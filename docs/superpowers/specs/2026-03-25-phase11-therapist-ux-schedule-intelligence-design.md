# Phase 11 — Therapist UX Completion & Schedule Intelligence Design

## Overview

Phase 11 has two tracks delivered sequentially:

1. **Therapist UX** — fix broken navigation, add a change-requests view for therapists, and add a personal upcoming-shifts page
2. **Schedule Intelligence** — live conflict detection in the schedule grid and a fairness/equity metrics page for managers

No new npm dependencies. No new Supabase migrations.

---

## Track 1: Therapist UX

### 1. Nav Fixes

**File:** `components/shell/Sidebar.tsx`

- Fix therapist nav item: `/open-shifts` → `/availability/open-shifts`
- Add therapist nav item: `/change-requests` (label: "My Requests")
- Add manager nav item: `/fairness` (label: "Fairness") — see Track 2

### 2. `/change-requests` Page

**File:** `app/(app)/change-requests/page.tsx`

- Therapist-only server component (redirect manager to `/schedule`)
- Fetches `preliminary_change_requests` for the current user, ordered by `created_at` descending
- Groups requests by block (shows block date range as section heading)
- Displays per request: request type, shift date, therapist note, status badge (pending / approved / denied), manager response note (if set)
- Read-only — no actions; data already exists via `preliminary_change_requests` table and existing server actions
- Empty state: "No change requests yet"

### 3. `/my-schedule` Page

**File:** `app/(app)/my-schedule/page.tsx`

- Therapist-only server component (redirect manager to `/schedule`)
- Fetches all `shifts` for the current user joined to `schedule_blocks`, filtered to `cell_state = 'working'` and block status not `preliminary_draft`, ordered by `shift_date` ascending
- Also fetches pending `swap_requests` where current user is requester or partner (joined through shift ids) to show inline swap status
- Groups rows by block (section heading: block date range + shift type badge)
- Per row: shift date (formatted), day of week, shift type (Day/Night), swap badge if a pending swap involves this shift
- "Past" section for completed/active blocks vs "Upcoming" for final/preliminary blocks
- Add to therapist sidebar nav (label: "My Schedule")
- Empty state: "No scheduled shifts found"

---

## Track 2: Schedule Intelligence

### 4. Conflict Detection

#### Data Loading

**File:** `app/(app)/schedule/page.tsx`

- After fetching shifts for the selected block, also fetch `availability_entries` joined to `availability_submissions` for all therapists in the department, filtered to the block's date range
- Build a conflict lookup map: `Record<string, string>` keyed by `${userId}_${shiftDate}` → `entry_type`
- Pass this map to `ScheduleGrid` as a new `availabilityMap` prop

#### Pure Helper

**File:** `lib/schedule/conflict-detection.ts`

```ts
export type ConflictType = 'cannot_work' | 'wrong_shift_type' | null

export function detectConflict(
  cellState: string,
  availEntryType: string | undefined,
  blockShiftType: 'day' | 'night'
): ConflictType
```

- Returns `'cannot_work'` when `cellState = 'working'` and `availEntryType = 'cannot_work'`
- Returns `'wrong_shift_type'` when `cellState = 'working'` and `availEntryType` is the opposite shift's available type (e.g. `available_night` on a day block)
- Returns `null` otherwise
- Pure function — no Supabase calls; independently unit-testable

#### `GridCell` — Passive Indicator

**File:** `components/schedule/GridCell.tsx`

- Receives `conflictType: ConflictType | null` prop (derived from `availabilityMap` in `ScheduleGrid`)
- When `conflictType` is non-null and cell is in manager-editable mode: adds yellow border (`border-yellow-400`) and a small warning icon (⚠) in the top-right corner
- Tooltip on hover: "Availability conflict: therapist marked cannot_work" or "wrong shift type"
- No visual change for therapist read-only view

#### `CellPanel` — Confirm on Save

**File:** `components/schedule/CellPanel.tsx`

- Receives `conflictType: ConflictType | null` prop
- When manager clicks a new state that would create or maintain a conflict (i.e. setting `cell_state = 'working'` and `conflictType` is non-null):
  - Shows a shadcn `AlertDialog` before firing the server action
  - Dialog title: "Availability conflict"
  - Dialog body: "This therapist marked [cannot_work / wrong shift type] on this date. Schedule them anyway?"
  - Buttons: "Cancel" (abort) and "Schedule anyway" (proceed with optimistic update as normal)
- If manager cancels, no state change occurs; optimistic update is never applied

### 5. `/fairness` Page

#### Fetch Helper

**File:** `lib/fairness/fetch-therapist-equity.ts`

- Queries `shifts` joined to `schedule_blocks` and `users` for the current department
- Filters: `shifts.cell_state = 'working'`, block status in `['active', 'completed', 'final']`
- Groups by `user_id`, `block_id`, `schedule_blocks.shift_type`
- Returns:

```ts
export interface TherapistBlockRow {
  userId: string
  fullName: string
  employmentType: 'full_time' | 'prn'
  blockId: string
  blockLabel: string  // e.g. "Day — Mar 1 – Apr 11"
  shiftType: 'day' | 'night'
  workingCount: number
}
```

#### Page

**File:** `app/(app)/fairness/page.tsx`

- Manager-only server component (redirect therapist to `/today`)
- Calls `fetch-therapist-equity.ts`, pivots into a table structure: therapist rows × block columns
- Each cell shows day count / night count (e.g. "8D / 6N") for that block
- Last column: all-time totals (sum across all fetched blocks)
- FT section first, PRN section below, separated by a divider
- Column headers: block label + shift type badge
- No filters in v1 — shows all non-draft blocks with at least one working shift
- Manager sidebar nav item: "Fairness"

---

## New Files

| File | Purpose |
|------|---------|
| `app/(app)/change-requests/page.tsx` | Therapist change request history |
| `app/(app)/my-schedule/page.tsx` | Therapist upcoming shifts list |
| `app/(app)/fairness/page.tsx` | Manager fairness/equity metrics |
| `lib/schedule/conflict-detection.ts` | Pure conflict detection helper |
| `lib/fairness/fetch-therapist-equity.ts` | Equity data fetch helper |

## Modified Files

| File | Change |
|------|--------|
| `components/shell/Sidebar.tsx` | Fix `/open-shifts` route; add My Schedule, My Requests, Fairness nav items |
| `app/(app)/schedule/page.tsx` | Fetch availability_entries; build availabilityMap; pass to ScheduleGrid |
| `components/schedule/ScheduleGrid.tsx` | Accept availabilityMap; pass conflictType to GridCell and CellPanel |
| `components/schedule/GridCell.tsx` | Render conflict indicator (yellow border + icon) |
| `components/schedule/CellPanel.tsx` | Show AlertDialog before saving conflicting state |

## Tests

| File | What's tested |
|------|--------------|
| `tests/unit/conflict-detection.test.ts` | `detectConflict()` — all combinations of cellState × availEntryType × blockShiftType |
| `tests/unit/fairness.test.ts` | `fetch-therapist-equity.ts` pivot logic (pure data transformation) |

---

## Sequence

1. Nav fixes (Sidebar.tsx)
2. `/change-requests` page
3. `/my-schedule` page
4. `conflict-detection.ts` + unit tests
5. Schedule page data loading (availabilityMap)
6. GridCell conflict indicator
7. CellPanel confirm dialog
8. `fetch-therapist-equity.ts` + unit tests
9. `/fairness` page

---

## Non-Goals

- No new Supabase migrations
- No drag-and-drop grid editing
- No cross-block swap support
- No iCal export
- No CI/E2E hardening (Phase 12 candidate)
