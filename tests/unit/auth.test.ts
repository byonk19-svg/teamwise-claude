// tests/unit/auth.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock Supabase clients before importing auth
const mockSignInWithPassword = vi.fn().mockResolvedValue({ data: {}, error: null })
const mockSignOut = vi.fn().mockResolvedValue({ error: null })
const mockOnAuthStateChange = vi.fn(() => ({
  data: { subscription: { unsubscribe: vi.fn() } },
}))

vi.mock('@/lib/supabase/client', () => ({
  createClient: vi.fn(() => ({
    auth: {
      signInWithPassword: mockSignInWithPassword,
      signOut: mockSignOut,
      onAuthStateChange: mockOnAuthStateChange,
    },
  })),
}))

const mockGetUser = vi.fn().mockResolvedValue({ data: { user: null }, error: null })

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => ({
    auth: { getUser: mockGetUser },
  })),
}))

// Mock @supabase/supabase-js for inviteUser admin client
const mockInviteUserByEmail = vi.fn().mockResolvedValue({ data: {}, error: null })
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    auth: { admin: { inviteUserByEmail: mockInviteUserByEmail } },
  })),
}))

import { signIn, signOut, getServerUser, onAuthStateChange, inviteUser } from '@/lib/auth'

beforeEach(() => {
  vi.clearAllMocks()
  // Restore default mock behaviours after each test
  mockSignInWithPassword.mockResolvedValue({ data: {}, error: null })
  mockGetUser.mockResolvedValue({ data: { user: null }, error: null })
  mockInviteUserByEmail.mockResolvedValue({ data: {}, error: null })
})

describe('lib/auth', () => {
  it('exports signIn, signOut, getServerUser, onAuthStateChange, inviteUser', () => {
    expect(typeof signIn).toBe('function')
    expect(typeof signOut).toBe('function')
    expect(typeof getServerUser).toBe('function')
    expect(typeof onAuthStateChange).toBe('function')
    expect(typeof inviteUser).toBe('function')
  })

  it('signIn calls supabase.auth.signInWithPassword', async () => {
    const result = await signIn('test@test.com', 'pass123')
    expect(mockSignInWithPassword).toHaveBeenCalledWith({
      email: 'test@test.com',
      password: 'pass123',
    })
    expect(result).toHaveProperty('data')
    expect(result).toHaveProperty('error')
  })

  it('getServerUser returns null when no user is authenticated', async () => {
    const user = await getServerUser()
    expect(user).toBeNull()
  })

  it('getServerUser returns null and logs error when auth check fails', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null }, error: { message: 'JWT expired' } })
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const user = await getServerUser()
    expect(user).toBeNull()
    expect(consoleSpy).toHaveBeenCalledWith('[auth] getServerUser error:', 'JWT expired')
    consoleSpy.mockRestore()
  })

  it('onAuthStateChange returns an unsubscribe function', () => {
    const callback = vi.fn()
    const unsubscribe = onAuthStateChange(callback)
    expect(typeof unsubscribe).toBe('function')
    expect(mockOnAuthStateChange).toHaveBeenCalledWith(callback)
  })

  it('inviteUser calls admin.inviteUserByEmail with correct args', async () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key'
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'
    const userData = {
      full_name: 'Jane Doe',
      role: 'therapist' as const,
      employment_type: 'full_time' as const,
      default_shift_type: 'day' as const,
    }
    await inviteUser('jane@test.com', userData)
    expect(mockInviteUserByEmail).toHaveBeenCalledWith('jane@test.com', { data: userData })
  })
})
