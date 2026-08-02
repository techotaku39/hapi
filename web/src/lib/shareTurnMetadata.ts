import type { SessionHeaderMetadataPreferences } from '@/hooks/useSessionHeaderMetadata'

export type ShareTurnMetadataKey = Exclude<keyof SessionHeaderMetadataPreferences, 'showLabels'>

export type ShareTurnMetadataItem = {
    key: ShareTurnMetadataKey
    text: string
    flavor?: string | null
}

const SESSION_HEADER_METADATA_ORDER: ReadonlyArray<ShareTurnMetadataKey> = [
    'agent',
    'machine',
    'lastActive',
    'model',
    'reasoning',
    'fastMode',
    'createdAt',
    'updatedAt',
    'worktree',
]

export function selectShareTurnMetadata(
    preferences: SessionHeaderMetadataPreferences,
    available: Partial<Record<ShareTurnMetadataKey, Omit<ShareTurnMetadataItem, 'key'>>>
): ShareTurnMetadataItem[] {
    return SESSION_HEADER_METADATA_ORDER.flatMap((key) => {
        const item = available[key]
        return preferences[key] && item?.text ? [{ key, ...item }] : []
    })
}
