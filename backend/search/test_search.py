import urllib.request
import urllib.parse
import re
import json

def search_duckduckgo(query: str, max_results: int = 4):
    encoded = urllib.parse.quote(query)
    url = f"https://html.duckduckgo.com/html/?q={encoded}"
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.5"
        }
    )
    results = []
    try:
        with urllib.request.urlopen(req, timeout=8) as resp:
            html = resp.read().decode("utf-8", errors="ignore")
            # DuckDuckGo HTML layout regex
            blocks = re.findall(r'<div class="result__body">(.*?)</div>\s*</div>', html, re.DOTALL)
            for block in blocks[:max_results]:
                # Extract title and link
                title_match = re.search(r'<a class="result__snippet[^>]*>(.*?)</a>', block, re.DOTALL)
                url_match = re.search(r'<a class="result__url[^>]*href="([^"]*)"', block, re.DOTALL)
                title_tag = re.search(r'<h2 class="result__title">.*?<a[^>]*>(.*?)</a>', block, re.DOTALL)
                
                snippet = re.sub(r'<[^>]+>', '', title_match.group(1)).strip() if title_match else ""
                title = re.sub(r'<[^>]+>', '', title_tag.group(1)).strip() if title_tag else ""
                link = url_match.group(1).strip() if url_match else ""
                
                if snippet:
                    results.append({
                        "title": title,
                        "snippet": snippet,
                        "link": link
                    })
    except Exception as e:
        print("Search error:", e)
    return results

if __name__ == "__main__":
    res = search_duckduckgo("NVIDIA H100 GPU specs and pricing")
    print(f"Results found: {len(res)}")
    for r in res:
        print(f"Title: {r['title']}")
        print(f"Snippet: {r['snippet']}")
        print(f"Link: {r['link']}\n")
