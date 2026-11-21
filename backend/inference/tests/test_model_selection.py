"""Model selection: request.model is honoured when the operator allows it, rejected otherwise,
and omitted values use the configured default. No network: the provider is mocked."""

from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException

from inference.schemas import InferenceRequest
from inference.service import InferenceService
from providers.nvidia.nvidia_provider import DEFAULT_NVIDIA_MODEL, configured_models

RESULT = {"provider": "nvidia", "model": "m", "content": "ok", "finish_reason": "stop",
          "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2}}


@pytest.fixture
def svc(monkeypatch):
    monkeypatch.delenv("NVIDIA_MODEL", raising=False)
    monkeypatch.setenv("NVIDIA_ALLOWED_MODELS", "meta/llama-3.1-8b-instruct, mistralai/mixtral-8x7b")
    provider = MagicMock()
    provider.model = DEFAULT_NVIDIA_MODEL
    provider.generate.return_value = RESULT
    telemetry = MagicMock()
    service = InferenceService(provider=provider, telemetry_repo=telemetry)
    api_key = MagicMock(id="key-1", user_id="user-1", organization_id=None)
    return service, provider, telemetry, api_key


def run(service, api_key, **fields):
    return service.execute_inference(request=InferenceRequest(prompt="hello", **fields), api_key=api_key)


def test_configured_models_default_and_extras(monkeypatch):
    monkeypatch.setenv("NVIDIA_MODEL", "org/default")
    monkeypatch.setenv("NVIDIA_ALLOWED_MODELS", " a/one ,, b/two ")
    default, allowed = configured_models()
    assert default == "org/default"
    assert allowed == {"org/default", "a/one", "b/two"}


def test_missing_model_uses_default_without_override(svc):
    service, provider, _, api_key = svc
    run(service, api_key)
    assert "model" not in provider.generate.call_args.kwargs


def test_default_model_requested_explicitly_is_not_an_override(svc):
    service, provider, _, api_key = svc
    run(service, api_key, model=DEFAULT_NVIDIA_MODEL)
    assert "model" not in provider.generate.call_args.kwargs


def test_supported_model_is_passed_to_provider(svc):
    service, provider, _, api_key = svc
    run(service, api_key, model=" meta/llama-3.1-8b-instruct ")
    assert provider.generate.call_args.kwargs["model"] == "meta/llama-3.1-8b-instruct"


@pytest.mark.parametrize("model", ["gpt-4", "llama-3.1-8b-instruct", "x" * 500])
def test_unsupported_model_rejected_before_provider_call(svc, model):
    service, provider, telemetry, api_key = svc
    with pytest.raises(HTTPException) as info:
        run(service, api_key, model=model)
    assert info.value.status_code == 422
    assert "Unsupported model" in info.value.detail
    assert len(info.value.detail) < 400  # requested value is truncated in the message
    provider.generate.assert_not_called()
    telemetry.record_inference_request.assert_not_called()


def test_blank_model_treated_as_missing(svc):
    service, provider, _, api_key = svc
    run(service, api_key, model="   ")
    assert "model" not in provider.generate.call_args.kwargs


def test_real_provider_uses_requested_model(monkeypatch):
    monkeypatch.setenv("NVIDIA_API_KEY", "nvapi-test-dummy")
    from providers.nvidia.nvidia_provider import NVIDIAProvider
    p = NVIDIAProvider()
    fake = MagicMock()
    fake.chat.completions.create.return_value = MagicMock(
        choices=[MagicMock(message=MagicMock(content="hi"), finish_reason="stop")], usage=None, model="x")
    p.client = fake
    p.generate("hello", model="meta/llama-3.1-8b-instruct")
    assert fake.chat.completions.create.call_args.kwargs["model"] == "meta/llama-3.1-8b-instruct"
    p.generate("hello")
    assert fake.chat.completions.create.call_args.kwargs["model"] == p.model


def test_error_telemetry_attributes_requested_override(svc, monkeypatch):
    service, provider, _, api_key = svc
    provider.generate.side_effect = RuntimeError("upstream crash")
    seen = []
    monkeypatch.setattr(service, "_record_telemetry", lambda **kw: seen.append(kw["model"]))
    with pytest.raises(HTTPException):
        run(service, api_key, model="mistralai/mixtral-8x7b")
    assert seen == ["mistralai/mixtral-8x7b"]
