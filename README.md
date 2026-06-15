# Fitness Tracker

Personal fitness tracker. FastAPI backend on Cloud Run, React + Vite web PWA, Expo iOS app.

- Web: https://ui.fitness-tracker.blueelephants.org
- API: https://api.fitness-tracker.blueelephants.org

## What it does

A single place to log workouts, food, body metrics, and cardio — plus an AI coach that answers questions across all of it.

**Workouts**
- Build plan templates (push day, pull day, custom)
- Run a workout: tracks sets, reps, weight, RPE; shows last performance for the same exercise so you can progressively overload
- Library of exercises with primary/secondary muscle tags, movement pattern, equipment; add custom ones
- Full session history with per-exercise stats

**Nutrition**
- Log meals by typing, photo (AI vision estimates macros), or barcode scan
- USDA-backed food autocomplete with full macros + micros
- Per-meal time picker; daily roll-up with target deltas

**Body metrics**
- Weight, body-fat %, measurements; date-anchored trend lines
- Apple Health sync on iOS — pulls weight, steps, HRV, sleep, workouts

**Cardio**
- Manual log (treadmill, run, cycle, swim) with duration + distance + average HR
- Also auto-imported from Apple Health workouts

**AI coach**
- Ask "what should I do today" / "how am I trending on protein" / "build me a 4-day split"
- Reads from all of the above; uses Anthropic Claude with adaptive model routing (Haiku for cheap classification, Sonnet for chat, Opus for explicit deep analysis)
- Durable Firestore-backed conversations; iOS app reopens SSE on foreground

**Platforms**
- Web PWA — install to home screen on any device
- Native iOS via AltStore sideload (see below) — Sign in with Apple, native HealthKit, native camera/barcode


## Sideload the iOS app (AltStore)

The iOS app is distributed as an unsigned `.ipa` through AltStore — no App Store, no Apple Developer account.

### One-time setup

1. Install **AltStore** on your Mac or PC: https://altstore.io
2. Install **AltStore** on your iPhone via the desktop app (USB pair, follow the prompts)
3. On the desktop AltStore, sign in with your Apple ID — this lets AltStore re-sign apps for your iPhone (free Apple ID works; 7-day re-sign cycle)

### Add the source

1. Open AltStore on your iPhone
2. **Browse** tab → **Sources** → **+**
3. Paste:
   ```
   https://apps.blueelephants.org/altstore.json
   ```
4. **Add** → the **Blue Elephants Family** source appears with two apps:
   - **Fitness Tracker**
   - **Expenses**

### Install

1. **Browse** → **Fitness Tracker** → **FREE** → installs the latest `.ipa`
2. First launch: sign in with Google or Apple
3. Refresh weekly inside AltStore (free Apple ID = 7-day signing window). With a paid Apple Developer account, signing lasts 1 year.

### Updates

New releases land automatically. When CI publishes a new `mobile-v*` tag:
- GitHub Actions builds the `.ipa`, attaches it to a GitHub Release
- The shared `altstore.json` on GCS is updated with the new version + download URL
- AltStore shows **Update available** on next refresh

### Troubleshooting

- **"Could not verify app" / "Untrusted developer"** — Settings → General → VPN & Device Management → trust the developer profile
- **"App expired"** — open AltStore, tap the app, **Refresh**
- **"Version mismatch"** — pull-to-refresh in AltStore, then update again

## Repos in the source

The same `altstore.json` is shared with [family-expense-tracker](https://github.com/dhishan/family-expense-tracker). Both repos' release workflows write to `gs://blueelephants-altstore/altstore.json`, fronted by a Cloudflare Worker at `apps.blueelephants.org`.

## Development

See `CLAUDE.md` for codebase conventions and hard-won lessons from the sibling project.
