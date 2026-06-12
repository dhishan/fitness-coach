import os

import litellm

from app.config import get_settings

_configured = False


def _configure_langfuse() -> None:
    global _configured
    if _configured:
        return
    s = get_settings()
    if s.langfuse_public_key and s.langfuse_secret_key:
        os.environ.setdefault("LANGFUSE_PUBLIC_KEY", s.langfuse_public_key)
        os.environ.setdefault("LANGFUSE_SECRET_KEY", s.langfuse_secret_key)
        if s.langfuse_base_url:
            os.environ.setdefault("LANGFUSE_HOST", s.langfuse_base_url)
        litellm.success_callback = ["langfuse"]
        litellm.failure_callback = ["langfuse"]
    _configured = True


def complete(messages: list[dict], tools: list[dict] | None = None,
             metadata: dict | None = None):
    """Single non-streamed completion via LiteLLM. Model + key from settings."""
    _configure_langfuse()
    s = get_settings()
    return litellm.completion(
        model=s.chat_model,
        messages=messages,
        tools=tools or None,
        api_key=s.openai_api_key or None,
        metadata=metadata or None,
    )
