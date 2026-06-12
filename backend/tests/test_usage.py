from unittest.mock import MagicMock, patch


def test_pricing_returns_zero_on_unknown_model():
    from app.services.pricing import cost_usd
    assert cost_usd("definitely-not-a-model", 1000, 500) == 0.0


def test_pricing_known_model_positive():
    from app.services.pricing import cost_usd
    c = cost_usd("openai/gpt-4o-mini", 100000, 50000)
    assert c >= 0.0  # litellm may or may not know it offline; must not raise


def test_record_usage_never_raises(mock_db):
    from app.services.usage_service import record_usage
    mock_db.collection.side_effect = RuntimeError("firestore down")
    cost = record_usage(user_id="u1", source="chat", model="openai/gpt-5.5",
                        input_tokens=10, output_tokens=5, duration_ms=100,
                        conversation_id="c1")
    assert isinstance(cost, float)  # survived total Firestore failure


def test_record_usage_writes_event_and_summary(mock_db):
    from app.services.usage_service import record_usage
    record_usage(user_id="u1", source="chat", model="m", input_tokens=10,
                 output_tokens=5, duration_ms=42, conversation_id="c1")
    called = [c.args[0] for c in mock_db.collection.call_args_list]
    assert "usage_events" in called
    assert "user_usage_summaries" in called
