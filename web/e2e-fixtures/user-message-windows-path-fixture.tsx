import { createRoot } from 'react-dom/client'
import { Outlet, createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import type { ApiClient } from '../src/api/client'
import { HappyChatProvider, type HappyChatContextValue } from '../src/components/AssistantChat/context'
import { getUserBubbleClassName, UserBubbleContent } from '../src/components/AssistantChat/messages/user-bubble'
import { I18nProvider } from '../src/lib/i18n-context'
import { decodeBase64 } from '../src/lib/utils'
import '../src/index.css'

const prompt = [
    String.raw`Please check D:\Projects\demo\.front`,
    String.raw`--path=D:\_work\.front`,
    String.raw`路径：D:\_work\_cache\.front`,
    String.raw`Path:D:\_work\.front`,
    String.raw`D:\_work\.env.local`,
    String.raw`D:\_work\.env#backup.md`,
    String.raw`Open "D:\_work\.env files\README.md"`,
    String.raw`Open D:\_work\.env: settings`,
    String.raw`Use \* as a literal asterisk.`,
].join('\n')

const chat: HappyChatContextValue = {
    api: {} as ApiClient,
    sessionId: 'fixture-session',
    metadata: { path: 'D:\\_work', host: 'fixture' },
    terminalToolDisplayMode: 'compact',
    showSessionSummaryInChat: false,
    disabled: false,
    onRefresh: () => {},
    hasMoreMessages: false,
    isSyncingTail: false,
    isLoadingMoreMessages: false,
    loadOlderMessagesPreservingScroll: async () => 'loaded',
}

function UserBubbleFixture() {
    return (
        <main className="mx-auto max-w-3xl space-y-5 px-4 py-8">
            <h1 className="text-lg font-semibold">Sent user message</h1>
            <HappyChatProvider value={chat}>
                <div className={getUserBubbleClassName()} data-testid="user-message">
                    <UserBubbleContent text={prompt} />
                </div>
                <div className={getUserBubbleClassName()} data-testid="user-message-with-math">
                    <UserBubbleContent text={String.raw`D:\_work\.front,\(x+1\)`} />
                </div>
                <div className={getUserBubbleClassName()} data-testid="user-message-with-display-math">
                    <UserBubbleContent text={[String.raw`See 《D:\_work\.front》\.`, String.raw`D:\_work\.front,\[`, 'x+1', String.raw`\]`].join('\n')} />
                </div>
                <div className={getUserBubbleClassName()} data-testid="user-message-adjacent-paths">
                    <UserBubbleContent text={String.raw`(D:\repo\.front),(E:\repo\.cache)`} />
                </div>
            </HappyChatProvider>
        </main>
    )
}

const rootRoute = createRootRoute({ component: Outlet })
const bubbleRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: UserBubbleFixture,
})
const fileRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/sessions/$sessionId/file',
    validateSearch: (search: Record<string, unknown>) => ({ path: typeof search.path === 'string' ? search.path : '' }),
    component: function FileTarget() {
        const { path } = fileRoute.useSearch()
        return <div data-testid="file-target">{decodeBase64(path).text}</div>
    },
})
const router = createRouter({
    routeTree: rootRoute.addChildren([bubbleRoute, fileRoute]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
})

createRoot(document.getElementById('root')!).render(
    <I18nProvider>
        <RouterProvider router={router} />
    </I18nProvider>
)
