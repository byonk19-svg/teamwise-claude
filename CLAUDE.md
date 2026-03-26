# Teamwise — Claude Code Guidelines

## Project Overview

Teamwise is a Respiratory Therapy department scheduling app. Managers build 6-week Day/Night shift schedules for ~15 staff; therapists view their own schedules.

**Stack:** Next.js 14 (App Router) · TypeScript · Supabase (Auth + Postgres + @supabase/ssr) · Tailwind CSS · shadcn/ui · @ducanh2912/next-pwa · Vitest · Playwright

---

## Commands

```bash
npm run dev          # Start dev server (port 3000)
npm run build        # Production build
npm test             # Vitest unit tests
npm run test:e2e     # Playwright E2E (requires real .env.local; see Testing)
npm run test:e2e:ui  # Playwright UI mode
npm run seed         # Seed Supabase with test data (no-op if already seeded; see Seed Data)
npm run lint         # ESLint
```

---

## Directory Structure

```
app/
  (app)/            # Authenticated routes (layout wraps with Sidebar + TopBar)
  (auth)/           # Unauthenticated routes (/login)
  actions/          # Server actions (schedule, swaps, change-requests, notifications, staff, settings, coverage, ops, …)
  page.tsx          # Root redirect — therapist → /today, manager → /schedule

components/
  shell/            # Layout: Sidebar, TopBar, NotificationBell, NotificationPanel
  schedule/         # ScheduleGrid, GridCell, CellPanel, WeekView
  today/            # Presentational cards for /today hub
  availability/     # Availability submission UI
  swaps/            # SwapInbox, TherapistSwapQueue
  coverage/         # CoverageHeatmap
  ops/              # Ops dashboard components
  audit/            # AuditLog
  notifications/    # PushPermissionToggle
  staff/            # StaffTable, StaffSheet, InviteDialog (manager-only)
  settings/         # CoverageThresholdsForm (manager-only)
  ui/               # shadcn/ui primitives

lib/
  auth.ts           # ONLY file that calls supabase.auth.* (exceptions: see Auth Abstraction)
  supabase/
    server.ts       # Cookie-based anon client (server components + actions)
    service-role.ts # Service-role client (notifications + staff actions — bypasses RLS)
  schedule/         # block-status helpers, cell-colors, optimistic updates, swap logic
  today/            # buildWeekWindow, resolveLeadName, computeUnsignaledCount
  notifications/    # create, push, email, payloads
  settings/         # validate.ts (validateCoverageThresholds)
  exports/          # Pure CSV builder helpers (build-coverage-csv, build-kpi-csv, build-staff-csv, download-csv)
  ops/              # KPI helpers, block-health, fetch-block-health, types (OpsFilterParams)
  ops/              # KPI helpers
  server/           # deferred-work.ts (runAfterResponse shim)
  types/
    database.types.ts  # Generated + manual table type stubs

worker/             # Custom PWA service-worker chunk (push + notificationclick) — picked up by @ducanh2912/next-pwa

supabase/
  migrations/       # SQL migrations 001–007
  seed.ts           # Dev seed script
tests/
  unit/             # Vitest unit tests (118; includes staff-settings + notification-payloads + exports)
  e2e/              # Playwright specs (require E2E_AUTH=true + real .env.local)
```

---

## Architecture Rules

### eslint-disable-next-line Placement (CRITICAL)
The `// eslint-disable-next-line @typescript-eslint/no-explicit-any` comment suppresses the error on the **immediately following line only**. If the `(supabase as any)` cast is on a different line than the comment, the lint error will NOT be suppressed. Always write:
```typescript
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { data } = await (supabase as any).from('table_name')...
```

### searchParams in Next.js 14 (CRITICAL)
`searchParams` is a **synchronous plain object** in Next.js 14 — NOT a Promise. Do not `await` it. The correct pattern:
```typescript
export default async function Page({ searchParams }: { searchParams: { key?: string } }) {
  const value = searchParams.key  // direct access, no await
}
```
The `await searchParams` pattern is Next.js 15/16 only and will cause runtime errors in this project.

### Auth Abstraction (CRITICAL)
`lib/auth.ts` is the **only** file that calls Supabase Auth APIs. No other file may import or call `supabase.auth.*` directly.

**Documented exceptions** (all have inline comments explaining why):
- `middleware.ts` — must call Supabase directly; runs before `next/headers` is available
- `supabase/seed.ts` — dev-only script; uses service-role client to create test users
- `app/actions/staff.ts` — calls `supabase.auth.admin.inviteUserByEmail` and `auth.admin.deleteUser` via service-role client (invite flow requires admin API; no user session exists at invite time)

### Manual Table Access Pattern
Any table added to `lib/types/database.types.ts` manually (not in the generated Supabase client) must be accessed via `(supabase as any).from('table_name')`. Currently applies to:

| Table | Added in |
|-------|----------|
| `preliminary_change_requests` | Phase 3 |
| `prn_shift_interest` | Phase 3 |
| `swap_requests` | Phase 4 |
| `notifications` | Phase 8 |
| `push_subscriptions` | Phase 8 |
| `coverage_thresholds` | Phase 9 |

### Supabase RPC Typing
Supabase client doesn't auto-type RPCs. Cast as `any` to call: `(supabase as any).rpc('rpc_name', { params })`. Return type must be cast manually.

### Server vs Client Components
- Server components for all data fetching — default to server
- Add `'use client'` only for interactivity, browser APIs, or hooks
- For a full list of client components by phase, see Phase Status below

### Server Client Workaround
`lib/supabase/server.ts` uses `require('next/headers')` inside the function body (not a top-level import). This is intentional — Next.js 14 causes client bundle conflicts when `next/headers` is imported at the top level. Do not "fix" this.

### Service-Role Client (Phase 8+)
`lib/supabase/service-role.ts` exports `createServiceRoleClient()` — uses `SUPABASE_SERVICE_ROLE_KEY` to bypass RLS. **Only import in server-side files** (`lib/notifications/*`, server actions that need it). Never import in client components, middleware, or `lib/supabase/server.ts`. Needed for: notification inserts (writing rows for other users' `user_id`), `subscribeToPush` upserts, `auth.admin.*` APIs (invite/delete user), and deactivation cleanup steps that mutate other users' rows.

### CSS Grid Layout
The schedule grid uses a shared `.grid-row` CSS class:
```css
display: grid;
grid-template-columns: 160px repeat(42, minmax(28px, 1fr));
```
Applied to every row so all 43 columns align without a shared parent element.

### Day/Night Color Theming
Day/Night shift color is controlled via a CSS custom property `--shift-color` set at the grid root using a `data-shift` attribute. Toggling shifts = swapping a data attribute, not re-rendering components.

### Lead Assignment (Phase 4)
- `lead_user_id` on a `shifts` row means **this therapist IS the lead for this date** — only the lead's own shift row has a non-null value (set to their own `user_id`). All other rows for the same date have `lead_user_id = null`.
- Lead assignment is handled by the `assign_lead` Supabase RPC (validates `is_lead_qualified` AND `cell_state='working'`, atomically clears/sets). Never update `lead_user_id` directly from the client.
- GridCell yellow badge (bottom-right, `bg-yellow-400`) = this cell's therapist is the lead. Already implemented — do not touch.
- GridCell pink dot (top-left, `bg-pink-400`) = Working cell on a date with no lead assigned. Controlled by `dateHasLead` prop.

### Optimistic Updates
`lib/schedule/optimistic.ts` exports `applyOptimisticUpdate<T>(shifts, shiftId, newState)` — immutable map returning new array. `ScheduleGrid` stores shifts in `useState`; `handleCellStateUpdate` applies optimistic update and returns a revert closure called by `CellPanel` on server error.

---

## Database

**Supabase project:** `jcvlmwsiiikifdvaufqz`

Key tables: `users`, `departments`, `schedule_blocks`, `shifts`, `coverage_thresholds`, `time_off_requests`, `availability_submissions`, `availability_entries`, `schedule_comments`, `swap_requests`, `operational_entries`, `notifications`, `push_subscriptions`

**Views:** `shift_planned_headcount` (planned counts for CoverageHeatmap); `shift_actual_headcount` (planned vs actual for active/completed blocks)

**RPCs:** `copy_block(p_source_block_id, p_manager_id)` → new block id; `get_constraint_diff(p_new_block_id)` → `DiffItem[]` (user_id, full_name, shift_date, prior_cell_state, avail_entry_type); `assign_lead(p_schedule_block_id, p_shift_date, p_lead_user_id)` → `{ success?, error? }` — atomically clears all leads for date then sets the new one (validates `is_lead_qualified` AND `cell_state='working'`; pass `null` to clear); Phase 5: `enter_operational_code`, `remove_operational_code`, `revert_to_final` (see migration `004_phase5_operational.sql`)

All tables have RLS enabled. Broad authenticated-only policies (all phases so far).

**Migrations:**
- `supabase/migrations/001_initial_schema.sql` — initial schema
- `supabase/migrations/002_phase2_rpcs.sql` — `copy_block` and `get_constraint_diff` RPCs (applied)
- `supabase/migrations/003_phase4_swaps.sql` — `swap_requests` table, `assign_lead` RPC, `shift_planned_headcount` view, pg_cron hourly expiry job (applied)
- `supabase/migrations/004_phase5_operational.sql` — `operational_entries`, actuals view, RPCs, pg_cron auto-activate final→active (applied)
- `supabase/migrations/005_phase5_rls_hardening.sql` — department-scoped RLS for `swap_requests` and `operational_entries` (applied)
- `supabase/migrations/006_phase8_notifications.sql` — `notifications` + `push_subscriptions` tables + RLS (Phase 8)
- `supabase/migrations/007_phase9_swap_cancelled.sql` — `swap_requests.status` may be `cancelled` (therapist deactivation)

### Seed Data (after running `npm run seed`)
- If `manager@teamwise.dev` already exists in `public.users`, the seed script **exits successfully without changes** (safe to re-run).
- Manager: `manager@teamwise.dev` / `password123`
- Therapist: `jsmith@teamwise.dev` / `password123`
- 1 dept, 10 FT therapists (3 lead-qualified), 5 PRN, 2 schedule blocks (Day + Night), 1,260 shift rows

---

## Environment Variables

```
NEXT_PUBLIC_SUPABASE_URL        # Settings → General → Project URL
NEXT_PUBLIC_SUPABASE_ANON_KEY   # Use the new Publishable key (sb_publishable_...)
SUPABASE_SERVICE_ROLE_KEY       # Secret key from API Keys page

# Phase 8 — Notifications
NEXT_PUBLIC_VAPID_PUBLIC_KEY    # from: npx web-push generate-vapid-keys
VAPID_PRIVATE_KEY               # from: npx web-push generate-vapid-keys
VAPID_SUBJECT                   # mailto:schedule@teamwise.work
RESEND_API_KEY                  # from: Resend dashboard → API Keys
```

---

## Testing

- **Unit tests:** Vitest — `npm test`. Keep all tests passing before any commit. **118** unit tests (includes `staff-settings` + `notification-payloads` + `exports`).
- **E2E tests:** Playwright — requires real `.env.local` credentials and `E2E_AUTH=true` for authenticated specs. Use `loginAsManager` from `tests/e2e/helpers/auth.ts` (waits up to 60s for `/schedule`; throws with login alert text or env hint on failure). After login, middleware sends users to `/`; `app/page.tsx` then redirects **managers → `/schedule`**, **therapists → `/today`**. `loginAsManager` remains correct for manager flows. `tests/e2e/phase5-operational.spec.ts` runs **serial** within the file so revert/coverage/week tests do not race the same DB. `playwright.config.ts` uses extended timeouts and **one worker** locally so `next dev` is not overloaded; avoid running two servers on port 3000.
- Vitest is configured to exclude `tests/e2e/**` — do not remove this exclusion.

---

## Key Gotchas

1. **Geist font** — not available via `next/font/google` in Next.js 14; uses `localFont` with bundled woff files instead.
2. **Tailwind color tokens** — Full shadcn token set is in `tailwind.config.ts`. `outline-ring/50` uses `color-mix()` workaround.
3. **Supabase `.single()` type inference** — Returns `never` in some TS versions. Use explicit type casts.
4. **`preliminary_draft` status** — Seed data uses this status; the schedule page query includes it in the status filter.
5. **next.config.js** — CommonJS format (not ESM). `fallbacks.document` removed due to workbox version incompatibility with `@ducanh2912/next-pwa`.
6. **Middleware redirects** — Must copy cookies from `supabaseResponse` onto the redirect response, or the session is dropped.
7. **`classifyBlock` parameter order** — signature is `classifyBlock(endDate, startDate, todayStr)` (end before start). Unconventional but intentional; all callers pass in this order.
8. **Status recheck hardening (resolved)** — `resolveChangeRequest`, `resolvePrnInterest`, and `resolveSwap` now re-verify the current block status before mutating `shifts.cell_state`.
9. **Department-scoped RLS hardening (resolved)** — `swap_requests` and `operational_entries` policies are department-scoped via migration `005_phase5_rls_hardening.sql`.
10. **`schedule_blocks` `.update()` returns `never`** — self-referential Database type issue in generated client. Always use `(supabase as any).from('schedule_blocks').update(...)` for block status mutations. (Same `any`-cast pattern as Manual Table Access — see Architecture Rules.)
11. **Set spread downlevel iteration** — `[...mySet]` fails with `TS2802` in this tsconfig. Always use `Array.from(mySet)` instead when spreading Sets or Map iterators.
12. **E2E `/ops` drill-down** — On desktop, the sidebar includes a link named “Schedule”; table-scoped locators in `tests/e2e/ops.spec.ts` avoid clicking the nav link (which omits `?blockId=`).
13. **PRN empty-state pattern** — PRN-only UI sections (e.g. Open Shifts card) must always render for PRN users even when the backing data (preliminary block) is absent. Pass `null` props and show “No open shifts right now” — never conditionally omit the card based on a nullable dependency.
14. **Today hub / operational display** — `operational_entries` rows use **`entry_type`** (not `code`) for OC/CI/CX/LE; Today and audit UIs read that column.
15. **`prn_shift_interest` has no `block_id`** — Interest is keyed by `shift_id` only; Today hub counts unsignaled PRN slots by intersecting off-shift ids with interest rows (same pattern as `availability/open-shifts/page.tsx`).
16. **`swap_requests` has no `shift_date`** — Join through `requester_shift_id` / `partner_shift_id` → `shifts.shift_date` when displaying dates.
17. **`notifications` / `push_subscriptions` require `(supabase as any)`** — See Manual Table Access Pattern above.
18. **Post-response work (Phase 8)** — Push/email after server actions use **`runAfterResponse`** from `lib/server/deferred-work.ts` (queueMicrotask + detached promise). This repo’s Next 14.2.x build does not type-export `unstable_after` from `next/server`; do not add `experimental.after` to `next.config.js` unless upgrading to a Next version that supports it and switching call sites to the stable `after` API.
19. **PWA push UI (Phase 8)** — `worker/index.js` is compiled by `@ducanh2912/next-pwa` into `public/worker-*.js` and `importScripts`’d from `sw.js`. It handles **`push`** (shows OS notification from JSON `{ title, body, href? }`) and **`notificationclick`**. **Middleware** must not auth-guard `sw.js`, `worker-*.js`, `workbox-*.js`, etc. (see `middleware.ts` matcher).
20. **Email from domain** — All Resend emails use `schedule@teamwise.work`. The domain must be verified in Resend before emails will deliver.
21. **Service-role client is not cookie-based** — `createServiceRoleClient()` uses `SUPABASE_SERVICE_ROLE_KEY` directly (no session). Never use for user-facing queries.
22. **`deactivateTherapist` uses two clients** — anon client (`createClient()`) for session auth and role guard only; service-role client for all DB reads and writes (dept guard, swap/PRN cleanup, users update). This is intentional: the cleanup steps mutate rows belonging to other users, which RLS on the anon client would reject.
23. **`swap_requests.status = 'cancelled'`** — requires migration `007_phase9_swap_cancelled.sql` (extends the DB check constraint). Without it, deactivation fails when pending swaps exist.

---

## Phase Status

- **Phase 1 (Foundation):** Complete — schema, auth, app shell, calendar grid, cell panel, PWA foundation
- **Phase 2 (Availability & Schedule Building):** Complete — availability windows, FT/PRN submission, copy-from-prior-block, constraint diff, cell state editing with optimistic updates
- **Phase 3 (Preliminary / Final Lifecycle):** Complete — types, block-status helpers, postPreliminary/postFinal actions, BlockStatusActions, BlockPicker groupings, CellPanel prop threading, FT change request form, PRN interest actions, manager inbox, PRN open shifts page.
- **Phase 4 (Lead Assignment & Shift Swaps):** Complete — `swap_requests` table + `assign_lead` RPC (migration 003), lead eligibility/gap helpers + tests, swap-allowed helper + tests, `assignLead` server action, GridCell lead-gap dot, ScheduleGrid lead tracking + bulk modal trigger, CellPanel lead dropdown + swap request form, BlockStatusActions lead-gap warning, BulkLeadModal, `submitSwap`/`resolveSwap` actions, `/swaps` page (managers: `SwapInbox`; therapists: read-only `TherapistSwapQueue`), `/coverage` page + CoverageHeatmap.
- **Phase 5 (Operational Layer):** Complete — `operational_entries` table/RPCs + RLS, shift actuals view, operational code entry in `CellPanel` + mobile `WeekView`, coverage actuals + alerts, audit log page + CSV export, revert-to-final flow, and hardening/observability updates.
- **Phase 6 (Operational Dashboard):** Complete — manager-only `/ops` read-only dashboard: KPI cards (aggregated + drill-downs), filters (shift type, block, date range), **Block health** table (per-block risk metrics, Schedule/Focus links), consolidated event feed with drill-downs, Supabase Realtime refresh (operational entries, swaps, change requests, shifts, PRN interest batched by `shift_id`). Playwright smoke in `tests/e2e/ops.spec.ts` when `E2E_AUTH=true`.
- **Phase 7 (Therapist Today Hub):** Complete — `/today` therapist landing (shift card, week strip, swaps, op codes, block context, PRN open-shift count). `app/(app)/today/page.tsx` parallel fetches; `lib/today/helpers.ts` (`buildWeekWindow`, `resolveLeadName`, `computeUnsignaledCount`) + `tests/unit/today-helpers.test.ts` (11 tests). `lib/schedule/cell-colors.ts` + `components/today/*`. Post-login: middleware → `/`, then `app/page.tsx` branches by role (therapist → `/today`, manager → `/schedule`). Sidebar “Today” for therapists. Plan reference: `docs/superpowers/plans/2026-03-24-phase7-today-hub.md`.
- **Phase 8 (Notifications):** Complete — persistent in-app inbox (TopBar `NotificationBell` + `NotificationPanel`), `web-push` + VAPID, optional Resend email for `block_posted`. Migration `006_phase8_notifications.sql` (`notifications`, `push_subscriptions`, RLS). Triggers write rows via service-role; **`runAfterResponse`** (`lib/server/deferred-work.ts`) dispatches push/email after the action returns (Next 14.2.x has no `unstable_after` in typings). **`subscribeToPush`** upserts subscriptions; **`worker/index.js`** handles `push` + `notificationclick` for OS notifications. Event types: `swap_requested`, `swap_resolved`, `change_request_resolved`, `prn_interest_resolved`, `block_posted`. Plan: `docs/superpowers/plans/2026-03-24-phase8-notifications.md`.
- **Phase 8 — Optional follow-ups (production / email):**
  - [ ] **Production env:** set `NEXT_PUBLIC_VAPID_*`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `SUPABASE_SERVICE_ROLE_KEY`, and `RESEND_API_KEY` on the host if using block-post email.
  - [ ] **Resend:** verify sending domain for `schedule@teamwise.work` (or change `from` in `lib/notifications/email.ts` to match a verified domain).
- **Phase 9 (Staff Management & Settings):** Complete — manager-only `/staff` (invite via Supabase email, edit profile, soft-deactivate with pending swap cancel + PRN interest decline) and `/settings` (coverage threshold upsert). `lib/settings/validate.ts` + `tests/unit/staff-settings.test.ts` (4 tests). Service-role: `inviteTherapist` / `deactivateTherapist`. Migration `007_phase9_swap_cancelled.sql` for `cancelled` swap status. Spec: `docs/superpowers/specs/2026-03-24-phase9-staff-settings-design.md`. Plan: `docs/superpowers/plans/2026-03-25-phase9-staff-settings.md`.
- **Phase 10 (Richer Exports):** Planned — browser print PDF for schedule grid (`@media print` + `PrintButton`), Coverage CSV (`exportCoverageCSV` in `app/actions/coverage.ts`), KPI CSV (`exportKPICSV` via `lib/ops/fetch-block-health.ts` shared helper), Staff Roster CSV (`exportStaffCSV` added to `app/actions/staff.ts`). Pure CSV builders in `lib/exports/`. 4 new Vitest tests (`tests/unit/exports.test.ts`). No new npm dependencies. Spec: `docs/superpowers/specs/2026-03-25-phase10-richer-exports-design.md`. Plan: `docs/superpowers/plans/2026-03-25-phase10-richer-exports.md`.
- **Phase 11+:** Candidates — CI-hardened E2E with isolated DB.
