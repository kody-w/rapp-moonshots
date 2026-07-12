from __future__ import annotations

import contextlib
import io
import json
import shutil
import unittest
from pathlib import Path
from unittest.mock import patch

import app
from resurrection_proof.drill import execute_drill
from resurrection_proof.experiment import experiment_exit_code, run_experiment


ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "fixtures" / "rapp-estate"
TEST_ROOT = ROOT / ".test-runtime" / "experiment"


class HeadlessExperimentTests(unittest.TestCase):
    def setUp(self) -> None:
        shutil.rmtree(TEST_ROOT, ignore_errors=True)
        TEST_ROOT.mkdir(parents=True)

    def tearDown(self) -> None:
        shutil.rmtree(TEST_ROOT, ignore_errors=True)

    def test_success_aggregates_every_documented_threshold(self) -> None:
        summary = run_experiment(FIXTURE, TEST_ROOT / "workspaces", 3)

        self.assertTrue(summary["meets_thresholds"])
        self.assertEqual(experiment_exit_code(summary), 0)
        self.assertTrue(all(summary["thresholds"].values()))
        self.assertEqual(summary["metrics"]["clean_successes"]["observed"], 3)
        self.assertEqual(summary["metrics"]["manifest"]["files_verified"], 15)
        self.assertEqual(summary["metrics"]["canaries"]["passed"], 12)
        self.assertEqual(summary["metrics"]["corruption"]["hard_fails"], 3)
        self.assertEqual(summary["metrics"]["corruption"]["false_acceptances"], 0)
        self.assertEqual(summary["metrics"]["cleanup"]["observed"], 3)
        self.assertEqual(summary["metrics"]["latency_seconds"]["samples"], 3)
        self.assertGreaterEqual(
            summary["metrics"]["latency_seconds"]["p95"],
            summary["metrics"]["latency_seconds"]["median"],
        )
        self.assertFalse(summary["safety"]["http_server_started"])
        self.assertEqual(list((TEST_ROOT / "workspaces").iterdir()), [])

    def test_corruption_acceptance_fails_threshold_and_exit_code(self) -> None:
        def compromised_runner(*args: object, **kwargs: object) -> dict[str, object]:
            receipt = execute_drill(*args, **kwargs)
            receipt["controlled_corruption"]["observed_guard_result"] = "accepted"
            receipt["metrics"]["corruptions_detected"] = 0
            return receipt

        summary = run_experiment(
            FIXTURE,
            TEST_ROOT / "workspaces",
            1,
            runner=compromised_runner,
        )

        self.assertFalse(summary["meets_thresholds"])
        self.assertEqual(experiment_exit_code(summary), 1)
        self.assertFalse(summary["thresholds"]["corruption_hard_fails"])
        self.assertEqual(summary["metrics"]["corruption"]["hard_fails"], 0)
        self.assertEqual(summary["metrics"]["corruption"]["false_acceptances"], 1)

    def test_cli_experiment_path_never_starts_http_server(self) -> None:
        failing_summary = {
            "meets_thresholds": False,
            "runs_requested": 2,
            "safety": {"http_server_started": False},
        }
        output = io.StringIO()
        with (
            patch.object(app, "run_experiment", return_value=failing_summary) as run,
            patch.object(app, "serve") as serve,
            contextlib.redirect_stdout(output),
        ):
            code = app.main(["--experiment", "--runs", "2"])

        self.assertEqual(code, 1)
        run.assert_called_once()
        serve.assert_not_called()
        self.assertEqual(json.loads(output.getvalue()), failing_summary)


if __name__ == "__main__":
    unittest.main()
