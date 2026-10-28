import { expect, test } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

test.use({ serviceWorkers: 'block' })
test.setTimeout(90_000)

for (const viewport of [{ width: 1280, height: 900 }, { width: 412, height: 915 }]) {
    test(`list/detail catch-up preserves the real chat at ${viewport.width}px`, async ({ page }) => {
        page.on('pageerror', error => console.error('Browser error:', error.message))
        await page.setViewportSize(viewport)
        await page.addInitScript(() => {
            localStorage.setItem('hapi_access_token::' + location.origin, 'fixture-token')
            localStorage.setItem('hapi-language', 'en')
            localStorage.setItem('hapi.fue.v1.rich-composer-mentions', '1')
            class FixtureEventSource {
                static CONNECTING = 0
                static OPEN = 1
                static CLOSED = 2
                readyState = 0
                onopen: (() => void) | null = null
                onmessage: ((event: MessageEvent) => void) | null = null
                onerror: (() => void) | null = null
                constructor(_url: string) {}
                close() { this.readyState = 2 }
            }
            Object.defineProperty(window, 'EventSource', { value: FixtureEventSource })
        })
        let detailRequests = 0
        let releaseDetail!: () => void
        const blocked = new Promise<void>(resolve => { releaseDetail = resolve })
        await page.route('**/api/**', async route => {
            const path = new URL(route.request().url()).pathname
            if (!path.startsWith('/api/')) {
                await route.continue()
                return
            }
            let body: unknown = {}
            if (path === '/api/auth') {
                const payload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')
                body = { token: `fixture.${payload}.signature`, user: { id: 'fixture', namespace: 'default' } }
            } else if (path === '/api/sessions/session-refresh') {
                detailRequests++
                await blocked
                await route.abort()
                return
            } else if (path.endsWith('/messages')) {
                const messages = Array.from({ length: 20 }, (_, i) => ({
                    id: `message-${i}`, seq: i + 1, localId: null,
                    createdAt: 1_700_000_000_000 + i, invokedAt: 1_700_000_000_000 + i,
                    isSidechain: false, content: { role: 'user', content: { type: 'text', text: `Fixture message ${i}: ${'conversation history '.repeat(20)}` } },
                }))
                body = { messages, page: { hasMore: false, nextBeforeSeq: null, nextBeforeAt: null, newestSeq: 20, newestAt: 1_700_000_000_019, epoch: 0, reset: false } }
            } else if (path === '/api/sessions') {
                await route.abort()
                return
            } else if (path === '/api/machines') body = { machines: [] }
            else if (path.endsWith('/scratchlist')) body = { entries: [], version: 0 }
            else if (path === '/api/voice/backend') body = { backend: null, backends: [] }
            else if (path.endsWith('/queued-state')) body = { queuedLocalIds: [], indeterminateLocalIds: [] }
            else if (path.endsWith('/slash-commands')) body = { success: true, commands: [] }
            else if (path.endsWith('/skills')) body = { success: true, skills: [] }
            else if (path.includes('voice')) body = { providers: [], enabled: false }
            else if (path.includes('push')) body = { enabled: false, publicKey: null }
            await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
        })
        await page.goto('/e2e-fixtures/session-refresh-fixture.html', { waitUntil: 'domcontentloaded' })
        const composer = page.getByRole('textbox').first()
        await expect(composer).toBeVisible({ timeout: 20_000 })
        await composer.fill('unsent browser draft')
        const original = await composer.elementHandle()
        const viewportElement = page.locator('.app-scroll-y').last()
        await expect(page.getByText(/^Fixture message 19:/)).toBeVisible()
        await viewportElement.dispatchEvent('pointerdown', { button: 0, pointerType: 'mouse' })
        await viewportElement.evaluate(el => {
            el.scrollTop = Math.max(0, el.scrollHeight / 3)
            el.dispatchEvent(new Event('scroll'))
        })
        await viewportElement.dispatchEvent('pointerup', { button: 0, pointerType: 'mouse' })
        const scrollBefore = await viewportElement.evaluate(el => el.scrollTop)
        const navigationCount = await page.evaluate(() => performance.getEntriesByType('navigation').length)
        await page.evaluate(() => window.sessionRefreshProbe.advance())
        await expect(page.locator('[aria-busy="true"][inert]')).toBeVisible()
        await expect.poll(() => detailRequests).toBeGreaterThan(0)
        await expect(page.getByText('Loading session…', { exact: true })).toHaveCount(0)
        expect(await composer.evaluate((el, previous) => el === previous, original)).toBe(true)
        await expect(composer).toHaveText('unsent browser draft')
        expect(await viewportElement.evaluate(el => el.scrollTop)).toBe(scrollBefore)
        if (process.env.HAPI_SESSION_REFRESH_SCREENSHOTS) {
            await mkdir(process.env.HAPI_SESSION_REFRESH_SCREENSHOTS, { recursive: true })
            await page.screenshot({ path: join(process.env.HAPI_SESSION_REFRESH_SCREENSHOTS, `${viewport.width}-syncing.png`) })
        }
        await page.evaluate(() => window.sessionRefreshProbe.catchUp())
        await expect(page.locator('[aria-busy="true"][inert]')).toHaveCount(0)
        expect(await composer.evaluate((el, previous) => el === previous, original)).toBe(true)
        await expect(composer).toHaveText('unsent browser draft')
        expect(await page.evaluate(() => performance.getEntriesByType('navigation').length)).toBe(navigationCount)
        if (process.env.HAPI_SESSION_REFRESH_SCREENSHOTS) {
            await page.screenshot({ path: join(process.env.HAPI_SESSION_REFRESH_SCREENSHOTS, `${viewport.width}-restored.png`) })
        }
        releaseDetail()
    })
}
