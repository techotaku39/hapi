const REGEXP_SPECIAL_CHARACTERS = new Set(['\\', '^', '$', '+', '.', '(', ')', '|', '{', '}', '[', ']'])

/** Whether a search query should be interpreted as a wildcard pattern. */
export function isWildcardSearch(query: string): boolean {
    return query.includes('*') || query.includes('?')
}

function escapeRegExpCharacter(character: string): string {
    return REGEXP_SPECIAL_CHARACTERS.has(character) ? `\\${character}` : character
}

/**
 * Convert the supported wildcard syntax into an anchored, case-insensitive matcher.
 * `*` matches zero or more characters and `?` matches exactly one character.
 */
export function wildcardToRegExp(pattern: string): RegExp {
    let source = '^'
    for (const character of pattern) {
        if (character === '*') {
            source += '[\\s\\S]*'
        } else if (character === '?') {
            source += '[\\s\\S]'
        } else {
            source += escapeRegExpCharacter(character)
        }
    }
    return new RegExp(`${source}$`, 'i')
}

/** Match a value using the existing substring behavior or supported wildcards. */
export function matchesSearchQuery(value: string, query: string): boolean {
    const normalizedQuery = query.trim()
    if (!normalizedQuery) return true

    if (!isWildcardSearch(normalizedQuery)) {
        return value.toLowerCase().includes(normalizedQuery.toLowerCase())
    }

    return wildcardToRegExp(normalizedQuery).test(value)
}

/** Build the ripgrep Glob used by file search while preserving plain-text behavior. */
export function toSearchGlob(query: string): string {
    const normalizedQuery = query.trim()
    return isWildcardSearch(normalizedQuery) ? normalizedQuery : `*${normalizedQuery}*`
}
