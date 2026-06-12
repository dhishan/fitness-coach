import logging

logger = logging.getLogger(__name__)


def cost_usd(model: str, input_tokens: int, output_tokens: int) -> float:
    """Lazy-import litellm; any failure returns 0.0 - metering must never crash callers."""
    try:
        import litellm

        ip, op = litellm.cost_per_token(
            model=model,
            prompt_tokens=input_tokens,
            completion_tokens=output_tokens,
        )
        return float((ip or 0.0) + (op or 0.0))
    except Exception:
        logger.warning("cost_per_token failed for model=%s", model, exc_info=True)
        return 0.0
