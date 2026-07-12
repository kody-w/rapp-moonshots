import json
import shutil
import threading
import unittest
from pathlib import Path
from unittest.mock import patch

from counterfactual_lab import (
    CausalEvidenceError,
    ExperimentCancelled,
    ExperimentRunner,
    FixtureDriftError,
    FixtureExecutionError,
    SCENARIOS,
    UnknownScenarioError,
    WorkspaceCleanupError,
)


TRACK_ROOT = Path(__file__).resolve().parent.parent
TEST_ROOT = TRACK_ROOT / ".test-runtime" / "engine"


class ExperimentRunnerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        shutil.rmtree(TEST_ROOT, ignore_errors=True)
        TEST_ROOT.mkdir(parents=True)
        cls.runner = ExperimentRunner(runtime_root=TEST_ROOT)

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(TRACK_ROOT / ".test-runtime", ignore_errors=True)

    @staticmethod
    def scripted_trials(outcomes):
        return [
            {
                "passed": passed,
                "status": "PASS" if passed else "FAIL",
                "workspace_cleanup_verified": True,
            }
            for passed in outcomes
        ]

    def test_all_seeded_scenarios_find_expected_repeatable_flip(self):
        expected = {
            "line-endings": ("checkout.lineEnding", "crlf", "lf"),
            "path-precedence": (
                "simulatedPath.order",
                "legacy-first",
                "current-first",
            ),
            "environment-flag": (
                "feature.safeParser",
                "disabled",
                "enabled",
            ),
        }
        self.assertEqual(set(expected), set(SCENARIOS))

        for scenario_id, expected_flip in expected.items():
            with self.subTest(scenario=scenario_id):
                result = self.runner.run(scenario_id)
                flip = result["first_repeatable_flip"]
                self.assertEqual(
                    (flip["variable"], flip["from"], flip["to"]),
                    expected_flip,
                )
                self.assertEqual(result["baseline_capture"]["status"], "FAIL")
                self.assertEqual(result["baseline_capture"]["pass_count"], 0)
                self.assertTrue(result["baseline_capture"]["repeatable"])
                self.assertEqual(flip["counterfactual_status"], "PASS")
                self.assertEqual(flip["pass_count"], 3)
                self.assertEqual(result["metrics"]["trials_run"], 12)
                self.assertEqual(result["metrics"]["workspaces_cleaned"], 12)
                self.assertEqual(
                    result["confidence"]["earlier_controls_rejected"], 2
                )
                self.assertTrue(
                    all(
                        intervention["repeatable"]
                        and intervention["pass_count"] == 0
                        and not intervention["flipped"]
                        for intervention in result["interventions"][:-1]
                    )
                )
                self.assertEqual(
                    result["interventions"][-1]["pass_count"], 3
                )
                self.assertTrue(result["interventions"][-1]["flipped"])
                snapshot_hash = result["baseline_capture"][
                    "fixture_snapshot_sha256"
                ]
                self.assertEqual(len(snapshot_hash), 64)
                self.assertEqual(
                    result["baseline_capture"]["fixture_sha256"],
                    snapshot_hash,
                )
                self.assertTrue(
                    result["baseline_capture"][
                        "fixture_source_verified_at_release"
                    ]
                )
                all_trials = list(result["baseline_capture"]["trials"])
                for intervention in result["interventions"]:
                    all_trials.extend(intervention["trials"])
                self.assertTrue(
                    all(
                        trial["fixture_snapshot_sha256"] == snapshot_hash
                        for trial in all_trials
                    )
                )
                boundary = result["baseline_capture"]["environment_boundary"]
                self.assertEqual(
                    boundary["inherited_experiment_environment_keys"], 0
                )
                self.assertEqual(
                    boundary["inherited_secret_environment_keys"], 0
                )
                self.assertFalse(boundary["bootstrap_values_recorded"])
                self.assertEqual(
                    result["baseline_capture"]["private_data_fields_captured"], 0
                )
                self.assertEqual(list(TEST_ROOT.iterdir()), [])

    def test_each_intervention_changes_exactly_one_bounded_variable(self):
        result = self.runner.run("line-endings")
        baseline = result["baseline_capture"]["controlled_environment"]
        for intervention in result["interventions"]:
            self.assertEqual(intervention["changed_variable_count"], 1)
            self.assertIn(intervention["variable"], baseline)
            self.assertNotEqual(intervention["from"], intervention["to"])
            self.assertTrue(intervention["repeatable"])
            for trial in intervention["trials"]:
                self.assertEqual(len(trial["manifest_sha256"]), 64)
                self.assertEqual(len(trial["environment_sha256"]), 64)
                self.assertTrue(trial["workspace_cleanup_verified"])
        self.assertFalse(result["interventions"][0]["flipped"])
        self.assertFalse(result["interventions"][1]["flipped"])
        self.assertTrue(result["interventions"][2]["flipped"])

    def test_recipe_replays_only_seeded_inputs(self):
        result = self.runner.run("environment-flag")
        recipe = json.loads(result["copyable_recipe"])
        self.assertEqual(recipe["schema"], "counterfactual-repro-recipe/v1")
        self.assertEqual(recipe["scenario"], "environment-flag")
        self.assertEqual(recipe["rerun_count"], 3)
        self.assertEqual(len(recipe["fixture_snapshot_sha256"]), 64)
        commands = self.runner._platform_commands("environment-flag")
        self.assertEqual(
            recipe["command"],
            commands["replay"],
        )
        self.assertEqual(recipe["launch_command"], commands["launch"])
        self.assertEqual(recipe["platform"], commands["platform"])
        changed = recipe["change_exactly_one"]
        self.assertNotIn(changed["variable"], recipe["hold_constant"])
        self.assertEqual(len(recipe["hold_constant"]), 2)

    def test_recipe_commands_cover_windows_and_posix_launchers(self):
        windows = self.runner._platform_commands(
            "path-precedence", platform_name="nt"
        )
        self.assertEqual(
            windows,
            {
                "platform": "windows",
                "launch": "launch.bat",
                "replay": "python cli.py run path-precedence --json",
            },
        )
        posix = self.runner._platform_commands(
            "path-precedence", platform_name="posix"
        )
        self.assertEqual(
            posix,
            {
                "platform": "posix",
                "launch": "./launch.sh",
                "replay": "python3 cli.py run path-precedence --json",
            },
        )

    def test_unknown_scenario_is_rejected_before_workspace_creation(self):
        with self.assertRaises(UnknownScenarioError):
            self.runner.run("../../untrusted")
        self.assertEqual(list(TEST_ROOT.iterdir()), [])

    def test_runtime_root_cannot_escape_the_owned_track(self):
        with self.assertRaisesRegex(ValueError, "inside Track 02"):
            ExperimentRunner(runtime_root=TRACK_ROOT.parent / "outside-track")

    def test_windows_environment_keeps_only_required_bootstrap_key(self):
        controlled = SCENARIOS["line-endings"].baseline_dict()
        environment = self.runner._fixture_environment(
            controlled,
            host_environment={
                "SYSTEMROOT": r"C:\Windows",
                "PATH": r"C:\untrusted",
                "API_TOKEN": "must-not-cross-boundary",
            },
            platform_name="nt",
        )
        self.assertEqual(environment["SYSTEMROOT"], r"C:\Windows")
        self.assertNotIn("PATH", environment)
        self.assertNotIn("API_TOKEN", environment)
        self.assertEqual(
            set(environment) - {"SYSTEMROOT"},
            {
                "CFR_CHECKOUT_LINE_ENDING",
                "CFR_PROCESS_LOCALE",
                "CFR_RUNTIME_VALIDATION",
            },
        )
        with self.assertRaisesRegex(FixtureExecutionError, "SYSTEMROOT"):
            self.runner._fixture_environment(
                controlled,
                host_environment={"PATH": r"C:\untrusted"},
                platform_name="nt",
            )

    def test_cancellation_waits_until_current_workspace_is_clean(self):
        cancel_event = threading.Event()

        def cancel_after_first_trial(event):
            if event["completed"] == 1:
                cancel_event.set()

        with self.assertRaises(ExperimentCancelled):
            self.runner.run(
                "line-endings",
                progress=cancel_after_first_trial,
                cancel_event=cancel_event,
            )
        self.assertEqual(list(TEST_ROOT.iterdir()), [])

    def test_cleanup_residue_withholds_completed_receipt(self):
        with patch("counterfactual_lab.engine.shutil.rmtree", return_value=None):
            with self.assertRaisesRegex(WorkspaceCleanupError, "residue"):
                self.runner.run("line-endings")
        self.assertNotEqual(list(TEST_ROOT.iterdir()), [])
        shutil.rmtree(TEST_ROOT)
        TEST_ROOT.mkdir(parents=True)

    def test_cleanup_verification_stat_error_fails_closed(self):
        absent = TEST_ROOT / "already-absent"
        self.runner._remove_workspace_verified(absent)

        with patch.object(
            Path,
            "lstat",
            side_effect=PermissionError("verification denied"),
        ):
            with self.assertRaisesRegex(
                WorkspaceCleanupError, "could not be verified"
            ) as context:
                self.runner._remove_workspace_verified(absent)
        self.assertIsInstance(context.exception.__cause__, PermissionError)

    def test_mid_run_source_mutation_uses_snapshot_and_withholds_receipt(self):
        drift_root = TRACK_ROOT / ".test-runtime" / "fixture-drift"
        shutil.rmtree(drift_root, ignore_errors=True)
        drift_root.mkdir(parents=True)
        source_fixture = drift_root / "fixture.py"
        source_fixture.write_bytes(self.runner.fixture_path.read_bytes())
        runner = ExperimentRunner(runtime_root=drift_root / "workspaces")
        runner.fixture_path = source_fixture.resolve()
        events = []
        mutated = False

        malicious_fixture = (
            b"import json\n"
            b"print(json.dumps({'passed': True, 'code': 'MUTATED', "
            b"'observation': 'mutated fixture passed', 'expected': 'pass', "
            b"'actual': 'pass'}))\n"
        )

        def mutate_after_baseline(event):
            nonlocal mutated
            events.append(dict(event))
            if (
                not mutated
                and event["stage"] == "capturing"
                and event["completed"] == 3
            ):
                source_fixture.write_bytes(malicious_fixture)
                mutated = True

        try:
            with self.assertRaisesRegex(
                FixtureDriftError, "changed during the experiment"
            ):
                runner.run(
                    "line-endings",
                    progress=mutate_after_baseline,
                )
            self.assertTrue(mutated)
            messages = [event["message"] for event in events]
            self.assertIn("process.locale repeat 3/3: FAIL", messages)
            self.assertIn("checkout.lineEnding repeat 3/3: PASS", messages)
            self.assertNotIn("process.locale repeat 1/3: PASS", messages)
            self.assertEqual(list((drift_root / "workspaces").iterdir()), [])
        finally:
            shutil.rmtree(drift_root, ignore_errors=True)

    def test_mixed_control_outcomes_withhold_receipt(self):
        outcomes = [False, False, False, False, True, False]
        with patch.object(
            self.runner,
            "_run_trial",
            side_effect=self.scripted_trials(outcomes),
        ) as run_trial:
            with self.assertRaisesRegex(
                CausalEvidenceError,
                "Control process.locale produced mixed/flaky outcomes",
            ):
                self.runner.run("line-endings")
        self.assertEqual(run_trial.call_count, 6)

    def test_unanimous_passing_baseline_withholds_receipt(self):
        outcomes = [True, True, True]
        with patch.object(
            self.runner,
            "_run_trial",
            side_effect=self.scripted_trials(outcomes),
        ) as run_trial:
            with self.assertRaisesRegex(
                CausalEvidenceError,
                "Baseline was unanimous PASS",
            ):
                self.runner.run("line-endings")
        self.assertEqual(run_trial.call_count, 3)

    def test_flaky_baseline_withholds_receipt(self):
        outcomes = [False, True, False]
        with patch.object(
            self.runner,
            "_run_trial",
            side_effect=self.scripted_trials(outcomes),
        ) as run_trial:
            with self.assertRaisesRegex(
                CausalEvidenceError,
                "Baseline produced mixed/flaky outcomes",
            ):
                self.runner.run("line-endings")
        self.assertEqual(run_trial.call_count, 3)

    def test_non_unanimous_causal_intervention_withholds_receipt(self):
        outcomes = (
            [False, False, False]
            + [False, False, False]
            + [False, False, False]
            + [True, False, True]
        )
        with patch.object(
            self.runner,
            "_run_trial",
            side_effect=self.scripted_trials(outcomes),
        ) as run_trial:
            with self.assertRaisesRegex(
                CausalEvidenceError,
                "Causal intervention checkout.lineEnding produced mixed/flaky outcomes",
            ):
                self.runner.run("line-endings")
        self.assertEqual(run_trial.call_count, 12)


if __name__ == "__main__":
    unittest.main()
