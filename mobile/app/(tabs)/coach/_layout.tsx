/**
 * Nested stack inside the Coach tab. Keeps the bottom tab bar visible when
 * the user opens a single conversation, and gives them proper back navigation
 * (header back arrow + iOS swipe-from-edge) within the tab.
 */
import { Stack } from 'expo-router'

export default function CoachStackLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="[id]" />
    </Stack>
  )
}
