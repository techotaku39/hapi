import type { Literal, Root, RootContent, Text } from 'mdast'
import type { Processor } from 'unified'
import { matchNonHttpsUris } from './remark-non-https-autolink'

// Keep matching scoped to space-free drive paths. The separator after the
// drive may have been consumed by Markdown, so verify it against escape tokens.
const DRIVE_PATH = /(^|[\s=:：'"\p{Ps}\p{Pi}])[A-Za-z]:[^\s<>:"|?*`]*(?::[^\s<>"|?*`]*)?/gu
const INVALID_PATH_CHARACTER = /[<>:"|?*`\\]/u

// Keep a restored path together through Markdown transforms such as line
// breaks, so the file autolinker can accept or reject it as a whole.
export const RESTORED_WINDOWS_PATH = 'restoredWindowsPath'

interface RestoredWindowsPath extends Literal {
    type: typeof RESTORED_WINDOWS_PATH
    allowAutolink: boolean
}

declare module 'mdast' {
    interface RootContentMap {
        restoredWindowsPath: RestoredWindowsPath
    }
    interface PhrasingContentMap {
        restoredWindowsPath: RestoredWindowsPath
    }
}

const CLOSING_QUOTE = new Map([
    ['"', '"'], ["'", "'"], ['“', '”'], ['‘', '’'], ['«', '»'], ['‹', '›'],
])

const CLOSING_WRAPPER = new Map([
    ['(', ')'], ['[', ']'], ['{', '}'], ["'", "'"],
    ['（', '）'], ['［', '］'], ['｛', '｝'], ['｟', '｠'],
    ['【', '】'], ['〈', '〉'], ['《', '》'], ['〔', '〕'], ['〖', '〗'],
    ['〘', '〙'], ['〚', '〛'], ['「', '」'], ['『', '』'], ['｢', '｣'],
    ['“', '”'], ['‘', '’'], ['«', '»'], ['‹', '›'],
])

const parseStops = new WeakMap<Processor, ReadonlyMap<string, unknown>>()

/** Keep the actual bracket-math tokens intact during its synchronous reparse. */
export function parseWithWindowsPathStops(
    processor: Processor,
    source: string,
    stops: ReadonlyMap<string, unknown>,
): ReturnType<Processor['parse']> {
    parseStops.set(processor, stops)
    try {
        return processor.parse(source)
    } finally {
        parseStops.delete(processor)
    }
}

function pathEnd(value: string, start: number, end: number, opening: string, stops?: ReadonlyMap<string, unknown>): number {
    const closing = CLOSING_WRAPPER.get(opening)
    if (!closing && !stops) return end
    let depth = 1
    for (let i = start; i < end; i++) {
        const ch = value[i]
        if (stops?.has(ch)) return i
        if (closing) {
            if (ch === closing && --depth === 0) return i
            if (ch === opening && opening !== closing) depth++
        }
    }
    return end
}

type Escape = { offset: number; dot: boolean }

function restoreDottedPaths(value: string, escapes: Escape[], stops?: ReadonlyMap<string, unknown>): RootContent[] {
    const parts: RootContent[] = []
    const drivePaths = new RegExp(DRIVE_PATH)
    const uriMatches = matchNonHttpsUris(value)
    let uri = uriMatches.next().value
    let next = 0
    let lastEnd = 0
    let match: RegExpExecArray | null
    while ((match = drivePaths.exec(value)) !== null) {
        const boundary = match[1]
        const start = match.index + boundary.length
        const root = start + 2
        // A closing quote after whitespace makes this a spaced path, which
        // we do not restore. Do not hand its first word to the file linker.
        const quote = CLOSING_QUOTE.get(boundary)
        if (quote) {
            const close = value.indexOf(quote, root)
            const quoted = close < 0 ? '' : value.slice(root, close)
            if (/[^\S\r\n]/.test(quoted) && !/[\r\n]/.test(quoted)) {
                drivePaths.lastIndex = close + 1
                continue
            }
        }
        // Do not split a bare URI (e.g. a path inside a custom URI query).
        while (uri && (uri.index ?? 0) + uri[0].length <= start) uri = uriMatches.next().value
        if (uri && (uri.index ?? 0) <= start) {
            drivePaths.lastIndex = (uri.index ?? 0) + uri[0].length
            continue
        }
        const matchEnd = Math.min(match.index + match[0].length, uri?.index ?? value.length)
        const end = pathEnd(value, root, matchEnd, boundary, stops)
        // A closing wrapper or math token can end the path before the regex
        // match does. Resume there so adjacent paths are considered too.
        drivePaths.lastIndex = end
        while (next < escapes.length && escapes[next].offset < root) next++
        const first = next
        let hasDotEscape = false
        while (next < escapes.length && escapes[next].offset < end) {
            hasDotEscape ||= escapes[next].dot
            next++
        }
        const rootCharacter = value[root]
        if (!hasDotEscape || (rootCharacter !== '\\' && rootCharacter !== '/' && escapes[first]?.offset !== root)) {
            continue
        }

        const path: string[] = []
        let cursor = start
        for (let i = first; i < next; i++) {
            const offset = escapes[i].offset
            path.push(value.slice(cursor, offset), '\\')
            cursor = offset
        }
        path.push(value.slice(cursor, end))
        if (start > lastEnd) parts.push({ type: 'text', value: value.slice(lastEnd, start) })
        // Preserve the autolinker's existing rejection after an ASCII colon.
        parts.push({ type: RESTORED_WINDOWS_PATH, value: path.join(''), allowAutolink: boundary !== ':' })
        lastEnd = end
    }
    if (parts.length && lastEnd < value.length) parts.push({ type: 'text', value: value.slice(lastEnd) })
    return parts
}

export default function remarkPreserveWindowsPaths(this: Processor) {
    const processor = this
    const pathEscapes = new WeakMap<Text, Escape[]>()
    const extensions = this.data('fromMarkdownExtensions') ?? []
    // Restore the spelling before other transforms can turn parts of the text
    // into links. Only text with an actual dot escape in the same path changes.
    extensions.unshift({
        enter: {
            characterEscapeValue(token) {
                // Markdown already opened the text node but hasn't appended
                // the escaped character. Record the position of its separator.
                const text = this.stack.at(-1)
                if (text?.type !== 'text' || this.stack.at(-2)?.type === 'fragment') return
                const character = this.sliceSerialize(token)
                if (INVALID_PATH_CHARACTER.test(character)) return
                let escapes = pathEscapes.get(text)
                if (!escapes) pathEscapes.set(text, escapes = [])
                escapes.push({ offset: text.value.length, dot: character === '.' })
            },
        },
        transforms: [function restoreText(tree: Root) {
            const stops = parseStops.get(processor)
            function visit(node: Root | RootContent): void {
                if (!('children' in node) || node.type === 'link' || node.type === 'linkReference') return
                const children: RootContent[] = node.children
                const updated: RootContent[] = []
                for (const child of children) {
                    if (child.type === 'text') {
                        const escapes = pathEscapes.get(child)
                        if (escapes?.some((escape) => escape.dot)) {
                            const parts = restoreDottedPaths(child.value, escapes, stops)
                            if (parts.length) {
                                updated.push(...parts)
                                continue
                            }
                        }
                    } else {
                        visit(child)
                    }
                    updated.push(child)
                }
                // All replacements have the same phrasing position as the text
                // node they replace; no block or table structure is changed.
                if (updated.length !== children.length || updated.some((child, i) => child !== children[i])) {
                    node.children = updated as typeof node.children
                }
            }
            visit(tree)
        }],
    })
    this.data('fromMarkdownExtensions', extensions)
}
