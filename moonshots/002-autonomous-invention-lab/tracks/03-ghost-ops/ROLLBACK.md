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

From the repository worktree:

```bash
git log --oneline -- moonshots/002-autonomous-invention-lab/tracks/03-ghost-ops/
git revert <ghost-ops-commit-sha>
```

The implementation changes only `moonshots/002-autonomous-invention-lab/tracks/03-ghost-ops/`, so reverting its single local commit removes the application without touching shared infrastructure or another invention track.

Verify the rollback:

```bash
git status --short
test ! -e moonshots/002-autonomous-invention-lab/tracks/03-ghost-ops/index.html
```

If the commit has not been created, discard only this owned path:

```bash
git restore --staged --worktree moonshots/002-autonomous-invention-lab/tracks/03-ghost-ops/
```

Never use a repository-wide reset for this track.
