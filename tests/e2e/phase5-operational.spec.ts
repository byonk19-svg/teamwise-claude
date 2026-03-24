import { test, expect } from '@playwright/test'

const hasAuthEnv = process.env.E2E_AUTH === 'true'

async function loginAsManager(page: import('@playwright/test').Page) {
  await page.goto('/login')
  await page.getByLabel('Email').fill('manager@teamwise.dev')
  await page.getByLabel('Password').fill('password123')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/.*schedule/)
}

test.describe('Phase 5 operational flows', () => {
  test.skip(!hasAuthEnv, 'Set E2E_AUTH=true and seeded credentials to run authenticated flows')

  test('mobile week view opens operational bottom sheet', async ({ page }) => {
    await loginAsManager(page)
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/schedule')

    // WeekView renders only on mobile.
    await expect(page.getByText('Name')).toBeVisible()

    const weekCell = page.locator('button:has(span.w-3.h-3.rounded-full)').first()
    await expect(weekCell).toBeVisible()
    await weekCell.click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(
      dialog.getByText(/Operational Codes|Operational codes are only available on active blocks/i)
    ).toBeVisible()
  })

  test('coverage page shows Actual column', async ({ page }) => {
    await loginAsManager(page)
    await page.goto('/coverage')

    await expect(page.getByRole('heading', { name: 'Coverage' })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: 'Actual' })).toBeVisible()
  })

  test('manager can revert active block to final when active block exists', async ({ page }) => {
    await loginAsManager(page)
    await page.goto('/schedule')
    await page.setViewportSize({ width: 1280, height: 900 })

    const activeBadge = page.locator('span', { hasText: 'Active' }).first()
    if (await activeBadge.count() === 0) {
      test.skip(true, 'No active block available in current seed data')
    }

    const revertButton = page.getByRole('button', { name: 'Revert to Final' }).first()
    await expect(revertButton).toBeVisible()
    await revertButton.click()

    await expect(page.getByText('Revert to Final?')).toBeVisible()
    await page.getByRole('button', { name: 'Yes, revert' }).click()

    await expect(page.getByText('Final')).toBeVisible()
  })
})
