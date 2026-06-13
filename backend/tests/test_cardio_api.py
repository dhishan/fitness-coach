"""Tests for the cardio CRUD API router."""
from unittest.mock import patch

CARDIO_SVC = "app.routers.cardio.cardio_service"

SAMPLE = {
    "id": "log1",
    "user_id": "u1",
    "date": "2026-06-13",
    "type": "run",
    "duration_s": 1800,
    "distance_m": 5000.0,
    "avg_hr": 150,
    "calories": 300,
    "notes": "",
    "source": "manual",
    "external_id": None,
    "created_at": "2026-06-13T08:00:00+00:00",
}


def _auth(client):
    from app.auth.tokens import create_access_token
    t = create_access_token(user_id="u1", email="iamdhishan@gmail.com")
    return {"Authorization": f"Bearer {t}"}


# ---- list ----

def test_list_logs(client):
    with patch(f"{CARDIO_SVC}.list_logs", return_value=[SAMPLE]):
        r = client.get("/api/v1/cardio", headers=_auth(client))
    assert r.status_code == 200
    assert len(r.json()) == 1
    assert r.json()[0]["type"] == "run"


def test_list_logs_empty(client):
    with patch(f"{CARDIO_SVC}.list_logs", return_value=[]):
        r = client.get("/api/v1/cardio", headers=_auth(client))
    assert r.status_code == 200
    assert r.json() == []


def test_list_logs_passes_uid(client):
    with patch(f"{CARDIO_SVC}.list_logs", return_value=[]) as m:
        client.get("/api/v1/cardio", headers=_auth(client))
    args = m.call_args.args
    assert args[0] == "u1"


# ---- create ----

def test_create_log_201(client):
    payload = {"date": "2026-06-13", "type": "run", "duration_s": 1800}
    with patch(f"{CARDIO_SVC}.create_log", return_value=SAMPLE):
        r = client.post("/api/v1/cardio", json=payload, headers=_auth(client))
    assert r.status_code == 201
    assert r.json()["id"] == "log1"


def test_create_log_bad_date_422(client):
    r = client.post(
        "/api/v1/cardio",
        json={"date": "bad", "type": "run", "duration_s": 600},
        headers=_auth(client),
    )
    assert r.status_code == 422


def test_create_log_invalid_type_422(client):
    r = client.post(
        "/api/v1/cardio",
        json={"date": "2026-06-13", "type": "yoga", "duration_s": 600},
        headers=_auth(client),
    )
    assert r.status_code == 422


def test_create_log_negative_duration_422(client):
    r = client.post(
        "/api/v1/cardio",
        json={"date": "2026-06-13", "type": "run", "duration_s": -1},
        headers=_auth(client),
    )
    assert r.status_code == 422


def test_create_log_with_external_id(client):
    payload = {
        "date": "2026-06-13",
        "type": "run",
        "duration_s": 1800,
        "source": "healthkit",
        "external_id": "hk-uuid-abc",
    }
    expected = {**SAMPLE, "external_id": "hk-uuid-abc", "source": "healthkit"}
    with patch(f"{CARDIO_SVC}.create_log", return_value=expected) as m:
        r = client.post("/api/v1/cardio", json=payload, headers=_auth(client))
    assert r.status_code == 201
    assert r.json()["external_id"] == "hk-uuid-abc"


def test_create_log_idempotent_same_external_id_no_dup(client):
    """Posting same external_id twice should return same doc (idempotent)."""
    payload = {
        "date": "2026-06-13",
        "type": "run",
        "duration_s": 1800,
        "external_id": "hk-dup-1",
    }
    existing = {**SAMPLE, "id": "existing_doc", "external_id": "hk-dup-1"}
    with patch(f"{CARDIO_SVC}.create_log", return_value=existing) as m:
        r1 = client.post("/api/v1/cardio", json=payload, headers=_auth(client))
        r2 = client.post("/api/v1/cardio", json=payload, headers=_auth(client))
    assert r1.status_code == 201
    assert r2.status_code == 201
    assert r1.json()["id"] == r2.json()["id"] == "existing_doc"


# ---- get ----

def test_get_log_200(client):
    with patch(f"{CARDIO_SVC}.get_log", return_value=SAMPLE):
        r = client.get("/api/v1/cardio/log1", headers=_auth(client))
    assert r.status_code == 200
    assert r.json()["id"] == "log1"


def test_get_log_404(client):
    with patch(f"{CARDIO_SVC}.get_log", return_value=None):
        r = client.get("/api/v1/cardio/nope", headers=_auth(client))
    assert r.status_code == 404


# ---- update ----

def test_update_log_200(client):
    updated = {**SAMPLE, "duration_s": 2400}
    with patch(f"{CARDIO_SVC}.update_log", return_value=updated):
        r = client.put("/api/v1/cardio/log1", json={"duration_s": 2400}, headers=_auth(client))
    assert r.status_code == 200
    assert r.json()["duration_s"] == 2400


def test_update_log_404(client):
    with patch(f"{CARDIO_SVC}.update_log", return_value=None):
        r = client.put("/api/v1/cardio/nope", json={"duration_s": 2400}, headers=_auth(client))
    assert r.status_code == 404


# ---- delete ----

def test_delete_log_204(client):
    with patch(f"{CARDIO_SVC}.delete_log", return_value="log1"):
        r = client.delete("/api/v1/cardio/log1", headers=_auth(client))
    assert r.status_code == 204


def test_delete_log_404(client):
    with patch(f"{CARDIO_SVC}.delete_log", return_value=None):
        r = client.delete("/api/v1/cardio/nope", headers=_auth(client))
    assert r.status_code == 404


# ---- auth guard ----

def test_list_logs_unauthenticated_401(client):
    r = client.get("/api/v1/cardio")
    assert r.status_code in (401, 403)
