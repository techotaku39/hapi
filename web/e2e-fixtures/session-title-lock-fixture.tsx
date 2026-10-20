import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import '../src/index.css'
import { I18nProvider } from '../src/lib/i18n-context'
import { RenameSessionDialog } from '../src/components/RenameSessionDialog'

function Fixture() {
    const [sessions, setSessions] = useState([{ name: 'First session', locked: false }, { name: 'Second session', locked: false }])
    const [selected, setSelected] = useState(0)
    const [open, setOpen] = useState(false)
    const save = async (name: string, titleLocked?: boolean) => {
        setSessions(current => current.map((session, index) => index === selected ? { name, locked: !!titleLocked } : session))
    }
    return <>
        {sessions.map((session, index) => <div key={index}>
            <output data-testid={`session-${index}`}>{JSON.stringify(session)}</output>
            <button onClick={() => { setSelected(index); setOpen(true) }}>Rename {index + 1}</button>
        </div>)}
        <RenameSessionDialog isOpen={open} onClose={() => setOpen(false)} sessionId={String(selected)}
            currentName={sessions[selected].name} currentTitleLocked={sessions[selected].locked}
            onRename={save} onUpdateSummary={save} onSuggestTitle={async () => 'Generated title'} isPending={false} />
    </>
}

createRoot(document.getElementById('root')!).render(<I18nProvider><Fixture /></I18nProvider>)
