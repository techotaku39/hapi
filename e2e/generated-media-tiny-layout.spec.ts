import { expect, test, type Page } from '@playwright/test'

const fixtureUrl = '/e2e-fixtures/generated-media-tiny-fixture.html'
const card = '[data-hapi-generated-media-id="tiny-16x32"]'
const image = `${card} img`

// The card commits the enlarged inline size from a separate image probe
// (ToolMessage.tsx), so the img can be visible at its intrinsic 16x32 first.
// Poll for the scaled box before either geometry test measures it.
async function waitForScaledBox(page: Page) {
    await expect.poll(async () => page.locator(image).evaluate((element) => {
        const rect = element.getBoundingClientRect()
        return `${Math.round(rect.width)}x${Math.round(rect.height)}`
    })).toBe('32x64')
}

// The jsdom suite can only prove which inline style we set. These specs measure
// the real box: a tiny preview enlarged with `transform: scale()` paints outside
// the space its `w-fit` card reserves, so the card would overlap the following
// chat content instead of pushing it down.
test.describe('generated media tiny preview geometry', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto(fixtureUrl)
        await expect(page.locator(image)).toBeVisible()
    })

    test('reserves the painted size in layout flow for a skinny tiny image', async ({ page }) => {
        await waitForScaledBox(page)
        const probe = await page.locator(image).evaluate((element) => {
            const img = element as HTMLImageElement
            const rect = img.getBoundingClientRect()
            return {
                naturalWidth: img.naturalWidth,
                naturalHeight: img.naturalHeight,
                width: rect.width,
                height: rect.height,
                transform: getComputedStyle(img).transform
            }
        })

        expect(probe.naturalWidth).toBe(16)
        expect(probe.naturalHeight).toBe(32)
        // 16x32 doubles to 32x64 (MIN_INLINE_IMAGE_DIMENSION / maxDim).
        expect(probe.width).toBeCloseTo(32, 1)
        expect(probe.height).toBeCloseTo(64, 1)
        // A transform would make the painted box diverge from the layout box.
        expect(probe.transform).toBe('none')
    })

    test('keeps the enlarged image inside its card and clear of following content', async ({ page }) => {
        await waitForScaledBox(page)
        const geometry = await page.evaluate((cardSelector) => {
            const cardElement = document.querySelector(cardSelector)!
            const imageElement = cardElement.querySelector('img')!
            const follower = document.querySelector('[data-testid="follower"]')!
            const cardRect = cardElement.getBoundingClientRect()
            const imageRect = imageElement.getBoundingClientRect()
            const followerRect = follower.getBoundingClientRect()
            return {
                imageBottom: imageRect.bottom,
                imageRight: imageRect.right,
                cardBottom: cardRect.bottom,
                cardRight: cardRect.right,
                followerTop: followerRect.top
            }
        }, card)

        // The image must not paint past its own card box.
        expect(geometry.imageBottom).toBeLessThanOrEqual(geometry.cardBottom + 0.5)
        expect(geometry.imageRight).toBeLessThanOrEqual(geometry.cardRight + 0.5)
        // Following content must start below the card, never on top of it.
        expect(geometry.followerTop).toBeGreaterThanOrEqual(geometry.cardBottom - 0.5)
    })
})

test.describe('generated media unavailable state', () => {
    test('keeps the error panel inside a narrow card', async ({ page }) => {
        await page.goto(`${fixtureUrl}?fail=1&width=200`)
        const retry = page.locator('[data-hapi-share-action="true"]')
        await expect(retry).toBeVisible()

        const geometry = await page.evaluate((cardSelector) => {
            const cardElement = document.querySelector(cardSelector)!
            const panel = cardElement.querySelector('[data-hapi-share-action="true"]')!.parentElement!
            const cardRect = cardElement.getBoundingClientRect()
            const panelRect = panel.getBoundingClientRect()
            return {
                cardLeft: cardRect.left,
                cardRight: cardRect.right,
                cardWidth: cardRect.width,
                panelLeft: panelRect.left,
                panelRight: panelRect.right,
                panelWidth: panelRect.width
            }
        }, card)

        // A 200px chat column caps the card at 92%; the panel has to fit inside.
        expect(geometry.cardWidth).toBeLessThan(200)
        expect(geometry.panelWidth).toBeLessThanOrEqual(geometry.cardWidth)
        expect(geometry.panelLeft).toBeGreaterThanOrEqual(geometry.cardLeft - 0.5)
        expect(geometry.panelRight).toBeLessThanOrEqual(geometry.cardRight + 0.5)
    })
})
