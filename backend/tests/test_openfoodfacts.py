"""TDD tests for openfoodfacts barcode lookup and nutrition router barcode endpoint."""
from unittest.mock import MagicMock, patch

import pytest

# Minimal product fixture representing a real OFF API response
PRODUCT_JSON = {
    "status": 1,
    "product": {
        "product_name": "Oats",
        "brands": "Quaker",
        "serving_size": "40 g",
        "nutriments": {
            "energy-kcal_100g": 380,
            "proteins_100g": 13.0,
            "carbohydrates_100g": 66.0,
            "fat_100g": 7.0,
        },
    },
}

# Product with no serving_size - should default to 100 g
PRODUCT_NO_SERVING = {
    "status": 1,
    "product": {
        "product_name": "Rice Cakes",
        "brands": "",
        "nutriments": {
            "energy-kcal_100g": 390,
            "proteins_100g": 7.5,
            "carbohydrates_100g": 82.0,
            "fat_100g": 2.8,
        },
    },
}


def _mock_response(json_data: dict, status_code: int = 200):
    resp = MagicMock()
    resp.status_code = status_code
    resp.json.return_value = json_data
    return resp


# ---- lookup_barcode ----

def test_lookup_barcode_returns_estimation(mock_db):
    from app.services.openfoodfacts import lookup_barcode
    with patch("requests.get", return_value=_mock_response(PRODUCT_JSON)):
        result = lookup_barcode("7613034626844")
    assert result is not None
    assert result["name"] == "Oats (Quaker)"
    assert result["serving"] == "40 g"
    assert result["source"] == "openfoodfacts"
    assert result["code"] == "7613034626844"
    assert result["confidence"] == 0.9


def test_lookup_barcode_scales_macros_to_serving(mock_db):
    """40 g serving from 100g values: cals = 380 * 40/100 = 152."""
    from app.services.openfoodfacts import lookup_barcode
    with patch("requests.get", return_value=_mock_response(PRODUCT_JSON)):
        result = lookup_barcode("7613034626844")
    macros = result["macros"]
    assert abs(macros["calories"] - 152.0) < 0.1
    assert abs(macros["protein_g"] - 5.2) < 0.1
    assert abs(macros["carbs_g"] - 26.4) < 0.1
    assert abs(macros["fat_g"] - 2.8) < 0.1


def test_lookup_barcode_default_serving_100g(mock_db):
    """No serving_size field → defaults to 100 g, macros are the _100g values."""
    from app.services.openfoodfacts import lookup_barcode
    with patch("requests.get", return_value=_mock_response(PRODUCT_NO_SERVING)):
        result = lookup_barcode("1234567890123")
    assert result["serving"] == "100 g"
    macros = result["macros"]
    assert abs(macros["calories"] - 390.0) < 0.1


def test_lookup_barcode_no_brand(mock_db):
    from app.services.openfoodfacts import lookup_barcode
    with patch("requests.get", return_value=_mock_response(PRODUCT_NO_SERVING)):
        result = lookup_barcode("1234567890123")
    assert result["name"] == "Rice Cakes"


def test_lookup_barcode_status_0_returns_none(mock_db):
    """OFF returns status=0 when product not found."""
    from app.services.openfoodfacts import lookup_barcode
    not_found = {"status": 0, "product": None}
    with patch("requests.get", return_value=_mock_response(not_found)):
        assert lookup_barcode("0000000000000") is None


def test_lookup_barcode_http_404_returns_none(mock_db):
    from app.services.openfoodfacts import lookup_barcode
    with patch("requests.get", return_value=_mock_response({}, status_code=404)):
        assert lookup_barcode("9999999999999") is None


def test_lookup_barcode_exception_returns_none(mock_db):
    """Any exception (network error, malformed JSON) must not raise."""
    from app.services.openfoodfacts import lookup_barcode
    with patch("requests.get", side_effect=Exception("network error")):
        assert lookup_barcode("1234567890123") is None


def test_lookup_barcode_missing_nutriments_returns_none(mock_db):
    """Product exists but nutriments are missing."""
    from app.services.openfoodfacts import lookup_barcode
    bad = {"status": 1, "product": {"product_name": "Mystery", "brands": ""}}
    with patch("requests.get", return_value=_mock_response(bad)):
        assert lookup_barcode("1234567890123") is None


# ---- router endpoint ----

def _auth(client):
    from app.auth.tokens import create_access_token
    t = create_access_token(user_id="u1", email="iamdhishan@gmail.com")
    return {"Authorization": f"Bearer {t}"}


OFF_SVC = "app.routers.nutrition.openfoodfacts"

ESTIMATION = {
    "name": "Oats (Quaker)",
    "serving": "40 g",
    "macros": {"calories": 152.0, "protein_g": 5.2, "carbs_g": 26.4, "fat_g": 2.8},
    "confidence": 0.9,
    "source": "openfoodfacts",
    "code": "7613034626844",
}


def test_barcode_endpoint_200(client):
    with patch(f"{OFF_SVC}.lookup_barcode", return_value=ESTIMATION):
        r = client.get("/api/v1/nutrition/barcode/7613034626844", headers=_auth(client))
    assert r.status_code == 200
    assert r.json()["name"] == "Oats (Quaker)"
    assert r.json()["confidence"] == 0.9


def test_barcode_endpoint_404_when_none(client):
    with patch(f"{OFF_SVC}.lookup_barcode", return_value=None):
        r = client.get("/api/v1/nutrition/barcode/0000000000000", headers=_auth(client))
    assert r.status_code == 404


def test_barcode_endpoint_requires_auth(client):
    r = client.get("/api/v1/nutrition/barcode/7613034626844")
    assert r.status_code in (401, 403)
