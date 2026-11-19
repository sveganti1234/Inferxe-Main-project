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
PROJECT_ROOT = SCRIPT_DIR if (SCRIPT_DIR / "package.json").exists() else SCRIPT_DIR.parent.parent

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
VARIATIONS_PER_ITEM = 18  # 55 base items * (1 original + 18 variations) = 1,045 Q&As
MAX_CONCURRENT_REQUESTS = 10

# Clean, direct system prompt baked into every fine-tuning example
CONCISE_SYSTEM_PROMPT = (
    "You are the Inferxe AI Assistant for inferxe.com—a unified GPU control plane "
    "that routes AI workloads across GPU providers based on compatibility, cost, and performance. "
    "Answer the user's exact question in the first sentence. Keep greetings and simple steps brief "
    "(1-2 sentences), use crisp bullet points for specs or pricing, and never add robotic intros, "
    "sales fluff, or generic closing questions."
)

PERSONAS = [
    "Direct & Formal (enterprise buyer or tech lead)",
    "Casual Developer Slang (short, lowercase, abbreviations like 'hr', 'vram', 'gpu')",
    "Cost-Conscious Startup Founder (focused on INR/USD pricing and burn rate)",
    "ML Engineer / Researcher (focused on CUDA, quantization, vLLM, PyTorch)",
    "Competitor Switcher (comparing against AWS, RunPod, Lambda Labs, or Vast.ai)",
    "Compliance & Security Officer (focused on India data residency and DPDP Act)",
    "Problem/Goal-Oriented User (describes workload like 'running Llama 70B' without naming GPU)",
    "Impatient / Search-Style Query (3-6 words, direct keyword query)",
    "Clarification / Edge-Case Seeker (asking 'what if...', limits, or failure behavior)",
    "Non-Native / Slight Typo Style (natural phrasing with minor typos like 'web sit e')",
    "API & Integration Developer (asking about endpoints, SDKs, keys, Docker)",
    "Finance / Procurement Manager (asking about GST invoices, UPI, wallet top-ups)",
    "DevOps / Infrastructure Engineer (asking about SSH, failover, autoscaling, storage)",
    "Student / Indie Hacker (budget-focused, quick experimentation, spot GPUs)",
    "CTO / VP Engineering (evaluating reliability, multi-provider routing, SLAs)",
    "Skeptical Buyer (questioning lock-in, cold starts, or hidden fees)",
    "Mobile / Quick Chat User (very brief, conversational one-liner)",
    "Migration Planner (moving existing OpenAI or single-cloud workloads to Inferxe)",
]

# ==========================================
# 2. STRUCTURED OUTPUT SCHEMAS
# ==========================================
class QuestionVariation(BaseModel):
    persona: str = Field(description="The persona style used for this phrasing.")
    question: str = Field(description="The rewritten user question.")
    concise_answer: str = Field(
        description=(
            "A direct, natural, concise answer tailored to this specific question. "
            "Must answer immediately in sentence 1, contain zero robotic greetings/sign-offs, "
            "and preserve 100% of factual details (prices, GPUs, URLs) from the verified answer."
        )
    )

class ExpandedBatch(BaseModel):
    canonical_concise_answer: str = Field(
        description="A tightened, fluff-free version of the original verified answer."
    )
    variations: List[QuestionVariation]

# ==========================================
# 3. ASYNC EXPANSION & REWRITE ENGINE
# ==========================================
api_key = os.getenv("GEMINI_API_KEY")
client = genai.Client(api_key=api_key) if api_key else genai.Client()
semaphore = asyncio.Semaphore(MAX_CONCURRENT_REQUESTS)

def normalize_text(text: str) -> str:
    return re.sub(r"[^a-z0-9\s]", "", text.lower()).strip()

async def expand_single_qa(item: dict, idx: int, total: int) -> List[dict]:
    active_personas = PERSONAS[:VARIATIONS_PER_ITEM]
    persona_instructions = "\n".join(
        [f"{i+1}. {p}" for i, p in enumerate(active_personas)]
    )

    prompt = f"""
You are building a high-precision training dataset for the Inferxe (inferxe.com) chatbot.

TASK:
1. Rewrite the Verified Answer into a crisp, direct, human-sounding `canonical_concise_answer`.
2. Generate {VARIATIONS_PER_ITEM} distinct user question variations using the personas below, and pair EACH variation with a tailored `concise_answer`.

STRICT STYLE RULES FOR EVERY ANSWER:
- **Lead with the answer in Sentence 1.** Zero filler openers (NEVER say "Hello! I am the Inferxe AI Assistant..." or "Great question!").
- **Zero filler closers.** NEVER end with generic sign-offs like "How can I help you today?" or "What model are you looking for?"
- **Proportional length:**
  - Simple/account/greeting questions -> 1 to 2 direct sentences max.
  - Pricing/hardware/multi-step answers -> Short bullet points with exact figures.
- **100% Factual Lock:** Every GPU name, VRAM size, INR/USD price, URL, and technical claim MUST come strictly from the Verified Answer below. Do not invent features or numbers.

PERSONAS TO USE (one per variation):
{persona_instructions}

CANONICAL QUESTION:
{item['question']}

VERIFIED ANSWER (SOURCE OF TRUTH):
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
                        temperature=0.65,
                    ),
                )
                parsed = ExpandedBatch.model_validate_json(response.text)
                print(f"[{idx}/{total}] {item['id']} ({model_id}) -> {len(parsed.variations)} concise pairs")

                results = [
                    {
                        "id": f"{item['id']}-orig",
                        "parent_id": item["id"],
                        "category": item.get("category", "general"),
                        "persona": "canonical",
                        "question": item["question"],
                        "answer": parsed.canonical_concise_answer.strip(),
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
                            "answer": var.concise_answer.strip(),
                            "verified_source": item.get("verified_source", "https://inferxe.com/"),
                        }
                    )
                return results

            except Exception as e:
                last_err = e
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

    print(
        f"Loaded {len(base_data)} base Q&As. "
        f"Generating ~{len(base_data) * (VARIATIONS_PER_ITEM + 1)} concise pairs..."
    )

    tasks = [
        expand_single_qa(item, i + 1, len(base_data))
        for i, item in enumerate(base_data)
    ]
    nested_results = await asyncio.gather(*tasks)

    seen_questions = set()
    final_dataset = []

    for group in nested_results:
        for entry in group:
            norm_q = normalize_text(entry["question"])
            if norm_q and norm_q not in seen_questions:
                seen_questions.add(norm_q)
                final_dataset.append(entry)

    # 1. Save full JSON (for RAG / Vector DB indexing & QA auditing)
    for out_p in [OUTPUT_JSON, LOCAL_OUTPUT_JSON]:
        with open(out_p, "w", encoding="utf-8") as f:
            json.dump(final_dataset, f, indent=2, ensure_ascii=False)

    # 2. Save Chat JSONL (for supervised fine-tuning)
    for out_l in [OUTPUT_JSONL, LOCAL_OUTPUT_JSONL]:
        with open(out_l, "w", encoding="utf-8") as f:
            for entry in final_dataset:
                record = {
                    "messages": [
                        {"role": "system", "content": CONCISE_SYSTEM_PROMPT},
                        {"role": "user", "content": entry["question"]},
                        {"role": "assistant", "content": entry["answer"]},
                    ]
                }
                f.write(json.dumps(record, ensure_ascii=False) + "\n")

    print("\n--- DONE ---")
    print(f"Total unique concise Q&A pairs: {len(final_dataset)}")
    print(f"RAG/Audit JSON saved to: {OUTPUT_JSON} and {LOCAL_OUTPUT_JSON}")
    print(f"Fine-Tuning JSONL saved to: {OUTPUT_JSONL} and {LOCAL_OUTPUT_JSONL}")

if __name__ == "__main__":
    asyncio.run(main())
