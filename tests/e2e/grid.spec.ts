// tests/e2e/grid.spec.ts
import { test, expect } from '@playwright/test'
import { loginAsManager } from './helpers/auth'

const hasAuthEnv = process.env.E2E_AUTH === 'true'
const authDescribe = hasAuthEnv ? test.describe : test.describe.skip

authDescribe('Schedule grid (authenticated)', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsManager(page)
  })

  test.skip('schedule grid shows FT and PRN sections', async ({ page }) => {
    await expect(page.getByText('Full-Time')).toBeVisible()
    await expect(page.getByText('PRN')).toBeVisible()
  })

  test.skip('grid shows FT Count and PRN Count rows', async ({ page }) => {
    await expect(page.getByText('FT Count')).toBeVisible()
    await expect(page.getByText('PRN Count')).toBeVisible()
    await expect(page.getByText('Total')).toBeVisible()
  })

  test.skip('Day/Night toggle switches grids', async ({ page }) => {
    await page.getByRole('button', { name: 'Night' }).click()
    const nightBtn = page.getByRole('button', { name: 'Night' })
    await expect(nightBtn).toHaveClass(/bg-slate-900/)
  })

  test.skip('grid does not overflow at 1440px viewport', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    const grid = page.locator('.schedule-grid')
    await expect(grid).toBeVisible()
    const box = await grid.boundingBox()
    expect(box?.width).toBeLessThanOrEqual(1440)
  })
})
