import json
import shutil
import unittest
from pathlib import Path

from counterfactual_lab import ExperimentRunner, SCENARIOS, UnknownScenarioError


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
                    result["baseline_capture"]["inherited_environment_keys"], 0
                )
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
        self.assertFalse(result["interventions"][0]["flipped"])
        self.assertFalse(result["interventions"][1]["flipped"])
        self.assertTrue(result["interventions"][2]["flipped"])

    def test_recipe_replays_only_seeded_inputs(self):
        result = self.runner.run("environment-flag")
        recipe = json.loads(result["copyable_recipe"])
        self.assertEqual(recipe["schema"], "counterfactual-repro-recipe/v1")
        self.assertEqual(recipe["scenario"], "environment-flag")
        self.assertEqual(recipe["rerun_count"], 3)
        self.assertEqual(
            recipe["command"],
            "python3 cli.py run environment-flag --json",
        )
        changed = recipe["change_exactly_one"]
        self.assertNotIn(changed["variable"], recipe["hold_constant"])
        self.assertEqual(len(recipe["hold_constant"]), 2)

    def test_unknown_scenario_is_rejected_before_workspace_creation(self):
        with self.assertRaises(UnknownScenarioError):
            self.runner.run("../../untrusted")
        self.assertEqual(list(TEST_ROOT.iterdir()), [])

    def test_runtime_root_cannot_escape_the_owned_track(self):
        with self.assertRaisesRegex(ValueError, "inside Track 02"):
            ExperimentRunner(runtime_root=TRACK_ROOT.parent / "outside-track")


if __name__ == "__main__":
    unittest.main()
