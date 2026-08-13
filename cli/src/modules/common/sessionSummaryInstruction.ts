/**
 * Optional session-status summary instruction for non-Cursor agent flavors.
 *
 * Cursor ACP has no system-prompt / rules-overlay seam in upstream today, so
 * it is intentionally not covered here. Claude / Codex / OpenCode / Grok get
 * this text via their existing system-prompt / developer-instructions /
 * one-shot instruction paths when the operator opts in.
 *
 * The contract toggle remains opt-in. The locale is applied independently by
 * the Hub session bootstrap and defaults to English for backward compatibility.
 */

import type { SupportedLocale } from '@hapi/protocol'

let hubPreference: boolean | undefined
let hubLocale: SupportedLocale = 'en'

/** Apply the hub-resolved toggle from session create/get bootstrap. */
export function applyHubSessionSummaryContract(enabled: boolean): void {
    hubPreference = enabled
}

/** Apply the namespace-scoped UI locale from session create/get bootstrap. */
export function applyHubSessionSummaryLocale(locale: SupportedLocale): void {
    hubLocale = locale
}

/** Test-only: clear hub preference between cases. */
export function resetSessionSummaryContractForTests(): void {
    hubPreference = undefined
    hubLocale = 'en'
}

export function isSessionSummaryContractEnabled(
    env: NodeJS.ProcessEnv = process.env
): boolean {
    const raw = env.HAPI_SESSION_SUMMARY_CONTRACT
    if (raw !== undefined && raw !== '') {
        const normalized = raw.trim().toLowerCase()
        return !(normalized === '0' || normalized === 'false' || normalized === 'off' || normalized === 'no')
    }
    return hubPreference === true
}

/**
 * Canonical trailing-line contract. Matches the FCM / native-companion parser
 * in `@hapi/protocol` (`extractNotifySummary`).
 */
export const SESSION_SUMMARY_CONTRACT_LINE =
    'AGENT_NOTIFY_SUMMARY {"version":1,"agent":"<agent-id>","project":"<project>","status":"done|blocked|needs_review|needs_decision|failed|stalled","action":"<=12 words","summary":"one-line triage"}'

/**
 * Body appended to flavor system / developer instructions when enabled.
 * Keep short — rides every session's prompt budget.
 */
export function buildSessionSummaryInstruction(locale: SupportedLocale = hubLocale): string {
    if (locale === 'zh-CN') {
        return [
            '会话状态摘要：',
            '每次回复都必须以一行机器可读的状态信息结尾（不要使用反引号）',
            '以便工作区会话跟踪记录进度。请将该行单独放在',
            '其他所有内容之后的最后一行：',
            SESSION_SUMMARY_CONTRACT_LINE,
            '请用中文书写 "action" 和 "summary" 的值。',
            '如果不确定，请使用状态 "blocked"。当状态为 "done" 且仍有后续工作时，',
            'action 不得超过 12 个词语。'
        ].join('\n')
    }

    return [
        'Session status summary:',
        'End every response with a single machine-readable status line (no backticks)',
        'so this workspace\'s session tracking can record progress. Put it on its own',
        'final line after all other content:',
        SESSION_SUMMARY_CONTRACT_LINE,
        'Use status "blocked" if unsure. Keep action to 12 words or fewer when status',
        'is "done" and follow-up remains.'
    ].join('\n')
}

/** Empty string when disabled so callers can append unconditionally. */
export function sessionSummaryInstructionOrEmpty(
    env: NodeJS.ProcessEnv = process.env
): string {
    return isSessionSummaryContractEnabled(env) ? buildSessionSummaryInstruction() : ''
}

/** Append instruction to an existing prompt block (blank line separator). */
export function withSessionSummaryInstruction(
    base: string,
    env: NodeJS.ProcessEnv = process.env
): string {
    const extra = sessionSummaryInstructionOrEmpty(env)
    if (!extra) return base
    const trimmed = base.trimEnd()
    return trimmed.length > 0 ? `${trimmed}\n\n${extra}` : extra
}
