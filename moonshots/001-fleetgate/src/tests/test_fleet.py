import json
import sys
import tempfile
import unittest
import xml.etree.ElementTree as ET
from pathlib import Path

import fleet


class FleetGateTests(unittest.TestCase):
    def setUp(self):
        self.cases = fleet.load_json(fleet.DEFAULT_CASES)
        self.controller = {
            "name": "controller",
            "transport": "local",
            "python": sys.executable,
            "role": "test",
        }

    def test_local_harness_is_deterministic(self):
        payload = fleet.load_fixture_payload(self.cases)
        harness = fleet.build_harness(payload)
        first = fleet.run_node(self.controller, harness, 10, 1)
        second = fleet.run_node(self.controller, harness, 10, 2)

        self.assertTrue(first["ok"])
        self.assertTrue(second["ok"])
        self.assertEqual(
            fleet.normalized_fixture_evidence(first),
            fleet.normalized_fixture_evidence(second),
        )
        self.assertEqual(len(first["evidence"]["fixtures"]), 3)

    def test_tampered_source_is_rejected_before_import(self):
        proof = fleet.prove_tamper_rejection(
            self.controller,
            self.cases,
            10,
        )
        self.assertTrue(proof["ok"])
        self.assertEqual(
            proof["errors"][0]["code"],
            "source_hash_mismatch",
        )

    def test_timeout_isolation_proof(self):
        self.assertTrue(fleet.prove_timeout_isolation()["ok"])
        self.assertEqual(fleet.text_tail(b"\xffoutput"), "\ufffdoutput")

    def test_launch_failure_isolation_proof(self):
        harness = fleet.build_harness(
            fleet.load_fixture_payload(self.cases)
        )
        self.assertTrue(
            fleet.prove_launch_failure_isolation(harness)["ok"]
        )

    def test_malformed_output_isolation_proof(self):
        harness = fleet.build_harness(
            fleet.load_fixture_payload(self.cases)
        )
        self.assertTrue(
            fleet.prove_malformed_output_isolation(
                self.controller,
                harness,
                10,
            )["ok"]
        )

    def test_reports_are_self_verifying(self):
        lock = {
            "schema_version": 1,
            "inputs": {
                "inventory_sha256": "d" * 64,
                "cases_sha256": "e" * 64,
            },
        }
        report = {
            "schema_version": 1,
            "run_id": "test-run",
            "created_at": "2026-07-11T00:00:00+00:00",
            "rounds": 1,
            "inventory_sha256": "d" * 64,
            "cases_sha256": "e" * 64,
            "lock": lock,
            "lock_sha256": fleet.sha256_bytes(
                fleet.canonical_json_bytes(lock)
            ),
            "node_results": [
                {
                    "name": "controller",
                    "role": "test",
                    "round": 1,
                    "ok": True,
                    "status": "passed",
                    "elapsed_ms": 1,
                    "normalized_sha256": "a" * 64,
                    "evidence": {
                        "platform": "test",
                        "python": "3.9",
                    },
                }
            ],
            "matrix": [
                {
                    "round": 1,
                    "node": "controller",
                    "platform": "test",
                    "python": "3.9",
                    "fixture": "case_convert_agent.py",
                    "source_sha256": "b" * 64,
                    "tool_schema_sha256": "c" * 64,
                    "calls": 1,
                    "ok": True,
                }
            ],
            "proofs": [
                {"name": "tamper_rejection", "ok": True},
                {"name": "timeout_isolation", "ok": True},
            ],
            "summary": {
                "ok": True,
                "node_executions_total": 1,
                "node_executions_passed": 1,
                "deterministic": True,
                "tamper_rejected": True,
                "timeout_isolated": True,
                "remote_writes": 0,
            },
        }
        with tempfile.TemporaryDirectory() as temp_dir:
            paths = fleet.write_reports(
                report,
                Path(temp_dir) / "run",
            )
            manifest = Path(paths["manifest"]).read_text().splitlines()
            self.assertEqual(len(manifest), 5)
            for line in manifest:
                expected, filename = line.split("  ", 1)
                self.assertEqual(
                    expected,
                    fleet.sha256_file(Path(temp_dir) / "run" / filename),
                )
            html_text = Path(paths["html"]).read_text()
            self.assertIn("FleetGate: PASS", html_text)
            self.assertIn("--cp-accent", html_text)
            self.assertNotIn(".innerHTML", html_text)
            verified = fleet.verify_evidence_directory(
                Path(temp_dir) / "run",
                paths["capsule_sha256"],
            )
            self.assertTrue(verified["ok"])
            with self.assertRaises(ValueError):
                fleet.verify_evidence_directory(
                    Path(temp_dir) / "run",
                    "0" * 64,
                )

    def test_evidence_corruption_is_detected(self):
        lock = {
            "schema_version": 1,
            "inputs": {
                "inventory_sha256": "d" * 64,
                "cases_sha256": "e" * 64,
            },
        }
        report = {
            "schema_version": 1,
            "run_id": "corruption-test",
            "created_at": "2026-07-11T00:00:00+00:00",
            "rounds": 1,
            "inventory_sha256": "d" * 64,
            "cases_sha256": "e" * 64,
            "lock": lock,
            "lock_sha256": fleet.sha256_bytes(
                fleet.canonical_json_bytes(lock)
            ),
            "node_results": [],
            "matrix": [],
            "proofs": [],
            "summary": {
                "ok": True,
                "node_executions_total": 0,
                "node_executions_passed": 0,
                "deterministic": True,
                "tamper_rejected": True,
                "timeout_isolated": True,
                "remote_writes": 0,
            },
        }
        with tempfile.TemporaryDirectory() as temp_dir:
            run_dir = Path(temp_dir) / "run"
            fleet.write_reports(report, run_dir)
            (run_dir / "report.md").write_text("tampered\n")
            with self.assertRaises(ValueError):
                fleet.verify_evidence_directory(
                    run_dir,
                    fleet.sha256_file(run_dir / "evidence.sha256"),
                )

    def test_inventory_rejects_unknown_node(self):
        inventory = fleet.load_json(fleet.DEFAULT_INVENTORY)
        with self.assertRaises(ValueError):
            fleet.select_nodes(inventory, ["missing"])

    def test_fixture_path_cannot_escape_fixture_directory(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            cases_path = Path(temp_dir) / "cases.json"
            cases_path.write_text(
                json.dumps([
                    {
                        "agent_file": "../escape.py",
                        "class_name": "EscapeAgent",
                        "calls": [],
                    }
                ])
            )
            with self.assertRaises(ValueError):
                fleet.load_fixture_payload(fleet.load_json(cases_path))

    def test_junit_fails_when_node_has_no_matrix_results(self):
        report = {
            "node_results": [
                {
                    "name": "offline",
                    "round": 1,
                    "ok": False,
                    "status": "timeout",
                    "error": "timed out",
                }
            ],
            "matrix": [],
            "proofs": [
                {"name": "tamper_rejection", "ok": True},
                {"name": "timeout_isolation", "ok": True},
            ],
            "summary": {
                "ok": False,
                "deterministic": False,
            },
        }
        root = ET.fromstring(fleet.junit_report(report))
        self.assertEqual(root.attrib["failures"], "3")

    def test_malformed_node_evidence_is_rejected(self):
        error = fleet.validate_evidence(
            {"ok": True, "fixtures": [{}]}
        )
        self.assertIsNotNone(error)

    def test_json_snapshot_hash_matches_loaded_bytes(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "value.json"
            path.write_text('{"value":1}\n')
            value, digest = fleet.read_json_snapshot(path)
            path.write_text('{"value":2}\n')
            self.assertEqual(value, {"value": 1})
            self.assertEqual(
                digest,
                fleet.sha256_bytes(b'{"value":1}\n'),
            )


if __name__ == "__main__":
    unittest.main()
