"""Tests for the HealthKit sync API router."""
from unittest.mock import patch

HK_SVC = "app.routers.healthkit.healthkit_service"

SAMPLE_WEIGHT = {
    "kind": "weight",
    "external_id": "hk-w-1",
    "date": "2026-06-13",
    "value": 80.5,
}

SAMPLE_WORKOUT = {
    "kind": "workout",
    "external_id": "hk-wo-1",
    "date": "2026-06-13",
    "workout_type": "Running",
    "duration_s": 1800,
    "distance_m": 5000.0,
    "avg_hr": 150,
    "calories": 300,
    "value": None,
}


def _auth(client):
    from app.auth.tokens import create_access_token
    t = create_access_token(user_id="u1", email="iamdhishan@gmail.com")
    return {"Authorization": f"Bearer {t}"}


COUNTS = {"imported": {"weight": 1, "steps": 0, "workouts": 1, "hrv": 0, "sleep": 0}, "skipped": 0}


def test_healthkit_sync_200(client):
    body = {"samples": [SAMPLE_WEIGHT, SAMPLE_WORKOUT]}
    with patch(f"{HK_SVC}.ingest_batch", return_value=COUNTS):
        r = client.post("/api/v1/healthkit/sync", json=body, headers=_auth(client))
    assert r.status_code == 200
    data = r.json()
    assert data["imported"]["weight"] == 1
    assert data["imported"]["workouts"] == 1


def test_healthkit_sync_passes_uid(client):
    body = {"samples": [SAMPLE_WEIGHT]}
    with patch(f"{HK_SVC}.ingest_batch", return_value=COUNTS) as m:
        client.post("/api/v1/healthkit/sync", json=body, headers=_auth(client))
    args = m.call_args.args
    assert args[0] == "u1"


def test_healthkit_sync_empty_batch(client):
    body = {"samples": []}
    empty = {"imported": {"weight": 0, "steps": 0, "workouts": 0, "hrv": 0, "sleep": 0}, "skipped": 0}
    with patch(f"{HK_SVC}.ingest_batch", return_value=empty):
        r = client.post("/api/v1/healthkit/sync", json=body, headers=_auth(client))
    assert r.status_code == 200
    assert r.json()["imported"]["weight"] == 0


def test_healthkit_sync_invalid_kind_422(client):
    body = {"samples": [{"kind": "blood_pressure", "external_id": "x", "date": "2026-06-13"}]}
    r = client.post("/api/v1/healthkit/sync", json=body, headers=_auth(client))
    assert r.status_code == 422


def test_healthkit_sync_missing_external_id_422(client):
    body = {"samples": [{"kind": "weight", "date": "2026-06-13", "value": 80.0}]}
    r = client.post("/api/v1/healthkit/sync", json=body, headers=_auth(client))
    assert r.status_code == 422


def test_healthkit_sync_requires_auth(client):
    body = {"samples": []}
    r = client.post("/api/v1/healthkit/sync", json=body)
    assert r.status_code in (401, 403)
