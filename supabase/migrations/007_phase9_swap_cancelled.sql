-- Phase 9: allow cancelling pending swaps (e.g. therapist deactivation)
ALTER TABLE public.swap_requests DROP CONSTRAINT IF EXISTS swap_requests_status_check;
ALTER TABLE public.swap_requests ADD CONSTRAINT swap_requests_status_check
  CHECK (status IN ('pending', 'approved', 'rejected', 'expired', 'cancelled'));
