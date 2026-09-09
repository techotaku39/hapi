import { expect, test } from '@playwright/test'

const fixture = '/e2e-fixtures/about-fixture.html'

test('renders localized release announcements on the mobile About page', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(fixture)

    await expect(page.getByText("What's New")).toBeVisible()
    await expect(page.locator('details')).toHaveCount(75)
    const releaseSummary = page.locator('details').first().locator('p').first()
    await expect(releaseSummary).toContainText('Add Cursor Steer, DeepSeek Harness, remote Codex MCP and Luna fallback, richer session controls, and attachment/export tools; improve usage visibility, streaming, rewind, and cross-platform reliability.')
    await expect(releaseSummary.getByText('🌟', { exact: true })).toBeVisible()
    await expect(releaseSummary.getByText('⭐', { exact: true })).toBeHidden()
    await page.setViewportSize({ width: 1280, height: 844 })
    await expect(releaseSummary.getByText('🌟', { exact: true })).toBeHidden()
    await expect(releaseSummary.getByText('⭐', { exact: true })).toBeVisible()
    await expect(page.locator('details').first().getByText('Added', { exact: true }).first()).toHaveClass(/sm:top-\[0\.5px\]/)
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(releaseSummary.getByText('🌟', { exact: true })).toBeVisible()
    await expect(page.getByText('Steer an active Cursor turn through a concurrent ACP prompt without canceling the turn in progress.')).toBeVisible()
    await expect(page.locator('details').first().getByText('Added', { exact: true }).first()).toBeVisible()
    await expect(page.locator('time[datetime="2026-09-09"]')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Open release page for v0.29.1' })).toHaveAttribute('href', 'https://github.com/tiann/hapi/releases/tag/v0.29.1')
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
    await expect(page.locator('details')).toHaveCount(75)
    await expect(page.locator('details').first().locator('p').first()).toContainText('增加 Cursor Steer、DeepSeek Harness、远程 Codex MCP 与 Luna 回退、更丰富的会话控制及附件/导出工具；改进用量展示、流式处理、rewind 和跨平台可靠性。')
    await expect(page.getByText('通过并发 ACP prompt 将消息插入活动 Cursor 回合，无需取消正在进行的回合。')).toBeVisible()
    await expect(page.locator('details').first().getByText('新增', { exact: true }).first()).toBeVisible()
    await expect(page.getByRole('link', { name: '打开 v0.29.1 发行页' })).toBeVisible()
    await expect(page.getByText('查看完整发行说明', { exact: true })).toHaveCount(0)
})
