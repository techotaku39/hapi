import { afterEach, describe, expect, it } from 'bun:test'
import { Database } from 'bun:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Store } from './index'

const tempDirs: string[] = []

afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
        rmSync(dir, { recursive: true, force: true })
    }
})

describe('schema migration v23 to current', () => {
    it('adds the assistant reply clock and preserves activity time', () => {
        const dir = mkdtempSync(join(tmpdir(), 'hapi-migration-v24-'))
        tempDirs.push(dir)
        const dbPath = join(dir, 'hapi.db')

        const initial = new Store(dbPath)
        const session = initial.sessions.getOrCreateSession(
            'migration-reply-clock',
            { path: '/tmp/project', host: 'localhost' },
            null,
            'default'
        )
        const activityAt = session.updatedAt
        initial.close()

        const legacy = new Database(dbPath)
        legacy.exec('ALTER TABLE sessions DROP COLUMN assistant_reply_clock_backfilled')
        legacy.exec('ALTER TABLE sessions DROP COLUMN last_assistant_message_at')
        legacy.exec('PRAGMA user_version = 23')
        legacy.close()

        const migrated = new Store(dbPath)
        const columns = migrated
            ? ((migrated as unknown as { db: Database }).db
                .prepare('PRAGMA table_info(sessions)')
                .all() as Array<{ name: string }>)
            : []
        expect(columns.some((column) => column.name === 'last_assistant_message_at')).toBe(true)
        expect(columns.some((column) => column.name === 'assistant_reply_clock_backfilled')).toBe(true)
        expect((migrated as unknown as { db: Database }).db
            .prepare('PRAGMA user_version').get() as { user_version: number })
            .toEqual({ user_version: 25 })

        const reloaded = migrated.sessions.getSession(session.id)
        expect(reloaded?.lastAssistantMessageAt).toBeNull()
        expect(reloaded?.assistantReplyClockBackfilled).toBe(false)
        expect(reloaded?.updatedAt).toBe(activityAt)
        migrated.close()
    })
})
