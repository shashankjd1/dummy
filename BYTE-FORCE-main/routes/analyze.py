from fastapi import HTTPException
from pydantic import BaseModel

from services import session_store
from services.token_service import run_analyze


class AnalyzeRequest(BaseModel):
    prompt: str
    model: str = "gpt-4o-mini"
    session_id: str | None = None
    append_to_session: bool = False


def analyze_prompt(req: AnalyzeRequest):
    try:
        result = run_analyze(req.prompt, req.model)
        if req.session_id:
            if session_store.session_snapshot(req.session_id) is None:
                raise HTTPException(
                    status_code=404,
                    detail="Unknown session_id. POST /api/session first.",
                )
            if req.append_to_session:
                session_store.append_message(
                    req.session_id,
                    "user",
                    req.prompt,
                    result["original_tokens"],
                )
            snap = session_store.record_analyze_run(
                req.session_id,
                original_tokens=result["original_tokens"],
                trimmed_tokens=result["trimmed_tokens"],
                saved_tokens=result["saved_tokens"],
                savings_pct=result["savings_percentage"],
                prompt_preview=req.prompt[:200],
                model=req.model,
            )
            result = {**result, "session": snap}
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
