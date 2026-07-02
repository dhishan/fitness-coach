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
    history_best = {"bench": {"weight": 85.0}}
    prs = detect_prs(entries, history_best)
    assert prs == [{"exercise_id": "bench", "exercise_name": "Bench",
                    "weight": 90, "previous_best": 85.0}]
    assert detect_prs(entries, {"bench": {"weight": 95.0}}) == []


def test_compute_total_volume_excludes_time_sets():
    from app.services.workout_service import compute_total_volume
    entries = [
        {"exercise_id": "bench", "tracking": "reps", "sets": [
            {"weight": 80, "reps": 5, "is_warmup": False}]},
        {"exercise_id": "plank", "tracking": "time", "sets": [
            {"weight": 0, "reps": 0, "duration_s": 60, "is_warmup": False}]},
    ]
    # only the bench set contributes; the plank hold is excluded
    assert compute_total_volume(entries) == 80 * 5


def test_detect_prs_time_longest_hold():
    from app.services.workout_service import detect_prs
    entries = [{"exercise_id": "plank", "exercise_name": "Plank", "tracking": "time", "sets": [
        {"weight": 0, "reps": 0, "duration_s": 90, "is_warmup": False},
        {"weight": 0, "reps": 0, "duration_s": 75, "is_warmup": False},
    ]}]
    history_best = {"plank": {"duration": 60.0}}
    prs = detect_prs(entries, history_best)
    assert prs == [{"exercise_id": "plank", "exercise_name": "Plank",
                    "duration_s": 90, "previous_best_duration_s": 60.0}]
    # not a PR if the previous best hold is longer
    assert detect_prs(entries, {"plank": {"duration": 120.0}}) == []
