#!/usr/bin/env python3
"""Run the invention's falsifiable three-scenario measurement."""

import argparse
import json
import shutil
import statistics
import sys
from datetime import datetime, timezone
from pathlib import Path


TRACK_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(TRACK_ROOT))

from counterfactual_lab import ExperimentRunner, SCENARIOS  # noqa: E402


EXPECTED_CAUSES = {
    "line-endings": "checkout.lineEnding",
    "path-precedence": "simulatedPath.order",
    "environment-flag": "feature.safeParser",
}


def remove_tree_verified(path: Path) -> None:
    try:
        path.lstat()
    except FileNotFoundError:
        return
    except OSError as error:
        raise RuntimeError(
            "Measurement workspace state could not be inspected"
        ) from error

    try:
        shutil.rmtree(path)
    except FileNotFoundError:
        pass
    except OSError as error:
        raise RuntimeError(
            "Measurement workspace deletion failed"
        ) from error
    try:
        path.lstat()
    except FileNotFoundError:
        return
    except OSError as error:
        raise RuntimeError(
            "Measurement workspace cleanup could not be verified"
        ) from error
    raise RuntimeError("Measurement workspace cleanup left residue")


def measure() -> dict:
    runtime_root = TRACK_ROOT / ".runtime" / "measurement"
    remove_tree_verified(runtime_root)
    runner = ExperimentRunner(runtime_root=runtime_root)
    runs = []
    try:
        for scenario_id in SCENARIOS:
            result = runner.run(scenario_id)
            flip = result["first_repeatable_flip"]
            controls = [
                intervention
                for intervention in result["interventions"]
                if not intervention["flipped"]
            ]
            control_trials = [
                trial
                for intervention in controls
                for trial in intervention["trials"]
            ]
            runs.append(
                {
                    "scenario": scenario_id,
                    "expected_cause": EXPECTED_CAUSES[scenario_id],
                    "observed_cause": flip["variable"],
                    "cause_correct": flip["variable"] == EXPECTED_CAUSES[scenario_id],
                    "fixture_snapshot_sha256": result["baseline_capture"][
                        "fixture_snapshot_sha256"
                    ],
                    "fixture_source_verified_at_release": result[
                        "baseline_capture"
                    ]["fixture_source_verified_at_release"],
                    "baseline_repeats": result["baseline_capture"]["repetitions"],
                    "baseline_failures": (
                        result["baseline_capture"]["repetitions"]
                        - result["baseline_capture"]["pass_count"]
                    ),
                    "flip_repeats": flip["repeat_count"],
                    "flip_passes": flip["pass_count"],
                    "control_repeats": len(control_trials),
                    "control_failures": sum(
                        1 for trial in control_trials if not trial["passed"]
                    ),
                    "controls_rejected": result["confidence"][
                        "earlier_controls_rejected"
                    ],
                    "trials": result["metrics"]["trials_run"],
                    "workspaces_cleaned": result["metrics"]["workspaces_cleaned"],
                    "duration_ms": result["metrics"]["duration_ms"],
                    "variables_changed_per_trial": result["metrics"][
                        "variables_changed_per_trial"
                    ],
                    "residual_workspaces": len(list(runtime_root.iterdir())),
                }
            )
    finally:
        remove_tree_verified(runtime_root)

    total_trials = sum(run["trials"] for run in runs)
    verified_cleanups = sum(run["workspaces_cleaned"] for run in runs)
    report = {
        "schema": "counterfactual-repro-measurement/v1",
        "measured_at_utc": datetime.now(timezone.utc).isoformat(),
        "hypothesis": (
            "The lab identifies the seeded environmental cause in every scenario, "
            "with repeatable baseline and counterfactual outcomes, while changing "
            "one variable per trial and leaving no workspace residue."
        ),
        "pass_gates": {
            "cause_accuracy": "3/3",
            "baseline_reproducibility": "9/9 failures",
            "control_reproducibility": "18/18 failures",
            "counterfactual_reproducibility": "9/9 passes",
            "fixture_source_integrity": "3/3 verified before receipt",
            "variables_changed_per_trial": 1,
            "verified_workspace_deletions": "36/36",
            "residual_workspaces": 0,
            "median_scenario_duration_under_ms": 3000,
        },
        "summary": {
            "scenarios_correct": sum(run["cause_correct"] for run in runs),
            "scenarios_total": len(runs),
            "cause_accuracy_percent": round(
                100 * sum(run["cause_correct"] for run in runs) / len(runs), 1
            ),
            "baseline_failures": sum(run["baseline_failures"] for run in runs),
            "baseline_repeats": sum(run["baseline_repeats"] for run in runs),
            "counterfactual_passes": sum(run["flip_passes"] for run in runs),
            "counterfactual_repeats": sum(run["flip_repeats"] for run in runs),
            "control_failures": sum(run["control_failures"] for run in runs),
            "control_repeats": sum(run["control_repeats"] for run in runs),
            "controls_rejected": sum(run["controls_rejected"] for run in runs),
            "fixture_sources_verified": sum(
                run["fixture_source_verified_at_release"] for run in runs
            ),
            "total_trials": total_trials,
            "workspaces_created_and_cleaned": verified_cleanups,
            "residual_workspaces": sum(run["residual_workspaces"] for run in runs),
            "median_scenario_duration_ms": round(
                statistics.median(run["duration_ms"] for run in runs), 2
            ),
        },
        "runs": runs,
    }
    summary = report["summary"]
    report["passed"] = (
        summary["scenarios_correct"] == summary["scenarios_total"]
        and summary["baseline_failures"] == summary["baseline_repeats"]
        and summary["control_failures"] == summary["control_repeats"]
        and summary["counterfactual_passes"] == summary["counterfactual_repeats"]
        and summary["fixture_sources_verified"] == summary["scenarios_total"]
        and all(len(run["fixture_snapshot_sha256"]) == 64 for run in runs)
        and summary["workspaces_created_and_cleaned"] == summary["total_trials"]
        and summary["residual_workspaces"] == 0
        and all(run["variables_changed_per_trial"] == 1 for run in runs)
        and summary["median_scenario_duration_ms"] < 3000
    )
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description="Measure all seeded experiments")
    parser.add_argument(
        "--write-evidence",
        action="store_true",
        help="Write the fixed evidence/experiment-results.json artifact",
    )
    args = parser.parse_args()
    report = measure()
    print(json.dumps(report, indent=2, sort_keys=True))
    if args.write_evidence:
        output = TRACK_ROOT / "evidence" / "experiment-results.json"
        output.parent.mkdir(exist_ok=True)
        output.write_text(
            json.dumps(report, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
