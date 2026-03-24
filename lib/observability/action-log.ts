type LogLevel = 'info' | 'error'

interface ActionLogPayload {
  action: string
  actorId?: string
  ok?: boolean
  message?: string
  meta?: Record<string, unknown>
}

function emit(level: LogLevel, payload: ActionLogPayload) {
  const entry = {
    ts: new Date().toISOString(),
    ...payload,
  }

  if (level === 'error') {
    console.error('[action]', JSON.stringify(entry))
    return
  }
  console.info('[action]', JSON.stringify(entry))
}

export function logActionStart(action: string, actorId?: string, meta?: Record<string, unknown>) {
  emit('info', { action, actorId, ok: true, message: 'start', meta })
}

export function logActionSuccess(action: string, actorId?: string, meta?: Record<string, unknown>) {
  emit('info', { action, actorId, ok: true, message: 'success', meta })
}

export function logActionFailure(
  action: string,
  actorId: string | undefined,
  message: string,
  meta?: Record<string, unknown>
) {
  emit('error', { action, actorId, ok: false, message, meta })
}
