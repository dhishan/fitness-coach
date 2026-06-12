import os
from unittest.mock import MagicMock, patch

# Set env BEFORE any app import
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
