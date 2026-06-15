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
- Run a session — log sets, reps, weight, RPE
- See your last performance for the same exercise so you can progressively overload
- Full exercise library with muscle/movement/equipment tags; add your own custom exercises

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

## For developers

Codebase notes and architecture lessons live in `CLAUDE.md`. Sister project: [family-expense-tracker](https://github.com/dhishan/family-expense-tracker) — same AltStore source, same patterns.
