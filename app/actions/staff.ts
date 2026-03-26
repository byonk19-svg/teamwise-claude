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
  if (!invited.user?.id) return { error: 'Invite failed — no user id returned' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: insertError } = await (serviceClient as any).from('users').insert({
    id: invited.user.id,
    email,
    full_name: fullName,
    role: 'therapist',
    employment_type: employmentType,
    is_lead_qualified: false,
    department_id: profile.department_id,
  })

  if (insertError) {
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

  const { data: target } = await supabase
    .from('users')
    .select('department_id')
    .eq('id', userId)
    .single() as { data: { department_id: string | null } | null; error: unknown }
  if (!target || target.department_id !== profile.department_id) {
    return { error: 'Access denied' }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any)
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
 */
export async function deactivateTherapist(userId: string): Promise<{ error?: string }> {
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

  const { data: target } = await serviceClient
    .from('users')
    .select('department_id')
    .eq('id', userId)
    .single() as { data: { department_id: string | null } | null; error: unknown }
  if (!target || target.department_id !== profile.department_id) {
    return { error: 'Access denied' }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: swapErr } = await (serviceClient as any)
    .from('swap_requests')
    .update({ status: 'cancelled' })
    .eq('status', 'pending')
    .or(`requester_id.eq.${userId},partner_id.eq.${userId}`)
  if (swapErr) return { error: swapErr.message }

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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: deactivateErr } = await (serviceClient as any)
    .from('users')
    .update({ department_id: null })
    .eq('id', userId)
  if (deactivateErr) return { error: deactivateErr.message }

  revalidatePath('/staff')
  return {}
}
