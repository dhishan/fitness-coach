variable "project_id" {
  type    = string
  default = "personal-projects-473219"
}

variable "region" {
  type    = string
  default = "us-central1"
}

variable "env" {
  type    = string
  default = "prod"
}

variable "cloudflare_zone_id" {
  type    = string
  default = "1eb0ae8907a74b14d5226384b92946b7"
}

variable "api_domain" {
  type    = string
  default = "api.fitness-tracker.blueelephants.org"
}

variable "ui_domain" {
  type    = string
  default = "ui.fitness-tracker.blueelephants.org"
}

variable "allowed_emails" {
  type    = string
  default = "iamdhishan@gmail.com"
}

variable "google_oauth_client_id" {
  type    = string
  default = ""
}

variable "google_oauth_client_ids" {
  type    = string
  default = ""
}

variable "cf_access_team_domain" {
  type    = string
  default = ""
}

variable "cf_access_aud" {
  type    = string
  default = ""
}

variable "mcp_domain" {
  type    = string
  default = "mcp.fitness-tracker.blueelephants.org"
}
