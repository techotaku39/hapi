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
    it('adds the durable attachments table automatically', () => {
        const dir = mkdtempSync(join(tmpdir(), 'hapi-migration-v24-'))
        tempDirs.push(dir)
        const dbPath = join(dir, 'hapi.db')

        new Store(dbPath, { attachmentsRoot: join(dir, 'attachments') }).close()
        const legacy = new Database(dbPath)
        legacy.exec('DROP TABLE IF EXISTS attachments; PRAGMA user_version = 23;')
        legacy.close()

        const migrated = new Store(dbPath, { attachmentsRoot: join(dir, 'attachments') })
        const internalDb = (migrated as unknown as { db: Database }).db
        const table = internalDb.prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'attachments'"
        ).get() as { name: string } | null
        const version = internalDb.prepare('PRAGMA user_version').get() as { user_version: number }

        expect(table?.name).toBe('attachments')
        expect(version.user_version).toBe(24)
        migrated.close()
    })
})
