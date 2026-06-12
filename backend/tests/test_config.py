def test_chat_settings_defaults():
    from app.config import get_settings
    s = get_settings()
    assert s.chat_model == "openai/gpt-5.5"
    assert s.chat_max_events == 800
    assert s.chat_generation_timeout_s == 1800


def test_settings_load_from_env():
    from app.config import get_settings
    s = get_settings()
    assert s.environment == "test"
    assert s.firestore_database == "test-database"
    assert "iamdhishan@gmail.com" in s.allowed_emails_list
    assert s.cors_origins == ["http://localhost:5173"]
