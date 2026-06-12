# Plan 1: Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deployable FastAPI skeleton on Cloud Run with Google auth + allowlist, Firestore (named DB), Terraform infra, and CI - verified end to end by calling the deployed `/health` and `/api/v1/auth/google` endpoints.

**Architecture:** Single FastAPI app, settings-driven config (`pydantic-settings` + `lru_cache`), Google ID token verification -> app JWT (HS256), async auth dependency using `asyncio.to_thread` for Firestore. Terraform mirrors family-expense-tracker layout (`terraform/main/` + `terraform/workspaces/prod/`). CI via GitHub Actions + WIF (repo `dhishan/fitness-coach`).

**Tech Stack:** Python 3.12, FastAPI, pydantic-settings, google-auth, PyJWT, google-cloud-firestore, pytest, Terraform (google/google-beta pinned), GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-06-12-fitness-tracker-design.md`
**Lessons doc (binding):** `docs/superpowers/research/2026-06-12-expense-tracker-code-analysis.md`

**End-of-plan E2E check:** `curl https://api.fitness-tracker.blueelephants.org/health` returns `{"status":"ok"}`; auth with a real Google ID token returns a JWT; non-allowlisted email gets 403.

---

### Task 0: One-time manual GCP/GitHub bootstrap (human or carefully-verified agent)

**Files:** none (gcloud/gh commands)

- [ ] **Step 1: Add repo to WIF pool**

```bash
gcloud iam service-accounts add-iam-policy-binding \
  tf-github@personal-projects-473219.iam.gserviceaccount.com \
  --member="principalSet://iam.googleapis.com/projects/610355955735/locations/global/workloadIdentityPools/github-pool/attribute.repository/dhishan/fitness-coach" \
  --role="roles/iam.workloadIdentityUser"
```

Expected: policy binding added (note: repo is `fitness-coach`, NOT `fitness-tracker`).

- [ ] **Step 2: Set GitHub secrets**

```bash
gh secret set GCP_WORKLOAD_IDENTITY_PROVIDER --repo dhishan/fitness-coach --body "projects/610355955735/locations/global/workloadIdentityPools/github-pool/providers/github-provider"
gh secret set GCP_SERVICE_ACCOUNT --repo dhishan/fitness-coach --body "tf-github@personal-projects-473219.iam.gserviceaccount.com"
# CLOUDFLARE_API_TOKEN: copy value from family-expense-tracker repo secrets (same zone token)
```

Verify provider resource name first: `gcloud iam workload-identity-pools providers list --workload-identity-pool=github-pool --location=global --project=personal-projects-473219`

- [ ] **Step 3: Verify state bucket access**

```bash
gsutil ls gs://dhishan-terraform-assets/ | head
```

Expected: listing succeeds.

---

### Task 1: Repo skeleton + Makefile

**Files:**
- Create: `Makefile`, `backend/requirements.txt`, `backend/requirements-dev.txt`, `backend/.python-version`, `.gitignore` (modify)

- [ ] **Step 1: Create backend requirements**

`backend/requirements.txt`:
```
fastapi==0.115.6
uvicorn[standard]==0.34.0
pydantic-settings==2.7.0
google-cloud-firestore==2.19.0
google-auth==2.37.0
requests==2.32.3
PyJWT==2.10.1
```

`backend/requirements-dev.txt`:
```
-r requirements.txt
pytest==8.3.4
pytest-asyncio==0.25.0
httpx==0.28.1
```

`backend/.python-version`:
```
3.12
```

- [ ] **Step 2: Create Makefile**

```makefile
TF_DIR=terraform/main
TF_ENV?=prod

.PHONY: backend-install backend-dev backend-test terraform-init terraform-plan terraform-apply

backend-install: ## install backend deps into .venv
	cd backend && python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt

backend-dev: ## run backend locally
	cd backend && .venv/bin/uvicorn app.main:app --reload --port 8000

backend-test: ## run backend tests
	cd backend && .venv/bin/pytest -q

terraform-init:
	terraform -chdir=$(TF_DIR) init -backend-config=../workspaces/$(TF_ENV)/backend.conf

terraform-plan:
	terraform -chdir=$(TF_DIR) plan -var-file=../workspaces/$(TF_ENV)/terraform.tfvars

terraform-apply:
	terraform -chdir=$(TF_DIR) apply -auto-approve -var-file=../workspaces/$(TF_ENV)/terraform.tfvars
```

- [ ] **Step 3: Extend .gitignore**

Append to `.gitignore`:
```
.venv/
__pycache__/
*.pyc
.pytest_cache/
.terraform/
*.tfstate*
backend/.env
```

- [ ] **Step 4: Commit**

```bash
git add Makefile backend/requirements.txt backend/requirements-dev.txt backend/.python-version .gitignore
git commit -m "chore: repo skeleton, Makefile, backend deps"
```

---

### Task 2: Settings module

**Files:**
- Create: `backend/app/__init__.py`, `backend/app/config.py`
- Test: `backend/tests/__init__.py`, `backend/tests/conftest.py`, `backend/tests/test_config.py`

- [ ] **Step 1: Write conftest (env vars BEFORE imports, patch Firestore)**

`backend/tests/conftest.py`:
```python
import os
from unittest.mock import MagicMock, patch

# Set env BEFORE any app import (lesson: expense-tracker conftest pattern)
os.environ.setdefault("ENVIRONMENT", "test")
os.environ.setdefault("GCP_PROJECT", "test-project")
os.environ.setdefault("FIRESTORE_DATABASE", "test-database")
os.environ.setdefault("JWT_SECRET_KEY", "test-secret")
os.environ.setdefault("ALLOWED_EMAILS", "iamdhishan@gmail.com")
os.environ.setdefault("GOOGLE_OAUTH_CLIENT_ID", "test-client-id.apps.googleusercontent.com")

_firestore_patcher = patch("google.cloud.firestore.Client", MagicMock())
_firestore_patcher.start()

import pytest
from fastapi.testclient import TestClient


@pytest.fixture()
def client():
    from app.main import app
    return TestClient(app)


@pytest.fixture()
def mock_db():
    from app import firestore as fs
    mock = MagicMock()
    fs._client = mock
    yield mock
    fs._client = None
```

- [ ] **Step 2: Write failing test**

`backend/tests/test_config.py`:
```python
def test_settings_load_from_env():
    from app.config import get_settings
    s = get_settings()
    assert s.environment == "test"
    assert s.firestore_database == "test-database"
    assert "iamdhishan@gmail.com" in s.allowed_emails_list
    assert s.cors_origins == ["http://localhost:5173"]
```

Also create empty `backend/app/__init__.py`, `backend/tests/__init__.py`.

- [ ] **Step 3: Run test to verify it fails**

Run: `cd backend && .venv/bin/pytest tests/test_config.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.config'`

- [ ] **Step 4: Implement config**

`backend/app/config.py`:
```python
from functools import lru_cache

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    environment: str = "development"
    gcp_project: str = "personal-projects-473219"
    firestore_database: str = "fitness-tracker-dev"
    jwt_secret_key: str = "dev-only-secret"
    jwt_expiry_hours: int = 24 * 30
    google_oauth_client_id: str = ""
    allowed_emails: str = "iamdhishan@gmail.com"
    # ALL origins from settings, none hardcoded in main.py (lesson #6)
    cors_origins: list[str] = ["http://localhost:5173"]

    model_config = {"extra": "ignore", "env_file": ".env"}

    @property
    def allowed_emails_list(self) -> list[str]:
        return [e.strip().lower() for e in self.allowed_emails.split(",") if e.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && .venv/bin/pytest tests/test_config.py -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/app backend/tests
git commit -m "feat: settings module with env-driven config"
```

---

### Task 3: Firestore client (named DB) + health endpoint

**Files:**
- Create: `backend/app/firestore.py`, `backend/app/main.py`
- Test: `backend/tests/test_health.py`

- [ ] **Step 1: Write failing test**

`backend/tests/test_health.py`:
```python
def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


def test_cors_header_on_allowed_origin(client):
    r = client.get("/health", headers={"Origin": "http://localhost:5173"})
    assert r.headers.get("access-control-allow-origin") == "http://localhost:5173"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && .venv/bin/pytest tests/test_health.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.main'`

- [ ] **Step 3: Implement firestore module and main app**

`backend/app/firestore.py`:
```python
from google.cloud import firestore

from app.config import get_settings

_client: firestore.Client | None = None


def get_db() -> firestore.Client:
    global _client
    if _client is None:
        s = get_settings()
        # Named DB always - (default) is never used (lesson: named DB everywhere)
        _client = firestore.Client(project=s.gcp_project, database=s.firestore_database)
    return _client
```

`backend/app/main.py`:
```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings

app = FastAPI(title="fitness-tracker-backend")

settings = get_settings()
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {"status": "ok"}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && .venv/bin/pytest -v`
Expected: 3 PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/firestore.py backend/app/main.py backend/tests/test_health.py
git commit -m "feat: FastAPI app with health endpoint and named-DB Firestore client"
```

---

### Task 4: JWT helpers

**Files:**
- Create: `backend/app/auth/__init__.py`, `backend/app/auth/tokens.py`
- Test: `backend/tests/test_tokens.py`

- [ ] **Step 1: Write failing test**

`backend/tests/test_tokens.py`:
```python
import pytest


def test_create_and_verify_roundtrip():
    from app.auth.tokens import create_access_token, verify_access_token
    token = create_access_token(user_id="uid123", email="iamdhishan@gmail.com")
    payload = verify_access_token(token)
    assert payload["sub"] == "uid123"
    assert payload["email"] == "iamdhishan@gmail.com"


def test_verify_rejects_garbage():
    from app.auth.tokens import verify_access_token
    with pytest.raises(Exception):
        verify_access_token("not-a-token")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && .venv/bin/pytest tests/test_tokens.py -v`
Expected: FAIL with ModuleNotFoundError

- [ ] **Step 3: Implement**

`backend/app/auth/__init__.py`: empty.

`backend/app/auth/tokens.py`:
```python
from datetime import datetime, timedelta, timezone

import jwt

from app.config import get_settings

ALGORITHM = "HS256"


def create_access_token(user_id: str, email: str) -> str:
    s = get_settings()
    payload = {
        "sub": user_id,
        "email": email,
        "exp": datetime.now(timezone.utc) + timedelta(hours=s.jwt_expiry_hours),
        "iat": datetime.now(timezone.utc),
    }
    return jwt.encode(payload, s.jwt_secret_key, algorithm=ALGORITHM)


def verify_access_token(token: str) -> dict:
    s = get_settings()
    # algorithms pinned - never trust the token header (lesson: RS256 pinning in cloudflare.py)
    return jwt.decode(token, s.jwt_secret_key, algorithms=[ALGORITHM])
```

- [ ] **Step 4: Run tests**

Run: `cd backend && .venv/bin/pytest tests/test_tokens.py -v`
Expected: 2 PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/auth backend/tests/test_tokens.py
git commit -m "feat: JWT create/verify helpers with pinned algorithm"
```

---

### Task 5: Google auth endpoint with allowlist

**Files:**
- Create: `backend/app/auth/router.py`, `backend/app/auth/google.py`
- Modify: `backend/app/main.py`
- Test: `backend/tests/test_auth.py`

- [ ] **Step 1: Write failing tests**

`backend/tests/test_auth.py`:
```python
from unittest.mock import patch


def _fake_idinfo(email="iamdhishan@gmail.com"):
    return {"sub": "google-uid-1", "email": email, "name": "Dhishan", "email_verified": True}


def test_auth_google_success(client, mock_db):
    with patch("app.auth.router.verify_google_id_token", return_value=_fake_idinfo()):
        r = client.post("/api/v1/auth/google", json={"id_token": "fake"})
    assert r.status_code == 200
    body = r.json()
    assert "access_token" in body
    assert body["user"]["email"] == "iamdhishan@gmail.com"
    # user doc upserted
    mock_db.collection.assert_any_call("users")


def test_auth_google_rejects_non_allowlisted(client, mock_db):
    with patch("app.auth.router.verify_google_id_token", return_value=_fake_idinfo("evil@example.com")):
        r = client.post("/api/v1/auth/google", json={"id_token": "fake"})
    assert r.status_code == 403


def test_auth_google_rejects_invalid_token(client, mock_db):
    with patch("app.auth.router.verify_google_id_token", side_effect=ValueError("bad")):
        r = client.post("/api/v1/auth/google", json={"id_token": "fake"})
    assert r.status_code == 401
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && .venv/bin/pytest tests/test_auth.py -v`
Expected: FAIL (404s / import errors)

- [ ] **Step 3: Implement**

`backend/app/auth/google.py`:
```python
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token as google_id_token

from app.config import get_settings


def verify_google_id_token(token: str) -> dict:
    """Raises ValueError on invalid token."""
    s = get_settings()
    return google_id_token.verify_oauth2_token(
        token, google_requests.Request(), s.google_oauth_client_id
    )
```

`backend/app/auth/router.py`:
```python
import asyncio
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.auth.google import verify_google_id_token
from app.auth.tokens import create_access_token
from app.config import get_settings
from app.firestore import get_db

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])


class GoogleAuthRequest(BaseModel):
    id_token: str


@router.post("/google")
async def auth_google(body: GoogleAuthRequest):
    try:
        idinfo = await asyncio.to_thread(verify_google_id_token, body.id_token)
    except ValueError:
        raise HTTPException(status_code=401, detail="Invalid Google token")

    email = (idinfo.get("email") or "").lower()
    s = get_settings()
    if email not in s.allowed_emails_list:
        raise HTTPException(status_code=403, detail="Not allowed")

    uid = idinfo["sub"]

    def _upsert():
        db = get_db()
        ref = db.collection("users").document(uid)
        ref.set(
            {
                "email": email,
                "display_name": idinfo.get("name", ""),
                "preferred_units": "kg",
                "updated_at": datetime.now(timezone.utc),
            },
            merge=True,
        )

    # all Firestore in async paths via to_thread (lesson #5)
    await asyncio.to_thread(_upsert)

    return {
        "access_token": create_access_token(user_id=uid, email=email),
        "token_type": "bearer",
        "user": {"id": uid, "email": email, "display_name": idinfo.get("name", "")},
    }
```

Modify `backend/app/main.py` - add after middleware:
```python
from app.auth.router import router as auth_router

app.include_router(auth_router)
```

- [ ] **Step 4: Run all tests**

Run: `cd backend && .venv/bin/pytest -v`
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app backend/tests/test_auth.py
git commit -m "feat: Google auth endpoint with email allowlist and user upsert"
```

---

### Task 6: Auth dependency (get_current_user)

**Files:**
- Create: `backend/app/auth/dependencies.py`
- Test: `backend/tests/test_dependencies.py`

- [ ] **Step 1: Write failing test**

`backend/tests/test_dependencies.py`:
```python
import pytest
from fastapi import HTTPException


@pytest.mark.asyncio
async def test_current_user_from_valid_token():
    from app.auth.dependencies import get_current_user
    from app.auth.tokens import create_access_token
    token = create_access_token(user_id="uid123", email="iamdhishan@gmail.com")
    user = await get_current_user(authorization=f"Bearer {token}")
    assert user.user_id == "uid123"
    assert user.email == "iamdhishan@gmail.com"


@pytest.mark.asyncio
async def test_current_user_rejects_missing_header():
    from app.auth.dependencies import get_current_user
    with pytest.raises(HTTPException) as e:
        await get_current_user(authorization=None)
    assert e.value.status_code == 401


@pytest.mark.asyncio
async def test_current_user_rejects_bad_token():
    from app.auth.dependencies import get_current_user
    with pytest.raises(HTTPException) as e:
        await get_current_user(authorization="Bearer garbage")
    assert e.value.status_code == 401
```

Add to `backend/requirements-dev.txt` if missing: `pytest-asyncio` already present. Add `asyncio_mode = "auto"` is NOT used; tests use explicit marker. Create `backend/pytest.ini`:
```ini
[pytest]
asyncio_default_fixture_loop_scope = function
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && .venv/bin/pytest tests/test_dependencies.py -v`
Expected: FAIL ModuleNotFoundError

- [ ] **Step 3: Implement**

`backend/app/auth/dependencies.py`:
```python
from dataclasses import dataclass

import jwt
from fastapi import Header, HTTPException

from app.auth.tokens import verify_access_token


@dataclass
class CurrentUser:
    user_id: str
    email: str


async def get_current_user(authorization: str | None = Header(default=None)) -> CurrentUser:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token")
    token = authorization.removeprefix("Bearer ")
    try:
        payload = verify_access_token(token)
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Invalid token")
    return CurrentUser(user_id=payload["sub"], email=payload["email"])
```

Note: no per-request Firestore read - the JWT is the source of truth (lesson #5: the sibling's per-request sync Firestore read in the auth dependency was a latency cliff; single-user app doesn't need revocation-by-doc).

- [ ] **Step 4: Run all tests**

Run: `cd backend && .venv/bin/pytest -v`
Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/auth/dependencies.py backend/tests/test_dependencies.py backend/pytest.ini
git commit -m "feat: bearer-JWT auth dependency"
```

---

### Task 7: Dockerfile

**Files:**
- Create: `backend/Dockerfile`, `backend/.dockerignore`

- [ ] **Step 1: Write Dockerfile**

`backend/Dockerfile`:
```dockerfile
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app ./app
ENV PORT=8080
CMD exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT}
```

`backend/.dockerignore`:
```
.venv
__pycache__
tests
.pytest_cache
.env
```

- [ ] **Step 2: Verify build locally**

Run: `cd backend && docker build -t fitness-tracker-backend:local . && docker run --rm -p 8081:8080 -e JWT_SECRET_KEY=x -e GOOGLE_OAUTH_CLIENT_ID=x -d --name ft-test fitness-tracker-backend:local && sleep 2 && curl -s localhost:8081/health && docker rm -f ft-test`
Expected: `{"status":"ok"}`

- [ ] **Step 3: Commit**

```bash
git add backend/Dockerfile backend/.dockerignore
git commit -m "feat: backend Dockerfile"
```

---

### Task 8: Terraform - providers, backend, variables

**Files:**
- Create: `terraform/main/provider.tf`, `terraform/main/variables.tf`, `terraform/workspaces/prod/backend.conf`, `terraform/workspaces/prod/terraform.tfvars`

- [ ] **Step 1: Write provider config (exact pins - lesson #15)**

`terraform/main/provider.tf`:
```hcl
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
```

`terraform/main/variables.tf`:
```hcl
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
  default = "" # set after Firebase web app registration
}
```

`terraform/workspaces/prod/backend.conf`:
```hcl
bucket = "dhishan-terraform-assets"
prefix = "fitness-tracker/prod/state"
```

`terraform/workspaces/prod/terraform.tfvars`:
```hcl
env = "prod"
```

- [ ] **Step 2: Validate**

Run: `make terraform-init && terraform -chdir=terraform/main validate`
Expected: `Success! The configuration is valid.`

- [ ] **Step 3: Commit**

```bash
git add terraform/
git commit -m "feat: terraform providers, backend, variables (exact pins)"
```

---

### Task 9: Terraform - Firestore DB + workout/chat indexes (split files)

**Files:**
- Create: `terraform/main/firestore.tf`, `terraform/main/indexes_workouts.tf`, `terraform/main/indexes_chat.tf`

- [ ] **Step 1: Write firestore.tf**

```hcl
resource "google_firestore_database" "db" {
  project     = var.project_id
  name        = "fitness-tracker-dev"
  location_id = "nam5"
  type        = "FIRESTORE_NATIVE"
}
```

- [ ] **Step 2: Write indexes_workouts.tf**

```hcl
resource "google_firestore_index" "workouts_user_date" {
  project    = var.project_id
  database   = google_firestore_database.db.name
  collection = "workouts"
  fields {
    field_path = "user_id"
    order      = "ASCENDING"
  }
  fields {
    field_path = "date"
    order      = "DESCENDING"
  }
}

resource "google_firestore_index" "workouts_user_exercise_date" {
  project    = var.project_id
  database   = google_firestore_database.db.name
  collection = "workouts"
  fields {
    field_path   = "exercise_ids"
    array_config = "CONTAINS"
  }
  fields {
    field_path = "user_id"
    order      = "ASCENDING"
  }
  fields {
    field_path = "date"
    order      = "DESCENDING"
  }
}
```

- [ ] **Step 3: Write indexes_chat.tf**

```hcl
resource "google_firestore_index" "chat_conversations_user_updated" {
  project    = var.project_id
  database   = google_firestore_database.db.name
  collection = "chat_conversations"
  fields {
    field_path = "user_id"
    order      = "ASCENDING"
  }
  fields {
    field_path = "updated_at"
    order      = "DESCENDING"
  }
}

resource "google_firestore_index" "usage_events_user_created" {
  project    = var.project_id
  database   = google_firestore_database.db.name
  collection = "usage_events"
  fields {
    field_path = "user_id"
    order      = "ASCENDING"
  }
  fields {
    field_path = "created_at"
    order      = "DESCENDING"
  }
}
```

- [ ] **Step 4: Validate + commit**

Run: `terraform -chdir=terraform/main validate`
Expected: valid.

```bash
git add terraform/main/firestore.tf terraform/main/indexes_workouts.tf terraform/main/indexes_chat.tf
git commit -m "feat: firestore named DB and day-one composite indexes"
```

---

### Task 10: Terraform - Artifact Registry, secrets, Cloud Run

**Files:**
- Create: `terraform/main/artifact_registry.tf`, `terraform/main/secrets.tf`, `terraform/main/cloud_run.tf`, `terraform/main/outputs.tf`

- [ ] **Step 1: Artifact Registry**

`terraform/main/artifact_registry.tf`:
```hcl
resource "google_artifact_registry_repository" "backend" {
  location      = var.region
  repository_id = "fitness-tracker-backend"
  format        = "DOCKER"
}
```

- [ ] **Step 2: JWT secret**

`terraform/main/secrets.tf`:
```hcl
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
```

- [ ] **Step 3: Cloud Run service**

`terraform/main/cloud_run.tf`:
```hcl
locals {
  image = "${var.region}-docker.pkg.dev/${var.project_id}/fitness-tracker-backend/backend:latest"
}

resource "google_cloud_run_v2_service" "backend" {
  name     = "fitness-tracker-backend"
  location = var.region
  ingress  = "INGRESS_TRAFFIC_ALL"

  template {
    annotations = {
      # :latest won't re-pull without a metadata change (lesson: revision annotation)
      "deployed-at" = timestamp()
    }
    scaling {
      min_instance_count = 1
      max_instance_count = 2
    }
    containers {
      image = local.image
      resources {
        cpu_idle = false # cpu always allocated - chat background generation needs it
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
```

- [ ] **Step 4: Outputs**

`terraform/main/outputs.tf`:
```hcl
output "cloud_run_url" {
  value = google_cloud_run_v2_service.backend.uri
}
```

- [ ] **Step 5: Validate + commit**

Run: `terraform -chdir=terraform/main validate`
Expected: valid.

```bash
git add terraform/main/artifact_registry.tf terraform/main/secrets.tf terraform/main/cloud_run.tf terraform/main/outputs.tf
git commit -m "feat: artifact registry, jwt secret, cloud run service"
```

Note: `CORS_ORIGINS` as JSON list parses into `Settings.cors_origins` via pydantic-settings automatically.

---

### Task 11: Terraform - DNS + domain mapping (manual-create + import)

**Files:**
- Create: `terraform/main/dns.tf`, `docs/runbooks/domain-mapping.md`

- [ ] **Step 1: dns.tf**

```hcl
resource "cloudflare_record" "api" {
  zone_id = var.cloudflare_zone_id
  name    = "api.fitness-tracker"
  type    = "CNAME"
  content = "ghs.googlehosted.com"
  proxied = false
}

# IMPORTANT: domain mapping must be created manually first (Search Console
# ownership - tf-github SA is not a verified owner), then imported:
#   gcloud alpha run domain-mappings create --service fitness-tracker-backend \
#     --domain api.fitness-tracker.blueelephants.org --region us-central1
#   terraform -chdir=terraform/main import \
#     'google_cloud_run_domain_mapping.api' \
#     'us-central1/api.fitness-tracker.blueelephants.org'
resource "google_cloud_run_domain_mapping" "api" {
  name     = var.api_domain
  location = var.region
  metadata {
    namespace = var.project_id
  }
  spec {
    route_name = google_cloud_run_v2_service.backend.name
  }
}
```

- [ ] **Step 2: Runbook**

`docs/runbooks/domain-mapping.md`:
```markdown
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
```

- [ ] **Step 3: Validate + commit**

Run: `terraform -chdir=terraform/main validate`

```bash
git add terraform/main/dns.tf docs/runbooks/domain-mapping.md
git commit -m "feat: api DNS record and domain mapping with import runbook"
```

---

### Task 12: CI - ci-cd.yml + infra-deploy.yml

**Files:**
- Create: `.github/workflows/ci-cd.yml`, `.github/workflows/infra-deploy.yml`

- [ ] **Step 1: ci-cd.yml**

```yaml
name: CI/CD
on:
  push:
    branches: [main]
  pull_request:

env:
  PROJECT_ID: personal-projects-473219
  REGION: us-central1
  TF_ENV: prod

jobs:
  test-backend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: '3.12'
      - run: pip install -r backend/requirements-dev.txt
      - run: cd backend && pytest -q   # lint/test failures FAIL CI - no '|| true'

  deploy-backend:
    if: github.ref == 'refs/heads/main' && github.event_name == 'push'
    needs: [test-backend]
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write    # required for WIF on EVERY GCP job
    steps:
      - uses: actions/checkout@v4
      - uses: google-github-actions/auth@v3
        with:
          workload_identity_provider: ${{ secrets.GCP_WORKLOAD_IDENTITY_PROVIDER }}
          service_account: ${{ secrets.GCP_SERVICE_ACCOUNT }}
          create_credentials_file: true
          export_environment_variables: true
      - uses: google-github-actions/setup-gcloud@v2
      - run: gcloud auth configure-docker ${REGION}-docker.pkg.dev --quiet
      - name: Build and push image
        run: |
          IMG=${REGION}-docker.pkg.dev/${PROJECT_ID}/fitness-tracker-backend/backend:latest
          docker build -t "$IMG" backend
          docker push "$IMG"
      - uses: hashicorp/setup-terraform@v3
      - name: Terraform apply
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
        run: |
          make terraform-init
          make terraform-apply
      - name: Smoke check deployed health
        run: |
          URL=$(terraform -chdir=terraform/main output -raw cloud_run_url)
          for i in $(seq 1 30); do
            curl -fsS "$URL/health" && exit 0
            sleep 2
          done
          echo "health check failed" && exit 1
```

- [ ] **Step 2: infra-deploy.yml**

```yaml
name: Infra (manual)
on:
  workflow_dispatch:
    inputs:
      action:
        type: choice
        options: [plan, apply]
        default: plan

env:
  TF_ENV: prod

jobs:
  terraform:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write
    steps:
      - uses: actions/checkout@v4
      - uses: google-github-actions/auth@v3
        with:
          workload_identity_provider: ${{ secrets.GCP_WORKLOAD_IDENTITY_PROVIDER }}
          service_account: ${{ secrets.GCP_SERVICE_ACCOUNT }}
          create_credentials_file: true
          export_environment_variables: true
      - uses: hashicorp/setup-terraform@v3
      - env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
        run: |
          make terraform-init
          make terraform-${{ inputs.action }}
```

- [ ] **Step 3: Commit and push; watch the run**

```bash
git add .github/workflows
git commit -m "ci: ci-cd and manual infra workflows"
git push
gh run watch --repo dhishan/fitness-coach --exit-status
```

Expected: test-backend green. deploy-backend green after Task 0 bootstrap + first apply (first apply also creates AR repo - if the docker push races the repo creation, run infra-deploy apply once first, then re-run ci-cd).

---

### Task 13: End-to-end verification of Plan 1

**Files:** none

- [ ] **Step 1: Health on Cloud Run URL**

```bash
URL=$(terraform -chdir=terraform/main output -raw cloud_run_url)
curl -fsS "$URL/health"
```

Expected: `{"status":"ok"}`

- [ ] **Step 2: Manual domain mapping + import (per runbook)**

Follow `docs/runbooks/domain-mapping.md`. Then (may take up to 24h for cert):

```bash
curl -fsS https://api.fitness-tracker.blueelephants.org/health
```

Expected: `{"status":"ok"}`

- [ ] **Step 3: Auth path verification**

`google_oauth_client_id` is empty until Firebase web app registration (Plan 4 sets up Firebase Hosting + web app). Until then verify the rejection paths against prod:

```bash
curl -s -o /dev/null -w "%{http_code}" -X POST "$URL/api/v1/auth/google" \
  -H 'Content-Type: application/json' -d '{"id_token":"garbage"}'
```

Expected: `401`. Full allowlist + JWT happy path is covered by unit tests now and verified live at the end of Plan 4 (web login).

- [ ] **Step 4: Tag**

```bash
git tag plan-1-complete && git push --tags
```

---

## Self-review notes

- Spec coverage for this plan's scope: repo layout (T1), settings/CORS-from-settings (T2,3), named DB (T3), auth google->JWT+allowlist (T4-6), async-Firestore-via-to_thread (T5), Dockerfile (T7), terraform pinned providers/state (T8), day-one indexes incl. chat+usage (T9), Cloud Run min-instances+cpu-always (T10), JWT via Secret Manager (T10), DNS + domain-mapping runbook (T11), CI with WIF + id-token + no lint-skip (T12), live verification (T13).
- Deliberately deferred to later plans: exercises/workouts/dashboard endpoints (Plan 2), chat + metering (Plan 3), shared types + web (Plan 4), mobile (Plan 5), e2e.yml + Playwright (Plan 6), Firebase Hosting TF (Plan 4 - so `google_oauth_client_id` exists when web ships).
- Types/signatures consistent: `get_settings()` used everywhere; `CurrentUser` defined in T6 and not referenced earlier.
