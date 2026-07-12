import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from scripts.measure import remove_tree_verified


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


if __name__ == "__main__":
    unittest.main()
