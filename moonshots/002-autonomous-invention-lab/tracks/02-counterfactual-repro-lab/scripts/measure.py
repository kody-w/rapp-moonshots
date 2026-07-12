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

EXPECTED_TOTALS = {
    "scenarios_total": 3,
    "scenarios_correct": 3,
    "baseline_failures": 9,
    "baseline_repeats": 9,
    "control_failures": 18,
    "control_repeats": 18,
    "counterfactual_passes": 9,
    "counterfactual_repeats": 9,
    "controls_rejected": 6,
    "fixture_sources_verified": 3,
    "total_trials": 36,
    "workspaces_created_and_cleaned": 36,
    "variables_changed_per_trial": 1,
    "residual_workspaces": 0,
    "cause_accuracy_percent": 100.0,
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
            "with repeatable baseline, control, and causal outcomes, while changing "
            "one variable per trial and leaving no workspace residue."
        ),
        "expected_totals": EXPECTED_TOTALS,
        "pass_gates": {
            "scenarios": 3,
            "cause_accuracy": "3/3",
            "baseline_reproducibility": "9/9 failures",
            "control_reproducibility": "18/18 failures",
            "counterfactual_reproducibility": "9/9 passes",
            "controls_rejected": 6,
            "fixture_source_integrity": "3/3 verified before receipt",
            "variables_changed_per_trial": 1,
            "total_trials": 36,
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
    expected = EXPECTED_TOTALS
    gate_checks = [
        (
            "scenario_totals",
            summary["scenarios_total"] == expected["scenarios_total"]
            and summary["scenarios_correct"] == expected["scenarios_correct"],
            "Scenarios: expected exactly {0}/{1} correct, observed {2}/{3}".format(
                expected["scenarios_correct"],
                expected["scenarios_total"],
                summary["scenarios_correct"], summary["scenarios_total"]
            ),
        ),
        (
            "baseline_reproducibility",
            summary["baseline_failures"] == expected["baseline_failures"]
            and summary["baseline_repeats"] == expected["baseline_repeats"],
            "Baseline FAIL observations: expected exactly {0}/{1}, "
            "observed {2}/{3}".format(
                expected["baseline_failures"],
                expected["baseline_repeats"],
                summary["baseline_failures"], summary["baseline_repeats"]
            ),
        ),
        (
            "control_reproducibility",
            summary["control_failures"] == expected["control_failures"]
            and summary["control_repeats"] == expected["control_repeats"],
            "Control FAIL observations: expected exactly {0}/{1}, "
            "observed {2}/{3}".format(
                expected["control_failures"],
                expected["control_repeats"],
                summary["control_failures"], summary["control_repeats"]
            ),
        ),
        (
            "causal_reproducibility",
            summary["counterfactual_passes"] == expected["counterfactual_passes"]
            and summary["counterfactual_repeats"]
            == expected["counterfactual_repeats"],
            "Causal PASS observations: expected exactly {0}/{1}, "
            "observed {2}/{3}".format(
                expected["counterfactual_passes"],
                expected["counterfactual_repeats"],
                summary["counterfactual_passes"],
                summary["counterfactual_repeats"],
            ),
        ),
        (
            "controls_rejected",
            summary["controls_rejected"] == expected["controls_rejected"],
            "Rejected controls: expected exactly {0}, observed {1}".format(
                expected["controls_rejected"],
                summary["controls_rejected"]
            ),
        ),
        (
            "trial_total",
            summary["total_trials"] == expected["total_trials"],
            "Total trials: expected exactly {0}, observed {1}".format(
                expected["total_trials"],
                summary["total_trials"]
            ),
        ),
        (
            "cleanup_total",
            summary["workspaces_created_and_cleaned"]
            == expected["workspaces_created_and_cleaned"],
            "Verified cleanups: expected exactly {0}, observed {1}".format(
                expected["workspaces_created_and_cleaned"],
                summary["workspaces_created_and_cleaned"]
            ),
        ),
        (
            "fixture_source_integrity",
            summary["fixture_sources_verified"]
            == expected["fixture_sources_verified"]
            and all(len(run["fixture_snapshot_sha256"]) == 64 for run in runs),
            "Fixture sources: expected exactly {0}/{1} verified with snapshot "
            "hashes, observed {2}/{1}".format(
                expected["fixture_sources_verified"],
                expected["scenarios_total"],
                summary["fixture_sources_verified"],
            ),
        ),
        (
            "variables_changed_per_trial",
            len(runs) == expected["scenarios_total"]
            and all(
                run["variables_changed_per_trial"]
                == expected["variables_changed_per_trial"]
                for run in runs
            ),
            "Variables changed per trial: expected exactly {0} for all {1} "
            "scenarios".format(
                expected["variables_changed_per_trial"],
                expected["scenarios_total"],
            ),
        ),
        (
            "workspace_residue",
            summary["residual_workspaces"] == expected["residual_workspaces"],
            "Residual workspaces: expected exactly {0}, observed {1}".format(
                expected["residual_workspaces"],
                summary["residual_workspaces"]
            ),
        ),
        (
            "cause_accuracy",
            summary["cause_accuracy_percent"] == expected["cause_accuracy_percent"],
            "Cause accuracy: expected exactly {0}%, observed {1}%".format(
                expected["cause_accuracy_percent"],
                summary["cause_accuracy_percent"]
            ),
        ),
        (
            "duration",
            summary["median_scenario_duration_ms"] < 3000,
            "Median duration: expected under 3000 ms, observed {0} ms".format(
                summary["median_scenario_duration_ms"]
            ),
        ),
    ]
    report["gate_results"] = {
        name: passed for name, passed, _reason in gate_checks
    }
    report["failure_reasons"] = [
        reason for _name, passed, reason in gate_checks if not passed
    ]
    report["passed"] = not report["failure_reasons"]
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
