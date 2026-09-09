import { describe, expect, it } from 'vitest'
import { getVisibleReleaseNotes, RELEASE_NOTES } from './releaseNotes'

describe('release notes catalog', () => {
    it('keeps every entry localized, linked, and newest-first', () => {
        expect(RELEASE_NOTES.length).toBeGreaterThan(0)
        expect(RELEASE_NOTES.length).toBeGreaterThanOrEqual(75)
        expect(RELEASE_NOTES.some((release) => release.version === __APP_VERSION__)).toBe(true)
        expect(new Set(RELEASE_NOTES.map((release) => release.version)).size).toBe(RELEASE_NOTES.length)

        for (const [index, release] of RELEASE_NOTES.entries()) {
            expect(release.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
            expect(release.url).toBe('https://github.com/tiann/hapi/releases/tag/v' + release.version)
            expect(release.summary.en.trim().length).toBeGreaterThan(0)
            expect(release.summary['zh-CN'].trim().length).toBeGreaterThan(0)
            expect(release.summary.en).not.toContain('complete GitHub release notes')
            expect(release.groups.length).toBeGreaterThan(0)
            for (const releaseGroup of release.groups) {
                expect(releaseGroup.title.en.trim().length).toBeGreaterThan(0)
                expect(releaseGroup.title['zh-CN'].trim().length).toBeGreaterThan(0)
                expect(releaseGroup.changes.length).toBeGreaterThan(0)
                for (const change of releaseGroup.changes) {
                    expect(['feature', 'fix', 'note']).toContain(change.kind)
                    expect(change.text.en.trim().length).toBeGreaterThan(0)
                    expect(change.text['zh-CN'].trim().length).toBeGreaterThan(0)
                }
            }

            const previous = RELEASE_NOTES[index - 1]
            if (previous) {
                expect(previous.date >= release.date).toBe(true)
            }
        }
    })

    it('puts additions before fixes in every release', () => {
        for (const release of RELEASE_NOTES) {
            expect(release.summary.en.trim().length).toBeGreaterThan(0)
            expect(release.summary['zh-CN'].trim().length).toBeGreaterThan(0)
            const changes = release.groups.flatMap((releaseGroup) => releaseGroup.changes)
            let seenFix = false
            for (const change of changes) {
                if (change.kind === 'fix') seenFix = true
                if (change.kind === 'feature') expect(seenFix).toBe(false)
            }
        }
    })

    it('hides a prepared future entry from the current app', () => {
        const futureRelease = {
            ...RELEASE_NOTES[0],
            version: '0.30.0',
            date: '2026-09-10',
            url: 'https://github.com/tiann/hapi/releases/tag/v0.30.0',
        }
        const preparedCatalog = [futureRelease, ...RELEASE_NOTES]
        const visible = getVisibleReleaseNotes('0.29.1', preparedCatalog)

        expect(visible[0].version).toBe('0.29.1')
        expect(visible).toHaveLength(RELEASE_NOTES.length)
        expect(visible.some((release) => release.version === '0.30.0')).toBe(false)
    })
})
