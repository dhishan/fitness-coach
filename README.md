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

## Use the coach from Claude / Cursor / any MCP client

The backend exposes an **MCP server** so any MCP-aware chat client (Claude Desktop, Cursor, Windsurf, etc.) can read your training data and answer questions in-chat.

**Endpoint**
```
https://api.fitness-tracker.blueelephants.org/mcp/
```

**Tools available**
- `get_dashboard_summary` - this week's streak, volume, sessions, muscle split
- `get_workouts` - list past workouts in a date range
- `get_active_workout` - the in-progress session, if one is running
- `get_exercise_progress` - volume-over-time for a single exercise
- `get_exercise_history` - last N sets for a single exercise
- `get_alternatives` - same-muscle alternative exercises
- `list_exercises` - browse the library
- `log_workout` - record a finished workout

### Claude Desktop

Open **Settings -> Developer -> Edit Config** and add:

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

Restart Claude Desktop. The 8 tools appear in the tools menu of any conversation.

### Cursor

Open **Settings -> MCP -> Add Server** and paste the same JSON snippet above. Reload the window.

### Windsurf / other clients

Any client that speaks **Streamable HTTP MCP** works. Point it at the URL above with your JWT in the `Authorization` header.

### Where do I get the JWT?

The app's JWT is the same one your phone or browser uses to call the API. Easiest paths:

1. **Web app** -> open `https://ui.fitness-tracker.blueelephants.org` -> DevTools -> Network tab -> any request to `api.fitness-tracker.blueelephants.org` -> copy the `Authorization: Bearer ...` header value.
2. **iOS app** -> currently no in-app token export; pull from the web app above.

Tokens expire after 24 hours (post security-hardening). Refresh by signing in again on web and copying the new token.

### Example prompts to try in Claude / Cursor

- "How is my bench progressing? Use the fitness-tracker tools."
- "What should I train today given my last 7 days?"
- "Show me my weekly volume by muscle group."
- "List alternatives for Romanian Deadlift if I only have dumbbells."

---

## For developers

Codebase notes and architecture lessons live in `CLAUDE.md`. Sister project: [family-expense-tracker](https://github.com/dhishan/family-expense-tracker) — same AltStore source, same patterns.
