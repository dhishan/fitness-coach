"""IFCT 2017 Indian food composition search.

Loads the static JSON at startup and matches the query against each dish's
name AND its aliases (regional / alternate names), so e.g. "chole" finds
"Chana Masala" and "curd" finds "Plain Curd / Dahi".
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


def _hit(entry: dict) -> dict:
    return {
        "name": entry["name"],
        "serving": entry["serving"],
        "macros": entry["macros"],
        "micros": entry["micros"],
        "source": "ifct",
    }


def search_ifct(query: str, limit: int = 8) -> list[dict]:
    """Case-insensitive search over IFCT dish names + aliases.

    A dish matches when the query is a substring of (or contains) its name
    or any alias. Name matches rank above alias-only matches so the
    canonically-named dish leads.
    """
    if not query.strip():
        return []
    q = query.lower()
    name_hits: list[dict] = []
    alias_hits: list[dict] = []
    for entry in _DB:
        name = entry["name"].lower()
        if q in name:
            name_hits.append(_hit(entry))
            continue
        aliases = entry.get("aliases") or []
        # match either direction: "chole" in alias, or alias "dal" in "moong dal"
        if any(q in a or a in q for a in aliases):
            alias_hits.append(_hit(entry))
    return (name_hits + alias_hits)[:limit]
