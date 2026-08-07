import { describe, expect, it, vi } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query-keys'
import { reapplyOptimisticSessionActive } from './session-detail-optimistic'

describe('reapplyOptimisticSessionActive', () => {
    it('keeps the cache active after a stale inactive detail fetch', async () => {
        const queryClient = new QueryClient({
            defaultOptions: { queries: { retry: false } },
        })
        const resolvedSessionId = 'session-reopened'
        queryClient.setQueryData(queryKeys.session(resolvedSessionId), {
            session: { id: resolvedSessionId, active: true, title: 'seeded' },
        })

        await queryClient.fetchQuery({
            queryKey: queryKeys.session(resolvedSessionId),
            queryFn: async () => ({
                session: { id: resolvedSessionId, active: false, title: 'stale' },
            }),
            staleTime: 0,
        }).catch(() => undefined).finally(() => {
            reapplyOptimisticSessionActive(queryClient, resolvedSessionId)
        })

        expect(queryClient.getQueryData(queryKeys.session(resolvedSessionId))).toEqual({
            session: { id: resolvedSessionId, active: true, title: 'stale' },
        })
    })

    it('is a no-op when the detail cache is empty', () => {
        const queryClient = new QueryClient({
            defaultOptions: { queries: { retry: false } },
        })
        const spy = vi.spyOn(queryClient, 'setQueryData')
        reapplyOptimisticSessionActive(queryClient, 'missing')
        const updater = spy.mock.calls[0]?.[1] as ((previous: unknown) => unknown) | undefined
        expect(updater?.(undefined)).toBeUndefined()
    })
})
