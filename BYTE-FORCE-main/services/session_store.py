"""
In-memory session: conversation messages, per-analyze history with full metrics.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from threading import Lock
from typing import Any

from services.token_service import calculate_cost

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


def clear_messages(session_id: str) -> dict | None:
    with _lock:
        s = _sessions.get(session_id)
        if not s:
            return None
        s["messages"] = []
        s["total_tokens"] = 0
        return _snapshot_unlocked(s)


def append_message(session_id: str, role: str, content: str, tokens: int) -> dict | None:
    with _lock:
        s = _sessions.get(session_id)
        if not s:
            return None
        s["messages"].append({"role": role, "content": content, "tokens": int(tokens)})
        s["total_tokens"] += int(tokens)
        return _snapshot_unlocked(s)


def record_analyze_run(
    session_id: str,
    *,
    original_tokens: int,
    trimmed_tokens: int,
    saved_tokens: int,
    savings_pct: float,
    prompt_preview: str,
    model: str,
) -> dict | None:
    with _lock:
        s = _sessions.get(session_id)
        if not s:
            return None
        qid = len(s["query_history"]) + 1
        s["query_history"].append(
            {
                "query_id": qid,
                "timestamp": _utc_iso(),
                "tokens_used": int(original_tokens),
                "original_tokens": int(original_tokens),
                "trimmed_tokens": int(trimmed_tokens),
                "saved_tokens": int(saved_tokens),
                "savings_pct": round(float(savings_pct), 2),
                "prompt_preview": (prompt_preview or "")[:200],
                "model": model,
            }
        )
        return _snapshot_unlocked(s)


def _snapshot_unlocked(s: dict) -> dict:
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
        return _snapshot_unlocked(s)


def history_dashboard(session_id: str) -> dict | None:
    """Aggregates + rows for History tab."""
    with _lock:
        s = _sessions.get(session_id)
        if not s:
            return None
        qh = list(s["query_history"])
    if not qh:
        return {
            "session_id": session_id,
            "totals": {
                "total_original": 0,
                "total_trimmed": 0,
                "total_saved": 0,
                "avg_savings_pct": 0.0,
                "runs": 0,
            },
            "runs": [],
        }
    tot_o = sum(r.get("original_tokens", r.get("tokens_used", 0)) for r in qh)
    tot_t = sum(r.get("trimmed_tokens", 0) for r in qh)
    tot_s = sum(r.get("saved_tokens", 0) for r in qh)
    avg_sv = sum(r.get("savings_pct", 0) for r in qh) / len(qh)
    return {
        "session_id": session_id,
        "totals": {
            "total_original": tot_o,
            "total_trimmed": tot_t,
            "total_saved": tot_s,
            "avg_savings_pct": round(avg_sv, 2),
            "runs": len(qh),
        },
        "runs": qh,
    }


def conversation_dashboard(session_id: str, model: str) -> dict | None:
    with _lock:
        s = _sessions.get(session_id)
        if not s:
            return None
        messages = list(s["messages"])
        qh = list(s["query_history"])
    user_t = sum(m["tokens"] for m in messages if m.get("role") == "user")
    asst_t = sum(m["tokens"] for m in messages if m.get("role") == "assistant")
    total = user_t + asst_t
    est_cost = calculate_cost(total, model) if model else 0.0
    tokens_saved_analyzer = sum(r.get("saved_tokens", 0) for r in qh)
    return {
        "session_id": session_id,
        "message_count": len(messages),
        "user_tokens": user_t,
        "assistant_tokens": asst_t,
        "total_tokens": total,
        "estimated_cost_usd": round(est_cost, 10),
        "tokens_saved": tokens_saved_analyzer,
        "messages": messages,
    }
