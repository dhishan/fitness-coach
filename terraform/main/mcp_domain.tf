# IMPORTANT: same domain-mapping landmine as api - create manually first, then import.
# See docs/runbooks/domain-mapping.md.
resource "google_cloud_run_domain_mapping" "mcp" {
  name     = var.mcp_domain
  location = var.region
  metadata { namespace = var.project_id }
  spec     { route_name = google_cloud_run_v2_service.backend.name }
}
