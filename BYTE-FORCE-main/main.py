"""
TokenScope — FastAPI entrypoint.
Registers modular routes (analyze, compare, history, export, session) and static files.
"""
import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from routes.analyze import analyze_prompt
from routes.compare import compare_prompts
from routes.conversation import (
    add_conversation_message,
    clear_conversation,
    get_conversation_view,
)
from routes.export_pdf import export_pdf
from routes.history import get_history
from routes.session_routes import (
    create_session,
    delete_session_route,
    get_session,
    reset_session,
)
from utils.constants import MODEL_PRICING

logger = logging.getLogger("tokenscope")

# Resolve paths from this file so StaticFiles / FileResponse work even if cwd differs.
_ROOT = os.path.dirname(os.path.abspath(__file__))
_STATIC_DIR = os.path.join(_ROOT, "static")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Explicit lifecycle — logs help confirm whether shutdown is app-driven or external."""
    logger.info("TokenScope: lifespan startup (routes and static are ready)")
    yield
    logger.info("TokenScope: lifespan shutdown (process received stop signal or parent exited)")


app = FastAPI(
    title="TokenScope",
    version="3.0.0",
    description="LLM prompt analyzer with sessions, compare, history, and PDF export",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

os.makedirs(_STATIC_DIR, exist_ok=True)

if not logging.getLogger().handlers:
    logging.basicConfig(
        level=logging.INFO,
        format="%(levelname)s %(name)s: %(message)s",
    )


def _dup(path_api: str, path_short: str, handler, methods: list[str]):
    app.add_api_route(path_api, handler, methods=methods)
    app.add_api_route(path_short, handler, methods=methods)


_dup("/api/analyze", "/analyze", analyze_prompt, ["POST"])
_dup("/api/compare", "/compare", compare_prompts, ["POST"])
_dup("/api/history/{session_id}", "/history/{session_id}", get_history, ["GET"])
_dup("/api/export", "/export", export_pdf, ["POST"])

app.add_api_route("/api/conversation/message", add_conversation_message, methods=["POST"])
app.add_api_route("/conversation/message", add_conversation_message, methods=["POST"])
app.add_api_route("/api/conversation/clear", clear_conversation, methods=["POST"])
app.add_api_route("/conversation/clear", clear_conversation, methods=["POST"])
app.add_api_route(
    "/api/session/{session_id}/conversation",
    get_conversation_view,
    methods=["GET"],
)
app.add_api_route(
    "/session/{session_id}/conversation",
    get_conversation_view,
    methods=["GET"],
)

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


app.mount("/static", StaticFiles(directory=_STATIC_DIR), name="static")


@app.get("/")
def read_root():
    index_path = os.path.join(_STATIC_DIR, "index.html")
    if not os.path.isfile(index_path):
        logger.error("Missing %s — create static/index.html or fix deployment path", index_path)
    return FileResponse(index_path)
