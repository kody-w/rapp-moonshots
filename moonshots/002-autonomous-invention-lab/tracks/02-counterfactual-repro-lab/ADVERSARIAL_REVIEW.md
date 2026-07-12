# Adversarial review

## Verdict

**Ship as a bounded causal-debugging prototype, not as a universal root-cause
oracle.** The core claim survives: the app produces repeatable one-variable
evidence without executing user input or harvesting the host environment.

## Attacks and findings

| Attack | Severity | Finding / mitigation |
|---|---|---|
| “Correlation is being sold as causation.” | High | The claim is explicitly bounded. Fixture, input, and all other controlled values remain fixed; two earlier controls do not flip; the result repeats 3/3. Receipts name untested-variable uncertainty. |
| “A hidden second variable changes.” | High | Candidate states are copied from baseline, changed at one key, then checked by an invariant. Tests assert `changed_variable_count == 1` for every intervention. |
| “The command API becomes local RCE.” | Critical | There is no command field. HTTP accepts exactly one allowlisted `scenario_id`; CLI uses `argparse` choices; subprocess uses a fixed argv with `shell=False`. Adversarial API and CLI tests reject extra or unknown input. |
| “Secrets leak through environment capture.” | Critical | Child environments replace rather than extend `os.environ`. Windows alone preserves required `SYSTEMROOT` for process bootstrap. Receipts record only that key's name—not its value—and accurately report zero inherited experiment or secret keys. |
| “Temporary trials pollute the machine.” | Medium | Workspaces are under this track's ignored `.runtime/` and uniquely named. Only `lstat`-confirmed absence counts as cleanup: deletion errors, verification errors (including permission denial), or surviving paths raise `WorkspaceCleanupError`; no completed receipt is returned. Unknown worker failures also default to unverified. The measured 36/36 verified deletions left zero residue. |
| “Ctrl+C abandons a daemon worker mid-write.” | High | Experiment workers are tracked and non-daemon. Shutdown rejects new runs, signals cooperative cancellation, joins every worker, and returns only after each started trial's `finally` block verifies deletion. |
| “PATH simulation proves nothing cross-platform.” | Medium | Fair criticism. The prototype deterministically models first-match resolution; it does not claim to boot multiple operating systems. The receipt says “simulatedPath,” and the next gate is a sanitized read-only adapter. |
| “Three repeats are statistically weak.” | Medium | Three repeats establish demo determinism, not fleet-wide confidence. Production mode should make repetition count policy-driven and report confidence intervals. |
| “A flaky fixture can manufacture a flip.” | High | Baseline unanimity is mandatory; a mixed baseline aborts rather than explaining. Candidate unanimity is also required. Timing, randomness, network, and inherited state are absent from seeded fixtures. |
| “Concurrent runs cross-contaminate.” | Medium | Every trial has a UUID workspace, receives a fresh environment dictionary, and is cleaned independently. Active runs are capped at two; the registry and worker lifecycle are lock-protected. |
| “The receipt can be edited after export.” | Low | Trial inputs and fixture/workspace manifests are hashed, but the receipt itself is not signed. Signing and content-addressed storage are deliberately deferred because the app performs no remote writes. |

## Kill criteria

Do not advance the invention if a real sanitized fixture requires arbitrary
shell input, if interventions cannot be proven single-variable, if flaky
baselines are explained instead of rejected, or if private host state must be
captured to produce a useful result.

## Highest-value next tests

1. Run a sanitized repository fixture on Windows, macOS, and Linux hosts.
2. Add order randomization to detect drift and trial-order effects.
3. Sign exported receipts locally and verify them during replay.
4. Compare time-to-cause against an experienced engineer's manual diagnosis.
