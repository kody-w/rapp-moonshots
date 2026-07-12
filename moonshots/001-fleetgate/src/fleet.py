#!/usr/bin/env python3
"""
FleetGate — prove reviewed RAPP agent bytes behave identically across machines.

The controller sends one self-contained Python harness over stdin. Reviewed
agent bytes are loaded as in-memory modules. No brainstem, model, agent
directory, remote file, or remote configuration is changed.
"""

from __future__ import annotations

import argparse
import base64
import concurrent.futures
import hashlib
import json
import platform
import re
import subprocess
import sys
import time
import uuid
import webbrowser
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple


ROOT = Path(__file__).resolve().parent
FLEET_DIR = ROOT / "fleet"
FIXTURE_DIR = FLEET_DIR / "fixtures"
DEFAULT_INVENTORY = FLEET_DIR / "inventory.json"
DEFAULT_CASES = FLEET_DIR / "cases.json"
RESULTS_DIR = ROOT / "results" / "fleetgate"

ALLOWED_IMPORTS = {
    "basic_agent",
    "agents.basic_agent",
    "hashlib",
    "re",
    "unicodedata",
}
FORBIDDEN_CALLS = {
    "__import__",
    "breakpoint",
    "compile",
    "eval",
    "exec",
    "open",
}


HARNESS_SOURCE = r'''
import ast
import base64
import hashlib
import json
import os
import platform
import sys
import time
import types

PAYLOAD = json.loads(base64.b64decode("__PAYLOAD__").decode("utf-8"))
ALLOWED_IMPORTS = set(PAYLOAD["allowed_imports"])
FORBIDDEN_CALLS = set(PAYLOAD["forbidden_calls"])


def fail(code, message, fixture=None):
    item = {"code": code, "message": message}
    if fixture:
        item["fixture"] = fixture
    errors.append(item)


def static_validate(filename, source):
    try:
        tree = ast.parse(source, filename=filename)
    except SyntaxError as exc:
        return ["syntax_error:%s" % exc]
    violations = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                if alias.name not in ALLOWED_IMPORTS:
                    violations.append("import:%s" % alias.name)
        elif isinstance(node, ast.ImportFrom):
            module = node.module or ""
            if module not in ALLOWED_IMPORTS:
                violations.append("import_from:%s" % module)
        elif isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
            if node.func.id in FORBIDDEN_CALLS:
                violations.append("call:%s" % node.func.id)
    return sorted(set(violations))


class BasicAgent:
    def __init__(self, name=None, metadata=None):
        if name is not None:
            self.name = name
        elif not hasattr(self, "name"):
            self.name = "BasicAgent"
        if metadata is not None:
            self.metadata = metadata
        elif not hasattr(self, "metadata"):
            self.metadata = {
                "name": self.name,
                "description": "",
                "parameters": {"type": "object", "properties": {}},
            }

    def to_tool(self):
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.metadata.get("description", ""),
                "parameters": self.metadata.get(
                    "parameters", {"type": "object", "properties": {}}
                ),
            },
        }


stub = types.ModuleType("basic_agent")
stub.BasicAgent = BasicAgent
sys.modules["basic_agent"] = stub
agents_package = types.ModuleType("agents")
agents_package.__path__ = []
sys.modules["agents"] = agents_package
agents_stub = types.ModuleType("agents.basic_agent")
agents_stub.BasicAgent = BasicAgent
sys.modules["agents.basic_agent"] = agents_stub

started = time.perf_counter()
errors = []
fixture_results = []

for fixture in PAYLOAD["fixtures"]:
    filename = fixture["filename"]
    if (
        not filename
        or os.path.basename(filename) != filename
        or os.path.isabs(filename)
        or filename in {".", ".."}
    ):
        fail(
            "invalid_fixture_path",
            "fixture filename must be a basename",
            filename,
        )
        continue
    source = base64.b64decode(fixture["source_b64"])
    actual_hash = hashlib.sha256(source).hexdigest()
    expected_hash = fixture["sha256"]
    if actual_hash != expected_hash:
        fail(
            "source_hash_mismatch",
            "expected %s, received %s" % (expected_hash, actual_hash),
            filename,
        )
        continue

    text = source.decode("utf-8")
    violations = static_validate(filename, text)
    if violations:
        fail(
            "static_policy_violation",
            ",".join(violations),
            filename,
        )
        continue

    case = fixture["case"]
    module_name = "fleetgate_" + filename.replace(".py", "")
    module = types.ModuleType(module_name)
    module.__file__ = filename
    sys.modules[module_name] = module
    exec(compile(text, filename, "exec"), module.__dict__)
    agent_class = getattr(module, case["class_name"])
    agent = agent_class()
    tool = agent.to_tool()
    tool_hash = hashlib.sha256(
        json.dumps(tool, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()

    calls = []
    fixture_ok = True
    for index, call in enumerate(case["calls"]):
        call_started = time.perf_counter()
        value = agent.perform(**call["args"])
        duration_ms = round((time.perf_counter() - call_started) * 1000, 3)
        expected = call["expected"]
        ok = value == expected
        fixture_ok = fixture_ok and ok
        normalized = json.dumps(
            value,
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=True,
        )
        calls.append(
            {
                "index": index,
                "args": call["args"],
                "expected": expected,
                "actual": value,
                "ok": ok,
                "duration_ms": duration_ms,
                "output_sha256": hashlib.sha256(
                    normalized.encode("utf-8")
                ).hexdigest(),
            }
        )
    fixture_results.append(
        {
            "file": filename,
            "source_sha256": actual_hash,
            "agent_name": agent.name,
            "tool_schema_sha256": tool_hash,
            "calls": calls,
            "ok": fixture_ok,
        }
    )

result = {
    "ok": not errors and all(item["ok"] for item in fixture_results),
    "machine": platform.node(),
    "platform": platform.platform(),
    "python": platform.python_version(),
    "duration_ms": round((time.perf_counter() - started) * 1000, 3),
    "fixtures": fixture_results,
    "errors": errors,
}
print(json.dumps(result, sort_keys=True, separators=(",", ":"), ensure_ascii=True))
'''


def load_json(path: Path) -> Any:
    return read_json_snapshot(path)[0]


def read_json_snapshot(path: Path) -> Tuple[Any, str]:
    data = path.read_bytes()
    value = json.loads(data.decode("utf-8"))
    return value, sha256_bytes(data)


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def canonical_json_bytes(value: Any) -> bytes:
    return (
        json.dumps(
            value,
            sort_keys=True,
            separators=(",", ":"),
            ensure_ascii=True,
        )
        + "\n"
    ).encode("utf-8")


def source_state() -> Dict[str, Any]:
    commit = None
    dirty = None
    try:
        commit_result = subprocess.run(
            ["git", "-C", str(ROOT), "rev-parse", "HEAD"],
            text=True,
            capture_output=True,
            timeout=5,
            check=False,
        )
        if commit_result.returncode == 0:
            commit = commit_result.stdout.strip()
        status_result = subprocess.run(
            ["git", "-C", str(ROOT), "status", "--porcelain"],
            text=True,
            capture_output=True,
            timeout=5,
            check=False,
        )
        if status_result.returncode == 0:
            dirty = bool(status_result.stdout.strip())
    except (OSError, subprocess.TimeoutExpired):
        pass
    return {
        "commit": commit,
        "dirty": dirty,
        "fleet_py_sha256": sha256_file(Path(__file__).resolve()),
    }


def build_run_lock(
    nodes: Sequence[Dict[str, Any]],
    payload: Dict[str, Any],
    harness: str,
    inventory_hash: str,
    cases_hash: str,
    rounds: int,
    timeout: float,
) -> Dict[str, Any]:
    return {
        "schema_version": 1,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "source": source_state(),
        "inputs": {
            "inventory_sha256": inventory_hash,
            "cases_sha256": cases_hash,
            "harness_sha256": sha256_bytes(harness.encode("utf-8")),
            "fixtures": [
                {
                    "filename": item["filename"],
                    "sha256": item["sha256"],
                }
                for item in payload["fixtures"]
            ],
        },
        "policy": {
            "allowed_imports": payload["allowed_imports"],
            "forbidden_calls": payload["forbidden_calls"],
            "remote_writes": 0,
            "raw_command_input": False,
        },
        "execution": {
            "rounds": rounds,
            "timeout_seconds": timeout,
            "nodes": [
                {
                    "name": node["name"],
                    "role": node.get("role", ""),
                    "transport": node["transport"],
                    "host": node.get("host"),
                    "python": node["python"],
                }
                for node in nodes
            ],
        },
    }


def fixture_path(filename: str) -> Path:
    candidate = Path(filename)
    if (
        not filename
        or candidate.is_absolute()
        or candidate.name != filename
        or filename in {".", ".."}
        or "/" in filename
        or "\\" in filename
    ):
        raise ValueError("invalid fixture filename: %r" % filename)
    resolved_root = FIXTURE_DIR.resolve()
    resolved = (FIXTURE_DIR / candidate).resolve()
    if resolved.parent != resolved_root:
        raise ValueError("fixture escapes fixture directory: %r" % filename)
    return resolved


def load_fixture_payload(
    cases: Sequence[Dict[str, Any]],
    tamper_fixture: Optional[str] = None,
) -> Dict[str, Any]:
    fixtures = []
    for case in cases:
        filename = case["agent_file"]
        source = fixture_path(filename).read_bytes()
        expected_hash = sha256_bytes(source)
        transported = source
        if filename == tamper_fixture:
            transported = source + b"\n# deliberate FleetGate tamper proof\n"
        fixtures.append(
            {
                "filename": filename,
                "sha256": expected_hash,
                "source_b64": base64.b64encode(transported).decode("ascii"),
                "case": case,
            }
        )
    return {
        "fixtures": fixtures,
        "allowed_imports": sorted(ALLOWED_IMPORTS),
        "forbidden_calls": sorted(FORBIDDEN_CALLS),
    }


def build_harness(payload: Dict[str, Any]) -> str:
    encoded = base64.b64encode(
        json.dumps(
            payload,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
    ).decode("ascii")
    return HARNESS_SOURCE.replace("__PAYLOAD__", encoded)


def parse_harness_output(stdout: str) -> Dict[str, Any]:
    for line in reversed(stdout.splitlines()):
        line = line.strip()
        if line.startswith("{") and line.endswith("}"):
            value = json.loads(line)
            if isinstance(value, dict):
                return value
    raise ValueError("harness returned no JSON object")


def validate_evidence(evidence: Dict[str, Any]) -> Optional[str]:
    required_types = {
        "ok": bool,
        "machine": str,
        "platform": str,
        "python": str,
        "duration_ms": (int, float),
        "fixtures": list,
        "errors": list,
    }
    for key, expected_type in required_types.items():
        if key not in evidence:
            return "missing evidence field: %s" % key
        if not isinstance(evidence[key], expected_type):
            return "invalid evidence field type: %s" % key

    for error in evidence["errors"]:
        if (
            not isinstance(error, dict)
            or not isinstance(error.get("code"), str)
            or not isinstance(error.get("message"), str)
        ):
            return "invalid evidence error record"

    fixture_fields = {
        "file": str,
        "source_sha256": str,
        "agent_name": str,
        "tool_schema_sha256": str,
        "calls": list,
        "ok": bool,
    }
    call_fields = {
        "index": int,
        "args": dict,
        "ok": bool,
        "duration_ms": (int, float),
        "output_sha256": str,
    }
    hash_pattern = re.compile(r"^[0-9a-f]{64}$")
    for fixture in evidence["fixtures"]:
        if not isinstance(fixture, dict):
            return "invalid fixture evidence record"
        for key, expected_type in fixture_fields.items():
            if key not in fixture or not isinstance(
                fixture[key], expected_type
            ):
                return "invalid fixture field: %s" % key
        if not hash_pattern.fullmatch(fixture["source_sha256"]):
            return "invalid fixture source hash"
        if not hash_pattern.fullmatch(fixture["tool_schema_sha256"]):
            return "invalid fixture schema hash"
        for call in fixture["calls"]:
            if not isinstance(call, dict):
                return "invalid call evidence record"
            for key, expected_type in call_fields.items():
                if key not in call or not isinstance(
                    call[key], expected_type
                ):
                    return "invalid call field: %s" % key
            if "expected" not in call or "actual" not in call:
                return "missing call expected/actual field"
            if not hash_pattern.fullmatch(call["output_sha256"]):
                return "invalid call output hash"
    return None


def command_for_node(node: Dict[str, Any]) -> List[str]:
    python_command = node["python"]
    if node["transport"] == "local":
        return [python_command, "-"]
    if node["transport"] == "ssh":
        return [
            "ssh",
            "-o",
            "BatchMode=yes",
            "-o",
            "ConnectTimeout=10",
            node["host"],
            python_command,
            "-",
        ]
    raise ValueError("unsupported transport: %s" % node["transport"])


def text_tail(value: Any, limit: int = 1000) -> str:
    if value is None:
        return ""
    if isinstance(value, bytes):
        value = value.decode("utf-8", "replace")
    elif not isinstance(value, str):
        value = str(value)
    return value[-limit:]


def run_node(
    node: Dict[str, Any],
    harness: str,
    timeout: float,
    round_number: int,
) -> Dict[str, Any]:
    command = command_for_node(node)
    started = time.monotonic()
    try:
        completed = subprocess.run(
            command,
            input=harness.encode("utf-8"),
            capture_output=True,
            timeout=timeout,
            check=False,
        )
    except OSError as exc:
        return {
            "name": node["name"],
            "role": node.get("role", ""),
            "round": round_number,
            "ok": False,
            "status": "launch_error",
            "elapsed_ms": round((time.monotonic() - started) * 1000, 3),
            "error": str(exc),
            "stdout_tail": "",
            "stderr_tail": "",
        }
    except subprocess.TimeoutExpired as exc:
        return {
            "name": node["name"],
            "role": node.get("role", ""),
            "round": round_number,
            "ok": False,
            "status": "timeout",
            "elapsed_ms": round((time.monotonic() - started) * 1000, 3),
            "error": "node exceeded %.1fs timeout" % timeout,
            "stdout_tail": text_tail(exc.stdout),
            "stderr_tail": text_tail(exc.stderr),
        }

    elapsed_ms = round((time.monotonic() - started) * 1000, 3)
    if completed.returncode != 0:
        return {
            "name": node["name"],
            "role": node.get("role", ""),
            "round": round_number,
            "ok": False,
            "status": "process_error",
            "elapsed_ms": elapsed_ms,
            "error": "process exited %s" % completed.returncode,
            "stdout_tail": text_tail(completed.stdout),
            "stderr_tail": text_tail(completed.stderr),
        }

    try:
        stdout = completed.stdout.decode("utf-8")
        stderr = completed.stderr.decode("utf-8")
    except UnicodeDecodeError as exc:
        return {
            "name": node["name"],
            "role": node.get("role", ""),
            "round": round_number,
            "ok": False,
            "status": "invalid_output",
            "elapsed_ms": elapsed_ms,
            "error": "node output is not UTF-8: %s" % exc,
            "stdout_tail": text_tail(completed.stdout),
            "stderr_tail": text_tail(completed.stderr),
        }

    try:
        evidence = parse_harness_output(stdout)
    except (ValueError, json.JSONDecodeError) as exc:
        return {
            "name": node["name"],
            "role": node.get("role", ""),
            "round": round_number,
            "ok": False,
            "status": "invalid_output",
            "elapsed_ms": elapsed_ms,
            "error": str(exc),
            "stdout_tail": text_tail(stdout),
            "stderr_tail": text_tail(stderr),
        }
    schema_error = validate_evidence(evidence)
    if schema_error:
        return {
            "name": node["name"],
            "role": node.get("role", ""),
            "round": round_number,
            "ok": False,
            "status": "invalid_output",
            "elapsed_ms": elapsed_ms,
            "error": schema_error,
            "stdout_tail": text_tail(stdout),
            "stderr_tail": text_tail(stderr),
        }

    return {
        "name": node["name"],
        "role": node.get("role", ""),
        "round": round_number,
        "ok": bool(evidence.get("ok")),
        "status": "passed" if evidence.get("ok") else "failed",
        "elapsed_ms": elapsed_ms,
        "evidence": evidence,
        "stderr_tail": text_tail(stderr),
    }


def normalized_fixture_evidence(node_result: Dict[str, Any]) -> Optional[str]:
    evidence = node_result.get("evidence")
    if not evidence:
        return None
    normalized = []
    for fixture in evidence.get("fixtures", []):
        normalized.append(
            {
                "file": fixture["file"],
                "source_sha256": fixture["source_sha256"],
                "agent_name": fixture["agent_name"],
                "tool_schema_sha256": fixture["tool_schema_sha256"],
                "calls": [
                    {
                        "index": call["index"],
                        "args": call["args"],
                        "expected": call["expected"],
                        "actual": call["actual"],
                        "ok": call["ok"],
                        "output_sha256": call["output_sha256"],
                    }
                    for call in fixture["calls"]
                ],
                "ok": fixture["ok"],
            }
        )
    encoded = json.dumps(
        normalized,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=True,
    ).encode("utf-8")
    return sha256_bytes(encoded)


def run_round(
    nodes: Sequence[Dict[str, Any]],
    harness: str,
    timeout: float,
    round_number: int,
) -> List[Dict[str, Any]]:
    results = []
    with concurrent.futures.ThreadPoolExecutor(
        max_workers=max(1, len(nodes))
    ) as executor:
        futures = {
            executor.submit(
                run_node,
                node,
                harness,
                timeout,
                round_number,
            ): node
            for node in nodes
        }
        for future in concurrent.futures.as_completed(futures):
            results.append(future.result())
    return sorted(results, key=lambda item: item["name"])


def prove_tamper_rejection(
    controller: Dict[str, Any],
    cases: Sequence[Dict[str, Any]],
    timeout: float,
) -> Dict[str, Any]:
    fixture_name = cases[0]["agent_file"]
    payload = load_fixture_payload(cases, tamper_fixture=fixture_name)
    result = run_node(
        controller,
        build_harness(payload),
        timeout,
        round_number=0,
    )
    errors = result.get("evidence", {}).get("errors", [])
    rejected = any(
        item.get("code") == "source_hash_mismatch"
        for item in errors
    )
    return {
        "name": "tamper_rejection",
        "ok": rejected and not result.get("ok"),
        "fixture": fixture_name,
        "errors": errors,
    }


def prove_timeout_isolation() -> Dict[str, Any]:
    try:
        subprocess.run(
            [
                sys.executable,
                "-c",
                "import time; time.sleep(2)",
            ],
            capture_output=True,
            timeout=0.1,
            check=False,
        )
    except subprocess.TimeoutExpired:
        return {
            "name": "timeout_isolation",
            "ok": True,
            "limit_ms": 100,
        }
    return {
        "name": "timeout_isolation",
        "ok": False,
        "limit_ms": 100,
    }


def prove_launch_failure_isolation(harness: str) -> Dict[str, Any]:
    result = run_node(
        {
            "name": "missing-runtime",
            "role": "failure-proof",
            "transport": "local",
            "python": str(ROOT / ".fleetgate-runtime-does-not-exist"),
        },
        harness,
        timeout=1,
        round_number=0,
    )
    return {
        "name": "launch_failure_isolation",
        "ok": (
            not result.get("ok")
            and result.get("status") == "launch_error"
        ),
        "status": result.get("status"),
    }


def prove_malformed_output_isolation(
    controller: Dict[str, Any],
    valid_harness: str,
    timeout: float,
) -> Dict[str, Any]:
    truncated = run_node(
        controller,
        "print('{')",
        timeout=timeout,
        round_number=0,
    )
    schema_invalid = run_node(
        controller,
        (
            "import json\n"
            "print(json.dumps({'ok': True, 'fixtures': [{}]}))\n"
        ),
        timeout=timeout,
        round_number=0,
    )
    non_utf8 = run_node(
        controller,
        "import sys\nsys.stdout.buffer.write(bytes([255]))\n",
        timeout=timeout,
        round_number=0,
    )
    control = run_node(
        controller,
        valid_harness,
        timeout=timeout,
        round_number=0,
    )
    return {
        "name": "malformed_output_isolation",
        "ok": (
            truncated.get("status") == "invalid_output"
            and schema_invalid.get("status") == "invalid_output"
            and non_utf8.get("status") == "invalid_output"
            and control.get("ok") is True
        ),
        "truncated_status": truncated.get("status"),
        "schema_status": schema_invalid.get("status"),
        "non_utf8_status": non_utf8.get("status"),
        "control_status": control.get("status"),
    }


def fixture_matrix(
    node_results: Sequence[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    matrix = []
    for node in node_results:
        evidence = node.get("evidence") or {}
        for fixture in evidence.get("fixtures", []):
            matrix.append(
                {
                    "round": node["round"],
                    "node": node["name"],
                    "platform": evidence.get("platform"),
                    "python": evidence.get("python"),
                    "fixture": fixture["file"],
                    "source_sha256": fixture["source_sha256"],
                    "tool_schema_sha256": fixture["tool_schema_sha256"],
                    "calls": len(fixture["calls"]),
                    "ok": fixture["ok"],
                }
            )
    return matrix


def markdown_report(report: Dict[str, Any]) -> str:
    summary = report["summary"]
    lines = [
        "# FleetGate Evidence Report",
        "",
        "- Run: `%s`" % report["run_id"],
        "- Time: `%s`" % report["created_at"],
        "- Result: **%s**" % ("PASS" if summary["ok"] else "FAIL"),
        "- Nodes: `%s/%s`" % (
            summary["node_executions_passed"],
            summary["node_executions_total"],
        ),
        "- Deterministic evidence: `%s`" % summary["deterministic"],
        "- Tamper rejection: `%s`" % summary["tamper_rejected"],
        "- Timeout isolation: `%s`" % summary["timeout_isolated"],
        "",
        "## Node executions",
        "",
        "| round | node | role | result | elapsed | platform | Python | evidence |",
        "|---:|---|---|---|---:|---|---|---|",
    ]
    for item in report["node_results"]:
        evidence = item.get("evidence") or {}
        lines.append(
            "| {round} | {name} | {role} | {status} | {elapsed_ms} ms | "
            "{platform} | {python} | `{digest}` |".format(
                round=item["round"],
                name=item["name"],
                role=item.get("role", ""),
                status=item["status"],
                elapsed_ms=item["elapsed_ms"],
                platform=evidence.get("platform", "—"),
                python=evidence.get("python", "—"),
                digest=item.get("normalized_sha256") or "—",
            )
        )
    lines.extend(
        [
            "",
            "## Portability matrix",
            "",
            "| round | node | fixture | source | schema | calls | result |",
            "|---:|---|---|---|---|---:|---|",
        ]
    )
    for item in report["matrix"]:
        lines.append(
            "| {round} | {node} | {fixture} | `{source}` | `{schema}` | "
            "{calls} | {result} |".format(
                round=item["round"],
                node=item["node"],
                fixture=item["fixture"],
                source=item["source_sha256"][:12],
                schema=item["tool_schema_sha256"][:12],
                calls=item["calls"],
                result="PASS" if item["ok"] else "FAIL",
            )
        )
    lines.extend(
        [
            "",
            "## Safety proofs",
            "",
        ]
    )
    for proof in report["proofs"]:
        lines.append(
            "- **%s:** %s" % (
                proof["name"],
                "PASS" if proof["ok"] else "FAIL",
            )
        )
    lines.extend(
        [
            "",
            "## Rollback",
            "",
            "Delete this run directory. FleetGate made no persistent remote "
            "changes and used only process stdin plus temporary directories.",
            "",
        ]
    )
    return "\n".join(lines)


def junit_report(report: Dict[str, Any]) -> bytes:
    tests = []
    for item in report["node_results"]:
        tests.append(
            (
                "fleetgate.nodes.round%s" % item["round"],
                item["name"],
                item["ok"],
                item.get("error") or item["status"],
            )
        )
    for item in report["matrix"]:
        tests.append(
            (
                "%s.round%s" % (item["node"], item["round"]),
                item["fixture"],
                item["ok"],
                "",
            )
        )
    for proof in report["proofs"]:
        tests.append(
            (
                "fleetgate.proofs",
                proof["name"],
                proof["ok"],
                json.dumps(proof, sort_keys=True),
            )
        )
    summary = report["summary"]
    tests.append(
        (
            "fleetgate.summary",
            "deterministic",
            summary["deterministic"],
            "cross-node evidence hashes diverged",
        )
    )
    tests.append(
        (
            "fleetgate.summary",
            "overall",
            summary["ok"],
            json.dumps(summary, sort_keys=True),
        )
    )
    suite = ET.Element(
        "testsuite",
        {
            "name": "fleetgate",
            "tests": str(len(tests)),
            "failures": str(sum(1 for test in tests if not test[2])),
        },
    )
    for classname, name, ok, detail in tests:
        case = ET.SubElement(
            suite,
            "testcase",
            {"classname": classname, "name": name},
        )
        if not ok:
            failure = ET.SubElement(case, "failure", {"message": "FleetGate failure"})
            failure.text = detail
    return ET.tostring(suite, encoding="utf-8", xml_declaration=True)


def html_report(report: Dict[str, Any]) -> str:
    data = json.dumps(report, sort_keys=True, ensure_ascii=True).replace(
        "</",
        "<\\/",
    )
    return """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>FleetGate Evidence</title>
<script>
  (() => {
    const param = new URLSearchParams(window.location.search).get("scoutTheme");
    const theme =
      param || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    document.documentElement.setAttribute("data-theme", theme);
  })();
</script>
<style>
:root {
  color-scheme: light;
  --cp-bg: #f7f4ef;
  --cp-bg-elevated: #fcfbf8;
  --cp-surface: #ffffff;
  --cp-surface-soft: #f5f5f5;
  --cp-border: #dedede;
  --cp-border-strong: #919191;
  --cp-text: #242424;
  --cp-text-muted: #5c5c5c;
  --cp-text-soft: #6f6f6f;
  --cp-accent: #b11f4b;
  --cp-accent-hover: #9a1a41;
  --cp-accent-soft: rgba(177, 31, 75, 0.08);
  --cp-accent-fg: #ffffff;
  --cp-success: #16a34a;
  --cp-danger: #dc2626;
  --cp-warning: #f59e0b;
  --cp-link: #0078d4;
  --cp-shadow: 0 18px 48px rgba(0, 0, 0, 0.12);
  --cp-overlay: rgba(255, 255, 255, 0.8);
  --cp-panel: rgba(255, 255, 255, 0.86);
  --cp-panel-strong: rgba(255, 255, 255, 0.96);
  --cp-sheen: rgba(255, 255, 255, 0.55);
  --cp-highlight: rgba(177, 31, 75, 0.12);
}
html[data-theme="dark"] {
  color-scheme: dark;
  --cp-bg: #3d3b3a;
  --cp-bg-elevated: #343231;
  --cp-surface: #292929;
  --cp-surface-soft: #2e2e2e;
  --cp-border: #474747;
  --cp-border-strong: #5f5f5f;
  --cp-text: #dedede;
  --cp-text-muted: #919191;
  --cp-text-soft: #b0b0b0;
  --cp-accent: #fd8ea1;
  --cp-accent-hover: #fb7b91;
  --cp-accent-soft: rgba(253, 142, 161, 0.14);
  --cp-accent-fg: #1a1a1a;
  --cp-success: #4ade80;
  --cp-danger: #f87171;
  --cp-warning: #fbbf24;
  --cp-link: #4da6ff;
  --cp-shadow: 0 18px 48px rgba(0, 0, 0, 0.32);
  --cp-overlay: rgba(41, 41, 41, 0.88);
  --cp-panel: rgba(41, 41, 41, 0.72);
  --cp-panel-strong: rgba(41, 41, 41, 0.96);
  --cp-sheen: rgba(255, 255, 255, 0.04);
  --cp-highlight: rgba(253, 142, 161, 0.12);
}
*{box-sizing:border-box}
body{margin:0;background:var(--cp-bg);color:var(--cp-text);font-family:"Segoe UI",Aptos,Calibri,-apple-system,BlinkMacSystemFont,sans-serif}
code,.mono{font-family:Consolas,"Courier New",Courier,monospace}
.shell{width:min(1420px,calc(100% - 32px));margin:auto;padding:28px 0 56px}
.eyebrow{color:var(--cp-accent);font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase}
h1{margin:7px 0 8px;font-size:clamp(36px,6vw,72px);line-height:.95;letter-spacing:-.045em}
.sub{margin:0;color:var(--cp-text-muted);max-width:820px;line-height:1.5}
.hero{display:flex;justify-content:space-between;align-items:flex-start;gap:20px;margin-bottom:20px}
.button{border:1px solid var(--cp-border);border-radius:.625rem;background:var(--cp-surface);color:var(--cp-text);padding:9px 12px;font-weight:700;cursor:pointer}
.metrics{display:grid;grid-template-columns:repeat(6,1fr);gap:10px;margin-bottom:14px}
.metric,.card{border:1px solid var(--cp-border);border-radius:16px;background:var(--cp-surface);box-shadow:0 0 0 1px var(--cp-sheen)}
.metric{padding:14px}.metric strong{display:block;font-size:28px;margin-bottom:5px}.metric span{font-size:10px;color:var(--cp-text-muted)}
.pass{color:var(--cp-success)}.fail{color:var(--cp-danger)}
.grid{display:grid;grid-template-columns:1.2fr .8fr;gap:14px;margin-bottom:14px}
.head{display:flex;justify-content:space-between;align-items:center;padding:13px 15px;border-bottom:1px solid var(--cp-border)}
.head h2{font-size:15px;margin:0}.body{padding:14px}
.nodes{display:grid;grid-template-columns:repeat(2,1fr);gap:9px}
.node{border:1px solid var(--cp-border);border-left:5px solid var(--cp-success);border-radius:.625rem;padding:10px;background:var(--cp-surface-soft)}
.node.bad{border-left-color:var(--cp-danger)}.node strong{display:block;font-size:13px}.node span{font-size:10px;color:var(--cp-text-muted)}
.proof{display:flex;justify-content:space-between;gap:10px;padding:10px;border-bottom:1px solid var(--cp-border);font-size:12px}.proof:last-child{border:0}
.matrix{overflow:auto;max-height:520px}table{border-collapse:collapse;width:100%;min-width:850px}th,td{padding:9px 11px;border-bottom:1px solid var(--cp-border);text-align:left;font-size:10px}th{position:sticky;top:0;background:var(--cp-surface);color:var(--cp-text-muted);text-transform:uppercase}
.bar{height:7px;border-radius:.625rem;background:var(--cp-border);overflow:hidden;margin-top:7px}.bar i{display:block;height:100%;background:var(--cp-success)}
.footer{display:flex;justify-content:space-between;gap:20px;color:var(--cp-text-muted);font-size:10px;margin-top:14px}
@media(max-width:900px){.metrics{grid-template-columns:repeat(3,1fr)}.grid{grid-template-columns:1fr}}
@media(max-width:560px){.metrics{grid-template-columns:repeat(2,1fr)}.nodes{grid-template-columns:1fr}.hero{flex-direction:column}}
</style>
</head>
<body>
<main class="shell">
  <section class="hero">
    <div><div class="eyebrow">RAPP Moonshot · Tamper-Evident Portability</div><h1 id="title"></h1><p class="sub" id="subtitle"></p></div>
    <button class="button" id="theme">Toggle theme</button>
  </section>
  <section class="metrics" id="metrics"></section>
  <section class="grid">
    <article class="card"><div class="head"><h2>Fleet executions</h2><span class="mono" id="run"></span></div><div class="body nodes" id="nodes"></div></article>
    <article class="card"><div class="head"><h2>Safety proofs</h2><span>measured</span></div><div class="body" id="proofs"></div></article>
  </section>
  <article class="card"><div class="head"><h2>Portability evidence matrix</h2><span id="matrixCount"></span></div><div class="matrix"><table><thead><tr><th>Round</th><th>Node</th><th>Platform</th><th>Python</th><th>Agent</th><th>Source</th><th>Schema</th><th>Calls</th><th>Result</th></tr></thead><tbody id="matrix"></tbody></table></div></article>
  <footer class="footer"><span>No remote persistence or agent directories were modified.</span><span id="created"></span></footer>
</main>
<script>
const report=__REPORT__;
const s=report.summary;
const make=(tag,className,text)=>{
  const element=document.createElement(tag);
  if(className) element.className=className;
  if(text!==undefined) element.textContent=String(text);
  return element;
};
document.getElementById("title").textContent=s.ok?"FleetGate: PASS":"FleetGate: FAIL";
document.getElementById("title").className=s.ok?"pass":"fail";
document.getElementById("subtitle").textContent=`${s.node_executions_passed}/${s.node_executions_total} node executions · ${report.matrix.length} agent/node attestations · ${report.rounds} rounds`;
document.getElementById("run").textContent=report.run_id;
document.getElementById("created").textContent=report.created_at;
const metrics=[
  [s.node_executions_passed+"/"+s.node_executions_total,"node executions"],
  [report.matrix.filter(x=>x.ok).length+"/"+report.matrix.length,"matrix passes"],
  [s.deterministic?"YES":"NO","deterministic"],
  [s.tamper_rejected?"YES":"NO","tamper rejected"],
  [s.timeout_isolated?"YES":"NO","timeout isolated"],
  [s.remote_writes,"persistent remote writes"]
];
const metricsRoot=document.getElementById("metrics");
for(const [value,label] of metrics){
  const card=make("article","metric");
  card.append(make("strong","",value),make("span","",label));
  metricsRoot.append(card);
}
const nodesRoot=document.getElementById("nodes");
for(const node of report.node_results){
  const evidence=node.evidence||{};
  const card=make("div",`node ${node.ok?"":"bad"}`);
  card.append(
    make("strong","",`${node.name} · round ${node.round}`),
    make("span","",`${node.status} · ${node.elapsed_ms} ms · ${evidence.python||"—"} · ${(node.normalized_sha256||"—").slice(0,12)}`)
  );
  const bar=make("div","bar");
  const fill=make("i");
  fill.style.width=`${node.ok?100:12}%`;
  bar.append(fill);
  card.append(bar);
  nodesRoot.append(card);
}
const proofsRoot=document.getElementById("proofs");
for(const proof of report.proofs){
  const row=make("div","proof");
  row.append(
    make("strong","",proof.name.replaceAll("_"," ")),
    make("span",proof.ok?"pass":"fail",proof.ok?"PASS":"FAIL")
  );
  proofsRoot.append(row);
}
document.getElementById("matrixCount").textContent=report.matrix.length+" records";
const matrixRoot=document.getElementById("matrix");
for(const item of report.matrix){
  const row=document.createElement("tr");
  const values=[
    item.round,item.node,item.platform,item.python,item.fixture,
    item.source_sha256.slice(0,12),item.tool_schema_sha256.slice(0,12),
    item.calls,item.ok?"PASS":"FAIL"
  ];
  values.forEach((value,index)=>{
    const className=index===5||index===6?"mono":index===8?(item.ok?"pass":"fail"):"";
    row.append(make("td",className,value));
  });
  matrixRoot.append(row);
}
document.getElementById("theme").addEventListener("click",()=>{const h=document.documentElement;h.dataset.theme=h.dataset.theme==="dark"?"light":"dark"});
</script>
</body>
</html>
""".replace("__REPORT__", data)


def write_reports(report: Dict[str, Any], output_dir: Path) -> Dict[str, str]:
    output_dir.mkdir(parents=True, exist_ok=False)
    paths = {
        "lock": output_dir / "run.lock.json",
        "json": output_dir / "report.json",
        "markdown": output_dir / "report.md",
        "junit": output_dir / "junit.xml",
        "html": output_dir / "report.html",
        "manifest": output_dir / "evidence.sha256",
        "capsule": output_dir / "capsule.sha256",
    }
    paths["lock"].write_bytes(canonical_json_bytes(report["lock"]))
    paths["json"].write_text(
        json.dumps(report, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    paths["markdown"].write_text(
        markdown_report(report) + "\n",
        encoding="utf-8",
    )
    paths["junit"].write_bytes(junit_report(report))
    paths["html"].write_text(html_report(report), encoding="utf-8")

    manifest_lines = []
    for key in ("lock", "json", "markdown", "junit", "html"):
        path = paths[key]
        manifest_lines.append("%s  %s" % (sha256_file(path), path.name))
    manifest_bytes = ("\n".join(manifest_lines) + "\n").encode("ascii")
    paths["manifest"].write_bytes(manifest_bytes)
    capsule_hash = sha256_bytes(manifest_bytes)
    paths["capsule"].write_text(
        "%s  evidence.sha256\n" % capsule_hash,
        encoding="ascii",
    )
    result = {key: str(value) for key, value in paths.items()}
    result["capsule_sha256"] = capsule_hash
    return result


def verify_evidence_directory(
    run_dir: Path,
    expected_capsule_hash: str,
) -> Dict[str, Any]:
    run_dir = run_dir.resolve()
    if not re.fullmatch(r"[0-9a-f]{64}", expected_capsule_hash):
        raise ValueError("expected capsule hash must be 64 lowercase hex characters")
    manifest_path = run_dir / "evidence.sha256"
    capsule_path = run_dir / "capsule.sha256"
    if not manifest_path.is_file() or not capsule_path.is_file():
        raise ValueError("evidence manifest or capsule root is missing")

    manifest_bytes = manifest_path.read_bytes()
    expected_capsule_line = capsule_path.read_text(
        encoding="ascii"
    ).strip()
    parts = expected_capsule_line.split("  ", 1)
    if (
        len(parts) != 2
        or parts[1] != "evidence.sha256"
        or not re.fullmatch(r"[0-9a-f]{64}", parts[0])
    ):
        raise ValueError("invalid capsule root format")
    actual_capsule_hash = sha256_bytes(manifest_bytes)
    if actual_capsule_hash != expected_capsule_hash:
        raise ValueError("evidence manifest does not match trusted capsule hash")
    if parts[0] != expected_capsule_hash:
        raise ValueError("in-bundle capsule root does not match trusted hash")

    expected_files = {
        "run.lock.json",
        "report.json",
        "report.md",
        "junit.xml",
        "report.html",
    }
    seen = set()
    for raw_line in manifest_bytes.decode("ascii").splitlines():
        match = re.fullmatch(
            r"([0-9a-f]{64})  ([A-Za-z0-9._-]+)",
            raw_line,
        )
        if not match:
            raise ValueError("invalid evidence manifest line")
        expected_hash, filename = match.groups()
        if filename in seen:
            raise ValueError("duplicate evidence manifest entry")
        seen.add(filename)
        path = (run_dir / filename).resolve()
        if path.parent != run_dir or not path.is_file():
            raise ValueError("invalid evidence path: %s" % filename)
        if sha256_file(path) != expected_hash:
            raise ValueError("evidence hash mismatch: %s" % filename)
    if seen != expected_files:
        raise ValueError("evidence manifest file set is incomplete")

    lock = load_json(run_dir / "run.lock.json")
    report = load_json(run_dir / "report.json")
    lock_hash = sha256_bytes(canonical_json_bytes(lock))
    if report.get("lock_sha256") != lock_hash:
        raise ValueError("report lock hash does not match run.lock.json")
    if report.get("lock") != lock:
        raise ValueError("embedded report lock does not match lock file")
    if (
        report.get("inventory_sha256")
        != lock.get("inputs", {}).get("inventory_sha256")
        or report.get("cases_sha256")
        != lock.get("inputs", {}).get("cases_sha256")
    ):
        raise ValueError("report input hashes do not match run lock")
    return {
        "ok": True,
        "run_id": report.get("run_id"),
        "capsule_sha256": actual_capsule_hash,
        "files": sorted(seen),
    }


def select_nodes(
    inventory: Dict[str, Any],
    names: Sequence[str],
) -> List[Dict[str, Any]]:
    nodes = inventory.get("nodes")
    if not isinstance(nodes, list) or not nodes:
        raise ValueError("inventory must contain a non-empty nodes list")
    seen = set()
    selected = []
    requested = set(names)
    for node in nodes:
        name = node.get("name")
        if not name or name in seen:
            raise ValueError("node names must be present and unique")
        seen.add(name)
        if requested and name not in requested:
            continue
        if node.get("transport") not in {"local", "ssh"}:
            raise ValueError("invalid transport for %s" % name)
        if not node.get("python"):
            raise ValueError("missing Python command for %s" % name)
        if node["transport"] == "ssh" and not node.get("host"):
            raise ValueError("missing SSH host for %s" % name)
        selected.append(node)
    missing = requested - {node["name"] for node in selected}
    if missing:
        raise ValueError("unknown node(s): %s" % ", ".join(sorted(missing)))
    return selected


def verify(args: argparse.Namespace) -> int:
    inventory_path = Path(args.inventory).resolve()
    cases_path = Path(args.cases).resolve()
    inventory, inventory_hash = read_json_snapshot(inventory_path)
    cases, cases_hash = read_json_snapshot(cases_path)
    nodes = select_nodes(inventory, args.nodes)
    if args.rounds < 1:
        raise ValueError("--rounds must be at least 1")

    payload = load_fixture_payload(cases)
    harness = build_harness(payload)
    run_lock = build_run_lock(
        nodes,
        payload,
        harness,
        inventory_hash,
        cases_hash,
        args.rounds,
        args.timeout,
    )
    lock_hash = sha256_bytes(canonical_json_bytes(run_lock))
    all_results = []
    started = time.monotonic()
    for round_number in range(1, args.rounds + 1):
        print("round %s/%s" % (round_number, args.rounds))
        round_results = run_round(
            nodes,
            harness,
            args.timeout,
            round_number,
        )
        for result in round_results:
            result["normalized_sha256"] = normalized_fixture_evidence(result)
            print(
                "  {name:<16} {status:<13} {elapsed_ms:>9.1f} ms".format(
                    **result
                )
            )
        all_results.extend(round_results)

    controller = next(
        (node for node in nodes if node["transport"] == "local"),
        nodes[0],
    )
    proofs = [
        prove_tamper_rejection(controller, cases, args.timeout),
        prove_timeout_isolation(),
        prove_launch_failure_isolation(harness),
        prove_malformed_output_isolation(
            controller,
            harness,
            args.timeout,
        ),
    ]
    evidence_hashes = {
        result.get("normalized_sha256")
        for result in all_results
        if result.get("normalized_sha256")
    }
    deterministic = (
        len(evidence_hashes) == 1
        and len(evidence_hashes) == len(
            {
                result.get("normalized_sha256")
                for result in all_results
                if result.get("ok")
            }
        )
        and all(result.get("ok") for result in all_results)
    )
    # The first condition above intentionally makes missing evidence fail.
    deterministic = (
        deterministic
        and len(all_results) == len(nodes) * args.rounds
        and all(result.get("normalized_sha256") for result in all_results)
    )
    passed = sum(1 for result in all_results if result.get("ok"))
    overall_ok = (
        passed == len(all_results)
        and deterministic
        and all(proof["ok"] for proof in proofs)
    )
    run_id = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S") + "-" + uuid.uuid4().hex[:8]
    report = {
        "schema_version": 1,
        "run_id": run_id,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "controller": {
            "hostname": platform.node(),
            "platform": platform.platform(),
            "python": platform.python_version(),
        },
        "inventory_sha256": inventory_hash,
        "cases_sha256": cases_hash,
        "lock_sha256": lock_hash,
        "lock": run_lock,
        "rounds": args.rounds,
        "duration_ms": round((time.monotonic() - started) * 1000, 3),
        "node_results": all_results,
        "matrix": fixture_matrix(all_results),
        "proofs": proofs,
        "summary": {
            "ok": overall_ok,
            "node_executions_total": len(all_results),
            "node_executions_passed": passed,
            "deterministic": bool(deterministic),
            "tamper_rejected": proofs[0]["ok"],
            "timeout_isolated": proofs[1]["ok"],
            "launch_failure_isolated": proofs[2]["ok"],
            "malformed_output_isolated": proofs[3]["ok"],
            "remote_writes": 0,
        },
    }
    output_root = Path(args.output).resolve()
    output_dir = output_root / run_id
    paths = write_reports(report, output_dir)
    print("\nFleetGate: %s" % ("PASS" if overall_ok else "FAIL"))
    print("report: %s" % paths["html"])
    print("manifest: %s" % paths["manifest"])
    print("capsule: %s" % paths["capsule_sha256"])
    if args.open:
        webbrowser.open(Path(paths["html"]).as_uri())
    return 0 if overall_ok else 1


def verify_bundle(args: argparse.Namespace) -> int:
    result = verify_evidence_directory(
        Path(args.run_dir),
        args.expected_capsule,
    )
    print("FleetGate evidence: PASS")
    print("run: %s" % result["run_id"])
    print("capsule: %s" % result["capsule_sha256"])
    print("files: %s" % len(result["files"]))
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Run a tamper-evident RAPP portability gate across a fleet."
    )
    subparsers = parser.add_subparsers(dest="command", required=True)
    verify_parser = subparsers.add_parser(
        "verify",
        help="run reviewed deterministic agents on every selected node",
    )
    verify_parser.add_argument(
        "--inventory",
        default=str(DEFAULT_INVENTORY),
    )
    verify_parser.add_argument(
        "--cases",
        default=str(DEFAULT_CASES),
    )
    verify_parser.add_argument(
        "--output",
        default=str(RESULTS_DIR),
    )
    verify_parser.add_argument(
        "--nodes",
        nargs="*",
        default=[],
        help="optional node names; default is every inventory node",
    )
    verify_parser.add_argument("--rounds", type=int, default=1)
    verify_parser.add_argument("--timeout", type=float, default=45.0)
    verify_parser.add_argument("--open", action="store_true")
    verify_parser.set_defaults(func=verify)
    evidence_parser = subparsers.add_parser(
        "verify-evidence",
        help="verify a saved evidence bundle without contacting the fleet",
    )
    evidence_parser.add_argument("run_dir")
    evidence_parser.add_argument(
        "--expected-capsule",
        required=True,
        help="trusted SHA-256 printed when the capsule was created",
    )
    evidence_parser.set_defaults(func=verify_bundle)
    return parser


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        return args.func(args)
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print("FleetGate configuration error: %s" % exc, file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
