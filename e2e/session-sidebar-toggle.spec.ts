import { expect, test, type Page } from '@playwright/test'

const splitViewport = { width: 1024, height: 768 }

async function assertTouchToggle(page: Page) {
    await page.goto('/e2e-fixtures/session-sidebar-toggle-fixture.html')

    const modes = await page.evaluate(() => ({
        width: window.innerWidth,
        hasTouch: navigator.maxTouchPoints > 0,
        coarsePointer: window.matchMedia('(pointer: coarse)').matches,
        anyCoarsePointer: window.matchMedia('(any-pointer: coarse)').matches,
    }))
    expect(modes).toMatchObject({ width: 1024, hasTouch: true })
    expect(modes.coarsePointer || modes.anyCoarsePointer).toBe(true)

    const hideButton = page.getByRole('button', { name: 'Hide session list' })
    await expect(hideButton).toBeVisible()
    await expect(hideButton).toHaveCSS('pointer-events', 'auto')

    await hideButton.tap()
    await expect(page.getByRole('button', { name: 'Show session list' })).toBeVisible()

    await page.getByRole('button', { name: 'Show session list' }).tap()
    await expect(hideButton).toBeVisible()
}

test.describe('session sidebar toggle', () => {
    test.describe('coarse primary pointer', () => {
        test.use({
            viewport: splitViewport,
            isMobile: true,
            hasTouch: true,
        })

        test('keeps the hide action visible and tappable on split layouts', async ({ page }) => {
            await assertTouchToggle(page)
        })
    })
})
