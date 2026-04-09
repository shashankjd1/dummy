"""
TokenScope — FastAPI entrypoint.
Registers modular routes (analyze, compare, history, export, session) and static files.
"""
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from routes.analyze import analyze_prompt
from routes.compare import compare_prompts
from routes.export_pdf import export_pdf
from routes.history import get_history
from routes.session_routes import (
    create_session,
    delete_session_route,
    get_session,
    reset_session,
)
from utils.constants import MODEL_PRICING

app = FastAPI(
    title="TokenScope",
    version="3.0.0",
    description="LLM prompt analyzer with sessions, compare, history, and PDF export",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

os.makedirs("static", exist_ok=True)


def _dup(path_api: str, path_short: str, handler, methods: list[str]):
    app.add_api_route(path_api, handler, methods=methods)
    app.add_api_route(path_short, handler, methods=methods)


_dup("/api/analyze", "/analyze", analyze_prompt, ["POST"])
_dup("/api/compare", "/compare", compare_prompts, ["POST"])
_dup("/api/history/{session_id}", "/history/{session_id}", get_history, ["GET"])
_dup("/api/export", "/export", export_pdf, ["POST"])

app.add_api_route("/api/session", create_session, methods=["POST"])
app.add_api_route("/session", create_session, methods=["POST"])
app.add_api_route("/api/session/reset", reset_session, methods=["POST"])
app.add_api_route("/session/reset", reset_session, methods=["POST"])
app.add_api_route("/api/session/{session_id}", get_session, methods=["GET"])
app.add_api_route("/session/{session_id}", get_session, methods=["GET"])
app.add_api_route("/api/session/{session_id}", delete_session_route, methods=["DELETE"])
app.add_api_route("/session/{session_id}", delete_session_route, methods=["DELETE"])


@app.get("/api/models")
def get_models():
    return {"models": MODEL_PRICING}


app.mount("/static", StaticFiles(directory="static"), name="static")


@app.get("/")
def read_root():
    return FileResponse("static/index.html")
