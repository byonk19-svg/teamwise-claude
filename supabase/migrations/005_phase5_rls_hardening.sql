-- supabase/migrations/005_phase5_rls_hardening.sql
-- Tighten department scoping policies for swap_requests and operational_entries.

-- swap_requests
DROP POLICY IF EXISTS "Authenticated read swap_requests" ON public.swap_requests;
DROP POLICY IF EXISTS "Authenticated insert swap_requests" ON public.swap_requests;
DROP POLICY IF EXISTS "Authenticated update swap_requests" ON public.swap_requests;

CREATE POLICY "Department read swap_requests"
  ON public.swap_requests
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.users me
      JOIN public.schedule_blocks b ON b.id = public.swap_requests.schedule_block_id
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
      JOIN public.schedule_blocks b ON b.id = public.swap_requests.schedule_block_id
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
      JOIN public.schedule_blocks b ON b.id = public.swap_requests.schedule_block_id
      WHERE me.id = auth.uid()
        AND me.role = 'manager'
        AND me.department_id = b.department_id
    )
  );

-- operational_entries
DROP POLICY IF EXISTS "Authenticated read operational_entries" ON public.operational_entries;
DROP POLICY IF EXISTS "Authenticated insert operational_entries" ON public.operational_entries;
DROP POLICY IF EXISTS "Authenticated update operational_entries" ON public.operational_entries;

CREATE POLICY "Department read operational_entries"
  ON public.operational_entries
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.users me
      JOIN public.schedule_blocks b ON b.id = public.operational_entries.schedule_block_id
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
      JOIN public.schedule_blocks b ON b.id = public.operational_entries.schedule_block_id
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
      JOIN public.schedule_blocks b ON b.id = public.operational_entries.schedule_block_id
      WHERE me.id = auth.uid()
        AND me.department_id = b.department_id
        AND (
          me.role = 'manager'
          OR public.operational_entries.entered_by = auth.uid()
        )
    )
  );
