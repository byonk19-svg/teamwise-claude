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
DECLARE
  v_source_start date;
  v_new_start    date;
BEGIN
  SELECT start_date INTO v_source_start FROM schedule_blocks WHERE id = source_block_id;
  SELECT start_date INTO v_new_start    FROM schedule_blocks WHERE id = new_block_id;

  INSERT INTO shifts (
    schedule_block_id, user_id, shift_date,
    cell_state, lead_user_id, is_cross_shift, modified_after_publish
  )
  SELECT
    new_block_id,
    s.user_id,
    s.shift_date + (v_new_start - v_source_start),  -- remap dates to new block window
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
