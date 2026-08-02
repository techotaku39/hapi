type ShareMessage = {
    id: string
    role: string
}

export function shouldHideShareForRunningTurn(
    messages: readonly ShareMessage[],
    currentMessageId: string,
    threadIsRunning: boolean
): boolean {
    if (!threadIsRunning) return false

    const currentIndex = messages.findIndex((message) => message.id === currentMessageId)
    if (currentIndex < 0) return false

    const activeUserIndex = messages.findLastIndex((message) => message.role === 'user')
    if (activeUserIndex >= 0) return currentIndex >= activeUserIndex

    return currentIndex === messages.length - 1
}
