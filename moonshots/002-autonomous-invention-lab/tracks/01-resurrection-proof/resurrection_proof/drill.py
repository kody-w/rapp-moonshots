"""Deterministic, offline recovery drill for a synthetic RAPP estate."""

from __future__ import annotations

import hashlib
import json
import re
import secrets
import shutil
import time
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from typing import Any, Callable


PHASES = (
    {
        "id": "isolate",
        "label": "Isolate",
        "description": "Create a private, ephemeral workspace.",
    },
    {
        "id": "restore",
        "label": "Restore",
        "description": "Rehydrate the synthetic RAPP estate.",
    },
    {
        "id": "verify",
        "label": "Verify",
        "description": "Check inventory, sizes, and SHA-256 manifest.",
    },
    {
        "id": "canaries",
        "label": "Canaries",
        "description": "Exercise recovered behaviors, not just files.",
    },
    {
        "id": "corrupt",
        "label": "Corrupt",
        "description": "Inject one controlled synthetic mutation.",
    },
    {
        "id": "prove",
        "label": "Prove",
        "description": "Require the corruption guard to hard-fail.",
    },
    {
        "id": "receipt",
        "label": "Receipt",
        "description": "Clean up and issue public-safe evidence.",
    },
)

ProgressCallback = Callable[[dict[str, Any]], None]
_DRILL_ID = re.compile(r"^rp-[A-Za-z0-9-]{3,80}$")
_SHA256 = re.compile(r"^[0-9a-f]{64}$")


class DrillFailure(RuntimeError):
    """A recovery failure with a public-safe machine code."""

    def __init__(self, code: str, message: str, *, file: str | None = None):
        super().__init__(message)
        self.code = code
        self.public_message = message
        self.file = file


class VerificationFailure(DrillFailure):
    """A manifest or inventory verification failure."""


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace(
        "+00:00", "Z"
    )


def _read_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise DrillFailure("INVALID_JSON", f"{path.name} is not valid fixture JSON.") from exc


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(64 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _safe_manifest_path(value: Any) -> str:
    if not isinstance(value, str) or not value:
        raise DrillFailure("INVALID_MANIFEST", "Manifest contains an invalid file name.")
    candidate = PurePosixPath(value)
    if candidate.is_absolute() or ".." in candidate.parts or value != candidate.as_posix():
        raise DrillFailure("UNSAFE_MANIFEST_PATH", "Manifest contains an unsafe file name.")
    if value == "manifest.json":
        raise DrillFailure("INVALID_MANIFEST", "Manifest cannot inventory itself.")
    return value


def load_manifest(estate_root: Path) -> dict[str, Any]:
    manifest = _read_json(estate_root / "manifest.json")
    if not isinstance(manifest, dict):
        raise DrillFailure("INVALID_MANIFEST", "Fixture manifest must be an object.")
    if manifest.get("schema") != "resurrection-proof-manifest/v1":
        raise DrillFailure("INVALID_MANIFEST", "Fixture manifest schema is unsupported.")
    raw_files = manifest.get("files")
    if not isinstance(raw_files, list) or not raw_files:
        raise DrillFailure("INVALID_MANIFEST", "Fixture manifest has no inventory.")

    seen: set[str] = set()
    normalized: list[dict[str, Any]] = []
    for entry in raw_files:
        if not isinstance(entry, dict):
            raise DrillFailure("INVALID_MANIFEST", "Manifest file entry is invalid.")
        relative = _safe_manifest_path(entry.get("path"))
        digest = entry.get("sha256")
        size = entry.get("bytes")
        if relative in seen:
            raise DrillFailure("INVALID_MANIFEST", "Manifest contains a duplicate file.")
        if not isinstance(digest, str) or not _SHA256.fullmatch(digest):
            raise DrillFailure("INVALID_MANIFEST", "Manifest contains an invalid digest.")
        if not isinstance(size, int) or isinstance(size, bool) or size < 0:
            raise DrillFailure("INVALID_MANIFEST", "Manifest contains an invalid file size.")
        seen.add(relative)
        normalized.append({"path": relative, "sha256": digest, "bytes": size})

    return {
        "schema": manifest["schema"],
        "estate_id": manifest.get("estate_id"),
        "files": normalized,
    }


def scan_inventory(estate_root: Path) -> dict[str, int]:
    inventory: dict[str, int] = {}
    for path in sorted(estate_root.rglob("*")):
        if path.is_symlink():
            raise VerificationFailure(
                "SYMLINK_REJECTED", "Recovered inventory contains a symbolic link."
            )
        if not path.is_file():
            continue
        relative = path.relative_to(estate_root).as_posix()
        if relative == "manifest.json":
            continue
        inventory[relative] = path.stat().st_size
    return inventory


def verify_inventory(estate_root: Path) -> dict[str, int]:
    manifest = load_manifest(estate_root)
    expected = {entry["path"]: entry["bytes"] for entry in manifest["files"]}
    observed = scan_inventory(estate_root)
    if set(observed) != set(expected):
        raise VerificationFailure(
            "INVENTORY_MISMATCH", "Recovered file inventory does not match the manifest."
        )
    for relative, expected_size in expected.items():
        if observed[relative] != expected_size:
            raise VerificationFailure(
                "SIZE_MISMATCH",
                f"Recovered file size is wrong for {relative}.",
                file=relative,
            )
    return {
        "files": len(observed),
        "bytes": sum(observed.values()),
    }


def verify_manifest(estate_root: Path) -> dict[str, int]:
    manifest = load_manifest(estate_root)
    for entry in manifest["files"]:
        relative = entry["path"]
        candidate = estate_root.joinpath(*PurePosixPath(relative).parts)
        if not candidate.is_file() or candidate.is_symlink():
            raise VerificationFailure(
                "FILE_MISSING", f"Recovered file is missing: {relative}.", file=relative
            )
        if _sha256_file(candidate) != entry["sha256"]:
            raise VerificationFailure(
                "CHECKSUM_MISMATCH",
                f"SHA-256 mismatch detected for {relative}.",
                file=relative,
            )
    return {"files": len(manifest["files"])}


def _assert_synthetic_fixture(
    fixture_root: Path,
) -> tuple[dict[str, Any], int]:
    estate = _read_json(fixture_root / "estate.json")
    policy = _read_json(fixture_root / "policy" / "recovery.json")
    if (
        not isinstance(estate, dict)
        or estate.get("synthetic") is not True
        or estate.get("classification") != "synthetic-public-fixture"
    ):
        raise DrillFailure(
            "NON_SYNTHETIC_FIXTURE", "Recovery drills accept synthetic fixtures only."
        )
    if not isinstance(policy, dict) or policy.get("network_access") is not False:
        raise DrillFailure(
            "UNSAFE_FIXTURE_POLICY", "Fixture policy must explicitly disable network access."
        )
    if policy.get("allowed_classification") != estate["classification"]:
        raise DrillFailure(
            "UNSAFE_FIXTURE_POLICY", "Fixture classification is not allowed by policy."
        )
    required_canaries = policy.get("required_canaries")
    if (
        not isinstance(required_canaries, int)
        or isinstance(required_canaries, bool)
        or required_canaries < 3
    ):
        raise DrillFailure(
            "UNSAFE_FIXTURE_POLICY", "Fixture policy must require at least three canaries."
        )
    return estate, required_canaries


class RecoveredEstate:
    """Tiny deterministic behavior surface exercised by the canaries."""

    def __init__(self, root: Path):
        self.root = root

    def discover_agents(self) -> list[str]:
        registry = _read_json(self.root / "registry" / "agents.json")
        agents = registry.get("agents", []) if isinstance(registry, dict) else []
        return sorted(
            agent["id"]
            for agent in agents
            if isinstance(agent, dict)
            and agent.get("enabled") is True
            and isinstance(agent.get("id"), str)
        )

    def greet(self, name: str) -> str:
        definition = _read_json(self.root / "agents" / "greeter.json")
        behavior = definition.get("behavior", {}) if isinstance(definition, dict) else {}
        if behavior.get("kind") != "template" or not isinstance(
            behavior.get("template"), str
        ):
            raise DrillFailure("INVALID_BEHAVIOR", "Greeter behavior is invalid.")
        return behavior["template"].format(name=name)

    def recall(self, key: str) -> str | None:
        memory = _read_json(self.root / "memory" / "facts.json")
        facts = memory.get("facts", {}) if isinstance(memory, dict) else {}
        value = facts.get(key) if isinstance(facts, dict) else None
        return value if isinstance(value, str) else None

    def route(self, capability: str) -> str | None:
        registry = _read_json(self.root / "registry" / "agents.json")
        agents = registry.get("agents", []) if isinstance(registry, dict) else []
        candidates = sorted(
            agent["id"]
            for agent in agents
            if isinstance(agent, dict)
            and agent.get("enabled") is True
            and isinstance(agent.get("id"), str)
            and capability in agent.get("capabilities", [])
        )
        return candidates[0] if candidates else None


def run_behavioral_canaries(estate_root: Path) -> list[dict[str, Any]]:
    estate = RecoveredEstate(estate_root)
    checks: tuple[tuple[str, str, Callable[[], tuple[Any, Any, str]]], ...] = (
        (
            "agent-discovery",
            "Enabled agents are discoverable",
            lambda: (
                estate.discover_agents(),
                ["archivist", "greeter"],
                "2 enabled agents discovered",
            ),
        ),
        (
            "greeting-contract",
            "Greeter preserves its response contract",
            lambda: (
                estate.greet("Ada"),
                "Hello, Ada — recovery is ready.",
                "exact synthetic greeting returned",
            ),
        ),
        (
            "memory-recall",
            "Synthetic memory can be recalled",
            lambda: (
                estate.recall("project_codename"),
                "Phoenix Fixture",
                "synthetic codename recalled",
            ),
        ),
        (
            "capability-routing",
            "Capability routing selects the archivist",
            lambda: (
                estate.route("memory-recall"),
                "archivist",
                "memory-recall routed to archivist",
            ),
        ),
    )

    results: list[dict[str, Any]] = []
    for canary_id, name, check in checks:
        started = time.perf_counter()
        observed, expected, evidence = check()
        duration_ms = round((time.perf_counter() - started) * 1000, 3)
        if observed != expected:
            raise DrillFailure(
                "CANARY_FAILED", f"Behavioral canary failed: {canary_id}."
            )
        results.append(
            {
                "id": canary_id,
                "name": name,
                "status": "pass",
                "duration_ms": duration_ms,
                "evidence": evidence,
            }
        )
    return results


def inject_controlled_corruption(estate_root: Path) -> str:
    relative = "memory/facts.json"
    target = estate_root / "memory" / "facts.json"
    original = target.read_text(encoding="utf-8")
    clean_value = "Phoenix Fixture"
    corrupt_value = "Corrupt Fixture"
    if len(clean_value.encode()) != len(corrupt_value.encode()) or clean_value not in original:
        raise DrillFailure(
            "CORRUPTION_SETUP_FAILED", "Controlled corruption precondition was not met."
        )
    target.write_text(original.replace(clean_value, corrupt_value, 1), encoding="utf-8")
    return relative


def assert_public_safe_receipt(receipt: dict[str, Any]) -> None:
    blocked_keys = {
        "absolute_path",
        "credential",
        "environment",
        "home",
        "hostname",
        "ip_address",
        "secret",
        "token",
        "username",
        "workspace",
        "workspace_path",
    }
    home = str(Path.home())

    def inspect(value: Any, key: str | None = None) -> None:
        if key is not None and key.lower() in blocked_keys:
            raise DrillFailure(
                "UNSAFE_RECEIPT", "Receipt contains a prohibited private field."
            )
        if isinstance(value, dict):
            for child_key, child in value.items():
                inspect(child, str(child_key))
        elif isinstance(value, list):
            for child in value:
                inspect(child, key)
        elif isinstance(value, str):
            if (
                value.startswith("/")
                or value.startswith("file:")
                or re.match(r"^[A-Za-z]:[\\/]", value)
                or (home and home in value)
            ):
                raise DrillFailure(
                    "UNSAFE_RECEIPT", "Receipt contains a local filesystem location."
                )

    inspect(receipt)


def _emit(
    callback: ProgressCallback | None,
    phase: str,
    status: str,
    progress: int,
    message: str,
) -> None:
    if callback is not None:
        callback(
            {
                "phase": phase,
                "status": status,
                "progress": progress,
                "message": message,
            }
        )


def _pause(step_delay: float) -> None:
    if step_delay > 0:
        time.sleep(step_delay)


def _create_workspace(runtime_root: Path, drill_id: str) -> Path:
    if not _DRILL_ID.fullmatch(drill_id):
        raise DrillFailure("INVALID_DRILL_ID", "Drill identifier is invalid.")
    runtime_root.mkdir(parents=True, exist_ok=True, mode=0o700)
    workspace = runtime_root / f"{drill_id}-{secrets.token_hex(4)}"
    workspace.mkdir(mode=0o700)
    return workspace


def execute_drill(
    fixture_root: Path,
    runtime_root: Path,
    drill_id: str,
    *,
    progress: ProgressCallback | None = None,
    step_delay: float = 0.0,
) -> dict[str, Any]:
    """Restore, verify, exercise, corrupt, detect, clean, and return a receipt."""

    started_wall = _utc_now()
    started = time.perf_counter()
    workspace: Path | None = None
    receipt: dict[str, Any] | None = None

    try:
        _emit(progress, "isolate", "running", 3, "Opening isolated workspace")
        scan_inventory(fixture_root)
        fixture_metadata, required_canaries = _assert_synthetic_fixture(fixture_root)
        source_manifest = load_manifest(fixture_root)
        if source_manifest["estate_id"] != fixture_metadata.get("estate_id"):
            raise DrillFailure(
                "FIXTURE_ID_MISMATCH", "Fixture identity does not match its manifest."
            )
        verify_inventory(fixture_root)
        verify_manifest(fixture_root)
        workspace = _create_workspace(runtime_root, drill_id)
        _pause(step_delay)
        _emit(progress, "isolate", "pass", 12, "Isolated workspace ready")

        _emit(progress, "restore", "running", 16, "Restoring synthetic estate")
        restored_root = workspace / "estate"
        shutil.copytree(fixture_root, restored_root, symlinks=False)
        _pause(step_delay)
        _emit(progress, "restore", "pass", 30, "Synthetic estate restored")

        _emit(progress, "verify", "running", 35, "Comparing inventory and manifest")
        inventory_result = verify_inventory(restored_root)
        manifest_result = verify_manifest(restored_root)
        manifest_digest = _sha256_file(restored_root / "manifest.json")
        recovery_seconds = round(time.perf_counter() - started, 4)
        _pause(step_delay)
        _emit(
            progress,
            "verify",
            "pass",
            48,
            f"{manifest_result['files']} files match SHA-256 manifest",
        )

        _emit(progress, "canaries", "running", 52, "Running behavioral canaries")
        canaries = run_behavioral_canaries(restored_root)
        passed_canaries = sum(
            canary.get("status") == "pass" for canary in canaries
        )
        if (
            len(canaries) < required_canaries
            or passed_canaries < required_canaries
        ):
            raise DrillFailure(
                "INSUFFICIENT_CANARIES",
                (
                    f"Fixture requires {required_canaries} passing canaries; "
                    f"{passed_canaries} of {len(canaries)} executed canaries passed."
                ),
            )
        _pause(step_delay)
        _emit(
            progress,
            "canaries",
            "pass",
            67,
            (
                f"{passed_canaries} canaries passed; "
                f"{required_canaries} required"
            ),
        )

        _emit(
            progress,
            "corrupt",
            "running",
            71,
            "Injecting controlled same-size mutation",
        )
        corrupted_file = inject_controlled_corruption(restored_root)
        post_corruption_inventory = verify_inventory(restored_root)
        _pause(step_delay)
        _emit(
            progress,
            "corrupt",
            "pass",
            78,
            "Controlled mutation injected; inventory still looks valid",
        )

        _emit(
            progress,
            "prove",
            "running",
            82,
            "Demanding a hard failure from integrity guard",
        )
        detector_error: VerificationFailure | None = None
        try:
            verify_manifest(restored_root)
        except VerificationFailure as exc:
            detector_error = exc
        if detector_error is None:
            raise DrillFailure(
                "CORRUPTION_NOT_DETECTED",
                "Integrity guard accepted the controlled corruption.",
            )
        if (
            detector_error.code != "CHECKSUM_MISMATCH"
            or detector_error.file != corrupted_file
        ):
            raise DrillFailure(
                "WRONG_FAILURE_MODE",
                "Corruption guard failed for an unexpected reason.",
            )
        corrupted_recall = RecoveredEstate(restored_root).recall("project_codename")
        if corrupted_recall == "Phoenix Fixture":
            raise DrillFailure(
                "CORRUPTION_NOT_EFFECTIVE",
                "Controlled mutation did not change recovered behavior.",
            )
        _pause(step_delay)
        _emit(
            progress,
            "prove",
            "hard_fail",
            91,
            "Integrity guard hard-failed exactly as required",
        )

        receipt = {
            "receipt_schema": "resurrection-proof/receipt-v1",
            "receipt_id": drill_id,
            "generated_at": _utc_now(),
            "application": {"name": "Resurrection Proof", "version": "1.0.0"},
            "outcome": "PASS",
            "claim": (
                "A synthetic RAPP estate was restored, exercised, and its "
                "controlled corruption was rejected."
            ),
            "fixture": {
                "estate_id": fixture_metadata["estate_id"],
                "name": fixture_metadata["name"],
                "classification": fixture_metadata["classification"],
                "manifest_sha256": manifest_digest,
            },
            "metrics": {
                "recovery_seconds": recovery_seconds,
                "files_restored": inventory_result["files"],
                "bytes_restored": inventory_result["bytes"],
                "files_manifest_verified": manifest_result["files"],
                "canaries_passed": passed_canaries,
                "canaries_total": len(canaries),
                "canaries_required": required_canaries,
                "corruptions_injected": 1,
                "corruptions_detected": 1,
            },
            "verification": {
                "inventory": "pass",
                "file_sizes": "pass",
                "sha256_manifest": "pass",
            },
            "canaries": canaries,
            "controlled_corruption": {
                "target_file": corrupted_file,
                "mutation": "same-size synthetic value substitution",
                "inventory_after_mutation": (
                    "pass"
                    if post_corruption_inventory["files"] == inventory_result["files"]
                    else "fail"
                ),
                "expected_guard_result": "hard_fail",
                "observed_guard_result": "hard_fail",
                "detector": "sha256_manifest",
                "error_code": detector_error.code,
                "behavioral_impact_observed": True,
            },
            "phases": [
                {
                    "id": phase["id"],
                    "label": phase["label"],
                    "status": (
                        "hard_fail_as_designed"
                        if phase["id"] == "prove"
                        else "pass"
                    ),
                }
                for phase in PHASES
            ],
            "safety": {
                "fixture_only": True,
                "synthetic_data_only": True,
                "network_access": False,
                "remote_machines_contacted": 0,
                "live_brainstems_contacted": 0,
                "credentials_used": False,
                "local_locations_redacted": True,
                "ephemeral_workspace_removed": False,
            },
            "started_at": started_wall,
        }
    finally:
        if workspace is not None and workspace.exists():
            shutil.rmtree(workspace)

    if receipt is None:
        raise DrillFailure("RECEIPT_NOT_CREATED", "Recovery receipt was not created.")

    receipt["safety"]["ephemeral_workspace_removed"] = True
    receipt["metrics"]["drill_seconds"] = round(time.perf_counter() - started, 4)
    assert_public_safe_receipt(receipt)
    _emit(progress, "receipt", "pass", 100, "Public-safe recovery receipt ready")
    return receipt
