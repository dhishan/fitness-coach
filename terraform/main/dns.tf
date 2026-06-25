resource "cloudflare_record" "api" {
  zone_id = var.cloudflare_zone_id
  name    = "api.fitness-tracker"
  type    = "CNAME"
  content = "ghs.googlehosted.com"
  proxied = false
}

# IMPORTANT: domain mapping must be created manually first (Search Console
# ownership - tf-github SA is not a verified owner), then imported:
#   gcloud alpha run domain-mappings create --service fitness-tracker-backend \
#     --domain api.fitness-tracker.blueelephants.org --region us-central1
#   terraform -chdir=terraform/main import \
#     'google_cloud_run_domain_mapping.api' \
#     'us-central1/api.fitness-tracker.blueelephants.org'
resource "cloudflare_record" "ui" {
  zone_id = var.cloudflare_zone_id
  name    = "ui.fitness-tracker"
  type    = "CNAME"
  content = "fitness-tracker-ble.web.app"
  proxied = false
}

resource "cloudflare_record" "mcp" {
  zone_id = var.cloudflare_zone_id
  name    = "mcp.fitness-tracker"
  type    = "CNAME"
  content = "ghs.googlehosted.com"
  # DNS-only: the MCP server now authenticates via Google OAuth (not Cloudflare
  # Access), so no proxy is needed. It also CANNOT be proxied — this is a
  # two-level subdomain that Cloudflare Universal SSL does not cover, so the
  # proxied path fails the TLS handshake. Google's Cloud Run managed cert serves
  # directly when DNS-only. (The public, DCR-fronted connector uses a separate
  # single-level host, fitness-mcp.*, which IS proxied for the Worker.)
  proxied = false
}

resource "google_cloud_run_domain_mapping" "api" {
  name     = var.api_domain
  location = var.region
  metadata {
    namespace = var.project_id
  }
  spec {
    route_name = google_cloud_run_v2_service.backend.name
  }
  # CI service account is not a verified owner of blueelephants.org; create
  # manually with user creds and never let CI modify it. See runbook.
  lifecycle {
    ignore_changes = all
  }
}

resource "google_cloud_run_domain_mapping" "mcp" {
  name     = var.mcp_domain
  location = var.region
  metadata {
    namespace = var.project_id
  }
  spec {
    route_name = google_cloud_run_v2_service.backend.name
  }
  lifecycle {
    ignore_changes = all
  }
}
