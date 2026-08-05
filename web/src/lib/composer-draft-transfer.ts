import { getDraft, saveDraft } from '@/lib/composer-drafts'
import {
    getDraftAttachments,
    getRestoredUploadMetadata,
    saveDraftAttachments,
    type AttachmentDraftInput,
} from '@/lib/composer-attachment-drafts'

type ComposerDraftSnapshot = {
    text: string
    attachments: AttachmentDraftInput[]
}

const liveSnapshots = new Map<string, ComposerDraftSnapshot>()
const MAX_LIVE_SNAPSHOTS = 50

export function setComposerDraftSnapshot(
    sessionId: string,
    text: string,
    attachments: readonly AttachmentDraftInput[],
): void {
    // Keep the in-memory fast path bounded because snapshots retain File blobs.
    if (!liveSnapshots.has(sessionId) && liveSnapshots.size >= MAX_LIVE_SNAPSHOTS) {
        const oldestSessionId = liveSnapshots.keys().next().value
        if (oldestSessionId) liveSnapshots.delete(oldestSessionId)
    }
    liveSnapshots.set(sessionId, { text, attachments: [...attachments] })
}

/** Copy a draft to the new id returned by resume/reopen before navigating. */
export async function transferComposerDraft(sourceSessionId: string, targetSessionId: string): Promise<void> {
    if (sourceSessionId === targetSessionId) return

    const live = liveSnapshots.get(sourceSessionId)
    const text = live ? live.text : getDraft(sourceSessionId)
    const sourceAttachments = live
        ? live.attachments
        : (await getDraftAttachments(sourceSessionId)).map((file, index) => {
            const metadata = getRestoredUploadMetadata(file)
            return {
                id: metadata?.id ?? `transferred-${index}-${file.name}`,
                file,
                path: metadata?.path,
                previewUrl: metadata?.previewUrl,
                uploadSessionId: metadata?.uploadSessionId,
            }
        })
    // Reopened sessions can receive a new id and cannot safely reuse upload
    // paths authorized for (and potentially deleted with) the source session.
    const attachments = sourceAttachments.map((attachment) => ({
        ...attachment,
        path: undefined,
        previewUrl: undefined,
        uploadSessionId: undefined,
    }))

    saveDraft(targetSessionId, text)
    saveDraftAttachments(targetSessionId, attachments)
    liveSnapshots.delete(sourceSessionId)
}
