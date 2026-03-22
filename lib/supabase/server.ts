// lib/supabase/server.ts
import { createServerClient } from '@supabase/ssr'
import type { Database } from '@/lib/types/database.types'

export function createClient() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { cookies } = require('next/headers')
  const cookieStore = cookies()
  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // Called from a Server Component — cookies are read-only. Safe to ignore.
          }
        },
      },
    }
  )
}
