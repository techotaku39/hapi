import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import type { SessionSummary, SessionsResponse } from '@/types/api'
import { queryKeys } from '@/lib/query-keys'
import { mergeSessionsResponse } from '@/lib/sessionCache'

export function useSessions(api: ApiClient | null): {
    sessions: SessionSummary[]
    isLoading: boolean
    error: string | null
    refetch: () => Promise<unknown>
} {
    const queryClient = useQueryClient()
    const query = useQuery({
        queryKey: queryKeys.sessions,
        queryFn: async () => {
            if (!api) {
                throw new Error('API unavailable')
            }
            const incoming = await api.getSessions()
            const current = queryClient.getQueryData<SessionsResponse>(queryKeys.sessions)
            return mergeSessionsResponse(current, incoming)
        },
        enabled: Boolean(api),
    })

    return {
        sessions: query.data?.sessions ?? [],
        isLoading: query.isLoading,
        error: query.error instanceof Error ? query.error.message : query.error ? 'Failed to load sessions' : null,
        refetch: query.refetch,
    }
}
