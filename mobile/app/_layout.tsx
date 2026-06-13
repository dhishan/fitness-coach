import { useEffect } from 'react'
import { ActivityIndicator, View } from 'react-native'
import { Stack, useRouter, useSegments } from 'expo-router'
import * as SplashScreen from 'expo-splash-screen'
import { useAuth } from '../src/store/auth'
import { colors } from '../src/theme'

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
    <Stack>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="login" options={{ headerShown: false }} />
      <Stack.Screen
        name="settings"
        options={{ presentation: 'modal', title: 'Settings' }}
      />
      <Stack.Screen name="+not-found" />
    </Stack>
  )
}
