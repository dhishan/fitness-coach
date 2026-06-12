resource "google_firestore_database" "db" {
  project     = var.project_id
  name        = "fitness-tracker-dev"
  location_id = "nam5"
  type        = "FIRESTORE_NATIVE"
}
