"""
service.py
==========
Inference orchestration service.
Bridges authenticated customer requests to the existing NVIDIA Nemotron provider
and persists execution telemetry to Supabase (`inference_requests`).
"""

import logging
import math
import re
import threading
import time
import uuid
from typing import Any, Dict, Optional, Tuple

from fastapi import HTTPException, status
from openai import (
    APIConnectionError,
    APIStatusError,
    APITimeoutError,
    AuthenticationError,
    RateLimitError,
)

from inference.schemas import InferenceRequest, InferenceResponse, UsageInfo
from inference.supabase_telemetry import (
    SupabaseTelemetryRepository,
    calculate_inference_cost,
    get_telemetry_repository,
    sanitize_diagnostic_text,
)
from providers.nvidia.nvidia_provider import NVIDIAProvider

logger = logging.getLogger("inferxe.service")

DEFAULT_MODEL = "nvidia/nemotron-3.5-bolt-e4b"
_INTEGER_TOKEN_RE = re.compile(r"^[0-9]+$")


class _MalformedProviderResponseError(Exception):
    """Raised when an upstream inference provider returns a malformed response payload."""


class InferenceService:
    """Service orchestrating prompt inference through NVIDIA and logging usage to Supabase."""

    def __init__(
        self,
        provider: Optional[NVIDIAProvider] = None,
        telemetry_repo: Optional[SupabaseTelemetryRepository] = None,
    ):
        # Lazy initialization or injected dependencies for testing
        self._provider = provider
        self._telemetry_repo = telemetry_repo
        self._init_lock = threading.Lock()

    @property
    def provider(self) -> NVIDIAProvider:
        if self._provider is None:
            with self._init_lock:
                if self._provider is None:
                    self._provider = NVIDIAProvider()
        return self._provider

    @property
    def telemetry_repository(self) -> SupabaseTelemetryRepository:
        if self._telemetry_repo is None:
            with self._init_lock:
                if self._telemetry_repo is None:
                    self._telemetry_repo = get_telemetry_repository()
        return self._telemetry_repo

    @staticmethod
    def _validate_request_before_inference(
        request: InferenceRequest,
    ) -> Tuple[str, int, float]:
        """Validate request fields prior to attempting provider inference."""
        if request is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Inference request payload is required.",
            )

        raw_prompt = getattr(request, "prompt", None)
        if not isinstance(raw_prompt, str) or not raw_prompt.strip():
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Prompt cannot be empty or solely whitespace.",
            )

        raw_model = getattr(request, "model", None)
        if raw_model is not None and not isinstance(raw_model, str):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Model identifier must be a string.",
            )

        raw_max_tokens = getattr(request, "max_tokens", None)
        if raw_max_tokens is None:
            max_tokens = 300
        else:
            if (
                isinstance(raw_max_tokens, bool)
                or not isinstance(raw_max_tokens, int)
                or raw_max_tokens < 1
                or raw_max_tokens > 4096
            ):
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail="max_tokens must be an integer between 1 and 4096.",
                )
            max_tokens = raw_max_tokens

        raw_temperature = getattr(request, "temperature", None)
        if raw_temperature is None:
            temperature = 0.2
        else:
            if (
                isinstance(raw_temperature, bool)
                or not isinstance(raw_temperature, (int, float))
                or not math.isfinite(float(raw_temperature))
            ):
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail="temperature must be a finite number between 0.0 and 2.0.",
                )
            temperature = float(raw_temperature)
            if temperature < 0.0 or temperature > 2.0:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail="temperature must be a finite number between 0.0 and 2.0.",
                )

        return raw_prompt.strip(), max_tokens, temperature

    def _resolve_model_name(
        self,
        request: Optional[InferenceRequest],
        provider: Optional[Any] = None,
    ) -> str:
        """Resolve telemetry/error model name preferring actual provider model over requested model."""
        raw_provider_model = (
            getattr(provider, "model", None) if provider is not None else None
        )
        provider_model = (
            raw_provider_model.strip()
            if isinstance(raw_provider_model, str) and raw_provider_model.strip()
            else None
        )
        raw_request_model = (
            getattr(request, "model", None) if request is not None else None
        )
        request_model = (
            raw_request_model.strip()
            if isinstance(raw_request_model, str) and raw_request_model.strip()
            else None
        )
        return provider_model or request_model or DEFAULT_MODEL

    @staticmethod
    def _normalize_token_count(value: Any, *, field_name: str) -> int:
        """Strictly normalize non-negative integer token counts while rejecting booleans and invalid types."""
        if isinstance(value, bool):
            raise _MalformedProviderResponseError(
                f"Provider usage field '{field_name}' must be an integer, got bool."
            )
        if isinstance(value, int):
            if value < 0:
                raise _MalformedProviderResponseError(
                    f"Provider usage field '{field_name}' cannot be negative."
                )
            return value
        if isinstance(value, str):
            stripped = value.strip()
            if not stripped or not _INTEGER_TOKEN_RE.fullmatch(stripped):
                raise _MalformedProviderResponseError(
                    f"Provider usage field '{field_name}' contains non-numeric value."
                )
            return int(stripped)
        raise _MalformedProviderResponseError(
            f"Provider usage field '{field_name}' has invalid type '{type(value).__name__}'."
        )

    @classmethod
    def _parse_provider_result(
        cls,
        result: Any,
        *,
        resolved_model: str,
    ) -> Tuple[str, str, str, int, int, int]:
        """Validate and extract normalized fields from the upstream provider response payload."""
        if not isinstance(result, dict):
            raise _MalformedProviderResponseError(
                f"Provider returned non-dictionary response '{type(result).__name__}'."
            )

        try:
            usage_data = result.get("usage")
            if not isinstance(usage_data, dict):
                raise _MalformedProviderResponseError(
                    f"Provider returned non-dictionary usage payload '{type(usage_data).__name__}'."
                )

            if "prompt_tokens" not in usage_data or usage_data.get("prompt_tokens") is None:
                raise _MalformedProviderResponseError("Provider usage is missing 'prompt_tokens'.")
            if "completion_tokens" not in usage_data or usage_data.get("completion_tokens") is None:
                raise _MalformedProviderResponseError("Provider usage is missing 'completion_tokens'.")

            prompt_tokens = cls._normalize_token_count(
                usage_data.get("prompt_tokens"),
                field_name="prompt_tokens",
            )
            completion_tokens = cls._normalize_token_count(
                usage_data.get("completion_tokens"),
                field_name="completion_tokens",
            )

            raw_total_tokens = usage_data.get("total_tokens")
            if raw_total_tokens is not None:
                total_tokens = cls._normalize_token_count(
                    raw_total_tokens,
                    field_name="total_tokens",
                )
            else:
                total_tokens = prompt_tokens + completion_tokens

            raw_provider = result.get("provider")
            if raw_provider is None:
                provider_name = "nvidia"
            elif isinstance(raw_provider, str) and raw_provider.strip():
                provider_name = raw_provider.strip()
            else:
                raise _MalformedProviderResponseError("Provider response contains invalid 'provider'.")

            raw_model = result.get("model")
            if raw_model is None:
                model_name = resolved_model
            elif isinstance(raw_model, str):
                model_name = raw_model.strip() or resolved_model
            else:
                raise _MalformedProviderResponseError("Provider response contains invalid 'model'.")

            raw_content = result.get("content")
            if raw_content is None:
                response_text = ""
            elif isinstance(raw_content, str):
                response_text = raw_content
            else:
                raise _MalformedProviderResponseError(
                    f"Provider response 'content' must be a string, got '{type(raw_content).__name__}'."
                )

            return (
                provider_name,
                model_name,
                response_text,
                prompt_tokens,
                completion_tokens,
                total_tokens,
            )
        except _MalformedProviderResponseError:
            raise
        except (TypeError, ValueError, KeyError, AttributeError) as parse_err:
            raise _MalformedProviderResponseError(
                f"Malformed provider response payload ({type(parse_err).__name__})."
            ) from parse_err

    def execute_inference(
        self,
        request: InferenceRequest,
        api_key: Any,
        telemetry_repo: Optional[SupabaseTelemetryRepository] = None,
    ) -> InferenceResponse:
        """
        Execute model inference via NVIDIA Nemotron provider,
        measure latency, log usage to Supabase, and return formatted response.
        """
        validated_prompt, max_tokens, temperature = self._validate_request_before_inference(
            request
        )

        start_time = time.perf_counter()
        request_id = uuid.uuid4()
        telemetry_recorded = False
        inference_attempted = False
        fallback_model = self._resolve_model_name(request, provider=self._provider)

        try:
            provider = self.provider
            fallback_model = self._resolve_model_name(request, provider=provider)
            inference_attempted = True

            # Call existing NVIDIA provider directly
            result = provider.generate(
                prompt=validated_prompt,
                max_tokens=max_tokens,
                temperature=temperature,
            )

            # Parse & validate provider payload inside exception/telemetry protection
            (
                provider_name,
                model_name,
                response_text,
                prompt_tokens,
                completion_tokens,
                total_tokens,
            ) = self._parse_provider_result(
                result,
                resolved_model=fallback_model,
            )
        except _MalformedProviderResponseError as e:
            logger.error(
                "NVIDIA provider returned malformed response (%s): %s",
                type(e).__name__,
                sanitize_diagnostic_text(e),
            )
            if inference_attempted and not telemetry_recorded:
                telemetry_recorded = True
                self._record_telemetry(
                    request_id=request_id,
                    telemetry_repo=telemetry_repo,
                    api_key=api_key,
                    provider_name="nvidia",
                    model=fallback_model,
                    status="failed",
                    prompt_tokens=0,
                    completion_tokens=0,
                    latency_ms=max(0, int((time.perf_counter() - start_time) * 1000)),
                    error_message="Upstream provider returned a malformed response.",
                )
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="Upstream inference provider returned a malformed response.",
            )
        except RateLimitError as e:
            logger.warning(
                "NVIDIA upstream rate limit reached (%s): %s",
                type(e).__name__,
                sanitize_diagnostic_text(e),
            )
            if not telemetry_recorded:
                telemetry_recorded = True
                self._record_telemetry(
                    request_id=request_id,
                    telemetry_repo=telemetry_repo,
                    api_key=api_key,
                    provider_name="nvidia",
                    model=fallback_model,
                    status="failed",
                    prompt_tokens=0,
                    completion_tokens=0,
                    latency_ms=max(0, int((time.perf_counter() - start_time) * 1000)),
                    error_message="Upstream rate limit exceeded.",
                )
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Upstream model rate limit reached. Please try again shortly.",
            )
        except APITimeoutError as e:
            logger.error(
                "NVIDIA upstream timeout (%s): %s",
                type(e).__name__,
                sanitize_diagnostic_text(e),
            )
            if not telemetry_recorded:
                telemetry_recorded = True
                self._record_telemetry(
                    request_id=request_id,
                    telemetry_repo=telemetry_repo,
                    api_key=api_key,
                    provider_name="nvidia",
                    model=fallback_model,
                    status="timeout",
                    prompt_tokens=0,
                    completion_tokens=0,
                    latency_ms=max(0, int((time.perf_counter() - start_time) * 1000)),
                    error_message="Upstream request timed out.",
                )
            raise HTTPException(
                status_code=status.HTTP_504_GATEWAY_TIMEOUT,
                detail="Upstream NVIDIA model inference request timed out.",
            )
        except AuthenticationError:
            logger.critical("NVIDIA provider upstream authentication failed. Verify server NVIDIA_API_KEY.")
            if not telemetry_recorded:
                telemetry_recorded = True
                self._record_telemetry(
                    request_id=request_id,
                    telemetry_repo=telemetry_repo,
                    api_key=api_key,
                    provider_name="nvidia",
                    model=fallback_model,
                    status="failed",
                    prompt_tokens=0,
                    completion_tokens=0,
                    latency_ms=max(0, int((time.perf_counter() - start_time) * 1000)),
                    error_message="Upstream provider authentication failed.",
                )
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="Inference service provider authentication error.",
            )
        except (APIConnectionError, APIStatusError) as e:
            logger.error(
                "NVIDIA provider communication error (%s): %s",
                type(e).__name__,
                sanitize_diagnostic_text(e),
            )
            if not telemetry_recorded:
                telemetry_recorded = True
                self._record_telemetry(
                    request_id=request_id,
                    telemetry_repo=telemetry_repo,
                    api_key=api_key,
                    provider_name="nvidia",
                    model=fallback_model,
                    status="failed",
                    prompt_tokens=0,
                    completion_tokens=0,
                    latency_ms=max(0, int((time.perf_counter() - start_time) * 1000)),
                    error_message="Upstream provider connection error.",
                )
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="Upstream inference provider is temporarily unavailable.",
            )
        except ValueError as e:
            safe_detail = sanitize_diagnostic_text(e) or "Invalid inference parameters."
            if inference_attempted:
                logger.warning(
                    "NVIDIA provider raised ValueError during inference (%s): %s",
                    type(e).__name__,
                    safe_detail,
                )
                if not telemetry_recorded:
                    telemetry_recorded = True
                    self._record_telemetry(
                        request_id=request_id,
                        telemetry_repo=telemetry_repo,
                        api_key=api_key,
                        provider_name="nvidia",
                        model=fallback_model,
                        status="failed",
                        prompt_tokens=0,
                        completion_tokens=0,
                        latency_ms=max(0, int((time.perf_counter() - start_time) * 1000)),
                        error_message="Upstream provider rejected the inference request.",
                    )
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=safe_detail,
            )
        except Exception as e:
            logger.error(
                "Unexpected error during inference processing (%s): %s",
                type(e).__name__,
                sanitize_diagnostic_text(e),
            )
            if not telemetry_recorded:
                telemetry_recorded = True
                self._record_telemetry(
                    request_id=request_id,
                    telemetry_repo=telemetry_repo,
                    api_key=api_key,
                    provider_name="nvidia",
                    model=fallback_model,
                    status="failed",
                    prompt_tokens=0,
                    completion_tokens=0,
                    latency_ms=max(0, int((time.perf_counter() - start_time) * 1000)),
                    error_message="Internal inference execution failure.",
                )
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="An internal error occurred during model inference.",
            )

        # Calculate latency after successful provider call and payload validation
        latency_ms = max(0, int((time.perf_counter() - start_time) * 1000))

        # Persist request telemetry in Supabase without affecting customer response on failure
        if not telemetry_recorded:
            telemetry_recorded = True
            self._record_telemetry(
                request_id=request_id,
                telemetry_repo=telemetry_repo,
                api_key=api_key,
                provider_name=provider_name,
                model=model_name,
                status="success",
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens,
                latency_ms=latency_ms,
                error_message=None,
            )

        return InferenceResponse(
            success=True,
            provider="nvidia",
            model=model_name,
            response=response_text,
            usage=UsageInfo(
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens,
                total_tokens=total_tokens,
            ),
        )

    def _record_telemetry(
        self,
        *,
        request_id: Optional[uuid.UUID] = None,
        telemetry_repo: Optional[SupabaseTelemetryRepository] = None,
        api_key: Optional[Any],
        model: str,
        status: str,
        prompt_tokens: int,
        completion_tokens: int,
        latency_ms: int,
        provider_name: str = "nvidia",
        error_message: Optional[str] = None,
    ) -> None:
        """Persist inference request log safely in Supabase without leaking secrets or failing inference."""
        try:
            repo = telemetry_repo or self.telemetry_repository
            user_id = getattr(api_key, "user_id", None) if api_key is not None else None
            api_key_id = getattr(api_key, "id", None) if api_key is not None else None
            organization_id = getattr(api_key, "organization_id", None) if api_key is not None else None
            deployment_id = getattr(api_key, "deployment_id", None) if api_key is not None else None

            cost = calculate_inference_cost(
                model_name=model,
                input_tokens=prompt_tokens,
                output_tokens=completion_tokens,
            )

            repo.record_inference_request(
                request_id=request_id,
                user_id=user_id,
                organization_id=organization_id,
                api_key_id=api_key_id,
                deployment_id=deployment_id,
                model_name=model,
                provider_name=provider_name,
                input_tokens=prompt_tokens,
                output_tokens=completion_tokens,
                latency_ms=latency_ms,
                status=status,
                error_message=error_message,
                cost=cost,
            )
        except Exception as e:
            logger.error(
                "Failed to record inference telemetry in Supabase (%s): %s",
                type(e).__name__,
                sanitize_diagnostic_text(e),
            )

