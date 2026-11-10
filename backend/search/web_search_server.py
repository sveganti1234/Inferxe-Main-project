"""
Lightweight local HTTP search micro-server for the Inferxe Chatbot.
Provides live DuckDuckGo web search results via JSON API with CORS enabled.
Endpoint: http://127.0.0.1:8765/api/search?q=<query>
"""

import sys
import json
import urllib.parse
from http.server import HTTPServer, BaseHTTPRequestHandler
from ddgs import DDGS

sys.stdout.reconfigure(encoding='utf-8')

PORT = 8765

class SearchRequestHandler(BaseHTTPRequestHandler):
    def _send_cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def do_OPTIONS(self):
        self.send_response(200)
        self._send_cors_headers()
        self.end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/search":
            query_params = urllib.parse.parse_qs(parsed.query)
            q = query_params.get("q", [""])[0].strip()
            max_results = int(query_params.get("limit", [4])[0])

            if not q:
                self.send_response(400)
                self._send_cors_headers()
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.end_headers()
                self.wfile.write(json.dumps({"error": "Missing 'q' query parameter"}).encode("utf-8"))
                return

            try:
                results = []
                with DDGS() as ddgs:
                    raw_results = list(ddgs.text(q, max_results=max_results))
                    for r in raw_results:
                        results.append({
                            "title": r.get("title", ""),
                            "snippet": r.get("body", ""),
                            "link": r.get("href", "")
                        })

                payload = json.dumps({"query": q, "count": len(results), "results": results}, ensure_ascii=False)
                self.send_response(200)
                self._send_cors_headers()
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.end_headers()
                self.wfile.write(payload.encode("utf-8"))
            except Exception as e:
                self.send_response(500)
                self._send_cors_headers()
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(e)}).encode("utf-8"))
        elif parsed.path == "/health":
            self.send_response(200)
            self._send_cors_headers()
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            self.wfile.write(json.dumps({"status": "ok", "service": "inferxe-websearch-proxy"}).encode("utf-8"))
        else:
            self.send_response(404)
            self._send_cors_headers()
            self.end_headers()

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/search":
            content_length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(content_length).decode("utf-8")
            try:
                data = json.loads(body)
                q = data.get("query", "").strip()
                max_results = int(data.get("limit", 4))

                results = []
                with DDGS() as ddgs:
                    raw_results = list(ddgs.text(q, max_results=max_results))
                    for r in raw_results:
                        results.append({
                            "title": r.get("title", ""),
                            "snippet": r.get("body", ""),
                            "link": r.get("href", "")
                        })

                payload = json.dumps({"query": q, "count": len(results), "results": results}, ensure_ascii=False)
                self.send_response(200)
                self._send_cors_headers()
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.end_headers()
                self.wfile.write(payload.encode("utf-8"))
            except Exception as e:
                self.send_response(500)
                self._send_cors_headers()
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(e)}).encode("utf-8"))
        else:
            self.send_response(404)
            self._send_cors_headers()
            self.end_headers()

def run():
    server_address = ("127.0.0.1", PORT)
    httpd = HTTPServer(server_address, SearchRequestHandler)
    print(f"ðŸ“¡ Inferxe Web Search Proxy listening on http://127.0.0.1:{PORT}")
    httpd.serve_forever()

if __name__ == "__main__":
    run()
