import { afterEach, describe, expect, it, vi } from 'vitest'
import {
    clearScratchlistAttachmentPreviewCache,
    getScratchlistAttachmentPreview,
    releaseScratchlistAttachmentPreview,
    rememberScratchlistAttachmentObjectUrl,
} from './scratchlistAttachmentPreview'

function attachment(id: string) {
    return {
        id,
        filename: `${id}.png`,
        mimeType: 'image/png',
        size: 1,
        path: `hapi-hub:scratchlist/default/session/${id}.png`,
    }
}

const originalRevokeObjectURL = URL.revokeObjectURL

afterEach(() => {
    clearScratchlistAttachmentPreviewCache()
    vi.restoreAllMocks()
    Object.defineProperty(URL, 'revokeObjectURL', {
        configurable: true,
        value: originalRevokeObjectURL,
    })
})

describe('scratchlist attachment preview cache', () => {
    it('releases an explicitly removed object URL', () => {
        const revoke = vi.fn()
        Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revoke })
        const item = attachment('removed')
        rememberScratchlistAttachmentObjectUrl(item, 'blob:removed')

        releaseScratchlistAttachmentPreview(item.id)

        expect(revoke).toHaveBeenCalledWith('blob:removed')
        expect(getScratchlistAttachmentPreview(item)).toBeUndefined()
    })

    it('bounds the cache and evicts the least recently used preview', () => {
        const revoke = vi.fn()
        Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revoke })
        const first = attachment('first')
        rememberScratchlistAttachmentObjectUrl(first, 'blob:first')
        for (let index = 1; index <= 64; index += 1) {
            const item = attachment(`item-${index}`)
            rememberScratchlistAttachmentObjectUrl(item, `blob:${item.id}`)
        }

        expect(getScratchlistAttachmentPreview(first)).toBeUndefined()
        expect(revoke).toHaveBeenCalledWith('blob:first')
    })
})
