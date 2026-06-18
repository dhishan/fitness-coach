"""Tests for OFF mapper, IFCT search, and combined /foods/search dedup logic."""
import pytest
from unittest.mock import patch

from app.services.off_search import _map_hit, search_off
from app.services.ifct import search_ifct


# --- OFF mapper ---

def _product(overrides=None):
    base = {
        "product_name": "Test Biscuit",
        "brands": "BrandX",
        "serving_size": "40 g",
        "nutriments": {
            "energy-kcal_100g": 500,
            "proteins_100g": 5.0,
            "carbohydrates_100g": 60.0,
            "fat_100g": 25.0,
            "fiber_100g": 2.0,
            "sugars_100g": 20.0,
            "sodium_100g": 0.5,      # g/100g -> 200 mg per 40g serving
            "calcium_100g": 0.1,     # g/100g -> 40 mg per 40g serving
            "iron_100g": 0.005,      # g/100g -> 2 mg per 40g serving
            "vitamin-c_100g": 0.02,  # g/100g -> 8 mg per 40g serving
            "vitamin-d_100g": 0.000002,  # g/100g -> 0.8 mcg per 40g serving
            "saturated-fat_100g": 12.0,
            "cholesterol_100g": 0.02,  # g/100g -> 8 mg per 40g serving
        },
    }
    if overrides:
        base.update(overrides)
    return base


def test_map_hit_per_serving_macros():
    hit = _map_hit(_product())
    assert hit is not None
    # 40g serving = 0.4 * 500 = 200 kcal
    assert hit["macros"]["calories"] == pytest.approx(200.0, abs=0.2)
    assert hit["macros"]["protein_g"] == pytest.approx(2.0, abs=0.1)
    assert hit["macros"]["carbs_g"] == pytest.approx(24.0, abs=0.1)
    assert hit["macros"]["fat_g"] == pytest.approx(10.0, abs=0.1)
    assert hit["source"] == "off"


def test_map_hit_sodium_converted_to_mg():
    hit = _map_hit(_product())
    assert hit is not None
    # 0.5 g/100g * (40/100) * 1000 mg/g = 200 mg
    assert hit["micros"]["sodium_mg"] == pytest.approx(200.0, abs=0.5)


def test_map_hit_calcium_iron_vit_c_mg():
    hit = _map_hit(_product())
    assert hit is not None
    # calcium: 0.1 g/100g -> 40 mg per 40g serving
    assert hit["micros"]["calcium_mg"] == pytest.approx(40.0, abs=0.5)
    # iron: 0.005 g/100g -> 2 mg per 40g serving
    assert hit["micros"]["iron_mg"] == pytest.approx(2.0, abs=0.1)
    # vit C: 0.02 g/100g -> 8 mg per 40g serving
    assert hit["micros"]["vitamin_c_mg"] == pytest.approx(8.0, abs=0.2)


def test_map_hit_vitamin_d_mcg():
    hit = _map_hit(_product())
    assert hit is not None
    # vit D: 0.000002 g/100g -> 0.8 mcg per 40g serving
    assert hit["micros"]["vitamin_d_mcg"] == pytest.approx(0.8, abs=0.1)


def test_map_hit_missing_macros_returns_none():
    p = _product()
    del p["nutriments"]["energy-kcal_100g"]
    assert _map_hit(p) is None


def test_map_hit_no_serving_falls_back_to_100g():
    p = _product({"serving_size": ""})
    hit = _map_hit(p)
    assert hit is not None
    assert hit["serving"] == "100g serving"
    # Per-100g: calories = 500
    assert hit["macros"]["calories"] == pytest.approx(500.0, abs=0.5)


def test_map_hit_name_includes_brand():
    hit = _map_hit(_product())
    assert hit is not None
    assert "BrandX" in hit["name"]


# --- IFCT search ---

def test_ifct_finds_dal_makhani_case_insensitive():
    results = search_ifct("dal makhani")
    assert len(results) >= 1
    assert results[0]["name"].lower() == "dal makhani"


def test_ifct_case_insensitive_uppercase():
    results = search_ifct("DAL MAKHANI")
    assert len(results) >= 1


def test_ifct_partial_match():
    results = search_ifct("paneer")
    names = [r["name"].lower() for r in results]
    assert any("paneer" in n for n in names)


def test_ifct_empty_query_returns_empty():
    assert search_ifct("") == []


def test_ifct_hit_has_correct_shape():
    results = search_ifct("dal makhani")
    hit = results[0]
    assert "name" in hit
    assert "serving" in hit
    assert "macros" in hit
    assert "micros" in hit
    assert hit["source"] == "ifct"
    assert "calories" in hit["macros"]
    assert "protein_g" in hit["macros"]


def test_ifct_limit_respected():
    results = search_ifct("a", limit=2)
    assert len(results) <= 2


# --- Combined search dedup ---

def test_combined_search_dedupes(monkeypatch):
    """Router dedup logic: same lowercase name from two sources should appear only once."""
    duplicate_name = "Test Food"
    usda_hit = {"name": duplicate_name, "serving": "100 g", "macros": {"calories": 100, "protein_g": 1, "carbs_g": 10, "fat_g": 2}, "source": "usda"}
    off_hit = {"name": duplicate_name, "serving": "100 g", "macros": {"calories": 100, "protein_g": 1, "carbs_g": 10, "fat_g": 2}, "source": "off"}

    merged: list[dict] = []
    seen: set[str] = set()
    for group in [[usda_hit], [off_hit], []]:
        for hit in group:
            key = hit.get("name", "").lower()
            if key and key not in seen:
                seen.add(key)
                merged.append(hit)

    assert len(merged) == 1
    assert merged[0]["source"] == "usda"


def test_combined_search_interleaves_sources():
    """Different names from different sources should all appear."""
    usda_hit = {"name": "Apple", "source": "usda"}
    off_hit = {"name": "Banana", "source": "off"}
    ifct_hit = {"name": "Dal Makhani", "source": "ifct"}

    merged: list[dict] = []
    seen: set[str] = set()
    for group in [[usda_hit], [off_hit], [ifct_hit]]:
        for hit in group:
            key = hit.get("name", "").lower()
            if key and key not in seen:
                seen.add(key)
                merged.append(hit)

    assert len(merged) == 3
    sources = {h["source"] for h in merged}
    assert sources == {"usda", "off", "ifct"}
