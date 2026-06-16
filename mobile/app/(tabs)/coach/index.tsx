/**
 * app/(tabs)/coach.tsx  -- Conversation list
 *
 * Shows all past conversations with title, relative time, and cost chip.
 * Tapping a row pushes /coach/[id]. "New chat" pushes /coach/new.
 */
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  ActivityIndicator,
} from 'react-native'
import { useRouter } from 'expo-router'
import { useQuery } from '@tanstack/react-query'
import { chatApi } from '../../../src/services/api'
import { colors, spacing, radius } from '../../../src/theme'
import type { Conversation } from '@fitness/shared-types'

// ---- helpers ----

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

// ---- CostChip ----

function CostChip({ cost }: { cost: number }) {
  return (
    <View style={styles.costChip}>
      <Text style={styles.costChipText}>${cost.toFixed(4)}</Text>
    </View>
  )
}

// ---- ConversationRow ----

function ConversationRow({ item, onPress }: { item: Conversation; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.rowTop}>
        <Text style={styles.rowTitle} numberOfLines={1}>{item.title}</Text>
        <CostChip cost={item.total_cost_usd} />
      </View>
      <Text style={styles.rowTime}>{relativeTime(item.updated_at)}</Text>
    </TouchableOpacity>
  )
}

// ---- Screen ----

export default function CoachScreen() {
  const router = useRouter()
  const { data: conversations, isLoading } = useQuery({
    queryKey: ['chat-conversations'],
    queryFn: chatApi.conversations,
  })

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Conversations</Text>
        <TouchableOpacity
          style={styles.newBtn}
          onPress={() => router.push('/coach/new')}
          activeOpacity={0.8}
        >
          <Text style={styles.newBtnText}>New chat</Text>
        </TouchableOpacity>
      </View>

      {/* Body */}
      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : !conversations || conversations.length === 0 ? (
        <View style={styles.centered}>
          <Text style={styles.emptyText}>Ask your coach anything about your training.</Text>
        </View>
      ) : (
        <FlatList<Conversation>
          data={conversations}
          keyExtractor={(c) => c.id}
          renderItem={({ item }) => (
            <ConversationRow
              item={item}
              onPress={() => router.push(`/coach/${item.id}`)}
            />
          )}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          contentContainerStyle={styles.list}
        />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.gray700,
  },
  newBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
  },
  newBtnText: {
    fontSize: 12,
    fontWeight: '500',
    color: colors.surface,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  emptyText: {
    fontSize: 14,
    color: colors.gray500,
    textAlign: 'center',
  },
  list: {
    paddingBottom: spacing.base,
  },
  row: {
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
  },
  rowTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  rowTitle: {
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
    color: colors.gray800,
  },
  rowTime: {
    fontSize: 12,
    color: colors.gray400,
    marginTop: 2,
  },
  separator: {
    height: 1,
    backgroundColor: colors.border,
  },
  costChip: {
    backgroundColor: colors.gray100,
    borderRadius: radius.sm,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  costChipText: {
    fontSize: 11,
    color: colors.gray400,
  },
})
