from fastapi import HTTPException
from fastapi.responses import Response
from pydantic import BaseModel

from services.pdf_service import build_analysis_pdf


class ExportRequest(BaseModel):
    prompt: str
    trimmed_prompt: str = ""
    model: str = "gpt-4o-mini"
    original_tokens: int = 0
    trimmed_tokens: int = 0
    cost_original_usd: float = 0.0
    cost_trimmed_usd: float = 0.0
    saved_tokens: int = 0
    savings_percentage: float = 0.0
    token_data: list = []
    tfidf_top_terms: list | None = None
    conversation_messages: list | None = None


def export_pdf(req: ExportRequest):
    try:
        payload = req.model_dump()
        pdf_bytes = build_analysis_pdf(payload)
        return Response(
            content=pdf_bytes,
            media_type="application/pdf",
            headers={
                "Content-Disposition": 'attachment; filename="tokenscope_report.pdf"'
            },
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
