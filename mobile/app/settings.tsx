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
import { useRouter } from 'expo-router'
import Constants from 'expo-constants'
import * as Updates from 'expo-updates'
import { useAuth } from '../src/store/auth'
import { useUnitStore } from '../src/store/units'
import { usageApi } from '../src/services/api'
import { colors, spacing, radius, card } from '../src/theme'
import type { UsageSummary } from '@fitness/shared-types'

export default function Settings() {
  const router = useRouter()
  const { user, logout } = useAuth()
  const unit = useUnitStore((s) => s.unit)
  const setUnit = useUnitStore((s) => s.set)
  const useKg = unit === 'kg'
  const [usage, setUsage] = useState<UsageSummary | null>(null)
  const [loadingUsage, setLoadingUsage] = useState(true)
  const [checking, setChecking] = useState(false)

  // Version + OTA info. expo-updates constants are safe to read (null in dev).
  const appVersion = Constants.expoConfig?.version ?? 'unknown'
  const otaLabel = Updates.isEmbeddedLaunch
    ? 'Embedded (no OTA yet)'
    : `${(Updates.updateId ?? '').slice(0, 8)}${
        Updates.createdAt ? ` · ${Updates.createdAt.toLocaleDateString()}` : ''
      }`

  const handleCheckUpdate = async () => {
    if (!Updates.isEnabled) {
      Alert.alert('Updates', 'OTA updates are not available in this build.')
      return
    }
    setChecking(true)
    try {
      const res = await Updates.checkForUpdateAsync()
      if (!res.isAvailable) {
        Alert.alert('Up to date', 'You are running the latest version.')
        return
      }
      await Updates.fetchUpdateAsync()
      Alert.alert('Update ready', 'Restart now to apply the update?', [
        { text: 'Later', style: 'cancel' },
        { text: 'Restart', onPress: () => void Updates.reloadAsync() },
      ])
    } catch (e) {
      Alert.alert('Update check failed', String(e))
    } finally {
      setChecking(false)
    }
  }

  useEffect(() => {
    usageApi
      .summary()
      .then(setUsage)
      .catch(() => {})
      .finally(() => setLoadingUsage(false))
  }, [])

  const toggleUnits = async (value: boolean) => {
    await setUnit(value ? 'kg' : 'lb')
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

      <View style={[card, styles.section]}>
        <Text style={styles.sectionTitle}>About</Text>
        <View style={styles.row}>
          <Text style={styles.label}>App version</Text>
          <Text style={styles.value}>{appVersion}</Text>
        </View>
        <View style={[styles.row, { marginTop: spacing.sm }]}>
          <Text style={styles.label}>Update</Text>
          <Text style={styles.value}>{otaLabel}</Text>
        </View>
        <Text style={styles.subtext}>
          Runtime {Updates.runtimeVersion ?? '-'} · channel {Updates.channel ?? '-'}
        </Text>
        <TouchableOpacity
          style={styles.checkButton}
          onPress={handleCheckUpdate}
          activeOpacity={0.8}
          disabled={checking}
        >
          {checking ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <Text style={styles.checkText}>Check for updates</Text>
          )}
        </TouchableOpacity>
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
  checkButton: {
    marginTop: spacing.md,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
  checkText: { color: colors.primary, fontWeight: '600', fontSize: 14 },
  signOutButton: {
    backgroundColor: colors.error,
    borderRadius: radius.md,
    padding: spacing.base,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  signOutText: { color: '#fff', fontWeight: '600', fontSize: 16 },
})
