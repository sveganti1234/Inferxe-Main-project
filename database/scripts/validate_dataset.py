import json
import re
from pathlib import Path

# ==========================================
# 1. CONFIGURATION
# ==========================================
SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR if (SCRIPT_DIR / "package.json").exists() else SCRIPT_DIR.parent.parent

CANDIDATE_INPUTS = [
    Path("inferxe_expanded_1000plus.json"),
    PROJECT_ROOT / "inferxe_expanded_1000plus.json",
    PROJECT_ROOT / "database" / "datasets" / "training" / "inferxe_expanded_1000plus.json",
    Path("inferxe_base_qa.json"),
    PROJECT_ROOT / "inferxe_base_qa.json",
    PROJECT_ROOT / "database" / "datasets" / "knowledge" / "inferxe_base_qa.json",
]
INPUT_JSON = next((p for p in CANDIDATE_INPUTS if p.exists()), Path("inferxe_base_qa.json"))

CLEAN_JSONL_OUT = Path("inferxe_finetune_clean.jsonl")
REPORT_OUT = Path("validation_report.json")

MAX_WORDS_PER_ANSWER = 65  # Flag answers longer than 65 words

CONCISE_SYSTEM_PROMPT = (
    "You are the Inferxe AI Assistant for inferxe.com—a unified GPU control plane "
    "that routes AI workloads across GPU providers based on compatibility, cost, and performance. "
    "Answer the user's exact question in the first sentence. Keep greetings and simple steps brief "
    "(1-2 sentences), use crisp bullet points for specs or pricing, and never add robotic intros, "
    "sales fluff, or generic closing questions."
)

# Regex patterns for forbidden artifacts
PLACEHOLDER_PATTERN = re.compile(r"\[INSERT[^\]]*\]|\{\{[^}]+\}\}", re.IGNORECASE)
LEGACY_BRAND_PATTERN = re.compile(r"\bjarvis\s*labs?\b", re.IGNORECASE)

FILLER_PATTERNS = [
    re.compile(r"^(hello|hi|hey)[!.,]?\s+i\s+(am|'m)\s+the\s+inferxe", re.IGNORECASE),
    re.compile(r"^great\s+question[!.,]?", re.IGNORECASE),
    re.compile(r"^certainly[!.,]?|^sure[!.,]?|^absolutely[!.,]?", re.IGNORECASE),
    re.compile(r"how\s+can\s+i\s+(help|assist)\s+you\s+today\??$", re.IGNORECASE),
    re.compile(r"what\s+model\s+or\s+token\s+throughput\s+target\s+are\s+you\s+looking\s+for\??$", re.IGNORECASE),
    re.compile(r"let\s+me\s+know\s+if\s+you\s+have\s+any\s+(other\s+)?questions[!.]?$", re.IGNORECASE),
]

# ==========================================
# 2. AUDIT LOGIC
# ==========================================
def audit_dataset():
    input_path = Path(INPUT_JSON)
    if not input_path.exists():
        raise FileNotFoundError(f"Could not find {INPUT_JSON}. Run your expansion script first.")

    with open(input_path, "r", encoding="utf-8") as f:
        dataset = json.load(f)

    flagged_items = []
    clean_items = []

    stats = {
        "total_scanned": len(dataset),
        "passed": 0,
        "flagged": 0,
        "issues_breakdown": {
            "unreplaced_placeholders": 0,
            "legacy_brand_mention": 0,
            "robotic_filler": 0,
            "too_long": 0,
            "empty_or_missing_text": 0,
        },
    }

    for entry in dataset:
        item_id = entry.get("id", "unknown")
        question = entry.get("question", "").strip()
        answer = entry.get("answer", "").strip()
        issues = []

        # 1. Check empty fields
        if not question or not answer:
            issues.append("empty_or_missing_text")
            stats["issues_breakdown"]["empty_or_missing_text"] += 1

        # 2. Check [INSERT_...] or {{...}} placeholders
        if PLACEHOLDER_PATTERN.search(question) or PLACEHOLDER_PATTERN.search(answer):
            issues.append("unreplaced_placeholders")
            stats["issues_breakdown"]["unreplaced_placeholders"] += 1

        # 3. Check accidental JarvisLabs references
        if LEGACY_BRAND_PATTERN.search(question) or LEGACY_BRAND_PATTERN.search(answer):
            issues.append("legacy_brand_mention")
            stats["issues_breakdown"]["legacy_brand_mention"] += 1

        # 4. Check robotic intros & closers
        for pattern in FILLER_PATTERNS:
            if pattern.search(answer):
                issues.append(f"robotic_filler ({pattern.pattern})")
                stats["issues_breakdown"]["robotic_filler"] += 1
                break

        # 5. Check word count (skip strict limit for full pricing tables if needed)
        word_count = len(answer.split())
        if word_count > MAX_WORDS_PER_ANSWER:
            issues.append(f"too_long ({word_count} words > {MAX_WORDS_PER_ANSWER})")
            stats["issues_breakdown"]["too_long"] += 1

        if issues:
            stats["flagged"] += 1
            flagged_items.append({
                "id": item_id,
                "parent_id": entry.get("parent_id"),
                "issues": issues,
                "question": question,
                "answer": answer,
            })
        else:
            stats["passed"] += 1
            clean_items.append(entry)

    # Save detailed report of flagged items so you can inspect/fix them
    report = {"summary": stats, "flagged_entries": flagged_items}
    with open(REPORT_OUT, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2, ensure_ascii=False)

    # Export clean JSONL ready for fine-tuning
    with open(CLEAN_JSONL_OUT, "w", encoding="utf-8") as f:
        for entry in clean_items:
            record = {
                "messages": [
                    {"role": "system", "content": CONCISE_SYSTEM_PROMPT},
                    {"role": "user", "content": entry["question"]},
                    {"role": "assistant", "content": entry["answer"]},
                ]
            }
            f.write(json.dumps(record, ensure_ascii=False) + "\n")

    # Print console summary
    print("=== INFERXE DATASET VALIDATION REPORT ===")
    print(f"Total Scanned : {stats['total_scanned']}")
    print(f"Passed Clean  : {stats['passed']}")
    print(f"Flagged       : {stats['flagged']}")
    print("\nBreakdown of Issues:")
    for issue_type, count in stats["issues_breakdown"].items():
        print(f"  - {issue_type}: {count}")
    print(f"\nDetailed report saved to : {REPORT_OUT}")
    print(f"Clean training JSONL     : {CLEAN_JSONL_OUT}")

if __name__ == "__main__":
    audit_dataset()
