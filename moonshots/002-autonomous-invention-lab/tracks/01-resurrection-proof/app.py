#!/usr/bin/env python3
"""Launch Resurrection Proof with only the Python standard library."""

from __future__ import annotations

import argparse
import json
import os
from collections.abc import Sequence
from pathlib import Path

from resurrection_proof.experiment import experiment_exit_code, run_experiment
from resurrection_proof.server import DrillManager, serve


ROOT = Path(__file__).resolve().parent


def _step_delay() -> float:
    raw = os.environ.get("RESURRECTION_STEP_DELAY", "0.35")
    try:
        return min(max(float(raw), 0.0), 2.0)
    except ValueError:
        return 0.35


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run the offline Resurrection Proof app")
    parser.add_argument(
        "--experiment",
        action="store_true",
        help="run headless recovery drills, print aggregate JSON, and exit",
    )
    parser.add_argument(
        "--runs",
        type=int,
        default=None,
        help="number of headless drills, 1-1000 (default: 10)",
    )
    parser.add_argument(
        "--host",
        choices=("127.0.0.1", "localhost"),
        default="127.0.0.1",
        help="loopback interface (default: 127.0.0.1)",
    )
    parser.add_argument("--port", type=int, default=8787, help="local port (default: 8787)")
    args = parser.parse_args(argv)
    if args.runs is not None and not args.experiment:
        parser.error("--runs requires --experiment")
    if args.experiment:
        runs = 10 if args.runs is None else args.runs
        if not 1 <= runs <= 1000:
            parser.error("--runs must be between 1 and 1000")
        summary = run_experiment(
            ROOT / "fixtures" / "rapp-estate",
            ROOT / ".runtime" / "experiment",
            runs,
        )
        print(json.dumps(summary, indent=2, sort_keys=True))
        return experiment_exit_code(summary)

    if not 0 <= args.port <= 65535:
        parser.error("--port must be between 0 and 65535")

    manager = DrillManager(
        fixture_root=ROOT / "fixtures" / "rapp-estate",
        runtime_root=ROOT / ".runtime" / "workspaces",
        step_delay=_step_delay(),
    )
    serve(args.host, args.port, manager, ROOT / "web")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
