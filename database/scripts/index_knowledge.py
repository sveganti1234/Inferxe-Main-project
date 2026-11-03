"""
index_knowledge.py
==================
Vector indexing pipeline for the Inferxe RAG knowledge base.
Uses ChromaDB for local persistent storage and 'nomic-embed-text' via Ollama for 768-dim embeddings.
Stores chunks with sanitized metadata and tracks indexing manifests.
"""

import os
import sys
import json
import time
import hashlib
import urllib.request
import urllib.error
from typing import List, Dict, Any, Optional

sys.stdout.reconfigure(encoding='utf-8')

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_ROOT = os.path.abspath(os.path.join(BASE_DIR, ".."))
CHUNKS_FILE = os.path.join(DB_ROOT, "datasets", "knowledge", "cleaned_knowledge_chunks.json")
MANIFEST_FILE = os.path.join(DB_ROOT, "config", "index_manifest.json")
CHROMA_PERSIST_DIR = os.environ.get("CHROMA_PERSIST_DIR", os.path.join(DB_ROOT, "chroma_db"))
COLLECTION_NAME = "inferxe_knowledge_base"
EMBEDDING_MODEL = "nomic-embed-text"
OLLAMA_EMBED_URL = "http://127.0.0.1:11434/api/embeddings"

def get_file_sha256(filepath: str) -> str:
    h = hashlib.sha256()
    with open(filepath, "rb") as f:
        while chunk := f.read(8192):
            h.update(chunk)
    return h.hexdigest()

def get_embedding(text: str, timeout: int = 15) -> Optional[List[float]]:
    payload = json.dumps({
        "model": EMBEDDING_MODEL,
        "prompt": text
    }).encode("utf-8")
    
    req = urllib.request.Request(
        OLLAMA_EMBED_URL,
        data=payload,
        headers={"Content-Type": "application/json"}
    )
    
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return data.get("embedding")
    except Exception as e:
        print(f"[Embedding Error] Failed to generate embedding: {e}")
        return None

def sanitize_metadata(meta: Dict[str, Any]) -> Dict[str, Any]:
    """Ensure all metadata values are primitive types (str, int, float, bool) for ChromaDB."""
    clean = {}
    for k, v in meta.items():
        if isinstance(v, (str, int, float, bool)):
            clean[k] = v
        elif v is None:
            clean[k] = ""
        else:
            clean[k] = str(v)
    return clean

def index_all_chunks(force: bool = False):
    print("=" * 80)
    print("INFERXE RAG VECTOR INDEXING PIPELINE")
    print("=" * 80)
    print(f"Embedding Model:   {EMBEDDING_MODEL} (via Ollama)")
    print(f"Vector Database:   ChromaDB (Persistent)")
    print(f"Persist Directory: {CHROMA_PERSIST_DIR}")
    print(f"Collection Name:   {COLLECTION_NAME}\n")

    if not os.path.exists(CHUNKS_FILE):
        print(f"❌ Error: Chunks file not found at '{CHUNKS_FILE}'. Run 'rag/ingest_dataset.py' first.")
        sys.exit(1)

    with open(CHUNKS_FILE, "r", encoding="utf-8") as f:
        chunks = json.load(f)

    total_chunks = len(chunks)
    print(f"Loaded {total_chunks} cleaned knowledge chunks.")

    current_hash = get_file_sha256(CHUNKS_FILE)

    # Check manifest
    if not force and os.path.exists(MANIFEST_FILE):
        try:
            with open(MANIFEST_FILE, "r", encoding="utf-8") as f:
                manifest = json.load(f)
            if manifest.get("file_hash") == current_hash and manifest.get("indexed_chunks") == total_chunks:
                print(f"✅ Index is already up to date with dataset version (SHA256: {current_hash[:12]}...).")
                print(f"Use '--force' or pass force=True to reindex.")
                return manifest
        except Exception:
            pass

    # Verify Ollama embedding availability
    print("Verifying Ollama connection and 'nomic-embed-text' model...")
    test_vec = get_embedding("Inferxe GPU cloud indexing verification")
    if not test_vec:
        print("❌ Fatal: Ollama 'nomic-embed-text' model is not responding.")
        print("Please ensure Ollama is running (`ollama serve`) and the model is downloaded (`ollama pull nomic-embed-text`).")
        sys.exit(1)
    print(f"✅ Embedding service active! Output dimension: {len(test_vec)}")

    # Initialize ChromaDB
    import chromadb
    client = chromadb.PersistentClient(path=CHROMA_PERSIST_DIR)

    # Safe reindexing: drop existing collection if force or updating
    existing_collections = [c.name for c in client.list_collections()]
    if COLLECTION_NAME in existing_collections:
        print(f"Found existing collection '{COLLECTION_NAME}'. Resetting for clean indexing...")
        client.delete_collection(COLLECTION_NAME)

    collection = client.create_collection(
        name=COLLECTION_NAME,
        metadata={"hnsw:space": "cosine"}
    )

    print(f"\nGenerating embeddings and storing {total_chunks} chunks...")
    batch_size = 10
    start_time = time.time()
    successful_count = 0

    for i in range(0, total_chunks, batch_size):
        batch = chunks[i : i + batch_size]
        batch_ids = []
        batch_texts = []
        batch_metas = []
        batch_embs = []

        for item in batch:
            emb = get_embedding(item["content"])
            if emb:
                batch_ids.append(item["id"])
                batch_texts.append(item["content"])
                batch_metas.append(sanitize_metadata(item.get("metadata", {})))
                batch_embs.append(emb)
            else:
                print(f"⚠️ Failed to embed chunk {item['id']}")

        if batch_ids:
            collection.add(
                ids=batch_ids,
                documents=batch_texts,
                metadatas=batch_metas,
                embeddings=batch_embs
            )
            successful_count += len(batch_ids)

        progress = min(100.0, (i + len(batch)) / total_chunks * 100.0)
        elapsed = time.time() - start_time
        print(f"  [{progress:5.1f}%] Indexed {successful_count}/{total_chunks} chunks (Elapsed: {elapsed:.1f}s)")

    # Verification
    final_count = collection.count()
    print(f"\nVerification: Stored document count in ChromaDB = {final_count}")
    if final_count != total_chunks:
        print(f"⚠️ Warning: Indexed {final_count} items, expected {total_chunks}.")
    else:
        print("✅ Document count strictly matches expected dataset size!")

    # Write Manifest
    manifest_data = {
        "indexed_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "collection_name": COLLECTION_NAME,
        "embedding_model": EMBEDDING_MODEL,
        "embedding_dimension": len(test_vec),
        "source_chunks_file": CHUNKS_FILE,
        "file_hash": current_hash,
        "indexed_chunks": final_count,
        "status": "success"
    }

    with open(MANIFEST_FILE, "w", encoding="utf-8") as f:
        json.dump(manifest_data, f, indent=2)
    print(f"Saved manifest to: {MANIFEST_FILE}")

    # Test Search Query
    print("\nRunning smoke query test: 'NVIDIA L4 specifications and VRAM'")
    query_emb = get_embedding("NVIDIA L4 specifications and VRAM")
    results = collection.query(
        query_embeddings=[query_emb],
        n_results=2
    )
    print("Smoke Test Results:")
    for idx, (doc, dist) in enumerate(zip(results["documents"][0], results["distances"][0])):
        print(f"  Result #{idx+1} [Cosine Distance: {dist:.4f}]:\n    {doc[:120]}...\n")

    print("=" * 80)
    print("✅ RAG KNOWLEDGE INDEXING COMPLETED SUCCESSFULLY!")
    print("=" * 80)
    return manifest_data

if __name__ == "__main__":
    force_flag = "--force" in sys.argv
    index_all_chunks(force=force_flag)
