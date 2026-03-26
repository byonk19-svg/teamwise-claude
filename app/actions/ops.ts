'use server'

import { createClient } from '@/lib/supabase/server'
import { getServerUser } from '@/lib/auth'
import { fetchBlockHealthData } from '@/lib/ops/fetch-block-health'
import { buildBlockHealthRows } from '@/lib/ops/block-health'
import { buildKPICSV } from '@/lib/exports/build-kpi-csv'
import type { OpsFilterParams } from '@/lib/ops/types'

export async function exportKPICSV(
  filters: OpsFilterParams
): Promise<{ data: string } | { error: string }> {
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

  const result = await fetchBlockHealthData(supabase, profile.department_id, filters)
  if (result.blockIds.length === 0) return { data: buildKPICSV([]) }

  const rows = buildBlockHealthRows({
    blocks: result.filteredBlocks,
    shifts: result.shifts,
    actualRows: result.actualRows,
    pendingSwapBlockIds: result.pendingSwapBlockIds,
    pendingChangeBlockIds: result.pendingChangeBlockIds,
    pendingPrnByBlockId: result.pendingPrnByBlockId,
  })

  return { data: buildKPICSV(rows) }
}
