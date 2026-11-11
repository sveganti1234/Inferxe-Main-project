"""
FastAPI Application Entry Point for Inferxe Notification Service.
Runs standalone on port 8000 or can be imported into existing services.
"""

import sys
import logging
import traceback
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .db import init_db
from .router import router

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("inferxe.notifications")

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Safe database migration on startup
    try:
        init_db()
        logger.info("Database initialized successfully.")
    except Exception as e:
        # Log the actual exception message for local debugging; sanitize any secrets.
        safe_msg = _sanitize_startup_error(str(e))
        logger.error("Failed to initialize database during startup (%s): %s", type(e).__name__, safe_msg)
        logger.debug("Database startup traceback:\n%s", traceback.format_exc())
    yield


def _sanitize_startup_error(message: str) -> str:
    """Mask any PostgreSQL connection strings or credentials that may appear in an error message."""
    import re
    message = re.sub(r"postgresql://[^\s'\"\)]+", "postgresql://<redacted>", message)
    message = re.sub(r"password=[^\s'\"\)]+", "password=<redacted>", message)
    return message

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
    from backend.rag.server import chat_endpoint, ChatRequest
    @app.post("/api/chat")
    async def chat_handler(payload: ChatRequest):
        return await chat_endpoint(payload)
    logger.info("RAG chat endpoint mounted successfully on /api/chat.")
except Exception as _rag_err:
    logger.warning(f"Could not mount RAG chat endpoint: {_rag_err}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.notifications.main:app", host="127.0.0.1", port=8000, reload=True)
