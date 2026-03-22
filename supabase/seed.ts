// supabase/seed.ts
// Run after applying supabase/migrations/001_initial_schema.sql
// Usage: npm run seed
// Requires real credentials in .env.local

import { createClient } from '@supabase/supabase-js'
import { addDays, format } from 'date-fns'

// Load env vars
import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !serviceRoleKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const BLOCK_START = new Date('2026-03-01') // Sunday
const BLOCK_END = addDays(BLOCK_START, 41) // Saturday April 11

// All 42 dates in the block
const DATES = Array.from({ length: 42 }, (_, i) => addDays(BLOCK_START, i))

async function seed() {
  console.log('🌱 Seeding Teamwise test data...\n')

  // ── 1. Department ──────────────────────────────────────────
  const { data: dept, error: deptErr } = await supabase
    .from('departments')
    .insert({ name: 'Respiratory Therapy' })
    .select('id')
    .single()
  if (deptErr) throw new Error(`departments: ${deptErr.message}`)
  const deptId = dept.id
  console.log('✓ Department:', deptId)

  // ── 2. Coverage thresholds ─────────────────────────────────
  await supabase.from('coverage_thresholds').insert([
    { department_id: deptId, shift_type: 'day', minimum_staff: 3, ideal_staff: 4, maximum_staff: 5 },
    { department_id: deptId, shift_type: 'night', minimum_staff: 3, ideal_staff: 4, maximum_staff: 5 },
  ])
  console.log('✓ Coverage thresholds set')

  // ── 3. Manager ─────────────────────────────────────────────
  const { data: managerAuth, error: managerAuthErr } = await supabase.auth.admin.createUser({
    email: 'manager@teamwise.dev',
    password: 'password123',
    email_confirm: true,
  })
  if (managerAuthErr) throw new Error(`manager auth: ${managerAuthErr.message}`)
  const managerId = managerAuth.user.id

  const { error: managerErr } = await supabase.from('users').insert({
    id: managerId,
    email: 'manager@teamwise.dev',
    full_name: 'Alex Rivera',
    role: 'manager',
    employment_type: 'full_time',
    is_lead_qualified: false,
    default_shift_type: 'day',
    department_id: deptId,
  })
  if (managerErr) throw new Error(`manager users row: ${managerErr.message}`)
  console.log('✓ Manager created (manager@teamwise.dev / password123)')

  // ── 4. FT therapists (10 total, 3 lead-qualified) ──────────
  const ftDefs = [
    { name: 'Jordan Smith',    email: 'jsmith@teamwise.dev',    lead: true  },
    { name: 'Casey Brown',     email: 'cbrown@teamwise.dev',    lead: true  },
    { name: 'Morgan Davis',    email: 'mdavis@teamwise.dev',    lead: true  },
    { name: 'Taylor Wilson',   email: 'twilson@teamwise.dev',   lead: false },
    { name: 'Avery Martinez',  email: 'amartinez@teamwise.dev', lead: false },
    { name: 'Riley Johnson',   email: 'rjohnson@teamwise.dev',  lead: false },
    { name: 'Quinn Lee',       email: 'qlee@teamwise.dev',      lead: false },
    { name: 'Drew Anderson',   email: 'danderson@teamwise.dev', lead: false },
    { name: 'Sage Thomas',     email: 'sthomas@teamwise.dev',   lead: false },
    { name: 'Blake Garcia',    email: 'bgarcia@teamwise.dev',   lead: false },
  ]

  const ftIds: string[] = []
  for (const t of ftDefs) {
    const { data: a, error: ae } = await supabase.auth.admin.createUser({
      email: t.email, password: 'password123', email_confirm: true,
    })
    if (ae) throw new Error(`FT auth ${t.email}: ${ae.message}`)
    const { error: ue } = await supabase.from('users').insert({
      id: a.user.id, email: t.email, full_name: t.name,
      role: 'therapist', employment_type: 'full_time',
      is_lead_qualified: t.lead, default_shift_type: 'day', department_id: deptId,
    })
    if (ue) throw new Error(`FT users ${t.email}: ${ue.message}`)
    ftIds.push(a.user.id)
  }
  console.log('✓ FT therapists created:', ftIds.length, '(3 lead-qualified)')

  // ── 5. PRN therapists (5 total) ────────────────────────────
  const prnDefs = [
    { name: 'Sam Chen',    email: 'schen@teamwise.dev'   },
    { name: 'Jamie Patel', email: 'jpatel@teamwise.dev'  },
    { name: 'Reese Kim',   email: 'rkim@teamwise.dev'    },
    { name: 'Parker Obi',  email: 'pobi@teamwise.dev'    },
    { name: 'Cam Torres',  email: 'ctorres@teamwise.dev' },
  ]

  const prnIds: string[] = []
  for (const t of prnDefs) {
    const { data: a, error: ae } = await supabase.auth.admin.createUser({
      email: t.email, password: 'password123', email_confirm: true,
    })
    if (ae) throw new Error(`PRN auth ${t.email}: ${ae.message}`)
    const { error: ue } = await supabase.from('users').insert({
      id: a.user.id, email: t.email, full_name: t.name,
      role: 'therapist', employment_type: 'prn',
      is_lead_qualified: false, default_shift_type: null, department_id: deptId,
    })
    if (ue) throw new Error(`PRN users ${t.email}: ${ue.message}`)
    prnIds.push(a.user.id)
  }
  console.log('✓ PRN therapists created:', prnIds.length)

  // ── 6. Schedule blocks (Day + Night) ──────────────────────
  const blockStart = format(BLOCK_START, 'yyyy-MM-dd')
  const blockEnd = format(BLOCK_END, 'yyyy-MM-dd')

  const { data: dayBlock, error: dayErr } = await supabase
    .from('schedule_blocks')
    .insert({
      department_id: deptId, shift_type: 'day',
      start_date: blockStart, end_date: blockEnd, status: 'final',
      created_by: managerId, published_by: managerId, published_at: new Date().toISOString(),
    })
    .select('id').single()
  if (dayErr) throw new Error(`day block: ${dayErr.message}`)

  const { data: nightBlock, error: nightErr } = await supabase
    .from('schedule_blocks')
    .insert({
      department_id: deptId, shift_type: 'night',
      start_date: blockStart, end_date: blockEnd, status: 'final',
      created_by: managerId, published_by: managerId, published_at: new Date().toISOString(),
    })
    .select('id').single()
  if (nightErr) throw new Error(`night block: ${nightErr.message}`)

  const dayBlockId = dayBlock.id
  const nightBlockId = nightBlock.id
  console.log('✓ Blocks created — Day:', dayBlockId, '/ Night:', nightBlockId)

  // ── 7. Shift rows ──────────────────────────────────────────
  const [lead1, lead2, lead3] = ftIds

  type ShiftRow = {
    schedule_block_id: string
    user_id: string
    shift_date: string
    cell_state: 'working' | 'cannot_work' | 'off' | 'fmla'
    lead_user_id: string | null
  }

  function buildFTRows(blockId: string): ShiftRow[] {
    const rows: ShiftRow[] = []
    for (let ui = 0; ui < ftIds.length; ui++) {
      const userId = ftIds[ui]
      for (let di = 0; di < DATES.length; di++) {
        const date = DATES[di]
        const dayInCycle = (di + ui * 3) % 7
        let state: ShiftRow['cell_state'] = 'off'
        if (dayInCycle < 3) state = 'working'
        else if (dayInCycle === 3 && ui === 0) state = 'cannot_work'
        if (ui === 9 && di >= 14 && di <= 20) state = 'fmla'

        let leadUserId: string | null = null
        if (state === 'working') {
          if (userId === lead1) leadUserId = lead1
          else if (di % 7 < 3) leadUserId = di % 2 === 0 ? lead2 : lead3
        }
        rows.push({ schedule_block_id: blockId, user_id: userId, shift_date: format(date, 'yyyy-MM-dd'), cell_state: state, lead_user_id: leadUserId })
      }
    }
    return rows
  }

  function buildPRNRows(blockId: string): ShiftRow[] {
    const rows: ShiftRow[] = []
    for (let pi = 0; pi < prnIds.length; pi++) {
      const userId = prnIds[pi]
      for (let di = 0; di < DATES.length; di++) {
        const date = DATES[di]
        const dayOfWeek = date.getDay()
        const isWeekend = dayOfWeek === 0 || dayOfWeek === 6
        let state: 'working' | 'off' = 'off'
        if (isWeekend && (di + pi) % 3 !== 0) state = 'working'
        if (!isWeekend && (di + pi) % 5 === 0) state = 'working'
        rows.push({ schedule_block_id: blockId, user_id: userId, shift_date: format(date, 'yyyy-MM-dd'), cell_state: state, lead_user_id: null })
      }
    }
    return rows
  }

  const allRows: ShiftRow[] = [
    ...buildFTRows(dayBlockId),
    ...buildPRNRows(dayBlockId),
    ...buildFTRows(nightBlockId),
    ...buildPRNRows(nightBlockId),
  ]

  // Insert in batches of 200
  for (let i = 0; i < allRows.length; i += 200) {
    const { error } = await supabase.from('shifts').insert(allRows.slice(i, i + 200))
    if (error) throw new Error(`shifts batch ${i}: ${error.message}`)
  }
  console.log(`✓ Inserted ${allRows.length} shift rows (Day + Night blocks)`)

  console.log('\n✅ Seed complete!')
  console.log('  Manager:   manager@teamwise.dev / password123')
  console.log('  Therapist: jsmith@teamwise.dev  / password123')
}

seed().catch(err => {
  console.error('\n❌ Seed failed:', err.message)
  process.exit(1)
})
