import type { Text } from 'mdast'
import type { Processor } from 'unified'

// Match a drive-qualified path in the current text run, or a drive prefix when
// the escaped backslash is itself the root separator (C:\.config). Allow `=` so
// an unquoted option value such as --path=C:\work\.config is treated the same.
const WINDOWS_PATH_PREFIX = /(?:^|[\s='"\p{Ps}\p{Pi}])[A-Za-z]:(?:[\\/][^\s<>:"|?*`]*)?$/u

export default function remarkPreserveWindowsPaths(this: Processor) {
    const escapedRootSeparators = new WeakMap<Text, number>()
    const extensions = this.data('fromMarkdownExtensions') ?? []
    extensions.push({
        enter: {
            characterEscapeValue(token) {
                // The normal characterEscape handler opens a text node and
                // appends only the escaped character. Preserve separators
                // without changing the source or token positions.
                const text = this.stack.at(-1)
                if (text?.type !== 'text') return

                // Buffered fragments include link destinations, titles and
                // reference labels, where normal Markdown rules still apply.
                if (this.stack.at(-2)?.type === 'fragment') return
                const escaped = this.sliceSerialize(token)
                if (escaped !== '.') {
                    // Record an actual escaped root separator before valid path
                    // punctuation (D:\_work), not a literal drive-relative D:_work.
                    // Only restore it when a later dot escape is in the same path.
                    if (escaped !== '\\' && text.value.endsWith(':') && WINDOWS_PATH_PREFIX.test(`${text.value}\\${escaped}`)) {
                        escapedRootSeparators.set(text, text.value.length)
                    }
                    return
                }
                if (WINDOWS_PATH_PREFIX.test(text.value)) {
                    text.value += '\\'
                    return
                }
                const offset = escapedRootSeparators.get(text)
                if (offset === undefined) return
                const prefix = `${text.value.slice(0, offset)}\\${text.value.slice(offset)}`
                if (WINDOWS_PATH_PREFIX.test(prefix)) {
                    text.value = prefix + '\\'
                    escapedRootSeparators.delete(text)
                }
            },
        },
    })
    this.data('fromMarkdownExtensions', extensions)
}
