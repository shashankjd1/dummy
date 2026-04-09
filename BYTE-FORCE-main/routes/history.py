from fastapi import HTTPException

from services import session_store


def get_history(session_id: str):
    snap = session_store.session_snapshot(session_id)
    if not snap:
        raise HTTPException(status_code=404, detail="Session not found")
    return {
        "session_id": session_id,
        "query_history": snap["query_history"],
        "total_queries": len(snap["query_history"]),
    }
