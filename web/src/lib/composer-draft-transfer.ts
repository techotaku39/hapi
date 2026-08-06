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

type HandoffState = {
    targetSessionId: string
    pending: AttachmentDraftInput[]
    done: Promise<void>
    resolveDone: () => void
}

const activeHandoffs = new Map<string, HandoffState>()

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

export function clearComposerDraftSnapshot(sessionId: string): void {
    liveSnapshots.delete(sessionId)
}

function stripSessionScopedUploadFields(attachment: AttachmentDraftInput): AttachmentDraftInput {
    return {
        ...attachment,
        path: undefined,
        previewUrl: undefined,
        uploadSessionId: undefined,
    }
}

function mergeAttachmentsById(
    base: readonly AttachmentDraftInput[],
    pending: readonly AttachmentDraftInput[],
): AttachmentDraftInput[] {
    const byId = new Map<string, AttachmentDraftInput>()
    for (const attachment of base) {
        byId.set(attachment.id, attachment)
    }
    for (const attachment of pending) {
        byId.set(attachment.id, attachment)
    }
    return [...byId.values()]
}

async function loadPersistedAttachments(sessionId: string): Promise<AttachmentDraftInput[]> {
    return (await getDraftAttachments(sessionId)).map((file, index) => {
        const metadata = getRestoredUploadMetadata(file)
        return {
            id: metadata?.id ?? `transferred-${index}-${file.name}`,
            file,
            path: metadata?.path,
            previewUrl: metadata?.previewUrl,
            uploadSessionId: metadata?.uploadSessionId,
        }
    })
}

/** Copy a draft to the new id returned by resume/reopen before navigating. */
export async function transferComposerDraft(
    sourceSessionId: string,
    targetSessionId: string,
    pendingAttachments: readonly AttachmentDraftInput[] = [],
): Promise<void> {
    if (sourceSessionId === targetSessionId && pendingAttachments.length === 0) return

    const sourceLive = liveSnapshots.get(sourceSessionId)
    const targetLive = liveSnapshots.get(targetSessionId)

    let text: string
    let baseAttachments: AttachmentDraftInput[]

    if (sourceLive) {
        text = sourceLive.text
        baseAttachments = sourceLive.attachments
    } else if (targetLive) {
        // Source live was cleared by an earlier handoff; merge late files into the target.
        text = targetLive.text
        baseAttachments = targetLive.attachments
    } else {
        text = getDraft(sourceSessionId)
        baseAttachments = await loadPersistedAttachments(sourceSessionId)
    }

    // Reopened sessions can receive a new id and cannot safely reuse upload
    // paths authorized for (and potentially deleted with) the source session.
    // In-flight picks keep their local preview data URL.
    const strippedBase = baseAttachments.map(stripSessionScopedUploadFields)
    const normalizedPending = pendingAttachments.map((attachment) => ({
        id: attachment.id,
        file: attachment.file,
        previewUrl: attachment.previewUrl,
        path: undefined,
        uploadSessionId: undefined,
    }))
    const attachments = mergeAttachmentsById(strippedBase, normalizedPending)

    saveDraft(targetSessionId, text)
    saveDraftAttachments(targetSessionId, attachments)
    setComposerDraftSnapshot(targetSessionId, text, attachments)
    if (sourceSessionId !== targetSessionId) {
        liveSnapshots.delete(sourceSessionId)
    }
}

/**
 * Resume/upload handoff for a newly selected inactive-session attachment.
 * Concurrent multi-file drops share one transfer + navigation; late files merge into the target.
 */
export async function handoffComposerDraft(
    sourceSessionId: string,
    targetSessionId: string,
    pending: AttachmentDraftInput,
    onNavigable: (targetSessionId: string) => void | Promise<void>,
): Promise<void> {
    const pendingItem: AttachmentDraftInput = {
        id: pending.id,
        file: pending.file,
        previewUrl: pending.previewUrl,
    }

    if (sourceSessionId === targetSessionId) {
        await transferComposerDraft(sourceSessionId, targetSessionId, [pendingItem])
        return
    }

    const existing = activeHandoffs.get(sourceSessionId)
    if (existing) {
        if (!existing.pending.some((item) => item.id === pendingItem.id)) {
            existing.pending.push(pendingItem)
        }
        await existing.done
        // Ensure this file is on the target even if it missed the batched snapshot.
        await transferComposerDraft(sourceSessionId, targetSessionId, [pendingItem])
        return
    }

    let resolveDone!: () => void
    const done = new Promise<void>((resolve) => {
        resolveDone = resolve
    })
    const state: HandoffState = {
        targetSessionId,
        pending: [pendingItem],
        done,
        resolveDone,
    }
    activeHandoffs.set(sourceSessionId, state)

    try {
        // Let concurrent add() callbacks enqueue into state.pending before transferring.
        await new Promise<void>((resolve) => {
            setTimeout(resolve, 0)
        })
        const batch = [...state.pending]
        await transferComposerDraft(sourceSessionId, targetSessionId, batch)
        await onNavigable(targetSessionId)
        const late = state.pending.filter((item) => !batch.some((early) => early.id === item.id))
        if (late.length > 0) {
            await transferComposerDraft(sourceSessionId, targetSessionId, late)
        }
    } finally {
        resolveDone()
        activeHandoffs.delete(sourceSessionId)
    }
}
