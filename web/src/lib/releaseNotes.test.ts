import { describe, expect, it } from 'vitest'
import { RELEASE_NOTES } from './releaseNotes'

describe('release notes catalog', () => {
    it('keeps every entry localized, linked, and newest-first', () => {
        expect(RELEASE_NOTES.length).toBeGreaterThan(0)
        expect(RELEASE_NOTES.length).toBeGreaterThanOrEqual(74)
        expect(RELEASE_NOTES[0].version).toBe(__APP_VERSION__)
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

    it('puts additions before fixes in the recently curated releases', () => {
        for (const release of RELEASE_NOTES.slice(0, 3)) {
            expect(release.summary?.en.trim().length).toBeGreaterThan(0)
            expect(release.summary?.['zh-CN'].trim().length).toBeGreaterThan(0)
            const changes = release.groups.flatMap((releaseGroup) => releaseGroup.changes)
            const firstFixIndex = changes.findIndex((change) => change.kind === 'fix')
            if (firstFixIndex === -1) continue
            expect(changes.slice(0, firstFixIndex).every((change) => change.kind === 'feature')).toBe(true)
            expect(changes.slice(firstFixIndex).every((change) => change.kind === 'fix')).toBe(true)
        }
    })
})
