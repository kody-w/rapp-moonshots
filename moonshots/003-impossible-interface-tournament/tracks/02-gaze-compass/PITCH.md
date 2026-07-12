# Shark Tank pitch — Gaze Compass

## Hook — 10 seconds

Look north. Hear “Route.” Hold. Say “confirm.” Look home. Gaze found the choice,
but gaze was never trusted to send it.

## Customer

Operators whose hands are occupied or unreliable, but who still need a compact,
auditable way to choose among a few stable actions: assisted-workstation users,
field technicians, and supervised control-room teams.

## Problem

Pointers demand precision. Voice-only systems hide alternatives and mishear
context. Webcam gaze demos often turn an accidental look into a click. The
result is slow correction at best and frightening unintended action at worst.

## Invention

Gaze Compass separates attention from consent. A calibrated coarse webcam gaze
estimate supplies one of four directions. At 400 ms the application speaks the
candidate. Stability arms it. A different channel—voice, deliberate nod, or an
accessible switch—commits it. Center always cancels, and sensor loss erases the
arm.

## Live proof

The deterministic replay routes three cobalt beacons at 14:30, marks them
fragile, sends them to ORION-7 through North Gate, confirms, and returns home.
It also cancels a wrong focus and recovers from sensor loss. Exported metrics
show seven explicit confirmations, zero false commits, zero gaze-only
executions, and no raw media or network request.

## Why now

Modern browsers provide camera permission, speech synthesis, optional
FaceDetector, Web Audio, and accessible web controls without an SDK. The RAPP
moonshot harness supplies a shared task, adversarial gates, deterministic
evidence, and parallel interface variants for honest comparison.

## Why moonshot

If attention and consent can be safely separated, interfaces can become useful
when hands, screens, or precise pointers are unavailable. This prototype proves
a testable state-machine boundary, not the category-scale accuracy or
accessibility outcome.

## Business wedge

Start with a supervised, reversible four-choice workstation workflow where
every command is reviewed and no physical action is irreversible. Sell local
deployment, calibration analytics that exclude raw media, and integration
validation—not “mind reading.”

## Risks

Commodity cameras are noisy; browser speech processing varies; head motion is
not eye gaze; nods can be ambiguous; and some users cannot or should not use
these inputs. The product must preserve parity, independent confirmation,
visible sensors, and local ephemeral processing.

## Ask

Fund a consented 24-participant cross-device study against dwell-to-commit and
keyboard baselines. Advance only if exact completion holds, gaze-only execution
remains zero, and the independent accessibility/privacy review passes.
