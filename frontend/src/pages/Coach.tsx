import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { chatApi } from '../services/api'
import { openTurnStream } from '../services/chatStream'
import type { ChatEvent } from '@fitness/shared-types'

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

function CostChip({ cost }: { cost: number }) {
  return (
    <span className="inline-block text-xs text-gray-400 bg-gray-100 rounded px-1.5 py-0.5">
      ${cost.toFixed(4)}
    </span>
  )
}

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

const STARTERS = [
  'How is my bench progressing?',
  'What should I train today?',
  'Where am I slacking?',
]

// ---- ConversationList ----

function ConversationList() {
  const navigate = useNavigate()
  const { data: conversations, isLoading } = useQuery({
    queryKey: ['chat-conversations'],
    queryFn: chatApi.conversations,
  })

  return (
    <div className="flex-1 flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <span className="text-sm font-semibold text-gray-700">Conversations</span>
        <button
          onClick={() => navigate('/coach/new')}
          className="text-xs bg-primary-500 text-white rounded-full px-3 py-1 font-medium"
        >
          New chat
        </button>
      </div>

      {isLoading && (
        <div className="flex-1 flex items-center justify-center">
          <span className="text-gray-400 text-sm">Loading...</span>
        </div>
      )}

      {!isLoading && (!conversations || conversations.length === 0) && (
        <div className="flex-1 flex items-center justify-center px-8 text-center">
          <p className="text-gray-500 text-sm">Ask your coach anything about your training.</p>
        </div>
      )}

      {!isLoading && conversations && conversations.length > 0 && (
        <ul className="divide-y divide-gray-100">
          {conversations.map((c) => (
            <li key={c.id}>
              <button
                className="w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors"
                onClick={() => navigate(`/coach/${c.id}`)}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="text-sm font-medium text-gray-800 line-clamp-1 flex-1">
                    {c.title}
                  </span>
                  <CostChip cost={c.total_cost_usd} />
                </div>
                <span className="text-xs text-gray-400 mt-0.5 block">
                  {relativeTime(c.updated_at)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ---- ConversationThread ----

function ConversationThread({ convId }: { convId: string }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const isNew = convId === 'new'

  const [turns, setTurns] = useState<LocalTurn[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [activeConvId, setActiveConvId] = useState<string | undefined>(isNew ? undefined : convId)
  const [totalCost, setTotalCost] = useState<number>(0)

  // per active stream state
  const cancelStreamRef = useRef<(() => void) | null>(null)
  const lastSeqRef = useRef<number>(0)
  const pendingTurnIdRef = useRef<string | null>(null)

  // hydrate from existing conversation
  const { data: detail } = useQuery({
    queryKey: ['chat-conversation', convId],
    queryFn: () => chatApi.conversation(convId),
    enabled: !isNew,
  })

  useEffect(() => {
    if (!detail) return
    setActiveConvId(detail.id)
    setTotalCost(detail.total_cost_usd)
    setTurns(
      detail.turns.map((t) => ({
        id: t.id,
        role: t.role,
        content: t.content,
        status: t.status,
        inputTokens: t.input_tokens,
        outputTokens: t.output_tokens,
        costUsd: t.cost_usd,
      })),
    )
  }, [detail])

  // cancel stream on unmount
  useEffect(() => {
    return () => {
      cancelStreamRef.current?.()
    }
  }, [])

  // reconnect on visibility change
  useEffect(() => {
    function handleVisibility() {
      if (document.visibilityState !== 'visible') return
      const pendingId = pendingTurnIdRef.current
      const cid = activeConvId
      if (!pendingId || !cid) return
      // check turn still pending in local state
      setTurns((prev) => {
        const t = prev.find((x) => x.id === pendingId)
        if (!t || t.status !== 'pending') return prev
        // re-open stream from lastSeq
        cancelStreamRef.current?.()
        cancelStreamRef.current = openTurnStream(cid, pendingId, lastSeqRef.current, {
          onEvent: (e) => handleStreamEvent(e, pendingId, cid),
          onError: () => markFailed(pendingId),
        })
        return prev
      })
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConvId])

  function markFailed(turnId: string) {
    setTurns((prev) =>
      prev.map((t) => (t.id === turnId ? { ...t, status: 'failed', toolStatus: undefined } : t)),
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
    } else if (e.type === 'tool_call') {
      setTurns((prev) =>
        prev.map((t) =>
          t.id === assistantTurnId ? { ...t, toolStatus: 'Checking your training data...' } : t,
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
      // refetch conversation to get final tokens/cost
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
        // update URL without full navigation so back still works
        navigate(`/coach/${cid}`, { replace: true })
      }

      lastSeqRef.current = 0
      pendingTurnIdRef.current = res.assistant_turn_id

      setTurns((prev) => [
        ...prev,
        {
          id: res.user_turn_id,
          role: 'user',
          content: message,
          status: 'completed',
        },
        {
          id: res.assistant_turn_id,
          role: 'assistant',
          content: '',
          status: 'pending',
        },
      ])

      cancelStreamRef.current?.()
      cancelStreamRef.current = openTurnStream(cid, res.assistant_turn_id, 0, {
        onEvent: (e) => handleStreamEvent(e, res.assistant_turn_id, cid),
        onError: () => markFailed(res.assistant_turn_id),
      })
    } catch {
      // start failed
    } finally {
      setSending(false)
    }
  }

  const isEmpty = turns.length === 0

  return (
    <div className="flex-1 flex flex-col">
      {/* header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100">
        <button
          onClick={() => navigate('/coach')}
          className="text-gray-500 hover:text-gray-700"
          aria-label="Back"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <span className="flex-1 text-sm font-semibold text-gray-700 line-clamp-1">
          {isNew ? 'New conversation' : (detail?.title ?? 'Coach')}
        </span>
        {totalCost > 0 && (
          <CostChip cost={totalCost} />
        )}
      </div>

      {/* messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {isEmpty && (
          <div className="space-y-2 pt-4">
            <p className="text-center text-sm text-gray-400 mb-4">Ask your coach anything about your training.</p>
            {STARTERS.map((s) => (
              <button
                key={s}
                onClick={() => send(s)}
                className="w-full text-left text-sm text-gray-700 border border-gray-200 rounded-xl px-4 py-3 hover:bg-gray-50 transition-colors"
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {turns.map((turn) => (
          <div key={turn.id} className={`flex flex-col ${turn.role === 'user' ? 'items-end' : 'items-start'}`}>
            <div
              className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap ${
                turn.role === 'user'
                  ? 'bg-primary-500 text-white'
                  : 'bg-gray-100 text-gray-800'
              }`}
            >
              {turn.status === 'failed' ? (
                <button
                  className="text-red-500 text-sm"
                  onClick={() => {
                    // find preceding user turn to retry
                    const idx = turns.findIndex((t) => t.id === turn.id)
                    const userTurn = idx > 0 ? turns[idx - 1] : null
                    if (userTurn && userTurn.role === 'user') {
                      // remove the failed pair and resend
                      setTurns((prev) => prev.filter((t) => t.id !== turn.id && t.id !== userTurn.id))
                      void send(userTurn.content, activeConvId)
                    }
                  }}
                >
                  Generation failed. Tap to retry.
                </button>
              ) : (
                <>
                  {turn.content}
                  {turn.status === 'pending' && !turn.content && (
                    <span className="inline-block w-2 h-4 bg-gray-400 animate-pulse rounded-sm align-middle" />
                  )}
                </>
              )}
            </div>

            {/* tool status line */}
            {turn.toolStatus && (
              <span className="text-xs text-gray-400 mt-1 px-1">{turn.toolStatus}</span>
            )}

            {/* cost chip for completed assistant turns */}
            {turn.role === 'assistant' && turn.status === 'completed' && turn.costUsd !== undefined && turn.costUsd > 0 && (
              <span className="text-xs text-gray-400 mt-1 px-1">
                {turn.inputTokens} in / {turn.outputTokens} out tokens, ${turn.costUsd.toFixed(4)}
              </span>
            )}
          </div>
        ))}
      </div>

      {/* input */}
      <div className="px-4 py-3 border-t border-gray-100 flex gap-2">
        <input
          className="flex-1 text-sm border border-gray-200 rounded-full px-4 py-2 outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500"
          placeholder="Ask your coach..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void send(input)
            }
          }}
          disabled={sending}
        />
        <button
          onClick={() => void send(input)}
          disabled={sending || !input.trim()}
          className="w-9 h-9 rounded-full bg-primary-500 flex items-center justify-center text-white disabled:opacity-40 transition-opacity flex-shrink-0"
          aria-label="Send"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>
      </div>
    </div>
  )
}

// ---- Coach (router shim) ----

export default function Coach() {
  const { id } = useParams<{ id?: string }>()

  if (id !== undefined) {
    return <ConversationThread convId={id} />
  }

  return <ConversationList />
}
