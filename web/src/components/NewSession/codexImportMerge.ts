export function resolveCodexImportRedirectSessionId(
    merged: ReadonlyArray<{ canonicalSessionId?: string | null }>,
    importedHapiSessionIds: readonly string[]
): string | null {
    return merged.find((group) => Boolean(group.canonicalSessionId))?.canonicalSessionId
        ?? importedHapiSessionIds[0]
        ?? null
}
