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

  useEffect(() => {
    setDay(initialDay)
    setNight(initialNight)
  }, [initialDay, initialNight])

  useEffect(() => {
    if (!saved) return
    const timer = setTimeout(() => setSaved(false), 3000)
    return () => clearTimeout(timer)
  }, [saved])

  function validateAll(): string | null {
    const dayErr = validateCoverageThresholds(day.minimum_staff, day.ideal_staff, day.maximum_staff)
    if (dayErr) return `Day shift: ${dayErr}`
    const nightErr = validateCoverageThresholds(
      night.minimum_staff,
      night.ideal_staff,
      night.maximum_staff
    )
    if (nightErr) return `Night shift: ${nightErr}`
    return null
  }

  async function handleSubmit() {
    const clientError = validateAll()
    if (clientError) {
      setError(clientError)
      return
    }
    setSaving(true)
    setError(null)
    const result = await updateCoverageThresholds(day, night)
    setSaving(false)
    if (result.error) {
      setError(result.error)
      return
    }
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
          value={Number.isNaN(value) ? '' : value}
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
