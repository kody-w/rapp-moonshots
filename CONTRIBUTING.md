# Contributing

## Add a moonshot

1. Copy `templates/MOONSHOT.md` into `moonshots/NNN-short-name/README.md`.
2. Add the moonshot to `moonshots.json` and the root catalog.
3. Define measurable pass/fail gates before implementation.
4. Keep private inputs and credentials outside the repository.
5. Include rollback instructions and a runnable demonstration.

## Evidence

Evidence should contain the minimum public-safe information needed to support a
claim. Prefer deterministic outputs, hashes, test reports, and reproducible
commands over screenshots or prose.

## Pull requests

Pull requests should describe:

- the objective,
- the measured outcome,
- known limitations,
- how to reproduce it, and
- how to remove it.

