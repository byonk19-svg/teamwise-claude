# Phase 9: Staff Management & Settings — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add manager-only `/staff` page (invite/edit/deactivate therapists) and `/settings` page (coverage thresholds).

**Architecture:** Two new server-component pages, each with a matching client component tree. Server actions in `app/actions/staff.ts` and `app/actions/settings.ts` handle mutations. `inviteTherapist` and `deactivateTherapist` use the service-role client to bypass RLS; `updateTherapist` and `updateCoverageThresholds` use the cookie-based anon client.

**Tech Stack:** Next.js 14 App Router, Supabase (anon + service-role), shadcn/ui (Table, Sheet, Dialog, Select, Checkbox, Input), Vitest, TypeScript

**Spec:** `docs/superpowers/specs/2026-03-24-phase9-staff-settings-design.md`

---

## File Map

### Create
| File | Purpose |
|------|---------|
| `lib/settings/validate.ts` | Pure helper: `validateCoverageThresholds(min, ideal, max)` |
| `tests/unit/staff-settings.test.ts` | 4 unit tests for the validate helper |
| `app/actions/staff.ts` | `inviteTherapist`, `updateTherapist`, `deactivateTherapist` |
| `app/actions/settings.ts` | `updateCoverageThresholds` |
| `components/staff/StaffTable.tsx` | Client: table list + manages Sheet/Dialog open state |
| `components/staff/StaffSheet.tsx` | Client: right-side edit panel (shadcn Sheet) |
| `components/staff/InviteDialog.tsx` | Client: invite modal (shadcn Dialog) |
| `components/settings/CoverageThresholdsForm.tsx` | Client: min/ideal/max form for day+night |
| `app/(app)/staff/page.tsx` | Server: fetches therapist list, renders StaffTable |
| `app/(app)/settings/page.tsx` | Server: fetches thresholds, renders form |

### Modify
| File | Change |
|------|--------|
| `lib/types/database.types.ts` | Add `coverage_thresholds` type stub |
| `CLAUDE.md` | Add `coverage_thresholds` to Manual Table Access table + Phase 9 note |

---

## Task 1: Type Stub + Validate Helper (TDD)

**Files:**
- Modify: `lib/types/database.types.ts`
- Create: `lib/settings/validate.ts`
- Create: `tests/unit/staff-settings.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/staff-settings.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { validateCoverageThresholds } from '@/lib/settings/validate'

describe('validateCoverageThresholds', () => {
  it('returns null for a valid range', () => {
    expect(validateCoverageThresholds(2, 4, 5)).toBeNull()
  })

  it('returns null for equal boundary values (enforces <= not <)', () => {
    expect(validateCoverageThresholds(4, 4, 4)).toBeNull()
  })

  it('returns error string when min > ideal', () => {
    expect(validateCoverageThresholds(5, 3, 6)).toBe('Minimum staff cannot exceed ideal staff')
  })

  it('returns error string when ideal > max', () => {
    expect(validateCoverageThresholds(2, 6, 4)).toBe('Ideal staff cannot exceed maximum staff')
  })
})
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
npm test -- tests/unit/staff-settings.test.ts
```

Expected: 4 failures — `Cannot find module '@/lib/settings/validate'`

- [ ] **Step 3: Add `coverage_thresholds` to the type stub**

In `lib/types/database.types.ts`, add the following entry inside the `Tables` object, after `push_subscriptions`:

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
        Insert: {
          department_id: string
          shift_type: 'day' | 'night'
          minimum_staff: number
          ideal_staff: number
          maximum_staff: number
          updated_by?: string | null
          updated_at?: string
        }
        Update: Partial<{
          minimum_staff: number
          ideal_staff: number
          maximum_staff: number
          updated_by: string | null
          updated_at: string
        }>
      }
```

- [ ] **Step 4: Implement the validate helper**

Create `lib/settings/validate.ts`:

```ts
/**
 * Validates coverage threshold values.
 * Returns null if valid (min ≤ ideal ≤ max), or an error string.
 */
export function validateCoverageThresholds(
  min: number,
  ideal: number,
  max: number
): string | null {
  if (min > ideal) return 'Minimum staff cannot exceed ideal staff'
  if (ideal > max) return 'Ideal staff cannot exceed maximum staff'
  return null
}
```

- [ ] **Step 5: Run tests — verify they pass**

```bash
npm test -- tests/unit/staff-settings.test.ts
```

Expected: 4 passing

- [ ] **Step 6: Run full test suite — verify nothing broke**

```bash
npm test
```

Expected: all tests pass (114 total)

- [ ] **Step 7: Commit**

```bash
git add lib/types/database.types.ts lib/settings/validate.ts tests/unit/staff-settings.test.ts
git commit -m "feat(phase9): add coverage_thresholds type stub and validate helper"
```

---

## Task 2: Staff Server Actions

**Files:**
- Create: `app/actions/staff.ts`

**Key patterns to follow:**
- Import `createClient` from `@/lib/supabase/server` (cookie-based, for auth reads)
- Import `createServiceRoleClient` from `@/lib/supabase/service-role` (for admin writes)
- `getServerUser()` from `@/lib/auth` — the only way to get the current user
- All actions return `Promise<{ error?: string }>` and call `revalidatePath` before returning `{}`
- Non-generated tables (`swap_requests`, `prn_shift_interest`) require `(supabase as any).from(...)`
- The `swap_requests` DB enum includes `'cancelled'` even though the TypeScript stub doesn't list it — the `any` cast makes this safe

- [ ] **Step 1: Create `app/actions/staff.ts`**

```ts
// app/actions/staff.ts
'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { getServerUser } from '@/lib/auth'
import type { Database } from '@/lib/types/database.types'

type EmploymentType = Database['public']['Tables']['users']['Row']['employment_type']
type ShiftType = Database['public']['Tables']['users']['Row']['default_shift_type']

/**
 * Manager invites a new therapist. Creates an auth user and a public.users profile.
 * If the profile insert fails, the orphaned auth user is deleted (compensating action).
 */
export async function inviteTherapist(
  fullName: string,
  email: string,
  employmentType: EmploymentType
): Promise<{ error?: string }> {
  const user = await getServerUser()
  if (!user) return { error: 'Not authenticated' }

  const supabase = createClient()
  const { data: profile } = await supabase
    .from('users')
    .select('role, department_id')
    .eq('id', user.id)
    .single() as { data: { role: string; department_id: string | null } | null; error: unknown }
  if (!profile || profile.role !== 'manager') return { error: 'Manager access required' }
  if (!profile.department_id) return { error: 'No department assigned' }

  const serviceClient = createServiceRoleClient()
  const { data: invited, error: inviteError } = await serviceClient.auth.admin.inviteUserByEmail(
    email,
    { data: { full_name: fullName } }
  )
  if (inviteError) {
    if (inviteError.message.toLowerCase().includes('already')) {
      return { error: 'A user with that email already exists' }
    }
    return { error: inviteError.message }
  }

  const { error: insertError } = await serviceClient
    .from('users')
    .insert({
      id: invited.user.id,
      email,
      full_name: fullName,
      role: 'therapist',
      employment_type: employmentType,
      is_lead_qualified: false,
      department_id: profile.department_id,
    })

  if (insertError) {
    // Compensating action: remove the orphaned auth account
    const { error: deleteError } = await serviceClient.auth.admin.deleteUser(invited.user.id)
    if (deleteError) {
      console.error('[inviteTherapist] compensating deleteUser failed', {
        userId: invited.user.id,
        error: deleteError,
      })
    }
    return { error: 'Failed to create user profile. Please try again.' }
  }

  revalidatePath('/staff')
  return {}
}

/**
 * Manager updates a therapist's profile attributes.
 * Guards: must be manager, target must be in same department.
 */
export async function updateTherapist(
  userId: string,
  updates: {
    fullName: string
    employmentType: EmploymentType
    isLeadQualified: boolean
    defaultShiftType: ShiftType
  }
): Promise<{ error?: string }> {
  const user = await getServerUser()
  if (!user) return { error: 'Not authenticated' }

  const supabase = createClient()
  const { data: profile } = await supabase
    .from('users')
    .select('role, department_id')
    .eq('id', user.id)
    .single() as { data: { role: string; department_id: string | null } | null; error: unknown }
  if (!profile || profile.role !== 'manager') return { error: 'Manager access required' }
  if (!profile.department_id) return { error: 'No department assigned' }

  // Cross-dept guard
  const { data: target } = await supabase
    .from('users')
    .select('department_id')
    .eq('id', userId)
    .single() as { data: { department_id: string | null } | null; error: unknown }
  if (!target || target.department_id !== profile.department_id) {
    return { error: 'Access denied' }
  }

  const { error } = await supabase
    .from('users')
    .update({
      full_name: updates.fullName,
      employment_type: updates.employmentType,
      is_lead_qualified: updates.isLeadQualified,
      default_shift_type: updates.defaultShiftType,
    })
    .eq('id', userId)
  if (error) return { error: error.message }

  revalidatePath('/staff')
  return {}
}

/**
 * Manager soft-removes a therapist from the department.
 * Sets department_id = null, cancels pending swaps, declines pending PRN interest.
 * Hard deletion is not supported (shifts FK would fail).
 */
export async function deactivateTherapist(userId: string): Promise<{ error?: string }> {
  const user = await getServerUser()
  if (!user) return { error: 'Not authenticated' }

  // Anon client for auth + role check only
  const supabase = createClient()
  const { data: profile } = await supabase
    .from('users')
    .select('role, department_id')
    .eq('id', user.id)
    .single() as { data: { role: string; department_id: string | null } | null; error: unknown }
  if (!profile || profile.role !== 'manager') return { error: 'Manager access required' }

  // Service-role for all DB writes (bypasses RLS for cross-user updates)
  const serviceClient = createServiceRoleClient()

  // Cross-dept guard via service-role
  const { data: target } = await serviceClient
    .from('users')
    .select('department_id')
    .eq('id', userId)
    .single() as { data: { department_id: string | null } | null; error: unknown }
  if (!target || target.department_id !== profile.department_id) {
    return { error: 'Access denied' }
  }

  // Cancel pending swap requests (DB enum includes 'cancelled' even if TS stub doesn't)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: swapErr } = await (serviceClient as any)
    .from('swap_requests')
    .update({ status: 'cancelled' })
    .eq('status', 'pending')
    .or(`requester_id.eq.${userId},partner_id.eq.${userId}`)
  if (swapErr) return { error: swapErr.message }

  // Decline pending PRN interest with audit trail
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: prnErr } = await (serviceClient as any)
    .from('prn_shift_interest')
    .update({
      status: 'declined',
      actioned_by: user.id,
      actioned_at: new Date().toISOString(),
    })
    .eq('user_id', userId)
    .eq('status', 'pending')
  if (prnErr) return { error: prnErr.message }

  // Soft-remove: null out department_id, preserving all shift history
  await serviceClient
    .from('users')
    .update({ department_id: null })
    .eq('id', userId)

  revalidatePath('/staff')
  return {}
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npm run build 2>&1 | head -30
```

Expected: no errors related to `app/actions/staff.ts`

- [ ] **Step 3: Commit**

```bash
git add app/actions/staff.ts
git commit -m "feat(phase9): add staff server actions (invite, update, deactivate)"
```

---

## Task 3: Settings Server Action

**Files:**
- Create: `app/actions/settings.ts`

- [ ] **Step 1: Create `app/actions/settings.ts`**

```ts
// app/actions/settings.ts
'use server'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getServerUser } from '@/lib/auth'
import { validateCoverageThresholds } from '@/lib/settings/validate'

interface ThresholdInput {
  minimum_staff: number
  ideal_staff: number
  maximum_staff: number
}

/**
 * Manager upserts coverage thresholds for both shift types.
 * coverage_thresholds uses (supabase as any) — not in generated client.
 */
export async function updateCoverageThresholds(
  day: ThresholdInput,
  night: ThresholdInput
): Promise<{ error?: string }> {
  const user = await getServerUser()
  if (!user) return { error: 'Not authenticated' }

  const supabase = createClient()
  const { data: profile } = await supabase
    .from('users')
    .select('role, department_id')
    .eq('id', user.id)
    .single() as { data: { role: string; department_id: string | null } | null; error: unknown }
  if (!profile || profile.role !== 'manager') return { error: 'Manager access required' }
  if (!profile.department_id) return { error: 'No department assigned' }

  // Server-side validation (client also validates, but server is authoritative)
  const dayErr = validateCoverageThresholds(day.minimum_staff, day.ideal_staff, day.maximum_staff)
  if (dayErr) return { error: `Day shift: ${dayErr}` }
  const nightErr = validateCoverageThresholds(night.minimum_staff, night.ideal_staff, night.maximum_staff)
  if (nightErr) return { error: `Night shift: ${nightErr}` }

  const now = new Date().toISOString()
  const rows = [
    {
      department_id: profile.department_id,
      shift_type: 'day' as const,
      ...day,
      updated_by: user.id,
      updated_at: now,
    },
    {
      department_id: profile.department_id,
      shift_type: 'night' as const,
      ...night,
      updated_by: user.id,
      updated_at: now,
    },
  ]

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
    .from('coverage_thresholds')
    .upsert(rows, { onConflict: 'department_id,shift_type' })
  if (error) return { error: error.message }

  revalidatePath('/settings')
  return {}
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npm run build 2>&1 | head -30
```

Expected: no errors related to `app/actions/settings.ts`

- [ ] **Step 3: Commit**

```bash
git add app/actions/settings.ts
git commit -m "feat(phase9): add updateCoverageThresholds server action"
```

---

## Task 4: Staff UI Components

**Files:**
- Create: `components/staff/StaffTable.tsx`
- Create: `components/staff/StaffSheet.tsx`
- Create: `components/staff/InviteDialog.tsx`

**Important React patterns:**
- `StaffTable` passes `key={editing?.id ?? 'none'}` to `StaffSheet` — this forces the Sheet to remount when a different therapist is selected, resetting all form state automatically
- All form state lives in the Sheet/Dialog, not the Table
- Server action results: check `result.error`; on success call `onClose()`

- [ ] **Step 1: Create `components/staff/StaffSheet.tsx`**

This is the right-side edit panel. Note `key` is set from the parent, not here.

```tsx
// components/staff/StaffSheet.tsx
'use client'
import { useState } from 'react'
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter,
} from '@/components/ui/sheet'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import { updateTherapist, deactivateTherapist } from '@/app/actions/staff'
import type { Database } from '@/lib/types/database.types'

type UserRow = Database['public']['Tables']['users']['Row']
export type StaffRow = Pick<
  UserRow,
  'id' | 'full_name' | 'employment_type' | 'is_lead_qualified' | 'default_shift_type'
>

interface Props {
  therapist: StaffRow | null
  open: boolean
  onClose: () => void
}

export function StaffSheet({ therapist, open, onClose }: Props) {
  // State is initialized from therapist on mount. The parent passes key={therapist?.id}
  // so this component remounts whenever the selected therapist changes.
  const [fullName, setFullName] = useState(therapist?.full_name ?? '')
  const [employmentType, setEmploymentType] = useState<'full_time' | 'prn'>(
    therapist?.employment_type ?? 'full_time'
  )
  const [isLeadQualified, setIsLeadQualified] = useState(therapist?.is_lead_qualified ?? false)
  const [defaultShiftType, setDefaultShiftType] = useState<'day' | 'night' | null>(
    therapist?.default_shift_type ?? null
  )
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    if (!therapist) return
    setSaving(true)
    setError(null)
    const result = await updateTherapist(therapist.id, {
      fullName,
      employmentType,
      isLeadQualified,
      defaultShiftType,
    })
    setSaving(false)
    if (result.error) { setError(result.error); return }
    onClose()
  }

  async function handleDeactivate() {
    if (!therapist) return
    setSaving(true)
    setError(null)
    const result = await deactivateTherapist(therapist.id)
    setSaving(false)
    if (result.error) { setError(result.error); return }
    onClose()
  }

  return (
    <Sheet
      open={open}
      onOpenChange={isOpen => { if (!isOpen) { setConfirming(false); onClose() } }}
    >
      <SheetContent className="flex flex-col">
        <SheetHeader>
          <SheetTitle>Edit Therapist</SheetTitle>
        </SheetHeader>

        <div className="flex-1 space-y-4 py-4 overflow-y-auto">
          <div className="space-y-1.5">
            <Label>Full Name</Label>
            <Input value={fullName} onChange={e => setFullName(e.target.value)} />
          </div>

          <div className="space-y-1.5">
            <Label>Employment Type</Label>
            <Select
              value={employmentType}
              onValueChange={v => setEmploymentType(v as 'full_time' | 'prn')}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="full_time">Full-time</SelectItem>
                <SelectItem value="prn">PRN</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id="lead-qualified"
              checked={isLeadQualified}
              onCheckedChange={v => setIsLeadQualified(Boolean(v))}
            />
            <Label htmlFor="lead-qualified">Lead Qualified</Label>
          </div>

          <div className="space-y-1.5">
            <Label>Default Shift</Label>
            <Select
              value={defaultShiftType ?? 'none'}
              onValueChange={v => setDefaultShiftType(v === 'none' ? null : v as 'day' | 'night')}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Flexible (none)</SelectItem>
                <SelectItem value="day">Day</SelectItem>
                <SelectItem value="night">Night</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>

        <SheetFooter className="flex-col gap-2 pt-4 border-t border-slate-100">
          <Button onClick={handleSave} disabled={saving} className="w-full">
            {saving ? 'Saving…' : 'Save'}
          </Button>

          {!confirming ? (
            <Button
              variant="outline"
              onClick={() => setConfirming(true)}
              className="w-full text-red-600 border-red-200 hover:bg-red-50"
            >
              Deactivate
            </Button>
          ) : (
            <div className="rounded border border-red-200 bg-red-50 p-3 space-y-2">
              <p className="text-sm text-red-700">
                Are you sure? This removes them from the department.
              </p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={handleDeactivate}
                  disabled={saving}
                  className="flex-1"
                >
                  Confirm
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setConfirming(false)}
                  className="flex-1"
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
```

- [ ] **Step 2: Create `components/staff/InviteDialog.tsx`**

```tsx
// components/staff/InviteDialog.tsx
'use client'
import { useState } from 'react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { inviteTherapist } from '@/app/actions/staff'

interface Props {
  open: boolean
  onClose: () => void
}

export function InviteDialog({ open, onClose }: Props) {
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [employmentType, setEmploymentType] = useState<'full_time' | 'prn'>('full_time')
  const [error, setError] = useState<string | null>(null)
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  function handleClose() {
    setFullName('')
    setEmail('')
    setEmploymentType('full_time')
    setError(null)
    setSentTo(null)
    onClose()
  }

  async function handleSubmit() {
    if (!fullName.trim() || !email.trim()) {
      setError('Name and email are required')
      return
    }
    setSaving(true)
    setError(null)
    const result = await inviteTherapist(fullName.trim(), email.trim(), employmentType)
    setSaving(false)
    if (result.error) { setError(result.error); return }
    setSentTo(email.trim())
  }

  return (
    <Dialog open={open} onOpenChange={isOpen => { if (!isOpen) handleClose() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite Therapist</DialogTitle>
        </DialogHeader>

        {sentTo ? (
          <div className="py-4">
            <p className="text-sm text-green-700">
              Invite sent to <strong>{sentTo}</strong>. They will receive an email with a link to set their password.
            </p>
          </div>
        ) : (
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Full Name</Label>
              <Input
                value={fullName}
                onChange={e => setFullName(e.target.value)}
                placeholder="Jane Smith"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="jsmith@hospital.org"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Employment Type</Label>
              <Select
                value={employmentType}
                onValueChange={v => setEmploymentType(v as 'full_time' | 'prn')}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="full_time">Full-time</SelectItem>
                  <SelectItem value="prn">PRN</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
          </div>
        )}

        <DialogFooter>
          {sentTo ? (
            <Button onClick={handleClose}>Close</Button>
          ) : (
            <>
              <Button variant="outline" onClick={handleClose}>Cancel</Button>
              <Button onClick={handleSubmit} disabled={saving}>
                {saving ? 'Sending…' : 'Send Invite'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 3: Create `components/staff/StaffTable.tsx`**

Note `key={editing?.id ?? 'none'}` on `StaffSheet` — this remounts the Sheet (resetting form state) whenever the selected therapist changes.

```tsx
// components/staff/StaffTable.tsx
'use client'
import { useState } from 'react'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { StaffSheet, type StaffRow } from './StaffSheet'
import { InviteDialog } from './InviteDialog'

interface Props {
  therapists: StaffRow[]
}

export function StaffTable({ therapists }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [inviteOpen, setInviteOpen] = useState(false)

  const editing = therapists.find(t => t.id === editingId) ?? null

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-900">Therapists</h2>
        <Button size="sm" onClick={() => setInviteOpen(true)}>
          Invite Therapist
        </Button>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Lead Qualified</TableHead>
              <TableHead>Default Shift</TableHead>
              <TableHead className="w-16" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {therapists.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="text-center text-sm text-slate-400 py-8"
                >
                  No therapists in this department yet.
                </TableCell>
              </TableRow>
            )}
            {therapists.map(t => (
              <TableRow
                key={t.id}
                className="cursor-pointer hover:bg-slate-50"
                onClick={() => setEditingId(t.id)}
              >
                <TableCell className="font-medium">{t.full_name}</TableCell>
                <TableCell>
                  <Badge variant={t.employment_type === 'full_time' ? 'default' : 'secondary'}>
                    {t.employment_type === 'full_time' ? 'FT' : 'PRN'}
                  </Badge>
                </TableCell>
                <TableCell className="text-slate-500">
                  {t.is_lead_qualified ? '✓' : '—'}
                </TableCell>
                <TableCell className="text-slate-500 capitalize">
                  {t.default_shift_type ?? 'Flexible'}
                </TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={e => { e.stopPropagation(); setEditingId(t.id) }}
                  >
                    Edit
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* key forces remount (and form reset) when a different therapist is selected */}
      <StaffSheet
        key={editing?.id ?? 'none'}
        therapist={editing}
        open={editingId !== null}
        onClose={() => setEditingId(null)}
      />

      <InviteDialog
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
      />
    </div>
  )
}
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npm run build 2>&1 | grep -E "error TS|Error"
```

Expected: no errors in `components/staff/`

- [ ] **Step 5: Commit**

```bash
git add components/staff/StaffSheet.tsx components/staff/InviteDialog.tsx components/staff/StaffTable.tsx
git commit -m "feat(phase9): add staff UI components (StaffTable, StaffSheet, InviteDialog)"
```

---

## Task 5: Settings UI Component

**Files:**
- Create: `components/settings/CoverageThresholdsForm.tsx`

- [ ] **Step 1: Create `components/settings/CoverageThresholdsForm.tsx`**

```tsx
// components/settings/CoverageThresholdsForm.tsx
'use client'
import { useState, useEffect } from 'react'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { updateCoverageThresholds } from '@/app/actions/settings'
import { validateCoverageThresholds } from '@/lib/settings/validate'

interface ThresholdValues {
  minimum_staff: number
  ideal_staff: number
  maximum_staff: number
}

interface Props {
  day: ThresholdValues
  night: ThresholdValues
}

export function CoverageThresholdsForm({ day: initialDay, night: initialNight }: Props) {
  const [day, setDay] = useState(initialDay)
  const [night, setNight] = useState(initialNight)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)

  // Auto-hide "Saved ✓" after 3 seconds
  useEffect(() => {
    if (!saved) return
    const timer = setTimeout(() => setSaved(false), 3000)
    return () => clearTimeout(timer)
  }, [saved])

  function validateAll(): string | null {
    const dayErr = validateCoverageThresholds(day.minimum_staff, day.ideal_staff, day.maximum_staff)
    if (dayErr) return `Day shift: ${dayErr}`
    const nightErr = validateCoverageThresholds(night.minimum_staff, night.ideal_staff, night.maximum_staff)
    if (nightErr) return `Night shift: ${nightErr}`
    return null
  }

  async function handleSubmit() {
    const clientError = validateAll()
    if (clientError) { setError(clientError); return }
    setSaving(true)
    setError(null)
    const result = await updateCoverageThresholds(day, night)
    setSaving(false)
    if (result.error) { setError(result.error); return }
    setSaved(true)
  }

  function NumInput({
    value,
    onChange,
    label,
    id,
  }: {
    value: number
    onChange: (v: number) => void
    label: string
    id: string
  }) {
    return (
      <div className="space-y-1.5">
        <Label htmlFor={id}>{label}</Label>
        <Input
          id={id}
          type="number"
          min={0}
          value={value}
          onChange={e => onChange(Math.max(0, Number(e.target.value)))}
          className="w-24"
        />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-slate-200 bg-white p-4 space-y-4">
        <h3 className="text-sm font-semibold text-slate-700">Day Shift</h3>
        <div className="flex gap-6 flex-wrap">
          <NumInput
            value={day.minimum_staff}
            onChange={v => setDay(d => ({ ...d, minimum_staff: v }))}
            label="Minimum Staff"
            id="day-min"
          />
          <NumInput
            value={day.ideal_staff}
            onChange={v => setDay(d => ({ ...d, ideal_staff: v }))}
            label="Ideal Staff"
            id="day-ideal"
          />
          <NumInput
            value={day.maximum_staff}
            onChange={v => setDay(d => ({ ...d, maximum_staff: v }))}
            label="Maximum Staff"
            id="day-max"
          />
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-4 space-y-4">
        <h3 className="text-sm font-semibold text-slate-700">Night Shift</h3>
        <div className="flex gap-6 flex-wrap">
          <NumInput
            value={night.minimum_staff}
            onChange={v => setNight(d => ({ ...d, minimum_staff: v }))}
            label="Minimum Staff"
            id="night-min"
          />
          <NumInput
            value={night.ideal_staff}
            onChange={v => setNight(d => ({ ...d, ideal_staff: v }))}
            label="Ideal Staff"
            id="night-ideal"
          />
          <NumInput
            value={night.maximum_staff}
            onChange={v => setNight(d => ({ ...d, maximum_staff: v }))}
            label="Maximum Staff"
            id="night-max"
          />
        </div>
      </section>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex items-center gap-3">
        <Button onClick={handleSubmit} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
        {saved && <span className="text-sm text-green-600">Saved ✓</span>}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npm run build 2>&1 | grep -E "error TS|Error"
```

Expected: no errors in `components/settings/`

- [ ] **Step 3: Commit**

```bash
git add components/settings/CoverageThresholdsForm.tsx
git commit -m "feat(phase9): add CoverageThresholdsForm component"
```

---

## Task 6: Page Routes

**Files:**
- Create: `app/(app)/staff/page.tsx`
- Create: `app/(app)/settings/page.tsx`

**Pattern reminder:** `searchParams` in Next.js 14 is a synchronous plain object — do NOT await it. These pages don't use searchParams, but keep this in mind generally.

- [ ] **Step 1: Create `app/(app)/staff/page.tsx`**

```tsx
// app/(app)/staff/page.tsx
import { redirect } from 'next/navigation'
import { getServerUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { StaffTable } from '@/components/staff/StaffTable'
import type { Database } from '@/lib/types/database.types'

type UserRow = Database['public']['Tables']['users']['Row']

export default async function StaffPage() {
  const user = await getServerUser()
  if (!user) redirect('/login')

  const supabase = createClient()

  const { data: profile } = await supabase
    .from('users')
    .select('role, department_id')
    .eq('id', user.id)
    .single() as { data: { role: string; department_id: string | null } | null; error: unknown }

  if (!profile || profile.role !== 'manager') redirect('/today')
  if (!profile.department_id) {
    return (
      <div className="p-8 text-sm text-slate-500">
        Your account is not assigned to a department. Contact your administrator.
      </div>
    )
  }

  const { data: therapists } = await supabase
    .from('users')
    .select('id, full_name, employment_type, is_lead_qualified, default_shift_type')
    .eq('department_id', profile.department_id)
    .eq('role', 'therapist')
    .order('full_name') as {
      data: Pick<
        UserRow,
        'id' | 'full_name' | 'employment_type' | 'is_lead_qualified' | 'default_shift_type'
      >[] | null
      error: unknown
    }

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      <h1 className="text-xl font-bold text-slate-900 mb-6">Staff</h1>
      <StaffTable therapists={therapists ?? []} />
    </div>
  )
}
```

- [ ] **Step 2: Create `app/(app)/settings/page.tsx`**

Default thresholds are used when no rows exist yet (first-time setup).

```tsx
// app/(app)/settings/page.tsx
import { redirect } from 'next/navigation'
import { getServerUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { CoverageThresholdsForm } from '@/components/settings/CoverageThresholdsForm'

const DEFAULT_THRESHOLDS = { minimum_staff: 3, ideal_staff: 4, maximum_staff: 5 }

export default async function SettingsPage() {
  const user = await getServerUser()
  if (!user) redirect('/login')

  const supabase = createClient()

  const { data: profile } = await supabase
    .from('users')
    .select('role, department_id')
    .eq('id', user.id)
    .single() as { data: { role: string; department_id: string | null } | null; error: unknown }

  if (!profile || profile.role !== 'manager') redirect('/today')
  if (!profile.department_id) {
    return (
      <div className="p-8 text-sm text-slate-500">
        Your account is not assigned to a department.
      </div>
    )
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: thresholds } = await (supabase as any)
    .from('coverage_thresholds')
    .select('shift_type, minimum_staff, ideal_staff, maximum_staff')
    .eq('department_id', profile.department_id) as {
      data: Array<{
        shift_type: 'day' | 'night'
        minimum_staff: number
        ideal_staff: number
        maximum_staff: number
      }> | null
    }

  const dayRow = thresholds?.find(t => t.shift_type === 'day') ?? DEFAULT_THRESHOLDS
  const nightRow = thresholds?.find(t => t.shift_type === 'night') ?? DEFAULT_THRESHOLDS

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <h1 className="text-xl font-bold text-slate-900 mb-6">Settings</h1>
      <section>
        <h2 className="text-base font-semibold text-slate-800 mb-4">Coverage Thresholds</h2>
        <CoverageThresholdsForm day={dayRow} night={nightRow} />
      </section>
    </div>
  )
}
```

- [ ] **Step 3: Verify TypeScript compiles cleanly**

```bash
npm run build 2>&1 | grep -E "error TS|Error"
```

Expected: no errors in `app/(app)/staff/` or `app/(app)/settings/`

- [ ] **Step 4: Run full test suite**

```bash
npm test
```

Expected: 114 tests passing (110 existing + 4 new)

- [ ] **Step 5: Commit**

```bash
git add app/\(app\)/staff/page.tsx app/\(app\)/settings/page.tsx
git commit -m "feat(phase9): add /staff and /settings page routes"
```

---

## Task 7: CLAUDE.md Update

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add `coverage_thresholds` to the Manual Table Access Pattern table in `CLAUDE.md`**

Find this section in `CLAUDE.md`:

```markdown
| `push_subscriptions` | Phase 8 |
```

Add the new row immediately after it:

```markdown
| `coverage_thresholds` | Phase 9 |
```

- [ ] **Step 2: Add Phase 9 entry to the Phase Status section**

Find the Phase 8 entry and add below it:

```markdown
- **Phase 9 (Staff & Settings):** Complete — manager-only `/staff` page (invite via Supabase email, edit profile attributes, soft-deactivate with pending swap/PRN interest cleanup) and `/settings` page (coverage threshold upsert). `lib/settings/validate.ts` + `tests/unit/staff-settings.test.ts` (4 tests). Service-role client used for invite and deactivate. Plan reference: `docs/superpowers/plans/2026-03-25-phase9-staff-settings.md`.
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md for Phase 9 (staff & settings)"
```

---

## Verification Checklist

After all tasks are complete:

- [ ] `npm test` — all 114 tests pass
- [ ] `npm run build` — clean TypeScript, no errors
- [ ] `npm run lint` — no ESLint errors
- [ ] Navigate to `/staff` as manager — therapist table renders, invite dialog works
- [ ] Navigate to `/settings` as manager — coverage form pre-populated, saves with "Saved ✓"
- [ ] Navigate to `/staff` as therapist — redirected to `/today`
- [ ] Navigate to `/settings` as therapist — redirected to `/today`
