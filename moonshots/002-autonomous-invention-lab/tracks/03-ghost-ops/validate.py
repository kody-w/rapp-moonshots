#!/usr/bin/env python3
"""Zero-dependency structural validator for the Ghost Ops artifact."""

from __future__ import annotations

import hashlib
import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent
HTML_PATH = ROOT / "index.html"
REQUIRED_FILES = (
    "index.html",
    "README.md",
    "EXPERIMENT.md",
    "ADVERSARIAL_REVIEW.md",
    "ROLLBACK.md",
    "PITCH.md",
    "experiment.mjs",
    "tests/test_engine.mjs",
)
REQUIRED_VARIABLES = (
    "--cp-bg",
    "--cp-bg-elevated",
    "--cp-surface",
    "--cp-surface-soft",
    "--cp-border",
    "--cp-border-strong",
    "--cp-text",
    "--cp-text-muted",
    "--cp-text-soft",
    "--cp-accent",
    "--cp-accent-hover",
    "--cp-accent-soft",
    "--cp-accent-fg",
    "--cp-success",
    "--cp-danger",
    "--cp-warning",
    "--cp-link",
    "--cp-shadow",
    "--cp-overlay",
    "--cp-panel",
    "--cp-panel-strong",
    "--cp-sheen",
    "--cp-highlight",
)


def check(name: str, condition: bool, detail: str = "") -> None:
    if not condition:
        suffix = f": {detail}" if detail else ""
        raise AssertionError(f"{name}{suffix}")
    print(f"PASS  {name}")


def main() -> int:
    html = HTML_PATH.read_text(encoding="utf-8")

    check("all track evidence files exist", all((ROOT / path).is_file() for path in REQUIRED_FILES))
    check("artifact is substantial", len(html) > 50_000, f"{len(html)} bytes")
    first_script = re.search(r"<script>([\s\S]*?)</script>", html)
    check("theme detection is the first script", bool(first_script))
    check(
        "first script honors scoutTheme",
        "new URLSearchParams(window.location.search).get(\"scoutTheme\")" in first_script.group(1),
    )
    check("light and dark Clawpilot themes exist", ":root {" in html and 'html[data-theme="dark"]' in html)
    check("all mandatory Clawpilot variables exist", all(variable in html for variable in REQUIRED_VARIABLES))
    check(
        "approved typography is used",
        '"Segoe UI", Aptos, Calibri, -apple-system, BlinkMacSystemFont, sans-serif' in html
        and 'Consolas, "Courier New", Courier, monospace' in html,
    )

    style = re.search(r"<style>([\s\S]*?)</style>", html)
    check("single embedded stylesheet exists", bool(style))
    component_css = re.sub(r"^\s*--cp-[^;]+;\s*$", "", style.group(1), flags=re.MULTILINE)
    raw_colors = re.findall(r"(?<!-)(?:#[0-9a-fA-F]{3,8}\b|(?:rgb|hsl)a?\()", component_css)
    check("component CSS has no hardcoded colors", not raw_colors, ", ".join(raw_colors[:3]))

    external_tags = re.findall(
        r"<(?:script|link|img|iframe|audio|video|source)\b[^>]*(?:src|href)\s*=\s*[\"'][^\"']+[\"']",
        html,
        flags=re.IGNORECASE,
    )
    check("artifact has no external assets", not external_tags, external_tags[0] if external_tags else "")
    check("artifact contains no remote URL", not re.search(r"https?://", html))
    check(
        "artifact contains no network client primitive",
        all(token not in html for token in ("fetch(", "XMLHttpRequest", "WebSocket", "EventSource")),
    )

    check("two scenarios are embedded", 'id: "midnight-canary"' in html and 'id: "phantom-credential"' in html)
    check("three named machine personas exist per scenario", all(
        f'name: "{name}"' in html for name in ("Edda", "Ari", "Cato", "Atlas", "Quinn", "Wren")
    ))
    check("three disagreeing responder personas exist", all(
        f'name: "{name}"' in html for name in ("Sentinel", "Vale", "Quill")
    ) and "disagreesWith" in html)
    check("bounded action inventory exists", 'budget: 2' in html and 'budget: 1' in html)
    check("deterministic replay schema exists", "ghost-ops/replay/v1" in html and "expectedDigest" in html)
    check("Obsidian playbook export exists", "[[Incident rehearsals]]" in html and "tags:" in html)
    check("safe JSON event export exists", "ghost-ops/event-log/v1" in html and "networkCalls: 0" in html)
    check("embedded engine and app scripts exist", 'id="ghost-engine"' in html and 'id="ghost-app"' in html)

    digest = hashlib.sha256(html.encode("utf-8")).hexdigest()[:16]
    print(f"\nGhost Ops structural validation passed · index sha256:{digest}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (AssertionError, OSError) as error:
        print(f"FAIL  {error}", file=sys.stderr)
        raise SystemExit(1)
