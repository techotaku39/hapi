import { afterEach, describe, expect, it } from 'bun:test'
import { Database } from 'bun:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Store } from './index'

const tempDirs: string[] = []

afterEach(() => {
    if (process.platform === 'win32') Bun.gc(true)
    for (const dir of tempDirs.splice(0)) {
        rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 })
    }
})

describe('schema migration v27 to v28', () => {
    it('preserves an older PR-v27 reply clock while repairing the upstream index', () => {
        const dir = mkdtempSync(join(tmpdir(), 'hapi-pr-v27-migration-'))
        tempDirs.push(dir)
        const dbPath = join(dir, 'hapi.db')
        const initial = new Store(dbPath)
        const session = initial.sessions.getOrCreateSession('old-pr-v27', { path: '/tmp' }, null, 'default')
        initial.messages.addMessage(session.id, {
            role: 'agent', content: { type: 'codex', data: { type: 'message', message: 'preserved answer' } },
        }, undefined, undefined, 8_000)
        const before = initial.sessions.getSession(session.id)!
        initial.close()

        const legacy = new Database(dbPath)
        legacy.exec('DROP INDEX idx_messages_future_scheduled_queued; PRAGMA user_version = 27;')
        legacy.close(true)
        const migrated = new Store(dbPath)
        try {
            const db = (migrated as unknown as { db: Database }).db
            expect(db.prepare('PRAGMA user_version').get()).toEqual({ user_version: 28 })
            expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'idx_messages_future_scheduled_queued'").get()).not.toBeNull()
            expect(migrated.sessions.getSession(session.id)).toMatchObject({
                lastAssistantMessageAt: before.lastAssistantMessageAt,
                assistantReplyClockBackfilled: before.assistantReplyClockBackfilled,
                updatedAt: before.updatedAt,
            })
            expect(migrated.messages.getMessages(session.id)).toHaveLength(1)
        } finally {
            migrated.close()
        }
    })

    it('adds reply-clock columns to an already-v27 database', () => {
        const dir = mkdtempSync(join(tmpdir(), 'hapi-migration-v27-'))
        tempDirs.push(dir)
        const dbPath = join(dir, 'hapi.db')

        const initial = new Store(dbPath)
        initial.sessions.getOrCreateSession(
            'migration-v27-reply-clock',
            { path: '/tmp/project', host: 'localhost' },
            null,
            'default'
        )
        initial.close()

        const legacy = new Database(dbPath)
        legacy.exec(`
            ALTER TABLE sessions DROP COLUMN assistant_reply_clock_backfilled;
            ALTER TABLE sessions DROP COLUMN last_assistant_message_at;
            PRAGMA user_version = 27;
        `)
        legacy.close(true)

        const migrated = new Store(dbPath)
        try {
            const internalDb = (migrated as unknown as { db: Database }).db
            const columns = internalDb
                .prepare('PRAGMA table_info(sessions)')
                .all() as Array<{ name: string }>

            expect(columns.some((column) => column.name === 'last_assistant_message_at')).toBe(true)
            expect(columns.some((column) => column.name === 'assistant_reply_clock_backfilled')).toBe(true)
            expect(internalDb.prepare('PRAGMA user_version').get() as { user_version: number })
                .toEqual({ user_version: 28 })

            const session = migrated.sessions.getOrCreateSession(
                'post-v27-session',
                { path: '/tmp/project', host: 'localhost' },
                null,
                'default'
            )
            const message = migrated.messages.addMessage(session.id, {
                role: 'agent',
                content: { type: 'codex', data: { type: 'message', message: 'reply after migration' } }
            })

            expect(message.id).toBeString()
            expect(migrated.sessions.getSession(session.id)?.lastAssistantMessageAt).toBeGreaterThan(0)
        } finally {
            migrated.close()
        }
    })
})
