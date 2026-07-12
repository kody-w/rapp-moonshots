# Rollback and cleanup

Counterfactual Repro Lab has no installer, service registration, dependency
change, remote state, or write outside this track.

## Stop the application

Press `Ctrl+C` in the launch terminal. Shutdown cancels and joins every tracked
experiment worker, then returns only after each started trial has verified its
workspace deletion.

## Remove local runtime state

From this directory:

```bash
python3 -c "from pathlib import Path; import shutil; p=Path('.runtime'); shutil.rmtree(p) if p.exists() else None; assert not p.exists()"
```

`.runtime/` is ignored and contains no durable evidence. Downloaded receipts
live wherever the browser saves them and may be deleted normally.

## Revert the implementation

The public application entered `main` through merge commit `9f240bc`:

```bash
git revert -m 1 9f240bc
```

Then make a small integration commit that removes or marks Track 02 withdrawn
in:

- `moonshots/002-autonomous-invention-lab/index.html`
- `moonshots/002-autonomous-invention-lab/RESULTS.json`
- `moonshots/002-autonomous-invention-lab/JUDGING.md`
- `moonshots/002-autonomous-invention-lab/README.md`

On an uncommitted copy, remove only this track directory and the same shared
references. Never reset the repository or revert only the source-tip commit:
Track 02 was built through several commits before its merge.

## Verify zero residue

```bash
test ! -d .runtime && echo "Counterfactual Repro Lab: clean"
```
