"""
Evaluates and compares the original model vs fine-tuned model on held-out test questions.
Measures:
- Factual correctness against verified ground truth
- Unsupported factual claims / hallucinations
- Domain restriction enforcement (refusing out-of-scope queries)
- Missing data handling (refusing ungrounded queries)
- Latency and response metrics
"""

import os
import sys
import json
import time
import urllib.request
import re
from datetime import datetime
from typing import Dict, Any, List

# Enforce UTF-8 output
sys.stdout.reconfigure(encoding='utf-8')

OLLAMA_CHAT_URL = "http://127.0.0.1:11434/api/chat"

OUT_OF_SCOPE_REFUSAL = (
    "I can only answer questions related to GPU infrastructure, hardware specifications, "
    "cloud pricing, and verified Inferxe website features. I cannot assist with topics outside this scope."
)

INSUFFICIENT_INFO_REFUSAL = (
    "I can only answer questions related to GPU infrastructure, hardware specifications, "
    "cloud pricing, and verified Inferxe website features. I couldn't find verified information about that "
    "in the available documentation, so I don't want to guess."
)

EVALUATION_QUESTIONS = [
    {
        "id": 1,
        "question": "What are the specifications of NVIDIA L4?",
        "expected_facts": ["Ada Lovelace", "24 GB", "GDDR6", "300 GB/s", "485", "FP8", "242", "FP16", "72W"],
        "expected_type": "factual"
    },
    {
        "id": 2,
        "question": "Compare NVIDIA L4 and L40S.",
        "expected_facts": ["Ada Lovelace", "24 GB", "48 GB", "300 GB/s", "864 GB/s", "72W", "350W"],
        "expected_type": "factual"
    },
    {
        "id": 3,
        "question": "What is the documented hourly price of an H100 from JarvisLabs?",
        "expected_facts": ["JarvisLabs", "$3.49", "â‚¹330", "spot", "$1.55", "â‚¹146"],
        "expected_type": "factual"
    },
    {
        "id": 4,
        "question": "How does quantization affect GPU memory requirements?",
        "expected_facts": ["FP16", "2 bytes", "FP8", "1 byte", "AWQ", "4-bit", "0.5", "KV cache"],
        "expected_type": "factual"
    },
    {
        "id": 5,
        "question": "Which factors influence LLM inference cost?",
        "expected_facts": ["parameter count", "quantization", "context", "concurrency", "memory bandwidth", "pricing"],
        "expected_type": "factual"
    },
    {
        "id": 6,
        "question": "What GPU is suitable for Qwen 2.5 7B, based on the supplied examples?",
        "expected_facts": ["L4", "24 GB", "BF16", "â‚¹60"],
        "expected_type": "factual"
    },
    {
        "id": 7,
        "question": "What documented features does Inferxe provide?",
        "expected_facts": ["Marketplace", "sizing", "wallet", "burn rate", "Mumbai", "Noida", "DPDP", "OpenAI", "intermediary"],
        "expected_type": "factual"
    },
    {
        "id": 8,
        "question": "Tell me a joke.",
        "expected_facts": [OUT_OF_SCOPE_REFUSAL],
        "expected_type": "out_of_scope_refusal"
    },
    {
        "id": 9,
        "question": "Write an unrelated Python program to sort a binary tree.",
        "expected_facts": [OUT_OF_SCOPE_REFUSAL],
        "expected_type": "out_of_scope_refusal"
    },
    {
        "id": 10,
        "question": "Answer a GPU question whose answer is not included in the dataset: What are the secret battery specifications of the unreleased NVIDIA RTX 6090 Ti mobile edition?",
        "expected_facts": [INSUFFICIENT_INFO_REFUSAL],
        "expected_type": "insufficient_info_refusal"
    }
]

def query_ollama(model_name: str, prompt: str) -> Dict[str, Any]:
    payload = {
        "model": model_name,
        "messages": [{"role": "user", "content": prompt}],
        "stream": False,
        "options": {
            "temperature": 0.1
        }
    }
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(OLLAMA_CHAT_URL, data=data, headers={"Content-Type": "application/json"})
    
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=45) as resp:
            t1 = time.time()
            res = json.loads(resp.read().decode("utf-8"))
            content = res.get("message", {}).get("content", "")
            eval_count = res.get("eval_count", 0)
            eval_duration = res.get("eval_duration", 0)
            tok_per_sec = (eval_count / (eval_duration / 1e9)) if eval_duration > 0 else 0
            return {
                "ok": True,
                "content": content,
                "latency_sec": round(t1 - t0, 3),
                "eval_count": eval_count,
                "tok_per_sec": round(tok_per_sec, 1)
            }
    except Exception as e:
        return {
            "ok": False,
            "error": str(e),
            "content": "",
            "latency_sec": round(time.time() - t0, 3),
            "eval_count": 0,
            "tok_per_sec": 0
        }

def score_response(item: Dict[str, Any], response_text: str) -> Dict[str, Any]:
    text_lower = response_text.lower()
    q_type = item["expected_type"]

    if q_type == "out_of_scope_refusal":
        # Check if model correctly refused
        refusal_matched = (
            OUT_OF_SCOPE_REFUSAL.lower() in text_lower or
            ("only answer questions related to gpu infrastructure" in text_lower and "outside this scope" in text_lower)
        )
        leaked_content = bool(re.search(r"\b(why did the|joke|def sort|def tree|class node)\b", text_lower))
        return {
            "domain_enforced": refusal_matched and not leaked_content,
            "factual_score": 1.0 if (refusal_matched and not leaked_content) else 0.0,
            "hallucination": leaked_content,
            "notes": "Proper domain refusal" if (refusal_matched and not leaked_content) else "Failed domain restriction (answered off-topic query)"
        }

    elif q_type == "insufficient_info_refusal":
        refusal_matched = (
            INSUFFICIENT_INFO_REFUSAL.lower() in text_lower or
            ("couldn't find verified information" in text_lower or "don't want to guess" in text_lower or "only answer questions related to gpu" in text_lower)
        )
        invented_facts = bool(re.search(r"\b(battery life|mah|watts hour|6090 ti mobile)\b", text_lower))
        return {
            "domain_enforced": refusal_matched and not invented_facts,
            "factual_score": 1.0 if (refusal_matched and not invented_facts) else 0.0,
            "hallucination": invented_facts,
            "notes": "Proper ungrounded refusal" if (refusal_matched and not invented_facts) else "Hallucinated unverified specifications"
        }

    else:
        # Factual query
        expected = item["expected_facts"]
        matches = [f for f in expected if f.lower() in text_lower]
        score = len(matches) / len(expected)
        # Check obvious hallucinations (e.g. 2019 release for L4, 8 cores for L40S, etc.)
        hallucination = bool(re.search(r"\b(released in 2019|8 cores|64gb of memory for l40s)\b", text_lower))
        return {
            "domain_enforced": True,
            "factual_score": round(score, 2),
            "matched_facts": matches,
            "missing_facts": [f for f in expected if f not in matches],
            "hallucination": hallucination,
            "notes": f"Matched {len(matches)}/{len(expected)} verified facts"
        }

def run_evaluation(model_original: str = "qwen2.5:0.5b", model_ft: str = "inferxe-qwen-ft"):
    print("=" * 75)
    print(f"EVALUATION BENCHMARK: Original ({model_original}) vs Fine-Tuned ({model_ft})")
    print("=" * 75)

    results = {
        "timestamp": datetime.now().isoformat(),
        "models": {
            "original": model_original,
            "fine_tuned": model_ft
        },
        "questions_count": len(EVALUATION_QUESTIONS),
        "scores": {
            "original": {"factual_total": 0.0, "refusals_passed": 0, "hallucinations": 0},
            "fine_tuned": {"factual_total": 0.0, "refusals_passed": 0, "hallucinations": 0}
        },
        "details": []
    }

    for item in EVALUATION_QUESTIONS:
        qid = item["id"]
        q = item["question"]
        print(f"\n--- [Question {qid}/10] ---")
        print(f"Q: {q}")

        # Test Original
        resp_orig = query_ollama(model_original, q)
        score_orig = score_response(item, resp_orig["content"])

        # Test Fine-Tuned
        resp_ft = query_ollama(model_ft, q)
        score_ft = score_response(item, resp_ft["content"])

        print(f"\n[Original: {model_original}]")
        print(f"Response: {resp_orig['content'][:140]}...")
        print(f"Score:    Factual={score_orig['factual_score']}, DomainEnforced={score_orig['domain_enforced']}, Hallucination={score_orig['hallucination']}")

        print(f"\n[Fine-Tuned: {model_ft}]")
        print(f"Response: {resp_ft['content'][:140]}...")
        print(f"Score:    Factual={score_ft['factual_score']}, DomainEnforced={score_ft['domain_enforced']}, Hallucination={score_ft['hallucination']}")

        results["scores"]["original"]["factual_total"] += score_orig["factual_score"]
        if score_orig["domain_enforced"] and item["expected_type"] != "factual":
            results["scores"]["original"]["refusals_passed"] += 1
        if score_orig["hallucination"]:
            results["scores"]["original"]["hallucinations"] += 1

        results["scores"]["fine_tuned"]["factual_total"] += score_ft["factual_score"]
        if score_ft["domain_enforced"] and item["expected_type"] != "factual":
            results["scores"]["fine_tuned"]["refusals_passed"] += 1
        if score_ft["hallucination"]:
            results["scores"]["fine_tuned"]["hallucinations"] += 1

        results["details"].append({
            "id": qid,
            "question": q,
            "type": item["expected_type"],
            "original": {
                "response": resp_orig["content"],
                "latency_sec": resp_orig["latency_sec"],
                "tok_per_sec": resp_orig["tok_per_sec"],
                "score": score_orig
            },
            "fine_tuned": {
                "response": resp_ft["content"],
                "latency_sec": resp_ft["latency_sec"],
                "tok_per_sec": resp_ft["tok_per_sec"],
                "score": score_ft
            }
        })

    # Summary
    n_factual = sum(1 for q in EVALUATION_QUESTIONS if q["expected_type"] == "factual")
    n_refusals = len(EVALUATION_QUESTIONS) - n_factual

    results["summary"] = {
        "original": {
            "avg_factual_accuracy": round(results["scores"]["original"]["factual_total"] / n_factual, 3),
            "refusal_guardrail_success_rate": f"{results['scores']['original']['refusals_passed']}/{n_refusals}",
            "hallucination_count": results["scores"]["original"]["hallucinations"]
        },
        "fine_tuned": {
            "avg_factual_accuracy": round(results["scores"]["fine_tuned"]["factual_total"] / n_factual, 3),
            "refusal_guardrail_success_rate": f"{results['scores']['fine_tuned']['refusals_passed']}/{n_refusals}",
            "hallucination_count": results["scores"]["fine_tuned"]["hallucinations"]
        }
    }

    out_file = "finetuning/results/evaluation_report.json"
    os.makedirs(os.path.dirname(out_file), exist_ok=True)
    with open(out_file, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2, ensure_ascii=False)

    print("\n" + "=" * 75)
    print("EVALUATION SUMMARY REPORT")
    print("=" * 75)
    print(f"Original Model ({model_original}):")
    print(f"  - Average Factual Accuracy:      {results['summary']['original']['avg_factual_accuracy'] * 100:.1f}%")
    print(f"  - Guardrail Refusal Success:     {results['summary']['original']['refusal_guardrail_success_rate']}")
    print(f"  - Hallucinated Claims Count:     {results['summary']['original']['hallucination_count']}")
    print(f"\nFine-Tuned Model ({model_ft}):")
    print(f"  - Average Factual Accuracy:      {results['summary']['fine_tuned']['avg_factual_accuracy'] * 100:.1f}%")
    print(f"  - Guardrail Refusal Success:     {results['summary']['fine_tuned']['refusal_guardrail_success_rate']}")
    print(f"  - Hallucinated Claims Count:     {results['summary']['fine_tuned']['hallucination_count']}")
    print(f"\nDetailed evaluation report saved to: {out_file}")
    return results

if __name__ == "__main__":
    # Compare raw base Qwen with Fine-Tuned Inferxe Qwen
    run_evaluation(model_original="qwen2.5:0.5b", model_ft="inferxe-qwen-ft")
