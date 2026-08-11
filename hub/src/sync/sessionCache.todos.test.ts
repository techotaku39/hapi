import { describe, expect, it } from 'bun:test'
import type { SyncEvent } from '@hapi/protocol/types'
import { Store } from '../store'
import type { EventPublisher } from './eventPublisher'
import { SessionCache } from './sessionCache'

function createPublisher(events: SyncEvent[]): EventPublisher {
    return {
        emit: (event: SyncEvent) => {
            events.push(event)
        }
    } as unknown as EventPublisher
}

describe('SessionCache structured task backfill', () => {
    it('restores Codex update_plan tasks when a session is reopened', () => {
        const store = new Store(':memory:')
        const created = store.sessions.getOrCreateSession('codex-plan-reopen', { path: '/tmp', host: 'h' }, null, 'default')
        store.messages.addMessage(created.id, {
            role: 'agent',
            content: {
                type: 'codex',
                data: {
                    type: 'tool-call',
                    name: 'update_plan',
                    input: {
                        plan: [{ step: 'Reopen the task state', status: 'in_progress' }]
                    }
                }
            }
        })

        const events: SyncEvent[] = []
        const cache = new SessionCache(store, createPublisher(events))
        const reopened = cache.refreshSession(created.id)

        expect(reopened?.todos).toEqual([
            {
                content: 'Reopen the task state',
                priority: 'medium',
                status: 'in_progress',
                id: 'plan-1'
            }
        ])
    })
})
