from __future__ import annotations

import hashlib
import json
import shutil
import unittest
from pathlib import Path

from resurrection_proof.drill import (
    DrillFailure,
    VerificationFailure,
    assert_public_safe_receipt,
    execute_drill,
    inject_controlled_corruption,
    verify_inventory,
    verify_manifest,
)


ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "fixtures" / "rapp-estate"
TEST_ROOT = ROOT / ".test-runtime" / "core"


def tree_digest(root: Path) -> str:
    digest = hashlib.sha256()
    for path in sorted(item for item in root.rglob("*") if item.is_file()):
        digest.update(path.relative_to(root).as_posix().encode())
        digest.update(path.read_bytes())
    return digest.hexdigest()


class RecoveryDrillTests(unittest.TestCase):
    def setUp(self) -> None:
        shutil.rmtree(TEST_ROOT, ignore_errors=True)
        TEST_ROOT.mkdir(parents=True)

    def tearDown(self) -> None:
        shutil.rmtree(TEST_ROOT, ignore_errors=True)

    def test_full_drill_restores_behaviors_detects_corruption_and_cleans(self) -> None:
        before = tree_digest(FIXTURE)
        events: list[dict[str, object]] = []

        receipt = execute_drill(
            FIXTURE,
            TEST_ROOT / "workspaces",
            "rp-unit-success",
            progress=events.append,
        )

        self.assertEqual(receipt["outcome"], "PASS")
        self.assertEqual(receipt["metrics"]["files_manifest_verified"], 5)
        self.assertEqual(receipt["metrics"]["canaries_passed"], 4)
        self.assertEqual(receipt["metrics"]["canaries_total"], 4)
        self.assertEqual(receipt["metrics"]["canaries_required"], 4)
        self.assertEqual(receipt["metrics"]["corruptions_detected"], 1)
        self.assertEqual(
            receipt["controlled_corruption"]["observed_guard_result"], "hard_fail"
        )
        self.assertEqual(
            receipt["controlled_corruption"]["error_code"], "CHECKSUM_MISMATCH"
        )
        self.assertTrue(receipt["safety"]["ephemeral_workspace_removed"])
        self.assertFalse(receipt["safety"]["network_access"])
        self.assertIn(
            ("prove", "hard_fail"),
            [(event["phase"], event["status"]) for event in events],
        )
        self.assertEqual(events[-1]["phase"], "receipt")
        self.assertEqual(events[-1]["progress"], 100)
        self.assertEqual(list((TEST_ROOT / "workspaces").iterdir()), [])
        self.assertEqual(tree_digest(FIXTURE), before, "source fixture must remain immutable")
        assert_public_safe_receipt(receipt)

    def test_same_size_corruption_passes_inventory_but_hard_fails_manifest(self) -> None:
        restored = TEST_ROOT / "tampered-estate"
        shutil.copytree(FIXTURE, restored)
        clean_size = (restored / "memory" / "facts.json").stat().st_size

        relative = inject_controlled_corruption(restored)

        self.assertEqual(relative, "memory/facts.json")
        self.assertEqual(
            (restored / "memory" / "facts.json").stat().st_size, clean_size
        )
        self.assertEqual(verify_inventory(restored)["files"], 5)
        with self.assertRaises(VerificationFailure) as caught:
            verify_manifest(restored)
        self.assertEqual(caught.exception.code, "CHECKSUM_MISMATCH")
        self.assertEqual(caught.exception.file, "memory/facts.json")

    def test_non_synthetic_fixture_is_refused_before_restore(self) -> None:
        unsafe_fixture = TEST_ROOT / "unsafe-fixture"
        shutil.copytree(FIXTURE, unsafe_fixture)
        estate_path = unsafe_fixture / "estate.json"
        estate = json.loads(estate_path.read_text(encoding="utf-8"))
        estate["synthetic"] = False
        estate_path.write_text(json.dumps(estate), encoding="utf-8")

        with self.assertRaises(DrillFailure) as caught:
            execute_drill(
                unsafe_fixture,
                TEST_ROOT / "workspaces",
                "rp-unit-refusal",
            )

        self.assertEqual(caught.exception.code, "NON_SYNTHETIC_FIXTURE")
        workspace_root = TEST_ROOT / "workspaces"
        self.assertFalse(workspace_root.exists() and any(workspace_root.iterdir()))

    def test_policy_requiring_five_canaries_refuses_receipt_and_cleans(self) -> None:
        demanding_fixture = TEST_ROOT / "five-canary-fixture"
        shutil.copytree(FIXTURE, demanding_fixture)
        policy_path = demanding_fixture / "policy" / "recovery.json"
        policy_text = policy_path.read_text(encoding="utf-8")
        policy_path.write_text(
            policy_text.replace('"required_canaries": 4', '"required_canaries": 5'),
            encoding="utf-8",
        )
        policy_bytes = policy_path.read_bytes()
        manifest_path = demanding_fixture / "manifest.json"
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        policy_entry = next(
            entry
            for entry in manifest["files"]
            if entry["path"] == "policy/recovery.json"
        )
        policy_entry["bytes"] = len(policy_bytes)
        policy_entry["sha256"] = hashlib.sha256(policy_bytes).hexdigest()
        manifest_path.write_text(
            json.dumps(manifest, indent=2) + "\n",
            encoding="utf-8",
        )

        with self.assertRaises(DrillFailure) as caught:
            execute_drill(
                demanding_fixture,
                TEST_ROOT / "workspaces",
                "rp-five-canary-refusal",
            )

        self.assertEqual(caught.exception.code, "INSUFFICIENT_CANARIES")
        workspace_root = TEST_ROOT / "workspaces"
        self.assertTrue(workspace_root.exists())
        self.assertEqual(list(workspace_root.iterdir()), [])

    def test_public_receipt_guard_rejects_local_locations(self) -> None:
        with self.assertRaises(DrillFailure) as caught:
            assert_public_safe_receipt({"outcome": "PASS", "workspace": str(ROOT)})
        self.assertEqual(caught.exception.code, "UNSAFE_RECEIPT")


if __name__ == "__main__":
    unittest.main()
