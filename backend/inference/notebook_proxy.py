"""
notebook_proxy.py
=================
Reverse proxy from the public notebook URL (/nb/<notebook id>/...) to the notebook's JupyterLab, for HTTP and
WebSocket traffic.

  * Entry: /nb/<id>/_inferxe/enter. The console's Open button lands here with a single-use ticket in the URL
    fragment (never sent to servers); the page posts it to /_inferxe/login. Customers can also log in with their
    notebook token on the same page. Success sets a signed, HttpOnly session cookie scoped to /nb/<id>/.
  * Every proxied request needs that cookie, valid for this notebook and the current token hash (rotation logs
    everyone out). The upstream address is resolved on the server from the notebook's deployment and its real
    port mappings (public addresses only); the client never chooses where requests go.
  * Customer cookies/credentials are stripped; JupyterLab is called with the internal token.
  * WebSockets additionally require Origin == the configured public origin (cross-site WebSocket hijacking).

Not covered here (see the Phase 4 notes): TLS on the proxy -> provider hop, provider-side firewalling of the raw
port, and serving notebooks from their own origin instead of the backend's.
"""

import asyncio
import hashlib
import hmac
import html
import logging
import secrets
import urllib.parse
import uuid
from typing import Any, Callable, List, Optional, Tuple

import httpx2
from fastapi import APIRouter, Depends, Request, WebSocket
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse, Response, StreamingResponse
from starlette.background import BackgroundTask
from websockets.asyncio.client import connect as websocket_connect

from inference.notebook_access import (
    SESSION_COOKIE,
    SESSION_TTL_SECONDS,
    AccessConfig,
    internal_jupyter_token,
    load_access_config,
    new_session,
    notebook_path,
    token_fingerprint,
    used_tickets,
    verify,
)
from inference.notebook_service import jupyter_base_url
from inference.supabase_deployments import SupabaseDeploymentRepository, get_deployment_repository
from inference.supabase_notebooks import (
    NotebookValidationError,
    SupabaseNotebookRecord,
    SupabaseNotebookRepository,
    get_notebook_repository,
)

logger = logging.getLogger("inferxe.notebook_proxy")
router = APIRouter(include_in_schema=False)

HOP_BY_HOP = frozenset({"connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer",
                        "transfer-encoding", "upgrade", "host", "content-length"})
MAX_LOGIN_BODY = 8 * 1024
MAX_PROXY_BODY = 256 * 1024 * 1024  # JupyterLab uploads large files in chunks well below this
BODY_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})


class ProxyContext:
    def __init__(self, notebooks, deployments, config: Optional[AccessConfig], http_transport=None,
                 ws_connect: Callable = websocket_connect, resolve_upstream: Callable = jupyter_base_url):
        self.notebooks = notebooks
        self.deployments = deployments
        self.config = config
        self.http_transport = http_transport
        self.ws_connect = ws_connect
        self.resolve_upstream = resolve_upstream


def get_proxy_context(
    notebooks: SupabaseNotebookRepository = Depends(get_notebook_repository),
    deployments: SupabaseDeploymentRepository = Depends(get_deployment_repository),
) -> ProxyContext:
    return ProxyContext(notebooks, deployments, load_access_config())


# ── helpers ────────────────────────────────────────────────────────────────────────────────────────────

def _clean_id(notebook_id: str) -> Optional[str]:
    try:
        return str(uuid.UUID(notebook_id))
    except (ValueError, AttributeError):
        return None


def _lookup(ctx: ProxyContext, notebook_id: Optional[str]) -> Optional[Tuple[SupabaseNotebookRecord, str]]:
    """GPU notebook that can be accessed, with its token hash; None hides whether it exists."""
    if notebook_id is None:
        return None
    try:
        found = ctx.notebooks.get_notebook_with_token_hash(notebook_id)
    except NotebookValidationError:
        return None
    if found is None or found[0].deployment_id is None or found[0].status == "terminated":
        return None
    return found


def _session_valid(config: AccessConfig, notebook_id: str, token_hash: str, cookie: Optional[str]) -> bool:
    claims = verify(config, "session", cookie)
    return bool(claims) and claims.get("nb") == notebook_id and hmac.compare_digest(
        str(claims.get("fp", "")), token_fingerprint(config, token_hash))


def _upstream(ctx: ProxyContext, record: SupabaseNotebookRecord) -> Optional[str]:
    row = ctx.deployments.get(record.user_id, str(record.deployment_id))
    if not row or row.get("status") != "running":
        return None
    return ctx.resolve_upstream(row)


def _page(title: str, body: str, status: int, script: Optional[str] = None) -> HTMLResponse:
    nonce = secrets.token_urlsafe(16)
    csp = "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"
    if script:
        csp += f"; script-src 'nonce-{nonce}'"
    doc = (
        "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">"
        "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">"
        f"<title>{html.escape(title)}</title><style>body{{font-family:system-ui,sans-serif;max-width:28rem;"
        "margin:4rem auto;padding:0 1rem;color:#1f2937}input,button{font:inherit;padding:.5rem;margin:.25rem 0;"
        "width:100%;box-sizing:border-box}</style></head><body>"
        f"<h1>{html.escape(title)}</h1>{body}"
        + (f"<script nonce=\"{nonce}\">{script}</script>" if script else "")
        + "</body></html>"
    )
    return HTMLResponse(doc, status_code=status, headers={
        "Content-Security-Policy": csp, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
    })


_TOKEN_FORM = (
    "<form method=\"post\" action=\"login\"><label>Notebook token<input type=\"password\" name=\"token\" "
    "autocomplete=\"off\" required></label><button type=\"submit\">Open notebook</button></form>"
    "<p>Use <strong>Open</strong> in the Inferxe console, or reset the notebook token there if you lost it.</p>"
)
_ENTER_SCRIPT = (
    "var m=location.hash.match(/^#ticket=([A-Za-z0-9_.-]{20,2048})$/);"
    "history.replaceState(null,'',location.pathname);"
    "if(m){var f=document.getElementById('ticket-form');f.ticket.value=m[1];f.submit();}"
)


def _not_configured() -> HTMLResponse:
    return _page("Notebook access unavailable", "<p>Notebook access is not configured on this server.</p>", 503)


def _not_found() -> HTMLResponse:
    return _page("Notebook not found", "<p>This notebook does not exist or is no longer available.</p>", 404)


def _login_failed() -> HTMLResponse:
    return _page("Sign in to your notebook",
                 "<p>That link has expired or the token is not valid for this notebook.</p>" + _TOKEN_FORM, 401)


def _forward_headers(request: Request, upstream: str, internal_token: str, public_origin: Optional[str]) -> List[Tuple[str, str]]:
    headers: List[Tuple[str, str]] = []
    for name, value in request.headers.items():
        lower = name.lower()
        if lower in HOP_BY_HOP or lower == "authorization":
            continue
        if lower == "cookie":
            kept = [c for c in value.split(";") if c.split("=", 1)[0].strip() != SESSION_COOKIE]
            if kept:
                headers.append(("cookie", ";".join(kept).strip()))
            continue
        if lower in ("origin", "referer") and public_origin and value.startswith(public_origin):
            value = upstream + value[len(public_origin):]  # JupyterLab compares these with its own Host
        headers.append((name, value))
    headers.append(("authorization", f"token {internal_token}"))
    return headers


def _response_headers(resp: httpx2.Response, upstream: str) -> List[Tuple[bytes, bytes]]:
    out = []
    for name, value in resp.headers.multi_items():
        lower = name.lower()
        if lower in HOP_BY_HOP and lower != "content-length":
            continue
        if lower == "location" and value.startswith(upstream):
            value = value[len(upstream):] or "/"  # never reveal the provider address
        out.append((lower.encode("latin-1"), value.encode("latin-1")))
    return out


# ── entry and login ────────────────────────────────────────────────────────────────────────────────────

@router.get("/nb/{notebook_id}")
def notebook_root(notebook_id: str):
    clean = _clean_id(notebook_id)
    return RedirectResponse(notebook_path(clean), status_code=307) if clean else _not_found()


@router.get("/nb/{notebook_id}/_inferxe/enter")
def enter_page(notebook_id: str):
    if _clean_id(notebook_id) is None:
        return _not_found()
    body = ("<form id=\"ticket-form\" method=\"post\" action=\"login\"><input type=\"hidden\" name=\"ticket\"></form>"
            + _TOKEN_FORM)
    return _page("Sign in to your notebook", body, 200, script=_ENTER_SCRIPT)


@router.post("/nb/{notebook_id}/_inferxe/login")
async def login(notebook_id: str, request: Request, ctx: ProxyContext = Depends(get_proxy_context)):
    config = ctx.config
    if config is None or not config.base_url:
        return _not_configured()
    origin = request.headers.get("origin")
    if origin and origin != config.base_url:  # login CSRF: only our own pages may post here
        return _page("Forbidden", "<p>Cross-site sign-in is not allowed.</p>", 403)
    body = await request.body()
    if len(body) > MAX_LOGIN_BODY:
        return _login_failed()
    form = urllib.parse.parse_qs(body.decode("utf-8", "replace"), max_num_fields=4)
    ticket = (form.get("ticket") or [""])[0]
    token = (form.get("token") or [""])[0]

    clean = _clean_id(notebook_id)
    found = _lookup(ctx, clean)
    if found is None:
        return _login_failed()
    record, token_hash = found

    method = None
    if ticket:
        claims = verify(config, "ticket", ticket)
        if (claims and claims.get("nb") == clean and claims.get("uid") == record.user_id
                and hmac.compare_digest(str(claims.get("fp", "")), token_fingerprint(config, token_hash))
                and used_tickets.claim(str(claims.get("n")), float(claims["exp"]))):
            method = "ticket"
    elif token:
        if hmac.compare_digest(hashlib.sha256(token.encode("utf-8")).hexdigest(), token_hash):
            method = "token"
    if method is None:
        logger.warning("Notebook proxy sign-in rejected: id=%s", clean)
        return _login_failed()

    logger.info("Notebook proxy session opened: id=%s method=%s", clean, method)
    response = RedirectResponse(f"{notebook_path(clean)}lab", status_code=303)
    response.set_cookie(SESSION_COOKIE, new_session(config, clean, token_hash), max_age=SESSION_TTL_SECONDS,
                        path=notebook_path(clean), httponly=True, secure=config.secure_cookies, samesite="lax")
    response.headers["Cache-Control"] = "no-store"
    return response


# ── HTTP proxy ─────────────────────────────────────────────────────────────────────────────────────────

@router.api_route("/nb/{notebook_id}/{path:path}", methods=["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"])
async def proxy_http(notebook_id: str, path: str, request: Request, ctx: ProxyContext = Depends(get_proxy_context)):
    config = ctx.config
    if config is None or not config.base_url:
        return _not_configured()
    clean = _clean_id(notebook_id)
    found = _lookup(ctx, clean)
    if found is None:
        return _not_found()
    record, token_hash = found
    if not _session_valid(config, clean, token_hash, request.cookies.get(SESSION_COOKIE)):
        if request.method == "GET":
            return RedirectResponse(f"{notebook_path(clean)}_inferxe/enter", status_code=303)
        return JSONResponse({"message": "Notebook session required."}, status_code=401)

    upstream = _upstream(ctx, record)
    if upstream is None:
        return _page("Notebook not running", "<p>The notebook is not running. Start it from the Inferxe console.</p>", 503)

    body = None
    if request.method in BODY_METHODS:
        declared = request.headers.get("content-length")
        if declared and declared.isdigit() and int(declared) > MAX_PROXY_BODY:
            return JSONResponse({"message": "Request body too large."}, status_code=413)
        body = await request.body()

    url = upstream + request.url.path + (f"?{request.url.query}" if request.url.query else "")
    client = httpx2.AsyncClient(transport=ctx.http_transport, follow_redirects=False,
                                timeout=httpx2.Timeout(300.0, connect=10.0))
    upstream_request = client.build_request(
        request.method, url, content=body,
        headers=_forward_headers(request, upstream, internal_jupyter_token(config, record.deployment_id), config.base_url))
    try:
        resp = await client.send(upstream_request, stream=True)
    except httpx2.HTTPError as err:
        await client.aclose()
        logger.warning("Notebook proxy upstream error: id=%s (%s)", clean, type(err).__name__)
        return _page("Notebook unreachable", "<p>JupyterLab did not respond. Try again in a moment.</p>", 502)

    async def close():
        await resp.aclose()
        await client.aclose()

    response = StreamingResponse(resp.aiter_raw(), status_code=resp.status_code, background=BackgroundTask(close))
    response.raw_headers = _response_headers(resp, upstream)
    return response


# ── WebSocket proxy ────────────────────────────────────────────────────────────────────────────────────

@router.websocket("/nb/{notebook_id}/{path:path}")
async def proxy_websocket(websocket: WebSocket, notebook_id: str, path: str,
                          ctx: ProxyContext = Depends(get_proxy_context)):
    config = ctx.config
    clean = _clean_id(notebook_id)
    found = _lookup(ctx, clean) if config is not None and config.base_url else None
    if (found is None or websocket.headers.get("origin") != config.base_url
            or not _session_valid(config, clean, found[1], websocket.cookies.get(SESSION_COOKIE))):
        await websocket.close(code=1008)
        return
    record, _token_hash = found
    upstream = _upstream(ctx, record)
    if upstream is None:
        await websocket.close(code=1011)
        return

    ws_url = "ws" + upstream[len("http"):] + websocket.url.path + (f"?{websocket.url.query}" if websocket.url.query else "")
    subprotocols = list(websocket.scope.get("subprotocols") or [])
    try:
        async with ctx.ws_connect(
            ws_url,
            additional_headers={"Authorization": f"token {internal_jupyter_token(config, record.deployment_id)}"},
            origin=upstream, subprotocols=subprotocols or None, max_size=None, open_timeout=10,
        ) as upstream_ws:
            await websocket.accept(subprotocol=upstream_ws.subprotocol)
            await _pump(websocket, upstream_ws)
    except Exception as err:  # handshake refused, connection lost, timeouts
        logger.warning("Notebook proxy WebSocket ended: id=%s (%s)", clean, type(err).__name__)
        try:
            await websocket.close(code=1011)
        except RuntimeError:
            pass  # already closed


async def _pump(client: WebSocket, upstream: Any) -> None:
    async def client_to_upstream():
        while True:
            message = await client.receive()
            if message["type"] == "websocket.disconnect":
                return
            if message.get("text") is not None:
                await upstream.send(message["text"])
            elif message.get("bytes") is not None:
                await upstream.send(message["bytes"])

    async def upstream_to_client():
        async for message in upstream:
            if isinstance(message, str):
                await client.send_text(message)
            else:
                await client.send_bytes(message)

    tasks = [asyncio.create_task(client_to_upstream()), asyncio.create_task(upstream_to_client())]
    done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
    for task in pending:
        task.cancel()
    for task in done:
        task.exception()  # retrieved so a closed peer does not log "exception never retrieved"
    await upstream.close()
    try:
        await client.close()
    except RuntimeError:
        pass
