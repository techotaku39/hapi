import React from 'react'
import ReactDOM from 'react-dom/client'
import '../src/index.css'
import { HappyChatProvider, type HappyChatContextValue } from '../src/components/AssistantChat/context'
import { I18nProvider } from '../src/lib/i18n-context'
import { MarkdownRenderer } from '../src/components/MarkdownRenderer'

const TABLE_MARKDOWN = `# Repository activity

| Project | Stars | Language | Latest release | Maintainer | Notes |
| --- | ---: | --- | --- | --- | --- |
| HAPI | 128 | TypeScript | 0.28.0 | Local-first team | Remote control for coding agents |
| HAPI, local-first | 42 | TypeScript | 0.27.3 | Community | A deliberately long description for horizontal table scrolling |
| Example | 7 | Rust | 1.2.0 | Open source | Stable fixture row |`

function MarkdownTableFixture() {
    return (
        <HappyChatProvider value={{ sessionTitle: 'Table filename fixture' } as HappyChatContextValue}>
            <main data-testid="markdown-table-fixture">
                <MarkdownRenderer standalone content={TABLE_MARKDOWN} />
            </main>
        </HappyChatProvider>
    )
}

const root = document.getElementById('root')
if (root) {
    ReactDOM.createRoot(root).render(
        <React.StrictMode>
            <I18nProvider>
                <MarkdownTableFixture />
            </I18nProvider>
        </React.StrictMode>,
    )
}
