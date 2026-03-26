# Phase 10 — Richer Exports Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a printable schedule PDF (browser print dialog) and three CSV exports (coverage, KPI summary, staff roster) to Teamwise.

**Architecture:** Print CSS scoped via a pass-through schedule layout; CSV building logic extracted into pure helper functions tested independently; server actions fetch data and call helpers; client components trigger downloads via `Blob + URL.createObjectURL`. Ops page queries extracted into a shared `fetch-block-health.ts` helper reused by the new KPI export action.

**Tech Stack:** Next.js 14 App Router, Supabase (anon client), TypeScript, Tailwind CSS, shadcn/ui (toast), Vitest (jsdom for download helper test)

**Spec:** `docs/superpowers/specs/2026-03-25-phase10-richer-exports-design.md`

---

## File Map

### Create
| File | Purpose |
|------|---------|
| `lib/exports/download-csv.ts` | Shared `downloadCSV(filename, data)` — Blob + anchor click |
| `lib/exports/build-coverage-csv.ts` | Pure `buildCoverageCSV(rows, threshold)` → CSV string |
| `lib/exports/build-kpi-csv.ts` | Pure `buildKPICSV(rows)` → CSV string |
| `lib/exports/build-staff-csv.ts` | Pure `buildStaffCSV(users)` → CSV string |
| `lib/ops/types.ts` | `OpsFilterParams` interface |
| `lib/ops/fetch-block-health.ts` | Shared Supabase fetch helper for ops data |
| `app/actions/coverage.ts` | `exportCoverageCSV(blockId)` server action |
| `app/actions/ops.ts` | `exportKPICSV(filters)` server action |
| `app/(app)/schedule/print.css` | `@media print` styles for schedule grid |
| `app/(app)/schedule/layout.tsx` | Pass-through layout to scope `print.css` |
| `components/schedule/PrintButton.tsx` | `'use client'` — calls `window.print()` |
| `components/coverage/ExportCoverageButton.tsx` | `'use client'` — triggers coverage CSV download |
| `components/ops/ExportKPIButton.tsx` | `'use client'` — triggers KPI CSV download |
| `components/staff/ExportStaffButton.tsx` | `'use client'` — triggers staff CSV download |
| `tests/unit/exports.test.ts` | 4 unit tests for pure CSV helpers + downloadCSV |

### Modify
| File | Change |
|------|--------|
| `app/actions/staff.ts` | Add `exportStaffCSV()` action |
| `app/(app)/ops/page.tsx` | Refactor to use `fetch-block-health.ts`; add `ExportKPIButton` |
| `app/(app)/coverage/page.tsx` | Add `ExportCoverageButton` |
| `app/(app)/staff/page.tsx` | Add `ExportStaffButton` |
| `app/(app)/layout.tsx` | Wrap `<Sidebar>` with `id="app-sidebar"` div; wrap `<TopBar>` with `id="app-topbar"` div |
| `CLAUDE.md` | Update unit test count 114 → 118; add Phase 10 note |

---

## Task 1: Shared Infrastructure — Download Helper + CSV Builders (TDD)

**Files:**
- Create: `lib/exports/download-csv.ts`
- Create: `lib/exports/build-coverage-csv.ts`
- Create: `lib/exports/build-kpi-csv.ts`
- Create: `lib/exports/build-staff-csv.ts`
- Create: `tests/unit/exports.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/unit/exports.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildCoverageCSV } from '@/lib/exports/build-coverage-csv'
import { buildKPICSV } from '@/lib/exports/build-kpi-csv'
import { buildStaffCSV } from '@/lib/exports/build-staff-csv'
import { downloadCSV } from '@/lib/exports/download-csv'

describe('buildCoverageCSV', () => {
  it('outputs correct header and one data row', () => {
    const rows = [{ date: '2026-04-01', shift_type: 'day', planned_headcount: 4, actual_headcount: 3 }]
    const csv = buildCoverageCSV(rows, 3)
    const lines = csv.trim().split('\n')
    expect(lines[0]).toBe('date,shift_type,planned_headcount,actual_headcount,threshold,status')
    expect(lines).toHaveLength(2)
    expect(lines[1]).toContain('ok') // 3 >= 3
  })
})

describe('buildKPICSV', () => {
  it('outputs correct header and one data row', () => {
    const rows = [{
      blockId: 'b1', shiftType: 'day', startDate: '2026-04-01', endDate: '2026-05-12',
      status: 'active', leadGapDates: 1, pendingSwaps: 0, pendingChangeRequests: 2,
      pendingPrnInterest: 0, lowCoverageDates: 1, riskScore: 4,
    }]
    const csv = buildKPICSV(rows)
    const lines = csv.trim().split('\n')
    expect(lines[0]).toBe('block_id,shift_type,start_date,end_date,status,lead_gap_dates,pending_swaps,pending_change_requests,pending_prn_interest,low_coverage_dates,risk_score')
    expect(lines).toHaveLength(2)
    expect(lines[1]).toContain('b1')
  })
})

describe('buildStaffCSV', () => {
  it('outputs correct header and filters to department data', () => {
    const users = [{ full_name: 'Jane Smith', email: 'j@t.dev', role: 'therapist', employment_type: 'ft', is_lead_qualified: true, is_active: true, created_at: '2026-01-01T00:00:00Z' }]
    const csv = buildStaffCSV(users)
    const lines = csv.trim().split('\n')
    expect(lines[0]).toBe('full_name,email,role,employment_type,is_lead_qualified,is_active,created_at')
    expect(lines).toHaveLength(2)
    expect(lines[1]).toContain('Jane Smith')
  })
})

describe('downloadCSV', () => {
  beforeEach(() => {
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:mock-url'),
      revokeObjectURL: vi.fn(),
    })
  })

  it('creates a Blob with text/csv MIME type', () => {
    const appendSpy = vi.spyOn(document.body, 'appendChild').mockImplementation((el) => el)
    const removeSpy = vi.spyOn(document.body, 'removeChild').mockImplementation((el) => el)
    downloadCSV('test.csv', 'a,b\n1,2')
    expect(URL.createObjectURL).toHaveBeenCalledWith(expect.any(Blob))
    const blob = (URL.createObjectURL as ReturnType<typeof vi.fn>).mock.calls[0][0] as Blob
    expect(blob.type).toBe('text/csv')
    appendSpy.mockRestore()
    removeSpy.mockRestore()
  })
})
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
npm test -- tests/unit/exports.test.ts
```

Expected: 4 failures — modules not found.

- [ ] **Step 3: Implement `downloadCSV`**

Create `lib/exports/download-csv.ts`:

```ts
export function downloadCSV(filename: string, csvData: string): void {
  const blob = new Blob([csvData], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
```

- [ ] **Step 4: Implement `buildCoverageCSV`**

Create `lib/exports/build-coverage-csv.ts`:

```ts
export interface CoverageCSVRow {
  date: string
  shift_type: string
  planned_headcount: number
  actual_headcount: number | null
}

export function buildCoverageCSV(rows: CoverageCSVRow[], threshold: number): string {
  const header = 'date,shift_type,planned_headcount,actual_headcount,threshold,status'
  const lines = rows.map((r) => {
    const actual = r.actual_headcount
    const status = actual === null ? 'n/a' : actual >= threshold ? 'ok' : 'critical'
    return [r.date, r.shift_type, r.planned_headcount, actual ?? '', threshold, status].join(',')
  })
  return [header, ...lines].join('\n')
}
```

- [ ] **Step 5: Implement `buildKPICSV`**

Create `lib/exports/build-kpi-csv.ts`:

```ts
import type { BlockHealthRow } from '@/lib/ops/block-health'

export function buildKPICSV(rows: BlockHealthRow[]): string {
  const header = 'block_id,shift_type,start_date,end_date,status,lead_gap_dates,pending_swaps,pending_change_requests,pending_prn_interest,low_coverage_dates,risk_score'
  const lines = rows.map((r) =>
    [r.blockId, r.shiftType, r.startDate, r.endDate, r.status,
      r.leadGapDates, r.pendingSwaps, r.pendingChangeRequests,
      r.pendingPrnInterest, r.lowCoverageDates, r.riskScore].join(',')
  )
  return [header, ...lines].join('\n')
}
```

- [ ] **Step 6: Implement `buildStaffCSV`**

Create `lib/exports/build-staff-csv.ts`:

```ts
export interface StaffCSVRow {
  full_name: string | null
  email: string
  role: string
  employment_type: string | null
  is_lead_qualified: boolean
  is_active: boolean
  created_at: string
}

export function buildStaffCSV(users: StaffCSVRow[]): string {
  const header = 'full_name,email,role,employment_type,is_lead_qualified,is_active,created_at'
  const lines = users.map((u) =>
    [u.full_name ?? '', u.email, u.role, u.employment_type ?? '',
      u.is_lead_qualified, u.is_active, u.created_at].join(',')
  )
  return [header, ...lines].join('\n')
}
```

- [ ] **Step 7: Run tests — verify all 4 pass**

```bash
npm test -- tests/unit/exports.test.ts
```

Expected: 4 passing.

- [ ] **Step 8: Run full test suite — verify no regressions**

```bash
npm test
```

Expected: 118 passing (114 existing + 4 new).

- [ ] **Step 9: Commit**

```bash
git add lib/exports/ tests/unit/exports.test.ts
git commit -m "feat(exports): CSV builder helpers + download utility with tests"
```

---

## Task 2: Ops Types + Fetch Helper Extraction

Extract the ops page Supabase queries into a reusable helper and add the shared `OpsFilterParams` type.

**Files:**
- Create: `lib/ops/types.ts`
- Create: `lib/ops/fetch-block-health.ts`
- Modify: `app/(app)/ops/page.tsx`

- [ ] **Step 1: Create `lib/ops/types.ts`**

```ts
export interface OpsFilterParams {
  shift?: string
  blockId?: string
  from?: string
  to?: string
}
```

- [ ] **Step 2: Create `lib/ops/fetch-block-health.ts`**

This extracts lines 94–216 of `app/(app)/ops/page.tsx` into a standalone function. The helper accepts `OpsFilterParams` + a Supabase client and a `departmentId`, and returns everything `buildBlockHealthRows` needs.

```ts
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/types/database.types'
import type { OpsFilterParams } from './types'

type BlockRow = Database['public']['Tables']['schedule_blocks']['Row']
type ActualHeadcountRow = Database['public']['Views']['shift_actual_headcount']['Row']

export interface BlockHealthFetchResult {
  filteredBlocks: BlockRow[]
  allBlocks: BlockRow[]
  blockIds: string[]
  shifts: Array<{ id: string; schedule_block_id: string; shift_date: string; cell_state: string; lead_user_id: string | null }>
  pendingSwaps: number
  pendingChangeRequests: number
  pendingPrnInterest: number
  pendingSwapBlockIds: string[]
  pendingChangeBlockIds: string[]
  pendingPrnByBlockId: Map<string, number>
  actualRows: Array<{ schedule_block_id: string; shift_date: string; total_actual: number }>
}

export async function fetchBlockHealthData(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  departmentId: string,
  filters: OpsFilterParams
): Promise<BlockHealthFetchResult> {
  const shift = filters.shift === 'day' || filters.shift === 'night' ? filters.shift : 'all'
  const blockId = filters.blockId ?? ''
  const from = filters.from ?? ''
  const to = filters.to ?? ''

  const { data: blocksData } = await supabase
    .from('schedule_blocks')
    .select('*')
    .eq('department_id', departmentId)
    .order('start_date', { ascending: false })
  const allBlocks = (blocksData ?? []) as BlockRow[]

  const filteredBlocks = allBlocks.filter((b) => {
    if (shift !== 'all' && b.shift_type !== shift) return false
    if (blockId && b.id !== blockId) return false
    return true
  })
  const blockIds = filteredBlocks.map((b) => b.id)

  if (blockIds.length === 0) {
    return {
      filteredBlocks, allBlocks, blockIds: [], shifts: [],
      pendingSwaps: 0, pendingChangeRequests: 0, pendingPrnInterest: 0,
      pendingSwapBlockIds: [], pendingChangeBlockIds: [],
      pendingPrnByBlockId: new Map(), actualRows: [],
    }
  }

  const shiftsQuery = supabase
    .from('shifts')
    .select('id, schedule_block_id, shift_date, cell_state, lead_user_id')
    .in('schedule_block_id', blockIds)
  if (from) shiftsQuery.gte('shift_date', from)
  if (to) shiftsQuery.lte('shift_date', to)
  const { data: shiftsData } = await shiftsQuery as {
    data: Array<{ id: string; schedule_block_id: string; shift_date: string; cell_state: string; lead_user_id: string | null }> | null
    error: unknown
  }
  const shifts = shiftsData ?? []

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { count: pendingSwapsCount } = await (supabase as any)
    .from('swap_requests')
    .select('*', { count: 'exact', head: true })
    .in('schedule_block_id', blockIds)
    .eq('status', 'pending')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: pendingSwapRows } = await (supabase as any)
    .from('swap_requests')
    .select('schedule_block_id')
    .in('schedule_block_id', blockIds)
    .eq('status', 'pending')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { count: pendingChangeCount } = await (supabase as any)
    .from('preliminary_change_requests')
    .select('*', { count: 'exact', head: true })
    .in('schedule_block_id', blockIds)
    .eq('status', 'pending')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: pendingChangeRows } = await (supabase as any)
    .from('preliminary_change_requests')
    .select('schedule_block_id')
    .in('schedule_block_id', blockIds)
    .eq('status', 'pending')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: pendingPrnRows } = await (supabase as any)
    .from('prn_shift_interest')
    .select('shift_id')
    .eq('status', 'pending') as { data: Array<{ shift_id: string }> | null; error: unknown }

  const blockShiftIds = new Set(shifts.map((s) => s.id))
  const pendingPrnInterest = (pendingPrnRows ?? []).filter((r) => blockShiftIds.has(r.shift_id)).length

  const shiftToBlockId = new Map(shifts.map((s) => [s.id, s.schedule_block_id]))
  const pendingPrnByBlockId = new Map<string, number>()
  for (const r of pendingPrnRows ?? []) {
    if (!blockShiftIds.has(r.shift_id)) continue
    const bid = shiftToBlockId.get(r.shift_id)
    if (!bid) continue
    pendingPrnByBlockId.set(bid, (pendingPrnByBlockId.get(bid) ?? 0) + 1)
  }

  const pendingSwapBlockIds = (pendingSwapRows ?? []).map(
    (r: { schedule_block_id: string }) => r.schedule_block_id
  )
  const pendingChangeBlockIds = (pendingChangeRows ?? []).map(
    (r: { schedule_block_id: string }) => r.schedule_block_id
  )

  const activeCompletedBlockIds = filteredBlocks
    .filter((b) => b.status === 'active' || b.status === 'completed')
    .map((b) => b.id)
  let actualRows: Array<{ schedule_block_id: string; shift_date: string; total_actual: number }> = []
  if (activeCompletedBlockIds.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const actualQuery = (supabase as any)
      .from('shift_actual_headcount')
      .select('*')
      .in('schedule_block_id', activeCompletedBlockIds)
    if (from) actualQuery.gte('shift_date', from)
    if (to) actualQuery.lte('shift_date', to)
    const { data } = await actualQuery as { data: Array<{ schedule_block_id: string; shift_date: string; total_actual: number }> | null; error: unknown }
    actualRows = (data ?? []).map((r) => ({
      schedule_block_id: r.schedule_block_id,
      shift_date: r.shift_date,
      total_actual: r.total_actual,
    }))
  }

  return {
    filteredBlocks,
    allBlocks,
    blockIds,
    shifts,
    pendingSwaps: pendingSwapsCount ?? 0,
    pendingChangeRequests: pendingChangeCount ?? 0,
    pendingPrnInterest,
    pendingSwapBlockIds,
    pendingChangeBlockIds,
    pendingPrnByBlockId,
    actualRows,
  }
}
```

- [ ] **Step 3: Refactor `app/(app)/ops/page.tsx` to use the helper**

At the top of `app/(app)/ops/page.tsx`, add imports:

```ts
import { fetchBlockHealthData } from '@/lib/ops/fetch-block-health'
import type { OpsFilterParams } from '@/lib/ops/types'
```

Replace the `interface PageProps` block with:

```ts
interface PageProps {
  searchParams: OpsFilterParams
}
```

After the role guard (lines 63–85 in the original — the part that builds `shift`, `blockId`, `from`, `to`, and the URL helper strings), replace everything from line 94 (`const { data: blocksData }`) down to line 216 (`})` closing `buildBlockHealthRows`) with:

```ts
  const result = await fetchBlockHealthData(supabase, profile.department_id, searchParams)
  const { filteredBlocks, allBlocks, blockIds, shifts, pendingSwaps: pendingSwapsCount,
    pendingChangeRequests: pendingChangeCount, pendingPrnInterest, pendingSwapBlockIds,
    pendingChangeBlockIds, pendingPrnByBlockId, actualRows } = result

  if (blockIds.length === 0) {
    return (
      <div className="space-y-4">
        <h1 className="text-lg font-semibold text-slate-900">Operations Dashboard</h1>
        <OpsFilters shift={shift} blockId={blockId} from={from} to={to} blocks={allBlocks} />
        <p className="text-sm text-slate-500">No blocks matched your filters.</p>
      </div>
    )
  }

  const blockHealthRows = buildBlockHealthRows({
    blocks: filteredBlocks,
    shifts,
    actualRows,
    pendingSwapBlockIds,
    pendingChangeBlockIds,
    pendingPrnByBlockId,
  })

  const kpis = buildOpsKpis({
    shifts,
    pendingSwaps: pendingSwapsCount,
    pendingChangeRequests: pendingChangeCount,
    pendingPrnInterest,
    actualRows,
  })
```

The rest of the page (users query, event feed queries, JSX) remains unchanged. Remove unused variable declarations that are now in the helper.

- [ ] **Step 4: Verify the ops page still works — run full test suite**

```bash
npm test
```

Expected: 118 passing, no regressions.

- [ ] **Step 5: Commit**

```bash
git add lib/ops/types.ts lib/ops/fetch-block-health.ts app/\(app\)/ops/page.tsx
git commit -m "refactor(ops): extract block-health fetch helper + OpsFilterParams type"
```

---

## Task 3: Schedule Grid PDF (Print CSS + PrintButton)

**Files:**
- Modify: `app/(app)/layout.tsx`
- Create: `app/(app)/schedule/layout.tsx`
- Create: `app/(app)/schedule/print.css`
- Create: `components/schedule/PrintButton.tsx`
- Modify: `app/(app)/schedule/page.tsx`

- [ ] **Step 1: Add print-target IDs to the app shell layout**

In `app/(app)/layout.tsx`, wrap `<Sidebar>` and `<TopBar>` with ID'd divs so print CSS can target them:

```tsx
return (
  <div className="flex h-screen overflow-hidden bg-slate-50">
    <div id="app-sidebar">
      <Sidebar role={profile.role} />
    </div>
    <div className="flex flex-col flex-1 min-w-0 lg:pl-14 xl:pl-56">
      <div id="app-topbar">
        <TopBar user={profile} />
      </div>
      <main className="flex-1 overflow-auto p-4">
        {children}
      </main>
    </div>
  </div>
)
```

- [ ] **Step 2: Create the pass-through schedule layout**

Create `app/(app)/schedule/layout.tsx`:

```tsx
import './print.css'

export default function ScheduleLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
```

- [ ] **Step 3: Create `app/(app)/schedule/print.css`**

```css
@media print {
  @page {
    size: landscape;
    margin: 10mm;
  }

  /* Hide shell chrome */
  #app-sidebar,
  #app-topbar {
    display: none !important;
  }

  /* Hide interactive controls */
  [data-no-print] {
    display: none !important;
  }

  /* Remove overflow clip so full grid prints */
  body,
  .flex.h-screen.overflow-hidden {
    overflow: visible !important;
    height: auto !important;
  }

  /* Ensure main content fills the page */
  main {
    overflow: visible !important;
    padding: 0 !important;
  }

  /* Force grid to compress columns across page width */
  .grid-row {
    display: grid;
    grid-template-columns: 120px repeat(42, minmax(16px, 1fr)) !important;
  }

  /* Preserve cell colors when printing */
  * {
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }

  /* Print header — block name shown at top */
  #print-header {
    display: block !important;
    font-size: 14px;
    font-weight: 600;
    margin-bottom: 8px;
  }
}

/* Hide print header on screen */
#print-header {
  display: none;
}
```

- [ ] **Step 4: Create `PrintButton`**

Create `components/schedule/PrintButton.tsx`:

```tsx
'use client'

interface Props {
  label?: string
}

export function PrintButton({ label = 'Print Schedule' }: Props) {
  return (
    <button
      data-no-print
      onClick={() => window.print()}
      className="px-3 py-1.5 text-sm rounded-md border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
    >
      {label}
    </button>
  )
}
```

- [ ] **Step 5: Add `PrintButton` and print header to the schedule page**

In `app/(app)/schedule/page.tsx`, find where the page renders its header/title area (look for the element containing the `BlockPicker` or the page heading). Add:

1. Import `PrintButton`:
```tsx
import { PrintButton } from '@/components/schedule/PrintButton'
```

2. Near the top of the returned JSX (inside the main content), add a print-only header and the print button. Find the existing heading area and insert alongside it. For example, find the area near where `BlockPicker` or the shift tab is rendered and add the button to the controls row:

```tsx
{/* Print-only header — hidden on screen, shown when printing */}
<div id="print-header">
  {block?.name ?? 'Schedule'} — {block?.start_date} to {block?.end_date}
</div>
{/* Add PrintButton to the existing controls/header area */}
<PrintButton />
```

Look at the actual schedule page JSX to find the right insertion point — typically next to the `BlockPicker` or shift selector in the header row. Add `<PrintButton />` alongside the other controls, and `<div id="print-header">` immediately before the grid.

- [ ] **Step 6: Add `data-no-print` to `BlockStatusActions`**

In `components/schedule/BlockStatusActions.tsx`, add `data-no-print` to the root element so it is hidden when printing:

```tsx
// Find the root div/section in BlockStatusActions and add:
<div data-no-print ...>
```

- [ ] **Step 7: Run tests — verify no regressions**

```bash
npm test
```

Expected: 118 passing.

- [ ] **Step 8: Commit**

```bash
git add app/\(app\)/layout.tsx app/\(app\)/schedule/ components/schedule/PrintButton.tsx components/schedule/BlockStatusActions.tsx
git commit -m "feat(exports): schedule print CSS + PrintButton"
```

---

## Task 4: Coverage CSV Export

**Files:**
- Create: `app/actions/coverage.ts`
- Create: `components/coverage/ExportCoverageButton.tsx`
- Modify: `app/(app)/coverage/page.tsx`

- [ ] **Step 1: Create `app/actions/coverage.ts`**

```ts
'use server'

import { createClient } from '@/lib/supabase/server'
import { getServerUser } from '@/lib/auth'
import { buildCoverageCSV } from '@/lib/exports/build-coverage-csv'

export async function exportCoverageCSV(
  blockId: string
): Promise<{ data: string } | { error: string }> {
  const user = await getServerUser()
  if (!user) return { error: 'Not authenticated' }

  const supabase = createClient()
  const { data: profile } = await supabase
    .from('users')
    .select('role, department_id')
    .eq('id', user.id)
    .single() as { data: { role: string; department_id: string | null } | null; error: unknown }
  if (!profile || profile.role !== 'manager') return { error: 'Manager access required' }
  if (!profile.department_id) return { error: 'No department assigned' }

  // Get the block's shift_type to filter thresholds correctly
  const { data: blockData } = await supabase
    .from('schedule_blocks')
    .select('shift_type, status')
    .eq('id', blockId)
    .single() as { data: { shift_type: string; status: string } | null; error: unknown }
  if (!blockData) return { error: 'Block not found' }

  // Fetch planned headcount
  const { data: planned } = await supabase
    .from('shift_planned_headcount')
    .select('shift_date, total_planned')
    .eq('schedule_block_id', blockId) as {
      data: Array<{ shift_date: string; total_planned: number }> | null
      error: unknown
    }

  // Fetch actual headcount (only available for active/completed blocks)
  let actualMap = new Map<string, number>()
  if (blockData.status === 'active' || blockData.status === 'completed') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: actual } = await (supabase as any)
      .from('shift_actual_headcount')
      .select('shift_date, total_actual')
      .eq('schedule_block_id', blockId) as {
        data: Array<{ shift_date: string; total_actual: number }> | null
        error: unknown
      }
    actualMap = new Map((actual ?? []).map((r) => [r.shift_date, r.total_actual]))
  }

  // Fetch threshold for this block's shift_type
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: thresholdData } = await (supabase as any)
    .from('coverage_thresholds')
    .select('minimum_staff')
    .eq('department_id', profile.department_id)
    .eq('shift_type', blockData.shift_type)
    .single() as { data: { minimum_staff: number } | null; error: unknown }
  const threshold = thresholdData?.minimum_staff ?? 3

  const rows = (planned ?? []).map((r) => ({
    date: r.shift_date,
    shift_type: blockData.shift_type,
    planned_headcount: r.total_planned,
    actual_headcount: actualMap.get(r.shift_date) ?? null,
  }))

  const csv = buildCoverageCSV(rows, threshold)
  return { data: csv }
}
```

- [ ] **Step 2: Create `ExportCoverageButton`**

Create `components/coverage/ExportCoverageButton.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { exportCoverageCSV } from '@/app/actions/coverage'
import { downloadCSV } from '@/lib/exports/download-csv'

interface Props {
  blockId: string
}

export function ExportCoverageButton({ blockId }: Props) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleExport() {
    setLoading(true)
    setError(null)
    const result = await exportCoverageCSV(blockId)
    setLoading(false)
    if ('error' in result) {
      setError(result.error)
      return
    }
    const date = new Date().toISOString().slice(0, 10)
    downloadCSV(`coverage-${blockId}-${date}.csv`, result.data)
  }

  return (
    <div>
      <button
        onClick={handleExport}
        disabled={loading}
        className="px-3 py-1.5 text-sm rounded-md border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50"
      >
        {loading ? 'Exporting…' : 'Export CSV'}
      </button>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  )
}
```

- [ ] **Step 3: Add button to the coverage page**

In `app/(app)/coverage/page.tsx`, add the import and the button to the header area:

```tsx
import { ExportCoverageButton } from '@/components/coverage/ExportCoverageButton'
```

In the JSX, find the header `<div className="flex items-center justify-between ...">` and add `<ExportCoverageButton blockId={block.id} />` alongside the existing Day/Night link buttons. Pass the resolved `block.id` (not the raw `searchParams.blockId`).

- [ ] **Step 4: Run tests — verify no regressions**

```bash
npm test
```

Expected: 118 passing.

- [ ] **Step 5: Commit**

```bash
git add app/actions/coverage.ts components/coverage/ExportCoverageButton.tsx app/\(app\)/coverage/page.tsx
git commit -m "feat(exports): coverage CSV export action + button"
```

---

## Task 5: KPI CSV Export

**Files:**
- Create: `app/actions/ops.ts`
- Create: `components/ops/ExportKPIButton.tsx`
- Modify: `app/(app)/ops/page.tsx`

- [ ] **Step 1: Create `app/actions/ops.ts`**

```ts
'use server'

import { createClient } from '@/lib/supabase/server'
import { getServerUser } from '@/lib/auth'
import { fetchBlockHealthData } from '@/lib/ops/fetch-block-health'
import { buildBlockHealthRows } from '@/lib/ops/block-health'
import { buildKPICSV } from '@/lib/exports/build-kpi-csv'
import type { OpsFilterParams } from '@/lib/ops/types'

export async function exportKPICSV(
  filters: OpsFilterParams
): Promise<{ data: string } | { error: string }> {
  const user = await getServerUser()
  if (!user) return { error: 'Not authenticated' }

  const supabase = createClient()
  const { data: profile } = await supabase
    .from('users')
    .select('role, department_id')
    .eq('id', user.id)
    .single() as { data: { role: string; department_id: string | null } | null; error: unknown }
  if (!profile || profile.role !== 'manager') return { error: 'Manager access required' }
  if (!profile.department_id) return { error: 'No department assigned' }

  const result = await fetchBlockHealthData(supabase, profile.department_id, filters)
  if (result.blockIds.length === 0) return { data: buildKPICSV([]) }

  const rows = buildBlockHealthRows({
    blocks: result.filteredBlocks,
    shifts: result.shifts,
    actualRows: result.actualRows,
    pendingSwapBlockIds: result.pendingSwapBlockIds,
    pendingChangeBlockIds: result.pendingChangeBlockIds,
    pendingPrnByBlockId: result.pendingPrnByBlockId,
  })

  return { data: buildKPICSV(rows) }
}
```

- [ ] **Step 2: Create `ExportKPIButton`**

Create `components/ops/ExportKPIButton.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { exportKPICSV } from '@/app/actions/ops'
import { downloadCSV } from '@/lib/exports/download-csv'
import type { OpsFilterParams } from '@/lib/ops/types'

interface Props {
  filters: OpsFilterParams
}

export function ExportKPIButton({ filters }: Props) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleExport() {
    setLoading(true)
    setError(null)
    const result = await exportKPICSV(filters)
    setLoading(false)
    if ('error' in result) {
      setError(result.error)
      return
    }
    const date = new Date().toISOString().slice(0, 10)
    downloadCSV(`kpi-summary-${date}.csv`, result.data)
  }

  return (
    <div>
      <button
        onClick={handleExport}
        disabled={loading}
        className="px-3 py-1.5 text-sm rounded-md border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50"
      >
        {loading ? 'Exporting…' : 'Export CSV'}
      </button>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  )
}
```

- [ ] **Step 3: Add `ExportKPIButton` to the ops page**

In `app/(app)/ops/page.tsx`, add the import:

```tsx
import { ExportKPIButton } from '@/components/ops/ExportKPIButton'
```

In the JSX, find the `<h1>Operations Dashboard</h1>` heading and change the heading wrapper to include the button:

```tsx
<div className="flex items-center justify-between">
  <h1 className="text-lg font-semibold text-slate-900">Operations Dashboard</h1>
  <ExportKPIButton filters={{ shift: searchParams.shift, blockId: searchParams.blockId, from: searchParams.from, to: searchParams.to }} />
</div>
```

- [ ] **Step 4: Run tests — verify no regressions**

```bash
npm test
```

Expected: 118 passing.

- [ ] **Step 5: Commit**

```bash
git add app/actions/ops.ts components/ops/ExportKPIButton.tsx app/\(app\)/ops/page.tsx
git commit -m "feat(exports): KPI CSV export action + button"
```

---

## Task 6: Staff CSV Export

**Files:**
- Modify: `app/actions/staff.ts`
- Create: `components/staff/ExportStaffButton.tsx`
- Modify: `app/(app)/staff/page.tsx`

- [ ] **Step 1: Add `exportStaffCSV` to `app/actions/staff.ts`**

At the bottom of `app/actions/staff.ts`, add:

```ts
import { buildStaffCSV } from '@/lib/exports/build-staff-csv'

export async function exportStaffCSV(): Promise<{ data: string } | { error: string }> {
  const user = await getServerUser()
  if (!user) return { error: 'Not authenticated' }

  const supabase = createClient()
  const { data: profile } = await supabase
    .from('users')
    .select('role, department_id')
    .eq('id', user.id)
    .single() as { data: { role: string; department_id: string | null } | null; error: unknown }
  if (!profile || profile.role !== 'manager') return { error: 'Manager access required' }
  if (!profile.department_id) return { error: 'No department assigned' }

  const { data: usersData } = await supabase
    .from('users')
    .select('full_name, email, role, employment_type, is_lead_qualified, is_active, created_at')
    .eq('department_id', profile.department_id)
    .order('full_name') as {
      data: Array<{
        full_name: string | null
        email: string
        role: string
        employment_type: string | null
        is_lead_qualified: boolean
        is_active: boolean
        created_at: string
      }> | null
      error: unknown
    }

  return { data: buildStaffCSV(usersData ?? []) }
}
```

Note: add the `buildStaffCSV` import at the top of the file alongside the existing imports.

- [ ] **Step 2: Create `ExportStaffButton`**

Create `components/staff/ExportStaffButton.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { exportStaffCSV } from '@/app/actions/staff'
import { downloadCSV } from '@/lib/exports/download-csv'

export function ExportStaffButton() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleExport() {
    setLoading(true)
    setError(null)
    const result = await exportStaffCSV()
    setLoading(false)
    if ('error' in result) {
      setError(result.error)
      return
    }
    const date = new Date().toISOString().slice(0, 10)
    downloadCSV(`staff-roster-${date}.csv`, result.data)
  }

  return (
    <div>
      <button
        onClick={handleExport}
        disabled={loading}
        className="px-3 py-1.5 text-sm rounded-md border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50"
      >
        {loading ? 'Exporting…' : 'Export CSV'}
      </button>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  )
}
```

- [ ] **Step 3: Add button to the staff page**

In `app/(app)/staff/page.tsx`, add the import:

```tsx
import { ExportStaffButton } from '@/components/staff/ExportStaffButton'
```

In the JSX, find the page heading and add the button alongside it:

```tsx
<div className="flex items-center justify-between">
  <h1 className="text-lg font-semibold text-slate-900">Staff</h1>
  <ExportStaffButton />
</div>
```

- [ ] **Step 4: Run full test suite — verify all tests pass**

```bash
npm test
```

Expected: 118 passing.

- [ ] **Step 5: Commit**

```bash
git add app/actions/staff.ts components/staff/ExportStaffButton.tsx app/\(app\)/staff/page.tsx
git commit -m "feat(exports): staff roster CSV export action + button"
```

---

## Task 7: CLAUDE.md Update

- [ ] **Step 1: Update unit test count and add Phase 10 entry**

In `CLAUDE.md`:
1. Find `**114** unit tests` and change to `**118** unit tests`
2. In the Phase Status section, find the Phase 10+ candidates line and replace with:

```markdown
- **Phase 10 (Richer Exports):** Complete — browser print PDF for schedule grid (`@media print` + `PrintButton`), Coverage CSV (`exportCoverageCSV`), KPI CSV (`exportKPICSV` via shared `fetch-block-health.ts` helper), Staff Roster CSV (`exportStaffCSV`). 4 new Vitest unit tests in `tests/unit/exports.test.ts` (118 total). No new npm dependencies.
- **Phase 11+:** Candidates — CI-hardened E2E with isolated DB.
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md for Phase 10 richer exports"
```

---

## Summary

| Task | Deliverable |
|------|-------------|
| 1 | CSV helpers + download utility, 4 unit tests |
| 2 | `fetch-block-health.ts` + ops page refactor |
| 3 | Print CSS, schedule layout, PrintButton |
| 4 | Coverage CSV export |
| 5 | KPI CSV export |
| 6 | Staff roster CSV export |
| 7 | CLAUDE.md update |

**Verification:** `npm test` → 118 passing. Manual verification: open `/schedule`, click Print Schedule, check browser print dialog. Open `/coverage`, `/ops`, `/staff`, click Export CSV on each, confirm `.csv` file downloads.
