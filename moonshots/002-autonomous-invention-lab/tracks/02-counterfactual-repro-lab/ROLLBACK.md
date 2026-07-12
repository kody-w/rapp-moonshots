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

Revert the Track 02 commit with `git revert <track-commit-sha>`, or remove only
this directory on an uncommitted copy. No shared or root files need restoration.

## Verify zero residue

```bash
test ! -d .runtime && echo "Counterfactual Repro Lab: clean"
```
