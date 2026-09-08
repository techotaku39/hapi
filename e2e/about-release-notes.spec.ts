import { expect, test } from '@playwright/test'

const fixture = '/e2e-fixtures/about-fixture.html'

test('renders localized release announcements on the mobile About page', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(fixture)

    await expect(page.getByText("What's New")).toBeVisible()
    await expect(page.locator('details')).toHaveCount(74)
    const releaseSummary = page.locator('details').first().locator('p').first()
    await expect(releaseSummary).toContainText('Codex now supports mid-turn steering, while Pi session controls follow model capabilities and compaction no longer leaves stale context usage on screen.')
    await expect(releaseSummary.getByText('🌟', { exact: true })).toBeVisible()
    await expect(releaseSummary.getByText('⭐', { exact: true })).toBeHidden()
    await page.setViewportSize({ width: 1280, height: 844 })
    await expect(releaseSummary.getByText('🌟', { exact: true })).toBeHidden()
    await expect(releaseSummary.getByText('⭐', { exact: true })).toBeVisible()
    await expect(page.locator('details').first().getByText('Added', { exact: true }).first()).toHaveClass(/sm:top-\[0\.5px\]/)
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(releaseSummary.getByText('🌟', { exact: true })).toBeVisible()
    await expect(page.getByText('Deliver one queued message into an active Codex turn through app-server turn/steer without interrupting or waiting for the turn to finish.')).toBeVisible()
    await expect(page.locator('details').first().getByText('Added', { exact: true }).first()).toBeVisible()
    await expect(page.locator('time[datetime="2026-08-19"]')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Open release page for v0.29.0' })).toHaveAttribute('href', 'https://github.com/tiann/hapi/releases/tag/v0.29.0')
    await expect(page.getByText('View full release notes', { exact: true })).toHaveCount(0)

    const summary = page.locator('details').first().locator('summary')
    const summaryBox = await summary.boundingBox()
    if (!summaryBox) throw new Error('Could not measure the latest release summary')
    await page.mouse.click(summaryBox.x + summaryBox.width * 0.55, summaryBox.y + summaryBox.height / 2)
    await expect(page.context().pages()).toHaveLength(1)
    await expect(page).toHaveURL(/about-fixture\.html/)
    await expect(page.locator('details').first()).not.toHaveAttribute('open')

    await page.evaluate(() => window.localStorage.setItem('hapi-lang', 'zh-CN'))
    await page.reload()
    await expect(page.getByRole('heading', { name: '更新公告' })).toBeVisible()
    await expect(page.locator('details')).toHaveCount(74)
    await expect(page.locator('details').first().locator('p').first()).toContainText('Codex 现在支持回合中介入；Pi 会话控制会根据模型能力调整，压缩后也不再显示过期的上下文用量。')
    await expect(page.getByText('通过 app-server turn/steer 将一条队列消息插入当前 Codex 回合，无需中断或等待当前回合结束。')).toBeVisible()
    await expect(page.locator('details').first().getByText('新增', { exact: true }).first()).toBeVisible()
    await expect(page.getByRole('link', { name: '打开 v0.29.0 发行页' })).toBeVisible()
    await expect(page.getByText('查看完整发行说明', { exact: true })).toHaveCount(0)
})
