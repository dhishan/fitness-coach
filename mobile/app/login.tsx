import {
  Alert,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native'
import { GoogleSignin, statusCodes } from '@react-native-google-signin/google-signin'
import * as AppleAuthentication from 'expo-apple-authentication'
import { useRouter } from 'expo-router'
import { authApi } from '../src/services/api'
import { useAuth } from '../src/store/auth'
import { colors, spacing, radius } from '../src/theme'
import { IOS_CLIENT_ID, WEB_CLIENT_ID } from '../src/config'

// Configure at module load. The native SDK uses ASWebAuthenticationSession
// under the hood. Unlike expo-auth-session's generic OAuth, it sends only
// the OAuth client id to Google (no bundle id), so AltStore's per-user
// bundle suffix is invisible to Google's validation.
GoogleSignin.configure({
  iosClientId: IOS_CLIENT_ID,
  webClientId: WEB_CLIENT_ID || undefined,
  scopes: ['openid', 'profile', 'email'],
  offlineAccess: false,
})

export default function Login() {
  const router = useRouter()
  const { setAuth } = useAuth()

  const handleGoogle = async () => {
    try {
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: false })
      const userInfo = await GoogleSignin.signIn()
      const idToken =
        (userInfo as unknown as { data?: { idToken?: string } })?.data?.idToken ??
        (userInfo as unknown as { idToken?: string })?.idToken
      if (!idToken) {
        Alert.alert('Sign-in failed', 'Google did not return an id token.')
        return
      }
      const data = await authApi.google(idToken)
      await setAuth(data.access_token, data.user)
      router.replace('/(tabs)')
    } catch (e: unknown) {
      const err = e as { code?: string; response?: { status?: number } }
      if (err?.code === statusCodes.SIGN_IN_CANCELLED) return
      if (err?.code === statusCodes.IN_PROGRESS) return
      if (err?.response?.status === 403) {
        Alert.alert('Access denied', 'This app is invite-only.')
        return
      }
      Alert.alert('Sign-in failed', 'Please try again.')
    }
  }

  const handleApple = async () => {
    try {
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      })
      const idToken = credential.identityToken
      if (!idToken) {
        Alert.alert('Sign in failed', 'No identity token received')
        return
      }
      const fullName = credential.fullName
        ? [credential.fullName.givenName, credential.fullName.familyName]
            .filter(Boolean)
            .join(' ')
        : undefined
      const res = await authApi.apple(
        idToken,
        fullName || undefined,
        credential.email ?? undefined,
      )
      await setAuth(res.access_token, res.user)
      router.replace('/(tabs)')
    } catch (e: unknown) {
      const err = e as { code?: string; response?: { status?: number }; message?: string }
      if (err?.code === 'ERR_REQUEST_CANCELED') return
      if (err?.response?.status === 403) {
        Alert.alert('Not allowed', 'This app is invite-only.')
        return
      }
      Alert.alert('Sign in failed', String(err?.message ?? e))
    }
  }

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
          onPress={handleGoogle}
          activeOpacity={0.8}
        >
          <Text style={styles.buttonText}>Sign in with Google</Text>
        </TouchableOpacity>
        {Platform.OS === 'ios' && (
          <AppleAuthentication.AppleAuthenticationButton
            buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
            buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
            cornerRadius={8}
            style={styles.appleButton}
            onPress={handleApple}
          />
        )}
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
  appleButton: {
    width: '100%',
    height: 48,
    marginTop: spacing.sm,
  },
})
