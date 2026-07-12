"""Bounded counterfactual experiment orchestration."""

import hashlib
import json
import shutil
import subprocess
import sys
import time
import uuid
from pathlib import Path
from typing import Callable, Dict, List, Optional

from .scenarios import BOUNDS, SCENARIOS, Intervention, Scenario


ProgressCallback = Optional[Callable[[dict], None]]


class UnknownScenarioError(ValueError):
    """Raised when input is not one of the seeded scenario identifiers."""


class FixtureExecutionError(RuntimeError):
    """Raised when the fixed fixture does not return valid evidence."""


class ExperimentRunner:
    """Run fixed fixtures in disposable, track-local isolated workspaces."""

    repetitions = 3

    def __init__(self, runtime_root: Optional[Path] = None) -> None:
        track_root = Path(__file__).resolve().parent.parent
        self.runtime_root = Path(
            runtime_root or track_root / ".runtime" / "workspaces"
        ).resolve()
        try:
            self.runtime_root.relative_to(track_root)
        except ValueError as error:
            raise ValueError("Runtime workspaces must remain inside Track 02") from error
        self.fixture_path = (Path(__file__).resolve().parent / "fixture.py").resolve()

    def run(
        self,
        scenario_id: str,
        progress: ProgressCallback = None,
        experiment_id: Optional[str] = None,
    ) -> dict:
        if scenario_id not in SCENARIOS:
            raise UnknownScenarioError("Unknown seeded scenario: {0}".format(scenario_id))
        scenario = SCENARIOS[scenario_id]
        run_id = experiment_id or uuid.uuid4().hex
        started = time.perf_counter()
        total_trials = self.repetitions * (1 + len(scenario.interventions))
        completed = 0

        self._notify(
            progress,
            stage="capturing",
            completed=completed,
            total=total_trials,
            message="Capturing the failing baseline in three fresh workspaces",
        )
        baseline_environment = scenario.baseline_dict()
        baseline_trials: List[dict] = []
        for repetition in range(1, self.repetitions + 1):
            trial = self._run_trial(
                scenario, baseline_environment, "baseline", repetition, run_id
            )
            baseline_trials.append(trial)
            completed += 1
            self._notify(
                progress,
                stage="capturing",
                completed=completed,
                total=total_trials,
                message="Baseline repeat {0}/{1}: {2}".format(
                    repetition, self.repetitions, trial["status"]
                ),
            )

        baseline_statuses = [trial["passed"] for trial in baseline_trials]
        if len(set(baseline_statuses)) != 1:
            raise FixtureExecutionError("Seeded baseline was not repeatable")
        baseline_passed = baseline_statuses[0]

        interventions: List[dict] = []
        first_flip: Optional[dict] = None
        for index, mutation in enumerate(scenario.interventions, start=1):
            candidate = self._single_variable_candidate(
                baseline_environment, mutation
            )
            self._notify(
                progress,
                stage="intervening",
                completed=completed,
                total=total_trials,
                message="Changing only {0}: {1} → {2}".format(
                    mutation.variable,
                    baseline_environment[mutation.variable],
                    mutation.to_value,
                ),
            )
            trials = []
            for repetition in range(1, self.repetitions + 1):
                trial = self._run_trial(
                    scenario,
                    candidate,
                    "intervention-{0}".format(index),
                    repetition,
                    run_id,
                )
                trials.append(trial)
                completed += 1
                self._notify(
                    progress,
                    stage="intervening",
                    completed=completed,
                    total=total_trials,
                    message="{0} repeat {1}/{2}: {3}".format(
                        mutation.variable,
                        repetition,
                        self.repetitions,
                        trial["status"],
                    ),
                )

            statuses = [trial["passed"] for trial in trials]
            repeatable = len(set(statuses)) == 1
            flipped = repeatable and statuses[0] != baseline_passed
            result = {
                "order": index,
                "variable": mutation.variable,
                "from": baseline_environment[mutation.variable],
                "to": mutation.to_value,
                "rationale": mutation.rationale,
                "changed_variable_count": 1,
                "trials": trials,
                "pass_count": sum(1 for status in statuses if status),
                "repeatable": repeatable,
                "flipped": flipped,
            }
            interventions.append(result)
            if flipped:
                first_flip = result
                break

        if first_flip is None:
            raise FixtureExecutionError("No repeatable pass/fail flip was found")
        if (
            first_flip["variable"] != scenario.causal_variable
            or first_flip["to"] != scenario.causal_value
        ):
            raise FixtureExecutionError("Seeded causal control produced an unexpected result")

        duration_ms = round((time.perf_counter() - started) * 1000, 2)
        baseline_label = "PASS" if baseline_passed else "FAIL"
        flipped_label = "FAIL" if baseline_passed else "PASS"
        prior_controls = len(interventions) - 1
        causal_claim = (
            "Changing {variable} from {old} to {new} was the first intervention to flip "
            "the fixed fixture from {before} to {after} in {repeats}/{repeats} isolated "
            "reruns. {controls} earlier one-variable controls did not flip it. Fixture, "
            "logical input, repetition count, and every other controlled variable remained "
            "fixed; this is bounded causal evidence, not a claim about untested variables."
        ).format(
            variable=first_flip["variable"],
            old=first_flip["from"],
            new=first_flip["to"],
            before=baseline_label,
            after=flipped_label,
            repeats=self.repetitions,
            controls=prior_controls,
        )
        recipe = {
            "schema": "counterfactual-repro-recipe/v1",
            "scenario": scenario.id,
            "fixture": "seeded-safe-fixture/v1",
            "baseline": baseline_environment,
            "change_exactly_one": {
                "variable": first_flip["variable"],
                "from": first_flip["from"],
                "to": first_flip["to"],
            },
            "hold_constant": {
                key: value
                for key, value in baseline_environment.items()
                if key != first_flip["variable"]
            },
            "rerun_count": self.repetitions,
            "expected_transition": "{0} -> {1}".format(
                baseline_label, flipped_label
            ),
            "command": "python3 cli.py run {0} --json".format(scenario.id),
        }
        result = {
            "schema": "counterfactual-repro-evidence/v1",
            "experiment_id": run_id,
            "scenario": {
                "id": scenario.id,
                "title": scenario.title,
                "symptom": scenario.symptom,
                "hypothesis": scenario.hypothesis,
            },
            "baseline_capture": {
                "controlled_environment": baseline_environment,
                "fixture_id": "seeded-safe-fixture/v1",
                "fixture_sha256": self._fixture_digest(),
                "repetitions": self.repetitions,
                "pass_count": sum(1 for status in baseline_statuses if status),
                "repeatable": True,
                "status": baseline_label,
                "trials": baseline_trials,
                "inherited_environment_keys": 0,
                "private_data_fields_captured": 0,
            },
            "interventions": interventions,
            "first_repeatable_flip": {
                "variable": first_flip["variable"],
                "from": first_flip["from"],
                "to": first_flip["to"],
                "baseline_status": baseline_label,
                "counterfactual_status": flipped_label,
                "repeat_count": self.repetitions,
                "pass_count": first_flip["pass_count"],
            },
            "causal_explanation": causal_claim,
            "mechanism": scenario.explanation,
            "confidence": {
                "label": "repeatable bounded flip",
                "baseline_reproducibility": 1.0,
                "counterfactual_reproducibility": 1.0,
                "absolute_pass_rate_change": 1.0,
                "earlier_controls_rejected": prior_controls,
            },
            "safety": {
                "fixture": "fixed and local",
                "shell": False,
                "network_requests": 0,
                "dependency_installs": 0,
                "inherited_environment_keys": 0,
                "workspace_cleanup": "completed after every trial",
            },
            "recipe": recipe,
            "copyable_recipe": json.dumps(recipe, indent=2, sort_keys=True),
            "metrics": {
                "duration_ms": duration_ms,
                "trials_run": completed,
                "variables_changed_per_trial": 1,
                "workspaces_cleaned": completed,
            },
        }
        self._notify(
            progress,
            stage="complete",
            completed=completed,
            total=total_trials,
            message="Repeatable flip isolated; evidence receipt ready",
        )
        return result

    def _run_trial(
        self,
        scenario: Scenario,
        controlled_environment: Dict[str, str],
        phase: str,
        repetition: int,
        run_id: str,
    ) -> dict:
        workspace_id = "{0}-{1}-{2}-{3}".format(
            run_id[:12], phase, repetition, uuid.uuid4().hex[:8]
        )
        workspace = self.runtime_root / workspace_id
        self._assert_workspace_path(workspace)
        workspace.mkdir(parents=True, exist_ok=False)
        started = time.perf_counter()
        try:
            self._materialize(scenario.id, controlled_environment, workspace)
            manifest_sha256 = self._manifest_digest(workspace)
            fixture_environment = self._fixture_environment(controlled_environment)
            completed = subprocess.run(
                [sys.executable, "-I", str(self.fixture_path), scenario.id],
                cwd=str(workspace),
                env=fixture_environment,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                encoding="utf-8",
                timeout=5,
                check=False,
            )
            if len(completed.stdout) > 16_384 or len(completed.stderr) > 16_384:
                raise FixtureExecutionError("Fixed fixture exceeded its output bound")
            try:
                observation = json.loads(completed.stdout)
            except (TypeError, ValueError) as error:
                raise FixtureExecutionError("Fixed fixture returned invalid evidence") from error
            passed = bool(observation.get("passed"))
            expected_exit = 0 if passed else 1
            if completed.returncode != expected_exit:
                raise FixtureExecutionError("Fixture status and exit code disagree")
            return {
                "repetition": repetition,
                "workspace_id": workspace_id,
                "passed": passed,
                "status": "PASS" if passed else "FAIL",
                "exit_code": completed.returncode,
                "code": observation["code"],
                "observation": observation["observation"],
                "expected": observation["expected"],
                "actual": observation["actual"],
                "manifest_sha256": manifest_sha256,
                "environment_sha256": self._environment_digest(controlled_environment),
                "duration_ms": round((time.perf_counter() - started) * 1000, 2),
            }
        except subprocess.TimeoutExpired as error:
            raise FixtureExecutionError("Fixed fixture exceeded its five-second limit") from error
        finally:
            shutil.rmtree(workspace, ignore_errors=True)

    @staticmethod
    def _single_variable_candidate(
        baseline: Dict[str, str], mutation: Intervention
    ) -> Dict[str, str]:
        if mutation.variable not in baseline:
            raise FixtureExecutionError("Intervention variable is not in the baseline")
        if mutation.to_value not in BOUNDS.get(mutation.variable, frozenset()):
            raise FixtureExecutionError("Intervention value is outside its allowlist")
        candidate = dict(baseline)
        candidate[mutation.variable] = mutation.to_value
        changed = [
            key for key in baseline if baseline.get(key) != candidate.get(key)
        ]
        if changed != [mutation.variable]:
            raise FixtureExecutionError("Intervention did not change exactly one variable")
        return candidate

    @staticmethod
    def _fixture_environment(controlled: Dict[str, str]) -> Dict[str, str]:
        key_map = {
            "checkout.lineEnding": "CFR_CHECKOUT_LINE_ENDING",
            "simulatedPath.order": "CFR_SIMULATED_PATH_ORDER",
            "feature.safeParser": "CFR_FEATURE_SAFE_PARSER",
            "process.locale": "CFR_PROCESS_LOCALE",
            "runtime.validation": "CFR_RUNTIME_VALIDATION",
        }
        return {key_map[key]: value for key, value in controlled.items()}

    @staticmethod
    def _materialize(
        scenario_id: str, controlled: Dict[str, str], workspace: Path
    ) -> None:
        if scenario_id == "line-endings":
            payload = workspace / "payload"
            payload.mkdir()
            separator = (
                b"\r\n"
                if controlled["checkout.lineEnding"] == "crlf"
                else b"\n"
            )
            (payload / "records.txt").write_bytes(
                separator.join((b"alpha", b"beta", b"gamma")) + separator
            )
        elif scenario_id == "path-precedence":
            for name, major in (("legacy", 1), ("current", 2)):
                tool_dir = workspace / "tools" / name
                tool_dir.mkdir(parents=True)
                (tool_dir / "tool.json").write_text(
                    json.dumps({"name": "repro-tool", "major": major}),
                    encoding="utf-8",
                )
        elif scenario_id == "environment-flag":
            (workspace / "policy.json").write_text(
                json.dumps({"requires": "safe-parser", "payload": "seeded"}),
                encoding="utf-8",
            )
        else:
            raise UnknownScenarioError("Unknown seeded scenario: {0}".format(scenario_id))

    def _assert_workspace_path(self, workspace: Path) -> None:
        runtime = self.runtime_root.resolve()
        candidate = workspace.resolve()
        if runtime != candidate.parent:
            raise FixtureExecutionError("Workspace escaped the local runtime root")

    def _fixture_digest(self) -> str:
        return hashlib.sha256(self.fixture_path.read_bytes()).hexdigest()

    @staticmethod
    def _manifest_digest(workspace: Path) -> str:
        digest = hashlib.sha256()
        for path in sorted(item for item in workspace.rglob("*") if item.is_file()):
            digest.update(path.relative_to(workspace).as_posix().encode("utf-8"))
            digest.update(b"\0")
            digest.update(path.read_bytes())
            digest.update(b"\0")
        return digest.hexdigest()

    @staticmethod
    def _environment_digest(controlled: Dict[str, str]) -> str:
        encoded = json.dumps(
            controlled, sort_keys=True, separators=(",", ":")
        ).encode("utf-8")
        return hashlib.sha256(encoded).hexdigest()

    @staticmethod
    def _notify(
        callback: ProgressCallback,
        stage: str,
        completed: int,
        total: int,
        message: str,
    ) -> None:
        if callback:
            callback(
                {
                    "stage": stage,
                    "completed": completed,
                    "total": total,
                    "message": message,
                }
            )
