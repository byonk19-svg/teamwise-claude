-- supabase/migrations/001_initial_schema.sql
-- Teamwise complete schema — all phases defined here so Phase 1 decisions are never revisited

-- ============================================================
-- ENUMS
-- ============================================================
CREATE TYPE user_role          AS ENUM ('manager', 'therapist');
CREATE TYPE employment_type    AS ENUM ('full_time', 'prn');
CREATE TYPE shift_type         AS ENUM ('day', 'night');
CREATE TYPE block_status       AS ENUM ('preliminary_draft', 'preliminary', 'final', 'active', 'completed');
CREATE TYPE cell_state         AS ENUM ('working', 'cannot_work', 'off', 'fmla');
CREATE TYPE operational_code   AS ENUM ('on_call', 'call_in', 'cancelled', 'left_early');
CREATE TYPE avail_entry_type   AS ENUM ('cannot_work', 'requesting_to_work', 'available_day', 'available_night', 'available_either');
CREATE TYPE change_req_type    AS ENUM ('move_shift', 'mark_off', 'other');
CREATE TYPE change_req_status  AS ENUM ('pending', 'accepted', 'rejected');
CREATE TYPE swap_status        AS ENUM ('pending', 'approved', 'denied', 'expired', 'cancelled');
CREATE TYPE prn_interest_status AS ENUM ('pending', 'confirmed', 'declined');

-- ============================================================
-- DEPARTMENTS
-- ============================================================
CREATE TABLE departments (
  id         uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name       text NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- ============================================================
-- USERS (mirrors auth.users via id FK)
-- ============================================================
CREATE TABLE users (
  id                uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email             text UNIQUE NOT NULL,
  full_name         text NOT NULL,
  role              user_role NOT NULL DEFAULT 'therapist',
  employment_type   employment_type NOT NULL DEFAULT 'full_time',
  is_lead_qualified boolean NOT NULL DEFAULT false,
  default_shift_type shift_type,           -- NULL = PRN / flexible
  department_id     uuid REFERENCES departments(id),
  created_at        timestamptz DEFAULT now()
);

-- ============================================================
-- SCHEDULE_BLOCKS
-- ============================================================
CREATE TABLE schedule_blocks (
  id                       uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  department_id            uuid NOT NULL REFERENCES departments(id),
  shift_type               shift_type NOT NULL,
  start_date               date NOT NULL,
  end_date                 date NOT NULL,
  status                   block_status NOT NULL DEFAULT 'preliminary_draft',
  copied_from_block_id     uuid REFERENCES schedule_blocks(id),
  availability_window_open  timestamptz,
  availability_window_close timestamptz,
  published_by             uuid REFERENCES users(id),
  published_at             timestamptz,
  created_by               uuid NOT NULL REFERENCES users(id),
  created_at               timestamptz DEFAULT now(),
  CONSTRAINT date_range_valid CHECK (end_date > start_date),
  CONSTRAINT block_is_42_days CHECK (end_date = start_date + INTERVAL '41 days')
);

-- ============================================================
-- SHIFTS — planning layer only; never mutated by op codes
-- One row per therapist per date per block.
-- ============================================================
CREATE TABLE shifts (
  id                    uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  schedule_block_id     uuid NOT NULL REFERENCES schedule_blocks(id) ON DELETE CASCADE,
  user_id               uuid NOT NULL REFERENCES users(id),
  shift_date            date NOT NULL,
  cell_state            cell_state NOT NULL DEFAULT 'off',
  lead_user_id          uuid REFERENCES users(id),
  is_cross_shift        boolean NOT NULL DEFAULT false,
  modified_after_publish boolean NOT NULL DEFAULT false,
  created_at            timestamptz DEFAULT now(),
  updated_at            timestamptz DEFAULT now(),
  UNIQUE (schedule_block_id, user_id, shift_date)
);

-- Auto-update updated_at on shifts
CREATE OR REPLACE FUNCTION touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_shifts_updated_at
  BEFORE UPDATE ON shifts
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ============================================================
-- OPERATIONAL_ENTRIES — append-only audit log
-- Overlaid on shifts; never modifies shifts table.
-- ============================================================
CREATE TABLE operational_entries (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  shift_id    uuid NOT NULL REFERENCES shifts(id),
  code        operational_code NOT NULL,
  note        text,
  entry_date  date NOT NULL,
  is_backfill boolean NOT NULL DEFAULT false,
  entered_by  uuid NOT NULL REFERENCES users(id),
  entered_at  timestamptz NOT NULL DEFAULT now(),
  removed_by  uuid REFERENCES users(id),
  removed_at  timestamptz,
  is_active   boolean NOT NULL DEFAULT true
);

-- Trigger: new active entry → deactivate all prior active entries for same shift
CREATE OR REPLACE FUNCTION deactivate_prior_op_entries()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.is_active = true THEN
    UPDATE operational_entries
    SET    is_active = false
    WHERE  shift_id = NEW.shift_id
      AND  id != NEW.id
      AND  is_active = true;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_deactivate_prior_op_entries
  AFTER INSERT ON operational_entries
  FOR EACH ROW EXECUTE FUNCTION deactivate_prior_op_entries();

-- ============================================================
-- AVAILABILITY_SUBMISSIONS + AVAILABILITY_ENTRIES
-- ============================================================
CREATE TABLE availability_submissions (
  id                uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  schedule_block_id uuid NOT NULL REFERENCES schedule_blocks(id) ON DELETE CASCADE,
  user_id           uuid NOT NULL REFERENCES users(id),
  submitted_at      timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (schedule_block_id, user_id)
);

CREATE TABLE availability_entries (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  submission_id uuid NOT NULL REFERENCES availability_submissions(id) ON DELETE CASCADE,
  entry_date    date NOT NULL,
  entry_type    avail_entry_type NOT NULL,
  note          text,
  UNIQUE (submission_id, entry_date)
);

-- ============================================================
-- PRELIMINARY_CHANGE_REQUESTS
-- ============================================================
CREATE TABLE preliminary_change_requests (
  id                uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  schedule_block_id uuid NOT NULL REFERENCES schedule_blocks(id) ON DELETE CASCADE,
  requester_id      uuid NOT NULL REFERENCES users(id),
  shift_id          uuid NOT NULL REFERENCES shifts(id),
  request_type      change_req_type NOT NULL,
  note              text,
  status            change_req_status NOT NULL DEFAULT 'pending',
  response_note     text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  actioned_at       timestamptz,
  actioned_by       uuid REFERENCES users(id)
);

-- ============================================================
-- POST_PUBLISH_EDITS — logs manager edits to active blocks on past/operational dates
-- ============================================================
CREATE TABLE post_publish_edits (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  shift_id      uuid NOT NULL REFERENCES shifts(id),
  edited_by     uuid NOT NULL REFERENCES users(id),
  edited_at     timestamptz NOT NULL DEFAULT now(),
  action_type   text NOT NULL DEFAULT 'post_publish_edit',
  field_changed text NOT NULL,
  old_value     text,
  new_value     text
);

-- ============================================================
-- SWAP_REQUESTS
-- ============================================================
CREATE TABLE swap_requests (
  id                       uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  requester_id             uuid NOT NULL REFERENCES users(id),
  target_id                uuid NOT NULL REFERENCES users(id),
  requester_shift_id       uuid NOT NULL REFERENCES shifts(id),
  target_shift_id          uuid NOT NULL REFERENCES shifts(id),
  status                   swap_status NOT NULL DEFAULT 'pending',
  is_cross_shift           boolean NOT NULL DEFAULT false,
  cross_shift_acknowledged boolean NOT NULL DEFAULT false,
  lead_impact_warning      boolean NOT NULL DEFAULT false,
  requester_note           text,
  denial_reason            text,
  expires_at               timestamptz NOT NULL,
  submitted_at             timestamptz NOT NULL DEFAULT now(),
  actioned_at              timestamptz,
  actioned_by              uuid REFERENCES users(id)
);

-- Trigger: new op entry on a shift → cancel any pending swaps for that shift
CREATE OR REPLACE FUNCTION cancel_pending_swaps_on_op_entry()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.is_active = true THEN
    UPDATE swap_requests
    SET    status = 'cancelled'
    WHERE  status = 'pending'
      AND  (requester_shift_id = NEW.shift_id OR target_shift_id = NEW.shift_id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_cancel_pending_swaps_on_op_entry
  AFTER INSERT ON operational_entries
  FOR EACH ROW EXECUTE FUNCTION cancel_pending_swaps_on_op_entry();

-- ============================================================
-- PRN_SHIFT_INTEREST
-- ============================================================
CREATE TABLE prn_shift_interest (
  id                  uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id             uuid NOT NULL REFERENCES users(id),
  shift_id            uuid NOT NULL REFERENCES shifts(id),
  status              prn_interest_status NOT NULL DEFAULT 'pending',
  outside_availability boolean NOT NULL DEFAULT false,
  submitted_at        timestamptz NOT NULL DEFAULT now(),
  actioned_at         timestamptz,
  actioned_by         uuid REFERENCES users(id),
  UNIQUE (user_id, shift_id)
);

-- ============================================================
-- COVERAGE_THRESHOLDS
-- ============================================================
CREATE TABLE coverage_thresholds (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  department_id uuid NOT NULL REFERENCES departments(id),
  shift_type    shift_type NOT NULL,
  minimum_staff integer NOT NULL DEFAULT 3,
  ideal_staff   integer NOT NULL DEFAULT 4,
  maximum_staff integer NOT NULL DEFAULT 5,
  updated_by    uuid REFERENCES users(id),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (department_id, shift_type)
);

-- ============================================================
-- VIEWS
-- ============================================================

-- Planned headcount per date per block (used by grid count rows in Phase 2+)
CREATE VIEW shift_planned_headcount AS
SELECT
  s.schedule_block_id,
  s.shift_date,
  COUNT(*) FILTER (
    WHERE s.cell_state = 'working'
    AND   (SELECT u.employment_type FROM users u WHERE u.id = s.user_id) = 'full_time'
  ) AS ft_count,
  COUNT(*) FILTER (
    WHERE s.cell_state = 'working'
    AND   (SELECT u.employment_type FROM users u WHERE u.id = s.user_id) = 'prn'
  ) AS prn_count,
  COUNT(*) FILTER (WHERE s.cell_state = 'working') AS total_count
FROM shifts s
GROUP BY s.schedule_block_id, s.shift_date;

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
ALTER TABLE departments              ENABLE ROW LEVEL SECURITY;
ALTER TABLE users                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedule_blocks          ENABLE ROW LEVEL SECURITY;
ALTER TABLE shifts                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE operational_entries      ENABLE ROW LEVEL SECURITY;
ALTER TABLE availability_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE availability_entries     ENABLE ROW LEVEL SECURITY;
ALTER TABLE preliminary_change_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE post_publish_edits       ENABLE ROW LEVEL SECURITY;
ALTER TABLE swap_requests            ENABLE ROW LEVEL SECURITY;
ALTER TABLE prn_shift_interest       ENABLE ROW LEVEL SECURITY;
ALTER TABLE coverage_thresholds      ENABLE ROW LEVEL SECURITY;

-- Phase 1: any authenticated user can read/write.
-- Per-role policies refined in later phases.
CREATE POLICY "authenticated_all_departments"      ON departments              FOR ALL USING (auth.uid() IS NOT NULL);
CREATE POLICY "authenticated_all_users"            ON users                    FOR ALL USING (auth.uid() IS NOT NULL);
CREATE POLICY "authenticated_all_schedule_blocks"  ON schedule_blocks          FOR ALL USING (auth.uid() IS NOT NULL);
CREATE POLICY "authenticated_all_shifts"           ON shifts                   FOR ALL USING (auth.uid() IS NOT NULL);
CREATE POLICY "authenticated_all_op_entries"       ON operational_entries      FOR ALL USING (auth.uid() IS NOT NULL);
CREATE POLICY "authenticated_all_avail_subs"       ON availability_submissions FOR ALL USING (auth.uid() IS NOT NULL);
CREATE POLICY "authenticated_all_avail_entries"    ON availability_entries     FOR ALL USING (auth.uid() IS NOT NULL);
CREATE POLICY "authenticated_all_change_requests"  ON preliminary_change_requests FOR ALL USING (auth.uid() IS NOT NULL);
CREATE POLICY "authenticated_all_post_pub_edits"   ON post_publish_edits       FOR ALL USING (auth.uid() IS NOT NULL);
CREATE POLICY "authenticated_all_swap_requests"    ON swap_requests            FOR ALL USING (auth.uid() IS NOT NULL);
CREATE POLICY "authenticated_all_prn_interest"     ON prn_shift_interest       FOR ALL USING (auth.uid() IS NOT NULL);
CREATE POLICY "authenticated_all_coverage"         ON coverage_thresholds      FOR ALL USING (auth.uid() IS NOT NULL);

-- operational_entries is append-only: block all DELETE
CREATE POLICY "no_delete_op_entries" ON operational_entries FOR DELETE USING (false);
