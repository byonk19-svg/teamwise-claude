# Therapist Today Hub — Design Spec

**Date:** 2026-03-24
**Phase:** 7

---

## Overview

A dedicated `/today` route that serves as the default landing page for therapists after login. Provides a focused daily view: current shift status, upcoming schedule, pending swaps, operational codes, block context, and (for PRN staff) open shift opportunities — all without navigating the full schedule grid.

Managers are unaffected: they continue to land on `/schedule`.

---

## Route & Navigation

- **URL:** `/today` — new route under `app/(app)/today/page.tsx`
- **Auth:** Server component; unauthenticated users redirect to `/login`
- **Role guard:** If `profile.role === 'manager'`, redirect to `/schedule`. Therapists without a `department_id` show an inline message: "Your account is not assigned to a department. Contact your manager." (no separate error route — same pattern as `/schedule/page.tsx`)
- **Default redirect after login:**
  - `middleware.ts` line 44: change `url.pathname = '/schedule'` → `url.pathname = '/'`. This sends all authenticated users who hit `/login` to the root page, which then performs the role-based redirect.
  - `app/page.tsx` updated: convert to `async` server component; call `getServerUser()` from `lib/auth.ts` and `createClient()` from `lib/supabase/server.ts` to fetch the user's role. Redirect `therapist` → `/today`, `manager` → `/schedule`. If no session, redirect `/login`.
  - Middleware cannot check `public.users.role` without a DB query, so role-based branching lives in `app/page.tsx` only.
- **Sidebar:** Add `{ href: '/today', label: 'Today', roles: ['therapist'] }` to `NAV_ITEMS` in `Sidebar.tsx` — insert **before** the existing `Schedule` entry (index 0 of the array)

---

## Data Fetching

Single `Promise.all` in `page.tsx` — all queries fire in parallel, page latency = slowest single query.

| # | Query | Table | Condition | Notes |
|---|-------|-------|-----------|-------|
| 1 | Profile + department | `users` | `id = user.id` | Standard typed client |
| 2 | Active/final block | `schedule_blocks` | `department_id`, `status IN ('final','active')`, `order by start_date desc limit 1` | **Only `final` and `active` statuses.** `preliminary_draft` and `preliminary` blocks → "No active schedule" fallback. Standard typed client. |
| 3 | Therapist's shifts for block | `shifts` | `user_id = user.id`, `schedule_block_id = block.id` | Standard typed client. Used for week strip. |
| 4 | Department therapists | `users` | `department_id = dept.id`, `role = 'therapist'`, select `id, full_name` | Standard typed client. Used to resolve lead name from `lead_user_id`. |
| 5 | Lead for today | `shifts` | `shift_date = today`, `lead_user_id IS NOT NULL`, `schedule_block_id = block.id`, select `lead_user_id` | Returns one row (or null). Resolve name via Query #4 list. |
| 6 | Pending swap requests | `swap_requests` | `(requester_id = user.id OR partner_id = user.id)`, `status = 'pending'`, `expires_at > now()` | **Requires `(supabase as any)` cast** — `swap_requests` is not in generated Supabase client (CLAUDE.md Phase 4). |
| 7 | Operational entries for today | `operational_entries` | `user_id = user.id`, `entry_date = today`, `schedule_block_id = block.id`, `removed_at IS NULL` | **Requires `(supabase as any)` cast** — `operational_entries` is in the manual `database.types.ts` stub, not the generated client (CLAUDE.md Phase 5 table, same `any`-cast pattern as Phase 3/4 tables). |
| 8 | Preliminary block (PRN only) | `schedule_blocks` | `department_id`, `status = 'preliminary'`, `order by start_date desc limit 1` | **Skipped entirely for FT.** Needed for Open Shifts card. Standard typed client. |
| 9 | PRN open shift count | `shifts` + `prn_shift_interest` | `user_id = user.id`, `schedule_block_id = prelim_block.id`, **`cell_state = 'off'`** | **PRN only, skipped if no preliminary block.** PRN open slots are `off` rows in a preliminary block. Cross-ref with `prn_shift_interest` (requires `(supabase as any)`) to compute unsignaled count. **Unsignaled = `off` shifts with no existing `prn_shift_interest` row for that `shift_id`, regardless of interest status** (pending/confirmed/declined all count as "already signaled" — matches `open-shifts/page.tsx` logic). Links to `/availability/open-shifts?blockId=<prelim_block_id>`. |

---

## Layout

```
┌─────────────────────────────────────────────────────┐
│  Today                          Tuesday, March 24    │
├─────────────────────────────────────────────────────┤
│  TodayShiftCard (full width)                         │
│  ● WORKING · Day Shift · Lead: J. Smith · Active     │
├─────────────────────────────────────────────────────┤
│  TodayWeekStrip (full width)                         │
│  7 days starting from max(today, block.start_date)   │
│  capped at block.end_date — fewer days OK if near    │
│  end of block; no backfill                           │
├──────────────────────┬──────────────────────────────┤
│  TodaySwapsCard      │  TodayOpCodesCard             │
├──────────────────────┼──────────────────────────────┤
│  TodayBlockCard      │  TodayOpenShiftsCard [PRN]    │
│                      │  (not rendered for FT)        │
└──────────────────────┴──────────────────────────────┘
```

Tailwind: `grid grid-cols-1 md:grid-cols-2 gap-4` for the bottom 4 cards. Collapses to single column on mobile. For FT the grid has 3 cards — CSS grid handles this naturally, no extra wrapper needed.

---

## Components

All components are **presentational** — no data fetching of their own. All data passed as props from `page.tsx`.

```
app/(app)/today/page.tsx

components/today/
  TodayShiftCard.tsx          shift status, shift type, lead name, block badge
                              states: working (green), off (slate), cannot_work (red), fmla (purple)
                              uses STATE_COLORS from lib/schedule/cell-colors.ts
  TodayWeekStrip.tsx          days from max(today, block.start_date), capped at block.end_date
                              receives full shifts array from Query #3; filters to window at render time
                              (server component — no useState needed)
                              today highlighted with ring; fewer than 7 days at block end is acceptable
  TodaySwapsCard.tsx          pending + unexpired swap count, partner name + date of first pending
                              swap, link to /swaps
  TodayOpCodesCard.tsx        read-only list of OC/CI/CX/LE entries for today (already filtered
                              by removed_at IS NULL at query layer)
  TodayBlockCard.tsx          block date range, status badge (Final / Active), link to /schedule
  TodayOpenShiftsCard.tsx     PRN only: unsignaled open shift count, link to
                              /availability/open-shifts?blockId=<prelim_block_id>
```

**Shared constant:** `STATE_COLORS` extracted from `components/schedule/WeekView.tsx` to `lib/schedule/cell-colors.ts`:
```ts
export const STATE_COLORS: Record<string, string> = {
  working: 'bg-green-500',
  cannot_work: 'bg-red-400',
  off: 'bg-slate-300',
  fmla: 'bg-purple-400',
}
```
Both `WeekView` and `TodayShiftCard` import from this shared location.

---

## Edge Cases

| Scenario | Behaviour |
|----------|-----------|
| No active or final block | Full-width card: "No active schedule. Check back when your manager posts the next block." All other sections hidden. |
| Block is `preliminary` or `preliminary_draft` | Same as "no active block" — fallback card shown. |
| Today is outside the block date range | Shift card shows "—" for status (no shift row for this date); week strip starts from `block.start_date` |
| Therapist is off today | Shift card shows "OFF" with slate styling; lead field hidden |
| No lead assigned today | Shift card shows "No lead assigned" in muted slate text |
| No pending / unexpired swaps | Swaps card: "No pending requests" — card always rendered |
| PRN with no open shifts (no prelim block, or all signaled) | Open Shifts card: "No open shifts right now" — card still rendered for PRN |
| FT therapist | Open Shifts card **not rendered** (not mounted) |
| No operational entries for today | Op Codes card: "No codes entered for today" |
| Therapist has no department | Inline message on page: "Your account is not assigned to a department. Contact your manager." |
| Block ends in < 7 days | Week strip shows remaining days only — no backfill |

---

## Files Changed

| Action | File |
|--------|------|
| Modified | `middleware.ts` — line 44: change redirect destination from `/schedule` to `/` |
| Modified | `app/page.tsx` — fetch profile role; redirect therapist → `/today`, manager → `/schedule`, no session → `/login` |
| New | `app/(app)/today/page.tsx` |
| New | `components/today/TodayShiftCard.tsx` |
| New | `components/today/TodayWeekStrip.tsx` |
| New | `components/today/TodaySwapsCard.tsx` |
| New | `components/today/TodayOpCodesCard.tsx` |
| New | `components/today/TodayBlockCard.tsx` |
| New | `components/today/TodayOpenShiftsCard.tsx` |
| New | `lib/schedule/cell-colors.ts` |
| Modified | `components/shell/Sidebar.tsx` — add "Today" nav item for therapist role |
| Modified | `components/schedule/WeekView.tsx` — import STATE_COLORS from shared location |

---

## Out of Scope

- Real-time updates (no Supabase Realtime on this page)
- Inline swap approval/rejection (links to `/swaps`)
- Manager view of any therapist's today page
- Push notifications
- Availability submission actions (links to existing availability pages)
- Playwright E2E coverage (deferred to a future hardening pass)
