# Therapist Today Hub — Design Spec

**Date:** 2026-03-24
**Phase:** 7
**Status:** Approved

---

## Overview

A dedicated `/today` route that serves as the default landing page for therapists after login. Provides a focused daily view: current shift status, upcoming schedule, pending swaps, operational codes, block context, and (for PRN staff) open shift opportunities — all without navigating the full schedule grid.

Managers are unaffected: they continue to land on `/schedule`.

---

## Route & Navigation

- **URL:** `/today` — new route under `app/(app)/today/page.tsx`
- **Auth:** Server component; redirects to `/login` if unauthenticated
- **Role guard:** Managers redirected to `/schedule`; therapists without a department redirected to an error state
- **Default redirect:** `middleware.ts` updated — therapists land on `/today` post-login; managers continue to `/schedule`
- **Sidebar:** "Today" nav item added for `therapist` role only, positioned above "Schedule"

---

## Data Fetching

Single `Promise.all` in `page.tsx` — all queries fire in parallel, page latency = slowest single query.

| # | Query | Table / View | Condition |
|---|-------|-------------|-----------|
| 1 | Profile + department | `users` | `id = user.id` |
| 2 | Active/final block | `schedule_blocks` | `department_id`, status in `['final','active']`, most recent |
| 3 | Therapist's shifts for active block | `shifts` | `user_id = user.id`, `schedule_block_id = block.id` |
| 4 | Lead for today | `shifts` | `shift_date = today`, `lead_user_id IS NOT NULL`, same block |
| 5 | Pending swap requests | `swap_requests` | `(requester_id = user OR partner_id = user)`, `status = 'pending'` |
| 6 | Operational entries for today | `operational_entries` | `user_id = user.id`, `entry_date = today` |
| 7 | Open shifts (PRN only) | `prn_shift_interest` | Skipped entirely if `employment_type = 'full_time'` |

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
│  Next 7 days mini-calendar, today highlighted        │
├──────────────────────┬──────────────────────────────┤
│  TodaySwapsCard      │  TodayOpCodesCard             │
│  (pending count +    │  (read-only OC/CI/CX/LE       │
│   link to /swaps)    │   entries for today)          │
├──────────────────────┼──────────────────────────────┤
│  TodayBlockCard      │  TodayOpenShiftsCard          │
│  (block dates,       │  (PRN only — omitted          │
│   status, link)      │   entirely for FT)            │
└──────────────────────┴──────────────────────────────┘
```

Tailwind: `grid grid-cols-1 md:grid-cols-2 gap-4` for the bottom 4 cards. Collapses to single column on mobile.

---

## Components

All components are **presentational** — no data fetching of their own. All data passed as props from `page.tsx`.

```
app/(app)/today/page.tsx

components/today/
  TodayShiftCard.tsx          shift status, shift type, lead name, block badge
  TodayWeekStrip.tsx          7-day mini-calendar, today highlighted
  TodaySwapsCard.tsx          pending count + summary + link to /swaps
  TodayOpCodesCard.tsx        read-only OC/CI/CX/LE list for today
  TodayBlockCard.tsx          block name, status badge, link to /schedule
  TodayOpenShiftsCard.tsx     PRN only: count + link to /availability/open-shifts
```

**Shared constant:** `STATE_COLORS` extracted from `components/schedule/WeekView.tsx` to `lib/schedule/cell-colors.ts` — used by both `WeekView` and `TodayShiftCard`.

---

## Edge Cases

| Scenario | Behaviour |
|----------|-----------|
| No active or final block | Full-width card: "No active schedule. Check back when your manager posts the next block." All other sections hidden. |
| Today is outside the block date range | Shift card shows "—" for status; week strip still renders block dates |
| Therapist is off today | Shift card shows "OFF" with grey styling; lead field hidden |
| No lead assigned today | Shift card shows "No lead assigned" in muted text |
| No pending swaps | Swaps card: "No pending requests" — card always rendered |
| PRN with no open shifts | Open Shifts card: "No open shifts right now" |
| FT therapist | Open Shifts card not rendered at all (not just hidden) |

---

## Files Changed

| Action | File |
|--------|------|
| New | `app/(app)/today/page.tsx` |
| New | `components/today/TodayShiftCard.tsx` |
| New | `components/today/TodayWeekStrip.tsx` |
| New | `components/today/TodaySwapsCard.tsx` |
| New | `components/today/TodayOpCodesCard.tsx` |
| New | `components/today/TodayBlockCard.tsx` |
| New | `components/today/TodayOpenShiftsCard.tsx` |
| New | `lib/schedule/cell-colors.ts` |
| Modified | `components/shell/Sidebar.tsx` — add "Today" nav item for therapist role |
| Modified | `middleware.ts` — update default redirect for therapist role |
| Modified | `components/schedule/WeekView.tsx` — import STATE_COLORS from shared location |

---

## Out of Scope

- Real-time updates (no Supabase Realtime on this page)
- Inline swap approval/rejection (links to `/swaps`)
- Manager view of any therapist's today page
- Push notifications
