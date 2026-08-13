import { useEffect, useRef } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useAppContext } from '@/lib/app-context'
import { useTranslation } from '@/lib/use-translation'
import type { SupportedLocale } from '@hapi/protocol'
import { queryKeys } from '@/lib/query-keys'

/**
 * Reconciles the browser's UI locale with the authenticated namespace.
 * The namespace value is authoritative on first load; subsequent UI changes
 * are persisted without making the prompt protocol itself locale-dependent.
 */
export function NamespaceLocaleSync() {
    const { api } = useAppContext()
    const { locale, setLocale } = useTranslation()
    const hydratedApiRef = useRef<typeof api | null>(null)
    const hydrationPendingRef = useRef(false)
    const lastQueuedLocaleRef = useRef<SupportedLocale | null>(null)
    const writeChainRef = useRef(Promise.resolve())
    const localeRef = useRef(locale)
    localeRef.current = locale
    const settingsQuery = useQuery({
        queryKey: [...queryKeys.hubSettings, 'namespace-locale', api],
        queryFn: () => api.getNamespaceSettings(),
        retry: 3,
        retryDelay: 0,
        refetchOnReconnect: true,
    })
    const { mutateAsync: saveLocale } = useMutation({
        mutationFn: (nextLocale: SupportedLocale) => api.updateNamespaceSettings({ locale: nextLocale }),
        retry: 3,
        retryDelay: 0,
    })

    useEffect(() => {
        hydratedApiRef.current = null
        hydrationPendingRef.current = false
        lastQueuedLocaleRef.current = null
        writeChainRef.current = Promise.resolve()
    }, [api])

    useEffect(() => {
        const settings = settingsQuery.data
        if (!settings) return

        const isFirstHydration = hydratedApiRef.current !== api
        hydratedApiRef.current = api
        if (isFirstHydration) {
            lastQueuedLocaleRef.current = settings.locale
            hydrationPendingRef.current = settings.locale !== localeRef.current
        }
        if (isFirstHydration && settings.locale !== localeRef.current) {
            setLocale(settings.locale)
        }
    }, [api, setLocale, settingsQuery.data])

    useEffect(() => {
        if (hydratedApiRef.current !== api) return
        if (hydrationPendingRef.current) {
            if (lastQueuedLocaleRef.current === locale) {
                hydrationPendingRef.current = false
                return
            }
            hydrationPendingRef.current = false
        }
        if (lastQueuedLocaleRef.current === locale) {
            return
        }

        lastQueuedLocaleRef.current = locale
        writeChainRef.current = writeChainRef.current
            .catch(() => undefined)
            .then(() => saveLocale(locale).then(() => undefined))
            .catch((error) => {
                console.warn('Failed to save namespace locale:', error)
            })
    }, [api, locale, saveLocale])

    return null
}
