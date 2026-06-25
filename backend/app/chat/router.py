import re
from typing import Literal, Optional

from app.config import get_settings
from app.services import llm

# Quality-first routing. Coaching ADVICE (recommendations, "what should I…",
# "why", planning, analysis) is the heart of the product and must use the
# strong model. Only narrow, single-fact DATA LOOKUPS go to the cheap model.

# Clear advice / analysis / planning signals -> strong model.
_COMPLEX_RE = re.compile(
    r"\b("
    r"recommend|suggest|should i|what should|what do i|what do you|"
    r"why|because|explain|"
    r"plan|program|programme|split|routine|periodi[sz]|mesocycle|deload|"
    r"analy[sz]e|analysis|compare|improve|progress(?:ion)?|optimi[sz]e|"
    r"better|worse|too (?:much|little|heavy|light)|enough|"
    r"what(?:'?s| is) next|whats next|next (?:exercise|move|lift|set)|"
    r"focus on|work on|target|weak|lagging|plateau|stall|form|technique|"
    r"how (?:do|should|can) i|is it (?:ok|okay|fine|good|bad)|do you think"
    r")\b",
    re.IGNORECASE,
)

# Clear single-fact data-lookup signals -> cheap model is fine.
_SIMPLE_RE = re.compile(
    r"^\s*("
    r"how many\b|how much did|what(?:'?s| is| was) my (?:best|max|pr|current|last|total|average|avg)\b|"
    r"show (?:me|my)\b|list (?:my)?\b|when did i\b|how long\b|"
    r"what(?:'?s| is| was) my .* (?:weight|bench|squat|deadlift|press|pr|max|total)\b"
    r")",
    re.IGNORECASE,
)

# Short throwaway follow-ups / acknowledgements -> cheap.
_FOLLOWUP_PREFIXES = ("and ", "what about", "ok ", "okay", "thanks", "thank you", "got it", "cool", "nice")

CLASSIFIER_SYSTEM = (
    "Classify a fitness-coaching message as 'simple' or 'complex'. "
    "simple = a single fact or recent number answered by ONE data lookup with no "
    "reasoning (e.g. 'how many sessions this week', 'what is my best bench', "
    "'show my last workout'). "
    "complex = ANYTHING needing judgment: recommendations, advice, what-should-I, "
    "why questions, form/technique, programming, planning, analysis, comparisons, "
    "or anything ambiguous. "
    "When in doubt, answer 'complex' — a coach should reason carefully. "
    "Reply with exactly one word, lowercase: simple or complex."
)


def _heuristic(text: str) -> Optional[Literal["simple", "complex"]]:
    t = text.strip()
    if not t:
        return "complex"
    low = t.lower()
    # Advice signals win — never send these to the weak model.
    if _COMPLEX_RE.search(low):
        return "complex"
    if low.startswith(_FOLLOWUP_PREFIXES):
        return "simple"
    if _SIMPLE_RE.match(low):
        return "simple"
    return None  # let the LLM decide; it defaults to complex when unsure


def classify(messages: list[dict]) -> Literal["simple", "complex"]:
    """Quality-first: only clear single-fact lookups go cheap; everything
    advisory (the bulk of coaching) uses the strong model."""
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
        # Bias to quality: only an explicit 'simple' uses the cheap model.
        return "simple" if "simple" in out else "complex"
    except Exception:
        return "complex"


def select_model(messages: list[dict]) -> str:
    s = get_settings()
    if not s.chat_router_enabled:
        return s.chat_model
    return s.chat_model_cheap if classify(messages) == "simple" else s.chat_model
