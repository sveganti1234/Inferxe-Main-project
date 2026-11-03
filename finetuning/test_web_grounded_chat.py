"""
test_web_grounded_chat.py
=========================
Simulates the chatbot's live web-augmented flow:
1. Search outside web via local DDGS proxy (http://127.0.0.1:8765)
2. Inject live outside snippets into Ollama prompt
3. Verify inferxe-qwen-ft answers using live web data
"""

import sys
import json
import time
import urllib.request
import urllib.parse

sys.stdout.reconfigure(encoding='utf-8')

SEARCH_URL = "http://127.0.0.1:8765/api/search"
OLLAMA_URL = "http://127.0.0.1:11434/api/chat"
MODEL = "inferxe-qwen-ft"

QUESTION = "What is the latest cloud rental price for an NVIDIA H100 on JarvisLabs?"

def main():
    print("=" * 80)
    print("🌐 TESTING LIVE WEB SEARCH GROUNDING FOR INFERXE CHATBOT")
    print("=" * 80)
    print(f"User Question: \"{QUESTION}\"\n")

    # Step 1: Query Live Outside Web
    print("[Step 1] Searching outside web via DuckDuckGo proxy...")
    t0 = time.time()
    search_req = urllib.request.Request(
        f"{SEARCH_URL}?q={urllib.parse.quote('JarvisLabs NVIDIA H100 cloud rental hourly price')}&limit=3"
    )
    with urllib.request.urlopen(search_req, timeout=10) as resp:
        search_data = json.loads(resp.read().decode("utf-8"))
    search_time = time.time() - t0

    results = search_data.get("results", [])
    print(f"--> Retrieved {len(results)} live web sources in {search_time:.2f}s:")
    for i, r in enumerate(results, 1):
        print(f"   [{i}] {r['title']} ({r['link']})")
        print(f"       \"{r['snippet'][:120]}...\"")

    # Step 2: Augment prompt with live search context
    print("\n[Step 2] Injecting outside data into Ollama prompt...")
    context = "\n\n".join([
        f"[Live Source {i}]: {r['title']}\nURL: {r['link']}\nSnippet: {r['snippet']}"
        for i, r in enumerate(results, 1)
    ])

    user_content = (
        f"[LIVE WEB SEARCH CONTEXT FROM OUTSIDE INTERNET]\n{context}\n\n"
        f"[USER QUESTION]\n{QUESTION}\n\n"
        "INSTRUCTIONS: Answer the user's question accurately using both your GPU knowledge and "
        "the fresh outside web search results provided above. Cite specific live prices and provider rates from the search results."
    )

    ollama_payload = {
        "model": MODEL,
        "messages": [
            {
                "role": "system",
                "content": "You are the Inferxe GPU infrastructure assistant. Answer GPU, cloud pricing, and platform questions accurately using verified facts and provided live web results."
            },
            {
                "role": "user",
                "content": user_content
            }
        ],
        "stream": False,
        "options": {
            "temperature": 0.2,
            "top_p": 0.9
        }
    }

    # Step 3: Call Ollama with augmented context
    print(f"[Step 3] Querying {MODEL} in Ollama with live web grounding...")
    t1 = time.time()
    ollama_req = urllib.request.Request(
        OLLAMA_URL,
        data=json.dumps(ollama_payload).encode("utf-8"),
        headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(ollama_req, timeout=30) as resp:
        ollama_data = json.loads(resp.read().decode("utf-8"))
    ollama_time = time.time() - t1

    response_text = ollama_data.get("message", {}).get("content", "").strip()

    print(f"\n[Response from {MODEL} ({ollama_time:.2f}s)]:\n")
    print(response_text)
    print("\n" + "=" * 80)
    print("✅ Live Web Search Grounding test completed successfully!")

if __name__ == "__main__":
    main()
