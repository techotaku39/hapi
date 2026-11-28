import type { Processor } from 'unified'

// Match a drive-qualified path in the current text run, or a drive prefix when
// the escaped backslash is itself the root separator (C:\.config).
const WINDOWS_PATH_PREFIX = /(?:^|[\s'"\p{Ps}\p{Pi}])[A-Za-z]:(?:[\\/][^\s<>:"|?*`]*)?$/u

export default function remarkPreserveWindowsPaths(this: Processor) {
    const extensions = this.data('fromMarkdownExtensions') ?? []
    extensions.push({
        enter: {
            characterEscapeValue(token) {
                // The normal characterEscape handler opens a text node and
                // is about to append only the dot. Restore the separator here
                // without changing the source, token positions or other escapes.
                const text = this.stack.at(-1)
                if (text?.type !== 'text' || this.sliceSerialize(token) !== '.') return

                // Buffered fragments include link destinations, titles and
                // reference labels, where normal Markdown rules still apply.
                if (this.stack.at(-2)?.type === 'fragment') return
                if (WINDOWS_PATH_PREFIX.test(text.value)) text.value += '\\'
            },
        },
    })
    this.data('fromMarkdownExtensions', extensions)
}
