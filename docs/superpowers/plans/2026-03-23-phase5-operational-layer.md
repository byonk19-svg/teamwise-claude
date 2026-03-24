# Phase 5: Operational Layer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable lead/charge therapists to log OC/CI/CX/LE codes in 3 taps on their phone mid-shift, with live actual headcount, coverage alerts when actual drops below 3, and a full exportable audit log for completed blocks.

**Architecture:** A new `operational_entries` table stores all code entries (with soft-delete via `removed_at`). A `shift_actual_headcount` DB view computes planned and actual headcount per date using EXISTS subqueries (never in JavaScript). Block auto-transitions to `active` via a pg_cron daily job. Actual headcount is only shown on the Coverage page for active/completed blocks. A Supabase Realtime subscription in `AlertBanner` fires a client-side alert when actual drops below 3. The mobile schedule view is a separate `WeekView` component shown below the `md` breakpoint; it renders 7 columns and shares the same `CellPanel` as the desktop grid. CSV export is generated client-side from the audit log data.

**Tech Stack:** Next.js 14 (App Router), TypeScript, Supabase (@supabase/ssr), Tailwind CSS, shadcn/ui, Vitest

**Spec references:**
- Roadmap v1.0: `C:\Users\byonk\Downloads\teamwise-roadmap-v1.md` (Phase 5)
- Phase 4 plan: `docs/superpowers/plans/2026-03-23-phase4-lead-swaps-coverage.md`

**Pre-decisions confirmed:**
1. Therapists see their own OC/CI/CX/LE codes in their personal schedule view (read-only)
2. Manager can revert a block from Active → Final (with confirmation)
3. LE (Left Early) applies to both PRN and FT therapists

**Critical context for every implementer:**
- `lib/auth.ts` is the ONLY file allowed to call Supabase Auth APIs
- `lib/supabase/server.ts` uses `require('next/headers')` inside the function body — do not refactor
- Cast `(supabase as any)` for new tables and RPCs not in generated types; always put `// eslint-disable-next-line @typescript-eslint/no-explicit-any` on the LINE IMMEDIATELY BEFORE the cast (not two lines before)
- `schedule_blocks.update()` returns `never` — always use `(supabase as any).from('schedule_blocks').update(...)`
- `searchParams` in Next.js 14 is a SYNCHRONOUS plain object — never `await` it
- `[...mySet]` fails with TS2802 in this tsconfig — always use `Array.from(mySet)`
- Supabase `.single()` type inference returns `never` in some TS versions — use explicit `as { data: ...; error: unknown }` cast
- `operational_entries` is NOT in the generated Supabase client — always use `(supabase as any).from('operational_entries')`

---

## File Map

```
teamwise-claude/
├── supabase/migrations/
│   └── 004_phase5_operational.sql         # NEW: operational_entries + views + RPCs + pg_cron
├── lib/
│   ├── types/
│   │   └── database.types.ts              # MODIFY: add operational_entries, shift_actual_headcount, RPCs
│   └── schedule/
│       ├── operational-codes.ts           # NEW: isOperationalEntryAllowed, isBackfill (pure, unit-tested)
│       └── block-status.ts               # MODIFY: add canActivateBlock, canRevertToFinal
├── tests/unit/
│   ├── operational-codes.test.ts          # NEW: 8 unit tests for operational-codes helpers
│   └── block-status.test.ts              # MODIFY: add tests for new helpers
├── app/
│   ├── actions/
│   │   └── operational-entries.ts        # NEW: enterCode, removeCode, revertToFinal server actions
│   └── (app)/
│       ├── schedule/
│       │   └── page.tsx                  # MODIFY: fetch entries for active blocks, show WeekView on mobile
│       ├── coverage/
│       │   └── page.tsx                  # MODIFY: fetch shift_actual_headcount, pass to heatmap
│       └── audit/
│           └── [blockId]/
│               └── page.tsx              # NEW: manager-only audit log page
├── components/
│   ├── schedule/
│   │   ├── OperationalCodeEntry.tsx      # NEW: 4-button OC/CI/CX/LE entry section (44px, mobile-safe)
│   │   ├── CellPanel.tsx                # MODIFY: add operational entry section (entries prop)
│   │   ├── ScheduleGrid.tsx             # MODIFY: pass entries + entriesByShiftId to CellPanel
│   │   ├── BlockStatusActions.tsx       # MODIFY: Active status display + Revert to Final button
│   │   └── WeekView.tsx                 # NEW: mobile 7-col week view, shares CellPanel
│   ├── coverage/
│   │   ├── CoverageHeatmap.tsx          # MODIFY: accept + display actual headcount for active blocks
│   │   └── AlertBanner.tsx              # NEW: Supabase Realtime subscriber, fires when actual < 3
│   └── audit/
│       └── AuditLog.tsx                 # NEW: read-only log table + CSV download button
```

---

## Task 1: Migration — operational_entries + views + RPCs + pg_cron

**Files:**
- Create: `supabase/migrations/004_phase5_operational.sql`

- [ ] **Step 1: Write the migration file**

```sql
-- supabase/migrations/004_phase5_operational.sql

-- ──────────────────────────────────────────────────
-- operational_entries table
-- ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.operational_entries (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_block_id   UUID        NOT NULL REFERENCES public.schedule_blocks(id) ON DELETE CASCADE,
  shift_id            UUID        NOT NULL REFERENCES public.shifts(id) ON DELETE CASCADE,
  user_id             UUID        NOT NULL REFERENCES public.users(id),
  entry_date          DATE        NOT NULL,
  entry_type          TEXT        NOT NULL CHECK (entry_type IN ('OC', 'CI', 'CX', 'LE')),
  note                TEXT,
  is_backfill         BOOLEAN     NOT NULL DEFAULT false,
  entered_by          UUID        NOT NULL REFERENCES public.users(id),
  entered_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  removed_at          TIMESTAMPTZ,
  removed_by          UUID        REFERENCES public.users(id)
);

ALTER TABLE public.operational_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read operational_entries"
  ON public.operational_entries FOR SELECT USING (auth.role() = 'authenticated');
CREATE POLICY "Authenticated insert operational_entries"
  ON public.operational_entries FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "Authenticated update operational_entries"
  ON public.operational_entries FOR UPDATE USING (auth.role() = 'authenticated');

-- ──────────────────────────────────────────────────
-- shift_actual_headcount view
-- Actual = planned - shifts that have at least one active entry (removed_at IS NULL)
-- Uses EXISTS to avoid count inflation from multiple entries per shift.
-- ──────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.shift_actual_headcount AS
SELECT
  s.schedule_block_id,
  s.shift_date,
  -- Planned counts (same as shift_planned_headcount)
  COUNT(CASE WHEN u.employment_type = 'full_time' AND s.cell_state = 'working' THEN 1 END)::INT
    AS ft_planned,
  COUNT(CASE WHEN u.employment_type = 'prn'       AND s.cell_state = 'working' THEN 1 END)::INT
    AS prn_planned,
  COUNT(CASE WHEN s.cell_state = 'working' THEN 1 END)::INT
    AS total_planned,
  -- Actual = planned - shifts with at least one active entry
  GREATEST(0,
    COUNT(CASE WHEN u.employment_type = 'full_time' AND s.cell_state = 'working' THEN 1 END) -
    COUNT(CASE WHEN u.employment_type = 'full_time' AND s.cell_state = 'working'
                AND EXISTS (
                  SELECT 1 FROM public.operational_entries oe
                  WHERE oe.shift_id = s.id AND oe.removed_at IS NULL
                ) THEN 1 END)
  )::INT AS ft_actual,
  GREATEST(0,
    COUNT(CASE WHEN u.employment_type = 'prn' AND s.cell_state = 'working' THEN 1 END) -
    COUNT(CASE WHEN u.employment_type = 'prn' AND s.cell_state = 'working'
                AND EXISTS (
                  SELECT 1 FROM public.operational_entries oe
                  WHERE oe.shift_id = s.id AND oe.removed_at IS NULL
                ) THEN 1 END)
  )::INT AS prn_actual,
  GREATEST(0,
    COUNT(CASE WHEN s.cell_state = 'working' THEN 1 END) -
    COUNT(CASE WHEN s.cell_state = 'working'
                AND EXISTS (
                  SELECT 1 FROM public.operational_entries oe
                  WHERE oe.shift_id = s.id AND oe.removed_at IS NULL
                ) THEN 1 END)
  )::INT AS total_actual
FROM public.shifts s
JOIN public.users u ON u.id = s.user_id
GROUP BY s.schedule_block_id, s.shift_date;

-- ──────────────────────────────────────────────────
-- enter_operational_code RPC
-- Validates access, inserts entry, sets is_backfill.
-- Therapist access: must be lead on this block (has lead_user_id = their id on any date).
-- Returns JSONB: { "success": true } or { "error": "reason" }
-- ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.enter_operational_code(
  p_schedule_block_id UUID,
  p_shift_id          UUID,
  p_entry_type        TEXT,
  p_note              TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_block_status  TEXT;
  v_shift_date    DATE;
  v_cell_state    TEXT;
  v_user_role     TEXT;
  v_is_lead       BOOLEAN;
  v_shift_user_id UUID;
BEGIN
  -- Validate block is active
  SELECT status INTO v_block_status
  FROM public.schedule_blocks WHERE id = p_schedule_block_id;
  IF v_block_status != 'active' THEN
    RETURN jsonb_build_object('error', 'Block is not active');
  END IF;

  -- Get shift info
  SELECT shift_date, cell_state, user_id
  INTO v_shift_date, v_cell_state, v_shift_user_id
  FROM public.shifts WHERE id = p_shift_id;
  IF v_cell_state != 'working' THEN
    RETURN jsonb_build_object('error', 'Shift is not working');
  END IF;
  IF v_shift_date > CURRENT_DATE THEN
    RETURN jsonb_build_object('error', 'Cannot enter code for a future date');
  END IF;

  -- Check user access
  SELECT role INTO v_user_role FROM public.users WHERE id = auth.uid();
  IF v_user_role = 'therapist' THEN
    SELECT EXISTS(
      SELECT 1 FROM public.shifts
      WHERE schedule_block_id = p_schedule_block_id
        AND lead_user_id = auth.uid()
    ) INTO v_is_lead;
    IF NOT v_is_lead THEN
      RETURN jsonb_build_object('error', 'Only the lead/charge or a manager can enter codes');
    END IF;
  END IF;

  -- Insert entry; is_backfill = true when entering for a prior date
  INSERT INTO public.operational_entries (
    schedule_block_id, shift_id, user_id, entry_date, entry_type,
    note, is_backfill, entered_by
  ) VALUES (
    p_schedule_block_id, p_shift_id, v_shift_user_id, v_shift_date, p_entry_type,
    p_note, (v_shift_date != CURRENT_DATE), auth.uid()
  );

  RETURN jsonb_build_object('success', true);
END;
$$;

-- ──────────────────────────────────────────────────
-- remove_operational_code RPC
-- Soft-deletes an entry (sets removed_at / removed_by).
-- Manager can remove any entry. Therapist can only remove entries they entered.
-- ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.remove_operational_code(
  p_entry_id UUID
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_user_role  TEXT;
  v_entered_by UUID;
BEGIN
  SELECT role INTO v_user_role FROM public.users WHERE id = auth.uid();
  SELECT entered_by INTO v_entered_by FROM public.operational_entries WHERE id = p_entry_id;

  IF v_entered_by IS NULL THEN
    RETURN jsonb_build_object('error', 'Entry not found');
  END IF;
  IF v_user_role = 'therapist' AND v_entered_by != auth.uid() THEN
    RETURN jsonb_build_object('error', 'Cannot remove another user''s entry');
  END IF;

  UPDATE public.operational_entries
  SET removed_at = now(), removed_by = auth.uid()
  WHERE id = p_entry_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

-- ──────────────────────────────────────────────────
-- revert_to_final RPC
-- Manager can revert an active block back to final status.
-- ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.revert_to_final(
  p_schedule_block_id UUID
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_user_role    TEXT;
  v_block_status TEXT;
BEGIN
  SELECT role INTO v_user_role FROM public.users WHERE id = auth.uid();
  IF v_user_role != 'manager' THEN
    RETURN jsonb_build_object('error', 'Manager access required');
  END IF;

  SELECT status INTO v_block_status
  FROM public.schedule_blocks WHERE id = p_schedule_block_id;
  IF v_block_status != 'active' THEN
    RETURN jsonb_build_object('error', 'Block must be active to revert to Final');
  END IF;

  UPDATE public.schedule_blocks
  SET status = 'final'
  WHERE id = p_schedule_block_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

-- ──────────────────────────────────────────────────
-- pg_cron: auto-activate final blocks when start_date arrives
-- Runs daily at 06:00 UTC (adjust to your local midnight as needed).
-- ──────────────────────────────────────────────────
SELECT cron.schedule(
  'activate-blocks-on-start-date',
  '0 6 * * *',
  $$
    UPDATE public.schedule_blocks
    SET status = 'active'
    WHERE status = 'final'
      AND start_date <= CURRENT_DATE;
  $$
);
```

- [ ] **Step 2: Apply the migration in Supabase Dashboard**

Go to **Supabase Dashboard → SQL Editor**, paste the migration, and run it.
Verify in **Table Editor** that `operational_entries` table exists.
Verify in **Database → Views** that `shift_actual_headcount` view exists.
Verify in **Database → Functions** that `enter_operational_code`, `remove_operational_code`, `revert_to_final` exist.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/004_phase5_operational.sql
git commit -m "feat: add operational_entries table, shift_actual_headcount view, and operational RPCs"
```

---

## Task 2: Type Definitions

**Files:**
- Modify: `lib/types/database.types.ts`

- [ ] **Step 1: Add `operational_entries` table type after `swap_requests`**

In the `Tables` section, add after the `swap_requests` block:

```typescript
      operational_entries: {
        Row: {
          id: string
          schedule_block_id: string
          shift_id: string
          user_id: string
          entry_date: string
          entry_type: 'OC' | 'CI' | 'CX' | 'LE'
          note: string | null
          is_backfill: boolean
          entered_by: string
          entered_at: string
          removed_at: string | null
          removed_by: string | null
        }
        Insert: Omit<
          Database['public']['Tables']['operational_entries']['Row'],
          'id' | 'entered_at'
        >
        Update: Partial<
          Database['public']['Tables']['operational_entries']['Insert']
        >
      }
```

- [ ] **Step 2: Add `shift_actual_headcount` view type after `shift_planned_headcount`**

In the `Views` section, add:

```typescript
      shift_actual_headcount: {
        Row: {
          schedule_block_id: string
          shift_date: string
          ft_planned: number
          prn_planned: number
          total_planned: number
          ft_actual: number
          prn_actual: number
          total_actual: number
        }
      }
```

- [ ] **Step 3: Add new RPCs to the `Functions` section**

Add after `assign_lead`:

```typescript
      enter_operational_code: {
        Args: {
          p_schedule_block_id: string
          p_shift_id: string
          p_entry_type: 'OC' | 'CI' | 'CX' | 'LE'
          p_note?: string | null
        }
        Returns: { success?: boolean; error?: string }
      }
      remove_operational_code: {
        Args: { p_entry_id: string }
        Returns: { success?: boolean; error?: string }
      }
      revert_to_final: {
        Args: { p_schedule_block_id: string }
        Returns: { success?: boolean; error?: string }
      }
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no type errors in `lib/types/database.types.ts`

- [ ] **Step 5: Commit**

```bash
git add lib/types/database.types.ts
git commit -m "feat: add operational_entries and shift_actual_headcount types"
```

---

## Task 3: Operational Code Helpers + Tests

**Files:**
- Create: `lib/schedule/operational-codes.ts`
- Create: `tests/unit/operational-codes.test.ts`

- [ ] **Step 1: Write the failing tests first**

```typescript
// tests/unit/operational-codes.test.ts
import { describe, it, expect } from 'vitest'
import { isOperationalEntryAllowed, isBackfill } from '@/lib/schedule/operational-codes'

describe('isOperationalEntryAllowed', () => {
  const TODAY = '2026-04-15'

  it('allows manager on active block for today', () => {
    expect(isOperationalEntryAllowed('active', 'manager', '2026-04-15', '2026-04-01', TODAY)).toBe(true)
  })
  it('allows manager on active block for a prior date (backfill)', () => {
    expect(isOperationalEntryAllowed('active', 'manager', '2026-04-10', '2026-04-01', TODAY)).toBe(true)
  })
  it('denies manager on non-active block', () => {
    expect(isOperationalEntryAllowed('final', 'manager', '2026-04-15', '2026-04-01', TODAY)).toBe(false)
  })
  it('allows therapist-lead on active block for today', () => {
    expect(isOperationalEntryAllowed('active', 'therapist', '2026-04-15', '2026-04-01', TODAY)).toBe(true)
  })
  it('allows therapist-lead on active block for a prior date', () => {
    expect(isOperationalEntryAllowed('active', 'therapist', '2026-04-05', '2026-04-01', TODAY)).toBe(true)
  })
  it('denies therapist-lead for a future date', () => {
    expect(isOperationalEntryAllowed('active', 'therapist', '2026-04-20', '2026-04-01', TODAY)).toBe(false)
  })
  it('denies therapist-lead for a date before block start', () => {
    expect(isOperationalEntryAllowed('active', 'therapist', '2026-03-15', '2026-04-01', TODAY)).toBe(false)
  })
  it('denies therapist-lead on completed block', () => {
    expect(isOperationalEntryAllowed('completed', 'therapist', '2026-04-15', '2026-04-01', TODAY)).toBe(false)
  })
})

describe('isBackfill', () => {
  it('returns false when entry date matches today', () => {
    expect(isBackfill('2026-04-15', '2026-04-15')).toBe(false)
  })
  it('returns true when entry date is before today', () => {
    expect(isBackfill('2026-04-10', '2026-04-15')).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm test -- operational-codes
```

Expected: FAIL — module not found

- [ ] **Step 3: Implement the helpers**

```typescript
// lib/schedule/operational-codes.ts

/**
 * Whether a user can enter an operational code for a specific shift date.
 *
 * @param blockStatus  - current block status
 * @param userRole     - 'manager' | 'therapist' (therapist caller must already be confirmed as lead)
 * @param shiftDate    - the date of the shift being annotated ('YYYY-MM-DD')
 * @param blockStart   - block start_date ('YYYY-MM-DD')
 * @param today        - today's date string ('YYYY-MM-DD'), injected for testability
 */
export function isOperationalEntryAllowed(
  blockStatus: string,
  userRole: 'manager' | 'therapist',
  shiftDate: string,
  blockStart: string,
  today: string
): boolean {
  if (blockStatus !== 'active') return false
  if (shiftDate > today) return false
  if (shiftDate < blockStart) return false
  return true
}

/**
 * Whether an operational code entry is a backfill (entered after the shift date).
 *
 * @param entryDate - the date of the shift ('YYYY-MM-DD')
 * @param today     - today's date string ('YYYY-MM-DD')
 */
export function isBackfill(entryDate: string, today: string): boolean {
  return entryDate < today
}
```

Note: `userRole` is accepted but not checked in the helper — the server RPC enforces lead access for therapists. The helper validates the date range and block status, which can be checked client-side to decide whether to show the entry UI.

- [ ] **Step 4: Run tests — expect all 10 to pass**

```bash
npm test -- operational-codes
```

Expected: 10/10 PASS

- [ ] **Step 5: Run full test suite to confirm nothing broke**

```bash
npm test
```

Expected: 77/77 PASS (67 prior + 10 new)

- [ ] **Step 6: Commit**

```bash
git add lib/schedule/operational-codes.ts tests/unit/operational-codes.test.ts
git commit -m "feat: add operational-codes helpers and tests"
```

---

## Task 4: Block-Status Helpers + Tests

**Files:**
- Modify: `lib/schedule/block-status.ts`
- Modify: `tests/unit/block-status.test.ts`

- [ ] **Step 1: Write the new failing tests**

Add to the end of `tests/unit/block-status.test.ts`:

```typescript
import { canActivateBlock, canRevertToFinal } from '@/lib/schedule/block-status'

describe('canActivateBlock', () => {
  it('returns true for final status', () => {
    expect(canActivateBlock('final')).toBe(true)
  })
  it('returns false for active status', () => {
    expect(canActivateBlock('active')).toBe(false)
  })
  it('returns false for preliminary_draft', () => {
    expect(canActivateBlock('preliminary_draft')).toBe(false)
  })
})

describe('canRevertToFinal', () => {
  it('returns true for active status', () => {
    expect(canRevertToFinal('active')).toBe(true)
  })
  it('returns false for final status', () => {
    expect(canRevertToFinal('final')).toBe(false)
  })
  it('returns false for completed status', () => {
    expect(canRevertToFinal('completed')).toBe(false)
  })
})
```

- [ ] **Step 2: Run to confirm they fail**

```bash
npm test -- block-status
```

Expected: FAIL — `canActivateBlock is not exported`

- [ ] **Step 3: Add the helpers to block-status.ts**

Append to `lib/schedule/block-status.ts`:

```typescript
/** pg_cron auto-transitions final blocks to active; this helper reflects that logic. */
export function canActivateBlock(status: BlockStatus): boolean {
  return status === 'final'
}

/** Manager can revert an active block back to Final. */
export function canRevertToFinal(status: BlockStatus): boolean {
  return status === 'active'
}
```

- [ ] **Step 4: Run tests — expect all to pass**

```bash
npm test
```

Expected: 83/83 PASS (77 prior + 6 new)

- [ ] **Step 5: Commit**

```bash
git add lib/schedule/block-status.ts tests/unit/block-status.test.ts
git commit -m "feat: add canActivateBlock and canRevertToFinal block-status helpers"
```

---

## Task 5: Server Actions

**Files:**
- Create: `app/actions/operational-entries.ts`

- [ ] **Step 1: Create the file**

```typescript
// app/actions/operational-entries.ts
'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getServerUser } from '@/lib/auth'

/** Enter an OC/CI/CX/LE code for a working shift. Lead/charge or manager only. */
export async function enterCode(
  blockId: string,
  shiftId: string,
  entryType: 'OC' | 'CI' | 'CX' | 'LE',
  note: string | null
): Promise<{ error?: string }> {
  const user = await getServerUser()
  if (!user) return { error: 'Not authenticated' }

  const supabase = createClient()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc('enter_operational_code', {
    p_schedule_block_id: blockId,
    p_shift_id: shiftId,
    p_entry_type: entryType,
    p_note: note,
  }) as { data: { success?: boolean; error?: string } | null; error: unknown }

  if (error) return { error: String(error) }
  if (data?.error) return { error: data.error }

  revalidatePath('/schedule')
  revalidatePath('/coverage')
  return {}
}

/** Soft-delete (remove) an operational code entry. */
export async function removeCode(
  entryId: string
): Promise<{ error?: string }> {
  const user = await getServerUser()
  if (!user) return { error: 'Not authenticated' }

  const supabase = createClient()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc('remove_operational_code', {
    p_entry_id: entryId,
  }) as { data: { success?: boolean; error?: string } | null; error: unknown }

  if (error) return { error: String(error) }
  if (data?.error) return { error: data.error }

  revalidatePath('/schedule')
  revalidatePath('/coverage')
  return {}
}

/** Manager-only: revert an active block back to Final status. */
export async function revertToFinal(
  blockId: string
): Promise<{ error?: string }> {
  const user = await getServerUser()
  if (!user) return { error: 'Not authenticated' }

  const supabase = createClient()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc('revert_to_final', {
    p_schedule_block_id: blockId,
  }) as { data: { success?: boolean; error?: string } | null; error: unknown }

  if (error) return { error: String(error) }
  if (data?.error) return { error: data.error }

  revalidatePath('/schedule')
  revalidatePath('/coverage')
  return {}
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add app/actions/operational-entries.ts
git commit -m "feat: add enterCode, removeCode, revertToFinal server actions"
```

---

## Task 6: OperationalCodeEntry Component + CellPanel Integration

**Files:**
- Create: `components/schedule/OperationalCodeEntry.tsx`
- Modify: `components/schedule/CellPanel.tsx`
- Modify: `components/schedule/ScheduleGrid.tsx`

OperationalCodeEntry is a self-contained section rendered inside CellPanel. It shows existing entries (with remove button for manager/entered-by-self) and four entry buttons (OC/CI/CX/LE, min 44px height, full-width, mobile-safe). Therapists see entries as read-only.

- [ ] **Step 1: Create OperationalCodeEntry.tsx**

```tsx
// components/schedule/OperationalCodeEntry.tsx
'use client'
import { useState, useTransition } from 'react'
import { enterCode, removeCode } from '@/app/actions/operational-entries'
import { isOperationalEntryAllowed } from '@/lib/schedule/operational-codes'
import type { Database } from '@/lib/types/database.types'

type OperationalEntry = Database['public']['Tables']['operational_entries']['Row']
type BlockStatus = Database['public']['Tables']['schedule_blocks']['Row']['status']

const CODE_LABELS: Record<string, string> = {
  OC: 'On Call',
  CI: 'Called In',
  CX: 'Called Out',
  LE: 'Left Early',
}
const CODES = ['OC', 'CI', 'CX', 'LE'] as const

interface Props {
  blockId: string
  shiftId: string
  shiftDate: string
  blockStart: string
  blockStatus: BlockStatus
  userRole: 'manager' | 'therapist'
  isUserLead: boolean          // therapist: is current user the lead on this block?
  currentUserId: string
  entries: OperationalEntry[]  // active entries for this shift (removed_at IS NULL)
  onUpdate: () => void         // callback to trigger parent refresh (revalidation happens server-side)
}

export function OperationalCodeEntry({
  blockId, shiftId, shiftDate, blockStart, blockStatus,
  userRole, isUserLead, currentUserId, entries, onUpdate,
}: Props) {
  const today = new Date().toISOString().split('T')[0]
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [isPending, startTransition] = useTransition()

  // Therapists must be lead; managers always allowed
  const canEnter = (userRole === 'manager' || isUserLead) &&
    isOperationalEntryAllowed(blockStatus, userRole, shiftDate, blockStart, today)

  if (!canEnter && entries.length === 0) return null

  function handleEnter(code: typeof CODES[number]) {
    setError(null)
    startTransition(async () => {
      const result = await enterCode(blockId, shiftId, code, note || null)
      if (result.error) {
        setError(result.error)
      } else {
        setSuccess(true)
        setNote('')
        setTimeout(() => setSuccess(false), 2000)
        onUpdate()
      }
    })
  }

  function handleRemove(entryId: string) {
    setError(null)
    startTransition(async () => {
      const result = await removeCode(entryId)
      if (result.error) setError(result.error)
      else onUpdate()
    })
  }

  return (
    <div className="mt-4 border-t border-slate-100 pt-4 space-y-3">
      <span className="block text-sm font-medium text-slate-700">Operational Codes</span>

      {/* Existing entries */}
      {entries.length > 0 && (
        <ul className="space-y-1">
          {entries.map(e => {
            const canRemove = userRole === 'manager' || e.entered_by === currentUserId
            return (
              <li key={e.id} className="flex items-center justify-between text-sm">
                <span className="font-mono font-semibold text-slate-800">{e.entry_type}</span>
                <span className="text-slate-500 text-xs flex-1 mx-2 truncate">
                  {CODE_LABELS[e.entry_type]}{e.is_backfill ? ' (backfill)' : ''}{e.note ? ` — ${e.note}` : ''}
                </span>
                {canRemove && (
                  <button
                    type="button"
                    onClick={() => handleRemove(e.id)}
                    disabled={isPending}
                    className="text-xs text-red-500 hover:text-red-700 disabled:opacity-50 shrink-0"
                    aria-label="Remove entry"
                  >
                    ✕
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {/* Entry UI — only shown to managers and leads on active blocks for allowed dates */}
      {canEnter && (
        <>
          <textarea
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="Optional note…"
            rows={2}
            disabled={isPending}
            className="w-full text-sm border border-slate-200 rounded-md px-2 py-1.5 resize-none focus:outline-none focus:ring-2 focus:ring-slate-400 disabled:opacity-50"
          />

          {/* 4 buttons — 44px min height for mobile */}
          <div className="grid grid-cols-2 gap-2">
            {CODES.map(code => (
              <button
                key={code}
                type="button"
                onClick={() => handleEnter(code)}
                disabled={isPending}
                style={{ minHeight: '44px' }}
                className="flex flex-col items-center justify-center rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50 transition-colors px-2 py-1"
              >
                <span className="font-mono font-bold text-base leading-none">{code}</span>
                <span className="text-xs text-slate-500 leading-tight mt-0.5">{CODE_LABELS[code]}</span>
              </button>
            ))}
          </div>

          {success && <p className="text-xs text-green-700">Code entered.</p>}
          {error && <p className="text-xs text-red-600">{error}</p>}
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Modify CellPanel.tsx — add entries props and render OperationalCodeEntry**

Add to the Props interface (after `allTherapists`):

```typescript
  operationalEntries: OperationalEntry[]  // active entries for this shift
  blockStart: string
  isUserLead: boolean
```

Add import at top:

```typescript
import type { Database } from '@/lib/types/database.types'
// add to existing type imports:
type OperationalEntry = Database['public']['Tables']['operational_entries']['Row']
import { OperationalCodeEntry } from './OperationalCodeEntry'
import { isOperationalEntryAllowed } from '@/lib/schedule/operational-codes'
```

In the Props interface, add after `allTherapists`:
```typescript
  operationalEntries: OperationalEntry[]
  blockStart: string
  isUserLead: boolean
```

Add the section inside `<SheetContent>`, after the Swap Request section and before `</SheetContent>`:

```tsx
        {/* Operational code entry — active blocks only */}
        {shift && state === 'working' && (
          <OperationalCodeEntry
            blockId={blockId}
            shiftId={shift.id}
            shiftDate={date}
            blockStart={blockStart}
            blockStatus={blockStatus}
            userRole={userRole}
            isUserLead={isUserLead}
            currentUserId={currentUserId}
            entries={operationalEntries}
            onUpdate={() => {}}
          />
        )}
```

Note: `onUpdate` is a no-op because `revalidatePath` in the server action handles data refresh on the next navigation. A full Realtime update is handled separately by AlertBanner.

- [ ] **Step 3: Modify ScheduleGrid.tsx — add entries data + pass to CellPanel**

Add new props to `ScheduleGridProps`:

```typescript
  operationalEntriesByShiftId: Map<string, OperationalEntry[]>  // entries for active shifts
  blockStart: string
```

Import the type:
```typescript
type OperationalEntry = Database['public']['Tables']['operational_entries']['Row']
```

In the component, derive `isUserLead` from shifts:
```typescript
  const isUserLead = useMemo(() => {
    return shifts.some(s => s.lead_user_id === currentUserId)
  }, [shifts, currentUserId])
```

Pass to CellPanel where it's rendered:
```tsx
  operationalEntries={operationalEntriesByShiftId.get(panelShift?.id ?? '') ?? []}
  blockStart={block.start_date}
  isUserLead={isUserLead}
```

- [ ] **Step 4: Modify schedule/page.tsx — fetch operational entries for active blocks**

After the `shifts` fetch, add (inside the existing server component):

```typescript
  // Fetch operational entries for active blocks
  let operationalEntries: Database['public']['Tables']['operational_entries']['Row'][] = []
  if (block.status === 'active') {
    // Manager sees all entries; therapist sees only their own
    let entriesQuery = (supabase as any)
      .from('operational_entries')
      .select('*')
      .eq('schedule_block_id', block.id)
      .is('removed_at', null)
    if (profile.role === 'therapist') {
      entriesQuery = entriesQuery.eq('user_id', user.id)
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: entriesData } = await entriesQuery as { data: any[] | null; error: unknown }
    operationalEntries = (entriesData ?? []) as typeof operationalEntries
  }
```

Build the map and pass to `ScheduleGrid`:

```typescript
  const operationalEntriesByShiftId = new Map<string, typeof operationalEntries>()
  for (const e of operationalEntries) {
    const arr = operationalEntriesByShiftId.get(e.shift_id) ?? []
    arr.push(e)
    operationalEntriesByShiftId.set(e.shift_id, arr)
  }
```

Pass `operationalEntriesByShiftId={operationalEntriesByShiftId}` and `blockStart={block.start_date}` to `<ScheduleGrid>`.

- [ ] **Step 5: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add components/schedule/OperationalCodeEntry.tsx components/schedule/CellPanel.tsx components/schedule/ScheduleGrid.tsx app/(app)/schedule/page.tsx
git commit -m "feat: add OperationalCodeEntry component and wire to CellPanel"
```

---

## Task 7: Mobile WeekView + Schedule Page Integration

**Files:**
- Create: `components/schedule/WeekView.tsx`
- Modify: `app/(app)/schedule/page.tsx`

WeekView shows 7 columns. Each cell shows a colored dot for the cell state. Tapping a cell fires the same `onCellClick(userId, date)` callback, which opens the existing CellPanel. WeekView is shown on screens `< md` (hidden on `md` and above). The desktop ScheduleGrid is shown only on `md` and above.

- [ ] **Step 1: Create WeekView.tsx**

```tsx
// components/schedule/WeekView.tsx
'use client'
import { useState, useMemo } from 'react'
import { addDays, format, startOfWeek } from 'date-fns'
import type { Database } from '@/lib/types/database.types'

type ShiftRow = Database['public']['Tables']['shifts']['Row']
type UserRow = Database['public']['Tables']['users']['Row']
type OperationalEntry = Database['public']['Tables']['operational_entries']['Row']

const STATE_COLORS: Record<string, string> = {
  working:      'bg-green-500',
  cannot_work:  'bg-red-400',
  off:          'bg-slate-300',
  fmla:         'bg-purple-400',
}

interface Props {
  block: Database['public']['Tables']['schedule_blocks']['Row']
  shifts: ShiftRow[]
  therapists: UserRow[]
  currentUserId: string
  userRole: 'manager' | 'therapist'
  operationalEntriesByShiftId: Map<string, OperationalEntry[]>
  onCellClick: (userId: string, date: string) => void
}

export function WeekView({
  block, shifts, therapists, currentUserId, userRole,
  operationalEntriesByShiftId, onCellClick,
}: Props) {
  const blockStart = new Date(block.start_date + 'T00:00:00')
  const blockEnd   = new Date(block.end_date + 'T00:00:00')

  // Start at the week containing blockStart (or today if within block)
  const today = new Date()
  const initialWeekStart = today >= blockStart && today <= blockEnd
    ? startOfWeek(today, { weekStartsOn: 0 })
    : startOfWeek(blockStart, { weekStartsOn: 0 })

  const [weekStart, setWeekStart] = useState(initialWeekStart)

  const weekDates = useMemo(() =>
    Array.from({ length: 7 }, (_, i) => {
      const d = addDays(weekStart, i)
      return format(d, 'yyyy-MM-dd')
    }), [weekStart])

  const shiftMap = useMemo(() => {
    const m = new Map<string, ShiftRow>()  // key: userId:date
    for (const s of shifts) m.set(`${s.user_id}:${s.shift_date}`, s)
    return m
  }, [shifts])

  const visibleTherapists = userRole === 'therapist'
    ? therapists.filter(t => t.id === currentUserId)
    : therapists

  function prevWeek() {
    setWeekStart(w => addDays(w, -7))
  }
  function nextWeek() {
    setWeekStart(w => addDays(w, 7))
  }

  return (
    <div className="md:hidden overflow-x-auto">
      {/* Week navigation */}
      <div className="flex items-center justify-between mb-2 px-1">
        <button
          type="button"
          onClick={prevWeek}
          className="px-3 py-1 text-sm border border-slate-200 rounded-md hover:bg-slate-50"
        >
          ←
        </button>
        <span className="text-xs font-medium text-slate-600">
          {format(weekStart, 'MMM d')} – {format(addDays(weekStart, 6), 'MMM d, yyyy')}
        </span>
        <button
          type="button"
          onClick={nextWeek}
          className="px-3 py-1 text-sm border border-slate-200 rounded-md hover:bg-slate-50"
        >
          →
        </button>
      </div>

      {/* Grid */}
      <div className="border border-slate-200 rounded-lg overflow-hidden">
        {/* Header row */}
        <div className="grid bg-slate-50 border-b border-slate-200"
          style={{ gridTemplateColumns: '100px repeat(7, 1fr)' }}>
          <div className="px-2 py-1.5 text-xs text-slate-400 font-medium">Name</div>
          {weekDates.map(d => {
            const inBlock = d >= block.start_date && d <= block.end_date
            return (
              <div key={d} className={`px-1 py-1.5 text-center text-xs font-medium ${inBlock ? 'text-slate-600' : 'text-slate-300'}`}>
                <div>{format(new Date(d + 'T00:00:00'), 'EEE')}</div>
                <div>{format(new Date(d + 'T00:00:00'), 'd')}</div>
              </div>
            )
          })}
        </div>

        {/* Therapist rows */}
        {visibleTherapists.map((t, ti) => (
          <div
            key={t.id}
            className={`grid border-b border-slate-100 last:border-0 ${ti % 2 === 0 ? 'bg-white' : 'bg-slate-50/40'}`}
            style={{ gridTemplateColumns: '100px repeat(7, 1fr)' }}
          >
            <div className="px-2 py-2 text-xs text-slate-700 font-medium truncate flex items-center">
              {t.full_name.split(' ')[0]}
            </div>
            {weekDates.map(d => {
              const inBlock = d >= block.start_date && d <= block.end_date
              const shift = shiftMap.get(`${t.id}:${d}`)
              const state = shift?.cell_state ?? 'off'
              const hasEntries = shift ? (operationalEntriesByShiftId.get(shift.id) ?? []).length > 0 : false

              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => inBlock && shift && onCellClick(t.id, d)}
                  disabled={!inBlock || !shift}
                  className="flex items-center justify-center py-2 relative"
                >
                  {inBlock ? (
                    <>
                      <span className={`w-3 h-3 rounded-full ${STATE_COLORS[state] ?? 'bg-slate-200'}`} />
                      {hasEntries && state === 'working' && (
                        <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-amber-500" />
                      )}
                    </>
                  ) : (
                    <span className="w-3 h-3 rounded-full bg-slate-100 opacity-30" />
                  )}
                </button>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Update schedule/page.tsx to render WeekView and hide ScheduleGrid on mobile**

Import WeekView at the top of the page:
```typescript
import { WeekView } from '@/components/schedule/WeekView'
```

In the return JSX, wrap ScheduleGrid in a div that hides on mobile, and add WeekView below it:

```tsx
      {/* Desktop grid — hidden on mobile */}
      <div className="hidden md:block">
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
          operationalEntriesByShiftId={operationalEntriesByShiftId}
          blockStart={block.start_date}
        />
      </div>

      {/* Mobile week view — hidden on md+ */}
      {/* WeekView manages its own cell click to open CellPanel via a shared callback.
          Since CellPanel is inside ScheduleGrid's client state, we expose a ref or lift state.
          For now, WeekView is display-only on mobile — CellPanel opens when the user
          taps a cell (handled inside ScheduleGrid via URL state or lifted state).

          Simplest approach: render ScheduleGrid always (it manages CellPanel state),
          but show a WeekView overlay on mobile as a visual layer.
          Use CSS to hide ScheduleGrid's overflow on mobile.
      */}
```

**Implementation note for the WeekView + CellPanel connection:** CellPanel state (which cell is open) lives inside ScheduleGrid. The cleanest approach is:
1. Render `<ScheduleGrid>` always but wrap it in `<div className="hidden md:block">` so it's invisible on mobile
2. Render `<WeekView>` in `<div className="md:hidden">` — but WeekView needs a way to open CellPanel

**Correct solution:** Lift the CellPanel open/close state OUT of ScheduleGrid into the page itself (as a client component wrapper). But the schedule page is a server component.

**Practical approach for Phase 5:** Render both grid and week view; on mobile, the user taps a WeekView cell which sets a URL param (`?openCell=userId:date`), and ScheduleGrid reads that param to open its panel on initial render. This avoids client state lifting.

Actually — simpler: render WeekView with an `onCellClick` that calls `router.push` with a query param, and make ScheduleGrid open its panel when it detects that param on mount. This is acceptable for Phase 5.

**Even simpler for Phase 5:** Don't lift state. Just make WeekView cells tap to open a full-screen mobile modal (a separate Sheet) that shows the same content as CellPanel, passing the shift data directly. This avoids touching ScheduleGrid's internal state.

**Recommended implementation:** `WeekView` renders its OWN `CellPanel` instance alongside the desktop ScheduleGrid's CellPanel. WeekView manages its own `panelOpen`, `selectedUserId`, `selectedDate` state internally. Pass all the same data that ScheduleGrid would pass to CellPanel. This means CellPanel is rendered twice (one per view), but only one is visible at a time.

Update `WeekView` to import and render `CellPanel` internally:

```tsx
// Add to WeekView.tsx
import { CellPanel } from './CellPanel'
// ... add state for panel inside WeekView
const [panelOpen, setPanelOpen] = useState(false)
const [panelUserId, setPanelUserId] = useState<string | null>(null)
const [panelDate, setPanelDate] = useState<string | null>(null)
// ... wire onCellClick to set these, render CellPanel at bottom of WeekView
```

This is self-contained and requires no architecture changes to ScheduleGrid.

The full WeekView+CellPanel wiring is complex. The implementer should:
1. Add `allTherapists`, `leadCandidates`, `currentLeadByDate`, `workingShiftsByUser`, `blockId`, `blockStatus`, `onLeadUpdate`, `onCellStateUpdate` props to WeekView (same as ScheduleGrid passes to CellPanel)
2. OR simplify: on mobile, show a read-only WeekView — clicking a cell opens an alert with the cell's state info. Full CellPanel interaction requires the desktop view.

**Phase 5 decision:** WeekView on mobile is for VIEWING cell states and entering operational codes only. Full cell editing (state change, lead assignment, swaps) requires the desktop view. This is acceptable — operational code entry is the mobile use case.

With this decision, WeekView only needs: shifts, therapists, operationalEntriesByShiftId. CellPanel is NOT rendered inside WeekView. Instead, WeekView shows a simplified bottom sheet with just the OperationalCodeEntry section.

Update the final WeekView implementation to include a simplified sheet:

```tsx
// Add to WeekView.tsx imports:
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { OperationalCodeEntry } from './OperationalCodeEntry'
import { format } from 'date-fns'

// Add to WeekView state:
const [panelOpen, setPanelOpen] = useState(false)
const [panelShift, setPanelShift] = useState<ShiftRow | null>(null)
const [panelUser, setPanelUser] = useState<UserRow | null>(null)
const [panelDate, setPanelDate] = useState<string | null>(null)

// Update onCellClick to set panel state:
function handleCellClick(userId: string, date: string) {
  const shift = shiftMap.get(`${userId}:${date}`) ?? null
  const user = therapists.find(t => t.id === userId) ?? null
  setPanelShift(shift)
  setPanelUser(user)
  setPanelDate(date)
  setPanelOpen(true)
}

// Add at bottom of returned JSX (still inside the div.md:hidden wrapper):
{panelOpen && panelShift && panelUser && panelDate && (
  <Sheet open={panelOpen} onOpenChange={v => { if (!v) setPanelOpen(false) }}>
    <SheetContent side="bottom" className="max-h-[80vh]">
      <SheetHeader>
        <SheetTitle className="text-left">{panelUser.full_name}</SheetTitle>
        <p className="text-sm text-slate-500">
          {format(new Date(panelDate + 'T00:00:00'), 'EEEE, MMMM d, yyyy')}
        </p>
      </SheetHeader>
      <div className="mt-4">
        <OperationalCodeEntry
          blockId={block.id}
          shiftId={panelShift.id}
          shiftDate={panelDate}
          blockStart={block.start_date}
          blockStatus={block.status}
          userRole={userRole}
          isUserLead={isUserLead}
          currentUserId={currentUserId}
          entries={operationalEntriesByShiftId.get(panelShift.id) ?? []}
          onUpdate={() => setPanelOpen(false)}
        />
        {block.status !== 'active' && (
          <p className="text-sm text-slate-400 mt-4">
            Operational codes are only available on active blocks.
          </p>
        )}
      </div>
    </SheetContent>
  </Sheet>
)}
```

Add `isUserLead` as a prop to WeekView (passed from page.tsx).

- [ ] **Step 3: Update schedule/page.tsx to pass isUserLead to WeekView**

Compute `isUserLead` server-side (check if current user has lead on this block):

```typescript
  // Check if current user is lead on this block (for WeekView mobile access scoping)
  const isUserLead = profile.role === 'manager' ? false :
    shifts.some(s => s.lead_user_id === user.id)
```

Pass to WeekView:
```tsx
<WeekView
  block={block}
  shifts={shifts}
  therapists={therapists}
  currentUserId={user.id}
  userRole={profile.role as 'manager' | 'therapist'}
  operationalEntriesByShiftId={operationalEntriesByShiftId}
  blockStart={block.start_date}
  isUserLead={isUserLead}
  blockId={block.id}
  blockStatus={block.status}
/>
```

- [ ] **Step 4: TypeScript check + tests**

```bash
npx tsc --noEmit
npm test
```

Expected: no errors, 83/83 tests pass

- [ ] **Step 5: Commit**

```bash
git add components/schedule/WeekView.tsx app/(app)/schedule/page.tsx
git commit -m "feat: add mobile WeekView with operational code entry sheet"
```

---

## Task 8: BlockStatusActions — Active State + Revert to Final

**Files:**
- Modify: `components/schedule/BlockStatusActions.tsx`

- [ ] **Step 1: Add imports and revertToFinal action to BlockStatusActions**

Add import:
```typescript
import { revertToFinal } from '@/app/actions/operational-entries'
import { canRevertToFinal } from '@/lib/schedule/block-status'
```

Add state for revert confirmation:
```typescript
const [confirmingRevert, setConfirmingRevert] = useState(false)
const [revertError, setRevertError] = useState<string | null>(null)
```

- [ ] **Step 2: Add Active status display + Revert to Final button**

Inside the component's return, add this block after the existing Final/Preliminary status buttons (check `block.status === 'active'`):

```tsx
        {/* Active block — lead/charge enters codes; manager can revert to Final */}
        {block.status === 'active' && (
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-green-100 text-green-800 border border-green-200">
              Active
            </span>
            {userRole === 'manager' && (
              confirmingRevert ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-600">Revert to Final?</span>
                  <button
                    type="button"
                    onClick={() => {
                      setRevertError(null)
                      startTransition(async () => {
                        const result = await revertToFinal(block.id)
                        if (result.error) {
                          setRevertError(result.error)
                          setConfirmingRevert(false)
                        } else {
                          setConfirmingRevert(false)
                        }
                      })
                    }}
                    disabled={isPending}
                    className="px-2.5 py-1 text-xs bg-amber-600 text-white rounded-md hover:bg-amber-700 disabled:opacity-50"
                  >
                    Yes, revert
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmingRevert(false)}
                    className="px-2.5 py-1 text-xs border border-slate-200 rounded-md hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmingRevert(true)}
                  className="px-2.5 py-1 text-xs border border-slate-300 text-slate-600 rounded-md hover:bg-slate-50"
                >
                  Revert to Final
                </button>
              )
            )}
            {revertError && <p className="text-xs text-red-600">{revertError}</p>}
          </div>
        )}
```

- [ ] **Step 3: TypeScript check**

```bash
npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add components/schedule/BlockStatusActions.tsx
git commit -m "feat: add Active status badge and Revert to Final to BlockStatusActions"
```

---

## Task 9: Coverage Page + CoverageHeatmap — Actual Headcount

**Files:**
- Modify: `app/(app)/coverage/page.tsx`
- Modify: `components/coverage/CoverageHeatmap.tsx`

When the selected block is `active` or `completed`, the coverage page fetches `shift_actual_headcount` and passes both planned and actual counts to CoverageHeatmap. For non-active blocks, actual = planned (no operational entries exist yet).

- [ ] **Step 1: Update coverage/page.tsx to fetch actual headcount for active/completed blocks**

Add type import:
```typescript
type ActualHeadcountRow = Database['public']['Views']['shift_actual_headcount']['Row']
```

After the existing `headcountData` fetch, add:

```typescript
  // For active/completed blocks, fetch actual headcount (includes operational entries)
  let actualHeadcount: ActualHeadcountRow[] = []
  if (block.status === 'active' || block.status === 'completed') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: actualData } = await (supabase as any)
      .from('shift_actual_headcount')
      .select('*')
      .eq('schedule_block_id', block.id) as { data: ActualHeadcountRow[] | null; error: unknown }
    actualHeadcount = (actualData ?? []) as ActualHeadcountRow[]
  }
```

Pass to CoverageHeatmap:
```tsx
      <CoverageHeatmap
        headcount={headcount}
        leadGapDates={leadGapDates}
        blockStartDate={block.start_date}
        actualHeadcount={actualHeadcount}
        blockStatus={block.status}
      />
```

Also add an Audit Log link for completed blocks:
```tsx
      {block.status === 'completed' && (
        <Link
          href={`/audit/${block.id}`}
          className="text-sm text-slate-600 underline hover:text-slate-900"
        >
          View Audit Log →
        </Link>
      )}
```

- [ ] **Step 2: Update CoverageHeatmap.tsx to display actual headcount**

Add new props:

```typescript
type ActualHeadcountRow = Database['public']['Views']['shift_actual_headcount']['Row']

interface Props {
  headcount: HeadcountRow[]
  leadGapDates: Set<string>
  blockStartDate: string
  actualHeadcount: ActualHeadcountRow[]    // NEW
  blockStatus: string                        // NEW
}
```

Add `actualByDate` map alongside `byDate`:

```typescript
  const actualByDate = useMemo(() => {
    const m = new Map<string, ActualHeadcountRow>()
    for (const row of actualHeadcount) m.set(row.shift_date, row)
    return m
  }, [actualHeadcount])

  const showActual = blockStatus === 'active' || blockStatus === 'completed'
```

Update the table header to include Actual column:

```tsx
          <th className="px-2 py-2 text-center text-slate-500 font-medium">Planned</th>
          {showActual && (
            <th className="px-2 py-2 text-center text-slate-500 font-medium">Actual</th>
          )}
```

Update the row to show actual:

```tsx
                <td className={`px-2 py-1.5 text-center font-semibold rounded ${hasWorking ? cellBg(total) : 'text-slate-400'}`}>
                  {total}
                </td>
                {showActual && (() => {
                  const actual = actualByDate.get(date)
                  const actualTotal = actual?.total_actual ?? total
                  const hasAnyEntry = actual && actual.total_actual < actual.total_planned
                  return (
                    <td className={`px-2 py-1.5 text-center font-semibold rounded ${hasWorking && hasAnyEntry ? cellBg(actualTotal) : 'text-slate-400'}`}>
                      {hasAnyEntry ? actualTotal : <span className="text-slate-300">—</span>}
                    </td>
                  )
                })()}
```

Also update the legend:
```tsx
        {showActual && (
          <span className="flex items-center gap-1">
            <span className="text-slate-400 text-xs font-mono">—</span> no entries yet (actual = planned)
          </span>
        )}
```

- [ ] **Step 3: TypeScript check**

```bash
npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add app/(app)/coverage/page.tsx components/coverage/CoverageHeatmap.tsx
git commit -m "feat: show actual headcount on coverage page for active/completed blocks"
```

---

## Task 10: Live Coverage Alert (Supabase Realtime)

**Files:**
- Create: `components/coverage/AlertBanner.tsx`
- Modify: `app/(app)/coverage/page.tsx`

AlertBanner subscribes to `INSERT` events on `operational_entries` for the active block. On each event, it checks whether `total_actual` for the affected date has dropped below 3, then shows a dismissible banner.

- [ ] **Step 1: Create AlertBanner.tsx**

```tsx
// components/coverage/AlertBanner.tsx
'use client'
import { useState, useEffect, useRef } from 'react'
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs'
import type { Database } from '@/lib/types/database.types'

type ActualHeadcountRow = Database['public']['Views']['shift_actual_headcount']['Row']

interface Props {
  blockId: string
  initialActualHeadcount: ActualHeadcountRow[]
  coverageThreshold?: number  // default 3
}

export function AlertBanner({ blockId, initialActualHeadcount, coverageThreshold = 3 }: Props) {
  const [alertDate, setAlertDate] = useState<string | null>(null)
  const actualMapRef = useRef<Map<string, number>>(new Map(
    initialActualHeadcount.map(r => [r.shift_date, r.total_actual])
  ))

  useEffect(() => {
    const supabase = createClientComponentClient<Database>()

    const channel = supabase
      .channel(`operational-entries-${blockId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'operational_entries',
          filter: `schedule_block_id=eq.${blockId}`,
        },
        async () => {
          // Re-fetch actual headcount to get accurate numbers after insert
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { data } = await (supabase as any)
            .from('shift_actual_headcount')
            .select('shift_date,total_actual')
            .eq('schedule_block_id', blockId) as {
              data: { shift_date: string; total_actual: number }[] | null
            }
          if (!data) return
          for (const row of data) {
            actualMapRef.current.set(row.shift_date, row.total_actual)
            if (row.total_actual < coverageThreshold) {
              setAlertDate(row.shift_date)
            }
          }
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [blockId, coverageThreshold])

  if (!alertDate) return null

  return (
    <div
      role="alert"
      className="flex items-center justify-between gap-3 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800"
    >
      <span>
        ⚠️ Coverage alert: <strong>{alertDate}</strong> is below minimum ({coverageThreshold} therapists).
      </span>
      <button
        type="button"
        onClick={() => setAlertDate(null)}
        className="text-red-500 hover:text-red-700 shrink-0"
        aria-label="Dismiss alert"
      >
        ✕
      </button>
    </div>
  )
}
```

**Note:** `createClientComponentClient` from `@supabase/auth-helpers-nextjs` is used for Realtime on the client. This package is already installed (it's part of `@supabase/ssr` ecosystem). If not present, install: `npm install @supabase/auth-helpers-nextjs`.

- [ ] **Step 2: Add AlertBanner to coverage/page.tsx**

Add import:
```typescript
import { AlertBanner } from '@/components/coverage/AlertBanner'
```

Render in the return JSX for active blocks (before the heatmap):
```tsx
      {block.status === 'active' && (
        <AlertBanner
          blockId={block.id}
          initialActualHeadcount={actualHeadcount}
        />
      )}
```

- [ ] **Step 3: TypeScript check**

```bash
npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add components/coverage/AlertBanner.tsx app/(app)/coverage/page.tsx
git commit -m "feat: add Realtime coverage alert banner for active blocks"
```

---

## Task 11: Audit Log Page + AuditLog Component + CSV Export

**Files:**
- Create: `app/(app)/audit/[blockId]/page.tsx`
- Create: `components/audit/AuditLog.tsx`

The audit log page is manager-only. It shows all operational entries (including removed ones) for a completed block. CSV export generates a comma-separated file client-side from the log data.

- [ ] **Step 1: Create app/(app)/audit/[blockId]/page.tsx**

```typescript
// app/(app)/audit/[blockId]/page.tsx
import { redirect } from 'next/navigation'
import { getServerUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { AuditLog } from '@/components/audit/AuditLog'
import Link from 'next/link'
import type { Database } from '@/lib/types/database.types'

type OperationalEntry = Database['public']['Tables']['operational_entries']['Row']
type UserRow = Database['public']['Tables']['users']['Row']

interface PageProps {
  params: { blockId: string }
}

export default async function AuditPage({ params }: PageProps) {
  const { blockId } = params
  const user = await getServerUser()
  if (!user) redirect('/login')

  const supabase = createClient()

  const { data: profile } = await supabase
    .from('users')
    .select('role, department_id')
    .eq('id', user.id)
    .single() as { data: { role: string; department_id: string | null } | null; error: unknown }

  if (!profile || profile.role !== 'manager') redirect('/schedule')

  // Fetch block info for display
  const { data: blockData } = await supabase
    .from('schedule_blocks')
    .select('id, shift_type, start_date, end_date, status')
    .eq('id', blockId)
    .single() as { data: { id: string; shift_type: string; start_date: string; end_date: string; status: string } | null; error: unknown }

  if (!blockData) redirect('/coverage')

  // Fetch ALL entries for this block (including removed), with entered_by user info
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: entriesData } = await (supabase as any)
    .from('operational_entries')
    .select('*')
    .eq('schedule_block_id', blockId)
    .order('entry_date', { ascending: true })
    .order('entered_at', { ascending: true }) as { data: OperationalEntry[] | null; error: unknown }

  const entries = (entriesData ?? []) as OperationalEntry[]

  // Fetch all users to resolve names
  const { data: usersData } = await supabase
    .from('users')
    .select('id, full_name')
    .eq('department_id', profile.department_id ?? '')
  const users = (usersData ?? []) as Pick<UserRow, 'id' | 'full_name'>[]

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">Audit Log</h1>
          <p className="text-sm text-slate-500 capitalize">
            {blockData.shift_type} shift · {blockData.start_date} to {blockData.end_date}
          </p>
        </div>
        <Link
          href="/coverage"
          className="text-sm text-slate-600 underline hover:text-slate-900"
        >
          ← Coverage
        </Link>
      </div>

      <AuditLog entries={entries} users={users} blockInfo={blockData} />
    </div>
  )
}
```

- [ ] **Step 2: Create components/audit/AuditLog.tsx**

```tsx
// components/audit/AuditLog.tsx
'use client'
import { format } from 'date-fns'
import type { Database } from '@/lib/types/database.types'

type OperationalEntry = Database['public']['Tables']['operational_entries']['Row']

interface Props {
  entries: OperationalEntry[]
  users: { id: string; full_name: string }[]
  blockInfo: { shift_type: string; start_date: string; end_date: string }
}

const CODE_LABELS: Record<string, string> = {
  OC: 'On Call', CI: 'Called In', CX: 'Called Out', LE: 'Left Early',
}

export function AuditLog({ entries, users, blockInfo }: Props) {
  const userMap = new Map(users.map(u => [u.id, u.full_name]))

  function downloadCSV() {
    const headers = ['Date', 'Therapist', 'Code', 'Description', 'Entered By', 'Entered At', 'Backfill', 'Note', 'Removed', 'Removed At', 'Removed By']
    const rows = entries.map(e => [
      e.entry_date,
      userMap.get(e.user_id) ?? e.user_id,
      e.entry_type,
      CODE_LABELS[e.entry_type] ?? e.entry_type,
      userMap.get(e.entered_by) ?? e.entered_by,
      format(new Date(e.entered_at), 'yyyy-MM-dd HH:mm:ss'),
      e.is_backfill ? 'Yes' : 'No',
      e.note ?? '',
      e.removed_at ? 'Yes' : 'No',
      e.removed_at ? format(new Date(e.removed_at), 'yyyy-MM-dd HH:mm:ss') : '',
      e.removed_by ? (userMap.get(e.removed_by) ?? e.removed_by) : '',
    ])
    const csv = [headers, ...rows]
      .map(r => r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `audit-${blockInfo.shift_type}-${blockInfo.start_date}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (entries.length === 0) {
    return (
      <div className="text-sm text-slate-400 py-8 text-center">
        No operational codes were entered for this block.
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={downloadCSV}
          className="px-3 py-1.5 text-sm border border-slate-300 text-slate-700 rounded-md hover:bg-slate-50"
        >
          Export CSV
        </button>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="min-w-max text-xs w-full">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200 text-left">
              <th className="px-3 py-2 text-slate-500 font-medium">Date</th>
              <th className="px-3 py-2 text-slate-500 font-medium">Therapist</th>
              <th className="px-3 py-2 text-slate-500 font-medium">Code</th>
              <th className="px-3 py-2 text-slate-500 font-medium">Entered By</th>
              <th className="px-3 py-2 text-slate-500 font-medium">Entered At</th>
              <th className="px-3 py-2 text-slate-500 font-medium">Backfill</th>
              <th className="px-3 py-2 text-slate-500 font-medium">Note</th>
              <th className="px-3 py-2 text-slate-500 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {entries.map(e => (
              <tr
                key={e.id}
                className={`border-b border-slate-100 last:border-0 ${e.removed_at ? 'opacity-50 line-through' : ''}`}
              >
                <td className="px-3 py-1.5 text-slate-700 whitespace-nowrap">
                  {format(new Date(e.entry_date + 'T00:00:00'), 'EEE, MMM d')}
                </td>
                <td className="px-3 py-1.5 text-slate-700 whitespace-nowrap">
                  {userMap.get(e.user_id) ?? '—'}
                </td>
                <td className="px-3 py-1.5 font-mono font-semibold text-slate-800">
                  {e.entry_type}
                  <span className="ml-1 font-normal text-slate-400 font-sans">
                    {CODE_LABELS[e.entry_type]}
                  </span>
                </td>
                <td className="px-3 py-1.5 text-slate-600">{userMap.get(e.entered_by) ?? '—'}</td>
                <td className="px-3 py-1.5 text-slate-500 whitespace-nowrap">
                  {format(new Date(e.entered_at), 'MMM d, HH:mm')}
                </td>
                <td className="px-3 py-1.5 text-center">
                  {e.is_backfill ? <span className="text-amber-600">✓</span> : null}
                </td>
                <td className="px-3 py-1.5 text-slate-500 max-w-[160px] truncate">{e.note ?? ''}</td>
                <td className="px-3 py-1.5">
                  {e.removed_at ? (
                    <span className="text-red-400">Removed</span>
                  ) : (
                    <span className="text-green-600">Active</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add app/(app)/audit app/\(app\)/audit components/audit
git commit -m "feat: add audit log page and AuditLog component with CSV export"
```

---

## Task 12: Build Check + Final Cleanup

**Files:**
- Fix any TypeScript/lint/build errors found

- [ ] **Step 1: Run full test suite**

```bash
npm test
```

Expected: 83/83 PASS

- [ ] **Step 2: Run TypeScript check**

```bash
npx tsc --noEmit
```

Expected: no errors. Common issues to watch for:
- New props added to CellPanel/ScheduleGrid not passed at all call sites
- `(supabase as any)` without eslint-disable comment on the line immediately before
- `[...someSet]` — replace with `Array.from(someSet)`
- `await searchParams` — remove await
- Missing type casts on `.single()` returns

- [ ] **Step 3: Run production build**

```bash
npm run build
```

Expected: exit 0. Check output for:
- `/audit/[blockId]` route listed
- `/coverage` route listed
- `/schedule` route listed
- No "Type error:" lines

- [ ] **Step 4: Fix any issues found**

For each build error: identify the file, fix the specific issue, re-run `npm run build`.

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "fix: resolve build errors from Phase 5 integration"
```

---

## Phase 5 Done When

- Lead/charge can open a Working cell on an active block (today or prior date) and tap OC/CI/CX/LE in 3 taps — works at 360px viewport width, 44px button height
- Actual headcount updates on the Coverage page after any code is entered
- An alert banner appears on the Coverage page when actual drops below 3 (Realtime)
- Therapists see their own entered codes in read-only mode in CellPanel/WeekView
- Manager can revert an Active block back to Final with a confirmation step
- Completed blocks have a full operational log at `/audit/[blockId]` with CSV export
- `npm run build` exits 0, `npm test` shows 83/83 PASS

---

## Post-Implementation Notes

- Mobile layout behavior depends on local client chunk freshness during development. If interactions appear non-responsive while markup is visible, check for `/_next/static/chunks/*` 404 responses and restart local dev after clearing `.next`.
- Coverage now keeps an `Actual` column visible for consistency; values are shown for `active`/`completed` blocks and rendered as `-` for earlier statuses.
