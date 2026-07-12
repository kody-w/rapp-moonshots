from __future__ import annotations

import json
import re
import shutil
import threading
import time
import unittest
from pathlib import Path
from urllib.request import Request, urlopen

from resurrection_proof.server import DrillManager, build_server


ROOT = Path(__file__).resolve().parents[1]
TEST_ROOT = ROOT / ".test-runtime" / "api"


class ApplicationEndToEndTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        shutil.rmtree(TEST_ROOT, ignore_errors=True)
        manager = DrillManager(
            ROOT / "fixtures" / "rapp-estate",
            TEST_ROOT / "workspaces",
            step_delay=0,
        )
        cls.server = build_server("127.0.0.1", 0, manager, ROOT / "web")
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        host, port = cls.server.server_address[:2]
        cls.base_url = f"http://{host}:{port}"

    @classmethod
    def tearDownClass(cls) -> None:
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=2)
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


if __name__ == "__main__":
    unittest.main()
