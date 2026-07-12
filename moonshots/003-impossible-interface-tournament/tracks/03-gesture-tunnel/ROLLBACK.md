# Rollback

Gesture Tunnel is isolated to:

```text
moonshots/003-impossible-interface-tournament/tracks/03-gesture-tunnel/
```

It changes no shared manifest, route, dependency, server, schema, storage, or
external service. Nothing is deployed and runtime data exists only in memory or
in an explicit local JSON download.

## Revert a merged commit

```bash
git revert <track-commit-sha>
```

That removes the application and evidence while preserving public history.

## Remove before merge

```bash
git rm -r moonshots/003-impossible-interface-tournament/tracks/03-gesture-tunnel
```

## Runtime stop

Close the tab. Its `pagehide` handler aborts recognition, stops local media
tracks, cancels frame processing, and revokes generated Blob URLs. If a browser
retains a permission grant, revoke camera/microphone access in the browser’s
site settings; the application stores no grant or token.

## Verification

After rollback, confirm `git status --short` has no path under the directory and
that the parent moonshot’s existing files are unchanged. No data migration or
cleanup job is required.
