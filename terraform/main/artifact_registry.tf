resource "google_artifact_registry_repository" "backend" {
  location      = var.region
  repository_id = "fitness-tracker-backend"
  format        = "DOCKER"

  # Every deploy pushes :latest and orphans the previous image, so untagged
  # digests pile up and accrue storage cost. Keep the 5 newest versions
  # (current + rollback headroom) and delete untagged images older than 7 days.
  # dry_run=false so this also prunes the existing backlog.
  cleanup_policy_dry_run = false
  cleanup_policies {
    id     = "keep-recent-5"
    action = "KEEP"
    most_recent_versions {
      keep_count = 5
    }
  }
  cleanup_policies {
    id     = "delete-untagged-7d"
    action = "DELETE"
    condition {
      tag_state  = "UNTAGGED"
      older_than = "604800s"
    }
  }
}
