import { create } from 'zustand'
import * as SecureStore from 'expo-secure-store'

interface User {
  id: string
  email: string
  display_name: string
}

interface AuthState {
  token: string | null
  user: User | null
  hasHydrated: boolean
  hydrate: () => Promise<void>
  setAuth: (token: string, user: User) => Promise<void>
  logout: () => Promise<void>
}

const TOKEN_KEY = 'fitness-auth-token'
const USER_KEY = 'fitness-auth-user'

export const useAuth = create<AuthState>()((set) => ({
  token: null,
  user: null,
  hasHydrated: false,

  hydrate: async () => {
    try {
      const [token, userJson] = await Promise.all([
        SecureStore.getItemAsync(TOKEN_KEY),
        SecureStore.getItemAsync(USER_KEY),
      ])
      const user: User | null = userJson ? JSON.parse(userJson) : null
      set({ token, user, hasHydrated: true })
    } catch {
      set({ token: null, user: null, hasHydrated: true })
    }
  },

  setAuth: async (token, user) => {
    await Promise.all([
      SecureStore.setItemAsync(TOKEN_KEY, token),
      SecureStore.setItemAsync(USER_KEY, JSON.stringify(user)),
    ])
    set({ token, user })
  },

  logout: async () => {
    await Promise.all([
      SecureStore.deleteItemAsync(TOKEN_KEY),
      SecureStore.deleteItemAsync(USER_KEY),
    ])
    set({ token: null, user: null })
  },
}))
