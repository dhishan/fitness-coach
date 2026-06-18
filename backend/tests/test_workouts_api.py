from unittest.mock import patch

BASE = "app.routers.workouts.workout_service"


def _auth(client):
    from app.auth.tokens import create_access_token
    t = create_access_token(user_id="u1", email="iamdhishan@gmail.com")
    return {"Authorization": f"Bearer {t}"}


def test_create_workout(client):
    payload = {"date": "2026-06-12", "entries": []}
    with patch(f"{BASE}.create_workout", return_value={"id": "w1", "user_id": "u1", **payload,
               "exercise_ids": [], "started_at": None, "ended_at": None, "notes": "", "total_volume": 0}):
        r = client.post("/api/v1/workouts", json=payload, headers=_auth(client))
    assert r.status_code == 201
    assert r.json()["id"] == "w1"


def test_create_workout_rejects_bad_date(client):
    r = client.post("/api/v1/workouts", json={"date": "12-06-2026"}, headers=_auth(client))
    assert r.status_code == 422


def test_active_returns_null_when_none(client):
    with patch(f"{BASE}.get_active_workout", return_value=None):
        r = client.get("/api/v1/workouts/active", headers=_auth(client))
    assert r.status_code == 200
    assert r.json() is None


def test_get_workout_404_cross_user(client):
    with patch(f"{BASE}.get_workout", return_value=None):
        r = client.get("/api/v1/workouts/other", headers=_auth(client))
    assert r.status_code == 404


def test_update_workout(client):
    upd = {"entries": [{"exercise_id": "e1", "exercise_name": "Bench",
                        "sets": [{"weight": 80, "reps": 5}]}]}
    with patch(f"{BASE}.update_workout", return_value={"id": "w1", **upd}) as m:
        r = client.put("/api/v1/workouts/w1", json=upd, headers=_auth(client))
    assert r.status_code == 200
    args = m.call_args.args
    assert args[0] == "w1" and args[1] == "u1"


def test_finish_returns_prs(client):
    with patch(f"{BASE}.finish_workout", return_value={"id": "w1", "total_volume": 900, "prs": []}):
        r = client.post("/api/v1/workouts/w1/finish", headers=_auth(client))
    assert r.status_code == 200
    assert r.json()["total_volume"] == 900


def test_list_returns_total(client):
    with patch(f"{BASE}.list_workouts", return_value={"items": [], "total": 0}):
        r = client.get("/api/v1/workouts?from=2026-06-01&to=2026-06-30", headers=_auth(client))
    assert r.status_code == 200
    assert r.json() == {"items": [], "total": 0}


def test_delete(client):
    with patch(f"{BASE}.delete_workout", return_value=True):
        assert client.delete("/api/v1/workouts/w1", headers=_auth(client)).status_code == 204
    with patch(f"{BASE}.delete_workout", return_value=False):
        assert client.delete("/api/v1/workouts/w1", headers=_auth(client)).status_code == 404


def test_update_workout_preserves_entry_order(client):
    """The PUT body's entries array order is preserved verbatim into the service call."""
    reordered = {
        "entries": [
            {"exercise_id": "sq", "exercise_name": "Squat", "sets": [{"weight": 100, "reps": 5}]},
            {"exercise_id": "rdl", "exercise_name": "RDL", "sets": [{"weight": 60, "reps": 8}]},
            {"exercise_id": "bp", "exercise_name": "Bench", "sets": [{"weight": 80, "reps": 6}]},
        ]
    }
    with patch(f"{BASE}.update_workout", return_value={"id": "w1", **reordered}) as m:
        r = client.put("/api/v1/workouts/w1", json=reordered, headers=_auth(client))
    assert r.status_code == 200
    sent_payload = m.call_args.args[2]
    names = [e["exercise_name"] for e in sent_payload["entries"]]
    assert names == ["Squat", "RDL", "Bench"], "router must forward entries in the order the client sent"
