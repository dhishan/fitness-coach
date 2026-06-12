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
