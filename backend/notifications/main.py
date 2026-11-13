"""
FastAPI Application Entry Point for Inferxe Notification Service.
Runs standalone on port 8000 or can be imported into existing services.
"""

import sys
import os
import logging
from pathlib import Path
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

ROOT_DIR = Path(__file__).resolve().parents[2]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from .db import init_db, DBConnection, PG_DB, PG_HOST
from .router import router
from .auth import COGNITO_USER_POOL_ID, COGNITO_CLIENT_ID, _COGNITO_PLACEHOLDERS

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("inferxe.notifications")

RAG_MOUNTED = False
_RAG_MOUNT_ERROR = ""

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Safe database migration on startup
    try:
        init_db()
        logger.info("Database initialized successfully.")
    except Exception as e:
        logger.error("Failed to initialize database during startup (%s).", type(e).__name__)
    yield

app = FastAPI(
    title="Inferxe Multi-User Notification Service",
    description="Centralized, database-driven notification service with multi-tenant isolation, Cognito JWT authentication, and outbox reliability.",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS Middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "*"
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount notification router
app.include_router(router)

# Mount RAG AI Chatbot endpoint
try:
    from backend.rag.server import chat_endpoint, ChatRequest, CHROMA_PERSIST_DIR
    @app.post("/api/chat")
    async def chat_handler(payload: ChatRequest):
        return await chat_endpoint(payload)
    RAG_MOUNTED = True
    logger.info("RAG chat endpoint mounted successfully on /api/chat.")
except Exception as _rag_err:
    _RAG_MOUNT_ERROR = str(_rag_err)
    logger.warning(f"Could not mount RAG chat endpoint: {_rag_err}")


def _build_notifications_health() -> dict:
    db_connected = False
    db_name = PG_DB
    try:
        with DBConnection(autocommit=True) as conn:
            cur = conn.cursor()
            cur.execute("SELECT current_database();")
            row = cur.fetchone()
            db_connected = True
            if row and row[0]:
                db_name = row[0]
    except Exception:
        db_connected = False

    cognito_ok = (
        COGNITO_USER_POOL_ID not in _COGNITO_PLACEHOLDERS
        and COGNITO_CLIENT_ID not in _COGNITO_PLACEHOLDERS
    )
    overall = "ok" if db_connected else "degraded"
    return {
        "status": overall,
        "service": "inferxe-notifications-rag",
        "database_connected": db_connected,
        "database_name": db_name,
        "database_host": PG_HOST,
        "rag_mounted": RAG_MOUNTED,
        "rag_note": _RAG_MOUNT_ERROR if not RAG_MOUNTED else None,
        "cognito_configured": cognito_ok,
    }


@app.get("/")
def root():
    return {
        "service": "Inferxe Notifications & RAG API",
        "version": "1.0.0",
        "health": "/health",
        "api_health": "/api/health",
    }


@app.get("/health")
@app.get("/api/health")
def health_check():
    return _build_notifications_health()


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("NOTIFICATIONS_PORT", 8000))
    uvicorn.run("backend.notifications.main:app", host="127.0.0.1", port=port, reload=True)
