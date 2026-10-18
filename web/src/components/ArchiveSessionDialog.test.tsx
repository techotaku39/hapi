import { StrictMode, useState } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '@/lib/i18n-context'
import { ToastProvider, useToast } from '@/lib/toast-context'
import { ArchiveSessionDialog } from './ArchiveSessionDialog'

afterEach(cleanup)

function pendingArchive() {
    let resolve!: () => void
    let reject!: (error: Error) => void
    const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail })
    return { promise, resolve, reject }
}

function Harness(props: { active: boolean; confirm: () => Promise<void>; unmountOnClose?: boolean }) {
    const [open, setOpen] = useState(true)
    const [pending, setPending] = useState(false)
    const { toasts } = useToast()
    return <>
        {open || !props.unmountOnClose ? <ArchiveSessionDialog
            isOpen={open} onClose={() => setOpen(false)}
            sessionId="session-1" sessionName="My session" active={props.active}
            isPending={pending} onConfirm={async () => {
                setPending(true)
                try { await props.confirm() } finally { setPending(false) }
            }}
        /> : null}
        {toasts.map(toast => <div key={toast.id} role="alert">{toast.title}: {toast.body}</div>)}
    </>
}

function view(active: boolean, confirm: () => Promise<void>, unmountOnClose = false) {
    return <StrictMode><I18nProvider><ToastProvider>
        <Harness active={active} confirm={confirm} unmountOnClose={unmountOnClose} />
    </ToastProvider></I18nProvider></StrictMode>
}

describe('ArchiveSessionDialog', () => {
    it('shows cleanup progress after inactive SSE and still waits for HTTP success', async () => {
        const archive = pendingArchive()
        const confirm = vi.fn(() => archive.promise)
        const rendered = render(view(true, confirm))
        fireEvent.click(screen.getByRole('button', { name: 'Archive' }))
        expect(screen.getByRole('button', { name: 'Archiving…' })).toBeDisabled()
        expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
        rendered.rerender(view(false, confirm))
        expect(screen.getByText(/Session disconnected\. Confirming archive/)).toBeVisible()
        expect(screen.getByRole('button', { name: 'Confirming cleanup…' })).toBeDisabled()
        expect(within(screen.getByRole('dialog')).getAllByRole('button', { name: 'Close' })[0]).toBeEnabled()
        expect(confirm).toHaveBeenCalledTimes(1)
        await act(async () => archive.resolve())
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
        expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it.each([false, true])('surfaces a cleanup failure after dismissal (unmount=%s)', async unmountOnClose => {
        const archive = pendingArchive()
        const confirm = vi.fn(() => archive.promise)
        const rendered = render(view(true, confirm, unmountOnClose))
        fireEvent.click(screen.getByRole('button', { name: 'Archive' }))
        rendered.rerender(view(false, confirm, unmountOnClose))
        fireEvent.click(within(screen.getByRole('dialog')).getAllByRole('button', { name: 'Close' })[0]!)
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
        await act(async () => archive.reject(new Error('Session process is still running')))
        expect(await screen.findByRole('alert')).toHaveTextContent('Archive could not be confirmed: Session process is still running')
        expect(confirm).toHaveBeenCalledTimes(1)
    })

    it('keeps failures visible in an open dialog without claiming success', async () => {
        const archive = pendingArchive()
        render(view(false, () => archive.promise))
        fireEvent.click(screen.getByRole('button', { name: 'Archive' }))
        await act(async () => archive.reject(new Error('Stop not confirmed')))
        expect(screen.getByRole('dialog')).toBeVisible()
        expect(screen.getByText('Stop not confirmed')).toBeVisible()
        expect(screen.getByRole('button', { name: 'Archive' })).toBeEnabled()
        expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })
})
