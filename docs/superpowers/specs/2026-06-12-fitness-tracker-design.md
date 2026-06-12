# Fitness Tracker - Design Spec

- **Status:** approved (brainstorm 2026-06-12)
- **Owner:** Dhishan (single-user app, iamdhishan@gmail.com)
- **Reference architecture:** `/Users/dhishan/Projects/family-expense-tracker`

## Purpose

Personal fitness tracker. Daily drivers: strength workout logging and (later) nutrition. Built in vertical phases, web and mobile shipped together each phase. Includes an AI coach chat from day one and a remote MCP server (Phase 2) so workout data is usable from chat apps.

## Phases

| Phase | Scope |
|---|---|
| 1 | Strength logging (freeform, supersets, alternatives, history prefill), Home dashboard (progress charts, weekly frequency, muscle split, streaks, PRs), Coach chat (durable SSE), full infra + CI + E2E. Web PWA + Expo mobile. |
| 2 | Remote MCP (FastMCP sub-app at `/mcp`, streamable HTTP) exposing workout data and logging tools to claude.ai / Claude Desktop / Claude Code. Cost-saving model router (cheap classifier routes simple queries to a cheaper model). |
| 3 | Nutrition: AI photo/text food estimation (Haiku), quick-add favorites. Later in phase: food database search. AI-suggested calorie/macro targets, user approves. |
| 4 | HealthKit sync (native Expo module), cardio tracking, body metrics, barcode scanning. |

Out of scope until needed: multi-user, social features, offline sync, admin layer, RAG.

## Architecture

- **Backend:** FastAPI on Cloud Run, service `fitness-tracker-backend`, project `personal-projects-473219`, region `us-central1`. Domain `api.fitness-tracker.blueelephants.org` (Cloud Run domain mapping, created manually once then terraform-imported).
- **Web:** React + Vite + TypeScript + Tailwind + React Query + Zustand. PWA (manual setup, no vite-plugin-pwa). Firebase Hosting at `ui.fitness-tracker.blueelephants.org`.
- **Mobile:** Expo SDK 53, bundle id `org.blueelephants.fitnesstracker`, scheme `fitness://`. Types manually mirrored from `frontend/src/types/index.ts` to `mobile/src/types/index.ts`.
- **Data:** Firestore named DB `fitness-tracker-dev` (never `(default)`).
- **Auth:** Google sign-in -> backend JWT. Allowlist: owner's email only.
- **AI:** OpenAI GPT-5.5+ as the coach model, called through **LiteLLM** so the provider/model can be swapped via config without code changes. System prompt instructs brief responses unless asked for a deep dive. Langfuse tracing via `langfuse.langchain` (v3 import).
- **Usage metering (Phase 1, observational):** mirror expense-tracker's `usage_service.py`: every LLM call writes a `usage_events` doc (user_id, source, model, input/output/cache tokens, cost_usd via `litellm.cost_per_token()`, duration_ms); monthly atomic counters in `user_usage_summaries/{uid}/months/{YYYY-MM}`; per-conversation token/cost totals on the conversation doc. No hard limits.
- **Model routing (Phase 2):** cheap-classifier router (small model classifies the request; simple lookups answered by a cheaper model, only complex coaching goes to GPT-5.5). Reference: expense-tracker's Haiku topic-classifier pattern in `chat.py`.

## Data model (Phase 1)

All docs denormalize `user_id`. Dates: `YYYY-MM-DD` local-date string (`toLocalISODate`) for "which day it counts toward" plus UTC timestamps for ordering. Dashboard endpoints accept `reference_date` from clients.

```
users/{uid}
  email, display_name, created_at
  preferred_units: "kg" | "lb"

exercises/{id}
  user_id                  # "system" for seeded catalog
  name
  primary_muscles: [str]   # e.g. ["chest","triceps"]
  secondary_muscles: [str]
  movement_pattern: push | pull | squat | hinge | carry | core
  equipment: barbell | dumbbell | machine | cable | bodyweight | other
  is_custom: bool

workouts/{id}
  user_id
  date                     # local date string
  started_at, ended_at     # UTC; ended_at null while in progress
  notes
  exercise_ids: [str]      # flat array for array_contains queries
  entries: [               # embedded, ordered
    { exercise_id, exercise_name,        # name denormalized
      superset_group: str | null,        # shared id = superset
      sets: [ { weight, reps, rpe?, is_warmup? } ] }
  ]
  total_volume             # computed on finish: sum(weight*reps) working sets

chat_conversations/{conv_id}            # durable chat pattern
  user_id, title, created_at, updated_at
  turns/{turn_id}: user_id, role, seq, content, status
```

Decisions:
- Sets embedded in the workout doc (atomic saves, read as a unit, well under 1MB). `exercise_ids` flat array exists because Firestore cannot query inside arrays of maps.
- Exercise history = `workouts where user_id == X and exercise_ids array_contains Y order by date desc limit 3`, sets extracted client-side.
- Alternatives = catalog query: same `movement_pattern` + overlapping `primary_muscles`, ranked by overlap. No AI; works in the gym.
- PRs/streaks computed on read by dashboard endpoints. No materialized aggregates yet.
- In-progress workout = doc with `ended_at: null`; app resumes on reopen.

Composite indexes (declared in Terraform from day one):
- `workouts (user_id ASC, date DESC)`
- `workouts (user_id ASC, exercise_ids array_contains, date DESC)`
- `chat_conversations (user_id ASC, updated_at DESC)`

No silent `except: return []` around Firestore queries - missing-index errors must surface.

## API (Phase 1, /api/v1, JWT bearer)

```
POST /auth/google                       Google ID token -> backend JWT

GET  /exercises                         ?muscle=&pattern=&q=
POST /exercises                         create custom
GET  /exercises/{id}/alternatives
GET  /exercises/{id}/history            last N workouts' sets

POST   /workouts                        start session or log after the fact
GET    /workouts                        ?from=&to=  paginated, returns total
GET    /workouts/active                 resume in-progress (ended_at null)
GET    /workouts/{id}
PUT    /workouts/{id}                   autosave entries/sets during session
POST   /workouts/{id}/finish            sets ended_at, computes total_volume
DELETE /workouts/{id}

GET  /dashboard/summary                 ?week=&reference_date=
GET  /dashboard/exercise/{id}           top-set weight + volume series
GET  /dashboard/muscle-split            ?weeks=N

POST /chat/start                        spawn generation, return ids
GET  /chat/conversations                history list incl. per-conversation cost
GET  /chat/conversations/{c}            turns incl. per-turn token/cost
GET  /chat/conversations/{c}/turns/{t}/stream?from_seq=N   resumable SSE
GET  /usage/summary                     ?month=YYYY-MM  monthly tokens + cost
```

Chat transport (proven pattern from expense-tracker `chat.py` lines ~2290-2403, `chat_store.py`, `mobile/src/services/api.ts`):
- Every delta/tool event persisted to the turn doc with a `seq` counter; MAX_EVENTS=800 per turn (1MB doc limit)
- Stream endpoint polls Firestore every 200ms and emits SSE events; 10s keepalive comments; 30-min generation ceiling
- Mobile uses `react-native-sse` polyfill (RN has no native EventSource); re-opens with `from_seq` on AppState foreground; up to 3 auto-reconnects with exponential backoff (500ms * 2^attempt)
- Generation runs as a background task on Cloud Run (`min_instances=1`, cpu-throttling off)
- Coach has tool access to workout/dashboard service functions for data-grounded answers; every model call goes through LiteLLM and logs a usage event

Client autosaves via `PUT /workouts/{id}` after every set entry.

Phase 2: MCP via **FastMCP sub-app mounted at `/mcp`** on the same FastAPI instance (streamable HTTP, session manager in app lifespan - pattern: expense-tracker `backend/app/mcp_server.py` + `main.py`), exposed publicly on its **own subdomain `mcp.fitness-tracker.blueelephants.org`** (dedicated Cloud Run domain mapping to the same service; Cloudflare DNS record `proxied = true` so Cloudflare Access injects its JWT; the plain API CNAME stays unproxied). Domain mapping created manually once, then terraform-imported. Always authenticated - no anonymous access: auth middleware resolves the user in priority order: Cloudflare Access JWT (`Cf-Access-Jwt-Assertion`, RS256 hard-pinned, key-rotation retry) -> app-issued bearer JWT -> dev-only `X-Mcp-User-Id` (ENVIRONMENT=development only); resolved user stashed in a ContextVar; requests with no valid identity are rejected. Tools wrap existing service functions: `log_workout`, `get_workouts`, `get_exercise_progress`, `get_alternatives`, `get_dashboard_summary`. Phase 2 also adds the model-routing layer (see Architecture).

## Screens (web PWA and Expo, same nav)

Bottom tabs:
1. **Home** - Start/Resume workout button; this-week strip (7 dots) + streak; last workout card; progress sections below: per-exercise charts (top-set weight + volume), weekly muscle-group volume split, PR list. Profile avatar top-right -> settings sheet (units, sign out).
2. **Workout** - active session. Exercise picker (search, muscle chips, recent-first). Each exercise card: weight x reps rows with steppers, prefilled from last session, one tap confirms a repeated set; "last time" line under the name. Select 2+ exercises -> "Group as superset" (bracketed, alternating set order). Alternatives button per exercise -> ranked swap-in list. Finish -> summary (duration, volume, PRs hit).
3. **History** - infinite-scroll list with real total (surgical cache updates on mutation, not invalidation); tap -> session detail; calendar heat toggle.
4. **Coach** - chat history: conversation/session list (titles, last-updated, per-conversation cost) with resume; thread view with streaming responses, grounded in user data. **Cost/usage bubble**: each assistant turn shows a small token+cost chip (from the turn's usage event); conversation header shows running conversation cost; settings sheet links to a monthly usage summary (from `user_usage_summaries`).

Empty states are honest ("No workouts yet. Start your first session."). No fake data anywhere. PWA: safe-area insets on sticky header and bottom nav; solid-background icons (192/512/180).

### Visual theme

Modern, light. Base conventions reused from expense-tracker (`frontend/tailwind.config.js`, `src/index.css`): Inter font, white cards `rounded-xl shadow-sm`, primary blue scale (#3b82f6 family), gray-200 borders, Chart.js for charts, react-hot-toast (dark toast). New for this app: **white page background with a subtle dotted pattern**:

```css
body {
  background-color: #ffffff;
  background-image: radial-gradient(circle, #d4d4d8 1px, transparent 1px);
  background-size: 20px 20px;
}
```

Cards sit on the dotted field as solid white surfaces. Muscle-group chips get a per-group accent palette (analogous to expense-tracker's category colors).

## Infra / CI / Testing (Phase 1)

**Terraform** (state `fitness-tracker/prod/state` in `dhishan-terraform-assets`):
- Cloud Run with `run.googleapis.com/cpu-throttling = "false"` and `min_instance_count = 1` (chat background generation requires it)
- Artifact Registry `fitness-tracker-backend`, Firestore DB + composite indexes, Firebase Hosting, google-beta provider for Firebase resources
- Day-one: add repo to WIF pool binding

**GitHub Actions:**
- `ci-cd.yml`: pytest + frontend typecheck/build -> terraform -> docker deploy -> frontend deploy -> CDN cache invalidation. `id-token: write` on every GCP-authed job.
- `e2e.yml`: triggers after ci-cd; local uvicorn backend with ephemeral `JWT_SECRET_KEY=ci-e2e-ephemeral-${{ github.run_id }}`; frontend built with `VITE_API_URL=http://localhost:8000`, served on :4173; Playwright `BASE_URL=http://localhost:4173`. Dump backend/frontend logs on failure. Artifact path `playwright/test-results/`.
- `infra-deploy.yml`: manual terraform.

**Testing:**
- Backend: pytest for services (volume calc, alternatives ranking, streak/PR logic), API tests against Firestore emulator, resumable-SSE test (`from_seq`).
- E2E: dedicated test Google account (`GOOGLE_TEST_REFRESH_TOKEN` secret), global-setup exchanges token -> wipes data; http/https `clientFor(url)` helper in all four Playwright infra files from the start; `waitForResponse` for saves; `networkidle` after navigation; `retries: process.env.CI ? 1 : 0`.

**Error handling:** side-effect work isolated in try/except so failures never become CORS-less 500s. CORS allow_origins includes localhost:5173 and the prod UI domain from day one.

## Lessons applied from expense-tracker code analysis

Full analysis: `docs/superpowers/research/2026-06-12-expense-tracker-code-analysis.md`. Binding decisions for this app:

- Chat backend split from day one: `app/chat/tools/definitions.py`, `app/chat/tools/executor.py` (registry, not elif), `app/chat/generation.py`, thin `app/routers/chat.py`.
- **Shared types workspace package** (`packages/shared-types`) imported by web and mobile - replaces the manual mirror convention (which demonstrably drifted in the sibling repo).
- Usage recorded once per logical turn (accumulated across agentic sub-turns, written in finally block) - the sibling double-counts.
- SSE reconnect with backoff on BOTH web and mobile; streamed messages keyed by server-assigned turn id, never array index.
- All Firestore calls in async paths via `asyncio.to_thread`, including the auth dependency.
- All CORS origins from Settings, none hardcoded.
- E2E setup uses `API_URL` consistently (no hardcoded prod host) and Playwright's `request` fixture instead of raw node http/https.
- Lint failures fail CI (no `|| true`); no timer-coupled `waitForTimeout` assertions.
- Expo `runtimeVersion.policy: nativeBuildVersion`; PWA service worker `prompt` mode with reload banner.
- Babel `api.cache.forever()` outside tests; pin NativeWind-related versions.
- Terraform: exact provider pins; firestore indexes split per feature file; `roles/firebasehosting.admin` granted explicitly; domain mappings manual-create + import.

## Open questions

- (Phase 2) MCP token issuance UX: settings screen generates/revokes tokens, or a CLI script? Decide at Phase 2 planning.
- (Phase 3) Food DB source (USDA vs OpenFoodFacts). Decide at Phase 3 planning.
- (Phase 4) HealthKit sync direction (read-only import vs write-back). Decide at Phase 4 planning.
