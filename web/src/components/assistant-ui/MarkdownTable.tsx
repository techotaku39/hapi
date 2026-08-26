import {
    useCallback,
    useEffect,
    useRef,
    useState,
    type ComponentPropsWithoutRef,
    type RefObject,
    type ReactNode,
} from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { CheckIcon, CloseIcon, CopyIcon } from '@/components/icons'
import { useOptionalHappyChatContext } from '@/components/AssistantChat/context'
import { Spinner } from '@/components/Spinner'
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard'
import { getShareImageFileName, getShareTableFileName } from '@/lib/share-image-filename'
import { useTranslation } from '@/lib/use-translation'
import { cn } from '@/lib/utils'

type TableProps = ComponentPropsWithoutRef<'table'>

type IconProps = {
    className?: string
}

type TableOrientationApi = {
    lock?: (orientation: 'landscape') => Promise<void>
    unlock?: () => void
}

function ExpandIcon(props: IconProps) {
    return (
        <svg
            className={props.className ?? 'h-4 w-4'}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            <path d="M8 3H3v5M16 3h5v5M8 21H3v-5M21 16v5h-5" />
            <path d="m3 3 6 6M21 3l-6 6M3 21l6-6M21 21l-6-6" />
        </svg>
    )
}

function DownloadIcon(props: IconProps) {
    return (
        <svg
            className={props.className ?? 'h-4 w-4'}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            <path d="M12 3v12" />
            <path d="m7 10 5 5 5-5" />
            <path d="M5 21h14" />
        </svg>
    )
}

function ImageIcon(props: IconProps) {
    return (
        <svg
            className={props.className ?? 'h-4 w-4'}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <path d="m3 16 5-5 4 4 3-3 6 6" />
        </svg>
    )
}

function TableActionButton(props: {
    label: string
    onClick: () => void
    children: ReactNode
    variant?: 'surface' | 'ghost'
}) {
    const variantClassName = props.variant === 'ghost'
        ? 'border-0 bg-transparent text-[var(--app-hint)] shadow-none hover:text-[var(--app-fg)]'
        : 'border border-[var(--app-border)] bg-[var(--app-md-table-bg)]/90 text-[var(--app-hint)] shadow-sm hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)]'

    return (
        <button
            type="button"
            aria-label={props.label}
            title={props.label}
            onClick={props.onClick}
            className={cn(
                'flex h-7 w-7 items-center justify-center rounded-md transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)]',
                variantClassName,
            )}
        >
            {props.children}
        </button>
    )
}

function isCoarsePointerDevice(): boolean {
    if (typeof window === 'undefined') return false

    const coarsePointer = window.matchMedia('(pointer: coarse)').matches
    const touchPoints = typeof navigator !== 'undefined' ? navigator.maxTouchPoints : 0
    const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : ''
    const mobileUserAgent = /Android|iPhone|iPad|iPod|Mobile/i.test(userAgent)
    const desktopModeIpad = /Macintosh/i.test(userAgent) && touchPoints > 1

    return coarsePointer || mobileUserAgent || desktopModeIpad
}

/** Exported for responsive behavior tests and future table viewers. */
export function isMobileTableViewerViewport(): boolean {
    if (typeof window === 'undefined') return false
    const shortSide = Math.min(window.innerWidth, window.innerHeight)
    return shortSide <= 767 && isCoarsePointerDevice()
}

function getTableCellText(cell: HTMLTableCellElement): string {
    const innerText = cell.innerText
    const text = typeof innerText === 'string' ? innerText : cell.textContent ?? ''
    return text.replace(/\s+/g, ' ').trim()
}

function escapeCsvCell(value: string): string {
    const safeValue = /^[\t\r\n ]*[=+\-@]/.test(value) ? `'${value}` : value
    return `"${safeValue.replace(/"/g, '""')}"`
}

export function serializeTableToCsv(table: HTMLTableElement): string {
    const rows = Array.from(table.rows).map((row) =>
        Array.from(row.cells).map((cell) => escapeCsvCell(getTableCellText(cell))).join(','),
    )

    return rows.length > 0 ? `\uFEFF${rows.join('\r\n')}\r\n` : '\uFEFF'
}

function escapeMarkdownTableCell(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')
}

function formatMarkdownTableRow(cells: string[], width: number): string {
    const padded = [...cells, ...Array.from({ length: Math.max(0, width - cells.length) }, () => '')]
    return `| ${padded.map(escapeMarkdownTableCell).join(' | ')} |`
}

function getTableCellAlignment(cell: HTMLTableCellElement | undefined): 'left' | 'center' | 'right' | undefined {
    const alignment = cell?.getAttribute('align') ?? cell?.style.textAlign
    if (alignment === 'left' || alignment === 'center' || alignment === 'right') return alignment
    return undefined
}

function formatMarkdownAlignment(alignment: 'left' | 'center' | 'right' | undefined): string {
    if (alignment === 'left') return ':---'
    if (alignment === 'center') return ':---:'
    if (alignment === 'right') return '---:'
    return '---'
}

export function serializeTableToMarkdown(table: HTMLTableElement): string {
    const rows = Array.from(table.rows).map((row) =>
        Array.from(row.cells).map(getTableCellText),
    )
    if (rows.length === 0) return ''

    const width = Math.max(...rows.map((row) => row.length), 1)
    const header = rows[0] ?? []
    const headerCells = Array.from(table.tHead?.rows[0]?.cells ?? table.rows[0]?.cells ?? [])
    const separator = Array.from({ length: width }, (_, index) => formatMarkdownAlignment(getTableCellAlignment(headerCells[index])))
    return [
        formatMarkdownTableRow(header, width),
        formatMarkdownTableRow(separator, width),
        ...rows.slice(1).map((row) => formatMarkdownTableRow(row, width)),
    ].join('\n') + '\n'
}

export function downloadTableAsCsv(table: HTMLTableElement, filename = 'hapi-table.csv'): void {
    if (typeof document === 'undefined' || typeof URL.createObjectURL !== 'function') return

    const blob = new Blob([serializeTableToCsv(table)], { type: 'text/csv;charset=utf-8' })
    downloadBlob(blob, filename)
}

function downloadBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = filename
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    // Match the working session-image download path. Some mobile browsers
    // read a Blob URL asynchronously after click; revoking it immediately
    // makes the download appear to do nothing.
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function createStaticTableImageClone(table: HTMLTableElement, tableWidth: number): {
    table: HTMLTableElement
    cleanup: () => void
} {
    const wrapper = document.createElement('div')
    wrapper.dataset.hapiTableImageRender = 'true'
    Object.assign(wrapper.style, {
        position: 'fixed',
        left: '-100000px',
        top: '0',
        width: `${tableWidth}px`,
        maxWidth: 'none',
        overflow: 'visible',
        pointerEvents: 'none',
    })

    const clone = table.cloneNode(true) as HTMLTableElement
    clone.style.setProperty('width', `${tableWidth}px`, 'important')
    clone.style.setProperty('min-width', `${tableWidth}px`, 'important')
    clone.querySelectorAll('thead, thead *').forEach((element) => {
        if (!(element instanceof HTMLElement)) return
        element.style.setProperty('position', 'static', 'important')
        element.style.removeProperty('top')
        element.style.removeProperty('z-index')
    })

    wrapper.appendChild(clone)
    document.body.appendChild(wrapper)
    return {
        table: clone,
        cleanup: () => wrapper.remove(),
    }
}

export const MAX_TABLE_EXPORT_PIXELS = 24_000_000

export async function renderTableAsImage(table: HTMLTableElement): Promise<Blob> {
    if (typeof document === 'undefined') throw new Error('Cannot render a table outside the browser')

    const { default: html2canvas } = await import('html2canvas-pro')
    const tableWidth = Math.max(table.scrollWidth, Math.ceil(table.getBoundingClientRect().width), 1)
    const tableHeight = Math.max(table.scrollHeight, Math.ceil(table.getBoundingClientRect().height), 1)
    const tableBackground = getComputedStyle(table).backgroundColor
    const backgroundColor = tableBackground === 'rgba(0, 0, 0, 0)'
        ? getComputedStyle(document.body).backgroundColor
        : tableBackground
    const scale = Math.min(
        window.devicePixelRatio || 1,
        2,
        Math.sqrt(MAX_TABLE_EXPORT_PIXELS / (tableWidth * tableHeight)),
    )
    const imageTable = createStaticTableImageClone(table, tableWidth)
    try {
        const canvas = await html2canvas(imageTable.table, {
            backgroundColor: backgroundColor || null,
            foreignObjectRendering: false,
            logging: false,
            scale,
            useCORS: true,
            width: tableWidth,
            height: tableHeight,
            windowWidth: Math.max(document.documentElement.clientWidth, tableWidth),
            windowHeight: Math.max(document.documentElement.clientHeight, tableHeight),
        })
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
        if (!blob) throw new Error('Failed to encode table image')
        return blob
    } finally {
        imageTable.cleanup()
    }
}

export async function saveTableAsImage(table: HTMLTableElement, filename = getShareImageFileName('Table', 'table')): Promise<void> {
    const blob = await renderTableAsImage(table)
    await downloadBlob(blob, filename)
}

/**
 * Mobile browsers generally only honor orientation locks from fullscreen.
 * Keep this best-effort so unsupported browsers still get the full table view.
 */
export async function enterMobileTableViewer(): Promise<boolean> {
    if (typeof document === 'undefined') return false

    let enteredFullscreen = false
    const root = document.documentElement
    if (!document.fullscreenElement && typeof root.requestFullscreen === 'function') {
        try {
            await root.requestFullscreen()
            enteredFullscreen = true
        } catch {
            // Fullscreen can be denied by browser policy; keep the viewer usable.
        }
    }

    const orientation = typeof window !== 'undefined'
        ? window.screen.orientation as unknown as TableOrientationApi | undefined
        : undefined
    if (orientation && typeof orientation.lock === 'function') {
        try {
            await orientation.lock('landscape')
        } catch {
            // Orientation lock is unavailable on some browsers and iOS versions.
        }
    }

    return enteredFullscreen
}

export function leaveMobileTableViewer(enteredFullscreen: boolean): void {
    if (typeof window !== 'undefined') {
        const orientation = window.screen.orientation as unknown as TableOrientationApi | undefined
        if (orientation && typeof orientation.unlock === 'function') {
            try {
                orientation.unlock()
            } catch {
                // Ignore browsers that reject unlock after an interrupted rotation.
            }
        }
    }

    if (enteredFullscreen && typeof document !== 'undefined' && typeof document.exitFullscreen === 'function') {
        void document.exitFullscreen().catch(() => {
            // The user may already have exited browser fullscreen manually.
        })
    }
}

function TableViewer(props: {
    open: boolean
    onClose: () => void
    tableProps: TableProps
    tableRef: RefObject<HTMLTableElement | null>
    imageTitle: string
}) {
    const { t } = useTranslation()
    const { className, children, ...rest } = props.tableProps
    const { copied, copy } = useCopyToClipboard()
    const [savingImage, setSavingImage] = useState(false)
    const [preparedImage, setPreparedImage] = useState<Blob | null>(null)
    const [toolbarVisible, setToolbarVisible] = useState(true)
    const viewerRef = useRef<HTMLDivElement>(null)
    const lastScrollTopRef = useRef(0)
    const reverseScrollDistanceRef = useRef(0)
    const toolbarVisibleRef = useRef(true)

    const setToolbarState = useCallback((visible: boolean) => {
        if (toolbarVisibleRef.current === visible) return
        toolbarVisibleRef.current = visible
        setToolbarVisible(visible)
    }, [])

    const handleViewerScroll = useCallback(() => {
        const viewer = viewerRef.current
        if (!viewer) return

        const scrollTop = viewer.scrollTop
        const previousScrollTop = lastScrollTopRef.current
        lastScrollTopRef.current = scrollTop
        const delta = scrollTop - previousScrollTop

        if (scrollTop <= 0) {
            reverseScrollDistanceRef.current = 0
            setToolbarState(true)
        } else if (delta > 0) {
            reverseScrollDistanceRef.current = 0
            setToolbarState(false)
        } else if (delta < 0 && !toolbarVisibleRef.current) {
            reverseScrollDistanceRef.current += -delta
            const distanceToBottom = Math.max(0, viewer.scrollHeight - viewer.clientHeight - scrollTop)
            if (reverseScrollDistanceRef.current >= 12 && distanceToBottom > 8) {
                reverseScrollDistanceRef.current = 0
                setToolbarState(true)
            }
        } else if (delta >= 0) {
            reverseScrollDistanceRef.current = 0
        }
    }, [setToolbarState])

    const setViewerElement = useCallback((viewer: HTMLDivElement | null) => {
        const previousViewer = viewerRef.current
        if (previousViewer) previousViewer.removeEventListener('scroll', handleViewerScroll)

        viewerRef.current = viewer
        if (!viewer) return

        reverseScrollDistanceRef.current = 0
        lastScrollTopRef.current = viewer.scrollTop
        setToolbarState(viewer.scrollTop <= 0)
        viewer.addEventListener('scroll', handleViewerScroll, { passive: true })
    }, [handleViewerScroll, setToolbarState])

    useEffect(() => {
        if (!props.open) {
            lastScrollTopRef.current = 0
            reverseScrollDistanceRef.current = 0
            setToolbarState(true)
        }
    }, [props.open, setToolbarState])

    useEffect(() => () => {
        viewerRef.current?.removeEventListener('scroll', handleViewerScroll)
    }, [handleViewerScroll])

    useEffect(() => {
        if (!props.open) setPreparedImage(null)
    }, [props.open])

    const handleDownload = useCallback(() => {
        if (props.tableRef.current) {
            downloadTableAsCsv(props.tableRef.current, getShareTableFileName(props.imageTitle, 'csv'))
        }
    }, [props.imageTitle, props.tableRef])

    const handleCopyMarkdown = useCallback(() => {
        if (props.tableRef.current) {
            void copy(serializeTableToMarkdown(props.tableRef.current))
        }
    }, [copy, props.tableRef])

    const handleSaveImage = useCallback(() => {
        const table = props.tableRef.current
        if (!table || savingImage) return

        setSavingImage(true)
        const filename = getShareImageFileName(props.imageTitle, 'table')
        const imagePromise = preparedImage
            ? Promise.resolve(preparedImage)
            : renderTableAsImage(table).then((blob) => {
                setPreparedImage(blob)
                return blob
            })
        void imagePromise
            .then((blob) => downloadBlob(blob, filename))
            .catch(() => undefined)
            .finally(() => setSavingImage(false))
    }, [preparedImage, props.imageTitle, props.tableRef, savingImage])

    const viewerTitle = props.imageTitle.trim() || t('table.viewerTitle')

    return (
        <DialogPrimitive.Root
            open={props.open}
            onOpenChange={(nextOpen) => {
                if (!nextOpen) props.onClose()
            }}
        >
            <DialogPrimitive.Portal>
                <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[var(--app-bg)]" />
                <DialogPrimitive.Content
                    aria-label={viewerTitle}
                    className="fixed inset-0 z-50 flex h-[100dvh] w-screen flex-col bg-[var(--app-bg)] p-0 outline-none"
                >
                    {savingImage ? (
                        <div
                            data-hapi-table-save-status="true"
                            role="status"
                            aria-live="polite"
                            className="pointer-events-none absolute left-1/2 top-3 z-20 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-[var(--app-border)] bg-[var(--app-bg)]/90 px-2.5 py-1 text-xs text-[var(--app-hint)] shadow-sm backdrop-blur"
                        >
                            <Spinner size="sm" label={null} className="text-current" />
                            <span>{t('table.savingImage')}</span>
                        </div>
                    ) : null}
                    <DialogPrimitive.Title className="sr-only">
                        {viewerTitle}
                    </DialogPrimitive.Title>
                    <DialogPrimitive.Description className="sr-only">
                        {viewerTitle}
                    </DialogPrimitive.Description>

                    <div
                        data-hapi-table-viewer-toolbar="true"
                        aria-hidden={!toolbarVisible}
                        className={cn(
                            'flex shrink-0 items-center gap-1 overflow-hidden bg-[var(--app-bg)]/95 backdrop-blur-sm transition-[max-height,opacity,padding,border-color] duration-200',
                            toolbarVisible
                                ? 'max-h-24 px-1.5 py-0 opacity-100'
                                : 'pointer-events-none max-h-0 border-transparent p-0 opacity-0',
                        )}
                    >
                        <button
                            type="button"
                            tabIndex={toolbarVisible ? 0 : -1}
                            aria-label={t('table.closeFullscreen')}
                            title={t('table.closeFullscreen')}
                            onClick={props.onClose}
                            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[var(--app-hint)] transition-colors hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)]"
                        >
                            <CloseIcon className="h-5 w-5" />
                        </button>
                        <div
                            data-hapi-table-viewer-heading="true"
                            className="min-w-0 flex-1 truncate text-lg font-semibold text-[var(--app-fg)]"
                        >
                            {viewerTitle}
                        </div>
                        <div className="ml-auto flex items-center gap-1">
                            <button
                                type="button"
                                tabIndex={toolbarVisible ? 0 : -1}
                                aria-label={copied ? t('table.copiedMarkdown') : t('table.copyMarkdown')}
                                title={copied ? t('table.copiedMarkdown') : t('table.copyMarkdown')}
                                onClick={handleCopyMarkdown}
                                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[var(--app-hint)] transition-colors hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)]"
                            >
                                {copied ? <CheckIcon className="h-5 w-5" /> : <CopyIcon className="h-5 w-5" />}
                            </button>
                            <button
                                type="button"
                                tabIndex={toolbarVisible ? 0 : -1}
                                aria-label={savingImage ? t('table.savingImage') : t('table.saveImage')}
                                title={savingImage ? t('table.savingImage') : t('table.saveImage')}
                                onClick={handleSaveImage}
                                disabled={savingImage}
                                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[var(--app-hint)] transition-colors hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)] disabled:opacity-50"
                            >
                                <ImageIcon className="h-5 w-5" />
                            </button>
                            <button
                                type="button"
                                tabIndex={toolbarVisible ? 0 : -1}
                                aria-label={t('table.download')}
                                title={t('table.download')}
                                onClick={handleDownload}
                                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[var(--app-hint)] transition-colors hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)]"
                            >
                                <DownloadIcon className="h-5 w-5" />
                            </button>
                        </div>
                    </div>

                    <div
                        ref={setViewerElement}
                        data-hapi-table-viewer="true"
                        className="min-h-0 flex-1 overflow-auto overscroll-contain pb-0 pl-0 pr-0 pt-0"
                    >
                        <table
                            {...rest}
                            ref={props.tableRef}
                            className={cn('aui-md-table w-max min-w-full border-collapse text-sm', className)}
                        >
                            {children}
                        </table>
                    </div>
                </DialogPrimitive.Content>
            </DialogPrimitive.Portal>
        </DialogPrimitive.Root>
    )
}

export function MarkdownTable(props: TableProps) {
    const { t } = useTranslation()
    const chatContext = useOptionalHappyChatContext()
    const { className, children, ...rest } = props
    const inlineTableRef = useRef<HTMLTableElement>(null)
    const viewerTableRef = useRef<HTMLTableElement>(null)
    const [viewerOpen, setViewerOpen] = useState(false)
    const openRef = useRef(false)
    const mobileViewerRef = useRef(false)
    const enteredFullscreenRef = useRef(false)

    const closeViewer = useCallback(() => {
        openRef.current = false
        setViewerOpen(false)

        if (mobileViewerRef.current) {
            mobileViewerRef.current = false
            const enteredFullscreen = enteredFullscreenRef.current
            enteredFullscreenRef.current = false
            leaveMobileTableViewer(enteredFullscreen)
        }
    }, [])

    const openViewer = useCallback(() => {
        openRef.current = true
        setViewerOpen(true)

        const isMobile = isMobileTableViewerViewport()
        mobileViewerRef.current = isMobile
        if (!isMobile) return

        void enterMobileTableViewer().then((enteredFullscreen) => {
            if (!openRef.current) {
                leaveMobileTableViewer(enteredFullscreen)
                return
            }
            enteredFullscreenRef.current = enteredFullscreen
        })
    }, [])

    useEffect(() => {
        if (typeof document === 'undefined') return undefined

        const handleFullscreenChange = () => {
            if (!openRef.current || !mobileViewerRef.current || !enteredFullscreenRef.current) return
            if (document.fullscreenElement) return

            enteredFullscreenRef.current = false
            mobileViewerRef.current = false
            openRef.current = false
            setViewerOpen(false)
        }

        document.addEventListener('fullscreenchange', handleFullscreenChange)
        return () => document.removeEventListener('fullscreenchange', handleFullscreenChange)
    }, [])

    useEffect(() => () => {
        if (mobileViewerRef.current) {
            leaveMobileTableViewer(enteredFullscreenRef.current)
        }
    }, [])

    const tableProps = { ...rest, className, children }
    const imageTitle = chatContext?.sessionTitle ?? 'Table'

    return (
        <>
            <div
                className="aui-md-table-shell aui-md-table-wrapper aui-md-table-frame relative my-3 max-w-full"
                aria-hidden={viewerOpen || undefined}
            >
                <div className="max-w-full overflow-x-auto rounded-xl bg-[var(--app-md-table-bg)]">
                    <table
                        {...rest}
                        ref={inlineTableRef}
                        className={cn('aui-md-table w-full border-collapse text-sm', className)}
                    >
                        {children}
                    </table>
                </div>
                <div data-hapi-share-exclude="true" className="aui-md-table-actions flex items-center">
                    <TableActionButton label={t('table.openFullscreen')} onClick={openViewer} variant="ghost">
                        <ExpandIcon className="h-4 w-4" />
                    </TableActionButton>
                </div>
            </div>

            <TableViewer
                open={viewerOpen}
                onClose={closeViewer}
                tableProps={tableProps}
                tableRef={viewerTableRef}
                imageTitle={imageTitle}
            />
        </>
    )
}
