# 001 — FleetGate

FleetGate proves that reviewed, byte-identical RAPP agents retain the same tool
schema and deterministic behavior across heterogeneous machines.

## Measured result

- 4 operating-system/runtime combinations
- Python 3.9, 3.12, and 3.14
- 12/12 node executions passed
- 36/36 agent/node/round records passed
- one identical normalized evidence hash
- source tampering, timeouts, launch failures, and malformed output rejected
- zero persistent remote writes

The private run used a controller Mac, two Apple Silicon workers, and one
Windows worker. Public evidence intentionally replaces private host identities
with generic roles.

## Run it

```bash
cd src
cp fleet/inventory.json fleet/inventory.local.json
# Edit SSH aliases and Python commands for your machines.
python3 fleet.py verify \
  --inventory fleet/inventory.local.json \
  --rounds 3 \
  --open
```

Verify a saved evidence capsule with the trusted root printed when it was
created:

```bash
python3 fleet.py verify-evidence results/fleetgate/<run-id> \
  --expected-capsule <trusted-sha256>
```

## Safety model

FleetGate has no raw-command input. It sends a fixed, reviewed harness over
stdin, validates agent bytes before in-memory execution, and never installs an
agent or writes a persistent file on a worker.

This is a portability and reproducibility result—not a hostile-code sandbox or
hardware attestation claim.

## Public receipt

See [`evidence/public-summary.json`](evidence/public-summary.json). The complete
private capsule remains local because it contains machine identities.

## Rollback

Delete generated `results/` directories. Workers receive no persistent change.

