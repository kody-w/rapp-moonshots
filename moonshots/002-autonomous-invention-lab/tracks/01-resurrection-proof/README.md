# Resurrection Proof

**Backups tell you files exist. Resurrection Proof tells you the intelligence
inside them can come back from the dead.**

Resurrection Proof is a working, one-button recovery rehearsal for a completely
synthetic RAPP estate. It restores into an isolated local workspace, verifies
the inventory and SHA-256 manifest, runs four behavioral canaries, injects a
same-size corruption, and refuses to issue a passing receipt unless the
integrity guard **hard-fails exactly as designed**.

No report generator is masquerading as a prototype: the browser shows every
phase live and downloads the resulting public-safe JSON evidence.

## Launch

Requirements: Python 3.10+ and a local browser. There is nothing to install.

From this directory, the exact one-command launch is:

```bash
python3 app.py
```

Open <http://127.0.0.1:8787>, then press **Run Recovery Drill**.

From the repository root, the equivalent command is:

```bash
python3 moonshots/002-autonomous-invention-lab/tracks/01-resurrection-proof/app.py
```

To use a different local port:

```bash
python3 app.py --port 8899
```

The server only accepts a loopback host. `RESURRECTION_STEP_DELAY=0` removes
the presentation delay without changing the drill.

## What the button proves

| Gate | Executable evidence |
| --- | --- |
| Isolate | A mode-`0700`, uniquely named workspace is created under ignored local runtime storage. |
| Restore | The checked synthetic fixture is copied; the source fixture is never modified. |
| Verify | Exact file inventory, byte sizes, and all five SHA-256 digests match. |
| Canaries | Agent discovery, greeting contract, memory recall, and capability routing behave correctly; the policy's `required_canaries` count must be met. |
| Corrupt | `memory/facts.json` receives a controlled, same-byte-length synthetic mutation, so inventory and size checks still pass. |
| Prove | SHA-256 verification raises `CHECKSUM_MISMATCH`; accepting the mutation makes the entire drill fail. |
| Receipt | The workspace is deleted and a public-safe JSON receipt becomes downloadable. |

A green final outcome does **not** mean corruption passed. It means the clean
recovery passed and the adversarial copy was rejected with the required hard
failure.

## Synthetic-only safety boundary

- `fixtures/rapp-estate/` is invented, public fixture data.
- The engine rejects fixtures unless `synthetic: true`,
  `classification: synthetic-public-fixture`, and `network_access: false`.
- `required_canaries` is carried into execution and the receipt; too few
  executed or passing canaries abort the drill before receipt creation.
- No socket client, remote-machine integration, vault reader, credential
  provider, or live brainstem client exists in the application.
- The HTTP server binds only to `127.0.0.1` or `localhost`.
- Manifest paths reject absolute paths and `..`; symlinks are rejected.
- Receipts are checked before release for home paths, absolute paths, host/user
  fields, credentials, tokens, secrets, and workspace locations.
- UI event text and receipts expose fixture-relative facts only.

The receipt intentionally contains checksums and synthetic names, but never a
local workspace path, username, host name, IP address, environment value, or
raw exception.

## Measurable experiment

**Hypothesis:** a file-perfect restore is insufficient proof of recovery, while
a behavior-plus-adversary rehearsal can demonstrate both liveness and integrity
in one repeatable run.

Run the reproducible ten-drill experiment:

```bash
python3 app.py --experiment --runs 10
```

This is a headless path: it never constructs or starts the HTTP server. It runs
ten independently isolated drills with presentation delays disabled, evaluates
each public-safe receipt in memory, prints one aggregate JSON document, and
exits `0` only when every threshold passes. Any missed threshold exits `1`.
`--runs N` accepts 1–1000 and scales every required count to `N`.

| Metric | Acceptance threshold for 10 runs | Aggregate JSON field |
| --- | ---: | --- |
| Clean restore success | 10/10 | `metrics.clean_successes` |
| Manifest coverage | 50/50 files; 10/10 runs | `metrics.manifest` |
| Behavioral liveness | 40/40 canaries; 10/10 runs | `metrics.canaries` |
| Corruption detection | 10/10 hard failures | `metrics.corruption.hard_fails` |
| False acceptance | 0 | `metrics.corruption.false_acceptances` |
| Workspace cleanup | 10/10 | `metrics.cleanup` |
| Public-safety gate | 10/10 receipts | `runs_completed` |
| Restore latency | Record median and nearest-rank p95 | `metrics.latency_seconds` |

The JSON also contains a boolean for every threshold, an overall
`meets_thresholds`, public-safe failure-code counts, total experiment duration,
and `safety.http_server_started: false`.

The deliberately same-size mutation is important: it establishes an
adversarial baseline where “the right files with the right sizes” is proven
insufficient, while content integrity and a behavioral check both notice the
damage.

## Tests

Run the complete stdlib test suite:

```bash
python3 -B -m unittest discover -s tests -v
```

The suite covers:

1. full restore → verify → four canaries → corrupt → required hard-fail → cleanup;
2. same-size corruption passing inventory but failing SHA-256;
3. refusal of a non-synthetic fixture before workspace creation;
4. receipt privacy enforcement;
5. a real loopback HTTP server, one-button API flow, and receipt download;
6. required Clawpilot theme, self-contained UI, CSP, and health endpoint;
7. successful headless aggregation, median/p95 latency, and workspace cleanup;
8. a simulated false acceptance producing a failed threshold and exit code `1`;
9. experiment-mode CLI routing that never calls the HTTP server;
10. refusal and cleanup when fixture policy requires more canaries than exist;
11. bounded shutdown waiting, timeout reporting, worker tracking, and cleanup.

## API

The browser uses a deliberately small local API:

- `GET /api/health` — readiness and safety mode;
- `POST /api/drills` — start the single allowed active drill;
- `GET /api/drills/{id}` — phase, progress, and public-safe event polling;
- `GET /api/drills/{id}/receipt` — downloadable JSON after success.

All application state is in memory. Runtime workspaces are ignored by Git and
removed in the engine's `finally` path.

## Adversarial review

| Attack / failure | Current response | Honest residual risk |
| --- | --- | --- |
| Same-size content mutation | Inventory passes; SHA-256 hard-fails; changed recall is observed. | SHA-256 proves content equality, not who authored the source manifest. |
| Missing, extra, or resized file | Exact inventory/size gate fails before canaries. | The fixture is intentionally tiny; production estates need schema-aware inventory rules. |
| Manifest path traversal | Absolute, non-canonical, and parent paths are refused. | This prototype does not ingest archives; an archive adapter would need separate extraction defenses. |
| Symlink escape | Any fixture or recovered symlink is refused. | Other special filesystem nodes are outside the synthetic fixture contract. |
| Private estate substituted | Explicit synthetic classification and offline policy are mandatory. | Classification is a guardrail, not a DLP scanner; this build must never be pointed at private data. |
| Canary quietly regresses | Any mismatch aborts; the policy's required count is enforced and recorded. | The fixture currently implements four canaries, not every future RAPP behavior. |
| Corruption guard becomes a no-op | Failure to raise the exact checksum error fails the whole drill. | A signed or independently anchored manifest is future work. |
| Receipt leaks machine details | Recursive privacy gate blocks private keys and local paths. | Free-form future receipt fields must continue to pass the same release gate. |
| Concurrent operator clicks | Backend permits one active drill; UI disables the button. | Separate application processes are not coordinated. |
| Ctrl+C during a drill | New drills are refused; tracked workers get up to 15 seconds to finish their `finally` cleanup. Success is printed only after workers finish and runtime is empty. | A stuck worker can exceed the bound; the process exits `2` and warns that cleanup is unconfirmed. |
| Process is force-killed | No remote side effects; source remains immutable. | A hard kill can leave ignored `.runtime/` files, handled by the rollback below. |

## Rollback and cleanup

1. Stop the server with **Ctrl+C**. It stops accepting drills and waits up to
   fifteen seconds for every tracked worker to complete cleanup.
2. A confirmed shutdown prints `Workspace cleanup confirmed` and exits `0`.
   If the bound expires or runtime is not empty, it prints an explicit
   unconfirmed-cleanup warning and exits `2`—it never claims a clean stop.
3. Normal, failed, and exception paths remove each isolated workspace
   automatically.
4. After an operating-system kill or an unconfirmed shutdown, inspect and then
   remove only this track's ignored runtime:

   ```bash
   rm -rf .runtime
   ```

5. No package, service, database, credential, remote resource, or live
   brainstem was created, so there is nothing else to roll back.

The fixture source stays immutable throughout every drill. A new run starts
from the same deterministic evidence base.

## Why this is a moonshot — Shark Tank pitch

**Sharks, every AI team is buying backup insurance and calling it resilience.**
But a directory full of agent files is not an agent estate. Prompts can restore
while routing breaks. Memory can deserialize while meaning changes. A checksum
can pass while nobody has asked the recovered system to do its job.

Resurrection Proof turns disaster recovery from a storage ceremony into an
executable product claim: *restore it, make it perform, attack the copy, and
ship the evidence*. One button produces a receipt an operator, auditor, or
customer can understand without exposing the estate itself.

The wedge is a five-file synthetic RAPP. The moonshot is a universal
“resurrection contract” for autonomous systems: portable behavioral canaries,
adversarial recovery rehearsals, and privacy-safe proof across every agent
runtime. Traditional backup vendors sell the probability that bytes return.
We can own the much more valuable moment when a company proves its digital
workforce returns **alive, correct, and able to reject corruption**.

**The ask:** bet on moving recovery from “we have copies” to “we have proof.”

## Layout

```text
app.py                         # one-command entry point
resurrection_proof/
  drill.py                     # restore, verification, canaries, adversary, receipt
  experiment.py                # headless N-run aggregation and threshold exit
  server.py                    # loopback HTTP API and progress orchestration
fixtures/rapp-estate/          # synthetic public estate + SHA-256 manifest
web/index.html                 # self-contained Clawpilot application
tests/                         # core and HTTP end-to-end tests
```
