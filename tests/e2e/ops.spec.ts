import { test, expect } from '@playwright/test'
import { loginAsManager } from './helpers/auth'

const hasAuthEnv = process.env.E2E_AUTH === 'true'

test.describe('Ops page', () => {
  test.skip(!hasAuthEnv, 'Set E2E_AUTH=true and seeded credentials to run authenticated flows')

  test('manager can use ops dashboard: KPIs, block health, events, drill-down', async ({ page }) => {
    await loginAsManager(page)
    await page.goto('/ops')
    await expect(page.getByRole('heading', { name: 'Operations Dashboard' })).toBeVisible({
      timeout: 15_000,
    })
    await expect(page.getByText('Lead gap dates')).toBeVisible()
    await expect(page.getByText('Pending swaps')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Block health' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Recent Events' })).toBeVisible()

    // Sidebar (lg+) also has a "Schedule" nav link without blockId; scope to block health table.
    const scheduleLink = page.locator('table').getByRole('link', { name: 'Schedule' }).first()
    await expect(scheduleLink).toBeVisible()
    await scheduleLink.click()
    await expect(page).toHaveURL(/\/schedule\?blockId=/)
  })
})
