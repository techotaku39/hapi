import { afterEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Store } from './index'

const tempDirs: string[] = []

afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
        rmSync(dir, { recursive: true, force: true })
    }
})

describe('AttachmentStore', () => {
    it('stores original and thumbnail bytes with session and namespace isolation', () => {
        const dir = mkdtempSync(join(tmpdir(), 'hapi-attachments-'))
        tempDirs.push(dir)
        const store = new Store(':memory:', { attachmentsRoot: join(dir, 'attachments') })
        const original = Buffer.from('original bytes')
        const thumbnail = Buffer.from('thumbnail bytes')

        const created = store.attachments.create({
            namespace: 'namespace-a',
            sessionId: 'session-a',
            filename: '../photo.png',
            mimeType: 'image/png',
            original,
            thumbnail,
            thumbnailMimeType: 'image/webp'
        })

        expect(created.filename).toBe('photo.png')
        expect(created.originalPath).not.toContain('photo.png')
        expect(existsSync(created.originalPath)).toBe(true)
        expect(readFileSync(created.originalPath)).toEqual(original)
        expect(store.attachments.getForSession(created.id, 'namespace-b', 'session-a')).toBeNull()
        expect(store.attachments.getForSession(created.id, 'namespace-a', 'session-b')).toBeNull()

        const originalBlob = store.attachments.readForSession(created.id, 'namespace-a', 'session-a', 'original')
        const thumbnailBlob = store.attachments.readForSession(created.id, 'namespace-a', 'session-a', 'thumbnail')
        expect(originalBlob?.data).toEqual(original)
        expect(originalBlob?.sha256).toBe(created.sha256)
        expect(thumbnailBlob?.data).toEqual(thumbnail)
        expect(thumbnailBlob?.mimeType).toBe('image/webp')

        expect(store.attachments.deleteForSession(created.id, 'namespace-b', 'session-a')).toBe(false)
        expect(store.attachments.deleteForSession(created.id, 'namespace-a', 'session-a')).toBe(true)
        expect(existsSync(created.originalPath)).toBe(false)
        expect(store.attachments.readForSession(created.id, 'namespace-a', 'session-a', 'original')).toBeNull()
        store.close()
    })

    it('keeps a valid original when the optional thumbnail is rejected', () => {
        const dir = mkdtempSync(join(tmpdir(), 'hapi-attachments-'))
        tempDirs.push(dir)
        const store = new Store(':memory:', { attachmentsRoot: join(dir, 'attachments') })
        const created = store.attachments.create({
            namespace: 'namespace-a',
            sessionId: 'session-a',
            filename: 'document.txt',
            mimeType: 'text/plain',
            original: Buffer.from('content'),
            thumbnail: Buffer.from('not an image thumbnail'),
            thumbnailMimeType: 'text/plain'
        })

        expect(created.thumbnailPath).toBeNull()
        expect(store.attachments.readForSession(created.id, 'namespace-a', 'session-a', 'original')?.data)
            .toEqual(Buffer.from('content'))
        expect(store.attachments.readForSession(created.id, 'namespace-a', 'session-a', 'thumbnail')).toBeNull()
        store.close()
    })

    it('transfers and deletes all attachments by session without crossing namespaces', () => {
        const dir = mkdtempSync(join(tmpdir(), 'hapi-attachments-'))
        tempDirs.push(dir)
        const store = new Store(':memory:', { attachmentsRoot: join(dir, 'attachments') })
        const created = store.attachments.create({
            namespace: 'namespace-a',
            sessionId: 'session-a',
            filename: 'photo.png',
            mimeType: 'image/png',
            original: Buffer.from('original'),
            thumbnail: Buffer.from('thumb'),
            thumbnailMimeType: 'image/webp'
        })
        const otherNamespace = store.attachments.create({
            namespace: 'namespace-b',
            sessionId: 'session-a',
            filename: 'other.png',
            mimeType: 'image/png',
            original: Buffer.from('other')
        })

        expect(store.attachments.transferSession('namespace-a', 'session-a', 'session-b')).toBe(1)
        expect(store.attachments.getForSession(created.id, 'namespace-a', 'session-a')).toBeNull()
        expect(store.attachments.getForSession(created.id, 'namespace-a', 'session-b')).not.toBeNull()
        expect(store.attachments.getForSession(otherNamespace.id, 'namespace-b', 'session-a')).not.toBeNull()

        expect(store.attachments.deleteAllForSession('namespace-a', 'session-b')).toBe(1)
        expect(store.attachments.getForSession(created.id, 'namespace-a', 'session-b')).toBeNull()
        expect(existsSync(created.originalPath)).toBe(false)
        expect(created.thumbnailPath && existsSync(created.thumbnailPath)).toBe(false)
        expect(existsSync(otherNamespace.originalPath)).toBe(true)
        store.close()
    })
})
