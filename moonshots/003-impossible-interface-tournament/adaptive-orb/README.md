# Adaptive Orb

Adaptive Orb is the unified Moonshot 003 product. It is one application with
one persistent central safe-rest orb, one cobalt-beacon task, one history, one
sensor/privacy lifecycle, and three interchangeable interaction grammars:

- **Voice Orbit** captures broad intent, time, and handling, then generates
  predictive petals.
- **Gaze Compass** stabilizes fine selection among four to eight radial choices.
- **Gesture Tunnel** exposes nested review, repair, undo, and home layers.

It is not three pages and contains no iframe. Mode changes never replace the
task machine.

## Run

No install or dependency is required. Camera access needs localhost or another
secure context.

```bash
cd moonshots/003-impossible-interface-tournament/adaptive-orb
python3 -m http.server 8073
```

Open:

- live one-click path: <http://localhost:8073/>
- deterministic all-mode replay: <http://localhost:8073/?simulate=1>
- either theme: append `&scoutTheme=light` or `&scoutTheme=dark`

The launch screen also offers **Start sensor-free access**, which requests no
camera or microphone and does not create Web Speech recognition.

Sensor-free task entry is fully semantic and UI-exposed: choose Route beacons,
then quantity, color, time, handling, the predicted intent, destination, gate,
review confirmation, and home. Keyboard, touch, and single-switch controls can
complete this entire path without a synthetic voice event.

## Normal flow

1. Select **Start voice + camera** once.
2. Say “Route three cobalt beacons at 14:30, mark them fragile.”
3. Say “confirm” to accept the predicted broad intent.
4. Hold a coarse direction on ORION-7, then explicitly say “confirm” or nod.
5. Select North Gate the same way.
6. Navigate the review tunnel with coarse horizontal motion or option names.
7. Explicitly confirm the route and Return home.

After launch, pointer and keyboard are not required in the intended live flow.
Speech `orbit`, `compass`, and `tunnel` manually changes grammar; `auto mode`
restores shape-based selection. `stop`, `cancel`, and `undo` preempt ordinary
speech.

Automatic mode choice is deterministic:

- broad or unstable intent → Orbit;
- stable flat sets of 4–8 choices → Compass;
- hierarchical or depth ≥ 2 → Tunnel.

## Safety contract

- Center always relaxes aim and cancels dwell.
- Gaze can highlight and arm, but has no execution path.
- Voice, gesture, keyboard, touch, or switch confirmation is explicit.
- Task confirmation is local and reversible; the app performs no dispatch or
  irreversible external action.
- Camera, microphone, raw frame, content, and processed-estimate status share
  one controller but create independent safety causes.
- A loss clears pending aim. Removing one cause never removes another.
- Task values, history, freeze causes, sensor freshness, and metrics survive
  grammar changes.
- Sensor-free controls use the same task state and separate highlight/confirm
  phases.

## Honest sensing and privacy

The live path makes one combined `getUserMedia` request. `FaceDetector`, when
available, contributes only a transient face-box/head-position proxy. Otherwise
a 48×36 local frame-motion estimate is used. Both are visibly labeled coarse
and **not eye tracking**.

Every new media frame is identity-gated. Uniform, dark, overexposed,
low-detail, or nearly unchanged content cannot refresh the content gate.
Raw `ImageData` bytes are zeroed and the analysis canvas is cleared every turn.
One rolling derived grayscale comparison and at most one registered detector
working copy may coexist. Every registered copy is zeroed on result, detector
replacement, invalid content, or shutdown. Delayed detector results carry
lifecycle, content, and detector-identity epochs.

The app has no network client, recorder, persistence API, analytics, service
worker, external asset, or raw transcript export. Browser Web Speech API
implementations may send audio to a browser/OS vendor; this limitation is
visible before permission and during use. Sensor-free access avoids it.

## Deterministic acceptance fixture

`?simulate=1` visibly executes one scripted task with logical time:

- Orbit captures broad intent/time/handling and confirms its prediction;
- Compass blocks a gaze commit, performs center rest, injects content loss,
  recovers, then selects ORION-7 and North Gate;
- Tunnel intentionally enters the wrong Amend branch, undoes it, confirms the
  route, and returns home.

Replay mode rejects pointer, voice, keyboard, switch, and programmatic state
actions. It claims success only after exact state and fingerprint `c1b6e39f`
both match.

Checked-in evidence reports exact completion in 8,700 ms scripted time, all
three modes, zero false commits, one blocked gaze attempt, one center cancel,
two voice repairs, one loss/recovery, and one intentional wrong branch/undo.
This is logic evidence, not a measured human completion speed.

## Metrics export

**Export local JSON metrics** downloads semantic state only:

- mode transitions and exact-task verdict;
- completion time, errors, false commits, blocked gaze attempts;
- center cancels, voice repairs, commits, and undo;
- loss/recovery counts and recovery duration;
- per-mode active time, dwell, and confirmations;
- task values and sensor status/freshness timestamps.

Frames, audio, raw transcripts, face boxes, and identifiers are excluded.

## Build and verify

```bash
npm run build
npm test
npm run evidence
npm run verify
```

The build reads public-safe deterministic results from all three merged
prototype tracks, then generates the dependency-free, self-contained
`index.html`. Node’s built-in test runner and the static validator cover shared
state, mode switching, no-gaze commit, exact all-mode replay, freshness,
lifecycle races, privacy, Clawpilot theme, parity, and external-asset absence.

## Files

- `index.html` — generated self-contained demo
- `src/core.mjs` — shared task, history, safety, modes, metrics, replay
- `src/sensors.mjs` — one guarded media/speech/freshness lifecycle
- `src/app.mjs` — rendering, live inputs, parity, export, page lifecycle
- `src/comparison.mjs` — normalized tournament comparison
- `src/index.template.html` / `src/styles.css` — Clawpilot application shell
- `scripts/` — dependency-free build, evidence, and policy validation
- `tests/` — Node behavior, lifecycle, privacy, and static tests
- `evidence/` — deterministic semantic metrics and replay
