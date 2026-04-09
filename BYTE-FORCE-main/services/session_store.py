"""
In-memory session storage for multi-turn conversations and per-query token history.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from threading import Lock
from typing import Any

_lock = Lock()
_sessions: dict[str, dict[str, Any]] = {}


def _utc_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def create_session() -> str:
    sid = str(uuid.uuid4())
    with _lock:
        _sessions[sid] = {
            "session_id": sid,
            "messages": [],
            "total_tokens": 0,
            "query_history": [],
        }
    return sid


def delete_session(session_id: str) -> None:
    with _lock:
        _sessions.pop(session_id, None)


def append_message(session_id: str, role: str, content: str, tokens: int) -> dict | None:
    with _lock:
        s = _sessions.get(session_id)
        if not s:
            return None
        s["messages"].append({"role": role, "content": content, "tokens": tokens})
        s["total_tokens"] += int(tokens)
        return {
            "session_id": s["session_id"],
            "messages": list(s["messages"]),
            "total_tokens": s["total_tokens"],
            "query_history": list(s["query_history"]),
        }


def record_analyze_query(session_id: str, tokens_used: int) -> dict | None:
    """Append one analytics history point (one Analyze click = one query)."""
    with _lock:
        s = _sessions.get(session_id)
        if not s:
            return None
        qid = len(s["query_history"]) + 1
        s["query_history"].append(
            {
                "query_id": qid,
                "tokens_used": int(tokens_used),
                "timestamp": _utc_iso(),
            }
        )
        return {
            "session_id": s["session_id"],
            "messages": list(s["messages"]),
            "total_tokens": s["total_tokens"],
            "query_history": list(s["query_history"]),
        }


def session_snapshot(session_id: str) -> dict | None:
    with _lock:
        s = _sessions.get(session_id)
        if not s:
            return None
        return {
            "session_id": s["session_id"],
            "messages": list(s["messages"]),
            "total_tokens": s["total_tokens"],
            "query_history": list(s["query_history"]),
        }
