# Phase 11 — Therapist UX Completion & Schedule Intelligence Design

## Overview

Phase 11 has two tracks delivered sequentially:

1. **Therapist UX** — fix broken navigation, add a change-requests view for therapists, and add a personal upcoming-shifts page
2. **Schedule Intelligence** — live conflict detection in the schedule grid and a fairness/equity metrics page for managers

No new npm dependencies. No new Supabase migrations.

---

## Key Schema Facts

For implementers — confirmed against `lib/types/database.types.ts`:

| Table | Relevant columns |
|-------|-----------------|
| `preliminary_change_requests` | `requester_id`, `schedule_block_id`, `request_type`, `note`, `status` (`'pending' \| 'accepted' \| 'rejected'`), `response_note`, `created_at` |
| `shifts` | `schedule_block_id`, `user_id`, `shift_date`, `cell_state` |
| `schedule_blocks` | `id`, `shift_type`, `start_date`, `end_date`, `status` |
| `availability_submissions` | `schedule_block_id`, `user_id` — no direct `block_id` |
| `availability_entries` | `submission_id`, `entry_date`, `entry_type` — no `user_id` or `block_id` directly |
| `swap_requests` | `requester_id`, `partner_id`, `requester_shift_id`, `partner_shift_id`, `status` |

The `shiftIndex` convention in `ScheduleGrid` uses `${userId}:${date}` (colon separator). All new lookup maps must use the same separator.

---

## Track 1: Therapist UX

### 1. Nav Fixes

**File:** `components/shell/Sidebar.tsx`

Current state (lines 25–26):
- `/open-shifts` — broken route; feature lives at `/availability/open-shifts`
- `/change-requests` — already present, no change needed

Changes:
- Fix line 25: `href: '/open-shifts'` → `href: '/availability/open-shifts'`
- Add therapist nav item: `{ href: '/my-schedule', label: 'My Schedule', roles: ['therapist'] }`
- Add manager nav item: `{ href: '/fairness', label: 'Fairness', roles: ['manager'] }` — see Track 2

### 2. `/change-requests` Page

**File:** `app/(app)/change-requests/page.tsx`

- Therapist-only server component (redirect manager to `/schedule`)
- Fetches `preliminary_change_requests` where `requester_id = currentUserId`, ordered by `created_at` descending
- For each request, joins `schedule_blocks` via `schedule_block_id` to show the block date range as a section heading
- Displays per request: `request_type`, shift date (via `shift_id` → `shifts.shift_date` join), `note`, status badge (`pending` / `accepted` / `rejected`), `response_note` if set
- Read-only — no actions; all data already present in DB
- Empty state: "No change requests yet"

> Note: `preliminary_change_requests` is a manually-typed table — access via `(supabase as any).from('preliminary_change_requests')` per the Manual Table Access Pattern.

### 3. `/my-schedule` Page

**File:** `app/(app)/my-schedule/page.tsx`

- Therapist-only server component (redirect manager to `/schedule`)
- **Shifts fetch:** query `shifts` joined to `schedule_blocks` where `shifts.user_id = currentUserId` AND `shifts.cell_state = 'working'` AND `schedule_blocks.status NOT IN ('preliminary_draft')`, ordered by `shifts.shift_date` ascending. The join key is `shifts.schedule_block_id = schedule_blocks.id`.
- **Swaps fetch:** query `swap_requests` where `requester_id = currentUserId OR partner_id = currentUserId` AND `status = 'pending'`. Collect `requester_shift_id` and `partner_shift_id` into a Set. A shift row shows a swap badge if its `id` is in that Set.
- Groups rows by block (section heading: `[shift_type badge] start_date – end_date`)
- Splits into "Upcoming" (block status `preliminary` / `final` / `active`) and "Past" (status `completed`) sections
- Per row: formatted shift date, day of week, shift type (Day/Night), swap pending badge if applicable
- Add to therapist sidebar nav (label: "My Schedule") — see nav fixes above
- Empty state: "No scheduled shifts found"

---

## Track 2: Schedule Intelligence

### 4. Conflict Detection

#### Data Loading

**File:** `app/(app)/schedule/page.tsx`

Two-step availability fetch for the selected block:
1. Fetch all `availability_submissions` where `schedule_block_id = blockId` — collect submission IDs and build a `submissionId → userId` map
2. Fetch all `availability_entries` where `submission_id IN (submissionIds)` — for each entry, look up the `userId` from the map and insert into the availability map

Build `availabilityMap: Record<string, string>` keyed by `${userId}:${entry_date}` → `entry_type`.

Pass `availabilityMap` as a new prop to `ScheduleGrid`.

`availability_entries` is in the typed schema and can be accessed without the `(supabase as any)` cast. `availability_submissions` is also typed.

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

Logic:
- Returns `'cannot_work'` when `cellState = 'working'` and `availEntryType = 'cannot_work'`
- Returns `'wrong_shift_type'` when `cellState = 'working'` and `availEntryType` is the opposite shift's type (i.e. `'available_night'` on a day block, or `'available_day'` on a night block)
- Returns `null` in all other cases (no conflict, or cell not working)
- Pure function — no Supabase calls; independently unit-testable

#### `ScheduleGrid` — Wiring

**File:** `components/schedule/ScheduleGrid.tsx`

New prop: `availabilityMap?: Record<string, string>`

New state: `panelConflictType: ConflictType | null` (initialized to `null`)

In `handleCellClick(shift, date, user)`:
- After setting existing panel state, compute: `const availEntry = availabilityMap?.[`${user.id}:${date}`]`
- Call `detectConflict(shift?.cell_state ?? 'off', availEntry, block.shift_type)`
- Store result in `setPanelConflictType(result)`

Pass to `GridCell` (computed inline per render, not stored in state):
- `availConflict={detectConflict(getShift(user.id, date)?.cell_state ?? 'off', availabilityMap?.[`${user.id}:${date}`], block.shift_type)}`

Pass to `CellPanel`:
- `conflictType={panelConflictType}`

#### `GridCell` — Passive Indicator

**File:** `components/schedule/GridCell.tsx`

New prop: `availConflict?: ConflictType` (default: `null`)

This is separate from the existing `isConflicted` prop (which covers constraint-diff conflicts from copy-block). The two can coexist on the same cell with distinct visuals:
- `isConflicted` → existing amber `ring-2 ring-inset ring-amber-400` + amber dot (unchanged)
- `availConflict` non-null → add `border-yellow-400 border-2` to the cell + a small `⚠` text indicator in the top-left (only when `isConflicted` dot is not already there, use top-right otherwise)

Tooltip on the `⚠` indicator: `"cannot_work conflict"` or `"wrong shift type"`

Only render `availConflict` indicators when `userRole = 'manager'` (not for therapist read-only view) — `ScheduleGrid` already has `userRole` in scope and passes it to cells.

#### `CellPanel` — Confirm on Save

**File:** `components/schedule/CellPanel.tsx`

New prop: `conflictType?: ConflictType` (default: `null`)

When manager clicks to set a new `cell_state` of `'working'` and `conflictType` is non-null:
- Intercept the save with a shadcn `AlertDialog` before calling the server action
- Dialog title: `"Availability conflict"`
- Dialog body: `"This therapist marked ${conflictType === 'cannot_work' ? 'cannot work' : 'a different shift type'} on this date. Schedule them anyway?"`
- Buttons: `"Cancel"` (abort, no state change) and `"Schedule anyway"` (proceed — fires server action and optimistic update as normal)
- If the new state is not `'working'`, no dialog — save proceeds immediately regardless of `conflictType`

### 5. `/fairness` Page

#### Data & Helpers

**File:** `lib/fairness/fetch-therapist-equity.ts`

Exports two functions:

**`fetchEquityRows(supabase, departmentId): Promise<TherapistBlockRow[]>`**

Uses three separate queries joined in TypeScript — consistent with the pattern in `lib/ops/fetch-block-health.ts`:

1. Fetch `schedule_blocks` where `department_id = departmentId` AND `status IN ('active', 'completed', 'final')` → collect `blockIds`
2. Fetch `shifts` where `schedule_block_id IN (blockIds)` AND `cell_state = 'working'` → collect `userIds`
3. Fetch `users` where `id IN (userIds)` → build a `userId → { full_name, employment_type }` map

Aggregate in TypeScript: group by `(user_id, schedule_block_id, block.shift_type)`, count rows.

Returns flat array of `TherapistBlockRow`:

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

> Note: `is_active` is absent from `database.types.ts` (manual stub omits it). For v1, do not filter on it — the page will show historical data for all therapists including deactivated ones, which is acceptable. If active-only filtering is added later, use `(supabase as any)` and `.eq('is_active', true)` on the users query.

**`pivotEquityRows(rows: TherapistBlockRow[]): PivotedTable`**
- Pure function — groups rows by therapist, aggregates working counts by block and shift type
- Returns a structure suitable for rendering the table: ordered therapist list, ordered block columns, per-cell `{ dayCount, nightCount }`, per-therapist totals
- This is what the unit test covers

#### Page

**File:** `app/(app)/fairness/page.tsx`

- Manager-only server component (redirect therapist to `/today`)
- Fetches `departmentId` from the current user session via `lib/auth.ts`
- Calls `fetchEquityRows(supabase, departmentId)` then `pivotEquityRows(rows)`
- Renders a table: therapist rows × block columns
- Each cell: `"8D / 6N"` format (day count / night count for that block)
- Final column: all-time totals
- FT section first, PRN section below, separated by a heading/divider
- Column headers: block label (e.g. "Day — Mar 1–Apr 11")
- No filters in v1
- Manager sidebar nav item: "Fairness" — see nav fixes above

---

## New Files

| File | Purpose |
|------|---------|
| `app/(app)/change-requests/page.tsx` | Therapist change request history |
| `app/(app)/my-schedule/page.tsx` | Therapist upcoming shifts list |
| `app/(app)/fairness/page.tsx` | Manager fairness/equity metrics |
| `lib/schedule/conflict-detection.ts` | Pure `detectConflict()` helper |
| `lib/fairness/fetch-therapist-equity.ts` | DB fetch + pure pivot helpers |

## Modified Files

| File | Change |
|------|--------|
| `components/shell/Sidebar.tsx` | Fix `/open-shifts` href; add My Schedule and Fairness nav items |
| `app/(app)/schedule/page.tsx` | Two-step availability fetch; build `availabilityMap`; pass to `ScheduleGrid` |
| `components/schedule/ScheduleGrid.tsx` | Accept `availabilityMap` prop; compute `availConflict` per cell; store `panelConflictType` in click handler; pass both to `GridCell` and `CellPanel` |
| `components/schedule/GridCell.tsx` | Add `availConflict` prop; render yellow border + ⚠ indicator (manager-only, coexists with existing `isConflicted` amber ring) |
| `components/schedule/CellPanel.tsx` | Add `conflictType` prop; show `AlertDialog` before saving `'working'` on a conflicting cell |

## Tests

| File | What's tested |
|------|--------------|
| `tests/unit/conflict-detection.test.ts` | `detectConflict()` — all combinations of `cellState` × `availEntryType` × `blockShiftType` (pure, no mocks needed) |
| `tests/unit/fairness.test.ts` | `pivotEquityRows()` — grouping, day/night counts, totals (pure, no mocks needed) |

---

## Implementation Sequence

1. Nav fixes (`components/shell/Sidebar.tsx`)
2. `/change-requests` page
3. `/my-schedule` page
4. `lib/schedule/conflict-detection.ts` + `tests/unit/conflict-detection.test.ts`
5. Schedule page availability fetch (`app/(app)/schedule/page.tsx`)
6. `ScheduleGrid` wiring (`availabilityMap` prop + `panelConflictType` state)
7. `GridCell` conflict indicator
8. `CellPanel` confirm dialog
9. `lib/fairness/fetch-therapist-equity.ts` + `tests/unit/fairness.test.ts`
10. `/fairness` page

---

## Non-Goals

- No new Supabase migrations
- No drag-and-drop grid editing
- No cross-block swap support
- No iCal export
- No CI/E2E hardening (Phase 12 candidate)
