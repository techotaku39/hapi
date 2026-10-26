import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createPortal } from 'react-dom'
import { useEffect, useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ApiClient } from '@/api/client'
import type { Session, SessionResponse, SessionSummary, SessionsResponse } from '@/types/api'
import { queryKeys } from '@/lib/query-keys'
import { useSession } from '@/hooks/queries/useSession'
import { SessionContentBoundary } from './SessionContentBoundary'

afterEach(cleanup)

const detail = (id: string, seq: number) => ({
    id, namespace: 'default', seq, createdAt: 1, updatedAt: 1_000,
    active: true, activeAt: 1_000, metadata: null, metadataVersion: 0,
    agentState: null, agentStateVersion: 0, thinking: true, thinkingAt: 1_000,
} as Session)

function harness() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    client.setQueryData<SessionResponse>(queryKeys.session('s1'), { session: detail('s1', 4) })
    const list = (seq: number) => ({ sessions: [{ id: 's1', lastAssistantMessageVersion: seq } as SessionSummary] } satisfies SessionsResponse)
    client.setQueryData(queryKeys.sessions, list(4))
    const pending = new Promise<SessionResponse>(() => {})
    const api = { getSession: vi.fn(() => pending) } as unknown as ApiClient
    const mounts = vi.fn()
    const send = vi.fn()
    function Chat() {
        const [draft, setDraft] = useState('')
        useEffect(() => { mounts() }, [])
        return <>
            <input aria-label="Draft" value={draft} onChange={e => setDraft(e.target.value)} />
            <div data-testid="scroll" style={{ height: 100, overflow: 'auto' }}><div style={{ height: 2_000 }}>Messages</div></div>
            <button onClick={send}>Send</button>
            {createPortal(<button onClick={send} onPointerDown={send}>Confirm portal action</button>, document.body)}
        </>
    }
    function Route({ sessionId = 's1', scope = api }: { sessionId?: string; scope?: unknown }) {
        const { session, error, isRefreshing } = useSession(api, sessionId)
        return <SessionContentBoundary sessionId={sessionId} scope={scope} synchronizing={isRefreshing}
            fallback={<div data-testid="fallback">{error ?? 'Loading session'}</div>}>
            {session ? <Chat /> : null}
        </SessionContentBoundary>
    }
    const tree = (props: { sessionId?: string; scope?: unknown } = {}) => <QueryClientProvider client={client}><Route {...props} /></QueryClientProvider>
    const rendered = render(tree())
    const advance = () => act(() => { client.setQueryData(queryKeys.sessions, list(5)) })
    const catchUp = () => act(() => { client.setQueryData<SessionResponse>(queryKeys.session('s1'), { session: detail('s1', 5) }) })
    return { ...rendered, client, api, mounts, send, advance, catchUp, tree }
}

describe('SessionContentBoundary', () => {
    it('retains the mounted conversation, draft and scroll while a newer list waits for detail', async () => {
        const h = harness()
        const draft = screen.getByLabelText('Draft')
        const scroll = screen.getByTestId('scroll')
        fireEvent.change(draft, { target: { value: 'unsent draft' } })
        scroll.scrollTop = 450
        h.advance()
        await waitFor(() => expect(h.api.getSession).toHaveBeenCalled())
        expect(screen.queryByTestId('fallback')).toBeNull()
        expect(screen.getByLabelText('Draft')).toBe(draft)
        expect((draft as HTMLInputElement).value).toBe('unsent draft')
        expect(screen.getByTestId('scroll').scrollTop).toBe(450)
        expect(draft.closest('[aria-busy]')?.getAttribute('aria-busy')).toBe('true')
        expect(draft.closest('[inert]')).not.toBeNull()
        // Portals are outside the inert DOM subtree; React capture must guard them too.
        fireEvent.pointerDown(screen.getByText('Confirm portal action'))
        fireEvent.click(screen.getByText('Confirm portal action'))
        expect(h.send).not.toHaveBeenCalled()
        h.catchUp()
        await waitFor(() => expect(draft.closest('[aria-busy]')).toBeNull())
        expect(screen.getByLabelText('Draft')).toBe(draft)
        expect(h.mounts).toHaveBeenCalledTimes(1)
        fireEvent.click(screen.getByText('Send'))
        expect(h.send).toHaveBeenCalledTimes(1)
    })

    it('does not retain another session while the next one is loading', async () => {
        const h = harness()
        h.advance()
        h.rerender(h.tree({ sessionId: 's2' }))
        expect(screen.getByTestId('fallback')).toBeTruthy()
        expect(screen.queryByLabelText('Draft')).toBeNull()
    })

    it('does not retain content when the API scope changes', async () => {
        const h = harness()
        h.advance()
        h.rerender(h.tree({ scope: {} }))
        expect(screen.getByTestId('fallback')).toBeTruthy()
        expect(screen.queryByLabelText('Draft')).toBeNull()
    })

    it('does not show a never-validated detail on cold entry', async () => {
        const h = harness()
        h.unmount()
        h.advance()
        const view = render(h.tree())
        expect(screen.getByTestId('fallback')).toBeTruthy()
        expect(screen.queryByLabelText('Draft')).toBeNull()
        view.unmount()
    })

    it('drops retained content for a terminal detail error', async () => {
        const h = harness()
        h.advance()
        act(() => {
            h.client.getQueryCache().find({ queryKey: queryKeys.session('s1') })!.setState({
                error: new Error('HTTP 404 Not Found'), status: 'error', fetchStatus: 'idle',
            })
        })
        await waitFor(() => expect(screen.getByTestId('fallback').textContent).toBe('HTTP 404 Not Found'))
        expect(screen.queryByLabelText('Draft')).toBeNull()
    })
})
