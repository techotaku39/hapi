export type SessionHeaderSecondaryMetadataKey =
    | 'model'
    | 'reasoning'
    | 'machine'
    | 'lastActive'
    | 'updatedAt'
    | 'createdAt'
    | 'worktree'
    | 'fastMode'

const MOBILE_SECONDARY_PRIORITY: ReadonlyArray<SessionHeaderSecondaryMetadataKey> = [
    'machine',
    'lastActive',
    'model',
    'reasoning',
    'updatedAt',
    'createdAt',
    'worktree',
    'fastMode',
]

export function selectMobileSessionHeaderSecondary(
    available: Partial<Record<SessionHeaderSecondaryMetadataKey, boolean>>
): SessionHeaderSecondaryMetadataKey | null {
    return MOBILE_SECONDARY_PRIORITY.find((key) => available[key] === true) ?? null
}
