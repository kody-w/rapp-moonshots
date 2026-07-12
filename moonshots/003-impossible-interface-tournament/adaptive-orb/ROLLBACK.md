# Rollback

Adaptive Orb is isolated to:

```text
moonshots/003-impossible-interface-tournament/adaptive-orb/
```

It changes no shared tournament, track, root, dependency, server, or data file.

## Immediate runtime stop

1. Say **stop**, press `S`, or choose **End sensors**.
2. The controller invalidates its lifecycle generation, cancels frame and
   speech retries, rejects delayed detector work, stops every media track,
   clears derived frame memory/canvas, and detaches the preview.
3. Close the tab to release browser-managed speech and synthesis resources.

No server-side cleanup, remote deletion, storage migration, or credential
revocation is needed because the app has no backend, network client, storage,
or secrets.

## Repository rollback

Before merge, discard only this directory:

```bash
git restore --staged moonshots/003-impossible-interface-tournament/adaptive-orb
rm -rf moonshots/003-impossible-interface-tournament/adaptive-orb
```

After merge, revert the Adaptive Orb commit rather than rewriting history:

```bash
git revert <adaptive-orb-commit>
```

Verify that the revert touches only the isolated directory with
`git diff --stat <before>..<after>`.

## Partial rollback

If live sensing proves unstable but the experiment must remain inspectable,
serve `?simulate=1` or use **Start sensor-free access**. Both paths use the same
task and safety machine while requesting no media. Do not weaken freshness or
enable gaze-only execution as a workaround.
