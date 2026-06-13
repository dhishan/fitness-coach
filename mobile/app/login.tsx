import { useEffect } from 'react'
import {
  Alert,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import * as WebBrowser from 'expo-web-browser'
import * as Google from 'expo-auth-session/providers/google'
import { useRouter } from 'expo-router'
import { authApi } from '../src/services/api'
import { useAuth } from '../src/store/auth'
import { colors, spacing, radius } from '../src/theme'
import { IOS_CLIENT_ID, WEB_CLIENT_ID } from '../src/config'

WebBrowser.maybeCompleteAuthSession()

export default function Login() {
  const router = useRouter()
  const { setAuth } = useAuth()

  const [_request, response, promptAsync] = Google.useIdTokenAuthRequest({
    clientId: WEB_CLIENT_ID,
    iosClientId: IOS_CLIENT_ID || undefined,
  })

  useEffect(() => {
    if (response?.type !== 'success') return
    const idToken = response.params.id_token
    if (!idToken) return

    authApi
      .google(idToken)
      .then(async (data) => {
        await setAuth(data.access_token, data.user)
        router.replace('/(tabs)')
      })
      .catch((err: { response?: { status?: number } }) => {
        const status = err?.response?.status
        if (status === 403) {
          Alert.alert('Access denied', 'This app is invite-only.')
        } else {
          Alert.alert('Sign-in failed', 'Please try again.')
        }
      })
  }, [response, setAuth, router])

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <View style={styles.iconWrap}>
          <Text style={styles.iconText}>FT</Text>
        </View>
        <Text style={styles.title}>Fitness Tracker</Text>
        <Text style={styles.subtitle}>Track your training, talk to your coach.</Text>
        <TouchableOpacity
          style={styles.button}
          onPress={() => promptAsync()}
          activeOpacity={0.8}
        >
          <Text style={styles.buttonText}>Sign in with Google</Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.base,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xl,
    width: '100%',
    maxWidth: 360,
    alignItems: 'center',
    gap: spacing.base,
  },
  iconWrap: {
    width: 56,
    height: 56,
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 18,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.text,
  },
  subtitle: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  button: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    marginTop: spacing.sm,
    width: '100%',
    alignItems: 'center',
  },
  buttonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 16,
  },
})
