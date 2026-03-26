import { redirect } from 'next/navigation'
import { getServerUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import {
  fetchEquityRows,
  pivotEquityRows,
  type TherapistEquityRow,
} from '@/lib/fairness/fetch-therapist-equity'
import type { Database } from '@/lib/types/database.types'

type UserRow = Database['public']['Tables']['users']['Row']

function TherapistRows({
  therapists,
  blockIds,
}: {
  therapists: TherapistEquityRow[]
  blockIds: string[]
}) {
  return (
    <>
      {therapists.map((t) => (
        <tr key={t.userId} className="border-b border-slate-100 hover:bg-slate-50">
          <td className="py-2 px-3 text-sm text-slate-900 font-medium whitespace-nowrap">{t.fullName}</td>
          {blockIds.map((blockId) => {
            const cell = t.cells[blockId] ?? { dayCount: 0, nightCount: 0 }
            const isEmpty = cell.dayCount === 0 && cell.nightCount === 0
            return (
              <td key={blockId} className="py-2 px-3 text-sm text-center">
                {isEmpty ? (
                  <span className="text-slate-300">—</span>
                ) : (
                  <span className="text-slate-700">
                    {cell.dayCount > 0 && <span className="text-blue-600">{cell.dayCount}D</span>}
                    {cell.dayCount > 0 && cell.nightCount > 0 && <span className="text-slate-300"> / </span>}
                    {cell.nightCount > 0 && <span className="text-slate-800">{cell.nightCount}N</span>}
                  </span>
                )}
              </td>
            )
          })}
          <td className="py-2 px-3 text-sm text-center font-medium">
            <span className="text-blue-600">{t.totalDay}D</span>
            {t.totalDay > 0 && t.totalNight > 0 && <span className="text-slate-300"> / </span>}
            <span className="text-slate-800">{t.totalNight}N</span>
          </td>
        </tr>
      ))}
    </>
  )
}

export default async function FairnessPage() {
  const user = await getServerUser()
  if (!user) redirect('/login')

  const supabase = createClient()

  const { data: profileData } = await supabase
    .from('users')
    .select('role, department_id')
    .eq('id', user.id)
    .single()

  const profile = profileData as Pick<UserRow, 'role' | 'department_id'> | null
  if (!profile) redirect('/login')
  if (profile.role === 'therapist') redirect('/today')

  if (!profile.department_id) {
    return (
      <div className="p-8 text-slate-500 text-sm">Your account is not assigned to a department.</div>
    )
  }

  const rows = await fetchEquityRows(supabase, profile.department_id)
  const { blockLabels, blockIds, ft, prn } = pivotEquityRows(rows)

  if (blockIds.length === 0) {
    return (
      <div className="p-8">
        <h1 className="text-xl font-semibold text-slate-900 mb-4">Fairness</h1>
        <p className="text-slate-500 text-sm">No completed or active blocks yet.</p>
      </div>
    )
  }

  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold text-slate-900 mb-6">Fairness</h1>
      <p className="text-sm text-slate-500 mb-4">
        Working shifts per therapist across active, final, and completed blocks.
      </p>

      <div className="overflow-x-auto">
        <table className="min-w-full border border-slate-200 rounded-lg text-left">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <th className="py-2 px-3 text-xs font-medium text-slate-500 uppercase tracking-wide">
                Therapist
              </th>
              {blockLabels.map((label, i) => (
                <th
                  key={blockIds[i]}
                  className="py-2 px-3 text-xs font-medium text-slate-500 uppercase tracking-wide text-center whitespace-nowrap"
                >
                  {label}
                </th>
              ))}
              <th className="py-2 px-3 text-xs font-medium text-slate-500 uppercase tracking-wide text-center">
                Total
              </th>
            </tr>
          </thead>
          <tbody>
            {ft.length > 0 && (
              <>
                <tr>
                  <td colSpan={blockIds.length + 2} className="py-1.5 px-3 bg-slate-50">
                    <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                      Full-Time
                    </span>
                  </td>
                </tr>
                <TherapistRows therapists={ft} blockIds={blockIds} />
              </>
            )}
            {prn.length > 0 && (
              <>
                <tr>
                  <td
                    colSpan={blockIds.length + 2}
                    className="py-1.5 px-3 bg-slate-50 border-t border-slate-200"
                  >
                    <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                      PRN
                    </span>
                  </td>
                </tr>
                <TherapistRows therapists={prn} blockIds={blockIds} />
              </>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
