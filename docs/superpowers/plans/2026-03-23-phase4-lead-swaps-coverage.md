# Phase 4: Lead, Swaps & Coverage — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable lead/charge assignment with gap detection before publish, swap requests between therapists with 48-hour auto-expiry, and a coverage heatmap page for managers.

**Architecture:** Lead assignment is stored as `lead_user_id` on the assigned therapist's own shift row, validated server-side via a Supabase RPC `assign_lead`. Swap requests live in a new `swap_requests` table; auto-expiry runs via pg_cron. Lead gap computation is a pure helper used by both BlockStatusActions (warning dialog) and the coverage heatmap. Coverage page reads the existing `shift_planned_headcount` view. All business logic lives in `lib/schedule/` pure helpers for unit testing.

**Tech Stack:** Next.js 14, TypeScript, Supabase (@supabase/ssr), Tailwind CSS, shadcn/ui, Vitest

**Spec references:**
- Roadmap v1.0: `C:\Users\byonk\Downloads\teamwise-roadmap-v1.md` (Phase 4)
- Phase 3 plan: `docs/superpowers/plans/2026-03-23-phase3-preliminary-final-lifecycle.md`

**Critical context for every implementer:**
- `lib/auth.ts` is the ONLY file allowed to call Supabase Auth APIs
- `lib/supabase/server.ts` uses `require('next/headers')` inside the function body — do not refactor
- Cast `(supabase as any)` for RPCs and Phase 4 tables not yet in generated types; add `// eslint-disable-next-line @typescript-eslint/no-explicit-any` on the line before
- Supabase `.single()` / `.update()` on `schedule_blocks` requires explicit `as { data: ... }` cast — see existing pattern in `app/actions/schedule.ts`
- `lead_user_id` on a shifts row means **this therapist IS the lead for this date** — only the lead's own shift row carries a non-null `lead_user_id` value (set to their own user_id)
- GridCell yellow badge already works (line 17/31 of GridCell.tsx) — do not touch it
- Sidebar already has `/swaps` and `/coverage` nav entries — just create the pages
- `shift_planned_headcount` view already exists in DB and `database.types.ts`

---

## How lead_user_id works

Each therapist has one shift row per date in the block. When John is assigned lead on March 25:
- John's shift row for March 25: `lead_user_id = John's user_id`
- All other therapists' shift rows for March 25: `lead_user_id = null`

Finding the lead for a date: `SELECT user_id FROM shifts WHERE shift_date = X AND schedule_block_id = Y AND lead_user_id IS NOT NULL LIMIT 1`

The `assign_lead` RPC:
1. Validates `is_lead_qualified` for the target user
2. Validates the target user has `cell_state = 'working'` on that date
3. Clears `lead_user_id` on ALL shifts for that date in the block
4. Sets `lead_user_id = target_user_id` on the target's shift row

---

## File Map

```
teamwise-claude/
├── supabase/
│   └── migrations/
│       └── 003_phase4_swaps.sql         # NEW: swap_requests table + assign_lead RPC + pg_cron
├── lib/
│   ├── schedule/
│   │   └── lead-assignment.ts           # NEW: pure helpers — getLeadGapDates, isLeadEligible
│   │   └── swap-requests.ts             # NEW: pure helpers — isSwapAllowed, swapExpiryDate
│   └── types/
│       └── database.types.ts            # MODIFIED: add swap_requests table + assign_lead Function
├── app/
│   └── actions/
│       ├── lead-assignment.ts           # NEW: assignLead server action (calls RPC)
│       ├── swap-requests.ts             # NEW: submitSwap, resolveSwap server actions
│       └── schedule.ts                  # MODIFIED: postFinal checks lead gaps, returns warning
│   └── (app)/
│       ├── swaps/
│       │   └── page.tsx                 # NEW: Manager swaps inbox (server component)
│       └── coverage/
│           └── page.tsx                 # NEW: Coverage heatmap (server component)
├── components/
│   ├── schedule/
│   │   ├── ScheduleGrid.tsx             # MODIFIED: leadDates Set, leadCandidates, handleLeadUpdate
│   │   ├── CellPanel.tsx                # MODIFIED: lead dropdown for managers, swap request form
│   │   ├── GridCell.tsx                 # MODIFIED: dateHasLead prop → pink gap indicator
│   │   └── BlockStatusActions.tsx       # MODIFIED: lead gap dialog before publish
│   ├── swaps/
│   │   └── SwapInbox.tsx               # NEW: swap request list with accept/reject (client)
│   └── coverage/
│       └── CoverageHeatmap.tsx          # NEW: heatmap grid with color coding (client)
└── tests/unit/
    ├── lead-assignment.test.ts           # NEW
    └── swap-requests.test.ts             # NEW
```

---

## Task 1: DB Migration — swap_requests Table + assign_lead RPC

**Files:**
- Create: `supabase/migrations/003_phase4_swaps.sql`

- [ ] **Step 1.1: Write the migration SQL**

```sql
-- supabase/migrations/003_phase4_swaps.sql

-- ──────────────────────────────────────────────────
-- swap_requests table
-- ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.swap_requests (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_block_id   UUID        NOT NULL REFERENCES public.schedule_blocks(id) ON DELETE CASCADE,
  requester_id        UUID        NOT NULL REFERENCES public.users(id),
  requester_shift_id  UUID        NOT NULL REFERENCES public.shifts(id),
  partner_id          UUID        NOT NULL REFERENCES public.users(id),
  partner_shift_id    UUID        NOT NULL REFERENCES public.shifts(id),
  is_cross_shift      BOOLEAN     NOT NULL DEFAULT false,
  status              TEXT        NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
  expires_at          TIMESTAMPTZ NOT NULL,
  request_note        TEXT,
  response_note       TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  actioned_at         TIMESTAMPTZ,
  actioned_by         UUID        REFERENCES public.users(id)
);

ALTER TABLE public.swap_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read swap_requests"  ON public.swap_requests
  FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated insert swap_requests" ON public.swap_requests
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "Authenticated update swap_requests" ON public.swap_requests
  FOR UPDATE USING (auth.role() = 'authenticated');

-- ──────────────────────────────────────────────────
-- assign_lead RPC
-- Validates eligibility and atomically re-assigns the lead for a given date in a block.
-- Returns JSONB: { "success": true } or { "error": "reason string" }
-- ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.assign_lead(
  p_schedule_block_id UUID,
  p_shift_date        DATE,
  p_lead_user_id      UUID  -- pass NULL to clear the lead without assigning a new one
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_is_qualified BOOLEAN;
  v_shift_id     UUID;
BEGIN
  -- Clear mode: just null out lead for this date
  IF p_lead_user_id IS NULL THEN
    UPDATE public.shifts
    SET lead_user_id = NULL
    WHERE schedule_block_id = p_schedule_block_id
      AND shift_date = p_shift_date;
    RETURN jsonb_build_object('success', true);
  END IF;

  -- Check lead qualification
  SELECT is_lead_qualified INTO v_is_qualified
  FROM public.users WHERE id = p_lead_user_id;

  IF NOT COALESCE(v_is_qualified, false) THEN
    RETURN jsonb_build_object('error', 'Therapist is not lead-qualified');
  END IF;

  -- Check therapist has a working shift on this date in this block
  SELECT id INTO v_shift_id
  FROM public.shifts
  WHERE schedule_block_id = p_schedule_block_id
    AND shift_date         = p_shift_date
    AND user_id            = p_lead_user_id
    AND cell_state         = 'working';

  IF v_shift_id IS NULL THEN
    RETURN jsonb_build_object('error', 'Therapist is not working on this date');
  END IF;

  -- Atomically: clear existing lead for this date, then set new one
  UPDATE public.shifts
  SET lead_user_id = NULL
  WHERE schedule_block_id = p_schedule_block_id
    AND shift_date         = p_shift_date;

  UPDATE public.shifts
  SET lead_user_id = p_lead_user_id
  WHERE id = v_shift_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

-- ──────────────────────────────────────────────────
-- pg_cron: auto-expire swap requests every hour
-- Requires the pg_cron extension (enabled by default on Supabase Pro;
-- on free tier: Dashboard → Database → Extensions → enable pg_cron first)
-- ──────────────────────────────────────────────────
SELECT cron.schedule(
  'expire-swap-requests',
  '0 * * * *',
  $$
    UPDATE public.swap_requests
    SET status = 'expired'
    WHERE status = 'pending'
      AND expires_at < now();
  $$
);
```

- [ ] **Step 1.2: Apply the migration in Supabase Dashboard**

Go to Supabase Dashboard → SQL Editor → paste the migration and run it.

If pg_cron is not available on your plan, omit the `cron.schedule(...)` block — the swap expiry logic will still work via a fallback filter in the API (`status = 'pending' AND expires_at >= now()`).

- [ ] **Step 1.3: Add swap_requests to database.types.ts**

In `lib/types/database.types.ts`, inside the `Tables` object after `prn_shift_interest`, add:

```typescript
      swap_requests: {
        Row: {
          id: string
          schedule_block_id: string
          requester_id: string
          requester_shift_id: string
          partner_id: string
          partner_shift_id: string
          is_cross_shift: boolean
          status: 'pending' | 'approved' | 'rejected' | 'expired'
          expires_at: string
          request_note: string | null
          response_note: string | null
          created_at: string
          actioned_at: string | null
          actioned_by: string | null
        }
        Insert: Omit<
          Database['public']['Tables']['swap_requests']['Row'],
          'id' | 'created_at'
        >
        Update: Partial<
          Database['public']['Tables']['swap_requests']['Insert']
        >
      }
```

Also add `assign_lead` to the `Functions` object in `database.types.ts`:

```typescript
      assign_lead: {
        Args: {
          p_schedule_block_id: string
          p_shift_date: string
          p_lead_user_id: string | null
        }
        Returns: { success?: boolean; error?: string }
      }
```

- [ ] **Step 1.4: Run tests to confirm nothing broke**

```bash
npm test
```

Expected: all 55 tests pass.

- [ ] **Step 1.5: Commit**

```bash
git add supabase/migrations/003_phase4_swaps.sql lib/types/database.types.ts
git commit -m "feat: phase4 migration — swap_requests table, assign_lead RPC, pg_cron expiry"
```

---

## Task 2: Lead Assignment Pure Helpers + Unit Tests

**Files:**
- Create: `lib/schedule/lead-assignment.ts`
- Create: `tests/unit/lead-assignment.test.ts`

- [ ] **Step 2.1: Write the failing tests first**

```typescript
// tests/unit/lead-assignment.test.ts
import { describe, it, expect } from 'vitest'
import { isLeadEligible, getLeadGapDates } from '@/lib/schedule/lead-assignment'

describe('isLeadEligible', () => {
  it('returns true when qualified and working', () => {
    expect(isLeadEligible('u1', true, ['u1', 'u2'])).toBe(true)
  })
  it('returns false when not qualified', () => {
    expect(isLeadEligible('u1', false, ['u1', 'u2'])).toBe(false)
  })
  it('returns false when not working on that date', () => {
    expect(isLeadEligible('u1', true, ['u2', 'u3'])).toBe(false)
  })
})

describe('getLeadGapDates', () => {
  it('returns dates with working shifts but no lead', () => {
    const shifts = [
      { shift_date: '2026-04-01', cell_state: 'working', lead_user_id: null },
      { shift_date: '2026-04-01', cell_state: 'working', lead_user_id: null },
      { shift_date: '2026-04-02', cell_state: 'working', lead_user_id: 'u1' },
      { shift_date: '2026-04-03', cell_state: 'off',     lead_user_id: null },
    ]
    expect(getLeadGapDates(shifts)).toEqual(['2026-04-01'])
  })
  it('returns empty when all working dates have a lead', () => {
    const shifts = [
      { shift_date: '2026-04-01', cell_state: 'working', lead_user_id: 'u1' },
      { shift_date: '2026-04-01', cell_state: 'working', lead_user_id: null },
    ]
    expect(getLeadGapDates(shifts)).toEqual([])
  })
  it('ignores dates where no one is working', () => {
    const shifts = [
      { shift_date: '2026-04-01', cell_state: 'off', lead_user_id: null },
    ]
    expect(getLeadGapDates(shifts)).toEqual([])
  })
})
```

- [ ] **Step 2.2: Run tests to confirm they fail**

```bash
npm test -- lead-assignment
```

Expected: FAIL (module not found).

- [ ] **Step 2.3: Implement the helpers**

```typescript
// lib/schedule/lead-assignment.ts

/**
 * Whether a therapist is eligible to be assigned as lead on a given date.
 * @param userId - the candidate's user id
 * @param isLeadQualified - from users.is_lead_qualified
 * @param workingUserIds - user_ids with cell_state='working' on this date in this block
 */
export function isLeadEligible(
  userId: string,
  isLeadQualified: boolean,
  workingUserIds: string[]
): boolean {
  return isLeadQualified && workingUserIds.includes(userId)
}

type ShiftSummary = {
  shift_date: string
  cell_state: string
  lead_user_id: string | null
}

/**
 * Returns the sorted list of dates that have at least one Working shift
 * but no lead assignment (lead_user_id IS NULL on all shifts for that date).
 */
export function getLeadGapDates(shifts: ShiftSummary[]): string[] {
  const dateMap = new Map<string, { hasWorking: boolean; hasLead: boolean }>()

  for (const s of shifts) {
    const entry = dateMap.get(s.shift_date) ?? { hasWorking: false, hasLead: false }
    if (s.cell_state === 'working') entry.hasWorking = true
    if (s.lead_user_id !== null) entry.hasLead = true
    dateMap.set(s.shift_date, entry)
  }

  return Array.from(dateMap.entries())
    .filter(([, v]) => v.hasWorking && !v.hasLead)
    .map(([date]) => date)
    .sort()
}
```

- [ ] **Step 2.4: Run tests to confirm they pass**

```bash
npm test -- lead-assignment
```

Expected: all 5 lead-assignment tests pass.

- [ ] **Step 2.5: Commit**

```bash
git add lib/schedule/lead-assignment.ts tests/unit/lead-assignment.test.ts
git commit -m "feat: lead assignment pure helpers with unit tests"
```

---

## Task 3: Swap Request Pure Helpers + Unit Tests

**Files:**
- Create: `lib/schedule/swap-requests.ts`
- Create: `tests/unit/swap-requests.test.ts`

- [ ] **Step 3.1: Write the failing tests**

```typescript
// tests/unit/swap-requests.test.ts
import { describe, it, expect } from 'vitest'
import { isSwapAllowed, swapExpiryDate } from '@/lib/schedule/swap-requests'

describe('isSwapAllowed', () => {
  it('allows swaps on preliminary blocks', () => {
    expect(isSwapAllowed('preliminary')).toBe(true)
  })
  it('allows swaps on final blocks', () => {
    expect(isSwapAllowed('final')).toBe(true)
  })
  it('allows swaps on active blocks', () => {
    expect(isSwapAllowed('active')).toBe(true)
  })
  it('disallows swaps on preliminary_draft blocks', () => {
    expect(isSwapAllowed('preliminary_draft')).toBe(false)
  })
  it('disallows swaps on completed blocks', () => {
    expect(isSwapAllowed('completed')).toBe(false)
  })
})

describe('swapExpiryDate', () => {
  it('returns a date 48 hours in the future', () => {
    const base = new Date('2026-04-01T10:00:00Z')
    const expiry = swapExpiryDate(base)
    expect(expiry.toISOString()).toBe('2026-04-03T10:00:00.000Z')
  })
})
```

- [ ] **Step 3.2: Run tests to confirm they fail**

```bash
npm test -- swap-requests
```

Expected: FAIL (module not found).

- [ ] **Step 3.3: Implement the helpers**

```typescript
// lib/schedule/swap-requests.ts

/** Swaps can be submitted on Preliminary, Final, or Active blocks only. */
export function isSwapAllowed(blockStatus: string): boolean {
  return blockStatus === 'preliminary' || blockStatus === 'final' || blockStatus === 'active'
}

/** Returns a Date 48 hours from `from` (defaults to now). */
export function swapExpiryDate(from: Date = new Date()): Date {
  return new Date(from.getTime() + 48 * 60 * 60 * 1000)
}
```

- [ ] **Step 3.4: Run all tests**

```bash
npm test
```

Expected: all tests pass (55 + new swap/lead tests).

- [ ] **Step 3.5: Commit**

```bash
git add lib/schedule/swap-requests.ts tests/unit/swap-requests.test.ts
git commit -m "feat: swap request pure helpers with unit tests"
```

---

## Task 4: Lead Assignment Server Action

**Files:**
- Create: `app/actions/lead-assignment.ts`

- [ ] **Step 4.1: Create the server action**

```typescript
// app/actions/lead-assignment.ts
'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getServerUser } from '@/lib/auth'

/**
 * Manager assigns (or clears) the lead for a given date in a block.
 * Validation is server-side via the assign_lead RPC.
 * Pass leadUserId = null to clear the lead without assigning a new one.
 */
export async function assignLead(
  blockId: string,
  shiftDate: string,
  leadUserId: string | null
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
  const { data, error } = await (supabase as any).rpc('assign_lead', {
    p_schedule_block_id: blockId,
    p_shift_date: shiftDate,
    p_lead_user_id: leadUserId,
  })

  if (error) return { error: error.message }
  if (data?.error) return { error: data.error }

  revalidatePath('/schedule')
  revalidatePath('/coverage')
  return {}
}
```

- [ ] **Step 4.2: Run tests**

```bash
npm test
```

Expected: all tests still pass.

- [ ] **Step 4.3: Commit**

```bash
git add app/actions/lead-assignment.ts
git commit -m "feat: assignLead server action calling assign_lead RPC"
```

---

## Task 5: Lead UI — Grid Pink Gap Indicator + CellPanel Lead Dropdown

**Files:**
- Modify: `components/schedule/GridCell.tsx`
- Modify: `components/schedule/ScheduleGrid.tsx`
- Modify: `components/schedule/CellPanel.tsx`

### Step 5.1 — GridCell: add pink gap indicator

The yellow badge already exists. Add a pink dot on Working cells on dates where no lead is assigned.

- [ ] **Step 5.1a: Modify GridCell.tsx**

Add `dateHasLead?: boolean` to Props interface. Add the pink indicator:

```tsx
// components/schedule/GridCell.tsx
import { cn } from '@/lib/utils'
import { cellStateClass, cellStateLabel } from '@/lib/schedule/cell-state'
import type { Database } from '@/lib/types/database.types'

type Shift = Database['public']['Tables']['shifts']['Row']

interface Props {
  shift: Shift | undefined
  onClick: (shift: Shift | undefined, date: string) => void
  date: string
  isConflicted?: boolean
  dateHasLead?: boolean   // NEW
}

export function GridCell({ shift, onClick, date, isConflicted = false, dateHasLead = true }: Props) {
  const state = shift?.cell_state ?? 'off'
  const isLead = !!shift?.lead_user_id
  const showLeadGap = state === 'working' && !dateHasLead

  return (
    <button
      onClick={() => onClick(shift, date)}
      className={cn(
        'relative h-9 text-xs flex items-center justify-center border border-white/20',
        'transition-opacity hover:opacity-80 focus:outline-none focus:ring-1 focus:ring-slate-400',
        cellStateClass(state),
        isConflicted && 'ring-2 ring-inset ring-amber-400'
      )}
      aria-label={`${date}: ${state}${isConflicted ? ' (conflict)' : ''}${showLeadGap ? ' (no lead)' : ''}`}
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
    </button>
  )
}
```

### Step 5.2 — ScheduleGrid: compute leadDates, leadCandidates, handleLeadUpdate

- [ ] **Step 5.2a: Add leadDates computation and handleLeadUpdate**

In `ScheduleGrid.tsx`, add the following after the existing `shiftIndex` useMemo:

```typescript
// Dates where at least one shift has lead_user_id set
const leadDates = useMemo(() => {
  const s = new Set<string>()
  for (const sh of shifts) {
    if (sh.lead_user_id !== null) s.add(sh.shift_date)
  }
  return s
}, [shifts])

// Current lead user_id per date
const currentLeadByDate = useMemo(() => {
  const m = new Map<string, string>()
  for (const sh of shifts) {
    if (sh.lead_user_id !== null) m.set(sh.shift_date, sh.lead_user_id)
  }
  return m
}, [shifts])
```

Add `panelLeadCandidates` and `panelCurrentLeadUserId` state:

```typescript
const [panelLeadCandidates, setPanelLeadCandidates] = useState<UserRow[]>([])
const [panelCurrentLeadUserId, setPanelCurrentLeadUserId] = useState<string | null>(null)
```

Update `handleCellClick` to compute candidates for the opened date:

```typescript
function handleCellClick(shift: Shift | undefined, date: string, user: UserRow) {
  const currentShift = shift ? shifts.find(s => s.id === shift.id) ?? shift : undefined
  setPanelShift(currentShift)
  setPanelDate(date)
  setPanelUser(user)
  setPanelOpen(true)

  // Compute lead candidates: lead-qualified AND working on this date
  const candidates = therapists.filter(t =>
    t.is_lead_qualified &&
    shiftIndex.get(`${t.id}:${date}`)?.cell_state === 'working'
  )
  setPanelLeadCandidates(candidates)
  setPanelCurrentLeadUserId(currentLeadByDate.get(date) ?? null)
}
```

Add `handleLeadUpdate` (optimistic update — clears all leads for date, sets new one):

```typescript
const handleLeadUpdate = useCallback((date: string, newLeadUserId: string | null) => {
  setShifts(prev => prev.map(s => {
    if (s.shift_date !== date) return s
    if (newLeadUserId === null) return { ...s, lead_user_id: null }
    return { ...s, lead_user_id: s.user_id === newLeadUserId ? newLeadUserId : null }
  }))
  setPanelCurrentLeadUserId(newLeadUserId)
}, [])
```

Pass the new props to CellPanel:

```tsx
<CellPanel
  open={panelOpen}
  onClose={() => setPanelOpen(false)}
  shift={panelShift}
  date={panelDate ?? ''}
  user={panelUser}
  userRole={userRole}
  onCellStateUpdate={handleCellStateUpdate}
  blockStatus={blockStatus}
  blockId={blockId}
  currentUserId={currentUserId}
  leadCandidates={panelLeadCandidates}
  currentLeadUserId={panelCurrentLeadUserId}
  onLeadUpdate={handleLeadUpdate}
/>
```

Pass `dateHasLead` to each GridCell:

```tsx
<GridCell
  key={date}
  shift={getShift(therapist.id, date)}
  date={date}
  onClick={(shift, d) => handleCellClick(shift, d, therapist)}
  isConflicted={conflictedCells?.has(`${therapist.id}:${date}`) ?? false}
  dateHasLead={leadDates.has(date)}
/>
```

(Apply to both the FT and PRN therapist map calls.)

### Step 5.3 — CellPanel: interactive lead dropdown for managers

- [ ] **Step 5.3a: Update CellPanel props and lead section**

Add new imports and props:

```typescript
import { assignLead } from '@/app/actions/lead-assignment'

// New in Props interface:
leadCandidates: UserRow[]
currentLeadUserId: string | null
onLeadUpdate: (date: string, newLeadUserId: string | null) => void
```

Replace the existing display-only lead section (the `{state === 'working' && (...)}` block at lines 123–135) with:

```tsx
{/* Lead / Charge — interactive for managers on editable blocks */}
{state === 'working' && (
  <div>
    <span className="block text-sm font-medium text-slate-700 mb-2">Lead / Charge</span>
    {userRole === 'manager' && canEditCell(blockStatus, userRole) ? (
      <select
        value={currentLeadUserId ?? ''}
        disabled={isPending}
        onChange={e => {
          const newId = e.target.value || null
          onLeadUpdate(date, newId)
          startTransition(async () => {
            const result = await assignLead(blockId, date, newId)
            if (result.error) {
              // revert optimistic update
              onLeadUpdate(date, currentLeadUserId)
              setEditError(result.error)
            }
          })
        }}
        className="w-full text-sm border border-slate-200 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-slate-400 disabled:opacity-50"
      >
        <option value="">— None —</option>
        {leadCandidates.map(c => (
          <option key={c.id} value={c.id}>{c.full_name}</option>
        ))}
      </select>
    ) : (
      currentLeadUserId ? (
        <Badge className="bg-yellow-100 text-yellow-800 border-yellow-200">Assigned ✓</Badge>
      ) : (
        <span className="text-sm text-slate-400">Not assigned</span>
      )
    )}
  </div>
)}
```

- [ ] **Step 5.4: Run tests**

```bash
npm test
```

Expected: all tests pass (no new TypeScript-visible tests for UI components).

- [ ] **Step 5.5: Manual smoke test**

```bash
npm run dev
```

Log in as manager. Open a preliminary_draft or preliminary block. Click a Working cell. Confirm:
- Lead dropdown appears with only lead-qualified working therapists listed
- Selecting one fires the RPC, yellow badge appears on that cell
- Pink dot appears on Working cells for dates with no lead
- Pink dot disappears after assigning a lead to a date

- [ ] **Step 5.6: Commit**

```bash
git add components/schedule/GridCell.tsx components/schedule/ScheduleGrid.tsx components/schedule/CellPanel.tsx
git commit -m "feat: lead assignment dropdown in CellPanel + pink gap indicator on GridCell"
```

---

## Task 6: Lead Gap Warning on Publish

**Files:**
- Modify: `app/(app)/schedule/page.tsx`
- Modify: `components/schedule/BlockStatusActions.tsx`

The "Publish as Final" button should warn the manager if any shift dates are missing a lead.

- [ ] **Step 6.1: Compute leadGapDates in schedule/page.tsx**

In `app/(app)/schedule/page.tsx`, after the `shifts` constant is defined, add:

```typescript
import { getLeadGapDates } from '@/lib/schedule/lead-assignment'

// ... after: const shifts = (shiftsData ?? []) as ShiftRow[]
const leadGapDates = getLeadGapDates(shifts)
```

Pass to `BlockStatusActions`:

```tsx
<BlockStatusActions
  block={block}
  userRole={profile.role as 'manager' | 'therapist'}
  leadGapDates={leadGapDates}
/>
```

- [ ] **Step 6.2: Add lead gap dialog to BlockStatusActions.tsx**

Add `leadGapDates: string[]` to the Props interface.

Add `confirmingPublish` state:

```typescript
const [confirmingPublish, setConfirmingPublish] = useState(false)
```

Update the "Publish as Final" button to check for gaps first:

```tsx
{canPublishFinal(block.status) && (
  <>
    <Link
      href={`/schedule/inbox?blockId=${block.id}`}
      className="px-3 py-1.5 text-sm border border-slate-300 text-slate-700 rounded-md hover:bg-slate-50"
    >
      View Inbox
    </Link>

    {confirmingPublish ? (
      <div className="flex items-center gap-2 p-2 bg-pink-50 border border-pink-200 rounded-md">
        <span className="text-xs text-pink-800">
          {leadGapDates.length} date{leadGapDates.length !== 1 ? 's' : ''} missing a lead.
          Publish anyway?
        </span>
        <button
          onClick={() => { setConfirmingPublish(false); handlePostFinal() }}
          disabled={isPending}
          className="px-2 py-1 text-xs bg-green-700 text-white rounded hover:bg-green-800 disabled:opacity-50"
        >
          Yes, publish
        </button>
        <button
          onClick={() => setConfirmingPublish(false)}
          className="px-2 py-1 text-xs border border-slate-300 rounded hover:bg-slate-50"
        >
          Cancel
        </button>
      </div>
    ) : (
      <button
        onClick={() => {
          if (leadGapDates.length > 0) {
            setConfirmingPublish(true)
          } else {
            handlePostFinal()
          }
        }}
        disabled={isPending}
        className="px-3 py-1.5 text-sm bg-green-700 text-white rounded-md hover:bg-green-800 disabled:opacity-50"
      >
        {isPending ? 'Publishing…' : 'Publish as Final'}
      </button>
    )}
  </>
)}
```

- [ ] **Step 6.3: Run tests**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 6.4: Manual smoke test**

Log in as manager, open a preliminary block, click "Publish as Final" with some dates missing a lead. Confirm the dialog appears listing the gap count. Click "Cancel" — no publish. Click "Yes, publish" — publishes.

- [ ] **Step 6.5: Commit**

```bash
git add "app/(app)/schedule/page.tsx" components/schedule/BlockStatusActions.tsx
git commit -m "feat: lead gap warning dialog before Publish as Final"
```

---

## Task 7: Bulk Lead Assignment

**Files:**
- Create: `components/schedule/BulkLeadModal.tsx`
- Modify: `components/schedule/ScheduleGrid.tsx`

The bulk assign modal lets a manager pick one lead and apply them to multiple dates in a single action.

- [ ] **Step 7.1: Create BulkLeadModal.tsx**

```tsx
// components/schedule/BulkLeadModal.tsx
'use client'
import { useState, useTransition } from 'react'
import { format } from 'date-fns'
import { assignLead } from '@/app/actions/lead-assignment'
import type { Database } from '@/lib/types/database.types'

type UserRow = Database['public']['Tables']['users']['Row']

interface Props {
  blockId: string
  gapDates: string[]         // dates missing a lead
  leadQualified: UserRow[]   // all lead-qualified therapists
  onClose: () => void
  onComplete: () => void     // trigger revalidation in parent
}

function fmtDate(d: string) {
  return format(new Date(d + 'T00:00:00'), 'EEE MMM d')
}

export function BulkLeadModal({ blockId, gapDates, leadQualified, onClose, onComplete }: Props) {
  const [selectedLead, setSelectedLead] = useState<string>('')
  const [selectedDates, setSelectedDates] = useState<Set<string>>(new Set(gapDates))
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function toggleDate(date: string) {
    setSelectedDates(prev => {
      const next = new Set(prev)
      if (next.has(date)) next.delete(date)
      else next.add(date)
      return next
    })
  }

  function handleSubmit() {
    if (!selectedLead || selectedDates.size === 0) return
    setError(null)
    startTransition(async () => {
      const dates = Array.from(selectedDates)
      const results = await Promise.all(
        dates.map(d => assignLead(blockId, d, selectedLead))
      )
      const firstError = results.find(r => r.error)
      if (firstError?.error) {
        setError(firstError.error)
      } else {
        onComplete()
        onClose()
      }
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-6 space-y-4">
        <h2 className="text-base font-semibold text-slate-900">Bulk Assign Lead</h2>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Lead to assign</label>
          <select
            value={selectedLead}
            onChange={e => setSelectedLead(e.target.value)}
            className="w-full text-sm border border-slate-200 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-slate-400"
          >
            <option value="">— Select therapist —</option>
            {leadQualified.map(t => (
              <option key={t.id} value={t.id}>{t.full_name}</option>
            ))}
          </select>
        </div>

        <div>
          <span className="block text-sm font-medium text-slate-700 mb-1">
            Dates to assign ({selectedDates.size} selected)
          </span>
          <div className="max-h-48 overflow-y-auto space-y-1 border border-slate-200 rounded-md p-2">
            {gapDates.length === 0 ? (
              <p className="text-xs text-slate-400">No gap dates — all dates have a lead.</p>
            ) : (
              gapDates.map(d => (
                <label key={d} className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedDates.has(d)}
                    onChange={() => toggleDate(d)}
                    className="accent-slate-900"
                  />
                  {fmtDate(d)}
                </label>
              ))
            )}
          </div>
        </div>

        {error && <p className="text-xs text-red-600">{error}</p>}

        <div className="flex gap-2 justify-end">
          <button
            type="button"
            onClick={onClose}
            className="py-1.5 px-3 text-sm border border-slate-200 rounded-md hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isPending || !selectedLead || selectedDates.size === 0}
            className="py-1.5 px-4 text-sm bg-slate-900 text-white rounded-md hover:bg-slate-800 disabled:opacity-50"
          >
            {isPending ? 'Assigning…' : `Assign to ${selectedDates.size} date${selectedDates.size !== 1 ? 's' : ''}`}
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 7.2: Add Bulk Assign button to ScheduleGrid**

In `ScheduleGrid.tsx`, add state and imports:

```typescript
import { BulkLeadModal } from './BulkLeadModal'
import { getLeadGapDates } from '@/lib/schedule/lead-assignment'

// New state:
const [showBulkModal, setShowBulkModal] = useState(false)
```

Compute gap dates and lead-qualified list from existing data:

```typescript
const leadGapDates = useMemo(
  () => getLeadGapDates(shifts),
  [shifts]
)

const leadQualifiedTherapists = useMemo(
  () => therapists.filter(t => t.is_lead_qualified),
  [therapists]
)
```

Add a "Bulk Assign Lead" button to the grid controls section (only for managers on editable blocks), and render the modal:

```tsx
{/* In the controls div, after ShiftToggle: */}
{userRole === 'manager' && canEditCell(blockStatus, userRole) && (
  <button
    type="button"
    onClick={() => setShowBulkModal(true)}
    className="px-3 py-1 text-xs border border-slate-300 text-slate-700 rounded-md hover:bg-slate-50"
  >
    Bulk Assign Lead {leadGapDates.length > 0 && `(${leadGapDates.length} gaps)`}
  </button>
)}

{/* At the bottom of the returned JSX, before closing </div>: */}
{showBulkModal && (
  <BulkLeadModal
    blockId={block.id}
    gapDates={leadGapDates}
    leadQualified={leadQualifiedTherapists}
    onClose={() => setShowBulkModal(false)}
    onComplete={() => setShifts(prev => [...prev])} // trigger re-memo; page will revalidate via action
  />
)}
```

Note: `canEditCell` import needs to be added to ScheduleGrid.tsx:
```typescript
import { canEditCell } from '@/lib/schedule/block-status'
```

- [ ] **Step 7.3: Run tests**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 7.4: Commit**

```bash
git add components/schedule/BulkLeadModal.tsx components/schedule/ScheduleGrid.tsx
git commit -m "feat: bulk lead assignment modal for gap dates"
```

---

## Task 8: Swap Actions

**Files:**
- Create: `app/actions/swap-requests.ts`

- [ ] **Step 8.1: Create the swap actions**

```typescript
// app/actions/swap-requests.ts
'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getServerUser } from '@/lib/auth'
import { isSwapAllowed, swapExpiryDate } from '@/lib/schedule/swap-requests'

/**
 * Therapist submits a swap request.
 * requesterShiftId: the requester's Working shift they offer
 * partnerShiftId: the partner's Working shift the requester wants
 */
export async function submitSwap(
  blockId: string,
  requesterShiftId: string,
  partnerShiftId: string,
  requestNote: string | null
): Promise<{ error?: string }> {
  const user = await getServerUser()
  if (!user) return { error: 'Not authenticated' }

  const supabase = createClient()

  // Validate block status
  const { data: block } = await supabase
    .from('schedule_blocks')
    .select('status')
    .eq('id', blockId)
    .single() as { data: { status: string } | null; error: unknown }
  if (!block) return { error: 'Block not found' }
  if (!isSwapAllowed(block.status)) return { error: 'Swaps are not allowed for this block status' }

  // Validate requester shift belongs to this user and is working
  const { data: reqShift } = await supabase
    .from('shifts')
    .select('id, user_id, cell_state, shift_date, is_cross_shift, schedule_block_id')
    .eq('id', requesterShiftId)
    .single() as { data: { id: string; user_id: string; cell_state: string; shift_date: string; is_cross_shift: boolean; schedule_block_id: string } | null; error: unknown }
  if (!reqShift) return { error: 'Shift not found' }
  if (reqShift.user_id !== user.id) return { error: 'You can only swap your own shifts' }
  if (reqShift.cell_state !== 'working') return { error: 'You can only swap a Working shift' }
  if (reqShift.schedule_block_id !== blockId) return { error: 'Shift does not belong to this block' }

  // Validate partner shift exists and is working
  const { data: partnerShift } = await supabase
    .from('shifts')
    .select('id, user_id, cell_state, is_cross_shift, schedule_block_id')
    .eq('id', partnerShiftId)
    .single() as { data: { id: string; user_id: string; cell_state: string; is_cross_shift: boolean; schedule_block_id: string } | null; error: unknown }
  if (!partnerShift) return { error: 'Partner shift not found' }
  if (partnerShift.cell_state !== 'working') return { error: 'Partner must be working on that date' }
  if (partnerShift.schedule_block_id !== blockId) return { error: 'Partner shift does not belong to this block' }
  if (partnerShift.user_id === user.id) return { error: 'Cannot swap with yourself' }

  const isCrossShift = reqShift.is_cross_shift || partnerShift.is_cross_shift

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from('swap_requests')
    .insert({
      schedule_block_id: blockId,
      requester_id: user.id,
      requester_shift_id: requesterShiftId,
      partner_id: partnerShift.user_id,
      partner_shift_id: partnerShiftId,
      is_cross_shift: isCrossShift,
      status: 'pending',
      expires_at: swapExpiryDate().toISOString(),
      request_note: requestNote || null,
    })

  if (error) return { error: error.message }

  revalidatePath('/swaps')
  revalidatePath('/schedule')
  return {}
}

/**
 * Manager approves or rejects a swap request.
 * On approval: swaps the cell_states of the two shifts and clears lead if requester was lead.
 */
export async function resolveSwap(
  swapId: string,
  decision: 'approved' | 'rejected',
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
  const { data: swap } = await (supabase as any)
    .from('swap_requests')
    .select('requester_id, partner_id, requester_shift_id, partner_shift_id, status, schedule_block_id')
    .eq('id', swapId)
    .single() as {
      data: {
        requester_id: string; partner_id: string
        requester_shift_id: string; partner_shift_id: string
        status: string; schedule_block_id: string
      } | null; error: unknown
    }
  if (!swap) return { error: 'Swap request not found' }
  if (swap.status !== 'pending') return { error: 'Swap is no longer pending' }

  // Update swap status
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: updateErr } = await (supabase as any)
    .from('swap_requests')
    .update({
      status: decision,
      response_note: responseNote || null,
      actioned_at: new Date().toISOString(),
      actioned_by: user.id,
    })
    .eq('id', swapId)
  if (updateErr) return { error: updateErr.message }

  if (decision === 'approved') {
    // Fetch both shifts to get dates and lead info
    const { data: reqShift } = await supabase
      .from('shifts')
      .select('id, user_id, shift_date, lead_user_id, schedule_block_id')
      .eq('id', swap.requester_shift_id)
      .single() as { data: { id: string; user_id: string; shift_date: string; lead_user_id: string | null; schedule_block_id: string } | null; error: unknown }

    const { data: partShift } = await supabase
      .from('shifts')
      .select('id, user_id, shift_date')
      .eq('id', swap.partner_shift_id)
      .single() as { data: { id: string; user_id: string; shift_date: string } | null; error: unknown }

    if (!reqShift || !partShift) return { error: 'Could not fetch shift details' }

    // Swap the cell_states: requester's shift → off, partner's shift → off
    // requester gets partner's date → working; partner gets requester's date → working
    const reqGivesDate = reqShift.shift_date
    const partGivesDate = partShift.shift_date

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any).from('shifts').update({ cell_state: 'off' }).eq('id', swap.requester_shift_id)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any).from('shifts').update({ cell_state: 'off' }).eq('id', swap.partner_shift_id)

    // Requester gains partner's date — find their shift row for that date
    const { data: reqGainsShift } = await supabase
      .from('shifts')
      .select('id')
      .eq('schedule_block_id', reqShift.schedule_block_id)
      .eq('user_id', swap.requester_id)
      .eq('shift_date', partGivesDate)
      .single() as { data: { id: string } | null; error: unknown }

    if (reqGainsShift) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase as any).from('shifts').update({ cell_state: 'working' }).eq('id', reqGainsShift.id)
    }

    // Partner gains requester's date — find their shift row for that date
    const { data: partGainsShift } = await supabase
      .from('shifts')
      .select('id')
      .eq('schedule_block_id', reqShift.schedule_block_id)
      .eq('user_id', swap.partner_id)
      .eq('shift_date', reqGivesDate)
      .single() as { data: { id: string } | null; error: unknown }

    if (partGainsShift) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase as any).from('shifts').update({ cell_state: 'working' }).eq('id', partGainsShift.id)
    }

    // Swap-triggered lead flag: if requester was the lead on their given date, clear it
    if (reqShift.lead_user_id !== null) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase as any)
        .from('shifts')
        .update({ lead_user_id: null })
        .eq('schedule_block_id', reqShift.schedule_block_id)
        .eq('shift_date', reqGivesDate)
    }
  }

  revalidatePath('/swaps')
  revalidatePath('/schedule')
  return {}
}
```

- [ ] **Step 8.2: Run tests**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 8.3: Commit**

```bash
git add app/actions/swap-requests.ts
git commit -m "feat: submitSwap and resolveSwap server actions with lead flag on approval"
```

---

## Task 9: Swap Request Form in CellPanel

**Files:**
- Modify: `components/schedule/CellPanel.tsx`
- Modify: `components/schedule/ScheduleGrid.tsx`

The swap form appears on a therapist's own Working cell (or manager viewing therapist's cell). The therapist picks a partner and which of the partner's Working shifts to take.

- [ ] **Step 9.1: Pass workingShiftsByUser to CellPanel from ScheduleGrid**

In `ScheduleGrid.tsx`, compute a map of `userId → working shift ids with dates`:

```typescript
const workingShiftsByUser = useMemo(() => {
  const m = new Map<string, Array<{ shiftId: string; date: string }>>()
  for (const s of shifts) {
    if (s.cell_state === 'working') {
      const arr = m.get(s.user_id) ?? []
      arr.push({ shiftId: s.id, date: s.shift_date })
      m.set(s.user_id, arr)
    }
  }
  return m
}, [shifts])
```

Add `workingShiftsByUser` to CellPanel props.

- [ ] **Step 9.2: Add swap form to CellPanel**

Add imports and state:

```typescript
import { submitSwap } from '@/app/actions/swap-requests'
import { isSwapAllowed } from '@/lib/schedule/swap-requests'

// New props:
workingShiftsByUser: Map<string, Array<{ shiftId: string; date: string }>>

// New state:
const [showSwapForm, setShowSwapForm] = useState(false)
const [swapPartnerId, setSwapPartnerId] = useState('')
const [swapPartnerShiftId, setSwapPartnerShiftId] = useState('')
const [swapNote, setSwapNote] = useState('')
const [swapError, setSwapError] = useState<string | null>(null)
const [swapSuccess, setSwapSuccess] = useState(false)
```

Add the swap form section (render after the FT change request section):

```tsx
{/* Swap Request — own Working cell, on allowed block statuses */}
{shift &&
  state === 'working' &&
  user.id === currentUserId &&
  isSwapAllowed(blockStatus) && (
    <div className="mt-4 border-t border-slate-100 pt-4">
      {swapSuccess ? (
        <p className="text-sm text-green-700">Swap request submitted.</p>
      ) : showSwapForm ? (
        <div className="space-y-3">
          <span className="block text-sm font-medium text-slate-700">Request Swap</span>

          {/* Partner selector */}
          <div>
            <label className="block text-xs text-slate-500 mb-1">Swap with</label>
            <select
              value={swapPartnerId}
              onChange={e => { setSwapPartnerId(e.target.value); setSwapPartnerShiftId('') }}
              className="w-full text-sm border border-slate-200 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-slate-400"
            >
              <option value="">— Select therapist —</option>
              {Array.from(workingShiftsByUser.entries())
                .filter(([uid]) => uid !== currentUserId && workingShiftsByUser.get(uid)!.length > 0)
                .map(([uid, ws]) => {
                  // Find therapist name — we need user data here
                  // user prop is only the cell owner; partner name comes from the shift user_id
                  // Use uid as display fallback; ScheduleGrid can pass therapists array instead
                  return (
                    <option key={uid} value={uid}>{uid}</option>
                  )
                })
              }
            </select>
          </div>

          {/* Partner's working dates */}
          {swapPartnerId && (
            <div>
              <label className="block text-xs text-slate-500 mb-1">Take their date</label>
              <select
                value={swapPartnerShiftId}
                onChange={e => setSwapPartnerShiftId(e.target.value)}
                className="w-full text-sm border border-slate-200 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-slate-400"
              >
                <option value="">— Select date —</option>
                {(workingShiftsByUser.get(swapPartnerId) ?? []).map(ws => (
                  <option key={ws.shiftId} value={ws.shiftId}>
                    {format(new Date(ws.date + 'T00:00:00'), 'EEE, MMM d')}
                  </option>
                ))}
              </select>
            </div>
          )}

          <textarea
            value={swapNote}
            onChange={e => setSwapNote(e.target.value)}
            placeholder="Optional note…"
            rows={2}
            className="w-full text-sm border border-slate-200 rounded-md px-2 py-1.5 resize-none focus:outline-none focus:ring-2 focus:ring-slate-400"
          />

          {swapError && <p className="text-xs text-red-600">{swapError}</p>}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                if (!shift || !swapPartnerShiftId) return
                setSwapError(null)
                startTransition(async () => {
                  const result = await submitSwap(blockId, shift.id, swapPartnerShiftId, swapNote || null)
                  if (result.error) setSwapError(result.error)
                  else { setSwapSuccess(true); setShowSwapForm(false) }
                })
              }}
              disabled={isPending || !swapPartnerShiftId}
              className="flex-1 py-1.5 text-sm bg-slate-900 text-white rounded-md hover:bg-slate-800 disabled:opacity-50"
            >
              {isPending ? 'Submitting…' : 'Submit Swap Request'}
            </button>
            <button
              type="button"
              onClick={() => { setShowSwapForm(false); setSwapNote(''); setSwapPartnerId(''); setSwapPartnerShiftId('') }}
              className="py-1.5 px-3 text-sm border border-slate-200 rounded-md hover:bg-slate-50"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setShowSwapForm(true)}
          className="w-full py-2 text-sm border border-slate-300 text-slate-700 rounded-md hover:bg-slate-50"
        >
          Request Swap
        </button>
      )}
    </div>
  )}
```

**Important:** The partner dropdown shows user IDs. Fix this by passing `therapists` as a prop to CellPanel and looking up names:

In CellPanel props, add:
```typescript
allTherapists: UserRow[]
```

In ScheduleGrid, pass `allTherapists={therapists}` to CellPanel.

Then update the partner option rendering in the swap form:
```tsx
.map(([uid, ws]) => {
  const t = allTherapists.find(th => th.id === uid)
  return (
    <option key={uid} value={uid}>{t?.full_name ?? uid}</option>
  )
})
```

- [ ] **Step 9.3: Run tests**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 9.4: Commit**

```bash
git add components/schedule/CellPanel.tsx components/schedule/ScheduleGrid.tsx
git commit -m "feat: swap request form in CellPanel with partner and date selection"
```

---

## Task 10: Manager Swaps Page + SwapInbox Component

**Files:**
- Create: `app/(app)/swaps/page.tsx`
- Create: `components/swaps/SwapInbox.tsx`

- [ ] **Step 10.1: Create the server page**

```tsx
// app/(app)/swaps/page.tsx
import { redirect } from 'next/navigation'
import { getServerUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { SwapInbox } from '@/components/swaps/SwapInbox'

export default async function SwapsPage() {
  const user = await getServerUser()
  if (!user) redirect('/login')

  const supabase = createClient()

  const { data: profile } = await supabase
    .from('users')
    .select('role, department_id')
    .eq('id', user.id)
    .single() as { data: { role: string; department_id: string | null } | null; error: unknown }

  if (!profile || profile.role !== 'manager') redirect('/schedule')
  if (!profile.department_id) redirect('/schedule')

  // All pending swap requests for this department's blocks
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: swapsRaw } = await (supabase as any)
    .from('swap_requests')
    .select(`
      *,
      requester:requester_id(full_name),
      partner:partner_id(full_name),
      requester_shift:requester_shift_id(shift_date),
      partner_shift:partner_shift_id(shift_date),
      block:schedule_block_id(shift_type, start_date)
    `)
    .eq('status', 'pending')
    .order('created_at', { ascending: true })

  type SwapItem = {
    id: string
    is_cross_shift: boolean
    expires_at: string
    request_note: string | null
    requester: { full_name: string }
    partner: { full_name: string }
    requester_shift: { shift_date: string }
    partner_shift: { shift_date: string }
    block: { shift_type: string; start_date: string }
  }

  const swaps = (swapsRaw ?? []) as SwapItem[]

  return (
    <div className="max-w-2xl mx-auto py-6 px-4 space-y-4">
      <h1 className="text-lg font-semibold text-slate-900">Pending Swaps</h1>
      {swaps.length === 0 ? (
        <p className="text-sm text-slate-500">No pending swap requests.</p>
      ) : (
        <SwapInbox swaps={swaps} />
      )}
    </div>
  )
}
```

- [ ] **Step 10.2: Create SwapInbox.tsx**

```tsx
// components/swaps/SwapInbox.tsx
'use client'
import { useState, useTransition } from 'react'
import { format, formatDistanceToNow } from 'date-fns'
import { resolveSwap } from '@/app/actions/swap-requests'

function fmtDate(d: string) {
  return format(new Date(d + 'T00:00:00'), 'EEE, MMM d')
}

type SwapItem = {
  id: string
  is_cross_shift: boolean
  expires_at: string
  request_note: string | null
  requester: { full_name: string }
  partner: { full_name: string }
  requester_shift: { shift_date: string }
  partner_shift: { shift_date: string }
  block: { shift_type: string; start_date: string }
}

export function SwapInbox({ swaps }: { swaps: SwapItem[] }) {
  return (
    <div className="space-y-3">
      {swaps.map(s => <SwapItem key={s.id} swap={s} />)}
    </div>
  )
}

function SwapItem({ swap }: { swap: SwapItem }) {
  const [isPending, startTransition] = useTransition()
  const [note, setNote] = useState('')
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function handle(decision: 'approved' | 'rejected') {
    setError(null)
    startTransition(async () => {
      const result = await resolveSwap(swap.id, decision, note || null)
      if (result.error) setError(result.error)
      else setDone(true)
    })
  }

  const expiresIn = formatDistanceToNow(new Date(swap.expires_at), { addSuffix: true })

  if (done) {
    return (
      <div className="p-3 rounded-md border border-slate-200 bg-slate-50">
        <p className="text-xs text-slate-500">Resolved.</p>
      </div>
    )
  }

  return (
    <div className="p-4 rounded-md border border-slate-200 bg-white space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-slate-900">
            {swap.requester.full_name} ↔ {swap.partner.full_name}
          </p>
          <p className="text-xs text-slate-500">
            {fmtDate(swap.requester_shift.shift_date)} ↔ {fmtDate(swap.partner_shift.shift_date)}
            {' '}· {swap.block.shift_type} shift
          </p>
        </div>
        <div className="text-right shrink-0">
          {swap.is_cross_shift && (
            <span className="text-xs text-amber-700 border border-amber-200 bg-amber-50 px-1.5 py-0.5 rounded">
              Cross-shift
            </span>
          )}
          <p className="text-xs text-slate-400 mt-1">Expires {expiresIn}</p>
        </div>
      </div>

      {swap.request_note && (
        <p className="text-xs text-slate-600 italic">&ldquo;{swap.request_note}&rdquo;</p>
      )}

      <input
        type="text"
        value={note}
        onChange={e => setNote(e.target.value)}
        placeholder="Optional response note…"
        className="w-full text-xs border border-slate-200 rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-slate-400"
      />

      {error && <p className="text-xs text-red-600">{error}</p>}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => handle('approved')}
          disabled={isPending}
          className="flex-1 py-1.5 text-xs bg-green-700 text-white rounded hover:bg-green-800 disabled:opacity-50"
        >
          Approve
        </button>
        <button
          type="button"
          onClick={() => handle('rejected')}
          disabled={isPending}
          className="flex-1 py-1.5 text-xs border border-red-200 text-red-700 rounded hover:bg-red-50 disabled:opacity-50"
        >
          Reject
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 10.3: Create the `components/swaps/` directory structure**

(The Write tool will create it when you write the file above.)

- [ ] **Step 10.4: Run tests**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 10.5: Commit**

```bash
git add "app/(app)/swaps/page.tsx" components/swaps/SwapInbox.tsx
git commit -m "feat: manager swaps page with approve/reject SwapInbox"
```

---

## Task 11: Coverage Heatmap Page

**Files:**
- Create: `app/(app)/coverage/page.tsx`
- Create: `components/coverage/CoverageHeatmap.tsx`

- [ ] **Step 11.1: Create the server page**

```tsx
// app/(app)/coverage/page.tsx
import { redirect } from 'next/navigation'
import { getServerUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { CoverageHeatmap } from '@/components/coverage/CoverageHeatmap'
import Link from 'next/link'
import type { Database } from '@/lib/types/database.types'

type BlockRow = Database['public']['Tables']['schedule_blocks']['Row']
type ShiftRow = Database['public']['Tables']['shifts']['Row']
type HeadcountRow = Database['public']['Views']['shift_planned_headcount']['Row']

export default async function CoveragePage({
  searchParams,
}: {
  searchParams: { blockId?: string; shift?: string }
}) {
  const user = await getServerUser()
  if (!user) redirect('/login')

  const supabase = createClient()

  const { data: profile } = await supabase
    .from('users')
    .select('role, department_id')
    .eq('id', user.id)
    .single() as { data: { role: string; department_id: string | null } | null; error: unknown }

  if (!profile || profile.role !== 'manager') redirect('/schedule')
  if (!profile.department_id) redirect('/schedule')

  // Fetch blocks for the department
  const { data: blocksData } = await supabase
    .from('schedule_blocks')
    .select('*')
    .eq('department_id', profile.department_id)
    .in('status', ['preliminary_draft', 'preliminary', 'final', 'active', 'completed'])
    .order('start_date', { ascending: false })

  const allBlocks = (blocksData ?? []) as BlockRow[]

  const activeShift: 'day' | 'night' =
    searchParams.shift === 'night' ? 'night' : 'day'

  const blocksForShift = allBlocks.filter(b => b.shift_type === activeShift)
  let block: BlockRow | null = null
  if (searchParams.blockId) {
    block = blocksForShift.find(b => b.id === searchParams.blockId) ?? null
  }
  if (!block) block = blocksForShift[0] ?? null

  if (!block) {
    return (
      <div className="p-8 text-sm text-slate-500">
        No block found. <Link href="/schedule" className="underline">Back to Schedule</Link>
      </div>
    )
  }

  // Fetch headcount from the existing view
  const { data: headcountData } = await supabase
    .from('shift_planned_headcount')
    .select('*')
    .eq('schedule_block_id', block.id) as { data: HeadcountRow[] | null; error: unknown }

  // Fetch shifts to compute lead gaps (only need shift_date and lead_user_id)
  const { data: shiftsData } = await supabase
    .from('shifts')
    .select('shift_date, lead_user_id, cell_state')
    .eq('schedule_block_id', block.id) as {
      data: Pick<ShiftRow, 'shift_date' | 'lead_user_id' | 'cell_state'>[] | null
      error: unknown
    }

  // Pending swap count for the header stat
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { count: pendingSwapCount } = await (supabase as any)
    .from('swap_requests')
    .select('*', { count: 'exact', head: true })
    .eq('schedule_block_id', block.id)
    .eq('status', 'pending')

  const headcount = (headcountData ?? []) as HeadcountRow[]
  const shifts = (shiftsData ?? []) as Pick<ShiftRow, 'shift_date' | 'lead_user_id' | 'cell_state'>[]

  // Build lead-gap set (dates with working shifts but no lead)
  const leadDates = new Set(shifts.filter(s => s.lead_user_id !== null).map(s => s.shift_date))
  const workingDates = new Set(shifts.filter(s => s.cell_state === 'working').map(s => s.shift_date))
  const leadGapDates = new Set([...workingDates].filter(d => !leadDates.has(d)))

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-lg font-semibold text-slate-900">Coverage</h1>
        <div className="flex gap-4 text-sm text-slate-600">
          <span>Lead gaps: <strong className={leadGapDates.size > 0 ? 'text-pink-600' : 'text-green-600'}>{leadGapDates.size}</strong></span>
          <span>Pending swaps: <strong className={pendingSwapCount > 0 ? 'text-amber-600' : 'text-slate-600'}>{pendingSwapCount ?? 0}</strong></span>
        </div>
        <div className="flex gap-2">
          <Link
            href={`/coverage?blockId=${block.id}&shift=day`}
            className={`px-3 py-1 text-sm rounded-md border ${activeShift === 'day' ? 'bg-slate-900 text-white border-slate-900' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}
          >
            Day
          </Link>
          <Link
            href={`/coverage?blockId=${block.id}&shift=night`}
            className={`px-3 py-1 text-sm rounded-md border ${activeShift === 'night' ? 'bg-slate-900 text-white border-slate-900' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}
          >
            Night
          </Link>
        </div>
      </div>

      {/* Legend */}
      <div className="flex gap-4 text-xs text-slate-500">
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-red-200 inline-block" /> &lt;3 understaffed</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-yellow-200 inline-block" /> =3 minimum</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-green-200 inline-block" /> 4-5 optimal</span>
        <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-pink-400 inline-block" /> no lead</span>
      </div>

      <CoverageHeatmap
        headcount={headcount}
        leadGapDates={leadGapDates}
        blockStartDate={block.start_date}
      />
    </div>
  )
}
```

- [ ] **Step 11.2: Create CoverageHeatmap.tsx**

```tsx
// components/coverage/CoverageHeatmap.tsx
'use client'
import { useMemo } from 'react'
import { format, addDays } from 'date-fns'
import type { Database } from '@/lib/types/database.types'

type HeadcountRow = Database['public']['Views']['shift_planned_headcount']['Row']

interface Props {
  headcount: HeadcountRow[]
  leadGapDates: Set<string>
  blockStartDate: string
}

function cellBg(total: number): string {
  if (total < 3) return 'bg-red-100 text-red-800'
  if (total === 3) return 'bg-yellow-100 text-yellow-800'
  return 'bg-green-100 text-green-800'
}

export function CoverageHeatmap({ headcount, leadGapDates, blockStartDate }: Props) {
  const dates = useMemo(() => {
    const start = new Date(blockStartDate + 'T00:00:00')
    return Array.from({ length: 42 }, (_, i) => format(addDays(start, i), 'yyyy-MM-dd'))
  }, [blockStartDate])

  const byDate = useMemo(() => {
    const m = new Map<string, HeadcountRow>()
    for (const row of headcount) m.set(row.shift_date, row)
    return m
  }, [headcount])

  // Group into 6 weeks
  const weeks = Array.from({ length: 6 }, (_, i) => dates.slice(i * 7, i * 7 + 7))

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="min-w-max text-xs">
        <thead>
          <tr className="bg-slate-50 border-b border-slate-200">
            <th className="px-3 py-2 text-left text-slate-500 font-medium w-16">Date</th>
            <th className="px-2 py-2 text-center text-slate-500 font-medium">FT</th>
            <th className="px-2 py-2 text-center text-slate-500 font-medium">PRN</th>
            <th className="px-2 py-2 text-center text-slate-500 font-medium">Total</th>
            <th className="px-2 py-2 text-center text-slate-500 font-medium">Lead</th>
          </tr>
        </thead>
        <tbody>
          {dates.map(date => {
            const row = byDate.get(date)
            const total = row?.total_count ?? 0
            const hasLeadGap = leadGapDates.has(date)
            const hasWorking = total > 0

            return (
              <tr key={date} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/50">
                <td className="px-3 py-1.5 font-medium text-slate-700 whitespace-nowrap">
                  {format(new Date(date + 'T00:00:00'), 'EEE d MMM')}
                </td>
                <td className="px-2 py-1.5 text-center text-slate-600">{row?.ft_count ?? 0}</td>
                <td className="px-2 py-1.5 text-center text-slate-600">{row?.prn_count ?? 0}</td>
                <td className={`px-2 py-1.5 text-center font-semibold rounded ${hasWorking ? cellBg(total) : 'text-slate-400'}`}>
                  {total}
                </td>
                <td className="px-2 py-1.5 text-center">
                  {hasWorking ? (
                    hasLeadGap ? (
                      <span className="w-2 h-2 rounded-full bg-pink-400 inline-block" title="No lead assigned" />
                    ) : (
                      <span className="w-2 h-2 rounded-full bg-yellow-400 inline-block" title="Lead assigned" />
                    )
                  ) : null}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
```

- [ ] **Step 11.3: Run tests**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 11.4: Commit**

```bash
git add "app/(app)/coverage/page.tsx" components/coverage/CoverageHeatmap.tsx
git commit -m "feat: coverage heatmap page with lead gap overlay and headcount color coding"
```

---

## Task 12: Build Check + Final Smoke

**Files:**
- Verify: all modified files compile

- [ ] **Step 12.1: Run full test suite**

```bash
npm test
```

Expected: all tests pass. Test count should be higher than 55 (new lead-assignment and swap-requests tests added in Tasks 2 and 3).

- [ ] **Step 12.2: Production build**

```bash
npm run build
```

Fix any TypeScript or ESLint errors before continuing. Common issues to watch for:
- `(supabase as any)` without `eslint-disable-next-line` comment immediately before
- Missing `type="button"` on `<button>` elements inside forms
- Unescaped `"` in JSX — use `&ldquo;` / `&rdquo;`
- `schedule_blocks` `.update()` returning `never` — use `(supabase as any)` pattern (see existing pattern in `app/actions/schedule.ts`)
- CellPanel props interface must match all props passed from ScheduleGrid

Expected routes in build output:
```
├── /coverage
├── /swaps
```

- [ ] **Step 12.3: Final commit**

```bash
git add .
git commit -m "feat: phase 4 complete — lead assignment, swap requests, coverage heatmap"
```

---

## Phase 4 Definition of Done

- [ ] Manager can assign a lead from any Working cell — yellow badge appears, pink gap dot disappears
- [ ] "Publish as Final" shows a dialog listing gap dates when any date has no lead
- [ ] "Bulk Assign Lead" opens a modal, selects lead + dates, assigns in one action
- [ ] Therapist can submit a swap request from their own Working cell
- [ ] Manager `/swaps` page shows pending requests with Approve/Reject; Approve swaps the two cell_states and clears lead if requester was the lead
- [ ] `/coverage` heatmap shows color-coded totals per date, pink dot for lead gaps, pending swap count in header
- [ ] All tests pass, `npm run build` exits 0
