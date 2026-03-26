// components/staff/InviteDialog.tsx
'use client'

import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
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
    if (result.error) {
      setError(result.error)
      return
    }
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
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
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
