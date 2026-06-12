from unittest.mock import patch


def test_complete_passes_model_and_metadata():
    from app.services import llm
    with patch("app.services.llm.litellm") as ll:
        llm.complete([{"role": "user", "content": "x"}], metadata={"session_id": "c1"})
        kwargs = ll.completion.call_args.kwargs
        assert kwargs["model"] == "openai/gpt-5.5"
        assert kwargs["metadata"] == {"session_id": "c1"}


def test_langfuse_callbacks_enabled_when_keys_present(monkeypatch):
    from app.services import llm

    class _S:
        langfuse_public_key = "pk"
        langfuse_secret_key = "sk"
        langfuse_base_url = "https://cloud.langfuse.com"
        chat_model = "openai/gpt-5.5"
        openai_api_key = ""

    monkeypatch.setattr(llm, "_configured", False)
    monkeypatch.setattr(llm, "get_settings", lambda: _S())
    with patch("app.services.llm.litellm") as ll:
        llm.complete([{"role": "user", "content": "x"}])
        assert ll.success_callback == ["langfuse"]
