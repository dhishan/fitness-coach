import type { ChatEvent } from '@fitness/shared-types'
import { API_URL } from './api'
import { useAuth } from '../store/auth'

export interface StreamHandlers {
  onEvent: (e: ChatEvent) => void
  onError: (message: string) => void
}

const MAX_RETRIES = 3

export function openTurnStream(
  convId: string, turnId: string, fromSeq: number, handlers: StreamHandlers,
): () => void {
  let cancelled = false
  let lastSeq = fromSeq
  let retries = 0
  const controller = new AbortController()

  async function run(): Promise<void> {
    while (!cancelled) {
      try {
        const res = await fetch(
          `${API_URL}/api/v1/chat/conversations/${convId}/turns/${turnId}/stream?from_seq=${lastSeq}`,
          { headers: { Authorization: `Bearer ${useAuth.getState().token}` }, signal: controller.signal },
        )
        if (!res.ok || !res.body) throw new Error(`stream http ${res.status}`)
        retries = 0
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buf = ''
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          buf += decoder.decode(value, { stream: true })
          const lines = buf.split('\n\n')
          buf = lines.pop() ?? ''
          for (const block of lines) {
            const line = block.split('\n').find((l) => l.startsWith('data: '))
            if (!line) continue
            const event = JSON.parse(line.slice(6)) as ChatEvent
            lastSeq = event.seq
            handlers.onEvent(event)
            if (event.type === 'done' || event.type === 'error') return
          }
        }
        return // server closed after terminal event
      } catch (err) {
        if (cancelled) return
        retries += 1
        if (retries > MAX_RETRIES) {
          handlers.onError('Connection lost. Tap to retry.')
          return
        }
        await new Promise((r) => setTimeout(r, 500 * 2 ** retries))
      }
    }
  }

  void run()
  return () => { cancelled = true; controller.abort() }
}
