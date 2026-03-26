# Phase 9: Staff Management & Settings — Design Spec

**Date:** 2026-03-24  
**Project:** Teamwise  
**Scope:** Manager-only `/staff` and `/settings` pages  
**Status:** Implemented in-repo. One follow-up migration extends `swap_requests` status values — see **`supabase/migrations/007_phase9_swap_cancelled.sql`** (required for deactivation when pending swaps exist).

---

## Overview

Two new pages for the manager role. `/staff` provides full lifecycle management of therapist accounts: invite, edit profile attributes, and soft-deactivate. `/settings` exposes department-level coverage thresholds. Core tables (`users`, `coverage_thresholds`, etc.) already existed; **`007_phase9_swap_cancelled.sql`** adds `'cancelled'` to the `swap_requests` status check for the deactivation flow.

---

## 1. Architecture

### `/staff` page

- **Route:** `app/(app)/staff/page.tsx` — async server component
- **Data:** Fetches all `users` rows where `department_id = manager's dept AND role = 'therapist'`, ordered by `full_name`
- **Layout:** Full-width table + floating "Invite Therapist" button

### `/settings` page

- **Route:** `app/(app)/settings/page.tsx` — async server component
- **Data:** Fetches `coverage_thresholds` rows for the manager's dept (one per shift_type: day/night)
- **Layout:** Single-section form, two shift-type groups

### Server actions

| File | Actions |
|------|---------|
| `app/actions/staff.ts` | `inviteTherapist`, `updateTherapist`, `deactivateTherapist` |
| `app/actions/settings.ts` | `updateCoverageThresholds` |

### Supabase client usage

| Action | Client | Reason |
|--------|--------|--------|
| `inviteTherapist` | service-role | `auth.admin.inviteUserByEmail` requires service-role; insert into `public.users` bypasses RLS |
| `deactivateTherapist` | anon (auth) + service-role | Anon client for session auth + role guard; service-role for dept-guard read + mutation |
| `updateTherapist` | anon (cookie) | Manager edits own dept's users; RLS passes |
| `updateCoverageThresholds` | anon (cookie) | Manager edits own dept's thresholds; RLS passes |

### Manual Table Access Pattern

`coverage_thresholds` is not in the generated Supabase client and must be accessed via `(supabase as any).from('coverage_thresholds')`. Add `coverage_thresholds` to the manual table reference in `CLAUDE.md`. Also add the type stub to `lib/types/database.types.ts`:

```ts
coverage_thresholds: {
  Row: {
    id: string
    department_id: string
    shift_type: 'day' | 'night'
    minimum_staff: number
    ideal_staff: number
    maximum_staff: number
    updated_by: string | null
    updated_at: string
  }
}
```

---

## 2. Components

### `components/staff/`

**`StaffTable`** (client component)
- Renders a shadcn `Table` with columns: Name, Type (FT/PRN badge), Lead Qualified (✓ icon), Default Shift, Edit (icon button)
- Manages open/closed state for `StaffSheet` (tracks which `userId` is being edited)
- Contains the "Invite Therapist" button that opens `InviteDialog`

**`StaffSheet`** (client component)
- shadcn `Sheet` (right-side panel) opened from `StaffTable`
- Edit form fields:
  - `full_name` — text input
  - `employment_type` — Select: "Full-time" | "PRN"
  - `is_lead_qualified` — Checkbox
  - `default_shift_type` — Select: "Day" | "Night" | "Flexible (none)"
- Save button calls `updateTherapist`; returns `{}` on success, closes Sheet
- Deactivate button (destructive red, confirmation inline: "Are you sure? This removes them from the department.") calls `deactivateTherapist`
- Inline error display; closes Sheet on success

**`InviteDialog`** (client component)
- shadcn `Dialog` opened from `StaffTable`
- Fields:
  - `full_name` — text input
  - `email` — email input
  - `employment_type` — Select: "Full-time" | "PRN" (defaults to Full-time; surfaced explicitly so manager sets the correct type at invite time)
- Submit calls `inviteTherapist`
- Success state: "Invite sent to [email]" with Close button
- Error state: inline message (e.g. "A user with that email already exists")

### `components/settings/`

**`CoverageThresholdsForm`** (client component)
- Two sections: Day Shift and Night Shift
- Each section: three number inputs — Minimum Staff, Ideal Staff, Maximum Staff
- Client-side validation: `min ≤ ideal ≤ max` (inclusive; shows inline error before submit)
- Submit calls `updateCoverageThresholds`
- Inline success confirmation: "Saved ✓" (fades after 3 seconds)
- Pre-populated with current threshold values from server

---

## 3. Server Action Detail

### `inviteTherapist(fullName, email, employmentType)`

1. Authenticate + verify `role === 'manager'`; fetch manager's `department_id`
2. Call `supabase.auth.admin.inviteUserByEmail(email, { data: { full_name: fullName } })` via service-role client
3. Insert into `public.users`: `{ id: newUser.id, email, full_name: fullName, role: 'therapist', employment_type: employmentType, is_lead_qualified: false, department_id }`
4. **If step 3 fails:** call `supabase.auth.admin.deleteUser(newUser.id)` to remove the orphaned auth account before returning the error. If the compensating delete also fails, log the orphaned auth user ID (`console.error('[inviteTherapist] compensating deleteUser failed', { userId: newUser.id, error })`) and still return the original profile-insert error to the client — do not surface the delete failure to the user.
5. `revalidatePath('/staff')`
6. Return `{}`

**Error cases:**
- Duplicate email: catch Supabase error, return `{ error: 'A user with that email already exists' }`
- `public.users` insert failure: compensating delete of auth user (with logged fallback if delete also fails), return `{ error: 'Failed to create user profile. Please try again.' }`

### `updateTherapist(userId, { fullName, employmentType, isLeadQualified, defaultShiftType })`

1. Authenticate + verify `role === 'manager'`; fetch manager's `department_id` — use anon client
2. Verify target user's `department_id` matches manager's dept (cross-dept guard)
3. Update `users` row: `full_name`, `employment_type`, `is_lead_qualified`, `default_shift_type`
4. `revalidatePath('/staff')`
5. Return `{}`

### `deactivateTherapist(userId)`

Uses **anon client** for session auth + role guard; **service-role client** for all DB reads and writes.

1. Authenticate via anon client + verify `role === 'manager'`; fetch manager's `department_id`
2. Via service-role client: verify target user's `department_id` matches manager's dept
3. Cancel all `pending` swap_requests where `requester_id = userId OR partner_id = userId`: set `status = 'cancelled'`
4. Decline all `pending` prn_shift_interest rows where `user_id = userId`: set `status = 'declined'`, `actioned_by = managerId`, `actioned_at = now()` (matches the audit trail set by `resolvePrnInterest`)
5. Set `department_id = null` on the `users` row (soft-remove; preserves all shift history)
6. `revalidatePath('/staff')`
7. Return `{}`

> **Note:** Hard deletion is not supported. The `shifts.user_id` FK has no ON DELETE CASCADE, so deleting an auth user with existing shifts would fail at the DB level. Soft-deactivation (nulling `department_id`) is the correct approach and is reversible via direct DB access. The deactivated user's `/today` page will show "Your account is not assigned to a department. Contact your manager." — this is the existing graceful fallback.

> **Note:** Steps 3 and 4 use `(supabase as any)` casts — `swap_requests` and `prn_shift_interest` are manually-typed tables.

### `updateCoverageThresholds({ day, night })`

Each of `day` and `night` is `{ minimum_staff, ideal_staff, maximum_staff }`.

1. Authenticate + verify `role === 'manager'`; fetch manager's `department_id`
2. Server-side validate both sets: `min ≤ ideal ≤ max` (return error string if invalid)
3. Upsert both rows into `coverage_thresholds` via `(supabase as any)`:
   - ON CONFLICT `(department_id, shift_type)` DO UPDATE `minimum_staff`, `ideal_staff`, `maximum_staff`, `updated_by = managerId`, `updated_at = now()`
4. `revalidatePath('/settings')`
5. Return `{}`

---

## 4. Pure Helpers & Tests

**`lib/settings/validate.ts`**

```ts
export function validateCoverageThresholds(
  min: number, ideal: number, max: number
): string | null
```

Returns `null` if valid (`min ≤ ideal ≤ max`), or an error string describing the violation.

**`tests/unit/staff-settings.test.ts`** — 4 tests:
- Valid range (2, 4, 5) → `null`
- Equal boundary (4, 4, 4) → `null` (forces `<=` not `<` in implementation)
- min > ideal (5, 3, 6) → error string
- ideal > max (2, 6, 4) → error string

---

## 5. Error Handling

| Scenario | Handling |
|----------|---------|
| Invite with duplicate email | Catch Supabase error, return "A user with that email already exists" |
| `public.users` insert fails after auth user created | Compensating `auth.admin.deleteUser` before returning error |
| Cross-dept mutation attempt | Server action returns "Access denied" before any DB write |
| Coverage min > ideal or ideal > max | Server-side validation returns error string; client also validates |
| Non-manager accessing actions | All actions guard `role === 'manager'` and return `{ error: 'Manager access required' }` |
| `updateTherapist` on deactivated user (dept_id null) | dept guard catches null mismatch, returns "Access denied" |

---

## 6. What's Not In Scope

- Hard-deleting therapist accounts
- Re-activating a deactivated therapist via UI (possible via Supabase dashboard directly)
- Editing manager accounts
- Availability window configuration (per-block; belongs in block management)
- Department name editing
- Role promotion (therapist → manager)
