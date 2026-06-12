resource "random_password" "jwt_secret" {
  length  = 64
  special = false
}

resource "google_secret_manager_secret" "jwt_secret" {
  secret_id = "fitness-tracker-jwt-secret-${var.env}"
  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_version" "jwt_secret" {
  secret      = google_secret_manager_secret.jwt_secret.id
  secret_data = random_password.jwt_secret.result
}

data "google_project" "project" {}

resource "google_secret_manager_secret_iam_member" "jwt_secret_accessor" {
  secret_id = google_secret_manager_secret.jwt_secret.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${data.google_project.project.number}-compute@developer.gserviceaccount.com"
}

data "google_secret_manager_secret" "openai_key" {
  secret_id = "fitness-tracker-openai-key-prod"
}

resource "google_secret_manager_secret_iam_member" "openai_key_accessor" {
  secret_id = data.google_secret_manager_secret.openai_key.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${data.google_project.project.number}-compute@developer.gserviceaccount.com"
}

data "google_secret_manager_secret" "langfuse_public" {
  secret_id = "fitness-tracker-langfuse-public-prod"
}

resource "google_secret_manager_secret_iam_member" "langfuse_public_accessor" {
  secret_id = data.google_secret_manager_secret.langfuse_public.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${data.google_project.project.number}-compute@developer.gserviceaccount.com"
}

data "google_secret_manager_secret" "langfuse_secret" {
  secret_id = "fitness-tracker-langfuse-secret-prod"
}

resource "google_secret_manager_secret_iam_member" "langfuse_secret_accessor" {
  secret_id = data.google_secret_manager_secret.langfuse_secret.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${data.google_project.project.number}-compute@developer.gserviceaccount.com"
}
