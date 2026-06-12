from unittest.mock import patch

BASE = "app.routers.dashboard.dashboard_service"


def _auth(client):
    from app.auth.tokens import create_access_token
    t = create_access_token(user_id="u1", email="iamdhishan@gmail.com")
    return {"Authorization": f"Bearer {t}"}


def test_summary_passes_reference_date(client):
    with patch(f"{BASE}.summary", return_value={"sessions_this_week": 2}) as m:
        r = client.get("/api/v1/dashboard/summary?reference_date=2026-06-12", headers=_auth(client))
    assert r.status_code == 200
    m.assert_called_once_with("u1", "2026-06-12")


def test_summary_defaults_to_today(client):
    with patch(f"{BASE}.summary", return_value={}) as m:
        client.get("/api/v1/dashboard/summary", headers=_auth(client))
    ref = m.call_args.args[1]
    assert len(ref) == 10 and ref[4] == "-"


def test_exercise_progress(client):
    with patch(f"{BASE}.exercise_progress", return_value=[{"date": "2026-06-01", "top_weight": 80, "volume": 400}]):
        r = client.get("/api/v1/dashboard/exercise/sys-bench-press", headers=_auth(client))
    assert r.status_code == 200
    assert r.json()[0]["top_weight"] == 80


def test_muscle_split(client):
    with patch(f"{BASE}.muscle_split_for", return_value={"chest": 500.0}) as m:
        r = client.get("/api/v1/dashboard/muscle-split?weeks=4&reference_date=2026-06-12", headers=_auth(client))
    assert r.status_code == 200
    m.assert_called_once_with("u1", "2026-06-12", 4)
