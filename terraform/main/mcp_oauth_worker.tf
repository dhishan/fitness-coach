# Public, DCR-capable OAuth gateway for the MCP server (claude.ai / chatgpt.com
# custom connectors). The Worker runs @cloudflare/workers-oauth-provider: it
# exposes /authorize, /token, /register (DCR), logs the user in via Google
# upstream, and proxies authenticated MCP requests to the backend with a signed
# X-Mcp-Gateway-Assertion.
#
# Bundle is built from worker/ via `cd worker && npm run build`, then copied to
# terraform/main/mcp_oauth_worker.js (mirrors altstore_worker.js). Regenerate
# after changing worker/src.
#
# Host: fitness-mcp.blueelephants.org — a SINGLE-level subdomain so Cloudflare
# Universal SSL covers it and it can be proxied (required for a Worker) for free.
#
# Gated behind var.mcp_oauth_enabled (a GH repo variable -> TF_VAR). Two external
# prerequisites must be met before flipping it true, or `apply` fails:
#   1. The CLOUDFLARE_API_TOKEN needs "Workers KV Storage:Edit" (the existing
#      altstore worker only needed "Workers Scripts:Edit"; KV is a separate scope).
#   2. GOOGLE_OAUTH_CLIENT_SECRET + MCP_GATEWAY_SECRET GH secrets set, and the
#      Google OAuth client's redirect URI includes .../callback.
# Until then the stack stays unprovisioned and the main deploy stays green.

locals {
  mcp_oauth_enabled = var.mcp_oauth_enabled == "true"
}

resource "cloudflare_workers_kv_namespace" "mcp_oauth" {
  count      = local.mcp_oauth_enabled ? 1 : 0
  account_id = local.cf_account_id
  title      = "fitness-mcp-oauth"
}

resource "cloudflare_worker_script" "mcp_oauth" {
  count      = local.mcp_oauth_enabled ? 1 : 0
  account_id = local.cf_account_id
  name       = "fitness-mcp-oauth"
  content    = file("${path.module}/mcp_oauth_worker.js")
  module     = true

  kv_namespace_binding {
    name         = "OAUTH_KV"
    namespace_id = cloudflare_workers_kv_namespace.mcp_oauth[0].id
  }

  plain_text_binding {
    name = "GOOGLE_CLIENT_ID"
    text = var.google_oauth_client_id
  }
  plain_text_binding {
    name = "BACKEND_MCP_URL"
    text = "https://${var.api_domain}/mcp/"
  }

  secret_text_binding {
    name = "GOOGLE_CLIENT_SECRET"
    text = var.google_client_secret
  }
  secret_text_binding {
    name = "MCP_GATEWAY_SECRET"
    text = var.mcp_gateway_secret
  }
}

# Custom domain binding — creates the (proxied) DNS record + edge cert.
resource "cloudflare_worker_domain" "mcp_oauth" {
  count       = local.mcp_oauth_enabled ? 1 : 0
  account_id  = local.cf_account_id
  zone_id     = var.cloudflare_zone_id
  hostname    = "fitness-mcp.blueelephants.org"
  service     = cloudflare_worker_script.mcp_oauth[0].name
  environment = "production"
}

output "public_mcp_connector_url" {
  value = local.mcp_oauth_enabled ? "https://fitness-mcp.blueelephants.org/mcp" : "disabled (set mcp_oauth_enabled=true)"
}
