import type { ScratchlistAttachmentMetadata } from '@hapi/protocol'

/** Client-only attachment metadata. The preview is never sent to the Hub. */
export type ScratchlistAttachmentWithPreview = ScratchlistAttachmentMetadata & {
    previewUrl?: string
}

type CachedPreview = {
    signature: string
    src: string
    kind: 'data' | 'object-url'
}

const previews = new Map<string, CachedPreview>()

function signature(attachment: ScratchlistAttachmentMetadata): string {
    return [
        attachment.id,
        attachment.filename,
        attachment.mimeType,
        attachment.size,
        attachment.path,
    ].join('\u001f')
}

function revokeIfOwned(preview: CachedPreview | undefined): void {
    if (preview?.kind === 'object-url' && typeof URL !== 'undefined') {
        URL.revokeObjectURL(preview.src)
    }
}

function putPreview(
    attachment: ScratchlistAttachmentMetadata,
    src: string,
    kind: CachedPreview['kind'],
): string {
    const next = {
        signature: signature(attachment),
        src,
        kind,
    } satisfies CachedPreview
    const current = previews.get(attachment.id)
    if (
        current
        && current.signature === next.signature
        && current.src === next.src
    ) {
        return current.src
    }
    revokeIfOwned(current)
    previews.set(attachment.id, next)
    return next.src
}

/** Remember a preview that already exists in the composer, without fetching it. */
export function rememberScratchlistAttachmentPreview(
    attachment: ScratchlistAttachmentMetadata,
    previewUrl: string | undefined,
): void {
    if (!previewUrl) return
    putPreview(attachment, previewUrl, 'data')
}

/** Resolve a preview from the attachment metadata or this page's memory cache. */
export function getScratchlistAttachmentPreview(
    attachment: ScratchlistAttachmentWithPreview,
): string | undefined {
    if (attachment.previewUrl) return attachment.previewUrl
    const cached = previews.get(attachment.id)
    return cached?.signature === signature(attachment) ? cached.src : undefined
}

/** Cache a blob URL downloaded for a thumbnail and prefer an existing data URL. */
export function rememberScratchlistAttachmentObjectUrl(
    attachment: ScratchlistAttachmentMetadata,
    objectUrl: string,
): string {
    const cached = previews.get(attachment.id)
    if (cached?.signature === signature(attachment)) {
        if (cached.kind === 'data') {
            if (typeof URL !== 'undefined') URL.revokeObjectURL(objectUrl)
            return cached.src
        }
        if (cached.src === objectUrl) return cached.src
    }
    return putPreview(attachment, objectUrl, 'object-url')
}

/** Test/lifecycle hook; also releases cached blob URLs when a page is discarded. */
export function clearScratchlistAttachmentPreviewCache(): void {
    for (const preview of previews.values()) revokeIfOwned(preview)
    previews.clear()
}
