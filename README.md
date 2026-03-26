# Teamwise

Teamwise is a respiratory therapy scheduling app for building and operating 6-week Day/Night blocks.

## Stack

- Next.js 14 (App Router) + TypeScript
- Supabase (Auth, Postgres, RLS, Realtime)
- Tailwind CSS + shadcn/ui + PWA (`@ducanh2912/next-pwa`)
- Vitest + Playwright

## Local development

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Core commands

```bash
npm run dev        # local app (port 3000)
npm test           # unit tests (Vitest)
npm run build      # production build (includes PWA + custom worker)
npm run lint       # ESLint
npm run seed       # seed Supabase dev data (see CLAUDE.md)
npm run test:e2e   # Playwright (needs .env.local + seed; see below)
```

For **PWA / web push** locally, use a production build — the service worker is not enabled the same way under `next dev`:

```bash
npm run build && npm run start
```

## Environment variables

Create **`.env.local`** (gitignored) with at minimum:

- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- **Notifications / push (Phase 8):** `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`; optional `RESEND_API_KEY` for block-post email

Full list and behavior are documented in [**CLAUDE.md**](CLAUDE.md).

## Features by phase (summary)

| Phase | Highlights |
|-------|------------|
| **5** | Operational codes (`OC`/`CI`/`CX`/`LE`), coverage actuals, `/audit/[blockId]` + CSV |
| **6** | Manager `/ops` dashboard, Realtime refresh, block health |
| **7** | Therapist `/today` hub |
| **8** | In-app notifications, optional push + email, `worker/index.js` for OS notifications |
| **9** | Manager `/staff` (invite / edit / deactivate), `/settings` (coverage thresholds); migration `007` adds `swap_requests.status = cancelled` |
| **10** | Schedule print CSS, coverage/KPI/staff CSV exports (`lib/exports/`, server actions) |

**Authoritative detail:** table list, RPCs, migrations **001–007**, auth rules, and gotchas → **CLAUDE.md**.

## Applying the database

Run SQL migrations in order from `supabase/migrations/` (see `supabase/migrations/README.md`). Remote Supabase: SQL Editor, paste each file, run.

## Troubleshooting

If UI breaks after changes (cells inert, 404 on `/_next/static/chunks/*`):

1. Stop the dev server.
2. Remove `.next`.
3. `npm run dev` again and hard-refresh the browser.

## Testing & CI

**What runs in GitHub by default:** on pushes/PRs to `main` or `master`, **`.github/workflows/ci.yml`** runs **`npm run lint`** and **`npm test`**. No Supabase or browser is required; that is enough for day-to-day merges.

**Local E2E (Playwright):**

- Prefer **one** server on port 3000 (Playwright starts **`npm run dev`** for you locally, or run it yourself and Playwright will reuse it).
- Authenticated specs need a real **`.env.local`**, **`npm run seed`**, and **`E2E_AUTH=true`** (see **CLAUDE.md → Testing**).
- **`npm run test:e2e`** · **`npm run test:e2e:ui`** for UI mode.

**Optional — E2E in GitHub Actions:** **`.github/workflows/e2e.yml`** is **manual only** (Actions → run workflow). It needs repository secrets and a seeded Supabase project; use it when you want cloud browser tests, not as a prerequisite for contributing. Full checklist → **CLAUDE.md → Testing → Optional: E2E in GitHub Actions**.
