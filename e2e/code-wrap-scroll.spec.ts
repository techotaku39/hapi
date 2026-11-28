import { join } from 'node:path'
import { expect, test } from '@playwright/test'

for (const { name, width, height, hasTouch } of [
    { name: 'mobile', width: 390, height: 844, hasTouch: true },
    { name: 'desktop', width: 1024, height: 768, hasTouch: false },
]) {
    test.describe(name, () => {
        test.use({ viewport: { width, height }, hasTouch, isMobile: hasTouch })

        test('keeps the clicked code-block header in place as earlier code blocks rewrap', async ({ page }) => {
            const errors: string[] = []
            page.on('pageerror', error => errors.push(error.message))
            await page.goto('/e2e-fixtures/history-load-fixture.html?navigationShell=1&codeWrap=1')
            const viewport = page.locator('.chat-scroll-y')
            const messages = viewport.locator('.happy-thread-messages > [id]')
            const earlierBlock = messages.filter({ hasText: 'Earlier code block 1130' })
            const target = messages.filter({ hasText: 'Code block to keep in view' })
            const matches = '[data-hapi-code-wrap-toggle="true"]'
            const earlierToggle = earlierBlock.locator(matches)
            const toggle = target.locator(matches)
            const earlierGrid = earlierBlock.locator('[data-hapi-code-grid="true"]')
            const top = () => toggle.evaluate(el => el.getBoundingClientRect().top)
            const gridHeight = () => earlierGrid.evaluate(el => el.getBoundingClientRect().height)
            const screenshot = async (phase: string) => {
                const directory = process.env.HAPI_CODE_WRAP_SCREENSHOT_DIR
                if (directory) {
                    await page.screenshot({ path: join(directory, `${name}-${phase}.png`) })
                }
            }

            await expect(page.getByText('Fixture message 1200', { exact: true })).toBeVisible()
            await expect.poll(() => viewport.evaluate(el => el.scrollHeight - el.clientHeight - el.scrollTop)).toBeLessThanOrEqual(1)
            await expect(toggle).toHaveAttribute('aria-pressed', 'false')
            // Model an upward drag so initial tail settling does not reclaim the viewport.
            await viewport.dispatchEvent('pointerdown', { button: 0, pointerType: hasTouch ? 'touch' : 'mouse' })
            await toggle.evaluate(el => {
                const scroller = el.closest('.chat-scroll-y')!
                scroller.scrollTop += el.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 125
            })
            await expect(page.getByRole('button', { name: 'Scroll to bottom', exact: true })).toBeVisible()
            await viewport.dispatchEvent('pointerup', { button: 0, pointerType: hasTouch ? 'touch' : 'mouse' })
            await expect(toggle).toBeInViewport({ ratio: 1 })
            const initialTop = await top()
            const unwrappedHeight = await gridHeight()
            await screenshot('before-toggle')

            for (const wrapped of [true, false]) {
                if (hasTouch) await toggle.tap()
                else await toggle.click()
                await expect(toggle).toHaveAttribute('aria-pressed', String(wrapped))
                await expect(earlierToggle).toHaveAttribute('aria-pressed', String(wrapped))
                if (wrapped) expect(await gridHeight()).toBeGreaterThan(unwrappedHeight + 50)
                else expect(await gridHeight()).toBe(unwrappedHeight)
                await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
                await screenshot(wrapped ? 'wrap-on' : 'wrap-off')
                await expect.poll(async () => Math.abs(await top() - initialTop)).toBeLessThanOrEqual(2)
                await expect(toggle).toBeInViewport({ ratio: 1 })
            }
            expect(errors).toEqual([])
        })
    })
}
