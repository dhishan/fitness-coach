# Fitness Tracker

A personal fitness tracker with workouts, nutrition, body metrics, cardio, and an AI coach that reads all of it.

**Live now**
- Web app — https://ui.fitness-tracker.blueelephants.org
- iOS app — install via AltStore (see below)

---

## Install on iPhone

The iOS app is sideloaded via AltStore. No App Store, no developer account needed.

**First time**
1. Install **AltStore** on your computer and iPhone — https://altstore.io
2. On your iPhone: **AltStore → Browse → Sources → +**
3. Paste this URL:
   ```
   https://apps.blueelephants.org/altstore.json
   ```
4. **Add** → the **Blue Elephants Family** source appears

**Install the app**
- **Browse → Fitness Tracker → FREE** → installs the latest version
- Sign in with Google or Apple on first launch

**Updates**
- Every new release auto-publishes here. Open AltStore and pull-to-refresh — you'll see **Update available** when one is ready.

**If something goes wrong**
- *"Untrusted developer"* → Settings → General → VPN & Device Management → trust the profile
- *"App expired"* (free Apple IDs re-sign every 7 days) → open AltStore, tap the app, **Refresh**
- *"Version mismatch"* → pull-to-refresh in AltStore, then update again

---

## Install on iPhone (no AltStore — web version)

Don't want to sideload? Add the web app to your home screen and it runs full-screen, no browser chrome, no address bar - feels like a native app.

1. Open **Safari** (this doesn't work in Chrome/Firefox on iOS)
2. Go to **https://ui.fitness-tracker.blueelephants.org**
3. Sign in with Google
4. Tap the **Share** button (the square with the up arrow at the bottom)
5. Scroll down and tap **Add to Home Screen**
6. Tap **Add** in the top right

The app icon now lives on your home screen. Tap it - opens full-screen with no Safari UI. Works offline once cached, supports the camera for food photos, syncs the same data as the sideloaded app.

**Android / desktop:** Chrome shows an **Install app** option in the address bar menu - same idea, same result.

---

## What you can do

**Track workouts**
- Build plan templates (push day, pull day, anything custom)
- Run a session — log sets, reps, weight, RPE in kg or lb (your choice)
- See your last performance for the same exercise so you can progressively overload

**Exercise catalog**
- Hundreds of exercises with animated GIF demos showing proper form
- Each one tagged with primary + secondary muscle groups, movement pattern (push / pull / squat / hinge / carry / core), and equipment (barbell, dumbbell, machine, cable, bodyweight, other)
- Add your own custom exercises when something isn't covered
- **Intent-based search**: type "chest" and Bench Press shows up, type "legs" and Squat / Lunge / Deadlift surface, type "db curl" and dumbbell biceps work appears. Search expands aliases (chest → push, bench, press, fly, dip) and scores across name + muscles + movement + equipment, not just exact name match

**Log food**
- Type, snap a photo, or scan a barcode — AI estimates macros from any of them
- USDA-backed autocomplete with full macros and micros
- Per-meal time picker; daily roll-up against your targets

**Body metrics**
- Weight, body-fat %, measurements with trend lines over time
- Apple Health sync on iPhone — pulls in weight, steps, HRV, sleep, workouts

**Cardio**
- Manual log for treadmill, run, cycle, swim (duration, distance, average HR)
- Auto-imports Apple Health workouts on iPhone

**AI coach**
- Ask "what should I do today", "how am I trending on protein", "build me a 4-day split"
- Reads from everything above and answers in context
- Conversations persist; the iPhone app picks up where it left off

---

## Heads up

- The web app works on any device — install it to your home screen for a native feel
- The iPhone app gives you HealthKit sync, native camera barcode scanning, Sign in with Apple
- This is a personal project — no signups, no marketing, no telemetry beyond what you'd expect

---

## Use the coach from Claude / ChatGPT / any MCP client

The backend exposes an **MCP server** so an MCP-aware chat client can read your
training data and log workouts in-chat. There are two ways in:

- **Public connector** (claude.ai, ChatGPT): sign in with Google, nothing to
  paste. This is the easy path.
- **Direct endpoint with a token** (Claude Desktop, Cursor, Windsurf): paste a
  JWT. Good for local clients.

**Connector URL (public)**
```
https://fitness-mcp.blueelephants.org/mcp
```

Authentication is OAuth with Dynamic Client Registration, so there is no client
id or secret to paste. The client self-registers and sends you to Google to log
in. Each person only ever sees their own data.

**Tools available**
- `log_workout` - record an already-finished workout in one shot (write)
- `start_workout` - start a new in-progress workout (write)
- `add_to_active_workout` - add an exercise + sets to the in-progress workout (write)
- `finish_active_workout` - finish the in-progress workout (write)
- `create_plan` - create a reusable workout plan/template (write)
- `log_food` - log a food you ate with macros + optional micros (write)
- `get_dashboard_summary` - this week's streak, volume, sessions, muscle split
- `get_workouts` - list past workouts in a date range
- `get_active_workout` - the in-progress session, if one is running
- `get_exercise_progress` - volume-over-time for a single exercise
- `get_exercise_history` - last N sets for a single exercise
- `get_alternatives` - same-muscle alternative exercises
- `list_exercises` - browse the library
- `get_nutrition_logs`, `get_nutrition_summary`, `get_nutrition_goals`,
  `list_recipes`, `list_favorites` - read nutrition
- `get_body_metrics` - weight and measurements over time
- `get_cardio_logs` - cardio sessions

You can log workouts and food and read everything. Body metrics and cardio
are read-only over MCP.

### Claude (claude.ai)

1. **Settings**, then **Connectors**.
2. **Add custom connector**.
3. URL: `https://fitness-mcp.blueelephants.org/mcp`.
4. Click through and log in with Google when prompted. The tools appear.

No developer mode or extra toggles. Works in a normal chat.

### ChatGPT (chatgpt.com)

ChatGPT's default connector surface (Deep Research) only calls `search` and
`fetch` tools, which this server does not implement. To use the real tools you
need **Developer Mode**.

1. Paid plan required (Plus, Pro, Business, Enterprise, or Edu). Use the web or
   desktop app.
2. **Settings**, then **Connectors**, then **Advanced settings**. Turn on
   **Developer Mode**. This exposes the full set of MCP tools, including write
   actions.
3. **Settings**, then **Connectors**, then **Create** / **Add custom connector**.
   - Name: anything (e.g. Fitness Tracker).
   - MCP Server URL: `https://fitness-mcp.blueelephants.org/mcp`.
   - Authentication: **OAuth**.
4. Sign in with Google in the popup. The connector shows as connected.
5. In a chat, open the tools menu and enable the connector for that
   conversation. Write actions prompt you to confirm before they run.

If ChatGPT only offers the connector under Deep Research or reports no tools,
Developer Mode is not on. That is the usual gotcha.

### Claude Desktop / Cursor / Windsurf (direct, with a token)

For local MCP clients, skip the OAuth connector and point straight at the
backend with a JWT. Open the client's MCP config and add:

```json
{
  "mcpServers": {
    "fitness-tracker": {
      "transport": "http",
      "url": "https://api.fitness-tracker.blueelephants.org/mcp/",
      "headers": {
        "Authorization": "Bearer YOUR_JWT_HERE"
      }
    }
  }
}
```

- **Claude Desktop:** Settings, Developer, Edit Config. Restart after saving.
- **Cursor:** Settings, MCP, Add Server. Reload the window.
- **Windsurf / others:** any client that speaks Streamable HTTP MCP works.

**Where do I get the JWT?** It is the same token your browser uses to call the
API. Open `https://ui.fitness-tracker.blueelephants.org`, open DevTools, go to
the Network tab, click any request to `api.fitness-tracker.blueelephants.org`,
and copy the `Authorization: Bearer ...` header value. Tokens expire after 24
hours; sign in again to get a fresh one.

### Example prompts

- "How is my bench progressing? Use the fitness-tracker tools."
- "What should I train today given my last 7 days?"
- "Show me my weekly volume by muscle group."
- "Log today's workout: bench press 3x8 at 60kg, squats 3x5 at 100kg."
- "List alternatives for Romanian Deadlift if I only have dumbbells."

---

## Observability (Sentry)

Errors, traces, and business events from all three surfaces stream to a single Sentry org (`dhishan`). Three projects:

- **fitness-tracker-backend** — FastAPI on Cloud Run. DSN injected at runtime via GCP Secret Manager (terraform owns the secret + IAM; CI passes `TF_VAR_sentry_dsn_backend` from the GH secret `SENTRY_DSN_BACKEND`).
- **fitness-tracker-web** — React on Firebase Hosting. DSN baked into the bundle at build time (`VITE_SENTRY_DSN`); `@sentry/vite-plugin` uploads source maps from CI tagged with the build SHA so stack traces resolve to original TS lines.
- **fitness-tracker-mobile** — Expo / React Native. DSN in `app.extra.sentry.dsn` (public client identifier, safe to bake). The `@sentry/react-native/expo` plugin patches the native iOS project on `expo prebuild` and uploads dSYM + JS source maps per IPA build (tag `mobile-v*`).

### What's captured automatically

- **Errors** — every uncaught exception (FastAPI 500s, React render errors, RN JS errors, native crashes) lands as an event with stack trace + user attribution + request context.
- **Logger output** — backend `logger.error(...)` becomes a Sentry event; `logger.info(...)` becomes a breadcrumb attached to the next event.
- **Tracing** — 100% sample of every backend route, browser page load, mobile screen open. LLM completions wrapped in `op=llm.completion` spans tagged with model + input/output tokens.
- **Session Replay (web only)** — last ~60s of DOM + clicks + network captured on error (`replaysOnErrorSampleRate=1.0`).

### Business events (captured via `track()` / `Sentry.captureMessage`)

`auth.signed_in`, `workout.finished`, `nutrition.log.created`, `nutrition.log.updated`, `nutrition.estimate.{text,label}`, `recipe.created`, `recipe.logged`, `cardio.log.created`, `body.metric.created`, `chat.message.sent`.

Use Sentry → Insights → Custom Events to filter by name and see per-user trends.

### User attribution

Backend sets the Sentry user scope from `get_current_user` on every authenticated request. Web sets it on sign-in via the Zustand auth store. Mobile sets it on `setAuth` and clears on `logout`. Errors land with `{ id, email }` already attached.

### Verifying the pipe

```bash
# Backend — fires one info event into fitness-tracker-backend
curl "https://api.fitness-tracker.blueelephants.org/internal/sentry-test?token=$(echo $JWT_SECRET_KEY | cut -c1-12)"

# Web — open https://ui.fitness-tracker.blueelephants.org in DevTools console:
Sentry.captureMessage("verification.web", "info")

# Mobile — shake to open dev menu, or run on connected sim:
# In any screen, briefly throw from a Pressable:  () => { throw new Error("verification.mobile") }
```

Then check Sentry → Issues; expect each event within ~30s tagged with the right environment + release.

### Secrets reference

GitHub Actions repo secrets (read by `ci-cd.yml` and `release-ipa.yml`):

- `SENTRY_DSN_BACKEND` — passed as `TF_VAR_sentry_dsn_backend` to terraform; written to Secret Manager `fitness-tracker-sentry-dsn-prod`; mounted on Cloud Run as `SENTRY_DSN`.
- `SENTRY_DSN_WEB` — set as `VITE_SENTRY_DSN` at frontend build time.
- `SENTRY_AUTH_TOKEN` — org-level Sentry token used by `@sentry/vite-plugin` (web) and `@sentry/react-native/expo` (mobile) for source-map upload.
- `SENTRY_ORG` (`dhishan`), `SENTRY_PROJECT_BACKEND`, `SENTRY_PROJECT_WEB`, `SENTRY_PROJECT_MOBILE`.

---

## For developers

Codebase notes and architecture lessons live in `CLAUDE.md`. Sister project: [family-expense-tracker](https://github.com/dhishan/family-expense-tracker) — same AltStore source, same patterns.

### Automated UI tests (Maestro)

Install Maestro once:
```
brew install maestro
```

Get a test JWT (needed to bypass Google Sign-In in flows):
```
bash scripts/get-test-jwt.sh
```
This saves your token to `~/.fitness-test-jwt`. Tokens expire after 1 hour.

Run all flows against the running iOS sim:
```
make e2e-mobile
```

Run a single flow:
```
make e2e-mobile-flow FLOW=02-add-food-search.yaml
```

Flows: `00-login` (auth), `01-launch`, `02-add-food-search`, `03-edit-food` (needs a food log today), `04-coach-message`, `05-reorder-workout` (needs an active workout).
