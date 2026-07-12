# Gesture Tunnel

Track 03 turns the tournament task into eight cumulative spatial depths. A
central safe orb anchors six tunnel mouths; every confirmed layer remains
visible as a nested shell. Voice names a tunnel, coarse webcam direction only
previews it, broad frame-difference motion rotates/opens/backs, and **“choose”**
is the commit boundary.

## Run

Camera APIs require a secure context. From this directory:

```bash
python3 -m http.server 8033
```

Open:

- live: <http://localhost:8033/>
- deterministic demo: <http://localhost:8033/?simulate=1>
- strictly local accessible path (no media request): <http://localhost:8033/?accessible=1>
- either theme: add `&scoutTheme=light` or `&scoutTheme=dark`

The live path has one permission click. No pointer or keyboard is needed after
it: say the prompted intent, move coarsely toward a mouth or use a horizontal
camera-motion sweep, dip to open its threshold, then say **“choose.”** Say
**“stop,” “cancel,” “undo,” “recover,”** or **“resume”** at any time.

## Honest sensing contract

- Camera frames are mirrored, downsampled to 96×72, converted to grayscale, and
  immediately reduced to a frame-difference centroid. No raw frame leaves the
  animation callback.
- Motion runs only for fresh camera frames via `requestVideoFrameCallback`, with
  advancing media time as fallback. Duplicate display frames cannot end a
  gesture or refresh the 2.5-second camera-stall watchdog.
- The detector recognizes only coarse displacement. It does **not** classify
  hands, identity, emotion, or precise eye direction.
- When `FaceDetector` exists, the face bounding-box center can provide a coarse
  head-position preview. This is still labeled a **coarse webcam gaze
  estimate**, never eye tracking. Detection results carry a tracker generation;
  any result resolving after stop or sensor replacement is discarded.
- Returning the head-position proxy to center, or holding motion neutral for
  1.2 seconds, cancels camera preview and resets dwell.
- This app makes no network request and uses no persistence API. It never
  records video or audio.
- Replay retains recognized option IDs and confidence, not free-form transcript
  text.
- Browser `SpeechRecognition` may be implemented by the browser/vendor as a
  cloud-backed service. The launch disclosure says so. Use `?accessible=1` when
  browser-level network processing is unacceptable.
- Speech synthesis uses an available browser/device voice and captions every
  state change.

Camera loss freezes depth and cancels pending input. Recovery never replays the
canceled preview. Confidence thresholds, 600 ms camera dwell, 900 ms gesture
cooldown, 500 ms commit cooldown, and a 480 ms neutral gate reject noisy input.
Camera loss preserves a voice listener restricted to “recover.” Terminal
recognition errors—including permission, audio capture, service, and language
failures—disable restart until explicit keyboard recovery; transient failures
use exponential backoff capped at four seconds. Evidence appears only for a
completed route and labels exact and mismatched results differently.

If the browser restores the page from back/forward cache, a persisted
`pageshow` forces a same-URL reload. This resets torn-down media, recognition,
launch, and simulation state in live, accessible, and deterministic modes.

## Deterministic proof

`?simulate=1` executes fixed timestamps for the identical task:

> Route three cobalt beacons at 14:30, mark them fragile, send them to ORION-7
> through North Gate, confirm, then return home.

The script intentionally commits 15:00, undoes it, loses the camera, proves
input is frozen, recovers, completes the exact route, and exposes local metrics
and replay downloads. Golden JSON is in `evidence/`.

## Validate

```bash
npm test
npm run validate
npm run evidence
npm run experiment
```

Only Node’s built-in test runner is used; there are no dependencies or external
assets. `index.html` is a generated, self-contained artifact. Edit `src/`, then
run `npm run build`.

## Accessibility fallback

The switch path preserves the same state machine and commit rules: Left/Right
preview, Enter or Space choose, Up or U undo, Escape cancel, R recover, and E
prepare exports. It includes assertive state summaries, visible captions,
high-contrast support, and reduced-motion handling. The keyboard is an explicit
fallback, not part of the primary no-keyboard/no-pointer flow.

## Files

- `index.html` — runnable single-file application
- `src/core.mjs` — deterministic state, gesture bounds, replay, metrics
- `src/app.mjs` — local sensors, speech, rendering, fallback
- `tests/` and `scripts/validate.mjs` — behavioral and static safety gates
- `EXPERIMENT.md` — hypothesis, protocol, and measured deterministic evidence
- `ADVERSARIAL_REVIEW.md` — failure analysis and residual risks
- `ROLLBACK.md` — track-only removal/revert path
- `PITCH.md` — tournament pitch
