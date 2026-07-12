# Ghost Ops experiment — does decision order matter?

## Falsifiable value hypothesis

On identical incident fixtures, a policy that controls spread before restoring service will finish **at least 15 containment-score points higher on average** than a policy that restores service before controlling spread.

The hypothesis fails if the mean paired difference is below 15 points. It is not evaluated by subjective playtest impressions.

## Protocol

- Engine: embedded Ghost Ops engine `1.0.0`
- Scenarios: Midnight Canary and Phantom Credential
- Seeds: integers `1..100` for each scenario
- Trials: 200 matched pairs, 400 total simulations
- Horizon: seven actions / 35 virtual minutes
- Independent variable: fixed policy order
- Primary outcome: final containment score (`0..100`)
- Secondary outcome: simulated lateral-spread events
- Controls: same scenario, seed, tick horizon, action budget, scoring function, and fixture topology within each pair

The containment-first policy blocks the highest-risk node's egress, preserves its evidence, applies the vector-specific remediation, and then controls adjacent machines. The recovery-first policy begins with a hot restart, applies an early wrong-target or wrong-vector recovery, and delays effective controls. Both policies use seven legal bounded actions; neither receives hidden engine access.

## Reproduce

From this directory:

```bash
node experiment.mjs
```

The script uses only built-in Node modules, extracts the exact engine shipped inside `index.html`, runs the cohort, and prints machine-readable JSON.

## Measured result

Recorded locally on 2026-07-11:

| Scenario | Pairs | Containment-first mean | Recovery-first mean | Mean delta | Spread events, C / R | Paired wins |
|---|---:|---:|---:|---:|---:|---:|
| Midnight Canary | 100 | 61.990 | 16.390 | +45.600 | 0.500 / 4.870 | 100 / 100 |
| Phantom Credential | 100 | 53.980 | 13.590 | +40.390 | 0.750 / 4.300 | 100 / 100 |
| **Combined** | **200** | **57.985** | **14.990** | **+42.995** | **0.625 / 4.585** | **200 / 200** |

**Verdict: supported.** The observed `+42.995` point advantage exceeds the pre-registered `+15` threshold by `27.995` points. Mean spread events fell by `86.37%`.

## What this proves

It proves that Ghost Ops' bounded decisions have measurable, deterministic consequences and that policy order can be compared with paired experiments. The UI is not a branching slideshow: its tick engine propagates controls, vector efficacy, spread, compromise, evidence, and service impact.

## What this does not prove

- Fixture effect sizes do not estimate production incident outcomes.
- The two hand-authored policies are not optimal policies.
- The score weights encode a product hypothesis and require calibration with real postmortems.
- One topology with three nodes cannot represent a full fleet.
- Agent recommendations are deterministic perspectives, not independently trained responders.

## Next falsification

Blind ten incident commanders to policy labels, let each choose freely on matched seeds, and test whether the exported playbook helps a second operator improve score by at least ten points on their first replay. That would test learning transfer—not merely engine mechanics.
