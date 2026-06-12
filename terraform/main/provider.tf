terraform {
  required_version = ">= 1.7"
  backend "gcs" {}
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "= 5.45.2"
    }
    google-beta = {
      source  = "hashicorp/google-beta"
      version = "= 5.45.2"
    }
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "= 4.52.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "= 3.6.3"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

provider "google-beta" {
  project = var.project_id
  region  = var.region
}

provider "cloudflare" {}
