#!/usr/bin/env python3
"""Dependency-free CLI for deterministic Counterfactual Repro Lab runs."""

import argparse
import json

from counterfactual_lab import ExperimentRunner, SCENARIOS


def main() -> int:
    parser = argparse.ArgumentParser(description="Counterfactual Repro Lab")
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("list", help="List the three seeded failures")
    run_parser = subparsers.add_parser("run", help="Run one seeded experiment")
    run_parser.add_argument("scenario", choices=tuple(SCENARIOS))
    run_parser.add_argument("--json", action="store_true", help="Print the evidence receipt")
    args = parser.parse_args()

    if args.command == "list":
        for scenario in SCENARIOS.values():
            print("{0:18} {1}".format(scenario.id, scenario.title))
        return 0

    result = ExperimentRunner().run(args.scenario)
    if args.json:
        print(json.dumps(result, indent=2, sort_keys=True))
    else:
        flip = result["first_repeatable_flip"]
        print("Counterfactual Repro Lab")
        print("  Scenario: {0}".format(result["scenario"]["title"]))
        print("  Baseline: {0}".format(result["baseline_capture"]["status"]))
        print(
            "  Flip: {0} = {1} -> {2} ({3}/{3} repeats)".format(
                flip["variable"],
                flip["from"],
                flip["to"],
                flip["repeat_count"],
            )
        )
        print("  Evidence: {0}".format(result["causal_explanation"]))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
