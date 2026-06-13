resource "google_firestore_index" "food_logs_user_date_asc" {
  project    = var.project_id
  database   = google_firestore_database.db.name
  collection = "food_logs"
  fields {
    field_path = "user_id"
    order      = "ASCENDING"
  }
  fields {
    field_path = "date"
    order      = "ASCENDING"
  }
}

resource "google_firestore_index" "food_logs_user_date_desc" {
  project    = var.project_id
  database   = google_firestore_database.db.name
  collection = "food_logs"
  fields {
    field_path = "user_id"
    order      = "ASCENDING"
  }
  fields {
    field_path = "date"
    order      = "DESCENDING"
  }
}

resource "google_firestore_index" "favorites_user_last_used" {
  project    = var.project_id
  database   = google_firestore_database.db.name
  collection = "favorites"
  fields {
    field_path = "user_id"
    order      = "ASCENDING"
  }
  fields {
    field_path = "last_used_at"
    order      = "DESCENDING"
  }
}
