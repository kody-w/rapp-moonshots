#!/usr/bin/env python3
"""Fixed, safe fixture invoked by the experiment engine.

The fixture accepts only a seeded scenario identifier and reads only files in
its current isolated workspace plus Counterfactual Repro Lab's allowlisted
environment keys.
"""

import argparse
import json
import os
from pathlib import Path
from typing import Dict


SCENARIO_IDS = ("line-endings", "path-precedence", "environment-flag")


def inspect_line_endings(workspace: Path) -> Dict[str, object]:
    payload = (workspace / "payload" / "records.txt").read_bytes()
    records = payload.split(b"\n")
    if records and records[-1] == b"":
        records.pop()
    has_carriage_returns = any(record.endswith(b"\r") for record in records)
    logical_records = [record.rstrip(b"\r").decode("utf-8") for record in records]
    passed = logical_records == ["alpha", "beta", "gamma"] and not has_carriage_returns
    return {
        "passed": passed,
        "code": "LF_ONLY" if passed else "UNEXPECTED_CR_BYTE",
        "observation": (
            "3 records parsed with LF-only delimiters"
            if passed
            else "3 logical records found; each carries an extra CR byte"
        ),
        "expected": "LF-only bytes: alpha\\nbeta\\ngamma\\n",
        "actual": "CRLF bytes detected" if has_carriage_returns else "LF-only bytes detected",
    }


def inspect_path_precedence(workspace: Path) -> Dict[str, object]:
    order = os.environ.get("CFR_SIMULATED_PATH_ORDER", "")
    directories = {
        "legacy-first": ("legacy", "current"),
        "current-first": ("current", "legacy"),
    }.get(order, ())
    if not directories:
        return {
            "passed": False,
            "code": "INVALID_BOUNDED_ORDER",
            "observation": "No allowlisted simulated search order was supplied",
            "expected": "legacy-first or current-first",
            "actual": "invalid order",
        }
    selected = json.loads(
        (workspace / "tools" / directories[0] / "tool.json").read_text(encoding="utf-8")
    )
    passed = selected["major"] >= 2
    return {
        "passed": passed,
        "code": "COMPATIBLE_TOOL" if passed else "LEGACY_TOOL_WON",
        "observation": "resolved repro-tool v{0} from {1}/".format(
            selected["major"], directories[0]
        ),
        "expected": "first resolved tool has major version >= 2",
        "actual": "major version {0}".format(selected["major"]),
    }


def inspect_environment_flag(workspace: Path) -> Dict[str, object]:
    policy = json.loads((workspace / "policy.json").read_text(encoding="utf-8"))
    flag = os.environ.get("CFR_FEATURE_SAFE_PARSER", "")
    passed = flag == "enabled" and policy["requires"] == "safe-parser"
    return {
        "passed": passed,
        "code": "SAFE_PARSER_ACTIVE" if passed else "SAFE_PARSER_DISABLED",
        "observation": "safe parser gate is {0}".format(flag or "unset"),
        "expected": "feature.safeParser=enabled",
        "actual": "feature.safeParser={0}".format(flag or "unset"),
    }


INSPECTORS = {
    "line-endings": inspect_line_endings,
    "path-precedence": inspect_path_precedence,
    "environment-flag": inspect_environment_flag,
}


def main() -> int:
    parser = argparse.ArgumentParser(description="Run a seeded safe fixture")
    parser.add_argument("scenario", choices=SCENARIO_IDS)
    args = parser.parse_args()
    result = INSPECTORS[args.scenario](Path.cwd())
    print(json.dumps(result, sort_keys=True, separators=(",", ":")))
    return 0 if result["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
