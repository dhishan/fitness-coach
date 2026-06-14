# Cloudflare Worker that serves the shared AltStore source at
# https://apps.blueelephants.org/altstore.json, proxying the GCS bucket below.

locals {
  # Resolved via Cloudflare zones API (the token can read its own zone).
  cf_account_id = "8f47aec7a2756ec1917e4993e9de1da7"
}

resource "cloudflare_worker_script" "altstore" {
  account_id = local.cf_account_id
  name       = "blueelephants-altstore"
  content    = file("${path.module}/altstore_worker.js")
  module     = true
}

# Custom domain binding (creates the DNS record + cert automatically).
resource "cloudflare_worker_domain" "altstore" {
  account_id  = local.cf_account_id
  zone_id     = var.cloudflare_zone_id
  hostname    = "apps.blueelephants.org"
  service     = cloudflare_worker_script.altstore.name
  environment = "production"
}

output "altstore_pretty_url" {
  value = "https://apps.blueelephants.org/altstore.json"
}
