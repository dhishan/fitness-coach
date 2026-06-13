"""TDD tests for USDA FoodData Central service."""
import json
from unittest.mock import MagicMock, patch

import pytest


# ---- helpers ----

def _mock_search_response(foods: list[dict], status: int = 200):
    resp = MagicMock()
    resp.status_code = status
    resp.json.return_value = {"foods": foods}
    return resp


def _make_food(fdc_id: int, description: str, brand_owner=None, score=800.0, data_type="Foundation"):
    return {
        "fdcId": fdc_id,
        "description": description,
        "brandOwner": brand_owner,
        "score": score,
        "dataType": data_type,
    }


def _mock_food_response(fdc_id: int, description: str, nutrients: list[dict],
                         brand_owner=None, serving_size=None, serving_size_unit=None,
                         status: int = 200):
    resp = MagicMock()
    resp.status_code = status
    resp.json.return_value = {
        "fdcId": fdc_id,
        "description": description,
        "brandOwner": brand_owner,
        "servingSize": serving_size,
        "servingSizeUnit": serving_size_unit,
        "foodNutrients": nutrients,
    }
    return resp


def _nutrient(nid: int, amount: float) -> dict:
    return {"nutrient": {"id": nid}, "amount": amount}


# ---- search ----

def test_search_returns_empty_when_key_missing(mock_db):
    from app.services import usda
    with patch("app.services.usda.get_settings") as mock_settings:
        mock_settings.return_value.usda_api_key = ""
        result = usda.search("chicken breast")
    assert result == []


def test_search_returns_empty_when_query_blank(mock_db):
    from app.services import usda
    with patch("app.services.usda.get_settings") as mock_settings:
        mock_settings.return_value.usda_api_key = "testkey"
        result = usda.search("   ")
    assert result == []


def test_search_parses_fields_from_response(mock_db):
    from app.services import usda
    food = _make_food(123, "Chicken breast", score=900.0, data_type="Foundation")
    with patch("app.services.usda.get_settings") as mock_settings, \
         patch("app.services.usda.requests.get", return_value=_mock_search_response([food])):
        mock_settings.return_value.usda_api_key = "testkey"
        result = usda.search("chicken", limit=5)

    assert len(result) == 1
    assert result[0]["fdc_id"] == 123
    assert result[0]["description"] == "Chicken breast"
    assert result[0]["score"] == 900.0
    assert result[0]["data_type"] == "Foundation"
    assert result[0]["brand_owner"] is None


def test_search_returns_empty_on_http_error(mock_db):
    from app.services import usda
    with patch("app.services.usda.get_settings") as mock_settings, \
         patch("app.services.usda.requests.get", return_value=_mock_search_response([], status=500)):
        mock_settings.return_value.usda_api_key = "testkey"
        result = usda.search("chicken")
    assert result == []


def test_search_returns_empty_on_exception(mock_db):
    from app.services import usda
    with patch("app.services.usda.get_settings") as mock_settings, \
         patch("app.services.usda.requests.get", side_effect=ConnectionError("timeout")):
        mock_settings.return_value.usda_api_key = "testkey"
        result = usda.search("chicken")
    assert result == []


def test_search_respects_limit(mock_db):
    from app.services import usda
    foods = [_make_food(i, f"Food {i}") for i in range(10)]
    with patch("app.services.usda.get_settings") as mock_settings, \
         patch("app.services.usda.requests.get", return_value=_mock_search_response(foods)):
        mock_settings.return_value.usda_api_key = "testkey"
        result = usda.search("food", limit=3)
    assert len(result) == 3


# ---- get_nutrients ----

def test_get_nutrients_reads_cache_when_present(mock_db):
    from app.services import usda
    cached = {"name": "Chicken", "serving": "100 g", "macros": {}, "micros": {}, "usda_fdc_id": 123}
    cache_snap = MagicMock()
    cache_snap.exists = True
    cache_snap.to_dict.return_value = cached
    mock_db.collection.return_value.document.return_value.get.return_value = cache_snap

    with patch("app.services.usda.get_settings") as mock_settings, \
         patch("app.services.usda.requests.get") as mock_http:
        mock_settings.return_value.usda_api_key = "testkey"
        result = usda.get_nutrients(123)

    # HTTP must NOT be called when cache hit
    mock_http.assert_not_called()
    assert result["name"] == "Chicken"
    assert result["usda_fdc_id"] == 123


def test_get_nutrients_fetches_and_parses_14_nutrients(mock_db):
    from app.services import usda
    # Cache miss
    cache_snap = MagicMock()
    cache_snap.exists = False
    cache_ref = MagicMock()
    cache_ref.get.return_value = cache_snap
    mock_db.collection.return_value.document.return_value = cache_ref

    nutrients = [
        _nutrient(1008, 165),    # calories
        _nutrient(1003, 31.0),   # protein_g
        _nutrient(1005, 0.0),    # carbs_g
        _nutrient(1004, 3.6),    # fat_g
        _nutrient(1079, 0.0),    # fiber_g
        _nutrient(2000, 0.0),    # sugar_g
        _nutrient(1093, 74.0),   # sodium_mg
        _nutrient(1092, 256.0),  # potassium_mg
        _nutrient(1087, 11.0),   # calcium_mg
        _nutrient(1089, 0.9),    # iron_mg
        _nutrient(1162, 0.0),    # vitamin_c_mg
        _nutrient(1114, 0.1),    # vitamin_d_mcg
        _nutrient(1258, 1.0),    # saturated_fat_g
        _nutrient(1253, 85.0),   # cholesterol_mg
    ]
    food_resp = _mock_food_response(123, "Chicken breast", nutrients)

    with patch("app.services.usda.get_settings") as mock_settings, \
         patch("app.services.usda.requests.get", return_value=food_resp):
        mock_settings.return_value.usda_api_key = "testkey"
        result = usda.get_nutrients(123)

    assert result is not None
    assert result["macros"]["calories"] == 165
    assert result["macros"]["protein_g"] == 31.0
    assert result["macros"]["fat_g"] == 3.6
    assert result["macros"]["carbs_g"] == 0.0
    assert result["micros"]["sodium_mg"] == 74.0
    assert result["micros"]["potassium_mg"] == 256.0
    assert result["micros"]["calcium_mg"] == 11.0
    assert result["micros"]["iron_mg"] == 0.9
    assert result["micros"]["cholesterol_mg"] == 85.0
    assert result["micros"]["saturated_fat_g"] == 1.0
    assert result["micros"]["vitamin_d_mcg"] == 0.1
    assert result["usda_fdc_id"] == 123
    # Verify cache was written
    cache_ref.set.assert_called_once()


def test_get_nutrients_branded_includes_brand_in_name(mock_db):
    from app.services import usda
    cache_snap = MagicMock()
    cache_snap.exists = False
    cache_ref = MagicMock()
    cache_ref.get.return_value = cache_snap
    mock_db.collection.return_value.document.return_value = cache_ref

    food_resp = _mock_food_response(456, "Greek Yogurt", [], brand_owner="Chobani")
    with patch("app.services.usda.get_settings") as mock_settings, \
         patch("app.services.usda.requests.get", return_value=food_resp):
        mock_settings.return_value.usda_api_key = "testkey"
        result = usda.get_nutrients(456)

    assert "Chobani" in result["name"]


def test_get_nutrients_uses_serving_size_when_present(mock_db):
    from app.services import usda
    cache_snap = MagicMock()
    cache_snap.exists = False
    cache_ref = MagicMock()
    cache_ref.get.return_value = cache_snap
    mock_db.collection.return_value.document.return_value = cache_ref

    food_resp = _mock_food_response(789, "Oats", [], serving_size=40, serving_size_unit="g")
    with patch("app.services.usda.get_settings") as mock_settings, \
         patch("app.services.usda.requests.get", return_value=food_resp):
        mock_settings.return_value.usda_api_key = "testkey"
        result = usda.get_nutrients(789)

    assert result["serving"] == "40 g"


def test_get_nutrients_returns_none_on_404(mock_db):
    from app.services import usda
    cache_snap = MagicMock()
    cache_snap.exists = False
    mock_db.collection.return_value.document.return_value.get.return_value = cache_snap

    food_resp = MagicMock()
    food_resp.status_code = 404
    with patch("app.services.usda.get_settings") as mock_settings, \
         patch("app.services.usda.requests.get", return_value=food_resp):
        mock_settings.return_value.usda_api_key = "testkey"
        result = usda.get_nutrients(999)

    assert result is None


def test_get_nutrients_returns_none_on_exception(mock_db):
    from app.services import usda
    cache_snap = MagicMock()
    cache_snap.exists = False
    mock_db.collection.return_value.document.return_value.get.return_value = cache_snap

    with patch("app.services.usda.get_settings") as mock_settings, \
         patch("app.services.usda.requests.get", side_effect=ConnectionError("timeout")):
        mock_settings.return_value.usda_api_key = "testkey"
        result = usda.get_nutrients(123)

    assert result is None


def test_get_nutrients_returns_none_when_no_key(mock_db):
    from app.services import usda
    cache_snap = MagicMock()
    cache_snap.exists = False
    mock_db.collection.return_value.document.return_value.get.return_value = cache_snap

    with patch("app.services.usda.get_settings") as mock_settings, \
         patch("app.services.usda.requests.get") as mock_http:
        mock_settings.return_value.usda_api_key = ""
        result = usda.get_nutrients(123)

    assert result is None
    mock_http.assert_not_called()


# ---- enrich_estimation ----

def test_enrich_estimation_returns_none_when_no_hits(mock_db):
    from app.services import usda
    with patch("app.services.usda.search", return_value=[]):
        result = usda.enrich_estimation("mystery food")
    assert result is None


def test_enrich_estimation_returns_none_below_threshold_foundation(mock_db):
    from app.services import usda
    hits = [{"fdc_id": 1, "description": "Chicken", "score": 400, "data_type": "Foundation"}]
    with patch("app.services.usda.search", return_value=hits):
        result = usda.enrich_estimation("chicken")
    assert result is None


def test_enrich_estimation_returns_none_below_threshold_branded(mock_db):
    from app.services import usda
    hits = [{"fdc_id": 2, "description": "Yogurt", "score": 100, "data_type": "Branded"}]
    with patch("app.services.usda.search", return_value=hits):
        result = usda.enrich_estimation("yogurt")
    assert result is None


def test_enrich_estimation_returns_nutrients_above_threshold_foundation(mock_db):
    from app.services import usda
    hits = [{"fdc_id": 3, "description": "Oats", "score": 800, "data_type": "Foundation"}]
    nutrient_data = {
        "name": "Oats",
        "serving": "100 g",
        "macros": {"calories": 389, "protein_g": 17, "carbs_g": 66, "fat_g": 7},
        "micros": {"fiber_g": 10, "sugar_g": 0, "sodium_mg": 2, "potassium_mg": 429,
                   "calcium_mg": 54, "iron_mg": 4.7, "vitamin_c_mg": 0,
                   "vitamin_d_mcg": 0, "saturated_fat_g": 1.2, "cholesterol_mg": 0},
        "usda_fdc_id": 3,
    }
    with patch("app.services.usda.search", return_value=hits), \
         patch("app.services.usda.get_nutrients", return_value=nutrient_data) as mock_get:
        result = usda.enrich_estimation("oats")

    assert result is not None
    assert result["macros"]["calories"] == 389
    mock_get.assert_called_once_with(3)


def test_enrich_estimation_returns_nutrients_above_threshold_branded(mock_db):
    from app.services import usda
    hits = [{"fdc_id": 4, "description": "Greek Yogurt", "score": 250, "data_type": "Branded"}]
    nutrient_data = {
        "name": "Greek Yogurt (Brand)",
        "serving": "150 g",
        "macros": {"calories": 100, "protein_g": 17, "carbs_g": 6, "fat_g": 0},
        "micros": {},
        "usda_fdc_id": 4,
    }
    with patch("app.services.usda.search", return_value=hits), \
         patch("app.services.usda.get_nutrients", return_value=nutrient_data):
        result = usda.enrich_estimation("greek yogurt")
    assert result is not None
    assert result["macros"]["protein_g"] == 17
