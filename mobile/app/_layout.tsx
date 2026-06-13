import { useEffect } from 'react'
import { ActivityIndicator, View } from 'react-native'
import { Stack, useRouter, useSegments } from 'expo-router'
import * as SplashScreen from 'expo-splash-screen'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useAuth } from '../src/store/auth'
import { colors } from '../src/theme'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 min — mirrors web config
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
})

SplashScreen.preventAutoHideAsync()

export { ErrorBoundary } from 'expo-router'

export const unstable_settings = {
  initialRouteName: '(tabs)',
}

export default function RootLayout() {
  const { hasHydrated, token, hydrate } = useAuth()
  const router = useRouter()
  const segments = useSegments()

  useEffect(() => {
    hydrate()
  }, [])

  useEffect(() => {
    if (!hasHydrated) return
    SplashScreen.hideAsync()

    const inLogin = segments[0] === 'login'

    if (!token && !inLogin) {
      router.replace('/login')
    } else if (token && inLogin) {
      router.replace('/(tabs)')
    }
  }, [hasHydrated, token, segments, router])

  if (!hasHydrated) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors.bg,
        }}
      >
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    )
  }

  return (
    <QueryClientProvider client={queryClient}>
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="login" options={{ headerShown: false }} />
        <Stack.Screen
          name="settings"
          options={{ presentation: 'modal', title: 'Settings' }}
        />
        <Stack.Screen name="plans/new" options={{ title: 'New plan' }} />
        <Stack.Screen name="plans/[id]" options={{ title: 'Edit plan' }} />
        <Stack.Screen name="library/[id]" options={{ title: 'Exercise' }} />
        <Stack.Screen name="history/[id]" options={{ title: 'Workout' }} />
        <Stack.Screen name="+not-found" />
      </Stack>
    </QueryClientProvider>
  )
}
