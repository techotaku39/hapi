import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ApiClient } from '@/api/client'
import type { AttachmentMetadata } from '@/types/api'
import { I18nProvider } from '@/lib/i18n-context'
import { MessageAttachments } from './MessageAttachments'

afterEach(() => cleanup())

const attachment: AttachmentMetadata = {
    id: 'attachment-row-1',
    filename: 'photo.png',
    mimeType: 'image/png',
    size: 2 * 1024 * 1024,
    attachmentId: 'attachment-1'
}

function renderAttachments(fetchAttachmentBlob: ApiClient['fetchAttachmentBlob']) {
    const api = { fetchAttachmentBlob } as unknown as ApiClient
    return render(
        <I18nProvider>
            <MessageAttachments attachments={[attachment]} api={api} sessionId="session-1" />
        </I18nProvider>
    )
}

describe('MessageAttachments', () => {
    it('falls back to a file card when thumbnail and original fetches fail', async () => {
        const fetchAttachmentBlob = vi.fn().mockRejectedValue(new Error('attachment unavailable'))

        renderAttachments(fetchAttachmentBlob)

        expect(screen.getByText('Loading preview…')).toBeInTheDocument()
        await waitFor(() => expect(fetchAttachmentBlob).toHaveBeenCalledTimes(2))
        expect(screen.getByText('photo.png')).toBeInTheDocument()
        expect(screen.getByText('2.0 MB')).toBeInTheDocument()
        expect(screen.queryByText('Loading preview…')).not.toBeInTheDocument()
    })
})
