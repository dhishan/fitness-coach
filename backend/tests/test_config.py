def test_settings_load_from_env():
    from app.config import get_settings
    s = get_settings()
    assert s.environment == "test"
    assert s.firestore_database == "test-database"
    assert "iamdhishan@gmail.com" in s.allowed_emails_list
    assert s.cors_origins == ["http://localhost:5173"]
