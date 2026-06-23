import re
from typing import Literal, Optional

from app.config import get_settings
from app.services import llm

# Phrases that signal genuinely heavy work — always use the strong model.
# Word-boundaried so "plan" doesn't fire on "plank", "split" not on "splits".
_COMPLEX_RE = re.compile(
    r"\b("
    r"program|programme|mesocycle|macrocycle|periodi[sz]e|periodization|periodisation|"
    r"split|routine for|plan for|a plan|give me a plan|make a plan|build me|"
    r"design|analy[sz]e|analysis|compare|trade[- ]?offs?|"
    r"plateau|stalled|stalling|deload|"
    r"over the next|for the next|how (?:should|do) i structure|should i switch"
    r")\b",
    re.IGNORECASE,
)

# In a coaching chat, short messages are almost always quick lookups, quick
# advice, or follow-ups — the cheap model handles them well.
_SIMPLE_MAX_WORDS = 12

CLASSIFIER_SYSTEM = (
    "You route a fitness-coaching message to a cheap model ('simple') or a "
    "strong model ('complex'). Default to 'simple' — the cheap model answers "
    "most coaching questions well. "
    "simple = factual lookups, recent numbers, quick advice, form/technique "
    "tips, what-to-log questions, single-exercise or single-day recommendations, "
    "and any short follow-up. "
    "complex = ONLY genuinely heavy work: designing a multi-week program or "
    "training split, analyzing trends across many sessions, diagnosing a "
    "plateau, or weighing several options with detailed trade-offs. "
    "When unsure, answer 'simple'. Reply with exactly one word: simple or complex."
)


def _heuristic(text: str) -> Optional[Literal["simple", "complex"]]:
    """Cheap, deterministic pre-filter that avoids an LLM call for obvious cases.

    Returns None when the message is medium/long with no strong signal, leaving
    the final call to the LLM classifier.
    """
    t = text.strip()
    if not t:
        return "simple"
    if _COMPLEX_RE.search(t):
        return "complex"
    if len(t.split()) <= _SIMPLE_MAX_WORDS:
        return "simple"
    return None


def classify(messages: list[dict]) -> Literal["simple", "complex"]:
    """Bias toward 'simple' (cheap). Only escalate clearly-heavy requests.

    Order: heuristic short-circuit -> LLM classifier (bias simple) -> on error,
    prefer quality ('complex') since we only reach here for medium/long,
    no-strong-signal messages.
    """
    user_msgs = [m for m in messages if m.get("role") == "user"]
    if not user_msgs:
        return "complex"
    text = user_msgs[-1].get("content") or ""

    pre = _heuristic(text)
    if pre is not None:
        return pre

    try:
        s = get_settings()
        prompt = [
            {"role": "system", "content": CLASSIFIER_SYSTEM},
            {"role": "user", "content": text},
        ]
        resp = llm.complete(prompt, model=s.chat_router_model)
        out = (resp.choices[0].message.content or "").strip().lower()
        # Bias to cheap: only the strong model when the classifier clearly says so.
        return "complex" if "complex" in out else "simple"
    except Exception:
        return "complex"


def select_model(messages: list[dict]) -> str:
    s = get_settings()
    if not s.chat_router_enabled:
        return s.chat_model
    return s.chat_model_cheap if classify(messages) == "simple" else s.chat_model
