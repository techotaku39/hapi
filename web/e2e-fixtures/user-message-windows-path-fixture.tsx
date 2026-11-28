import { createRoot } from 'react-dom/client'
import { getUserBubbleClassName, UserBubbleContent } from '../src/components/AssistantChat/messages/user-bubble'
import { I18nProvider } from '../src/lib/i18n-context'
import '../src/index.css'

const prompt = String.raw`Please check D:\Projects\demo\.front` + '\n' + String.raw`Use \* as a literal asterisk.`

createRoot(document.getElementById('root')!).render(
    <I18nProvider>
        <main className="mx-auto max-w-3xl space-y-5 px-4 py-8">
            <h1 className="text-lg font-semibold">Sent user message</h1>
            <div className={getUserBubbleClassName()} data-testid="user-message">
                <UserBubbleContent text={prompt} />
            </div>
        </main>
    </I18nProvider>
)
