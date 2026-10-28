import { useLayoutEffect, useRef, useState, type ReactNode, type SyntheticEvent } from 'react'

export function SessionContentBoundary(props: {
    sessionId: string
    scope: unknown
    synchronizing: boolean
    fallback: ReactNode
    children: ReactNode
}) {
    const [snapshot, setSnapshot] = useState<{
        sessionId: string
        scope: unknown
        content: ReactNode
    } | null>(null)
    const hasContent = props.children != null
    const canRetain = props.synchronizing
        && snapshot?.sessionId === props.sessionId
        && snapshot.scope === props.scope
    const content = hasContent ? props.children : canRetain ? snapshot.content : null
    const paused = !hasContent && content != null
    const focusedElement = useRef<HTMLElement | null>(null)
    const wasPaused = useRef(false)

    // Retain only committed content. A cold stale cache must never seed the
    // snapshot, and another Hub/auth scope or session cannot reuse it.
    useLayoutEffect(() => {
        if (hasContent) {
            setSnapshot({ sessionId: props.sessionId, scope: props.scope, content: props.children })
        } else if (!canRetain) {
            setSnapshot(null)
        }
    }, [canRetain, hasContent, props.children, props.scope, props.sessionId])

    useLayoutEffect(() => {
        if (!paused && wasPaused.current && focusedElement.current?.isConnected
            && document.activeElement === document.body) {
            focusedElement.current.focus({ preventScroll: true })
        }
        wasPaused.current = paused
    }, [paused])

    useLayoutEffect(() => {
        if (!paused) return
        const guardGlobalAction = (event: KeyboardEvent) => {
            if (!(event.ctrlKey || event.metaKey)) return
            const key = event.key.toLowerCase()
            // Retained descendants also register window-level model, scratchlist
            // and dictation actions. Body focus bypasses React capture/inert.
            if (key === 'm' || (event.shiftKey && (key === 's' || key === 'd'))) {
                event.preventDefault()
                event.stopImmediatePropagation()
            }
        }
        window.addEventListener('keydown', guardGlobalAction, true)
        return () => window.removeEventListener('keydown', guardGlobalAction, true)
    }, [paused])

    const guardInteraction = (event: SyntheticEvent) => {
        if (paused) {
            // React portals are outside the inert DOM subtree but their
            // events still pass through this capture boundary.
            event.preventDefault()
            event.stopPropagation()
        }
    }

    return (
        <div className="flex h-full min-h-0 flex-1 flex-col"
            inert={paused || undefined}
            aria-busy={paused || undefined}
            onClickCapture={guardInteraction}
            onPointerDownCapture={guardInteraction}
            onKeyDownCapture={guardInteraction}
            onSubmitCapture={guardInteraction}
            onDropCapture={guardInteraction}
            onFocusCapture={(event) => { focusedElement.current = event.target }}
            onBlurCapture={(event) => {
                if (!paused && !event.currentTarget.contains(event.relatedTarget as Node | null)) {
                    focusedElement.current = null
                }
            }}
        >{content ?? props.fallback}</div>
    )
}
