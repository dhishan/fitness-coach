from typing import Literal

from app.config import get_settings
from app.services import llm

CLASSIFIER_SYSTEM = (
    "Classify the user's request as 'simple' or 'complex'. "
    "simple = a single fact or recent number answered by ONE tool call (e.g. "
    "'how many sessions this week', 'what is my best bench', 'show last workout'). "
    "Follow-up questions that just need to re-fetch one piece of data ('and the squat?', "
    "'what about last week?', 'show me cardio too') are also simple. "
    "complex = analysis, recommendation, plan change, multi-step reasoning, anything "
    "ambiguous, or anything asking 'why' or 'what should I do'. "
    "Reply with exactly one word, lowercase: simple or complex."
)


def classify(messages: list[dict]) -> Literal["simple", "complex"]:
    """Fallback to 'complex' on any error - favor accuracy over savings."""
    try:
        s = get_settings()
        # only the LAST user message matters for classification
        user_msgs = [m for m in messages if m.get("role") == "user"]
        if not user_msgs:
            return "complex"
        prompt = [
            {"role": "system", "content": CLASSIFIER_SYSTEM},
            {"role": "user", "content": user_msgs[-1]["content"]},
        ]
        resp = llm.complete(prompt, model=s.chat_router_model)
        text = (resp.choices[0].message.content or "").strip().lower()
        # Use substring check so "Simple." or "  simple\n" are handled correctly
        return "simple" if "simple" in text else "complex"
    except Exception:
        return "complex"


def select_model(messages: list[dict]) -> str:
    s = get_settings()
    if not s.chat_router_enabled:
        return s.chat_model
    return s.chat_model_cheap if classify(messages) == "simple" else s.chat_model
