# Expense Tracker Code Analysis - Lessons for Fitness Tracker

- **Status:** complete (deep read 2026-06-12, 3 parallel agents: backend, frontend/mobile, infra/CI/tests)
- **Source repo:** `/Users/dhishan/Projects/family-expense-tracker`
- **Related:** [[2026-06-12-fitness-tracker-design]]

## Copy verbatim

**Backend**
- Durable SSE: `POST /start` spawns `asyncio.create_task` (pin tasks in a module-level `_BG_TASKS` set so GC can't collect them), `GET .../stream?from_seq=N` polls Firestore events.
- ChatStore isolation: every read validates `user_id` on the doc, returns None (-> 404) for cross-user, logs the attempt.
- Usage service: each of the 3 Firestore writes wrapped independently; metering can never crash the main flow. `pricing.py` imports LiteLLM lazily, returns 0.0 on any error.
- Cloudflare JWT verification: hard-pin RS256 (never trust header `alg`), retry once on kid-miss for key rotation.
- `get_settings()` with `@lru_cache` and `extra = "ignore"`.

**Frontend/mobile**
- `api.ts` trifecta layout: one axios instance, named namespace exports per resource, auth request/response interceptors, `/auth/google` excluded from 401-logout redirect (avoids login loop).
- Mobile axios `timeout: 45_000` (Cloud Run cold starts) - web client lacks this; add to BOTH.
- `openResumeStream` + handler-callbacks pattern: transport stateless, `lastSeqRef` lives in the component.
- AppState foreground listener that re-opens the stream - the single most important mobile chat pattern.

**Infra/CI**
- 4-job CI chain: test-backend + test-frontend parallel -> deploy-backend (docker + terraform) -> deploy-frontend -> e2e.
- WIF auth block with `create_credentials_file: true` + `export_environment_variables: true` (needed by gcloud AND firebase CLI).
- Health-check poll (30x1s curl loop) before Playwright, never fixed sleep.
- Terraform layout: `main/` split by concern + `workspaces/<env>/backend.conf` + tfvars; Makefile `-chdir` targets so CI == local.
- Cloud Run `:latest` image needs the `deployed-<timestamp>` revision annotation to force re-pull on apply.
- `wait_dns_verification = false` on Firebase custom domain (cert is async, hours).
- E2E `.test-state.json` handoff between global-setup / auth.setup / teardown.

## Known pain - do differently

1. **chat.py grew to 2612 lines** (tool schemas + classifier + executor elif-chains + generation loop + routes + legacy shim, never extracted). Fitness tracker starts split:
   - `app/chat/tools/definitions.py` (data), `app/chat/tools/executor.py` (registry lookup, not elif), `app/chat/generation.py`, `app/routers/chat.py` (HTTP only, ~150 lines).
2. **Type drift between web and mobile mirrors is real**: `MerchantRule` field names diverged (`merchant_name` vs `merchant`), `is_income` optionality differs, split-approve types have two incompatible naming schemes, vestigial legacy chat types linger. Fitness tracker uses a **shared types workspace package** (`packages/shared-types`) imported by both - drift becomes a compile error.
3. **Usage double-count**: expense tracker records usage per agentic sub-turn AND again at turn end with the last sub-turn's numbers. Fitness tracker accumulates a TurnUsage across the loop and records ONCE in `_generate_turn`'s finally block.
4. **Web chat never reconnects** (fetch+ReadableStream, no retry -> silent half-filled bubble). Mobile's backoff-reconnect exists. Implement reconnect on BOTH from day one; key streamed messages by server-assigned `turnId`, never by array index (web's `messages.length + 1` is a stale-closure bug).
5. **Sync Firestore inside async**: every Firestore call in async paths must go through `asyncio.to_thread`; expense tracker's `get_current_user` dependency blocks the event loop per request. Make the auth dependency async from day one.
6. **CORS origins hardcoded in main.py** alongside settings-driven ones -> config drift. All origins from Settings.
7. **`global-setup.ts` hardcodes the prod API hostname** for the token exchange even when `API_URL` is local - E2E setup hits prod while specs hit the sandbox. Use `API_URL` consistently; better, use Playwright's `request` fixture instead of raw node http/https plumbing.
8. **`npm run lint || true`** - lint never fails CI. Don't carry this over.
9. **Hardcoded `waitForTimeout(6000)`** coupled to an undo-toast timer in a spec. Avoid timer-coupled assertions.
10. **Firestore index build race**: indexes are async; a fresh apply leaves queries throwing FailedPrecondition for minutes, masked by silent try/except. Surface index errors loudly; consider startup readiness check polling index state.
11. **Expo `runtimeVersion.policy: 'appVersion'`** kicks all users off OTA on every version bump. Use `nativeBuildVersion` policy.
12. **PWA `registerType: 'autoUpdate'`** can blank-screen mid-session on iOS. Use `prompt` mode + "new version - reload?" banner (matters for mid-workout sessions).
13. **Babel cache**: `api.cache(() => isTest)` invalidates prod cache every Metro start (~3-5s). Use `api.cache.forever()` outside tests.
14. **NativeWind + New Architecture needed a patch-package patch** (`react-native-css-interop`). Pin versions; document any patch dependency.
15. **Terraform providers `~> 5.0`**: pin exact versions in greenfield.
16. **WIF/SA bootstrap was manual**: consider a tiny `bootstrap/` terraform root for pool + SA bindings. Binding member must be `principalSet://...attribute.repository/<owner>/<repo>` - never pool-wide.
17. **Firebase Hosting deploy needs `roles/firebasehosting.admin` explicitly** - not in `roles/editor`.
18. **`google_firebase_project` 409s** if the project was Firebase-enabled out-of-band - guard or skip.
19. **Domain mappings**: must be created manually once (Search Console ownership), then `terraform import`. If state is lost, re-import - CI cannot create them.
20. **Split firestore indexes by feature domain** (`indexes_workouts.tf`, `indexes_chat.tf`) instead of one 400-line file.

## Subtle correctness details (chat/LLM)

- SSE keepalive comments (`: keepalive`) are mandatory - Cloud Run LB and react-native-sse treat silent connections as dead during model thinking. `X-Accel-Buffering: no` header equally mandatory.
- Streaming token usage: input tokens come from `message_start`, cumulative output from `message_delta`; reading only the final message's usage logs input=0. (Provider-specific - verify the LiteLLM equivalent.)
- If the model uses thinking blocks across tool turns, pass the assistant message content through verbatim (`model_dump(exclude_none=True)`), don't reconstruct from text+tool blocks.
- Cheap topic-classifier shrinking the tool list 60-80% before the main model call is economically proven (~$0.0004/turn) - this is the Phase 2 router's foundation.
- MCP subdomain behind Cloudflare Access must be `proxied = true` or the CF JWT header is never injected; plain API CNAME stays `proxied = false`.
