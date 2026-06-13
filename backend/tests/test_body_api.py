"""Tests for the body metrics API router."""
from unittest.mock import patch

BODY_SVC = "app.routers.body.body_service"

SAMPLE = {
    "id": "m1",
    "user_id": "u1",
    "date": "2026-06-13",
    "weight_kg": 80.0,
    "body_fat_pct": None,
    "waist_cm": None,
    "chest_cm": None,
    "arm_cm": None,
    "thigh_cm": None,
    "photo_urls": [],
    "notes": "",
    "created_at": "2026-06-13T08:00:00+00:00",
}


def _auth(client):
    from app.auth.tokens import create_access_token
    t = create_access_token(user_id="u1", email="iamdhishan@gmail.com")
    return {"Authorization": f"Bearer {t}"}


# ---- list ----

def test_list_metrics(client):
    with patch(f"{BODY_SVC}.list_metrics", return_value=[SAMPLE]):
        r = client.get("/api/v1/body", headers=_auth(client))
    assert r.status_code == 200
    assert len(r.json()) == 1
    assert r.json()[0]["weight_kg"] == 80.0


def test_list_metrics_with_limit(client):
    with patch(f"{BODY_SVC}.list_metrics", return_value=[]) as m:
        r = client.get("/api/v1/body?limit=30", headers=_auth(client))
    assert r.status_code == 200
    m.assert_called_once_with("u1", 30)


# ---- create ----

def test_create_metric(client):
    payload = {"date": "2026-06-13", "weight_kg": 80.0}
    with patch(f"{BODY_SVC}.create_metric", return_value=SAMPLE):
        r = client.post("/api/v1/body", json=payload, headers=_auth(client))
    assert r.status_code == 201
    assert r.json()["id"] == "m1"


def test_create_metric_bad_date(client):
    r = client.post("/api/v1/body", json={"date": "bad", "weight_kg": 80.0}, headers=_auth(client))
    assert r.status_code == 422


def test_create_metric_zero_weight(client):
    r = client.post("/api/v1/body", json={"date": "2026-06-13", "weight_kg": 0.0}, headers=_auth(client))
    assert r.status_code == 422


def test_create_metric_with_all_fields(client):
    payload = {
        "date": "2026-06-13",
        "weight_kg": 75.5,
        "body_fat_pct": 18.0,
        "waist_cm": 82.0,
        "notes": "Morning",
    }
    with patch(f"{BODY_SVC}.create_metric", return_value={**SAMPLE, **payload}) as m:
        r = client.post("/api/v1/body", json=payload, headers=_auth(client))
    assert r.status_code == 201
    args = m.call_args.args
    assert args[0] == "u1"


# ---- latest ----

def test_latest_metric(client):
    with patch(f"{BODY_SVC}.latest_metric", return_value=SAMPLE):
        r = client.get("/api/v1/body/latest", headers=_auth(client))
    assert r.status_code == 200
    assert r.json()["weight_kg"] == 80.0


def test_latest_metric_none(client):
    with patch(f"{BODY_SVC}.latest_metric", return_value=None):
        r = client.get("/api/v1/body/latest", headers=_auth(client))
    assert r.status_code == 200
    assert r.json() is None


# ---- get ----

def test_get_metric(client):
    with patch(f"{BODY_SVC}.get_metric", return_value=SAMPLE):
        r = client.get("/api/v1/body/m1", headers=_auth(client))
    assert r.status_code == 200
    assert r.json()["id"] == "m1"


def test_get_metric_404(client):
    with patch(f"{BODY_SVC}.get_metric", return_value=None):
        r = client.get("/api/v1/body/nope", headers=_auth(client))
    assert r.status_code == 404


def test_get_metric_cross_user_404(client):
    with patch(f"{BODY_SVC}.get_metric", return_value=None):
        r = client.get("/api/v1/body/other_user_metric", headers=_auth(client))
    assert r.status_code == 404


# ---- update ----

def test_update_metric(client):
    updated = {**SAMPLE, "weight_kg": 81.5}
    with patch(f"{BODY_SVC}.update_metric", return_value=updated) as m:
        r = client.put("/api/v1/body/m1", json={"weight_kg": 81.5}, headers=_auth(client))
    assert r.status_code == 200
    assert r.json()["weight_kg"] == 81.5
    args = m.call_args.args
    assert args[0] == "u1" and args[1] == "m1"


def test_update_metric_404(client):
    with patch(f"{BODY_SVC}.update_metric", return_value=None):
        r = client.put("/api/v1/body/nope", json={"weight_kg": 80.0}, headers=_auth(client))
    assert r.status_code == 404


# ---- delete ----

def test_delete_metric(client):
    with patch(f"{BODY_SVC}.delete_metric", return_value="m1"):
        r = client.delete("/api/v1/body/m1", headers=_auth(client))
    assert r.status_code == 204


def test_delete_metric_404(client):
    with patch(f"{BODY_SVC}.delete_metric", return_value=None):
        r = client.delete("/api/v1/body/nope", headers=_auth(client))
    assert r.status_code == 404
