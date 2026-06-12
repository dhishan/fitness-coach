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
resource "google_cloud_run_domain_mapping" "api" {
  name     = var.api_domain
  location = var.region
  metadata {
    namespace = var.project_id
  }
  spec {
    route_name = google_cloud_run_v2_service.backend.name
  }
}
