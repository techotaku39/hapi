import { describe, expect, it } from 'vitest'
import { resolveCodexImportRedirectSessionId } from './codexImportMerge'

describe('resolveCodexImportRedirectSessionId', () => {
    it('prefers the canonical session returned by duplicate merge', () => {
        expect(resolveCodexImportRedirectSessionId(
            [{ canonicalSessionId: 'canonical-session' }],
            ['imported-session']
        )).toBe('canonical-session')
    })

    it('falls back to the imported Hapi session when merge omits a canonical id', () => {
        expect(resolveCodexImportRedirectSessionId(
            [{}],
            ['imported-session']
        )).toBe('imported-session')
    })

    it('returns null when neither source provides a session id', () => {
        expect(resolveCodexImportRedirectSessionId([], [])).toBeNull()
    })
})
