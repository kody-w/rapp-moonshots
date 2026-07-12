# RAPP Moonshots

Ambitious, working experiments built by fleets of RAPP agents and machines.

A moonshot is not an idea document. It must finish with:

1. a working artifact,
2. measurable evidence,
3. adversarial review,
4. a reversible implementation path, and
5. a demonstration another person can run.

## Moonshots

| # | Moonshot | Status | Result |
|---:|---|---|---|
| 001 | [FleetGate](moonshots/001-fleetgate/) | **Complete** | Identical RAPP agent behavior across macOS and Windows |
| 002 | [Autonomous Invention Laboratory](moonshots/002-autonomous-invention-lab/) | **Complete** | Three applications + measured Shark Tank verdict |

See [`BACKLOG.md`](BACKLOG.md) for the larger idea portfolio.

## Repository layout

```text
moonshots/
  001-fleetgate/
    README.md
    src/
    evidence/
  002-autonomous-invention-lab/
    README.md
    tracks/
templates/
moonshots.json
```

Each moonshot owns its source, evidence, demo, and rollback instructions. Shared
infrastructure belongs here only after at least two moonshots need it.

## Operating rules

- Never commit credentials, tokens, private keys, personal data, or private fleet addresses.
- Public evidence must be redacted and independently understandable.
- No moonshot publishes, purchases, deploys, or deletes external resources without explicit approval.
- Source changes stay reversible and evidence distinguishes measured facts from claims.
- Failed experiments remain valuable when their failure is attributable and reproducible.

## Running a moonshot

Start from [`templates/MOONSHOT.md`](templates/MOONSHOT.md), assign independent
strategies, select measurable gates, and keep all work under one numbered
directory.
