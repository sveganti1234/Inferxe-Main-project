"""B3/B4: pooled Supabase transport by default, httpx errors mapped to 503-class errors,
NVIDIA client timeouts. No network: transports and clients are faked."""

from unittest.mock import patch

import httpx2
import pytest

from inference import supabase_api_keys, supabase_telemetry
from inference.supabase_api_keys import SupabaseAPIKeyRepository, SupabaseAPIKeyServiceUnavailableError


def test_repositories_default_to_pooled_transport():
    repo = SupabaseAPIKeyRepository(settings=object())
    assert repo._transport is supabase_api_keys._default_pooled_transport
    trepo = supabase_telemetry.SupabaseTelemetryRepository(settings=object())
    assert trepo._transport is supabase_telemetry._default_pooled_transport


def test_pooled_transport_delegates_to_shared_client():
    calls = []
    with patch("inference.supabase_ssh_keys._default_pooled_http_transport",
               side_effect=lambda *a: calls.append(a) or (200, {}, b"[]")):
        assert supabase_api_keys._default_pooled_transport("GET", "https://x.invalid", {}, None, 3.0) == (200, {}, b"[]")
        assert supabase_telemetry._default_pooled_transport("POST", "https://x.invalid", {}, b"{}", 3.0) == (200, {}, b"[]")
    assert len(calls) == 2


@pytest.mark.parametrize("err", [
    httpx2.ConnectTimeout("connect timed out"),
    httpx2.ReadTimeout("read timed out"),
    httpx2.ConnectError("connection refused"),
    httpx2.RemoteProtocolError("server disconnected"),
])
def test_httpx_errors_map_to_service_unavailable(err):
    from inference.supabase_config import SupabaseSettings
    fields = SupabaseSettings.__dataclass_fields__ if hasattr(SupabaseSettings, "__dataclass_fields__") else {}
    settings = SupabaseSettings(**{name: "https://x.invalid" if "url" in name else "k" for name in fields}) if fields else None

    attempts = []

    def failing(*a):
        attempts.append(a)
        raise err

    repo = SupabaseAPIKeyRepository(settings=settings, transport=failing)
    with pytest.raises(SupabaseAPIKeyServiceUnavailableError):
        repo.list_user_api_keys("user-1")
    assert attempts, "the transport error must come from the request, not from settings"


def test_nvidia_client_timeouts(monkeypatch):
    monkeypatch.setenv("NVIDIA_API_KEY", "nvapi-test-dummy")
    from providers.nvidia.nvidia_provider import NVIDIAProvider
    provider = NVIDIAProvider()
    assert provider.client.max_retries == 1
    assert provider.client.timeout.connect == 5.0
    assert provider.client.timeout.read == 60.0
