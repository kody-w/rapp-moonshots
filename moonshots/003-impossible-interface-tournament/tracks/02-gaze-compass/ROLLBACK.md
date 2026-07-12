# Rollback

## Immediate runtime stop

1. Say **stop** to clear any armed input.
2. Use **End sensors** or close the tab.
3. Verify the camera and microphone indicators show off.

Stopping destroys the in-memory stream, canvas pixels, derived grayscale frame,
recognition session, and gesture state. The application creates no server data,
browser database, cache, service worker, cookie, or local-storage entry.
Downloaded metric JSON contains no frame or audio; delete that user-controlled
file separately if it is not wanted.

## Repository rollback

This track owns only:

```text
moonshots/003-impossible-interface-tournament/tracks/02-gaze-compass/
```

After merge, revert the track commit:

```bash
git revert <gaze-compass-commit-sha>
```

Before merge, remove only the directory above or reset only its paths. Do not
change sibling tournament tracks.

## Feature rollback order

If a narrow defect is found, disable in this order while preserving safety:

1. Disable nod confirmation; retain voice and parity confirmation.
2. Disable the frame-motion fallback; retain FaceDetector and parity.
3. Disable all camera control; retain keyboard, touch, and switch parity.
4. Remove Track 02 entirely.

Never “fix” availability by allowing dwell or gaze to execute directly.
