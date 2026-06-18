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
             metadata: dict | None = None, model: str | None = None,
             response_format: dict | None = None):
    """Single non-streamed completion via LiteLLM. Model + key from settings."""
    _configure_langfuse()
    s = get_settings()
    chosen_model = model or s.chat_model
    try:
        import sentry_sdk
        ctx = sentry_sdk.start_span(op="llm.completion", description=chosen_model)
    except Exception:
        from contextlib import nullcontext
        ctx = nullcontext()
    with ctx as span:
        if span is not None:
            try:
                span.set_data("model", chosen_model)
                if metadata and metadata.get("generation_name"):
                    span.set_tag("generation_name", metadata["generation_name"])
            except Exception:
                pass
        resp = litellm.completion(
            model=chosen_model,
            messages=messages,
            tools=tools or None,
            api_key=s.openai_api_key or None,
            metadata=metadata or None,
            response_format=response_format,
        )
        if span is not None:
            try:
                u = getattr(resp, "usage", None) or {}
                span.set_data("input_tokens", getattr(u, "prompt_tokens", 0) or 0)
                span.set_data("output_tokens", getattr(u, "completion_tokens", 0) or 0)
            except Exception:
                pass
        return resp
