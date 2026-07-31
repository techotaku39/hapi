/** Labels shared by SessionHeader and composer StatusBar for Codex/OpenCode. */

export function formatCodexReasoningLabel(effort?: string | null, showLabel = true): string {
    const normalized = effort?.trim().toLowerCase()
    const value = !normalized || normalized === 'default' ? 'default' : normalized
    return showLabel ? `reasoning ${value}` : value
}

export function shouldShowCodexReasoningLabel(agentFlavor: string | null | undefined): boolean {
    return agentFlavor === 'codex' || agentFlavor === 'opencode'
}
