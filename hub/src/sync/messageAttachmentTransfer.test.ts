import { describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Store } from '../store'
import { writeScratchlistAttachmentFile } from '../scratchlistAttachments/storage'
import { rehomeMessageAttachments } from './messageAttachmentTransfer'

describe('rehomeMessageAttachments', () => {
    it('keeps earlier message metadata aligned when a later move fails', async () => {
        const hapiHome = mkdtempSync(join(tmpdir(), 'hapi-message-rehome-partial-'))
        const previousHome = process.env.HAPI_HOME
        process.env.HAPI_HOME = hapiHome
        const store = new Store(':memory:')
        try {
            const oldSession = store.sessions.getOrCreateSession(
                'message-rehome-old',
                { path: '/tmp/old', host: 'localhost' },
                null,
                'default',
            )
            const newSession = store.sessions.getOrCreateSession(
                'message-rehome-new',
                { path: '/tmp/new', host: 'localhost' },
                null,
                'default',
            )
            const firstAttachment = await writeScratchlistAttachmentFile(
                hapiHome,
                'default',
                oldSession.id,
                'first.png',
                'image/png',
                Buffer.from('first'),
            )
            const missingAttachment = {
                id: '22222222-2222-4222-8222-222222222222',
                filename: 'missing.png',
                mimeType: 'image/png',
                size: 7,
                path: `hapi-hub:scratchlist/default/${oldSession.id}/missing.png`,
            }
            store.messages.addMessage(
                oldSession.id,
                {
                    role: 'user',
                    content: { type: 'text', text: 'first', attachments: [firstAttachment] },
                },
                'message-rehome-first',
                Date.now() + 60_000,
            )
            store.messages.addMessage(
                oldSession.id,
                {
                    role: 'user',
                    content: { type: 'text', text: 'second', attachments: [missingAttachment] },
                },
                'message-rehome-second',
                Date.now() + 60_000,
            )
            store.messages.mergeSessionMessages(oldSession.id, newSession.id)

            await expect(
                rehomeMessageAttachments(store, 'default', oldSession.id, newSession.id),
            ).rejects.toThrow()

            const firstAfter = store.messages.getAllMessages(newSession.id)
                .find((message) => message.localId === 'message-rehome-first')
            const secondAfter = store.messages.getAllMessages(newSession.id)
                .find((message) => message.localId === 'message-rehome-second')
            const firstPath = (firstAfter?.content as { content?: { attachments?: Array<{ path: string }> } })
                .content?.attachments?.[0]?.path
            const secondPath = (secondAfter?.content as { content?: { attachments?: Array<{ path: string }> } })
                .content?.attachments?.[0]?.path

            expect(firstPath).toContain(`/${newSession.id}/`)
            expect(secondPath).toContain(`/${oldSession.id}/`)
        } finally {
            store.close()
            if (previousHome === undefined) delete process.env.HAPI_HOME
            else process.env.HAPI_HOME = previousHome
            rmSync(hapiHome, { recursive: true, force: true })
        }
    })
})
