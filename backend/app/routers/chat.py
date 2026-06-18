import asyncio
import json
import logging

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.auth.dependencies import CurrentUser, get_current_user
from app.chat.generation import generate_turn_sync
from app.config import get_settings
from app.services import chat_store

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/v1/chat", tags=["chat"])

_BG_TASKS: set[asyncio.Task] = set()  # pin against GC

POLL_INTERVAL_S = 0.2
KEEPALIVE_EVERY_S = 10


class StartRequest(BaseModel):
    message: str = Field(min_length=1, max_length=4000)
    conversation_id: str | None = None


def _spawn_generation(user_id: str, conv_id: str, turn_id: str, history: list[dict]) -> None:
    task = asyncio.create_task(
        asyncio.to_thread(generate_turn_sync, user_id, conv_id, turn_id, history))
    _BG_TASKS.add(task)
    task.add_done_callback(_BG_TASKS.discard)


@router.post("/start")
async def start(body: StartRequest, user: CurrentUser = Depends(get_current_user)):
    if body.conversation_id:
        conv = await asyncio.to_thread(chat_store.get_conversation, body.conversation_id, user.user_id)
        if conv is None:
            raise HTTPException(status_code=404, detail="Conversation not found")
        conv_id = conv["id"]
    else:
        conv = await asyncio.to_thread(
            chat_store.create_conversation, user.user_id, body.message[:60])
        conv_id = conv["id"]

    prior = await asyncio.to_thread(chat_store.list_turns, conv_id, user.user_id) or []
    history = [{"role": t["role"], "content": t["content"]}
               for t in prior if t.get("content")]
    history.append({"role": "user", "content": body.message})

    user_turn = await asyncio.to_thread(
        chat_store.create_turn, conv_id, user.user_id, "user", body.message, "completed")
    asst_turn = await asyncio.to_thread(
        chat_store.create_turn, conv_id, user.user_id, "assistant", "", "pending")

    _spawn_generation(user.user_id, conv_id, asst_turn["id"], history)
    from app.observability import track
    track("chat.message.sent", user_id=user.user_id, conversation_id=conv_id, message_len=len(body.message))
    return {"conversation_id": conv_id, "user_turn_id": user_turn["id"],
            "assistant_turn_id": asst_turn["id"]}


@router.get("/conversations")
async def conversations(user: CurrentUser = Depends(get_current_user)):
    return await asyncio.to_thread(chat_store.list_conversations, user.user_id)


@router.get("/conversations/{conv_id}")
async def conversation(conv_id: str, user: CurrentUser = Depends(get_current_user)):
    conv = await asyncio.to_thread(chat_store.get_conversation, conv_id, user.user_id)
    if conv is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    turns = await asyncio.to_thread(chat_store.list_turns, conv_id, user.user_id) or []
    return {**conv, "turns": turns}


@router.get("/conversations/{conv_id}/turns/{turn_id}/stream")
async def stream(conv_id: str, turn_id: str, from_seq: int = 0,
                 user: CurrentUser = Depends(get_current_user)):
    turn = await asyncio.to_thread(chat_store.get_turn, conv_id, turn_id, user.user_id)
    if turn is None:
        raise HTTPException(status_code=404, detail="Turn not found")

    async def gen():
        last_seq = from_seq
        last_keepalive = asyncio.get_event_loop().time()
        deadline = last_keepalive + get_settings().chat_generation_timeout_s
        current = turn
        while True:
            for e in chat_store.next_events(current, last_seq):
                last_seq = e["seq"]
                yield f"data: {json.dumps(e)}\n\n"
            if chat_store.is_terminal(current):
                return
            now = asyncio.get_event_loop().time()
            if now > deadline:
                yield f'data: {json.dumps({"seq": last_seq + 1, "type": "error", "message": "stream timeout"})}\n\n'
                return
            if now - last_keepalive > KEEPALIVE_EVERY_S:
                last_keepalive = now
                yield ": keepalive\n\n"
            await asyncio.sleep(POLL_INTERVAL_S)
            current = await asyncio.to_thread(chat_store.get_turn, conv_id, turn_id, user.user_id) or current

    return StreamingResponse(gen(), media_type="text/event-stream", headers={
        "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no",
    })
