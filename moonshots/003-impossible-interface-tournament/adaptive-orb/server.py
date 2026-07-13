#!/usr/bin/env python3
"""Serve Adaptive Orb and optionally proxy its strict Brainstem chat contract."""

from __future__ import annotations

import argparse
import json
import os
import re
import secrets
import socket
import sys
from http.cookies import CookieError, SimpleCookie
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

BODY_CAP_BYTES = 64 * 1024
UPSTREAM_CAP_BYTES = 256 * 1024
DEFAULT_BRAINSTEM_URL = "http://127.0.0.1:7071/chat"
DEFAULT_BIND = "127.0.0.1"
DEFAULT_PORT = 8073
MAX_INPUT_CHARS = 4000
MAX_HISTORY_TURNS = 24
MAX_RESPONSE_CHARS = 12000
SESSION_PATTERN = re.compile(r"^[A-Za-z0-9._:-]{1,128}$")
SCENARIOS = {"create", "plan", "explain", "navigate"}
ALLOWED_REQUEST_KEYS = {"user_input", "conversation_history", "session_id"}
DEFAULT_ALLOWED_HOSTS = frozenset({"localhost", "127.0.0.1", "::1"})
SESSION_COOKIE_NAME = "adaptive_orb_session"
ALLOWED_UPSTREAM_KEYS = {
    "response",
    "message",
    "assistant_response",
    "scenario",
    "summary",
    "suggestions",
    "shape",
}

class NoRedirectHandler(HTTPRedirectHandler):
    def redirect_request(self, *_args: Any, **_kwargs: Any) -> None:
        return None


def open_upstream(request: Request, timeout: float):
    return build_opener(NoRedirectHandler()).open(request, timeout=timeout)


class ValidationError(ValueError):
    """Raised when a public or upstream JSON payload violates the contract."""


def strict_json_loads(raw: bytes) -> Any:
    def unique_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
        result: dict[str, Any] = {}
        for key, value in pairs:
            if key in result:
                raise ValidationError("JSON contains a duplicate key")
            result[key] = value
        return result

    try:
        return json.loads(
            raw.decode("utf-8"),
            object_pairs_hook=unique_object,
        )
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValidationError("payload is not valid JSON") from error


def _bounded_text(value: Any, name: str, limit: int) -> str:
    if not isinstance(value, str):
        raise ValidationError(f"{name} must be text")
    normalized = value.strip()
    if not normalized or len(normalized) > limit:
        raise ValidationError(f"{name} is outside its size limit")
    return normalized


def validate_chat_request(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict) or set(payload) != ALLOWED_REQUEST_KEYS:
        raise ValidationError("request must use the Brainstem contract exactly")
    user_input = _bounded_text(payload["user_input"], "user_input", MAX_INPUT_CHARS)
    session_id = _bounded_text(payload["session_id"], "session_id", 128)
    if not SESSION_PATTERN.fullmatch(session_id):
        raise ValidationError("session_id contains unsupported characters")
    history = payload["conversation_history"]
    if not isinstance(history, list) or len(history) > MAX_HISTORY_TURNS:
        raise ValidationError("conversation_history must be a bounded list")
    normalized_history = []
    for turn in history:
        if (
            not isinstance(turn, dict)
            or set(turn) != {"role", "content"}
            or turn.get("role") not in {"user", "assistant"}
        ):
            raise ValidationError("conversation_history contains an invalid turn")
        normalized_history.append(
            {
                "role": turn["role"],
                "content": _bounded_text(
                    turn["content"], "conversation content", MAX_INPUT_CHARS
                ),
            }
        )
    return {
        "user_input": user_input,
        "conversation_history": normalized_history,
        "session_id": session_id,
    }


def _normalize_suggestion(value: Any, index: int) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValidationError("suggestion must be an object")
    allowed = {
        "id",
        "label",
        "detail",
        "prompt",
        "branch",
        "effect",
        "intentionalWrong",
    }
    if set(value) - allowed:
        raise ValidationError("suggestion contains unsupported fields")
    label = _bounded_text(value.get("label"), "suggestion label", 80)
    prompt = _bounded_text(value.get("prompt"), "suggestion prompt", MAX_INPUT_CHARS)
    raw_id = value.get("id", f"suggestion-{index + 1}")
    if not isinstance(raw_id, str):
        raise ValidationError("suggestion id must be text")
    suggestion_id = re.sub(r"[^A-Za-z0-9_-]", "-", raw_id)[:80]
    if not suggestion_id:
        raise ValidationError("suggestion id is empty")
    normalized = {
        "id": suggestion_id,
        "label": label,
        "detail": str(value.get("detail", "Continue this branch")).strip()[:120],
        "prompt": prompt,
        "branch": re.sub(
            r"[^A-Za-z0-9_-]", "-", str(value.get("branch", suggestion_id))
        )[:80],
    }
    if value.get("effect") == "task-demo":
        normalized["effect"] = "task-demo"
    if value.get("intentionalWrong") is True:
        normalized["intentionalWrong"] = True
    return normalized


def normalize_upstream_response(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict) or set(payload) - ALLOWED_UPSTREAM_KEYS:
        raise ValidationError("upstream response has unsupported fields")
    message_fields = [
        key
        for key in ("message", "response", "assistant_response")
        if payload.get(key) is not None
    ]
    if len(message_fields) != 1:
        raise ValidationError("upstream response must contain one message field")
    message = _bounded_text(
        payload[message_fields[0]], "upstream message", MAX_RESPONSE_CHARS
    )
    result: dict[str, Any] = {
        "message": message,
        "provider": "brainstem",
    }
    scenario = payload.get("scenario")
    if scenario is not None:
        if scenario not in SCENARIOS:
            raise ValidationError("upstream scenario is unsupported")
        result["scenario"] = scenario
    summary = payload.get("summary")
    if summary is not None:
        result["summary"] = _bounded_text(summary, "upstream summary", 180)
    suggestions = payload.get("suggestions")
    if suggestions is not None:
        if not isinstance(suggestions, list) or not 4 <= len(suggestions) <= 8:
            raise ValidationError("upstream suggestions must contain four to eight items")
        result["suggestions"] = [
            _normalize_suggestion(suggestion, index)
            for index, suggestion in enumerate(suggestions)
        ]
    shape = payload.get("shape")
    if shape is not None:
        if (
            not isinstance(shape, dict)
            or set(shape) != {"breadth", "stable", "depth", "hierarchical"}
            or not isinstance(shape.get("breadth"), int)
            or not 1 <= shape["breadth"] <= 8
            or not isinstance(shape.get("depth"), int)
            or not 0 <= shape["depth"] <= 12
            or not isinstance(shape.get("stable"), bool)
            or not isinstance(shape.get("hierarchical"), bool)
        ):
            raise ValidationError("upstream shape is invalid")
        result["shape"] = shape
    return result


def configured_upstream_url() -> str:
    value = os.environ.get("RAPP_BRAINSTEM_URL", DEFAULT_BRAINSTEM_URL).strip()
    parsed = urlsplit(value)
    if (
        parsed.scheme not in {"http", "https"}
        or not parsed.hostname
        or parsed.username
        or parsed.password
        or parsed.fragment
    ):
        raise ValidationError("RAPP_BRAINSTEM_URL is invalid")
    return value


def configured_timeout() -> float:
    try:
        value = float(os.environ.get("RAPP_BRAINSTEM_TIMEOUT", "8"))
    except ValueError as error:
        raise ValidationError("RAPP_BRAINSTEM_TIMEOUT is invalid") from error
    return min(30.0, max(1.0, value))


def _normalize_allowed_host(value: str) -> str:
    candidate = value.strip().lower().rstrip(".")
    if not candidate or any(character.isspace() for character in candidate):
        raise ValidationError("allowed host is invalid")
    if "://" in candidate or any(character in candidate for character in "/?#@,"):
        raise ValidationError("allowed host must be a hostname or address")
    if candidate.startswith("[") and candidate.endswith("]"):
        candidate = candidate[1:-1]
    try:
        parsed = urlsplit(f"//[{candidate}]" if ":" in candidate else f"//{candidate}")
        if not parsed.hostname or parsed.port is not None:
            raise ValidationError("allowed host must not include a port")
    except ValueError as error:
        raise ValidationError("allowed host is invalid") from error
    return parsed.hostname.lower().rstrip(".")


def configured_allowed_hosts(extra_hosts: list[str] | None = None) -> frozenset[str]:
    configured = [
        value
        for value in os.environ.get("ADAPTIVE_ORB_ALLOWED_HOSTS", "").split(",")
        if value.strip()
    ]
    configured.extend(extra_hosts or [])
    return frozenset(
        {
            *DEFAULT_ALLOWED_HOSTS,
            *(_normalize_allowed_host(value) for value in configured),
        }
    )


def parse_authority(value: str) -> tuple[str, int | None]:
    if (
        not value
        or "," in value
        or any(character.isspace() for character in value)
        or any(character in value for character in "/?#@")
    ):
        raise ValidationError("authority is invalid")
    try:
        parsed = urlsplit(f"//{value}")
        hostname = parsed.hostname
        port = parsed.port
    except ValueError as error:
        raise ValidationError("authority is invalid") from error
    if not hostname or parsed.username or parsed.password:
        raise ValidationError("authority is invalid")
    return hostname.lower().rstrip("."), port


def parse_origin(value: str) -> tuple[str, int | None]:
    if not value or value == "null" or "," in value:
        raise ValidationError("origin is invalid")
    try:
        parsed = urlsplit(value)
        port = parsed.port
    except ValueError as error:
        raise ValidationError("origin is invalid") from error
    if (
        parsed.scheme not in {"http", "https"}
        or not parsed.hostname
        or parsed.username
        or parsed.password
        or parsed.path
        or parsed.query
        or parsed.fragment
    ):
        raise ValidationError("origin is invalid")
    return parsed.hostname.lower().rstrip("."), port


def proxy_to_brainstem(payload: dict[str, Any]) -> dict[str, Any]:
    target = configured_upstream_url()
    encoded = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    headers = {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "User-Agent": "AdaptiveOrbCompanion/1.0",
    }
    secret = os.environ.get("RAPP_BRAINSTEM_SECRET")
    if secret:
        headers["Authorization"] = f"Bearer {secret}"
    request = Request(target, data=encoded, headers=headers, method="POST")
    try:
        with open_upstream(request, timeout=configured_timeout()) as response:
            raw = response.read(UPSTREAM_CAP_BYTES + 1)
    except (HTTPError, URLError, TimeoutError, socket.timeout) as error:
        raise ConnectionError("brainstem unavailable") from error
    if len(raw) > UPSTREAM_CAP_BYTES:
        raise ValidationError("upstream response is too large")
    decoded = strict_json_loads(raw)
    return normalize_upstream_response(decoded)


class AdaptiveOrbHandler(SimpleHTTPRequestHandler):
    server_version = "AdaptiveOrbCompanion/1.0"
    sys_version = ""

    def __init__(self, *args: Any, directory: str | None = None, **kwargs: Any):
        root = directory or str(Path(__file__).resolve().parent)
        super().__init__(*args, directory=root, **kwargs)

    def _send_json(self, status: HTTPStatus, payload: dict[str, Any]) -> None:
        encoded = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(encoded)

    def _request_authority(self) -> tuple[str, int | None] | None:
        host_headers = self.headers.get_all("Host", [])
        if len(host_headers) != 1:
            return None
        try:
            hostname, port = parse_authority(host_headers[0])
        except ValidationError:
            return None
        allowed_hosts = getattr(self.server, "allowed_hosts", DEFAULT_ALLOWED_HOSTS)
        if hostname not in allowed_hosts:
            return None
        return hostname, port

    def _origin_is_allowed(
        self,
        authority: tuple[str, int | None],
        *,
        required: bool,
    ) -> bool:
        origin_headers = self.headers.get_all("Origin", [])
        if not origin_headers:
            return not required
        if len(origin_headers) != 1:
            return False
        try:
            origin = parse_origin(origin_headers[0])
        except ValidationError:
            return False
        return origin == authority

    def _validate_request_context(self, *, require_origin: bool) -> bool:
        authority = self._request_authority()
        if authority is None:
            self._send_json(HTTPStatus.MISDIRECTED_REQUEST, {"error": "host_rejected"})
            return False
        if not self._origin_is_allowed(authority, required=require_origin):
            self._send_json(HTTPStatus.FORBIDDEN, {"error": "origin_rejected"})
            return False
        return True

    def _authorized_session(self) -> bool:
        expected = getattr(self.server, "session_token", "")
        if not expected:
            return False
        cookies = SimpleCookie()
        try:
            for header in self.headers.get_all("Cookie", []):
                cookies.load(header)
        except CookieError:
            return False
        supplied = cookies.get(SESSION_COOKIE_NAME)
        if not supplied or not re.fullmatch(r"[A-Za-z0-9_-]{32,128}", supplied.value):
            return False
        return secrets.compare_digest(supplied.value, expected)

    def do_GET(self) -> None:  # noqa: N802 - stdlib handler API
        if not self._validate_request_context(require_origin=False):
            return
        super().do_GET()

    def do_HEAD(self) -> None:  # noqa: N802 - stdlib handler API
        if not self._validate_request_context(require_origin=False):
            return
        super().do_HEAD()

    def do_POST(self) -> None:  # noqa: N802 - stdlib handler API
        if not self._validate_request_context(require_origin=True):
            return
        parsed_path = urlsplit(self.path)
        if parsed_path.path == "/api/session" and not parsed_path.query:
            self._issue_session_cookie = True
            self._send_json(HTTPStatus.OK, {"ready": True})
            return
        if parsed_path.path != "/api/chat" or parsed_path.query:
            self._send_json(HTTPStatus.NOT_FOUND, {"error": "not_found"})
            return
        if not self._authorized_session():
            self._send_json(HTTPStatus.FORBIDDEN, {"error": "session_required"})
            return
        if self.headers.get("Transfer-Encoding"):
            self._send_json(
                HTTPStatus.BAD_REQUEST, {"error": "chunked_requests_not_supported"}
            )
            return
        content_type = self.headers.get_content_type()
        if content_type != "application/json":
            self._send_json(
                HTTPStatus.UNSUPPORTED_MEDIA_TYPE, {"error": "json_required"}
            )
            return
        raw_length = self.headers.get("Content-Length")
        if raw_length is None:
            self._send_json(HTTPStatus.LENGTH_REQUIRED, {"error": "length_required"})
            return
        try:
            length = int(raw_length)
        except ValueError:
            self._send_json(HTTPStatus.BAD_REQUEST, {"error": "invalid_length"})
            return
        if length < 2 or length > BODY_CAP_BYTES:
            self._send_json(
                HTTPStatus.REQUEST_ENTITY_TOO_LARGE, {"error": "body_too_large"}
            )
            return
        raw = self.rfile.read(length)
        try:
            payload = validate_chat_request(strict_json_loads(raw))
        except ValidationError:
            self._send_json(HTTPStatus.BAD_REQUEST, {"error": "invalid_request"})
            return
        try:
            response = proxy_to_brainstem(payload)
        except (ConnectionError, ValidationError):
            self._send_json(
                HTTPStatus.SERVICE_UNAVAILABLE,
                {"error": "companion_unavailable"},
            )
            return
        self._send_json(HTTPStatus.OK, response)

    def do_OPTIONS(self) -> None:  # noqa: N802 - stdlib handler API
        if not self._validate_request_context(require_origin=True):
            return
        self.send_error(HTTPStatus.METHOD_NOT_ALLOWED)

    def end_headers(self) -> None:
        path = urlsplit(self.path).path
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header(
            "Permissions-Policy",
            "camera=(self), microphone=(self), geolocation=()",
        )
        self.send_header(
            "Content-Security-Policy",
            "default-src 'self' data: blob:; connect-src 'self'; "
            "img-src 'self' data: blob:; media-src 'self' blob:; "
            "script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; "
            "worker-src 'self'; object-src 'none'; base-uri 'none'; "
            "form-action 'none'; frame-ancestors 'none'",
        )
        if path in {"/service-worker.js", "/manifest.webmanifest"}:
            self.send_header("Cache-Control", "no-cache")
        if getattr(self, "_issue_session_cookie", False):
            token = getattr(self.server, "session_token", "")
            if token:
                self.send_header(
                    "Set-Cookie",
                    f"{SESSION_COOKIE_NAME}={token}; Path=/; HttpOnly; SameSite=Strict",
                )
            self._issue_session_cookie = False
        super().end_headers()

    def log_message(self, _format: str, *args: Any) -> None:
        status = args[1] if len(args) > 1 else "-"
        path = urlsplit(self.path).path
        sys.stderr.write(f"[adaptive-orb] {self.command} {path} {status}\n")


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--bind",
        default=os.environ.get("ADAPTIVE_ORB_BIND", DEFAULT_BIND),
        help="Bind address; defaults to loopback 127.0.0.1",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=int(os.environ.get("ADAPTIVE_ORB_PORT", str(DEFAULT_PORT))),
    )
    parser.add_argument(
        "--allow-host",
        action="append",
        default=[],
        metavar="HOST",
        help=(
            "Explicit Host header hostname/address to allow; may be repeated. "
            "Loopback hosts are always allowed."
        ),
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> None:
    args = parse_args(argv)
    configured_upstream_url()
    configured_timeout()
    allowed_hosts = configured_allowed_hosts(args.allow_host)
    root = str(Path(__file__).resolve().parent)

    class RootedHandler(AdaptiveOrbHandler):
        def __init__(self, *handler_args: Any, **handler_kwargs: Any):
            super().__init__(*handler_args, directory=root, **handler_kwargs)

    server = ThreadingHTTPServer((args.bind, args.port), RootedHandler)
    server.allowed_hosts = allowed_hosts
    server.session_token = secrets.token_urlsafe(32)
    print(
        f"Adaptive Orb companion serving http://{args.bind}:{args.port} "
        f"(allowed Hosts: {', '.join(sorted(allowed_hosts))}; "
        "Brainstem URL and secret remain server-side)",
        flush=True,
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
