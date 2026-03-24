# Phase 2: Availability & Schedule Building — Teamwise Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable the full availability-to-schedule workflow: manager opens availability window, staff submit digitally, manager copies prior block, sees constraint diff, edits cells directly from the panel, and headcount rows update immediately.

**Architecture:** All data mutations use Next.js 14 Server Actions (`'use server'`). The schedule page reads `?blockId=` and `?shift=` from URL search params so the block picker is a client component that does `router.push`. `ScheduleGrid` stores `shifts` in `useState` (initialized from props) so cell edits can be applied optimistically — the panel calls a server action and updates local state on success, reverts on error. The copy operation and constraint diff are Postgres RPCs (complex SQL stays in the DB). Availability submission is a single batch upsert of up to 42 rows.

**Headcount rows (Phase 1 carry-over):** The FT Count, PRN Count, and Total rows were built in Phase 1 and already exist in `ScheduleGrid.tsx` as `useMemo` values derived from the `shifts` array. Moving `shifts` to `useState` in Task 6 means these memos automatically recalculate whenever a cell changes — no additional work needed. The `shift_planned_headcount` view also already exists in the DB schema (migration 001). Color coding (red < 3, yellow = 3, green 4-5) is already implemented. Task 6 Step 6.7 verifies this works correctly after the optimistic update plumbing is in place.

**Tech Stack:** Next.js 14, TypeScript, Supabase (@supabase/ssr), Tailwind CSS, shadcn/ui, Vitest, Server Actions

**Spec references:**
- PRD v5.2: `C:\Users\byonk\Downloads\teamwise-prd-v5.2-COMPLETE.docx` (sections 7.2, 8, 11)
- Roadmap v1.0: `C:\Users\byonk\Downloads\teamwise-roadmap-v1.md` (Phase 2)
- Phase 1 plan: `docs/superpowers/plans/2026-03-22-phase1-foundation.md`

**Critical context for every implementer:**
- `lib/auth.ts` is the ONLY file allowed to call Supabase Auth APIs. All other files use `createClient()` from `lib/supabase/server.ts` or `lib/supabase/client.ts` for data queries.
- `lib/supabase/server.ts` uses `require('next/headers')` inside the function body (NOT a top-level import) — this is intentional. Do not refactor it.
- Server Actions must be in files with `'use server'` at the top. They can call `createClient()` from `lib/supabase/server.ts`.
- `ScheduleGrid` is `'use client'`. The schedule page (`app/(app)/schedule/page.tsx`) is a server component that passes data as props.
- All 42 dates in a block are `start_date` + 0..41 days. Start dates are always Sundays.
- Schema is fully deployed. All tables exist. RLS policies allow any authenticated user to read/write (Phase 1 broad policies). No schema changes needed for Phase 2.

---

## File Map

```
teamwise-claude/
├── app/
│   ├── actions/
│   │   ├── schedule.ts              # createBlock, copyBlock, updateCellState, openAvailabilityWindow
│   │   └── availability.ts          # submitAvailability
│   └── (app)/
│       ├── schedule/
│       │   ├── page.tsx             # MODIFIED: reads ?blockId + ?shift; passes profile/role to grid
│       │   └── new/
│       │       └── page.tsx         # Manager: create new block form page
│       └── availability/
│           ├── page.tsx             # Therapist: list of blocks with open windows
│           └── [blockId]/
│               └── page.tsx         # Therapist: 42-day submission calendar
├── components/
│   ├── schedule/
│   │   ├── BlockPicker.tsx          # NEW: block selector dropdown (client)
│   │   ├── BlockCreateForm.tsx      # NEW: new block form with copy option (client)
│   │   ├── ConstraintDiff.tsx       # NEW: dismissable conflict list (client)
│   │   ├── AvailabilityWindowControl.tsx  # NEW: manager opens/closes window (client)
│   │   ├── CellPanel.tsx            # MODIFIED: add cell state edit for managers
│   │   └── ScheduleGrid.tsx         # MODIFIED: shifts in useState; accepts role + onCellUpdate
│   └── availability/
│       ├── AvailabilityCalendar.tsx # NEW: 42-day form (FT + PRN modes)
│       └── SubmissionTracker.tsx    # NEW: manager view of who has submitted
├── lib/
│   └── types/
│       └── database.types.ts        # MODIFIED: add availability tables + RPC return types
└── supabase/
    └── migrations/
        └── 002_phase2_rpcs.sql      # copy_block RPC + get_constraint_diff RPC
```

---

## Task 1: Types, RPC Migration, and Server Action Stubs

**Files:**
- Modify: `lib/types/database.types.ts`
- Create: `supabase/migrations/002_phase2_rpcs.sql`
- Create: `app/actions/schedule.ts`
- Create: `app/actions/availability.ts`
- Create: `tests/unit/phase2-types.test.ts`

- [ ] **Step 1.1: Extend database.types.ts**

Replace the entire file with the following (preserves all existing types, adds Phase 2 additions):

```typescript
// lib/types/database.types.ts
// Manual stub — replace with: npx supabase gen types typescript --project-id jcvlmwsiiikifdvaufqz

export type Database = {
  public: {
    Tables: {
      users: {
        Row: {
          id: string
          email: string
          full_name: string
          role: 'manager' | 'therapist'
          employment_type: 'full_time' | 'prn'
          is_lead_qualified: boolean
          default_shift_type: 'day' | 'night' | null
          department_id: string | null
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['users']['Row'], 'created_at'>
        Update: Partial<Database['public']['Tables']['users']['Insert']>
      }
      departments: {
        Row: { id: string; name: string; created_at: string }
        Insert: Omit<Database['public']['Tables']['departments']['Row'], 'id' | 'created_at'>
        Update: Partial<Database['public']['Tables']['departments']['Insert']>
      }
      schedule_blocks: {
        Row: {
          id: string
          department_id: string
          shift_type: 'day' | 'night'
          start_date: string
          end_date: string
          status: 'preliminary_draft' | 'preliminary' | 'final' | 'active' | 'completed'
          copied_from_block_id: string | null
          availability_window_open: string | null
          availability_window_close: string | null
          published_by: string | null
          published_at: string | null
          created_by: string
          created_at: string
        }
        Insert: Omit<Database['public']['Tables']['schedule_blocks']['Row'], 'id' | 'created_at'>
        Update: Partial<Database['public']['Tables']['schedule_blocks']['Insert']>
      }
      shifts: {
        Row: {
          id: string
          schedule_block_id: string
          user_id: string
          shift_date: string
          cell_state: 'working' | 'cannot_work' | 'off' | 'fmla'
          lead_user_id: string | null
          is_cross_shift: boolean
          modified_after_publish: boolean
          created_at: string
          updated_at: string
        }
        Insert: Omit<Database['public']['Tables']['shifts']['Row'], 'id' | 'created_at' | 'updated_at'>
        Update: Partial<Database['public']['Tables']['shifts']['Insert']>
      }
      availability_submissions: {
        Row: {
          id: string
          schedule_block_id: string
          user_id: string
          submitted_at: string
          updated_at: string
        }
        Insert: Omit<Database['public']['Tables']['availability_submissions']['Row'], 'id' | 'submitted_at' | 'updated_at'>
        Update: Partial<Database['public']['Tables']['availability_submissions']['Insert']>
      }
      availability_entries: {
        Row: {
          id: string
          submission_id: string
          entry_date: string
          entry_type: 'cannot_work' | 'requesting_to_work' | 'available_day' | 'available_night' | 'available_either'
          note: string | null
        }
        Insert: Omit<Database['public']['Tables']['availability_entries']['Row'], 'id'>
        Update: Partial<Database['public']['Tables']['availability_entries']['Insert']>
      }
    }
    Views: {
      shift_planned_headcount: {
        Row: {
          schedule_block_id: string
          shift_date: string
          ft_count: number
          prn_count: number
          total_count: number
        }
      }
    }
    Functions: {
      copy_block: {
        Args: { source_block_id: string; new_block_id: string }
        Returns: void
      }
      get_constraint_diff: {
        Args: { p_new_block_id: string }
        Returns: Array<{
          user_id: string
          full_name: string
          shift_date: string
          prior_cell_state: string
          avail_entry_type: string
        }>
      }
    }
    Enums: Record<string, never>
  }
}
```

- [ ] **Step 1.2: Run existing tests to verify no regressions**

```bash
npm test
```
Expected: 14/14 PASS

- [ ] **Step 1.3: Write the failing Phase 2 types test**

```typescript
// tests/unit/phase2-types.test.ts
import { describe, it, expect } from 'vitest'
import type { Database } from '@/lib/types/database.types'

type AvailSub = Database['public']['Tables']['availability_submissions']['Row']
type AvailEntry = Database['public']['Tables']['availability_entries']['Row']

describe('Phase 2 database types', () => {
  it('availability_submissions has required fields', () => {
    const check: keyof AvailSub = 'schedule_block_id'
    expect(check).toBe('schedule_block_id')
  })

  it('availability_entries entry_type covers all 5 values', () => {
    const validTypes: Array<AvailEntry['entry_type']> = [
      'cannot_work',
      'requesting_to_work',
      'available_day',
      'available_night',
      'available_either',
    ]
    expect(validTypes).toHaveLength(5)
  })

  it('schedule_blocks has availability window fields', () => {
    type Block = Database['public']['Tables']['schedule_blocks']['Row']
    const check: keyof Block = 'availability_window_open'
    expect(check).toBe('availability_window_open')
  })
})
```

- [ ] **Step 1.4: Run new test to verify it fails**

```bash
npm test tests/unit/phase2-types.test.ts
```
Expected: FAIL (types not yet added) — after Step 1.1 is done it should pass.

- [ ] **Step 1.5: Run all tests to confirm 17/17 pass**

```bash
npm test
```
Expected: 17/17 PASS

- [ ] **Step 1.6: Create supabase/migrations/002_phase2_rpcs.sql**

```sql
-- supabase/migrations/002_phase2_rpcs.sql
-- Phase 2: Postgres RPCs for block copy and constraint diff

-- ============================================================
-- copy_block
-- Copies FT therapist shifts from source block to new block.
-- PRN rows are NOT copied (they start empty for manager to fill).
-- Lead assignments, cross-shift flags, and op codes never copy.
-- ============================================================
CREATE OR REPLACE FUNCTION copy_block(source_block_id uuid, new_block_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO shifts (
    schedule_block_id, user_id, shift_date,
    cell_state, lead_user_id, is_cross_shift, modified_after_publish
  )
  SELECT
    new_block_id,
    s.user_id,
    s.shift_date,
    s.cell_state,
    NULL,   -- lead cleared
    false,  -- cross-shift cleared
    false   -- modified_after_publish cleared
  FROM shifts s
  JOIN users u ON u.id = s.user_id
  WHERE s.schedule_block_id = source_block_id
    AND u.employment_type = 'full_time'
  ON CONFLICT (schedule_block_id, user_id, shift_date) DO NOTHING;
END;
$$;

-- ============================================================
-- get_constraint_diff
-- Returns FT therapists whose availability submission for
-- new_block_id has a 'cannot_work' entry on a date that was
-- 'working' in the source (copied-from) block.
-- Returns empty if the block was not copied from another.
-- ============================================================
CREATE OR REPLACE FUNCTION get_constraint_diff(p_new_block_id uuid)
RETURNS TABLE (
  user_id          uuid,
  full_name        text,
  shift_date       date,
  prior_cell_state text,
  avail_entry_type text
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_source_block_id uuid;
BEGIN
  SELECT copied_from_block_id INTO v_source_block_id
  FROM schedule_blocks
  WHERE id = p_new_block_id;

  IF v_source_block_id IS NULL THEN
    RETURN;  -- block was not copied; no diff
  END IF;

  RETURN QUERY
  SELECT
    u.id           AS user_id,
    u.full_name,
    s.shift_date,
    s.cell_state::text     AS prior_cell_state,
    ae.entry_type::text    AS avail_entry_type
  FROM shifts s
  JOIN users u ON u.id = s.user_id
  JOIN availability_submissions asub
    ON asub.user_id = s.user_id
    AND asub.schedule_block_id = p_new_block_id
  JOIN availability_entries ae
    ON ae.submission_id = asub.id
    AND ae.entry_date = s.shift_date
    AND ae.entry_type = 'cannot_work'
  WHERE s.schedule_block_id = v_source_block_id
    AND s.cell_state = 'working'
    AND u.employment_type = 'full_time'
  ORDER BY s.shift_date, u.full_name;
END;
$$;
```

- [ ] **Step 1.7: Apply migration in Supabase SQL Editor**

Open `supabase/migrations/002_phase2_rpcs.sql`, copy its contents, paste into:
`supabase.com/dashboard/project/jcvlmwsiiikifdvaufqz/sql/new`
Run it. Expected: "Success. No rows returned."

- [ ] **Step 1.8: Create server action stub files**

```typescript
// app/actions/schedule.ts
'use server'
// Server actions for schedule management. Populated in Tasks 2–4.
export {}
```

```typescript
// app/actions/availability.ts
'use server'
// Server actions for availability submission. Populated in Task 5.
export {}
```

- [ ] **Step 1.9: Commit**

```bash
git add lib/types/database.types.ts supabase/migrations/002_phase2_rpcs.sql \
  tests/unit/phase2-types.test.ts app/actions/schedule.ts app/actions/availability.ts
git commit -m "feat: phase 2 types, RPC migration, and server action stubs"
```

---

## Task 2: Block Picker and Schedule Page Refactor

The schedule page currently fetches the latest block. Phase 2 needs a block picker so the manager can switch between blocks. We use URL search params (`?blockId=xxx&shift=day`) so the server component controls data fetching.

**Files:**
- Create: `components/schedule/BlockPicker.tsx`
- Modify: `app/(app)/schedule/page.tsx`
- Create: `tests/unit/block-picker.test.ts`

- [ ] **Step 2.1: Write the failing test**

```typescript
// tests/unit/block-picker.test.ts
import { describe, it, expect } from 'vitest'

// Pure utility: format block label for the picker
function blockLabel(startDate: string, endDate: string, status: string): string {
  const start = new Date(startDate + 'T00:00:00')
  const end = new Date(endDate + 'T00:00:00')
  const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const statusLabel = status.replace(/_/g, ' ')
  return `${fmt(start)} – ${fmt(end)} (${statusLabel})`
}

describe('blockLabel', () => {
  it('formats dates and status', () => {
    expect(blockLabel('2026-03-01', '2026-04-11', 'preliminary_draft'))
      .toBe('Mar 1 – Apr 11 (preliminary draft)')
  })

  it('handles final status', () => {
    expect(blockLabel('2026-01-04', '2026-02-14', 'final'))
      .toBe('Jan 4 – Feb 14 (final)')
  })
})
```

- [ ] **Step 2.2: Run test to verify it fails**

```bash
npm test tests/unit/block-picker.test.ts
```
Expected: FAIL with "blockLabel is not defined"

- [ ] **Step 2.3: Create BlockPicker component**

```typescript
// components/schedule/BlockPicker.tsx
'use client'
import { useRouter, useSearchParams } from 'next/navigation'
import type { Database } from '@/lib/types/database.types'

type BlockRow = Database['public']['Tables']['schedule_blocks']['Row']

export function blockLabel(startDate: string, endDate: string, status: string): string {
  const start = new Date(startDate + 'T00:00:00')
  const end = new Date(endDate + 'T00:00:00')
  const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const statusLabel = status.replace(/_/g, ' ')
  return `${fmt(start)} – ${fmt(end)} (${statusLabel})`
}

interface Props {
  blocks: BlockRow[]
  currentBlockId: string
  currentShift: 'day' | 'night'
}

export function BlockPicker({ blocks, currentBlockId, currentShift }: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()

  function handleBlockChange(blockId: string) {
    const params = new URLSearchParams(searchParams.toString())
    params.set('blockId', blockId)
    router.push(`/schedule?${params.toString()}`)
  }

  function handleShiftChange(shift: 'day' | 'night') {
    const params = new URLSearchParams(searchParams.toString())
    params.set('shift', shift)
    // Find first block of this shift type
    const match = blocks.find(b => b.shift_type === shift)
    if (match) params.set('blockId', match.id)
    router.push(`/schedule?${params.toString()}`)
  }

  return (
    <div className="flex items-center gap-3 flex-wrap">
      {/* Shift toggle */}
      <div className="flex rounded-md border border-slate-200 overflow-hidden">
        {(['day', 'night'] as const).map(s => (
          <button
            key={s}
            onClick={() => handleShiftChange(s)}
            className={[
              'px-3 py-1.5 text-sm font-medium transition-colors',
              currentShift === s
                ? 'bg-slate-900 text-white'
                : 'bg-white text-slate-600 hover:bg-slate-50'
            ].join(' ')}
          >
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      {/* Block selector */}
      <select
        value={currentBlockId}
        onChange={e => handleBlockChange(e.target.value)}
        className="text-sm border border-slate-200 rounded-md px-2 py-1.5 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-400"
      >
        {blocks
          .filter(b => b.shift_type === currentShift)
          .map(b => (
            <option key={b.id} value={b.id}>
              {blockLabel(b.start_date, b.end_date, b.status)}
            </option>
          ))
        }
      </select>
    </div>
  )
}
```

- [ ] **Step 2.4: Run test — verify it passes**

Update the import in `tests/unit/block-picker.test.ts` to import from the component:

```typescript
// tests/unit/block-picker.test.ts
import { describe, it, expect } from 'vitest'
import { blockLabel } from '@/components/schedule/BlockPicker'

describe('blockLabel', () => {
  it('formats dates and status', () => {
    expect(blockLabel('2026-03-01', '2026-04-11', 'preliminary_draft'))
      .toBe('Mar 1 – Apr 11 (preliminary draft)')
  })

  it('handles final status', () => {
    expect(blockLabel('2026-01-04', '2026-02-14', 'final'))
      .toBe('Jan 4 – Feb 14 (final)')
  })
})
```

```bash
npm test tests/unit/block-picker.test.ts
```
Expected: 2/2 PASS

- [ ] **Step 2.5: Modify schedule/page.tsx to use URL params and block picker**

Replace the entire file:

```typescript
// app/(app)/schedule/page.tsx
import { redirect } from 'next/navigation'
import { getServerUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { ScheduleGrid } from '@/components/schedule/ScheduleGrid'
import { BlockPicker } from '@/components/schedule/BlockPicker'
import Link from 'next/link'
import type { Database } from '@/lib/types/database.types'

type UserRow = Database['public']['Tables']['users']['Row']
type BlockRow = Database['public']['Tables']['schedule_blocks']['Row']
type ShiftRow = Database['public']['Tables']['shifts']['Row']

interface PageProps {
  searchParams: { blockId?: string; shift?: string }
}

export default async function SchedulePage({ searchParams }: PageProps) {
  const user = await getServerUser()
  if (!user) redirect('/login')

  const supabase = createClient()

  const { data: profileData } = await supabase
    .from('users')
    .select('*')
    .eq('id', user.id)
    .single()

  const profile = profileData as UserRow | null
  if (!profile) redirect('/login')

  if (!profile.department_id) {
    return (
      <div className="text-slate-500 text-sm p-8">
        Your account is not assigned to a department. Contact your manager.
      </div>
    )
  }

  // Fetch all blocks for the department (all statuses, both shifts)
  const { data: allBlocksData } = await supabase
    .from('schedule_blocks')
    .select('*')
    .eq('department_id', profile.department_id)
    .in('status', ['preliminary_draft', 'preliminary', 'final', 'active', 'completed'])
    .order('start_date', { ascending: false })

  const allBlocks = (allBlocksData ?? []) as BlockRow[]

  // Determine active shift type
  const requestedShift = searchParams.shift as 'day' | 'night' | undefined
  const activeShift: 'day' | 'night' =
    requestedShift === 'day' || requestedShift === 'night'
      ? requestedShift
      : (profile.default_shift_type ?? 'day')

  // Determine active block
  const blocksForShift = allBlocks.filter(b => b.shift_type === activeShift)
  let block: BlockRow | null = null

  if (searchParams.blockId) {
    block = blocksForShift.find(b => b.id === searchParams.blockId) ?? null
  }
  if (!block) {
    block = blocksForShift[0] ?? null  // most recent
  }

  if (!block) {
    return (
      <div className="flex flex-col gap-4 p-8">
        {allBlocks.length === 0 && profile.role === 'manager' && (
          <Link
            href="/schedule/new"
            className="inline-flex items-center gap-2 px-4 py-2 bg-slate-900 text-white text-sm rounded-md hover:bg-slate-800 w-fit"
          >
            + Create First Block
          </Link>
        )}
        <p className="text-slate-500 text-sm">No schedule found for {activeShift} shift.</p>
      </div>
    )
  }

  const { data: shiftsData } = await supabase
    .from('shifts')
    .select('*')
    .eq('schedule_block_id', block.id)

  const { data: therapistsData } = await supabase
    .from('users')
    .select('*')
    .eq('department_id', profile.department_id)
    .eq('role', 'therapist')
    .order('employment_type', { ascending: true })
    .order('full_name', { ascending: true })

  const shifts = (shiftsData ?? []) as ShiftRow[]
  const therapists = (therapistsData ?? []) as UserRow[]

  return (
    <div className="flex flex-col gap-3">
      {/* Top controls */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <BlockPicker
          blocks={allBlocks}
          currentBlockId={block.id}
          currentShift={activeShift}
        />
        {profile.role === 'manager' && (
          <Link
            href="/schedule/new"
            className="inline-flex items-center px-3 py-1.5 bg-slate-900 text-white text-sm rounded-md hover:bg-slate-800"
          >
            + New Block
          </Link>
        )}
      </div>

      <ScheduleGrid
        block={block}
        shifts={shifts}
        therapists={therapists}
        defaultShiftType={activeShift}
        userRole={profile.role}
      />
    </div>
  )
}
```

- [ ] **Step 2.6: Run all tests**

```bash
npm test
```
Expected: 18/18 PASS (TS may warn about `userRole` prop not existing yet on ScheduleGrid — fix in Task 7)

- [ ] **Step 2.7: Commit**

```bash
git add components/schedule/BlockPicker.tsx app/(app)/schedule/page.tsx \
  tests/unit/block-picker.test.ts
git commit -m "feat: block picker with URL-based shift/block selection"
```

---

## Task 3: New Block Creation and Copy-from-Prior-Block

**Files:**
- Modify: `app/actions/schedule.ts`
- Create: `app/(app)/schedule/new/page.tsx`
- Create: `components/schedule/BlockCreateForm.tsx`
- Create: `tests/unit/block-create.test.ts`

- [ ] **Step 3.1: Write the failing test**

```typescript
// tests/unit/block-create.test.ts
import { describe, it, expect } from 'vitest'
import { addDays, format, getDay } from 'date-fns'

// Pure utility: given a start date string, compute end date (start + 41 days)
function computeEndDate(startDate: string): string {
  const start = new Date(startDate + 'T00:00:00')
  return format(addDays(start, 41), 'yyyy-MM-dd')
}

// Pure utility: check if a date string is a Sunday
function isSunday(dateStr: string): boolean {
  return getDay(new Date(dateStr + 'T00:00:00')) === 0
}

describe('block date utilities', () => {
  it('computes end date as start + 41 days', () => {
    expect(computeEndDate('2026-03-01')).toBe('2026-04-11')
  })

  it('2026-03-01 is a Sunday', () => {
    expect(isSunday('2026-03-01')).toBe(true)
  })

  it('2026-03-02 is not a Sunday', () => {
    expect(isSunday('2026-03-02')).toBe(false)
  })
})
```

- [ ] **Step 3.2: Run test to verify it fails**

```bash
npm test tests/unit/block-create.test.ts
```
Expected: FAIL

- [ ] **Step 3.3: Create the server action (createBlock + copyBlock)**

Replace `app/actions/schedule.ts`:

```typescript
// app/actions/schedule.ts
'use server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getServerUser } from '@/lib/auth'
import { addDays, format } from 'date-fns'

/** Create a new schedule block. Optionally copies FT shifts from the most recent prior block. */
export async function createBlock(formData: FormData) {
  const user = await getServerUser()
  if (!user) throw new Error('Not authenticated')

  const supabase = createClient()

  // Verify manager role
  const { data: profile } = await supabase
    .from('users')
    .select('role, department_id')
    .eq('id', user.id)
    .single()
  if (!profile || profile.role !== 'manager') throw new Error('Manager access required')
  if (!profile.department_id) throw new Error('No department assigned')

  const shiftType = formData.get('shift_type') as 'day' | 'night'
  const startDate = formData.get('start_date') as string
  const copyPrior = formData.get('copy_prior') === 'true'

  const endDate = format(addDays(new Date(startDate + 'T00:00:00'), 41), 'yyyy-MM-dd')

  // Find most recent prior block of same shift type (for copy)
  let copiedFromBlockId: string | null = null
  if (copyPrior) {
    const { data: priorBlock } = await supabase
      .from('schedule_blocks')
      .select('id')
      .eq('department_id', profile.department_id)
      .eq('shift_type', shiftType)
      .in('status', ['final', 'active', 'completed', 'preliminary_draft', 'preliminary'])
      .order('start_date', { ascending: false })
      .limit(1)
      .single()
    if (priorBlock) copiedFromBlockId = priorBlock.id
  }

  // Create the new block
  const { data: newBlock, error: blockErr } = await supabase
    .from('schedule_blocks')
    .insert({
      department_id: profile.department_id,
      shift_type: shiftType,
      start_date: startDate,
      end_date: endDate,
      status: 'preliminary_draft',
      copied_from_block_id: copiedFromBlockId,
      created_by: user.id,
    })
    .select('id')
    .single()

  if (blockErr || !newBlock) throw new Error(`Failed to create block: ${blockErr?.message}`)

  // Call copy_block RPC if copying
  if (copiedFromBlockId) {
    const { error: copyErr } = await supabase.rpc('copy_block', {
      source_block_id: copiedFromBlockId,
      new_block_id: newBlock.id,
    })
    if (copyErr) throw new Error(`Failed to copy block: ${copyErr.message}`)
  }

  revalidatePath('/schedule')
  redirect(`/schedule?blockId=${newBlock.id}&shift=${shiftType}`)
}

/** Update a single cell's state. Manager only. */
export async function updateCellState(
  shiftId: string,
  newState: 'working' | 'cannot_work' | 'off' | 'fmla'
): Promise<{ error?: string }> {
  const user = await getServerUser()
  if (!user) return { error: 'Not authenticated' }

  const supabase = createClient()

  const { data: profile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single()
  if (!profile || profile.role !== 'manager') return { error: 'Manager access required' }

  const { error } = await supabase
    .from('shifts')
    .update({ cell_state: newState })
    .eq('id', shiftId)

  if (error) return { error: error.message }

  revalidatePath('/schedule')
  return {}
}

/** Open the availability window for a block. Manager only.
 *  Returns an error if a window has already been set on this block (prevents accidental reopen).
 */
export async function openAvailabilityWindow(
  blockId: string,
  closesAt: string  // ISO timestamp string
): Promise<{ error?: string }> {
  const user = await getServerUser()
  if (!user) return { error: 'Not authenticated' }

  const supabase = createClient()

  const { data: profile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single()
  if (!profile || profile.role !== 'manager') return { error: 'Manager access required' }

  // Guard: prevent reopening a window that has already been set
  const { data: block } = await supabase
    .from('schedule_blocks')
    .select('availability_window_open')
    .eq('id', blockId)
    .single()
  if (block?.availability_window_open) {
    return { error: 'Availability window has already been opened for this block' }
  }

  const { error } = await supabase
    .from('schedule_blocks')
    .update({
      availability_window_open: new Date().toISOString(),
      availability_window_close: closesAt,
    })
    .eq('id', blockId)

  if (error) return { error: error.message }

  revalidatePath('/schedule')
  return {}
}
```

- [ ] **Step 3.4: Create the new block page**

```typescript
// app/(app)/schedule/new/page.tsx
import { redirect } from 'next/navigation'
import { getServerUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { BlockCreateForm } from '@/components/schedule/BlockCreateForm'
import type { Database } from '@/lib/types/database.types'

type UserRow = Database['public']['Tables']['users']['Row']

export default async function NewBlockPage() {
  const user = await getServerUser()
  if (!user) redirect('/login')

  const supabase = createClient()
  const { data: profileData } = await supabase
    .from('users')
    .select('role, department_id')
    .eq('id', user.id)
    .single()
  const profile = profileData as Pick<UserRow, 'role' | 'department_id'> | null

  if (!profile || profile.role !== 'manager') redirect('/schedule')

  return (
    <div className="max-w-lg mx-auto p-8">
      <h1 className="text-xl font-semibold text-slate-900 mb-6">Create New Block</h1>
      <BlockCreateForm />
    </div>
  )
}
```

- [ ] **Step 3.5: Create BlockCreateForm component**

```typescript
// components/schedule/BlockCreateForm.tsx
'use client'
import { useState, useTransition } from 'react'
import { createBlock } from '@/app/actions/schedule'
import { format, addDays, nextSunday, isSunday } from 'date-fns'

function getNextSunday(): string {
  const today = new Date()
  const candidate = isSunday(today) ? today : nextSunday(today)
  return format(candidate, 'yyyy-MM-dd')
}

// Exported for testing
export function computeEndDate(startDate: string): string {
  return format(addDays(new Date(startDate + 'T00:00:00'), 41), 'yyyy-MM-dd')
}

export function isStartDateSunday(dateStr: string): boolean {
  return getDay(new Date(dateStr + 'T00:00:00')) === 0
}

export function BlockCreateForm() {
  const [startDate, setStartDate] = useState(getNextSunday())
  const [shiftType, setShiftType] = useState<'day' | 'night'>('day')
  const [copyPrior, setCopyPrior] = useState(true)
  const [isPending, startTransition] = useTransition()

  const endDate = computeEndDate(startDate)

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    startTransition(async () => {
      await createBlock(formData)
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Shift type */}
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Shift Type</label>
        <div className="flex gap-3">
          {(['day', 'night'] as const).map(s => (
            <label key={s} className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="shift_type"
                value={s}
                checked={shiftType === s}
                onChange={() => setShiftType(s)}
                className="accent-slate-900"
              />
              <span className="text-sm capitalize">{s}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Start date */}
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1">
          Start Date <span className="text-slate-400 font-normal">(must be a Sunday)</span>
        </label>
        <input
          type="date"
          name="start_date"
          value={startDate}
          onChange={e => setStartDate(e.target.value)}
          className="w-full border border-slate-200 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
          required
        />
        {endDate && (
          <p className="mt-1 text-xs text-slate-500">
            End date: {format(new Date(endDate + 'T00:00:00'), 'MMMM d, yyyy')} (42 days)
          </p>
        )}
      </div>

      {/* Copy from prior */}
      <div>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            name="copy_prior"
            value="true"
            checked={copyPrior}
            onChange={e => setCopyPrior(e.target.checked)}
            className="accent-slate-900"
          />
          <span className="text-sm text-slate-700">Copy FT schedule from prior block</span>
        </label>
        <p className="mt-1 text-xs text-slate-400 ml-6">
          PRN rows will be empty. Operational codes are never copied.
        </p>
      </div>

      <button
        type="submit"
        disabled={isPending}
        className="w-full py-2 bg-slate-900 text-white text-sm font-medium rounded-md hover:bg-slate-800 disabled:opacity-50"
      >
        {isPending ? 'Creating...' : 'Create Block'}
      </button>
    </form>
  )
}
```

- [ ] **Step 3.6: Run all tests**

```bash
npm test
```
Expected: 19/19 PASS (the new block-create test should now pass since `date-fns` is installed)

Wait — the test file uses `addDays` and `format` from `date-fns` but doesn't import from the component. Update the test to import from the form:

```typescript
// tests/unit/block-create.test.ts
import { describe, it, expect } from 'vitest'
import { computeEndDate, isStartDateSunday } from '@/components/schedule/BlockCreateForm'

describe('block date utilities', () => {
  it('computes end date as start + 41 days', () => {
    expect(computeEndDate('2026-03-01')).toBe('2026-04-11')
  })

  it('2026-03-01 is a Sunday', () => {
    expect(isStartDateSunday('2026-03-01')).toBe(true)
  })

  it('2026-03-02 is not a Sunday', () => {
    expect(isStartDateSunday('2026-03-02')).toBe(false)
  })
})
```

```bash
npm test
```
Expected: All PASS

- [ ] **Step 3.7: Commit**

```bash
git add app/actions/schedule.ts app/(app)/schedule/new/page.tsx \
  components/schedule/BlockCreateForm.tsx tests/unit/block-create.test.ts
git commit -m "feat: new block creation with copy-from-prior-block RPC"
```

---

## Task 4: Availability Window Management (Manager)

Manager needs to open an availability window on a block and see a submission tracker.

**Files:**
- Create: `components/schedule/AvailabilityWindowControl.tsx`
- Create: `components/availability/SubmissionTracker.tsx`
- Modify: `app/(app)/schedule/page.tsx` (add window control + tracker for managers)

- [ ] **Step 4.1: Write a failing test**

```typescript
// tests/unit/availability-window.test.ts
import { describe, it, expect } from 'vitest'

// Pure utility: check if availability window is currently open
function isWindowOpen(
  windowOpen: string | null,
  windowClose: string | null
): boolean {
  if (!windowOpen || !windowClose) return false
  const now = Date.now()
  return now >= new Date(windowOpen).getTime() && now <= new Date(windowClose).getTime()
}

describe('isWindowOpen', () => {
  it('returns false when no window set', () => {
    expect(isWindowOpen(null, null)).toBe(false)
  })

  it('returns true when current time is within window', () => {
    const open = new Date(Date.now() - 1000).toISOString()   // 1 second ago
    const close = new Date(Date.now() + 60000).toISOString() // 1 minute from now
    expect(isWindowOpen(open, close)).toBe(true)
  })

  it('returns false when window has closed', () => {
    const open = new Date(Date.now() - 60000).toISOString()
    const close = new Date(Date.now() - 1000).toISOString()
    expect(isWindowOpen(open, close)).toBe(false)
  })
})
```

- [ ] **Step 4.2: Run test to verify it fails**

```bash
npm test tests/unit/availability-window.test.ts
```
Expected: FAIL

- [ ] **Step 4.3: Create AvailabilityWindowControl component**

```typescript
// components/schedule/AvailabilityWindowControl.tsx
'use client'
import { useState, useTransition } from 'react'
import { openAvailabilityWindow } from '@/app/actions/schedule'
import { format, addDays } from 'date-fns'
import type { Database } from '@/lib/types/database.types'

type BlockRow = Database['public']['Tables']['schedule_blocks']['Row']

export function isWindowOpen(
  windowOpen: string | null,
  windowClose: string | null
): boolean {
  if (!windowOpen || !windowClose) return false
  const now = Date.now()
  return now >= new Date(windowOpen).getTime() && now <= new Date(windowClose).getTime()
}

interface Props {
  block: BlockRow
}

export function AvailabilityWindowControl({ block }: Props) {
  // Default deadline: 1 week from today
  const defaultDeadline = format(addDays(new Date(), 7), "yyyy-MM-dd'T'HH:mm")
  const [deadline, setDeadline] = useState(defaultDeadline)
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const windowOpen = isWindowOpen(block.availability_window_open, block.availability_window_close)

  function handleOpen(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    startTransition(async () => {
      const result = await openAvailabilityWindow(block.id, new Date(deadline).toISOString())
      if (result.error) setError(result.error)
    })
  }

  return (
    <div className="border border-slate-200 rounded-lg p-4 bg-white space-y-3">
      <h3 className="text-sm font-semibold text-slate-700">Availability Window</h3>

      {windowOpen ? (
        <div className="space-y-1">
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-green-700 bg-green-50 border border-green-200 rounded-full px-2.5 py-0.5">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
            Open
          </span>
          <p className="text-xs text-slate-500">
            Closes: {block.availability_window_close
              ? new Date(block.availability_window_close).toLocaleString()
              : '—'}
          </p>
        </div>
      ) : block.availability_window_close ? (
        <p className="text-xs text-slate-500">
          Window closed: {new Date(block.availability_window_close).toLocaleString()}
        </p>
      ) : (
        <form onSubmit={handleOpen} className="flex items-end gap-2">
          <div className="flex-1">
            <label className="block text-xs text-slate-600 mb-1">Submission deadline</label>
            <input
              type="datetime-local"
              value={deadline}
              onChange={e => setDeadline(e.target.value)}
              className="w-full border border-slate-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400"
              required
            />
          </div>
          <button
            type="submit"
            disabled={isPending}
            className="px-3 py-1 bg-slate-900 text-white text-xs rounded hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap"
          >
            {isPending ? 'Opening...' : 'Open Window'}
          </button>
        </form>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  )
}
```

- [ ] **Step 4.4: Create SubmissionTracker component**

```typescript
// components/availability/SubmissionTracker.tsx
import type { Database } from '@/lib/types/database.types'

type UserRow = Database['public']['Tables']['users']['Row']
type SubmissionRow = Database['public']['Tables']['availability_submissions']['Row']

interface Props {
  therapists: UserRow[]
  submissions: SubmissionRow[]
}

export function SubmissionTracker({ therapists, submissions }: Props) {
  const submittedIds = new Set(submissions.map(s => s.user_id))

  const submitted = therapists.filter(t => submittedIds.has(t.id))
  const notSubmitted = therapists.filter(t => !submittedIds.has(t.id))

  return (
    <div className="border border-slate-200 rounded-lg p-4 bg-white space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-700">Availability Submissions</h3>
        <span className="text-xs text-slate-500">
          {submitted.length} / {therapists.length}
        </span>
      </div>

      {notSubmitted.length > 0 && (
        <div>
          <p className="text-xs font-medium text-red-600 mb-1">Not yet submitted</p>
          <ul className="space-y-0.5">
            {notSubmitted.map(t => (
              <li key={t.id} className="text-xs text-slate-600">
                {t.full_name}{' '}
                <span className="text-slate-400 capitalize">
                  ({t.employment_type.replace('_', '-')})
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {submitted.length > 0 && (
        <div>
          <p className="text-xs font-medium text-green-600 mb-1">Submitted</p>
          <ul className="space-y-0.5">
            {submitted.map(t => (
              <li key={t.id} className="text-xs text-slate-500">{t.full_name}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4.5: Update the availability-window test to import the utility**

```typescript
// tests/unit/availability-window.test.ts
import { describe, it, expect } from 'vitest'
import { isWindowOpen } from '@/components/schedule/AvailabilityWindowControl'

describe('isWindowOpen', () => {
  it('returns false when no window set', () => {
    expect(isWindowOpen(null, null)).toBe(false)
  })

  it('returns true when current time is within window', () => {
    const open = new Date(Date.now() - 1000).toISOString()
    const close = new Date(Date.now() + 60000).toISOString()
    expect(isWindowOpen(open, close)).toBe(true)
  })

  it('returns false when window has closed', () => {
    const open = new Date(Date.now() - 60000).toISOString()
    const close = new Date(Date.now() - 1000).toISOString()
    expect(isWindowOpen(open, close)).toBe(false)
  })
})
```

- [ ] **Step 4.6: Add window control and tracker to schedule page**

In `app/(app)/schedule/page.tsx`, after the `ScheduleGrid` return block, fetch submissions and add the manager panel. Add these imports at the top of the file:

```typescript
import { AvailabilityWindowControl } from '@/components/schedule/AvailabilityWindowControl'
import { SubmissionTracker } from '@/components/availability/SubmissionTracker'
import type { Database } from '@/lib/types/database.types'
type SubmissionRow = Database['public']['Tables']['availability_submissions']['Row']
```

Then in the body, before the return, add:

```typescript
  // Fetch availability submissions for current block (manager view)
  let submissions: SubmissionRow[] = []
  if (profile.role === 'manager') {
    const { data: subData } = await supabase
      .from('availability_submissions')
      .select('*')
      .eq('schedule_block_id', block.id)
    submissions = (subData ?? []) as SubmissionRow[]
  }
```

And update the return JSX to show the manager panel below the grid:

```tsx
      {/* Manager availability panel */}
      {profile.role === 'manager' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2">
          <AvailabilityWindowControl block={block} />
          <SubmissionTracker therapists={therapists} submissions={submissions} />
        </div>
      )}
```

- [ ] **Step 4.7: Run all tests**

```bash
npm test
```
Expected: All PASS (21+ tests)

- [ ] **Step 4.8: Commit**

```bash
git add components/schedule/AvailabilityWindowControl.tsx \
  components/availability/SubmissionTracker.tsx \
  tests/unit/availability-window.test.ts \
  app/(app)/schedule/page.tsx
git commit -m "feat: availability window management and submission tracker"
```

---

## Task 5: Availability Submission (FT and PRN)

Therapists see a 42-day calendar and mark their availability. FT marks Cannot Work / Requesting to Work. PRN marks Available (Day/Night/Either). One batch upsert per submit.

**Files:**
- Modify: `app/actions/availability.ts`
- Create: `app/(app)/availability/page.tsx`
- Create: `app/(app)/availability/[blockId]/page.tsx`
- Create: `components/availability/AvailabilityCalendar.tsx`
- Create: `tests/unit/availability-calendar.test.ts`

- [ ] **Step 5.1: Write the failing test**

```typescript
// tests/unit/availability-calendar.test.ts
import { describe, it, expect } from 'vitest'

type EntryType = 'cannot_work' | 'requesting_to_work' | 'available_day' | 'available_night' | 'available_either'

// Pure utility: get available options for a therapist type
function getEntryOptions(employmentType: 'full_time' | 'prn'): Array<{ value: EntryType; label: string }> {
  if (employmentType === 'full_time') {
    return [
      { value: 'cannot_work', label: 'Cannot Work' },
      { value: 'requesting_to_work', label: 'Requesting to Work' },
    ]
  }
  return [
    { value: 'available_day', label: 'Day' },
    { value: 'available_night', label: 'Night' },
    { value: 'available_either', label: 'Either' },
  ]
}

describe('getEntryOptions', () => {
  it('FT gets cannot_work and requesting_to_work', () => {
    const opts = getEntryOptions('full_time')
    expect(opts.map(o => o.value)).toEqual(['cannot_work', 'requesting_to_work'])
  })

  it('PRN gets day/night/either', () => {
    const opts = getEntryOptions('prn')
    expect(opts.map(o => o.value)).toEqual(['available_day', 'available_night', 'available_either'])
  })
})
```

- [ ] **Step 5.2: Run test to verify it fails**

```bash
npm test tests/unit/availability-calendar.test.ts
```
Expected: FAIL

- [ ] **Step 5.3: Create the submitAvailability server action**

Replace `app/actions/availability.ts`:

```typescript
// app/actions/availability.ts
'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getServerUser } from '@/lib/auth'

export type EntryInput = {
  entry_date: string
  entry_type: 'cannot_work' | 'requesting_to_work' | 'available_day' | 'available_night' | 'available_either'
  note?: string
}

/** Upsert availability submission for a block. Replaces all prior entries. */
export async function submitAvailability(
  blockId: string,
  entries: EntryInput[]
): Promise<{ error?: string }> {
  const user = await getServerUser()
  if (!user) return { error: 'Not authenticated' }

  const supabase = createClient()

  // Verify window is open (server-side check)
  const { data: block } = await supabase
    .from('schedule_blocks')
    .select('availability_window_open, availability_window_close')
    .eq('id', blockId)
    .single()

  if (!block) return { error: 'Block not found' }

  const now = Date.now()
  const windowOpen = block.availability_window_open
    ? new Date(block.availability_window_open).getTime()
    : null
  const windowClose = block.availability_window_close
    ? new Date(block.availability_window_close).getTime()
    : null

  if (!windowOpen || !windowClose || now < windowOpen || now > windowClose) {
    return { error: 'Availability window is not open' }
  }

  // Upsert the submission record
  const { data: submission, error: subErr } = await supabase
    .from('availability_submissions')
    .upsert(
      { schedule_block_id: blockId, user_id: user.id },
      { onConflict: 'schedule_block_id,user_id' }
    )
    .select('id')
    .single()

  if (subErr || !submission) return { error: subErr?.message ?? 'Submission failed' }

  // Delete all existing entries for this submission, then insert fresh
  await supabase
    .from('availability_entries')
    .delete()
    .eq('submission_id', submission.id)

  if (entries.length > 0) {
    const rows = entries.map(e => ({
      submission_id: submission.id,
      entry_date: e.entry_date,
      entry_type: e.entry_type,
      note: e.note ?? null,
    }))

    const { error: entriesErr } = await supabase
      .from('availability_entries')
      .insert(rows)

    if (entriesErr) return { error: entriesErr.message }
  }

  revalidatePath('/availability')
  return {}
}
```

- [ ] **Step 5.4: Create AvailabilityCalendar component**

```typescript
// components/availability/AvailabilityCalendar.tsx
'use client'
import { useState, useTransition } from 'react'
import { format, addDays } from 'date-fns'
import { submitAvailability, type EntryInput } from '@/app/actions/availability'

type EntryType = EntryInput['entry_type']

function getEntryOptions(employmentType: 'full_time' | 'prn'): Array<{ value: EntryType; label: string }> {
  if (employmentType === 'full_time') {
    return [
      { value: 'cannot_work', label: 'Cannot Work' },
      { value: 'requesting_to_work', label: 'Requesting' },
    ]
  }
  return [
    { value: 'available_day', label: 'Day' },
    { value: 'available_night', label: 'Night' },
    { value: 'available_either', label: 'Either' },
  ]
}

export { getEntryOptions }

interface Props {
  blockId: string
  startDate: string          // yyyy-MM-dd
  employmentType: 'full_time' | 'prn'
  existing: Record<string, EntryType>  // date → entry_type (pre-filled from DB)
  windowClosed: boolean
}

export function AvailabilityCalendar({ blockId, startDate, employmentType, existing, windowClosed }: Props) {
  const options = getEntryOptions(employmentType)
  const dates = Array.from({ length: 42 }, (_, i) =>
    format(addDays(new Date(startDate + 'T00:00:00'), i), 'yyyy-MM-dd')
  )

  const [selections, setSelections] = useState<Record<string, EntryType>>(existing)
  const [isPending, startTransition] = useTransition()
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function toggle(date: string, value: EntryType) {
    setSelections(prev => {
      const next = { ...prev }
      if (next[date] === value) {
        delete next[date]  // deselect
      } else {
        next[date] = value
      }
      return next
    })
    setSaved(false)
  }

  function handleSubmit() {
    setError(null)
    const entries: EntryInput[] = Object.entries(selections).map(([date, type]) => ({
      entry_date: date,
      entry_type: type,
    }))
    startTransition(async () => {
      const result = await submitAvailability(blockId, entries)
      if (result.error) {
        setError(result.error)
      } else {
        setSaved(true)
      }
    })
  }

  // Group dates into 6 weeks
  const weeks = Array.from({ length: 6 }, (_, i) => dates.slice(i * 7, i * 7 + 7))

  const cellBase = 'w-full text-xs py-1 rounded transition-colors border text-center'
  const cellSelected = 'bg-slate-900 text-white border-slate-900'
  const cellUnselected = 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'
  const cellDisabled = 'bg-slate-50 text-slate-300 border-slate-100 cursor-not-allowed'

  return (
    <div className="space-y-4">
      {windowClosed && (
        <div className="p-3 bg-amber-50 border border-amber-200 rounded text-sm text-amber-700">
          The availability window is closed. Your submission is read-only.
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className="text-left text-xs font-medium text-slate-500 pb-2 pr-3 w-20">Option</th>
              {weeks.map((week, wi) => (
                <th key={wi} colSpan={7} className="text-center text-xs text-slate-500 pb-1 border-l border-slate-100 px-1">
                  {format(new Date(week[0] + 'T00:00:00'), 'MMM d')} –{' '}
                  {format(new Date(week[6] + 'T00:00:00'), 'MMM d')}
                </th>
              ))}
            </tr>
            <tr>
              <th />
              {dates.map(d => (
                <th key={d} className="text-center text-[10px] text-slate-400 pb-1 w-9">
                  {format(new Date(d + 'T00:00:00'), 'EEEEE')}
                </th>
              ))}
            </tr>
            <tr>
              <th />
              {dates.map(d => (
                <th key={d} className="text-center text-[10px] text-slate-400 pb-2">
                  {format(new Date(d + 'T00:00:00'), 'd')}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {options.map(opt => (
              <tr key={opt.value}>
                <td className="text-xs font-medium text-slate-600 pr-3 py-0.5 whitespace-nowrap">
                  {opt.label}
                </td>
                {dates.map(date => {
                  const isSelected = selections[date] === opt.value
                  const disabled = windowClosed
                  return (
                    <td key={date} className="px-0.5 py-0.5">
                      <button
                        onClick={() => !disabled && toggle(date, opt.value)}
                        disabled={disabled}
                        className={[
                          cellBase,
                          disabled ? cellDisabled : isSelected ? cellSelected : cellUnselected
                        ].join(' ')}
                        aria-pressed={isSelected}
                        aria-label={`${opt.label} on ${date}`}
                      >
                        {isSelected ? '✓' : ''}
                      </button>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!windowClosed && (
        <div className="flex items-center gap-3">
          <button
            onClick={handleSubmit}
            disabled={isPending}
            className="px-4 py-2 bg-slate-900 text-white text-sm rounded-md hover:bg-slate-800 disabled:opacity-50"
          >
            {isPending ? 'Saving...' : 'Submit Availability'}
          </button>
          {saved && <span className="text-sm text-green-600">Saved ✓</span>}
          {error && <span className="text-sm text-red-600">{error}</span>}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 5.5: Update the test to import from the component**

```typescript
// tests/unit/availability-calendar.test.ts
import { describe, it, expect } from 'vitest'
import { getEntryOptions } from '@/components/availability/AvailabilityCalendar'

describe('getEntryOptions', () => {
  it('FT gets cannot_work and requesting_to_work', () => {
    const opts = getEntryOptions('full_time')
    expect(opts.map(o => o.value)).toEqual(['cannot_work', 'requesting_to_work'])
  })

  it('PRN gets day/night/either', () => {
    const opts = getEntryOptions('prn')
    expect(opts.map(o => o.value)).toEqual(['available_day', 'available_night', 'available_either'])
  })
})
```

- [ ] **Step 5.6: Create the availability listing page**

```typescript
// app/(app)/availability/page.tsx
import { redirect } from 'next/navigation'
import { getServerUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { format } from 'date-fns'
import type { Database } from '@/lib/types/database.types'

type BlockRow = Database['public']['Tables']['schedule_blocks']['Row']
type UserRow = Database['public']['Tables']['users']['Row']

export default async function AvailabilityPage() {
  const user = await getServerUser()
  if (!user) redirect('/login')

  const supabase = createClient()

  const { data: profileData } = await supabase
    .from('users')
    .select('*')
    .eq('id', user.id)
    .single()
  const profile = profileData as UserRow | null
  if (!profile) redirect('/login')
  if (!profile.department_id) {
    return <p className="p-8 text-slate-500 text-sm">Not assigned to a department.</p>
  }

  // Fetch blocks with open availability windows
  const { data: blocksData } = await supabase
    .from('schedule_blocks')
    .select('*')
    .eq('department_id', profile.department_id)
    .not('availability_window_open', 'is', null)
    .order('start_date', { ascending: false })

  const blocks = (blocksData ?? []) as BlockRow[]
  const now = new Date()

  const openBlocks = blocks.filter(b =>
    b.availability_window_close && new Date(b.availability_window_close) > now
  )
  const closedBlocks = blocks.filter(b =>
    b.availability_window_close && new Date(b.availability_window_close) <= now
  )

  return (
    <div className="max-w-2xl mx-auto p-8 space-y-6">
      <h1 className="text-xl font-semibold text-slate-900">Availability Submission</h1>

      {openBlocks.length === 0 && closedBlocks.length === 0 && (
        <p className="text-slate-500 text-sm">No availability windows open at this time.</p>
      )}

      {openBlocks.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-slate-700 mb-3">Open Windows</h2>
          <ul className="space-y-2">
            {openBlocks.map(b => (
              <li key={b.id}>
                <Link
                  href={`/availability/${b.id}`}
                  className="flex items-center justify-between p-4 border border-slate-200 rounded-lg hover:border-slate-400 bg-white"
                >
                  <div>
                    <p className="text-sm font-medium text-slate-800 capitalize">
                      {b.shift_type} Shift —{' '}
                      {format(new Date(b.start_date + 'T00:00:00'), 'MMM d')} to{' '}
                      {format(new Date(b.end_date + 'T00:00:00'), 'MMM d, yyyy')}
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Deadline: {b.availability_window_close
                        ? new Date(b.availability_window_close).toLocaleString()
                        : '—'}
                    </p>
                  </div>
                  <span className="text-xs font-medium text-green-700 bg-green-50 border border-green-200 rounded-full px-2.5 py-0.5">
                    Open →
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {closedBlocks.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-slate-500 mb-3">Past Windows</h2>
          <ul className="space-y-2">
            {closedBlocks.map(b => (
              <li key={b.id}>
                <Link
                  href={`/availability/${b.id}`}
                  className="flex items-center justify-between p-4 border border-slate-100 rounded-lg bg-slate-50 hover:bg-white"
                >
                  <p className="text-sm text-slate-500 capitalize">
                    {b.shift_type} Shift —{' '}
                    {format(new Date(b.start_date + 'T00:00:00'), 'MMM d')} to{' '}
                    {format(new Date(b.end_date + 'T00:00:00'), 'MMM d, yyyy')}
                  </p>
                  <span className="text-xs text-slate-400">View →</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
```

- [ ] **Step 5.7: Create the availability submission page (the 42-day calendar)**

```typescript
// app/(app)/availability/[blockId]/page.tsx
import { redirect } from 'next/navigation'
import { getServerUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { AvailabilityCalendar } from '@/components/availability/AvailabilityCalendar'
import { format } from 'date-fns'
import type { Database } from '@/lib/types/database.types'

type UserRow = Database['public']['Tables']['users']['Row']
type BlockRow = Database['public']['Tables']['schedule_blocks']['Row']
type EntryType = Database['public']['Tables']['availability_entries']['Row']['entry_type']

interface PageProps {
  params: { blockId: string }
}

export default async function AvailabilitySubmitPage({ params }: PageProps) {
  const user = await getServerUser()
  if (!user) redirect('/login')

  const supabase = createClient()

  const { data: profileData } = await supabase
    .from('users')
    .select('*')
    .eq('id', user.id)
    .single()
  const profile = profileData as UserRow | null
  if (!profile) redirect('/login')

  const { data: blockData } = await supabase
    .from('schedule_blocks')
    .select('*')
    .eq('id', params.blockId)
    .single()
  const block = blockData as BlockRow | null
  if (!block) redirect('/availability')

  // Check if window is still open
  const now = new Date()
  const windowClosed = !block.availability_window_close ||
    new Date(block.availability_window_close) <= now

  // Load existing submission if any
  const { data: submissionData } = await supabase
    .from('availability_submissions')
    .select('id')
    .eq('schedule_block_id', block.id)
    .eq('user_id', user.id)
    .single()

  const existing: Record<string, EntryType> = {}
  if (submissionData) {
    const { data: entriesData } = await supabase
      .from('availability_entries')
      .select('entry_date, entry_type')
      .eq('submission_id', submissionData.id)
    for (const e of (entriesData ?? [])) {
      existing[e.entry_date] = e.entry_type as EntryType
    }
  }

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">
          {block.shift_type.charAt(0).toUpperCase() + block.shift_type.slice(1)} Shift Availability
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          {format(new Date(block.start_date + 'T00:00:00'), 'MMMM d')} –{' '}
          {format(new Date(block.end_date + 'T00:00:00'), 'MMMM d, yyyy')}
        </p>
        {!windowClosed && block.availability_window_close && (
          <p className="text-xs text-slate-500 mt-0.5">
            Deadline: {new Date(block.availability_window_close).toLocaleString()}
          </p>
        )}
      </div>

      <AvailabilityCalendar
        blockId={block.id}
        startDate={block.start_date}
        employmentType={profile.employment_type}
        existing={existing}
        windowClosed={windowClosed}
      />
    </div>
  )
}
```

- [ ] **Step 5.8: Run all tests**

```bash
npm test
```
Expected: All PASS (23+ tests)

- [ ] **Step 5.9: Commit**

```bash
git add app/actions/availability.ts components/availability/AvailabilityCalendar.tsx \
  app/(app)/availability/page.tsx "app/(app)/availability/[blockId]/page.tsx" \
  components/availability/SubmissionTracker.tsx tests/unit/availability-calendar.test.ts
git commit -m "feat: availability submission for FT and PRN therapists"
```

---

## Task 6: Cell State Editing from Panel (Manager, Optimistic Updates)

Managers can change any cell's state directly from the CellPanel. The grid updates immediately without a full page reload.

**Architecture:** `ScheduleGrid` moves `shifts` from props into `useState`. When the panel calls `updateCellState`, the grid optimistically replaces the shift in its local state. If the server action fails, it reverts.

**Files:**
- Modify: `components/schedule/ScheduleGrid.tsx`
- Modify: `components/schedule/CellPanel.tsx`
- Create: `tests/unit/cell-editing.test.ts`

- [ ] **Step 6.1: Write the failing test**

```typescript
// tests/unit/cell-editing.test.ts
import { describe, it, expect } from 'vitest'

type CellState = 'working' | 'cannot_work' | 'off' | 'fmla'

// Simulate the optimistic update logic from ScheduleGrid
function applyOptimisticUpdate(
  shifts: Array<{ id: string; cell_state: CellState }>,
  shiftId: string,
  newState: CellState
): Array<{ id: string; cell_state: CellState }> {
  return shifts.map(s => s.id === shiftId ? { ...s, cell_state: newState } : s)
}

describe('optimistic cell update', () => {
  it('updates the target shift state', () => {
    const shifts = [
      { id: 'a', cell_state: 'working' as CellState },
      { id: 'b', cell_state: 'off' as CellState },
    ]
    const updated = applyOptimisticUpdate(shifts, 'a', 'fmla')
    expect(updated[0].cell_state).toBe('fmla')
    expect(updated[1].cell_state).toBe('off')
  })

  it('returns same array when shift not found', () => {
    const shifts = [{ id: 'a', cell_state: 'working' as CellState }]
    const updated = applyOptimisticUpdate(shifts, 'z', 'off')
    expect(updated[0].cell_state).toBe('working')
  })
})
```

- [ ] **Step 6.2: Run test to verify it fails**

```bash
npm test tests/unit/cell-editing.test.ts
```
Expected: FAIL

- [ ] **Step 6.3: Update ScheduleGrid to support optimistic updates and role prop**

Replace the top section of `ScheduleGrid.tsx` (imports, types, interface, and state) with the following. The rest of the render JSX stays the same except where noted:

```typescript
// components/schedule/ScheduleGrid.tsx
'use client'
import { useState, useMemo, useCallback } from 'react'
import { format, addDays } from 'date-fns'
import { GridCell } from './GridCell'
import { ShiftToggle } from './ShiftToggle'
import { CellPanel } from './CellPanel'
import type { Database } from '@/lib/types/database.types'

type Shift = Database['public']['Tables']['shifts']['Row']
type UserRow = Database['public']['Tables']['users']['Row']

interface Props {
  block: Database['public']['Tables']['schedule_blocks']['Row']
  shifts: Shift[]
  therapists: UserRow[]
  defaultShiftType: 'day' | 'night'
  userRole: 'manager' | 'therapist'   // NEW
}

function buildDates(startDate: string): string[] {
  const start = new Date(startDate + 'T00:00:00')
  return Array.from({ length: 42 }, (_, i) => format(addDays(start, i), 'yyyy-MM-dd'))
}

function buildWeeks(dates: string[]): string[][] {
  return Array.from({ length: 6 }, (_, i) => dates.slice(i * 7, i * 7 + 7))
}

export function ScheduleGrid({ block, shifts: initialShifts, therapists, defaultShiftType, userRole }: Props) {
  const [activeShift, setActiveShift] = useState<'day' | 'night'>(defaultShiftType)
  const [shifts, setShifts] = useState<Shift[]>(initialShifts)  // NEW: mutable for optimistic updates
  const [panelShift, setPanelShift] = useState<Shift | undefined>()
  const [panelDate, setPanelDate] = useState<string | null>(null)
  const [panelUser, setPanelUser] = useState<UserRow | undefined>()
  const [panelOpen, setPanelOpen] = useState(false)

  // NEW: optimistic cell state update
  const handleCellStateUpdate = useCallback((shiftId: string, newState: Shift['cell_state'], revert?: Shift) => {
    setShifts(prev => prev.map(s =>
      s.id === shiftId ? { ...s, cell_state: newState } : s
    ))
    // Also update the panel's shift reference
    setPanelShift(prev => prev?.id === shiftId ? { ...prev, cell_state: newState } : prev)

    // If revert provided, call it on error (passed as a callback by CellPanel)
    return () => {
      if (revert) {
        setShifts(prev => prev.map(s => s.id === shiftId ? revert : s))
        setPanelShift(prev => prev?.id === shiftId ? revert : prev)
      }
    }
  }, [])
```

Then update the `handleCellClick` to also keep `panelShift` in sync with the optimistic state:

```typescript
  function handleCellClick(shift: Shift | undefined, date: string, user: UserRow) {
    // Always get the latest version of the shift from state
    const currentShift = shift ? shifts.find(s => s.id === shift.id) ?? shift : undefined
    setPanelShift(currentShift)
    setPanelDate(date)
    setPanelUser(user)
    setPanelOpen(true)
  }
```

And update the CellPanel usage to pass `onCellStateUpdate` and `userRole`:

```tsx
      <CellPanel
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
        shift={panelShift}
        date={panelDate ?? ''}
        user={panelUser}
        userRole={userRole}
        onCellStateUpdate={handleCellStateUpdate}
      />
```

- [ ] **Step 6.4: Update CellPanel to add editing for managers**

Replace the entire `CellPanel.tsx`:

```typescript
// components/schedule/CellPanel.tsx
'use client'
import { useState, useTransition } from 'react'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Badge } from '@/components/ui/badge'
import { format } from 'date-fns'
import { updateCellState } from '@/app/actions/schedule'
import type { Database } from '@/lib/types/database.types'

type Shift = Database['public']['Tables']['shifts']['Row']
type UserRow = Database['public']['Tables']['users']['Row']
type CellState = Shift['cell_state']

const STATE_LABELS: Record<CellState, string> = {
  working:      'Working',
  cannot_work:  'Cannot Work',
  off:          'Off',
  fmla:         'FMLA',
}

const ALL_STATES: CellState[] = ['working', 'cannot_work', 'off', 'fmla']

interface Props {
  open: boolean
  onClose: () => void
  shift: Shift | undefined
  date: string
  user: UserRow | undefined
  userRole: 'manager' | 'therapist'
  onCellStateUpdate: (shiftId: string, newState: CellState, revert: Shift) => () => void
}

export function CellPanel({ open, onClose, shift, date, user, userRole, onCellStateUpdate }: Props) {
  const [isPending, startTransition] = useTransition()
  const [editError, setEditError] = useState<string | null>(null)

  if (!user || !date) return null

  const state = shift?.cell_state ?? 'off'
  const isLead = !!shift?.lead_user_id

  const formattedDate = format(new Date(date + 'T00:00:00'), 'EEEE, MMMM d, yyyy')

  function handleStateChange(newState: CellState) {
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

  return (
    <Sheet open={open} onOpenChange={v => { if (!v) onClose() }}>
      <SheetContent side="right" className="w-80 sm:w-96" aria-label="Cell details">
        <SheetHeader>
          <SheetTitle className="text-left">{user.full_name}</SheetTitle>
          <p className="text-sm text-slate-500">{formattedDate}</p>
        </SheetHeader>

        <div className="mt-6 space-y-4">
          {/* Cell state — editable for managers */}
          <div>
            <span className="block text-sm font-medium text-slate-700 mb-2">Status</span>
            {userRole === 'manager' && shift ? (
              <div className="grid grid-cols-2 gap-1.5">
                {ALL_STATES.map(s => (
                  <button
                    key={s}
                    onClick={() => handleStateChange(s)}
                    disabled={isPending || state === s}
                    className={[
                      'py-2 px-3 text-xs rounded-md border transition-colors',
                      state === s
                        ? 'bg-slate-900 text-white border-slate-900 font-medium'
                        : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400',
                      isPending ? 'opacity-50 cursor-not-allowed' : ''
                    ].join(' ')}
                  >
                    {STATE_LABELS[s]}
                  </button>
                ))}
              </div>
            ) : (
              <Badge variant={state === 'working' ? 'default' : state === 'off' ? 'outline' : 'secondary'}>
                {STATE_LABELS[state]}
              </Badge>
            )}
            {editError && <p className="mt-1 text-xs text-red-600">{editError}</p>}
          </div>

          {/* Lead assignment */}
          {state === 'working' && (
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-slate-700">Lead / Charge</span>
              {isLead ? (
                <Badge className="bg-yellow-100 text-yellow-800 border-yellow-200">
                  Assigned ✓
                </Badge>
              ) : (
                <span className="text-sm text-slate-400">Not assigned</span>
              )}
            </div>
          )}

          {/* Employment type */}
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-slate-700">Type</span>
            <span className="text-sm text-slate-500 capitalize">
              {user.employment_type.replace('_', '-')}
            </span>
          </div>

          {/* Lead-qualified badge */}
          {user.is_lead_qualified && (
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-slate-700">Lead-qualified</span>
              <Badge variant="outline" className="text-blue-600 border-blue-200">Yes</Badge>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
```

- [ ] **Step 6.5: Export `applyOptimisticUpdate` from a utility and update the test to import it**

First, create the utility file so the function is importable from a stable location:

```typescript
// lib/schedule/optimistic.ts
export type CellState = 'working' | 'cannot_work' | 'off' | 'fmla'

export function applyOptimisticUpdate<T extends { id: string; cell_state: CellState }>(
  shifts: T[],
  shiftId: string,
  newState: CellState
): T[] {
  return shifts.map(s => s.id === shiftId ? { ...s, cell_state: newState } : s)
}
```

Then update the test to import from it:

```typescript
// tests/unit/cell-editing.test.ts
import { describe, it, expect } from 'vitest'
import { applyOptimisticUpdate } from '@/lib/schedule/optimistic'

describe('optimistic cell update', () => {
  it('updates the target shift state', () => {
    const shifts = [
      { id: 'a', cell_state: 'working' as const },
      { id: 'b', cell_state: 'off' as const },
    ]
    const updated = applyOptimisticUpdate(shifts, 'a', 'fmla')
    expect(updated[0].cell_state).toBe('fmla')
    expect(updated[1].cell_state).toBe('off')
  })

  it('returns same state when shift not found', () => {
    const shifts = [{ id: 'a', cell_state: 'working' as const }]
    const updated = applyOptimisticUpdate(shifts, 'z', 'off')
    expect(updated[0].cell_state).toBe('working')
  })
})
```

Also update `ScheduleGrid.tsx` to use this utility in `handleCellStateUpdate` instead of an inline map:

```typescript
import { applyOptimisticUpdate } from '@/lib/schedule/optimistic'

// Inside handleCellStateUpdate:
setShifts(prev => applyOptimisticUpdate(prev, shiftId, newState))
```

- [ ] **Step 6.6: Run all tests**

```bash
npm test
```
Expected: All PASS (25+ tests)

- [ ] **Step 6.7: Verify build compiles**

```bash
npm run build 2>&1 | tail -20
```
Expected: Build completes with no errors (TS errors count as errors here)

- [ ] **Step 6.8: Commit**

```bash
git add components/schedule/ScheduleGrid.tsx components/schedule/CellPanel.tsx \
  tests/unit/cell-editing.test.ts
git commit -m "feat: manager cell state editing with optimistic updates"
```

---

## Task 7: Constraint Diff

After a manager creates a copied block, show a dismissable list of FT therapists whose availability conflicts with how they were scheduled in the prior block (working on dates they now marked Cannot Work).

**Files:**
- Create: `components/schedule/ConstraintDiff.tsx`
- Modify: `app/(app)/schedule/page.tsx` (fetch diff + pass to grid area)
- Create: `tests/unit/constraint-diff.test.ts`

- [ ] **Step 7.1: Write the failing test**

```typescript
// tests/unit/constraint-diff.test.ts
import { describe, it, expect } from 'vitest'

type DiffItem = {
  user_id: string
  full_name: string
  shift_date: string
  prior_cell_state: string
  avail_entry_type: string
}

// Pure utility: group diff items by user
function groupDiffByUser(items: DiffItem[]): Record<string, { name: string; dates: string[] }> {
  const result: Record<string, { name: string; dates: string[] }> = {}
  for (const item of items) {
    if (!result[item.user_id]) {
      result[item.user_id] = { name: item.full_name, dates: [] }
    }
    result[item.user_id].dates.push(item.shift_date)
  }
  return result
}

describe('groupDiffByUser', () => {
  it('groups multiple dates under one user', () => {
    const items: DiffItem[] = [
      { user_id: 'u1', full_name: 'Alice', shift_date: '2026-03-02', prior_cell_state: 'working', avail_entry_type: 'cannot_work' },
      { user_id: 'u1', full_name: 'Alice', shift_date: '2026-03-03', prior_cell_state: 'working', avail_entry_type: 'cannot_work' },
      { user_id: 'u2', full_name: 'Bob',   shift_date: '2026-03-04', prior_cell_state: 'working', avail_entry_type: 'cannot_work' },
    ]
    const grouped = groupDiffByUser(items)
    expect(grouped['u1'].dates).toHaveLength(2)
    expect(grouped['u2'].dates).toHaveLength(1)
    expect(grouped['u1'].name).toBe('Alice')
  })

  it('returns empty object for empty input', () => {
    expect(groupDiffByUser([])).toEqual({})
  })
})
```

- [ ] **Step 7.2: Run test to verify it fails**

```bash
npm test tests/unit/constraint-diff.test.ts
```
Expected: FAIL

- [ ] **Step 7.3: Create ConstraintDiff component**

```typescript
// components/schedule/ConstraintDiff.tsx
'use client'
import { useState } from 'react'
import { format } from 'date-fns'

export type DiffItem = {
  user_id: string
  full_name: string
  shift_date: string
  prior_cell_state: string
  avail_entry_type: string
}

export function groupDiffByUser(
  items: DiffItem[]
): Record<string, { name: string; dates: string[] }> {
  const result: Record<string, { name: string; dates: string[] }> = {}
  for (const item of items) {
    if (!result[item.user_id]) {
      result[item.user_id] = { name: item.full_name, dates: [] }
    }
    result[item.user_id].dates.push(item.shift_date)
  }
  return result
}

interface Props {
  diff: DiffItem[]
}

export function ConstraintDiff({ diff }: Props) {
  const [dismissed, setDismissed] = useState(false)

  if (dismissed || diff.length === 0) return null

  const grouped = groupDiffByUser(diff)
  const users = Object.entries(grouped)

  return (
    <div className="border border-amber-200 bg-amber-50 rounded-lg p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-amber-800">
            Availability Conflicts ({users.length} {users.length === 1 ? 'therapist' : 'therapists'})
          </h3>
          <p className="text-xs text-amber-700 mt-0.5">
            These FT therapists marked Cannot Work on dates they were scheduled as Working in the prior block.
            Review and adjust their rows.
          </p>
        </div>
        <button
          onClick={() => setDismissed(true)}
          className="text-amber-500 hover:text-amber-700 text-xs font-medium shrink-0"
          aria-label="Dismiss conflict list"
        >
          Dismiss
        </button>
      </div>

      <ul className="space-y-2">
        {users.map(([userId, { name, dates }]) => (
          <li key={userId} className="flex items-start gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 mt-1.5 shrink-0" />
            <div>
              <span className="text-sm font-medium text-amber-900">{name}</span>
              <span className="text-xs text-amber-700 ml-2">
                {dates.length} conflict{dates.length > 1 ? 's' : ''}:
              </span>
              <span className="text-xs text-amber-600 ml-1">
                {dates
                  .sort()
                  .map(d => format(new Date(d + 'T00:00:00'), 'MMM d'))
                  .join(', ')}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
```

- [ ] **Step 7.4: Update the test to import from component**

```typescript
// tests/unit/constraint-diff.test.ts
import { describe, it, expect } from 'vitest'
import { groupDiffByUser, type DiffItem } from '@/components/schedule/ConstraintDiff'

describe('groupDiffByUser', () => {
  it('groups multiple dates under one user', () => {
    const items: DiffItem[] = [
      { user_id: 'u1', full_name: 'Alice', shift_date: '2026-03-02', prior_cell_state: 'working', avail_entry_type: 'cannot_work' },
      { user_id: 'u1', full_name: 'Alice', shift_date: '2026-03-03', prior_cell_state: 'working', avail_entry_type: 'cannot_work' },
      { user_id: 'u2', full_name: 'Bob',   shift_date: '2026-03-04', prior_cell_state: 'working', avail_entry_type: 'cannot_work' },
    ]
    const grouped = groupDiffByUser(items)
    expect(grouped['u1'].dates).toHaveLength(2)
    expect(grouped['u2'].dates).toHaveLength(1)
    expect(grouped['u1'].name).toBe('Alice')
  })

  it('returns empty object for empty input', () => {
    expect(groupDiffByUser([])).toEqual({})
  })
})
```

- [ ] **Step 7.5: Add `conflictedCells` prop to `GridCell` for visual highlighting**

The roadmap requires "Conflicting cells are visually distinct." Add an `isConflicted` prop to `GridCell`:

```typescript
// components/schedule/GridCell.tsx — add isConflicted prop
interface Props {
  shift: Shift | undefined
  onClick: (shift: Shift | undefined, date: string) => void
  date: string
  isConflicted?: boolean   // NEW: amber ring when true
}

export function GridCell({ shift, onClick, date, isConflicted = false }: Props) {
  const state = shift?.cell_state ?? 'off'
  const isLead = !!shift?.lead_user_id

  return (
    <button
      onClick={() => onClick(shift, date)}
      className={cn(
        'relative h-9 text-xs flex items-center justify-center border border-white/20',
        'transition-opacity hover:opacity-80 focus:outline-none focus:ring-1 focus:ring-slate-400',
        cellStateClass(state),
        isConflicted && 'ring-2 ring-inset ring-amber-400'  // conflict highlight
      )}
      aria-label={`${date}: ${state}${isConflicted ? ' (conflict)' : ''}`}
    >
      {cellStateLabel(state)}
      {isLead && state === 'working' && (
        <span className="absolute bottom-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-yellow-400" title="Lead/charge" />
      )}
      {isConflicted && (
        <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-amber-400" title="Availability conflict" />
      )}
    </button>
  )
}
```

- [ ] **Step 7.6: Pass `conflictedCells` set to `ScheduleGrid` and wire into `GridCell`**

Add a `conflictedCells` prop to `ScheduleGrid` (a `Set<string>` of `"userId:date"` keys) and use it when rendering each `GridCell`.

In `ScheduleGrid.tsx`, extend Props:

```typescript
interface Props {
  // ... existing props ...
  conflictedCells?: Set<string>  // NEW: "userId:date" keys for amber ring
}
```

And in the `GridCell` render inside the FT/PRN rows, add:

```tsx
<GridCell
  key={date}
  shift={getShift(therapist.id, date)}
  date={date}
  isConflicted={conflictedCells?.has(`${therapist.id}:${date}`) ?? false}
  onClick={(shift, d) => handleCellClick(shift, d, therapist)}
/>
```

- [ ] **Step 7.7: Fetch diff, build conflict set, and wire to schedule page + grid**

In `app/(app)/schedule/page.tsx`, add the imports:

```typescript
import { ConstraintDiff, type DiffItem } from '@/components/schedule/ConstraintDiff'
```

After the submissions fetch, add the diff fetch (manager + copied block only):

```typescript
  // Fetch constraint diff if this is a copied block (manager only)
  let diff: DiffItem[] = []
  if (profile.role === 'manager' && block.copied_from_block_id) {
    const { data: diffData } = await supabase
      .rpc('get_constraint_diff', { p_new_block_id: block.id })
    diff = (diffData ?? []) as DiffItem[]
  }

  // Build a Set of "userId:date" keys for O(1) lookup in GridCell
  const conflictedCells = new Set(diff.map(d => `${d.user_id}:${d.shift_date}`))
```

Update the return JSX:

```tsx
      {diff.length > 0 && <ConstraintDiff diff={diff} />}

      <ScheduleGrid
        block={block}
        shifts={shifts}
        therapists={therapists}
        defaultShiftType={activeShift}
        userRole={profile.role}
        conflictedCells={conflictedCells}
      />
```

- [ ] **Step 7.8: Run all tests**

```bash
npm test
```
Expected: All PASS (27+ tests)

- [ ] **Step 7.9: Verify build**

```bash
npm run build 2>&1 | tail -20
```
Expected: No errors

- [ ] **Step 7.10: Commit**

```bash
git add components/schedule/ConstraintDiff.tsx components/schedule/GridCell.tsx \
  components/schedule/ScheduleGrid.tsx tests/unit/constraint-diff.test.ts \
  app/(app)/schedule/page.tsx
git commit -m "feat: constraint diff with conflicting cell highlighting"
```

---

## Phase 2 Complete

**Run the full test suite one final time:**

```bash
npm test
```
Expected: All tests passing.

**Verify the full flow manually:**
1. Log in as `manager@teamwise.dev`
2. Click "+ New Block" → create a new Day block copying from prior
3. Verify the new block appears in the block picker with FT shifts copied
4. Open an availability window with a deadline
5. Log out → log in as `jsmith@teamwise.dev`
6. Go to /availability → click the open window → mark some Cannot Work dates → Submit
7. Log back in as manager → check Submission Tracker shows jsmith as submitted
8. Click on a Working cell → panel opens → change state → grid updates immediately (no reload)
9. If jsmith marked Cannot Work on a date she was Working in prior block → see diff banner

**Push to GitHub:**

```bash
git push origin main
```

**Phase 2 is done when:**
- A therapist can submit availability digitally (no paper sheet)
- Manager can create a new block with FT shifts copied from the prior block
- Constraint diff surfaces conflicts between availability and prior schedule
- Manager can edit any cell state from the panel with immediate grid update
- Headcount rows update correctly when cells change
