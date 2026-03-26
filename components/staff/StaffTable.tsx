// components/staff/StaffTable.tsx
'use client'

import { useState } from 'react'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
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
                    onClick={e => {
                      e.stopPropagation()
                      setEditingId(t.id)
                    }}
                  >
                    Edit
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <StaffSheet
        key={editing?.id ?? 'none'}
        therapist={editing}
        open={editingId !== null}
        onClose={() => setEditingId(null)}
      />

      <InviteDialog open={inviteOpen} onClose={() => setInviteOpen(false)} />
    </div>
  )
}
