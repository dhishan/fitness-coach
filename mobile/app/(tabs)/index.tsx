import { StyleSheet, Text, View } from 'react-native'
import { colors, spacing } from '../../src/theme'

export default function HomeScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>Home coming soon.</Text>
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
  text: {
    fontSize: 16,
    color: colors.textSecondary,
  },
})
