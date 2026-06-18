import * as Sentry from '@sentry/react-native'
import Constants from 'expo-constants'
import { useEffect } from 'react'
import { ActivityIndicator, View, Keyboard } from 'react-native'
import { Stack, useRouter, useSegments } from 'expo-router'
import * as Linking from 'expo-linking'
import * as SplashScreen from 'expo-splash-screen'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useAuth } from '../src/store/auth'
import { useUnitStore } from '../src/store/units'
import { colors } from '../src/theme'

const dsn = (Constants.expoConfig?.extra as { sentry?: { dsn?: string } } | undefined)?.sentry?.dsn
if (dsn) {
  Sentry.init({
    dsn,
    environment: __DEV__ ? 'development' : 'production',
    release: Constants.expoConfig?.version,
    sendDefaultPii: false,
    tracesSampleRate: 1.0,
    enableAutoSessionTracking: true,
  })
}

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

function RootLayout() {
  const { hasHydrated, token, hydrate } = useAuth()
  const router = useRouter()
  const segments = useSegments()

  useEffect(() => {
    hydrate()
    void useUnitStore.getState().hydrate()
  }, [])

  // Dev-only: accept a JWT via deep link so Maestro UI tests can log in
  // without going through Google OAuth.
  // Example: fitness://dev-login?token=<JWT>
  // This handler is compiled out in Release builds (guarded by __DEV__).
  useEffect(() => {
    if (!__DEV__) return
    const handleUrl = ({ url }: { url: string }) => {
      try {
        const parsed = Linking.parse(url)
        if (parsed.path === 'dev-login' && parsed.queryParams?.token) {
          const jwt = String(parsed.queryParams.token)
          // Decode the payload to extract user info (no signature verification
          // needed here — this is a dev-only convenience hook).
          const parts = jwt.split('.')
          if (parts.length === 3) {
            const payload = JSON.parse(atob(parts[1]))
            void useAuth.getState().setAuth(jwt, {
              id: payload.sub ?? '',
              email: payload.email ?? '',
              display_name: payload.display_name ?? payload.email ?? '',
            })
          }
        }
      } catch {
        // silently ignore malformed links in dev
      }
    }
    const subscription = Linking.addEventListener('url', handleUrl)
    // Also handle the initial URL if the app was cold-started from the link
    void Linking.getInitialURL().then((url) => {
      if (url) handleUrl({ url })
    })
    return () => subscription.remove()
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
      <View style={{ flex: 1 }} onStartShouldSetResponder={() => false} onTouchStart={() => Keyboard.dismiss()}>
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
        <Stack.Screen name="body" options={{ title: 'Body metrics' }} />
        <Stack.Screen name="cardio" options={{ title: 'Cardio' }} />
        <Stack.Screen name="recipes/index" options={{ title: 'Recipes' }} />
        <Stack.Screen name="recipes/[id]" options={{ title: 'Recipe' }} />
        <Stack.Screen name="+not-found" />
      </Stack>
      </View>
    </QueryClientProvider>
  )
}

export default Sentry.wrap(RootLayout)
