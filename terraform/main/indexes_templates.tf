resource "google_firestore_index" "templates_user_updated_at" {
  project    = var.project_id
  database   = google_firestore_database.db.name
  collection = "workout_templates"
  fields {
    field_path = "user_id"
    order      = "ASCENDING"
  }
  fields {
    field_path = "updated_at"
    order      = "DESCENDING"
  }
}
