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
/** Source → target after a handoff completes, so staggered adds append instead of reloading the source. */
const completedHandoffs = new Map<string, string>()
/** Last visible inactive attachment ids, so a later empty composer can drop them from IndexedDB. */
const inactiveVisibleIds = new Map<string, Set<string>>()
/** Serialize read/merge/write so unmount + effect cannot race, and reopen can await the latest. */
const inactivePersistQueue = new Map<string, Promise<AttachmentDraftInput[]>>()

export function setComposerDraftSnapshot(
    sessionId: string,
    text: string,
    attachments: readonly AttachmentDraftInput[],
): void {
    // A fresh live snapshot means this session is active in a composer again.
    completedHandoffs.delete(sessionId)
    // Keep the in-memory fast path bounded because snapshots retain File blobs.
    if (!liveSnapshots.has(sessionId) && liveSnapshots.size >= MAX_LIVE_SNAPSHOTS) {
        const oldestSessionId = liveSnapshots.keys().next().value
        if (oldestSessionId) liveSnapshots.delete(oldestSessionId)
    }
    liveSnapshots.set(sessionId, { text, attachments: [...attachments] })
}

export function clearComposerDraftSnapshot(sessionId: string): void {
    liveSnapshots.delete(sessionId)
    completedHandoffs.delete(sessionId)
    inactiveVisibleIds.delete(sessionId)
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

async function persistInactiveComposerAttachmentsNow(
    sessionId: string,
    text: string,
    visibleAttachments: readonly AttachmentDraftInput[],
): Promise<AttachmentDraftInput[]> {
    saveDraft(sessionId, text)
    const previousVisibleIds = inactiveVisibleIds.get(sessionId) ?? new Set<string>()
    const stored = await loadPersistedAttachments(sessionId)
    // Drop ids that were previously visible but are gone now (operator removed
    // a failed-resume pick). Hidden stored files outside that set are retained.
    const retained = stored.filter((item) => !previousVisibleIds.has(item.id))
    const merged = mergeAttachmentsById(retained, visibleAttachments)
    inactiveVisibleIds.set(sessionId, new Set(visibleAttachments.map((item) => item.id)))

    if (visibleAttachments.length === 0) {
        // Inactive composers must not publish a live snapshot of hidden files.
        liveSnapshots.delete(sessionId)
        completedHandoffs.delete(sessionId)
        if (previousVisibleIds.size > 0) {
            saveDraftAttachments(sessionId, retained)
        }
        return retained
    }

    saveDraftAttachments(sessionId, merged)
    setComposerDraftSnapshot(sessionId, text, merged)
    return merged
}

/**
 * Persist text for an inactive composer. When the user has visible pending
 * attachments (e.g. resume failed after pick), merge them into IndexedDB
 * instead of replacing the hidden stored list or discarding the new picks.
 * Concurrent calls for one session are serialized.
 */
export async function persistInactiveComposerAttachments(
    sessionId: string,
    text: string,
    visibleAttachments: readonly AttachmentDraftInput[],
): Promise<AttachmentDraftInput[]> {
    const previous = inactivePersistQueue.get(sessionId) ?? Promise.resolve([] as AttachmentDraftInput[])
    const next = previous
        .catch(() => [] as AttachmentDraftInput[])
        .then(() => persistInactiveComposerAttachmentsNow(sessionId, text, visibleAttachments))
    inactivePersistQueue.set(sessionId, next)
    try {
        return await next
    } finally {
        if (inactivePersistQueue.get(sessionId) === next) {
            inactivePersistQueue.delete(sessionId)
        }
    }
}

async function awaitInactivePersist(sessionId: string): Promise<void> {
    const pending = inactivePersistQueue.get(sessionId)
    if (pending) await pending.catch(() => {})
}

/** Copy a draft to the new id returned by resume/reopen before navigating. */
export async function transferComposerDraft(
    sourceSessionId: string,
    targetSessionId: string,
    pendingAttachments: readonly AttachmentDraftInput[] = [],
): Promise<void> {
    if (sourceSessionId === targetSessionId && pendingAttachments.length === 0) return

    // Flush any in-flight inactive merge so reopen cannot race a pending read.
    await awaitInactivePersist(sourceSessionId)

    const sourceLive = liveSnapshots.get(sourceSessionId)

    let text: string
    let baseAttachments: AttachmentDraftInput[]

    // Always read the source draft. A previously visited target may still sit
    // in liveSnapshots; using it would shadow the reopened session's draft.
    if (sourceLive) {
        text = sourceLive.text
        baseAttachments = sourceLive.attachments
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

    const completedTarget = completedHandoffs.get(sourceSessionId)
    if (completedTarget === targetSessionId) {
        await transferComposerDraft(targetSessionId, targetSessionId, [pendingItem])
        return
    }

    const existing = activeHandoffs.get(sourceSessionId)
    if (existing) {
        if (!existing.pending.some((item) => item.id === pendingItem.id)) {
            existing.pending.push(pendingItem)
        }
        await existing.done
        // Append onto the target draft itself so an unrelated prior target
        // snapshot cannot replace the transferred source content.
        await transferComposerDraft(targetSessionId, targetSessionId, [pendingItem])
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
        completedHandoffs.set(sourceSessionId, targetSessionId)
        await onNavigable(targetSessionId)
        const late = state.pending.filter((item) => !batch.some((early) => early.id === item.id))
        if (late.length > 0) {
            await transferComposerDraft(targetSessionId, targetSessionId, late)
        }
    } finally {
        resolveDone()
        activeHandoffs.delete(sourceSessionId)
    }
}
