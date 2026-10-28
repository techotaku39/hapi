import { describe, expect, it } from 'vitest'
import type { SessionSummary } from '@/types/api'
import {
    classifySessionAttention,
    sessionIsUnread,
} from './sessionAttention'

function makeSummary(overrides: Partial<SessionSummary> & { id: string }): SessionSummary {
    return {
        active: true,
        thinking: false,
        activeAt: 0,
        updatedAt: 1000,
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
        ...overrides
    }
}

describe('classifySessionAttention', () => {
    it('returns null for the selected session', () => {
        const attention = classifySessionAttention(
            makeSummary({ id: 'a', pendingRequestKinds: ['permission'] }),
            { selected: true, lastSeenAt: 0 }
        )
        expect(attention).toBeNull()
    })

    it('shows an explicitly marked unread dot for the selected session', () => {
        const attention = classifySessionAttention(
            makeSummary({ id: 'a', updatedAt: 5000 }),
            { selected: true, lastSeenAt: 5000, manualUnreadAt: 5000 }
        )
        expect(attention).toEqual({ kind: 'unread' })
    })

    it('keeps an explicitly marked unread dot while the selected session is thinking', () => {
        const attention = classifySessionAttention(
            makeSummary({ id: 'a', thinking: true, updatedAt: 5000 }),
            { selected: true, lastSeenAt: 5000, manualUnreadAt: 5000 }
        )
        expect(attention).toEqual({ kind: 'unread' })
    })

    it('does not show selected-session attention for ordinary new activity', () => {
        const attention = classifySessionAttention(
            makeSummary({ id: 'a', updatedAt: 5000 }),
            { selected: true, lastSeenAt: 1000 }
        )
        expect(attention).toBeNull()
    })

    it('carries an explicit unread dot across newer activity', () => {
        const attention = classifySessionAttention(
            makeSummary({ id: 'a', updatedAt: 6000 }),
            { selected: true, lastSeenAt: 5000, manualUnreadAt: 5000 }
        )
        expect(attention).toEqual({ kind: 'unread' })
    })

    it('prioritizes permission over unread activity', () => {
        const attention = classifySessionAttention(
            makeSummary({
                id: 'a',
                pendingRequestKinds: ['permission'],
                pendingRequestsCount: 1,
                updatedAt: 5000
            }),
            { selected: false, lastSeenAt: 0 }
        )
        expect(attention).toEqual({ kind: 'permission' })
    })

    it('ignores pending requests left on an archived session', () => {
        const attention = classifySessionAttention(
            makeSummary({
                id: 'a',
                active: false,
                pendingRequestKinds: ['permission'],
                pendingRequestsCount: 1,
                updatedAt: 5000
            }),
            { selected: false, lastSeenAt: 5000 }
        )
        expect(attention).toBeNull()
    })

    it('handles summaries from older APIs without pendingRequestKinds', () => {
        const legacySummary = makeSummary({ id: 'legacy', updatedAt: 5000 }) as unknown as SessionSummary
        delete (legacySummary as Partial<SessionSummary>).pendingRequestKinds

        const attention = classifySessionAttention(
            legacySummary,
            { selected: false, lastSeenAt: 1000 }
        )

        expect(attention).toEqual({ kind: 'unread' })
    })

    it('shows unread activity when the session has updated since last seen', () => {
        const attention = classifySessionAttention(
            makeSummary({ id: 'a', updatedAt: 5000 }),
            { selected: false, lastSeenAt: 1000 }
        )
        expect(attention).toEqual({ kind: 'unread' })
    })

    it('does not show ordinary unread activity while the session is thinking', () => {
        expect(classifySessionAttention(
            makeSummary({ id: 'generating', thinking: true, updatedAt: 5000 }),
            { selected: false, lastSeenAt: 1000 }
        )).toBeNull()
    })

    it('keeps an explicitly marked unread dot while a session is thinking', () => {
        expect(classifySessionAttention(
            makeSummary({ id: 'manual-thinking', thinking: true, updatedAt: 5000 }),
            { selected: false, lastSeenAt: 5000, manualUnreadAt: 5000 }
        )).toEqual({ kind: 'unread' })
    })

    it('treats inactive stale thinking as unread activity', () => {
        expect(classifySessionAttention(
            makeSummary({ id: 'expired-thinking', active: false, thinking: true, updatedAt: 5000 }),
            { selected: false, lastSeenAt: 1000 }
        )).toEqual({ kind: 'unread' })
    })

    it('shows background work without treating it as unread', () => {
        const attention = classifySessionAttention(
            makeSummary({ id: 'a', backgroundTaskCount: 2, updatedAt: 5000 }),
            { selected: false, lastSeenAt: 0 }
        )
        expect(attention).toEqual({ kind: 'background' })
    })

    it('shows unread activity for inactive sessions updated since last seen', () => {
        const attention = classifySessionAttention(
            makeSummary({ id: 'a', active: false, updatedAt: 5000 }),
            { selected: false, lastSeenAt: 1000 }
        )
        expect(attention).toEqual({ kind: 'unread' })
    })

    it('prefers unread over background for inactive sessions', () => {
        const attention = classifySessionAttention(
            makeSummary({
                id: 'a',
                active: false,
                backgroundTaskCount: 2,
                updatedAt: 5000
            }),
            { selected: false, lastSeenAt: 1000 }
        )
        expect(attention).toEqual({ kind: 'unread' })
    })
})

describe('sessionIsUnread', () => {
    it('is true when the latest assistant reply is newer than lastSeenAt', () => {
        expect(sessionIsUnread(
            makeSummary({ id: 'u', updatedAt: 9000, lastAssistantMessageAt: 5000 }),
            { lastSeenAt: 4000 }
        )).toBe(true)
    })

    it('is false when the operator has already seen the latest assistant reply', () => {
        expect(sessionIsUnread(
            makeSummary({ id: 'seen', updatedAt: 9000, lastAssistantMessageAt: 5000 }),
            { lastSeenAt: 5000 }
        )).toBe(false)
    })

    it('ignores an archive-only activity-clock change after the reply was seen', () => {
        expect(classifySessionAttention(
            makeSummary({
                id: 'archived-after-seen',
                active: false,
                updatedAt: 9000,
                lastAssistantMessageAt: 5000,
            }),
            { selected: false, lastSeenAt: 5000 }
        )).toBeNull()
    })

    it('does not classify a legacy row until its reply clock is complete', () => {
        expect(sessionIsUnread(
            makeSummary({
                id: 'legacy-backfill',
                updatedAt: 9000,
                lastAssistantMessageAt: 5000,
                assistantReplyClockBackfilled: false,
            }),
            { lastSeenAt: 0 }
        )).toBe(false)
    })

    it('is false for activity received while the session is thinking', () => {
        expect(sessionIsUnread(
            makeSummary({ id: 'generating', thinking: true, updatedAt: 5000 }),
            { lastSeenAt: 1000 }
        )).toBe(false)
    })

    it('allows unread activity from an inactive session with a stale thinking flag', () => {
        expect(sessionIsUnread(
            makeSummary({ id: 'expired-thinking', active: false, thinking: true, updatedAt: 5000 }),
            { lastSeenAt: 1000 }
        )).toBe(true)
    })

    it('defers reply-clock unread while generating, then reveals the completed reply', () => {
        const generating = makeSummary({
            id: 'reply-generation',
            active: true, thinking: true, updatedAt: 9_000, lastAssistantMessageAt: 6_000,
        })
        expect(sessionIsUnread(generating, { lastSeenAt: 5_000 })).toBe(false)
        expect(sessionIsUnread({ ...generating, thinking: false }, { lastSeenAt: 5_000 })).toBe(true)
        expect(sessionIsUnread({ ...generating, thinking: false }, { lastSeenAt: 6_000 })).toBe(false)
    })

    it('preserves manual unread across reply-clock advances and pending backfill', () => {
        const summary = makeSummary({
            id: 'manual-pending-reply',
            active: true, thinking: true, updatedAt: 9_000, lastAssistantMessageAt: 6_000,
            assistantReplyClockBackfilled: false,
        })
        expect(sessionIsUnread(summary, { lastSeenAt: 6_000, manualUnreadAt: 5_000 })).toBe(true)
        expect(classifySessionAttention(summary, {
            selected: true, lastSeenAt: 6_000, manualUnreadAt: 5_000,
        })).toEqual({ kind: 'unread' })
    })

    it('does not care about permission / background fields — only the watermark', () => {
        expect(sessionIsUnread(
            makeSummary({
                id: 'p',
                pendingRequestKinds: ['permission'],
                pendingRequestsCount: 1,
                updatedAt: 1000,
            }),
            { lastSeenAt: 1000 }
        )).toBe(false)

        expect(sessionIsUnread(
            makeSummary({
                id: 'bg',
                backgroundTaskCount: 3,
                updatedAt: 9000,
                lastAssistantMessageAt: 9000,
            }),
            { lastSeenAt: 1000 }
        )).toBe(true)
    })
})
