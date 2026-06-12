# Fitness Tracker - Codebase Guide (Bootstrap)

This file captures hard-won lessons from the sibling project `family-expense-tracker` so we don't re-discover the same gotchas. Read it before any non-trivial work.

> Sibling repo (reference architecture): `/Users/dhishan/Projects/family-expense-tracker`

## Intended structure

```
fitness-tracker/
  backend/       FastAPI on Cloud Run
  frontend/      React + Vite + TypeScript + Tailwind + React Query + Zustand
  mobile/        Expo SDK 53 React Native (shared FastAPI backend)
  terraform/     GCP infrastructure (mirror of expense-tracker pattern)
  .github/workflows/  CI/CD with WIF auth + E2E job
  Makefile       Every dev/deploy/test command runs from here
```

Mirror the expense-tracker file layout exactly. Same naming. Same patterns. Resist the urge to redesign.

---

## Project-specific GCP names

- **GCP project (shared):** `personal-projects-473219`
- **Cloud Run service:** `fitness-tracker-backend`
- **Artifact Registry repo:** `fitness-tracker-backend`
- **Firestore named DB:** `fitness-tracker-dev` (NOT `(default)`)
- **Frontend domain:** `ui.fitness-tracker.blueelephants.org` (Firebase Hosting)
- **Backend domain:** `api.fitness-tracker.blueelephants.org` (Cloud Run domain mapping)
- **Terraform state prefix:** `fitness-tracker/prod/state` in `dhishan-terraform-assets`
- **Mobile bundle id:** `org.blueelephants.fitnesstracker`
- **Mobile scheme (deep links):** `fitness://`

Add the GitHub repo to the WIF pool on day one:
```bash
gcloud iam service-accounts add-iam-policy-binding \
  tf-github@personal-projects-473219.iam.gserviceaccount.com \
  --member="principalSet://iam.googleapis.com/projects/610355955735/locations/global/workloadIdentityPools/github-pool/attribute.repository/dhishan/fitness-tracker" \
  --role="roles/iam.workloadIdentityUser"
```

---

## CI / GitHub Actions

### Always set `id-token: write` on every GCP-authed job

Easy to forget. Without it the `google-github-actions/auth@v3` step errors with `did not inject $ACTIONS_ID_TOKEN_REQUEST_TOKEN`. The deploy jobs have it; new jobs (E2E, schedule, manual) need it too.

```yaml
jobs:
  e2e:
    permissions:
      contents: read
      id-token: write    # required for WIF
```

### E2E job pattern: local backend, not deployed backend

Do NOT run E2E against the deployed prod backend. Reasons:
1. If you ever flip an env (Plaid sandbox -> production, etc), every prior E2E breaks.
2. Test data pollutes prod Firestore.

Pattern:
- Build frontend with `VITE_API_URL=http://localhost:8000`
- Boot a sandbox-config FastAPI locally (uvicorn, port 8000)
- Serve frontend with `npx serve dist -p 4173`
- Playwright runs with `BASE_URL=http://localhost:4173` + `API_URL=http://localhost:8000/api/v1`
- Backend reads/writes the same Firestore DB (test family already there)
- Use an **ephemeral `JWT_SECRET_KEY`** scoped to the run: `ci-e2e-ephemeral-${{ github.run_id }}`. Never leak prod's JWT secret.
- Dump backend.log + frontend.log on failure for fast debugging.

### Keep two sets of sensitive secrets from day one

For any third-party with sandbox+prod modes (Plaid, payment, etc.):
- `<SERVICE>_CLIENT_ID` (same across envs usually)
- `<SERVICE>_SECRET` (production - used in Cloud Run)
- `<SERVICE>_SECRET_SANDBOX` (sandbox - used in E2E)

The first time the deployed backend is switched to production, the E2E suite WILL silently break against the prod backend. The fix is straight from the playbook.

### Playwright global-setup / global-teardown / spec helpers — http vs https

If you copy the expense-tracker `tests/global-setup.ts`, `auth.setup.ts`, `global-teardown.ts`, `<feature>.spec.ts` files, they ALL hard-code `https.request`. That breaks the moment `API_URL=http://localhost:8000`.

**Fix it up front, in all four files,** with a helper:
```ts
import * as https from 'https'
import * as http from 'http'

function clientFor(u: URL) {
  return u.protocol === 'http:' ? http : https
}

// And always pass the port through:
const req = clientFor(u).request({
  hostname: u.hostname,
  port: u.port || undefined,    // critical for :8000
  path: u.pathname + u.search,
  // ...
})
```

Symptom if you forget: empty `AggregateError` in <1s, no useful message.

---

## Backend (FastAPI)

### Unhandled exceptions kill CORS

A 500 with no CORS headers reads to the browser as a CORS error, not a 500. Confusing to debug.

**Isolate every side-effect inside its own try/except** so failures don't bubble:
```python
result = await main_operation()      # let this raise

try:
    await send_notification(result)  # never let this crash the response
except Exception:
    logger.exception("notification failed")

return result
```

### Background tasks need Cloud Run config

If you do `asyncio.create_task(...)` and return the HTTP response, Cloud Run will tear down the container before the task finishes (CPU is throttled outside requests).

Set in terraform:
```hcl
annotations = {
  "run.googleapis.com/cpu-throttling" = "false"
}
template {
  scaling { min_instance_count = 1 }
}
```

### Adaptive LLM routing

Default to Haiku 4.5 (`claude-haiku-4-5`) for cheap classification / generation. Use Sonnet 4.6 (`claude-sonnet-4-6`) for the chat by default; reserve Opus 4.7 (`claude-opus-4-7`) for explicitly-requested deep analysis.

System prompt MUST say "respond briefly unless asked for a deep dive" or the chat verbosity will be a problem from day one.

### Durable conversations are worth it from day one

Don't start with ephemeral SSE chat and migrate later. Build it durable:
- Firestore-backed conversations under `/chat_conversations/{conv_id}/turns/{turn_id}`
- Denormalize `user_id` on every doc for safe cross-user reads (-> 404 not 403)
- `POST /chat/start` -> spawn generation, return ids
- `GET /chat/conversations/{c}/turns/{t}/stream?from_seq=N` resumable SSE
- 10s keepalive comments so iOS / LB don't drop the SSE during model thinking
- Mobile re-opens SSE on AppState foreground with last-seen `seq`

This pattern handles iOS backgrounding, lost connections, and re-opens cleanly. Adding it later is 3x the work.

### Date / timezone hygiene

Backend uses UTC by default. Frontend defaults to local time. When the user logs a workout at 8pm EDT, that's midnight UTC -- it can land in the wrong day's totals.

Standard fix:
- Backend accepts an explicit `reference_date` (or `local_date`) from clients
- Or all timestamps stay UTC, and the frontend translates only for display

E2E tests near UTC midnight will break otherwise.

### Date formatter (use everywhere, not toISOString)

Never use `new Date().toISOString().split('T')[0]`. Users east of UTC get yesterday's date for most of the morning.

```ts
export function toLocalISODate(d: Date = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
```

Apply to: log dates, `max` attributes on date pickers, date strip rendering, navigation targets, ALL date-to-string conversions.

---

## Firestore

### Add composite indexes from day one

Any query with `(equality on A) + (range/sort on B)` needs a composite index. Missing index = `FailedPrecondition` exception.

**Worst-case gotcha:** if your service code wraps queries in `try/except: return []`, a missing index silently returns zero rows and is nearly impossible to diagnose.

For a fitness tracker, expect to need from day one:
```hcl
# workouts filtered by user + date range
fields: user_id (ASC), date (DESC)

# workouts filtered by user + workout_type + date
fields: user_id (ASC), workout_type (ASC), date (DESC)

# sessions by user + date for streak / calendar
fields: user_id (ASC), date (ASC)
```

When you query by `status="pending"` + sort by `date`, you need the composite `(status ASC, date DESC)`. Easy to forget.

### Named DB everywhere

```python
db = firestore.Client(project="personal-projects-473219",
                     database="fitness-tracker-dev")  # not (default)
```

Same in every script. Wipe scripts that forget the `database=` arg will silently target `(default)` and report nothing to delete.

### Cascade delete + stale FK guard

When deleting a parent doc (e.g., a workout plan), explicitly delete sub-docs (exercises, sets) in a batch. If the parent goes and children remain, future reads return broken references.

When you store a foreign key (e.g., `last_workout_id` on user), verify the referenced doc exists before using it. Test setup often hits stale FKs.

---

## Mobile (Expo)

### Reanimated needs the babel plugin

`babel.config.js` MUST end with `'react-native-reanimated/plugin'`:
```js
module.exports = {
  presets: [['babel-preset-expo']],
  plugins: [
    // ... other plugins
    'react-native-reanimated/plugin',  // MUST be last
  ],
}
```

Without it, Debug builds may run but Release builds will SIGSEGV in Hermes during the first event loop tick. Painful to diagnose without this note.

### EAS OTA + native build separation

- **JS-only change** (TS, React, styles) -> `make mobile-update` (EAS Update OTA, phones get it on next open)
- **Native dep change** (Reanimated, Plaid SDK, etc.) -> `make mobile-run-phone` (native rebuild, USB)

Always lean OTA-first. Only do native rebuild when adding/upgrading native modules.

### make mobile-run-phone (copy from expense-tracker)

```makefile
mobile-run-phone: ## Build + install Release on connected iPhone (set DEVICE_NAME=<substring> or DEVICE=<udid>)
	@DEVICE_UDID=$${DEVICE:-$$(xcrun xctrace list devices 2>&1 | grep -i "$${DEVICE_NAME:-iPhone}" | grep -v Simulator | head -1 | sed -E 's/.*\(([0-9A-F-]{20,})\).*/\1/')}; \
	if [ -z "$$DEVICE_UDID" ]; then echo "No matching connected iPhone found"; exit 1; fi; \
	cd mobile && npx expo run:ios --device "$$DEVICE_UDID" --configuration Release
```

The `xctrace list devices` UDID is different from `devicectl list devices` UDID. Use xctrace. Curly apostrophes in device names like `Dhishan's iPhone` break direct name matching - that's why we resolve to UDID.

### iOS Safe Area when using PWA-style configs

`viewport-fit=cover` + `apple-mobile-web-app-status-bar-style=black-translucent` cause content to render under the iOS notch. Add safe-area insets:

```css
.safe-top    { padding-top: env(safe-area-inset-top); }
.safe-bottom { padding-bottom: env(safe-area-inset-bottom); }
```

Apply to every sticky header and fixed bottom nav.

### Sim launch but locked phone

`expo run:ios --device <iPhone>` succeeds at build + install, then fails at "launch" if the phone is locked. The app IS installed -- unlock and tap the icon. Don't re-build.

### Type sharing convention

`mobile/src/types/index.ts` is a manual mirror of `frontend/src/types/index.ts`. Update both when types change. No codegen, no symlinks, no cross-workspace imports.

---

## React Query patterns we actually use

### Surgical cache update on mutations, not full invalidation

`useInfiniteQuery` invalidation refetches EVERY loaded page sequentially. With 4 pages of 50 items loaded that's 4 serial round-trips just to refresh after one mutation.

Use `queryClient.setQueryData` to remove / update the affected row:
```ts
const removeFromCache = (id: string) => {
  queryClient.setQueryData(
    ['list-key'],
    (old: { pages: { items: T[]; total: number }[]; pageParams: number[] } | undefined) => {
      if (!old) return old
      return {
        ...old,
        pages: old.pages.map((p) => ({
          ...p,
          items: p.items.filter((t) => t.id !== id),
          total: Math.max(0, p.total - 1),
        })),
      }
    }
  )
}
```

For approve / discard / archive flows this is night-and-day vs invalidation.

### Infinite scroll + real total

Always return `total` from the backend list endpoint. UI shows "247 items" not "showing first 50". `useInfiniteQuery` with `getNextPageParam` and an IntersectionObserver sentinel is the standard pattern.

---

## Auth / test isolation

### Dedicated test Google account

Never E2E against your real account. Create one (e.g., `testuser+fitness@blueelephants.org`), get a refresh token (script in `tests/get-refresh-token.mjs`), store as GH secret `GOOGLE_TEST_REFRESH_TOKEN`.

`global-setup.ts` exchanges refresh-token -> Google ID token -> backend JWT, creates/reuses a test profile / workspace, wipes data. `global-teardown.ts` cleans up.

If the app has an allowlist, the test account needs to be on it.

### `waitForLoadState('networkidle')` after navigation

React Query refetches on mount. Without `networkidle`, assertions on freshly-calculated data flake in CI.

### `waitForResponse` over banner timeouts

```ts
await Promise.all([
  page.waitForResponse((r) => r.url().includes('/api/save') && r.request().method() === 'POST'),
  page.getByRole('button', { name: 'Save' }).click(),
])
```

Banner-based waits flake under CI network jitter.

### `retries: process.env.CI ? 1 : 0` in playwright.config.ts

Handles one-off flake in CI without masking real failures locally.

---

## CORS for new domains

When adding a new frontend (web prod URL, staging, alt domain), the prod backend's `CORSMiddleware.allow_origins` list is the gate. Production URLs are NOT auto-allowed.

```python
allow_origins=[
    "http://localhost:5173",
    "https://ui.fitness-tracker.blueelephants.org",
]
```

Forget this and "the app is broken in prod" 10 minutes after the deploy lands.

---

## OAuth-style integrations (if applicable)

If integrating any provider with OAuth redirect URIs (Stripe, Plaid, Strava, Fitbit, etc.):

1. The redirect URI in the provider's dashboard CANNOT include a query string. Two URIs needed if you support web and mobile differently:
   - Web: `https://ui.fitness-tracker.blueelephants.org/<provider>-oauth-return`
   - Mobile: backend relay URL that 302's to `fitness://oauth-return`

2. After adding a URI to the dashboard, you MUST click "Save changes". The button often stays clickable even when no changes are pending - easy to miss the save.

3. For providers with OAuth bank/account allowlists (compliance review needed): check the Compliance / Production Access section first. Sandbox bypasses this, prod doesn't.

---

## LLM tracing (Langfuse)

If using Langfuse for chat tracing:
- v3+ import: `from langfuse.langchain import CallbackHandler` (NOT `langfuse.callback`)
- v3 constructor takes no args; session_id and tags go in config metadata, not constructor:
  ```python
  handler = CallbackHandler()
  config = {
    "callbacks": [handler],
    "metadata": {
      "langfuse_session_id": session_id,
      "langfuse_tags": ["fitness-chat"],
    }
  }
  ```
- This has tripped up two projects already.

---

## Commit / git discipline

- **Never use `--no-verify` or `--no-gpg-sign` flags** unless the user explicitly asked. (Easy reflex to slip into; if signing isn't configured, just commit normally and git won't sign.)
- Create new commits, don't amend. If a pre-commit hook fails, the commit didn't happen -- fix the issue, re-stage, NEW commit.
- Use HEREDOCs for multi-line commit messages.
- Co-author trailer:
  ```
  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  ```
- Don't `git add -A` -- prefer specific paths so you don't accidentally include `.env`, `test-results/`, etc.

---

## Process / collaboration meta-lessons

### Test on sim or phone BEFORE pushing OTA / building to phone

The reanimated babel plugin issue was caught after 3 wasted Release builds. The "build to sim first" rule exists because of that. For JS-only changes, hot-reload on a running sim is the smoke test. For native changes, run on sim first.

### Make targets are the source of truth, not commands in chat

If a command is going to be run more than twice, add it to the Makefile. It saves future-you from re-deriving the device-UDID-via-xctrace incantation.

### TaskList / agent teams for parallel work, not single bg agents

When work spans backend + web + mobile + tests, spawn a team (`TeamCreate`) with named teammates. Single bg agents lose coordination.

### When in doubt about reversibility, ask

Pushing OTAs is reversible (one more push). Force-pushing main isn't. Always check before destructive ops.

---

## Out-of-scope checks (do NOT pre-build)

- Don't add admin/role/permission layer until needed
- Don't pre-build offline sync until you have a flaky-network user
- Don't add multi-tenancy abstractions for a personal app
- Don't add A/B testing framework before you have users
- Don't over-engineer chat with vector DB / RAG before you have a corpus

---

## Source for any of this

If anything here is unclear, the implementations are all in `/Users/dhishan/Projects/family-expense-tracker`:
- CI: `.github/workflows/ci-cd.yml`
- Backend chat: `backend/app/routers/chat.py`, `backend/app/services/chat_store.py`
- Plaid OAuth pattern: `backend/app/routers/plaid.py`
- Surgical cache update: search `removePendingFromCache` in `mobile/app/(tabs)/expenses.tsx`
- Playwright http/https helpers: `frontend/tests/global-setup.ts`
- `make mobile-run-phone`: top-level `Makefile`

Read the real file before re-inventing.
