"""Tests for the nutrition API router."""
from unittest.mock import patch

FOOD_SVC = "app.routers.nutrition.food_service"
GOALS_SVC = "app.routers.nutrition.goals_service"
AI_SVC = "app.routers.nutrition.nutrition_ai"

MACROS = {"calories": 500.0, "protein_g": 40.0, "carbs_g": 50.0, "fat_g": 15.0}
SAMPLE_LOG = {
    "id": "log1",
    "user_id": "u1",
    "date": "2026-06-13",
    "name": "Chicken rice",
    "serving": "1 bowl",
    "macros": MACROS,
    "source": "manual",
    "notes": "",
}
SAMPLE_FAV = {
    "id": "fav1",
    "user_id": "u1",
    "name": "Oats",
    "serving": "100g",
    "macros": MACROS,
    "last_used_at": None,
}
SAMPLE_GOALS = {
    "id": "u1",
    "user_id": "u1",
    "calories": 2000.0,
    "protein_g": 150.0,
    "carbs_g": 200.0,
    "fat_g": 70.0,
}


def _auth(client):
    from app.auth.tokens import create_access_token
    t = create_access_token(user_id="u1", email="iamdhishan@gmail.com")
    return {"Authorization": f"Bearer {t}"}


# ---- Estimate text ----

def test_estimate_text_happy(client):
    estimate = {"name": "Chicken rice", "serving": "1 bowl", "macros": MACROS, "confidence": 0.9}
    with patch(f"{AI_SVC}.estimate_from_text", return_value=estimate):
        r = client.post("/api/v1/nutrition/estimate/text", json={"text": "chicken rice"}, headers=_auth(client))
    assert r.status_code == 200
    assert r.json()["name"] == "Chicken rice"


def test_estimate_text_empty_text(client):
    r = client.post("/api/v1/nutrition/estimate/text", json={"text": ""}, headers=_auth(client))
    assert r.status_code == 422


def test_estimate_text_ai_error(client):
    with patch(f"{AI_SVC}.estimate_from_text", return_value={"error": "LLM failed"}):
        r = client.post("/api/v1/nutrition/estimate/text", json={"text": "mystery food"}, headers=_auth(client))
    assert r.status_code == 422
    assert "LLM failed" in r.json()["detail"]


# ---- Estimate photo ----

def test_estimate_photo_happy(client, monkeypatch):
    monkeypatch.setenv("UPLOADS_BUCKET", "bucket")
    from app.config import get_settings
    get_settings.cache_clear()
    estimate = {"name": "Salad", "serving": "1 plate", "macros": MACROS, "confidence": 0.7}
    with patch(f"{AI_SVC}.estimate_from_image", return_value=estimate):
        r = client.post(
            "/api/v1/nutrition/estimate/photo",
            json={"image_url": "https://storage.googleapis.com/bucket/food/u1/abc.jpg"},
            headers=_auth(client),
        )
    assert r.status_code == 200
    assert r.json()["name"] == "Salad"


def test_estimate_photo_missing_url(client):
    r = client.post("/api/v1/nutrition/estimate/photo", json={}, headers=_auth(client))
    assert r.status_code == 422


def test_estimate_photo_ai_error(client):
    with patch(f"{AI_SVC}.estimate_from_image", return_value={"error": "Vision error"}):
        r = client.post(
            "/api/v1/nutrition/estimate/photo",
            json={"image_url": "https://example.com/img.jpg"},
            headers=_auth(client),
        )
    assert r.status_code == 422


# ---- Food logs ----

def test_create_log(client):
    payload = {
        "date": "2026-06-13",
        "name": "Chicken rice",
        "serving": "1 bowl",
        "macros": MACROS,
        "source": "manual",
        "notes": "",
    }
    with patch(f"{FOOD_SVC}.create_log", return_value={"id": "log1", **payload}):
        r = client.post("/api/v1/nutrition/logs", json=payload, headers=_auth(client))
    assert r.status_code == 201
    assert r.json()["id"] == "log1"


def test_create_log_bad_date(client):
    payload = {"date": "13-06-2026", "name": "X", "macros": MACROS}
    r = client.post("/api/v1/nutrition/logs", json=payload, headers=_auth(client))
    assert r.status_code == 422


def test_list_logs(client):
    day_result = {"items": [SAMPLE_LOG], "totals": MACROS}
    with patch(f"{FOOD_SVC}.list_by_date", return_value=day_result):
        r = client.get("/api/v1/nutrition/logs?date=2026-06-13", headers=_auth(client))
    assert r.status_code == 200
    assert len(r.json()["items"]) == 1


def test_list_logs_bad_date(client):
    r = client.get("/api/v1/nutrition/logs?date=June13", headers=_auth(client))
    assert r.status_code == 422


def test_update_log(client):
    updated = {**SAMPLE_LOG, "name": "Updated name"}
    with patch(f"{FOOD_SVC}.update_log", return_value=updated) as m:
        r = client.put("/api/v1/nutrition/logs/log1", json={"name": "Updated name"}, headers=_auth(client))
    assert r.status_code == 200
    assert r.json()["name"] == "Updated name"
    args = m.call_args.args
    assert args[0] == "u1" and args[1] == "log1"


def test_update_log_404(client):
    with patch(f"{FOOD_SVC}.update_log", return_value=None):
        r = client.put("/api/v1/nutrition/logs/nope", json={"name": "X"}, headers=_auth(client))
    assert r.status_code == 404


def test_delete_log(client):
    with patch(f"{FOOD_SVC}.delete_log", return_value="log1"):
        r = client.delete("/api/v1/nutrition/logs/log1", headers=_auth(client))
    assert r.status_code == 204


def test_delete_log_404(client):
    with patch(f"{FOOD_SVC}.delete_log", return_value=None):
        r = client.delete("/api/v1/nutrition/logs/nope", headers=_auth(client))
    assert r.status_code == 404


# ---- Favorites ----

def test_list_favorites(client):
    with patch(f"{FOOD_SVC}.list_favorites", return_value=[SAMPLE_FAV]):
        r = client.get("/api/v1/nutrition/favorites", headers=_auth(client))
    assert r.status_code == 200
    assert r.json()[0]["id"] == "fav1"


def test_create_favorite(client):
    payload = {"name": "Oats", "serving": "100g", "macros": MACROS}
    with patch(f"{FOOD_SVC}.create_favorite", return_value={"id": "fav1", **payload}):
        r = client.post("/api/v1/nutrition/favorites", json=payload, headers=_auth(client))
    assert r.status_code == 201
    assert r.json()["id"] == "fav1"


def test_delete_favorite(client):
    with patch(f"{FOOD_SVC}.delete_favorite", return_value="fav1"):
        r = client.delete("/api/v1/nutrition/favorites/fav1", headers=_auth(client))
    assert r.status_code == 204


def test_delete_favorite_404(client):
    with patch(f"{FOOD_SVC}.delete_favorite", return_value=None):
        r = client.delete("/api/v1/nutrition/favorites/nope", headers=_auth(client))
    assert r.status_code == 404


def test_log_from_favorite(client):
    with patch(f"{FOOD_SVC}.log_from_favorite", return_value=SAMPLE_LOG) as m:
        r = client.post(
            "/api/v1/nutrition/favorites/fav1/log?date=2026-06-13",
            headers=_auth(client),
        )
    assert r.status_code == 201
    assert r.json()["id"] == "log1"
    args = m.call_args.args
    assert args[0] == "u1" and args[1] == "fav1" and args[2] == "2026-06-13"


def test_log_from_favorite_404(client):
    with patch(f"{FOOD_SVC}.log_from_favorite", return_value=None):
        r = client.post(
            "/api/v1/nutrition/favorites/nope/log?date=2026-06-13",
            headers=_auth(client),
        )
    assert r.status_code == 404


def test_log_from_favorite_bad_date(client):
    r = client.post(
        "/api/v1/nutrition/favorites/fav1/log?date=bad",
        headers=_auth(client),
    )
    assert r.status_code == 422


# ---- Goals ----

def test_get_goals_returns_null_when_none(client):
    with patch(f"{GOALS_SVC}.get_goals", return_value=None):
        r = client.get("/api/v1/nutrition/goals", headers=_auth(client))
    assert r.status_code == 200
    assert r.json() is None


def test_get_goals_returns_goals(client):
    with patch(f"{GOALS_SVC}.get_goals", return_value=SAMPLE_GOALS):
        r = client.get("/api/v1/nutrition/goals", headers=_auth(client))
    assert r.status_code == 200
    assert r.json()["calories"] == 2000.0


def test_set_goals(client):
    payload = {"calories": 2000.0, "protein_g": 150.0, "carbs_g": 200.0, "fat_g": 70.0}
    with patch(f"{GOALS_SVC}.set_goals", return_value={"id": "u1", **payload}) as m:
        r = client.put("/api/v1/nutrition/goals", json=payload, headers=_auth(client))
    assert r.status_code == 200
    assert r.json()["calories"] == 2000.0
    assert m.call_args.args[0] == "u1"


def test_suggest_goals_happy(client):
    proposal = {
        "proposal": {"calories": 2200, "protein_g": 160, "carbs_g": 230, "fat_g": 75},
        "rationale": "Based on training volume and bodyweight.",
    }
    with patch(f"{GOALS_SVC}.suggest_goals", return_value=proposal):
        r = client.post(
            "/api/v1/nutrition/goals/suggest",
            json={"bodyweight_kg": 80.0, "goal_text": "lean bulk"},
            headers=_auth(client),
        )
    assert r.status_code == 200
    assert r.json()["proposal"]["calories"] == 2200


def test_suggest_goals_error(client):
    with patch(f"{GOALS_SVC}.suggest_goals", return_value={"error": "LLM timeout"}):
        r = client.post("/api/v1/nutrition/goals/suggest", json={}, headers=_auth(client))
    assert r.status_code == 422
    assert "LLM timeout" in r.json()["detail"]


# ---- micros_totals in list_logs ----

SAMPLE_MICROS = {
    "fiber_g": 4.0, "sugar_g": 1.0, "sodium_mg": 79.0,
    "potassium_mg": 219.0, "calcium_mg": 58.0, "iron_mg": 2.9,
    "vitamin_c_mg": 0.0, "vitamin_d_mcg": 1.1,
    "saturated_fat_g": 2.6, "cholesterol_mg": 186.0,
}


def test_list_logs_returns_micros_totals(client):
    """GET /logs?date= must include micros_totals alongside totals."""
    log_with_micros = {
        **SAMPLE_LOG,
        "meal_type": "breakfast",
        "micros": SAMPLE_MICROS,
        "micros_source": "usda",
        "usda_fdc_id": 999,
    }
    day_result = {
        "items": [log_with_micros],
        "totals": MACROS,
        "micros_totals": SAMPLE_MICROS,
    }
    with patch(f"{FOOD_SVC}.list_by_date", return_value=day_result):
        r = client.get("/api/v1/nutrition/logs?date=2026-06-13", headers=_auth(client))
    assert r.status_code == 200
    body = r.json()
    assert "micros_totals" in body
    assert body["micros_totals"]["sodium_mg"] == 79.0
    assert body["micros_totals"]["fiber_g"] == 4.0


def test_create_log_with_micros_and_meal_type(client):
    """POST /logs accepts meal_type, logged_at, micros, usda_fdc_id, micros_source."""
    payload = {
        "date": "2026-06-13",
        "name": "Oatmeal",
        "serving": "1 cup",
        "macros": MACROS,
        "source": "ai_text",
        "meal_type": "breakfast",
        "logged_at": "2026-06-13T07:30:00Z",
        "micros": SAMPLE_MICROS,
        "usda_fdc_id": 123456,
        "micros_source": "usda",
    }
    expected = {"id": "log2", **payload}
    with patch(f"{FOOD_SVC}.create_log", return_value=expected):
        r = client.post("/api/v1/nutrition/logs", json=payload, headers=_auth(client))
    assert r.status_code == 201
    body = r.json()
    assert body["meal_type"] == "breakfast"
    assert body["micros"]["sodium_mg"] == 79.0
    assert body["micros_source"] == "usda"
    assert body["usda_fdc_id"] == 123456
