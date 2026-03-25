// lib/server/deferred-work.ts
// Next 15+ exposes `after` / `unstable_after` from 'next/server' for post-response work.
// This Next 14.2 patch does not ship that API (see next/server typings). Run follow-up work
// in a detached microtask so the server action response is not blocked.

export function runAfterResponse(fn: () => void | Promise<void>): void {
  queueMicrotask(() => {
    void fn()
  })
}
