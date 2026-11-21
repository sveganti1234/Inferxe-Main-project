# Inferxe Database & Datasets

This directory contains the ChromaDB vector database, curated structured datasets, and automated ingestion scripts.

## Directory Structure

```
database/
├── chroma_db/          # Persistent ChromaDB vector database
├── datasets/           # Curated structured data files
│   ├── hardware/       # NVIDIA GPU specifications & architecture tables (CSV/JSON)
│   ├── pricing/        # GPU cloud instance pricing (JarvisLabs, AWS, Lambda, E2E)
│   ├── models/         # LLM model compatibility & token economic benchmarks
│   ├── knowledge/      # Verified Q&A, FAQs, website knowledge chunks, and technical concepts
│   └── training/       # SFT instruction tuning datasets (train.jsonl, test.jsonl, validation.jsonl)
├── scripts/            # Ingestion, scraping, and vector indexing pipelines
│   ├── ingest_dataset.py       # Data cleaning, deduplication, and chunk generator
│   ├── index_knowledge.py      # ChromaDB embeddings indexer
│   ├── build_inference_datasets.py
│   ├── process_and_filter_website_data.py
│   ├── scrape_jarvislabs_comprehensive.py
│   └── test_chatbot_limitations.py
└── config/             # Metadata & Guardrail Configuration
    ├── chatbot_guardrail_config.json
    ├── index_manifest.json
    ├── ingestion_report.json
    ├── CHATBOT_STRICT_LIMITATIONS_AND_GUARDRAILS.md
    └── FILTERED_WEBSITE_DATA_SUMMARY.md
```

## Reindexing the Database

To clean and ingest the datasets into ChromaDB:

```bash
# 1. Clean and chunk data
python database/scripts/ingest_dataset.py

# 2. Index into ChromaDB vector database
python database/scripts/index_knowledge.py
```

