"""Seeded, bounded cross-environment failure definitions."""

from dataclasses import dataclass
from typing import Dict, List, Tuple


@dataclass(frozen=True)
class Intervention:
    variable: str
    to_value: str
    rationale: str


@dataclass(frozen=True)
class Scenario:
    id: str
    title: str
    eyebrow: str
    symptom: str
    hypothesis: str
    baseline: Tuple[Tuple[str, str], ...]
    interventions: Tuple[Intervention, ...]
    causal_variable: str
    causal_value: str
    explanation: str

    def baseline_dict(self) -> Dict[str, str]:
        return dict(self.baseline)


BOUNDS = {
    "checkout.lineEnding": frozenset(("crlf", "lf")),
    "simulatedPath.order": frozenset(("legacy-first", "current-first")),
    "feature.safeParser": frozenset(("disabled", "enabled")),
    "process.locale": frozenset(("neutral", "unicode")),
    "runtime.validation": frozenset(("compatibility", "strict")),
}


SCENARIOS: Dict[str, Scenario] = {
    "line-endings": Scenario(
        id="line-endings",
        title="The invisible carriage return",
        eyebrow="CHECKOUT · WINDOWS → UNIX",
        symptom="A fixed record parser rejects a logically identical checkout.",
        hypothesis="CRLF materialization introduces bytes the strict fixture does not accept.",
        baseline=(
            ("checkout.lineEnding", "crlf"),
            ("process.locale", "neutral"),
            ("runtime.validation", "compatibility"),
        ),
        interventions=(
            Intervention(
                "process.locale",
                "unicode",
                "Test the common locale explanation without touching checkout bytes.",
            ),
            Intervention(
                "runtime.validation",
                "strict",
                "Test parser mode while preserving the materialized file.",
            ),
            Intervention(
                "checkout.lineEnding",
                "lf",
                "Materialize the same logical fixture with LF-only endings.",
            ),
        ),
        causal_variable="checkout.lineEnding",
        causal_value="lf",
        explanation=(
            "The parser consumes LF-delimited records but treats carriage returns as payload. "
            "LF materialization removes the extra byte while preserving every logical record."
        ),
    ),
    "path-precedence": Scenario(
        id="path-precedence",
        title="The right tool, found second",
        eyebrow="PATH · TOOL PRECEDENCE",
        symptom="The build resolves a compatible tool locally but still reports version 1.",
        hypothesis="A legacy tool directory wins before the current directory in search order.",
        baseline=(
            ("simulatedPath.order", "legacy-first"),
            ("process.locale", "neutral"),
            ("runtime.validation", "compatibility"),
        ),
        interventions=(
            Intervention(
                "process.locale",
                "unicode",
                "Rule out character handling while keeping tool order fixed.",
            ),
            Intervention(
                "runtime.validation",
                "strict",
                "Rule out validation policy while keeping tool order fixed.",
            ),
            Intervention(
                "simulatedPath.order",
                "current-first",
                "Move the compatible seeded tool ahead of the legacy tool.",
            ),
        ),
        causal_variable="simulatedPath.order",
        causal_value="current-first",
        explanation=(
            "Both seeded tools exist, but first-match resolution selects version 1 when the "
            "legacy directory leads. Reordering the bounded simulated PATH selects version 2."
        ),
    ),
    "environment-flag": Scenario(
        id="environment-flag",
        title="The missing safety gate",
        eyebrow="ENV · FEATURE FLAG",
        symptom="A guarded parser works in CI but refuses the same policy on a developer host.",
        hypothesis="The safe parser flag is absent from the failing environment.",
        baseline=(
            ("feature.safeParser", "disabled"),
            ("process.locale", "neutral"),
            ("runtime.validation", "compatibility"),
        ),
        interventions=(
            Intervention(
                "process.locale",
                "unicode",
                "Rule out locale sensitivity while the feature gate stays disabled.",
            ),
            Intervention(
                "runtime.validation",
                "strict",
                "Rule out validation mode while the feature gate stays disabled.",
            ),
            Intervention(
                "feature.safeParser",
                "enabled",
                "Enable only the seeded parser gate.",
            ),
        ),
        causal_variable="feature.safeParser",
        causal_value="enabled",
        explanation=(
            "The policy explicitly requires the safe parser path. Enabling the one bounded "
            "feature flag satisfies that precondition without changing policy or parser input."
        ),
    ),
}


def public_scenarios() -> List[dict]:
    """Return presentation-safe scenario metadata."""
    return [
        {
            "id": scenario.id,
            "title": scenario.title,
            "eyebrow": scenario.eyebrow,
            "symptom": scenario.symptom,
            "hypothesis": scenario.hypothesis,
            "candidate_count": len(scenario.interventions),
            "repeat_count": 3,
        }
        for scenario in SCENARIOS.values()
    ]
