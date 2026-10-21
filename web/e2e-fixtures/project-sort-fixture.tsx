import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { SessionSummary } from '@/types/api'
import { SessionList } from '@/components/SessionList'
import { I18nProvider } from '@/lib/i18n-context'
import { ToastProvider } from '@/lib/toast-context'
import '../src/index.css'

const params = new URLSearchParams(window.location.search)
if (params.get('mode') === 'recent') {
    window.localStorage.setItem('hapi-session-project-sort-mode', 'recent')
} else {
    window.localStorage.removeItem('hapi-session-project-sort-mode')
}
window.localStorage.removeItem('hapi-pin-in-progress-sessions')
window.localStorage.removeItem('hapi-pin-in-progress-sessions-mode')
window.localStorage.removeItem('hapi-session-project-order')

function makeSession(overrides: Partial<SessionSummary> & { id: string }): SessionSummary {
    return {
        active: false,
        thinking: false,
        activeAt: 0,
        updatedAt: 0,
        metadata: null,
        metadataVersion: 0,
        agentStateVersion: 0,
        todosUpdatedAt: 0,
        todoProgress: null,
        pendingRequestsCount: 0,
        pendingRequestKinds: [],
        pendingRequests: [],
        backgroundTaskCount: 0,
        futureScheduledMessageCount: 0,
        nextScheduledAt: null,
        model: null,
        effort: null,
        ...overrides,
    }
}

const now = Date.now()
const sessions: SessionSummary[] = [
    makeSession({
        id: 'mine-session',
        updatedAt: now - 30 * 60_000,
        metadata: { path: '/projects/mine', name: 'Mine task', flavor: 'codex' },
    }),
    makeSession({
        id: 'hapi-session',
        updatedAt: now - 2 * 60_000,
        metadata: { path: '/projects/hapi', name: 'HAPI task', flavor: 'codex' },
    }),
]

const queryClient = new QueryClient({
    defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
    },
})

createRoot(document.getElementById('root')!).render(
    <QueryClientProvider client={queryClient}>
        <ToastProvider>
            <I18nProvider>
                <div className="h-screen w-full bg-[var(--app-bg)] text-[var(--app-fg)]">
                    <SessionList
                        sessions={sessions}
                        selectedSessionId={null}
                        onSelect={() => {}}
                        onNewSession={() => {}}
                        onRefresh={async () => {}}
                        isLoading={false}
                        renderHeader={false}
                        api={null}
                    />
                </div>
            </I18nProvider>
        </ToastProvider>
    </QueryClientProvider>,
)
