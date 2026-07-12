# Adaptive Orb experiment

## Hypothesis

A shape-selected interaction grammar can outperform any single prototype
without weakening its safety boundary: broad voice drafts in Orbit, stable
radial choices in Compass, and nested recovery in Tunnel can share one task and
one sensor lifecycle with zero gaze-only commits.

The claim is falsified if a mode switch changes task/history/safety state, gaze
executes, stale sensing confirms, or the exact shared task cannot finish using
all three modes.

## Fixed task

> Route three cobalt beacons at 14:30, mark them fragile, send them to ORION-7
> through North Gate, confirm, then return home.

## Deterministic protocol

Run `npm run evidence` or open `?simulate=1`.

1. Capture and explicitly accept broad intent in Orbit.
2. Automatically enter Compass.
3. Dwell on ORION-7 and attempt a gaze confirmation; require rejection.
4. Return to center; require aim/dwell cancellation.
5. Re-arm ORION-7, inject stale content, and attempt voice confirmation;
   require freeze.
6. Recover content freshness and explicitly confirm ORION-7 and North Gate.
7. Automatically enter Tunnel.
8. Explicitly enter the wrong Amend branch, then say undo.
9. Confirm the exact route and Return home.
10. Export metrics and compare the exact fingerprint.

## Checked-in result

Generated from the state machine, not hand-entered:

| Measure | Deterministic result |
|---|---:|
| Exact task verdict | true |
| Scripted completion | 8,700 ms |
| Modes used | Orbit, Compass, Tunnel |
| Automatic transitions | 2 |
| Errors | 2 |
| False commits | 0 |
| Blocked gaze commit attempts | 1 |
| Center cancels | 1 |
| Voice repairs | 2 |
| Sensor loss / recovery | 1 / 1 |
| Recovery duration | 350 ms |
| Intentional wrong branch / undo | 1 / 1 |
| Orbit confirmations | 1 |
| Compass dwell / confirmations | 3,600 ms / 2 |
| Tunnel dwell / confirmations | 2,700 ms / 3 |
| Raw frame/audio/transcript storage | false / false / false |
| Application network/persistence | false / false |

Fingerprint: `c1b6e39f`.

## Acceptance gates

- task equals all nine expected fields, including confirmation and home;
- every mode has at least one confirmation and mode transitions are ordered;
- gaze and dwell never execute;
- center clears highlight, dwell, arm, and gesture epoch;
- independent freeze causes recover independently;
- stale generation, frame, content, and processed-estimate samples fail closed;
- delayed permission/play and detector work cannot revive an old generation;
- stop/cancel/undo preempt mixed ordinary speech;
- sensor-free keyboard/touch/switch control completes the same task;
- sensor-free control enters quantity, color, time, and handling through visible
  semantic options without direct voice dispatch;
- every sensor-free transition stops camera, microphone, and recognition before
  accessible state is committed or rendered;
- invalid content immediately revokes aim and requires fresh content plus a
  separately accepted processed estimate;
- long sensor gaps clear dwell and require a new highlight; duplicate/invalid
  dwell samples add no events;
- gesture epochs include highlighted choice identity;
- every pending detector working copy is zeroed on completion or teardown;
- deterministic mode rejects external input and verifies fingerprint
  `c1b6e39f` before any success announcement;
- JSON contains no raw media or raw transcript;
- generated HTML has exact Clawpilot tokens, no external asset, and
  `connect-src 'none'`;
- checked-in evidence exactly equals a fresh replay.

## Live study protocol

The deterministic fixture proves logic, not usability. A consented live study
should compare Adaptive Orb with each original track under the same browser,
camera position, lighting, task wording, and injected failure.

Record only semantic metrics:

- exact completion and time;
- mode changes, repairs, center cancels, and undo;
- false commits and blocked confirmations;
- calibration/freshness loss and recovery;
- per-mode dwell and confirmation source;
- workload, fatigue, and confidence;
- browser, OS, `FaceDetector` availability, and vendor speech boundary.

Do not record video or audio. Stop the study after any gaze-only execution or
irreversible effect. Report scripted and human timings separately.

## Interpretation boundary

The fixture does not establish precise gaze, gesture recognition, universal
accessibility, browser-vendor speech privacy, or safe consequential control.
Those claims remain explicitly out of scope.
