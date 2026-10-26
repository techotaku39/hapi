import ReactDOM from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router'
import '../src/index.css'
import type { Session, SessionResponse, SessionSummary, SessionsResponse } from '../src/types/api'
import { I18nProvider } from '../src/lib/i18n-context'
import { queryClient } from '../src/lib/query-client'
import { queryKeys } from '../src/lib/query-keys'
import { createAppRouter } from '../src/router'

const id = 'session-refresh'
const session = {
    id, namespace: 'default', seq: 4, createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000, active: true, activeAt: Date.now(),
    metadata: { name: 'Refresh regression conversation', path: '/fixture', host: 'fixture', flavor: 'claude' },
    metadataVersion: 1, agentState: null, agentStateVersion: 0,
    thinking: false, thinkingAt: 0, model: null, modelReasoningEffort: null,
    permissionMode: 'default', effort: null, serviceTier: null,
    assistantReplyClockBackfilled: true, lastAssistantMessageAt: 1_700_000_000_000,
} as Session
const summary = (seq: number) => ({
    ...session, hasConversationContent: true, lastAssistantMessageVersion: seq,
    pendingRequestsCount: 0, pendingRequestsVersion: 0, pendingRequestKinds: [],
    todoProgress: null, todosUpdatedAt: 0, metadata: session.metadata,
} as unknown as SessionSummary)
queryClient.setQueryData<SessionResponse>(queryKeys.session(id), { session })
queryClient.setQueryData<SessionsResponse>(queryKeys.sessions, { sessions: [summary(4)] })
const router = createAppRouter(createMemoryHistory({ initialEntries: ['/sessions/' + id] }))

declare global {
    interface Window {
        sessionRefreshProbe: {
            advance: () => void
            catchUp: () => void
            routeTo: (sessionId: string) => void
        }
    }
}
window.sessionRefreshProbe = {
    advance() { queryClient.setQueryData<SessionsResponse>(queryKeys.sessions, { sessions: [summary(5)] }) },
    catchUp() { queryClient.setQueryData<SessionResponse>(queryKeys.session(id), { session: { ...session, seq: 5 } }) },
    routeTo(sessionId) { void router.navigate({ to: '/sessions/$sessionId', params: { sessionId } }) },
}
ReactDOM.createRoot(document.getElementById('root')!).render(
    <I18nProvider><QueryClientProvider client={queryClient}><RouterProvider router={router} /></QueryClientProvider></I18nProvider>
)
