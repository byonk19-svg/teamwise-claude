import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/types/database.types'
import { format } from 'date-fns'

type BlockRow = Database['public']['Tables']['schedule_blocks']['Row']
type UserRow = Database['public']['Tables']['users']['Row']

export interface TherapistBlockRow {
  userId: string
  fullName: string
  employmentType: 'full_time' | 'prn'
  blockId: string
  blockLabel: string
  shiftType: 'day' | 'night'
  workingCount: number
}

export interface TherapistEquityRow {
  userId: string
  fullName: string
  employmentType: 'full_time' | 'prn'
  cells: Record<string, { dayCount: number; nightCount: number }>
  totalDay: number
  totalNight: number
}

export interface PivotedTable {
  blockLabels: string[]
  blockIds: string[]
  ft: TherapistEquityRow[]
  prn: TherapistEquityRow[]
}

/** Fetch working shift counts per therapist per block for a department. */
export async function fetchEquityRows(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  departmentId: string
): Promise<TherapistBlockRow[]> {
  const { data: blocksData } = await supabase
    .from('schedule_blocks')
    .select('id, shift_type, start_date, end_date, status')
    .eq('department_id', departmentId)
    .in('status', ['active', 'completed', 'final'])
    .order('start_date', { ascending: true })

  const blocks = (blocksData ?? []) as Pick<
    BlockRow,
    'id' | 'shift_type' | 'start_date' | 'end_date' | 'status'
  >[]
  if (blocks.length === 0) return []

  const blockIds = blocks.map((b) => b.id)
  const blockMap = new Map(blocks.map((b) => [b.id, b]))

  const { data: shiftsData } = await supabase
    .from('shifts')
    .select('user_id, schedule_block_id')
    .in('schedule_block_id', blockIds)
    .eq('cell_state', 'working')

  const shifts = (shiftsData ?? []) as Array<{ user_id: string; schedule_block_id: string }>
  if (shifts.length === 0) return []

  const userIds = Array.from(new Set(shifts.map((s) => s.user_id)))
  const { data: usersData } = await supabase
    .from('users')
    .select('id, full_name, employment_type')
    .in('id', userIds)

  const users = (usersData ?? []) as Pick<UserRow, 'id' | 'full_name' | 'employment_type'>[]
  const userMap = new Map(users.map((u) => [u.id, u]))

  const counts = new Map<string, number>()
  for (const s of shifts) {
    const key = `${s.user_id}:${s.schedule_block_id}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  const result: TherapistBlockRow[] = []
  for (const [key, count] of Array.from(counts.entries())) {
    const [userId, blockId] = key.split(':')
    const user = userMap.get(userId)
    const block = blockMap.get(blockId)
    if (!user || !block) continue

    const label = `${block.shift_type === 'day' ? 'Day' : 'Night'} — ${format(new Date(block.start_date + 'T00:00:00'), 'MMM d')} – ${format(new Date(block.end_date + 'T00:00:00'), 'MMM d, yyyy')}`

    result.push({
      userId,
      fullName: user.full_name ?? 'Unknown',
      employmentType: user.employment_type as 'full_time' | 'prn',
      blockId,
      blockLabel: label,
      shiftType: block.shift_type,
      workingCount: count,
    })
  }

  return result
}

/** Pure pivot function — groups rows into a table structure for rendering. */
export function pivotEquityRows(rows: TherapistBlockRow[]): PivotedTable {
  if (rows.length === 0) return { blockLabels: [], blockIds: [], ft: [], prn: [] }

  const blockOrder: string[] = []
  const blockLabelMap = new Map<string, string>()
  for (const r of rows) {
    if (!blockLabelMap.has(r.blockId)) {
      blockOrder.push(r.blockId)
      blockLabelMap.set(r.blockId, r.blockLabel)
    }
  }

  const therapistMap = new Map<string, TherapistEquityRow>()
  for (const r of rows) {
    if (!therapistMap.has(r.userId)) {
      therapistMap.set(r.userId, {
        userId: r.userId,
        fullName: r.fullName,
        employmentType: r.employmentType,
        cells: {},
        totalDay: 0,
        totalNight: 0,
      })
    }
    const therapist = therapistMap.get(r.userId)!
    if (!therapist.cells[r.blockId]) {
      therapist.cells[r.blockId] = { dayCount: 0, nightCount: 0 }
    }
    if (r.shiftType === 'day') {
      therapist.cells[r.blockId].dayCount += r.workingCount
      therapist.totalDay += r.workingCount
    } else {
      therapist.cells[r.blockId].nightCount += r.workingCount
      therapist.totalNight += r.workingCount
    }
  }

  for (const therapist of Array.from(therapistMap.values())) {
    for (const blockId of blockOrder) {
      if (!therapist.cells[blockId]) {
        therapist.cells[blockId] = { dayCount: 0, nightCount: 0 }
      }
    }
  }

  const allTherapists = Array.from(therapistMap.values()).sort((a, b) =>
    a.fullName.localeCompare(b.fullName)
  )

  return {
    blockLabels: blockOrder.map((id) => blockLabelMap.get(id)!),
    blockIds: blockOrder,
    ft: allTherapists.filter((t) => t.employmentType === 'full_time'),
    prn: allTherapists.filter((t) => t.employmentType === 'prn'),
  }
}
