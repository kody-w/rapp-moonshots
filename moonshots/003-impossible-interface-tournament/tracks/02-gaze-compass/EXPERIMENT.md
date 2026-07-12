# Experiment

## Hypothesis

Four calibrated, stable directions plus independent confirmation can complete
the shared routing task with fewer dangerous false commits than gaze dwell used
as a click.

## Falsifiable gates

1. The exact route is committed and center-home is reached.
2. Gaze-only executions equal zero.
3. Center cancels an announced or armed candidate.
4. Sensor loss clears arming and requires center recovery.
5. Calibration maps a translated, rotated sensor basis to all cardinals.
6. Identical synthetic input produces byte-equivalent metric objects.
7. No raw frame/audio persistence or application network client is present.
8. Keyboard, touch, and switch paths preserve separate arm and confirm phases.
9. Repeated video-frame identities cannot advance dwell and time out safely.
10. Negated/contextual confirmation speech cannot execute.
11. A stale sensor-derived arm is rejected synchronously without waiting for the
    watchdog.
12. Nod outbound and return phases both occur inside one arm epoch.
13. Late permission streams are disposed after End Sensors, and completion
    duration does not drift at export.

## Method

`runDeterministicSimulation()` uses fixed synthetic samples and a virtual clock.
It calibrates center plus four radial targets, dwells each expected sector,
asserts zero execution before explicit confirmation, alternates voice and
gesture confirmation, inserts a wrong-sector center cancellation, revokes one
armed choice with low confidence and blocks its confirmation, atomically rejects
a stale sensor-derived arm and recovers through center, then returns home.

Unit tests separately perturb the calibration basis, probe radial/angular
boundaries, and attempt confirmation after center cancellation and sensor loss.
Static policy tests inspect application source for the complete Clawpilot theme,
local-only assets, CSP, parity affordances, and prohibited networking,
recording, or persistence APIs.

## Reproduce

```bash
node --test tests/gaze-compass.test.js
node validate.mjs --write-evidence
```

## Deterministic result

The committed evidence records:

- exact task completion: pass,
- seven explicit confirmations: four voice and three gesture,
- false commits: 0,
- gaze-only executions: 0,
- confidence revocations/blocked stale confirmations: 1/1,
- stale sensor-arm rejections: 1,
- deliberate center cancellations: at least 1,
- sensor losses/recoveries: 1/1,
- raw frames/audio stored: 0/0, and
- application network requests: 0.

The fingerprint in `evidence/validation-report.json` binds the task, calibration,
timing, safety, and interaction summaries. It changes if those deterministic
outcomes change.

## Interpretation

This establishes deterministic state-machine safety and reproducibility. It
does **not** establish live accuracy, completion speed, accessibility for every
user, or speech privacy supplied by a browser vendor.

## Proposed live study

Run at least 24 participants across low/high light, laptop/external webcams,
glasses/no glasses, and FaceDetector/fallback modes. Compare:

1. Gaze Compass with independent confirmation.
2. The same sectors with dwell-to-commit.
3. Keyboard-only parity.

Measure exact completion, false commits, time, calibration retries, center
cancellations, voice repairs, sensor recovery time, estimator mode, and
camera/microphone on-time. Stop the study if any gaze-only execution is
observed. Do not collect raw video or audio.
