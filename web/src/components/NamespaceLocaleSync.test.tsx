import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, render, waitFor } from '@testing-library/react'
import { NamespaceLocaleSync } from './NamespaceLocaleSync'
import { I18nProvider } from '@/lib/i18n-context'
import { useTranslation } from '@/lib/use-translation'

const getNamespaceSettings = vi.fn()
const updateNamespaceSettings = vi.fn()
const api = { getNamespaceSettings, updateNamespaceSettings }

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

        render(
            <I18nProvider>
                <NamespaceLocaleSync />
            </I18nProvider>
        )

        await waitFor(() => expect(document.documentElement.lang).toBe('zh-CN'))
        expect(updateNamespaceSettings).not.toHaveBeenCalled()
    })

    it('persists later UI changes after namespace hydration', async () => {
        resetApiMocks()
        getNamespaceSettings.mockResolvedValue({ locale: 'en' })
        updateNamespaceSettings.mockResolvedValue({ locale: 'zh-CN' })
        let setLocale: ((locale: 'en' | 'zh-CN') => void) | undefined

        render(
            <I18nProvider>
                <NamespaceLocaleSync />
                <LocaleCapture onReady={(setter) => { setLocale = setter }} />
            </I18nProvider>
        )

        await waitFor(() => expect(document.documentElement.lang).toBe('en'))
        act(() => setLocale?.('zh-CN'))
        await waitFor(() => expect(updateNamespaceSettings).toHaveBeenCalledWith({ locale: 'zh-CN' }))
    })

    it('persists a UI change back to the hydrated namespace locale', async () => {
        resetApiMocks()
        getNamespaceSettings.mockResolvedValue({ locale: 'en' })
        updateNamespaceSettings.mockImplementation(async ({ locale }: { locale: 'en' | 'zh-CN' }) => ({ locale }))
        let setLocale: ((locale: 'en' | 'zh-CN') => void) | undefined

        render(
            <I18nProvider>
                <NamespaceLocaleSync />
                <LocaleCapture onReady={(setter) => { setLocale = setter }} />
            </I18nProvider>
        )

        await waitFor(() => expect(document.documentElement.lang).toBe('en'))
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
        render(
            <I18nProvider>
                <NamespaceLocaleSync />
                <LocaleCapture onReady={(setter) => { setLocale = setter }} />
            </I18nProvider>
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

        render(
            <I18nProvider>
                <NamespaceLocaleSync />
                <LocaleCapture onReady={(setter) => { setLocale = setter }} />
            </I18nProvider>
        )

        act(() => setLocale?.('zh-CN'))
        await act(async () => { resolveSettings({ locale: 'en' }) })
        await waitFor(() => expect(document.documentElement.lang).toBe('en'))
        expect(updateNamespaceSettings).not.toHaveBeenCalled()
    })
})
