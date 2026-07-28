import { useCallback, useEffect, useState } from 'react'

export const DEFAULT_LEGACY_SESSION_LIST_LAYOUT = false

function getLegacySessionListLayoutStorageKey(): string {
    return 'hapi-legacy-session-list-layout'
}

function isBrowser(): boolean {
    return typeof window !== 'undefined' && typeof document !== 'undefined'
}

function safeGetItem(key: string): string | null {
    if (!isBrowser()) {
        return null
    }
    try {
        return localStorage.getItem(key)
    } catch {
        return null
    }
}

function safeSetItem(key: string, value: string): void {
    if (!isBrowser()) {
        return
    }
    try {
        localStorage.setItem(key, value)
    } catch {
        // Ignore storage errors
    }
}

function safeRemoveItem(key: string): void {
    if (!isBrowser()) {
        return
    }
    try {
        localStorage.removeItem(key)
    } catch {
        // Ignore storage errors
    }
}

function parseLegacySessionListLayout(raw: string | null): boolean {
    if (raw === 'true') {
        return true
    }
    return DEFAULT_LEGACY_SESSION_LIST_LAYOUT
}

export function getInitialLegacySessionListLayout(): boolean {
    return parseLegacySessionListLayout(safeGetItem(getLegacySessionListLayoutStorageKey()))
}

export function useLegacySessionListLayout(): {
    legacySessionListLayout: boolean
    setLegacySessionListLayout: (value: boolean) => void
} {
    const [legacySessionListLayout, setLegacySessionListLayoutState] = useState<boolean>(getInitialLegacySessionListLayout)

    useEffect(() => {
        if (!isBrowser()) {
            return
        }

        const onStorage = (event: StorageEvent) => {
            if (event.key !== getLegacySessionListLayoutStorageKey()) {
                return
            }
            setLegacySessionListLayoutState(parseLegacySessionListLayout(event.newValue))
        }

        window.addEventListener('storage', onStorage)
        return () => window.removeEventListener('storage', onStorage)
    }, [])

    const setLegacySessionListLayout = useCallback((value: boolean) => {
        setLegacySessionListLayoutState(value)

        if (value === DEFAULT_LEGACY_SESSION_LIST_LAYOUT) {
            safeRemoveItem(getLegacySessionListLayoutStorageKey())
        } else {
            safeSetItem(getLegacySessionListLayoutStorageKey(), String(value))
        }
    }, [])

    return { legacySessionListLayout, setLegacySessionListLayout }
}
