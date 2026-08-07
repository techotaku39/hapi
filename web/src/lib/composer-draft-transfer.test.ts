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
    attachmentDraftRevision,
    clearComposerDraftSnapshot,
    handoffComposerDraft,
    persistInactiveComposerAttachments,
    setComposerDraftSnapshot,
    transferComposerDraft,
    updateComposerDraftTextSnapshot,
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

    it('falls back to persisted attachments after an inactive empty live snapshot is cleared', async () => {
        const file = new File(['kept'], 'kept.txt')
        mocks.getDraft.mockReturnValue('typed while inactive')
        mocks.getDraftAttachments.mockResolvedValue([file])
        mocks.getRestoredUploadMetadata.mockReturnValue({
            id: 'kept-1',
            path: '/tmp/kept',
            uploadSessionId: 'old-empty',
        })
        setComposerDraftSnapshot('old-empty', 'typed while inactive', [])
        clearComposerDraftSnapshot('old-empty')

        await transferComposerDraft('old-empty', 'new-empty')

        expect(mocks.saveDraft).toHaveBeenCalledWith('new-empty', 'typed while inactive')
        expect(mocks.saveDraftAttachments).toHaveBeenCalledWith('new-empty', [{
            id: 'kept-1',
            file,
            path: undefined,
            previewUrl: undefined,
            uploadSessionId: undefined,
        }])
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

    it('keeps upload metadata when appending onto the same target session', async () => {
        const uploaded = new File(['one'], 'one.txt')
        const late = new File(['two'], 'two.txt')
        const onNavigable = vi.fn().mockResolvedValue(undefined)

        // First handoff establishes source→target mapping.
        await handoffComposerDraft('source-a', 'target-a', { id: 'p1', file: uploaded }, onNavigable)
        // Simulate the target composer having finished uploading p1.
        setComposerDraftSnapshot('target-a', 'hello', [{
            id: 'p1',
            file: uploaded,
            path: '/uploads/one.txt',
            uploadSessionId: 'target-a',
        }])
        await handoffComposerDraft('source-a', 'target-a', { id: 'p2', file: late }, onNavigable)

        const savedAttachments = mocks.saveDraftAttachments.mock.calls.at(-1)?.[1] as Array<{
            id: string
            path?: string
            uploadSessionId?: string
        }>
        expect(savedAttachments).toEqual(expect.arrayContaining([
            expect.objectContaining({
                id: 'p1',
                path: '/uploads/one.txt',
                uploadSessionId: 'target-a',
            }),
            expect.objectContaining({ id: 'p2', file: late }),
        ]))
    })

    it('drops a cancelled pending id from the source snapshot at save time', async () => {
        const kept = new File(['kept'], 'kept.txt')
        const cancelled = new File(['gone'], 'gone.txt')
        setComposerDraftSnapshot('source-a', 'typed', [
            { id: 'kept-1', file: kept },
            { id: 'gone-1', file: cancelled },
        ])
        const onNavigable = vi.fn().mockResolvedValue(undefined)

        await handoffComposerDraft(
            'source-a',
            'target-a',
            {
                id: 'gone-1',
                file: cancelled,
                isCancelled: () => true,
            },
            onNavigable,
        )

        expect(onNavigable).toHaveBeenCalledOnce()
        expect(mocks.saveDraftAttachments).toHaveBeenCalledWith('target-a', [
            expect.objectContaining({ id: 'kept-1', file: kept }),
        ])
    })

    it('re-samples isCancelled after an async gap before writing the transfer', async () => {
        const kept = new File(['kept'], 'kept.txt')
        const cancelled = new File(['gone'], 'gone.txt')
        setComposerDraftSnapshot('source-a', 'typed', [
            { id: 'kept-1', file: kept },
            { id: 'gone-1', file: cancelled },
        ])
        let cancelledNow = false
        const onNavigable = vi.fn().mockResolvedValue(undefined)

        const handoff = handoffComposerDraft(
            'source-a',
            'target-a',
            {
                id: 'gone-1',
                file: cancelled,
                isCancelled: () => cancelledNow,
            },
            onNavigable,
        )
        // Cancel after enqueue, before the handoff's setTimeout(0) transfer samples.
        cancelledNow = true
        await handoff

        expect(onNavigable).toHaveBeenCalledOnce()
        expect(mocks.saveDraftAttachments).toHaveBeenCalledWith('target-a', [
            expect.objectContaining({ id: 'kept-1', file: kept }),
        ])
    })
})

describe('updateComposerDraftTextSnapshot', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        clearComposerDraftSnapshot('session-inactive')
    })

    it('updates text without writing attachment blobs', () => {
        const file = new File(['blob'], 'big.bin')
        setComposerDraftSnapshot('session-inactive', 'before', [{ id: 'a1', file }])

        updateComposerDraftTextSnapshot('session-inactive', 'after keystroke')

        expect(mocks.saveDraft).toHaveBeenCalledWith('session-inactive', 'after keystroke')
        expect(mocks.saveDraftAttachments).not.toHaveBeenCalled()
    })

    it('keeps attachment revision stable across text-only changes', () => {
        const file = new File(['blob'], 'big.bin')
        const drafts = [{ id: 'a1', file, path: '/tmp/a', uploadSessionId: 's1' }]
        expect(attachmentDraftRevision(drafts)).toBe(attachmentDraftRevision([
            { id: 'a1', file: new File(['other'], 'other.bin'), path: '/tmp/a', uploadSessionId: 's1' },
        ]))
        expect(attachmentDraftRevision(drafts)).not.toBe(attachmentDraftRevision([
            { id: 'a1', file, path: '/tmp/b', uploadSessionId: 's1' },
        ]))
    })
})

describe('persistInactiveComposerAttachments', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        clearComposerDraftSnapshot('session-inactive')
    })

    it('clears the live snapshot without touching stored files when nothing is visible', async () => {
        setComposerDraftSnapshot('session-inactive', 'stale', [])
        mocks.getDraftAttachments.mockResolvedValue([new File(['kept'], 'kept.txt')])

        await persistInactiveComposerAttachments('session-inactive', 'typed', [])

        expect(mocks.saveDraft).toHaveBeenCalledWith('session-inactive', 'typed')
        expect(mocks.saveDraftAttachments).not.toHaveBeenCalled()
    })

    it('merges a newly selected file into the hidden stored draft', async () => {
        const stored = new File(['a'], 'a.txt')
        const picked = new File(['b'], 'b.txt')
        mocks.getDraftAttachments.mockResolvedValue([stored])
        mocks.getRestoredUploadMetadata.mockReturnValue({
            id: 'stored-a',
            path: '/tmp/a',
            uploadSessionId: 'session-inactive',
        })

        await persistInactiveComposerAttachments('session-inactive', 'typed', [{
            id: 'picked-b',
            file: picked,
        }])

        expect(mocks.saveDraftAttachments).toHaveBeenCalledWith('session-inactive', [
            expect.objectContaining({ id: 'stored-a', file: stored }),
            expect.objectContaining({ id: 'picked-b', file: picked }),
        ])
    })

    it('removes a previously visible failed pick from storage when the operator clears it', async () => {
        const storedA = new File(['a'], 'a.txt')
        const pickedB = new File(['b'], 'b.txt')
        mocks.getDraftAttachments
            .mockResolvedValueOnce([storedA])
            .mockResolvedValueOnce([storedA, pickedB])
        mocks.getRestoredUploadMetadata.mockImplementation((file: File) => {
            if (file === storedA) {
                return { id: 'stored-a', path: '/tmp/a', uploadSessionId: 'session-inactive' }
            }
            if (file === pickedB) {
                return { id: 'picked-b' }
            }
            return undefined
        })

        await persistInactiveComposerAttachments('session-inactive', 'typed', [{
            id: 'picked-b',
            file: pickedB,
        }])
        await persistInactiveComposerAttachments('session-inactive', 'typed', [])

        expect(mocks.saveDraftAttachments).toHaveBeenLastCalledWith('session-inactive', [
            expect.objectContaining({ id: 'stored-a', file: storedA }),
        ])
    })

    it('serializes concurrent persist calls so an older read cannot overwrite a newer merge', async () => {
        const storedA = new File(['a'], 'a.txt')
        const pickedB = new File(['b'], 'b.txt')
        const pickedC = new File(['c'], 'c.txt')
        let releaseFirstRead!: () => void
        const firstReadGate = new Promise<void>((resolve) => {
            releaseFirstRead = resolve
        })
        let readCount = 0
        mocks.getDraftAttachments.mockImplementation(async () => {
            readCount += 1
            if (readCount === 1) {
                await firstReadGate
                return [storedA]
            }
            return [storedA]
        })
        mocks.getRestoredUploadMetadata.mockReturnValue({
            id: 'stored-a',
            path: '/tmp/a',
            uploadSessionId: 'session-inactive',
        })

        const first = persistInactiveComposerAttachments('session-inactive', 'first', [{
            id: 'picked-b',
            file: pickedB,
        }])
        const second = persistInactiveComposerAttachments('session-inactive', 'second', [{
            id: 'picked-c',
            file: pickedC,
        }])
        releaseFirstRead()
        await Promise.all([first, second])

        expect(mocks.saveDraftAttachments.mock.calls.at(-1)?.[1]).toEqual([
            expect.objectContaining({ id: 'stored-a', file: storedA }),
            expect.objectContaining({ id: 'picked-c', file: pickedC }),
        ])
    })

    it('awaits a pending inactive persist before transferComposerDraft reads storage', async () => {
        const storedA = new File(['a'], 'a.txt')
        const pickedB = new File(['b'], 'b.txt')
        let releaseRead!: () => void
        const readGate = new Promise<void>((resolve) => {
            releaseRead = resolve
        })
        mocks.getDraft.mockReturnValue('typed')
        mocks.getDraftAttachments.mockImplementation(async () => {
            await readGate
            return [storedA]
        })
        mocks.getRestoredUploadMetadata.mockImplementation((file: File) => {
            if (file === storedA) {
                return { id: 'stored-a', path: '/tmp/a' }
            }
            return { id: 'picked-b' }
        })

        const persist = persistInactiveComposerAttachments('old-pending', 'typed', [{
            id: 'picked-b',
            file: pickedB,
        }])
        const transfer = transferComposerDraft('old-pending', 'new-pending')
        releaseRead()
        await Promise.all([persist, transfer])

        expect(mocks.saveDraftAttachments).toHaveBeenCalledWith('new-pending', expect.arrayContaining([
            expect.objectContaining({ id: 'stored-a' }),
            expect.objectContaining({ id: 'picked-b' }),
        ]))
    })
})
