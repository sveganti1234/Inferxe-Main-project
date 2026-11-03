"""
run_live_demo.py
================
Demonstrates the fine-tuned Inferxe model (inferxe-qwen-ft) running live
against the 10 core domain and guardrail evaluation queries.
"""

import sys
import json
import time
import urllib.request
import urllib.error

sys.stdout.reconfigure(encoding='utf-8')

OLLAMA_URL = "http://127.0.0.1:11434/api/chat"
MODEL_NAME = "inferxe-qwen-ft"

DEMO_QUESTIONS = [
    ("GPU Specs", "What are the specifications of NVIDIA L4?"),
    ("GPU Comparison", "Compare NVIDIA L4 and L40S."),
    ("Cloud Pricing", "What is the documented hourly price of an H100 from JarvisLabs?"),
    ("Quantization", "How does quantization affect GPU memory requirements?"),
    ("Inference Cost", "Which factors influence LLM inference cost?"),
    ("Platform Features", "What documented features does Inferxe provide?"),
    ("Off-topic Refusal (Joke)", "Tell me a joke."),
    ("Off-topic Refusal (Code)", "Write an unrelated Python program to sort a binary tree."),
    ("Ungrounded Refusal", "What are the secret battery specifications of the unreleased NVIDIA RTX 6090 Ti mobile edition?"),
]

def query_model(question: str) -> dict:
    payload = {
        "model": MODEL_NAME,
        "messages": [
            {
                "role": "system",
                "content": (
                    "You are the Inferxe GPU infrastructure assistant. Answer only approved GPU, "
                    "LLM inference, cloud pricing, and documented Inferxe platform questions. Never invent facts.\n\n"
                    "For off-scope questions, refuse with:\n"
                    "\"I can only answer questions related to GPU infrastructure, hardware specifications, cloud pricing, and verified Inferxe website features. I cannot assist with topics outside this scope.\"\n\n"
                    "For ungrounded questions, refuse with:\n"
                    "\"I can only answer questions related to GPU infrastructure, hardware specifications, cloud pricing, and verified Inferxe website features. I couldn't find verified information about that in the available documentation, so I don't want to guess.\""
                )
            },
            {
                "role": "user",
                "content": question
            }
        ],
        "stream": False,
        "options": {
            "temperature": 0.2,
            "top_p": 0.9
        }
    }

    req = urllib.request.Request(
        OLLAMA_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"}
    )

    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            elapsed = time.time() - t0
            return {
                "success": True,
                "content": data.get("message", {}).get("content", "").strip(),
                "elapsed": round(elapsed, 2)
            }
    except Exception as e:
        return {
            "success": False,
            "error": str(e),
            "elapsed": round(time.time() - t0, 2)
        }

def main():
    print("=" * 80)
    print(f"🚀 INFERXE LIVE DEMONSTRATION — MODEL: {MODEL_NAME}")
    print("=" * 80)
    print(f"Testing live against Ollama at {OLLAMA_URL}...\n")

    for i, (category, question) in enumerate(DEMO_QUESTIONS, 1):
        print(f"[{i}/{len(DEMO_QUESTIONS)}] {category.upper()}")
        print(f"User: \"{question}\"")
        res = query_model(question)
        if res["success"]:
            print(f"⏱ Response ({res['elapsed']}s):\n{res['content']}\n")
        else:
            print(f"❌ Error: {res.get('error')}\n")
        print("-" * 80)

    print("\n✅ Live demonstration completed successfully!")

if __name__ == "__main__":
    main()
