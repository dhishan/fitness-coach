resource "google_storage_bucket" "uploads" {
  name          = "fitness-tracker-uploads-${var.env}"
  location      = var.region
  force_destroy = false
  uniform_bucket_level_access = true

  cors {
    origin          = ["http://localhost:5173", "https://${var.ui_domain}", "https://fitness-tracker-ble.web.app"]
    method          = ["GET", "PUT", "POST", "HEAD"]
    response_header = ["Content-Type", "Content-Length"]
    max_age_seconds = 3600
  }

  lifecycle_rule {
    condition { age = 30 }
    action    { type = "Delete" }
  }
}

resource "google_storage_bucket_iam_member" "uploads_sa_object_admin" {
  bucket = google_storage_bucket.uploads.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${data.google_project.project.number}-compute@developer.gserviceaccount.com"
}

resource "google_service_account_iam_member" "compute_sa_token_creator_self" {
  service_account_id = "projects/${var.project_id}/serviceAccounts/${data.google_project.project.number}-compute@developer.gserviceaccount.com"
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "serviceAccount:${data.google_project.project.number}-compute@developer.gserviceaccount.com"
}
