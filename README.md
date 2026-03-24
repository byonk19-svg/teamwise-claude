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

## Troubleshooting

If UI interactions stop working after code changes (for example, cell taps do nothing, coverage content disappears, or `/_next/static/chunks/*` returns 404):

1. Stop the running dev server.
2. Clear build output (`.next`).
3. Restart with `npm run dev`.
4. Hard refresh the browser.

This usually resolves stale chunk/hydration mismatch during local development.
