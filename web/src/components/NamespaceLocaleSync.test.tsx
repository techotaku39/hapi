import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, render, waitFor } from '@testing-library/react'
import { NamespaceLocaleSync } from './NamespaceLocaleSync'
import { I18nProvider } from '@/lib/i18n-context'
import { useTranslation } from '@/lib/use-translation'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

const getNamespaceSettings = vi.fn()
const updateNamespaceSettings = vi.fn()
const api = { getNamespaceSettings, updateNamespaceSettings }

function renderWithProviders(children: ReactNode) {
    const queryClient = new QueryClient({
        defaultOptions: {
            queries: { retry: false },
            mutations: { retry: false },
        }
    })
    return render(
        <QueryClientProvider client={queryClient}>
            <I18nProvider>{children}</I18nProvider>
        </QueryClientProvider>
    )
}

function resetApiMocks(): void {
    getNamespaceSettings.mockReset()
    updateNamespaceSettings.mockReset()
    getNamespaceSettings.mockResolvedValue({ locale: 'en' })
    updateNamespaceSettings.mockResolvedValue({ locale: 'en' })
}

vi.mock('@/lib/app-context', () => ({
    useAppContext: () => ({
        api
    })
}))

function LocaleCapture(props: { onReady: (setLocale: (locale: 'en' | 'zh-CN') => void) => void }) {
    const { setLocale } = useTranslation()
    props.onReady(setLocale)
    return null
}

describe('NamespaceLocaleSync', () => {
    afterEach(() => {
        localStorage.clear()
        resetApiMocks()
    })

    it('hydrates the UI from the namespace and does not echo the initial value', async () => {
        resetApiMocks()
        localStorage.setItem('hapi-lang', 'en')
        getNamespaceSettings.mockResolvedValue({ locale: 'zh-CN' })
        updateNamespaceSettings.mockResolvedValue({ locale: 'zh-CN' })

        renderWithProviders(<NamespaceLocaleSync />)

        await waitFor(() => expect(document.documentElement.lang).toBe('zh-CN'))
        expect(updateNamespaceSettings).not.toHaveBeenCalled()
    })

    it('persists later UI changes after namespace hydration', async () => {
        resetApiMocks()
        getNamespaceSettings.mockResolvedValue({ locale: 'en' })
        updateNamespaceSettings.mockResolvedValue({ locale: 'zh-CN' })
        let setLocale: ((locale: 'en' | 'zh-CN') => void) | undefined

        renderWithProviders(
            <>
                <NamespaceLocaleSync />
                <LocaleCapture onReady={(setter) => { setLocale = setter }} />
            </>
        )

        await waitFor(() => expect(document.documentElement.lang).toBe('en'))
        expect(setLocale).toBeDefined()
        act(() => setLocale?.('zh-CN'))
        await waitFor(() => expect(updateNamespaceSettings).toHaveBeenCalledWith({ locale: 'zh-CN' }))
    })

    it('persists a UI change back to the hydrated namespace locale', async () => {
        resetApiMocks()
        getNamespaceSettings.mockResolvedValue({ locale: 'en' })
        updateNamespaceSettings.mockImplementation(async ({ locale }: { locale: 'en' | 'zh-CN' }) => ({ locale }))
        let setLocale: ((locale: 'en' | 'zh-CN') => void) | undefined

        renderWithProviders(
            <>
                <NamespaceLocaleSync />
                <LocaleCapture onReady={(setter) => { setLocale = setter }} />
            </>
        )

        await waitFor(() => expect(document.documentElement.lang).toBe('en'))
        expect(setLocale).toBeDefined()
        act(() => setLocale?.('zh-CN'))
        await waitFor(() => expect(updateNamespaceSettings).toHaveBeenNthCalledWith(1, { locale: 'zh-CN' }))
        act(() => setLocale?.('en'))
        await waitFor(() => expect(updateNamespaceSettings).toHaveBeenNthCalledWith(2, { locale: 'en' }))
    })

    it('does not persist a stale local preference before the namespace loads', async () => {
        localStorage.setItem('hapi-lang', 'zh-CN')
        let resolveSettings!: (value: { locale: 'en' | 'zh-CN' }) => void
        getNamespaceSettings.mockReturnValue(new Promise((resolve) => { resolveSettings = resolve }))

        let setLocale: ((locale: 'en' | 'zh-CN') => void) | undefined
        renderWithProviders(
            <>
                <NamespaceLocaleSync />
                <LocaleCapture onReady={(setter) => { setLocale = setter }} />
            </>
        )

        act(() => setLocale?.('en'))
        expect(updateNamespaceSettings).not.toHaveBeenCalled()
        await act(async () => { resolveSettings({ locale: 'en' }) })
        expect(updateNamespaceSettings).not.toHaveBeenCalled()
    })

    it('uses the latest local choice when the namespace response races a UI change', async () => {
        let resolveSettings!: (value: { locale: 'en' | 'zh-CN' }) => void
        getNamespaceSettings.mockReturnValue(new Promise((resolve) => { resolveSettings = resolve }))
        let setLocale: ((locale: 'en' | 'zh-CN') => void) | undefined

        renderWithProviders(
            <>
                <NamespaceLocaleSync />
                <LocaleCapture onReady={(setter) => { setLocale = setter }} />
            </>
        )

        act(() => setLocale?.('zh-CN'))
        await act(async () => { resolveSettings({ locale: 'en' }) })
        await waitFor(() => expect(document.documentElement.lang).toBe('en'))
        expect(updateNamespaceSettings).not.toHaveBeenCalled()
    })

    it('retries a transient namespace read failure', async () => {
        getNamespaceSettings
            .mockRejectedValueOnce(new Error('temporary failure'))
            .mockResolvedValueOnce({ locale: 'zh-CN' })
        renderWithProviders(<NamespaceLocaleSync />)

        await waitFor(() => expect(document.documentElement.lang).toBe('zh-CN'))
        expect(getNamespaceSettings).toHaveBeenCalledTimes(2)
    })

    it('retries a transient locale write failure', async () => {
        updateNamespaceSettings
            .mockRejectedValueOnce(new Error('temporary failure'))
            .mockResolvedValueOnce({ locale: 'zh-CN' })
        let setLocale: ((locale: 'en' | 'zh-CN') => void) | undefined

        renderWithProviders(
            <>
                <NamespaceLocaleSync />
                <LocaleCapture onReady={(setter) => { setLocale = setter }} />
            </>
        )

        await waitFor(() => expect(document.documentElement.lang).toBe('en'))
        await waitFor(() => expect(getNamespaceSettings).toHaveBeenCalled())
        act(() => setLocale?.('zh-CN'))
        await waitFor(() => expect(updateNamespaceSettings).toHaveBeenCalledTimes(2), { timeout: 5000 })
        expect(updateNamespaceSettings).toHaveBeenLastCalledWith({ locale: 'zh-CN' })
    })
})
