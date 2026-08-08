import { useState } from 'react'
import { truncateGraphemes } from '@/lib/graphemes'

const DEFAULT_MAX_LENGTH = 160

export function ExpandableErrorMessage(props: {
    message: string
    expandLabel: string
    collapseLabel: string
    className?: string
    maxLength?: number
}) {
    const [expanded, setExpanded] = useState(false)
    const maxLength = props.maxLength ?? DEFAULT_MAX_LENGTH
    const singleLine = props.message.replace(/\s+/g, ' ').trim()
    const truncated = singleLine.length > maxLength
    const preview = truncated
        ? `${truncateGraphemes(singleLine, maxLength).trimEnd()}…`
        : props.message

    return (
        <div role="alert" className={props.className}>
            {truncated ? (
                <button
                    type="button"
                    data-hapi-expandable-error-toggle="true"
                    aria-expanded={expanded}
                    aria-label={`${expanded ? props.collapseLabel : props.expandLabel}: ${expanded ? props.message : preview}`}
                    title={expanded ? props.collapseLabel : props.expandLabel}
                    onClick={() => setExpanded((current) => !current)}
                    className={`block w-full min-w-0 cursor-pointer text-left hover:text-[var(--app-fg)] ${expanded ? 'whitespace-pre-wrap break-words' : 'truncate'}`}
                >
                    {expanded ? props.message : preview}
                </button>
            ) : (
                props.message
            )}
        </div>
    )
}
