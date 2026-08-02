type ShareMessage = {
    id: string
    role: string
    createdAt?: Date
    metadata?: {
        custom?: unknown
    }
}

function isShareTurnUserMessage(message: ShareMessage): boolean {
    if (message.role !== 'user') return false

    const custom = message.metadata?.custom as {
        status?: string
        invokedAt?: number | null
    } | undefined

    return custom?.status !== 'failed' && custom?.invokedAt !== null
}

export function shouldHideShareForRunningTurn(
    messages: readonly ShareMessage[],
    currentMessageId: string,
    threadIsRunning: boolean,
    runningSince = 0
): boolean {
    if (!threadIsRunning) return false

    const currentIndex = messages.findIndex((message) => message.id === currentMessageId)
    if (currentIndex < 0) return false

    const createdAt = messages[currentIndex]?.createdAt?.getTime() ?? 0
    if (runningSince > 0 && createdAt > 0 && createdAt < runningSince) return false

    const activeUserIndex = messages.findLastIndex(isShareTurnUserMessage)
    if (activeUserIndex < 0) return true

    return currentIndex >= activeUserIndex
}
