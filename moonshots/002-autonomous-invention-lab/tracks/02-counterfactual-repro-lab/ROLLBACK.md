# Rollback and cleanup

Counterfactual Repro Lab has no installer, service registration, dependency
change, remote state, or write outside this track.

## Stop the application

Press `Ctrl+C` in the launch terminal. Every trial workspace is already removed
in a `finally` block.

## Remove local runtime state

From this directory:

```bash
python3 -c "import shutil; shutil.rmtree('.runtime', ignore_errors=True)"
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
