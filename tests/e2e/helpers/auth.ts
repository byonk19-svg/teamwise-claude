import type { Page } from '@playwright/test'

/** Seeded manager (see `npm run seed` and CLAUDE.md). */
export async function loginAsManager(page: Page) {
  await page.goto('/login', { waitUntil: 'domcontentloaded' })
  await page.getByLabel('Email').fill('manager@teamwise.dev')
  await page.getByLabel('Password').fill('password123')
  await page.getByRole('button', { name: 'Sign in' }).click()
  try {
    await page.waitForURL(/\/schedule/, { timeout: 60_000 })
  } catch {
    const alert = page.getByRole('alert')
    if (await alert.isVisible().catch(() => false)) {
      throw new Error(`Login failed: ${(await alert.textContent()) ?? 'unknown error'}`)
    }
    throw new Error(
      'Login did not reach /schedule within 60s. Check .env.local Supabase keys, run `npm run seed`, and ensure the dev server is healthy.'
    )
  }
}
