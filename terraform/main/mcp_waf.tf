# Cloudflare WAF rate-limiting rule for the public MCP host — the outermost,
# cheapest layer (runs at the edge BEFORE the Worker executes). Free plan allows
# one rate-limit rule: a fixed 10s window, block action, counted per client IP.
#
# Gated behind var.mcp_waf_enabled (default false) because the CLOUDFLARE_API_TOKEN
# needs a Rate Limiting / WAF edit permission the Workers+KV token currently lacks
# (verified: ruleset API returns Authentication error 10000). Flip it on only
# after adding that permission, or `terraform apply` will 401.
#
# This is a coarse anti-flood net; the finer per-path / per-user limits live in
# the Worker (per IP) and the backend (per user).

variable "mcp_waf_enabled" {
  type    = string
  default = "false"
}

resource "cloudflare_ruleset" "mcp_ratelimit" {
  count   = var.mcp_waf_enabled == "true" ? 1 : 0
  zone_id = var.cloudflare_zone_id
  name    = "fitness-mcp-ratelimit"
  kind    = "zone"
  phase   = "http_ratelimit"

  rules {
    ref         = "mcp_ip_rate"
    description = "Per-IP request cap on the public MCP host (flood net)"
    expression  = "(http.host eq \"fitness-mcp.blueelephants.org\")"
    action      = "block"
    ratelimit {
      characteristics     = ["ip.src", "cf.colo.id"]
      period              = 10
      requests_per_period = 60
      mitigation_timeout  = 10
    }
  }
}
