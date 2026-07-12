import json
import shutil
import subprocess
import sys
import unittest
from pathlib import Path


TRACK_ROOT = Path(__file__).resolve().parent.parent


class CommandLineTests(unittest.TestCase):
    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(TRACK_ROOT / ".runtime", ignore_errors=True)

    def test_list_is_bounded_to_seeded_scenarios(self):
        completed = subprocess.run(
            [sys.executable, "cli.py", "list"],
            cwd=TRACK_ROOT,
            check=True,
            text=True,
            capture_output=True,
        )
        self.assertIn("line-endings", completed.stdout)
        self.assertIn("path-precedence", completed.stdout)
        self.assertIn("environment-flag", completed.stdout)

    def test_json_run_produces_replayable_receipt(self):
        completed = subprocess.run(
            [sys.executable, "cli.py", "run", "path-precedence", "--json"],
            cwd=TRACK_ROOT,
            check=True,
            text=True,
            capture_output=True,
        )
        receipt = json.loads(completed.stdout)
        self.assertEqual(
            receipt["first_repeatable_flip"]["variable"],
            "simulatedPath.order",
        )
        self.assertEqual(receipt["safety"]["shell"], False)
        self.assertEqual(receipt["safety"]["dependency_installs"], 0)

    def test_cli_rejects_non_seeded_scenario(self):
        completed = subprocess.run(
            [sys.executable, "cli.py", "run", "arbitrary-command"],
            cwd=TRACK_ROOT,
            check=False,
            text=True,
            capture_output=True,
        )
        self.assertNotEqual(completed.returncode, 0)
        self.assertIn("invalid choice", completed.stderr)


if __name__ == "__main__":
    unittest.main()
