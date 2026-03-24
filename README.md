# Teamwise

Teamwise is a respiratory therapy scheduling app for building and operating 6-week Day/Night blocks.

## Stack

- Next.js 14 (App Router) + TypeScript
- Supabase (Auth, Postgres, RLS, Realtime)
- Tailwind CSS + shadcn/ui
- Vitest + Playwright

## Local Development

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Core Commands

```bash
npm run dev        # run local app
npm test           # unit tests
npx tsc --noEmit   # typecheck
npm run build      # production build check
npm run lint       # lint
npm run seed       # seed local/dev Supabase data
```

## Phase 5 Notes (Operational Layer)

- Mobile WeekView supports in-shift operational code entry (`OC`, `CI`, `CX`, `LE`) via bottom sheet.
- Coverage page shows planned + actual headcount and live alert hooks.
- Completed blocks expose an audit log route at `/audit/[blockId]` with CSV export.

## Phase 6 Notes (Ops Dashboard v1) — complete

- Manager-only `/ops` page includes KPI cards for lead gaps, pending workflow items, and low coverage dates.
- Supports filter controls for shift type, block, and date range.
- Includes a consolidated operational event feed (operational entries, swaps, change requests, and PRN interest activity).
- KPI cards and event rows include drill-down links into existing manager workflows (`/coverage`, `/swaps`, `/schedule/inbox`, and `/audit/[blockId]`).
- The dashboard listens for Supabase Realtime changes on operational entries, swaps, change requests, shifts, and PRN interest (batched by `shift_id` for the shifts currently loaded) and refreshes KPIs and the event feed (debounced).
- **Block health** table lists each visible block with per-block lead gaps, pending workflow counts, low-coverage dates, a combined risk score, and links to **Schedule** or **Focus** (same filters, one block).

## Troubleshooting

If UI interactions stop working after code changes (for example, cell taps do nothing, coverage content disappears, or `/_next/static/chunks/*` returns 404):

1. Stop the running dev server.
2. Clear build output (`.next`).
3. Restart with `npm run dev`.
4. Hard refresh the browser.

This usually resolves stale chunk/hydration mismatch during local development.

## Playwright E2E

- Prefer **one** dev server on port 3000 (either let Playwright start it via `webServer`, or run `npm run dev` yourself with `reuseExistingServer` — not both on different ports).
- Authenticated specs need `.env.local` with valid Supabase keys, `npm run seed`, and `E2E_AUTH=true`.
- Local runs use **one worker** by default to avoid starving `next dev`; first compile can take 30s+.
