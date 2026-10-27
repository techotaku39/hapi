import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ApiClient } from '@/api/client'
import { I18nProvider } from '@/lib/i18n-context'
import { encodeBase64 } from '@/lib/utils'
import { MAX_MARKDOWN_IMAGE_BYTES } from '@/lib/markdown-file-assets'
import { MarkdownRenderer } from './MarkdownRenderer'

const navigate = vi.hoisted(() => vi.fn())

vi.mock('@tanstack/react-router', async () => {
    const actual = await vi.importActual<typeof import('@tanstack/react-router')>('@tanstack/react-router')
    return {
        ...actual,
        useNavigate: () => navigate,
    }
})

describe('MarkdownRenderer', () => {
    afterEach(() => {
        cleanup()
        localStorage.clear()
        vi.clearAllMocks()
    })

    it('renders fenced code blocks with the shared syntax highlighter shell in standalone mode', () => {
        render(
            <I18nProvider>
                <MarkdownRenderer standalone content={'```ts\nexport const ok = true\n```'} />
            </I18nProvider>
        )

        expect(document.querySelector('.aui-md-codeblock')).toBeTruthy()
    })

    it('renders inline code without the fenced-code shell in standalone mode', () => {
        render(
            <I18nProvider>
                <MarkdownRenderer standalone content={'Use `npm test` here.'} />
            </I18nProvider>
        )

        expect(document.querySelector('.aui-md-codeblock')).toBeFalsy()
        expect(document.querySelector('.aui-md-code')).toBeTruthy()
    })

    it('renders TeX bracket math in standalone mode', () => {
        const { container } = render(
            <I18nProvider>
                <MarkdownRenderer standalone content={String.raw`\[
E = mc^2
\]`} />
            </I18nProvider>
        )

        expect(container.querySelector('.katex-display')).toBeTruthy()
        expect(container.querySelector('.katex')).toBeTruthy()
        expect(container.textContent).not.toContain('\\[')
    })

    it('renders TeX bracket math through the assistant-ui path', () => {
        const { container } = render(
            <I18nProvider>
                <MarkdownRenderer content={String.raw`Result: \(x^2\)`} />
            </I18nProvider>
        )

        expect(container.querySelector('.katex')).toBeTruthy()
        expect(container.querySelector('.katex-display')).toBeFalsy()
    })

    it('resolves standalone file links and loads relative images through the session API', async () => {
        const readSessionFile = vi.fn(async () => ({
            success: true,
            content: encodeBase64('png-bytes'),
            size: 9,
        }))
        const api = { readSessionFile } as unknown as ApiClient

        render(
            <I18nProvider>
                <MarkdownRenderer
                    standalone
                    content={'[Related note](error-notes.md)\n\n![Page](images/page-001.png)'}
                    filePreview={{ api, sessionId: 'session-1', filePath: 'notes/notes-01.md' }}
                />
            </I18nProvider>
        )

        const link = screen.getByRole('link', { name: 'Related note' })
        expect(link.getAttribute('href')).toContain('/sessions/session-1/file?path=')
        fireEvent.click(link)
        expect(navigate).toHaveBeenCalledWith(expect.objectContaining({
            to: '/sessions/$sessionId/file',
            params: { sessionId: 'session-1' },
        }))
        await waitFor(() => expect(screen.getByRole('img', { name: 'Page' })).toHaveAttribute('src', expect.stringContaining('data:image/png;base64,')))
        expect(readSessionFile).toHaveBeenCalledWith('session-1', 'notes/images/page-001.png', MAX_MARKDOWN_IMAGE_BYTES)
    })

    it('loads HTTPS images directly and renders a fallback when they fail', async () => {
        render(
            <I18nProvider>
                <MarkdownRenderer
                    standalone
                    content={'![Remote](https://example.com/image.png)'}
                    filePreview={{
                        api: {} as ApiClient,
                        sessionId: 'session-1',
                        filePath: 'notes/notes-01.md',
                    }}
                />
            </I18nProvider>
        )

        const image = screen.getByRole('img', { name: 'Remote' })
        expect(image).toHaveAttribute('src', 'https://example.com/image.png')
        fireEvent.error(image)
        await waitFor(() => expect(screen.getByRole('img', { name: 'Remote' })).toHaveAttribute('data-hapi-markdown-image-fallback', 'true'))
    })

    it('honors the external-link new-tab preference in standalone previews', () => {
        localStorage.setItem('hapi-open-external-links-in-new-tab', 'true')

        render(
            <I18nProvider>
                <MarkdownRenderer
                    standalone
                    content={'[Remote](https://example.com/docs)' }
                    filePreview={{
                        api: {} as ApiClient,
                        sessionId: 'session-1',
                        filePath: 'notes/notes-01.md',
                    }}
                />
            </I18nProvider>
        )

        const link = screen.getByRole('link', { name: 'Remote' })
        expect(link).toHaveAttribute('target', '_blank')
        expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    })

    it('preserves safe URI links in standalone previews', () => {
        render(
            <I18nProvider>
                <MarkdownRenderer
                    standalone
                    content={'[Email](mailto:help@example.com)'}
                    filePreview={{
                        api: {} as ApiClient,
                        sessionId: 'session-1',
                        filePath: 'notes/notes-01.md',
                    }}
                />
            </I18nProvider>
        )

        expect(screen.getByRole('link', { name: 'Email' })).toHaveAttribute('href', 'mailto:help@example.com')
    })

    it('preserves local image state across parent rerenders', async () => {
        const readSessionFile = vi.fn(async () => ({
            success: true,
            content: encodeBase64('png-bytes'),
            size: 9,
        }))
        const api = { readSessionFile } as unknown as ApiClient
        const filePreview = { api, sessionId: 'session-1', filePath: 'notes/notes-01.md' }
        const content = '![First](images/first.png)\n\n![Second](images/second.png)'
        const view = render(
            <I18nProvider>
                <MarkdownRenderer standalone content={content} filePreview={filePreview} />
            </I18nProvider>
        )

        await waitFor(() => expect(screen.getAllByRole('img')).toHaveLength(2))
        expect(readSessionFile).toHaveBeenCalledTimes(2)

        view.rerender(
            <I18nProvider>
                <MarkdownRenderer standalone content={content} filePreview={filePreview} />
            </I18nProvider>
        )

        await waitFor(() => expect(screen.getAllByRole('img')).toHaveLength(2))
        expect(readSessionFile).toHaveBeenCalledTimes(2)
    })
})
