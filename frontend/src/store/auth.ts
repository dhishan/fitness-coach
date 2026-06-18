import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import * as Sentry from '@sentry/react'

interface AuthState {
  token: string | null
  user: { id: string; email: string; display_name: string } | null
  setAuth: (token: string, user: AuthState['user']) => void
  logout: () => void
}

export const useAuth = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      setAuth: (token, user) => {
        if (user) Sentry.setUser({ id: user.id, email: user.email })
        Sentry.addBreadcrumb({ category: 'auth', message: 'signed_in', level: 'info' })
        set({ token, user })
      },
      logout: () => {
        Sentry.setUser(null)
        set({ token: null, user: null })
      },
    }),
    {
      name: 'fitness-auth',
      onRehydrateStorage: () => (state) => {
        if (state?.user) Sentry.setUser({ id: state.user.id, email: state.user.email })
      },
    }
  )
)
