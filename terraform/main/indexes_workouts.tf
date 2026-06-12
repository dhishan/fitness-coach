resource "google_firestore_index" "workouts_user_date" {
  project    = var.project_id
  database   = google_firestore_database.db.name
  collection = "workouts"
  fields {
    field_path = "user_id"
    order      = "ASCENDING"
  }
  fields {
    field_path = "date"
    order      = "DESCENDING"
  }
}

resource "google_firestore_index" "workouts_user_date_asc" {
  project    = var.project_id
  database   = google_firestore_database.db.name
  collection = "workouts"
  fields {
    field_path = "user_id"
    order      = "ASCENDING"
  }
  fields {
    field_path = "date"
    order      = "ASCENDING"
  }
}

resource "google_firestore_index" "workouts_user_exercise_date" {
  project    = var.project_id
  database   = google_firestore_database.db.name
  collection = "workouts"
  fields {
    field_path   = "exercise_ids"
    array_config = "CONTAINS"
  }
  fields {
    field_path = "user_id"
    order      = "ASCENDING"
  }
  fields {
    field_path = "date"
    order      = "DESCENDING"
  }
}
