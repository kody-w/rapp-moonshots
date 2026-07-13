import http.client
import importlib.util
import io
import json
import os
import threading
import unittest
from contextlib import redirect_stderr
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("adaptive_orb_server", ROOT / "server.py")
SERVER = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(SERVER)


def valid_request():
    return {
        "user_input": "Plan four priorities.",
        "conversation_history": [
            {"role": "user", "content": "Create a calm concept."},
            {"role": "assistant", "content": "The concept is ready."},
        ],
        "session_id": "orb-test-session",
    }


class FakeResponse:
    def __init__(self, payload):
        self.payload = json.dumps(payload).encode("utf-8")

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self, _limit):
        return self.payload


class ValidationTests(unittest.TestCase):
    def test_request_contract_is_exact_and_bounded(self):
        self.assertEqual(SERVER.validate_chat_request(valid_request()), valid_request())
        with self.assertRaises(SERVER.ValidationError):
            SERVER.validate_chat_request({**valid_request(), "api_key": "forbidden"})
        with self.assertRaises(SERVER.ValidationError):
            SERVER.validate_chat_request(
                {**valid_request(), "conversation_history": [{"role": "system", "content": "x"}]}
            )
        with self.assertRaises(SERVER.ValidationError):
            SERVER.validate_chat_request(
                {**valid_request(), "user_input": "x" * (SERVER.MAX_INPUT_CHARS + 1)}
            )
        with self.assertRaises(SERVER.ValidationError):
            SERVER.strict_json_loads(
                b'{"user_input":"one","user_input":"two",'
                b'"conversation_history":[],"session_id":"orb"}'
            )

    def test_upstream_response_is_normalized_and_strict(self):
        normalized = SERVER.normalize_upstream_response(
            {
                "response": "A bounded answer.",
                "scenario": "plan",
                "summary": "Plan ready",
            }
        )
        self.assertEqual(
            normalized,
            {
                "message": "A bounded answer.",
                "provider": "brainstem",
                "scenario": "plan",
                "summary": "Plan ready",
            },
        )
        with self.assertRaises(SERVER.ValidationError):
            SERVER.normalize_upstream_response(
                {"message": "one", "response": "two"}
            )
        with self.assertRaises(SERVER.ValidationError):
            SERVER.normalize_upstream_response(
                {"message": "one", "debug": "not public"}
            )

    def test_upstream_url_defaults_to_loopback_and_rejects_credentials(self):
        with mock.patch.dict(os.environ, {}, clear=True):
            self.assertEqual(
                SERVER.configured_upstream_url(),
                SERVER.DEFAULT_BRAINSTEM_URL,
            )
            self.assertEqual(
                SERVER.configured_allowed_hosts(),
                frozenset({"localhost", "127.0.0.1", "::1"}),
            )
        with mock.patch.dict(
            os.environ,
            {"ADAPTIVE_ORB_ALLOWED_HOSTS": "orb.example.test"},
            clear=True,
        ):
            self.assertIn("orb.example.test", SERVER.configured_allowed_hosts())
        with mock.patch.dict(
            os.environ,
            {"RAPP_BRAINSTEM_URL": "http://user:password@example.test/chat"},
            clear=True,
        ):
            with self.assertRaises(SERVER.ValidationError):
                SERVER.configured_upstream_url()

    def test_proxy_uses_server_secret_without_logging_or_response_leakage(self):
        captured = {}

        def fake_open_upstream(request, timeout):
            captured["request"] = request
            captured["timeout"] = timeout
            return FakeResponse({"message": "Companion response.", "scenario": "create"})

        stderr = io.StringIO()
        with mock.patch.dict(
            os.environ,
            {
                "RAPP_BRAINSTEM_URL": "http://127.0.0.1:7071/chat",
                "RAPP_BRAINSTEM_SECRET": "server-only-secret",
                "RAPP_BRAINSTEM_TIMEOUT": "3",
            },
            clear=True,
        ), mock.patch.object(
            SERVER, "open_upstream", fake_open_upstream
        ), redirect_stderr(stderr):
            result = SERVER.proxy_to_brainstem(valid_request())
        self.assertEqual(result["message"], "Companion response.")
        self.assertEqual(captured["request"].get_header("Authorization"), "Bearer server-only-secret")
        self.assertEqual(captured["timeout"], 3.0)
        self.assertNotIn("server-only-secret", json.dumps(result))
        self.assertNotIn("server-only-secret", stderr.getvalue())


class HandlerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        class TestHandler(SERVER.AdaptiveOrbHandler):
            def __init__(self, *args, **kwargs):
                super().__init__(*args, directory=str(ROOT), **kwargs)

        cls.original_proxy = SERVER.proxy_to_brainstem
        SERVER.proxy_to_brainstem = lambda payload: {
            "message": f"Accepted {len(payload['conversation_history'])} history turns.",
            "provider": "brainstem",
            "scenario": "plan",
        }
        cls.httpd = ThreadingHTTPServer(("127.0.0.1", 0), TestHandler)
        cls.httpd.allowed_hosts = SERVER.configured_allowed_hosts()
        cls.httpd.session_token = SERVER.secrets.token_urlsafe(32)
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()
        cls.port = cls.httpd.server_address[1]

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        cls.thread.join(timeout=2)
        SERVER.proxy_to_brainstem = cls.original_proxy

    def request(self, method, path, body=None, headers=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=3)
        connection.request(method, path, body=body, headers=headers or {})
        response = connection.getresponse()
        payload = response.read()
        result = response.status, dict(response.getheaders()), payload
        connection.close()
        return result

    def authorized_headers(self, extra=None):
        status, headers, raw = self.request(
            "POST",
            "/api/session",
            headers={"Origin": f"http://127.0.0.1:{self.port}"},
        )
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(raw), {"ready": True})
        cookie = headers["Set-Cookie"]
        self.assertIn("HttpOnly", cookie)
        self.assertIn("SameSite=Strict", cookie)
        values = {
            "Origin": f"http://127.0.0.1:{self.port}",
            "Cookie": cookie.split(";", 1)[0],
        }
        values.update(extra or {})
        return values

    def test_valid_same_origin_chat_proxy(self):
        request = {
            **valid_request(),
            "conversation_history": [
                {
                    "role": "user" if index % 2 == 0 else "assistant",
                    "content": f"{index:02d}-" + ("x" * 3997),
                }
                for index in range(15)
            ],
        }
        body = json.dumps(request, separators=(",", ":")).encode("utf-8")
        self.assertLess(len(body), SERVER.BODY_CAP_BYTES)
        self.assertGreater(len(body), 60_000)
        status, headers, raw = self.request(
            "POST",
            "/api/chat",
            body,
            self.authorized_headers(
                {
                    "Content-Type": "application/json",
                    "Content-Length": str(len(body)),
                }
            ),
        )
        self.assertEqual(status, 200)
        self.assertEqual(headers["Cache-Control"], "no-store")
        self.assertIn("connect-src 'self'", headers["Content-Security-Policy"])
        self.assertNotIn("Access-Control-Allow-Origin", headers)
        self.assertEqual(json.loads(raw)["message"], "Accepted 15 history turns.")

    def test_invalid_shape_and_content_type_fail_closed(self):
        invalid = json.dumps({**valid_request(), "secret": "no"}).encode("utf-8")
        status, _, raw = self.request(
            "POST",
            "/api/chat",
            invalid,
            self.authorized_headers(
                {
                    "Content-Type": "application/json",
                    "Content-Length": str(len(invalid)),
                }
            ),
        )
        self.assertEqual(status, 400)
        self.assertEqual(json.loads(raw), {"error": "invalid_request"})
        status, _, _ = self.request(
            "POST",
            "/api/chat",
            b"plain",
            self.authorized_headers(
                {"Content-Type": "text/plain", "Content-Length": "5"}
            ),
        )
        self.assertEqual(status, 415)
        body = json.dumps(valid_request()).encode("utf-8")
        status, _, raw = self.request(
            "POST",
            "/api/chat",
            body,
            {
                "Origin": f"http://127.0.0.1:{self.port}",
                "Content-Type": "application/json",
                "Content-Length": str(len(body)),
            },
        )
        self.assertEqual(status, 403)
        self.assertEqual(json.loads(raw), {"error": "session_required"})
        status, _, raw = self.request(
            "POST",
            "/api/chat",
            body,
            self.authorized_headers(
                {
                    "Origin": "https://attacker.example",
                    "Content-Type": "application/json",
                    "Content-Length": str(len(body)),
                }
            ),
        )
        self.assertEqual(status, 403)
        self.assertEqual(json.loads(raw), {"error": "origin_rejected"})

    def test_body_cap_and_unknown_api_path_fail_closed(self):
        status, _, raw = self.request(
            "POST",
            "/api/chat",
            b"{}",
            self.authorized_headers(
                {
                    "Content-Type": "application/json",
                    "Content-Length": str(SERVER.BODY_CAP_BYTES + 1),
                }
            ),
        )
        self.assertEqual(status, 413)
        self.assertEqual(json.loads(raw), {"error": "body_too_large"})
        status, _, _ = self.request(
            "POST",
            "/api/other",
            b"{}",
            self.authorized_headers(
                {"Content-Type": "application/json", "Content-Length": "2"}
            ),
        )
        self.assertEqual(status, 404)
        status, _, _ = self.request(
            "POST",
            "/api/chat?secret=forbidden",
            b"{}",
            self.authorized_headers(
                {"Content-Type": "application/json", "Content-Length": "2"}
            ),
        )
        self.assertEqual(status, 404)
        status, headers, raw = self.request(
            "POST",
            "/api/chat",
            b"{}",
            {
                "Host": "attacker.example",
                "Origin": "http://attacker.example",
                "Content-Type": "application/json",
                "Content-Length": "2",
            },
        )
        self.assertEqual(status, 421)
        self.assertEqual(json.loads(raw), {"error": "host_rejected"})
        self.assertNotIn("Access-Control-Allow-Origin", headers)

    def test_static_shell_has_security_headers(self):
        status, headers, raw = self.request("GET", "/manifest.webmanifest")
        self.assertEqual(status, 200)
        self.assertEqual(headers["X-Content-Type-Options"], "nosniff")
        self.assertEqual(headers["Referrer-Policy"], "no-referrer")
        self.assertNotIn(b"RAPP_BRAINSTEM_SECRET", raw)
        status, headers, _ = self.request("GET", "/?companion=1")
        self.assertEqual(status, 200)
        self.assertNotIn("Set-Cookie", headers)
        status, headers, raw = self.request(
            "GET",
            "/",
            headers={"Host": "attacker.example", "Origin": "http://attacker.example"},
        )
        self.assertEqual(status, 421)
        self.assertEqual(json.loads(raw), {"error": "host_rejected"})
        self.assertNotIn("Set-Cookie", headers)


if __name__ == "__main__":
    unittest.main()
