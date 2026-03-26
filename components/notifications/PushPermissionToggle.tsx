'use client'

import { useState, useEffect } from 'react'
import { subscribeToPush } from '@/app/actions/notifications'

function urlBase64ToUint8Array(base64Url: string): Uint8Array {
  const padding = '='.repeat((4 - (base64Url.length % 4)) % 4)
  const base64 = (base64Url + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

export function PushPermissionToggle() {
  const [status, setStatus] = useState<'default' | 'granted' | 'denied' | 'unsupported'>('default')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  async function ensureSubscription() {
    const vapid = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
    if (!vapid) {
      console.warn('[PushPermissionToggle] NEXT_PUBLIC_VAPID_PUBLIC_KEY missing')
      return
    }

    const reg = await navigator.serviceWorker.ready
    const existing = await reg.pushManager.getSubscription()
    const applicationServerKey = urlBase64ToUint8Array(vapid) as BufferSource
    const sub =
      existing ??
      (await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      }))

    const json = sub.toJSON()
    const p256dh = json.keys?.p256dh
    const auth = json.keys?.auth
    const endpoint = json.endpoint
    if (!endpoint || !p256dh || !auth) {
      console.warn('[PushPermissionToggle] subscription JSON missing keys/endpoint')
      setSaveError('Could not read push keys from browser')
      return
    }

    setSaving(true)
    setSaveError(null)
    try {
      const result = await subscribeToPush({
        endpoint,
        keys: { p256dh, auth },
      })
      if (!result.ok) {
        setSaveError(result.error)
        console.error('[PushPermissionToggle] subscribeToPush failed', result.error)
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unknown error'
      setSaveError(msg)
      console.error('[PushPermissionToggle] subscribeToPush threw', e)
    } finally {
      setSaving(false)
    }
  }

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!('Notification' in window) || !('serviceWorker' in navigator)) {
      setStatus('unsupported')
    } else {
      const permission = Notification.permission as 'default' | 'granted' | 'denied'
      setStatus(permission)
      if (permission === 'granted') {
        // Permission can be granted from a previous session; make sure subscription exists in DB.
        void ensureSubscription()
      }
    }
  }, [])

  async function handleEnable() {
    const permission = await Notification.requestPermission()
    setStatus(permission)
    if (permission !== 'granted') return

    await ensureSubscription()
  }

  if (status === 'unsupported') return null
  if (status === 'denied') {
    return <p className="text-xs text-slate-400">Push notifications blocked in browser settings</p>
  }
  if (status === 'granted') {
    return (
      <div className="space-y-1">
        <p className="text-xs text-green-600">
          {saving ? 'Finishing push setup…' : 'Push notifications enabled'}
        </p>
        {saveError && (
          <p className="text-xs text-red-600" role="alert">
            Could not save subscription: {saveError}
          </p>
        )}
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={handleEnable}
      className="text-xs text-blue-600 underline hover:text-blue-800"
    >
      Enable push notifications
    </button>
  )
}
