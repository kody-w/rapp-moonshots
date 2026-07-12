# Ghost Ops adversarial review

Review target: the standalone `index.html` application and its exported artifacts.
Threat boundary: local browser, invented fixture data, no production integration.

## Findings

| Attack or failure claim | Test performed | Result / mitigation | Residual risk |
|---|---|---|---|
| “The simulator secretly contacts infrastructure.” | Searched the artifact for remote URLs, external tags, and network primitives; enforced by `validate.py`. | No `fetch`, XHR, WebSocket, EventSource, remote URL, SDK, or external asset. Runtime controls only mutate memory. | A modified browser or extension remains outside the artifact boundary. |
| “Import replay can smuggle a shell command or production host.” | Added extra action fields, unknown action IDs, and non-fixture target IDs. | Strict replay schema accepts only scenario, numeric seed, and allowlisted action/fixture-target pairs; seven-step and 64 KiB limits apply. Tests assert rejection. | JSON parsing can still briefly consume local browser resources below the cap. |
| “The deterministic claim is theater.” | Ran the same scenario, seed, and seven decisions twice; compared full state, events, virtual timestamps, and digest. Reconstructed a third run from export. | Exact equality. Randomness derives from stable hashing; time derives from fixed fixture clocks. | A future engine-version change can alter results; replay records the version but no migration exists yet. |
| “The agents create false authority.” | Inspected labels and recommendation flow. | UI says advice is opinionated, exposes confidence, and shows explicit Sentinel/Vale/Quill disagreement. Operator remains the only decision-maker. | Players may still anchor on the highest confidence number. Confidence is illustrative, not calibrated. |
| “The game rewards one scripted answer.” | Compared two policies over 200 matched seeds and inspected score components. | Multiple controls contribute; evidence and uptime trade against containment. Different seeds change spread. | Current scoring strongly rewards early controls by design; broader policies and topologies are needed. |
| “Restart is a fake choice.” | Restarted both low- and high-residue nodes. | Low residue improves; hot restart regenerates compromise. The action card states the risk. | A single threshold simplifies real process behavior. |
| “Machine social posts are cosmetic.” | Compared posts and metrics after control, spread, isolation, and recovery states. | Posts derive from current compromise, isolation, egress, health, load, latency, and tick. | Text templates are finite and become familiar on repeat play. |
| “Export can inject unsafe markup.” | Traced all replay-controlled values into UI and Markdown. | Scenario, target, and action strings are allowlisted constants; seed is numeric; UI interpolation passes through HTML escaping. | Markdown viewers may execute features from unrelated plugins; Ghost Ops emits no HTML or script. |
| “Exports leak real telemetry.” | Inspected scenario constants and event-log schema. | Every identity, version, metric, timestamp, and event is explicitly fixture data. JSON declares `fixtureOnly: true` and `networkCalls: 0`. | Users could manually paste unrelated text into a downloaded note after export. |
| “Accessibility collapses under spectacle.” | Reviewed focus, semantics, live regions, keyboard controls, responsive states, contrast tokens, and reduced-motion behavior. | Native buttons/dialog, focus-visible outlines, ARIA labels/live regions, no color-only action state, reduced-motion override. | A formal screen-reader and WCAG audit remains outstanding. |

## Deliberate adversarial runs

1. **Hot-restart cascade:** restarting the most compromised machine first increases residue and often allows spread.
2. **Wrong-vector remediation:** credential rotation only partially helps Midnight Canary; release rollback only partially helps Phantom Credential.
3. **Evidence-only delay:** snapshots preserve forensic value but do not stop spread by themselves.
4. **Isolation tax:** isolating healthy nodes consumes service-impact budget and can lower the final score.
5. **Replay mutation:** changing one action or seed changes the digest; adding an unsupported field rejects the import.
6. **Oversized replay:** text above 64 KiB rejects before parsing.

## Design weaknesses accepted for this prototype

- Three nodes make the causal chain legible but underrepresent fleet complexity.
- Directed fixture links do not model dynamic service discovery.
- Agent confidence is narrative UX, not probabilistic calibration.
- The score function is transparent in source but not adjustable in the UI.
- Replay integrity is an accidental-change digest, not a cryptographic signature.
- Browser downloads are not automatically written into an Obsidian vault.
- No durable session state is intentional; reload means rollback.

## Go / no-go recommendation

**Go for a bounded pilot, no-go for production control integration.** The prototype is safe and falsifiable as a rehearsal instrument. Before connecting even read-only real telemetry, require privacy review, a fixture/real-data mode boundary, content sanitization audit, signed scenario packs, calibrated scoring, and an explicit connector permission model. Do not add command execution to this artifact.
