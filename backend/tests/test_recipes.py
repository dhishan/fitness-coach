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


def _ing(name, servings_used=1.0, label="1 serving", **per_serving):
    """Build an ingredient with per-serving values straight off a label."""
    return {
        "name": name,
        "serving_label": label,
        "servings_used": servings_used,
        **{f"{k}_per_serving": v for k, v in per_serving.items()},
    }


class TestComputeTotals:
    def test_single_ingredient_one_serving(self):
        # 1 scoop of whey: 120 cal, 25 prot, 2 carb, 1 fat
        ings = [_ing("whey", 1.0, "1 scoop", calories=120, protein_g=25, carbs_g=2, fat_g=1)]
        tm, tu, pm, pu = compute_totals(ings, yields_servings=1.0)
        assert tm["calories"] == 120
        assert tm["protein_g"] == 25.0
        assert tm["fat_g"] == 1.0
        assert pm == tm

    def test_two_servings_of_ingredient_doubles(self):
        ings = [_ing("whey", 2.0, "1 scoop", calories=120, protein_g=25)]
        tm, _, _, _ = compute_totals(ings, yields_servings=1.0)
        assert tm["calories"] == 240
        assert tm["protein_g"] == 50.0

    def test_half_serving_halves(self):
        ings = [_ing("oats", 0.5, "1 cup", calories=300, protein_g=10)]
        tm, _, _, _ = compute_totals(ings, yields_servings=1.0)
        assert tm["calories"] == 150
        assert tm["protein_g"] == 5.0

    def test_multi_ingredient_sum_berry_shake(self):
        # The actual Berry Shake recipe — 5 ingredients, 1 serving of each
        ings = [
            _ing("Creatine", 1, calories=0, protein_g=0),
            _ing("Collagen", 1, calories=30, protein_g=9),
            _ing("Whey",     1, calories=120, protein_g=25, carbs_g=2, fat_g=1),
            _ing("Berries",  1, calories=60, protein_g=1, carbs_g=15, fat_g=0.5),
            _ing("Milk",     1, calories=160, protein_g=8, carbs_g=11, fat_g=9),
        ]
        tm, _, _, _ = compute_totals(ings, yields_servings=1.0)
        assert tm["calories"] == 370
        assert tm["protein_g"] == 43.0
        assert tm["carbs_g"] == 28.0
        assert tm["fat_g"] == 10.5

    def test_recipe_yields_two_servings_halves_per_serving(self):
        ings = [_ing("Whey", 2, calories=120)]
        # Recipe is 2 servings of whey total, yields 2 portions -> 1 scoop per portion
        _, _, pm, _ = compute_totals(ings, yields_servings=2.0)
        assert pm["calories"] == 120

    def test_zero_servings_used_ignored(self):
        ings = [
            _ing("Whey",  1, calories=120),
            _ing("Ghost", 0, calories=999),
        ]
        tm, _, _, _ = compute_totals(ings, yields_servings=1.0)
        assert tm["calories"] == 120

    def test_yields_zero_raises(self):
        with pytest.raises(ValueError):
            compute_totals([], yields_servings=0)

    def test_micros_sum(self):
        ings = [
            _ing("Milk", 1, calories=160, sodium_mg=120, calcium_mg=290, sugar_g=11),
            _ing("Berries", 1, calories=60, potassium_mg=150, vitamin_c_mg=26, fiber_g=4),
        ]
        _, tu, _, _ = compute_totals(ings, yields_servings=1.0)
        assert tu["sodium_mg"] == 120.0
        assert tu["calcium_mg"] == 290.0
        assert tu["vitamin_c_mg"] == 26.0
        assert tu["fiber_g"] == 4.0

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
        # Chicken: 2 servings of (100g chicken = 165 cal, 31 prot, 3.6 fat)
        {"name": "Chicken breast", "serving_label": "100g", "servings_used": 2,
         "calories_per_serving": 165, "protein_g_per_serving": 31, "fat_g_per_serving": 3.6},
        # Rice: 1.5 servings of (100g rice = 130 cal, 2.7 prot, 28 carb)
        {"name": "Rice", "serving_label": "100g", "servings_used": 1.5,
         "calories_per_serving": 130, "protein_g_per_serving": 2.7, "carbs_g_per_serving": 28},
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
        # totals: chicken (165 * 2 = 330) + rice (130 * 1.5 = 195) = 525
        assert d["totals_macros"]["calories"] == 525
        # per serving = 525 / 2 = 262.5 -> 262
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
        # Existing recipe: 1 serving of oats at 389 cal -> 389 total
        # Update bumps servings_used to 2 -> 778 total
        existing = {
            "user_id": "u1",
            "name": "Oats",
            "yields_servings": 1,
            "ingredients": [{"name": "Oats", "servings_used": 1, "calories_per_serving": 389}],
        }
        snap = MagicMock()
        snap.exists = True
        snap.id = "rec_1"
        snap.to_dict.return_value = existing
        mock_db.collection.return_value.document.return_value.get.return_value = snap

        r = client.put(
            "/api/v1/nutrition/recipes/rec_1",
            json={"ingredients": [{"name": "Oats", "servings_used": 2, "calories_per_serving": 389}]},
            headers=_auth_headers(),
        )
        assert r.status_code == 200, r.text
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
