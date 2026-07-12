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

For a true no-speech fallback, choose **Start keyboard + touch** or open
<http://localhost:8080/?fallback=1>. It requests no camera or microphone and
never constructs or starts Web Speech recognition.

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
| Center/rest direction | Clears highlight, cancels dwell, and resets gesture state |
| `select` / `confirm` | Activates the highlighted prediction |
| Deliberate nod around a settled petal pose | Activates only if it returns to that petal pose, not center |
| `stop`, `cancel`, `undo` | Preempts ordinary voice interpretation |
| Arrow keys | Accessible radial aim fallback |
| Enter / explicit touch button | Accessible confirmation fallback |

Touching a petal only highlights it. A separate confirmation action is always
required. After confirmation, route values are immutable: further route speech
is rejected until **Undo** or an explicitly confirmed **New route**.
Destination-like speech outside ORION-7, LUNA-3, ATLAS-2, and POLARIS-4 clears
the draft destination and reports a repair instead of retaining a stale value.
Directed corrections are parsed first: in “to X instead of Y” or “change
destination to X,” X is always the target and later identifier mentions cannot
override it.
Negation is scoped to fragile, delicate, and handle-with-care phrasing.

## Sensor honesty

- `getUserMedia` provides local camera and microphone tracks.
- `FaceDetector` landmarks are used as a coarse proxy when exposed by the
  browser.
- A face bounding-box/head-position estimate is used when landmarks are absent.
- If `FaceDetector` is absent, a 32×24 ephemeral frame-difference estimate is
  labeled **motion fallback · not eye tracking**.
- Directional aim and nod recognition use separate signals. Center handling
  runs first, so returning to center can never finish a nod.
- The analysis canvas is cleared in a `finally` block immediately after every
  sample, raw sample bytes are zeroed, and cleanup clears it again.
- Loss of camera, microphone, or the active estimator freezes activation and
  clears the armed highlight. Stop, cancel, and undo still work.
- The microphone indicator reflects only its physical media track. Browser
  speech-service denial disables recognition without marking that track lost,
  freezing gesture, or blocking keyboard/touch confirmation.
- Every awaited media step rechecks the active session. Stop cleanup is
  idempotent, removes every recognition callback/restart, and cannot revive
  speech after a delayed preview start.
- This is not medical-grade eye tracking and does not claim pixel accuracy.

Webcam frames stay in memory only long enough for local analysis. The
application has no network client, recorder, storage API, analytics, or
external asset. However, browser Web Speech API implementations may send audio
to a vendor speech service. This caveat is visible before permission and during
use. Simulation avoids live recognition; **Start keyboard + touch** guarantees
that no media or speech API is requested.

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
locked committed routes, completion-time freezing, destination normalization,
no-media startup isolation, native Enter activation, analysis-canvas clearing,
media-stop races, scoped handling negation, repeated-stop timing, source-aware
undo repairs, network/persistence absence, browser capability hooks, and the
mandatory Clawpilot theme.

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
