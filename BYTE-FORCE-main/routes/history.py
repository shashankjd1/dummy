from fastapi import HTTPException

from services import session_store


def get_history(session_id: str):
    dash = session_store.history_dashboard(session_id)
    if dash is None:
        raise HTTPException(status_code=404, detail="Session not found")
    runs = dash["runs"]
    return {
        "session_id": dash["session_id"],
        "totals": dash["totals"],
        "runs": runs,
        "query_history": runs,
        "total_queries": len(runs),
    }
