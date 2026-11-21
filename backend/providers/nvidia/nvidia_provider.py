
import os
from typing import FrozenSet, Optional, Tuple
from pathlib import Path

import sys as _sys
_GUARD_DIR = str(__import__('pathlib').Path(__file__).resolve().parents[2])  # backend/
if _GUARD_DIR not in _sys.path:
    _sys.path.append(_GUARD_DIR)
from isolation_guard import load_dotenv  # noqa: E402  (tests never load the project .env: isolation_guard.py)
import httpx
from openai import OpenAI


# Load configuration from backend/.env
BACKEND_DIR = Path(__file__).resolve().parents[2]
load_dotenv(BACKEND_DIR / ".env")


DEFAULT_NVIDIA_MODEL = "nvidia/nemotron-3.5-bolt-e4b"


def configured_models() -> Tuple[str, FrozenSet[str]]:
    """(default model, models clients may request).

    The default is NVIDIA_MODEL; NVIDIA_ALLOWED_MODELS (comma-separated) adds more. Clients can only
    pick from this operator-controlled list, never an arbitrary upstream model id.
    """
    default = (os.getenv("NVIDIA_MODEL") or DEFAULT_NVIDIA_MODEL).strip()
    extra = {m.strip() for m in (os.getenv("NVIDIA_ALLOWED_MODELS") or "").split(",") if m.strip()}
    return default, frozenset({default} | extra)


class NVIDIAProvider:
    """Reusable client for NVIDIA-hosted language models."""

    def __init__(self):
        api_key = os.getenv("NVIDIA_API_KEY")
        base_url = os.getenv(
            "NVIDIA_BASE_URL",
            "https://integrate.api.nvidia.com/v1"
        )
        self.model = configured_models()[0]

        if not api_key:
            raise ValueError("NVIDIA_API_KEY is missing from backend/.env")

        # Fail fast on connect; one retry. Worst case per request was ~3 x 60s (2 retries), each
        # holding a threadpool thread; now about 2 x 60s read, 5s to connect.
        self.client = OpenAI(
            base_url=base_url,
            api_key=api_key,
            timeout=httpx.Timeout(60.0, connect=5.0),
            max_retries=1
        )

    def generate(
        self,
        prompt: str,
        max_tokens: int = 500,
        temperature: float = 0.2,
        model: Optional[str] = None,
    ) -> dict:
        """Send a prompt to NVIDIA and return its response and usage."""

        if not prompt or not prompt.strip():
            raise ValueError("Prompt cannot be empty")

        response = self.client.chat.completions.create(
            model=model or self.model,
            messages=[
                {"role": "user", "content": prompt}
            ],
            max_tokens=max_tokens,
            temperature=temperature
        )

        choice = response.choices[0]
        usage = response.usage

        return {
            "provider": "nvidia",
            "model": response.model,
            "content": choice.message.content or "",
            "finish_reason": choice.finish_reason,
            "usage": {
                "prompt_tokens": usage.prompt_tokens if usage else 0,
                "completion_tokens": usage.completion_tokens if usage else 0,
                "total_tokens": usage.total_tokens if usage else 0
            }
        }


if __name__ == "__main__":
    print("Executing NVIDIAProvider test runner...")
    try:
        provider = NVIDIAProvider()
        print(f"NVIDIAProvider initialized. Model: {provider.model}")
        print("Sending test prompt: 'Hello from Inferxe'...")
        result = provider.generate("Hello from Inferxe", max_tokens=50)
        print("Response received:")
        print(result)
    except ValueError as e:
        print(f"Configuration note: {e}")
        print("To enable NVIDIA live generation, provide NVIDIA_API_KEY in backend/.env")
    except Exception as e:
        print(f"Execution error: {type(e).__name__}: {e}")

