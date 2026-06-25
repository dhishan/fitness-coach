# Wire Google OAuth on MCP for claude.ai + ChatGPT custom connectors

## Goal

Let claude.ai and chatgpt.com "Add custom connector" UIs (web + iOS + Android) hit this app's MCP server, authenticating via Google OAuth, so prompts run on the user's Claude Pro / ChatGPT Plus subscription instead of paying per-token via the in-app chat.

## Constraints

- Personal/family use only — skip dynamic client registration; advertise a pre-registered Google OAuth client_id.
- Reuse the existing Google OAuth client already configured for the web/mobile app (`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` env vars).
- Backend is FastAPI + FastMCP mounted at `/mcp`. Adapt paths if different.

## Implementation

### 1. New module `app/auth/google_oauth.py`

Function `verify_google_oauth_bearer(token: str) -> dict` that:
- Returns `{"email": ..., "sub": ...}` on success, raises `GoogleOAuthError` on any failure.
- If the token looks like a JWT (3 dot-separated segments) → verify as ID token via `google.oauth2.id_token.verify_oauth2_token(token, google.auth.transport.requests.Request(), settings.google_client_id)`. Check `iss in {"accounts.google.com", "https://accounts.google.com"}`.
- Else treat as access token → `GET https://oauth2.googleapis.com/tokeninfo?access_token=...`, confirm `aud == settings.google_client_id` and `expires_in > 0`, then `GET https://www.googleapis.com/oauth2/v2/userinfo` with bearer header to extract email.

### 2. Replace MCP auth in `app/mcp_server.py`

Two paths only:
1. `Authorization: Bearer <token>` → `verify_google_oauth_bearer` → map email to internal user_id via existing `_resolve_user_id_by_email` (Firestore lookup against `users` collection).
2. `X-Mcp-User-Id` header — dev-only escape hatch.

Delete any existing Cloudflare Access JWT path and app-JWT fallback.

### 3. FastMCP `transport_security` (critical — Claude returns 421 without this)

```python
from mcp.server.transport_security import TransportSecuritySettings

mcp = FastMCP(
    "my-app",
    streamable_http_path="/",
    transport_security=TransportSecuritySettings(
        enable_dns_rebinding_protection=True,
        allowed_hosts=[
            "mcp.<your-subdomain>.<root-domain>",
            "api.<your-subdomain>.<root-domain>",
            "127.0.0.1:*", "localhost:*",
        ],
        allowed_origins=[
            "https://claude.ai", "https://chatgpt.com", "https://chat.openai.com",
            "http://127.0.0.1:*", "http://localhost:*",
        ],
    ),
)
```

### 4. Middleware: rewrite `POST /mcp` → `/mcp/` (avoids 307 redirect)

In `app/main.py`, after mounting the MCP app:

```python
@app.middleware("http")
async def _mcp_trailing_slash(request, call_next):
    if request.url.path == "/mcp":
        request.scope["path"] = "/mcp/"
        request.scope["raw_path"] = b"/mcp/"
    return await call_next(request)
```

Claude/ChatGPT POST to `/mcp` (no slash); FastAPI's default 307 drops the auth header on redirect.

### 5. WWW-Authenticate header on 401

In the MCP auth middleware's exception handler, return:

```
WWW-Authenticate: Bearer realm="mcp.<your-subdomain>", resource_metadata="https://mcp.<your-subdomain>.<root-domain>/.well-known/oauth-protected-resource"
```

This is how clients discover the OAuth metadata.

### 6. New router `app/routers/wellknown.py`

Mount at root (no `/api/v1` prefix). Four routes, all returning the same payload:

```python
PAYLOAD = {
  "resource": "https://mcp.<your-subdomain>.<root-domain>/mcp/",
  "authorization_servers": ["https://accounts.google.com"],
  "scopes_supported": ["openid", "email", "profile"],
  "bearer_methods_supported": ["header"],
}
```

Endpoints:
- `GET /.well-known/oauth-protected-resource`
- `GET /.well-known/oauth-protected-resource/mcp` ← RFC 9728 path-aware variant Claude uses
- `GET /.well-known/oauth-protected-resource/mcp/`

Plus one auth-server descriptor that advertises Google's endpoints + your `client_id`:

```python
GET /.well-known/oauth-authorization-server → {
  "issuer": "https://accounts.google.com",
  "authorization_endpoint": "https://accounts.google.com/o/oauth2/v2/auth",
  "token_endpoint": "https://oauth2.googleapis.com/token",
  "userinfo_endpoint": "https://openidconnect.googleapis.com/v1/userinfo",
  "jwks_uri": "https://www.googleapis.com/oauth2/v3/certs",
  "response_types_supported": ["code"],
  "scopes_supported": ["openid", "email", "profile"],
  "code_challenge_methods_supported": ["S256"],
  "token_endpoint_auth_methods_supported": ["client_secret_post", "client_secret_basic"],
  "client_id": settings.google_client_id,
}
```

### 7. Tests `tests/test_mcp_auth.py`

- Discovery endpoint returns expected JSON shape.
- Unauth `GET /mcp/` returns 401 with `WWW-Authenticate` containing `resource_metadata=`.
- `Authorization: Bearer <fake>` with mocked `verify_google_oauth_bearer` resolves email → user_id.
- Unknown-email returns 403.
- Invalid bearer returns 401.

### 8. Observability (optional but recommended)

In the MCP auth middleware, after resolving user_id:
```python
import sentry_sdk
sentry_sdk.set_user({"id": user_id})
```

If Langfuse is wired into the in-app chat, mirror the pattern around `_dispatch_tool_call` so MCP traces show up alongside chat traces:
```python
with lf.start_as_current_span(name=f"mcp_tool:{tool_name}", input=tool_input) as span:
    result = await tool_fn(...)
    span.update(output=result, user_id=user_id, metadata={"source": "mcp"})
```

Note: the user's natural-language prompt never reaches your backend (Claude/ChatGPT keep it). You only see tool-call arguments. That's fine for usage analytics and debugging.

## Infra (manual, outside code)

### Cloudflare DNS

If your MCP subdomain CNAME is `proxied=true`: **flip to `proxied=false`**. Cloudflare Universal SSL doesn't cover second-level subdomains (`*.feature.root.com`); proxied path returns TLS handshake failure. DNS-only lets Google's managed Cloud Run cert serve directly.

Update terraform too if managed there:
```hcl
resource "cloudflare_record" "mcp_cname" {
  ...
  proxied = false  # was true for CF Access; no longer needed
}
```

### Cloud Run domain mapping

If the cert was stuck pending under the old proxied state, bounce the mapping:
```bash
gcloud beta run domain-mappings delete --domain=mcp.<sub>.<root> --region=<region> --project=<project>
gcloud beta run domain-mappings create --service=<service> --domain=mcp.<sub>.<root> --region=<region> --project=<project>
```
Then wait 15-60 min for cert issuance.

### GCP Console — OAuth client

APIs & Services → Credentials → open the existing OAuth 2.0 Client ID matching `GOOGLE_CLIENT_ID`. Add to Authorized redirect URIs:
- `https://claude.ai/api/mcp/auth_callback`
- `https://chatgpt.com/api/mcp/auth_callback`

(If different, Google's error page on the first failed attempt shows the exact URI to whitelist.)

## Verification

```bash
# 1. Discovery
curl -i https://mcp.<sub>.<root>/.well-known/oauth-protected-resource
# Expect 200 + JSON

# 2. Path-aware discovery
curl -i https://mcp.<sub>.<root>/.well-known/oauth-protected-resource/mcp
# Expect 200 + same JSON

# 3. Unauth probe
curl -i https://mcp.<sub>.<root>/mcp/
# Expect 401 + WWW-Authenticate: Bearer ... resource_metadata="..."

# 4. POST without slash
curl -i -X POST -H 'Content-Type: application/json' -d '{}' https://mcp.<sub>.<root>/mcp
# Expect 401 (NOT 307, NOT 421)
```

Then in claude.ai: Settings → Connectors → Add custom → URL → paste `client_id` + `client_secret` → Google consent → grant → test a tool-using prompt.

## Common failure modes

1. **TLS handshake failure** — Cloudflare proxied subdomain without Advanced Certificate Manager. Fix: unproxy.
2. **HTTP 421 Misdirected Request** — MCP DNS-rebinding-protection middleware rejecting Host header. Fix: explicit `TransportSecuritySettings(allowed_hosts=[...])`.
3. **HTTP 307 on POST /mcp** — FastAPI's trailing-slash auto-redirect drops auth headers. Fix: middleware path rewrite.
4. **`oauth-protected-resource/mcp` 404** — Claude appends the resource path per RFC 9728. Fix: register the path-aware variants too.
5. **OAuth callback `redirect_uri_mismatch`** — Claude's exact callback URI not whitelisted in GCP. Fix: copy from the error page, add to OAuth client.

## Reference implementation

Working in production at `family-expense-tracker` repo, commits `edcda16`, `2adf450`, `04c1f9f` (June 2026). The verification curls above were the exact ones used to validate that deployment.
