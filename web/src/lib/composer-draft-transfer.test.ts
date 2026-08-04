import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
    getDraft: vi.fn(),
    saveDraft: vi.fn(),
    getDraftAttachments: vi.fn(),
    getRestoredUploadMetadata: vi.fn(),
    saveDraftAttachments: vi.fn(),
}))

vi.mock('@/lib/composer-drafts', () => ({
    getDraft: mocks.getDraft,
    saveDraft: mocks.saveDraft,
}))
vi.mock('@/lib/composer-attachment-drafts', () => ({
    getDraftAttachments: mocks.getDraftAttachments,
    getRestoredUploadMetadata: mocks.getRestoredUploadMetadata,
    saveDraftAttachments: mocks.saveDraftAttachments,
}))

import { setComposerDraftSnapshot, transferComposerDraft } from './composer-draft-transfer'

describe('transferComposerDraft', () => {
    beforeEach(() => vi.clearAllMocks())

    it('prefers the live composer snapshot when reopening the visible session', async () => {
        const file = new File(['draft'], 'draft.txt')
        setComposerDraftSnapshot('old-live', 'latest text', [{ id: 'a1', file }])

        await transferComposerDraft('old-live', 'new-live')

        expect(mocks.saveDraft).toHaveBeenCalledWith('new-live', 'latest text')
        expect(mocks.saveDraftAttachments).toHaveBeenCalledWith('new-live', [{ id: 'a1', file }])
        expect(mocks.getDraftAttachments).not.toHaveBeenCalled()
    })

    it('copies persisted attachment upload metadata for a session-list reopen', async () => {
        const file = new File(['draft'], 'draft.txt')
        mocks.getDraft.mockReturnValue('persisted text')
        mocks.getDraftAttachments.mockResolvedValue([file])
        mocks.getRestoredUploadMetadata.mockReturnValue({
            id: 'uploaded-1',
            path: '/tmp/uploaded-1',
            previewUrl: 'blob:preview',
            uploadSessionId: 'old-stored',
        })

        await transferComposerDraft('old-stored', 'new-stored')

        expect(mocks.saveDraft).toHaveBeenCalledWith('new-stored', 'persisted text')
        expect(mocks.saveDraftAttachments).toHaveBeenCalledWith('new-stored', [{
            id: 'uploaded-1',
            file,
            path: '/tmp/uploaded-1',
            previewUrl: 'blob:preview',
            uploadSessionId: 'old-stored',
        }])
    })

    it('does not resurrect persisted text when the live composer is empty', async () => {
        mocks.getDraft.mockReturnValue('stale persisted text')
        setComposerDraftSnapshot('old-empty', '', [])

        await transferComposerDraft('old-empty', 'new-empty')

        expect(mocks.saveDraft).toHaveBeenCalledWith('new-empty', '')
        expect(mocks.saveDraftAttachments).toHaveBeenCalledWith('new-empty', [])
    })
})
