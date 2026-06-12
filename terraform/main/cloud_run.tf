locals {
  image = "${var.region}-docker.pkg.dev/${var.project_id}/fitness-tracker-backend/backend:latest"
}

resource "google_cloud_run_v2_service" "backend" {
  name     = "fitness-tracker-backend"
  location = var.region
  ingress  = "INGRESS_TRAFFIC_ALL"

  template {
    annotations = {
      "deployed-at" = timestamp()
    }
    scaling {
      min_instance_count = 1
      max_instance_count = 2
    }
    containers {
      image = local.image
      resources {
        cpu_idle = false
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
      }
      env {
        name  = "ENVIRONMENT"
        value = var.env
      }
      env {
        name  = "GCP_PROJECT"
        value = var.project_id
      }
      env {
        name  = "FIRESTORE_DATABASE"
        value = google_firestore_database.db.name
      }
      env {
        name  = "ALLOWED_EMAILS"
        value = var.allowed_emails
      }
      env {
        name  = "GOOGLE_OAUTH_CLIENT_ID"
        value = var.google_oauth_client_id
      }
      env {
        name  = "CORS_ORIGINS"
        value = jsonencode(["http://localhost:5173", "https://${var.ui_domain}"])
      }
      env {
        name = "JWT_SECRET_KEY"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.jwt_secret.secret_id
            version = "latest"
          }
        }
      }
      env {
        name = "OPENAI_API_KEY"
        value_source {
          secret_key_ref {
            secret  = data.google_secret_manager_secret.openai_key.secret_id
            version = "latest"
          }
        }
      }
      env {
        name = "LANGFUSE_PUBLIC_KEY"
        value_source {
          secret_key_ref {
            secret  = data.google_secret_manager_secret.langfuse_public.secret_id
            version = "latest"
          }
        }
      }
      env {
        name = "LANGFUSE_SECRET_KEY"
        value_source {
          secret_key_ref {
            secret  = data.google_secret_manager_secret.langfuse_secret.secret_id
            version = "latest"
          }
        }
      }
      env {
        name  = "LANGFUSE_BASE_URL"
        value = "https://us.cloud.langfuse.com"
      }
    }
  }
  lifecycle {
    ignore_changes = [client, client_version]
  }
}

resource "google_cloud_run_v2_service_iam_member" "public" {
  name     = google_cloud_run_v2_service.backend.name
  location = var.region
  role     = "roles/run.invoker"
  member   = "allUsers"
}
