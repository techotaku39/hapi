import type { ApiClient } from '@/api/client'
import { ApiError } from '@/api/client'
import { SessionReadMutationSchema, SessionReadSnapshotSchema, type SessionReadMutation, type SessionReadState } from '@hapi/protocol'
import {
    applySessionReadStates, configureSessionReadSync, disconnectSessionReadSync, getLegacyManualUnread
} from './sessionLastSeen'

type ReadApi = Pick<ApiClient, 'getSessionReadState' | 'updateSessionReadState' | 'getSessions'>

/** Hub identity includes namespace, not the short-lived JWT or user transport identity. */
export function sessionReadScope(baseUrl: string, token: string): string {
    const payload: unknown = JSON.parse(atob(token.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/')))
    if (!payload || typeof payload !== 'object' || !('ns' in payload) || typeof payload.ns !== 'string') {
        throw new Error('Missing read-state namespace')
    }
    return JSON.stringify([baseUrl, payload.ns])
}

export function startSessionReadSync(api: ReadApi, scope: string) {
    const states = new Map<string, SessionReadState>()
    let stopped = false
    let ready = false
    let running = false
    let refreshPromise: Promise<void> | null = null
    let retry: ReturnType<typeof setTimeout> | undefined
    // Independent tabs retain independent offline queues; reload resumes the same queue.
    let tabId: string
    try {
        tabId = sessionStorage.getItem('hapi.readSyncTab') ?? crypto.randomUUID()
        sessionStorage.setItem('hapi.readSyncTab', tabId)
    } catch { tabId = crypto.randomUUID() }
    const cacheKey = `hapi.sessionReadSync.v1:${scope}`
    const queueKey = `${cacheKey}:pending:${tabId}`
    let pending: SessionReadMutation[] = []
    try {
        const cached = SessionReadSnapshotSchema.safeParse(JSON.parse(localStorage.getItem(cacheKey) ?? 'null'))
        if (cached.success) for (const state of cached.data.states) states.set(state.sessionId, state)
        const queue: unknown = JSON.parse(localStorage.getItem(queueKey) ?? '[]')
        if (Array.isArray(queue)) {
            // Reuse the wire validator, including numeric bounds, for persisted queue data.
            for (const value of queue) {
                const parsed = SessionReadMutationSchema.safeParse(value)
                if (parsed.success) pending.push(parsed.data)
            }
        }
    } catch { /* Storage is optional; online synchronization still works. */ }

    const persist = () => {
        try {
            localStorage.setItem(cacheKey, JSON.stringify({ states: [...states.values()] }))
            localStorage.setItem(queueKey, JSON.stringify(pending))
        } catch { /* Storage can be unavailable in private browsing. */ }
    }
    const publish = () => {
        const visible = new Map(states)
        for (const mutation of pending) {
            const current = visible.get(mutation.sessionId)
            if ((current?.version ?? 0) !== mutation.expectedVersion) continue
            const seen = mutation.kind === 'seen'
            visible.set(mutation.sessionId, {
                sessionId: mutation.sessionId,
                version: mutation.expectedVersion + 1,
                lastSeenAt: seen ? Math.max(current?.lastSeenAt ?? 0, mutation.activityAt)
                    : Math.min(current?.lastSeenAt ?? 0, Math.max(0, mutation.activityAt - 1)),
                manualUnreadAt: seen
                    ? (mutation.activityAt >= (current?.manualUnreadAt ?? 0) ? null : current!.manualUnreadAt)
                    : mutation.activityAt
            })
        }
        applySessionReadStates([...visible.values()], true)
    }
    const apply = (incoming: SessionReadState[]) => {
        if (stopped) return
        for (const state of incoming) {
            if (state.version > (states.get(state.sessionId)?.version ?? 0)) states.set(state.sessionId, state)
        }
        persist()
        publish()
    }
    const schedule = () => {
        if (stopped || retry) return
        retry = setTimeout(() => { retry = undefined; void refresh() }, 5000)
    }
    const flush = async () => {
        if (!ready || running || stopped) return
        running = true
        let singleTarget = false
        try {
            while (pending.length && !stopped) {
                // Batch independent targets, but serialize each session's intent order.
                // Never rebase an offline action over a peer's newer version.
                const targets = new Set<string>()
                const batch = pending.filter(mutation => {
                    if (targets.has(mutation.sessionId) || targets.size >= (singleTarget ? 1 : 500)) return false
                    targets.add(mutation.sessionId)
                    return true
                })
                let response
                try {
                    response = await api.updateSessionReadState(batch)
                } catch (error) {
                    if (stopped) return
                    if (error instanceof ApiError && (error.status === 400 || error.status === 404)) {
                        // A deleted target rolls back a batch. Split it to retain valid work.
                        if (batch.length > 1) singleTarget = true
                        else pending = pending.filter(item => item !== batch[0])
                        persist()
                        continue
                    }
                    throw error
                }
                if (stopped) return
                const rejected = new Set(batch.filter(item => !response.acceptedSessionIds.includes(item.sessionId)).map(item => item.sessionId))
                // Drop the entire dependent offline chain on conflict. Its projected
                // versions might otherwise accidentally match an intervening peer write.
                pending = pending.filter(item => !batch.includes(item) && !rejected.has(item.sessionId))
                apply(response.states)
            }
        } catch {
            if (stopped) return
            schedule()
        } finally { running = false }
    }
    configureSessionReadSync(scope, (kind, sessions) => {
        for (const { id, updatedAt } of sessions) {
            const expectedVersion = pending.filter(item => item.sessionId === id)
                .reduce((version, item) => Math.max(version, item.expectedVersion + 1), states.get(id)?.version ?? 0)
            pending.push({ mutationId: crypto.randomUUID(), sessionId: id, kind, activityAt: updatedAt, expectedVersion })
        }
        persist()
        // Let the optimistic local update finish before an immediate mocked response.
        void Promise.resolve().then(flush)
    })
    if (states.size || pending.length) publish()

    async function refresh(): Promise<void> {
        if (stopped) return
        if (refreshPromise) return refreshPromise
        refreshPromise = (async () => {
            try {
                const snapshot = await api.getSessionReadState()
                if (stopped) return
                apply(snapshot.states)
                if (!ready) {
                    // Import only explicit unread markers and only for a session whose
                    // current activity still matches. Never promote legacy seen receipts.
                    const legacy = getLegacyManualUnread(scope)
                    if (Object.keys(legacy).length) {
                        const sessions = await api.getSessions()
                        if (stopped) return
                        for (const session of sessions.sessions) {
                            if (!states.has(session.id) && legacy[session.id] === session.updatedAt) {
                                pending.push({ mutationId: crypto.randomUUID(), sessionId: session.id, kind: 'import-unread', activityAt: session.updatedAt, expectedVersion: 0 })
                            }
                        }
                    }
                }
                ready = true
                await flush()
            } catch { schedule() }
            finally { refreshPromise = null }
        })()
        return refreshPromise
    }
    void refresh()
    return {
        refresh,
        receive: apply,
        stop() {
            stopped = true
            clearTimeout(retry)
            disconnectSessionReadSync()
        }
    }
}
