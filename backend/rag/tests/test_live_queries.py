import urllib.request
import json
import sys

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")

queries = [
    "how to use wallet in this web site",
    "how payment process will be done in the web site"
]

for q in queries:
    req = urllib.request.Request(
        "http://127.0.0.1:8000/api/chat",
        data=json.dumps({"message": q}).encode("utf-8"),
        headers={"Content-Type": "application/json"}
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            print(f"=== QUERY: {q} ===")
            print(f"Status: {data.get('status')}")
            print(f"Response:\n{data.get('response')}\n")
    except Exception as e:
        print(f"Error for {q}: {e}")
