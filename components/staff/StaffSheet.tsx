// components/staff/StaffSheet.tsx
'use client'

import { useState } from 'react'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetFooter,
} from '@/components/ui/sheet'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
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
    if (result.error) {
      setError(result.error)
      return
    }
    onClose()
  }

  async function handleDeactivate() {
    if (!therapist) return
    setSaving(true)
    setError(null)
    const result = await deactivateTherapist(therapist.id)
    setSaving(false)
    if (result.error) {
      setError(result.error)
      return
    }
    onClose()
  }

  return (
    <Sheet
      open={open}
      onOpenChange={isOpen => {
        if (!isOpen) {
          setConfirming(false)
          onClose()
        }
      }}
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
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
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
              onValueChange={v =>
                setDefaultShiftType(v === 'none' ? null : (v as 'day' | 'night'))
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
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
