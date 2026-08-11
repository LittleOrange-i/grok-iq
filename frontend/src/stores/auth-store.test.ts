import { clearCookies } from '@/test-utils/cookies'
import { beforeEach, describe, expect, it, vi } from 'vitest'

async function importAuthStore() {
  const { useAuthStore } = await import('./auth-store')
  return useAuthStore
}

const sampleUser = {
  id: 1,
  username: 'admin',
  role: 'admin' as const,
}

describe('useAuthStore', () => {
  beforeEach(() => {
    clearCookies()
    vi.resetModules()
  })

  it('starts with an empty access token when nothing is persisted', async () => {
    const useAuthStore = await importAuthStore()

    expect(useAuthStore.getState().auth.accessToken).toBe('')
    expect(useAuthStore.getState().auth.user).toBeNull()
  })

  it('persists access token so a new store instance reads it back', async () => {
    const useAuthStore = await importAuthStore()
    useAuthStore
      .getState()
      .auth.setSession(
        'session-token',
        { ...sampleUser },
        new Date(Date.now() + 604_800_000).toISOString()
      )

    vi.resetModules()
    const useAuthStoreAfterReload = await importAuthStore()

    expect(useAuthStoreAfterReload.getState().auth.accessToken).toBe(
      'session-token'
    )
  })

  it('updates the signed-in user via setUser', async () => {
    const useAuthStore = await importAuthStore()

    useAuthStore.getState().auth.setUser({ ...sampleUser })

    expect(useAuthStore.getState().auth.user).toEqual(sampleUser)
  })

  it('stores a complete JWT session in one state update', async () => {
    const useAuthStore = await importAuthStore()

    useAuthStore
      .getState()
      .auth.setSession(
        'admin-jwt',
        { ...sampleUser },
        new Date(Date.now() + 604_800_000).toISOString()
      )

    expect(useAuthStore.getState().auth.accessToken).toBe('admin-jwt')
    expect(useAuthStore.getState().auth.user).toEqual(sampleUser)
  })

  it('reset clears user and access token and drops persistence', async () => {
    const useAuthStore = await importAuthStore()
    useAuthStore
      .getState()
      .auth.setSession(
        'will-be-cleared',
        { ...sampleUser },
        new Date(Date.now() + 604_800_000).toISOString()
      )

    useAuthStore.getState().auth.reset()

    expect(useAuthStore.getState().auth.user).toBeNull()
    expect(useAuthStore.getState().auth.accessToken).toBe('')

    vi.resetModules()
    const useAuthStoreAfterReload = await importAuthStore()

    expect(useAuthStoreAfterReload.getState().auth.user).toBeNull()
    expect(useAuthStoreAfterReload.getState().auth.accessToken).toBe('')
  })
})
