/**
 * mobile/src/services/chatStream.ts
 *
 * Resumable SSE stream for coach chat turns.
 * Uses react-native-sse (EventSource polyfill) instead of fetch-reader,
 * since RN's built-in fetch does not expose a real ReadableStream.
 *
 * Interface is intentionally identical to frontend/src/services/chatStream.ts
 * so the web + mobile turn-handling logic stays in sync.
 */
import EventSource from 'react-native-sse'
import type { ChatEvent } from '@fitness/shared-types'
import { useAuth } from '../store/auth'
import { API_URL } from '../config'

export interface StreamHandlers {
  onEvent: (e: ChatEvent) => void
  onError: (message: string) => void
}

const MAX_RETRIES = 3

export function openTurnStream(
  convId: string,
  turnId: string,
  fromSeq: number,
  handlers: StreamHandlers,
): () => void {
  let cancelled = false
  let lastSeq = fromSeq
  let retries = 0
  let es: InstanceType<typeof EventSource> | null = null

  function cleanup() {
    try { es?.removeAllEventListeners() } catch { /* noop */ }
    try { es?.close() } catch { /* noop */ }
    es = null
  }

  function connect() {
    if (cancelled) return

    const token = useAuth.getState().token
    const url =
      `${API_URL}/api/v1/chat/conversations/${encodeURIComponent(convId)}` +
      `/turns/${encodeURIComponent(turnId)}/stream?from_seq=${lastSeq}`

    const headers: Record<string, string> = {
      Accept: 'text/event-stream',
    }
    if (token) headers['Authorization'] = `Bearer ${token}`

    cleanup()

    es = new EventSource(url, {
      headers,
      method: 'GET',
      pollingInterval: 0,
    })

    es.addEventListener('message', (event) => {
      if (cancelled) return
      const raw = (event as unknown as { data?: string }).data
      if (!raw) return
      try {
        const parsed = JSON.parse(raw) as ChatEvent
        if (typeof parsed.seq === 'number') {
          lastSeq = parsed.seq
        }
        handlers.onEvent(parsed)

        if (parsed.type === 'done' || parsed.type === 'error') {
          cleanup()
        }
      } catch {
        // ignore non-JSON keepalive comments
      }
    })

    es.addEventListener('error', () => {
      if (cancelled) return
      cleanup()

      retries += 1
      if (retries > MAX_RETRIES) {
        handlers.onError('Connection lost. Tap to retry.')
        return
      }

      const backoffMs = 500 * Math.pow(2, retries - 1)
      setTimeout(() => {
        if (!cancelled) connect()
      }, backoffMs)
    })
  }

  connect()

  return () => {
    cancelled = true
    cleanup()
  }
}
