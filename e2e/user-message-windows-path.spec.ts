import { expect, test } from '@playwright/test'

const path = String.raw`D:\Projects\demo\.front`
const option = String.raw`--path=D:\_work\.front`
const localized = String.raw`路径：D:\_work\_cache\.front`
const labeled = String.raw`Path:D:\_work\.front`
const plain = String.raw`D:\_work\.env.local`
const linkable = String.raw`D:\_work\.env`

for (const viewport of [{ width: 1280, height: 720 }, { width: 390, height: 844 }]) {
    test(`renders a literal Windows path in the user bubble at ${viewport.width}px`, async ({ page }) => {
        const pageErrors: string[] = []
        page.on('pageerror', (error) => pageErrors.push(error.message))
        await page.setViewportSize(viewport)
        await page.goto('/e2e-fixtures/user-message-windows-path-fixture.html')

        const bubble = page.getByTestId('user-message')
        await expect(bubble).toBeVisible()
        const screenshotDirectory = process.env.HAPI_WINDOWS_PATH_SCREENSHOTS
        if (screenshotDirectory) {
            await page.locator('main').screenshot({ path: `${screenshotDirectory}/user-bubble-${viewport.width}.png` })
        }

        await expect(bubble).toHaveText(`Please check ${path}\n${option}\n${localized}\n${labeled}\n${plain}\n${linkable}\nUse * as a literal asterisk.`, { useInnerText: true })
        await expect(bubble.locator('br')).toHaveCount(6)
        const selection = await bubble.evaluate((element) => {
            const range = document.createRange()
            range.selectNodeContents(element)
            const selection = window.getSelection()!
            selection.removeAllRanges()
            selection.addRange(range)
            return selection.toString()
        })
        expect(selection).toContain(path)
        expect(selection).toContain(option)
        expect(selection).toContain(localized)
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        const link = bubble.getByRole('link', { name: linkable, exact: true })
        await expect(bubble.getByRole('link')).toHaveCount(1)
        await link.click()
        await expect(page.getByTestId('file-target')).toHaveText(linkable)
        expect(pageErrors).toEqual([])
    })
}
