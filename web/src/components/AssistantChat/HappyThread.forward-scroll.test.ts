import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Reading forward past the window limit trims rows off the old end. Message
 * CSS disables browser scroll anchoring, so without capturing an anchor before
 * the page is applied and restoring it afterwards, the unchanged scrollTop
 * lands roughly a page later and jumps past the newly loaded messages
 * (tiann/hapi#1598 review).
 *
 * The behaviour itself needs a browser to assert end to end; this guards the
 * wiring so the anchor cannot be dropped from the forward path unnoticed.
 */
describe('forward history load scroll anchoring', () => {
    const source = readFileSync(resolve(__dirname, 'HappyThread.tsx'), 'utf8')

    it('captures a scroll anchor before requesting a newer page', () => {
        const forwardBranch = source.slice(
            source.indexOf('if (hasMoreNewerRef.current'),
            source.indexOf('onLoadNewerRef.current()')
        )

        expect(forwardBranch).toContain('captureScrollAnchor')
        expect(forwardBranch).toContain('pendingForwardAnchorRef.current =')
    })

    it('refreshes the pending anchor while the user scrolls during a load', () => {
        const scrollHandler = source.slice(
            source.indexOf('const pending = pendingScrollRef.current'),
            source.indexOf('const needsCoverage = needsViewportCoverageRef.current()')
        )

        // Restoring the start-of-request anchor would drag a user who scrolled
        // away back to where they were.
        expect(scrollHandler).toContain('pendingForwardAnchorRef.current = captureScrollAnchor(viewport)')
    })

    it('restores that anchor once the loaded history version renders', () => {
        const restoreEffect = source.slice(
            source.indexOf('const forwardAnchor = pendingForwardAnchorRef.current'),
            source.indexOf('}, [appliedHistoryVersion])')
        )

        expect(restoreEffect).toContain('restoreScrollAnchor')
        // Clearing it matters: a stale anchor would fight the next scroll.
        expect(restoreEffect).toContain('pendingForwardAnchorRef.current = null')
    })
})
