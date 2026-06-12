# Plan 4: Web PWA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Installable web PWA at ui.fitness-tracker.blueelephants.org: Google login, Home (summary + progress), Workout (fast logging with prefill/supersets/alternatives/autosave), History, Coach (streaming chat with cost bubbles) — verified by logging a real workout and chatting in a browser.

**Architecture:** npm workspaces monorepo addition: `packages/shared-types` (single source of truth for API types; mobile reuses it in Plan 5) + `frontend/` (React 18 + Vite 5 + TS + Tailwind + React Query + Zustand + react-router + chart.js). Google Identity Services button -> backend JWT in zustand-persisted store. SSE via fetch-reader with reconnect + turnId-keyed messages (lessons doc #4). Manual PWA (no vite-plugin-pwa), prompt-style update banner. Firebase Hosting + custom domain via terraform; CI deploy-frontend job after deploy-backend.

**Theme (binding, from spec):** white page background with dotted grid:
```css
body { background-color: #ffffff; background-image: radial-gradient(circle, #d4d4d8 1px, transparent 1px); background-size: 20px 20px; }
```
Inter font, white cards `rounded-xl shadow-sm border border-gray-100`, primary blue (#3b82f6 family), per-muscle accent palette, Chart.js charts, react-hot-toast. Honest empty states everywhere ("No workouts yet. Start your first session."). NO fake/sample data.

**UI text rules:** no em dashes, no arrows, US-ASCII only.

---

### Task 1: npm workspaces + shared-types package

**Files:** Create root `package.json`, `packages/shared-types/package.json`, `packages/shared-types/tsconfig.json`, `packages/shared-types/src/index.ts`.

Root `package.json`:
```json
{
  "name": "fitness-tracker",
  "private": true,
  "workspaces": ["packages/*", "frontend"]
}
```

`packages/shared-types/package.json`:
```json
{
  "name": "@fitness/shared-types",
  "version": "0.1.0",
  "private": true,
  "main": "src/index.ts",
  "types": "src/index.ts"
}
```

`packages/shared-types/tsconfig.json`: `{ "compilerOptions": { "strict": true, "target": "ES2022", "module": "ESNext", "moduleResolution": "bundler", "noEmit": true } }`

`packages/shared-types/src/index.ts` (mirror backend/app/schemas.py + API response shapes EXACTLY):
```ts
export type Muscle =
  | 'chest' | 'back' | 'quads' | 'hamstrings' | 'glutes' | 'shoulders'
  | 'biceps' | 'triceps' | 'core' | 'calves' | 'forearms'

export type MovementPattern = 'push' | 'pull' | 'squat' | 'hinge' | 'carry' | 'core'
export type Equipment = 'barbell' | 'dumbbell' | 'machine' | 'cable' | 'bodyweight' | 'other'

export interface Exercise {
  id: string
  user_id: string
  name: string
  primary_muscles: Muscle[]
  secondary_muscles: Muscle[]
  movement_pattern: MovementPattern
  equipment: Equipment
  is_custom: boolean
}

export interface ExerciseCreate {
  name: string
  primary_muscles: Muscle[]
  secondary_muscles?: Muscle[]
  movement_pattern: MovementPattern
  equipment: Equipment
}

export interface SetEntry {
  weight: number
  reps: number
  rpe?: number | null
  is_warmup?: boolean
}

export interface WorkoutEntry {
  exercise_id: string
  exercise_name: string
  superset_group?: string | null
  sets: SetEntry[]
}

export interface Workout {
  id: string
  user_id: string
  date: string
  started_at: string | null
  ended_at: string | null
  notes: string
  entries: WorkoutEntry[]
  exercise_ids: string[]
  total_volume: number
}

export interface WorkoutListResponse { items: Workout[]; total: number }

export interface PR {
  exercise_id: string
  exercise_name: string
  weight: number
  previous_best: number
}

export interface FinishResponse extends Workout { prs: PR[] }

export interface ExerciseHistoryItem { workout_id: string; date: string; sets: SetEntry[] }

export interface DashboardSummary {
  week_start: string
  sessions_this_week: number
  trained_dates: string[]
  week_volume: number
  streak_weeks: number
}

export interface ProgressPoint { date: string; top_weight: number; volume: number }

export interface AuthResponse {
  access_token: string
  token_type: string
  user: { id: string; email: string; display_name: string }
}

export interface Conversation {
  id: string
  title: string
  created_at: string
  updated_at: string
  total_cost_usd: number
  total_input_tokens: number
  total_output_tokens: number
}

export interface ChatEvent {
  seq: number
  type: 'text' | 'tool_call' | 'tool_result' | 'done' | 'error'
  text?: string
  name?: string
  args?: Record<string, unknown>
  message?: string
}

export interface Turn {
  id: string
  role: 'user' | 'assistant'
  content: string
  status: 'pending' | 'completed' | 'failed'
  created_at: string
  input_tokens: number
  output_tokens: number
  cost_usd: number
  events?: ChatEvent[]
}

export interface ConversationDetail extends Conversation { turns: Turn[] }

export interface StartChatResponse {
  conversation_id: string
  user_turn_id: string
  assistant_turn_id: string
}

export interface UsageSummary {
  month: string
  input_tokens: number
  output_tokens: number
  cost_usd: number
  calls: number
}
```

Verify: `npx -y typescript@5.6.3 --noEmit -p packages/shared-types` passes. Commit: "feat: shared-types workspace package".

---

### Task 2: Frontend scaffold (Vite, theme, API client, auth)

**Files:** `frontend/` via `npm create vite@latest frontend -- --template react-ts` then add deps; key files below are EXACT content.

Deps: `npm i -w frontend axios @tanstack/react-query zustand react-router-dom chart.js react-chartjs-2 react-hot-toast @fitness/shared-types` and dev `tailwindcss postcss autoprefixer @types/google.accounts vitest`.

`frontend/.env.development`: `VITE_API_URL=http://localhost:8000` ; `frontend/.env.production`: `VITE_API_URL=https://api.fitness-tracker.blueelephants.org`. Both: `VITE_GOOGLE_CLIENT_ID=610355955735-0uv0l16rbkr6bd345c34ck690s892kn6.apps.googleusercontent.com`.

`frontend/src/index.css` (theme - binding):
```css
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
@tailwind base;
@tailwind components;
@tailwind utilities;

body {
  font-family: 'Inter', system-ui, sans-serif;
  background-color: #ffffff;
  background-image: radial-gradient(circle, #d4d4d8 1px, transparent 1px);
  background-size: 20px 20px;
}

.card { @apply bg-white rounded-xl shadow-sm border border-gray-100; }
.safe-top { padding-top: env(safe-area-inset-top); }
.safe-bottom { padding-bottom: env(safe-area-inset-bottom); }
```

`frontend/tailwind.config.js`: Inter font family, primary = tailwind blue scale, plus `muscle` accent colors:
```js
muscle: { chest: '#ef4444', back: '#3b82f6', quads: '#f97316', hamstrings: '#f59e0b',
  glutes: '#ec4899', shoulders: '#8b5cf6', biceps: '#06b6d4', triceps: '#14b8a6',
  core: '#84cc16', calves: '#6366f1', forearms: '#6b7280' }
```

`frontend/src/lib/dates.ts`:
```ts
export function toLocalISODate(d: Date = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
```

`frontend/src/store/auth.ts` (zustand + localStorage persist):
```ts
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface AuthState {
  token: string | null
  user: { id: string; email: string; display_name: string } | null
  setAuth: (token: string, user: AuthState['user']) => void
  logout: () => void
}

export const useAuth = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      setAuth: (token, user) => set({ token, user }),
      logout: () => set({ token: null, user: null }),
    }),
    { name: 'fitness-auth' }
  )
)
```

`frontend/src/services/api.ts` (axios instance + namespaced resources; 45s timeout per lessons doc):
```ts
import axios from 'axios'
import type {
  AuthResponse, Conversation, ConversationDetail, DashboardSummary, Exercise,
  ExerciseCreate, ExerciseHistoryItem, FinishResponse, ProgressPoint,
  StartChatResponse, UsageSummary, Workout, WorkoutEntry, WorkoutListResponse,
} from '@fitness/shared-types'
import { useAuth } from '../store/auth'

export const API_URL = import.meta.env.VITE_API_URL as string

export const api = axios.create({
  baseURL: `${API_URL}/api/v1`,
  timeout: 45_000, // Cloud Run cold starts
})

api.interceptors.request.use((config) => {
  const token = useAuth.getState().token
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use(undefined, (error) => {
  if (error.response?.status === 401 && !error.config?.url?.includes('/auth/google')) {
    useAuth.getState().logout()
  }
  return Promise.reject(error)
})

export const authApi = {
  google: (idToken: string) =>
    api.post<AuthResponse>('/auth/google', { id_token: idToken }).then((r) => r.data),
}

export const exercisesApi = {
  list: (params?: { muscle?: string; pattern?: string; q?: string }) =>
    api.get<Exercise[]>('/exercises', { params }).then((r) => r.data),
  create: (body: ExerciseCreate) => api.post<Exercise>('/exercises', body).then((r) => r.data),
  alternatives: (id: string) => api.get<Exercise[]>(`/exercises/${id}/alternatives`).then((r) => r.data),
  history: (id: string, limit = 3) =>
    api.get<ExerciseHistoryItem[]>(`/exercises/${id}/history`, { params: { limit } }).then((r) => r.data),
}

export const workoutsApi = {
  create: (body: { date: string; notes?: string; entries?: WorkoutEntry[] }) =>
    api.post<Workout>('/workouts', body).then((r) => r.data),
  list: (params?: { from?: string; to?: string; limit?: number; offset?: number }) =>
    api.get<WorkoutListResponse>('/workouts', { params }).then((r) => r.data),
  active: () => api.get<Workout | null>('/workouts/active').then((r) => r.data),
  get: (id: string) => api.get<Workout>(`/workouts/${id}`).then((r) => r.data),
  update: (id: string, body: { notes?: string; entries?: WorkoutEntry[] }) =>
    api.put<Workout>(`/workouts/${id}`, body).then((r) => r.data),
  finish: (id: string) => api.post<FinishResponse>(`/workouts/${id}/finish`).then((r) => r.data),
  remove: (id: string) => api.delete(`/workouts/${id}`),
}

export const dashboardApi = {
  summary: (referenceDate: string) =>
    api.get<DashboardSummary>('/dashboard/summary', { params: { reference_date: referenceDate } }).then((r) => r.data),
  exerciseProgress: (id: string) =>
    api.get<ProgressPoint[]>(`/dashboard/exercise/${id}`).then((r) => r.data),
  muscleSplit: (referenceDate: string, weeks = 4) =>
    api.get<Record<string, number>>('/dashboard/muscle-split', { params: { reference_date: referenceDate, weeks } }).then((r) => r.data),
}

export const chatApi = {
  start: (message: string, conversationId?: string) =>
    api.post<StartChatResponse>('/chat/start', { message, conversation_id: conversationId }).then((r) => r.data),
  conversations: () => api.get<Conversation[]>('/chat/conversations').then((r) => r.data),
  conversation: (id: string) => api.get<ConversationDetail>(`/chat/conversations/${id}`).then((r) => r.data),
}

export const usageApi = {
  summary: (month?: string) =>
    api.get<UsageSummary>('/usage/summary', { params: month ? { month } : {} }).then((r) => r.data),
}
```

`frontend/src/services/chatStream.ts` (SSE via fetch reader; reconnect with backoff; the ONLY stream client):
```ts
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
```

Login page (`src/pages/Login.tsx`): GIS script in index.html (`<script src="https://accounts.google.com/gsi/client" async></script>`); render `google.accounts.id.renderButton` into a div; callback posts credential to `authApi.google`, stores via `setAuth`, navigates to `/`. On 403 show "This app is invite-only." toast.

App shell (`src/App.tsx`): react-router with routes `/login`, and authed layout (redirect to /login when no token) containing bottom tab nav (Home, Workout, History, Coach) with `safe-bottom`; sticky header with app name + avatar button (opens Settings sheet) with `safe-top`. QueryClient: `staleTime: 5 * 60_000, refetchOnWindowFocus: false`. Toaster mounted once.

Vitest: `frontend/src/lib/dates.test.ts` asserting toLocalISODate formats a fixed Date correctly (e.g. `new Date(2026, 5, 12)` -> "2026-06-12").

Verify: `npm run build -w frontend` succeeds; `npm run test -w frontend` green; `npm run dev -w frontend` renders login page. Commit per logical chunk (scaffold, theme+api, auth+shell).

---

### Task 3: Home tab

`src/pages/Home.tsx` + components. Data: `dashboardApi.summary(toLocalISODate())`, `workoutsApi.active()`, `workoutsApi.list({limit:1})`, `dashboardApi.muscleSplit(...)`, `dashboardApi.exerciseProgress(selectedExerciseId)`.

Sections (cards on the dotted field):
1. **Start strip**: big primary button "START WORKOUT" (or "RESUME WORKOUT" when active() returns one) -> navigates to /workout. Subline shows active session duration if resuming.
2. **This week**: 7 dots Mon-Sun (filled = date in `trained_dates`), "N sessions", streak badge "N week streak" (hide when 0), week volume.
3. **Last workout** card: date, exercise count, volume; tap -> history detail. Empty state: "No workouts yet. Start your first session."
4. **Progress**: exercise select (from exercisesApi.list, recent-first not required) + line chart (chart.js) of top_weight over date with volume as second dataset. Empty state when no data: "Not enough data yet. Log a few sessions."
5. **Muscle split**: horizontal bars per muscle, colored by tailwind muscle palette, share of last 4 weeks volume. Empty state matches rule.
6. **Settings sheet** (slide-over): user email, kg/lb display preference (local only for now), monthly usage (usageApi.summary): tokens + cost, sign out button.

Commit: "feat: home tab with summary, week strip, progress charts, settings sheet".

---

### Task 4: Workout tab (the core screen)

`src/pages/Workout.tsx` + components. State machine:
- On mount: `workoutsApi.active()`; if none, show "START WORKOUT" empty state; clicking creates `workoutsApi.create({date: toLocalISODate()})`.
- Active session: list of entry cards in order, grouped visually when `superset_group` shared (bracket border + "SUPERSET" chip).
- **Add exercise**: bottom sheet with search input (`q`), muscle chips filter, list shows name + muscle chips + equipment; tapping adds `{exercise_id, exercise_name, sets: prefillFromHistory}`. Prefill: `exercisesApi.history(id, 1)` -> last session's working sets copied as editable rows; if none, one empty row `{weight: 0, reps: 0}`. ALSO show "last time" line under exercise name: "80kg 5/5/4, 3d ago" computed from history.
- **Set rows**: weight + reps numeric steppers (long-press friendly +/- buttons, direct input), RPE optional small input, warmup toggle (dims row), add-set button duplicates last row, swipe/delete icon removes.
- **Autosave**: every mutation debounced 800ms -> `workoutsApi.update(id, {entries})`; "Saved" tick indicator; on failure red toast "Autosave failed, retrying" and retry once.
- **Superset**: multi-select mode via long-press or "Group" button -> assigns shared `superset_group` (uuid) to selected entries; ungroup clears it.
- **Alternatives**: per-entry menu "Swap exercise" -> `exercisesApi.alternatives(id)` sheet ranked list; swapping replaces exercise_id/name, keeps sets.
- **Finish**: confirm dialog -> `workoutsApi.finish(id)` -> summary modal: duration, total volume, PR list ("New PR: Bench 90kg, previous 85kg") -> navigate Home. Invalidate summary/list queries surgically (setQueryData for workouts list, invalidate dashboard summary).

Vitest for pure helpers in `src/lib/workoutHelpers.ts`: `formatLastTime(sets, date)` and `nextSupersetGroup(entries)` with tests.

Commit: "feat: workout session screen with prefill, supersets, alternatives, autosave".

---

### Task 5: History tab

`src/pages/History.tsx`:
- `useInfiniteQuery` over `workoutsApi.list({limit: 20, offset})`, `getNextPageParam` from accumulated count vs `total`; IntersectionObserver sentinel; header shows "N workouts" (real total).
- Toggle list/calendar: calendar = month grid heat (filled cell per workout date), prev/next month, future disabled (uses toLocalISODate for max).
- Row: date, exercise names line, volume; tap -> `/history/:id` detail page rendering entries/sets read-only (supersets bracketed) + delete button (confirm; surgical cache removal via setQueryData filtering the id, per lessons doc; toast undo NOT required).

Commit: "feat: history tab with infinite list, calendar heat, detail".

---

### Task 6: Coach tab

`src/pages/Coach.tsx` (+ `Conversation.tsx`):
- List: conversations with title, relative updated time, cost chip `$0.0172`; "New chat" button. Empty state: "Ask your coach anything about your training."
- Thread `/coach/:id?`: messages keyed by **turn id** (NEVER array index). Sending: `chatApi.start(message, convId?)` -> append user turn + pending assistant turn (ids from response) -> `openTurnStream(conv, assistantTurnId, 0, handlers)`; text events append to that turn's buffer; tool_call events render as small status line "Checking your training data..."; done -> refetch conversation (gets final content + tokens/cost) and update cost chip; error event or onError -> red inline "Generation failed. Tap to retry." with retry re-calling start.
- **Cost/usage bubble**: under each completed assistant turn, muted chip: `849 in / 26 out tokens, $0.0050`. Conversation header shows running `total_cost_usd`.
- Suggested starters when empty thread: 3 static strings ("How is my bench progressing?", "What should I train today?", "Where am I slacking?") - static is fine, no fake data implied.
- Reconnect on tab visibilitychange: if a turn is pending and stream closed, re-open with `from_seq = lastSeq`.

Commit: "feat: coach chat with streaming, reconnect, per-turn cost chips".

---

### Task 7: PWA

- `frontend/public/manifest.json`: name "Fitness Tracker", short_name "Fitness", start_url "/", display standalone, theme_color "#3b82f6", background_color "#ffffff", icons 192/512 + maskable.
- Icon generation script `frontend/scripts/generate-icons.mjs` using sharp: solid #3b82f6 background, white dumbbell glyph (simple SVG drawn inline), outputs pwa-192x192.png, pwa-512x512.png, apple-touch-icon.png (180).
- `frontend/public/sw.js`: cache-first for built assets (cache name versioned at build via query param), network-only for `/api/` and the API host; on activate, claim + delete old caches; **update flow**: when a new SW is waiting, the app shows a banner "New version available. Reload?" (prompt mode per lessons doc - no silent autoUpdate). Register in main.tsx on window load.
- `index.html` meta: viewport-fit=cover, manifest link, theme-color, apple-mobile-web-app-capable/status-bar-style black-translucent/title, apple-touch-icon. Safe-area classes already on header/nav (Task 2).

Commit: "feat: manual PWA with prompt-mode update banner and solid-background icons".

---

### Task 8: Terraform Firebase Hosting + CI frontend deploy

`terraform/main/firebase_hosting.tf` (google-beta; expense-tracker pattern):
```hcl
resource "google_firebase_hosting_site" "ui" {
  provider = google-beta
  project  = var.project_id
  site_id  = "fitness-tracker-ui"
}

resource "google_firebase_hosting_custom_domain" "ui" {
  provider              = google-beta
  project               = var.project_id
  site_id               = google_firebase_hosting_site.ui.site_id
  custom_domain         = var.ui_domain
  wait_dns_verification = false
}

resource "google_project_iam_member" "ci_firebase_hosting_admin" {
  project = var.project_id
  role    = "roles/firebasehosting.admin"
  member  = "serviceAccount:tf-github@${var.project_id}.iam.gserviceaccount.com"
}
```

`terraform/main/dns.tf` append (records come from the custom domain resource's required updates; per expense-tracker the practical records are A/AAAA or CNAME per Firebase console - add CNAME first, fix from `required_dns_updates` output if cert stalls):
```hcl
resource "cloudflare_record" "ui" {
  zone_id = var.cloudflare_zone_id
  name    = "ui.fitness-tracker"
  type    = "CNAME"
  content = "fitness-tracker-ui.web.app"
  proxied = false
}
```

`frontend/firebase.json` + `.firebaserc`:
```json
{ "hosting": { "site": "fitness-tracker-ui", "public": "dist", "ignore": ["firebase.json"], "rewrites": [{ "source": "**", "destination": "/index.html" }] } }
```
```json
{ "projects": { "default": "personal-projects-473219" } }
```

`.github/workflows/ci-cd.yml` additions:
- `test-frontend` job (parallel with test-backend): npm ci at root (workspaces), `npx tsc --noEmit -p packages/shared-types`, `npm run -w frontend test -- --run`, `npm run -w frontend build` (lint failures FAIL the job - no `|| true`).
- `deploy-frontend` job: needs [deploy-backend, test-frontend], `id-token: write`, WIF auth block, npm ci + build with `VITE_API_URL=https://api.fitness-tracker.blueelephants.org`, `npx firebase-tools deploy --only hosting:fitness-tracker-ui --project personal-projects-473219` (ADC via exported env). No CDN invalidation needed (Firebase Hosting purges on deploy).

Validate + commit: "feat: firebase hosting infra and frontend CI deploy".

---

### Task 9: Manual steps + live verification (controller)

- [ ] OAuth origins: add `https://ui.fitness-tracker.blueelephants.org` to the OAuth client's Authorized JavaScript origins (GCP console, Credentials - console-only, no API). `http://localhost:5173` already present.
- [ ] Push, CI green end to end (backend + frontend deploys).
- [ ] If hosting custom domain cert pends on DNS: check `terraform output` / Firebase console `required_dns_updates`, adjust cloudflare_record.ui accordingly.
- [ ] Browser verification (the real golden path): open the deployed URL (use `https://fitness-tracker-ui.web.app` until the custom domain cert lands), sign in with Google (allowlisted account), then: start workout, add Barbell Bench Press (verify "last time" empty state honest), log 2 sets, group a superset with Triceps Pushdown, swap one exercise via alternatives, finish (volume shown), see Home week strip update, ask Coach "what did I just train?" and watch it stream with a cost chip. Verify PWA installability (manifest + SW in devtools).
- [ ] Tag `plan-4-complete`.

---

## Self-review notes

- Spec coverage: shared-types package replaces manual mirror (lessons #2); 4 tabs + settings sheet per revised nav; dotted theme binding; chat keyed by turnId with reconnect on web (lessons #4); 45s axios timeout (lessons); prompt-mode SW (lessons #12); honest empty states (global rule); cost bubbles + conversation cost + monthly usage (spec); PWA icons solid background (global PWA rules); CI no lint-skip (lessons #8).
- Deliberately deferred: kg/lb conversion logic (display-only toggle now), Playwright E2E (Plan 6), custom domain cert flakiness handled with web.app fallback.
- Component-level JSX is spec'd, not verbatim, by design: integration-critical code (types, api, stream, store, theme, infra) IS verbatim; screens follow the binding theme + behavior specs above.
