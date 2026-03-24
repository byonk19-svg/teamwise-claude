# Phase 3: Preliminary / Final Lifecycle — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable the full Preliminary/Final lifecycle — manager posts Preliminary, FT therapists submit change requests, PRN therapists signal interest in open slots, manager resolves everything via an inbox, and publishes Final — with block picker groupings and read-only enforcement on published blocks.

**Architecture:** No new DB migrations needed — all Phase 3 tables (`preliminary_change_requests`, `prn_shift_interest`) and columns (`published_by`, `published_at`) already exist in migration 001. Pure business-rule functions live in `lib/schedule/` for unit testing; server actions call them. `CellPanel` gains `blockStatus`, `blockId`, and `currentUserId` props to gate the change request form. A new `/schedule/inbox` page aggregates pending change requests and PRN interest for the manager. A new `/availability/open-shifts` page shows PRN therapists their fillable slots.

**Tech Stack:** Next.js 14, TypeScript, Supabase (@supabase/ssr), Tailwind CSS, shadcn/ui, Vitest, Server Actions

**Spec references:**
- PRD v5.2: `C:\Users\byonk\Downloads\teamwise-prd-v5.2-COMPLETE.docx` (sections 7.3, 8.2, 11)
- Roadmap v1.0: `C:\Users\byonk\Downloads\teamwise-roadmap-v1.md` (Phase 3)
- Phase 2 plan: `docs/superpowers/plans/2026-03-22-phase2-availability-schedule-building.md`

**Critical context for every implementer:**
- `lib/auth.ts` is the ONLY file allowed to call Supabase Auth APIs
- `lib/supabase/server.ts` uses `require('next/headers')` inside the function body — do not refactor
- All Phase 3 DB tables already exist — **no migration needed**
- `block_status` enum: `preliminary_draft → preliminary → final → active → completed`
- `preliminary_change_requests.request_type` enum: `move_shift | mark_off | other`
- `prn_shift_interest.status` enum: `pending | confirmed | declined`
- Cast Supabase client as `any` for RPC calls and tables not yet in generated types
- Supabase `.single()` return type requires explicit casts — follow the pattern in `app/actions/schedule.ts`

---

## File Map

```
teamwise-claude/
├── app/
│   ├── actions/
│   │   ├── schedule.ts              # MODIFIED: add postPreliminary, postFinal; guard updateCellState by block status
│   │   ├── change-requests.ts       # NEW: submitChangeRequest, resolveChangeRequest
│   │   └── prn-interest.ts          # NEW: submitPrnInterest, resolvePrnInterest
│   └── (app)/
│       ├── schedule/
│       │   ├── page.tsx             # MODIFIED: pass blockStatus/currentUserId/blockId to grid; add BlockStatusActions; add therapist notices
│       │   └── inbox/
│       │       └── page.tsx         # NEW: Manager preliminary inbox (server component)
│       └── availability/
│           └── open-shifts/
│               └── page.tsx         # NEW: PRN open shifts list (server component)
├── components/
│   ├── schedule/
│   │   ├── BlockPicker.tsx          # MODIFIED: Past/Current/Upcoming optgroup groupings
│   │   ├── CellPanel.tsx            # MODIFIED: accept blockStatus/blockId/currentUserId; gate edits; add change request form
│   │   ├── ScheduleGrid.tsx         # MODIFIED: accept blockStatus/blockId/currentUserId; pass to CellPanel
│   │   ├── BlockStatusActions.tsx   # NEW: status badge + manager Post/Publish buttons (client)
│   │   └── InboxList.tsx            # NEW: change request + PRN interest items with accept/reject (client)
│   └── availability/
│       └── OpenShiftsList.tsx       # NEW: PRN open shifts with interest signaling (client)
├── lib/
│   ├── schedule/
│   │   ├── block-status.ts          # NEW: pure helpers — classifyBlock, canEditCell, isBlockReadOnly, canPostPreliminary, canPublishFinal
│   │   └── change-requests.ts       # NEW: pure helpers — isChangeRequestAllowed, isPrnInterestAllowed
│   └── types/
│       └── database.types.ts        # MODIFIED: add preliminary_change_requests + prn_shift_interest table types
└── tests/unit/
    ├── block-status.test.ts          # NEW
    └── change-request-guards.test.ts # NEW
```

---

## Task 1: Types + Block Status Helpers

**Files:**
- Modify: `lib/types/database.types.ts`
- Create: `lib/schedule/block-status.ts`
- Create: `lib/schedule/change-requests.ts`
- Create: `tests/unit/block-status.test.ts`
- Create: `tests/unit/change-request-guards.test.ts`

- [ ] **Step 1.1: Extend database.types.ts — add Phase 3 table types**

Inside the `Tables` object in `lib/types/database.types.ts`, after `availability_entries`, add:

```typescript
      preliminary_change_requests: {
        Row: {
          id: string
          schedule_block_id: string
          requester_id: string
          shift_id: string
          request_type: 'move_shift' | 'mark_off' | 'other'
          note: string | null
          status: 'pending' | 'accepted' | 'rejected'
          response_note: string | null
          created_at: string
          actioned_at: string | null
          actioned_by: string | null
        }
        Insert: Omit<
          Database['public']['Tables']['preliminary_change_requests']['Row'],
          'id' | 'created_at'
        >
        Update: Partial<
          Database['public']['Tables']['preliminary_change_requests']['Insert']
        >
      }
      prn_shift_interest: {
        Row: {
          id: string
          user_id: string
          shift_id: string
          status: 'pending' | 'confirmed' | 'declined'
          outside_availability: boolean
          submitted_at: string
          actioned_at: string | null
          actioned_by: string | null
        }
        Insert: Omit<
          Database['public']['Tables']['prn_shift_interest']['Row'],
          'id' | 'submitted_at'
        >
        Update: Partial<
          Database['public']['Tables']['prn_shift_interest']['Insert']
        >
      }
```

- [ ] **Step 1.2: Create lib/schedule/block-status.ts**

```typescript
// lib/schedule/block-status.ts
import type { Database } from '@/lib/types/database.types'

type BlockStatus = Database['public']['Tables']['schedule_blocks']['Row']['status']

/**
 * Classify a block into Past / Current / Upcoming relative to todayStr ('YYYY-MM-DD').
 * Used by BlockPicker to render optgroup labels.
 */
export function classifyBlock(
  endDate: string,
  startDate: string,
  todayStr: string
): 'past' | 'current' | 'upcoming' {
  if (endDate < todayStr) return 'past'
  if (startDate > todayStr) return 'upcoming'
  return 'current'
}

/** Manager can directly edit cells only in preliminary_draft or preliminary blocks. */
export function canEditCell(status: BlockStatus, role: 'manager' | 'therapist'): boolean {
  if (role !== 'manager') return false
  return status === 'preliminary_draft' || status === 'preliminary'
}

/** Block is read-only for all users — no posting, editing, or change requests. */
export function isBlockReadOnly(status: BlockStatus): boolean {
  return status === 'final' || status === 'active' || status === 'completed'
}

/** Manager can post this block as Preliminary. */
export function canPostPreliminary(status: BlockStatus): boolean {
  return status === 'preliminary_draft'
}

/** Manager can publish this block as Final. */
export function canPublishFinal(status: BlockStatus): boolean {
  return status === 'preliminary'
}
```

- [ ] **Step 1.3: Create lib/schedule/change-requests.ts**

```typescript
// lib/schedule/change-requests.ts
import type { Database } from '@/lib/types/database.types'

type BlockStatus = Database['public']['Tables']['schedule_blocks']['Row']['status']

/** FT therapist can submit a change request only on Preliminary blocks. */
export function isChangeRequestAllowed(
  status: BlockStatus,
  role: 'manager' | 'therapist',
  employmentType: 'full_time' | 'prn'
): boolean {
  return status === 'preliminary' && role === 'therapist' && employmentType === 'full_time'
}

/** PRN therapist can signal shift interest only on Preliminary blocks. */
export function isPrnInterestAllowed(
  status: BlockStatus,
  role: 'manager' | 'therapist',
  employmentType: 'full_time' | 'prn'
): boolean {
  return status === 'preliminary' && role === 'therapist' && employmentType === 'prn'
}
```

- [ ] **Step 1.4: Write tests for block-status helpers**

```typescript
// tests/unit/block-status.test.ts
import { describe, it, expect } from 'vitest'
import {
  classifyBlock,
  canEditCell,
  isBlockReadOnly,
  canPostPreliminary,
  canPublishFinal,
} from '@/lib/schedule/block-status'

describe('classifyBlock', () => {
  const today = '2026-03-23'
  it('returns past when end_date is before today', () => {
    expect(classifyBlock('2026-01-01', '2025-11-21', today)).toBe('past')
  })
  it('returns upcoming when start_date is after today', () => {
    expect(classifyBlock('2026-05-31', '2026-04-20', today)).toBe('upcoming')
  })
  it('returns current when today falls within the block', () => {
    expect(classifyBlock('2026-04-30', '2026-03-10', today)).toBe('current')
  })
  it('returns past when end_date is the day before today', () => {
    expect(classifyBlock('2026-03-22', '2026-02-10', today)).toBe('past')
  })
})

describe('canEditCell', () => {
  it('allows manager in preliminary_draft', () => {
    expect(canEditCell('preliminary_draft', 'manager')).toBe(true)
  })
  it('allows manager in preliminary', () => {
    expect(canEditCell('preliminary', 'manager')).toBe(true)
  })
  it('blocks manager in final', () => {
    expect(canEditCell('final', 'manager')).toBe(false)
  })
  it('blocks manager in active', () => {
    expect(canEditCell('active', 'manager')).toBe(false)
  })
  it('blocks therapist regardless of status', () => {
    expect(canEditCell('preliminary_draft', 'therapist')).toBe(false)
    expect(canEditCell('preliminary', 'therapist')).toBe(false)
  })
})

describe('isBlockReadOnly', () => {
  it('final is read-only', () => { expect(isBlockReadOnly('final')).toBe(true) })
  it('active is read-only', () => { expect(isBlockReadOnly('active')).toBe(true) })
  it('completed is read-only', () => { expect(isBlockReadOnly('completed')).toBe(true) })
  it('preliminary_draft is not read-only', () => { expect(isBlockReadOnly('preliminary_draft')).toBe(false) })
  it('preliminary is not read-only', () => { expect(isBlockReadOnly('preliminary')).toBe(false) })
})

describe('canPostPreliminary', () => {
  it('allows preliminary_draft only', () => {
    expect(canPostPreliminary('preliminary_draft')).toBe(true)
    expect(canPostPreliminary('preliminary')).toBe(false)
    expect(canPostPreliminary('final')).toBe(false)
    expect(canPostPreliminary('active')).toBe(false)
  })
})

describe('canPublishFinal', () => {
  it('allows preliminary only', () => {
    expect(canPublishFinal('preliminary')).toBe(true)
    expect(canPublishFinal('preliminary_draft')).toBe(false)
    expect(canPublishFinal('final')).toBe(false)
  })
})
```

- [ ] **Step 1.5: Write tests for change-request guards**

```typescript
// tests/unit/change-request-guards.test.ts
import { describe, it, expect } from 'vitest'
import { isChangeRequestAllowed, isPrnInterestAllowed } from '@/lib/schedule/change-requests'

describe('isChangeRequestAllowed', () => {
  it('allows FT therapist on preliminary block', () => {
    expect(isChangeRequestAllowed('preliminary', 'therapist', 'full_time')).toBe(true)
  })
  it('rejects PRN therapist (FT-only feature)', () => {
    expect(isChangeRequestAllowed('preliminary', 'therapist', 'prn')).toBe(false)
  })
  it('rejects manager', () => {
    expect(isChangeRequestAllowed('preliminary', 'manager', 'full_time')).toBe(false)
  })
  it('rejects non-preliminary blocks', () => {
    expect(isChangeRequestAllowed('preliminary_draft', 'therapist', 'full_time')).toBe(false)
    expect(isChangeRequestAllowed('final', 'therapist', 'full_time')).toBe(false)
    expect(isChangeRequestAllowed('active', 'therapist', 'full_time')).toBe(false)
  })
})

describe('isPrnInterestAllowed', () => {
  it('allows PRN therapist on preliminary block', () => {
    expect(isPrnInterestAllowed('preliminary', 'therapist', 'prn')).toBe(true)
  })
  it('rejects FT therapist', () => {
    expect(isPrnInterestAllowed('preliminary', 'therapist', 'full_time')).toBe(false)
  })
  it('rejects manager', () => {
    expect(isPrnInterestAllowed('preliminary', 'manager', 'prn')).toBe(false)
  })
  it('rejects non-preliminary blocks', () => {
    expect(isPrnInterestAllowed('preliminary_draft', 'therapist', 'prn')).toBe(false)
    expect(isPrnInterestAllowed('final', 'therapist', 'prn')).toBe(false)
  })
})
```

- [ ] **Step 1.6: Run tests — all must pass**

```bash
npm test
```

Expected: all pre-existing tests pass + 19 new tests pass.

- [ ] **Step 1.7: Commit**

```bash
git add lib/types/database.types.ts lib/schedule/block-status.ts lib/schedule/change-requests.ts tests/unit/block-status.test.ts tests/unit/change-request-guards.test.ts
git commit -m "feat: phase3 types and block-status/change-request guard helpers"
```

---

## Task 2: postPreliminary + postFinal + BlockStatusActions

**Files:**
- Modify: `app/actions/schedule.ts`
- Create: `components/schedule/BlockStatusActions.tsx`
- Modify: `app/(app)/schedule/page.tsx`

- [ ] **Step 2.1: Add postPreliminary + postFinal to app/actions/schedule.ts**

Add this import at the top of the file (after existing imports):

```typescript
import { canEditCell, canPostPreliminary, canPublishFinal } from '@/lib/schedule/block-status'
```

Append these two actions to the end of `app/actions/schedule.ts`:

```typescript
/** Post a preliminary_draft block as Preliminary. Manager only. */
export async function postPreliminary(blockId: string): Promise<{ error?: string }> {
  const user = await getServerUser()
  if (!user) return { error: 'Not authenticated' }

  const supabase = createClient()

  const { data: profile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single() as { data: { role: string } | null; error: unknown }
  if (!profile || profile.role !== 'manager') return { error: 'Manager access required' }

  const { data: block } = await supabase
    .from('schedule_blocks')
    .select('status')
    .eq('id', blockId)
    .single() as { data: { status: string } | null; error: unknown }
  if (!block || !canPostPreliminary(block.status as any)) {
    return { error: 'Block must be in preliminary_draft status' }
  }

  const { error } = await supabase
    .from('schedule_blocks')
    .update({ status: 'preliminary' })
    .eq('id', blockId)

  if (error) return { error: error.message }

  revalidatePath('/schedule')
  return {}
}

/** Publish a Preliminary block as Final. Manager only. Records published_by + published_at. */
export async function postFinal(blockId: string): Promise<{ error?: string }> {
  const user = await getServerUser()
  if (!user) return { error: 'Not authenticated' }

  const supabase = createClient()

  const { data: profile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single() as { data: { role: string } | null; error: unknown }
  if (!profile || profile.role !== 'manager') return { error: 'Manager access required' }

  const { data: block } = await supabase
    .from('schedule_blocks')
    .select('status')
    .eq('id', blockId)
    .single() as { data: { status: string } | null; error: unknown }
  if (!block || !canPublishFinal(block.status as 'preliminary')) {
    return { error: 'Block must be in Preliminary status to publish as Final' }
  }

  const { error } = await supabase
    .from('schedule_blocks')
    .update({
      status: 'final',
      published_by: user.id,
      published_at: new Date().toISOString(),
    })
    .eq('id', blockId)

  if (error) return { error: error.message }

  revalidatePath('/schedule')
  return {}
}
```

- [ ] **Step 2.2: Add block status guard to the existing updateCellState action**

In the existing `updateCellState` function in `app/actions/schedule.ts`, after the manager role check and before the `shifts.update()` call, add:

```typescript
  // Fetch block status to guard against editing published blocks
  const { data: shiftRow } = await supabase
    .from('shifts')
    .select('schedule_block_id')
    .eq('id', shiftId)
    .single() as { data: { schedule_block_id: string } | null; error: unknown }

  if (shiftRow) {
    const { data: blockRow } = await supabase
      .from('schedule_blocks')
      .select('status')
      .eq('id', shiftRow.schedule_block_id)
      .single() as { data: { status: string } | null; error: unknown }
    if (blockRow && !canEditCell(blockRow.status as any, 'manager')) {
      return { error: 'Cannot edit cells on a published block' }
    }
  }
```

- [ ] **Step 2.3: Create components/schedule/BlockStatusActions.tsx**

```tsx
// components/schedule/BlockStatusActions.tsx
'use client'
import { useState, useTransition } from 'react'
import Link from 'next/link'
import { postPreliminary, postFinal } from '@/app/actions/schedule'
import { canPostPreliminary, canPublishFinal } from '@/lib/schedule/block-status'
import type { Database } from '@/lib/types/database.types'

type BlockRow = Database['public']['Tables']['schedule_blocks']['Row']

const STATUS_LABELS: Record<BlockRow['status'], string> = {
  preliminary_draft: 'Draft',
  preliminary:       'Preliminary',
  final:             'Final',
  active:            'Active',
  completed:         'Completed',
}

const STATUS_COLORS: Record<BlockRow['status'], string> = {
  preliminary_draft: 'bg-slate-100 text-slate-700 border-slate-200',
  preliminary:       'bg-amber-50 text-amber-800 border-amber-200',
  final:             'bg-green-50 text-green-800 border-green-200',
  active:            'bg-blue-50 text-blue-800 border-blue-200',
  completed:         'bg-slate-50 text-slate-600 border-slate-200',
}

interface Props {
  block: BlockRow
  userRole: 'manager' | 'therapist'
}

export function BlockStatusActions({ block, userRole }: Props) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function handlePostPreliminary() {
    setError(null)
    startTransition(async () => {
      const result = await postPreliminary(block.id)
      if (result.error) setError(result.error)
    })
  }

  function handlePostFinal() {
    setError(null)
    startTransition(async () => {
      const result = await postFinal(block.id)
      if (result.error) setError(result.error)
    })
  }

  return (
    <div className="flex items-center gap-3 flex-wrap">
      {/* Status badge */}
      <span className={`inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium border ${STATUS_COLORS[block.status]}`}>
        {STATUS_LABELS[block.status]}
      </span>

      {userRole === 'manager' && (
        <>
          {canPostPreliminary(block.status) && (
            <button
              onClick={handlePostPreliminary}
              disabled={isPending}
              className="px-3 py-1.5 text-sm bg-amber-600 text-white rounded-md hover:bg-amber-700 disabled:opacity-50"
            >
              {isPending ? 'Posting…' : 'Post as Preliminary'}
            </button>
          )}

          {canPublishFinal(block.status) && (
            <>
              <Link
                href={`/schedule/inbox?blockId=${block.id}`}
                className="px-3 py-1.5 text-sm border border-slate-300 text-slate-700 rounded-md hover:bg-slate-50"
              >
                View Inbox
              </Link>
              <button
                onClick={handlePostFinal}
                disabled={isPending}
                className="px-3 py-1.5 text-sm bg-green-700 text-white rounded-md hover:bg-green-800 disabled:opacity-50"
              >
                {isPending ? 'Publishing…' : 'Publish as Final'}
              </button>
            </>
          )}
        </>
      )}

      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  )
}
```

- [ ] **Step 2.4: Integrate BlockStatusActions + therapist notices into schedule/page.tsx**

Add this import:
```typescript
import { BlockStatusActions } from '@/components/schedule/BlockStatusActions'
```

In the top-controls `<div>` (after `<BlockPicker …/>` and `+ New Block` link), add:
```tsx
<BlockStatusActions block={block} userRole={profile.role as 'manager' | 'therapist'} />
```

Below the top controls div, add therapist notices:
```tsx
{profile.role === 'therapist' && block.status === 'preliminary' && profile.employment_type === 'full_time' && (
  <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
    This schedule is Preliminary. Open any of your cells to request a change.
  </p>
)}
{profile.role === 'therapist' && block.status === 'preliminary' && profile.employment_type === 'prn' && (
  <div className="flex items-center gap-2">
    <Link
      href={`/availability/open-shifts?blockId=${block.id}&shift=${activeShift}`}
      className="text-sm px-3 py-1.5 border border-slate-300 rounded-md hover:bg-slate-50"
    >
      View Open Shifts
    </Link>
  </div>
)}
```

- [ ] **Step 2.5: Run tests**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 2.6: Commit**

```bash
git add app/actions/schedule.ts components/schedule/BlockStatusActions.tsx app/(app)/schedule/page.tsx
git commit -m "feat: post as preliminary, publish as final, block status actions component"
```

---

## Task 3: Block Picker Groupings + CellPanel blockStatus threading

**Files:**
- Modify: `components/schedule/BlockPicker.tsx`
- Modify: `components/schedule/ScheduleGrid.tsx`
- Modify: `components/schedule/CellPanel.tsx`
- Modify: `app/(app)/schedule/page.tsx`

- [ ] **Step 3.1: Update BlockPicker.tsx to group blocks by Past / Current / Upcoming**

Add this import at the top:
```typescript
import { classifyBlock } from '@/lib/schedule/block-status'
```

Replace the existing `{blocks.filter(...).map(...)}` inside `<select>` with optgroup grouping:

```tsx
// Compute today's date string inside the component:
const today = new Date().toISOString().slice(0, 10)
const filtered = blocks.filter(b => b.shift_type === currentShift)
const past     = filtered.filter(b => classifyBlock(b.end_date, b.start_date, today) === 'past')
const current  = filtered.filter(b => classifyBlock(b.end_date, b.start_date, today) === 'current')
const upcoming = filtered.filter(b => classifyBlock(b.end_date, b.start_date, today) === 'upcoming')

// In the <select>:
<select value={currentBlockId} onChange={e => handleBlockChange(e.target.value)} className="text-sm border border-slate-200 rounded-md px-2 py-1.5 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-400">
  {current.length > 0 && (
    <optgroup label="Current">
      {current.map(b => <option key={b.id} value={b.id}>{blockLabel(b.start_date, b.end_date, b.status)}</option>)}
    </optgroup>
  )}
  {upcoming.length > 0 && (
    <optgroup label="Upcoming">
      {upcoming.map(b => <option key={b.id} value={b.id}>{blockLabel(b.start_date, b.end_date, b.status)}</option>)}
    </optgroup>
  )}
  {past.length > 0 && (
    <optgroup label="Past">
      {past.map(b => <option key={b.id} value={b.id}>{blockLabel(b.start_date, b.end_date, b.status)}</option>)}
    </optgroup>
  )}
</select>
```

- [ ] **Step 3.2: Add blockStatus, blockId, currentUserId to ScheduleGrid props**

In `components/schedule/ScheduleGrid.tsx`, add to the `Props` interface:
```typescript
blockStatus: Database['public']['Tables']['schedule_blocks']['Row']['status']
blockId: string
currentUserId: string
```

Pass all three down to `CellPanel` when rendering:
```tsx
<CellPanel
  {/* …existing props… */}
  blockStatus={blockStatus}
  blockId={blockId}
  currentUserId={currentUserId}
/>
```

- [ ] **Step 3.3: Add blockStatus, blockId, currentUserId to CellPanel props; gate edit buttons**

Add to `Props` in `components/schedule/CellPanel.tsx`:
```typescript
blockStatus: Database['public']['Tables']['schedule_blocks']['Row']['status']
blockId: string
currentUserId: string
```

Add this import:
```typescript
import { canEditCell } from '@/lib/schedule/block-status'
```

Replace the existing manager edit condition:
```tsx
// Before:
{userRole === 'manager' && shift ? ( ... ) : ( <Badge ...> )}

// After:
{userRole === 'manager' && shift && canEditCell(blockStatus, userRole) ? (
  <div className="grid grid-cols-2 gap-1.5">
    {/* existing state buttons unchanged */}
  </div>
) : (
  <Badge variant={state === 'working' ? 'default' : state === 'off' ? 'outline' : 'secondary'}>
    {STATE_LABELS[state]}
  </Badge>
)}
```

- [ ] **Step 3.4: Pass blockStatus, blockId, currentUserId from schedule/page.tsx to ScheduleGrid**

```tsx
<ScheduleGrid
  block={block}
  shifts={shifts}
  therapists={therapists}
  defaultShiftType={activeShift}
  userRole={profile.role as 'manager' | 'therapist'}
  conflictedCells={conflictedCells}
  currentUserId={user.id}
  blockStatus={block.status}
  blockId={block.id}
/>
```

- [ ] **Step 3.5: Run tests**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 3.6: Commit**

```bash
git add components/schedule/BlockPicker.tsx components/schedule/ScheduleGrid.tsx components/schedule/CellPanel.tsx app/(app)/schedule/page.tsx
git commit -m "feat: block picker groupings and blockStatus/blockId/currentUserId threading to CellPanel"
```

---

## Task 4: FT Change Request from CellPanel

**Files:**
- Create: `app/actions/change-requests.ts`
- Modify: `components/schedule/CellPanel.tsx`

- [ ] **Step 4.1: Create app/actions/change-requests.ts**

```typescript
// app/actions/change-requests.ts
'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getServerUser } from '@/lib/auth'
import { isChangeRequestAllowed } from '@/lib/schedule/change-requests'
import type { Database } from '@/lib/types/database.types'

type RequestType = Database['public']['Tables']['preliminary_change_requests']['Row']['request_type']

/**
 * FT therapist submits a change request on a Preliminary block.
 * Guards: must be FT therapist, block must be preliminary, no duplicate pending request on same shift.
 */
export async function submitChangeRequest(
  blockId: string,
  shiftId: string,
  requestType: RequestType,
  note: string | null
): Promise<{ error?: string }> {
  const user = await getServerUser()
  if (!user) return { error: 'Not authenticated' }

  const supabase = createClient()

  const { data: profile } = await supabase
    .from('users')
    .select('role, employment_type')
    .eq('id', user.id)
    .single() as { data: { role: string; employment_type: string } | null; error: unknown }
  if (!profile) return { error: 'Profile not found' }

  const { data: block } = await supabase
    .from('schedule_blocks')
    .select('status')
    .eq('id', blockId)
    .single() as { data: { status: string } | null; error: unknown }
  if (!block) return { error: 'Block not found' }

  if (!isChangeRequestAllowed(block.status as any, profile.role as any, profile.employment_type as any)) {
    return { error: 'Change requests are only allowed for FT therapists on Preliminary blocks' }
  }

  // Guard: no duplicate pending requests on the same shift from the same user
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: existing } = await (supabase as any)
    .from('preliminary_change_requests')
    .select('id')
    .eq('shift_id', shiftId)
    .eq('requester_id', user.id)
    .eq('status', 'pending')
    .maybeSingle() as { data: { id: string } | null; error: unknown }
  if (existing) return { error: 'You already have a pending request for this shift' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from('preliminary_change_requests')
    .insert({
      schedule_block_id: blockId,
      requester_id: user.id,
      shift_id: shiftId,
      request_type: requestType,
      note: note || null,
      status: 'pending',
    })

  if (error) return { error: error.message }

  revalidatePath('/schedule')
  return {}
}

/**
 * Manager accepts or rejects a change request.
 * If accepted + request_type === 'mark_off': updates the shift cell_state to 'off'.
 * Note: 'move_shift' acceptance only marks the request resolved — the manager manually edits the cell.
 */
export async function resolveChangeRequest(
  requestId: string,
  decision: 'accepted' | 'rejected',
  responseNote: string | null
): Promise<{ error?: string }> {
  const user = await getServerUser()
  if (!user) return { error: 'Not authenticated' }

  const supabase = createClient()

  const { data: profile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single() as { data: { role: string } | null; error: unknown }
  if (!profile || profile.role !== 'manager') return { error: 'Manager access required' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: req } = await (supabase as any)
    .from('preliminary_change_requests')
    .select('shift_id, request_type, status')
    .eq('id', requestId)
    .single() as { data: { shift_id: string; request_type: string; status: string } | null; error: unknown }
  if (!req) return { error: 'Change request not found' }
  if (req.status !== 'pending') return { error: 'Request is no longer pending' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: updateErr } = await (supabase as any)
    .from('preliminary_change_requests')
    .update({
      status: decision,
      response_note: responseNote || null,
      actioned_at: new Date().toISOString(),
      actioned_by: user.id,
    })
    .eq('id', requestId)

  if (updateErr) return { error: updateErr.message }

  // If accepted + mark_off: update the shift
  if (decision === 'accepted' && req.request_type === 'mark_off') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any)
      .from('shifts')
      .update({ cell_state: 'off' })
      .eq('id', req.shift_id)
  }

  revalidatePath('/schedule')
  revalidatePath('/schedule/inbox')
  return {}
}
```

- [ ] **Step 4.2: Add change request form state and handlers to CellPanel.tsx**

Add these imports:
```typescript
import { isChangeRequestAllowed } from '@/lib/schedule/change-requests'
import { submitChangeRequest } from '@/app/actions/change-requests'
```

Add this type alias (after existing type aliases):
```typescript
type ChangeReqType = Database['public']['Tables']['preliminary_change_requests']['Row']['request_type']
```

Add new local state inside the component function (after existing `useState` calls):
```typescript
const [showChangeReqForm, setShowChangeReqForm] = useState(false)
const [reqType, setReqType] = useState<ChangeReqType>('move_shift')
const [reqNote, setReqNote] = useState('')
const [reqError, setReqError] = useState<string | null>(null)
const [reqSuccess, setReqSuccess] = useState(false)
```

Add a handler (after the existing `handleStateChange`):
```typescript
function handleChangeReqSubmit() {
  if (!shift) return
  setReqError(null)
  startTransition(async () => {
    const result = await submitChangeRequest(blockId, shift.id, reqType, reqNote || null)
    if (result.error) {
      setReqError(result.error)
    } else {
      setReqSuccess(true)
      setShowChangeReqForm(false)
      setReqNote('')
    }
  })
}
```

Add this JSX block inside `<SheetContent>`, after the closing `</div>` of the main `space-y-4` div:

```tsx
{/* FT Change Request — only on Preliminary blocks, therapist's own cell */}
{shift &&
  isChangeRequestAllowed(blockStatus, userRole, user.employment_type) &&
  user.id === currentUserId && (
    <div className="mt-4 border-t border-slate-100 pt-4">
      {reqSuccess ? (
        <p className="text-sm text-green-700">Change request submitted.</p>
      ) : showChangeReqForm ? (
        <div className="space-y-3">
          <span className="block text-sm font-medium text-slate-700">Request Change</span>
          <div className="space-y-1.5">
            {(['move_shift', 'mark_off', 'other'] as const).map(t => (
              <label key={t} className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="radio"
                  name="reqType"
                  value={t}
                  checked={reqType === t}
                  onChange={() => setReqType(t)}
                  className="accent-slate-900"
                />
                {t === 'move_shift' ? 'Move shift' : t === 'mark_off' ? 'Mark off' : 'Other'}
              </label>
            ))}
          </div>
          <textarea
            value={reqNote}
            onChange={e => setReqNote(e.target.value)}
            placeholder="Optional note…"
            rows={2}
            className="w-full text-sm border border-slate-200 rounded-md px-2 py-1.5 resize-none focus:outline-none focus:ring-2 focus:ring-slate-400"
          />
          {reqError && <p className="text-xs text-red-600">{reqError}</p>}
          <div className="flex gap-2">
            <button
              onClick={handleChangeReqSubmit}
              disabled={isPending}
              className="flex-1 py-1.5 text-sm bg-slate-900 text-white rounded-md hover:bg-slate-800 disabled:opacity-50"
            >
              {isPending ? 'Submitting…' : 'Submit Request'}
            </button>
            <button
              onClick={() => { setShowChangeReqForm(false); setReqNote('') }}
              className="py-1.5 px-3 text-sm border border-slate-200 rounded-md hover:bg-slate-50"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setShowChangeReqForm(true)}
          className="w-full py-2 text-sm border border-slate-300 text-slate-700 rounded-md hover:bg-slate-50"
        >
          Request Change
        </button>
      )}
    </div>
  )}
```

- [ ] **Step 4.3: Run tests**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 4.4: Commit**

```bash
git add app/actions/change-requests.ts components/schedule/CellPanel.tsx
git commit -m "feat: FT change request form in CellPanel with submitChangeRequest action"
```

---

## Task 5: PRN Interest Actions + Manager Preliminary Inbox

**Files:**
- Create: `app/actions/prn-interest.ts`
- Create: `app/(app)/schedule/inbox/page.tsx`
- Create: `components/schedule/InboxList.tsx`

- [ ] **Step 5.1: Create app/actions/prn-interest.ts**

```typescript
// app/actions/prn-interest.ts
'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getServerUser } from '@/lib/auth'
import { isPrnInterestAllowed } from '@/lib/schedule/change-requests'

/**
 * PRN therapist signals interest in an open shift.
 * outsideAvailability = true when the date was not in their submitted availability.
 */
export async function submitPrnInterest(
  shiftId: string,
  blockId: string,
  outsideAvailability: boolean
): Promise<{ error?: string }> {
  const user = await getServerUser()
  if (!user) return { error: 'Not authenticated' }

  const supabase = createClient()

  const { data: profile } = await supabase
    .from('users')
    .select('role, employment_type')
    .eq('id', user.id)
    .single() as { data: { role: string; employment_type: string } | null; error: unknown }
  if (!profile) return { error: 'Profile not found' }

  const { data: block } = await supabase
    .from('schedule_blocks')
    .select('status')
    .eq('id', blockId)
    .single() as { data: { status: string } | null; error: unknown }
  if (!block) return { error: 'Block not found' }

  if (!isPrnInterestAllowed(block.status as any, profile.role as any, profile.employment_type as any)) {
    return { error: 'PRN interest is only allowed for PRN therapists on Preliminary blocks' }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from('prn_shift_interest')
    .upsert(
      { user_id: user.id, shift_id: shiftId, outside_availability: outsideAvailability, status: 'pending' },
      { onConflict: 'user_id,shift_id' }
    )

  if (error) return { error: error.message }

  revalidatePath('/availability/open-shifts')
  revalidatePath('/schedule/inbox')
  return {}
}

/**
 * Manager confirms or declines PRN interest.
 * If confirmed: sets the PRN therapist's shift cell_state to 'working'.
 */
export async function resolvePrnInterest(
  interestId: string,
  decision: 'confirmed' | 'declined'
): Promise<{ error?: string }> {
  const user = await getServerUser()
  if (!user) return { error: 'Not authenticated' }

  const supabase = createClient()

  const { data: profile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single() as { data: { role: string } | null; error: unknown }
  if (!profile || profile.role !== 'manager') return { error: 'Manager access required' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: interest } = await (supabase as any)
    .from('prn_shift_interest')
    .select('shift_id, status')
    .eq('id', interestId)
    .single() as { data: { shift_id: string; status: string } | null; error: unknown }
  if (!interest) return { error: 'Interest record not found' }
  if (interest.status !== 'pending') return { error: 'Already resolved' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: updateErr } = await (supabase as any)
    .from('prn_shift_interest')
    .update({ status: decision, actioned_at: new Date().toISOString(), actioned_by: user.id })
    .eq('id', interestId)

  if (updateErr) return { error: updateErr.message }

  if (decision === 'confirmed') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any)
      .from('shifts')
      .update({ cell_state: 'working' })
      .eq('id', interest.shift_id)
  }

  revalidatePath('/schedule')
  revalidatePath('/schedule/inbox')
  return {}
}
```

- [ ] **Step 5.2: Create app/(app)/schedule/inbox/page.tsx**

```tsx
// app/(app)/schedule/inbox/page.tsx
import { redirect } from 'next/navigation'
import { getServerUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { InboxList } from '@/components/schedule/InboxList'
import Link from 'next/link'
import type { Database } from '@/lib/types/database.types'

type ChangeReqRow = Database['public']['Tables']['preliminary_change_requests']['Row']
type PrnInterestRow = Database['public']['Tables']['prn_shift_interest']['Row']
type UserRow = Database['public']['Tables']['users']['Row']
type ShiftRow = Database['public']['Tables']['shifts']['Row']

export interface ChangeReqWithContext extends ChangeReqRow {
  requester: Pick<UserRow, 'full_name'>
  shift: Pick<ShiftRow, 'shift_date' | 'cell_state'>
}

export interface PrnInterestWithContext extends PrnInterestRow {
  user: Pick<UserRow, 'full_name'>
  shift: Pick<ShiftRow, 'shift_date' | 'cell_state'>
}

interface PageProps {
  searchParams: { blockId?: string }
}

export default async function InboxPage({ searchParams }: PageProps) {
  const user = await getServerUser()
  if (!user) redirect('/login')

  const supabase = createClient()

  const { data: profile } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single() as { data: { role: string } | null; error: unknown }

  if (!profile || profile.role !== 'manager') redirect('/schedule')

  const blockId = searchParams.blockId
  if (!blockId) redirect('/schedule')

  const { data: block } = await supabase
    .from('schedule_blocks')
    .select('id, status, start_date, end_date')
    .eq('id', blockId)
    .single() as { data: { id: string; status: string; start_date: string; end_date: string } | null; error: unknown }

  if (!block || block.status !== 'preliminary') {
    return (
      <div className="p-8 text-sm text-slate-500">
        Inbox is only available for Preliminary blocks.{' '}
        <Link href="/schedule" className="underline">Back to Schedule</Link>
      </div>
    )
  }

  // Pending change requests for this block
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: changeReqsRaw } = await (supabase as any)
    .from('preliminary_change_requests')
    .select('*, requester:requester_id(full_name), shift:shift_id(shift_date, cell_state)')
    .eq('schedule_block_id', blockId)
    .eq('status', 'pending')
    .order('created_at', { ascending: true })

  // Shifts in this block (needed to filter PRN interest)
  const { data: blockShifts } = await supabase
    .from('shifts')
    .select('id')
    .eq('schedule_block_id', blockId)
  const shiftIds = (blockShifts ?? []).map(s => s.id)

  // Pending PRN interest for shifts in this block
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: prnInterestRaw } = shiftIds.length > 0
    ? await (supabase as any)
        .from('prn_shift_interest')
        .select('*, user:user_id(full_name), shift:shift_id(shift_date, cell_state)')
        .in('shift_id', shiftIds)
        .eq('status', 'pending')
        .order('submitted_at', { ascending: true })
    : { data: [] }

  const changeReqs = (changeReqsRaw ?? []) as ChangeReqWithContext[]
  const prnInterest = (prnInterestRaw ?? []) as PrnInterestWithContext[]

  return (
    <div className="max-w-2xl mx-auto py-6 px-4 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-slate-900">Preliminary Inbox</h1>
        <Link href={`/schedule?blockId=${blockId}`} className="text-sm text-slate-500 hover:text-slate-700">
          ← Back to Schedule
        </Link>
      </div>
      <InboxList changeReqs={changeReqs} prnInterest={prnInterest} />
    </div>
  )
}
```

- [ ] **Step 5.3: Create components/schedule/InboxList.tsx**

```tsx
// components/schedule/InboxList.tsx
'use client'
import { useState, useTransition } from 'react'
import { format } from 'date-fns'
import { resolveChangeRequest } from '@/app/actions/change-requests'
import { resolvePrnInterest } from '@/app/actions/prn-interest'
import type { ChangeReqWithContext, PrnInterestWithContext } from '@/app/(app)/schedule/inbox/page'
import type { Database } from '@/lib/types/database.types'

type ChangeReqType = Database['public']['Tables']['preliminary_change_requests']['Row']['request_type']

const REQ_TYPE_LABELS: Record<ChangeReqType, string> = {
  move_shift: 'Move shift',
  mark_off:   'Mark off',
  other:      'Other',
}

function fmtDate(d: string) {
  return format(new Date(d + 'T00:00:00'), 'EEE, MMM d')
}

interface Props {
  changeReqs: ChangeReqWithContext[]
  prnInterest: PrnInterestWithContext[]
}

export function InboxList({ changeReqs, prnInterest }: Props) {
  if (changeReqs.length === 0 && prnInterest.length === 0) {
    return <p className="text-sm text-slate-500">No pending requests.</p>
  }
  return (
    <div className="space-y-6">
      {changeReqs.length > 0 && (
        <section>
          <h2 className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">
            Change Requests ({changeReqs.length})
          </h2>
          <div className="space-y-2">
            {changeReqs.map(req => <ChangeReqItem key={req.id} req={req} />)}
          </div>
        </section>
      )}
      {prnInterest.length > 0 && (
        <section>
          <h2 className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">
            PRN Interest ({prnInterest.length})
          </h2>
          <div className="space-y-2">
            {prnInterest.map(item => <PrnInterestItem key={item.id} item={item} />)}
          </div>
        </section>
      )}
    </div>
  )
}

function ChangeReqItem({ req }: { req: ChangeReqWithContext }) {
  const [isPending, startTransition] = useTransition()
  const [responseNote, setResponseNote] = useState('')
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (done) return (
    <div className="p-3 rounded-md bg-slate-50 border border-slate-200 text-sm text-slate-500">Resolved.</div>
  )

  function handleResolve(decision: 'accepted' | 'rejected') {
    setError(null)
    startTransition(async () => {
      const result = await resolveChangeRequest(req.id, decision, responseNote || null)
      if (result.error) setError(result.error)
      else setDone(true)
    })
  }

  return (
    <div className="p-4 rounded-md border border-slate-200 bg-white space-y-3">
      <div>
        <p className="text-sm font-medium text-slate-900">{req.requester.full_name}</p>
        <p className="text-xs text-slate-500">
          {fmtDate(req.shift.shift_date)} · {REQ_TYPE_LABELS[req.request_type]}
        </p>
        {req.note && (
          <p className="text-xs text-slate-600 mt-1 italic">"{req.note}"</p>
        )}
      </div>
      <input
        type="text"
        placeholder="Optional response note…"
        value={responseNote}
        onChange={e => setResponseNote(e.target.value)}
        className="w-full text-xs border border-slate-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-slate-400"
      />
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button
          onClick={() => handleResolve('accepted')}
          disabled={isPending}
          className="flex-1 py-1.5 text-xs bg-green-700 text-white rounded hover:bg-green-800 disabled:opacity-50"
        >
          Accept
        </button>
        <button
          onClick={() => handleResolve('rejected')}
          disabled={isPending}
          className="flex-1 py-1.5 text-xs border border-slate-300 text-slate-700 rounded hover:bg-slate-50 disabled:opacity-50"
        >
          Reject
        </button>
      </div>
    </div>
  )
}

function PrnInterestItem({ item }: { item: PrnInterestWithContext }) {
  const [isPending, startTransition] = useTransition()
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (done) return (
    <div className="p-3 rounded-md bg-slate-50 border border-slate-200 text-sm text-slate-500">Resolved.</div>
  )

  function handleResolve(decision: 'confirmed' | 'declined') {
    setError(null)
    startTransition(async () => {
      const result = await resolvePrnInterest(item.id, decision)
      if (result.error) setError(result.error)
      else setDone(true)
    })
  }

  return (
    <div className="p-4 rounded-md border border-slate-200 bg-white space-y-3">
      <div>
        <p className="text-sm font-medium text-slate-900">
          {item.user.full_name} <span className="font-normal text-slate-500">(PRN)</span>
        </p>
        <p className="text-xs text-slate-500">
          {fmtDate(item.shift.shift_date)} · Interested in working
          {item.outside_availability && (
            <span className="ml-1 text-amber-600">· Outside submitted availability</span>
          )}
        </p>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button
          onClick={() => handleResolve('confirmed')}
          disabled={isPending}
          className="flex-1 py-1.5 text-xs bg-green-700 text-white rounded hover:bg-green-800 disabled:opacity-50"
        >
          Confirm
        </button>
        <button
          onClick={() => handleResolve('declined')}
          disabled={isPending}
          className="flex-1 py-1.5 text-xs border border-slate-300 text-slate-700 rounded hover:bg-slate-50 disabled:opacity-50"
        >
          Decline
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 5.4: Run tests**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 5.5: Commit**

```bash
git add app/actions/prn-interest.ts app/(app)/schedule/inbox/page.tsx components/schedule/InboxList.tsx
git commit -m "feat: PRN interest actions and manager preliminary inbox"
```

---

## Task 6: PRN Open Shifts Page

**Files:**
- Create: `app/(app)/availability/open-shifts/page.tsx`
- Create: `components/availability/OpenShiftsList.tsx`

- [ ] **Step 6.1: Create app/(app)/availability/open-shifts/page.tsx**

```tsx
// app/(app)/availability/open-shifts/page.tsx
import { redirect } from 'next/navigation'
import { getServerUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { OpenShiftsList } from '@/components/availability/OpenShiftsList'
import Link from 'next/link'
import type { Database } from '@/lib/types/database.types'

type ShiftRow = Database['public']['Tables']['shifts']['Row']
type AvailEntryRow = Database['public']['Tables']['availability_entries']['Row']

export interface OpenShift {
  shiftId: string
  date: string
  blockId: string
  outsideAvailability: boolean
  alreadySignaled: boolean
}

interface PageProps {
  searchParams: { blockId?: string; shift?: string }
}

export default async function OpenShiftsPage({ searchParams }: PageProps) {
  const user = await getServerUser()
  if (!user) redirect('/login')

  const supabase = createClient()

  const { data: profile } = await supabase
    .from('users')
    .select('role, employment_type')
    .eq('id', user.id)
    .single() as { data: { role: string; employment_type: string } | null; error: unknown }

  // Only PRN therapists can access this page
  if (!profile || profile.role !== 'therapist' || profile.employment_type !== 'prn') {
    redirect('/schedule')
  }

  const blockId = searchParams.blockId
  if (!blockId) redirect('/schedule')

  const { data: block } = await supabase
    .from('schedule_blocks')
    .select('id, status')
    .eq('id', blockId)
    .single() as { data: { id: string; status: string } | null; error: unknown }

  if (!block || block.status !== 'preliminary') {
    return (
      <div className="p-8 text-sm text-slate-500">
        Open shifts are only available during a Preliminary block.{' '}
        <Link href="/schedule" className="underline">Back to Schedule</Link>
      </div>
    )
  }

  // This PRN therapist's own 'off' shifts in this block (their open slots)
  const { data: myShifts } = await supabase
    .from('shifts')
    .select('id, shift_date, cell_state')
    .eq('schedule_block_id', blockId)
    .eq('user_id', user.id)
    .eq('cell_state', 'off')
    .order('shift_date', { ascending: true }) as {
      data: Pick<ShiftRow, 'id' | 'shift_date' | 'cell_state'>[] | null
      error: unknown
    }

  // Check which dates are within their submitted availability
  const { data: subData } = await supabase
    .from('availability_submissions')
    .select('id')
    .eq('schedule_block_id', blockId)
    .eq('user_id', user.id)
    .maybeSingle() as { data: { id: string } | null; error: unknown }

  let availDates: Set<string> = new Set()
  if (subData) {
    const { data: entries } = await supabase
      .from('availability_entries')
      .select('entry_date, entry_type')
      .eq('submission_id', subData.id) as {
        data: Pick<AvailEntryRow, 'entry_date' | 'entry_type'>[] | null
        error: unknown
      }
    availDates = new Set(
      (entries ?? [])
        .filter(e => e.entry_type !== 'cannot_work')
        .map(e => e.entry_date)
    )
  }

  // Check which shifts this user has already signaled interest in
  const shiftIds = (myShifts ?? []).map(s => s.id)
  let signaledShiftIds: Set<string> = new Set()
  if (shiftIds.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: existingInterest } = await (supabase as any)
      .from('prn_shift_interest')
      .select('shift_id')
      .eq('user_id', user.id)
      .in('shift_id', shiftIds)
    signaledShiftIds = new Set<string>(
      ((existingInterest ?? []) as { shift_id: string }[]).map(i => i.shift_id)
    )
  }

  const openShifts: OpenShift[] = (myShifts ?? []).map(s => ({
    shiftId: s.id,
    date: s.shift_date,
    blockId,
    outsideAvailability: !availDates.has(s.shift_date),
    alreadySignaled: signaledShiftIds.has(s.id),
  }))

  return (
    <div className="max-w-lg mx-auto py-6 px-4 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-slate-900">Open Shifts</h1>
        <Link href="/schedule" className="text-sm text-slate-500 hover:text-slate-700">← Back</Link>
      </div>
      <p className="text-sm text-slate-500">
        Dates below are open in the Preliminary schedule. Signal interest and your manager will confirm.
      </p>
      <OpenShiftsList openShifts={openShifts} />
    </div>
  )
}
```

- [ ] **Step 6.2: Create components/availability/OpenShiftsList.tsx**

```tsx
// components/availability/OpenShiftsList.tsx
'use client'
import { useState, useTransition } from 'react'
import { format } from 'date-fns'
import { submitPrnInterest } from '@/app/actions/prn-interest'
import type { OpenShift } from '@/app/(app)/availability/open-shifts/page'

function fmtDate(d: string) {
  return format(new Date(d + 'T00:00:00'), 'EEE, MMM d')
}

export function OpenShiftsList({ openShifts }: { openShifts: OpenShift[] }) {
  if (openShifts.length === 0) {
    return <p className="text-sm text-slate-500">No open shifts available for this block.</p>
  }
  return (
    <div className="space-y-2">
      {openShifts.map(s => <OpenShiftItem key={s.shiftId} shift={s} />)}
    </div>
  )
}

function OpenShiftItem({ shift }: { shift: OpenShift }) {
  const [isPending, startTransition] = useTransition()
  const [confirming, setConfirming] = useState(false)
  const [done, setDone] = useState(shift.alreadySignaled)
  const [error, setError] = useState<string | null>(null)

  function handleSignal() {
    if (shift.outsideAvailability) {
      setConfirming(true)
      return
    }
    doSubmit()
  }

  function doSubmit() {
    setConfirming(false)
    setError(null)
    startTransition(async () => {
      const result = await submitPrnInterest(shift.shiftId, shift.blockId, shift.outsideAvailability)
      if (result.error) setError(result.error)
      else setDone(true)
    })
  }

  return (
    <div className="p-3 rounded-md border border-slate-200 bg-white space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-slate-900">{fmtDate(shift.date)}</span>
        {shift.outsideAvailability && (
          <span className="text-xs text-amber-600 border border-amber-200 bg-amber-50 px-2 py-0.5 rounded">
            Outside availability
          </span>
        )}
      </div>

      {done ? (
        <p className="text-xs text-green-700">Interest signaled ✓</p>
      ) : confirming ? (
        <div className="space-y-2">
          <p className="text-xs text-amber-700">
            This date is outside your submitted availability. Signal interest anyway?
          </p>
          <div className="flex gap-2">
            <button
              onClick={doSubmit}
              disabled={isPending}
              className="flex-1 py-1.5 text-xs bg-amber-600 text-white rounded hover:bg-amber-700 disabled:opacity-50"
            >
              Yes, signal interest
            </button>
            <button
              onClick={() => setConfirming(false)}
              className="py-1.5 px-3 text-xs border border-slate-200 rounded hover:bg-slate-50"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={handleSignal}
          disabled={isPending}
          className="w-full py-1.5 text-xs border border-slate-300 text-slate-700 rounded hover:bg-slate-50 disabled:opacity-50"
        >
          {isPending ? 'Submitting…' : 'Signal Interest'}
        </button>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  )
}
```

- [ ] **Step 6.3: Run tests**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 6.4: Commit**

```bash
git add app/(app)/availability/open-shifts/page.tsx components/availability/OpenShiftsList.tsx
git commit -m "feat: PRN open shifts page with interest signaling"
```

---

## Task 7: Auto-login Routing Verification + Final Smoke

**Files:**
- Verify: `middleware.ts` (read, confirm redirect target)
- Verify: login redirect

- [ ] **Step 7.1: Verify login redirects to /schedule**

Read `middleware.ts`. Confirm that after successful authentication, unauthenticated users going to protected routes are redirected to `/login`, and after login they land on `/schedule`.

The schedule page already applies `default_shift_type`:
```typescript
const activeShift: 'day' | 'night' =
  requestedShift === 'day' || requestedShift === 'night'
    ? requestedShift
    : (profile.default_shift_type ?? 'day')
```

This is correct — no code change needed. Auto-routing to default shift on login already works.

- [ ] **Step 7.2: Build check**

```bash
npm run build
```

Fix any TypeScript errors before continuing. Common issues to watch for:
- ScheduleGrid prop type mismatch after adding `blockStatus`, `blockId`, `currentUserId`
- CellPanel props not forwarded through all callers

- [ ] **Step 7.3: Run full test suite**

```bash
npm test
```

Expected: all tests pass. The total test count should exceed the pre-Phase-3 count by at least 19.

- [ ] **Step 7.4: Final commit**

```bash
git add .
git commit -m "feat: phase 3 complete — preliminary/final lifecycle end-to-end"
```

---

## Phase 3 Done When

- Manager can click "Post as Preliminary" — status badge changes to Preliminary
- FT therapist opens their own cell on a Preliminary block and sees "Request Change" button
- Manager sees the request in `/schedule/inbox` and can accept/reject
- Accepting a "Mark off" request updates the cell state to Off on the grid
- PRN therapist sees "View Open Shifts" link on Preliminary blocks; can signal interest with out-of-availability warning
- Manager sees PRN interest in the inbox and can confirm (cell goes to Working) or decline
- Manager clicks "Publish as Final" — status badge changes to Final, `published_at` recorded
- On Final/Active/Completed blocks, the cell edit buttons are hidden for all users
- Block picker dropdown shows Past / Current / Upcoming groupings
- Therapist with `default_shift_type = 'day'` lands on Day grid immediately after login
