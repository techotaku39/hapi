type ShareMessage = {
    id: string
    role: string
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
    threadIsRunning: boolean
): boolean {
    if (!threadIsRunning) return false

    const currentIndex = messages.findIndex((message) => message.id === currentMessageId)
    if (currentIndex < 0) return false

    const activeUserIndex = messages.findLastIndex(isShareTurnUserMessage)
    if (activeUserIndex < 0) return true

    return currentIndex >= activeUserIndex
}
