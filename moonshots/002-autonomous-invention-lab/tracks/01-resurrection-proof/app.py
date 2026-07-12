#!/usr/bin/env python3
"""Launch Resurrection Proof with only the Python standard library."""

from __future__ import annotations

import argparse
import os
from pathlib import Path

from resurrection_proof.server import DrillManager, serve


ROOT = Path(__file__).resolve().parent


def _step_delay() -> float:
    raw = os.environ.get("RESURRECTION_STEP_DELAY", "0.35")
    try:
        return min(max(float(raw), 0.0), 2.0)
    except ValueError:
        return 0.35


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the offline Resurrection Proof app")
    parser.add_argument(
        "--host",
        choices=("127.0.0.1", "localhost"),
        default="127.0.0.1",
        help="loopback interface (default: 127.0.0.1)",
    )
    parser.add_argument("--port", type=int, default=8787, help="local port (default: 8787)")
    args = parser.parse_args()
    if not 0 <= args.port <= 65535:
        parser.error("--port must be between 0 and 65535")

    manager = DrillManager(
        fixture_root=ROOT / "fixtures" / "rapp-estate",
        runtime_root=ROOT / ".runtime" / "workspaces",
        step_delay=_step_delay(),
    )
    serve(args.host, args.port, manager, ROOT / "web")


if __name__ == "__main__":
    main()
