# Teamwise — Claude Code Guidelines

## Project Overview

Teamwise is a Respiratory Therapy department scheduling app. Managers build 6-week Day/Night shift schedules for ~15 staff; therapists view their own schedules.

**Stack:** Next.js 14 (App Router) · TypeScript · Supabase (Auth + Postgres + @supabase/ssr) · Tailwind CSS · shadcn/ui · @ducanh2912/next-pwa · Vitest · Playwright

---

## Commands

```bash
npm run dev          # Start dev server (port 3000)
npm run build        # Production build
npm test             # Vitest unit tests (67 tests as of Phase 4 complete)
npm run test:e2e     # Playwright E2E (requires real .env.local)
npm run seed         # Seed Supabase with test data
npm run lint         # ESLint
```

---

## Architecture Rules

### Auth Abstraction (CRITICAL)
`lib/auth.ts` is the **only** file that calls Supabase Auth APIs. No other file may import or call `supabase.auth.*` directly.

**Documented exceptions** (both have inline comments explaining why):
- `middleware.ts` — must call Supabase directly; runs before `next/headers` is available
- `supabase/seed.ts` — dev-only script; uses service-role client to create test users

### Server Client Workaround
`lib/supabase/server.ts` uses `require('next/headers')` inside the function body (not a top-level import). This is intentional — Next.js 14 causes client bundle conflicts when `next/headers` is imported at the top level. Do not "fix" this.

### CSS Grid Layout
The schedule grid uses a shared `.grid-row` CSS class:
```css
display: grid;
grid-template-columns: 160px repeat(42, minmax(28px, 1fr));
```
Applied to every row so all 43 columns align without a shared parent element.

### Day/Night Color Theming
Day/Night shift color is controlled via a CSS custom property `--shift-color` set at the grid root using a `data-shift` attribute. Toggling shifts = swapping a data attribute, not re-rendering components.

### Server vs Client Components
- Server components for all data fetching
- Client components only where interactivity is required: `CellPanel`, `ShiftToggle`, TopBar notification dot
- Phase 2 client components: `ConstraintDiff`, `AvailabilityCalendar`, `BlockPicker`, `BlockCreateForm`, `AvailabilityWindowControl`, `SubmissionTracker`
- Phase 3 client components: `BlockStatusActions`, `InboxList`, `OpenShiftsList`
- Phase 4 client components: `BulkLeadModal`, `SwapInbox`, `CoverageHeatmap`

### Supabase RPC Typing
Supabase client doesn't auto-type RPCs. Cast as `any` to call: `(supabase as any).rpc('rpc_name', { params })`. Return type must be cast manually.

### Phase 3 Table Access
`preliminary_change_requests` and `prn_shift_interest` are typed in `lib/types/database.types.ts` but not in the generated Supabase client — always access them via `(supabase as any).from('preliminary_change_requests')`. Same pattern applies to any future tables added manually to `database.types.ts`.

### Phase 4 Table Access
`swap_requests` is typed in `lib/types/database.types.ts` but not in the generated Supabase client — always access it via `(supabase as any).from('swap_requests')`.

### Lead Assignment (Phase 4)
- `lead_user_id` on a `shifts` row means **this therapist IS the lead for this date** — only the lead's own shift row has a non-null value (set to their own `user_id`). All other rows for the same date have `lead_user_id = null`.
- Lead assignment is handled by the `assign_lead` Supabase RPC (validates `is_lead_qualified` AND `cell_state='working'`, atomically clears/sets). Never update `lead_user_id` directly from the client.
- GridCell yellow badge (bottom-right, `bg-yellow-400`) = this cell's therapist is the lead. Already implemented — do not touch.
- GridCell pink dot (top-left, `bg-pink-400`) = Working cell on a date with no lead assigned. Controlled by `dateHasLead` prop.

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

### Optimistic Updates
`lib/schedule/optimistic.ts` exports `applyOptimisticUpdate<T>(shifts, shiftId, newState)` — immutable map returning new array. `ScheduleGrid` stores shifts in `useState`; `handleCellStateUpdate` applies optimistic update and returns a revert closure called by `CellPanel` on server error.

---

## Database

**Supabase project:** `jcvlmwsiiikifdvaufqz`

Key tables: `users`, `departments`, `schedule_blocks`, `shifts`, `coverage_thresholds`, `time_off_requests`, `availability_submissions`, `availability_entries`, `schedule_comments`, `swap_requests`

**Views:** `shift_planned_headcount` — per-date FT/PRN/Total planned counts used by CoverageHeatmap

**RPCs:** `copy_block(p_source_block_id, p_manager_id)` → new block id; `get_constraint_diff(p_new_block_id)` → `DiffItem[]` (user_id, full_name, shift_date, prior_cell_state, avail_entry_type); `assign_lead(p_schedule_block_id, p_shift_date, p_lead_user_id)` → `{ success?, error? }` — atomically clears all leads for date then sets the new one (validates `is_lead_qualified` AND `cell_state='working'`; pass `null` to clear)

All tables have RLS enabled. Broad authenticated-only policies (all phases so far).

**Migrations:**
- `supabase/migrations/001_initial_schema.sql` — initial schema
- `supabase/migrations/002_phase2_rpcs.sql` — `copy_block` and `get_constraint_diff` RPCs (applied)
- `supabase/migrations/003_phase4_swaps.sql` — `swap_requests` table, `assign_lead` RPC, `shift_planned_headcount` view, pg_cron hourly expiry job (applied)

### Seed Data (after running `npm run seed`)
- Manager: `manager@teamwise.dev` / `password123`
- Therapist: `jsmith@teamwise.dev` / `password123`
- 1 dept, 10 FT therapists (3 lead-qualified), 5 PRN, 2 schedule blocks (Day + Night), 1,260 shift rows

---

## Environment Variables

```
NEXT_PUBLIC_SUPABASE_URL        # Settings → General → Project URL
NEXT_PUBLIC_SUPABASE_ANON_KEY   # Use the new Publishable key (sb_publishable_...)
SUPABASE_SERVICE_ROLE_KEY       # Secret key from API Keys page
```

---

## Testing

- **Unit tests:** Vitest — `npm test`. Must stay at 67/67 passing before any commit.
- **E2E tests:** Playwright — requires real `.env.local` credentials. Currently skipped in CI until credentials are configured.
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
10. **`schedule_blocks` `.update()` returns `never`** — self-referential Database type issue in generated client. Always use `(supabase as any).from('schedule_blocks').update(...)` for block status mutations.
11. **Set spread downlevel iteration** — `[...mySet]` fails with `TS2802` in this tsconfig. Always use `Array.from(mySet)` instead when spreading Sets or Map iterators.

---

## Phase Status

- **Phase 1 (Foundation):** Complete — schema, auth, app shell, calendar grid, cell panel, PWA foundation
- **Phase 2 (Availability & Schedule Building):** Complete — availability windows, FT/PRN submission, copy-from-prior-block, constraint diff, cell state editing with optimistic updates
- **Phase 3 (Preliminary / Final Lifecycle):** Complete — types, block-status helpers, postPreliminary/postFinal actions, BlockStatusActions, BlockPicker groupings, CellPanel prop threading, FT change request form, PRN interest actions, manager inbox, PRN open shifts page.
- **Phase 4 (Lead Assignment & Shift Swaps):** Complete — `swap_requests` table + `assign_lead` RPC (migration 003), lead eligibility/gap helpers + tests, swap-allowed helper + tests, `assignLead` server action, GridCell lead-gap dot, ScheduleGrid lead tracking + bulk modal trigger, CellPanel lead dropdown + swap request form, BlockStatusActions lead-gap warning, BulkLeadModal, `submitSwap`/`resolveSwap` actions, `/swaps` page + SwapInbox, `/coverage` page + CoverageHeatmap. 67 unit tests passing.
- **Phase 5 (Operational Layer):** Not started — see below for details.
