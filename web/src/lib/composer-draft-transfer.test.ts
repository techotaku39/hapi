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

import {
    clearComposerDraftSnapshot,
    handoffComposerDraft,
    setComposerDraftSnapshot,
    transferComposerDraft,
} from './composer-draft-transfer'

describe('transferComposerDraft', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        clearComposerDraftSnapshot('old-live')
        clearComposerDraftSnapshot('new-live')
        clearComposerDraftSnapshot('old-stored')
        clearComposerDraftSnapshot('new-stored')
        clearComposerDraftSnapshot('old-empty')
        clearComposerDraftSnapshot('new-empty')
        clearComposerDraftSnapshot('old-pending')
        clearComposerDraftSnapshot('new-pending')
        clearComposerDraftSnapshot('source-a')
        clearComposerDraftSnapshot('target-a')
    })

    it('prefers the live composer snapshot when reopening the visible session', async () => {
        const file = new File(['draft'], 'draft.txt')
        setComposerDraftSnapshot('old-live', 'latest text', [{ id: 'a1', file }])

        await transferComposerDraft('old-live', 'new-live')

        expect(mocks.saveDraft).toHaveBeenCalledWith('new-live', 'latest text')
        expect(mocks.saveDraftAttachments).toHaveBeenCalledWith('new-live', [{ id: 'a1', file }])
        expect(mocks.getDraftAttachments).not.toHaveBeenCalled()
    })

    it('drops session-scoped upload metadata for a session-list reopen', async () => {
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
            path: undefined,
            previewUrl: undefined,
            uploadSessionId: undefined,
        }])
    })

    it('does not resurrect persisted text when the live composer is empty', async () => {
        mocks.getDraft.mockReturnValue('stale persisted text')
        setComposerDraftSnapshot('old-empty', '', [])

        await transferComposerDraft('old-empty', 'new-empty')

        expect(mocks.saveDraft).toHaveBeenCalledWith('new-empty', '')
        expect(mocks.saveDraftAttachments).toHaveBeenCalledWith('new-empty', [])
    })

    it('merges an in-flight pending attachment that is not in the live snapshot yet', async () => {
        const existing = new File(['old'], 'old.txt')
        const pending = new File(['new'], 'new.txt')
        setComposerDraftSnapshot('old-pending', 'typed', [{ id: 'a1', file: existing }])

        await transferComposerDraft('old-pending', 'new-pending', [{
            id: 'a2',
            file: pending,
            previewUrl: 'data:text/plain;base64,bmV3',
        }])

        expect(mocks.saveDraftAttachments).toHaveBeenCalledWith('new-pending', [
            { id: 'a1', file: existing },
            {
                id: 'a2',
                file: pending,
                previewUrl: 'data:text/plain;base64,bmV3',
                path: undefined,
                uploadSessionId: undefined,
            },
        ])
    })

    it('does not let a previously visited target snapshot replace the source draft', async () => {
        const sourceFile = new File(['source'], 'source.txt')
        const staleTargetFile = new File(['stale'], 'stale.txt')
        mocks.getDraft.mockImplementation((sessionId: string) => (
            sessionId === 'old-stored' ? 'source text' : 'stale target text'
        ))
        mocks.getDraftAttachments.mockImplementation(async (sessionId: string) => (
            sessionId === 'old-stored' ? [sourceFile] : [staleTargetFile]
        ))
        mocks.getRestoredUploadMetadata.mockImplementation((file: File) => (
            file === sourceFile
                ? { id: 'source-1', path: '/tmp/source', uploadSessionId: 'old-stored' }
                : { id: 'stale-1', path: '/tmp/stale', uploadSessionId: 'new-stored' }
        ))
        setComposerDraftSnapshot('new-stored', 'visited earlier', [{ id: 'stale-1', file: staleTargetFile }])

        await transferComposerDraft('old-stored', 'new-stored')

        expect(mocks.saveDraft).toHaveBeenCalledWith('new-stored', 'source text')
        expect(mocks.saveDraftAttachments).toHaveBeenCalledWith('new-stored', [{
            id: 'source-1',
            file: sourceFile,
            path: undefined,
            previewUrl: undefined,
            uploadSessionId: undefined,
        }])
    })
})

describe('handoffComposerDraft', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        clearComposerDraftSnapshot('source-a')
        clearComposerDraftSnapshot('target-a')
        mocks.getDraft.mockReturnValue('hello')
        mocks.getDraftAttachments.mockResolvedValue([])
    })

    it('passes every concurrent in-flight file into one navigable handoff', async () => {
        const file1 = new File(['one'], 'one.txt')
        const file2 = new File(['two'], 'two.txt')
        const onNavigable = vi.fn().mockResolvedValue(undefined)

        const first = handoffComposerDraft('source-a', 'target-a', { id: 'p1', file: file1 }, onNavigable)
        const second = handoffComposerDraft('source-a', 'target-a', { id: 'p2', file: file2 }, onNavigable)

        await Promise.all([first, second])

        expect(onNavigable).toHaveBeenCalledOnce()
        expect(onNavigable).toHaveBeenCalledWith('target-a')
        const savedAttachments = mocks.saveDraftAttachments.mock.calls.at(-1)?.[1] as Array<{ id: string }>
        expect(savedAttachments.map((item) => item.id).sort()).toEqual(['p1', 'p2'])
    })

    it('appends a staggered file onto the target after the first handoff completes', async () => {
        const file1 = new File(['one'], 'one.txt')
        const file2 = new File(['two'], 'two.txt')
        const onNavigable = vi.fn().mockResolvedValue(undefined)

        await handoffComposerDraft('source-a', 'target-a', { id: 'p1', file: file1 }, onNavigable)
        await handoffComposerDraft('source-a', 'target-a', { id: 'p2', file: file2 }, onNavigable)

        expect(onNavigable).toHaveBeenCalledOnce()
        const savedAttachments = mocks.saveDraftAttachments.mock.calls.at(-1)?.[1] as Array<{ id: string }>
        expect(savedAttachments.map((item) => item.id).sort()).toEqual(['p1', 'p2'])
    })
})
