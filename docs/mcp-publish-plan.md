# Publish the fitness-tracker MCP server as a public, listed connector

## Goal

Anyone can add `fitness-tracker` as a custom connector in claude.ai / chatgpt.com,
sign in with Google, and talk to their own data. No pasting client secrets. Aim
for the connector directories.

## Status

- **Phase 1 — DONE.** Backend multi-tenant + gateway-trust auth shipped
  (`public_signup_enabled`, `mcp_gateway_secret`, `X-Mcp-Gateway-Assertion`
  path, auto-provision verified Google emails). Env wired in `cloud_run.tf`
  (off until launch). **Data-isolation audit passed** — every read/list/get is
  user_id-scoped; goals are doc-id scoped; `list_exercises` returns system +
  caller's custom only; cross-user `get_*` returns None. 544 backend tests pass.
- **Phase 5 (legal) — DRAFTED.** `/privacy` and `/terms` public pages live on the
  web app (linked from Login). Review/sign-off pending before Google submission.
- **Phase 2/3 — BUILT + provisioned.** `worker/` (TS, @cloudflare/workers-oauth-provider:
  DCR /register, Google upstream login, MCP proxy with signed gateway assertion),
  bundled to `terraform/main/mcp_oauth_worker.js`. Terraform `mcp_oauth_worker.tf`
  (KV + worker_script + worker_domain `fitness-mcp.blueelephants.org`) plans clean
  (3 to add) and deploys via CI. Provisions **inert** until secrets exist.

### Remaining to go live (user actions)
1. Add GH secrets: `GOOGLE_OAUTH_CLIENT_SECRET` (the web OAuth client's secret),
   `MCP_GATEWAY_SECRET` (any long random string; same value used by Worker + backend).
2. Google Cloud OAuth client → Authorized redirect URI:
   `https://fitness-mcp.blueelephants.org/callback`.
3. Phase 4: OAuth consent screen → Production + submit for verification.
4. Flip `PUBLIC_SIGNUP_ENABLED=true` (GH repo variable) when ready to open signups.
5. Add the connector in claude.ai/chatgpt: URL `https://fitness-mcp.blueelephants.org/mcp`
   (DCR means no client id/secret to paste).

## Decisions (locked)

- **Audience:** fully public / listed.
- **Auth broker:** self-hosted **Cloudflare Worker OAuth provider** (free), with
  **Google as the upstream human login**. The Worker exposes DCR so Claude/ChatGPT
  self-register; Google never sees the connector, only the Worker does.
- **Why a broker at all:** Google has no DCR (`registration_endpoint` absent —
  verified). A public connector can't hand a `client_secret` to strangers. So a
  DCR-capable OAuth server must sit in front; Google can only be the upstream IdP.

## Architecture

```
Claude/ChatGPT  ──OAuth (DCR + auth code + PKCE)──▶  Cloudflare Worker
  (MCP client)                                        (OAuth provider + gateway)
                                                          │  user logs in via Google
                                                          ▼
                                                       Google OAuth (upstream)
                                                          │
   authed MCP request (Bearer = Worker token)            │ issues Worker token,
        │                                                 │ stores {user_email}
        ▼                                                 ▼
  Worker validates its own token ──forwards──▶  FastAPI /mcp  (trusts Worker via
                                                 signed header; maps email→user_id)
```

- **Host:** `fitness-mcp.blueelephants.org` — single-level subdomain, covered by
  Cloudflare Universal SSL, so it can be **proxied (orange)** for free (the Worker
  must run on a proxied route). The existing `mcp.fitness-tracker.*` stays DNS-only
  for the private/Bearer path.
- **Worker library:** `@cloudflare/workers-oauth-provider` (implements RFC 7591 DCR
  + authorize/token endpoints + token storage in KV). Add a Google OAuth handler
  for the upstream login. This is Cloudflare's documented "remote MCP server" auth
  pattern.
- **Backend trust:** the Worker forwards to FastAPI `/mcp` with a short-lived
  signed assertion (e.g. an HS256 JWT signed with a shared `MCP_GATEWAY_SECRET`,
  `sub=<email>`). New backend auth path validates that header and maps email→user.
  The current Google-bearer path stays for direct/private clients.

## Phases

### Phase 1 — Backend: multi-tenant + gateway trust (code; no external deps)
- Auto-provision a `users` doc on first MCP login (currently only the web flow
  creates accounts). Gate behind `PUBLIC_SIGNUP_ENABLED` (default false until launch).
- New auth path in `mcp_auth`: trust `X-Mcp-Gateway-Assertion` (HS256, signed with
  `MCP_GATEWAY_SECRET`), extract email, map/provision user. Keep Google-bearer +
  dev paths.
- Replace the hard `ALLOWED_EMAILS` gate with: allow any verified Google email when
  `PUBLIC_SIGNUP_ENABLED`, else keep the allowlist.
- **Data-isolation audit:** confirm every Firestore query is `user_id`-scoped
  (workouts, nutrition, body, cardio, recipes, favorites, goals, chat). Add tests.

### Phase 2 — Cloudflare Worker OAuth provider (the broker)
- `worker/` project (TS, bundled to a single file). `@cloudflare/workers-oauth-provider`:
  - DCR `registration_endpoint` (open registration; cap + rate-limit).
  - Google upstream handler (authorize → Google consent → callback → mint Worker token).
  - On MCP request: validate Worker token, sign the gateway assertion, proxy to
    `https://api.fitness-tracker.blueelephants.org/mcp/`.

### Phase 3 — Infra: **all via Terraform** (terraform/main)
**No manual Cloudflare API/CLI changes** — they get reverted on the next `terraform
apply` (this is exactly why the `mcp` record kept re-proxying). Mirror the existing
`altstore_worker.tf` pattern:

```hcl
# mcp_oauth_worker.tf
resource "cloudflare_workers_kv_namespace" "mcp_oauth" {
  account_id = local.cf_account_id
  title      = "fitness-mcp-oauth"
}

resource "cloudflare_worker_script" "mcp_oauth" {
  account_id = local.cf_account_id
  name       = "fitness-mcp-oauth"
  content    = file("${path.module}/mcp_oauth_worker.js")  # bundled worker
  module     = true
  kv_namespace_binding { name = "OAUTH_KV"  namespace_id = cloudflare_workers_kv_namespace.mcp_oauth.id }
  secret_text_binding   { name = "GOOGLE_CLIENT_ID"     text = var.google_oauth_client_id }
  secret_text_binding   { name = "GOOGLE_CLIENT_SECRET" text = var.google_client_secret }
  secret_text_binding   { name = "MCP_GATEWAY_SECRET"   text = var.mcp_gateway_secret }
  plain_text_binding    { name = "BACKEND_MCP_URL"      text = "https://api.fitness-tracker.blueelephants.org/mcp/" }
}

# Single-level host -> Universal SSL covers it -> proxied works for free.
# cloudflare_worker_domain creates the (proxied) DNS record + edge cert automatically.
resource "cloudflare_worker_domain" "mcp_oauth" {
  account_id  = local.cf_account_id
  zone_id     = var.cloudflare_zone_id
  hostname    = "fitness-mcp.blueelephants.org"
  service     = cloudflare_worker_script.mcp_oauth.name
  environment = "production"
}
```
- New vars in `variables.tf`: `google_client_secret`, `mcp_gateway_secret` (sensitive),
  fed from GH secrets via `TF_VAR_*` (never in tfvars).
- Backend env (`MCP_GATEWAY_SECRET`, `PUBLIC_SIGNUP_ENABLED`) added to `cloud_run.tf`
  + `secrets.tf`, same as existing secrets.
- Verify the OAuth + MCP round-trip end to end after `terraform apply` (CI runs it).

### Phase 4 — Google app verification (manual, user)
- OAuth consent screen → **Production**. Scopes: `openid email profile` (non-sensitive).
- Provide: homepage, **privacy policy**, **terms**, authorized domains, app logo.
- Submit for verification to remove the unverified-app warning + 100-user cap.
  (Days–weeks. Non-sensitive scopes = lighter review, still required for public.)

### Phase 5 — Legal + hardening
- Privacy policy + ToS pages (also required for Phase 4). Hosted on the web app.
- Per-user + per-IP rate limits on the Worker and `/mcp`. Abuse logging.
- Remove/confirm no dev escape hatch in prod (`X-Mcp-User-Id` already dev-gated).
- Cost note: MCP tool calls are read-only data (no LLM cost on our side — the model
  runs on the user's Claude/ChatGPT). Main cost is Firestore reads + Worker/Cloud Run.

### Phase 6 — Directory submission (optional)
- Submit to Anthropic's connector directory and OpenAI's, per their review process.

## What needs the user (can't be done from code/CLI)
- Google OAuth consent screen → Production + verification submission (Phase 4).
- Privacy policy / ToS content sign-off (Phase 5).
- Confirm willingness to operate a public service (support, abuse, cost).

## Verification (per phase)
- P1: backend tests for provision + isolation; gateway-assertion auth path.
- P2/3: `curl` the Worker's `/.well-known/oauth-authorization-server` shows a
  `registration_endpoint`; DCR POST returns a client; full auth-code round trip;
  authed MCP `initialize` → 200 through the Worker to the backend.
- P4: consent screen shows "verified"; no warning for a fresh Google account.

## Reference
- Cloudflare "Build a remote MCP server" + `@cloudflare/workers-oauth-provider`.
- Existing private path: `docs/mcp-google-oauth-plan.md` (shipped, commit 897e20f).
