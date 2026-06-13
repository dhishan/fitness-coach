resource "google_firestore_index" "cardio_logs_user_date_desc" {
  project    = var.project_id
  database   = google_firestore_database.db.name
  collection = "cardio_logs"
  fields {
    field_path = "user_id"
    order      = "ASCENDING"
  }
  fields {
    field_path = "date"
    order      = "DESCENDING"
  }
}

resource "google_firestore_index" "cardio_logs_user_external_id" {
  project    = var.project_id
  database   = google_firestore_database.db.name
  collection = "cardio_logs"
  fields {
    field_path = "user_id"
    order      = "ASCENDING"
  }
  fields {
    field_path = "external_id"
    order      = "ASCENDING"
  }
}
