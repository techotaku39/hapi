import { afterEach, describe, expect, it } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
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

    it('clones durable message attachments for a fork without changing the source', () => {
        const dir = mkdtempSync(join(tmpdir(), 'hapi-attachments-'))
        tempDirs.push(dir)
        const store = new Store(':memory:', { attachmentsRoot: join(dir, 'attachments') })
        const source = store.attachments.create({
            namespace: 'namespace-a',
            sessionId: 'session-a',
            filename: 'photo.png',
            mimeType: 'image/png',
            original: Buffer.from('original'),
            thumbnail: Buffer.from('thumbnail'),
            thumbnailMimeType: 'image/webp'
        })
        const content = {
            role: 'user',
            content: {
                type: 'text',
                text: 'inspect this',
                attachments: [{
                    id: 'message-attachment',
                    filename: source.filename,
                    mimeType: source.mimeType,
                    size: source.size,
                    attachmentId: source.id,
                    path: '/legacy/path-that-must-not-survive'
                }]
            }
        }

        const cloned = store.attachments.cloneMessageAttachments(
            'namespace-a',
            'session-a',
            'session-b',
            content
        ) as typeof content
        const clonedId = cloned.content.attachments[0]?.attachmentId
        expect(clonedId).toBeDefined()
        expect(clonedId).not.toBe(source.id)
        expect(cloned.content.attachments[0]?.path).toBeUndefined()
        expect(store.attachments.readForSession(clonedId!, 'namespace-a', 'session-b', 'original')?.data)
            .toEqual(Buffer.from('original'))
        expect(store.attachments.readForSession(clonedId!, 'namespace-a', 'session-b', 'thumbnail')?.data)
            .toEqual(Buffer.from('thumbnail'))
        expect(store.attachments.getForSession(source.id, 'namespace-a', 'session-a')).not.toBeNull()
        store.close()
    })

    it('rewrites durable attachment ids when queued messages change session ownership', () => {
        const dir = mkdtempSync(join(tmpdir(), 'hapi-attachments-'))
        tempDirs.push(dir)
        const store = new Store(':memory:', { attachmentsRoot: join(dir, 'attachments') })
        const target = store.sessions.getOrCreateSession(
            'target', { path: '/tmp/project', host: 'localhost', flavor: 'opencode' }, null, 'default'
        )
        const source = store.sessions.getOrCreateSession(
            'source', {
                path: '/tmp/project',
                host: 'localhost',
                flavor: 'opencode',
                supersededBySessionId: target.id
            }, null, 'default'
        )
        const makeContent = (attachment: { id: string; filename: string; mimeType: string; size: number }) => ({
            role: 'user',
            content: {
                type: 'text',
                text: 'inspect this',
                attachments: [{
                    id: 'message-attachment',
                    filename: attachment.filename,
                    mimeType: attachment.mimeType,
                    size: attachment.size,
                    attachmentId: attachment.id,
                    path: '/legacy/path-that-must-not-survive'
                }]
            }
        })
        const getAttachmentId = (message: { content: unknown } | undefined): string => {
            if (!message) throw new Error('expected moved message')
            const content = message.content as { content: { attachments: Array<{ attachmentId: string }> } }
            return content.content.attachments[0]!.attachmentId
        }

        const redirectedAttachment = store.attachments.create({
            namespace: 'default',
            sessionId: source.id,
            filename: 'redirected.txt',
            mimeType: 'text/plain',
            original: Buffer.from('redirected')
        })
        const redirected = store.addMessageForCurrentSession(
            source.id,
            makeContent(redirectedAttachment),
            'redirected-local'
        )
        const redirectedId = getAttachmentId(redirected.message)
        expect(redirected.sessionId).toBe(target.id)
        expect(redirectedId).not.toBe(redirectedAttachment.id)
        expect(store.attachments.readForSession(redirectedId, 'default', target.id, 'original')?.data)
            .toEqual(Buffer.from('redirected'))
        expect(store.attachments.getForSession(redirectedAttachment.id, 'default', source.id)).not.toBeNull()

        const queuedSource = store.sessions.getOrCreateSession(
            'queued-source', { path: '/tmp/project', host: 'localhost', flavor: 'opencode' }, null, 'default'
        )
        const queuedAttachment = store.attachments.create({
            namespace: 'default',
            sessionId: queuedSource.id,
            filename: 'queued.txt',
            mimeType: 'text/plain',
            original: Buffer.from('queued')
        })
        store.messages.addMessage(queuedSource.id, makeContent(queuedAttachment), 'queued-local')

        expect(store.moveUninvokedMessages('default', queuedSource.id, target.id)).toBe(1)
        const moved = store.messages.getAllMessages(target.id).find((message) => message.localId === 'queued-local')
        const movedId = getAttachmentId(moved)
        expect(movedId).not.toBe(queuedAttachment.id)
        expect(store.attachments.readForSession(movedId, 'default', target.id, 'original')?.data)
            .toEqual(Buffer.from('queued'))

        const abortSource = store.sessions.getOrCreateSession(
            'abort-source', { path: '/tmp/project', host: 'localhost', flavor: 'opencode' }, null, 'default'
        )
        const abortTarget = store.sessions.getOrCreateSession(
            'abort-target', { path: '/tmp/project', host: 'localhost', flavor: 'opencode' }, null, 'default'
        )
        const replacementAttachment = store.attachments.create({
            namespace: 'default',
            sessionId: abortTarget.id,
            filename: 'restored.txt',
            mimeType: 'text/plain',
            original: Buffer.from('restored')
        })
        store.messages.addMessage(abortTarget.id, makeContent(replacementAttachment), 'restored-local')

        expect(store.moveUninvokedMessages('default', abortTarget.id, abortSource.id)).toBe(1)
        const restored = store.messages.getAllMessages(abortSource.id).find((message) => message.localId === 'restored-local')
        const restoredId = getAttachmentId(restored)
        expect(restoredId).not.toBe(replacementAttachment.id)
        expect(store.attachments.readForSession(restoredId, 'default', abortSource.id, 'original')?.data)
            .toEqual(Buffer.from('restored'))
        store.close()
    })

    it('expands tilde-based attachment roots before resolving them', () => {
        const previousHome = process.env.HAPI_HOME
        const previousRoot = process.env.HAPI_ATTACHMENTS_ROOT
        const homeSuffix = `.hapi-attachments-home-${randomUUID()}`
        const rootSuffix = `.hapi-attachments-root-${randomUUID()}`
        const expectedHomeRoot = join(homedir(), homeSuffix, 'attachments')
        const expectedOverrideRoot = join(homedir(), rootSuffix)
        try {
            process.env.HAPI_HOME = `~/${homeSuffix}`
            delete process.env.HAPI_ATTACHMENTS_ROOT
            const homeStore = new Store(':memory:')
            const homeAttachment = homeStore.attachments.create({
                namespace: 'namespace-a',
                sessionId: 'session-a',
                filename: 'home.txt',
                mimeType: 'text/plain',
                original: Buffer.from('home')
            })
            expect(homeAttachment.originalPath).toBe(join(expectedHomeRoot, `${homeAttachment.id}.original`))
            homeStore.close()

            process.env.HAPI_ATTACHMENTS_ROOT = `~/${rootSuffix}`
            const overrideStore = new Store(':memory:')
            const overrideAttachment = overrideStore.attachments.create({
                namespace: 'namespace-a',
                sessionId: 'session-a',
                filename: 'override.txt',
                mimeType: 'text/plain',
                original: Buffer.from('override')
            })
            expect(overrideAttachment.originalPath)
                .toBe(join(expectedOverrideRoot, `${overrideAttachment.id}.original`))
            overrideStore.close()
        } finally {
            if (previousHome === undefined) delete process.env.HAPI_HOME
            else process.env.HAPI_HOME = previousHome
            if (previousRoot === undefined) delete process.env.HAPI_ATTACHMENTS_ROOT
            else process.env.HAPI_ATTACHMENTS_ROOT = previousRoot
            rmSync(join(homedir(), homeSuffix), { recursive: true, force: true })
            rmSync(expectedOverrideRoot, { recursive: true, force: true })
        }
    })
})
