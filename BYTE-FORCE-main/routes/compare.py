from fastapi import HTTPException
from pydantic import BaseModel

from services.token_service import run_compare


class CompareRequest(BaseModel):
    prompt_a: str
    prompt_b: str
    model: str = "gpt-4o-mini"


def compare_prompts(req: CompareRequest):
    try:
        return run_compare(req.prompt_a, req.prompt_b, req.model)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
