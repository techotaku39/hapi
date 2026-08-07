import type { QueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query-keys'

type SessionDetailCache = {
    session: {
        id: string
        active: boolean
        [key: string]: unknown
    }
    [key: string]: unknown
}

/**
 * Force the session detail cache back to active after a background getSession
 * may have overwritten an optimistic resume/reopen seed with a stale inactive
 * REST/SSE snapshot.
 */
export function reapplyOptimisticSessionActive(
    queryClient: QueryClient,
    resolvedSessionId: string,
): void {
    queryClient.setQueryData(
        queryKeys.session(resolvedSessionId),
        (previous: SessionDetailCache | undefined) => (
            previous?.session
                ? {
                    ...previous,
                    session: {
                        ...previous.session,
                        id: resolvedSessionId,
                        active: true,
                    },
                }
                : previous
        ),
    )
}
