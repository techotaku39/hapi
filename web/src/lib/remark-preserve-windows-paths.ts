import type { Root, RootContent, Text } from 'mdast'
import type { Processor } from 'unified'

// Keep matching scoped to space-free drive paths. The separator after the
// drive may have been consumed by Markdown, so verify it against escape tokens.
const DRIVE_PATH = /(^|[\s=：'"\p{Ps}\p{Pi}])[A-Za-z]:[^\s<>:"|?*`]*/gu
const INVALID_PATH_CHARACTER = /[<>:"|?*`\\]/u

type Escape = { offset: number; dot: boolean }

function restoreDottedPaths(value: string, escapes: Escape[]): string {
    let next = 0
    return value.replace(DRIVE_PATH, (path: string, boundary: string, start: number) => {
        const root = start + boundary.length + 2
        const end = start + path.length
        while (next < escapes.length && escapes[next].offset < root) next++
        const first = next
        let hasDotEscape = false
        while (next < escapes.length && escapes[next].offset < end) {
            hasDotEscape ||= escapes[next].dot
            next++
        }
        const rootCharacter = value[root]
        if (!hasDotEscape || (rootCharacter !== '\\' && rootCharacter !== '/' && escapes[first]?.offset !== root)) {
            return path
        }

        const parts: string[] = []
        let cursor = start
        for (let i = first; i < next; i++) {
            const offset = escapes[i].offset
            parts.push(value.slice(cursor, offset), '\\')
            cursor = offset
        }
        parts.push(value.slice(cursor, end))
        return parts.join('')
    })
}

export default function remarkPreserveWindowsPaths(this: Processor) {
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
            function visit(node: Root | RootContent): void {
                if (node.type === 'text') {
                    const escapes = pathEscapes.get(node)
                    if (escapes?.some((escape) => escape.dot)) {
                        node.value = restoreDottedPaths(node.value, escapes)
                    }
                } else if ('children' in node) {
                    for (const child of node.children) visit(child)
                }
            }
            visit(tree)
        }],
    })
    this.data('fromMarkdownExtensions', extensions)
}
