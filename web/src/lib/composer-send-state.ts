import type { SendMessageSettlement } from '@/hooks/mutations/useSendMessage'

export type PendingComposerSend = {
    attemptId: string | null
    sessionId: string
    routeSessionId: string
    text: string
    programmaticEditRevision: number
}

const pendingComposerSends = new Map<string, PendingComposerSend>()
const composerProgrammaticEditRevisions = new Map<string, number>()
const composerSendSettlements = new Map<string, SendMessageSettlement>()
const listeners = new Set<() => void>()

function notify(): void {
    for (const listener of listeners) listener()
}

export function subscribeComposerSendState(listener: () => void): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
}

export function getPendingComposerSend(sessionId: string): PendingComposerSend | null {
    return pendingComposerSends.get(sessionId) ?? null
}

export function recordPendingComposerSend(send: PendingComposerSend): void {
    pendingComposerSends.set(send.sessionId, send)
    notify()
}

export function consumePendingComposerSend(sessionId: string, attemptId: string | null): void {
    const current = pendingComposerSends.get(sessionId)
    if (!current || current.attemptId !== attemptId) return
    pendingComposerSends.delete(sessionId)
    notify()
}

export function getComposerProgrammaticEditRevision(sessionId: string): number {
    return composerProgrammaticEditRevisions.get(sessionId) ?? 0
}

export function recordComposerProgrammaticEdit(sessionId: string): void {
    composerProgrammaticEditRevisions.set(
        sessionId,
        getComposerProgrammaticEditRevision(sessionId) + 1,
    )
    notify()
}

export function getComposerSendSettlement(sessionId: string | null): SendMessageSettlement | null {
    return sessionId ? composerSendSettlements.get(sessionId) ?? null : null
}

export function publishComposerSendSettlement(settlement: SendMessageSettlement): void {
    composerSendSettlements.set(settlement.sessionId, settlement)
    notify()
}

export function consumeComposerSendSettlement(sessionId: string, attemptId: string): void {
    const current = composerSendSettlements.get(sessionId)
    if (!current || current.attemptId !== attemptId) return
    composerSendSettlements.delete(sessionId)
    notify()
}
