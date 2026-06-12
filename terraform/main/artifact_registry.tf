resource "google_artifact_registry_repository" "backend" {
  location      = var.region
  repository_id = "fitness-tracker-backend"
  format        = "DOCKER"
}
