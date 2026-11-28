import { expect, test } from '@playwright/test'

const path = String.raw`D:\Projects\demo\.front`
const option = String.raw`--path=D:\_work\.front`
const localized = String.raw`路径：D:\_work\_cache\.front`
const labeled = String.raw`Path:D:\_work\.front`
const plain = String.raw`D:\_work\.env.local`
const fragmentLike = String.raw`D:\_work\.env#backup.md`
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

        await expect(bubble).toHaveText(`Please check ${path}\n${option}\n${localized}\n${labeled}\n${plain}\n${fragmentLike}\nOpen ${linkable}: settings\nUse * as a literal asterisk.`, { useInnerText: true })
        await expect(bubble.locator('br')).toHaveCount(7)
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
        const mathBubble = page.getByTestId('user-message-with-math')
        await expect(mathBubble).toContainText(String.raw`D:\_work\.front,`)
        await expect(mathBubble.locator('.katex')).toHaveCount(1)
        await expect(mathBubble).not.toContainText(/[\uE000-\uF8FF]/u)
        const displayMath = page.getByTestId('user-message-with-display-math')
        await expect(displayMath).toContainText(String.raw`See 《D:\_work\.front》.`)
        await expect(displayMath.locator('.katex-display')).toHaveCount(1)
        await expect(displayMath).not.toContainText(/[\uE000-\uF8FF]/u)
        await expect(page.getByTestId('user-message-adjacent-paths')).toHaveText(String.raw`(D:\repo\.front),(E:\repo\.cache)`)
        const link = bubble.getByRole('link', { name: linkable, exact: true })
        await expect(bubble.getByRole('link')).toHaveCount(1)
        await link.click()
        await expect(page.getByTestId('file-target')).toHaveText(linkable)
        expect(pageErrors).toEqual([])
    })
}
