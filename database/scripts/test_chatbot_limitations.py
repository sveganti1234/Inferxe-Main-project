"""
test_chatbot_limitations.py
===========================
Automated test suite to verify the strict GPU and Website-Only Knowledge Policy.
Evaluates both on-topic queries and off-topic queries to ensure 100% compliance.
"""

import re
import json

REFUSAL_MESSAGE = "I can only answer questions related to GPU infrastructure, hardware specifications, cloud pricing, and verified Inferxe website features. I cannot assist with topics outside this scope."

def check_topic_whitelist(query: str) -> bool:
    q = query.lower().strip()
    
    # 1. Casual Chat & Greetings
    if re.search(r'\b(how are (you|u)|how\'s it going|how are you doing|how do you do)\b', q):
        return True
    if re.match(r'^(h+i+|h+e+y+|h+e+l+l+o+|greetings|howdy|sup|good\s+(morning|afternoon|evening))(!|\.|\?|\s)*$', q):
        return True
        
    # 2. Assistant Identity & Capabilities
    if re.search(r'\b(who is inferxe ai assistant|what(\'s| is) your name|who are (you|u)|what can (you|u) do|how can (you|u) help)\b', q):
        return True

    # 3. Explicit Out-of-Scope Trigger
    if re.search(r'\b(bake|cake|recipe|cook|weather|chocolate|girlfriend|boyfriend|sports|cricket|football|movie|song|poem|joke|dinner|pizza|politician|minister|election|history|biology|chemistry|physics|math|calculus|medical|doctor)\b', q):
        return False

    # 4. Strict Domain Gatekeeper: GPU, Model Sizing, Cloud Providers, or Inferxe Website
    is_gpu_or_website = bool(
        re.search(r'\b(gpu|gpus|nvidia|h100|h200|l40s|l40|l4|a100|a30|a6000|b200|rtx|blackwell|hopper|ada|ampere|vram|memory|bandwidth|tensor|cuda|tflops|tops|tdp|nvlink|pcie|sxm)\b', q) or
        re.search(r'\b(llama|qwen|mistral|mixtral|gemma|deepseek|model|models|weights|kv\s*cache|context|vllm|docker|token|tokens|prompt|completion|quantization|quantized|awq|gptq|fp8|fp16|bf16|throughput|latency|ttft)\b', q) or
        re.search(r'\b(jarvislabs|jarvis|e2e|yotta|cyfuture|runpod|lambda|vast|aws|azure|gcp|price|pricing|rate|rates|cost|hourly|spot|on-demand|inr|usd|rupee|₹|\$|bill|billing|quota)\b', q) or
        re.search(r'\b(inferxe|platform|website|marketplace|catalog|catalogue|dashboard|wallet|balance|burn|burn\s*rate|deploy|deployment|instance|instances|reservation|reserve|rent|rental|order|sovereign|india|noida|mumbai|dpdp|compliance|residency|api|sdk|key|auth|login|account)\b', q) or
        re.search(r'\b(sizing|calculate|calculator|recommend|recommendation|spec|specs|specification|benchmark|benchmarks)\b', q)
    )
    
    return is_gpu_or_website

def evaluate_chatbot_guardrail(query: str) -> str:
    if check_topic_whitelist(query):
        return "ALLOWED: Processing via Verified GPU/Website Documentation"
    else:
        return f"BLOCKED: {REFUSAL_MESSAGE}"

if __name__ == "__main__":
    print("=" * 70)
    print("INFERXE CHATBOT GUARDRAIL EVALUATION SUITE")
    print("=" * 70)

    test_queries = [
        ("What is the hourly rate for an NVIDIA H100 SXM?", True),
        ("Which GPU is recommended for Llama 3 70B inference?", True),
        ("Is data residency guaranteed in Noida, India?", True),
        ("How does the wallet burn rate work on Inferxe?", True),
        ("What are the memory bandwidth specs of the H200?", True),
        ("How to bake a vanilla chocolate cake?", False),
        ("Who is the current Prime Minister of Australia?", False),
        ("Write a Python script to sort a binary tree", False),
        ("What is the weather forecast for tomorrow?", False),
        ("Tell me a funny joke about doctors and patients", False)
    ]

    all_passed = True
    for query, expected_allowed in test_queries:
        allowed = check_topic_whitelist(query)
        status = "PASS" if allowed == expected_allowed else "FAIL"
        if status == "FAIL":
            all_passed = False
        print(f"[{status}] Query: '{query}'")
        print(f"       Outcome: {'ALLOWED' if allowed else 'REFUSED'}")
        if not allowed:
            print(f"       Response: '{REFUSAL_MESSAGE}'")
        print("-" * 70)

    print(f"\nFinal Result: {'100% GUARDRAIL COMPLIANCE ACHIEVED!' if all_passed else 'TESTS FAILED'}")
