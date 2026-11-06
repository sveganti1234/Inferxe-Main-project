"""
main.py
=======
FastAPI application entry point for the Inferxe Inference API service.
Provides Swagger UI at /docs, CORS middleware, and global error handling.

Usage:
  cd backend
  uvicorn inference.main:app --host 127.0.0.1 --port 8001 --reload
"""

import os
import sys
import logging
from pathlib import Path
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, status
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.exceptions import RequestValidationError

# Ensure backend root is on Python path
BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from inference.database import init_db, check_database_connection, get_masked_url, DATABASE_URL
from inference.routes import router

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("inferxe.api")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan: verify database and log startup configuration."""
    logger.info("Initializing Inferxe Inference Service...")
    logger.info(f"Target Database: {get_masked_url(DATABASE_URL)}")

    # Check database connectivity and create tables if reachable
    if check_database_connection():
        logger.info("Connected to PostgreSQL database. Verifying tables...")
        try:
            init_db()
            logger.info("Database tables initialized successfully.")
        except Exception as e:
            logger.error(f"Error initializing database schema: {e}")
    else:
        logger.warning(
            "PostgreSQL database is currently unreachable. "
            "Please ensure PostgreSQL service is running and credentials in backend/.env are valid."
        )

    yield

    logger.info("Shutting down Inferxe Inference Service.")


app = FastAPI(
    title="Inferxe Inference API",
    description=(
        "Enterprise LLM Inference Gateway. Bridges customer prompts to the NVIDIA Nemotron provider, "
        "enforces SHA-256 hashed customer API key authentication, and records token usage in PostgreSQL."
    ),
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_url="/api/v1/openapi.json",
    lifespan=lifespan
)

# CORS configuration
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

# Mount inference endpoints
app.include_router(router)


# Custom validation error handler (HTTP 422)
@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    errors = exc.errors()
    first_error = errors[0]["msg"] if errors else "Invalid request data"
    # Format safe JSON-serializable error details
    safe_errors = [
        {
            "loc": list(err.get("loc", [])),
            "msg": str(err.get("msg", "")),
            "type": str(err.get("type", ""))
        }
        for err in errors
    ]
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={
            "success": False,
            "error": first_error,
            "code": "VALIDATION_ERROR",
            "details": safe_errors
        }
    )


# Root welcome endpoint
@app.get("/", tags=["General"])
async def root():
    return {
        "service": "Inferxe Inference API",
        "version": "1.0.0",
        "docs": "/docs",
        "health": "/api/v1/health"
    }


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("INFERENCE_PORT", 8001))
    uvicorn.run("inference.main:app", host="127.0.0.1", port=port, reload=True)
