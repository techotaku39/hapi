import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { I18nProvider } from '@/lib/i18n-context'
import { StatusBar } from './StatusBar'

describe('StatusBar context details popover', () => {
    beforeEach(() => {
        localStorage.clear()
    })

    it('opens from the mobile-accessible context trigger and keeps the requested detail order', async () => {
        localStorage.setItem('hapi-lang', 'zh-CN')
        render(
            <I18nProvider>
                <StatusBar
                    active
                    thinking={false}
                    agentState={null}
                    contextSize={90_000}
                    contextCacheRead={86_000}
                    contextWindow={258_000}
                />
            </I18nProvider>
        )

        const trigger = screen.getByRole('button', { name: '上下文详情' })
        expect(trigger.textContent).toBe('ctx 258k · 65% left35% · 90k/258k')
        expect(trigger.className.split(' ')).not.toContain('hidden')
        const progressTrack = trigger.querySelector('[aria-hidden="true"]')
        expect((progressTrack?.firstElementChild as HTMLElement | null)?.style.width).toBe('35%')

        fireEvent.click(trigger)

        const cacheLine = await screen.findByText('缓存：86k')
        const details = cacheLine.parentElement
        expect(details?.textContent).toBe('缓存：86k使用：90k（35%）剩余：168k（65%）')
        expect(screen.queryByText('上下文详情')).toBeNull()
    })

    it('localizes the popover content without localizing the external left label', async () => {
        localStorage.setItem('hapi-lang', 'en')
        render(
            <I18nProvider>
                <StatusBar
                    active
                    thinking={false}
                    agentState={null}
                    contextSize={90_000}
                    contextCacheRead={86_000}
                    contextWindow={258_000}
                />
            </I18nProvider>
        )

        const trigger = screen.getByRole('button', { name: 'Context details' })
        expect(trigger.textContent).toContain('ctx 258k · 65% left')

        fireEvent.click(trigger)

        const cacheLine = await screen.findByText('Cache: 86k')
        expect(cacheLine.parentElement?.textContent).toBe('Cache: 86kUsed: 90k (35%)Remaining: 168k (65%)')
    })
})
