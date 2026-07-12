# Rollback

## Stop immediately

Say **stop** or use **Stop sensors**. Voice Orbit stops every media track,
stops speech recognition, cancels frame analysis, clears ephemeral frame
buffers, detaches the preview, and freezes the state. Navigating away also runs
the same cleanup through `pagehide`, invalidates in-flight media work, and
marks the session stopped. A bfcache return shows a clean restart screen rather
than reviving the prior sensor state.

Browser permission can additionally be revoked from the site-permission icon.
The app creates no service worker, background process, database, cookie, local
storage, server resource, or network subscription.

## Remove from the repository

Voice Orbit owns only this directory. From the repository root:

```bash
git rm -r moonshots/003-impossible-interface-tournament/tracks/01-voice-orbit
git commit -m "rollback: remove Voice Orbit track"
```

No shared manifest, migration, dependency lock, generated asset, or parent
moonshot file needs restoration.

## Verify removal

```bash
test ! -e moonshots/003-impossible-interface-tournament/tracks/01-voice-orbit
git status --short
```

Any downloaded instrumentation JSON is outside the repository and must be
deleted separately by its owner if no longer wanted.
