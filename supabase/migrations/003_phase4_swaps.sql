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
