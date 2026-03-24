-- supabase/migrations/004_phase5_operational.sql
-- Phase 5 operational layer: entries, coverage view, RPCs, and auto-activate cron

CREATE TABLE IF NOT EXISTS public.operational_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_block_id UUID NOT NULL REFERENCES public.schedule_blocks(id) ON DELETE CASCADE,
  shift_id UUID NOT NULL REFERENCES public.shifts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id),
  entry_date DATE NOT NULL,
  entry_type TEXT NOT NULL CHECK (entry_type IN ('OC', 'CI', 'CX', 'LE')),
  note TEXT,
  is_backfill BOOLEAN NOT NULL DEFAULT false,
  entered_by UUID NOT NULL REFERENCES public.users(id),
  entered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  removed_at TIMESTAMPTZ,
  removed_by UUID REFERENCES public.users(id)
);

ALTER TABLE public.operational_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read operational_entries"
  ON public.operational_entries FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated insert operational_entries"
  ON public.operational_entries FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Authenticated update operational_entries"
  ON public.operational_entries FOR UPDATE
  USING (auth.role() = 'authenticated');

CREATE OR REPLACE VIEW public.shift_actual_headcount AS
SELECT
  s.schedule_block_id,
  s.shift_date,
  COUNT(CASE WHEN u.employment_type = 'full_time' AND s.cell_state = 'working' THEN 1 END)::INT AS ft_planned,
  COUNT(CASE WHEN u.employment_type = 'prn' AND s.cell_state = 'working' THEN 1 END)::INT AS prn_planned,
  COUNT(CASE WHEN s.cell_state = 'working' THEN 1 END)::INT AS total_planned,
  GREATEST(
    0,
    COUNT(CASE WHEN u.employment_type = 'full_time' AND s.cell_state = 'working' THEN 1 END)
      - COUNT(
        CASE WHEN u.employment_type = 'full_time'
          AND s.cell_state = 'working'
          AND EXISTS (
            SELECT 1
            FROM public.operational_entries oe
            WHERE oe.shift_id = s.id
              AND oe.removed_at IS NULL
          ) THEN 1 END
      )
  )::INT AS ft_actual,
  GREATEST(
    0,
    COUNT(CASE WHEN u.employment_type = 'prn' AND s.cell_state = 'working' THEN 1 END)
      - COUNT(
        CASE WHEN u.employment_type = 'prn'
          AND s.cell_state = 'working'
          AND EXISTS (
            SELECT 1
            FROM public.operational_entries oe
            WHERE oe.shift_id = s.id
              AND oe.removed_at IS NULL
          ) THEN 1 END
      )
  )::INT AS prn_actual,
  GREATEST(
    0,
    COUNT(CASE WHEN s.cell_state = 'working' THEN 1 END)
      - COUNT(
        CASE WHEN s.cell_state = 'working'
          AND EXISTS (
            SELECT 1
            FROM public.operational_entries oe
            WHERE oe.shift_id = s.id
              AND oe.removed_at IS NULL
          ) THEN 1 END
      )
  )::INT AS total_actual
FROM public.shifts s
JOIN public.users u ON u.id = s.user_id
GROUP BY s.schedule_block_id, s.shift_date;

CREATE OR REPLACE FUNCTION public.enter_operational_code(
  p_schedule_block_id UUID,
  p_shift_id UUID,
  p_entry_type TEXT,
  p_note TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_block_status TEXT;
  v_shift_date DATE;
  v_cell_state TEXT;
  v_user_role TEXT;
  v_is_lead BOOLEAN;
  v_shift_user_id UUID;
BEGIN
  SELECT status INTO v_block_status
  FROM public.schedule_blocks
  WHERE id = p_schedule_block_id;

  IF v_block_status != 'active' THEN
    RETURN jsonb_build_object('error', 'Block is not active');
  END IF;

  SELECT shift_date, cell_state, user_id
  INTO v_shift_date, v_cell_state, v_shift_user_id
  FROM public.shifts
  WHERE id = p_shift_id;

  IF v_cell_state != 'working' THEN
    RETURN jsonb_build_object('error', 'Shift is not working');
  END IF;

  IF v_shift_date > CURRENT_DATE THEN
    RETURN jsonb_build_object('error', 'Cannot enter code for a future date');
  END IF;

  SELECT role INTO v_user_role
  FROM public.users
  WHERE id = auth.uid();

  IF v_user_role = 'therapist' THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.shifts
      WHERE schedule_block_id = p_schedule_block_id
        AND lead_user_id = auth.uid()
    ) INTO v_is_lead;

    IF NOT v_is_lead THEN
      RETURN jsonb_build_object('error', 'Only the lead/charge or a manager can enter codes');
    END IF;
  END IF;

  INSERT INTO public.operational_entries (
    schedule_block_id,
    shift_id,
    user_id,
    entry_date,
    entry_type,
    note,
    is_backfill,
    entered_by
  ) VALUES (
    p_schedule_block_id,
    p_shift_id,
    v_shift_user_id,
    v_shift_date,
    p_entry_type,
    p_note,
    (v_shift_date != CURRENT_DATE),
    auth.uid()
  );

  RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_operational_code(
  p_entry_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_role TEXT;
  v_entered_by UUID;
BEGIN
  SELECT role INTO v_user_role
  FROM public.users
  WHERE id = auth.uid();

  SELECT entered_by INTO v_entered_by
  FROM public.operational_entries
  WHERE id = p_entry_id;

  IF v_entered_by IS NULL THEN
    RETURN jsonb_build_object('error', 'Entry not found');
  END IF;

  IF v_user_role = 'therapist' AND v_entered_by != auth.uid() THEN
    RETURN jsonb_build_object('error', 'Cannot remove another user''s entry');
  END IF;

  UPDATE public.operational_entries
  SET removed_at = now(),
      removed_by = auth.uid()
  WHERE id = p_entry_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.revert_to_final(
  p_schedule_block_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_role TEXT;
  v_block_status TEXT;
BEGIN
  SELECT role INTO v_user_role
  FROM public.users
  WHERE id = auth.uid();

  IF v_user_role != 'manager' THEN
    RETURN jsonb_build_object('error', 'Manager access required');
  END IF;

  SELECT status INTO v_block_status
  FROM public.schedule_blocks
  WHERE id = p_schedule_block_id;

  IF v_block_status != 'active' THEN
    RETURN jsonb_build_object('error', 'Block must be active to revert to Final');
  END IF;

  UPDATE public.schedule_blocks
  SET status = 'final'
  WHERE id = p_schedule_block_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

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
