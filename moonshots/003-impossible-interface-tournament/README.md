# 003 — Impossible Interface Tournament

## Challenge

Build a voice-first interface with no conventional menus, forms, dashboards, or
chat box.

A circular VUI orb remains in the center as the safe rest zone. Voice supplies
intent. Webcam gaze estimates choose coarse radial directions. Gesture or voice
confirms, cancels, rotates, or moves between layers.

After camera/microphone permission, the tournament task must be completable
without keyboard or mouse.

## Interaction contract

- Voice expresses verbs, values, and confirmation.
- Gaze highlights one of 4–8 large sectors; gaze alone never executes.
- Gesture performs coarse navigation or explicit confirmation/cancel.
- Returning gaze to the center cancels dwell and rests the eyes.
- “Stop,” “cancel,” “undo,” and sensor loss always fail safe.
- Webcam frames remain local, ephemeral, and unrecorded.
- The application says **coarse webcam gaze estimate**, never medical-grade eye tracking.

## Inspiration

Original interaction principles were derived from:

- Nexus portal thresholds and spatial navigation,
- Pip-Boy gaze progress and persistent sensor feedback, and
- iframe-tunneler depth, cumulative layers, and portal motion.

Presentation code and visual themes are not copied.

## Tournament task

> Route three cobalt beacons at 14:30, mark them fragile, send them to ORION-7
> through North Gate, confirm, then return home.

Every variant uses the same task data, voice vocabulary, safety rules, and
instrumentation.

## Finalists

1. **Voice Orbit** — predictive radial intent petals.
2. **Gaze Compass** — coarse compass sectors with center-rest cancellation.
3. **Gesture Tunnel** — cumulative spatial layers navigated by motion and voice.

## Unified product — Adaptive Orb

The tournament feeds one final application rather than shipping three separate
interfaces.

Adaptive Orb keeps one AI conversation, one task/history model, and one
camera/microphone privacy lifecycle while changing interaction grammar:

- Orbit for broad spoken intent and predicted next actions;
- Compass for precise follow-up selection; and
- Tunnel for deep branches, revisions, and scenario navigation.

The final product includes an offline deterministic AI demo, an optional
server-side RAPP brainstem connector, and a mobile/installable iOS PWA. Browser
credentials and raw camera/audio never enter persistent storage.

## Mobile-first thesis

Adaptive Orb is an eyes-up operating layer for speaking with AI when hands and
attention are occupied.

The primary scenarios are:

- guided cooking and hands-busy tasks,
- field and workshop checklists,
- walking note capture and decision support,
- accessibility and switch-assisted control, and
- quick real-world planning without stopping to type.

The phone experience is designed first: portrait-safe layout, large radial
targets, short spoken responses, progressive microphone/camera permission, and
state recovery after interruption or orientation change. Desktop remains a
development and fallback environment.

The application is not intended for driving or safety-critical control.

## Measured gates

- exact task completion,
- false commits,
- completion time,
- calibration time,
- dwell cancellations,
- voice repairs,
- recovery after sensor loss,
- gesture/voice fallback use,
- camera and microphone on-time, and
- no raw frame/audio persistence.

Safety and fallback parity are mandatory before speed can win.

## Status

**Complete — Adaptive Orb AI/PWA published**

## Result

- [Launch Adaptive Orb](adaptive-orb/)
- [Read the tournament verdict](JUDGING.md)
- [Inspect measured results](RESULTS.json)
