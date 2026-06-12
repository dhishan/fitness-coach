import litellm

from app.config import get_settings


def complete(messages: list[dict], tools: list[dict] | None = None):
    """Single non-streamed completion via LiteLLM. Model + key from settings."""
    s = get_settings()
    return litellm.completion(
        model=s.chat_model,
        messages=messages,
        tools=tools or None,
        api_key=s.openai_api_key or None,
    )
