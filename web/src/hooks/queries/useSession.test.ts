import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { createElement, type ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { ApiClient } from '@/api/client'
import type { Session, SessionResponse } from '@/types/api'
import { queryKeys } from '@/lib/query-keys'
import { isSessionNotFoundError, SESSION_DETAIL_STALE_TIME_MS, useSession } from './useSession'

describe('isSessionNotFoundError', () => {
    it('matches hub 404 session responses', () => {
        expect(isSessionNotFoundError(new Error('HTTP 404 Not Found: {"error":"Session not found"}'))).toBe(true)
    })

    it('does not match unrelated errors', () => {
        expect(isSessionNotFoundError(new Error('HTTP 500 Internal Server Error'))).toBe(false)
        expect(isSessionNotFoundError(null)).toBe(false)
    })
})

describe('SESSION_DETAIL_STALE_TIME_MS', () => {
    // SSE patches the cache directly on session-updated events, so the REST
    // endpoint is just a cold-start / reconnect-recovery path.  A long staleTime
    // suppresses focus-refetch and remount-refetch storms — primary lever for
    // the refetch-storm fix (tiann/hapi#884).
    it('is set to a value that suppresses focus/mount refetches', () => {
        expect(SESSION_DETAIL_STALE_TIME_MS).toBeGreaterThanOrEqual(10_000)
    })
})

function makeSession(seq: number, lastAssistantMessageAt: number | null): Session {
    return {
        id: 's1',
        namespace: 'default',
        seq,
        createdAt: 1,
        updatedAt: 9_000,
        lastAssistantMessageAt,
        active: false,
        activeAt: 9_000,
        metadata: null,
        metadataVersion: 0,
        agentState: null,
        agentStateVersion: 0,
        thinking: false,
        thinkingAt: 0,
        model: null,
        modelReasoningEffort: null,
        effort: null,
        serviceTier: null,
        permissionMode: 'default'
    } as Session
}

function queryWrapper(queryClient: QueryClient) {
    return ({ children }: { children: ReactNode }) =>
        createElement(QueryClientProvider, { client: queryClient }, children)
}

describe('useSession REST ordering', () => {
    it('does not let a delayed REST response overwrite a newer SSE detail', async () => {
        const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
        const key = queryKeys.session('s1')
        queryClient.setQueryData<SessionResponse>(key, { session: makeSession(10, 9_000) })

        let resolveResponse!: (response: SessionResponse) => void
        const response = new Promise<SessionResponse>((resolve) => { resolveResponse = resolve })
        const api = {
            getSession: vi.fn(() => response)
        } as unknown as ApiClient
        const { result } = renderHook(() => useSession(api, 's1'), { wrapper: queryWrapper(queryClient) })

        let refetch!: Promise<unknown>
        await act(async () => { refetch = result.current.refetch() })
        await waitFor(() => expect(api.getSession).toHaveBeenCalledTimes(1))

        // The SSE correction arrives while the REST request is still pending.
        queryClient.setQueryData<SessionResponse>(key, { session: makeSession(11, null) })
        resolveResponse({ session: makeSession(10, 1_000) })
        await act(async () => { await refetch })

        expect(queryClient.getQueryData<SessionResponse>(key)?.session).toEqual(makeSession(11, null))
    })
})
