"""Recipe service + router tests.

Math tests first (no Firestore). Then endpoint tests with mocked db.
"""
from __future__ import annotations

from unittest.mock import patch, MagicMock

import pytest

from app.services.recipe_service import (
    compute_totals,
    scale_macros,
    scale_micros,
)


# ---------------------------------------------------------------------------
# Pure math
# ---------------------------------------------------------------------------


def _ing(name, grams, **per_100g):
    return {"name": name, "grams": grams, **{f"{k}_per_100g": v for k, v in per_100g.items()}}


class TestComputeTotals:
    def test_single_ingredient_round_trip(self):
        # 200g of chicken at 165 kcal/100g => 330 kcal total
        ings = [_ing("chicken", 200, calories=165, protein_g=31, carbs_g=0, fat_g=3.6)]
        tm, tu, pm, pu = compute_totals(ings, yields_servings=1.0)
        assert tm["calories"] == 330
        assert tm["protein_g"] == 62.0
        assert tm["fat_g"] == 7.2
        assert pm == tm   # 1 serving -> per-serving == totals

    def test_multi_ingredient_sum(self):
        ings = [
            _ing("chicken", 200, calories=165, protein_g=31, fat_g=3.6),
            _ing("rice",    150, calories=130, protein_g=2.7, carbs_g=28),
            _ing("oil",      10, calories=884, fat_g=100),
        ]
        tm, tu, pm, pu = compute_totals(ings, yields_servings=2.0)
        # totals unrounded: 330 + 195 + 88.4 = 613.4 -> rounded 613
        assert tm["calories"] == 613
        # per-serving is computed from the unrounded total, so 613.4 / 2 = 306.7 -> 307
        # (NOT round(613/2) — that would be 306. Per-serving must dervie from unrounded.)
        assert pm["calories"] == 307

    def test_zero_grams_ingredient_ignored(self):
        ings = [
            _ing("chicken", 200, calories=165),
            _ing("ghost",     0, calories=999),   # weight 0 -> ignored
        ]
        tm, _, _, _ = compute_totals(ings, yields_servings=1.0)
        assert tm["calories"] == 330

    def test_yields_two_servings_halves_per_serving(self):
        ings = [_ing("oats", 100, calories=389, protein_g=16.9, carbs_g=66.3, fat_g=6.9)]
        _, _, pm, _ = compute_totals(ings, yields_servings=2.0)
        assert pm["calories"] == round(389 / 2)
        assert pm["protein_g"] == round(16.9 / 2, 1)

    def test_yields_zero_raises(self):
        with pytest.raises(ValueError):
            compute_totals([], yields_servings=0)

    def test_micros_sum(self):
        ings = [
            _ing("spinach", 100, calories=23, fiber_g=2.2, sodium_mg=79, potassium_mg=558),
            _ing("almonds", 30,  calories=579, fiber_g=12.5, calcium_mg=269),
        ]
        _, tu, _, pu = compute_totals(ings, yields_servings=1.0)
        # fiber_g: spinach 100g*2.2/100 + almonds 30g*12.5/100 = 2.2 + 3.75 = 5.95 -> 6.0
        assert tu["fiber_g"] == 6.0
        # sodium: 100g * 79/100 = 79
        assert tu["sodium_mg"] == 79.0
        # calcium: 30g * 269/100 = 80.7
        assert tu["calcium_mg"] == 80.7

    def test_empty_ingredients_zero_macros(self):
        tm, tu, pm, pu = compute_totals([], yields_servings=1.0)
        assert tm["calories"] == 0
        assert pm["protein_g"] == 0


class TestScaling:
    def test_scale_macros_half_serving(self):
        per = {"calories": 400, "protein_g": 30, "carbs_g": 40, "fat_g": 10}
        out = scale_macros(per, 0.5)
        assert out["calories"] == 200
        assert out["protein_g"] == 15.0
        assert out["fat_g"] == 5.0

    def test_scale_micros_two_servings(self):
        per = {"fiber_g": 5, "sodium_mg": 100}
        out = scale_micros(per, 2.0)
        assert out["fiber_g"] == 10.0
        assert out["sodium_mg"] == 200.0

    def test_scale_handles_missing_keys(self):
        out = scale_macros({}, 1.0)
        assert out == {"calories": 0, "protein_g": 0, "carbs_g": 0, "fat_g": 0}


# ---------------------------------------------------------------------------
# Endpoint tests (mocked Firestore)
# ---------------------------------------------------------------------------


def _auth_headers():
    from app.auth.tokens import create_access_token
    return {"Authorization": f"Bearer {create_access_token('u1', 'iamdhishan@gmail.com')}"}


CHICKEN_RICE_RECIPE = {
    "name": "Chicken & Rice",
    "yields_servings": 2,
    "ingredients": [
        {"name": "Chicken breast", "grams": 200, "calories_per_100g": 165, "protein_g_per_100g": 31, "fat_g_per_100g": 3.6},
        {"name": "Rice",           "grams": 150, "calories_per_100g": 130, "protein_g_per_100g": 2.7, "carbs_g_per_100g": 28},
    ],
}


class TestCreateRecipe:
    def test_create_computes_totals_and_per_serving(self, client, mock_db):
        mock_ref = MagicMock()
        mock_ref.id = "rec_abc"
        mock_db.collection.return_value.document.return_value = mock_ref

        r = client.post("/api/v1/nutrition/recipes", json=CHICKEN_RICE_RECIPE, headers=_auth_headers())
        assert r.status_code == 201, r.text
        d = r.json()
        assert d["id"] == "rec_abc"
        assert d["yields_servings"] == 2
        # totals: chicken 200g => 330 kcal; rice 150g => 195 kcal => 525 total
        assert d["totals_macros"]["calories"] == 525
        # per serving = 525 / 2
        assert d["per_serving_macros"]["calories"] == round(525 / 2)
        # user_id stamped server-side
        assert d["user_id"] == "u1"

    def test_create_rejects_zero_yields(self, client, mock_db):
        bad = {**CHICKEN_RICE_RECIPE, "yields_servings": 0}
        r = client.post("/api/v1/nutrition/recipes", json=bad, headers=_auth_headers())
        assert r.status_code == 422

    def test_create_rejects_empty_name(self, client, mock_db):
        bad = {**CHICKEN_RICE_RECIPE, "name": ""}
        r = client.post("/api/v1/nutrition/recipes", json=bad, headers=_auth_headers())
        assert r.status_code == 422


class TestReadRecipe:
    def test_get_own_recipe(self, client, mock_db):
        snap = MagicMock()
        snap.exists = True
        snap.id = "rec_1"
        snap.to_dict.return_value = {"user_id": "u1", "name": "x", "yields_servings": 1}
        mock_db.collection.return_value.document.return_value.get.return_value = snap
        r = client.get("/api/v1/nutrition/recipes/rec_1", headers=_auth_headers())
        assert r.status_code == 200
        assert r.json()["id"] == "rec_1"

    def test_get_other_users_recipe_404(self, client, mock_db):
        snap = MagicMock()
        snap.exists = True
        snap.id = "rec_1"
        snap.to_dict.return_value = {"user_id": "OTHER", "name": "x"}
        mock_db.collection.return_value.document.return_value.get.return_value = snap
        r = client.get("/api/v1/nutrition/recipes/rec_1", headers=_auth_headers())
        # IDOR — must look like not-found, not 403
        assert r.status_code == 404

    def test_get_nonexistent_recipe_404(self, client, mock_db):
        snap = MagicMock()
        snap.exists = False
        mock_db.collection.return_value.document.return_value.get.return_value = snap
        r = client.get("/api/v1/nutrition/recipes/nope", headers=_auth_headers())
        assert r.status_code == 404


class TestUpdateRecipe:
    def test_update_recomputes_totals(self, client, mock_db):
        # Existing recipe has one ingredient; update bumps grams from 100 to 200.
        existing = {
            "user_id": "u1",
            "name": "Oats",
            "yields_servings": 1,
            "ingredients": [{"name": "Oats", "grams": 100, "calories_per_100g": 389}],
        }
        snap = MagicMock()
        snap.exists = True
        snap.id = "rec_1"
        snap.to_dict.return_value = existing
        mock_db.collection.return_value.document.return_value.get.return_value = snap

        r = client.put(
            "/api/v1/nutrition/recipes/rec_1",
            json={"ingredients": [{"name": "Oats", "grams": 200, "calories_per_100g": 389}]},
            headers=_auth_headers(),
        )
        assert r.status_code == 200, r.text
        # 200g * 389/100 = 778
        assert r.json()["totals_macros"]["calories"] == 778

    def test_update_other_users_recipe_404(self, client, mock_db):
        snap = MagicMock()
        snap.exists = True
        snap.id = "rec_1"
        snap.to_dict.return_value = {"user_id": "OTHER", "name": "x", "yields_servings": 1}
        mock_db.collection.return_value.document.return_value.get.return_value = snap
        r = client.put(
            "/api/v1/nutrition/recipes/rec_1",
            json={"name": "renamed"},
            headers=_auth_headers(),
        )
        assert r.status_code == 404


class TestDeleteRecipe:
    def test_delete_own(self, client, mock_db):
        snap = MagicMock()
        snap.exists = True
        snap.id = "rec_1"
        snap.to_dict.return_value = {"user_id": "u1"}
        mock_db.collection.return_value.document.return_value.get.return_value = snap
        r = client.delete("/api/v1/nutrition/recipes/rec_1", headers=_auth_headers())
        assert r.status_code == 204

    def test_delete_other_user_404(self, client, mock_db):
        snap = MagicMock()
        snap.exists = True
        snap.id = "rec_1"
        snap.to_dict.return_value = {"user_id": "OTHER"}
        mock_db.collection.return_value.document.return_value.get.return_value = snap
        r = client.delete("/api/v1/nutrition/recipes/rec_1", headers=_auth_headers())
        assert r.status_code == 404


class TestLogRecipe:
    def test_log_creates_food_log_with_scaled_macros(self, client, mock_db):
        # Recipe: 2 servings, per-serving cal = 200
        snap = MagicMock()
        snap.exists = True
        snap.id = "rec_1"
        snap.to_dict.return_value = {
            "user_id": "u1",
            "name": "Chicken & Rice",
            "yields_servings": 2,
            "per_serving_macros": {"calories": 200, "protein_g": 25, "carbs_g": 15, "fat_g": 5},
            "per_serving_micros": {"fiber_g": 2, "sodium_mg": 100},
        }
        mock_db.collection.return_value.document.return_value.get.return_value = snap

        with patch("app.services.recipe_service.food_service.create_log") as mock_create:
            mock_create.return_value = {"id": "log_1", "name": "Chicken & Rice"}
            r = client.post(
                "/api/v1/nutrition/recipes/rec_1/log",
                json={"date": "2026-06-16", "servings_eaten": 1.5},
                headers=_auth_headers(),
            )
        assert r.status_code == 201, r.text
        # Inspect the payload create_log was called with
        args, _kw = mock_create.call_args
        assert args[0] == "u1"
        payload = args[1]
        # 1.5 * 200 = 300 cal
        assert payload["macros"]["calories"] == 300
        assert payload["macros"]["protein_g"] == round(25 * 1.5, 1)
        # micros also scale
        assert payload["micros"]["fiber_g"] == 3.0
        assert payload["recipe_id"] == "rec_1"
        assert payload["servings_eaten"] == 1.5

    def test_log_other_users_recipe_404(self, client, mock_db):
        snap = MagicMock()
        snap.exists = True
        snap.id = "rec_1"
        snap.to_dict.return_value = {"user_id": "OTHER", "yields_servings": 1, "per_serving_macros": {}, "per_serving_micros": {}}
        mock_db.collection.return_value.document.return_value.get.return_value = snap
        r = client.post(
            "/api/v1/nutrition/recipes/rec_1/log",
            json={"date": "2026-06-16", "servings_eaten": 1},
            headers=_auth_headers(),
        )
        assert r.status_code == 404

    def test_log_rejects_zero_servings(self, client, mock_db):
        r = client.post(
            "/api/v1/nutrition/recipes/rec_1/log",
            json={"date": "2026-06-16", "servings_eaten": 0},
            headers=_auth_headers(),
        )
        assert r.status_code == 422
