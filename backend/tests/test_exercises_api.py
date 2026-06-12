from unittest.mock import patch


def _auth(client):
    from app.auth.tokens import create_access_token
    t = create_access_token(user_id="u1", email="iamdhishan@gmail.com")
    return {"Authorization": f"Bearer {t}"}


def test_exercises_requires_auth(client):
    assert client.get("/api/v1/exercises").status_code == 401


def test_list_exercises(client):
    with patch("app.routers.exercises.exercise_service.list_exercises", return_value=[{"id": "sys-bench-press", "name": "Barbell Bench Press"}]) as m:
        r = client.get("/api/v1/exercises?muscle=chest", headers=_auth(client))
    assert r.status_code == 200
    assert r.json()[0]["id"] == "sys-bench-press"
    m.assert_called_once_with("u1", muscle="chest", pattern=None, q=None)


def test_create_custom_exercise(client):
    payload = {"name": "Zercher Squat", "primary_muscles": ["quads", "core"],
               "movement_pattern": "squat", "equipment": "barbell"}
    with patch("app.routers.exercises.exercise_service.create_exercise", return_value={**payload, "secondary_muscles": [], "id": "x1", "user_id": "u1", "is_custom": True}):
        r = client.post("/api/v1/exercises", json=payload, headers=_auth(client))
    assert r.status_code == 201
    assert r.json()["is_custom"] is True


def test_alternatives_404_when_unknown(client):
    with patch("app.routers.exercises.exercise_service.alternatives_for", return_value=None):
        r = client.get("/api/v1/exercises/nope/alternatives", headers=_auth(client))
    assert r.status_code == 404


def test_history(client):
    with patch("app.routers.exercises.exercise_service.history_for", return_value=[{"workout_id": "w1", "date": "2026-06-10", "sets": []}]):
        r = client.get("/api/v1/exercises/sys-bench-press/history", headers=_auth(client))
    assert r.status_code == 200
    assert r.json()[0]["workout_id"] == "w1"
