"""Reproducible headless experiment runner for Resurrection Proof."""

from __future__ import annotations

import json
import math
import secrets
import shutil
import time
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from statistics import median
from typing import Any, Callable

from .drill import (
    DrillFailure,
    assert_public_safe_receipt,
    execute_drill,
    load_manifest,
)


DrillRunner = Callable[..., dict[str, Any]]
MIN_RUNS = 1
MAX_RUNS = 1000


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace(
        "+00:00", "Z"
    )


def _required_canaries(fixture_root: Path) -> int:
    policy_path = fixture_root / "policy" / "recovery.json"
    try:
        policy = json.loads(policy_path.read_text(encoding="utf-8"))
        required = policy["required_canaries"]
    except (OSError, UnicodeError, json.JSONDecodeError, KeyError, TypeError) as exc:
        raise ValueError("fixture does not declare required canaries") from exc
    if (
        not isinstance(required, int)
        or isinstance(required, bool)
        or required < 3
    ):
        raise ValueError("fixture must require at least three canaries")
    return required


def _int_metric(mapping: Any, key: str) -> int | None:
    if not isinstance(mapping, dict):
        return None
    value = mapping.get(key)
    if not isinstance(value, int) or isinstance(value, bool) or value < 0:
        return None
    return value


def _latency_metric(mapping: Any, key: str) -> float | None:
    if not isinstance(mapping, dict):
        return None
    value = mapping.get(key)
    if (
        not isinstance(value, (int, float))
        or isinstance(value, bool)
        or value < 0
        or not math.isfinite(float(value))
    ):
        return None
    return float(value)


def _nearest_rank(values: list[float], percentile: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    rank = max(1, math.ceil(percentile * len(ordered)))
    return ordered[rank - 1]


def run_experiment(
    fixture_root: Path,
    runtime_root: Path,
    runs: int,
    *,
    runner: DrillRunner = execute_drill,
) -> dict[str, Any]:
    """Run isolated drills and evaluate the documented acceptance thresholds."""

    if (
        not isinstance(runs, int)
        or isinstance(runs, bool)
        or not MIN_RUNS <= runs <= MAX_RUNS
    ):
        raise ValueError(f"runs must be between {MIN_RUNS} and {MAX_RUNS}")

    expected_files = len(load_manifest(fixture_root)["files"])
    expected_canaries = _required_canaries(fixture_root)
    started = time.perf_counter()

    clean_successes = 0
    receipts_issued = 0
    manifest_verified_runs = 0
    files_manifest_verified = 0
    canary_complete_runs = 0
    canaries_passed = 0
    corruption_hard_fails = 0
    corruptions_detected = 0
    false_acceptances = 0
    cleanup_successes = 0
    recovery_latencies: list[float] = []
    failures: Counter[str] = Counter()

    for index in range(1, runs + 1):
        drill_id = f"rp-experiment-{index:04d}-{secrets.token_hex(3)}"
        run_runtime = runtime_root / drill_id
        receipt: Any = None
        failure_code: str | None = None
        try:
            receipt = runner(
                fixture_root,
                run_runtime,
                drill_id,
                step_delay=0,
            )
        except DrillFailure as exc:
            failure_code = exc.code
        except Exception:
            failure_code = "UNEXPECTED_ERROR"

        actual_cleanup = True
        if run_runtime.exists():
            try:
                actual_cleanup = not any(run_runtime.iterdir())
            except OSError:
                actual_cleanup = False
            shutil.rmtree(run_runtime, ignore_errors=True)

        if failure_code is not None:
            failures[failure_code] += 1
            continue

        if not isinstance(receipt, dict):
            failures["INVALID_RECEIPT"] += 1
            continue
        try:
            assert_public_safe_receipt(receipt)
        except DrillFailure as exc:
            failures[exc.code] += 1
            continue
        receipts_issued += 1
        metrics = receipt.get("metrics")
        verification = receipt.get("verification")
        corruption = receipt.get("controlled_corruption")
        safety = receipt.get("safety")

        if receipt.get("outcome") == "PASS":
            clean_successes += 1

        verified_files = _int_metric(metrics, "files_manifest_verified")
        if verified_files is not None:
            files_manifest_verified += verified_files
        if (
            verified_files == expected_files
            and isinstance(verification, dict)
            and verification.get("inventory") == "pass"
            and verification.get("file_sizes") == "pass"
            and verification.get("sha256_manifest") == "pass"
        ):
            manifest_verified_runs += 1

        passed_canaries = _int_metric(metrics, "canaries_passed")
        total_canaries = _int_metric(metrics, "canaries_total")
        if passed_canaries is not None:
            canaries_passed += passed_canaries
        if passed_canaries == expected_canaries and total_canaries == expected_canaries:
            canary_complete_runs += 1

        detected = _int_metric(metrics, "corruptions_detected")
        if detected is not None:
            corruptions_detected += detected
        observed_guard = (
            corruption.get("observed_guard_result")
            if isinstance(corruption, dict)
            else None
        )
        if observed_guard == "hard_fail" and detected == 1:
            corruption_hard_fails += 1
        else:
            false_acceptances += 1

        if (
            isinstance(safety, dict)
            and safety.get("ephemeral_workspace_removed") is True
            and actual_cleanup
        ):
            cleanup_successes += 1

        latency = _latency_metric(metrics, "recovery_seconds")
        if latency is not None:
            recovery_latencies.append(latency)

    required_files_total = runs * expected_files
    required_canaries_total = runs * expected_canaries
    thresholds = {
        "clean_successes": clean_successes == runs,
        "manifest_coverage": (
            manifest_verified_runs == runs
            and files_manifest_verified == required_files_total
        ),
        "behavioral_canaries": (
            canary_complete_runs == runs
            and canaries_passed == required_canaries_total
        ),
        "corruption_hard_fails": (
            corruption_hard_fails == runs
            and corruptions_detected == runs
            and false_acceptances == 0
        ),
        "workspace_cleanup": cleanup_successes == runs,
        "public_safe_receipts": receipts_issued == runs,
        "latency_samples": len(recovery_latencies) == runs,
    }
    meets_thresholds = all(thresholds.values())

    return {
        "experiment_schema": "resurrection-proof/experiment-v1",
        "generated_at": _utc_now(),
        "runs_requested": runs,
        "runs_completed": receipts_issued,
        "meets_thresholds": meets_thresholds,
        "metrics": {
            "clean_successes": {
                "observed": clean_successes,
                "required": runs,
            },
            "manifest": {
                "verified_runs": manifest_verified_runs,
                "required_runs": runs,
                "files_verified": files_manifest_verified,
                "required_files": required_files_total,
            },
            "canaries": {
                "complete_runs": canary_complete_runs,
                "passed": canaries_passed,
                "required": required_canaries_total,
            },
            "corruption": {
                "hard_fails": corruption_hard_fails,
                "detected": corruptions_detected,
                "required": runs,
                "false_acceptances": false_acceptances,
            },
            "cleanup": {
                "observed": cleanup_successes,
                "required": runs,
            },
            "latency_seconds": {
                "samples": len(recovery_latencies),
                "median": (
                    round(float(median(recovery_latencies)), 4)
                    if recovery_latencies
                    else None
                ),
                "p95": (
                    round(float(_nearest_rank(recovery_latencies, 0.95)), 4)
                    if recovery_latencies
                    else None
                ),
            },
            "experiment_seconds": round(time.perf_counter() - started, 4),
        },
        "thresholds": thresholds,
        "failures": [
            {"code": code, "count": count}
            for code, count in sorted(failures.items())
        ],
        "safety": {
            "fixture_only": True,
            "network_access": False,
            "http_server_started": False,
        },
    }


def experiment_exit_code(summary: dict[str, Any]) -> int:
    return 0 if summary.get("meets_thresholds") is True else 1
