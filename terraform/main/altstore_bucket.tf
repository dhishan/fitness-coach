# Shared bucket for the cross-project AltStore source.
# Single tiny JSON object that both fitness-coach and family-expense-tracker
# release workflows write to. Public read so AltStore can fetch it.
resource "google_storage_bucket" "altstore" {
  name                        = "blueelephants-altstore"
  location                    = var.region
  force_destroy               = false
  uniform_bucket_level_access = true

  cors {
    origin          = ["*"]
    method          = ["GET", "HEAD"]
    response_header = ["Content-Type"]
    max_age_seconds = 60
  }

  # Keep one extra version around in case a bad workflow run clobbers it.
  versioning {
    enabled = true
  }
  lifecycle_rule {
    condition {
      num_newer_versions = 5
      with_state         = "ARCHIVED"
    }
    action {
      type = "Delete"
    }
  }
}

# Public read.
resource "google_storage_bucket_iam_member" "altstore_public_read" {
  bucket = google_storage_bucket.altstore.name
  role   = "roles/storage.objectViewer"
  member = "allUsers"
}

# tf-github (CI in both repos) can write.
resource "google_storage_bucket_iam_member" "altstore_ci_writer" {
  bucket = google_storage_bucket.altstore.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:tf-github@personal-projects-473219.iam.gserviceaccount.com"
}

output "altstore_public_url" {
  value = "https://storage.googleapis.com/${google_storage_bucket.altstore.name}/altstore.json"
}
