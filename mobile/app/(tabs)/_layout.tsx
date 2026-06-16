import { Tabs, Link } from 'expo-router'
import { Pressable, Text } from 'react-native'
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons'
import { colors } from '../../src/theme'
import { useAuth } from '../../src/store/auth'

function TabIcon({ label, focused }: { label: string; focused: boolean }) {
  const tint = focused ? colors.primary : colors.gray400
  const size = 22
  switch (label) {
    case 'Home':
      return <Ionicons name={focused ? 'home' : 'home-outline'} size={size} color={tint} />
    case 'Workout':
      return <MaterialCommunityIcons name="dumbbell" size={size + 2} color={tint} />
    case 'Nutrition':
      return <Ionicons name={focused ? 'restaurant' : 'restaurant-outline'} size={size} color={tint} />
    case 'History':
      return <Ionicons name={focused ? 'time' : 'time-outline'} size={size} color={tint} />
    case 'Coach':
      return <Ionicons name={focused ? 'chatbubble' : 'chatbubble-outline'} size={size} color={tint} />
    default:
      return <Text style={{ color: tint }}>○</Text>
  }
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
        name="nutrition"
        options={{
          title: 'Nutrition',
          tabBarIcon: ({ focused }) => <TabIcon label="Nutrition" focused={focused} />,
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
      {/* Library is hidden from the tab bar but reachable via router.push('/library') */}
      <Tabs.Screen
        name="library"
        options={{
          href: null,
          title: 'Library',
        }}
      />
    </Tabs>
  )
}
