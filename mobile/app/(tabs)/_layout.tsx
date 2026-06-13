import { Tabs, Link } from 'expo-router'
import { Pressable, Text } from 'react-native'
import { colors } from '../../src/theme'
import { useAuth } from '../../src/store/auth'

function TabIcon({ label, focused }: { label: string; focused: boolean }) {
  const icons: Record<string, string> = {
    Home: '⊙',
    Workout: '◈',
    Library: '⊞',
    History: '◷',
    Coach: '◉',
  }
  return (
    <Text style={{ fontSize: 20, color: focused ? colors.primary : colors.gray400 }}>
      {icons[label] ?? '○'}
    </Text>
  )
}

export default function TabLayout() {
  const user = useAuth((s) => s.user)
  const initials = user?.display_name
    ? user.display_name
        .split(' ')
        .map((w) => w[0])
        .join('')
        .slice(0, 2)
        .toUpperCase()
    : '?'

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.gray400,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.text,
        headerRight: () => (
          <Link href="/settings" asChild>
            <Pressable
              style={{
                marginRight: 16,
                width: 32,
                height: 32,
                borderRadius: 16,
                backgroundColor: colors.primary,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text style={{ color: '#fff', fontWeight: '700', fontSize: 12 }}>
                {initials}
              </Text>
            </Pressable>
          </Link>
        ),
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ focused }) => <TabIcon label="Home" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="workout"
        options={{
          title: 'Workout',
          tabBarIcon: ({ focused }) => <TabIcon label="Workout" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="library"
        options={{
          title: 'Library',
          tabBarIcon: ({ focused }) => <TabIcon label="Library" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="history"
        options={{
          title: 'History',
          tabBarIcon: ({ focused }) => <TabIcon label="History" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="coach"
        options={{
          title: 'Coach',
          tabBarIcon: ({ focused }) => <TabIcon label="Coach" focused={focused} />,
        }}
      />
    </Tabs>
  )
}
