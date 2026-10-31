import { describe, expect, it } from 'bun:test'
import { Store } from '../store'
import { RpcRegistry } from '../socket/rpcRegistry'
import { SyncEngine } from './syncEngine'

function fixture() {
    const store = new Store(':memory:')
    const engine = new SyncEngine(store, {} as never, new RpcRegistry(), { broadcast() {} } as never)
    const session = engine.getOrCreateSession('shared-codex', {
        path: '/tmp/project', host: 'test', flavor: 'codex',
        capabilities: { concurrentClients: true, conversationHistory: { rewindToMessage: true } },
    }, null, 'default')
    engine.handleSessionAlive({ sid: session.id, time: Date.now(), mode: 'remote' })
    for (const localId of ['one', 'two', 'three']) {
        store.messages.addMessage(session.id, { role: 'user', content: localId }, localId)
        store.messages.markMessagesInvoked(session.id, [localId], Date.now())
    }
    const gateway = (engine as unknown as { rpcGateway: {
        rewindConversation: () => Promise<unknown>
        completeConversationRewind: (sessionId: string, token: string) => Promise<void>
    } }).rpcGateway
    return { store, engine, session, gateway }
}
describe('shared Codex rewind commit', () => {
    it('acknowledges the CLI only after durable transcript truncation and keeps sends locked', async () => {
        const { store, engine, session, gateway } = fixture()
        try {
            let completed = false
            gateway.rewindConversation = async () => ({ success: true, truncateFromLocalId: 'two', rewindToken: 'transaction' })
            gateway.completeConversationRewind = async (id, token) => {
                expect(id).toBe(session.id); expect(token).toBe('transaction')
                expect(store.messages.getLocalMessageStates(id, ['one', 'two', 'three'])).toHaveLength(1)
                await expect(engine.sendMessage(id, { text: 'racing message', localId: 'race' })).rejects.toThrow('in progress')
                completed = true
            }
            expect(await engine.rewindConversation(session.id, 'default', 'two')).toEqual({ type: 'success' })
            expect(completed).toBe(true)
        } finally { engine.stop() }
    })
    it.each(['truncate', 'complete'])('quarantines a %s failure without reporting success', async failure => {
        const { store, engine, session, gateway } = fixture()
        try {
            let completed = false
            gateway.rewindConversation = async () => ({ success: true, truncateFromLocalId: 'two', rewindToken: 'transaction' })
            if (failure === 'truncate') store.messages.truncateMessagesFromLocalId = () => { throw new Error('disk failure') }
            gateway.completeConversationRewind = async () => { completed = true; throw new Error('ack failure') }
            expect(await engine.rewindConversation(session.id, 'default', 'two')).toMatchObject({ type: 'error', hydrateFailed: true })
            expect(completed).toBe(failure === 'complete')
            expect(engine.getSession(session.id)?.metadata?.conversationHistoryDiverged).toBe(true)
        } finally { engine.stop() }
    })
})

function createEngine() {
    const store = new Store(':memory:')
    const engine = new SyncEngine(store, {} as never, new RpcRegistry(), { broadcast() {} } as never)
    return { store, engine }
}

describe('Codex conversation-history hub integration', () => {
    it('forwards serialized Fork RPC errors instead of using the missing-id fallback', async () => {
        const { store, engine } = createEngine()
        try {
            const session = engine.getOrCreateSession('codex-fork-not-ready', {
                path: '/tmp/project',
                host: 'localhost',
                machineId: 'machine-1',
                flavor: 'codex',
                codexSessionId: 'native-thread',
                capabilities: { conversationHistory: { forkCurrent: true } }
            }, null, 'default')
            engine.handleSessionAlive({ sid: session.id, time: Date.now(), mode: 'remote' })
            store.messages.addMessage(session.id, { role: 'user', content: 'boundary' }, 'local-boundary')
            store.messages.markMessagesInvoked(session.id, ['local-boundary'], Date.now())

            ;(engine as any).rpcGateway.forkConversation = async () => ({
                error: 'Codex thread is not ready'
            })

            await expect(engine.forkConversation(session.id, 'default')).resolves.toEqual({
                type: 'error',
                message: 'Codex thread is not ready'
            })
        } finally {
            engine.stop()
        }
    })
})
