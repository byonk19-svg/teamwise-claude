// tests/e2e/grid.spec.ts
import { test, expect } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('Email').fill('manager@teamwise.dev')
  await page.getByLabel('Password').fill('password123')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/.*schedule/)
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
