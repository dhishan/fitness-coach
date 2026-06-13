import { useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import * as SecureStore from 'expo-secure-store'
import { useRouter } from 'expo-router'
import { useAuth } from '../src/store/auth'
import { usageApi } from '../src/services/api'
import { colors, spacing, radius, card } from '../src/theme'
import type { UsageSummary } from '@fitness/shared-types'

const UNITS_KEY = 'fitness-units'

export default function Settings() {
  const router = useRouter()
  const { user, logout } = useAuth()
  const [useKg, setUseKg] = useState(true)
  const [usage, setUsage] = useState<UsageSummary | null>(null)
  const [loadingUsage, setLoadingUsage] = useState(true)

  useEffect(() => {
    SecureStore.getItemAsync(UNITS_KEY).then((v) => {
      if (v !== null) setUseKg(v === 'kg')
    })
    usageApi
      .summary()
      .then(setUsage)
      .catch(() => {})
      .finally(() => setLoadingUsage(false))
  }, [])

  const toggleUnits = async (value: boolean) => {
    setUseKg(value)
    await SecureStore.setItemAsync(UNITS_KEY, value ? 'kg' : 'lb')
  }

  const handleSignOut = () => {
    Alert.alert('Sign out', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: async () => {
          await logout()
          router.replace('/login')
        },
      },
    ])
  }

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
      <View style={[card, styles.section]}>
        <Text style={styles.label}>Email</Text>
        <Text style={styles.value}>{user?.email ?? '-'}</Text>
      </View>

      <View style={[card, styles.section, styles.row]}>
        <Text style={styles.label}>Weight units</Text>
        <View style={styles.row}>
          <Text style={[styles.unitLabel, !useKg && styles.activeUnit]}>lb</Text>
          <Switch
            value={useKg}
            onValueChange={toggleUnits}
            trackColor={{ false: colors.gray300, true: colors.primary }}
            thumbColor={colors.surface}
          />
          <Text style={[styles.unitLabel, useKg && styles.activeUnit]}>kg</Text>
        </View>
      </View>

      <View style={[card, styles.section]}>
        <Text style={styles.sectionTitle}>Monthly usage</Text>
        {loadingUsage ? (
          <ActivityIndicator size="small" color={colors.primary} />
        ) : usage ? (
          <>
            <Text style={styles.value}>
              {usage.calls} calls - ${usage.cost_usd.toFixed(4)}
            </Text>
            <Text style={styles.subtext}>
              {(usage.input_tokens + usage.output_tokens).toLocaleString()} tokens
            </Text>
          </>
        ) : (
          <Text style={styles.subtext}>No usage data</Text>
        )}
      </View>

      <TouchableOpacity style={styles.signOutButton} onPress={handleSignOut} activeOpacity={0.8}>
        <Text style={styles.signOutText}>Sign out</Text>
      </TouchableOpacity>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.base, gap: spacing.md },
  section: { padding: spacing.base },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { fontSize: 13, fontWeight: '600', color: colors.textSecondary, marginBottom: spacing.sm },
  label: { fontSize: 13, color: colors.textSecondary, marginBottom: 4 },
  value: { fontSize: 15, color: colors.text, fontWeight: '500' },
  subtext: { fontSize: 13, color: colors.textSecondary, marginTop: 2 },
  unitLabel: { fontSize: 14, color: colors.gray400, marginHorizontal: 6 },
  activeUnit: { color: colors.text, fontWeight: '600' },
  signOutButton: {
    backgroundColor: colors.error,
    borderRadius: radius.md,
    padding: spacing.base,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  signOutText: { color: '#fff', fontWeight: '600', fontSize: 16 },
})
