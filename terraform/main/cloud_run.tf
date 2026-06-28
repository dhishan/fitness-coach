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
      # Scale to zero when idle. The coach streams over an open SSE request (CPU
      # stays allocated for the life of that request) and the workout-title job
      # is client-triggered, so nothing relies on a post-response background task
      # that a torn-down container would kill. Cold start adds ~1-3s on the first
      # request after idle. Trades that latency for ~$0 idle compute.
      min_instance_count = 0
      max_instance_count = 2
    }
    containers {
      image = local.image
      resources {
        # CPU throttled when no request is active; SSE streams keep CPU allocated
        # during chat generation.
        cpu_idle = true
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
        name  = "GOOGLE_OAUTH_CLIENT_IDS"
        value = var.google_oauth_client_ids
      }
      # Public MCP connector (Phase 1). Off until launch; gateway secret empty
      # disables the Worker-gateway auth path. Both fed from GH secrets via TF_VAR.
      env {
        name  = "PUBLIC_SIGNUP_ENABLED"
        value = var.public_signup_enabled
      }
      env {
        name  = "MCP_GATEWAY_SECRET"
        value = var.mcp_gateway_secret
      }
      env {
        name  = "CORS_ORIGINS"
        value = jsonencode(["http://localhost:5173", "https://${var.ui_domain}", "https://fitness-tracker-ble.web.app"])
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
        name = "USDA_API_KEY"
        value_source {
          secret_key_ref {
            secret  = data.google_secret_manager_secret.usda_key.secret_id
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
      env {
        name = "SENTRY_DSN"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.sentry_dsn_backend.secret_id
            version = "latest"
          }
        }
      }
      env {
        name  = "SENTRY_ENVIRONMENT"
        value = var.env
      }
      env {
        name  = "CF_ACCESS_TEAM_DOMAIN"
        value = var.cf_access_team_domain
      }
      env {
        name  = "CF_ACCESS_AUD"
        value = var.cf_access_aud
      }
      env {
        name  = "CHAT_MODEL_CHEAP"
        value = "openai/gpt-4o-mini"
      }
      env {
        name  = "CHAT_ROUTER_ENABLED"
        value = "true"
      }
      env {
        name  = "UPLOADS_BUCKET"
        value = google_storage_bucket.uploads.name
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
