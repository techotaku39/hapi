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

export function setComposerDraftSnapshot(
    sessionId: string,
    text: string,
    attachments: readonly AttachmentDraftInput[],
): void {
    liveSnapshots.set(sessionId, { text, attachments: [...attachments] })
}

/** Copy a draft to the new id returned by resume/reopen before navigating. */
export async function transferComposerDraft(sourceSessionId: string, targetSessionId: string): Promise<void> {
    if (sourceSessionId === targetSessionId) return

    const live = liveSnapshots.get(sourceSessionId)
    const text = live ? live.text : getDraft(sourceSessionId)
    const attachments = live
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

    saveDraft(targetSessionId, text)
    saveDraftAttachments(targetSessionId, attachments)
}
