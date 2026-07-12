#!/usr/bin/env python3
"""Loopback-only web application for Counterfactual Repro Lab."""

import argparse
import copy
import json
import re
import threading
import uuid
import webbrowser
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Optional
from urllib.parse import urlsplit

from counterfactual_lab import (
    ExperimentCancelled,
    ExperimentRunner,
    SCENARIOS,
    WorkspaceCleanupError,
    public_scenarios,
)


TRACK_ROOT = Path(__file__).resolve().parent
INDEX_PATH = TRACK_ROOT / "static" / "index.html"
RUN_PATH = re.compile(r"^/api/runs/([a-f0-9]{32})$")
EXPORT_PATH = re.compile(r"^/api/runs/([a-f0-9]{32})/export$")


class RunCapacityError(RuntimeError):
    """Raised when the local lab already has its maximum active experiments."""


class RunRegistry:
    """Thread-safe, in-memory experiment state."""

    def __init__(self, runner: Optional[ExperimentRunner] = None) -> None:
        self.runner = runner or ExperimentRunner()
        self._runs = {}
        self._workers = {}
        self._cancel_events = {}
        self._lock = threading.Lock()
        self._closing = False
        self._cleanup_failure_detected = False

    def create(self, scenario_id: str) -> dict:
        if scenario_id not in SCENARIOS:
            raise ValueError("Choose one of the seeded scenarios")
        with self._lock:
            if self._closing:
                raise RunCapacityError("The lab is shutting down")
            active = sum(
                1
                for run in self._runs.values()
                if run["status"] in ("queued", "running", "cancelling")
            )
            if active >= 2:
                raise RunCapacityError("Two experiments are already active")
            run_id = uuid.uuid4().hex
            self._runs[run_id] = {
                "id": run_id,
                "scenario_id": scenario_id,
                "status": "queued",
                "progress": {
                    "stage": "queued",
                    "completed": 0,
                    "total": 12,
                    "message": "Experiment queued locally",
                },
                "events": [],
                "result": None,
                "error": None,
                "cleanup_verified": None,
            }
            self._trim_completed()
            snapshot = copy.deepcopy(self._runs[run_id])
            cancel_event = threading.Event()
            worker = threading.Thread(
                target=self._execute,
                args=(run_id, scenario_id, cancel_event),
                name="counterfactual-{0}".format(run_id[:8]),
                daemon=False,
            )
            self._workers[run_id] = worker
            self._cancel_events[run_id] = cancel_event
            worker.start()
        return snapshot

    def get(self, run_id: str) -> Optional[dict]:
        with self._lock:
            run = self._runs.get(run_id)
            return copy.deepcopy(run) if run else None

    def shutdown(self) -> bool:
        """Cancel and join workers; report whether every cleanup was verified."""
        with self._lock:
            self._closing = True
            workers = list(self._workers.values())
            for run_id, cancel_event in self._cancel_events.items():
                cancel_event.set()
                run = self._runs.get(run_id)
                if run and run["status"] in ("queued", "running"):
                    run["status"] = "cancelling"
                    run["progress"] = {
                        "stage": "cancelling",
                        "completed": run["progress"]["completed"],
                        "total": run["progress"]["total"],
                        "message": (
                            "Shutdown requested; waiting for verified workspace cleanup"
                        ),
                    }
        for worker in workers:
            if worker is not threading.current_thread():
                worker.join()
        if any(worker.is_alive() for worker in workers):
            raise RuntimeError("An experiment worker survived shutdown")
        with self._lock:
            return not self._cleanup_failure_detected

    def active_worker_count(self) -> int:
        with self._lock:
            return sum(1 for worker in self._workers.values() if worker.is_alive())

    def _execute(
        self,
        run_id: str,
        scenario_id: str,
        cancel_event: threading.Event,
    ) -> None:
        with self._lock:
            if cancel_event.is_set():
                self._runs[run_id]["status"] = "cancelling"
            else:
                self._runs[run_id]["status"] = "running"

        def progress(event: dict) -> None:
            with self._lock:
                run = self._runs[run_id]
                run["progress"] = event
                run["events"].append(event)
                run["events"] = run["events"][-16:]

        try:
            result = self.runner.run(
                scenario_id,
                progress=progress,
                experiment_id=run_id,
                cancel_event=cancel_event,
            )
            with self._lock:
                run = self._runs[run_id]
                run["status"] = "complete"
                run["result"] = result
                run["cleanup_verified"] = True
        except ExperimentCancelled:
            with self._lock:
                run = self._runs[run_id]
                run["status"] = "cancelled"
                run["error"] = (
                    "Experiment cancelled during shutdown after verified cleanup."
                )
                run["cleanup_verified"] = True
        except WorkspaceCleanupError:
            with self._lock:
                run = self._runs[run_id]
                run["status"] = "failed"
                run["error"] = (
                    "Workspace deletion could not be verified; "
                    "the evidence receipt was withheld."
                )
                run["cleanup_verified"] = False
                self._cleanup_failure_detected = True
        except Exception:
            with self._lock:
                run = self._runs[run_id]
                run["status"] = "failed"
                run["error"] = (
                    "The fixed local experiment could not complete. "
                    "No workspace evidence was retained."
                )
                run["cleanup_verified"] = True
        finally:
            with self._lock:
                self._workers.pop(run_id, None)
                self._cancel_events.pop(run_id, None)

    def _trim_completed(self) -> None:
        completed = [
            run_id
            for run_id, run in self._runs.items()
            if run["status"] in ("complete", "failed", "cancelled")
        ]
        for run_id in completed[:-18]:
            del self._runs[run_id]


class ReproLabHandler(BaseHTTPRequestHandler):
    """Strict route allowlist for the local application."""

    registry = RunRegistry()
    server_version = "CounterfactualReproLab/1.0"

    def do_GET(self) -> None:
        path = urlsplit(self.path).path
        if path in ("/", "/index.html"):
            self._send_bytes(
                HTTPStatus.OK,
                INDEX_PATH.read_bytes(),
                "text/html; charset=utf-8",
            )
            return
        if path == "/api/health":
            self._send_json(
                HTTPStatus.OK,
                {
                    "status": "ready",
                    "scope": "loopback-only",
                    "seeded_scenarios": len(SCENARIOS),
                },
            )
            return
        if path == "/api/scenarios":
            self._send_json(HTTPStatus.OK, {"scenarios": public_scenarios()})
            return
        match = RUN_PATH.fullmatch(path)
        if match:
            run = self.registry.get(match.group(1))
            if not run:
                self._send_error(HTTPStatus.NOT_FOUND, "Experiment not found")
                return
            self._send_json(HTTPStatus.OK, run)
            return
        export_match = EXPORT_PATH.fullmatch(path)
        if export_match:
            run = self.registry.get(export_match.group(1))
            if not run or run["status"] != "complete":
                self._send_error(HTTPStatus.NOT_FOUND, "Evidence receipt not ready")
                return
            payload = json.dumps(
                run["result"], indent=2, sort_keys=True
            ).encode("utf-8")
            self._send_bytes(
                HTTPStatus.OK,
                payload,
                "application/json; charset=utf-8",
                attachment="counterfactual-repro-{0}.json".format(
                    run["scenario_id"]
                ),
            )
            return
        self._send_error(HTTPStatus.NOT_FOUND, "Route not found")

    def do_POST(self) -> None:
        path = urlsplit(self.path).path
        if path != "/api/runs":
            self._send_error(HTTPStatus.NOT_FOUND, "Route not found")
            return
        content_type = self.headers.get("Content-Type", "").split(";", 1)[0]
        if content_type != "application/json":
            self._send_error(HTTPStatus.UNSUPPORTED_MEDIA_TYPE, "JSON required")
            return
        try:
            content_length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self._send_error(HTTPStatus.BAD_REQUEST, "Invalid request length")
            return
        if content_length < 2 or content_length > 4096:
            self._send_error(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, "Request is outside its bound")
            return
        try:
            payload = json.loads(self.rfile.read(content_length))
        except (UnicodeDecodeError, ValueError):
            self._send_error(HTTPStatus.BAD_REQUEST, "Invalid JSON")
            return
        if (
            not isinstance(payload, dict)
            or set(payload) != {"scenario_id"}
            or not isinstance(payload["scenario_id"], str)
            or payload["scenario_id"] not in SCENARIOS
        ):
            self._send_error(
                HTTPStatus.BAD_REQUEST,
                "Only a seeded scenario_id is accepted",
            )
            return
        try:
            run = self.registry.create(payload["scenario_id"])
        except RunCapacityError as error:
            self._send_error(HTTPStatus.TOO_MANY_REQUESTS, str(error))
            return
        self._send_json(HTTPStatus.ACCEPTED, run)

    def do_PUT(self) -> None:
        self._send_error(HTTPStatus.METHOD_NOT_ALLOWED, "Method not allowed")

    def do_DELETE(self) -> None:
        self._send_error(HTTPStatus.METHOD_NOT_ALLOWED, "Method not allowed")

    def do_PATCH(self) -> None:
        self._send_error(HTTPStatus.METHOD_NOT_ALLOWED, "Method not allowed")

    def log_message(self, format_string: str, *args: object) -> None:
        print("[local] {0}".format(format_string % args))

    def _send_error(self, status: HTTPStatus, message: str) -> None:
        self._send_json(status, {"error": message})

    def _send_json(self, status: HTTPStatus, payload: object) -> None:
        encoded = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        self._send_bytes(
            status, encoded, "application/json; charset=utf-8"
        )

    def _send_bytes(
        self,
        status: HTTPStatus,
        payload: bytes,
        content_type: str,
        attachment: Optional[str] = None,
    ) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header(
            "Content-Security-Policy",
            "default-src 'self'; script-src 'self' 'unsafe-inline'; "
            "style-src 'self' 'unsafe-inline'; img-src 'self' data:; "
            "connect-src 'self'; object-src 'none'; base-uri 'none'; "
            "frame-ancestors 'none'; form-action 'none'",
        )
        if attachment:
            self.send_header(
                "Content-Disposition", 'attachment; filename="{0}"'.format(attachment)
            )
        self.end_headers()
        self.wfile.write(payload)


def create_server(
    host: str = "127.0.0.1",
    port: int = 8022,
    registry: Optional[RunRegistry] = None,
) -> ThreadingHTTPServer:
    bound_registry = registry or RunRegistry()
    handler = type(
        "BoundReproLabHandler",
        (ReproLabHandler,),
        {"registry": bound_registry},
    )
    server = ThreadingHTTPServer((host, port), handler)
    server.run_registry = bound_registry
    return server


def main() -> int:
    parser = argparse.ArgumentParser(description="Counterfactual Repro Lab")
    parser.add_argument("--port", type=int, default=8022)
    parser.add_argument("--open", action="store_true")
    args = parser.parse_args()
    if not 1024 <= args.port <= 65535:
        parser.error("--port must be between 1024 and 65535")

    server = create_server(port=args.port)
    url = "http://127.0.0.1:{0}".format(server.server_port)
    print("")
    print("  Counterfactual Repro Lab is ready")
    print("  {0}".format(url))
    print("  Local-only · fixed fixtures · Ctrl+C to stop")
    print("", flush=True)
    if args.open:
        threading.Timer(0.35, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n  Stopping lab; waiting for active workspace cleanup.")
    finally:
        try:
            cleanup_verified = server.run_registry.shutdown()
        finally:
            server.server_close()
    if cleanup_verified:
        print("  Lab stopped; all started trial workspaces were verified clean.")
    else:
        print("  Lab stopped with workspace residue; no affected receipt was issued.")
    return 0 if cleanup_verified else 1


if __name__ == "__main__":
    raise SystemExit(main())
