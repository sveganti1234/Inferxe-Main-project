
import os
from pathlib import Path

from dotenv import load_dotenv
from openai import OpenAI


# Load configuration from backend/.env
BACKEND_DIR = Path(__file__).resolve().parents[2]
load_dotenv(BACKEND_DIR / ".env")


class NVIDIAProvider:
    """Reusable client for NVIDIA-hosted language models."""

    def __init__(self):
        api_key = os.getenv("NVIDIA_API_KEY")
        base_url = os.getenv(
            "NVIDIA_BASE_URL",
            "https://integrate.api.nvidia.com/v1"
        )
        self.model = os.getenv(
            "NVIDIA_MODEL",
            "nvidia/nemotron-3.5-bolt-e4b"
        )

        if not api_key:
            raise ValueError("NVIDIA_API_KEY is missing from backend/.env")

        self.client = OpenAI(
            base_url=base_url,
            api_key=api_key,
            timeout=60.0,
            max_retries=2
        )

    def generate(
        self,
        prompt: str,
        max_tokens: int = 500,
        temperature: float = 0.2
    ) -> dict:
        """Send a prompt to NVIDIA and return its response and usage."""

        if not prompt or not prompt.strip():
            raise ValueError("Prompt cannot be empty")

        response = self.client.chat.completions.create(
            model=self.model,
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

