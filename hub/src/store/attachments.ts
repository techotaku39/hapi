import { createHash, randomUUID } from 'node:crypto'
import {
    chmodSync,
    existsSync,
    mkdirSync,
    readFileSync,
    renameSync,
    rmSync,
    writeFileSync
} from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import type { Database } from 'bun:sqlite'

export const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024
export const MAX_ATTACHMENT_THUMBNAIL_BYTES = 4 * 1024 * 1024

export type StoredAttachment = {
    id: string
    namespace: string
    sessionId: string
    filename: string
    mimeType: string
    size: number
    sha256: string
    originalPath: string
    thumbnailPath: string | null
    thumbnailMimeType: string | null
    thumbnailSize: number | null
    createdAt: number
}

export type AttachmentBlob = {
    attachment: StoredAttachment
    variant: 'original' | 'thumbnail'
    data: Buffer
    mimeType: string
    size: number
    sha256: string
}

export type CreateAttachmentInput = {
    namespace: string
    sessionId: string
    filename: string
    mimeType: string
    original: Buffer
    thumbnail?: Buffer
    thumbnailMimeType?: string
}

type AttachmentRow = {
    id: string
    namespace: string
    session_id: string
    filename: string
    mime_type: string
    size: number
    sha256: string
    original_path: string
    thumbnail_path: string | null
    thumbnail_mime_type: string | null
    thumbnail_size: number | null
    created_at: number
}

const sanitizeFilename = (filename: string): string => {
    const normalized = basename(filename)
        .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
        .trim()
    return (normalized || 'attachment').slice(0, 255)
}

const hashBytes = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex')

const defaultAttachmentRoot = (): string => {
    const hapiHome = process.env.HAPI_HOME || join(homedir(), '.hapi')
    return process.env.HAPI_ATTACHMENTS_ROOT || join(hapiHome, 'attachments')
}

export class AttachmentStore {
    private readonly root: string

    constructor(private readonly db: Database, root = defaultAttachmentRoot()) {
        this.root = resolve(root)
    }

    create(input: CreateAttachmentInput): StoredAttachment {
        if (input.original.length === 0 || input.original.length > MAX_ATTACHMENT_BYTES) {
            throw new Error('Attachment exceeds the maximum allowed size')
        }
        const id = randomUUID()
        const createdAt = Date.now()
        const filename = sanitizeFilename(input.filename)
        const sha256 = hashBytes(input.original)
        const originalPath = join(this.root, `${id}.original`)
        let thumbnailPath: string | null = null
        let thumbnailMimeType: string | null = null
        let thumbnailSize: number | null = null

        if (input.thumbnail
            && input.thumbnail.length > 0
            && input.thumbnail.length <= MAX_ATTACHMENT_THUMBNAIL_BYTES
            && input.thumbnailMimeType?.startsWith('image/')) {
            thumbnailPath = join(this.root, `${id}.thumbnail`)
            thumbnailMimeType = input.thumbnailMimeType
            thumbnailSize = input.thumbnail.length
        }

        mkdirSync(this.root, { recursive: true, mode: 0o700 })
        try {
            chmodSync(this.root, 0o700)
        } catch {
        }

        try {
            this.writeAtomically(originalPath, input.original)
            if (thumbnailPath && input.thumbnail) {
                this.writeAtomically(thumbnailPath, input.thumbnail)
            }

            this.db.prepare(`
                INSERT INTO attachments (
                    id, namespace, session_id, filename, mime_type, size,
                    sha256, original_path, thumbnail_path, thumbnail_mime_type,
                    thumbnail_size, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                id,
                input.namespace,
                input.sessionId,
                filename,
                input.mimeType,
                input.original.length,
                sha256,
                originalPath,
                thumbnailPath,
                thumbnailMimeType,
                thumbnailSize,
                createdAt
            )
        } catch (error) {
            rmSync(originalPath, { force: true })
            if (thumbnailPath) rmSync(thumbnailPath, { force: true })
            throw error
        }

        return {
            id,
            namespace: input.namespace,
            sessionId: input.sessionId,
            filename,
            mimeType: input.mimeType,
            size: input.original.length,
            sha256,
            originalPath,
            thumbnailPath,
            thumbnailMimeType,
            thumbnailSize,
            createdAt
        }
    }

    getForSession(id: string, namespace: string, sessionId: string): StoredAttachment | null {
        const row = this.db.prepare(`
            SELECT id, namespace, session_id, filename, mime_type, size,
                   sha256, original_path, thumbnail_path, thumbnail_mime_type,
                   thumbnail_size, created_at
            FROM attachments
            WHERE id = ? AND namespace = ? AND session_id = ?
        `).get(id, namespace, sessionId) as AttachmentRow | null | undefined
        return row ? this.toStoredAttachment(row) : null
    }

    readForSession(
        id: string,
        namespace: string,
        sessionId: string,
        variant: 'original' | 'thumbnail'
    ): AttachmentBlob | null {
        const attachment = this.getForSession(id, namespace, sessionId)
        if (!attachment) return null
        const path = variant === 'original' ? attachment.originalPath : attachment.thumbnailPath
        if (!path || !existsSync(path)) return null
        const data = readFileSync(path)
        return {
            attachment,
            variant,
            data,
            mimeType: variant === 'original'
                ? attachment.mimeType
                : (attachment.thumbnailMimeType || attachment.mimeType),
            size: data.length,
            sha256: variant === 'original' ? attachment.sha256 : hashBytes(data)
        }
    }

    deleteForSession(id: string, namespace: string, sessionId: string): boolean {
        const attachment = this.getForSession(id, namespace, sessionId)
        if (!attachment) return false
        this.db.prepare('DELETE FROM attachments WHERE id = ?').run(id)
        rmSync(attachment.originalPath, { force: true })
        if (attachment.thumbnailPath) rmSync(attachment.thumbnailPath, { force: true })
        return true
    }

    transferSession(namespace: string, fromSessionId: string, toSessionId: string): number {
        if (fromSessionId === toSessionId) return 0
        const result = this.db.prepare(`
            UPDATE attachments
            SET session_id = ?
            WHERE namespace = ? AND session_id = ?
        `).run(toSessionId, namespace, fromSessionId)
        return Number(result.changes)
    }

    deleteAllForSession(namespace: string, sessionId: string): number {
        const attachments = this.db.prepare(`
            SELECT id, namespace, session_id, filename, mime_type, size,
                   sha256, original_path, thumbnail_path, thumbnail_mime_type,
                   thumbnail_size, created_at
            FROM attachments
            WHERE namespace = ? AND session_id = ?
        `).all(namespace, sessionId) as AttachmentRow[]
        if (attachments.length === 0) return 0

        const result = this.db.prepare(
            'DELETE FROM attachments WHERE namespace = ? AND session_id = ?'
        ).run(namespace, sessionId)
        for (const row of attachments) {
            rmSync(row.original_path, { force: true })
            if (row.thumbnail_path) rmSync(row.thumbnail_path, { force: true })
        }
        return Number(result.changes)
    }

    private writeAtomically(target: string, data: Buffer): void {
        const temp = join(dirname(target), `.${basename(target)}.${randomUUID()}.tmp`)
        try {
            writeFileSync(temp, data, { mode: 0o600, flag: 'wx' })
            renameSync(temp, target)
        } finally {
            rmSync(temp, { force: true })
        }
    }

    private toStoredAttachment(row: AttachmentRow): StoredAttachment {
        return {
            id: row.id,
            namespace: row.namespace,
            sessionId: row.session_id,
            filename: row.filename,
            mimeType: row.mime_type,
            size: row.size,
            sha256: row.sha256,
            originalPath: row.original_path,
            thumbnailPath: row.thumbnail_path,
            thumbnailMimeType: row.thumbnail_mime_type,
            thumbnailSize: row.thumbnail_size,
            createdAt: row.created_at
        }
    }
}
