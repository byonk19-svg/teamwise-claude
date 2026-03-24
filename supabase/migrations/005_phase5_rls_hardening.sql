-- supabase/migrations/005_phase5_rls_hardening.sql
-- Backward-compatible hardening:
-- 1) normalize legacy columns when older swap/operational tables exist
-- 2) replace broad authenticated policies with department-scoped policies

-- =========================
-- Normalize swap_requests
-- =========================
ALTER TABLE public.swap_requests
  ADD COLUMN IF NOT EXISTS schedule_block_id UUID,
  ADD COLUMN IF NOT EXISTS partner_id UUID,
  ADD COLUMN IF NOT EXISTS partner_shift_id UUID,
  ADD COLUMN IF NOT EXISTS request_note TEXT,
  ADD COLUMN IF NOT EXISTS response_note TEXT,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();

UPDATE public.swap_requests
SET partner_id = target_id
WHERE partner_id IS NULL
  AND target_id IS NOT NULL;

UPDATE public.swap_requests
SET partner_shift_id = target_shift_id
WHERE partner_shift_id IS NULL
  AND target_shift_id IS NOT NULL;

UPDATE public.swap_requests
SET request_note = requester_note
WHERE request_note IS NULL
  AND requester_note IS NOT NULL;

UPDATE public.swap_requests
SET response_note = denial_reason
WHERE response_note IS NULL
  AND denial_reason IS NOT NULL;

UPDATE public.swap_requests
SET created_at = submitted_at
WHERE created_at IS NULL
  AND submitted_at IS NOT NULL;

UPDATE public.swap_requests sr
SET schedule_block_id = s.schedule_block_id
FROM public.shifts s
WHERE sr.schedule_block_id IS NULL
  AND s.id = sr.requester_shift_id;

-- ==============================
-- Normalize operational_entries
-- ==============================
ALTER TABLE public.operational_entries
  ADD COLUMN IF NOT EXISTS schedule_block_id UUID,
  ADD COLUMN IF NOT EXISTS user_id UUID,
  ADD COLUMN IF NOT EXISTS entry_type TEXT;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'operational_entries'
      AND column_name = 'code'
  ) THEN
    EXECUTE $q$
      UPDATE public.operational_entries
      SET entry_type = UPPER(code::text)
      WHERE entry_type IS NULL
        AND code IS NOT NULL
    $q$;
  END IF;
END$$;

UPDATE public.operational_entries oe
SET schedule_block_id = s.schedule_block_id,
    user_id = s.user_id
FROM public.shifts s
WHERE s.id = oe.shift_id
  AND (oe.schedule_block_id IS NULL OR oe.user_id IS NULL);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'operational_entries_entry_type_check'
  ) THEN
    ALTER TABLE public.operational_entries
      ADD CONSTRAINT operational_entries_entry_type_check
      CHECK (entry_type IN ('OC', 'CI', 'CX', 'LE'));
  END IF;
END$$;

-- =========================
-- swap_requests policies
-- =========================
DROP POLICY IF EXISTS "Authenticated read swap_requests" ON public.swap_requests;
DROP POLICY IF EXISTS "Authenticated insert swap_requests" ON public.swap_requests;
DROP POLICY IF EXISTS "Authenticated update swap_requests" ON public.swap_requests;
DROP POLICY IF EXISTS "authenticated_all_swap_requests" ON public.swap_requests;
DROP POLICY IF EXISTS "Department read swap_requests" ON public.swap_requests;
DROP POLICY IF EXISTS "Department insert swap_requests" ON public.swap_requests;
DROP POLICY IF EXISTS "Manager update swap_requests" ON public.swap_requests;

CREATE POLICY "Department read swap_requests"
  ON public.swap_requests
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.users me
      JOIN public.schedule_blocks b ON b.id = schedule_block_id
      WHERE me.id = auth.uid()
        AND me.department_id = b.department_id
    )
  );

CREATE POLICY "Department insert swap_requests"
  ON public.swap_requests
  FOR INSERT
  WITH CHECK (
    requester_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.users me
      JOIN public.schedule_blocks b ON b.id = schedule_block_id
      WHERE me.id = auth.uid()
        AND me.department_id = b.department_id
    )
  );

CREATE POLICY "Manager update swap_requests"
  ON public.swap_requests
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1
      FROM public.users me
      JOIN public.schedule_blocks b ON b.id = schedule_block_id
      WHERE me.id = auth.uid()
        AND me.role = 'manager'
        AND me.department_id = b.department_id
    )
  );

-- ===========================
-- operational_entries policies
-- ===========================
DROP POLICY IF EXISTS "Authenticated read operational_entries" ON public.operational_entries;
DROP POLICY IF EXISTS "Authenticated insert operational_entries" ON public.operational_entries;
DROP POLICY IF EXISTS "Authenticated update operational_entries" ON public.operational_entries;
DROP POLICY IF EXISTS "authenticated_all_op_entries" ON public.operational_entries;
DROP POLICY IF EXISTS "Department read operational_entries" ON public.operational_entries;
DROP POLICY IF EXISTS "Department insert operational_entries" ON public.operational_entries;
DROP POLICY IF EXISTS "Manager or owner update operational_entries" ON public.operational_entries;

CREATE POLICY "Department read operational_entries"
  ON public.operational_entries
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.users me
      JOIN public.schedule_blocks b ON b.id = schedule_block_id
      WHERE me.id = auth.uid()
        AND me.department_id = b.department_id
    )
  );

CREATE POLICY "Department insert operational_entries"
  ON public.operational_entries
  FOR INSERT
  WITH CHECK (
    entered_by = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.users me
      JOIN public.schedule_blocks b ON b.id = schedule_block_id
      WHERE me.id = auth.uid()
        AND me.department_id = b.department_id
    )
  );

CREATE POLICY "Manager or owner update operational_entries"
  ON public.operational_entries
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1
      FROM public.users me
      JOIN public.schedule_blocks b ON b.id = schedule_block_id
      WHERE me.id = auth.uid()
        AND me.department_id = b.department_id
        AND (me.role = 'manager' OR entered_by = auth.uid())
    )
  );
