// lib/auth.ts
// The ONLY file in the codebase that calls Supabase Auth APIs.
// All other files import from here — never from @supabase/ssr or @supabase/supabase-js auth directly.
// Exception: middleware.ts calls Supabase directly (documented exception — Next.js middleware
// cannot use next/headers cookies the same way, so it must construct its own Supabase client).

import type { AuthChangeEvent, Session, User } from '@supabase/supabase-js'
import { createClient as createBrowserClient } from '@/lib/supabase/client'
import { createClient as createServerClient } from '@/lib/supabase/server'

// ── Server-side ──────────────────────────────────────────────────────────────

/** Get the currently authenticated user. Use in Server Components and Route Handlers. */
export async function getServerUser(): Promise<User | null> {
  const supabase = createServerClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  if (error) {
    // Auth check failed (network error, malformed token, etc.)
    // Treat as unauthenticated so middleware redirects to login.
    console.error('[auth] getServerUser error:', error.message)
    return null
  }
  return user
}

// ── Client-side ──────────────────────────────────────────────────────────────

/** Sign in with email and password. */
export function signIn(email: string, password: string) {
  const supabase = createBrowserClient()
  return supabase.auth.signInWithPassword({ email, password })
}

/** Sign out the current session. */
export function signOut() {
  const supabase = createBrowserClient()
  return supabase.auth.signOut()
}

/**
 * Subscribe to auth state changes (login/logout).
 * Returns an unsubscribe function — call it in useEffect cleanup.
 */
export function onAuthStateChange(
  callback: (event: AuthChangeEvent, session: Session | null) => void
): () => void {
  const supabase = createBrowserClient()
  const { data: { subscription } } = supabase.auth.onAuthStateChange(callback)
  return () => subscription.unsubscribe()
}

// ── Admin (server-side, service role key) ────────────────────────────────────

/**
 * Invite a new user by email. Server action only — uses service role key.
 * Creates a Supabase Auth user and sends an invite email.
 */
export async function inviteUser(
  email: string,
  userData: {
    full_name: string
    role: 'manager' | 'therapist'
    employment_type: 'full_time' | 'prn'
    default_shift_type: 'day' | 'night' | null
  }
) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set — inviteUser requires a service role key')
  }
  const { createClient } = await import('@supabase/supabase-js')
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )
  return admin.auth.admin.inviteUserByEmail(email, { data: userData })
}
