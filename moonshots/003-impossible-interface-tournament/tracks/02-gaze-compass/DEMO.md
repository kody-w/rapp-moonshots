# Demonstration

## Hook

In ten seconds: look north, hear “Route,” keep holding until it arms, say
“confirm,” then look center. The gaze changed focus; the voice committed; center
made the next action safe.

## Before

Conventional pointer interfaces assume precise hand control. Webcam “eye
tracking” demos often overclaim precision or let dwell become an accidental
click. Gaze Compass tests the narrower claim that calibrated, coarse directions
can help while an independent confirmation channel owns commitment.

## Live sequence

1. From this directory run `python3 -m http.server 8000`.
2. Open `http://localhost:8000/` and make the single permission activation.
3. Follow the five automatically timed calibration targets.
4. Route the shared cobalt task using the direction table in `README.md`.
5. Hold one wrong candidate for 400 ms, then return center. Show that it speaks
   and cancels without execution.
6. Cover or freeze the camera after arming, then try to confirm before the next
   watchdog tick. Even if browser frame counters keep advancing, show content
   invalidation, atomic stale-arm rejection, and required center reacquisition.
7. Stall FaceDetector while raw frames continue. Show processed-sample timeout,
   arm revocation, and automatic frame-motion fallback recalibration. Resolve
   the old request afterward and show that it cannot recover or move focus.
8. Feed a static or uniformly dark test camera while presented-frame counters
   advance. Show that it cannot produce gaze samples, arm, or confirm and enters
   bounded sensor-loss recovery.
9. During calibration, choose End Sensors. Show the calibration layer disappear
   and complete a parity choice with Center plus keyboard/touch/switch.
10. Finish the route across the rebuilt controller, return center, and show all
   seven confirmations in the aggregated privacy-safe metrics.

## Deterministic proof

Open `http://localhost:8000/?simulate=1`. The fixed replay performs one center
cancellation, one confidence-arm revocation, one atomic stale-sensor rejection,
one sensor-loss recovery, alternating voice/gesture confirms, the exact route,
and final center return. Exported simulation metrics are identical to
`evidence/simulation-metrics.json`.

```bash
node validate.mjs
```

## Result

The deterministic gate completes the exact task with zero false commits and
zero gaze-only executions. That proves the state machine and demo contract, not
real-world gaze accuracy. Live accuracy still needs a diverse participant and
hardware study.

## Reproduce

Prerequisites: a modern browser, Node.js for validation, and Python only for the
optional static server. The application itself has no external dependency or
build step.
