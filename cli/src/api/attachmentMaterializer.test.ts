import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { basename } from 'node:path'

const axiosGet = vi.hoisted(() => vi.fn())

vi.mock('axios', () => ({
    default: {
        get: axiosGet
    }
}))

import { AttachmentMaterializer } from './attachmentMaterializer'

const attachment = {
    id: 'message-attachment-1',
    attachmentId: 'attachment-1',
    filename: 'photo.png',
    mimeType: 'image/png',
    size: 4
}

afterEach(() => {
    axiosGet.mockReset()
})

describe('AttachmentMaterializer', () => {
    it('downloads, validates, caches, and cleans an original', async () => {
        const data = Buffer.from('hub bytes')
        axiosGet.mockResolvedValue({
            data,
            headers: {
                'content-length': String(data.length),
                'x-hapi-attachment-size': String(data.length),
                'x-hapi-attachment-sha256': createHash('sha256').update(data).digest('hex')
            }
        })
        const materializer = new AttachmentMaterializer('session-1', 'token')

        const first = await materializer.materialize(attachment)
        const second = await materializer.materialize(attachment)
        expect(first.path).toBe(second.path)
        expect(first.path).toBeTruthy()
        expect(readFileSync(first.path!)).toEqual(data)
        expect(axiosGet).toHaveBeenCalledTimes(1)

        const path = first.path!
        await materializer.close()
        expect(existsSync(path)).toBe(false)
    })

    it('rejects a hash mismatch without returning a local path', async () => {
        const data = Buffer.from('hub bytes')
        axiosGet.mockResolvedValue({
            data,
            headers: { 'x-hapi-attachment-sha256': 'wrong' }
        })
        const materializer = new AttachmentMaterializer('session-1', 'token')

        await expect(materializer.materialize(attachment)).rejects.toThrow('integrity')
        await materializer.close()
    })

    it('keeps untrusted attachment identifiers inside the session directory', async () => {
        const data = Buffer.from('hub bytes')
        axiosGet.mockResolvedValue({
            data,
            headers: { 'x-hapi-attachment-sha256': createHash('sha256').update(data).digest('hex') }
        })
        const materializer = new AttachmentMaterializer('../session', 'token')

        const result = await materializer.materialize({
            ...attachment,
            attachmentId: '../escape/attachment'
        })
        expect(basename(result.path!)).toBe('.._escape_attachment.png')
        expect(readFileSync(result.path!)).toEqual(data)
        await materializer.close()
    })
})
