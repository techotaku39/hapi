import type { ApiSessionClient } from '@/api/apiSession'
import type { Metadata } from '@/api/types'

type SessionTitleClient = Pick<ApiSessionClient, 'updateMetadata'>

/** A Fork seed is a provisional title until the child agent names itself. */
export function isForkSeedSummary(metadata: Readonly<Metadata> | null | undefined): boolean {
    const summary = metadata?.summary?.text.trim()
    return Boolean(metadata?.forkedFrom?.trim() && summary?.startsWith('Fork: '))
}

/**
 * Apply an agent-generated title without replacing a user-owned or settled
 * title. Fork summaries are the one existing title intentionally eligible for
 * replacement.
 */
export function applySessionTitleSummary(client: SessionTitleClient, title: string): boolean {
    const normalizedTitle = title.trim()
    if (!normalizedTitle) return false

    client.updateMetadata((metadata) => {
        if (metadata.name?.trim()) return metadata

        const summary = metadata.summary?.text.trim()
        if (summary && !isForkSeedSummary(metadata)) return metadata

        return {
            ...metadata,
            summary: {
                text: normalizedTitle,
                updatedAt: Date.now()
            }
        }
    })
    return true
}
