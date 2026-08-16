import { useEffect, useRef, useState } from 'react'
import type { AttachmentMetadata } from '@/types/api'
import type { ApiClient } from '@/api/client'
import { FileIcon } from '@/components/FileIcon'
import { isImageMimeType } from '@/lib/fileAttachments'
import { ImagePreview } from '@/components/ImagePreview'

function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function ImageAttachment(props: { attachment: AttachmentMetadata; api: ApiClient; sessionId: string }) {
    const { attachment } = props
    const [thumbnailUrl, setThumbnailUrl] = useState(attachment.previewUrl ?? '')
    const [previewFailed, setPreviewFailed] = useState(false)
    const thumbnailUrlRef = useRef<string | undefined>(undefined)
    const originalUrlRef = useRef<string | undefined>(undefined)

    useEffect(() => {
        let cancelled = false
        setThumbnailUrl(attachment.previewUrl ?? '')
        setPreviewFailed(false)
        const attachmentId = attachment.attachmentId
        if (attachmentId && !attachment.previewUrl) {
            void (async () => {
                try {
                    let blob: Blob
                    let isOriginal = false
                    try {
                        blob = await props.api.fetchAttachmentBlob(props.sessionId, attachmentId, 'thumbnail')
                    } catch {
                        blob = await props.api.fetchAttachmentBlob(props.sessionId, attachmentId, 'original')
                        isOriginal = true
                    }
                    if (cancelled) return
                    const url = URL.createObjectURL(blob)
                    thumbnailUrlRef.current = url
                    if (isOriginal) originalUrlRef.current = url
                    setThumbnailUrl(url)
                } catch {
                    if (!cancelled) setPreviewFailed(true)
                }
            })()
        }
        return () => {
            cancelled = true
            if (thumbnailUrlRef.current) URL.revokeObjectURL(thumbnailUrlRef.current)
            if (originalUrlRef.current) URL.revokeObjectURL(originalUrlRef.current)
            thumbnailUrlRef.current = undefined
            originalUrlRef.current = undefined
        }
    }, [attachment.attachmentId, attachment.previewUrl, props.api, props.sessionId])

    if (previewFailed) {
        return <FileAttachment attachment={attachment} />
    }

    const openOriginal = async (): Promise<string | undefined> => {
        if (!attachment.attachmentId) return undefined
        if (originalUrlRef.current) return originalUrlRef.current
        try {
            const blob = await props.api.fetchAttachmentBlob(props.sessionId, attachment.attachmentId, 'original')
            const url = URL.createObjectURL(blob)
            originalUrlRef.current = url
            return url
        } catch {
            return undefined
        }
    }

    if (!thumbnailUrl) {
        return (
            <div className="flex h-32 w-48 items-center justify-center rounded-lg bg-[var(--app-bg)] text-xs text-[var(--app-hint)]">
                Loading preview…
            </div>
        )
    }

    return (
        <ImagePreview
            src={thumbnailUrl}
            fileName={attachment.filename}
            label={attachment.filename}
            onOpen={attachment.attachmentId ? openOriginal : undefined}
            buttonClassName="relative overflow-hidden rounded-lg text-left cursor-zoom-in"
            imageClassName="max-h-48 max-w-full object-contain"
            caption={(
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-2 py-1.5">
                    <span className="text-xs text-white/90 line-clamp-1">
                        {attachment.filename}
                    </span>
                </div>
            )}
        />
    )
}

function FileAttachment(props: { attachment: AttachmentMetadata }) {
    const { attachment } = props
    return (
        <div className="flex items-center gap-2 rounded-lg bg-[var(--app-bg)] px-3 py-2">
            <FileIcon fileName={attachment.filename} size={24} />
            <div className="min-w-0 flex-1">
                <div className="truncate text-base font-medium text-[var(--app-fg)]">
                    {attachment.filename}
                </div>
                <div className="text-xs text-[var(--app-hint)]">
                    {formatFileSize(attachment.size)}
                </div>
            </div>
        </div>
    )
}

export function MessageAttachments(props: { attachments: AttachmentMetadata[]; api: ApiClient; sessionId: string }) {
    const { attachments, api, sessionId } = props
    if (!attachments || attachments.length === 0) return null

    const images = attachments.filter(a => isImageMimeType(a.mimeType) && (a.previewUrl || a.attachmentId))
    const files = attachments.filter(a => !isImageMimeType(a.mimeType) || (!a.previewUrl && !a.attachmentId))

    return (
        <div className="mt-2 flex flex-col gap-2">
            {images.length > 0 && (
                <div
                    className="hapi-share-media-grid flex flex-wrap gap-2"
                    data-hapi-image-count={images.length}
                >
                    {images.map(attachment => (
                        <ImageAttachment key={attachment.id} attachment={attachment} api={api} sessionId={sessionId} />
                    ))}
                </div>
            )}
            {files.length > 0 && (
                <div className="flex flex-col gap-1.5">
                    {files.map(attachment => (
                        <FileAttachment key={attachment.id} attachment={attachment} />
                    ))}
                </div>
            )}
        </div>
    )
}
