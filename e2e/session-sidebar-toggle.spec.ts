import { expect, test } from '@playwright/test'

test.describe('session sidebar toggle', () => {
    test.use({
        viewport: { width: 1024, height: 768 },
        isMobile: true,
        hasTouch: true,
    })

    test('keeps the hide action visible and tappable on coarse-pointer split layouts', async ({ page }) => {
        await page.goto('/e2e-fixtures/session-sidebar-toggle-fixture.html')

        await expect.poll(() => page.evaluate(() => ({
            width: window.innerWidth,
            hasTouch: navigator.maxTouchPoints > 0,
            coarsePointer: window.matchMedia('(pointer: coarse)').matches,
        }))).toEqual({ width: 1024, hasTouch: true, coarsePointer: true })

        const hideButton = page.getByRole('button', { name: 'Hide session list' })
        await expect(hideButton).toBeVisible()
        await expect(hideButton).toHaveCSS('pointer-events', 'auto')

        await hideButton.tap()
        await expect(page.getByRole('button', { name: 'Show session list' })).toBeVisible()

        await page.getByRole('button', { name: 'Show session list' }).tap()
        await expect(hideButton).toBeVisible()
    })
})
