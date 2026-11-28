"""
Phase 4 notebook integration: token rotation, access tickets, the /nb/<id>/ HTTP + WebSocket proxy, public URL
generation and secret-leak prevention.

What these tests prove: Inferxe's authentication, ownership checks and proxying logic, including one test with a
real loopback HTTP + WebSocket upstream. What they cannot prove: a real JupyterLab behind a real GPU provider, TLS
on the deployed origin, or provider-side port firewalling. The upstream here is a stand-in server, not JupyterLab.
"""

import asyncio
import contextlib
import hashlib
import json
import logging
import os
import sys
import threading
import time
import unittest
import uuid
from pathlib import Path
from unittest.mock import patch

os.environ["INFERXE_TEST_MODE"] = "1"
os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")
BACKEND_DIR = Path(__file__).resolve().parents[2]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import httpx2  # noqa: E402
from starlette.websockets import WebSocketDisconnect  # noqa: E402
# Not uvicorn: importing an ASGI server module switches test-mode auth off for the whole process (inference.auth).
from websockets.asyncio.server import serve as websocket_serve  # noqa: E402

from inference import notebook_service  # noqa: E402
from inference.main import app  # noqa: E402
from inference.notebook_access import (  # noqa: E402
    SESSION_COOKIE,
    TICKET_TTL_SECONDS,
    UsedTickets,
    internal_jupyter_token,
    load_access_config,
    new_session,
    new_ticket,
    verify,
)
from inference.notebook_proxy import ProxyContext, get_proxy_context  # noqa: E402
from inference.notebook_service import jupyter_base_url, serialize_notebook  # noqa: E402
from inference.tests.test_notebook_gpu_provisioning import (  # noqa: E402
    TEST_PROXY_BASE_URL,
    TEST_PROXY_SECRET,
    NotebookGpuTestCase,
)

PUBLIC_IP = "8.8.8.8"  # global address so the SSRF guard allows it; never contacted (transports are faked)
UPSTREAM = f"http://{PUBLIC_IP}:40000"


class TestAccessConfig(unittest.TestCase):
    def test_secret_is_required_and_must_be_long(self):
        self.assertIsNone(load_access_config({}))
        self.assertIsNone(load_access_config({"NOTEBOOK_PROXY_SECRET": "short"}))
        self.assertIsNotNone(load_access_config({"NOTEBOOK_PROXY_SECRET": TEST_PROXY_SECRET}))

    def test_base_url_must_be_https_origin_or_local_http(self):
        def base(url):
            return load_access_config({"NOTEBOOK_PROXY_SECRET": TEST_PROXY_SECRET, "NOTEBOOK_PROXY_BASE_URL": url}).base_url
        self.assertEqual(base("https://inferxe-backend.onrender.com/"), "https://inferxe-backend.onrender.com")
        self.assertEqual(base("https://notebooks.example.com"), "https://notebooks.example.com")
        self.assertEqual(base("http://localhost:10000"), "http://localhost:10000")
        for bad in ("http://notebooks.example.com", "https://example.com/prefix", "https://example.com?x=1",
                    "ftp://example.com", "https://user@example.com", "not a url", ""):
            self.assertIsNone(base(bad), bad)

    def test_signed_values_reject_tampering_purpose_swaps_and_expiry(self):
        config = load_access_config({"NOTEBOOK_PROXY_SECRET": TEST_PROXY_SECRET})
        other = load_access_config({"NOTEBOOK_PROXY_SECRET": TEST_PROXY_SECRET + "-other"})
        session = new_session(config, "nb", "a" * 64)
        self.assertEqual(verify(config, "session", session)["nb"], "nb")
        self.assertIsNone(verify(config, "ticket", session))  # a session is not a ticket
        self.assertIsNone(verify(other, "session", session))  # another secret
        self.assertIsNone(verify(config, "session", session[:-2] + "xx"))
        self.assertIsNone(verify(config, "session", session, now=time.time() + 9 * 3600))
        ticket = new_ticket(config, "nb", "alice", "a" * 64)
        self.assertIsNone(verify(config, "ticket", ticket, now=time.time() + TICKET_TTL_SECONDS + 1))

    def test_tickets_are_single_use(self):
        used = UsedTickets()
        self.assertTrue(used.claim("n1", time.time() + 60))
        self.assertFalse(used.claim("n1", time.time() + 60))
        self.assertTrue(used.claim("n2", time.time() + 60))


class AccessTestCase(NotebookGpuTestCase):
    """A GPU notebook on the mock provider, made reachable at a public address with JupyterLab 'ready'."""

    def setUp(self):
        super().setUp()
        resp = self.create()
        self.assertEqual(resp.status_code, 201, resp.text)
        self.body = resp.json()
        self.nb_id = self.body["id"]
        self.token = self.body["access_token"]
        self.deployment_id = self.body["deployment_id"]
        instance_id = self.deployments.rows[self.deployment_id]["provider_instance_id"]
        handle = self.mock_provider._instances[instance_id]
        self.mock_provider._instances[instance_id] = handle.model_copy(update={"host_ip": PUBLIC_IP})
        probe = patch.object(notebook_service, "probe_jupyter", lambda url, **kw: True)
        probe.start()
        self.addCleanup(probe.stop)
        self.config = load_access_config()
        self.internal = internal_jupyter_token(self.config, self.deployment_id)
        self.upstream_requests = []
        self.upstream_handler = self.default_upstream
        self.ws_calls = []
        app.dependency_overrides[get_proxy_context] = lambda: ProxyContext(
            self.notebooks, self.deployments, load_access_config(),
            http_transport=httpx2.MockTransport(lambda req: self.upstream_handler(req)),
            ws_connect=self.fake_ws_connect, resolve_upstream=jupyter_base_url)

    def default_upstream(self, request):
        self.upstream_requests.append(request)
        return upstream_response(200, json.dumps({"path": request.url.path}).encode(),
                                 {"x-upstream": "1", "content-type": "application/json"})

    def make_ready(self):
        self.assertEqual(self.client.get(f"/api/v1/notebooks/{self.nb_id}", headers=self.alice).json()["status"], "running")

    def ticket_url(self, headers=None):
        return self.client.post(f"/api/v1/notebooks/{self.nb_id}/access", headers=headers or self.alice)

    def login(self, ticket=None, token=None, origin=TEST_PROXY_BASE_URL, nb_id=None):
        data = {"ticket": ticket} if ticket else {"token": token}
        headers = {"Origin": origin} if origin else {}
        return self.client.post(f"/nb/{nb_id or self.nb_id}/_inferxe/login", data=data, headers=headers,
                                follow_redirects=False)

    def open_session(self):
        self.make_ready()
        url = self.ticket_url().json()["url"]
        resp = self.login(ticket=url.split("#ticket=", 1)[1])
        self.assertEqual(resp.status_code, 303, resp.text)
        return resp.cookies[SESSION_COOKIE]

    @contextlib.asynccontextmanager
    async def fake_ws_connect(self, url, **kwargs):
        self.ws_calls.append((url, kwargs))
        yield FakeUpstreamSocket()


def upstream_response(status, body=b"", headers=None):
    # A streamed body, as a real network response has (a mock built with json= arrives already read).
    return httpx2.Response(status, stream=httpx2.ByteStream(body), headers=headers or {})


class FakeUpstreamSocket:
    subprotocol = "v1.kernel.websocket.jupyter.org"

    def __init__(self):
        self.queue = asyncio.Queue()

    async def send(self, message):
        await self.queue.put(f"echo:{message}" if isinstance(message, str) else b"echo:" + message)

    def __aiter__(self):
        return self

    async def __anext__(self):
        message = await self.queue.get()
        if message == "echo:close":
            raise StopAsyncIteration
        return message

    async def close(self):
        pass


class TestTokenRotation(AccessTestCase):
    def test_rotation_returns_new_token_once_and_invalidates_the_old_one(self):
        resp = self.client.post(f"/api/v1/notebooks/{self.nb_id}/token", headers=self.alice)
        self.assertEqual(resp.status_code, 200, resp.text)
        self.assertEqual(resp.headers["cache-control"], "no-store")
        new_token = resp.json()["access_token"]
        self.assertNotEqual(new_token, self.token)
        self.assertEqual(self.notebooks.token_hashes[self.nb_id], hashlib.sha256(new_token.encode()).hexdigest())

        self.assertEqual(self.login(token=self.token).status_code, 401)
        self.assertEqual(self.login(token=new_token).status_code, 303)
        # one-time disclosure: no other endpoint returns a token
        for text in (self.client.get(f"/api/v1/notebooks/{self.nb_id}", headers=self.alice).text,
                     self.client.get("/api/v1/notebooks", headers=self.alice).text):
            self.assertNotIn(new_token, text)
            self.assertNotIn(self.token, text)

    def test_rotation_requires_ownership_and_a_live_gpu_notebook(self):
        self.assertEqual(self.client.post(f"/api/v1/notebooks/{self.nb_id}/token", headers=self.bob).status_code, 404)
        self.assertEqual(self.client.post("/api/v1/notebooks/not-a-uuid/token", headers=self.alice).status_code, 400)
        self.assertEqual(self.client.post(f"/api/v1/notebooks/{self.nb_id}/token").status_code, 401)
        simulated = self.client.post("/api/v1/notebooks", headers=self.alice, json={"name": "sim"}).json()
        self.assertEqual(self.client.post(f"/api/v1/notebooks/{simulated['id']}/token", headers=self.alice).status_code, 409)
        self.client.delete(f"/api/v1/notebooks/{self.nb_id}", headers=self.alice)
        self.assertEqual(self.client.post(f"/api/v1/notebooks/{self.nb_id}/token", headers=self.alice).status_code, 409)

    def test_rotation_ends_existing_proxy_sessions(self):
        cookie = self.open_session()
        self.client.post(f"/api/v1/notebooks/{self.nb_id}/token", headers=self.alice)
        resp = self.client.get(f"/nb/{self.nb_id}/lab", cookies={SESSION_COOKIE: cookie}, follow_redirects=False)
        self.assertEqual(resp.status_code, 303)
        self.assertTrue(resp.headers["location"].endswith("/_inferxe/enter"))


class TestAccessEndpoint(AccessTestCase):
    def test_returns_single_use_link_only_when_ready(self):
        self.assertEqual(self.ticket_url().status_code, 200)  # probe patched ready, status refreshed first
        resp = self.ticket_url()
        url = resp.json()["url"]
        self.assertTrue(url.startswith(f"{TEST_PROXY_BASE_URL}/nb/{self.nb_id}/_inferxe/enter#ticket="))
        self.assertEqual(resp.headers["cache-control"], "no-store")
        self.assertNotIn(PUBLIC_IP, url)

    def test_not_ready_notebook_is_refused(self):
        with patch.object(notebook_service, "probe_jupyter", lambda url, **kw: False):
            resp = self.ticket_url()
        self.assertEqual(resp.status_code, 409)
        self.assertIn("starting", resp.json()["detail"])

    def test_owner_only(self):
        self.assertEqual(self.ticket_url(headers=self.bob).status_code, 404)
        self.assertEqual(self.client.post(f"/api/v1/notebooks/{self.nb_id}/access").status_code, 401)

    def test_unconfigured_public_url_is_refused(self):
        with patch.dict(os.environ, {"NOTEBOOK_PROXY_BASE_URL": ""}):
            self.assertEqual(self.ticket_url().status_code, 503)


class TestProxyLogin(AccessTestCase):
    def ticket(self):
        self.make_ready()
        return self.ticket_url().json()["url"].split("#ticket=", 1)[1]

    def test_ticket_login_sets_a_scoped_secure_session_cookie(self):
        resp = self.login(ticket=self.ticket())
        self.assertEqual(resp.status_code, 303)
        self.assertEqual(resp.headers["location"], f"/nb/{self.nb_id}/lab")
        cookie = resp.headers["set-cookie"]
        for part in (f"{SESSION_COOKIE}=", f"Path=/nb/{self.nb_id}/", "HttpOnly", "Secure", "SameSite=lax"):
            self.assertIn(part, cookie)

    def test_tickets_are_single_use_and_bound_to_the_notebook(self):
        ticket = self.ticket()
        self.assertEqual(self.login(ticket=ticket).status_code, 303)
        self.assertEqual(self.login(ticket=ticket).status_code, 401)
        other = self.create(key="nb-key-0002").json()
        self.assertEqual(self.login(ticket=self.ticket(), nb_id=other["id"]).status_code, 401)

    def test_ticket_issued_before_rotation_is_rejected(self):
        ticket = self.ticket()
        self.client.post(f"/api/v1/notebooks/{self.nb_id}/token", headers=self.alice)
        self.assertEqual(self.login(ticket=ticket).status_code, 401)

    def test_expired_or_forged_tickets_are_rejected(self):
        found = self.notebooks.get_notebook_with_token_hash(self.nb_id)
        expired = new_ticket(self.config, self.nb_id, "alice", found[1], now=time.time() - 120)
        self.assertEqual(self.login(ticket=expired).status_code, 401)
        self.assertEqual(self.login(ticket=self.ticket() + "x").status_code, 401)
        bobs = new_ticket(self.config, self.nb_id, "bob", found[1])  # signed, but for another user
        self.assertEqual(self.login(ticket=bobs).status_code, 401)

    def test_token_login_and_wrong_tokens(self):
        self.assertEqual(self.login(token=self.token).status_code, 303)
        self.assertEqual(self.login(token="ixnb_" + "0" * 48).status_code, 401)
        other = self.create(key="nb-key-0002", headers=self.bob).json()
        self.assertEqual(self.login(token=self.token, nb_id=other["id"]).status_code, 401)  # cross-tenant

    def test_cross_site_login_is_refused(self):
        self.assertEqual(self.login(token=self.token, origin="https://evil.example").status_code, 403)

    def test_unknown_or_simulated_notebooks_look_the_same(self):
        simulated = self.client.post("/api/v1/notebooks", headers=self.alice, json={"name": "sim"}).json()
        for nb_id in (str(uuid.uuid4()), simulated["id"]):
            self.assertEqual(self.login(token=self.token, nb_id=nb_id).status_code, 401)

    def test_enter_page_keeps_ticket_out_of_urls_and_logs(self):
        page = self.client.get(f"/nb/{self.nb_id}/_inferxe/enter")
        self.assertEqual(page.status_code, 200)
        self.assertIn("location.hash", page.text)
        self.assertIn("history.replaceState", page.text)
        self.assertIn("script-src 'nonce-", page.headers["content-security-policy"])
        self.assertEqual(page.headers["referrer-policy"], "no-referrer")


class TestHttpProxy(AccessTestCase):
    def get(self, path, cookie=None, **kwargs):
        cookies = {SESSION_COOKIE: cookie} if cookie else {}
        return self.client.get(f"/nb/{self.nb_id}/{path}", cookies=cookies, follow_redirects=False, **kwargs)

    def test_requires_a_session(self):
        resp = self.get("lab")
        self.assertEqual(resp.status_code, 303)
        self.assertEqual(resp.headers["location"], f"/nb/{self.nb_id}/_inferxe/enter")
        self.assertEqual(self.client.post(f"/nb/{self.nb_id}/api/contents", follow_redirects=False).status_code, 401)
        self.assertEqual(self.upstream_requests, [])  # nothing reached JupyterLab

    def test_forwards_with_internal_token_and_strips_customer_credentials(self):
        cookie = self.open_session()
        resp = self.client.get(
            f"/nb/{self.nb_id}/api/contents?type=directory",
            cookies={SESSION_COOKIE: cookie, "_xsrf": "abc"},
            headers={"Authorization": "Bearer customer-cognito-jwt", "Origin": TEST_PROXY_BASE_URL},
        )
        self.assertEqual(resp.status_code, 200, resp.text)
        self.assertEqual(resp.headers["x-upstream"], "1")
        sent = self.upstream_requests[-1]
        self.assertEqual(str(sent.url), f"{UPSTREAM}/nb/{self.nb_id}/api/contents?type=directory")
        self.assertEqual(sent.headers["authorization"], f"token {self.internal}")
        self.assertNotIn(SESSION_COOKIE, sent.headers.get("cookie", ""))
        self.assertIn("_xsrf=abc", sent.headers["cookie"])
        self.assertEqual(sent.headers["origin"], UPSTREAM)  # JupyterLab compares Origin with its own Host

    def test_forwards_request_bodies_and_rewrites_provider_redirects(self):
        cookie = self.open_session()

        def upstream(request):
            self.upstream_requests.append(request)
            return upstream_response(302, headers={"location": f"{UPSTREAM}/nb/{self.nb_id}/lab/tree"})
        self.upstream_handler = upstream
        resp = self.client.put(f"/nb/{self.nb_id}/api/contents/a.ipynb", content=b'{"type":"notebook"}',
                               cookies={SESSION_COOKIE: cookie}, follow_redirects=False)
        self.assertEqual(self.upstream_requests[-1].content, b'{"type":"notebook"}')
        self.assertEqual(resp.headers["location"], f"/nb/{self.nb_id}/lab/tree")  # provider address hidden

    def test_session_for_one_notebook_does_not_open_another(self):
        cookie = self.open_session()
        other = self.create(key="nb-key-0002").json()
        resp = self.client.get(f"/nb/{other['id']}/lab", cookies={SESSION_COOKIE: cookie}, follow_redirects=False)
        self.assertEqual(resp.status_code, 303)
        forged = new_session(load_access_config({"NOTEBOOK_PROXY_SECRET": "x" * 40}), self.nb_id, "a" * 64)
        self.assertEqual(self.get("lab", cookie=forged).status_code, 303)

    def test_stopped_or_unreachable_notebooks(self):
        cookie = self.open_session()

        def refuse(request):
            raise httpx2.ConnectError("refused", request=request)
        self.upstream_handler = refuse
        self.assertEqual(self.get("lab", cookie=cookie).status_code, 502)
        self.deployments.rows[self.deployment_id]["status"] = "stopped"
        self.assertEqual(self.get("lab", cookie=cookie).status_code, 503)

    def test_terminated_notebook_is_gone(self):
        cookie = self.open_session()
        self.client.delete(f"/api/v1/notebooks/{self.nb_id}", headers=self.alice)
        self.assertEqual(self.get("lab", cookie=cookie).status_code, 404)

    def test_private_provider_addresses_are_never_proxied(self):
        cookie = self.open_session()
        self.deployments.rows[self.deployment_id]["ssh_host"] = "10.0.0.5"
        self.assertEqual(self.get("lab", cookie=cookie).status_code, 503)
        self.assertEqual(self.upstream_requests, [])


class TestWebSocketProxy(AccessTestCase):
    path = "api/kernels/k1/channels?session_id=s1"

    def connect(self, cookie=None, origin=TEST_PROXY_BASE_URL):
        headers = {"Origin": origin} if origin else {}
        if cookie:
            headers["Cookie"] = f"{SESSION_COOKIE}={cookie}"
        return self.client.websocket_connect(f"/nb/{self.nb_id}/{self.path}", headers=headers,
                                             subprotocols=["v1.kernel.websocket.jupyter.org"])

    def test_relays_messages_with_internal_token(self):
        cookie = self.open_session()
        with self.connect(cookie) as ws:
            self.assertEqual(ws.accepted_subprotocol, "v1.kernel.websocket.jupyter.org")
            ws.send_text("hello")
            self.assertEqual(ws.receive_text(), "echo:hello")
            ws.send_bytes(b"\x01\x02")
            self.assertEqual(ws.receive_bytes(), b"echo:\x01\x02")
        url, kwargs = self.ws_calls[0]
        self.assertEqual(url, f"ws://{PUBLIC_IP}:40000/nb/{self.nb_id}/api/kernels/k1/channels?session_id=s1")
        self.assertEqual(kwargs["additional_headers"], {"Authorization": f"token {self.internal}"})
        self.assertEqual(kwargs["origin"], UPSTREAM)

    def test_rejects_missing_session_and_cross_site_origins(self):
        cookie = self.open_session()
        for kwargs in ({"cookie": None}, {"cookie": cookie, "origin": "https://evil.example"}, {"cookie": cookie, "origin": None}):
            with self.assertRaises(WebSocketDisconnect):
                with self.connect(**kwargs):
                    pass
        self.assertEqual(self.ws_calls, [])


class TestUrlGeneration(AccessTestCase):
    def test_url_only_for_ready_notebooks_with_a_public_base(self):
        self.assertEqual(self.notebooks.rows[self.nb_id].status, "starting")
        self.assertIsNone(serialize_notebook(self.notebooks.rows[self.nb_id]).jupyter_url)
        ready = self.client.get(f"/api/v1/notebooks/{self.nb_id}", headers=self.alice).json()
        self.assertEqual(ready["jupyter_url"], f"{TEST_PROXY_BASE_URL}/nb/{self.nb_id}/lab")
        self.assertIsNone(ready["ssh_command"])
        for leaked in (PUBLIC_IP, "40000", self.token, self.internal, "token="):
            self.assertNotIn(leaked, ready["jupyter_url"])
        with patch.dict(os.environ, {"NOTEBOOK_PROXY_BASE_URL": ""}):
            self.assertIsNone(serialize_notebook(self.notebooks.rows[self.nb_id]).jupyter_url)

    def test_internal_provider_address_comes_from_port_mappings(self):
        row = self.deployments.rows[self.deployment_id]
        self.assertEqual(row["metadata"]["port_mappings"], {"8888": 40000})
        self.make_ready()
        self.assertEqual(jupyter_base_url(self.deployments.rows[self.deployment_id]), UPSTREAM)


class TestNoSecretLeaks(AccessTestCase):
    def test_tokens_tickets_and_internal_token_never_reach_logs(self):
        with self.assertLogs(level=logging.DEBUG) as logs:
            logging.getLogger("inferxe").debug("capture start")
            self.make_ready()
            url = self.ticket_url().json()["url"]
            ticket = url.split("#ticket=", 1)[1]
            self.login(ticket=ticket)
            self.login(ticket=ticket)  # rejected replay
            self.login(token="ixnb_wrong")
            rotated = self.client.post(f"/api/v1/notebooks/{self.nb_id}/token", headers=self.alice).json()["access_token"]
        output = "\n".join(logs.output)
        for secret in (self.token, rotated, ticket, self.internal, TEST_PROXY_SECRET):
            self.assertNotIn(secret, output)

    def test_creation_without_proxy_secret_refuses_before_launching(self):
        with patch.dict(os.environ, {"NOTEBOOK_PROXY_SECRET": ""}):
            resp = self.create(key="nb-key-0099")
        self.assertEqual(resp.status_code, 503)
        self.assertEqual(len(self.deployments.rows), 1)  # only the setUp notebook's GPU


def _respond(connection, status, body, headers=()):
    response = connection.respond(status, body)
    for name, value in headers:
        if name in response.headers:
            del response.headers[name]
        response.headers[name] = value
    return response


class TestRealLoopbackUpstream(AccessTestCase):
    """Real sockets end to end: proxy -> a stand-in server on 127.0.0.1 that, like JupyterLab, refuses requests
    without the internal token. Proves the HTTP and WebSocket plumbing, not JupyterLab itself."""

    def setUp(self):
        super().setUp()
        expected = f"token {self.internal}"
        nb = self.nb_id
        state = {}
        ready = threading.Event()

        def process_request(connection, request):
            authorized = request.headers.get("Authorization") == expected
            if request.headers.get("Upgrade", "").lower() == "websocket":
                return None if authorized else _respond(connection, 403, "Forbidden\n")
            if not authorized:
                return _respond(connection, 403, '{"message": "Forbidden"}', [("Content-Type", "application/json")])
            if request.path == f"/nb/{nb}/api":
                body = json.dumps({"version": "stand-in", "cookie": request.headers.get("Cookie", "")})
                return _respond(connection, 200, body, [("Content-Type", "application/json")])
            if request.path == f"/nb/{nb}/lab":
                return _respond(connection, 302, "", [("Location", f"http://127.0.0.1:{state['port']}/nb/{nb}/lab/tree")])
            return _respond(connection, 404, "")

        async def kernel_channel(websocket):
            async for message in websocket:
                await websocket.send(f"kernel:{message}")

        async def main():
            async with websocket_serve(kernel_channel, "127.0.0.1", 0, process_request=process_request) as server:
                state["port"] = server.sockets[0].getsockname()[1]
                state["stop"] = asyncio.Event()
                state["loop"] = asyncio.get_running_loop()
                ready.set()
                await state["stop"].wait()

        thread = threading.Thread(target=lambda: asyncio.run(main()), daemon=True)
        thread.start()
        self.assertTrue(ready.wait(10))
        self.port = state["port"]
        self.addCleanup(lambda: (state["loop"].call_soon_threadsafe(state["stop"].set), thread.join(5)))
        local = f"http://127.0.0.1:{self.port}"
        app.dependency_overrides[get_proxy_context] = lambda: ProxyContext(
            self.notebooks, self.deployments, load_access_config(), resolve_upstream=lambda row: local)

    def test_http_and_websocket_through_real_sockets(self):
        cookie = self.open_session()
        resp = self.client.get(f"/nb/{self.nb_id}/api", cookies={SESSION_COOKIE: cookie})
        self.assertEqual(resp.status_code, 200, resp.text)
        self.assertEqual(resp.json()["version"], "stand-in")
        self.assertNotIn(SESSION_COOKIE, resp.json()["cookie"])

        redirect = self.client.get(f"/nb/{self.nb_id}/lab", cookies={SESSION_COOKIE: cookie}, follow_redirects=False)
        self.assertEqual(redirect.headers["location"], f"/nb/{self.nb_id}/lab/tree")

        headers = {"Origin": TEST_PROXY_BASE_URL, "Cookie": f"{SESSION_COOKIE}={cookie}"}
        with self.client.websocket_connect(f"/nb/{self.nb_id}/api/kernels/k1/channels", headers=headers) as ws:
            ws.send_text("1+1")
            self.assertEqual(ws.receive_text(), "kernel:1+1")

    def test_upstream_refuses_direct_access_without_the_internal_token(self):
        direct = httpx2.get(f"http://127.0.0.1:{self.port}/nb/{self.nb_id}/api", timeout=5)
        self.assertEqual(direct.status_code, 403)  # e.g. someone hitting the raw provider port


if __name__ == "__main__":
    unittest.main()
