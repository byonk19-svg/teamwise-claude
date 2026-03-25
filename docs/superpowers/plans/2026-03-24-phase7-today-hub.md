# Phase 7 — Therapist Today Hub Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/today` route that becomes the default landing page for therapists, showing today's shift, a 7-day week strip, pending swaps, operational codes, block context, and (PRN only) open shift count.

**Architecture:** Single async Server Component page (`app/(app)/today/page.tsx`) fires all Supabase queries in parallel via `Promise.all` and passes data down to six presentational components in `components/today/`. Role-based redirect logic moves from `middleware.ts` → `app/page.tsx` so the middleware stays role-agnostic (no DB query needed there).

**Tech Stack:** Next.js 14 App Router · TypeScript · Supabase (`@supabase/ssr`) · Tailwind CSS · shadcn/ui · Vitest

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| New | `lib/schedule/cell-colors.ts` | Shared `STATE_COLORS` constant |
| New | `lib/today/helpers.ts` | Pure functions: `buildWeekWindow`, `resolveLeadName`, `computeUnsignaledCount` |
| New | `tests/unit/today-helpers.test.ts` | Unit tests for the above helpers |
| New | `app/(app)/today/page.tsx` | Server page — all data fetching, layout |
| New | `components/today/TodayShiftCard.tsx` | Today's shift status, lead name, block badge |
| New | `components/today/TodayWeekStrip.tsx` | 7-day mini calendar |
| New | `components/today/TodaySwapsCard.tsx` | Pending swap count + link to /swaps |
| New | `components/today/TodayOpCodesCard.tsx` | Read-only op codes for today |
| New | `components/today/TodayBlockCard.tsx` | Block name, status, link to /schedule |
| New | `components/today/TodayOpenShiftsCard.tsx` | PRN only: unsignaled count + link |
| Modified | `middleware.ts` | Change post-login redirect from `/schedule` → `/` |
| Modified | `app/page.tsx` | Async server component; redirect by role |
| Modified | `components/shell/Sidebar.tsx` | Add "Today" nav item for therapist role |
| Modified | `components/schedule/WeekView.tsx` | Import `STATE_COLORS` from shared location |

---

## Task 1: Extract STATE_COLORS to shared constant

**Files:**
- Create: `lib/schedule/cell-colors.ts`
- Modify: `components/schedule/WeekView.tsx:13-18`

- [ ] **Step 1: Create the shared constant file**

```ts
// lib/schedule/cell-colors.ts
export const STATE_COLORS: Record<string, string> = {
  working: 'bg-green-500',
  cannot_work: 'bg-red-400',
  off: 'bg-slate-300',
  fmla: 'bg-purple-400',
}
```

- [ ] **Step 2: Update WeekView to import from shared location**

In `components/schedule/WeekView.tsx`, replace lines 13–18:
```ts
// Remove this:
const STATE_COLORS: Record<string, string> = {
  working: 'bg-green-500',
  cannot_work: 'bg-red-400',
  off: 'bg-slate-300',
  fmla: 'bg-purple-400',
}

// Add this import at the top (after existing imports):
import { STATE_COLORS } from '@/lib/schedule/cell-colors'
```

- [ ] **Step 3: Run tests to confirm nothing broke**

```bash
npm test
```
Expected: all tests pass (same count as before)

- [ ] **Step 4: Commit**

```bash
git add lib/schedule/cell-colors.ts components/schedule/WeekView.tsx
git commit -m "refactor: extract STATE_COLORS to lib/schedule/cell-colors.ts"
```

---

## Task 2: Pure helper functions (TDD)

**Files:**
- Create: `lib/today/helpers.ts`
- Create: `tests/unit/today-helpers.test.ts`

### Background

`buildWeekWindow` computes the 7-day strip: starting from `max(today, blockStart)`, walking forward day by day until `blockEnd` or 7 days (whichever comes first), then returns the matching shift row for each date (or a placeholder with `cell_state: null` if no row exists for that date — this happens when today is before the block starts or after it ends).

`resolveLeadName` looks up a `lead_user_id` in a list of therapist objects and returns `full_name` (or `null`).

`computeUnsignaledCount` counts how many of the PRN's `off` shifts have **no** entry in `prn_shift_interest` (any status counts as "already signaled").

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/today-helpers.test.ts
import { describe, it, expect } from 'vitest'
import { buildWeekWindow, resolveLeadName, computeUnsignaledCount } from '@/lib/today/helpers'

describe('buildWeekWindow', () => {
  it('returns up to 7 days starting from today when today is within the block', () => {
    const shifts = [
      { shift_date: '2026-03-24', cell_state: 'working' },
      { shift_date: '2026-03-25', cell_state: 'off' },
      { shift_date: '2026-03-26', cell_state: 'working' },
      { shift_date: '2026-03-27', cell_state: 'off' },
      { shift_date: '2026-03-28', cell_state: 'working' },
      { shift_date: '2026-03-29', cell_state: 'off' },
      { shift_date: '2026-03-30', cell_state: 'working' },
      { shift_date: '2026-03-31', cell_state: 'off' },
    ]
    const result = buildWeekWindow(shifts, '2026-03-01', '2026-04-11', '2026-03-24')
    expect(result).toHaveLength(7)
    expect(result[0].shift_date).toBe('2026-03-24')
    expect(result[6].shift_date).toBe('2026-03-30')
  })

  it('returns fewer than 7 days when block ends before 7 days out', () => {
    const shifts = [
      { shift_date: '2026-04-09', cell_state: 'working' },
      { shift_date: '2026-04-10', cell_state: 'off' },
      { shift_date: '2026-04-11', cell_state: 'working' },
    ]
    const result = buildWeekWindow(shifts, '2026-03-01', '2026-04-11', '2026-04-09')
    expect(result).toHaveLength(3)
    expect(result[2].shift_date).toBe('2026-04-11')
  })

  it('starts from blockStart when today is before the block', () => {
    const shifts = [
      { shift_date: '2026-05-01', cell_state: 'working' },
      { shift_date: '2026-05-02', cell_state: 'off' },
    ]
    const result = buildWeekWindow(shifts, '2026-05-01', '2026-05-30', '2026-03-24')
    expect(result[0].shift_date).toBe('2026-05-01')
  })

  it('returns null cell_state for dates with no matching shift row', () => {
    const result = buildWeekWindow([], '2026-03-01', '2026-04-11', '2026-03-24')
    expect(result).toHaveLength(7)
    expect(result[0].cell_state).toBeNull()
    expect(result[0].shift_date).toBe('2026-03-24')
  })
})

describe('resolveLeadName', () => {
  const therapists = [
    { id: 'u1', full_name: 'Jane Smith' },
    { id: 'u2', full_name: 'Bob Lee' },
  ]

  it('returns the therapist full_name for a matching id', () => {
    expect(resolveLeadName('u1', therapists)).toBe('Jane Smith')
  })

  it('returns null when lead_user_id is null', () => {
    expect(resolveLeadName(null, therapists)).toBeNull()
  })

  it('returns null when id not found', () => {
    expect(resolveLeadName('u99', therapists)).toBeNull()
  })
})

describe('computeUnsignaledCount', () => {
  it('counts off-shifts with no matching interest row', () => {
    const offShifts = [{ id: 's1' }, { id: 's2' }, { id: 's3' }]
    const interestRows = [{ shift_id: 's1' }]
    expect(computeUnsignaledCount(offShifts, interestRows)).toBe(2)
  })

  it('returns 0 when all shifts are signaled', () => {
    const offShifts = [{ id: 's1' }, { id: 's2' }]
    const interestRows = [{ shift_id: 's1' }, { shift_id: 's2' }]
    expect(computeUnsignaledCount(offShifts, interestRows)).toBe(0)
  })

  it('returns 0 when offShifts is empty', () => {
    expect(computeUnsignaledCount([], [])).toBe(0)
  })

  it('counts all as unsignaled when interestRows is empty', () => {
    const offShifts = [{ id: 's1' }, { id: 's2' }]
    expect(computeUnsignaledCount(offShifts, [])).toBe(2)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test tests/unit/today-helpers.test.ts
```
Expected: FAIL — `Cannot find module '@/lib/today/helpers'`

- [ ] **Step 3: Implement the helpers**

```ts
// lib/today/helpers.ts

/**
 * Returns the window of days to show in the week strip.
 * Starts from max(today, blockStart), walks forward up to 7 days,
 * capped at blockEnd. Returns a placeholder row with cell_state: null
 * for any date that has no shift row.
 */
export function buildWeekWindow(
  shifts: Array<{ shift_date: string; cell_state: string | null }>,
  blockStartDate: string,
  blockEndDate: string,
  todayStr: string
): Array<{ shift_date: string; cell_state: string | null }> {
  const startStr = todayStr > blockStartDate ? todayStr : blockStartDate
  const shiftMap = new Map(shifts.map(s => [s.shift_date, s]))
  const result: Array<{ shift_date: string; cell_state: string | null }> = []

  let current = startStr
  while (current <= blockEndDate && result.length < 7) {
    result.push(shiftMap.get(current) ?? { shift_date: current, cell_state: null })
    // advance one day via string math (safe for yyyy-MM-dd ISO dates within same year range)
    const d = new Date(`${current}T00:00:00`)
    d.setDate(d.getDate() + 1)
    current = d.toISOString().slice(0, 10)
  }

  return result
}

/**
 * Resolves a lead_user_id to a display name using the therapist list.
 */
export function resolveLeadName(
  leadUserId: string | null,
  therapists: Array<{ id: string; full_name: string | null }>
): string | null {
  if (!leadUserId) return null
  return therapists.find(t => t.id === leadUserId)?.full_name ?? null
}

/**
 * Counts PRN off-shifts that have no existing prn_shift_interest row
 * (any interest status counts as "already signaled").
 */
export function computeUnsignaledCount(
  offShifts: Array<{ id: string }>,
  interestRows: Array<{ shift_id: string }>
): number {
  const signaled = new Set(interestRows.map(r => r.shift_id))
  return offShifts.filter(s => !signaled.has(s.id)).length
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test tests/unit/today-helpers.test.ts
```
Expected: all 11 tests PASS

- [ ] **Step 5: Run full test suite**

```bash
npm test
```
Expected: all tests pass

- [ ] **Step 6: Commit**

```bash
git add lib/today/helpers.ts tests/unit/today-helpers.test.ts
git commit -m "feat(today): add pure helper functions with tests"
```

---

## Task 3: Auth redirect — middleware + root page

**Files:**
- Modify: `middleware.ts:44`
- Modify: `app/page.tsx`

The middleware cannot query `public.users.role` without a DB call. Instead, we send all authenticated users to `/` and let `app/page.tsx` do the role-based branch.

- [ ] **Step 1: Update middleware redirect destination**

In `middleware.ts`, change the post-login redirect (line 44):
```ts
// Before:
url.pathname = '/schedule'
// After:
url.pathname = '/'
```

The full updated `if (user && isAuthRoute)` block:
```ts
if (user && isAuthRoute) {
  const url = request.nextUrl.clone()
  url.pathname = '/'
  const redirectResponse = NextResponse.redirect(url)
  supabaseResponse.cookies.getAll().forEach(cookie =>
    redirectResponse.cookies.set(cookie.name, cookie.value)
  )
  return redirectResponse
}
```

- [ ] **Step 2: Replace app/page.tsx with role-aware async server component**

```ts
// app/page.tsx
import { redirect } from 'next/navigation'
import { getServerUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'

export default async function RootPage() {
  const user = await getServerUser()
  if (!user) redirect('/login')

  const supabase = createClient()
  const { data: profile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single() as { data: { role: string } | null; error: unknown }

  if (profile?.role === 'manager') redirect('/schedule')
  redirect('/today')
}
```

- [ ] **Step 3: Run tests**

```bash
npm test
```
Expected: all tests pass (no unit tests touch this path)

- [ ] **Step 4: Commit**

```bash
git add middleware.ts app/page.tsx
git commit -m "feat(today): role-based root redirect — therapist→/today, manager→/schedule"
```

---

## Task 4: Sidebar nav item

**Files:**
- Modify: `components/shell/Sidebar.tsx:16-26`

- [ ] **Step 1: Insert Today nav item at the top of therapist items**

In `components/shell/Sidebar.tsx`, update `NAV_ITEMS`:
```ts
const NAV_ITEMS: NavItem[] = [
  { href: '/today',           label: 'Today',            roles: ['therapist'] },  // NEW
  { href: '/schedule',        label: 'Schedule',         roles: ['manager', 'therapist'] },
  { href: '/availability',    label: 'Availability',     roles: ['manager', 'therapist'] },
  { href: '/swaps',           label: 'Swaps',            roles: ['manager', 'therapist'] },
  { href: '/coverage',        label: 'Coverage',         roles: ['manager'] },
  { href: '/ops',             label: 'Ops',              roles: ['manager'] },
  { href: '/staff',           label: 'Staff',            roles: ['manager'] },
  { href: '/settings',        label: 'Settings',         roles: ['manager'] },
  { href: '/open-shifts',     label: 'Open Shifts',      roles: ['therapist'] },
  { href: '/change-requests', label: 'Change Requests',  roles: ['therapist'] },
]
```

- [ ] **Step 2: Run tests**

```bash
npm test
```
Expected: all tests pass

- [ ] **Step 3: Commit**

```bash
git add components/shell/Sidebar.tsx
git commit -m "feat(today): add Today nav item for therapist role"
```

---

## Task 5: Presentational components

All components are plain TypeScript React server components (no `'use client'`). No data fetching — all data arrives as props.

**Files:**
- Create: `components/today/TodayShiftCard.tsx`
- Create: `components/today/TodayWeekStrip.tsx`
- Create: `components/today/TodaySwapsCard.tsx`
- Create: `components/today/TodayOpCodesCard.tsx`
- Create: `components/today/TodayBlockCard.tsx`
- Create: `components/today/TodayOpenShiftsCard.tsx`

- [ ] **Step 1: Create TodayShiftCard**

```tsx
// components/today/TodayShiftCard.tsx
import { STATE_COLORS } from '@/lib/schedule/cell-colors'
import type { Database } from '@/lib/types/database.types'

type ShiftRow = Database['public']['Tables']['shifts']['Row']
type BlockRow = Database['public']['Tables']['schedule_blocks']['Row']

const STATE_LABELS: Record<string, string> = {
  working: 'Working',
  off: 'Off',
  cannot_work: 'Cannot Work',
  fmla: 'FMLA',
}

interface Props {
  shift: ShiftRow | null       // null = today is outside the block
  block: BlockRow
  leadName: string | null
}

export function TodayShiftCard({ shift, block, leadName }: Props) {
  const state = shift?.cell_state ?? null
  const colorClass = state ? (STATE_COLORS[state] ?? 'bg-slate-300') : 'bg-slate-200'
  const label = state ? (STATE_LABELS[state] ?? state) : '—'
  const shiftType = block.shift_type === 'day' ? 'Day Shift' : 'Night Shift'

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-3">
        <span className={`h-3 w-3 rounded-full ${colorClass} shrink-0`} />
        <span className="text-lg font-semibold text-slate-900">{label}</span>
        <span className="ml-auto text-sm text-slate-500">{shiftType}</span>
      </div>
      <div className="mt-3 text-sm text-slate-500">
        {state === 'working' ? (
          leadName
            ? <span>Lead: <span className="text-slate-700 font-medium">{leadName}</span></span>
            : <span className="text-slate-400">No lead assigned</span>
        ) : null}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Create TodayWeekStrip**

```tsx
// components/today/TodayWeekStrip.tsx
import { STATE_COLORS } from '@/lib/schedule/cell-colors'
import { format } from 'date-fns'

interface DayEntry {
  shift_date: string
  cell_state: string | null
}

interface Props {
  days: DayEntry[]
  todayStr: string
}

export function TodayWeekStrip({ days, todayStr }: Props) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex gap-1 overflow-x-auto">
        {days.map(day => {
          const isToday = day.shift_date === todayStr
          const colorClass = day.cell_state
            ? (STATE_COLORS[day.cell_state] ?? 'bg-slate-200')
            : 'bg-slate-100'
          const date = new Date(`${day.shift_date}T00:00:00`)

          return (
            <div
              key={day.shift_date}
              className={`flex flex-col items-center gap-1 min-w-[40px] rounded-md p-1
                ${isToday ? 'ring-2 ring-slate-900 ring-offset-1' : ''}`}
            >
              <span className="text-[10px] text-slate-400 uppercase">
                {format(date, 'EEE')}
              </span>
              <span className="text-xs font-medium text-slate-700">
                {format(date, 'd')}
              </span>
              <span className={`h-2 w-2 rounded-full ${colorClass}`} />
            </div>
          )
        })}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Create TodaySwapsCard**

```tsx
// components/today/TodaySwapsCard.tsx
import Link from 'next/link'

interface SwapRow {
  id: string
  requester_id: string
  partner_id: string | null
  shift_date: string
  expires_at: string
}

interface Props {
  swaps: SwapRow[]
  currentUserId: string
  therapistNames: Map<string, string>
}

export function TodaySwapsCard({ swaps, currentUserId, therapistNames }: Props) {
  const count = swaps.length
  const first = swaps[0] ?? null
  const partnerName = first
    ? (therapistNames.get(
        first.requester_id === currentUserId
          ? (first.partner_id ?? '')
          : first.requester_id
      ) ?? 'Unknown')
    : null

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-slate-700">Swap Requests</span>
        {count > 0 && (
          <span className="text-xs font-semibold bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">
            {count} pending
          </span>
        )}
      </div>
      {count === 0 ? (
        <p className="text-sm text-slate-400">No pending requests</p>
      ) : (
        <p className="text-sm text-slate-600">
          {partnerName} · {first!.shift_date}
          {count > 1 && <span className="text-slate-400"> +{count - 1} more</span>}
        </p>
      )}
      <Link href="/swaps" className="mt-3 inline-block text-xs text-slate-500 underline hover:text-slate-700">
        View all swaps
      </Link>
    </div>
  )
}
```

- [ ] **Step 4: Create TodayOpCodesCard**

```tsx
// components/today/TodayOpCodesCard.tsx
import type { Database } from '@/lib/types/database.types'

type OpEntry = Database['public']['Tables']['operational_entries']['Row']

const CODE_LABELS: Record<string, string> = {
  OC: 'On Call',
  CI: 'Called In',
  CX: 'Cancelled',
  LE: 'Left Early',
}

interface Props {
  entries: OpEntry[]
}

export function TodayOpCodesCard({ entries }: Props) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <span className="text-sm font-medium text-slate-700">Today's Codes</span>
      {entries.length === 0 ? (
        <p className="mt-2 text-sm text-slate-400">No codes entered for today</p>
      ) : (
        <ul className="mt-2 space-y-1">
          {entries.map(entry => (
            <li key={entry.id} className="flex items-center gap-2 text-sm">
              <span className="font-mono text-xs bg-slate-100 px-1.5 py-0.5 rounded text-slate-700">
                {entry.code}
              </span>
              <span className="text-slate-500">{CODE_LABELS[entry.code] ?? entry.code}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
```

- [ ] **Step 5: Create TodayBlockCard**

```tsx
// components/today/TodayBlockCard.tsx
import Link from 'next/link'
import type { Database } from '@/lib/types/database.types'

type BlockRow = Database['public']['Tables']['schedule_blocks']['Row']

const STATUS_STYLES: Record<string, string> = {
  final:  'bg-blue-100 text-blue-700',
  active: 'bg-green-100 text-green-700',
}

interface Props {
  block: BlockRow
}

export function TodayBlockCard({ block }: Props) {
  const badgeClass = STATUS_STYLES[block.status] ?? 'bg-slate-100 text-slate-600'
  const label = block.status.charAt(0).toUpperCase() + block.status.slice(1)

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm font-medium text-slate-700">Current Block</span>
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${badgeClass}`}>
          {label}
        </span>
      </div>
      <p className="text-sm text-slate-500">
        {block.start_date} – {block.end_date}
      </p>
      <Link href="/schedule" className="mt-3 inline-block text-xs text-slate-500 underline hover:text-slate-700">
        View schedule
      </Link>
    </div>
  )
}
```

- [ ] **Step 6: Create TodayOpenShiftsCard (PRN only)**

`prelimBlockId` is nullable — when no preliminary block exists the card still renders, showing zero count and linking to the generic open-shifts page.

```tsx
// components/today/TodayOpenShiftsCard.tsx
import Link from 'next/link'

interface Props {
  unsignaledCount: number
  prelimBlockId: string | null
}

export function TodayOpenShiftsCard({ unsignaledCount, prelimBlockId }: Props) {
  const href = prelimBlockId
    ? `/availability/open-shifts?blockId=${prelimBlockId}`
    : '/availability/open-shifts'

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-slate-700">Open Shifts</span>
        {unsignaledCount > 0 && (
          <span className="text-xs font-semibold bg-sky-100 text-sky-700 px-2 py-0.5 rounded-full">
            {unsignaledCount} available
          </span>
        )}
      </div>
      {unsignaledCount === 0 ? (
        <p className="text-sm text-slate-400">No open shifts right now</p>
      ) : (
        <p className="text-sm text-slate-600">
          {unsignaledCount} shift{unsignaledCount !== 1 ? 's' : ''} available to signal interest
        </p>
      )}
      <Link
        href={href}
        className="mt-3 inline-block text-xs text-slate-500 underline hover:text-slate-700"
      >
        View open shifts
      </Link>
    </div>
  )
}
```

- [ ] **Step 7: Run tests**

```bash
npm test
```
Expected: all tests pass

- [ ] **Step 8: Commit**

```bash
git add components/today/
git commit -m "feat(today): add all presentational Today components"
```

---

## Task 6: Page server component

**Files:**
- Create: `app/(app)/today/page.tsx`

This is the only file with data fetching. It fires all queries in parallel, handles edge cases, then renders the layout.

- [ ] **Step 1: Create the page**

```tsx
// app/(app)/today/page.tsx
import { redirect } from 'next/navigation'
import { getServerUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { TodayShiftCard } from '@/components/today/TodayShiftCard'
import { TodayWeekStrip } from '@/components/today/TodayWeekStrip'
import { TodaySwapsCard } from '@/components/today/TodaySwapsCard'
import { TodayOpCodesCard } from '@/components/today/TodayOpCodesCard'
import { TodayBlockCard } from '@/components/today/TodayBlockCard'
import { TodayOpenShiftsCard } from '@/components/today/TodayOpenShiftsCard'
import { buildWeekWindow, resolveLeadName, computeUnsignaledCount } from '@/lib/today/helpers'
import { format } from 'date-fns'
import type { Database } from '@/lib/types/database.types'

type BlockRow = Database['public']['Tables']['schedule_blocks']['Row']
type ShiftRow = Database['public']['Tables']['shifts']['Row']
type UserRow = Database['public']['Tables']['users']['Row']
type OpEntry = Database['public']['Tables']['operational_entries']['Row']

export default async function TodayPage() {
  const user = await getServerUser()
  if (!user) redirect('/login')

  const supabase = createClient()
  const todayStr = new Date().toISOString().slice(0, 10)

  // --- Query 1: profile ---
  const { data: profile } = await supabase
    .from('users')
    .select('role, department_id, employment_type, full_name')
    .eq('id', user.id)
    .single() as { data: Pick<UserRow, 'role' | 'department_id' | 'employment_type' | 'full_name'> | null; error: unknown }

  if (!profile) redirect('/login')
  if (profile.role === 'manager') redirect('/schedule')
  if (!profile.department_id) {
    return (
      <div className="p-8 text-sm text-slate-500">
        Your account is not assigned to a department. Contact your manager.
      </div>
    )
  }

  const isPRN = profile.employment_type === 'prn'
  const deptId = profile.department_id

  // --- Queries 2–7 in parallel ---
  const [
    blocksResult,
    therapistsResult,
    swapsResult,
    opCodesResult,
  ] = await Promise.all([
    // Query 2: active/final block
    supabase
      .from('schedule_blocks')
      .select('*')
      .eq('department_id', deptId)
      .in('status', ['final', 'active'])
      .order('start_date', { ascending: false })
      .limit(1),

    // Query 4: all therapists in dept (for lead resolution + swap names)
    supabase
      .from('users')
      .select('id, full_name')
      .eq('department_id', deptId)
      .eq('role', 'therapist'),

    // Query 6: pending swap requests for this user
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any)
      .from('swap_requests')
      .select('id, requester_id, partner_id, shift_date, expires_at')
      .or(`requester_id.eq.${user.id},partner_id.eq.${user.id}`)
      .eq('status', 'pending')
      .gt('expires_at', new Date().toISOString()),

    // Query 7: operational entries for today
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any)
      .from('operational_entries')
      .select('id, code, notes')
      .eq('user_id', user.id)
      .eq('entry_date', todayStr)
      .is('removed_at', null),
  ])

  const block = (blocksResult.data?.[0] ?? null) as BlockRow | null
  const therapists = (therapistsResult.data ?? []) as Pick<UserRow, 'id' | 'full_name'>[]
  const swaps = swapsResult.data ?? []
  const opEntries = (opCodesResult.data ?? []) as OpEntry[]

  // No active/final block — show empty state
  if (!block) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-12">
        <div className="rounded-lg border border-slate-200 bg-white p-8 text-center shadow-sm">
          <p className="text-sm text-slate-500">
            No active schedule. Check back when your manager posts the next block.
          </p>
        </div>
      </div>
    )
  }

  // Queries that depend on block (run after block check)
  const [shiftsResult, leadResult, prelimResult] = await Promise.all([
    // Query 3: therapist's own shifts for the block
    supabase
      .from('shifts')
      .select('*')
      .eq('user_id', user.id)
      .eq('schedule_block_id', block.id),

    // Query 5: lead for today
    supabase
      .from('shifts')
      .select('lead_user_id')
      .eq('schedule_block_id', block.id)
      .eq('shift_date', todayStr)
      .not('lead_user_id', 'is', null)
      .limit(1),

    // Query 8: preliminary block (PRN only)
    isPRN
      ? supabase
          .from('schedule_blocks')
          .select('id')
          .eq('department_id', deptId)
          .eq('status', 'preliminary')
          .order('start_date', { ascending: false })
          .limit(1)
      : Promise.resolve({ data: null }),
  ])

  const shifts = (shiftsResult.data ?? []) as ShiftRow[]
  const leadUserId = (leadResult.data?.[0]?.lead_user_id as string | null) ?? null
  const prelimBlock = (prelimResult.data as Array<{ id: string }> | null)?.[0] ?? null

  // PRN open shifts (query 9) — only if preliminary block exists
  let unsignaledCount = 0
  if (isPRN && prelimBlock) {
    const [offShiftsResult, interestResult] = await Promise.all([
      supabase
        .from('shifts')
        .select('id')
        .eq('user_id', user.id)
        .eq('schedule_block_id', prelimBlock.id)
        .eq('cell_state', 'off'),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase as any)
        .from('prn_shift_interest')
        .select('shift_id')
        .eq('user_id', user.id)
        .eq('schedule_block_id', prelimBlock.id),
    ])
    unsignaledCount = computeUnsignaledCount(
      offShiftsResult.data ?? [],
      interestResult.data ?? []
    )
  }

  // Derived values
  const todayShift = shifts.find(s => s.shift_date === todayStr) ?? null
  const leadName = resolveLeadName(leadUserId, therapists)
  const weekDays = buildWeekWindow(shifts, block.start_date, block.end_date, todayStr)
  const therapistNameMap = new Map(therapists.map(t => [t.id, t.full_name ?? '']))

  const dateLabel = format(new Date(`${todayStr}T00:00:00`), 'EEEE, MMMM d')

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-900">Today</h1>
        <span className="text-sm text-slate-500">{dateLabel}</span>
      </div>

      {/* Shift card — full width */}
      <TodayShiftCard shift={todayShift} block={block} leadName={leadName} />

      {/* Week strip — full width */}
      <TodayWeekStrip days={weekDays} todayStr={todayStr} />

      {/* 2-col grid for remaining cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <TodaySwapsCard
          swaps={swaps}
          currentUserId={user.id}
          therapistNames={therapistNameMap}
        />
        <TodayOpCodesCard entries={opEntries} />
        <TodayBlockCard block={block} />
        {isPRN && (
          <TodayOpenShiftsCard
            unsignaledCount={unsignaledCount}
            prelimBlockId={prelimBlock?.id ?? null}
          />
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Run tests**

```bash
npm test
```
Expected: all tests pass

- [ ] **Step 3: Build check (catches TypeScript errors)**

```bash
npm run build
```
Expected: build succeeds with no TypeScript errors. If TS errors appear, fix them before proceeding.

- [ ] **Step 4: Commit**

```bash
git add app/\(app\)/today/page.tsx
git commit -m "feat(today): server page with parallel data fetching"
```

---

## Task 7: Final verification

- [ ] **Step 1: Run full test suite one last time**

```bash
npm test
```
Expected: all tests pass (count should be previous count + 11 new helper tests)

- [ ] **Step 2: Lint check**

```bash
npm run lint
```
Expected: no errors

- [ ] **Step 3: Smoke-test manually (dev server)**

```bash
npm run dev
```

Login as `jsmith@teamwise.dev` / `password123` and verify:
1. After login, redirected to `/today` (not `/schedule`)
2. Sidebar shows "Today" item above "Schedule"
3. Shift card shows status for today's date
4. Week strip shows 7 (or fewer) day dots
5. Swaps card renders (pending or empty)
6. Op codes card renders (empty or with codes)
7. Block card shows block name, status badge, link to /schedule
8. Login as `manager@teamwise.dev` → redirected to `/schedule` (not `/today`)
9. Manager does NOT see "Today" in sidebar

- [ ] **Step 4: Final commit (if any lint/build fixes needed)**

```bash
git add -p
git commit -m "fix(today): address lint and build feedback"
```

---

## Edge Cases Summary

| Scenario | Handled In |
|----------|-----------|
| No active/final block | `TodayPage` — early return with friendly message |
| Today outside block range | `buildWeekWindow` starts from blockStart; `TodayShiftCard` shows "—" |
| Therapist is off | `TodayShiftCard` — shows OFF, hides lead field |
| No lead assigned | `TodayShiftCard` — shows "No lead assigned" |
| No pending swaps | `TodaySwapsCard` — shows "No pending requests" |
| No op codes today | `TodayOpCodesCard` — shows "No codes entered for today" |
| PRN with no open shifts | `TodayOpenShiftsCard` — shows "No open shifts right now" |
| FT therapist | `TodayOpenShiftsCard` not rendered (guarded by `isPRN && prelimBlock`) |
| No department | `TodayPage` — inline message, no redirect |
| Block ends in < 7 days | `buildWeekWindow` — returns remaining days only |
