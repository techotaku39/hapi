import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RpcRegistry } from '../socket/rpcRegistry'
import { Store } from '../store'
import { SyncEngine } from './syncEngine'

const tempDirs: string[] = []

afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
        rmSync(dir, { recursive: true, force: true })
    }
})

function createEngine(store: Store): SyncEngine {
    return new SyncEngine(
        store,
        {} as never,
        new RpcRegistry(),
        { broadcast() {} } as never
    )
}

describe('SyncEngine.deleteAttachment', () => {
    it('refuses to delete an attachment referenced by a persisted message', async () => {
        const root = mkdtempSync(join(tmpdir(), 'hapi-attachment-delete-'))
        tempDirs.push(root)
        const store = new Store(':memory:', { attachmentsRoot: join(root, 'attachments') })
        const engine = createEngine(store)
        try {
            const session = engine.getOrCreateSession(
                'attachment-delete',
                { path: '/tmp/project', host: 'localhost', flavor: 'opencode' },
                null,
                'default'
            )
            const attachment = await store.attachments.create({
                namespace: 'default',
                sessionId: session.id,
                filename: 'photo.png',
                mimeType: 'image/png',
                original: Buffer.from('original')
            })
            store.messages.addMessage(session.id, {
                role: 'user',
                content: {
                    type: 'text',
                    text: 'keep this image',
                    attachments: [{
                        id: 'message-attachment',
                        filename: attachment.filename,
                        mimeType: attachment.mimeType,
                        size: attachment.size,
                        attachmentId: attachment.id
                    }]
                }
            })

            await expect(engine.deleteAttachment(session.id, 'default', attachment.id)).resolves.toEqual({
                success: false,
                error: 'Attachment is already referenced by a message'
            })
            expect(store.attachments.getForSession(attachment.id, 'default', session.id)).not.toBeNull()
            expect(existsSync(attachment.originalPath)).toBe(true)
        } finally {
            engine.stop()
            store.close()
        }
    })
})
