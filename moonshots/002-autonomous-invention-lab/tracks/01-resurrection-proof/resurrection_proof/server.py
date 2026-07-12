"""Standard-library HTTP server and in-memory drill orchestration."""

from __future__ import annotations

import json
import re
import secrets
import threading
import time
from copy import deepcopy
from dataclasses import dataclass
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Callable
from urllib.parse import urlsplit

from .drill import PHASES, DrillFailure, execute_drill


_DRILL_ROUTE = re.compile(r"^/api/drills/(rp-[A-Za-z0-9-]{3,80})(/receipt)?$")
DrillRunner = Callable[..., dict[str, Any]]
DEFAULT_SHUTDOWN_TIMEOUT = 15.0


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace(
        "+00:00", "Z"
    )


class DrillBusy(RuntimeError):
    pass


@dataclass(frozen=True)
class ShutdownResult:
    tracked_workers: int
    remaining_workers: int
    workspace_clean: bool
    waited_seconds: float

    @property
    def cleanup_confirmed(self) -> bool:
        return self.remaining_workers == 0 and self.workspace_clean


class DrillManager:
    """Owns drill state while keeping ephemeral filesystem details private."""

    def __init__(
        self,
        fixture_root: Path,
        runtime_root: Path,
        *,
        step_delay: float = 0.35,
        drill_runner: DrillRunner = execute_drill,
    ):
        self.fixture_root = fixture_root
        self.runtime_root = runtime_root
        self.step_delay = step_delay
        self.drill_runner = drill_runner
        self._lock = threading.Lock()
        self._jobs: dict[str, dict[str, Any]] = {}
        self._workers: set[threading.Thread] = set()
        self._accepting = True

    def _snapshot(self, job: dict[str, Any]) -> dict[str, Any]:
        public = {key: value for key, value in job.items() if key != "receipt"}
        public["receipt_ready"] = job.get("receipt") is not None
        return deepcopy(public)

    def start(self) -> dict[str, Any]:
        with self._lock:
            if not self._accepting:
                raise DrillBusy("Recovery service is shutting down.")
            self._workers = {
                worker for worker in self._workers if worker.is_alive()
            }
            if any(job["status"] in {"queued", "running"} for job in self._jobs.values()):
                raise DrillBusy("A recovery drill is already running.")
            completed = [
                key
                for key, job in self._jobs.items()
                if job["status"] in {"completed", "failed"}
            ]
            for key in completed[:-19]:
                self._jobs.pop(key, None)

            now = datetime.now(timezone.utc)
            drill_id = (
                f"rp-{now.strftime('%Y%m%d-%H%M%S')}-{secrets.token_hex(3)}"
            )
            job: dict[str, Any] = {
                "drill_id": drill_id,
                "status": "queued",
                "progress": 0,
                "current_phase": "isolate",
                "created_at": _utc_now(),
                "updated_at": _utc_now(),
                "phases": [
                    {
                        **phase,
                        "status": "pending",
                    }
                    for phase in PHASES
                ],
                "logs": [
                    {
                        "at": _utc_now(),
                        "level": "info",
                        "message": "Drill queued with synthetic-only safety boundary",
                    }
                ],
                "error": None,
                "receipt": None,
            }
            self._jobs[drill_id] = job
            snapshot = self._snapshot(job)

            thread = threading.Thread(
                target=self._run_tracked,
                args=(drill_id,),
                name=f"resurrection-{drill_id}",
                daemon=True,
            )
            self._workers.add(thread)
            try:
                thread.start()
            except RuntimeError:
                self._workers.discard(thread)
                self._jobs.pop(drill_id, None)
                raise
        return snapshot

    def _run_tracked(self, drill_id: str) -> None:
        try:
            self._run(drill_id)
        finally:
            with self._lock:
                self._workers.discard(threading.current_thread())

    def _progress(self, drill_id: str, event: dict[str, Any]) -> None:
        with self._lock:
            job = self._jobs[drill_id]
            job["status"] = "running"
            job["progress"] = event["progress"]
            job["current_phase"] = event["phase"]
            job["updated_at"] = _utc_now()
            for phase in job["phases"]:
                if phase["id"] == event["phase"]:
                    phase["status"] = event["status"]
                    break
            level = (
                "danger"
                if event["status"] == "hard_fail"
                else "success"
                if event["status"] == "pass"
                else "info"
            )
            job["logs"].append(
                {
                    "at": _utc_now(),
                    "level": level,
                    "message": event["message"],
                }
            )
            job["logs"] = job["logs"][-40:]

    def _run(self, drill_id: str) -> None:
        try:
            receipt = self.drill_runner(
                self.fixture_root,
                self.runtime_root,
                drill_id,
                progress=lambda event: self._progress(drill_id, event),
                step_delay=self.step_delay,
            )
        except DrillFailure as exc:
            with self._lock:
                job = self._jobs[drill_id]
                job["status"] = "failed"
                job["updated_at"] = _utc_now()
                job["error"] = {
                    "code": exc.code,
                    "message": exc.public_message,
                }
                for phase in job["phases"]:
                    if phase["id"] == job["current_phase"]:
                        phase["status"] = "fail"
                        break
                job["logs"].append(
                    {
                        "at": _utc_now(),
                        "level": "danger",
                        "message": f"Drill stopped: {exc.code}",
                    }
                )
            return
        except Exception:
            with self._lock:
                job = self._jobs[drill_id]
                job["status"] = "failed"
                job["updated_at"] = _utc_now()
                job["error"] = {
                    "code": "INTERNAL_ERROR",
                    "message": "The local recovery drill stopped unexpectedly.",
                }
                for phase in job["phases"]:
                    if phase["id"] == job["current_phase"]:
                        phase["status"] = "fail"
                        break
                job["logs"].append(
                    {
                        "at": _utc_now(),
                        "level": "danger",
                        "message": "Drill stopped: INTERNAL_ERROR",
                    }
                )
            return

        with self._lock:
            job = self._jobs[drill_id]
            job["receipt"] = receipt
            job["status"] = "completed"
            job["progress"] = 100
            job["updated_at"] = _utc_now()

    def get(self, drill_id: str) -> dict[str, Any]:
        with self._lock:
            if drill_id not in self._jobs:
                raise KeyError(drill_id)
            return self._snapshot(self._jobs[drill_id])

    def receipt(self, drill_id: str) -> dict[str, Any] | None:
        with self._lock:
            if drill_id not in self._jobs:
                raise KeyError(drill_id)
            receipt = self._jobs[drill_id].get("receipt")
            return deepcopy(receipt) if receipt is not None else None

    def shutdown(self, timeout: float = 8.0) -> ShutdownResult:
        if timeout < 0:
            raise ValueError("shutdown timeout cannot be negative")
        started = time.monotonic()
        deadline = started + timeout
        with self._lock:
            self._accepting = False
            workers = [worker for worker in self._workers if worker.is_alive()]

        for worker in workers:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                break
            worker.join(remaining)

        with self._lock:
            active = {worker for worker in self._workers if worker.is_alive()}
            self._workers = active

        try:
            workspace_clean = (
                not self.runtime_root.exists()
                or not any(self.runtime_root.iterdir())
            )
        except OSError:
            workspace_clean = False
        return ShutdownResult(
            tracked_workers=len(workers),
            remaining_workers=len(active),
            workspace_clean=workspace_clean,
            waited_seconds=round(time.monotonic() - started, 4),
        )


class ResurrectionHTTPServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(
        self,
        server_address: tuple[str, int],
        manager: DrillManager,
        web_root: Path,
    ):
        self.manager = manager
        self.web_root = web_root
        super().__init__(server_address, ResurrectionHandler)


class ResurrectionHandler(BaseHTTPRequestHandler):
    server: ResurrectionHTTPServer
    server_version = "ResurrectionProof/1.0"
    sys_version = ""

    def log_message(self, format: str, *args: object) -> None:
        return

    def _security_headers(self) -> None:
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Cache-Control", "no-store")
        self.send_header(
            "Content-Security-Policy",
            "default-src 'self'; script-src 'self' 'unsafe-inline'; "
            "style-src 'self' 'unsafe-inline'; img-src 'self' data:; "
            "connect-src 'self'; object-src 'none'; base-uri 'none'; "
            "frame-ancestors 'none'; form-action 'none'",
        )

    def _send_json(
        self,
        status: HTTPStatus,
        payload: dict[str, Any],
        *,
        attachment: str | None = None,
    ) -> None:
        body = json.dumps(payload, indent=2, sort_keys=True).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        if attachment is not None:
            self.send_header(
                "Content-Disposition", f'attachment; filename="{attachment}"'
            )
        self._security_headers()
        self.end_headers()
        self.wfile.write(body)

    def _send_html(self) -> None:
        try:
            body = (self.server.web_root / "index.html").read_bytes()
        except OSError:
            self._send_json(
                HTTPStatus.INTERNAL_SERVER_ERROR,
                {"error": {"code": "UI_UNAVAILABLE", "message": "UI is unavailable."}},
            )
            return
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self._security_headers()
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        path = urlsplit(self.path).path
        if path in {"/", "/index.html"}:
            self._send_html()
            return
        if path == "/api/health":
            self._send_json(
                HTTPStatus.OK,
                {
                    "status": "ready",
                    "application": "Resurrection Proof",
                    "safety_mode": "synthetic-offline",
                },
            )
            return

        match = _DRILL_ROUTE.fullmatch(path)
        if match:
            drill_id, receipt_suffix = match.groups()
            try:
                if receipt_suffix:
                    receipt = self.server.manager.receipt(drill_id)
                    if receipt is None:
                        self._send_json(
                            HTTPStatus.CONFLICT,
                            {
                                "error": {
                                    "code": "RECEIPT_NOT_READY",
                                    "message": "Recovery receipt is not ready.",
                                }
                            },
                        )
                        return
                    self._send_json(
                        HTTPStatus.OK,
                        receipt,
                        attachment=f"resurrection-proof-{drill_id}.json",
                    )
                else:
                    self._send_json(
                        HTTPStatus.OK, self.server.manager.get(drill_id)
                    )
            except KeyError:
                self._send_json(
                    HTTPStatus.NOT_FOUND,
                    {
                        "error": {
                            "code": "DRILL_NOT_FOUND",
                            "message": "Recovery drill was not found.",
                        }
                    },
                )
            return

        self._send_json(
            HTTPStatus.NOT_FOUND,
            {"error": {"code": "NOT_FOUND", "message": "Route was not found."}},
        )

    def do_POST(self) -> None:
        path = urlsplit(self.path).path
        if path != "/api/drills":
            self._send_json(
                HTTPStatus.NOT_FOUND,
                {"error": {"code": "NOT_FOUND", "message": "Route was not found."}},
            )
            return
        try:
            content_length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            content_length = -1
        if content_length < 0 or content_length > 1024:
            self._send_json(
                HTTPStatus.REQUEST_ENTITY_TOO_LARGE,
                {
                    "error": {
                        "code": "REQUEST_TOO_LARGE",
                        "message": "Request body is too large.",
                    }
                },
            )
            return
        if content_length:
            self.rfile.read(content_length)
        try:
            job = self.server.manager.start()
        except DrillBusy as exc:
            self._send_json(
                HTTPStatus.CONFLICT,
                {"error": {"code": "DRILL_BUSY", "message": str(exc)}},
            )
            return
        self._send_json(HTTPStatus.ACCEPTED, job)


def build_server(
    host: str,
    port: int,
    manager: DrillManager,
    web_root: Path,
) -> ResurrectionHTTPServer:
    return ResurrectionHTTPServer((host, port), manager, web_root)


def serve(
    host: str,
    port: int,
    manager: DrillManager,
    web_root: Path,
    *,
    shutdown_timeout: float = DEFAULT_SHUTDOWN_TIMEOUT,
) -> bool:
    server = build_server(host, port, manager, web_root)
    actual_host, actual_port = server.server_address[:2]
    print()
    print("  Resurrection Proof")
    print("  Synthetic-only recovery rehearsal")
    print(f"  Open http://{actual_host}:{actual_port}")
    print("  Press Ctrl+C to stop")
    print()
    try:
        server.serve_forever(poll_interval=0.2)
    except KeyboardInterrupt:
        print(
            "\n  Shutdown requested. Waiting up to "
            f"{shutdown_timeout:g}s for recovery cleanup..."
        )
    finally:
        result = manager.shutdown(timeout=shutdown_timeout)
        server.server_close()
        if result.cleanup_confirmed:
            print(
                "  Stopped. Workspace cleanup confirmed"
                f" ({result.tracked_workers} active worker(s) observed)."
            )
        elif result.remaining_workers:
            print(
                "  HTTP server stopped, but cleanup was not confirmed: "
                f"{result.remaining_workers} worker(s) did not finish within "
                f"{shutdown_timeout:g}s. Inspect .runtime before removal."
            )
        else:
            print(
                "  HTTP server stopped, but cleanup was not confirmed: "
                "the runtime workspace is not empty. "
                "Inspect .runtime before removal."
            )
    return result.cleanup_confirmed
