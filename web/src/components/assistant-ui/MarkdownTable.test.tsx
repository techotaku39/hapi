import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { I18nProvider } from '@/lib/i18n-context'
import { MarkdownRenderer } from '@/components/MarkdownRenderer'

const html2canvas = vi.hoisted(() => vi.fn())
vi.mock('html2canvas-pro', () => ({ default: html2canvas }))

import {
    downloadTableAsCsv,
    isMobileTableViewerViewport,
    MAX_TABLE_EXPORT_PIXELS,
    renderTableAsImage,
    saveTableAsImage,
    serializeTableToMarkdown,
    serializeTableToCsv,
} from './MarkdownTable'

const TABLE_MARKDOWN = `| Project | Stars |
| --- | ---: |
| HAPI | 128 |
| HAPI, local-first | 42 |`

function renderTable() {
    return render(
        <I18nProvider>
            <MarkdownRenderer standalone content={TABLE_MARKDOWN} />
        </I18nProvider>,
    )
}

describe('MarkdownTable', () => {
    const originalMatchMedia = window.matchMedia
    const originalOrientation = window.screen.orientation
    const originalNavigatorShare = navigator.share
    const originalNavigatorCanShare = navigator.canShare
    const originalMaxTouchPoints = navigator.maxTouchPoints
    const originalUserAgent = navigator.userAgent
    const originalInnerWidth = window.innerWidth
    const originalInnerHeight = window.innerHeight

    beforeEach(() => {
        localStorage.clear()
        vi.restoreAllMocks()
        html2canvas.mockReset()
        window.matchMedia = originalMatchMedia
        Object.defineProperty(navigator, 'share', {
            configurable: true,
            value: originalNavigatorShare,
        })
        Object.defineProperty(navigator, 'canShare', {
            configurable: true,
            value: originalNavigatorCanShare,
        })
        Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: originalMaxTouchPoints })
        Object.defineProperty(navigator, 'userAgent', { configurable: true, value: originalUserAgent })
        Object.defineProperty(window.screen, 'orientation', {
            configurable: true,
            value: originalOrientation,
        })
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalInnerWidth })
        Object.defineProperty(window, 'innerHeight', { configurable: true, value: originalInnerHeight })
    })

    afterEach(() => {
        window.matchMedia = originalMatchMedia
        Object.defineProperty(navigator, 'share', {
            configurable: true,
            value: originalNavigatorShare,
        })
        Object.defineProperty(navigator, 'canShare', {
            configurable: true,
            value: originalNavigatorCanShare,
        })
        Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: originalMaxTouchPoints })
        Object.defineProperty(navigator, 'userAgent', { configurable: true, value: originalUserAgent })
        Object.defineProperty(window.screen, 'orientation', {
            configurable: true,
            value: originalOrientation,
        })
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalInnerWidth })
        Object.defineProperty(window, 'innerHeight', { configurable: true, value: originalInnerHeight })
    })

    it('keeps the table header as the first row while exposing only a plain fullscreen action', () => {
        renderTable()

        const table = screen.getByRole('table')
        expect(table.firstElementChild?.tagName).toBe('THEAD')
        expect(table.parentElement?.parentElement).toHaveClass('aui-md-table-shell')
        const actions = table.parentElement?.parentElement?.querySelector('.aui-md-table-actions')
        expect(actions?.querySelectorAll('button')).toHaveLength(1)
        expect(screen.getByRole('button', { name: 'Open table full screen' })).toBeInTheDocument()
    })

    it('opens an enlarged PC viewer without requesting browser fullscreen or orientation lock', async () => {
        const requestFullscreen = vi.fn().mockResolvedValue(undefined)
        Object.defineProperty(document.documentElement, 'requestFullscreen', {
            configurable: true,
            value: requestFullscreen,
        })
        const lock = vi.fn().mockResolvedValue(undefined)
        Object.defineProperty(window.screen, 'orientation', {
            configurable: true,
            value: { lock, unlock: vi.fn() },
        })

        renderTable()
        fireEvent.click(screen.getByRole('button', { name: 'Open table full screen' }))

        expect(await screen.findByRole('dialog', { name: 'Table' })).toBeInTheDocument()
        const dialog = screen.getByRole('dialog', { name: 'Table' })
        expect(dialog).toContainElement(screen.getByRole('table'))
        expect(screen.getByRole('button', { name: 'Copy table as Markdown' })).toBeInTheDocument()
        const saveButton = screen.getByRole('button', { name: 'Save table as image' })
        expect(saveButton).toBeInTheDocument()
        expect(saveButton.querySelector('svg rect')).toHaveAttribute('width', '18')
        expect(saveButton.querySelector('svg rect')).toHaveAttribute('height', '18')
        expect(saveButton.querySelectorAll('svg path')).toHaveLength(1)
        expect(screen.getByRole('button', { name: 'Download table as CSV' })).toBeInTheDocument()
        expect(requestFullscreen).not.toHaveBeenCalled()
        expect(lock).not.toHaveBeenCalled()

        fireEvent.click(screen.getByRole('button', { name: 'Close table full screen' }))
        await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Table' })).not.toBeInTheDocument())
    })

    it('shows a saving status while the PNG is being generated', async () => {
        type CanvasStub = { toBlob: (callback: BlobCallback) => void }
        let resolveCanvas: ((value: CanvasStub | PromiseLike<CanvasStub>) => void) | undefined
        html2canvas.mockReturnValue(new Promise<CanvasStub>((resolve) => {
            resolveCanvas = resolve
        }))
        vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:hapi-table-image')
        vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
        vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

        renderTable()
        fireEvent.click(screen.getByRole('button', { name: 'Open table full screen' }))
        fireEvent.click(await screen.findByRole('button', { name: 'Save table as image' }))

        const savingStatus = screen.getByRole('status')
        expect(savingStatus).toHaveTextContent('Saving image…')
        expect(savingStatus).toHaveAttribute('data-hapi-table-save-status', 'true')
        expect(savingStatus).toHaveClass('left-1/2', '-translate-x-1/2', 'rounded-full')
        expect(savingStatus.querySelector('svg')).toHaveClass('animate-spin')
        expect(screen.getByRole('button', { name: 'Saving image…' })).toBeDisabled()

        resolveCanvas?.({
            toBlob: (callback: BlobCallback) => callback(new Blob(['png'], { type: 'image/png' })),
        })
        await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument())
    })

    it('requests mobile browser fullscreen and landscape orientation, then releases both on close', async () => {
        window.matchMedia = vi.fn((query: string) => ({
            matches: query.includes('max-width: 767px') || query.includes('pointer: coarse'),
            media: query,
            onchange: null,
            addListener() {},
            removeListener() {},
            addEventListener() {},
            removeEventListener() {},
            dispatchEvent() { return false },
        })) as typeof window.matchMedia
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 })
        Object.defineProperty(window, 'innerHeight', { configurable: true, value: 844 })

        const requestFullscreen = vi.fn().mockResolvedValue(undefined)
        const exitFullscreen = vi.fn().mockResolvedValue(undefined)
        Object.defineProperty(document.documentElement, 'requestFullscreen', {
            configurable: true,
            value: requestFullscreen,
        })
        Object.defineProperty(document, 'exitFullscreen', {
            configurable: true,
            value: exitFullscreen,
        })
        const lock = vi.fn().mockResolvedValue(undefined)
        const unlock = vi.fn()
        Object.defineProperty(window.screen, 'orientation', {
            configurable: true,
            value: { lock, unlock },
        })

        renderTable()
        fireEvent.click(screen.getByRole('button', { name: 'Open table full screen' }))

        await waitFor(() => {
            expect(requestFullscreen).toHaveBeenCalledTimes(1)
            expect(lock).toHaveBeenCalledWith('landscape')
        })

        fireEvent.click(screen.getByRole('button', { name: 'Close table full screen' }))
        await waitFor(() => expect(exitFullscreen).toHaveBeenCalledTimes(1))
        expect(unlock).toHaveBeenCalledTimes(1)
    })

    it('defers PNG rendering until the user requests an image save', async () => {
        window.matchMedia = vi.fn((query: string) => ({
            matches: query.includes('pointer: coarse'),
            media: query,
            onchange: null,
            addListener() {},
            removeListener() {},
            addEventListener() {},
            removeEventListener() {},
            dispatchEvent() { return false },
        })) as typeof window.matchMedia
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 })
        Object.defineProperty(window, 'innerHeight', { configurable: true, value: 844 })
        html2canvas.mockResolvedValue({
            toBlob: (callback: BlobCallback) => callback(new Blob(['png'], { type: 'image/png' })),
        })
        vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:hapi-table-image')
        vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
        vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

        renderTable()
        fireEvent.click(screen.getByRole('button', { name: 'Open table full screen' }))
        await screen.findByRole('dialog', { name: 'Table' })
        expect(html2canvas).not.toHaveBeenCalled()

        fireEvent.click(screen.getByRole('button', { name: 'Save table as image' }))
        await waitFor(() => expect(html2canvas).toHaveBeenCalledTimes(1))
    })

    it('recognizes a coarse-pointer phone that starts in landscape', () => {
        window.matchMedia = vi.fn((query: string) => ({
            matches: query.includes('pointer: coarse'),
            media: query,
            onchange: null,
            addListener() {},
            removeListener() {},
            addEventListener() {},
            removeEventListener() {},
            dispatchEvent() { return false },
        })) as typeof window.matchMedia
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: 915 })
        Object.defineProperty(window, 'innerHeight', { configurable: true, value: 412 })

        expect(isMobileTableViewerViewport()).toBe(true)
    })

    it('does not classify a touch-enabled Windows laptop as mobile', () => {
        window.matchMedia = vi.fn(() => ({
            matches: false,
            media: '',
            onchange: null,
            addListener() {},
            removeListener() {},
            addEventListener() {},
            removeEventListener() {},
            dispatchEvent() { return false },
        })) as typeof window.matchMedia
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1366 })
        Object.defineProperty(window, 'innerHeight', { configurable: true, value: 700 })
        Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: 5 })
        Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' })

        expect(isMobileTableViewerViewport()).toBe(false)
    })

    it('hides the viewer toolbar while scrolling down and restores it while scrolling up', async () => {
        window.matchMedia = vi.fn((query: string) => ({
            matches: query.includes('max-width: 767px') || query.includes('pointer: coarse'),
            media: query,
            onchange: null,
            addListener() {},
            removeListener() {},
            addEventListener() {},
            removeEventListener() {},
            dispatchEvent() { return false },
        })) as typeof window.matchMedia
        Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 })
        Object.defineProperty(window, 'innerHeight', { configurable: true, value: 844 })

        Object.defineProperty(document.documentElement, 'requestFullscreen', {
            configurable: true,
            value: vi.fn().mockResolvedValue(undefined),
        })
        Object.defineProperty(window.screen, 'orientation', {
            configurable: true,
            value: { lock: vi.fn().mockResolvedValue(undefined), unlock: vi.fn() },
        })

        renderTable()
        fireEvent.click(screen.getByRole('button', { name: 'Open table full screen' }))
        const dialog = await screen.findByRole('dialog', { name: 'Table' })
        const toolbar = dialog.querySelector('[data-hapi-table-viewer-toolbar="true"]')
        const viewer = dialog.querySelector('[data-hapi-table-viewer="true"]') as HTMLDivElement
        expect(toolbar).toHaveAttribute('aria-hidden', 'false')

        let scrollTop = 0
        Object.defineProperty(viewer, 'scrollTop', {
            configurable: true,
            get: () => scrollTop,
        })
        Object.defineProperty(viewer, 'scrollHeight', {
            configurable: true,
            get: () => 100,
        })
        Object.defineProperty(viewer, 'clientHeight', {
            configurable: true,
            get: () => 20,
        })

        scrollTop = 20
        fireEvent.scroll(viewer)
        await waitFor(() => expect(toolbar).toHaveAttribute('aria-hidden', 'true'))

        scrollTop = 15
        fireEvent.scroll(viewer)
        expect(toolbar).toHaveAttribute('aria-hidden', 'true')

        scrollTop = 80
        fireEvent.scroll(viewer)
        expect(toolbar).toHaveAttribute('aria-hidden', 'true')

        scrollTop = 79
        fireEvent.scroll(viewer)
        expect(toolbar).toHaveAttribute('aria-hidden', 'true')

        scrollTop = 80
        fireEvent.scroll(viewer)
        expect(toolbar).toHaveAttribute('aria-hidden', 'true')

        scrollTop = 79
        fireEvent.scroll(viewer)
        expect(toolbar).toHaveAttribute('aria-hidden', 'true')

        scrollTop = 65
        fireEvent.scroll(viewer)
        await waitFor(() => expect(toolbar).toHaveAttribute('aria-hidden', 'false'))

        scrollTop = 0
        fireEvent.scroll(viewer)
        await waitFor(() => expect(toolbar).toHaveAttribute('aria-hidden', 'false'))
    })

    it('serializes table cells as an Excel-friendly CSV', () => {
        const table = document.createElement('table')
        table.innerHTML = '<thead><tr><th>Project</th><th>Stars</th></tr></thead><tbody><tr><td>HAPI</td><td>128</td></tr><tr><td>HAPI, local-first</td><td>42</td></tr></tbody>'

        expect(serializeTableToCsv(table)).toBe('\uFEFF"Project","Stars"\r\n"HAPI","128"\r\n"HAPI, local-first","42"\r\n')
    })

    it('neutralizes formula-leading CSV cells', () => {
        const table = document.createElement('table')
        table.innerHTML = '<tr><td>=SUM(A1:A2)</td><td>+10</td><td>-1</td><td>@command</td></tr>'

        expect(serializeTableToCsv(table)).toBe('\uFEFF"\'=SUM(A1:A2)","\'+10","\'-1","\'@command"\r\n')
    })

    it('serializes the rendered table as Markdown', () => {
        const table = document.createElement('table')
        table.innerHTML = '<thead><tr><th>Project</th><th>Notes</th></tr></thead><tbody><tr><td>HAPI</td><td>Supports | tables</td></tr></tbody>'

        expect(serializeTableToMarkdown(table)).toBe('| Project | Notes |\n| --- | --- |\n| HAPI | Supports \\| tables |\n')
    })

    it('preserves Markdown column alignment when copying a table', () => {
        const table = document.createElement('table')
        table.innerHTML = '<thead><tr><th>Project</th><th align="right">Stars</th><th style="text-align: center">Status</th></tr></thead><tbody><tr><td>HAPI</td><td>128</td><td>Active</td></tr></tbody>'

        expect(serializeTableToMarkdown(table)).toBe('| Project | Stars | Status |\n| --- | ---: | :---: |\n| HAPI | 128 | Active |\n')
    })

    it('downloads the rendered table as CSV and keeps its Blob URL alive briefly', () => {
        vi.useFakeTimers()
        const table = document.createElement('table')
        table.innerHTML = '<tr><td>HAPI</td></tr>'
        const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:hapi-table')
        const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
        let clickedRel: string | undefined
        const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
            clickedRel = this.rel
        })

        try {
            downloadTableAsCsv(table, 'repositories.csv')

            expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob))
            expect(click).toHaveBeenCalledTimes(1)
            expect(clickedRel).toBe('')
            expect(document.querySelector('a[download="repositories.csv"]')).toBeNull()
            expect(revokeObjectURL).not.toHaveBeenCalled()

            vi.advanceTimersByTime(999)
            expect(revokeObjectURL).not.toHaveBeenCalled()
            vi.advanceTimersByTime(1)
            expect(revokeObjectURL).toHaveBeenCalledWith('blob:hapi-table')
        } finally {
            vi.useRealTimers()
        }
    })

    it('renders and downloads the table as a PNG image', async () => {
        const table = document.createElement('table')
        table.innerHTML = '<tr><td>HAPI</td></tr>'
        html2canvas.mockResolvedValue({
            toBlob: (callback: BlobCallback) => callback(new Blob(['png'], { type: 'image/png' })),
        })
        vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:hapi-table-image')
        vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
        const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

        await saveTableAsImage(table, 'repositories.png')

        expect(html2canvas).toHaveBeenCalledWith(expect.any(HTMLTableElement), expect.objectContaining({ useCORS: true }))
        expect(html2canvas.mock.calls[0]?.[0]).not.toBe(table)
        expect(click).toHaveBeenCalledTimes(1)
        expect(document.querySelector('a[download="repositories.png"]')).toBeNull()
    })

    it('renders a static table copy when the live header is sticky', async () => {
        const table = document.createElement('table')
        table.innerHTML = '<thead><tr><th>Project</th></tr></thead><tbody><tr><td>HAPI</td></tr></tbody>'
        table.querySelector('thead')?.setAttribute('style', 'position: sticky; top: 0;')

        html2canvas.mockImplementation(async () => {
            return {
                toBlob: (callback: BlobCallback) => callback(new Blob(['png'], { type: 'image/png' })),
            }
        })

        await renderTableAsImage(table)

        const renderedTable = html2canvas.mock.calls[0]?.[0] as HTMLTableElement | undefined
        expect(renderedTable).toBeDefined()
        expect(renderedTable).not.toBe(table)
        expect(renderedTable?.querySelector('thead')?.getAttribute('style')).not.toContain('position: sticky')
        expect(document.querySelector('[data-hapi-table-image-render="true"]')).toBeNull()
        expect(table.querySelector('thead')).toHaveStyle({ position: 'sticky', top: '0px' })
    })

    it('caps large table PNG rasterization to the pixel budget', async () => {
        const table = document.createElement('table')
        table.innerHTML = '<tr><td>HAPI</td></tr>'
        Object.defineProperty(table, 'scrollWidth', { configurable: true, value: 10_000 })
        Object.defineProperty(table, 'scrollHeight', { configurable: true, value: 10_000 })
        vi.spyOn(table, 'getBoundingClientRect').mockReturnValue({ width: 10_000, height: 10_000 } as DOMRect)
        html2canvas.mockResolvedValue({
            toBlob: (callback: BlobCallback) => callback(new Blob(['png'], { type: 'image/png' })),
        })

        await renderTableAsImage(table)

        const options = html2canvas.mock.calls[0]?.[1] as { width: number; height: number; scale: number }
        expect(options.scale).toBeLessThan(1)
        expect(options.width * options.height * options.scale ** 2).toBeLessThanOrEqual(MAX_TABLE_EXPORT_PIXELS)
    })

    it('uses the same direct download path on touch devices as shared images', () => {
        window.matchMedia = vi.fn((query: string) => ({
            matches: query.includes('pointer: coarse'),
            media: query,
            onchange: null,
            addListener() {},
            removeListener() {},
            addEventListener() {},
            removeEventListener() {},
            dispatchEvent() { return false },
        })) as typeof window.matchMedia

        const share = vi.fn().mockResolvedValue(undefined)
        const canShare = vi.fn().mockReturnValue(true)
        Object.defineProperty(navigator, 'share', { configurable: true, value: share })
        Object.defineProperty(navigator, 'canShare', { configurable: true, value: canShare })

        const table = document.createElement('table')
        table.innerHTML = '<tr><td>HAPI</td></tr>'
        const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
        downloadTableAsCsv(table, 'repositories.csv')

        expect(canShare).not.toHaveBeenCalled()
        expect(share).not.toHaveBeenCalled()
        expect(click).toHaveBeenCalledTimes(1)
    })
})
