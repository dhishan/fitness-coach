def _ex(id, pattern, primary, equipment="barbell"):
    return {"id": id, "name": id, "movement_pattern": pattern,
            "primary_muscles": primary, "secondary_muscles": [], "equipment": equipment,
            "user_id": "system", "is_custom": False}


def test_rank_alternatives_same_pattern_and_overlap_first():
    from app.services.exercise_service import rank_alternatives
    target = _ex("bench", "push", ["chest", "triceps"])
    pool = [
        _ex("bench", "push", ["chest", "triceps"]),          # self - excluded
        _ex("incline-db", "push", ["chest", "shoulders"], "dumbbell"),  # overlap 1, same pattern
        _ex("dips", "push", ["chest", "triceps"], "bodyweight"),        # overlap 2, same pattern
        _ex("row", "pull", ["back"]),                                    # different pattern - excluded
        _ex("ohp", "push", ["shoulders", "triceps"]),                    # overlap 1
    ]
    ranked = rank_alternatives(target, pool)
    assert [e["id"] for e in ranked][:2] == ["dips", "incline-db"] or \
           [e["id"] for e in ranked][0] == "dips"
    assert all(e["id"] != "bench" for e in ranked)
    assert all(e["movement_pattern"] == "push" for e in ranked)


def test_extract_exercise_history():
    from app.services.exercise_service import extract_history
    workouts = [
        {"id": "w2", "date": "2026-06-10", "entries": [
            {"exercise_id": "bench", "sets": [{"weight": 82.5, "reps": 5, "is_warmup": False}]},
            {"exercise_id": "squat", "sets": [{"weight": 100, "reps": 5, "is_warmup": False}]},
        ]},
        {"id": "w1", "date": "2026-06-07", "entries": [
            {"exercise_id": "bench", "sets": [{"weight": 80, "reps": 5, "is_warmup": False}]},
        ]},
    ]
    h = extract_history("bench", workouts)
    assert len(h) == 2
    assert h[0]["workout_id"] == "w2" and h[0]["date"] == "2026-06-10"
    assert h[0]["sets"][0]["weight"] == 82.5


# ---- search ranking: name phrase beats alias/muscle, recency floats up ----

def test_score_prefers_name_phrase_over_alias_expansion():
    from app.services.exercise_service import _score_exercise, _expand_query
    terms = _expand_query("shoulder press")
    orig = ["shoulder", "press"]
    shoulder_press = {
        "name": "Barbell Shoulder Press", "primary_muscles": ["shoulders"],
        "secondary_muscles": [], "movement_pattern": "push", "equipment": "barbell",
    }
    push_press = {
        "name": "Push Press", "primary_muscles": ["shoulders"],
        "secondary_muscles": [], "movement_pattern": "push", "equipment": "barbell",
    }
    # "shoulder press" appears verbatim in the first name; the second only
    # matches via the press->push alias + the shoulders muscle.
    assert _score_exercise(shoulder_press, terms, orig) > _score_exercise(push_press, terms, orig)


def test_recent_exercise_ids_orders_by_workout_recency():
    from unittest.mock import MagicMock, patch
    from app.services import exercise_service

    def _snap(ids):
        m = MagicMock()
        m.to_dict.return_value = {"exercise_ids": ids}
        return m

    # workout 0 (most recent) has e1; workout 1 has e1 + e2
    stream = [_snap(["e1"]), _snap(["e1", "e2"])]
    db = MagicMock()
    db.collection.return_value.where.return_value.order_by.return_value.limit.return_value.stream.return_value = stream
    with patch.object(exercise_service, "get_db", return_value=db):
        order = exercise_service._recent_exercise_ids("u1")
    assert order["e1"] == 0  # first seen in the most-recent workout
    assert order["e2"] == 1


def test_list_exercises_floats_recent_matches_up():
    from unittest.mock import patch
    from app.services import exercise_service

    a = {"id": "a", "name": "Cable Press", "primary_muscles": ["chest"],
         "secondary_muscles": [], "movement_pattern": "push", "equipment": "cable", "user_id": "system"}
    b = {"id": "b", "name": "Machine Press", "primary_muscles": ["chest"],
         "secondary_muscles": [], "movement_pattern": "push", "equipment": "machine", "user_id": "system"}
    # Both match "press" equally; b was used recently, so it should rank first.
    with patch.object(exercise_service, "_collect_exercise_docs", return_value=[a, b], create=True), \
         patch.object(exercise_service, "_recent_exercise_ids", return_value={"b": 0}), \
         patch.object(exercise_service, "get_db") as mock_db:
        mock_db.return_value.collection.return_value.where.return_value.stream.return_value = []
        # Feed docs directly by patching the query stream to yield a, b.
        import types
        def _stream():
            for d in (a, b):
                m = types.SimpleNamespace(to_dict=lambda d=d: {k: v for k, v in d.items() if k != "id"}, id=d["id"])
                yield m
        mock_db.return_value.collection.return_value.where.return_value.stream.side_effect = lambda: _stream()
        result = exercise_service.list_exercises("u1", q="press")
    ids = [d["id"] for d in result]
    assert ids and ids[0] == "b"
