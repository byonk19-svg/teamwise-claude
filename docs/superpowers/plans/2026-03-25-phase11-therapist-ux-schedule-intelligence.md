# Phase 11 — Therapist UX Completion & Schedule Intelligence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the therapist experience (fix broken nav, add change-requests page, add my-schedule page) and add schedule intelligence (live conflict detection in the grid, fairness/equity metrics page).

**Architecture:** Sequential delivery — Track 1 (therapist UX) first, Track 2 (schedule intelligence) second. No new npm dependencies, no new Supabase migrations. All new data fetches follow the established 3-query-then-join pattern from `lib/ops/fetch-block-health.ts`. Conflict detection is a pure helper function threaded through existing ScheduleGrid props.

**Tech Stack:** Next.js 14 App Router, TypeScript, Supabase (anon client + @supabase/ssr), Tailwind CSS, shadcn/ui (AlertDialog), Vitest

**Spec:** `docs/superpowers/specs/2026-03-25-phase11-therapist-ux-schedule-intelligence-design.md`

---

## File Map

### Create
| File | Purpose |
|------|---------|
| `app/(app)/change-requests/page.tsx` | Therapist change request history — read-only |
| `app/(app)/my-schedule/page.tsx` | Therapist upcoming working shifts across blocks |
| `app/(app)/fairness/page.tsx` | Manager equity metrics table |
| `lib/schedule/conflict-detection.ts` | Pure `detectConflict()` helper |
| `lib/fairness/fetch-therapist-equity.ts` | DB fetch + pure `pivotEquityRows()` |
| `tests/unit/conflict-detection.test.ts` | Unit tests for `detectConflict()` |
| `tests/unit/fairness.test.ts` | Unit tests for `pivotEquityRows()` |

### Modify
| File | Change |
|------|--------|
| `components/shell/Sidebar.tsx` | Fix `/open-shifts` href; add My Schedule + Fairness nav items |
| `app/(app)/schedule/page.tsx` | Two-step availability fetch; pass `availabilityMap` to `ScheduleGrid` |
| `components/schedule/ScheduleGrid.tsx` | Accept `availabilityMap`; wire `panelConflictType` through `handleCellClick`; pass `availConflict` to `GridCell` and `conflictType` to `CellPanel` |
| `components/schedule/GridCell.tsx` | Add `availConflict` prop; render yellow border + ⚠ indicator (manager-only) |
| `components/schedule/CellPanel.tsx` | Add `conflictType` prop; intercept `handleStateChange` with `AlertDialog` when setting `'working'` on a conflicting cell |

---

## Task 1: Fix Sidebar Navigation

**Files:**
- Modify: `components/shell/Sidebar.tsx:16-27`

- [ ] **Step 1: Fix `/open-shifts` href and add new nav items**

In `Sidebar.tsx`, update `NAV_ITEMS`:

```tsx
const NAV_ITEMS: NavItem[] = [
  { href: '/today',                  label: 'Today',           roles: ['therapist'] },
  { href: '/my-schedule',            label: 'My Schedule',     roles: ['therapist'] },
  { href: '/schedule',               label: 'Schedule',        roles: ['manager', 'therapist'] },
  { href: '/availability',           label: 'Availability',    roles: ['manager', 'therapist'] },
  { href: '/swaps',                  label: 'Swaps',           roles: ['manager', 'therapist'] },
  { href: '/coverage',               label: 'Coverage',        roles: ['manager'] },
  { href: '/ops',                    label: 'Ops',             roles: ['manager'] },
  { href: '/fairness',               label: 'Fairness',        roles: ['manager'] },
  { href: '/staff',                  label: 'Staff',           roles: ['manager'] },
  { href: '/settings',               label: 'Settings',        roles: ['manager'] },
  { href: '/availability/open-shifts', label: 'Open Shifts',   roles: ['therapist'] },
  { href: '/change-requests',        label: 'Change Requests', roles: ['therapist'] },
]
```

> Note: `/my-schedule` is listed BEFORE `/schedule` in the array intentionally. The `active` check is `pathname.startsWith(item.href)` — if `/my-schedule` were after `/schedule`, there would be no collision (the strings don't prefix each other), but leading with the more specific route is clearer.

- [ ] **Step 2: Verify lint passes**

```bash
npm run lint
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/shell/Sidebar.tsx
git commit -m "fix: correct open-shifts nav href; add My Schedule and Fairness nav items"
```

---

## Task 2: Change Requests Page

**Files:**
- Create: `app/(app)/change-requests/page.tsx`

This is a therapist-only server component. The `preliminary_change_requests` table is manually typed — use `(supabase as any)`. We fetch change requests, then their associated blocks and shifts in two follow-up queries.

- [ ] **Step 1: Create the page**

```tsx
// app/(app)/change-requests/page.tsx
import { redirect } from 'next/navigation'
import { getServerUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { Badge } from '@/components/ui/badge'
import { format } from 'date-fns'
import type { Database } from '@/lib/types/database.types'

type BlockRow = Database['public']['Tables']['schedule_blocks']['Row']
type ShiftRow = Database['public']['Tables']['shifts']['Row']

interface ChangeRequest {
  id: string
  schedule_block_id: string
  requester_id: string
  shift_id: string
  request_type: 'move_shift' | 'mark_off' | 'other'
  note: string | null
  status: 'pending' | 'accepted' | 'rejected'
  response_note: string | null
  created_at: string
}

const REQUEST_TYPE_LABELS: Record<string, string> = {
  move_shift: 'Move Shift',
  mark_off:   'Mark Off',
  other:      'Other',
}

const STATUS_VARIANTS: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  pending:  'secondary',
  accepted: 'default',
  rejected: 'destructive',
}

export default async function ChangeRequestsPage() {
  const user = await getServerUser()
  if (!user) redirect('/login')

  const supabase = createClient()

  const { data: profileData } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single()

  if (!profileData) redirect('/login')
  if (profileData.role === 'manager') redirect('/schedule')

  // Fetch change requests for this therapist (manual table — cast required)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: requestsData } = await (supabase as any)
    .from('preliminary_change_requests')
    .select('*')
    .eq('requester_id', user.id)
    .order('created_at', { ascending: false })

  const requests = (requestsData ?? []) as ChangeRequest[]

  if (requests.length === 0) {
    return (
      <div className="p-8">
        <h1 className="text-xl font-semibold text-slate-900 mb-6">Change Requests</h1>
        <p className="text-slate-500 text-sm">No change requests yet.</p>
      </div>
    )
  }

  // Fetch associated blocks and shifts in bulk
  const blockIds = Array.from(new Set(requests.map(r => r.schedule_block_id)))
  const shiftIds = Array.from(new Set(requests.map(r => r.shift_id)))

  const { data: blocksData } = await supabase
    .from('schedule_blocks')
    .select('id, shift_type, start_date, end_date')
    .in('id', blockIds)

  const { data: shiftsData } = await supabase
    .from('shifts')
    .select('id, shift_date')
    .in('id', shiftIds)

  const blockMap = new Map((blocksData ?? []).map(b => [b.id, b as Pick<BlockRow, 'id' | 'shift_type' | 'start_date' | 'end_date'>]))
  const shiftMap = new Map((shiftsData ?? []).map(s => [s.id, s as Pick<ShiftRow, 'id' | 'shift_date'>]))

  // Group by block
  const byBlock = new Map<string, ChangeRequest[]>()
  for (const req of requests) {
    const group = byBlock.get(req.schedule_block_id) ?? []
    group.push(req)
    byBlock.set(req.schedule_block_id, group)
  }

  return (
    <div className="p-6 max-w-2xl">
      <h1 className="text-xl font-semibold text-slate-900 mb-6">Change Requests</h1>

      <div className="space-y-8">
        {Array.from(byBlock.entries()).map(([blockId, blockRequests]) => {
          const block = blockMap.get(blockId)
          const blockLabel = block
            ? `${block.shift_type === 'day' ? 'Day' : 'Night'} — ${format(new Date(block.start_date + 'T00:00:00'), 'MMM d')} – ${format(new Date(block.end_date + 'T00:00:00'), 'MMM d, yyyy')}`
            : 'Unknown Block'

          return (
            <div key={blockId}>
              <h2 className="text-sm font-medium text-slate-500 uppercase tracking-wide mb-3">
                {blockLabel}
              </h2>
              <div className="space-y-3">
                {blockRequests.map(req => {
                  const shift = shiftMap.get(req.shift_id)
                  const shiftDate = shift
                    ? format(new Date(shift.shift_date + 'T00:00:00'), 'EEEE, MMMM d')
                    : 'Unknown date'

                  return (
                    <div key={req.id} className="border border-slate-200 rounded-lg p-4 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-slate-900">{shiftDate}</span>
                        <Badge variant={STATUS_VARIANTS[req.status]}>
                          {req.status.charAt(0).toUpperCase() + req.status.slice(1)}
                        </Badge>
                      </div>
                      <p className="text-xs text-slate-500">
                        Type: {REQUEST_TYPE_LABELS[req.request_type] ?? req.request_type}
                      </p>
                      {req.note && (
                        <p className="text-sm text-slate-700">
                          <span className="font-medium">Your note:</span> {req.note}
                        </p>
                      )}
                      {req.response_note && (
                        <p className="text-sm text-slate-700">
                          <span className="font-medium">Manager response:</span> {req.response_note}
                        </p>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify build**

```bash
npm run build 2>&1 | tail -20
```
Expected: no TypeScript errors for the new file.

- [ ] **Step 3: Commit**

```bash
git add app/\(app\)/change-requests/page.tsx
git commit -m "feat: add therapist change requests page"
```

---

## Task 3: My Schedule Page

**Files:**
- Create: `app/(app)/my-schedule/page.tsx`

Therapist-only server component. Fetches working shifts + block data (two typed queries), then pending swaps (manual table). Groups into Upcoming / Past sections.

- [ ] **Step 1: Create the page**

```tsx
// app/(app)/my-schedule/page.tsx
import { redirect } from 'next/navigation'
import { getServerUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { Badge } from '@/components/ui/badge'
import { format } from 'date-fns'
import type { Database } from '@/lib/types/database.types'

type BlockRow = Database['public']['Tables']['schedule_blocks']['Row']
type ShiftRow = Database['public']['Tables']['shifts']['Row']

interface SwapRequest {
  requester_shift_id: string
  partner_shift_id: string
  status: string
}

export default async function MySchedulePage() {
  const user = await getServerUser()
  if (!user) redirect('/login')

  const supabase = createClient()

  const { data: profileData } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single()

  if (!profileData) redirect('/login')
  if (profileData.role === 'manager') redirect('/schedule')

  // Fetch working shifts (typed — no cast needed)
  const { data: shiftsData } = await supabase
    .from('shifts')
    .select('id, schedule_block_id, shift_date, cell_state')
    .eq('user_id', user.id)
    .eq('cell_state', 'working')
    .order('shift_date', { ascending: true })

  const shifts = (shiftsData ?? []) as Pick<ShiftRow, 'id' | 'schedule_block_id' | 'shift_date' | 'cell_state'>[]

  if (shifts.length === 0) {
    return (
      <div className="p-8">
        <h1 className="text-xl font-semibold text-slate-900 mb-6">My Schedule</h1>
        <p className="text-slate-500 text-sm">No scheduled shifts found.</p>
      </div>
    )
  }

  // Fetch blocks for those shifts
  const blockIds = Array.from(new Set(shifts.map(s => s.schedule_block_id)))
  const { data: blocksData } = await supabase
    .from('schedule_blocks')
    .select('id, shift_type, start_date, end_date, status')
    .in('id', blockIds)
    .not('status', 'eq', 'preliminary_draft')

  const blocks = (blocksData ?? []) as Pick<BlockRow, 'id' | 'shift_type' | 'start_date' | 'end_date' | 'status'>[]
  const blockMap = new Map(blocks.map(b => [b.id, b]))

  // Fetch pending swaps involving this therapist (manual table — cast required)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: swapsData } = await (supabase as any)
    .from('swap_requests')
    .select('requester_shift_id, partner_shift_id, status')
    .or(`requester_id.eq.${user.id},partner_id.eq.${user.id}`)
    .eq('status', 'pending')

  const pendingShiftIds = new Set<string>()
  for (const swap of (swapsData ?? []) as SwapRequest[]) {
    pendingShiftIds.add(swap.requester_shift_id)
    pendingShiftIds.add(swap.partner_shift_id)
  }

  // Filter to shifts whose block is loaded (excludes preliminary_draft)
  const validShifts = shifts.filter(s => blockMap.has(s.schedule_block_id))

  // Split into upcoming and past
  const upcomingStatuses = new Set(['preliminary', 'final', 'active'])
  const upcoming = validShifts.filter(s => upcomingStatuses.has(blockMap.get(s.schedule_block_id)!.status))
  const past = validShifts.filter(s => blockMap.get(s.schedule_block_id)!.status === 'completed')

  function blockLabel(block: Pick<BlockRow, 'shift_type' | 'start_date' | 'end_date'>) {
    return `${block.shift_type === 'day' ? 'Day' : 'Night'} — ${format(new Date(block.start_date + 'T00:00:00'), 'MMM d')} – ${format(new Date(block.end_date + 'T00:00:00'), 'MMM d, yyyy')}`
  }

  function groupByBlock(shiftList: typeof validShifts) {
    const groups = new Map<string, typeof validShifts>()
    for (const s of shiftList) {
      const group = groups.get(s.schedule_block_id) ?? []
      group.push(s)
      groups.set(s.schedule_block_id, group)
    }
    return groups
  }

  function ShiftList({ shiftList }: { shiftList: typeof validShifts }) {
    const groups = groupByBlock(shiftList)
    return (
      <div className="space-y-6">
        {Array.from(groups.entries()).map(([blockId, groupShifts]) => {
          const block = blockMap.get(blockId)!
          return (
            <div key={blockId}>
              <div className="flex items-center gap-2 mb-2">
                <Badge variant={block.shift_type === 'day' ? 'outline' : 'secondary'}>
                  {block.shift_type === 'day' ? 'Day' : 'Night'}
                </Badge>
                <span className="text-sm font-medium text-slate-700">{blockLabel(block)}</span>
              </div>
              <div className="space-y-1">
                {groupShifts.map(s => (
                  <div key={s.id} className="flex items-center justify-between py-1.5 px-3 rounded-md bg-slate-50 text-sm">
                    <span className="text-slate-900">
                      {format(new Date(s.shift_date + 'T00:00:00'), 'EEE, MMM d')}
                    </span>
                    {pendingShiftIds.has(s.id) && (
                      <Badge variant="secondary" className="text-xs">Swap Pending</Badge>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <div className="p-6 max-w-2xl space-y-10">
      <h1 className="text-xl font-semibold text-slate-900">My Schedule</h1>

      {upcoming.length > 0 && (
        <section>
          <h2 className="text-sm font-medium text-slate-500 uppercase tracking-wide mb-4">Upcoming</h2>
          <ShiftList shiftList={upcoming} />
        </section>
      )}

      {past.length > 0 && (
        <section>
          <h2 className="text-sm font-medium text-slate-500 uppercase tracking-wide mb-4">Past</h2>
          <ShiftList shiftList={past} />
        </section>
      )}

      {upcoming.length === 0 && past.length === 0 && (
        <p className="text-slate-500 text-sm">No scheduled shifts found.</p>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify build**

```bash
npm run build 2>&1 | tail -20
```
Expected: no TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add app/\(app\)/my-schedule/page.tsx
git commit -m "feat: add therapist my-schedule page"
```

---

## Task 4: Conflict Detection Helper + Tests (TDD)

**Files:**
- Create: `lib/schedule/conflict-detection.ts`
- Create: `tests/unit/conflict-detection.test.ts`

Write the test first, then implement.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/conflict-detection.test.ts
import { describe, it, expect } from 'vitest'
import { detectConflict } from '@/lib/schedule/conflict-detection'

describe('detectConflict', () => {
  describe('cannot_work conflicts', () => {
    it('returns cannot_work when working on a cannot_work day', () => {
      expect(detectConflict('working', 'cannot_work', 'day')).toBe('cannot_work')
    })
    it('returns cannot_work on a night block too', () => {
      expect(detectConflict('working', 'cannot_work', 'night')).toBe('cannot_work')
    })
  })

  describe('wrong_shift_type conflicts', () => {
    it('returns wrong_shift_type when working day block but available_night only', () => {
      expect(detectConflict('working', 'available_night', 'day')).toBe('wrong_shift_type')
    })
    it('returns wrong_shift_type when working night block but available_day only', () => {
      expect(detectConflict('working', 'available_day', 'night')).toBe('wrong_shift_type')
    })
  })

  describe('no conflict', () => {
    it('returns null when no availability entry exists', () => {
      expect(detectConflict('working', undefined, 'day')).toBeNull()
    })
    it('returns null when cell is off (not scheduled)', () => {
      expect(detectConflict('off', 'cannot_work', 'day')).toBeNull()
    })
    it('returns null when working day block and available_day', () => {
      expect(detectConflict('working', 'available_day', 'day')).toBeNull()
    })
    it('returns null when working night block and available_night', () => {
      expect(detectConflict('working', 'available_night', 'night')).toBeNull()
    })
    it('returns null when working and available_either', () => {
      expect(detectConflict('working', 'available_either', 'day')).toBeNull()
    })
    it('returns null when working and requesting_to_work', () => {
      expect(detectConflict('working', 'requesting_to_work', 'day')).toBeNull()
    })
    it('returns null when fmla state (not working)', () => {
      expect(detectConflict('fmla', 'cannot_work', 'day')).toBeNull()
    })
    it('returns null when cannot_work cell state (not a scheduled working cell)', () => {
      expect(detectConflict('cannot_work', 'cannot_work', 'day')).toBeNull()
    })
  })
})
```

- [ ] **Step 2: Run test — verify it fails**

```bash
npm test -- conflict-detection
```
Expected: FAIL — `Cannot find module '@/lib/schedule/conflict-detection'`

- [ ] **Step 3: Implement the helper**

```ts
// lib/schedule/conflict-detection.ts

export type ConflictType = 'cannot_work' | 'wrong_shift_type' | null

/**
 * Detects if a scheduled cell conflicts with a therapist's availability entry.
 * Only flags conflicts when the cell is 'working'.
 */
export function detectConflict(
  cellState: string,
  availEntryType: string | undefined,
  blockShiftType: 'day' | 'night'
): ConflictType {
  if (cellState !== 'working') return null
  if (!availEntryType) return null

  if (availEntryType === 'cannot_work') return 'cannot_work'

  if (blockShiftType === 'day' && availEntryType === 'available_night') return 'wrong_shift_type'
  if (blockShiftType === 'night' && availEntryType === 'available_day') return 'wrong_shift_type'

  return null
}
```

- [ ] **Step 4: Run tests — verify all pass**

```bash
npm test -- conflict-detection
```
Expected: 11 tests PASS.

- [ ] **Step 5: Run full test suite to check no regressions**

```bash
npm test
```
Expected: all existing tests still pass.

- [ ] **Step 6: Commit**

```bash
git add lib/schedule/conflict-detection.ts tests/unit/conflict-detection.test.ts
git commit -m "feat: add detectConflict helper with unit tests"
```

---

## Task 5: Availability Map in Schedule Page

**Files:**
- Modify: `app/(app)/schedule/page.tsx`

Add a two-step availability fetch after the existing shifts fetch. Pass `availabilityMap` to `ScheduleGrid`.

- [ ] **Step 1: Read the current end of the schedule page to find where ScheduleGrid is rendered**

```bash
grep -n "availabilityMap\|ScheduleGrid\|availability_submissions\|availability_entries" app/\(app\)/schedule/page.tsx
```
Expected: `ScheduleGrid` appears near the bottom; no existing availability map fetch.

- [ ] **Step 2: Add the availability fetch and map**

After the existing shifts fetch (after line ~100 in `app/(app)/schedule/page.tsx`), add:

```ts
// Build availability conflict map for the current block
// Step 1: fetch submissions for this block → submissionId → userId map
const { data: submissionsData } = await supabase
  .from('availability_submissions')
  .select('id, user_id')
  .eq('schedule_block_id', block.id)

const submissionUserMap = new Map(
  (submissionsData ?? []).map(s => [s.id, s.user_id])
)

// Step 2: fetch entries for those submissions
const submissionIds = Array.from(submissionUserMap.keys())
let availabilityMap: Record<string, string> = {}
if (submissionIds.length > 0) {
  const { data: entriesData } = await supabase
    .from('availability_entries')
    .select('submission_id, entry_date, entry_type')
    .in('submission_id', submissionIds)

  for (const entry of entriesData ?? []) {
    const userId = submissionUserMap.get(entry.submission_id)
    if (userId) {
      availabilityMap[`${userId}:${entry.entry_date}`] = entry.entry_type
    }
  }
}
```

Then pass `availabilityMap={availabilityMap}` to the `<ScheduleGrid>` component.

- [ ] **Step 3: Add `availabilityMap` prop to ScheduleGrid's Props interface**

In `components/schedule/ScheduleGrid.tsx`, add to the `Props` interface:

```ts
availabilityMap?: Record<string, string>
```

And add it to the destructured props in the function signature.

- [ ] **Step 4: Verify build**

```bash
npm run build 2>&1 | tail -20
```
Expected: no errors. (`availabilityMap` on ScheduleGrid is optional so existing callers don't break.)

- [ ] **Step 5: Commit**

```bash
git add app/\(app\)/schedule/page.tsx components/schedule/ScheduleGrid.tsx
git commit -m "feat: fetch availability map in schedule page and pass to ScheduleGrid"
```

---

## Task 6: Wire Conflict Detection Through ScheduleGrid

**Files:**
- Modify: `components/schedule/ScheduleGrid.tsx`

Add `panelConflictType` state, compute it in `handleCellClick`, pass `availConflict` to `GridCell` and `conflictType` to `CellPanel`.

- [ ] **Step 1: Import `detectConflict` and `ConflictType`**

At the top of `ScheduleGrid.tsx`, add:

```ts
import { detectConflict, type ConflictType } from '@/lib/schedule/conflict-detection'
```

- [ ] **Step 2: Add `panelConflictType` state**

After the existing `useState` declarations (around line 50), add:

```ts
const [panelConflictType, setPanelConflictType] = useState<ConflictType>(null)
```

- [ ] **Step 3: Update `handleCellClick` to compute `panelConflictType`**

At the end of `handleCellClick`, after `setPanelCurrentLeadUserId(...)`, add:

```ts
const availEntry = availabilityMap?.[`${user.id}:${date}`]
setPanelConflictType(detectConflict(shift?.cell_state ?? 'off', availEntry, block.shift_type))
```

- [ ] **Step 4: Pass `availConflict` to each `GridCell`**

In the JSX where `GridCell` is rendered, add the `availConflict` prop (computed inline):

```tsx
availConflict={
  userRole === 'manager'
    ? detectConflict(
        getShift(user.id, date)?.cell_state ?? 'off',
        availabilityMap?.[`${user.id}:${date}`],
        block.shift_type
      )
    : null
}
```

- [ ] **Step 5: Pass `conflictType` to `CellPanel`**

In the `CellPanel` JSX, add:

```tsx
conflictType={panelConflictType}
```

- [ ] **Step 6: Verify build**

```bash
npm run build 2>&1 | tail -20
```
Expected: TypeScript may warn that `availConflict` and `conflictType` are unknown props until Tasks 7 and 8 add them — that's fine, address in next tasks.

- [ ] **Step 7: Commit**

```bash
git add components/schedule/ScheduleGrid.tsx
git commit -m "feat: wire availabilityMap and conflict detection through ScheduleGrid"
```

---

## Task 7: GridCell Conflict Indicator

**Files:**
- Modify: `components/schedule/GridCell.tsx`

Add `availConflict` prop and render yellow border + ⚠ indicator alongside the existing amber `isConflicted` ring.

- [ ] **Step 1: Check for any uncommitted changes in GridCell first**

```bash
git diff components/schedule/GridCell.tsx
```
Review the diff to ensure the replacement below preserves any existing modifications. The plan's replacement preserves all content from the Phase 10 baseline — if you see unexpected additions, merge them into the replacement manually.

- [ ] **Step 2: Update GridCell Props and render**

Replace the entire file content:

```tsx
// components/schedule/GridCell.tsx
import { cn } from '@/lib/utils'
import { cellStateClass, cellStateLabel } from '@/lib/schedule/cell-state'
import type { Database } from '@/lib/types/database.types'
import type { ConflictType } from '@/lib/schedule/conflict-detection'

type Shift = Database['public']['Tables']['shifts']['Row']

interface Props {
  shift: Shift | undefined
  onClick: (shift: Shift | undefined, date: string) => void
  date: string
  isConflicted?: boolean
  dateHasLead?: boolean
  availConflict?: ConflictType
}

export function GridCell({ shift, onClick, date, isConflicted = false, dateHasLead = true, availConflict = null }: Props) {
  const state = shift?.cell_state ?? 'off'
  const isLead = !!shift?.lead_user_id
  const showLeadGap = state === 'working' && !dateHasLead

  const availConflictTitle = availConflict === 'cannot_work'
    ? 'Availability conflict: cannot work'
    : availConflict === 'wrong_shift_type'
    ? 'Availability conflict: wrong shift type'
    : undefined

  return (
    <button
      onClick={() => onClick(shift, date)}
      className={cn(
        'relative h-9 text-xs flex items-center justify-center border border-white/20',
        'transition-opacity hover:opacity-80 focus:outline-none focus:ring-1 focus:ring-slate-400',
        cellStateClass(state),
        isConflicted && 'ring-2 ring-inset ring-amber-400',
        availConflict && 'border-yellow-400 border-2'
      )}
      aria-label={`${date}: ${state}${showLeadGap ? ' (no lead)' : ''}${isConflicted ? ' (constraint conflict)' : ''}${availConflict ? ` (${availConflict})` : ''}`}
    >
      {cellStateLabel(state)}
      {isLead && state === 'working' && (
        <span
          className="absolute bottom-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-yellow-400"
          title="Lead/charge"
        />
      )}
      {showLeadGap && (
        <span
          className="absolute top-0.5 left-0.5 w-1.5 h-1.5 rounded-full bg-pink-400"
          title="No lead assigned for this date"
        />
      )}
      {isConflicted && (
        <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-amber-400" title="Availability conflict" />
      )}
      {availConflict && !isConflicted && (
        <span
          className="absolute top-0.5 right-0.5 text-yellow-600 leading-none"
          style={{ fontSize: '8px' }}
          title={availConflictTitle}
        >
          ⚠
        </span>
      )}
      {availConflict && isConflicted && (
        <span
          className="absolute top-0.5 left-0.5 text-yellow-600 leading-none"
          style={{ fontSize: '8px' }}
          title={availConflictTitle}
        >
          ⚠
        </span>
      )}
    </button>
  )
}
```

- [ ] **Step 2: Verify build and tests**

```bash
npm run build 2>&1 | tail -20 && npm test
```
Expected: build passes, all tests pass.

- [ ] **Step 3: Commit**

```bash
git add components/schedule/GridCell.tsx
git commit -m "feat: add availConflict indicator to GridCell (yellow border + warning icon)"
```

---

## Task 8: CellPanel Confirm Dialog

**Files:**
- Modify: `components/schedule/CellPanel.tsx`

Add `conflictType` prop. Intercept `handleStateChange` when setting `'working'` and a conflict exists.

- [ ] **Step 1: Add AlertDialog import**

At the top of `CellPanel.tsx`, add to existing shadcn/ui imports:

```ts
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
```

- [ ] **Step 2: Add `conflictType` to Props interface**

In the `Props` interface, add:

```ts
conflictType?: ConflictType
```

And add `import type { ConflictType } from '@/lib/schedule/conflict-detection'` to the imports.

Update the function signature to destructure `conflictType = null`.

- [ ] **Step 3: Add `showConflictDialog` and `pendingState` state**

After existing `useState` declarations, add:

```ts
const [showConflictDialog, setShowConflictDialog] = useState(false)
const [pendingState, setPendingState] = useState<CellState | null>(null)
```

- [ ] **Step 4: Update `handleStateChange` to intercept working + conflict**

Replace the existing `handleStateChange` function:

```ts
function handleStateChange(newState: CellState) {
  if (!shift) return
  // If scheduling a conflicting cell as 'working', confirm first
  if (newState === 'working' && conflictType) {
    setPendingState(newState)
    setShowConflictDialog(true)
    return
  }
  commitStateChange(newState)
}

function commitStateChange(newState: CellState) {
  if (!shift) return
  setEditError(null)
  const revertFn = onCellStateUpdate(shift.id, newState, shift)
  startTransition(async () => {
    const result = await updateCellState(shift.id, newState)
    if (result.error) {
      revertFn()
      setEditError(result.error)
    }
  })
}
```

- [ ] **Step 5: Add AlertDialog to the JSX return**

Just before the closing `</SheetContent>` tag, add:

```tsx
<AlertDialog open={showConflictDialog} onOpenChange={setShowConflictDialog}>
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle>Availability conflict</AlertDialogTitle>
      <AlertDialogDescription>
        This therapist marked{' '}
        {conflictType === 'cannot_work' ? 'cannot work' : 'a different shift type'}{' '}
        on this date. Schedule them anyway?
      </AlertDialogDescription>
    </AlertDialogHeader>
    <AlertDialogFooter>
      <AlertDialogCancel onClick={() => setPendingState(null)}>Cancel</AlertDialogCancel>
      <AlertDialogAction
        onClick={() => {
          if (pendingState) commitStateChange(pendingState)
          setPendingState(null)
          setShowConflictDialog(false)
        }}
      >
        Schedule anyway
      </AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>
```

- [ ] **Step 6: Verify build and tests**

```bash
npm run build 2>&1 | tail -20 && npm test
```
Expected: build passes, all tests pass (129+ total: 118 existing + 11 conflict-detection + 6 fairness added in Task 9).

- [ ] **Step 7: Commit**

```bash
git add components/schedule/CellPanel.tsx
git commit -m "feat: add availability conflict confirm dialog to CellPanel"
```

---

## Task 9: Fairness Fetch Helper + Tests (TDD)

**Files:**
- Create: `lib/fairness/fetch-therapist-equity.ts`
- Create: `tests/unit/fairness.test.ts`

Write the pivot function test first (pure logic only — no DB mocking needed).

- [ ] **Step 1: Write the failing tests for `pivotEquityRows`**

```ts
// tests/unit/fairness.test.ts
import { describe, it, expect } from 'vitest'
import { pivotEquityRows, type TherapistBlockRow } from '@/lib/fairness/fetch-therapist-equity'

const rows: TherapistBlockRow[] = [
  { userId: 'u1', fullName: 'Alice', employmentType: 'full_time', blockId: 'b1', blockLabel: 'Day — Jan 1 – Feb 11', shiftType: 'day', workingCount: 8 },
  { userId: 'u1', fullName: 'Alice', employmentType: 'full_time', blockId: 'b2', blockLabel: 'Night — Feb 12 – Mar 25', shiftType: 'night', workingCount: 6 },
  { userId: 'u2', fullName: 'Bob', employmentType: 'full_time', blockId: 'b1', blockLabel: 'Day — Jan 1 – Feb 11', shiftType: 'day', workingCount: 10 },
  { userId: 'u3', fullName: 'Carmen', employmentType: 'prn', blockId: 'b1', blockLabel: 'Day — Jan 1 – Feb 11', shiftType: 'day', workingCount: 3 },
]

describe('pivotEquityRows', () => {
  it('returns ordered block labels', () => {
    const result = pivotEquityRows(rows)
    expect(result.blockLabels).toEqual(['Day — Jan 1 – Feb 11', 'Night — Feb 12 – Mar 25'])
  })

  it('separates FT and PRN therapists', () => {
    const result = pivotEquityRows(rows)
    expect(result.ft.map(t => t.fullName)).toContain('Alice')
    expect(result.ft.map(t => t.fullName)).toContain('Bob')
    expect(result.prn.map(t => t.fullName)).toContain('Carmen')
    expect(result.ft.map(t => t.fullName)).not.toContain('Carmen')
  })

  it('correctly sets day/night counts per block cell', () => {
    const result = pivotEquityRows(rows)
    const alice = result.ft.find(t => t.fullName === 'Alice')!
    // b1 = day block, b2 = night block
    expect(alice.cells['b1']).toEqual({ dayCount: 8, nightCount: 0 })
    expect(alice.cells['b2']).toEqual({ dayCount: 0, nightCount: 6 })
  })

  it('returns zero counts for blocks where therapist has no shifts', () => {
    const result = pivotEquityRows(rows)
    const bob = result.ft.find(t => t.fullName === 'Bob')!
    expect(bob.cells['b2']).toEqual({ dayCount: 0, nightCount: 0 })
  })

  it('computes correct totals', () => {
    const result = pivotEquityRows(rows)
    const alice = result.ft.find(t => t.fullName === 'Alice')!
    expect(alice.totalDay).toBe(8)
    expect(alice.totalNight).toBe(6)
  })

  it('handles empty input', () => {
    const result = pivotEquityRows([])
    expect(result.ft).toEqual([])
    expect(result.prn).toEqual([])
    expect(result.blockLabels).toEqual([])
  })
})
```

- [ ] **Step 2: Run test — verify it fails**

```bash
npm test -- fairness
```
Expected: FAIL — `Cannot find module '@/lib/fairness/fetch-therapist-equity'`

- [ ] **Step 3: Implement the helper**

```ts
// lib/fairness/fetch-therapist-equity.ts
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/types/database.types'
import { format } from 'date-fns'

type BlockRow = Database['public']['Tables']['schedule_blocks']['Row']
type UserRow = Database['public']['Tables']['users']['Row']

export interface TherapistBlockRow {
  userId: string
  fullName: string
  employmentType: 'full_time' | 'prn'
  blockId: string
  blockLabel: string
  shiftType: 'day' | 'night'
  workingCount: number
}

export interface TherapistEquityRow {
  userId: string
  fullName: string
  employmentType: 'full_time' | 'prn'
  cells: Record<string, { dayCount: number; nightCount: number }>
  totalDay: number
  totalNight: number
}

export interface PivotedTable {
  blockLabels: string[]
  blockIds: string[]
  ft: TherapistEquityRow[]
  prn: TherapistEquityRow[]
}

/** Fetch working shift counts per therapist per block for a department. */
export async function fetchEquityRows(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  departmentId: string
): Promise<TherapistBlockRow[]> {
  // Step 1: blocks
  const { data: blocksData } = await supabase
    .from('schedule_blocks')
    .select('id, shift_type, start_date, end_date, status')
    .eq('department_id', departmentId)
    .in('status', ['active', 'completed', 'final'])
    .order('start_date', { ascending: true })

  const blocks = (blocksData ?? []) as Pick<BlockRow, 'id' | 'shift_type' | 'start_date' | 'end_date' | 'status'>[]
  if (blocks.length === 0) return []

  const blockIds = blocks.map(b => b.id)
  const blockMap = new Map(blocks.map(b => [b.id, b]))

  // Step 2: working shifts
  const { data: shiftsData } = await supabase
    .from('shifts')
    .select('user_id, schedule_block_id')
    .in('schedule_block_id', blockIds)
    .eq('cell_state', 'working')

  const shifts = (shiftsData ?? []) as Array<{ user_id: string; schedule_block_id: string }>
  if (shifts.length === 0) return []

  // Step 3: users
  const userIds = Array.from(new Set(shifts.map(s => s.user_id)))
  const { data: usersData } = await supabase
    .from('users')
    .select('id, full_name, employment_type')
    .in('id', userIds)

  const users = (usersData ?? []) as Pick<UserRow, 'id' | 'full_name' | 'employment_type'>[]
  const userMap = new Map(users.map(u => [u.id, u]))

  // Aggregate: count shifts per (userId, blockId)
  const counts = new Map<string, number>()
  for (const s of shifts) {
    const key = `${s.user_id}:${s.schedule_block_id}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  const result: TherapistBlockRow[] = []
  for (const [key, count] of counts.entries()) {
    const [userId, blockId] = key.split(':')
    const user = userMap.get(userId)
    const block = blockMap.get(blockId)
    if (!user || !block) continue

    const label = `${block.shift_type === 'day' ? 'Day' : 'Night'} — ${format(new Date(block.start_date + 'T00:00:00'), 'MMM d')} – ${format(new Date(block.end_date + 'T00:00:00'), 'MMM d, yyyy')}`

    result.push({
      userId,
      fullName: user.full_name,
      employmentType: user.employment_type as 'full_time' | 'prn',
      blockId,
      blockLabel: label,
      shiftType: block.shift_type,
      workingCount: count,
    })
  }

  return result
}

/** Pure pivot function — groups rows into a table structure for rendering. */
export function pivotEquityRows(rows: TherapistBlockRow[]): PivotedTable {
  if (rows.length === 0) return { blockLabels: [], blockIds: [], ft: [], prn: [] }

  // Collect ordered unique blocks (preserve insertion order = start_date order from DB)
  const blockOrder: string[] = []
  const blockLabelMap = new Map<string, string>()
  for (const r of rows) {
    if (!blockLabelMap.has(r.blockId)) {
      blockOrder.push(r.blockId)
      blockLabelMap.set(r.blockId, r.blockLabel)
    }
  }

  // Collect therapists
  const therapistMap = new Map<string, TherapistEquityRow>()
  for (const r of rows) {
    if (!therapistMap.has(r.userId)) {
      therapistMap.set(r.userId, {
        userId: r.userId,
        fullName: r.fullName,
        employmentType: r.employmentType,
        cells: {},
        totalDay: 0,
        totalNight: 0,
      })
    }
    const therapist = therapistMap.get(r.userId)!
    if (!therapist.cells[r.blockId]) {
      therapist.cells[r.blockId] = { dayCount: 0, nightCount: 0 }
    }
    if (r.shiftType === 'day') {
      therapist.cells[r.blockId].dayCount += r.workingCount
      therapist.totalDay += r.workingCount
    } else {
      therapist.cells[r.blockId].nightCount += r.workingCount
      therapist.totalNight += r.workingCount
    }
  }

  // Fill in zero cells for blocks where therapist has no rows
  for (const therapist of therapistMap.values()) {
    for (const blockId of blockOrder) {
      if (!therapist.cells[blockId]) {
        therapist.cells[blockId] = { dayCount: 0, nightCount: 0 }
      }
    }
  }

  const allTherapists = Array.from(therapistMap.values()).sort((a, b) => a.fullName.localeCompare(b.fullName))

  return {
    blockLabels: blockOrder.map(id => blockLabelMap.get(id)!),
    blockIds: blockOrder,
    ft: allTherapists.filter(t => t.employmentType === 'full_time'),
    prn: allTherapists.filter(t => t.employmentType === 'prn'),
  }
}
```

- [ ] **Step 4: Run tests — verify all pass**

```bash
npm test -- fairness
```
Expected: 6 tests PASS.

- [ ] **Step 5: Run full test suite**

```bash
npm test
```
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add lib/fairness/fetch-therapist-equity.ts tests/unit/fairness.test.ts
git commit -m "feat: add fetchEquityRows and pivotEquityRows with unit tests"
```

---

## Task 10: Fairness Page

**Files:**
- Create: `app/(app)/fairness/page.tsx`

Manager-only server component. Fetches equity data and renders the pivot table.

- [ ] **Step 1: Create the page**

```tsx
// app/(app)/fairness/page.tsx
import { redirect } from 'next/navigation'
import { getServerUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { fetchEquityRows, pivotEquityRows, type TherapistEquityRow } from '@/lib/fairness/fetch-therapist-equity'
import { Badge } from '@/components/ui/badge'
import type { Database } from '@/lib/types/database.types'

type UserRow = Database['public']['Tables']['users']['Row']

function TherapistRows({ therapists, blockIds }: { therapists: TherapistEquityRow[]; blockIds: string[] }) {
  return (
    <>
      {therapists.map(t => (
        <tr key={t.userId} className="border-b border-slate-100 hover:bg-slate-50">
          <td className="py-2 px-3 text-sm text-slate-900 font-medium whitespace-nowrap">{t.fullName}</td>
          {blockIds.map(blockId => {
            const cell = t.cells[blockId] ?? { dayCount: 0, nightCount: 0 }
            const isEmpty = cell.dayCount === 0 && cell.nightCount === 0
            return (
              <td key={blockId} className="py-2 px-3 text-sm text-center">
                {isEmpty ? (
                  <span className="text-slate-300">—</span>
                ) : (
                  <span className="text-slate-700">
                    {cell.dayCount > 0 && <span className="text-blue-600">{cell.dayCount}D</span>}
                    {cell.dayCount > 0 && cell.nightCount > 0 && <span className="text-slate-300"> / </span>}
                    {cell.nightCount > 0 && <span className="text-slate-800">{cell.nightCount}N</span>}
                  </span>
                )}
              </td>
            )
          })}
          <td className="py-2 px-3 text-sm text-center font-medium">
            <span className="text-blue-600">{t.totalDay}D</span>
            {t.totalDay > 0 && t.totalNight > 0 && <span className="text-slate-300"> / </span>}
            <span className="text-slate-800">{t.totalNight}N</span>
          </td>
        </tr>
      ))}
    </>
  )
}

export default async function FairnessPage() {
  const user = await getServerUser()
  if (!user) redirect('/login')

  const supabase = createClient()

  const { data: profileData } = await supabase
    .from('users')
    .select('role, department_id')
    .eq('id', user.id)
    .single()

  if (!profileData) redirect('/login')
  if (profileData.role === 'therapist') redirect('/today')

  const profile = profileData as Pick<UserRow, 'role' | 'department_id'>

  if (!profile.department_id) {
    return (
      <div className="p-8 text-slate-500 text-sm">
        Your account is not assigned to a department.
      </div>
    )
  }

  const rows = await fetchEquityRows(supabase, profile.department_id)
  const { blockLabels, blockIds, ft, prn } = pivotEquityRows(rows)

  if (blockIds.length === 0) {
    return (
      <div className="p-8">
        <h1 className="text-xl font-semibold text-slate-900 mb-4">Fairness</h1>
        <p className="text-slate-500 text-sm">No completed or active blocks yet.</p>
      </div>
    )
  }

  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold text-slate-900 mb-6">Fairness</h1>
      <p className="text-sm text-slate-500 mb-4">
        Working shifts per therapist across active, final, and completed blocks.
      </p>

      <div className="overflow-x-auto">
        <table className="min-w-full border border-slate-200 rounded-lg text-left">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="py-2 px-3 text-xs font-medium text-slate-500 uppercase tracking-wide">Therapist</th>
              {blockLabels.map((label, i) => (
                <th key={blockIds[i]} className="py-2 px-3 text-xs font-medium text-slate-500 uppercase tracking-wide text-center whitespace-nowrap">
                  {label}
                </th>
              ))}
              <th className="py-2 px-3 text-xs font-medium text-slate-500 uppercase tracking-wide text-center">Total</th>
            </tr>
          </thead>
          <tbody>
            {ft.length > 0 && (
              <>
                <tr>
                  <td colSpan={blockIds.length + 2} className="py-1.5 px-3 bg-slate-50">
                    <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Full-Time</span>
                  </td>
                </tr>
                <TherapistRows therapists={ft} blockIds={blockIds} />
              </>
            )}
            {prn.length > 0 && (
              <>
                <tr>
                  <td colSpan={blockIds.length + 2} className="py-1.5 px-3 bg-slate-50 border-t border-slate-200">
                    <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">PRN</span>
                  </td>
                </tr>
                <TherapistRows therapists={prn} blockIds={blockIds} />
              </>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify full build and all tests pass**

```bash
npm run build 2>&1 | tail -20
npm test
```
Expected: build passes, all tests pass.

- [ ] **Step 3: Run lint**

```bash
npm run lint
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/\(app\)/fairness/page.tsx
git commit -m "feat: add manager fairness equity page"
```

---

## Final Verification

- [ ] **Confirm unit test count**

```bash
npm test 2>&1 | grep -E "Tests|passed|failed"
```
Expected: 129+ tests passing (118 original + 11 conflict-detection + 6 fairness).

- [ ] **Confirm no lint errors**

```bash
npm run lint
```
Expected: clean.

- [ ] **Final commit tag**

```bash
git log --oneline -10
```
Confirm all 9 feature commits are present and clean.
