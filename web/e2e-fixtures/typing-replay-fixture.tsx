import { useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from 'react'
import ReactDOM from 'react-dom/client'
import {
    AssistantRuntimeProvider,
    MessagePrimitive,
    ThreadPrimitive,
    useAuiState,
    type ReasoningGroupProps,
    type ReasoningMessagePartProps,
    type TextMessagePartProps
} from '@assistant-ui/react'
import '../src/index.css'
import type { Session } from '../src/types/api'
import { I18nProvider } from '../src/lib/i18n-context'
import { useHappyRuntime } from '../src/lib/assistant-runtime'
import type { VisibleChatBlock } from '../src/chat/toolGroups'
import { NotifySummaryText } from '../src/components/AssistantChat/messages/NotifySummaryText'
import { Reasoning, ReasoningGroup } from '../src/components/assistant-ui/reasoning'

export const EXISTING_ASSISTANT_TEXT = 'This response was generated before the session was opened again.'
export const EXISTING_REASONING_TEXT = 'This reasoning was generated before the session was opened again.'
export const NEW_ASSISTANT_TEXT = 'This is newly generated output and it must still appear with the typewriter animation enabled.'

declare global {
    interface Window {
        __typingReplayProbe?: {
            firstLayoutText: string
            runningLayoutText?: string
            statusTypes?: string[]
            reasoningFirstLayoutText?: string
            reasoningRunningLayoutText?: string
            reasoningStatusTypes?: string[]
            reasoningGroupStatusTypes?: string[]
            newOutputFirstLayoutText?: string
        }
    }
}

const FIXTURE_SESSION = {
    id: 'typing-replay-fixture',
    active: true,
    thinking: true,
    agentState: null,
    metadata: { path: '/tmp/typing-replay-fixture', host: 'fixture' }
} as unknown as Session

const FIXTURE_BLOCKS: readonly VisibleChatBlock[] = [
    {
        kind: 'user-text',
        id: 'user-1',
        localId: 'user-1',
        createdAt: 1_700_000_000_000,
        invokedAt: 1_700_000_000_000,
        text: 'Show the existing response.'
    },
    {
        kind: 'agent-text',
        id: 'assistant-1',
        localId: 'assistant-1',
        createdAt: 1_700_000_000_001,
        invokedAt: 1_700_000_000_001,
        text: EXISTING_ASSISTANT_TEXT
    }
]

const REASONING_BLOCK: VisibleChatBlock = {
    kind: 'agent-reasoning',
    id: 'reasoning-1',
    localId: 'reasoning-1',
    createdAt: 1_700_000_000_001,
    invokedAt: 1_700_000_000_001,
    text: EXISTING_REASONING_TEXT
}

function ProbeText(props: TextMessagePartProps) {
    useLayoutEffect(() => {
        const probe = window.__typingReplayProbe ?? { firstLayoutText: '' }
        probe.statusTypes = [...(probe.statusTypes ?? []), props.status.type]
        if (probe.firstLayoutText === '') {
            probe.firstLayoutText = document.querySelector('[data-testid="assistant-text"]')?.textContent ?? ''
        }
        if (props.status.type === 'running') {
            probe.runningLayoutText = document.querySelector('[data-testid="assistant-text"]')?.textContent ?? ''
        }
        if (props.text === NEW_ASSISTANT_TEXT && props.status.type === 'running') {
            const textNodes = document.querySelectorAll('[data-testid="assistant-text"]')
            probe.newOutputFirstLayoutText = textNodes.item(textNodes.length - 1)?.textContent ?? ''
        }
        window.__typingReplayProbe = probe
    }, [props.status.type])

    return (
        <div data-testid="assistant-text">
            <NotifySummaryText {...props} />
        </div>
    )
}

function FixtureUserMessage() {
    return (
        <MessagePrimitive.Root data-testid="user-message">
            <MessagePrimitive.Content />
        </MessagePrimitive.Root>
    )
}

function ProbeReasoning(props: ReasoningMessagePartProps) {
    useLayoutEffect(() => {
        const probe = window.__typingReplayProbe ?? { firstLayoutText: '' }
        probe.reasoningStatusTypes = [...(probe.reasoningStatusTypes ?? []), props.status.type]
        if (probe.reasoningFirstLayoutText === undefined) {
            probe.reasoningFirstLayoutText = document.querySelector('[data-testid="reasoning-text"]')?.textContent ?? ''
        }
        if (props.status.type === 'running') {
            probe.reasoningRunningLayoutText = document.querySelector('[data-testid="reasoning-text"]')?.textContent ?? ''
        }
        window.__typingReplayProbe = probe
    }, [props.status.type])

    return (
        <div data-testid="reasoning-text">
            <Reasoning {...props} />
        </div>
    )
}

function ProbeReasoningGroup(props: ReasoningGroupProps) {
    const statusType = useAuiState((state) => {
        const part = state.message.parts
            .slice(props.startIndex, props.endIndex + 1)
            .findLast((candidate) => candidate.type === 'reasoning')
        return part?.type === 'reasoning' ? part.status.type : state.message.status.type
    })
    useLayoutEffect(() => {
        const probe = window.__typingReplayProbe ?? { firstLayoutText: '' }
        probe.reasoningGroupStatusTypes = [...(probe.reasoningGroupStatusTypes ?? []), statusType]
        window.__typingReplayProbe = probe
    }, [statusType])

    return <ReasoningGroup {...props} />
}

function FixtureAssistantMessage() {
    return (
        <MessagePrimitive.Root data-testid="assistant-message">
            <MessagePrimitive.Content components={{ Text: ProbeText, Reasoning: ProbeReasoning, ReasoningGroup: ProbeReasoningGroup }} />
        </MessagePrimitive.Root>
    )
}

function FixtureThread() {
    const params = new URLSearchParams(window.location.search)
    const includeReasoning = params.has('reasoning')
    const hasActiveTurn = params.has('active-turn')
    const hydrateBlocks = params.has('hydrate')
    const hydrateAfterStart = params.has('hydrate-after-start')
    const streamNewOutput = params.has('stream-new')
    const [sessionId, setSessionId] = useState('typing-replay-fixture')
    const blocks = useMemo(
        () => includeReasoning ? [FIXTURE_BLOCKS[0]!, REASONING_BLOCK] : FIXTURE_BLOCKS,
        [includeReasoning]
    )
    const newOutputBlocks = useMemo<readonly VisibleChatBlock[]>(
        () => [
            ...blocks,
            {
                kind: 'user-text',
                id: 'user-2',
                localId: 'user-2',
                createdAt: 1_700_000_000_002,
                invokedAt: 1_700_000_000_002,
                text: 'Generate a new response.'
            },
            {
                kind: 'agent-text',
                id: 'assistant-2',
                localId: 'assistant-2',
                createdAt: 1_700_000_000_003,
                invokedAt: 1_700_000_000_003,
                text: NEW_ASSISTANT_TEXT
            }
        ],
        [blocks]
    )
    const [visibleBlocks, setVisibleBlocks] = useState<readonly VisibleChatBlock[]>(
        () => hydrateBlocks || hydrateAfterStart ? [] : blocks
    )
    useEffect(() => {
        if (!hydrateBlocks || hydrateAfterStart) return
        const timer = window.setTimeout(() => setVisibleBlocks(blocks), 50)
        return () => window.clearTimeout(timer)
    }, [blocks, hydrateAfterStart, hydrateBlocks])
    const session = useMemo(
        () => ({
            ...FIXTURE_SESSION,
            id: sessionId,
            activeTurnStartedAt: hasActiveTurn ? 1_700_000_000_100 : null
        } as Session),
        [hasActiveTurn, sessionId]
    )
    const [isRunning, setIsRunning] = useState(() => params.has('running'))
    const runtime = useHappyRuntime({
        session,
        blocks: visibleBlocks,
        messagesVersion: 1,
        historyVersion: 1,
        isSending: false,
        isRunning,
        onSendMessage: () => {},
        onAbort: async () => {}
    })

    return (
        <AssistantRuntimeProvider runtime={runtime}>
            <ThreadPrimitive.Root>
                <ThreadPrimitive.Messages
                    components={{
                        UserMessage: FixtureUserMessage,
                        AssistantMessage: FixtureAssistantMessage
                    }}
                />
                <button
                    type="button"
                    data-testid="start-running"
                    onClick={() => {
                        setIsRunning(true)
                        if (streamNewOutput) {
                            window.setTimeout(() => setVisibleBlocks(newOutputBlocks), 25)
                        }
                        if (hydrateAfterStart) {
                            window.setTimeout(() => setVisibleBlocks(blocks), 50)
                        }
                    }}
                >
                    Start running
                </button>
                {params.has('switch-session') ? (
                    <button
                        type="button"
                        data-testid="switch-session"
                        onClick={() => {
                            setSessionId('typing-replay-running-session')
                            setIsRunning(true)
                        }}
                    >
                        Switch session
                    </button>
                ) : null}
            </ThreadPrimitive.Root>
        </AssistantRuntimeProvider>
    )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
    <I18nProvider>
        <FixtureThread />
    </I18nProvider>
)
