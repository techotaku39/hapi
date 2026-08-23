import { beforeEach, describe, expect, it } from 'vitest'
import type { SendMessageSettlement } from '@/hooks/mutations/useSendMessage'
import {
    consumeComposerSendSettlement,
    consumePendingComposerSend,
    getComposerProgrammaticEditRevision,
    getComposerSendSettlement,
    getPendingComposerSend,
    publishComposerSendSettlement,
    recordComposerProgrammaticEdit,
    recordPendingComposerSend,
} from './composer-send-state'

const settlement = (sessionId: string, attemptId: string): SendMessageSettlement => ({
    sessionId,
    attemptId,
    text: `text-${sessionId}`,
    status: 'success',
    source: 'send',
})

describe('composer send state', () => {
    beforeEach(() => {
        for (const sessionId of ['session-A', 'session-B']) {
            const pending = getPendingComposerSend(sessionId)
            if (pending) consumePendingComposerSend(sessionId, pending.attemptId)
            const current = getComposerSendSettlement(sessionId)
            if (current) consumeComposerSendSettlement(sessionId, current.attemptId)
        }
    })

    it('retains accepted sends and settlements while the chat tree is unmounted', () => {
        recordPendingComposerSend({
            sessionId: 'session-A',
            attemptId: 'attempt-A',
            routeSessionId: 'session-A',
            text: 'message A',
            programmaticEditRevision: 0,
        })
        publishComposerSendSettlement(settlement('session-A', 'attempt-A'))

        expect(getPendingComposerSend('session-A')).toEqual(expect.objectContaining({
            attemptId: 'attempt-A',
        }))
        expect(getComposerSendSettlement('session-A')).toEqual(expect.objectContaining({
            attemptId: 'attempt-A',
        }))

        consumePendingComposerSend('session-A', 'attempt-A')
        consumeComposerSendSettlement('session-A', 'attempt-A')
        expect(getPendingComposerSend('session-A')).toBeNull()
        expect(getComposerSendSettlement('session-A')).toBeNull()
    })

    it('keeps independent session settlements isolated', () => {
        publishComposerSendSettlement(settlement('session-A', 'attempt-A'))
        publishComposerSendSettlement(settlement('session-B', 'attempt-B'))

        consumeComposerSendSettlement('session-B', 'attempt-B')

        expect(getComposerSendSettlement('session-A')).toEqual(expect.objectContaining({
            attemptId: 'attempt-A',
        }))
        expect(getComposerSendSettlement('session-B')).toBeNull()
    })

    it('increments programmatic edit revisions per session', () => {
        expect(getComposerProgrammaticEditRevision('session-A')).toBe(0)
        recordComposerProgrammaticEdit('session-A')
        recordComposerProgrammaticEdit('session-A')
        recordComposerProgrammaticEdit('session-B')
        expect(getComposerProgrammaticEditRevision('session-A')).toBe(2)
        expect(getComposerProgrammaticEditRevision('session-B')).toBe(1)
    })
})
