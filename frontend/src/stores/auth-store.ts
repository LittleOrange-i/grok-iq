import { create } from 'zustand'
import { getCookie, removeCookie, setCookie } from '@/lib/cookies'

const ACCESS_TOKEN_COOKIE = 'grokiq-admin-access-token'
const DEFAULT_SESSION_SECONDS = 7 * 24 * 60 * 60

export interface AuthUser {
  id: number
  username: string
  role: 'admin'
}

interface AuthState {
  auth: {
    user: AuthUser | null
    setUser: (user: AuthUser | null) => void
    accessToken: string
    setSession: (accessToken: string, user: AuthUser, expiresAt: string) => void
    reset: () => void
  }
}

function persistedToken(): string {
  const raw = getCookie(ACCESS_TOKEN_COOKIE)
  if (!raw) return ''
  try {
    return String(JSON.parse(raw) || '')
  } catch {
    removeCookie(ACCESS_TOKEN_COOKIE)
    return ''
  }
}

export const useAuthStore = create<AuthState>()((set) => ({
  auth: {
    user: null,
    accessToken: persistedToken(),
    setUser: (user) =>
      set((state) => ({ ...state, auth: { ...state.auth, user } })),
    setSession: (accessToken, user, expiresAt) =>
      set((state) => {
        const expiresAtMs = new Date(expiresAt).getTime()
        const remainingSeconds = Number.isFinite(expiresAtMs)
          ? Math.max(1, Math.floor((expiresAtMs - Date.now()) / 1000))
          : DEFAULT_SESSION_SECONDS
        setCookie(
          ACCESS_TOKEN_COOKIE,
          JSON.stringify(accessToken),
          remainingSeconds
        )
        return {
          ...state,
          auth: { ...state.auth, accessToken, user },
        }
      }),
    reset: () =>
      set((state) => {
        removeCookie(ACCESS_TOKEN_COOKIE)
        return {
          ...state,
          auth: { ...state.auth, user: null, accessToken: '' },
        }
      }),
  },
}))
