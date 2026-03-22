// tests/e2e/cell-panel.spec.ts
import { test, expect } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('Email').fill('manager@teamwise.dev')
  await page.getByLabel('Password').fill('password123')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/.*schedule/)
})

test.skip('clicking a Working cell opens the panel', async ({ page }) => {
  const workingCell = page.locator('button[aria-label*="working"]').first()
  await workingCell.click()
  await expect(page.getByRole('dialog')).toBeVisible()
})

test.skip('panel shows therapist name, date, and cell state', async ({ page }) => {
  const workingCell = page.locator('button[aria-label*="working"]').first()
  await workingCell.click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog.locator('text=/Working|Cannot Work|Off|FMLA/i')).toBeVisible()
})

test.skip('panel closes on X button click', async ({ page }) => {
  const workingCell = page.locator('button[aria-label*="working"]').first()
  await workingCell.click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByRole('button', { name: /close/i }).click()
  await expect(page.getByRole('dialog')).not.toBeVisible()
})

test.skip('panel does not cover the full grid', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const workingCell = page.locator('button[aria-label*="working"]').first()
  await workingCell.click()
  const panel = page.getByRole('dialog')
  const box = await panel.boundingBox()
  expect(box?.width).toBeLessThan(1440 * 0.4)
})

test.skip('panel works at mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const workingCell = page.locator('button[aria-label*="working"]').first()
  await workingCell.click()
  await expect(page.getByRole('dialog')).toBeVisible()
})
