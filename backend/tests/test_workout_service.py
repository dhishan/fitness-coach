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


# ---------------------------------------------------------------------------
# history_max_for — chunked array_contains_any
# ---------------------------------------------------------------------------


def _make_snap(data: dict, doc_id: str = "w1"):
    from unittest.mock import MagicMock
    s = MagicMock()
    s.id = doc_id
    s.to_dict.return_value = data
    return s


def test_history_max_for_empty_ids_returns_empty(mock_db):
    from app.services.workout_service import history_max_for
    result = history_max_for("u1", [], "w-exclude")
    assert result == {}
    # No Firestore calls should be made for empty list.
    mock_db.collection.assert_not_called()


def test_history_max_for_single_chunk_builds_best(mock_db):
    """With <=30 exercise_ids, a single array_contains_any query is issued."""
    from app.services.workout_service import history_max_for

    workout_doc = {
        "user_id": "u1",
        "date": "2026-06-01",
        "exercise_ids": ["e1", "e2"],
        "entries": [
            {"exercise_id": "e1", "sets": [
                {"weight": 100.0, "reps": 5, "is_warmup": False},
                {"weight": 80.0, "reps": 5, "is_warmup": True},   # warmup excluded
            ]},
            {"exercise_id": "e2", "sets": [
                {"weight": 0.0, "reps": 0, "duration_s": 60, "is_warmup": False},
            ]},
        ],
    }
    (
        mock_db.collection.return_value
        .where.return_value
        .where.return_value
        .order_by.return_value
        .limit.return_value
        .stream.return_value
    ) = iter([_make_snap(workout_doc, "w1")])

    result = history_max_for("u1", ["e1", "e2"], "w-exclude")

    assert result["e1"]["weight"] == 100.0
    assert result["e2"]["duration"] == 60.0
    assert "weight" not in result.get("e2", {})


def test_history_max_for_excludes_workout_id(mock_db):
    """Workout matching exclude_workout_id is skipped."""
    from app.services.workout_service import history_max_for

    workout_doc = {
        "user_id": "u1",
        "date": "2026-06-01",
        "exercise_ids": ["e1"],
        "entries": [{"exercise_id": "e1", "sets": [{"weight": 150.0, "reps": 3, "is_warmup": False}]}],
    }
    (
        mock_db.collection.return_value
        .where.return_value
        .where.return_value
        .order_by.return_value
        .limit.return_value
        .stream.return_value
    ) = iter([_make_snap(workout_doc, "w-exclude")])

    result = history_max_for("u1", ["e1"], "w-exclude")
    assert result == {}  # excluded


def test_history_max_for_chunks_at_30(mock_db):
    """31 exercise ids trigger two separate queries (chunks of 30 and 1)."""
    from app.services.workout_service import history_max_for

    # Return empty stream for every query so we just count the calls.
    mock_db.collection.return_value.where.return_value.where.return_value \
        .order_by.return_value.limit.return_value.stream.return_value = iter([])

    exercise_ids = [f"e{i}" for i in range(31)]
    history_max_for("u1", exercise_ids, "w-exclude")

    # collection("workouts") should be called twice — once per chunk.
    assert mock_db.collection.call_count == 2
