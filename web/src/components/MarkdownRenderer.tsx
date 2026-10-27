import type { MarkdownTextPrimitiveProps } from '@assistant-ui/react-markdown'
import { MarkdownTextPrimitive } from '@assistant-ui/react-markdown'
import { TextMessagePartProvider } from '@assistant-ui/react'
import { Children, isValidElement, useEffect, useMemo, useState, type ComponentPropsWithoutRef, type ComponentType, type ReactNode } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import type { ApiClient } from '@/api/client'
import {
    MARKDOWN_PLUGINS,
    MARKDOWN_PLUGINS_STANDALONE,
    MARKDOWN_PLUGINS_STANDALONE_WITH_BREAKS,
    MARKDOWN_PLUGINS_WITH_BREAKS,
    MARKDOWN_REHYPE_PLUGINS,
    MARKDOWN_COMPONENTS_BY_LANGUAGE,
    MARKDOWN_CLASSNAME,
    defaultComponents,
    denyOnlyTransform,
    UriConfirmProvider,
    isExternalHttpHref,
} from '@/components/assistant-ui/markdown-text'
import { SyntaxHighlighter } from '@/components/assistant-ui/shiki-highlighter'
import type { CodeHeaderProps, SyntaxHighlighterProps } from '@assistant-ui/react-markdown'
import { cn, encodeBase64 } from '@/lib/utils'
import { useOpenExternalLinksInNewTab } from '@/hooks/useOpenExternalLinksInNewTab'
import {
    getMarkdownImageMimeType,
    MAX_MARKDOWN_IMAGE_BYTES,
    resolveMarkdownFileImage,
    resolveMarkdownFileLink,
} from '@/lib/markdown-file-assets'

export interface MarkdownFilePreviewOptions {
    api: ApiClient
    sessionId: string
    filePath: string
    workspacePath?: string | null
}

interface MarkdownRendererProps {
    content: string
    components?: MarkdownTextPrimitiveProps['components']
    className?: string
    preserveSingleLineBreaks?: boolean
    /** Render outside assistant-ui thread context (file pane, fixtures). */
    standalone?: boolean
    /** Resolve local links and images for a standalone file preview. */
    filePreview?: MarkdownFilePreviewOptions
}

function StandaloneCode(props: ComponentPropsWithoutRef<'code'>) {
    const Code = defaultComponents.code!
    return <Code {...props} />
}

function StandalonePre(props: ComponentPropsWithoutRef<'pre'>) {
    const child = Children.toArray(props.children)[0]
    if (!isValidElement<ComponentPropsWithoutRef<'code'>>(child)) {
        const Pre = defaultComponents.pre!
        return <Pre {...props} />
    }

    const className = String(child.props.className ?? '')
    const language = /language-(\w+)/.exec(className)?.[1] ?? 'unknown'
    const code = String(child.props.children ?? '').replace(/\n$/, '')
    const Highlighter: ComponentType<SyntaxHighlighterProps> =
        MARKDOWN_COMPONENTS_BY_LANGUAGE[language as keyof typeof MARKDOWN_COMPONENTS_BY_LANGUAGE]?.SyntaxHighlighter
        ?? SyntaxHighlighter
    const CodeHeader = defaultComponents.CodeHeader as ComponentType<CodeHeaderProps>
    const Pre = defaultComponents.pre!
    const Code = defaultComponents.code!

    return (
        <>
            <CodeHeader language={language} code={code} />
            <Highlighter language={language} code={code} components={{ Pre, Code }} />
        </>
    )
}

function standaloneFileHref(sessionId: string, filePath: string): string {
    const baseUrl = (import.meta.env.BASE_URL as string | undefined) ?? '/'
    const base = baseUrl === '/' ? '' : baseUrl.replace(/\/+$/, '')
    const search = new URLSearchParams({ path: encodeBase64(filePath) })
    return `${base}/sessions/${encodeURIComponent(sessionId)}/file?${search.toString()}`
}

function InertStandaloneFileTarget(props: { href: string; children?: ReactNode; className?: string }) {
    return (
        <span
            title={props.href}
            className={cn('aui-md-a-inert text-[var(--app-hint)]', props.className)}
        >
            {props.children}
        </span>
    )
}

function StandaloneFileLink(props: ComponentPropsWithoutRef<'a'> & MarkdownFilePreviewOptions) {
    const { api: _api, filePath, sessionId, workspacePath, href, children, ...anchorProps } = props
    const { openExternalLinksInNewTab } = useOpenExternalLinksInNewTab()
    const target = typeof href === 'string'
        ? resolveMarkdownFileLink(filePath, href, { workspacePath })
        : { kind: 'inert', href: '' } as const

    if (target.kind === 'inert') {
        return <InertStandaloneFileTarget href={target.href}>{children}</InertStandaloneFileTarget>
    }

    const resolvedHref = target.kind === 'local'
        ? standaloneFileHref(sessionId, target.path)
        : target.href
    const forceNewTab = openExternalLinksInNewTab && target.kind === 'remote' && isExternalHttpHref(resolvedHref)
    const resolvedTarget = forceNewTab ? '_blank' : anchorProps.target
    const resolvedRel = forceNewTab ? (anchorProps.rel ?? 'noopener noreferrer') : anchorProps.rel

    return (
        <a
            {...anchorProps}
            href={resolvedHref}
            target={resolvedTarget}
            rel={resolvedRel}
            className={cn('aui-md-a font-medium text-[var(--app-link)] underline decoration-[color:var(--app-link-muted)] underline-offset-3', anchorProps.className)}
        >
            {children}
        </a>
    )
}

function markdownImageFallback(props: { label?: string; source: string; className?: string }) {
    return (
        <span
            role="img"
            aria-label={props.label || 'Image unavailable'}
            title={props.source}
            data-hapi-markdown-image-fallback="true"
            className={cn('aui-md-img-fallback my-3 text-[var(--app-hint)]', props.className)}
        >
            {props.label || 'Image unavailable'}
        </span>
    )
}

function markdownImageLoading(props: { label?: string; className?: string }) {
    return (
        <span
            role="img"
            aria-label={props.label || 'Loading image'}
            data-hapi-markdown-image-loading="true"
            className={cn('aui-md-img-loading my-3 text-[var(--app-hint)]', props.className)}
        >
            {props.label || 'Loading image'}
        </span>
    )
}

function StandaloneFileImage(props: ComponentPropsWithoutRef<'img'> & MarkdownFilePreviewOptions) {
    const { api, sessionId, filePath, workspacePath, src, alt, onError, className, ...imageProps } = props
    const source = typeof src === 'string'
        ? resolveMarkdownFileImage(filePath, src, { workspacePath })
        : { kind: 'inert', href: '' } as const
    const localPath = source.kind === 'local' ? source.path : null
    const sourceKey = localPath ?? ('href' in source ? source.href : '')
    const [state, setState] = useState<{ key: string; dataUrl: string | null; failed: boolean }>({
        key: sourceKey,
        dataUrl: null,
        failed: source.kind === 'inert',
    })

    useEffect(() => {
        let active = true
        if (!localPath) {
            setState({ key: sourceKey, dataUrl: null, failed: source.kind === 'inert' })
            return () => {
                active = false
            }
        }

        setState({ key: sourceKey, dataUrl: null, failed: false })
        void api.readSessionFile(sessionId, localPath, MAX_MARKDOWN_IMAGE_BYTES).then((result) => {
            if (!active) return
            const mimeType = getMarkdownImageMimeType(localPath)
            const tooLarge = result.size !== undefined && result.size > MAX_MARKDOWN_IMAGE_BYTES
            if (!result.success || !result.content || !mimeType || tooLarge) {
                setState({ key: sourceKey, dataUrl: null, failed: true })
                return
            }
            setState({
                key: sourceKey,
                dataUrl: `data:${mimeType};base64,${result.content}`,
                failed: false,
            })
        }).catch(() => {
            if (active) setState({ key: sourceKey, dataUrl: null, failed: true })
        })

        return () => {
            active = false
        }
    }, [api, localPath, sessionId, source.kind, sourceKey, workspacePath])

    if (localPath && state.key === sourceKey && !state.failed && !state.dataUrl) {
        return markdownImageLoading({ label: alt, className })
    }

    if (state.key !== sourceKey || state.failed) {
        return markdownImageFallback({ label: alt, source: typeof src === 'string' ? src : '', className })
    }

    const resolvedSrc = localPath ? state.dataUrl : source.kind === 'remote' ? source.href : null
    if (!resolvedSrc) {
        return markdownImageFallback({ label: alt, source: typeof src === 'string' ? src : '', className })
    }

    return (
        <img
            {...imageProps}
            src={resolvedSrc}
            alt={alt}
            loading="lazy"
            referrerPolicy="no-referrer"
            className={cn('aui-md-img my-3 max-w-full rounded-xl', className)}
            onError={(event) => {
                onError?.(event)
                setState({ key: sourceKey, dataUrl: null, failed: true })
            }}
        />
    )
}

function StandaloneMarkdownContent(props: MarkdownRendererProps) {
    const mergedComponents = useMemo(
        () => props.components ? { ...defaultComponents, ...props.components } : defaultComponents,
        [props.components]
    )
    const componentsRest = useMemo(() => {
        const {
            pre: _pre,
            code: _code,
            SyntaxHighlighter: _sh,
            CodeHeader: _header,
            ...rest
        } = mergedComponents as typeof mergedComponents & Record<string, unknown>
        return rest
    }, [mergedComponents])

    const components = useMemo<Components>(() => {
        const base = {
            ...(componentsRest as Components),
            pre: StandalonePre,
            code: StandaloneCode,
        } as Components
        if (props.filePreview) {
            const { api, sessionId, filePath, workspacePath } = props.filePreview
            base.a = (anchorProps) => <StandaloneFileLink {...anchorProps} api={api} sessionId={sessionId} filePath={filePath} workspacePath={workspacePath} />
            base.img = (imageProps) => <StandaloneFileImage {...imageProps} api={api} sessionId={sessionId} filePath={filePath} workspacePath={workspacePath} />
        }
        return base
    }, [componentsRest, props.filePreview?.api, props.filePreview?.filePath, props.filePreview?.sessionId, props.filePreview?.workspacePath])

    return (
        <UriConfirmProvider>
            <div className={cn(MARKDOWN_CLASSNAME, props.className)}>
                <ReactMarkdown
                    remarkPlugins={props.preserveSingleLineBreaks ? MARKDOWN_PLUGINS_STANDALONE_WITH_BREAKS : MARKDOWN_PLUGINS_STANDALONE}
                    rehypePlugins={MARKDOWN_REHYPE_PLUGINS}
                    components={components}
                    urlTransform={denyOnlyTransform}
                >
                    {props.content}
                </ReactMarkdown>
            </div>
        </UriConfirmProvider>
    )
}

function MarkdownContent(props: MarkdownRendererProps) {
    const mergedComponents = props.components
        ? { ...defaultComponents, ...props.components }
        : defaultComponents

    return (
        <UriConfirmProvider>
            <TextMessagePartProvider text={props.content}>
                <MarkdownTextPrimitive
                    remarkPlugins={props.preserveSingleLineBreaks ? MARKDOWN_PLUGINS_WITH_BREAKS : MARKDOWN_PLUGINS}
                    rehypePlugins={MARKDOWN_REHYPE_PLUGINS}
                    components={mergedComponents}
                    componentsByLanguage={MARKDOWN_COMPONENTS_BY_LANGUAGE}
                    urlTransform={denyOnlyTransform}
                    className={cn(MARKDOWN_CLASSNAME, props.className)}
                />
            </TextMessagePartProvider>
        </UriConfirmProvider>
    )
}

export function MarkdownRenderer(props: MarkdownRendererProps) {
    if (props.standalone) {
        return <StandaloneMarkdownContent {...props} />
    }
    return <MarkdownContent {...props} />
}
