# Voice Orbit

Voice Orbit is Track 01 of Moonshot 003: a working voice-first application in
which intent becomes four-to-eight predictive radial petals. A **coarse webcam
estimate** may highlight a petal, but only spoken `select`, a deliberate camera
nod, Enter, or the explicit touch fallback can activate it. Looking at the
center always relaxes the aim and cancels dwell.

The shared mission is built in:

> Route three cobalt beacons at 14:30, mark them fragile, send them to ORION-7
> through North Gate, confirm, then return home.

## Run

No install, build, external asset, or dependency is required.

```bash
cd moonshots/003-impossible-interface-tournament/tracks/01-voice-orbit
python3 -m http.server 8080
```

Open <http://localhost:8080/>. `localhost` is required because camera APIs need
a secure context. The single **Start voice + camera** click requests both media
permissions; normal interaction is hands-free afterward.

For the reproducible no-permission demo, choose **Run deterministic mission** or
open:

<http://localhost:8080/?simulate=1>

That simulation speaks the exact route, demonstrates that 900 ms of gaze dwell
does not commit, returns to center rest, explicitly confirms by voice, selects
home, and confirms home with a simulated nod.

## Interaction

| Input | Effect |
|---|---|
| Broad speech | Supplies intent and any recognized route values |
| Coarse gaze/head direction | Highlights one radial prediction |
| Center/rest direction | Clears highlight and cancels dwell |
| `select` / `confirm` | Activates the highlighted prediction |
| Deliberate down-and-return nod | Activates the highlighted prediction |
| `stop`, `cancel`, `undo` | Preempts ordinary voice interpretation |
| Arrow keys | Accessible radial aim fallback |
| Enter / explicit touch button | Accessible confirmation fallback |

Touching a petal only highlights it. A separate confirmation action is always
required.

## Sensor honesty

- `getUserMedia` provides local camera and microphone tracks.
- `FaceDetector` landmarks are used as a coarse proxy when exposed by the
  browser.
- A face bounding-box/head-position estimate is used when landmarks are absent.
- If `FaceDetector` is absent, a 32×24 ephemeral frame-difference estimate is
  labeled **motion fallback · not eye tracking**.
- Loss of camera, microphone, or the active estimator freezes activation and
  clears the armed highlight. Stop, cancel, and undo still work.
- This is not medical-grade eye tracking and does not claim pixel accuracy.

Webcam frames stay in memory only long enough for local analysis. The
application has no network client, recorder, storage API, analytics, or
external asset. However, browser Web Speech API implementations may send audio
to a vendor speech service. This caveat is visible before permission and during
use. Simulation and keyboard/touch controls avoid speech recognition.

## Instrumentation

**Export local JSON** (or voice `export`) downloads a local record containing:

- elapsed and completion time,
- errors and voice repairs,
- dwell time and center cancellations,
- voice/gesture/keyboard/touch confirmations,
- sensor transitions and losses,
- blocked actions, commits, false commits, cancels, and undos, and
- task values plus exact-task verdict.

It does not contain frames, audio, raw transcripts, or network identifiers.

## Validate

```bash
npm test
```

The dependency-free Node tests cover the state machine, all petal-count bounds,
gaze/dwell non-activation, explicit commits, center rest, sensor-loss freeze,
priority safety commands, exact deterministic completion, export privacy,
network/persistence absence, browser capability hooks, and the mandatory
Clawpilot theme.

## Files

- `index.html` — application shell and exact Clawpilot theme tokens
- `styles.css` — responsive radial interface
- `core.js` — deterministic state machine and instrumentation
- `app.js` — local media, speech, estimator, gesture, simulation, and fallbacks
- `tests/` — behavioral tests and static validator
- `EXPERIMENT.md` — protocol and measurable gates
- `ADVERSARIAL_REVIEW.md` — failure analysis and residual risk
- `ROLLBACK.md` — immediate stop and repository removal
- `PITCH.md` — finalist case
