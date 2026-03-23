// components/schedule/BlockStatusActions.tsx
'use client'
import { useState, useTransition } from 'react'
import Link from 'next/link'
import { postPreliminary, postFinal } from '@/app/actions/schedule'
import { canPostPreliminary, canPublishFinal } from '@/lib/schedule/block-status'
import type { Database } from '@/lib/types/database.types'

type BlockRow = Database['public']['Tables']['schedule_blocks']['Row']

const STATUS_LABELS: Record<BlockRow['status'], string> = {
  preliminary_draft: 'Draft',
  preliminary:       'Preliminary',
  final:             'Final',
  active:            'Active',
  completed:         'Completed',
}

const STATUS_COLORS: Record<BlockRow['status'], string> = {
  preliminary_draft: 'bg-slate-100 text-slate-700 border-slate-200',
  preliminary:       'bg-amber-50 text-amber-800 border-amber-200',
  final:             'bg-green-50 text-green-800 border-green-200',
  active:            'bg-blue-50 text-blue-800 border-blue-200',
  completed:         'bg-slate-50 text-slate-600 border-slate-200',
}

interface Props {
  block: BlockRow
  userRole: 'manager' | 'therapist'
}

export function BlockStatusActions({ block, userRole }: Props) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function handlePostPreliminary() {
    setError(null)
    startTransition(async () => {
      const result = await postPreliminary(block.id)
      if (result.error) setError(result.error)
    })
  }

  function handlePostFinal() {
    setError(null)
    startTransition(async () => {
      const result = await postFinal(block.id)
      if (result.error) setError(result.error)
    })
  }

  return (
    <div className="flex items-center gap-3 flex-wrap">
      {/* Status badge */}
      <span className={`inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium border ${STATUS_COLORS[block.status]}`}>
        {STATUS_LABELS[block.status]}
      </span>

      {userRole === 'manager' && (
        <>
          {canPostPreliminary(block.status) && (
            <button
              onClick={handlePostPreliminary}
              disabled={isPending}
              className="px-3 py-1.5 text-sm bg-amber-600 text-white rounded-md hover:bg-amber-700 disabled:opacity-50"
            >
              {isPending ? 'Posting…' : 'Post as Preliminary'}
            </button>
          )}

          {canPublishFinal(block.status) && (
            <>
              <Link
                href={`/schedule/inbox?blockId=${block.id}`}
                className="px-3 py-1.5 text-sm border border-slate-300 text-slate-700 rounded-md hover:bg-slate-50"
              >
                View Inbox
              </Link>
              <button
                onClick={handlePostFinal}
                disabled={isPending}
                className="px-3 py-1.5 text-sm bg-green-700 text-white rounded-md hover:bg-green-800 disabled:opacity-50"
              >
                {isPending ? 'Publishing…' : 'Publish as Final'}
              </button>
            </>
          )}
        </>
      )}

      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  )
}
