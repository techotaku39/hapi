import type { Processor } from 'unified'
import { repairMarkdownTables } from './remark-repair-tables'

interface MarkdownNode {
    type: string
    value?: string
    children?: MarkdownNode[]
    data?: unknown
}

interface MarkdownFile {
    value?: unknown
}

type MathKind = 'display' | 'inline'

const OPAQUE_NODE_TYPES = new Set([
    'code',
    'inlineCode',
    'math',
    'inlineMath',
    'link',
    'linkReference',
    'html',
])

function isUnescapedDelimiter(source: string, offset: number): boolean {
    // An odd run of backslashes before the delimiter escapes the final
    // backslash. An even run leaves the delimiter backslash unescaped, which
    // also keeps a TeX line break immediately before `\\]` usable.
    let precedingBackslashes = 0
    for (let index = offset - 1; index >= 0 && source[index] === '\\'; index--) {
        precedingBackslashes++
    }
    return precedingBackslashes % 2 === 0
}

interface BracketMathMatch {
    end: number
    kind: MathKind
    start: number
    value: string
}

type ProtectedMask = boolean[]

interface BracketMathPlaceholder extends BracketMathMatch {
    placeholder: string
    raw: string
    token: string
}

type PlaceholderMap = Map<string, BracketMathPlaceholder>

function markProtectedRange(mask: ProtectedMask, start: number, end: number): void {
    for (let index = start; index < end; index++) mask[index] = true
}

function findLineEnd(source: string, start: number): number {
    const newline = source.indexOf('\n', start)
    return newline < 0 ? source.length : newline + 1
}

function isFenceLine(line: string): { char: '`' | '~'; length: number; rest: string } | null {
    const match = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/)
    if (!match) return null
    return {
        char: match[1][0] as '`' | '~',
        length: match[1].length,
        rest: match[2],
    }
}

function markInlineCodeSpans(source: string, start: number, end: number, mask: ProtectedMask): void {
    let cursor = start
    while (cursor < end) {
        if (source[cursor] !== '`' || !isUnescapedDelimiter(source, cursor)) {
            cursor++
            continue
        }

        const runStart = cursor
        while (cursor < end && source[cursor] === '`') cursor++
        const delimiter = source.slice(runStart, cursor)
        let closing = source.indexOf(delimiter, cursor)
        while (closing >= 0 && closing < end) {
            const before = closing > start ? source[closing - 1] : ''
            const after = source[closing + delimiter.length] ?? ''
            if (before !== '`' && after !== '`') break
            closing = source.indexOf(delimiter, closing + 1)
        }
        if (closing < 0 || closing >= end) continue

        markProtectedRange(mask, runStart, closing + delimiter.length)
        cursor = closing + delimiter.length
    }
}

function getProtectedMarkdownRanges(source: string): ProtectedMask {
    const mask = Array<boolean>(source.length).fill(false)
    let fenceChar: '`' | '~' | null = null
    let fenceLength = 0
    let lineStart = 0

    while (lineStart < source.length) {
        const lineEnd = findLineEnd(source, lineStart)
        const contentEnd = lineEnd > lineStart && source[lineEnd - 1] === '\n'
            ? lineEnd - 1
            : lineEnd
        const line = source.slice(lineStart, contentEnd).replace(/\r$/, '')
        const fence = isFenceLine(line)

        if (fenceChar !== null) {
            markProtectedRange(mask, lineStart, lineEnd)
            if (fence && fence.char === fenceChar && fence.length >= fenceLength && /^\s*$/.test(fence.rest)) {
                fenceChar = null
                fenceLength = 0
            }
        } else if (fence) {
            markProtectedRange(mask, lineStart, lineEnd)
            fenceChar = fence.char
            fenceLength = fence.length
        } else {
            markInlineCodeSpans(source, lineStart, contentEnd, mask)
        }

        lineStart = lineEnd
    }

    return mask
}

function isProtected(mask: ProtectedMask, start: number, length: number): boolean {
    for (let index = start; index < start + length; index++) {
        if (mask[index]) return true
    }
    return false
}

function findNextDelimiter(source: string, delimiter: string, from: number, mask: ProtectedMask): number {
    let offset = source.indexOf(delimiter, from)
    while (offset >= 0 && (isProtected(mask, offset, delimiter.length) || !isUnescapedDelimiter(source, offset))) {
        offset = source.indexOf(delimiter, offset + 1)
    }
    return offset
}

function findBracketMathMatches(source: string, mask: ProtectedMask): BracketMathMatch[] {
    const matches: BracketMathMatch[] = []
    let cursor = 0

    while (cursor < source.length) {
        const displayStart = findNextDelimiter(source, '\\[', cursor, mask)
        const inlineStart = findNextDelimiter(source, '\\(', cursor, mask)

        let start = -1
        let kind: MathKind | null = null
        if (displayStart >= 0 && (inlineStart < 0 || displayStart < inlineStart)) {
            start = displayStart
            kind = 'display'
        } else if (inlineStart >= 0) {
            start = inlineStart
            kind = 'inline'
        }

        if (start < 0 || kind === null) break

        const openingLength = 2
        const closingDelimiter = kind === 'display' ? '\\]' : '\\)'
        const closingStart = findNextDelimiter(source, closingDelimiter, start + openingLength, mask)
        if (closingStart < 0) {
            cursor = start + openingLength
            continue
        }

        const value = source.slice(start + openingLength, closingStart).trim()
        if (value.length > 0) {
            matches.push({
                end: closingStart + closingDelimiter.length,
                kind,
                start,
                value,
            })
            cursor = closingStart + closingDelimiter.length
        } else {
            cursor = closingStart + closingDelimiter.length
        }
    }

    return matches
}

function createMathNode(kind: MathKind, value: string): MarkdownNode {
    if (kind === 'display') {
        return {
            type: 'math',
            value,
            data: {
                hName: 'pre',
                hChildren: [{
                    type: 'element',
                    tagName: 'code',
                    properties: { className: ['language-math', 'math-display'] },
                    children: [{ type: 'text', value }],
                }],
            },
        }
    }

    return {
        type: 'inlineMath',
        value,
        data: {
            hName: 'code',
            hProperties: { className: ['language-math', 'math-inline'] },
            hChildren: [{ type: 'text', value }],
        },
    }
}

function findUnusedPlaceholderToken(source: string, start: number): string {
    for (let codePoint = start; codePoint <= 0xF8FF; codePoint++) {
        const token = String.fromCharCode(codePoint)
        if (!source.includes(token)) return token
    }
    throw new Error('Unable to allocate a LaTeX placeholder token')
}

function makePlaceholder(source: string, match: BracketMathMatch, token: string): string {
    return Array.from(source.slice(match.start, match.end), (character) => (
        character === '\r' || character === '\n' ? character : token
    )).join('')
}

function prepareBracketMathSource(source: string): { source: string; placeholders: PlaceholderMap } | null {
    const matches = findBracketMathMatches(source, getProtectedMarkdownRanges(source))
    if (matches.length === 0) return null

    const placeholders: PlaceholderMap = new Map()
    const chunks: string[] = []
    let cursor = 0
    let nextToken = 0xE000
    for (const match of matches) {
        const token = findUnusedPlaceholderToken(source, nextToken)
        nextToken = token.charCodeAt(0) + 1
        const placeholder = makePlaceholder(source, match, token)
        placeholders.set(token, { ...match, placeholder, raw: source.slice(match.start, match.end), token })
        chunks.push(source.slice(cursor, match.start), placeholder)
        cursor = match.end
    }
    chunks.push(source.slice(cursor))

    return { source: chunks.join(''), placeholders }
}

function matchesPlaceholderAt(value: string, offset: number, placeholder: string): number | null {
    let valueOffset = offset
    for (let placeholderOffset = 0; placeholderOffset < placeholder.length; placeholderOffset++) {
        const character = placeholder[placeholderOffset]
        if (character === '\r' && placeholder[placeholderOffset + 1] === '\n') continue
        if (character === '\n') {
            if (value[valueOffset] === '\r') valueOffset++
            if (value[valueOffset] !== '\n') return null
        } else if (value[valueOffset] !== character) {
            return null
        }
        valueOffset++
    }
    return valueOffset
}

function findNextPlaceholder(value: string, from: number, placeholders: PlaceholderMap): {
    end: number
    entry: BracketMathPlaceholder
    start: number
} | null {
    for (let offset = from; offset < value.length; offset++) {
        const entry = placeholders.get(value[offset])
        if (!entry) continue
        const end = matchesPlaceholderAt(value, offset, entry.placeholder)
        if (end !== null) return { end, entry, start: offset }
    }
    return null
}

function restorePlaceholders(value: string, placeholders: PlaceholderMap): string {
    const parts: string[] = []
    let cursor = 0
    while (true) {
        const next = findNextPlaceholder(value, cursor, placeholders)
        if (!next) {
            parts.push(value.slice(cursor))
            return parts.join('')
        }
        parts.push(value.slice(cursor, next.start), next.entry.raw)
        cursor = next.end
    }
}

function splitTextNode(node: MarkdownNode, placeholders: PlaceholderMap): MarkdownNode[] {
    const value = node.value
    if (typeof value !== 'string') return [node]

    const children: MarkdownNode[] = []
    let cursor = 0
    let found = false
    while (true) {
        const next = findNextPlaceholder(value, cursor, placeholders)
        if (!next) break
        found = true
        if (next.start > cursor) children.push({ type: 'text', value: value.slice(cursor, next.start) })
        children.push(createMathNode(next.entry.kind, next.entry.value))
        cursor = next.end
    }
    if (!found) return [node]
    if (cursor < value.length) children.push({ type: 'text', value: value.slice(cursor) })
    return children
}

function splitParagraphAroundDisplayMath(node: MarkdownNode): MarkdownNode[] | null {
    const children = node.children ?? []
    if (!children.some((child) => child.type === 'math')) return null

    const blocks: MarkdownNode[] = []
    let paragraphChildren: MarkdownNode[] = []

    const flushParagraph = () => {
        const hasContent = paragraphChildren.some((child) => (
            child.type !== 'text' || (child.value ?? '').trim().length > 0
        ))
        if (hasContent) blocks.push({ type: 'paragraph', children: paragraphChildren })
        paragraphChildren = []
    }

    for (const child of children) {
        if (child.type === 'math') {
            flushParagraph()
            blocks.push(child)
        } else {
            paragraphChildren.push(child)
        }
    }
    flushParagraph()

    return blocks
}

function transformContainer(node: MarkdownNode, placeholders: PlaceholderMap): void {
    if (!node.children) return

    const children: MarkdownNode[] = []
    for (const child of node.children) {
        if (OPAQUE_NODE_TYPES.has(child.type)) {
            if (child.children) restorePlaceholdersInContainer(child, placeholders)
            children.push(child)
            continue
        }

        if (child.type === 'text') {
            children.push(...splitTextNode(child, placeholders))
            continue
        }

        transformContainer(child, placeholders)
        const splitParagraph = child.type === 'paragraph'
            ? splitParagraphAroundDisplayMath(child)
            : null
        children.push(...(splitParagraph ?? [child]))
    }
    node.children = children
}

function restorePlaceholdersInContainer(node: MarkdownNode, placeholders: PlaceholderMap): void {
    if (!node.children) return
    for (const child of node.children) {
        if (child.type === 'text' && typeof child.value === 'string') {
            child.value = restorePlaceholders(child.value, placeholders)
        } else {
            restorePlaceholdersInContainer(child, placeholders)
        }
    }
}

/** Convert TeX bracket delimiters before Markdown escape handling loses them. */
export default function remarkLatexBracketMath(this: Processor) {
    const processor = this
    return (tree: MarkdownNode, file: MarkdownFile): void => {
        if (typeof file.value !== 'string') return

        // Markdown parses `K^*` as emphasis and a line containing only `=` as
        // a setext heading before a normal transformer can inspect the source.
        // Replace each bracket-delimited formula with an equal-length private
        // use token, parse the safe source, then restore the formula as an AST
        // math node. Equal lengths keep positions usable by later plugins.
        const prepared = prepareBracketMathSource(repairMarkdownTables(file.value))
        if (!prepared) return

        const reparsedTree = processor.parse(prepared.source) as MarkdownNode
        transformContainer(reparsedTree, prepared.placeholders)
        Object.assign(tree, reparsedTree)
    }
}
