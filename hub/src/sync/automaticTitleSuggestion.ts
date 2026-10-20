import type { SessionCache } from './sessionCache'
import type { TitleSuggestionService } from './titleSuggestion'

/**
 * Best-effort first-turn title fallback.
 *
 * This service owns only the automatic path. The existing manual Generate
 * action remains available after an automatic attempt fails.
 */
export class AutomaticTitleSuggestionService {
    private readonly inFlightSessionIds = new Set<string>()
    private stopped = false

    constructor(
        private readonly sessionCache: SessionCache,
        private readonly titleSuggestionService: TitleSuggestionService,
        private readonly now: () => number = Date.now
    ) {
    }

    stop(): void {
        this.stopped = true
    }

    /**
     * Schedule one non-blocking attempt after the first turn becomes idle.
     * Errors are intentionally swallowed: title fallback must never affect the
     * primary agent conversation.
     */
    onTurnCompleted(sessionId: string): Promise<void> {
        if (this.stopped || this.inFlightSessionIds.has(sessionId)) return Promise.resolve()
        this.inFlightSessionIds.add(sessionId)

        return Promise.resolve()
            .then(async () => {
                try {
                    if (this.stopped) return
                    if (!this.titleSuggestionService.isConfigured()) return
                    const metadata = this.sessionCache.getSession(sessionId)?.metadata
                    if (metadata?.name?.trim() || metadata?.summary?.text?.trim()
                        || metadata?.titleSuggestionAutoAttemptedAt !== undefined) return
                    if (!this.titleSuggestionService.hasCompletedFirstTurn(sessionId)) return
                    if (!this.sessionCache.claimAutomaticTitleAttempt(sessionId, this.now())) return

                    const title = await this.titleSuggestionService.suggestTitle(sessionId)
                    if (!this.stopped) {
                        await this.sessionCache.updateAutomaticSessionSummary(sessionId, title)
                    }
                } catch {
                    // Automatic title generation is best-effort and silent.
                }
            })
            .finally(() => {
                this.inFlightSessionIds.delete(sessionId)
            })
    }
}
