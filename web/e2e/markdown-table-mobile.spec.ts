import { devices, expect, test } from '@playwright/test'

test.use({ ...devices['Pixel 7'] })

test('mobile markdown table viewer requests landscape and releases orientation controls', async ({ page }) => {
    await page.goto('/e2e-fixtures/markdown-table-fixture.html')
    await page.evaluate(() => {
        const state = { requestFullscreen: 0, exitFullscreen: 0, locks: [] as string[], unlocks: 0 }
        Object.defineProperty(window, '__hapiTableViewerState', { configurable: true, value: state })
        Object.defineProperty(document.documentElement, 'requestFullscreen', {
            configurable: true,
            value: () => {
                state.requestFullscreen += 1
                return Promise.resolve()
            },
        })
        Object.defineProperty(document, 'exitFullscreen', {
            configurable: true,
            value: () => {
                state.exitFullscreen += 1
                return Promise.resolve()
            },
        })
        Object.defineProperty(window.screen, 'orientation', {
            configurable: true,
            value: {
                lock: (value: string) => {
                    state.locks.push(value)
                    return Promise.resolve()
                },
                unlock: () => {
                    state.unlocks += 1
                },
            },
        })
    })

    const inlineActions = page.locator('[data-testid="markdown-table-fixture"] .aui-md-table-actions')
    await expect(inlineActions).toBeVisible()
    await expect(inlineActions.getByRole('button')).toHaveCount(1)
    await page.getByRole('button', { name: 'Open table full screen' }).click()
    const dialog = page.getByRole('dialog', { name: 'Table filename fixture' })
    await expect(dialog).toBeVisible()
    // A real mobile browser can rotate to a landscape CSS viewport. Keep the
    // mobile title unshifted even when its width becomes desktop-sized.
    await page.setViewportSize({ width: 915, height: 412 })
    await expect(dialog.getByRole('button', { name: 'Copy table as Markdown' })).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Save table as image' })).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Download table as CSV' })).toBeVisible()
    await expect.poll(() => dialog.locator('[data-hapi-table-viewer-toolbar="true"]').evaluate((element) => {
        const style = getComputedStyle(element)
        return `${style.paddingLeft}:${style.paddingRight}:${style.paddingTop}:${style.paddingBottom}`
    })).toBe('6px:6px:0px:0px')
    await expect.poll(() => dialog.locator('[data-hapi-table-viewer-toolbar="true"]').evaluate((element) => getComputedStyle(element).columnGap)).toBe('4px')
    await expect.poll(() => dialog.locator('[data-hapi-table-viewer-heading="true"]').evaluate((element) => getComputedStyle(element).transform)).toBe('none')
    await expect.poll(() => dialog.locator('[data-hapi-table-viewer="true"] thead th').first().evaluate((element) => {
        const thead = element.closest('thead')
        return `${getComputedStyle(thead ?? element).position}:${getComputedStyle(element).position}:${getComputedStyle(element).top}`
    })).toBe('static:sticky:0px')
    await expect.poll(() => page.evaluate(() => {
        const state = (window as Window & { __hapiTableViewerState?: { requestFullscreen: number; locks: string[] } }).__hapiTableViewerState
        return state ? `${state.requestFullscreen}:${state.locks.join(',')}` : ''
    })).toBe('1:landscape')

    const imageDownloadPromise = page.waitForEvent('download')
    await dialog.getByRole('button', { name: 'Save table as image' }).click()
    const imageDownload = await imageDownloadPromise
    expect(imageDownload.suggestedFilename()).toMatch(/^HAPI Table-Table filename fixture-\d{14}\.png$/)

    const csvDownloadPromise = page.waitForEvent('download')
    await dialog.getByRole('button', { name: 'Download table as CSV' }).click()
    const csvDownload = await csvDownloadPromise
    expect(csvDownload.suggestedFilename()).toMatch(/^HAPI Table-Table filename fixture-\d{14}\.csv$/)

    await dialog.getByRole('button', { name: 'Close table full screen' }).click()
    await expect.poll(() => page.evaluate(() => {
        const state = (window as Window & { __hapiTableViewerState?: { exitFullscreen: number; unlocks: number } }).__hapiTableViewerState
        return state ? `${state.exitFullscreen}:${state.unlocks}` : ''
    })).toBe('1:1')
})

test('mobile markdown table viewer detects a phone that starts in landscape', async ({ page }) => {
    await page.setViewportSize({ width: 915, height: 412 })
    await page.goto('/e2e-fixtures/markdown-table-fixture.html')
    await expect(page.getByRole('button', { name: 'Open table full screen' })).toBeVisible()
    await page.evaluate(() => {
        const state = { requestFullscreen: 0, locks: [] as string[] }
        Object.defineProperty(window, '__hapiTableViewerState', { configurable: true, value: state })
        Object.defineProperty(document.documentElement, 'requestFullscreen', {
            configurable: true,
            value: () => {
                state.requestFullscreen += 1
                return Promise.resolve()
            },
        })
        Object.defineProperty(window.screen, 'orientation', {
            configurable: true,
            value: {
                lock: (value: string) => {
                    state.locks.push(value)
                    return Promise.resolve()
                },
                unlock: () => {},
            },
        })
    })

    await page.getByRole('button', { name: 'Open table full screen' }).click()
    await expect(page.getByRole('dialog', { name: 'Table filename fixture' })).toBeVisible()
    await expect.poll(() => page.evaluate(() => {
        const state = (window as Window & { __hapiTableViewerState?: { requestFullscreen: number; locks: string[] } }).__hapiTableViewerState
        return state ? `${state.requestFullscreen}:${state.locks.join(',')}` : ''
    })).toBe('1:landscape')
})
