// tests/e2e/login.spec.ts
import { test, expect } from '@playwright/test'

test.describe('Login', () => {
  test('unauthenticated user is redirected to /login', async ({ page }) => {
    await page.goto('/schedule')
    await expect(page).toHaveURL(/.*login/)
  })

  test('login page renders email and password fields', async ({ page }) => {
    await page.goto('/login')
    await expect(page.getByLabel('Email')).toBeVisible()
    await expect(page.getByLabel('Password')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()
  })

  test.skip('valid credentials redirect to /schedule', async ({ page }) => {
    await page.goto('/login')
    await page.getByLabel('Email').fill('manager@teamwise.dev')
    await page.getByLabel('Password').fill('password123')
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page).toHaveURL(/.*schedule/, { timeout: 5000 })
  })

  test.skip('invalid credentials show error message', async ({ page }) => {
    await page.goto('/login')
    await page.getByLabel('Email').fill('nobody@example.com')
    await page.getByLabel('Password').fill('wrongpass')
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page.getByRole('alert')).toBeVisible()
  })
})
