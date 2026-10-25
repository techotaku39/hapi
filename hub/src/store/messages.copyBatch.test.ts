import { describe, expect, it } from 'bun:test'
import { Store } from './index'

describe('copyMessagesToSession', () => {
    it('copies a prefix in one transaction and bumps epoch once', () => {
        const store = new Store(':memory:')
        const source = store.sessions.getOrCreateSession('src', { path: '/tmp' }, null, 'default')
        const child = store.sessions.getOrCreateSession('child', { path: '/tmp' }, null, 'default')

        store.messages.addMessage(source.id, { role: 'user', content: { type: 'text', text: 'one' } }, 'local-1')
        store.messages.markMessagesInvoked(source.id, ['local-1'], Date.now())
        store.messages.addMessage(source.id, {
            role: 'agent',
            content: { type: 'codex', data: { type: 'message', message: 'a1' } }
        })
        store.messages.addMessage(source.id, { role: 'user', content: { type: 'text', text: 'two' } }, 'local-2')
        store.messages.markMessagesInvoked(source.id, ['local-2'], Date.now())

        const beforeEpoch = store.messages.getMessageEpoch(child.id)
        const prefix = store.messages.getAllMessages(source.id).slice(0, 2)
        const copied = store.messages.copyMessagesToSession(
            child.id,
            prefix.map((message) => ({
                content: message.content,
                createdAt: message.createdAt,
                localId: message.localId,
                invokedAt: message.invokedAt,
                scheduledAt: message.scheduledAt
            }))
        )

        expect(copied).toBe(2)
        expect(store.messages.getAllMessages(child.id)).toHaveLength(2)
        expect(store.messages.getMessageEpoch(child.id)).toBe(beforeEpoch + 1)
        expect(store.sessions.getSession(child.id)?.lastAssistantMessageAt)
            .toBe(prefix[1]?.createdAt)

        store.close()
    })

    it('does not promote copied Claude no-response sentinels to the reply clock', () => {
        const store = new Store(':memory:')
        const source = store.sessions.getOrCreateSession('hidden-src', { path: '/tmp' }, null, 'default')
        const child = store.sessions.getOrCreateSession('hidden-child', { path: '/tmp' }, null, 'default')
        const injectedUuid = 'injected-copy-turn'

        store.messages.addMessage(source.id, {
            role: 'agent',
            content: {
                type: 'output',
                data: {
                    type: 'user',
                    uuid: injectedUuid,
                    isSidechain: true,
                    message: { content: '<system-reminder>internal</system-reminder>' }
                }
            }
        }, undefined, undefined, 1_000)
        store.messages.addMessage(source.id, {
            role: 'agent',
            content: {
                type: 'output',
                data: {
                    type: 'assistant',
                    parentUuid: injectedUuid,
                    message: { content: [{ type: 'text', text: 'No response requested.' }] }
                }
            }
        }, undefined, undefined, 2_000)

        const sourceMessages = store.messages.getAllMessages(source.id)
        store.messages.copyMessagesToSession(
            child.id,
            sourceMessages.map((message) => ({
                content: message.content,
                createdAt: message.createdAt,
                localId: message.localId,
                invokedAt: message.invokedAt,
                scheduledAt: message.scheduledAt
            }))
        )
        expect(store.sessions.getSession(child.id)?.lastAssistantMessageAt).toBeNull()

        store.messages.copyMessageToSession(child.id, {
            content: {
                role: 'agent',
                content: {
                    type: 'output',
                    data: {
                        type: 'assistant',
                        uuid: 'ordinary-copy-turn',
                        message: { content: [{ type: 'text', text: 'Normal answer.' }] }
                    }
                }
            },
            createdAt: 2_500,
            localId: null,
            invokedAt: 2_500,
            scheduledAt: null
        })
        store.messages.copyMessageToSession(child.id, {
            content: {
                role: 'agent',
                content: {
                    type: 'output',
                    data: {
                        type: 'assistant',
                        parentUuid: 'ordinary-copy-turn',
                        message: { content: [{ type: 'text', text: 'No response requested.' }] }
                    }
                }
            },
            createdAt: 3_000,
            localId: null,
            invokedAt: 3_000,
            scheduledAt: null
        })
        expect(store.sessions.getSession(child.id)?.lastAssistantMessageAt).toBe(3_000)
        store.close()
    })

    it('keeps copied injected ancestry when the source turn is outside the recent window', () => {
        const store = new Store(':memory:')
        const child = store.sessions.getOrCreateSession('hidden-long-child', { path: '/tmp' }, null, 'default')
        const injectedUuid = 'injected-long-copy-turn'
        const messages = [
            {
                role: 'agent',
                content: {
                    type: 'output',
                    data: {
                        type: 'user',
                        uuid: injectedUuid,
                        isSidechain: true,
                        message: { content: '<system-reminder>internal</system-reminder>' }
                    }
                }
            },
            ...Array.from({ length: 220 }, (_, index) => ({
                role: 'user',
                content: { type: 'text', text: `filler ${index}` }
            })),
            {
                role: 'agent',
                content: {
                    type: 'output',
                    data: {
                        type: 'assistant',
                        parentUuid: injectedUuid,
                        message: { content: [{ type: 'text', text: 'No response requested.' }] }
                    }
                }
            }
        ]

        store.messages.copyMessagesToSession(
            child.id,
            messages.map((content, index) => ({
                content,
                createdAt: 1_000 + index,
                localId: null,
                invokedAt: 1_000 + index,
                scheduledAt: null
            }))
        )

        expect(store.sessions.getSession(child.id)?.lastAssistantMessageAt).toBeNull()
        store.close()
    })
})
