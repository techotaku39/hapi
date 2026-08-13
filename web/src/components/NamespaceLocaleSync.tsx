import { useEffect, useRef } from 'react'
import { useAppContext } from '@/lib/app-context'
import { useTranslation } from '@/lib/use-translation'
import type { SupportedLocale } from '@hapi/protocol'

/**
 * Reconciles the browser's UI locale with the authenticated namespace.
 * The namespace value is authoritative on first load; subsequent UI changes
 * are persisted without making the prompt protocol itself locale-dependent.
 */
export function NamespaceLocaleSync() {
    const { api } = useAppContext()
    const { locale, setLocale } = useTranslation()
    const hydratedApiRef = useRef<typeof api | null>(null)
    const lastServerLocaleRef = useRef<SupportedLocale | null>(null)
    const writeChainRef = useRef(Promise.resolve())
    const localeRef = useRef(locale)
    localeRef.current = locale

    useEffect(() => {
        let cancelled = false
        hydratedApiRef.current = null
        lastServerLocaleRef.current = null
        writeChainRef.current = Promise.resolve()

        void api.getNamespaceSettings()
            .then((settings) => {
                if (cancelled) return
                hydratedApiRef.current = api
                if (settings.locale === localeRef.current) {
                    lastServerLocaleRef.current = settings.locale
                    return
                }
                lastServerLocaleRef.current = settings.locale
                setLocale(settings.locale)
            })
            .catch((error) => {
                if (!cancelled) {
                    console.warn('Failed to load namespace locale:', error)
                }
            })

        return () => {
            cancelled = true
        }
    }, [api, setLocale])

    useEffect(() => {
        if (hydratedApiRef.current !== api) return
        if (lastServerLocaleRef.current === locale) {
            return
        }

        writeChainRef.current = writeChainRef.current
            .catch(() => undefined)
            .then(() => api.updateNamespaceSettings({ locale }).then(() => undefined))
            .catch((error) => {
                console.warn('Failed to save namespace locale:', error)
            })
    }, [api, locale])

    return null
}
