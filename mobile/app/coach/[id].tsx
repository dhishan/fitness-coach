/**
 * app/coach/[id].tsx  -- Conversation thread
 *
 * id === "new" -> blank thread, creates a conversation on first send.
 * id === <convId> -> hydrates from chatApi.conversation(id) on mount.
 *
 * Turn state is keyed by TURN ID (never array index).
 * Stream cancel on unmount. AppState 'active' reconnects pending stream.
 */
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  AppState,
} from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import Markdown from 'react-native-markdown-display'
import { useEffect, useRef, useState, useCallback } from 'react'
import { chatApi } from '../../src/services/api'
import { openTurnStream } from '../../src/services/chatStream'
import { colors, spacing, radius } from '../../src/theme'
import type { ChatEvent } from '@fitness/shared-types'

// ---- types ----

interface LocalTurn {
  id: string
  role: 'user' | 'assistant'
  content: string
  status: 'pending' | 'completed' | 'failed'
  toolStatus?: string
  inputTokens?: number
  outputTokens?: number
  costUsd?: number
}

// ---- constants ----

const STARTERS = [
  'How is my bench progressing?',
  'What should I train today?',
  'Where am I slacking?',
]

// ---- markdown styles (assistant bubble bg is white, text is gray-800) ----

const mdStyles = StyleSheet.create({
  body: { color: colors.gray800, fontSize: 14, lineHeight: 22 } as object,
  heading1: { color: colors.gray900, fontWeight: '700', fontSize: 18, marginTop: 10, marginBottom: 4 } as object,
  heading2: { color: colors.gray900, fontWeight: '700', fontSize: 16, marginTop: 8, marginBottom: 4 } as object,
  heading3: { color: colors.gray800, fontWeight: '600', fontSize: 14, marginTop: 6, marginBottom: 2 } as object,
  strong: { color: colors.gray900, fontWeight: '700' } as object,
  code_inline: {
    backgroundColor: colors.gray100,
    color: colors.error,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    fontSize: 12,
    borderRadius: 3,
    paddingHorizontal: 4,
  } as object,
  fence: { backgroundColor: colors.gray800, borderRadius: 8, padding: 12, marginVertical: 4 } as object,
  code_block: { backgroundColor: colors.gray800, borderRadius: 8, padding: 12, marginVertical: 4 } as object,
  bullet_list: { marginVertical: 2 } as object,
  ordered_list: { marginVertical: 2 } as object,
  paragraph: { marginTop: 0, marginBottom: 4 } as object,
})

// ---- CostChip ----

function CostChip({ cost }: { cost: number }) {
  return (
    <View style={styles.costChip}>
      <Text style={styles.costChipText}>${cost.toFixed(4)}</Text>
    </View>
  )
}

// ---- screen ----

export default function CoachThread() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()
  const queryClient = useQueryClient()
  const isNew = id === 'new'

  const [turns, setTurns] = useState<LocalTurn[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [activeConvId, setActiveConvId] = useState<string | undefined>(isNew ? undefined : id)
  const [totalCost, setTotalCost] = useState(0)

  const cancelStreamRef = useRef<(() => void) | null>(null)
  const lastSeqRef = useRef<number>(0)
  const pendingTurnIdRef = useRef<string | null>(null)
  const listRef = useRef<FlatList>(null)

  // ---- hydrate from server ----
  const { data: detail } = useQuery({
    queryKey: ['chat-conversation', id],
    queryFn: () => chatApi.conversation(id),
    enabled: !isNew,
  })

  useEffect(() => {
    if (!detail) return
    setActiveConvId(detail.id)
    setTotalCost(detail.total_cost_usd)
    const mapped: LocalTurn[] = detail.turns.map((t) => ({
      id: t.id,
      role: t.role,
      content: t.content,
      status: t.status,
      inputTokens: t.input_tokens,
      outputTokens: t.output_tokens,
      costUsd: t.cost_usd,
    }))
    setTurns(mapped)
  }, [detail])

  // ---- cancel stream on unmount ----
  useEffect(() => {
    return () => {
      cancelStreamRef.current?.()
    }
  }, [])

  const scrollToBottom = useCallback(() => {
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 80)
  }, [])

  // ---- AppState reconnect ----
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return
      const pendingId = pendingTurnIdRef.current
      const cid = activeConvId
      if (!pendingId || !cid) return
      // re-open if the turn is still pending
      setTurns((prev) => {
        const t = prev.find((x) => x.id === pendingId)
        if (!t || t.status !== 'pending') return prev
        cancelStreamRef.current?.()
        cancelStreamRef.current = openTurnStream(cid, pendingId, lastSeqRef.current, {
          onEvent: (e) => handleStreamEvent(e, pendingId, cid),
          onError: () => markFailed(pendingId),
        })
        return prev
      })
    })
    return () => sub.remove()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConvId])

  // ---- helpers ----

  function markFailed(turnId: string) {
    setTurns((prev) =>
      prev.map((t) =>
        t.id === turnId ? { ...t, status: 'failed', toolStatus: undefined } : t,
      ),
    )
    pendingTurnIdRef.current = null
  }

  function handleStreamEvent(e: ChatEvent, assistantTurnId: string, cid: string) {
    lastSeqRef.current = e.seq

    if (e.type === 'text') {
      setTurns((prev) =>
        prev.map((t) =>
          t.id === assistantTurnId ? { ...t, content: t.content + (e.text ?? '') } : t,
        ),
      )
      scrollToBottom()
    } else if (e.type === 'tool_call') {
      setTurns((prev) =>
        prev.map((t) =>
          t.id === assistantTurnId
            ? { ...t, toolStatus: 'Checking your training data...' }
            : t,
        ),
      )
    } else if (e.type === 'tool_result') {
      setTurns((prev) =>
        prev.map((t) =>
          t.id === assistantTurnId ? { ...t, toolStatus: undefined } : t,
        ),
      )
    } else if (e.type === 'done') {
      pendingTurnIdRef.current = null
      cancelStreamRef.current = null
      chatApi.conversation(cid).then((refreshed) => {
        const finalTurn = refreshed.turns.find((t) => t.id === assistantTurnId)
        if (finalTurn) {
          setTurns((prev) =>
            prev.map((t) =>
              t.id === assistantTurnId
                ? {
                    ...t,
                    content: finalTurn.content,
                    status: 'completed',
                    toolStatus: undefined,
                    inputTokens: finalTurn.input_tokens,
                    outputTokens: finalTurn.output_tokens,
                    costUsd: finalTurn.cost_usd,
                  }
                : t,
            ),
          )
        }
        setTotalCost(refreshed.total_cost_usd)
        queryClient.invalidateQueries({ queryKey: ['chat-conversations'] })
        queryClient.invalidateQueries({ queryKey: ['chat-conversation', cid] })
        scrollToBottom()
      })
    } else if (e.type === 'error') {
      markFailed(assistantTurnId)
    }
  }

  async function send(message: string, retryConvId?: string) {
    if (!message.trim() || sending) return
    setSending(true)
    setInput('')

    const cidToUse = retryConvId ?? activeConvId

    try {
      const res = await chatApi.start(message, cidToUse)
      const cid = res.conversation_id

      if (!activeConvId) {
        setActiveConvId(cid)
      }

      lastSeqRef.current = 0
      pendingTurnIdRef.current = res.assistant_turn_id

      setTurns((prev) => [
        ...prev,
        { id: res.user_turn_id, role: 'user', content: message, status: 'completed' },
        { id: res.assistant_turn_id, role: 'assistant', content: '', status: 'pending' },
      ])
      scrollToBottom()

      cancelStreamRef.current?.()
      cancelStreamRef.current = openTurnStream(cid, res.assistant_turn_id, 0, {
        onEvent: (e) => handleStreamEvent(e, res.assistant_turn_id, cid),
        onError: () => markFailed(res.assistant_turn_id),
      })
    } catch {
      // start failed silently; user can retry
    } finally {
      setSending(false)
    }
  }

  // ---- render turn ----

  function renderTurn({ item: turn }: { item: LocalTurn }) {
    const isUser = turn.role === 'user'
    return (
      <View style={[styles.turnRow, isUser ? styles.turnRowUser : styles.turnRowAssistant]}>
        <View style={[styles.bubble, isUser ? styles.bubbleUser : styles.bubbleAssistant]}>
          {turn.status === 'failed' ? (
            <TouchableOpacity
              onPress={() => {
                // find preceding user turn by scanning the array by index
                // (allowed here because we're finding the CONTENT of the user's
                //  message, not using index as a stable key)
                const idx = turns.findIndex((t) => t.id === turn.id)
                const userTurn = idx > 0 ? turns[idx - 1] : null
                if (userTurn && userTurn.role === 'user') {
                  setTurns((prev) =>
                    prev.filter((t) => t.id !== turn.id && t.id !== userTurn.id),
                  )
                  void send(userTurn.content, activeConvId)
                }
              }}
            >
              <Text style={styles.retryText}>Generation failed. Tap to retry.</Text>
            </TouchableOpacity>
          ) : isUser ? (
            <Text style={styles.userText}>{turn.content}</Text>
          ) : (
            <>
              {turn.status === 'pending' && !turn.content ? (
                <ActivityIndicator size="small" color={colors.gray400} />
              ) : (
                <Markdown style={mdStyles}>{turn.content || ' '}</Markdown>
              )}
            </>
          )}
        </View>

        {/* tool status line */}
        {turn.toolStatus ? (
          <Text style={styles.toolStatus}>{turn.toolStatus}</Text>
        ) : null}

        {/* per-turn cost chip for completed assistant turns */}
        {turn.role === 'assistant' &&
          turn.status === 'completed' &&
          turn.costUsd !== undefined &&
          turn.costUsd > 0 ? (
          <Text style={styles.turnCost}>
            {turn.inputTokens} in / {turn.outputTokens} out tokens, ${turn.costUsd.toFixed(4)}
          </Text>
        ) : null}
      </View>
    )
  }

  const isEmpty = turns.length === 0

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={8} style={styles.backBtn}>
          <Text style={styles.backArrow}>{'<'}</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {isNew ? 'New conversation' : (detail?.title ?? 'Coach')}
        </Text>
        {totalCost > 0 ? <CostChip cost={totalCost} /> : null}
      </View>

      {/* Messages */}
      <FlatList<LocalTurn>
        ref={listRef}
        data={turns}
        keyExtractor={(t) => t.id}
        renderItem={renderTurn}
        contentContainerStyle={[styles.messageList, isEmpty && styles.messageListEmpty]}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>Ask your coach anything about your training.</Text>
            {STARTERS.map((s) => (
              <TouchableOpacity
                key={s}
                style={styles.starterBtn}
                onPress={() => void send(s)}
                activeOpacity={0.7}
              >
                <Text style={styles.starterText}>{s}</Text>
              </TouchableOpacity>
            ))}
          </View>
        }
      />

      {/* Composer */}
      <View style={styles.composer}>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder="Ask your coach..."
          placeholderTextColor={colors.gray400}
          multiline
          maxLength={2000}
          editable={!sending}
          returnKeyType="send"
          blurOnSubmit={false}
          onSubmitEditing={() => void send(input)}
        />
        <TouchableOpacity
          style={[styles.sendBtn, (!input.trim() || sending) && styles.sendBtnDisabled]}
          onPress={() => void send(input)}
          disabled={!input.trim() || sending}
          activeOpacity={0.8}
        >
          {sending ? (
            <ActivityIndicator size="small" color={colors.surface} />
          ) : (
            <Text style={styles.sendArrow}>^</Text>
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },

  // header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backBtn: { padding: spacing.xs },
  backArrow: { fontSize: 18, color: colors.gray500, fontWeight: '500' },
  headerTitle: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: colors.gray700,
  },
  costChip: {
    backgroundColor: colors.gray100,
    borderRadius: radius.sm,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  costChipText: { fontSize: 11, color: colors.gray400 },

  // messages
  messageList: { padding: spacing.base, paddingBottom: spacing.sm },
  messageListEmpty: { flex: 1, justifyContent: 'center' },
  emptyState: { alignItems: 'center', paddingHorizontal: spacing.lg },
  emptyText: {
    fontSize: 14,
    color: colors.gray400,
    textAlign: 'center',
    marginBottom: spacing.base,
  },
  starterBtn: {
    width: '100%',
    borderWidth: 1,
    borderColor: colors.gray200,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.md,
    marginBottom: spacing.sm,
    backgroundColor: colors.surface,
  },
  starterText: { fontSize: 14, color: colors.gray700 },

  // turns
  turnRow: { marginBottom: spacing.base },
  turnRowUser: { alignItems: 'flex-end' },
  turnRowAssistant: { alignItems: 'flex-start' },
  bubble: { maxWidth: '85%', borderRadius: radius.lg, padding: spacing.md },
  bubbleUser: { backgroundColor: colors.primary },
  bubbleAssistant: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  userText: { color: colors.surface, fontSize: 14, lineHeight: 20 },
  retryText: { color: colors.error, fontSize: 14 },
  toolStatus: { fontSize: 12, color: colors.gray400, marginTop: 4, paddingHorizontal: 4 },
  turnCost: { fontSize: 12, color: colors.gray400, marginTop: 4, paddingHorizontal: 4 },

  // composer
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.md,
    paddingBottom: Platform.OS === 'ios' ? spacing.lg : spacing.md,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.gray200,
    borderRadius: radius.full,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm + 2,
    fontSize: 14,
    color: colors.text,
    maxHeight: 120,
    backgroundColor: colors.bg,
  },
  sendBtn: {
    width: 38,
    height: 38,
    borderRadius: radius.full,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: { opacity: 0.4 },
  sendArrow: { color: colors.surface, fontSize: 18, fontWeight: '700', lineHeight: 22 },
})
