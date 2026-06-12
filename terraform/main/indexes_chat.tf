resource "google_firestore_index" "chat_conversations_user_updated" {
  project    = var.project_id
  database   = google_firestore_database.db.name
  collection = "chat_conversations"
  fields {
    field_path = "user_id"
    order      = "ASCENDING"
  }
  fields {
    field_path = "updated_at"
    order      = "DESCENDING"
  }
}

resource "google_firestore_index" "usage_events_user_created" {
  project    = var.project_id
  database   = google_firestore_database.db.name
  collection = "usage_events"
  fields {
    field_path = "user_id"
    order      = "ASCENDING"
  }
  fields {
    field_path = "created_at"
    order      = "DESCENDING"
  }
}
