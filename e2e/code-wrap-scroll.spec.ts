import { join } from 'node:path'
import { expect, test, type Locator, type Page } from '@playwright/test'

async function saveScreenshot(page: Page, name: string) {
    const directory = process.env.HAPI_CODE_WRAP_SCREENSHOT_DIR
    if (directory) await page.screenshot({ path: join(directory, `${name}.png`) })
}

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

            await expect(page.getByText('Fixture message 1200', { exact: true })).toBeInViewport()
            await page.getByRole('button', { name: 'Open history', exact: true }).click()
            const outlineSearch = page.getByRole('searchbox', { name: 'Search outline items' })
            await outlineSearch.fill('Fixture message 1149')
            await page.getByRole('button', { name: /Fixture message 1149/ }).click()
            await expect(outlineSearch).toHaveCount(0)
            const anchor = messages.filter({ hasText: 'Fixture message 1149' })
            await expect.poll(() => anchor.evaluate(el => Math.abs(
                el.getBoundingClientRect().top - el.closest('.chat-scroll-y')!.getBoundingClientRect().top
                - Number.parseFloat(getComputedStyle(el).scrollMarginTop)
            ))).toBeLessThanOrEqual(2)
            await expect(toggle).toHaveAttribute('aria-pressed', 'false')
            await expect(toggle).toBeInViewport({ ratio: 1 })
            const initialTop = await top()
            const unwrappedHeight = await gridHeight()
            await saveScreenshot(page, `${name}-before-toggle`)

            for (const wrapped of [true, false]) {
                if (hasTouch) await toggle.tap()
                else await toggle.click()
                await expect(toggle).toHaveAttribute('aria-pressed', String(wrapped))
                await expect(earlierToggle).toHaveAttribute('aria-pressed', String(wrapped))
                if (wrapped) expect(await gridHeight()).toBeGreaterThan(unwrappedHeight + 50)
                else expect(await gridHeight()).toBe(unwrappedHeight)
                await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
                await saveScreenshot(page, `${name}-${wrapped ? 'wrap-on' : 'wrap-off'}`)
                await expect.poll(async () => Math.abs(await top() - initialTop)).toBeLessThanOrEqual(2)
                await expect(toggle).toBeInViewport({ ratio: 1 })
            }
            expect(errors).toEqual([])
        })
    })
}

async function placeInHistory(page: Page, target: Locator) {
    const viewport = page.locator('.chat-scroll-y')
    await expect(page.getByText('Fixture message 1200', { exact: true })).toBeInViewport()
    await expect.poll(() => viewport.evaluate(el => el.scrollHeight - el.clientHeight - el.scrollTop)).toBeLessThanOrEqual(1)
    await viewport.dispatchEvent('pointerdown', { button: 0, pointerType: 'mouse' })
    await target.evaluate(el => {
        const scroller = el.closest('.chat-scroll-y')!
        scroller.scrollTop += el.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 100
    })
    const jump = page.getByRole('button', { name: 'Scroll to bottom', exact: true })
    await expect(jump).toBeVisible()
    await viewport.dispatchEvent('pointerup', { button: 0, pointerType: 'mouse' })
    return { viewport, jump }
}

test('keeps the target visible in a nested reasoning panel when both scroll containers reflow', async ({ page }) => {
    await page.goto('/e2e-fixtures/history-load-fixture.html?navigationShell=1&codeWrap=reasoning')
    const reasoningToggle = page.getByRole('button', { name: 'Reasoning', exact: true })
    await placeInHistory(page, reasoningToggle)
    await reasoningToggle.click()
    const nested = page.locator('[data-hapi-nested-scroll="true"]')
    const toggle = nested.locator('[data-hapi-code-wrap-toggle="true"]').nth(1)
    await expect(toggle).toHaveAttribute('aria-pressed', 'false')
    const measure = () => toggle.evaluate(el => ({
        top: el.getBoundingClientRect().top,
        nestedOffset: el.getBoundingClientRect().top - el.closest('[data-hapi-nested-scroll="true"]')!.getBoundingClientRect().top,
    }))
    await expect(toggle).toBeInViewport({ ratio: 1 })
    const before = await measure()
    for (const wrap of [true, false]) {
        await toggle.click()
        await expect(toggle).toHaveAttribute('aria-pressed', String(wrap))
        await expect.poll(async () => Math.abs((await measure()).nestedOffset - before.nestedOffset)).toBeLessThanOrEqual(2)
        await expect.poll(async () => Math.abs((await measure()).top - before.top)).toBeLessThanOrEqual(2)
        await expect(toggle).toBeInViewport({ ratio: 1 })
        await saveScreenshot(page, `nested-reasoning-wrap-${wrap ? 'on' : 'off'}`)
    }
})

test('lets an in-progress jump to the latest message finish when wrap is turned off', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('hapi-code-wrap', '1'))
    await page.goto('/e2e-fixtures/history-load-fixture.html?navigationShell=1&codeWrap=1')
    const toggle = page.locator('.happy-thread-messages > [id]').filter({ hasText: 'Code block to keep in view' })
        .locator('[data-hapi-code-wrap-toggle="true"]')
    const { viewport, jump } = await placeInHistory(page, toggle)
    await expect(toggle).toBeInViewport({ ratio: 1 })
    await expect(toggle).toHaveAttribute('aria-pressed', 'true')
    // Start the real smooth scroll and toggle before its first animation frame,
    // without Playwright scrolling the code block back into view on our behalf.
    const jumpElement = await jump.elementHandle()
    await toggle.evaluate((element, button) => {
        const toggleButton = element as HTMLButtonElement
        button.click()
        toggleButton.click()
    }, jumpElement!)
    await expect(toggle).toHaveAttribute('aria-pressed', 'false')
    await expect.poll(() => viewport.evaluate(el => el.scrollHeight - el.clientHeight - el.scrollTop)).toBeLessThanOrEqual(1)
    await expect(page.getByText('Fixture message 1200', { exact: true })).toBeInViewport()
    await saveScreenshot(page, 'jump-to-latest-wrap-off')
})
