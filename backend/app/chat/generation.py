import json
import logging
import time

from app.chat.router import select_model
from app.chat.tools.definitions import TOOLS
from app.chat.tools.executor import execute_tool
from app.config import get_settings
from app.services import chat_store, llm, usage_service

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = (
    "You are a strength-training coach with access to the user's workout data via tools. "
    "Style: brief, direct, no filler. Two or three sentences is usually right; a short bulleted "
    "list is fine when listing prescriptions or findings. Never produce essay-length answers "
    "unless the user explicitly asks for a deep dive.\n\n"
    "Before answering, decide whether you have enough context. If the question is ambiguous "
    "(goal, body part, timeframe, intensity, injury status, equipment available), ask ONE "
    "concise clarifying question first and stop. Do not ask more than one question per turn. "
    "Once context is clear, call tools to ground every claim in the user's actual data "
    "rather than guessing.\n\n"
    "When you recommend changes (weight, reps, exercise swap, plan tweak), make them "
    "specific to what the data shows and explain in one short line WHY. Use kg unless the "
    "data says otherwise."
)

MAX_TOOL_ROUNDS = 6
TEXT_CHUNK = 400  # chars per text event


def _chunk_text(text: str) -> list[dict]:
    return [{"type": "text", "text": text[i:i + TEXT_CHUNK]}
            for i in range(0, len(text), TEXT_CHUNK)] or [{"type": "text", "text": ""}]


def generate_turn_sync(user_id: str, conv_id: str, turn_id: str,
                       history: list[dict]) -> None:
    """Agentic loop. Usage accumulated across sub-turns, recorded ONCE in finally."""
    start = time.monotonic()
    s = get_settings()
    total_in = total_out = 0
    final_text = ""
    status = "failed"
    chosen_model = s.chat_model  # default; overridden in try block
    turn = chat_store.get_turn(conv_id, turn_id, user_id) or {"id": turn_id, "events": []}
    messages = [{"role": "system", "content": SYSTEM_PROMPT}, *history]

    try:
        chosen_model = select_model(history)
        for _ in range(MAX_TOOL_ROUNDS):
            resp = llm.complete(messages, tools=TOOLS, model=chosen_model, metadata={
                "generation_name": "coach-turn",
                "session_id": conv_id,
                "trace_user_id": user_id,
                "tags": ["fitness-chat"],
            })
            usage = getattr(resp, "usage", None)
            total_in += getattr(usage, "prompt_tokens", 0) or 0
            total_out += getattr(usage, "completion_tokens", 0) or 0
            msg = resp.choices[0].message

            if getattr(msg, "tool_calls", None):
                messages.append({
                    "role": "assistant", "content": msg.content,
                    "tool_calls": [
                        {"id": tc.id, "type": "function",
                         "function": {"name": tc.function.name, "arguments": tc.function.arguments}}
                        for tc in msg.tool_calls
                    ],
                })
                for tc in msg.tool_calls:
                    args = json.loads(tc.function.arguments or "{}")
                    turn = chat_store.append_events(conv_id, turn_id, turn, [
                        {"type": "tool_call", "name": tc.function.name, "args": args}])
                    result = execute_tool(tc.function.name, args, user_id=user_id)
                    turn = chat_store.append_events(conv_id, turn_id, turn, [
                        {"type": "tool_result", "name": tc.function.name}])
                    messages.append({"role": "tool", "tool_call_id": tc.id,
                                     "content": json.dumps(result, default=str)})
                continue

            final_text = msg.content or ""
            turn = chat_store.append_events(conv_id, turn_id, turn, _chunk_text(final_text))
            status = "completed"
            break
        else:
            final_text = "I hit my tool-call limit for this question. Try narrowing it."
            turn = chat_store.append_events(conv_id, turn_id, turn, _chunk_text(final_text))
            status = "completed"

        chat_store.append_events(conv_id, turn_id, turn, [{"type": "done"}])
    except Exception as e:
        logger.exception("generation failed for turn %s", turn_id)
        try:
            chat_store.append_events(conv_id, turn_id, turn, [
                {"type": "error", "message": f"{type(e).__name__}: {e}"}])
        except Exception:
            logger.exception("failed to append error event")
    finally:
        duration_ms = int((time.monotonic() - start) * 1000)
        cost = usage_service.record_usage(
            user_id=user_id, source="chat", model=chosen_model,
            input_tokens=total_in, output_tokens=total_out,
            duration_ms=duration_ms, conversation_id=conv_id)
        try:
            chat_store.finalize_turn(conv_id, turn_id, final_text, status,
                                     total_in, total_out, cost)
        except Exception:
            logger.exception("finalize_turn failed")
