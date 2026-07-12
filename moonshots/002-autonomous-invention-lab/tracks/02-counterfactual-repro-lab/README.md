# Counterfactual Repro Lab

**Working application — Track 02**

CI can tell you *where* software failed. Counterfactual Repro Lab discovers the
smallest bounded environmental difference that made it fail, verifies the flip
three times, explains the mechanism, and exports a replayable evidence receipt.

## Launch in one command

Requires Python 3.9+ and no packages.

```bash
./launch.sh
```

The browser opens at **http://127.0.0.1:8022**. The server binds only to
loopback. Stop it with `Ctrl+C`. On Windows, run `launch.bat`.

## The experience

1. Choose one of three deterministic cross-environment failures.
2. Click **Run controlled experiment**.
3. Watch the baseline fail three times in fresh isolated workspaces.
4. Watch plausible one-variable controls get rejected.
5. See the first 3/3 repeatable `FAIL → PASS` flip.
6. Copy the minimal repro recipe or download the complete JSON evidence receipt.

| Seeded failure | Baseline | Isolated cause |
|---|---|---|
| Invisible carriage return | CRLF checkout | `checkout.lineEnding: crlf → lf` |
| Right tool, found second | legacy tool wins | `simulatedPath.order: legacy-first → current-first` |
| Missing safety gate | flag disabled | `feature.safeParser: disabled → enabled` |

## Why the evidence is causal

The fixture and logical input stay fixed. Each candidate is derived from the
captured baseline and an engine invariant rejects anything that changes more
than one allowlisted variable. Every observation runs three times in a new,
track-local workspace. The first unanimous opposite outcome is reported as a
**bounded causal flip**; the receipt explicitly avoids claims about untested
variables.

Each trial records:

- the allowlisted controlled environment and its SHA-256 digest,
- a fixture and workspace-manifest digest,
- expected versus actual observation,
- status, exit code, duration, and verified deletion evidence, and
- zero inherited experiment/secret keys and zero private-data fields.

## Safety boundaries

- The API accepts exactly one field: a seeded `scenario_id`.
- The child process uses a fixed argument vector—never a shell.
- The fixture receives a replacement allowlisted environment, not `os.environ`.
  On Windows, only required `SYSTEMROOT` bootstraps Python; its value is neither
  captured nor written to a receipt.
- Trial files live under this track's `.runtime/`; deletion is verified after
  every trial, and any residue withholds the completed receipt.
- `Ctrl+C` cancels and joins tracked non-daemon workers before shutdown returns.
- There are no network calls, remote writes, arbitrary commands, uploads, or
  dependency installs.
- Static assets are self-contained and protected by a restrictive CSP.

## CLI and validation

The copyable UI recipe uses the same fixed engine:

```bash
python3 cli.py list
python3 cli.py run line-endings --json
python3 -m unittest discover -s tests -v
python3 scripts/measure.py
```

Exported recipes automatically use `python3` with `./launch.sh` on POSIX and
`python` with `launch.bat` on Windows.

The committed experiment ran 36 isolated trials: **3/3 causes identified,
9/9 baseline failures reproduced, 9/9 counterfactual passes repeated, six
controls rejected, and zero residual workspaces**. Median scenario time was
538.89 ms. See [`EXPERIMENT.md`](EXPERIMENT.md) and the machine-readable
[`evidence/experiment-results.json`](evidence/experiment-results.json).

## Review package

- [`EXPERIMENT.md`](EXPERIMENT.md) — falsifiable hypothesis, method, and result
- [`ADVERSARIAL_REVIEW.md`](ADVERSARIAL_REVIEW.md) — attack, caveats, mitigations
- [`ROLLBACK.md`](ROLLBACK.md) — zero-residue stop and rollback
- [`PITCH.md`](PITCH.md) — three-minute Shark Tank demonstration and moonshot case

## Implementation map

```text
app.py                       loopback-only stdlib HTTP API
counterfactual_lab/
  engine.py                  one-variable experiment and evidence engine
  fixture.py                 fixed safe fixture subprocess
  scenarios.py               three allowlisted scenario definitions
static/index.html             self-contained Clawpilot-themed application
scripts/measure.py            reproducible value experiment
tests/                        engine, API, UI contract, safety, and CLI tests
```
