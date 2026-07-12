# Gaze Compass

Gaze Compass is a dependency-free, local web application for Moonshot 003 Track
02. A voice-guided **coarse webcam gaze estimate** focuses one of four stable
compass sectors. Focus is spoken at 400 ms, sustained stability arms the choice,
and only an explicit voice, deliberate nod, keyboard, touch, or switch
confirmation executes it. The permanent center circle always cancels.

This is not pixel-precise eye tracking, a medical device, or a universal
accessibility claim.

## Run

```bash
cd moonshots/003-impossible-interface-tournament/tracks/02-gaze-compass
python3 -m http.server 8000
```

Open <http://localhost:8000/>. `localhost` is required for camera and microphone
permissions in most browsers. There are no package installs, build steps,
external assets, service workers, or application network calls.

For the no-sensor deterministic replay, choose **Run deterministic simulation**
or open:

```text
http://localhost:8000/?simulate=1
```

## One-click live path

1. Select **Allow camera + microphone** once. The application requests both in
   one `getUserMedia` call.
2. Follow center, north, east, south, and west targets. Settle and capture phases
   advance by time; calibration needs no click.
3. Say the desired value. Gaze toward its spoken direction and hold.
4. At 400 ms the candidate is spoken. Continue holding until the armed earcon.
5. Say exactly **confirm** or **approve**, or make a deliberate down/up nod.
6. Return to center after every confirmation. Center clears carry-over focus.

The exact tournament route is:

| Step | Value | Direction |
|---|---|---|
| Intent | Route | North |
| Load | 3 cobalt beacons | East |
| Time | 14:30 | South |
| Handling | Fragile | West |
| Destination | ORION-7 | North |
| Gate | North Gate | East |
| Release | Send route | South |
| Finish | Return home | Center |

## Safety model

- Gaze updates focus and dwell only; `GazeIntentController.update()` has no
  execution path.
- `confirm()` requires an armed sector and records its explicit source.
- Center, `cancel`, `stop`, `undo`, low confidence, page hiding, and sensor loss
  fail safe.
- Low confidence revokes focus and any arm; a new confident full dwell is
  required. A signal timeout clears the candidate and requires center
  reacquisition before recovery.
- Video processing prefers `requestVideoFrameCallback` metadata and otherwise
  gates on decoded-frame count or `currentTime`. Repeated frozen pixels never
  refresh confidence or dwell, and the freshness watchdog declares sensor loss.
- The watchdog reads the raw-frame gate, not controller sample timestamps. It
  is suspended during manual override and after completion. Confirmation also
  checks that gate synchronously, so a stale sensor arm is rejected even before
  a watchdog tick.
- Nod recognition starts a new gesture epoch when an arm begins and ends it on
  every confirm, cancel, center, confidence pause, or sensor loss. Both nod
  phases must occur after the current arm.
- Smoothing, a radial dead zone, center threshold, angular hysteresis, and a
  maximum credited sample gap reduce jitter and tab-stall arming.
- Dwell is adjustable from 0.8–2.2 seconds.

## Sensor honesty

When supported, `FaceDetector` supplies a coarse face-box/head-pose proxy.
Otherwise a low-resolution frame-motion head-pose fallback integrates local
motion. Both paths are calibrated to the same four coarse sectors. If three
automatic passes cannot separate targets, gaze pauses and the parity controls
remain usable.

No model claims to infer precise eye position. Lighting, camera placement,
glasses, involuntary motion, browser support, and motor range can all reduce
quality.

## Privacy

- A visible indicator shows camera, microphone, and pause state.
- Video is sampled into a 64×48 in-memory canvas. The raw `ImageData` is scoped
  to one processing turn and the canvas is immediately cleared.
- The fallback retains only one derived grayscale comparison buffer while the
  session is active; stopping sensors clears it.
- If any startup step fails after permission, the application cancels frame,
  calibration, and recognition loops, stops every acquired track, clears the
  preview, then enters parity-only mode.
- End Sensors advances an explicit lifecycle generation. A stream that resolves
  from an older permission request is immediately disposed, and interrupted
  calibration becomes usable parity-only control. Parity entry clears a prior
  voice pause; Center also provides a non-voice resume path.
- Calibration begin clears the previous model, quality, and timestamps. Every
  success, retry failure, terminal failure, freeze, or shutdown closes the
  attempt, hides/resets its overlay, and records a bounded duration.
- Audio is neither read into application buffers nor recorded.
- No raw frame or audio enters exported metrics.
- Export recomputes live camera/microphone on-time at export; stopping sensors
  first freezes those counters without losing elapsed time.
- Camera and microphone counters finalize independently when their tracks end.
  Mission completion time freezes when center-home is reached; later exports
  refresh only still-active sensor counters.
- Calibration duration is computed only from a closed start/end interval, so
  later routing or export time cannot extend it.
- CSP sets `connect-src 'none'`; the source contains no network client,
  persistence API, analytics, or recorder.
- Browser speech recognition may be unavailable or use browser/OS processing
  outside this application. The UI states that boundary and retains non-voice
  parity.

## Input parity

- **Keyboard:** hold arrow keys to dwell, Enter/Space to confirm, Escape or
  Backspace for center, `R` to repeat, and `U` to undo. On focused controls,
  Enter/Space keeps native behavior instead of invoking the global confirmer.
- **Touch/pointer:** hold a sector until armed, then use Confirm. Tap the center
  circle to cancel. Sensor-loss overlays never intercept pointer input, so the
  safe center remains reachable.
- **Single-switch:** Cycle starts timed focus, Center cancels, and Confirm
  activates only an armed choice.
- **Voice:** values provide direction guidance; exact `confirm`/`approve`,
  `cancel`, `stop`,
  `undo`, `resume`, `home`, `repeat`, `slower`, `faster`, and `export metrics`
  are supported when browser recognition exists. Negated or contextual
  confirmation phrases are rejected.

## Verify

```bash
node --test tests/gaze-compass.test.js
node validate.mjs
node validate.mjs --write-evidence
```

The suite covers calibration, sector math, hysteresis, center cancellation,
false-commit prevention, sensor-loss recovery, deterministic task completion,
privacy, Clawpilot theme, and parity affordances. The validator writes only
synthetic, privacy-safe evidence.

## Files

- `index.html` — Clawpilot-themed application shell and radial interface.
- `app.js` — local sensors, speech, earcons, gestures, parity, and metric export.
- `core.js` — deterministic calibration, selection, safety, task, and simulation.
- `validate.mjs` / `tests/` — dependency-free policy and behavior validation.
- `evidence/` — reproducible synthetic metrics and gate report.
