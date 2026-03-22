// tests/unit/auth.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock Supabase clients before importing auth module
vi.mock('@/lib/supabase/client', () => ({
  createClient: vi.fn(() => ({
    auth: {
      signInWithPassword: vi.fn().mockResolvedValue({ data: { user: { id: 'test-id' }, session: {} }, error: null }),
      signOut: vi.fn().mockResolvedValue({ error: null }),
      onAuthStateChange: vi.fn(() => ({
        data: { subscription: { unsubscribe: vi.fn() } },
      })),
    },
  })),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => ({
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
    },
  })),
}))

describe('lib/auth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('exports signIn, signOut, getServerUser, onAuthStateChange, inviteUser', async () => {
    const auth = await import('@/lib/auth')
    expect(typeof auth.signIn).toBe('function')
    expect(typeof auth.signOut).toBe('function')
    expect(typeof auth.getServerUser).toBe('function')
    expect(typeof auth.onAuthStateChange).toBe('function')
    expect(typeof auth.inviteUser).toBe('function')
  })

  it('signIn returns data and error shape', async () => {
    const { signIn } = await import('@/lib/auth')
    const result = await signIn('test@test.com', 'pass123')
    expect(result).toHaveProperty('data')
    expect(result).toHaveProperty('error')
    expect(result.error).toBeNull()
  })

  it('getServerUser returns null when no session', async () => {
    const { getServerUser } = await import('@/lib/auth')
    const user = await getServerUser()
    expect(user).toBeNull()
  })

  it('signOut returns no error', async () => {
    const { signOut } = await import('@/lib/auth')
    const result = await signOut()
    expect(result.error).toBeNull()
  })

  it('onAuthStateChange returns an unsubscribe function', async () => {
    const { onAuthStateChange } = await import('@/lib/auth')
    const unsubscribe = onAuthStateChange(vi.fn())
    expect(typeof unsubscribe).toBe('function')
  })
})
