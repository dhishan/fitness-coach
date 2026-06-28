# Per-user entitlements + quotas (feature gating) - plan

Status: PLANNED, not built. Monetization-ready engine to gate the AI features
(which cost real money to run) behind per-user feature flags + quotas. Clients
keep working while unbuilt: everyone is effectively `free` with generous caps.

## Decisions (locked)

- Intent: build the entitlement/quota engine now-ish, designed so a payment
  system (Apple IAP / Stripe) can flip `plan` later. Not building payments yet.
- Control surface: an admin API, gated by an `admin_emails` allowlist (my email)
  reusing existing auth. No new secret.
- Gated features (all of these cost money / are power features): AI coach chat,
  AI nutrition estimate, suggest-next + workout title, MCP connector access.
- MCP is FREE but metered (a per-month call limit), not pro-only, so the public
  connector stays usable for new signups.
- Pro is NOT "everything unlimited". Pro still has quotas, just larger.
- `unlimited` exists as an option but is granted to only a few users (me, close
  friends) via admin, not sold as a public plan.
- Features have tiers beyond free/pro: some are `restricted` (personal / beta)
  and do NOT open for pro automatically - only via an explicit per-user override.
- Gemini: dropped. Cost analysis (below) shows the coach is ~95% of AI spend and
  the mini-features are rounding error; regular Gemini Flash is actually pricier
  than gpt-4o-mini, and Flash-Lite is only ~33% cheaper on already-negligible
  costs. Keep models configurable per-feature in case we revisit the COACH model
  (the only lever that matters), but no Gemini work for now.

## Data model

`users/{uid}` gains:
```
plan: "free" | "pro" | "unlimited"     # default "free"; single source of truth
feature_overrides: { <feature>: bool } # grant/deny one feature to one user (beats plan)
quota_overrides:   { <feature>: int | null }  # per-user cap; null = unlimited (beats plan)
plan_source: "admin" | "apple" | "stripe" | null  # future payments
plan_expires_at: timestamp | null      # future subscriptions
```

Quota counters (cheap O(1) read, mirrors existing usage summaries):
```
user_quotas/{uid}/months/{YYYY-MM} -> { <feature>: count }   # atomic Increment
```

## Feature catalog + tiers + quotas (defaults; all tunable in config)

| Feature key   | Covers                         | Tier        | Free/mo | Pro/mo | Unlimited |
|---------------|--------------------------------|-------------|---------|--------|-----------|
| `ai_coach`    | coach chat                     | free        | 30      | 500    | none (∞)  |
| `ai_nutrition`| photo/text/label estimate      | free        | 30      | 1000   | none (∞)  |
| `ai_workout`  | suggest-next + funny title     | free        | 50      | 1000   | none (∞)  |
| `mcp`         | connector access (metered)     | free        | 500     | 5000   | none (∞)  |
| (future)      | personal / beta features       | restricted  | -       | -      | per-user  |

`unlimited` = `quota = None`. Pro is finite. `restricted` features are off for
everyone until granted via `feature_overrides`.

## Resolution logic

```
entitled(uid, f):
    if f in feature_overrides: return feature_overrides[f]   # explicit grant/deny wins
    tier = FEATURE_TIER[f]
    if tier == "free": return True
    if tier == "pro":  return plan in ("pro", "unlimited")
    if tier == "restricted": return False                    # only via override

quota_limit(uid, f):
    if f in quota_overrides: return quota_overrides[f]        # int or None(∞)
    return PLAN_QUOTAS[plan][f]                               # int or None(∞)

check_and_consume(uid, f):
    if not entitled(uid, f): -> 403 {code: "feature_locked"}
    lim = quota_limit(uid, f)
    if lim is not None and count(uid, f, this_month) >= lim:
        -> 402 {code: "quota_exceeded", used, limit}
    increment(uid, f)        # on SUCCESS of the op, so failures don't burn quota
```

## Backend (Phase 1 - the engine)

- `entitlements_service`: `get_entitlements(uid)`, `check_and_consume(uid, f)`,
  `require_feature(uid, f)` (entitlement-only, for MCP access), `set_user_plan`,
  `set_feature_override`, `set_quota_override`.
- Config: `FEATURE_TIER`, `PLAN_QUOTAS` (free/pro/unlimited), `admin_emails`.
- Wire enforcement into: nutrition estimate routes, chat start, suggest-next,
  workout-title, and the MCP auth middleware (after resolving user_id ->
  require_feature("mcp") + consume the mcp call quota).
- `GET /me/entitlements` -> `{ plan, features: {f: bool}, quotas: {f: {used, limit|null}} }`.
- Admin API: `POST /admin/users/{id}/plan`, `/feature-override`, `/quota-override`,
  gated by `admin_emails`. Reuses existing auth; returns the updated entitlements.
- Increment on success; rate limiter already bounds retry abuse.
- Tests: entitlement (free/pro/unlimited/restricted), override beats plan, quota
  exhaustion (402), unlimited (None) never blocks, increment-on-success only,
  admin authz, MCP metered-free path.

## Phase 2 - clients (web + mobile)

Consume `/me/entitlements`; gate UI (lock badges), show "X / N used" on metered
features, upsell/quota sheet on 402/403. Settings shows plan + usage. Optional
admin screen later (lists users, toggles plan/flags) on top of the admin API.

## Phase 3 - payments (only when charging)

Apple IAP receipt validation (mobile) + optionally Stripe (web); both just call
`set_user_plan(uid, "pro", expires_at, source)`. Restore-purchases. The engine
above is built so this slots in without touching enforcement.

## Cost reference (June 2026, for sizing quotas)

Models in use: coach = gpt-5.5 (strong) + gpt-4o-mini; nutrition/suggest/title =
gpt-4o-mini. Prices: gpt-4o-mini $0.15/$0.60 per 1M in/out; Gemini 2.5 Flash
$0.30/$2.50 (pricier); Flash-Lite $0.10/$0.40.

| Segment            | Model       | ~per call | ~/active user/mo |
|--------------------|-------------|-----------|------------------|
| Coach chat         | gpt-5.5     | 0.5-1.0c  | ~38c (≈95% of cost) |
| Nutrition photo    | gpt-4o-mini | ~0.03c    | ~1c              |
| Nutrition text     | gpt-4o-mini | ~0.015c   | ~0.5c            |
| Suggest-next       | gpt-4o-mini | ~0.016c   | ~0.3c            |
| Workout title      | gpt-4o-mini | ~0.002c   | ~0c              |
| Total              |             |           | ~$0.40/user/mo   |

Real per-segment cost is already tracked in `usage_events` by `source` - use that
to set the quota numbers when building.

## Existing pieces this builds on

- `usage_service` (per-user monthly aggregate + per-source cost in usage_events).
- Per-user MCP rate limit + provisioning backstop (mcp_auth.py) - separate from
  quotas (rate limit = abuse/sec; quota = entitlement/month).
- `users/{uid}` doc shape (email, display_name, preferred_units, created_via).
- LiteLLM (`llm.complete`) with per-feature model settings - the hook if the
  coach model is ever revisited.
