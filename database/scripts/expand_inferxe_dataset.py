import asyncio
import json
import os
import re
from pathlib import Path
from typing import List
from google import genai
from google.genai import types
from pydantic import BaseModel, Field

# ==========================================
# 1. CONFIGURATION
# ==========================================
SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent.parent

# Resolve input file from either script location, root, or datasets directory
CANDIDATE_INPUTS = [
    Path("inferxe_base_qa.json"),
    PROJECT_ROOT / "inferxe_base_qa.json",
    PROJECT_ROOT / "database" / "datasets" / "knowledge" / "inferxe_base_qa.json",
]
INPUT_FILE = next((p for p in CANDIDATE_INPUTS if p.exists()), Path("inferxe_base_qa.json"))

OUTPUT_DIR = PROJECT_ROOT / "database" / "datasets" / "training"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

OUTPUT_JSON = OUTPUT_DIR / "inferxe_expanded_1000plus.json"
OUTPUT_JSONL = OUTPUT_DIR / "inferxe_finetune.jsonl"
LOCAL_OUTPUT_JSON = Path("inferxe_expanded_1000plus.json")
LOCAL_OUTPUT_JSONL = Path("inferxe_finetune.jsonl")

# Fallback models in priority order
MODELS_TO_TRY = [
    os.getenv("GEMINI_MODEL", "gemini-2.0-flash"),
    "gemini-2.5-flash",
    "gemini-1.5-flash",
]
VARIATIONS_PER_ITEM = 10  # 50 base items * (1 original + 10 variations) = 550 Q&As
MAX_CONCURRENT_REQUESTS = 10  # Adjust based on your API rate tier

PERSONAS = [
    "Direct & Formal (enterprise buyer or technical lead asking clearly)",
    "Casual Developer Slang (short, lowercase, abbreviations like 'hr', 'vram', 'gpu')",
    "Cost-Conscious Startup Founder (focused on INR/USD pricing, burn rate, discounts)",
    "ML Engineer / Researcher (focused on CUDA, quantization, throughput, vLLM, PyTorch)",
    "Competitor Switcher (comparing against AWS, RunPod, Lambda Labs, or Vast.ai)",
    "Compliance & Security Officer (focused on India data residency, DPDP Act, privacy)",
    "Problem/Goal-Oriented User (describes a workload like 'running Llama 70B' without naming a GPU)",
    "Impatient / Short Query (3-6 words, search-engine style query)",
    "Clarification / Edge-Case Seeker (asking 'what if...', limits, or failure behavior)",
    "Non-Native / Slight Typo Style (natural phrasing with minor grammar quirks or typos)",
]

# ==========================================
# 2. STRUCTURED OUTPUT SCHEMA
# ==========================================
class QuestionVariation(BaseModel):
    persona: str = Field(description="The persona style used for this phrasing.")
    question: str = Field(description="The rewritten user question.")

class ExpandedBatch(BaseModel):
    variations: List[QuestionVariation]

# ==========================================
# 3. ASYNC EXPANSION ENGINE
# ==========================================
api_key = os.getenv("GEMINI_API_KEY")
if not api_key:
    raise ValueError(
        "GEMINI_API_KEY environment variable is not set. Please set it before running: export GEMINI_API_KEY='your-key'"
    )
client = genai.Client(api_key=api_key)
semaphore = asyncio.Semaphore(MAX_CONCURRENT_REQUESTS)

def normalize_text(text: str) -> str:
    """Used to catch and drop exact or punctuation-only duplicates."""
    return re.sub(r"[^a-z0-9\s]", "", text.lower()).strip()

async def expand_single_qa(item: dict, idx: int, total: int) -> List[dict]:
    """Generates persona-based question variations while preserving the exact verified answer."""
    persona_instructions = "\n".join(
        [f"{i+1}. {p}" for i, p in enumerate(PERSONAS[:VARIATIONS_PER_ITEM])]
    )

    prompt = f"""
You are building a training dataset for the official customer support and technical AI assistant of Inferxe (inferxe.com), a unified GPU control plane.

Given the canonical Question and its Verified Answer below, generate {VARIATIONS_PER_ITEM} distinct ways real users would ask this exact question.

STRICT RULES:
1. Every generated question MUST be 100% answerable using ONLY the facts in the Verified Answer. Do not introduce new technical claims or ask for info not present in the answer.
2. Vary sentence structure, vocabulary, and tone according to the {VARIATIONS_PER_ITEM} personas listed below.
3. Keep brand names accurate ("Inferxe", "NVIDIA", "H100", etc.).

PERSONAS TO USE (one per variation):
{persona_instructions}

CANONICAL QUESTION:
{item['question']}

VERIFIED ANSWER (DO NOT ALTER FACTS):
{item['answer']}
"""

    async with semaphore:
        last_err = None
        for model_id in MODELS_TO_TRY:
            try:
                response = await client.aio.models.generate_content(
                    model=model_id,
                    contents=prompt,
                    config=types.GenerateContentConfig(
                        response_mime_type="application/json",
                        response_schema=ExpandedBatch,
                        temperature=0.75,
                    ),
                )
                parsed = ExpandedBatch.model_validate_json(response.text)
                print(f"[{idx}/{total}] Expanded {item['id']} ({model_id}) -> {len(parsed.variations)} variations")

                # Always preserve the original canonical entry first
                results = [
                    {
                        "id": f"{item['id']}-orig",
                        "parent_id": item["id"],
                        "category": item.get("category", "general"),
                        "persona": "canonical",
                        "question": item["question"],
                        "answer": item["answer"],
                        "verified_source": item.get("verified_source", "https://inferxe.com/"),
                    }
                ]

                for v_idx, var in enumerate(parsed.variations, start=1):
                    results.append(
                        {
                            "id": f"{item['id']}-v{v_idx:02d}",
                            "parent_id": item["id"],
                            "category": item.get("category", "general"),
                            "persona": var.persona,
                            "question": var.question.strip(),
                            "answer": item["answer"],  # Preserved verbatim
                            "verified_source": item.get("verified_source", "https://inferxe.com/"),
                        }
                    )
                return results

            except Exception as e:
                last_err = e
                # Try next model if 404 or unsupported
                continue

        print(f"[ERROR] Failed on {item.get('id', idx)}: {last_err}")
        return []

# ==========================================
# 4. MAIN PIPELINE & EXPORT
# ==========================================
async def main():
    input_path = Path(INPUT_FILE)
    if not input_path.exists():
        raise FileNotFoundError(
            f"Could not find {INPUT_FILE}. Save your base Q&A JSON array to {INPUT_FILE} first."
        )

    with open(input_path, "r", encoding="utf-8") as f:
        base_data = json.load(f)

    print(f"Loaded {len(base_data)} canonical Q&As. Target output: ~{len(base_data) * (VARIATIONS_PER_ITEM + 1)} items.")

    tasks = [
        expand_single_qa(item, i + 1, len(base_data))
        for i, item in enumerate(base_data)
    ]
    nested_results = await asyncio.gather(*tasks)

    # Flatten and deduplicate questions
    seen_questions = set()
    final_dataset = []

    for group in nested_results:
        for entry in group:
            norm_q = normalize_text(entry["question"])
            if norm_q and norm_q not in seen_questions:
                seen_questions.add(norm_q)
                final_dataset.append(entry)

    # Save 1: Full JSON (Ideal for RAG / Vector DBs / Evaluation)
    for out_p in [OUTPUT_JSON, LOCAL_OUTPUT_JSON]:
        with open(out_p, "w", encoding="utf-8") as f:
            json.dump(final_dataset, f, indent=2, ensure_ascii=False)

    # Save 2: Chat JSONL (Ideal for supervised fine-tuning)
    system_prompt = (
        "You are the official AI assistant for Inferxe (inferxe.com), a unified GPU control plane. "
        "Provide accurate, concise, and helpful answers grounded strictly in Inferxe's platform capabilities and pricing."
    )
    for out_l in [OUTPUT_JSONL, LOCAL_OUTPUT_JSONL]:
        with open(out_l, "w", encoding="utf-8") as f:
            for entry in final_dataset:
                record = {
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": entry["question"]},
                        {"role": "assistant", "content": entry["answer"]},
                    ]
                }
                f.write(json.dumps(record, ensure_ascii=False) + "\n")

    print("\n--- DONE ---")
    print(f"Total unique Q&A pairs generated: {len(final_dataset)}")
    print(f"Saved RAG/QA JSON to: {OUTPUT_JSON} and {LOCAL_OUTPUT_JSON}")
    print(f"Saved Fine-Tuning JSONL to: {OUTPUT_JSONL} and {LOCAL_OUTPUT_JSONL}")

if __name__ == "__main__":
    asyncio.run(main())
