def test_compute_total_volume_skips_warmups():
    from app.services.workout_service import compute_total_volume
    entries = [
        {"exercise_id": "bench", "sets": [
            {"weight": 60, "reps": 10, "is_warmup": True},
            {"weight": 80, "reps": 5, "is_warmup": False},
            {"weight": 80, "reps": 5, "is_warmup": False},
        ]},
        {"exercise_id": "squat", "sets": [{"weight": 100, "reps": 5, "is_warmup": False}]},
    ]
    assert compute_total_volume(entries) == 80 * 5 * 2 + 100 * 5


def test_exercise_ids_from_entries():
    from app.services.workout_service import exercise_ids_from_entries
    entries = [{"exercise_id": "a", "sets": []}, {"exercise_id": "b", "sets": []},
               {"exercise_id": "a", "sets": []}]
    assert exercise_ids_from_entries(entries) == ["a", "b"]


def test_detect_prs():
    from app.services.workout_service import detect_prs
    entries = [{"exercise_id": "bench", "exercise_name": "Bench", "sets": [
        {"weight": 90, "reps": 3, "is_warmup": False}]}]
    history_max = {"bench": 85.0}
    prs = detect_prs(entries, history_max)
    assert prs == [{"exercise_id": "bench", "exercise_name": "Bench",
                    "weight": 90, "previous_best": 85.0}]
    assert detect_prs(entries, {"bench": 95.0}) == []
