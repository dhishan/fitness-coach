# Plan 5: Expo Mobile App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Checkbox steps.

**Goal:** Native iOS app (Expo SDK 53) with the full Phase 1 + 4.5 feature set: Google sign-in, Home (summary/plans/progress), Workout logging (prefill/supersets/alternatives/autosave), Library, History, Coach chat (resumable SSE) — running on the user's iPhone.

**Architecture decisions:**
- **expo-router** tabs (mirrors expense-tracker `app/(tabs)/` layout).
- **Plain StyleSheet + theme module** (NO NativeWind — the sibling repo needed a fragile `react-native-css-interop` patch; we avoid the class entirely). Theme constants mirror the web palette; dotted background via `react-native-svg` pattern or subtle dot image.
- **Types from `@fitness/shared-types`** workspace package (metro `watchFolders` monorepo config) — zero manual mirroring.
- **Auth:** `@react-native-google-signin/google-signin` requires dev build; instead use **expo-auth-session** Google flow -> Google ID token -> existing `POST /auth/google`. Requires an **iOS OAuth client** (bundle id `org.blueelephants.fitnesstracker`) and backend support for multiple audiences. Token stored in `expo-secure-store`.
- **Chat:** `react-native-sse` EventSource against the existing stream endpoint; `from_seq` resume on AppState foreground; backoff reconnect (mirror web behavior; transport differs).
- **Charts:** `react-native-chart-kit` (+ react-native-svg) for progress line chart; muscle split as plain styled bars (no chart lib needed).
- **No Reanimated** in Phase 1 mobile (avoid the babel-plugin/Release-SIGSEGV class entirely; standard Animated API suffices). If ever added: plugin LAST in babel.config.js.
- `runtimeVersion: {"policy": "nativeBuildVersion"}` (lessons #11). EAS Update for JS-only changes; native rebuild only for new native deps.

---

### Task 0: Manual (controller + user)

- [ ] User (console-only): create **iOS OAuth client** — Credentials -> Create credentials -> OAuth client ID -> type iOS, name `fitness-tracker-ios`, bundle id `org.blueelephants.fitnesstracker`. Paste the client id back.
- [ ] Controller: append the iOS client id to backend allowed audiences (Task 1 adds multi-audience support; set via tfvars var `google_oauth_client_ids`).

### Task 1: Backend — multiple OAuth audiences (TDD)

**Files:** modify `backend/app/config.py`, `backend/app/auth/google.py`; tests extend `backend/tests/test_auth.py`; modify `terraform/main/variables.tf`, `cloud_run.tf`, `workspaces/prod/terraform.tfvars`.

- Settings: replace single `google_oauth_client_id` with `google_oauth_client_ids: str = ""` (comma-separated; keep old field as fallback: `audiences_list` property = parsed new field or [old field] if set). Env `GOOGLE_OAUTH_CLIENT_IDS`.
- `verify_google_id_token`: verify signature without audience (`verify_oauth2_token(token, request)` raises on bad token), then check `idinfo["aud"] in s.audiences_list`; raise ValueError("audience not allowed") otherwise; still raise if audiences_list empty.
- Tests: aud in list passes; aud not in list -> 401 via router; empty config -> 401.
- Terraform: var `google_oauth_client_ids` (list or comma string), env `GOOGLE_OAUTH_CLIENT_IDS` on Cloud Run; tfvars gets web client id + iOS client id (added when user supplies it).
- Commit: "feat: accept multiple oauth audiences (web + ios)".

### Task 2: Expo scaffold

**Files:** `mobile/` via `npx create-expo-app@latest mobile --template tabs` (SDK 53 line), then prune.

- `mobile/package.json` joins root workspaces (add "mobile" to root workspaces array). Metro config for monorepo:
```js
// mobile/metro.config.js
const { getDefaultConfig } = require('expo/metro-config')
const path = require('path')
const config = getDefaultConfig(__dirname)
config.watchFolders = [path.resolve(__dirname, '..')]
config.resolver.nodeModulesPaths = [
  path.resolve(__dirname, 'node_modules'),
  path.resolve(__dirname, '../node_modules'),
]
module.exports = config
```
- Deps: axios, @tanstack/react-query, zustand, expo-secure-store, expo-auth-session, expo-web-browser, react-native-sse, react-native-svg, react-native-chart-kit, @fitness/shared-types (workspace ref).
- `app.json`: name Fitness Tracker, scheme `fitness`, ios.bundleIdentifier `org.blueelephants.fitnesstracker`, runtimeVersion policy nativeBuildVersion, icon from a copied solid-bg icon (reuse web icon source), `newArchEnabled` left default.
- `src/theme.ts`: colors (primary #3b82f6, muscle palette map, gray scale), spacing, radius (12), card style object (white bg, border #f3f4f6, shadow subtle). Screens get light dotted-feel background color `#fcfcfc` (skip literal dot pattern if fiddly — flag a TODO-free decision in code: plain bg).
- `src/services/api.ts`: same namespaces as web api.ts (import types from shared-types), axios `timeout: 45_000`, request interceptor reads token from zustand (hydrated from SecureStore), 401 response logout (excluding /auth/google). `API_URL` from `app.json` extra: `https://fitness-tracker-backend-ix5fldbdya-uc.a.run.app` (prod) / `http://localhost:8000` (dev via `__DEV__`).
- `src/store/auth.ts`: zustand + SecureStore persistence (async hydrate on boot; gate root layout on hydration).
- Login screen: expo-auth-session `Google.useIdTokenAuthRequest({ iosClientId, clientId: webClientId })` -> id_token -> authApi.google -> store. 403 -> "This app is invite-only."
- `app/(tabs)/_layout.tsx`: 5 tabs Home/Workout/Library/History/Coach, header with avatar -> settings sheet (modal route): email, units toggle, usage summary, sign out.
- Gate: `npx tsc --noEmit -p mobile` (expo template tsconfig) passes; `npx expo export --platform ios` bundles without error (CI-friendly check, no simulator needed).
- Commits: scaffold, then api/auth/shell.

### Task 3: Home + Plans screens

Port web behavior with native UI: Start/Resume button; week strip (7 dots); streak badge; last workout card; Your plans section (list + Start via shared `startFromPlan` logic — port `buildWorkoutEntries` into `mobile/src/lib/startFromPlan.ts` reusing the same tests adapted to mobile's test setup if test runner configured, else rely on shared logic being identical; acceptable to import the function from a new `packages/shared-logic` ONLY if trivial — otherwise copy with a header comment naming the web source file); plans editor screen (name, picker, target_sets stepper, superset grouping, save/delete); progress chart (react-native-chart-kit LineChart, exercise picker); muscle split bars. Honest empty states, ASCII. Commit per screen group.

### Task 4: Workout screen

Port the web Workout UX: active query, entry cards with superset brackets, AddExerciseSheet (modal: search, muscle chips, create custom form), set rows (steppers + TextInput numeric), warmup toggle, prefill from history + "last time" line, autosave debounce 800ms with Saved tick + retry toast, alternatives swap sheet, finish flow with PR summary modal, surgical cache update. Reuse pure helpers by copying `formatLastTime`/`nextSupersetGroup`/`buildEntryFromHistory` into `mobile/src/lib/` (same names; comment header "mirror of frontend/src/lib/..."). Commit: "feat(mobile): workout session screen".

### Task 5: Library + History screens

Library: list (search, muscle/pattern chips server-side, equipment/difficulty client-side, thumbnails via expo-image with colored-initial fallback, paginated FlatList) + detail (photo toggle, instructions, history, alternatives, add-to-workout CTA). History: FlatList infinite scroll (real total header), month calendar toggle, detail screen with delete (surgical cache removal). Commit per screen.

### Task 6: Coach screen

Conversation list (cost chips) + thread. `react-native-sse` EventSource wrapper `mobile/src/services/chatStream.ts` with the same handler interface as web; turn-id keyed messages; markdown rendering via `react-native-markdown-display`; tool_call status line; per-turn cost chip; reconnect: AppState 'active' listener + backoff, `from_seq=lastSeq`; error state with retry. Commit: "feat(mobile): coach chat with resumable SSE".

### Task 7: Build plumbing

- Root Makefile: `mobile-start` (expo start), `mobile-sim` (expo run:ios simulator), `mobile-run-phone` (xctrace UDID resolution recipe from CLAUDE.md), `mobile-update` (eas update --branch main) — copy patterns from family-expense-tracker Makefile.
- `eas.json`: development/preview/production profiles, production autoIncrement buildNumber.
- App icons: script reuse of web icon generator outputs into `mobile/assets/` (1024 icon, splash with solid bg).
- Commit: "feat(mobile): build targets, eas config, icons".

### Task 8: Device verification (sim FIRST, then phone — CLAUDE.md rule)

- [ ] `make mobile-sim`: app boots in simulator; sign in (expo-auth-session works in sim), log a workout end to end, chat streams, kill app mid-generation and reopen -> turn resumes.
- [ ] `make mobile-run-phone`: Release build on the connected iPhone (unlock phone for launch; if launch fails after install, it IS installed — tap the icon).
- [ ] Tag `plan-5-complete`.

---

Self-review: no NativeWind/Reanimated (two known landmines avoided); shared-types eliminates type drift; pure-logic helpers are copies with provenance comments (explicit decision: a shared-logic package is overkill for 3 small functions — revisit if they grow); multi-audience auth is the only backend change; SSE transport differs web (fetch-reader) vs mobile (react-native-sse) by design — both resumable via from_seq.
