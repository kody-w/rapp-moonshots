# Measurable experiment

## Falsifiable value hypothesis

Given three seeded failures whose causes are known but hidden among two
plausible environmental controls, Counterfactual Repro Lab will:

1. reproduce every failing baseline in 3/3 isolated reruns;
2. identify the known causal variable in 3/3 scenarios;
3. reproduce every counterfactual pass in 3/3 reruns;
4. change exactly one bounded variable in every intervention;
5. verify the pre-baseline fixture snapshot still matches source before receipt;
6. leave zero trial workspaces behind; and
7. finish a median scenario in under 3,000 ms.

Any missed cause, unstable outcome, multi-variable intervention, unreported
fixture drift, residue, or median above the threshold falsifies this
prototype's value claim.

## Protocol

`python3 scripts/measure.py --write-evidence`

For each scenario, the runner:

1. snapshots and hashes fixture bytes, then executes the failing baseline three times;
2. tests locale and validation controls independently;
3. tests the seeded causal variable;
4. stops at the first unanimous opposite result; and
5. verifies every workspace cleanup and rechecks the source fixture hash before
   releasing the receipt.

The same immutable fixture snapshot runs in every trial, so a mid-run source
edit cannot create a mixed-version flip. It inherits zero experiment or secret
host keys and cannot accept a user command. Windows preserves only the required
`SYSTEMROOT` process-bootstrap value; receipts record its key name, never its
value.

## Observed result

Measurement captured in
[`evidence/experiment-results.json`](evidence/experiment-results.json):

| Metric | Gate | Observed |
|---|---:|---:|
| Cause-isolation accuracy | 3/3 | **3/3 (100%)** |
| Baseline reproducibility | 9/9 fail | **9/9 fail** |
| Counterfactual reproducibility | 9/9 pass | **9/9 pass** |
| Fixture source integrity | 3/3 verified | **3/3 verified** |
| Plausible controls rejected | 6 | **6** |
| Variables changed per trial | 1 | **1** |
| Trial workspaces cleaned | 36/36 | **36/36** |
| Residual workspaces | 0 | **0** |
| Median scenario duration | <3,000 ms | **574.04 ms** |

**Result: PASS.**

## Interpretation

The experiment proves that the application enforces and explains clean
counterfactuals for its seeded model. It does **not** prove that three variables
cover every real production failure, that simulation equals a full second OS,
or that temporal and hardware causes are solved. The next validation is a
read-only adapter over a sanitized real-world fixture with the same intervention
contract.
