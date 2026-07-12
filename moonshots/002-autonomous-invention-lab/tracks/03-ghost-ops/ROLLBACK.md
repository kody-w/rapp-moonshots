# Ghost Ops rollback

Ghost Ops is intentionally ephemeral and isolated.

## Roll back a running exercise

1. Choose **Run another incident** from the finale, or reload/close the tab at any time.
2. No runtime cleanup is required: state lives only in page memory.
3. No cookie, local storage, service worker, cache entry, host change, or network operation is created.

## Roll back exported artifacts

Delete the user-initiated local downloads:

- `ghost-ops-<scenario>-<digest>.md`
- `ghost-ops-<scenario>-<digest>.json`
- `ghost-ops-replay-<digest>.json`

Exports are ordinary files and are not automatically inserted into an Obsidian vault.

## Roll back source

The public application entered `main` through merge commit `cf1a8fc`:

```bash
git revert -m 1 cf1a8fc
```

Then make a small integration commit that removes or marks Ghost Ops withdrawn
in:

- `moonshots/002-autonomous-invention-lab/index.html`
- `moonshots/002-autonomous-invention-lab/RESULTS.json`
- `moonshots/002-autonomous-invention-lab/JUDGING.md`
- `moonshots/002-autonomous-invention-lab/README.md`

Verify the rollback:

```bash
git status --short
test ! -e moonshots/002-autonomous-invention-lab/tracks/03-ghost-ops/index.html
```

Never revert only the Ghost Ops source-tip commit: two track commits were
integrated by the merge. Never use a repository-wide reset for this track.
