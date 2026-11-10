"""
Inference orchestration service.
Bridges authenticated customer requests to the existing NVIDIA Nemotron provider
and persists execution telemetry to PostgreSQL.
"""

import time
import uuid
import logging
from typing import Optional, Dict, Any
from fastapi import HTTPException, status
from sqlalchemy.orm import Session
from openai import (
    APIConnectionError,
    RateLimitError,
    APITimeoutError,
    AuthenticationError,
    APIStatusError,
)

from inference.schemas import InferenceRequest, InferenceResponse, UsageInfo
from inference.models import APIKey, InferenceRequest as InferenceRequestRecord
from providers.nvidia.nvidia_provider import NVIDIAProvider

logger = logging.getLogger("inferxe.service")


class InferenceService:
    """Service orchestrating prompt inference through NVIDIA and logging usage."""

    def __init__(self, provider: Optional[NVIDIAProvider] = None):
        # Lazy initialization or injected provider for testing
        self._provider = provider

    @property
    def provider(self) -> NVIDIAProvider:
        if self._provider is None:
            self._provider = NVIDIAProvider()
        return self._provider

    def execute_inference(
        self,
        request: InferenceRequest,
        api_key: APIKey,
        db: Session
    ) -> InferenceResponse:
        """
        Execute model inference via NVIDIA Nemotron provider,
        measure latency, log usage to PostgreSQL, and return formatted response.
        """
        start_time = time.perf_counter()
        req_status = "success"
        error_msg: Optional[str] = None
        result: Optional[Dict[str, Any]] = None

        try:
            # Call existing NVIDIA provider directly
            result = self.provider.generate(
                prompt=request.prompt,
                max_tokens=request.max_tokens or 300,
                temperature=request.temperature if request.temperature is not None else 0.2
            )
        except RateLimitError as e:
            req_status = "rate_limited"
            error_msg = f"NVIDIA upstream rate limit reached: {e}"
            logger.warning(error_msg)
            self._record_telemetry(
                db=db,
                api_key=api_key,
                model=request.model or "nvidia/nemotron-3.5-bolt-e4b",
                status="failed",
                prompt_tokens=0,
                completion_tokens=0,
                total_tokens=0,
                latency_ms=int((time.perf_counter() - start_time) * 1000),
                error_message="Upstream rate limit exceeded."
            )
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Upstream model rate limit reached. Please try again shortly."
            )
        except APITimeoutError as e:
            req_status = "timeout"
            error_msg = f"NVIDIA upstream timeout: {e}"
            logger.error(error_msg)
            self._record_telemetry(
                db=db,
                api_key=api_key,
                model=request.model or "nvidia/nemotron-3.5-bolt-e4b",
                status="timeout",
                prompt_tokens=0,
                completion_tokens=0,
                total_tokens=0,
                latency_ms=int((time.perf_counter() - start_time) * 1000),
                error_message="Upstream request timed out."
            )
            raise HTTPException(
                status_code=status.HTTP_504_GATEWAY_TIMEOUT,
                detail="Upstream NVIDIA model inference request timed out."
            )
        except AuthenticationError as e:
            req_status = "auth_error"
            error_msg = f"NVIDIA provider authentication error: {e}"
            logger.critical("NVIDIA provider upstream authentication failed. Verify server NVIDIA_API_KEY.")
            self._record_telemetry(
                db=db,
                api_key=api_key,
                model=request.model or "nvidia/nemotron-3.5-bolt-e4b",
                status="failed",
                prompt_tokens=0,
                completion_tokens=0,
                total_tokens=0,
                latency_ms=int((time.perf_counter() - start_time) * 1000),
                error_message="Upstream provider authentication failed."
            )
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="Inference service provider authentication error."
            )
        except (APIConnectionError, APIStatusError) as e:
            req_status = "upstream_error"
            error_msg = f"NVIDIA provider communication error: {e}"
            logger.error(error_msg)
            self._record_telemetry(
                db=db,
                api_key=api_key,
                model=request.model or "nvidia/nemotron-3.5-bolt-e4b",
                status="failed",
                prompt_tokens=0,
                completion_tokens=0,
                total_tokens=0,
                latency_ms=int((time.perf_counter() - start_time) * 1000),
                error_message="Upstream provider connection error."
            )
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="Upstream inference provider is temporarily unavailable."
            )
        except ValueError as e:
            req_status = "invalid_input"
            error_msg = str(e)
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=str(e)
            )
        except Exception as e:
            req_status = "server_error"
            error_msg = str(e)
            logger.exception("Unexpected error during inference processing.")
            self._record_telemetry(
                db=db,
                api_key=api_key,
                model=request.model or "nvidia/nemotron-3.5-bolt-e4b",
                status="failed",
                prompt_tokens=0,
                completion_tokens=0,
                total_tokens=0,
                latency_ms=int((time.perf_counter() - start_time) * 1000),
                error_message="Internal inference execution failure."
            )
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="An internal error occurred during model inference."
            )

        # Calculate latency
        latency_ms = int((time.perf_counter() - start_time) * 1000)

        # Extract token usage
        usage_data = result.get("usage", {})
        prompt_tokens = usage_data.get("prompt_tokens", 0)
        completion_tokens = usage_data.get("completion_tokens", 0)
        total_tokens = usage_data.get("total_tokens", prompt_tokens + completion_tokens)
        model_name = result.get("model", request.model or "nvidia/nemotron-3.5-bolt-e4b")
        response_text = result.get("content", "")

        # Persist request telemetry in PostgreSQL
        self._record_telemetry(
            db=db,
            api_key=api_key,
            model=model_name,
            status=req_status,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            total_tokens=total_tokens,
            latency_ms=latency_ms,
            error_message=None
        )

        return InferenceResponse(
            success=True,
            provider="nvidia",
            model=model_name,
            response=response_text,
            usage=UsageInfo(
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens,
                total_tokens=total_tokens
            )
        )

    def _record_telemetry(
        self,
        db: Session,
        api_key: Optional[APIKey],
        model: str,
        status: str,
        prompt_tokens: int,
        completion_tokens: int,
        total_tokens: int,
        latency_ms: int,
        error_message: Optional[str] = None
    ) -> None:
        """Persist inference request log safely in PostgreSQL."""
        try:
            record = InferenceRequestRecord(
                id=uuid.uuid4(),
                api_key_id=api_key.id if api_key else None,
                user_id=api_key.user_id if api_key else None,
                provider="nvidia",
                model=model,
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens,
                total_tokens=total_tokens,
                status=status,
                latency_ms=latency_ms,
                error_message=error_message
            )
            db.add(record)
            db.commit()
        except Exception as e:
            logger.error(f"Failed to record inference telemetry in database: {e}")
            db.rollback()

