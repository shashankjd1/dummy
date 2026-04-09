# TokenScope v3 — Integration Guide

## Folder structure

```
BYTE-FORCE-main/
├── main.py                 # FastAPI app, CORS, static mount, route registration
├── requirements.txt
├── routes/
│   ├── __init__.py
│   ├── analyze.py          # POST /api/analyze, /analyze
│   ├── compare.py          # POST /api/compare, /compare
│   ├── history.py          # GET /api/history/{session_id}, /history/{session_id}
│   ├── export_pdf.py       # POST /api/export, /export (PDF)
│   └── session_routes.py   # Session create / get / reset / delete
├── services/
│   ├── __init__.py
│   ├── token_service.py    # tiktoken, TF-IDF, trim, analyze & compare logic
│   ├── session_store.py    # In-memory sessions (thread-locked dict)
│   └── pdf_service.py      # ReportLab PDF builder
├── utils/
│   ├── __init__.py
│   └── constants.py        # MODEL_PRICING
└── static/
    ├── index.html
    ├── style.css
    └── script.js
```

## Step-by-step: run locally

1. **Python 3.10+** recommended.
2. Create a virtual environment (optional): `python -m venv .venv` then activate it.
3. Install dependencies:
   ```text
   pip install -r requirements.txt
   ```
4. From the project directory (the folder that contains `main.py`):
   ```text
   uvicorn main:app --reload
   ```
5. Open `http://127.0.0.1:8000` in a browser.

## API summary

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/analyze` or `/analyze` | Analyze one prompt; optional `session_id` attaches to session |
| POST | `/api/compare` or `/compare` | Two prompts: tokens, USD cost, per-1K cost, winner |
| GET | `/api/history/{session_id}` or `/history/{session_id}` | Query history for charts |
| POST | `/api/export` or `/export` | JSON body → PDF download |
| POST | `/api/session` | Create `session_id` |
| GET | `/api/session/{session_id}` | Full session snapshot |
| POST | `/api/session/reset` | Optional body `{"session_id":"..."}`; returns new session |
| DELETE | `/api/session/{session_id}` | Clears session and creates a new id |

Existing **`GET /api/models`** is unchanged.

## Frontend integration notes

- **Session id** is stored in `localStorage` under `tokenscope_session_id`.
- Each **Analyze** sends `session_id` so the server appends the user message (`role`, `content`, `tokens`) and records a **history point** `{ query_id, tokens_used, timestamp }`.
- **Download Report** POSTs the last analysis JSON plus optional conversation from `GET /api/session/...`.

## Production caveats

- Sessions live **in memory**; restarting the server clears them. Clients should call `/api/session` again if `GET /api/session/{id}` returns 404.
