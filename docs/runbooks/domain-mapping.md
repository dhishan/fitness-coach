# Domain mapping runbook

CI's service account cannot create Cloud Run domain mappings (not a verified
Search Console owner). One-time manual steps with user credentials:

1. gcloud alpha run domain-mappings create --service fitness-tracker-backend \
     --domain api.fitness-tracker.blueelephants.org --region us-central1 \
     --project personal-projects-473219
2. terraform -chdir=terraform/main import \
     'google_cloud_run_domain_mapping.api' \
     'us-central1/api.fitness-tracker.blueelephants.org'

If terraform state is ever lost, re-import (CI cannot recreate).
Cert provisioning takes up to 24h. The Cloudflare CNAME stays unproxied.

## MCP subdomain (added Phase 2)

Same one-time manual steps as the api domain:

```bash
gcloud alpha run domain-mappings create --service fitness-tracker-backend \
  --domain mcp.fitness-tracker.blueelephants.org --region us-central1 \
  --project personal-projects-473219

terraform -chdir=terraform/main import \
  'google_cloud_run_domain_mapping.mcp' \
  'us-central1/mcp.fitness-tracker.blueelephants.org'
```

The Cloudflare record for mcp is `proxied = true` so Cloudflare Access can
inject the `Cf-Access-Jwt-Assertion` header.
