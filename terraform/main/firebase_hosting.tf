resource "google_firebase_hosting_site" "ui" {
  provider = google-beta
  project  = var.project_id
  site_id  = "fitness-tracker-ui"
}

resource "google_firebase_hosting_custom_domain" "ui" {
  provider              = google-beta
  project               = var.project_id
  site_id               = google_firebase_hosting_site.ui.site_id
  custom_domain         = var.ui_domain
  wait_dns_verification = false
}

resource "google_project_iam_member" "ci_firebase_hosting_admin" {
  project = var.project_id
  role    = "roles/firebasehosting.admin"
  member  = "serviceAccount:tf-github@${var.project_id}.iam.gserviceaccount.com"
}
