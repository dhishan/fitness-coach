def test_seed_catalog_shape():
    from app.seed.exercises import SEED_EXERCISES
    from app.schemas import ExerciseCreate
    assert len(SEED_EXERCISES) >= 24
    ids = [e["id"] for e in SEED_EXERCISES]
    assert len(ids) == len(set(ids)), "ids must be unique and stable"
    for e in SEED_EXERCISES:
        assert e["id"].startswith("sys-")
        ExerciseCreate(**{k: v for k, v in e.items() if k != "id"})  # validates
