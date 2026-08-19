import { useSyncExternalStore } from 'react'

const STORAGE_KEY = 'hapi.sessionLastSeen.v1'
const BASELINE_KEY = 'hapi.sessionLastSeenBaseline.v1'
const CHANGE_EVENT = 'hapi.sessionLastSeen.changed'

let changeVersion = 0

type LastSeenStore = Record<string, number>

function getLocalStorage(): Storage | null {
    if (typeof window === 'undefined') {
        return null
    }
    try {
        return window.localStorage
    } catch {
        return null
    }
}

function readStore(): LastSeenStore {
    const storage = getLocalStorage()
    if (!storage) {
        return {}
    }

    try {
        const raw = storage.getItem(STORAGE_KEY)
        if (!raw) {
            return {}
        }
        const parsed: unknown = JSON.parse(raw)
        if (!parsed || typeof parsed !== 'object') {
            return {}
        }
        return parsed as LastSeenStore
    } catch {
        return {}
    }
}

function writeStore(store: LastSeenStore): boolean {
    const storage = getLocalStorage()
    if (!storage) {
        return false
    }
    try {
        storage.setItem(STORAGE_KEY, JSON.stringify(store))
        return true
    } catch {
        // Ignore storage errors
        return false
    }
}

function notifyStoreChanged(): void {
    changeVersion += 1
    if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event(CHANGE_EVENT))
    }
}

function subscribeToStoreChanges(listener: () => void): () => void {
    if (typeof window === 'undefined') {
        return () => {}
    }
    window.addEventListener(CHANGE_EVENT, listener)
    return () => window.removeEventListener(CHANGE_EVENT, listener)
}

function getStoreChangeVersion(): number {
    return changeVersion
}

/** Re-render consumers when a same-tab read watermark changes. */
export function useSessionLastSeenVersion(): number {
    return useSyncExternalStore(
        subscribeToStoreChanges,
        getStoreChangeVersion,
        () => 0
    )
}

export function getSessionLastSeenAt(sessionId: string): number {
    return readStore()[sessionId] ?? 0
}

/** One localStorage read/parse for bulk filters (e.g. unread-only lens). */
export function getSessionLastSeenSnapshot(): Readonly<Record<string, number>> {
    return readStore()
}

export function initializeSessionLastSeen(scope: string, sessions: Iterable<{ id: string; updatedAt: number }>): void {
    const storage = getLocalStorage()
    if (!storage) {
        return
    }

    try {
        const baselineKey = `${BASELINE_KEY}:${scope}`
        if (storage.getItem(baselineKey) === '1') {
            return
        }
        const store = readStore()
        for (const session of sessions) {
            store[session.id] ??= session.updatedAt
        }
        storage.setItem(STORAGE_KEY, JSON.stringify(store))
        storage.setItem(baselineKey, '1')
    } catch {
        // Ignore storage errors
    }
}

export function markSessionSeen(sessionId: string, seenAt: number): void {
    if (!sessionId) {
        return
    }
    const store = readStore()
    const nextSeenAt = Math.max(store[sessionId] ?? 0, seenAt)
    if (store[sessionId] === nextSeenAt) {
        return
    }
    store[sessionId] = nextSeenAt
    if (writeStore(store)) {
        notifyStoreChanged()
    }
}

/** Move the local watermark just behind the current activity. */
export function markSessionUnread(sessionId: string, updatedAt: number): void {
    if (!sessionId || !Number.isFinite(updatedAt)) {
        return
    }

    const store = readStore()
    const unreadBefore = updatedAt - 1
    const currentSeenAt = store[sessionId]
    if (typeof currentSeenAt === 'number' && currentSeenAt <= unreadBefore) {
        return
    }

    store[sessionId] = unreadBefore
    if (writeStore(store)) {
        notifyStoreChanged()
    }
}
