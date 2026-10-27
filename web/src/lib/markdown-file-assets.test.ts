import { describe, expect, it } from 'vitest'
import {
    getMarkdownImageMimeType,
    resolveMarkdownFileImage,
    resolveMarkdownFileLink,
} from './markdown-file-assets'

describe('markdown file assets', () => {
    it('resolves sibling links relative to the current Markdown file', () => {
        expect(resolveMarkdownFileLink('notes/notes-01.md', 'error-notes.md')).toEqual({
            kind: 'local',
            path: 'notes/error-notes.md',
        })
    })

    it('resolves nested relative image paths and normalizes dot segments', () => {
        expect(resolveMarkdownFileImage('notes/notes-01.md', './images/../images/page-001.png')).toEqual({
            kind: 'local',
            path: 'notes/images/page-001.png',
        })
    })

    it('rejects paths that escape the session root', () => {
        expect(resolveMarkdownFileLink('notes/notes-01.md', '../../secret.md')).toEqual({
            kind: 'inert',
            href: '../../secret.md',
        })
    })

    it('keeps safe absolute in-workspace-looking paths as local targets', () => {
        expect(resolveMarkdownFileLink('/workspace/notes/notes-01.md', '/workspace/notes/error-notes.md')).toEqual({
            kind: 'local',
            path: '/workspace/notes/error-notes.md',
        })
    })

    it('passes HTTPS images through as remote targets', () => {
        expect(resolveMarkdownFileImage('notes/notes-01.md', 'https://example.com/page.png')).toEqual({
            kind: 'remote',
            href: 'https://example.com/page.png',
        })
    })

    it('keeps anchors and known app routes navigable', () => {
        expect(resolveMarkdownFileLink('notes/notes-01.md', '#section')).toEqual({ kind: 'anchor', href: '#section' })
        expect(resolveMarkdownFileLink('notes/notes-01.md', '/settings')).toEqual({ kind: 'anchor', href: '/settings' })
    })

    it('maps supported image extensions to MIME types', () => {
        expect(getMarkdownImageMimeType('images/page-001.PNG')).toBe('image/png')
        expect(getMarkdownImageMimeType('docs/readme.md')).toBeNull()
    })
})
