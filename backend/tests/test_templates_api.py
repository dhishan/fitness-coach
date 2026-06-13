from unittest.mock import patch

BASE = "app.routers.templates.template_service"


def _auth(client):
    from app.auth.tokens import create_access_token
    t = create_access_token(user_id="u1", email="iamdhishan@gmail.com")
    return {"Authorization": f"Bearer {t}"}


SAMPLE = {
    "id": "t1",
    "user_id": "u1",
    "name": "Push Day",
    "entries": [
        {"exercise_id": "e1", "exercise_name": "Bench Press", "target_sets": 3, "superset_group": None}
    ],
    "created_at": "2026-06-12T00:00:00Z",
    "updated_at": "2026-06-12T00:00:00Z",
}


def test_list_templates(client):
    with patch(f"{BASE}.list_templates", return_value=[SAMPLE]):
        r = client.get("/api/v1/templates", headers=_auth(client))
    assert r.status_code == 200
    assert r.json()[0]["id"] == "t1"


def test_create_template(client):
    body = {"name": "Push Day", "entries": [
        {"exercise_id": "e1", "exercise_name": "Bench Press", "target_sets": 3}
    ]}
    with patch(f"{BASE}.create_template", return_value=SAMPLE) as m:
        r = client.post("/api/v1/templates", json=body, headers=_auth(client))
    assert r.status_code == 201
    assert r.json()["id"] == "t1"
    args = m.call_args.args
    assert args[0] == "u1"
    assert args[1]["name"] == "Push Day"


def test_create_template_empty_name_rejected(client):
    r = client.post(
        "/api/v1/templates",
        json={"name": "", "entries": []},
        headers=_auth(client),
    )
    assert r.status_code == 422


def test_get_template(client):
    with patch(f"{BASE}.get_template", return_value=SAMPLE):
        r = client.get("/api/v1/templates/t1", headers=_auth(client))
    assert r.status_code == 200
    assert r.json()["name"] == "Push Day"


def test_get_template_404_cross_user(client):
    with patch(f"{BASE}.get_template", return_value=None):
        r = client.get("/api/v1/templates/other", headers=_auth(client))
    assert r.status_code == 404


def test_update_template(client):
    updated = {**SAMPLE, "name": "Push Day A"}
    with patch(f"{BASE}.update_template", return_value=updated) as m:
        r = client.put("/api/v1/templates/t1", json={"name": "Push Day A"}, headers=_auth(client))
    assert r.status_code == 200
    assert r.json()["name"] == "Push Day A"
    args = m.call_args.args
    assert args[0] == "t1" and args[1] == "u1"


def test_update_template_404(client):
    with patch(f"{BASE}.update_template", return_value=None):
        r = client.put("/api/v1/templates/bad", json={"name": "X"}, headers=_auth(client))
    assert r.status_code == 404


def test_delete_template(client):
    with patch(f"{BASE}.delete_template", return_value=True):
        assert client.delete("/api/v1/templates/t1", headers=_auth(client)).status_code == 204
    with patch(f"{BASE}.delete_template", return_value=False):
        assert client.delete("/api/v1/templates/t1", headers=_auth(client)).status_code == 404
