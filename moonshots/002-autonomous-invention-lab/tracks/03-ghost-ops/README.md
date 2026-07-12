# Track 03 — Ghost Ops

**Ghost Ops is a playable, local incident rehearsal where infrastructure speaks, responders disagree, and every operator decision becomes reusable recovery memory.**

Open [`index.html`](index.html) directly in a modern browser. There is no install, build, account, server, network request, or external asset.

## The application

1. Choose **Midnight Canary** (compromised release) or **Phantom Credential** (retired token reuse).
2. Set a deterministic seed and enter the incident room.
3. Read first-person symptoms from exactly three machine personas.
4. Compare recommendations from Sentinel, Vale, and Quill. Their containment, availability, and evidence priorities visibly conflict.
5. Select a fixture machine and spend one bounded action. Each decision advances a five-minute tick.
6. Watch compromise, health, latency, spread, evidence, service impact, and the containment score change.
7. After seven decisions, export:
   - an Obsidian-compatible recovery playbook (`.md`);
   - the complete safe-fixture event log (`.json`); and
   - a deterministic replay (`.json`).

The **Watch a gold replay** control demonstrates the complete loop automatically. Replay imports are schema-checked, allowlisted to fixture IDs/actions, capped at seven steps and 64 KiB, and verified against an event digest.

## Demo

```bash
open index.html
```

Optional local serving, still with Python's standard library only:

```bash
python3 -m http.server 8787
# visit localhost:8787
```

Recommended three-minute path:

1. Launch **Midnight Canary**, seed `30317`.
2. Notice Edda's symptom post and the explicit Sentinel ↔ Vale disagreement.
3. Choose Edda, then **Block egress** and **Capture snapshot**.
4. Continue manually, or restart and choose **Watch a gold replay**.
5. Export the Markdown and JSON artifacts from the finale.

## What is deterministic

The embedded engine uses only:

- the chosen scenario,
- the normalized integer seed,
- the ordered `(actionId, targetId)` decisions, and
- fixed fixture start times.

There is no `Math.random()`, wall-clock input, storage dependency, or remote state. Spread rolls derive from a stable FNV-1a hash. Replaying the same inputs reconstructs every state transition, virtual timestamp, feed post, event ID, score, and final digest.

## Safety boundary

- All six machines, telemetry values, logs, identities, and versions are invented fixtures.
- Operator controls mutate in-memory JavaScript objects only.
- No shell command, host API, cloud SDK, browser storage, analytics, or network client exists.
- Export happens only through a user-initiated local `Blob` download.
- Closing the tab removes all runtime state.

## Action deck

| Action | Uses | Benefit | Explicit tradeoff |
|---|---:|---|---|
| Isolate node | 2 | Stops inbound and outbound lateral spread | Reduces health and raises service impact |
| Block egress | 2 | Sharply reduces outbound spread pressure | Leaves the local process alive |
| Capture snapshot | 2 | Adds 28 points of evidence fidelity | Delays containment for one tick |
| Rollback release | 1 | Strong against a release vector | Weak against credential compromise |
| Rotate credential | 1 | Strong against credential reuse | Briefly increases authentication impact |
| Restart service | 1 | Recovers a low-residue node | Regenerates compromise on a hot node |

The score is derived from compromise, uncontrolled nodes, hot nodes, service impact, retained evidence, and active controls. This makes the consequences observable rather than narratively declared.

## Evidence

- **Falsifiable hypothesis:** a containment-first policy improves mean final score by at least 15 points over a recovery-first policy on matched seeds.
- **Measured result:** `+42.995` mean points across 200 paired runs; containment-first won `200/200`. Simulated spread fell from `4.585` to `0.625` events per run.
- **Reproduce:** `node experiment.mjs`
- **Protocol and limitations:** [`EXPERIMENT.md`](EXPERIMENT.md)
- **Adversarial review:** [`ADVERSARIAL_REVIEW.md`](ADVERSARIAL_REVIEW.md)
- **Rollback:** [`ROLLBACK.md`](ROLLBACK.md)
- **Three-minute pitch:** [`PITCH.md`](PITCH.md)

## Validation

```bash
python3 validate.py
node --test tests/test_engine.mjs
node experiment.mjs
```

`validate.py` uses Python's standard library and checks the standalone artifact, Clawpilot theme contract, approved fonts, absence of external assets/network clients, deterministic schemas, scenarios, personas, bounded actions, and both exports.

The Node tests use built-in modules only and cover fixtures, determinism, seed variation, action bounds, replay equality, replay rejection, the matched policy experiment, and both finale exports.

## Track files

| Path | Purpose |
|---|---|
| `index.html` | Complete self-contained application, engine, theme, UI, and exports |
| `validate.py` | Zero-dependency structural and safety validator |
| `tests/test_engine.mjs` | Eight deterministic engine and export tests |
| `experiment.mjs` | Reproducible 200-pair policy experiment |
| `EXPERIMENT.md` | Hypothesis, protocol, measured evidence, limitations |
| `ADVERSARIAL_REVIEW.md` | Abuse cases, mitigations, residual risk |
| `ROLLBACK.md` | Runtime, artifact, and source rollback |
| `PITCH.md` | Shark Tank narrative and live demo script |

## Why this is a moonshot

Most incident tooling begins after reality has already become expensive. Ghost Ops turns recovery into a multiplayer rehearsal **before** production is touched, gives infrastructure enough personality to make weak signals memorable, forces specialist disagreement into the open, and converts each run into portable organizational memory. The moonshot is not a prettier game: it is a future where every system can safely rehearse its own failure modes and continuously compile the best human-agent decisions into recovery playbooks.

## Build status

`complete · locally validated · zero install`

