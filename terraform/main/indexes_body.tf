resource "google_firestore_index" "body_metrics_user_date_desc" {
  project    = var.project_id
  database   = google_firestore_database.db.name
  collection = "body_metrics"
  fields {
    field_path = "user_id"
    order      = "ASCENDING"
  }
  fields {
    field_path = "date"
    order      = "DESCENDING"
  }
}
