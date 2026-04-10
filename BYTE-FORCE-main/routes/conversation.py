from typing import Literal

from fastapi import HTTPException, Query
from pydantic import BaseModel

from services import session_store
from services.token_service import count_tokens


class ConversationClearRequest(BaseModel):
    session_id: str


class ConversationMessageRequest(BaseModel):
    session_id: str
    role: Literal["user", "assistant"]
    content: str
    model: str = "gpt-4o-mini"


def add_conversation_message(req: ConversationMessageRequest):
    if session_store.session_snapshot(req.session_id) is None:
        raise HTTPException(status_code=404, detail="Session not found")
    tokens = count_tokens(req.content, req.model)
    snap = session_store.append_message(
        req.session_id,
        req.role,
        req.content,
        tokens,
    )
    if not snap:
        raise HTTPException(status_code=404, detail="Session not found")
    return snap


def clear_conversation(req: ConversationClearRequest):
    snap = session_store.clear_messages(req.session_id)
    if not snap:
        raise HTTPException(status_code=404, detail="Session not found")
    return snap


def get_conversation_view(session_id: str, model: str = Query(default="gpt-4o-mini")):
    d = session_store.conversation_dashboard(session_id, model)
    if not d:
        raise HTTPException(status_code=404, detail="Session not found")
    return d
