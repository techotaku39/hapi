import { describe, expect, it } from 'vitest'
import { shouldHideShareForRunningTurn } from './shareTurnAvailability'

const messages = [
    { id: 'user-old', role: 'user' },
    { id: 'assistant-old', role: 'assistant' },
    { id: 'user-active', role: 'user' },
    { id: 'assistant-active', role: 'assistant' },
]

describe('shouldHideShareForRunningTurn', () => {
    it('keeps historical turns shareable while the latest turn is running', () => {
        expect(shouldHideShareForRunningTurn(messages, 'user-old', true)).toBe(false)
        expect(shouldHideShareForRunningTurn(messages, 'assistant-old', true)).toBe(false)
    })

    it('hides both sides of the active turn while it is running', () => {
        expect(shouldHideShareForRunningTurn(messages, 'user-active', true)).toBe(true)
        expect(shouldHideShareForRunningTurn(messages, 'assistant-active', true)).toBe(true)
    })

    it('restores the active turn after generation finishes', () => {
        expect(shouldHideShareForRunningTurn(messages, 'user-active', false)).toBe(false)
        expect(shouldHideShareForRunningTurn(messages, 'assistant-active', false)).toBe(false)
    })

    it('does not let a failed queued attachment redefine the running turn', () => {
        const messagesWithFailedAttachment = [
            ...messages,
            {
                id: 'user-failed',
                role: 'user',
                metadata: { custom: { status: 'failed', invokedAt: null } },
            },
        ]

        expect(shouldHideShareForRunningTurn(messagesWithFailedAttachment, 'user-active', true)).toBe(true)
        expect(shouldHideShareForRunningTurn(messagesWithFailedAttachment, 'assistant-active', true)).toBe(true)
        expect(shouldHideShareForRunningTurn(messagesWithFailedAttachment, 'user-failed', true)).toBe(true)
    })

    it('fails open when the current message is not in the thread snapshot', () => {
        expect(shouldHideShareForRunningTurn(messages, 'missing', true)).toBe(false)
    })
})
