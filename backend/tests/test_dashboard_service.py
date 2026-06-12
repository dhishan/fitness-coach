def _w(date, entries=None, volume=0.0):
    return {"id": f"w-{date}", "date": date, "entries": entries or [], "total_volume": volume}


def test_week_dates_iso():
    from app.services.dashboard_service import week_dates
    # 2026-06-12 is a Friday; ISO week starts Monday 2026-06-08
    assert week_dates("2026-06-12")[0] == "2026-06-08"
    assert len(week_dates("2026-06-12")) == 7


def test_streak_weeks_counts_consecutive():
    from app.services.dashboard_service import streak_weeks
    dates = ["2026-06-10", "2026-06-03", "2026-05-27"]  # 3 consecutive ISO weeks
    assert streak_weeks(dates, reference_date="2026-06-12") == 3
    assert streak_weeks([], reference_date="2026-06-12") == 0
    # gap week breaks the streak
    assert streak_weeks(["2026-06-10", "2026-05-20"], reference_date="2026-06-12") == 1


def test_exercise_series_top_set_and_volume():
    from app.services.dashboard_service import exercise_series
    workouts = [
        _w("2026-06-01", [{"exercise_id": "bench", "sets": [
            {"weight": 80, "reps": 5, "is_warmup": False},
            {"weight": 85, "reps": 3, "is_warmup": False}]}]),
        _w("2026-06-08", [{"exercise_id": "bench", "sets": [
            {"weight": 87.5, "reps": 2, "is_warmup": False}]}]),
    ]
    series = exercise_series("bench", workouts)
    assert series == [
        {"date": "2026-06-01", "top_weight": 85, "volume": 80 * 5 + 85 * 3},
        {"date": "2026-06-08", "top_weight": 87.5, "volume": 87.5 * 2},
    ]


def test_muscle_split():
    from app.services.dashboard_service import muscle_split
    workouts = [_w("2026-06-10", [
        {"exercise_id": "bench", "sets": [{"weight": 100, "reps": 10, "is_warmup": False}]},
    ])]
    ex_map = {"bench": {"primary_muscles": ["chest", "triceps"]}}
    split = muscle_split(workouts, ex_map)
    # 1000 volume split evenly across 2 primary muscles
    assert split == {"chest": 500.0, "triceps": 500.0}
