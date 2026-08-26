import { expect, test } from '@playwright/test'

test.describe('markdown table actions', () => {
    test('opens a viewport-sized PC viewer and downloads the CSV', async ({ page }) => {
        await page.goto('/e2e-fixtures/markdown-table-fixture.html')

        const inlineTable = page.locator('[data-testid="markdown-table-fixture"] table')
        await expect(inlineTable).toBeVisible()
        await expect(inlineTable.locator('thead')).toBeVisible()

        const tableFrame = page.locator('[data-testid="markdown-table-fixture"] .aui-md-table-frame')
        const actions = tableFrame.locator('.aui-md-table-actions')
        await expect(actions).toBeAttached()
        await expect(actions.getByRole('button')).toHaveCount(1)
        const inlineButtonStyles = await actions.getByRole('button').evaluate((element) => {
            const style = getComputedStyle(element)
            return { backgroundColor: style.backgroundColor, borderWidth: style.borderTopWidth, backdropFilter: style.backdropFilter }
        })
        expect(inlineButtonStyles.backgroundColor).toMatch(/rgba\(0, 0, 0, 0\)|transparent/)
        expect(inlineButtonStyles.borderWidth).toBe('0px')
        expect(inlineButtonStyles.backdropFilter).toBe('none')
        await expect.poll(() => actions.evaluate((element) => {
            const style = getComputedStyle(element)
            return `${style.top}:${style.right}`
        })).toBe('3px:3px')
        await expect.poll(() => actions.evaluate((element) => getComputedStyle(element).opacity)).toBe('0')
        await tableFrame.hover()
        await expect.poll(() => actions.evaluate((element) => getComputedStyle(element).opacity)).toBe('1')

        await page.getByRole('button', { name: 'Open table full screen' }).click()
        const dialog = page.getByRole('dialog', { name: 'Table filename fixture' })
        await expect(dialog).toBeVisible()

        const viewerHeading = dialog.locator('[data-hapi-table-viewer-heading="true"]')
        await expect(viewerHeading).toHaveText('Table filename fixture')
        await expect.poll(() => viewerHeading.evaluate((element) => getComputedStyle(element).fontSize)).toBe('18px')
        await expect.poll(() => viewerHeading.evaluate((element) => getComputedStyle(element).transform)).toBe('matrix(1, 0, 0, 1, 0, -1)')
        const toolbar = dialog.locator('[data-hapi-table-viewer-toolbar="true"]')
        await expect.poll(() => toolbar.evaluate((element) => getComputedStyle(element).borderBottomWidth)).toBe('0px')
        await expect.poll(() => toolbar.evaluate((element) => `${getComputedStyle(element).paddingLeft}:${getComputedStyle(element).paddingRight}`)).toBe('6px:6px')
        await expect.poll(() => toolbar.evaluate((element) => getComputedStyle(element).columnGap)).toBe('4px')
        await expect.poll(() => toolbar.evaluate((element) => getComputedStyle(element).paddingTop)).toBe('0px')
        await expect.poll(() => toolbar.evaluate((element) => getComputedStyle(element).paddingBottom)).toBe('0px')
        const toolbarEdges = await toolbar.evaluate((element) => {
            const buttons = element.querySelectorAll('button')
            const first = buttons[0]?.getBoundingClientRect()
            const last = buttons[buttons.length - 1]?.getBoundingClientRect()
            const toolbarRect = element.getBoundingClientRect()
            return {
                leftGap: Math.round((first?.left ?? 0) - toolbarRect.left),
                rightGap: Math.round(toolbarRect.right - (last?.right ?? 0)),
            }
        })
        expect(toolbarEdges).toEqual({ leftGap: 6, rightGap: 6 })

        const box = await dialog.boundingBox()
        expect(box?.width).toBeGreaterThanOrEqual(1400)
        expect(box?.height).toBeGreaterThanOrEqual(850)
        await expect(dialog.locator('[data-hapi-table-viewer="true"] .aui-md-thead')).toBeVisible()
        await expect.poll(async () => {
            const toolbarHeight = (await toolbar.boundingBox())?.height ?? 0
            const headerHeight = await dialog.locator('[data-hapi-table-viewer="true"] thead').evaluate((element) => element.getBoundingClientRect().height)
            return Math.round(toolbarHeight) - Math.round(headerHeight)
        }).toBe(0)
        const viewerLeftOffset = await dialog.locator('[data-hapi-table-viewer="true"]').evaluate((element) => {
            const table = element.querySelector('table')
            if (!table) return -1
            return Math.round(table.getBoundingClientRect().left - element.getBoundingClientRect().left)
        })
        expect(viewerLeftOffset).toBe(0)
        await expect.poll(() => dialog.locator('[data-hapi-table-viewer="true"]').evaluate((element) => getComputedStyle(element).paddingRight)).toBe('0px')
        await expect.poll(() => dialog.locator('[data-hapi-table-viewer="true"]').evaluate((element) => getComputedStyle(element).paddingBottom)).toBe('0px')

        await page.evaluate(() => {
            let copied = ''
            Object.defineProperty(window, '__hapiCopiedTableMarkdown', {
                configurable: true,
                get: () => copied,
            })
            Object.defineProperty(navigator, 'clipboard', {
                configurable: true,
                value: { writeText: async (text: string) => { copied = text } },
            })
        })
        await dialog.getByRole('button', { name: 'Copy table as Markdown' }).click()
        await expect.poll(() => page.evaluate(() => (window as Window & { __hapiCopiedTableMarkdown?: string }).__hapiCopiedTableMarkdown ?? '')).toContain('| Project | Stars |')

        const imageDownloadPromise = page.waitForEvent('download')
        await dialog.getByRole('button', { name: 'Save table as image' }).click()
        const imageDownload = await imageDownloadPromise
        expect(imageDownload.suggestedFilename()).toMatch(/^HAPI Table-Table filename fixture-\d{14}\.png$/)

        const downloadPromise = page.waitForEvent('download')
        await dialog.getByRole('button', { name: 'Download table as CSV' }).click()
        const download = await downloadPromise
        expect(download.suggestedFilename()).toMatch(/^HAPI Table-Table filename fixture-\d{14}\.csv$/)

        await dialog.getByRole('button', { name: 'Close table full screen' }).click()
        await expect(dialog).toBeHidden()
    })
})
