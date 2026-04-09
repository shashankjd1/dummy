from fastapi import Body, HTTPException
from pydantic import BaseModel

from services import session_store


class ResetBody(BaseModel):
    session_id: str | None = None


def create_session():
    return {"session_id": session_store.create_session()}


def reset_session(body: ResetBody = Body(default_factory=ResetBody)):
    if body.session_id:
        session_store.delete_session(body.session_id)
    return {"session_id": session_store.create_session()}


def get_session(session_id: str):
    snap = session_store.session_snapshot(session_id)
    if not snap:
        raise HTTPException(status_code=404, detail="Session not found")
    return snap


def delete_session_route(session_id: str):
    session_store.delete_session(session_id)
    return {
        "session_id": session_store.create_session(),
        "message": "Previous session cleared; new session created.",
    }
