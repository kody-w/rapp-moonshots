import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from counterfactual_lab import ExperimentRunner
from scripts.measure import measure, remove_tree_verified


class MeasurementCleanupTests(unittest.TestCase):
    def test_post_delete_lstat_permission_error_cannot_be_reported_clean(self):
        workspace = Mock(spec=Path)
        workspace.lstat.side_effect = [
            object(),
            PermissionError("verification denied"),
        ]
        with patch("scripts.measure.shutil.rmtree") as remove_tree:
            with self.assertRaisesRegex(
                RuntimeError, "cleanup could not be verified"
            ) as context:
                remove_tree_verified(workspace)
        remove_tree.assert_called_once_with(workspace)
        self.assertEqual(workspace.lstat.call_count, 2)
        self.assertIsInstance(context.exception.__cause__, PermissionError)

    def test_reduced_repetitions_fail_exact_declared_totals(self):
        with patch.object(ExperimentRunner, "repetitions", 1):
            report = measure()

        self.assertFalse(report["passed"])
        self.assertFalse(report["gate_results"]["baseline_reproducibility"])
        self.assertFalse(report["gate_results"]["control_reproducibility"])
        self.assertFalse(report["gate_results"]["causal_reproducibility"])
        self.assertFalse(report["gate_results"]["trial_total"])
        reasons = "\n".join(report["failure_reasons"])
        self.assertIn(
            "Baseline FAIL observations: expected exactly 9/9, observed 3/3",
            reasons,
        )
        self.assertIn(
            "Total trials: expected exactly 36, observed 12",
            reasons,
        )


if __name__ == "__main__":
    unittest.main()
