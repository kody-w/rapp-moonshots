# Experiment

## Hypothesis

Predictive radial intent can reduce verbal repair while retaining a hard safety
boundary: coarse attention chooses; explicit voice or gesture commits.

## Fixed task

Route three cobalt beacons at 14:30, mark them fragile, send them to ORION-7
through North Gate, confirm, then return home.

## Conditions

1. **Live multimodal:** one permission click, then voice + webcam only.
2. **Voice fallback:** speak a petal label, then `select`; camera remains active.
3. **No-media accessible fallback:** dedicated startup, arrows + Enter or touch
   aim + explicit confirm; no camera, microphone, or speech recognition.
4. **Deterministic simulation:** fixed actions and values, no permissions.

Run on localhost in a current browser. Record browser/OS, `FaceDetector` mode,
permission result, and whether Web Speech uses a vendor service. Do not record
participants or media.

## Procedure

1. Start the session and wait for all three indicators.
2. Begin timing when the intent prompt appears.
3. Complete the fixed task without pointer or keyboard in the live condition.
4. During review, hold attention on **Confirm route** for at least 1.4 seconds;
   verify no commit.
5. Aim downward, then return to center; verify highlight, dwell, and any gesture
   sequence cancel without a commit.
6. Highlight again and say `select`.
7. Highlight **Return home** and perform a deliberate down-and-return nod.
8. In a second run, remove a camera track while armed; verify freeze, then use
   stop/cancel/undo.
9. Export the local JSON and compare the task and event counters.

## Gates

| Gate | Pass condition |
|---|---|
| Exact completion | All seven route values match; confirmed; home returned |
| False commits | Zero commits caused by gaze or dwell |
| Petal bound | Every stage exposes 4–8 predictions |
| Center rest | Armed highlight clears and cancellation increments |
| Gesture separation | Downward petal aim + center return cannot complete a nod |
| Sensor loss | Highlight clears; commit blocks until all required sensors recover |
| Priority safety | Stop, cancel, and undo preempt mixed ordinary phrases |
| Hands-free | No post-start pointer/keyboard use in normal live completion |
| Privacy | No raw media/transcript export, persistence API, or app network client |
| Accessibility | Keyboard and touch can aim and explicitly confirm |
| No-speech startup | No media request and no SpeechRecognition construction/start |
| Commit integrity | Route speech cannot mutate committed/completed values |
| Timing | Completion freezes elapsed time before any delayed export |
| Theme | Exact Clawpilot variables and required fonts present |

## Metrics

- `elapsedMs`: start to completion, or latest state transition for an incomplete run
- `errors`: unsupported actions plus media/speech failures
- `voiceRepairs`: unrecognized speech or confirmation without a highlight
- `dwellMs` / `dwellCancellations`: inspected time and center resets
- confirmation counts by `voice`, `gesture`, `keyboard`, and `touch`
- `sensorTransitions` / `sensorLosses`: derived state only
- `blockedActions`, `commits`, `falseCommits`, `undos`, and `cancels`

## Reproducible evidence

`npm test` deterministically proves the exact state-machine route with a
2.7-second synthetic clock: 800 ms dwell, one center cancellation, one voice
confirmation, one gesture confirmation, zero errors, and zero false commits.
The visible browser simulation intentionally runs slower (about 7.5 seconds) so
each safety transition can be observed.

No human timing or accuracy result is claimed yet. A tournament comparison
requires the same participants, browser, camera position, task wording, and
sensor-loss injection across all three tracks.
