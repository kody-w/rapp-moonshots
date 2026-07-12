import json
import shutil
import threading
import time
import unittest
import urllib.error
import urllib.request
from pathlib import Path

from app import RunRegistry, create_server
from counterfactual_lab import ExperimentRunner


TRACK_ROOT = Path(__file__).resolve().parent.parent
TEST_ROOT = TRACK_ROOT / ".test-runtime" / "api"


class ApplicationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        shutil.rmtree(TEST_ROOT, ignore_errors=True)
        TEST_ROOT.mkdir(parents=True)
        registry = RunRegistry(ExperimentRunner(runtime_root=TEST_ROOT))
        cls.server = create_server(port=0, registry=registry)
        cls.base_url = "http://127.0.0.1:{0}".format(cls.server.server_port)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=2)
        shutil.rmtree(TRACK_ROOT / ".test-runtime", ignore_errors=True)

    def request(self, path, method="GET", payload=None):
        data = None if payload is None else json.dumps(payload).encode("utf-8")
        headers = {"Accept": "application/json"}
        if data is not None:
            headers["Content-Type"] = "application/json"
        request = urllib.request.Request(
            self.base_url + path, data=data, headers=headers, method=method
        )
        return urllib.request.urlopen(request, timeout=5)

    def test_catalog_and_security_headers(self):
        with self.request("/api/scenarios") as response:
            payload = json.load(response)
            self.assertEqual(response.status, 200)
            self.assertEqual(len(payload["scenarios"]), 3)
            self.assertEqual(response.headers["X-Content-Type-Options"], "nosniff")
            self.assertIn("connect-src 'self'", response.headers["Content-Security-Policy"])
            self.assertEqual(response.headers["Cache-Control"], "no-store")

    def test_application_contains_mandatory_theme_and_no_external_assets(self):
        with self.request("/") as response:
            html = response.read().decode("utf-8")
        self.assertIn('const param = new URLSearchParams(window.location.search)', html)
        self.assertIn("--cp-bg: #f7f4ef;", html)
        self.assertIn("--cp-accent: #b11f4b;", html)
        self.assertIn('"Segoe UI", Aptos, Calibri', html)
        self.assertNotIn('src="http', html)
        self.assertNotIn('href="http', html)

    def test_api_rejects_arbitrary_commands_and_extra_fields(self):
        with self.assertRaises(urllib.error.HTTPError) as context:
            self.request(
                "/api/runs",
                method="POST",
                payload={"scenario_id": "line-endings", "command": "echo untrusted"},
            )
        self.assertEqual(context.exception.code, 400)
        context.exception.close()

        with self.assertRaises(urllib.error.HTTPError) as context:
            self.request(
                "/api/runs",
                method="POST",
                payload={"scenario_id": "../../untrusted"},
            )
        self.assertEqual(context.exception.code, 400)
        context.exception.close()

    def test_seeded_run_and_export_complete_end_to_end(self):
        with self.request(
            "/api/runs",
            method="POST",
            payload={"scenario_id": "environment-flag"},
        ) as response:
            run = json.load(response)
            self.assertEqual(response.status, 202)

        for _ in range(100):
            with self.request("/api/runs/" + run["id"]) as response:
                run = json.load(response)
            if run["status"] in ("complete", "failed"):
                break
            time.sleep(0.05)

        self.assertEqual(run["status"], "complete")
        self.assertEqual(
            run["result"]["first_repeatable_flip"]["variable"],
            "feature.safeParser",
        )
        with self.request("/api/runs/" + run["id"] + "/export") as response:
            receipt = json.load(response)
            self.assertEqual(
                receipt["schema"], "counterfactual-repro-evidence/v1"
            )
            self.assertIn(
                "counterfactual-repro-environment-flag.json",
                response.headers["Content-Disposition"],
            )
        self.assertEqual(list(TEST_ROOT.iterdir()), [])


if __name__ == "__main__":
    unittest.main()
