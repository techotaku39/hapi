import { afterEach, describe, expect, it } from 'bun:test'
import { Database } from 'bun:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Store } from './index'

const tempDirs: string[] = []

afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
        rmSync(dir, { recursive: true, force: true })
    }
})

describe('schema migration v23 to v24', () => {
    it('backfills position using the previous newest-first order', () => {
        const dir = mkdtempSync(join(tmpdir(), 'hapi-migration-v24-'))
        tempDirs.push(dir)
        const dbPath = join(dir, 'hapi.db')

        new Store(dbPath).close()
        const legacy = new Database(dbPath)
        legacy.exec(`
            PRAGMA foreign_keys = OFF;
            ALTER TABLE session_scratchlist RENAME TO session_scratchlist_with_position;
            CREATE TABLE session_scratchlist (
                session_id TEXT NOT NULL,
                entry_id TEXT NOT NULL,
                text TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                attachments TEXT DEFAULT NULL,
                PRIMARY KEY (session_id, entry_id),
                FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
            );
            INSERT INTO session_scratchlist
                (session_id, entry_id, text, created_at, updated_at, attachments)
            VALUES
                ('session-1', 'older', 'older', 100, 100, NULL),
                ('session-1', 'newer', 'newer', 200, 200, NULL);
            DROP TABLE session_scratchlist_with_position;
            CREATE INDEX idx_session_scratchlist_session_created
                ON session_scratchlist(session_id, created_at DESC);
            PRAGMA user_version = 23;
        `)
        legacy.close()

        const migrated = new Store(dbPath)
        expect(migrated.scratchlist.list('session-1').map((entry) => ({
            entryId: entry.entryId,
            position: entry.position,
        }))).toEqual([
            { entryId: 'newer', position: 0 },
            { entryId: 'older', position: 1 },
        ])
        const internalDb = (migrated as unknown as { db: Database }).db
        const version = internalDb.prepare('PRAGMA user_version').get() as { user_version: number }
        expect(version.user_version).toBe(24)
        migrated.close()
    })
})
