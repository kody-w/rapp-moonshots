from __future__ import annotations

import contextlib
import io
import json
import re
import shutil
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import Mock, patch
from urllib.request import Request, urlopen

from resurrection_proof.server import (
    DrillBusy,
    DrillManager,
    ShutdownResult,
    build_server,
    serve,
)


ROOT = Path(__file__).resolve().parents[1]
TEST_ROOT = ROOT / ".test-runtime" / "api"


class ApplicationEndToEndTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        shutil.rmtree(TEST_ROOT, ignore_errors=True)
        cls.manager = DrillManager(
            ROOT / "fixtures" / "rapp-estate",
            TEST_ROOT / "workspaces",
            step_delay=0,
        )
        cls.server = build_server("127.0.0.1", 0, cls.manager, ROOT / "web")
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        host, port = cls.server.server_address[:2]
        cls.base_url = f"http://{host}:{port}"

    @classmethod
    def tearDownClass(cls) -> None:
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=2)
        result = cls.manager.shutdown(timeout=2)
        if not result.cleanup_confirmed:
            raise AssertionError("API test manager did not clean up")
        shutil.rmtree(TEST_ROOT, ignore_errors=True)

    def get_json(self, path: str) -> tuple[dict[str, object], object]:
        with urlopen(f"{self.base_url}{path}", timeout=2) as response:
            return json.load(response), response.headers

    def test_ui_is_self_contained_clawpilot_artifact(self) -> None:
        with urlopen(f"{self.base_url}/?scoutTheme=dark", timeout=2) as response:
            html = response.read().decode("utf-8")
            headers = response.headers

        self.assertIn("--cp-bg: #f7f4ef", html)
        self.assertIn("--cp-accent: #b11f4b", html)
        self.assertIn('"Segoe UI", Aptos, Calibri', html)
        self.assertIn("Run Recovery Drill", html)
        self.assertIn("new URLSearchParams(window.location.search)", html)
        self.assertIsNone(re.search(r"<script[^>]+src=", html, re.IGNORECASE))
        self.assertIsNone(re.search(r"<link[^>]+href=", html, re.IGNORECASE))
        self.assertIn("default-src 'self'", headers["Content-Security-Policy"])
        self.assertEqual(headers["X-Frame-Options"], "DENY")

    def test_api_runs_complete_drill_and_downloads_safe_receipt(self) -> None:
        request = Request(
            f"{self.base_url}/api/drills",
            data=b"{}",
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urlopen(request, timeout=2) as response:
            self.assertEqual(response.status, 202)
            created = json.load(response)
        drill_id = created["drill_id"]

        deadline = time.monotonic() + 5
        while True:
            job, _ = self.get_json(f"/api/drills/{drill_id}")
            if job["status"] in {"completed", "failed"}:
                break
            if time.monotonic() > deadline:
                self.fail("recovery drill did not complete")
            time.sleep(0.01)

        self.assertEqual(job["status"], "completed", job.get("error"))
        self.assertEqual(job["progress"], 100)
        self.assertTrue(job["receipt_ready"])
        receipt, headers = self.get_json(f"/api/drills/{drill_id}/receipt")
        self.assertEqual(receipt["outcome"], "PASS")
        self.assertEqual(receipt["metrics"]["canaries_passed"], 4)
        self.assertEqual(
            receipt["controlled_corruption"]["observed_guard_result"], "hard_fail"
        )
        self.assertIn("attachment;", headers["Content-Disposition"])
        serialized = json.dumps(receipt)
        self.assertNotIn(str(ROOT), serialized)
        self.assertNotIn(str(Path.home()), serialized)
        self.assertEqual(list((TEST_ROOT / "workspaces").iterdir()), [])

    def test_health_declares_safety_mode(self) -> None:
        health, _ = self.get_json("/api/health")
        self.assertEqual(health["status"], "ready")
        self.assertEqual(health["safety_mode"], "synthetic-offline")


class WorkerShutdownTests(unittest.TestCase):
    def setUp(self) -> None:
        self.root = ROOT / ".test-runtime" / "worker-shutdown"
        shutil.rmtree(self.root, ignore_errors=True)
        self.root.mkdir(parents=True)

    def tearDown(self) -> None:
        shutil.rmtree(self.root, ignore_errors=True)

    def _manager_with_blocked_worker(
        self,
    ) -> tuple[DrillManager, threading.Event, threading.Event]:
        started = threading.Event()
        release = threading.Event()

        def runner(
            _fixture: Path,
            runtime: Path,
            _drill_id: str,
            **_kwargs: object,
        ) -> dict[str, object]:
            workspace = runtime / "held-workspace"
            workspace.mkdir(parents=True)
            started.set()
            try:
                release.wait(timeout=2)
            finally:
                shutil.rmtree(workspace, ignore_errors=True)
            return {"outcome": "PASS"}

        manager = DrillManager(
            ROOT / "fixtures" / "rapp-estate",
            self.root / "workspaces",
            step_delay=0,
            drill_runner=runner,
        )
        manager.start()
        self.assertTrue(started.wait(timeout=1))
        return manager, release, started

    def test_shutdown_waits_for_active_worker_cleanup(self) -> None:
        manager, release, _started = self._manager_with_blocked_worker()
        timer = threading.Timer(0.05, release.set)
        timer.start()

        result = manager.shutdown(timeout=1)
        timer.join(timeout=1)

        self.assertTrue(result.cleanup_confirmed)
        self.assertEqual(result.tracked_workers, 1)
        self.assertEqual(result.remaining_workers, 0)
        self.assertTrue(result.workspace_clean)
        self.assertGreater(result.waited_seconds, 0)
        self.assertLessEqual(result.waited_seconds, 1)
        with self.assertRaises(DrillBusy):
            manager.start()

    def test_shutdown_timeout_reports_cleanup_unconfirmed(self) -> None:
        manager, release, _started = self._manager_with_blocked_worker()
        try:
            timed_out = manager.shutdown(timeout=0.01)
            self.assertFalse(timed_out.cleanup_confirmed)
            self.assertEqual(timed_out.tracked_workers, 1)
            self.assertEqual(timed_out.remaining_workers, 1)
            self.assertFalse(timed_out.workspace_clean)
        finally:
            release.set()
            completed = manager.shutdown(timeout=1)

        self.assertTrue(completed.cleanup_confirmed)
        self.assertEqual(completed.remaining_workers, 0)
        self.assertTrue(completed.workspace_clean)

    def test_server_prints_no_clean_claim_after_shutdown_timeout(self) -> None:
        manager = Mock()
        manager.shutdown.return_value = ShutdownResult(
            tracked_workers=1,
            remaining_workers=1,
            workspace_clean=False,
            waited_seconds=0.01,
        )
        server = Mock()
        server.server_address = ("127.0.0.1", 8787)
        server.serve_forever.side_effect = KeyboardInterrupt
        output = io.StringIO()

        with (
            patch("resurrection_proof.server.build_server", return_value=server),
            contextlib.redirect_stdout(output),
        ):
            confirmed = serve(
                "127.0.0.1",
                8787,
                manager,
                ROOT / "web",
                shutdown_timeout=0.01,
            )

        self.assertFalse(confirmed)
        manager.shutdown.assert_called_once_with(timeout=0.01)
        server.server_close.assert_called_once()
        self.assertIn("cleanup was not confirmed", output.getvalue())
        self.assertNotIn("Workspace cleanup confirmed", output.getvalue())


if __name__ == "__main__":
    unittest.main()
