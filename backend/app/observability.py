"""Sentry helpers. No-op if Sentry not initialized."""
from typing import Any

try:
    import sentry_sdk
except ImportError:
    sentry_sdk = None


def track(event: str, user_id: str | None = None, **extras: Any) -> None:
    if sentry_sdk is None:
        return
    try:
        with sentry_sdk.push_scope() as scope:
            if user_id:
                scope.set_user({"id": user_id})
            for k, v in extras.items():
                scope.set_extra(k, v)
            scope.set_tag("event_name", event)
            sentry_sdk.capture_message(event, level="info")
    except Exception:
        pass
