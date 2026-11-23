"""Demo (simulated) inference: used only when INFERENCE_DEMO_MODE is on and no NVIDIA key is set."""

import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[2]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from inference.service import DemoProvider, InferenceService, demo_inference_enabled  # noqa: E402
from providers.nvidia.nvidia_provider import NVIDIAProvider  # noqa: E402


def test_demo_enabled_only_without_real_key(monkeypatch):
    monkeypatch.delenv("NVIDIA_API_KEY", raising=False)
    monkeypatch.setenv("INFERENCE_DEMO_MODE", "true")
    assert demo_inference_enabled()
    monkeypatch.setenv("INFERENCE_DEMO_MODE", "false")
    assert not demo_inference_enabled()
    monkeypatch.setenv("INFERENCE_DEMO_MODE", "true")
    monkeypatch.setenv("NVIDIA_API_KEY", "nvapi-real-looking-key")
    assert not demo_inference_enabled()


def test_service_uses_demo_provider_and_parses_its_result(monkeypatch):
    monkeypatch.delenv("NVIDIA_API_KEY", raising=False)
    monkeypatch.setenv("INFERENCE_DEMO_MODE", "1")
    service = InferenceService()
    provider = service.provider
    assert isinstance(provider, DemoProvider) and not isinstance(provider, NVIDIAProvider)
    result = provider.generate(prompt="hello world", max_tokens=5)
    provider_name, _model, text, prompt_tokens, completion_tokens, total = InferenceService._parse_provider_result(
        result, resolved_model=provider.model
    )
    assert provider_name == "demo"
    assert len(text.split()) == 5 == completion_tokens
    assert total == prompt_tokens + completion_tokens
