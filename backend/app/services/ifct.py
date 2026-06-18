"""IFCT 2017 Indian food composition search.

Loads the static JSON at startup and does case-insensitive substring matching.
"""
import json
import logging
from pathlib import Path

logger = logging.getLogger(__name__)

_DATA_PATH = Path(__file__).parent.parent / "data" / "ifct_2017.json"

def _load() -> list[dict]:
    try:
        with open(_DATA_PATH, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        logger.exception("failed to load ifct_2017.json")
        return []

_DB: list[dict] = _load()


def search_ifct(query: str, limit: int = 8) -> list[dict]:
    """Case-insensitive substring search over IFCT entries. Returns IngredientHit-shaped dicts."""
    if not query.strip():
        return []
    q = query.lower()
    out: list[dict] = []
    for entry in _DB:
        if q in entry["name"].lower():
            out.append({
                "name": entry["name"],
                "serving": entry["serving"],
                "macros": entry["macros"],
                "micros": entry["micros"],
                "source": "ifct",
            })
            if len(out) >= limit:
                break
    return out
