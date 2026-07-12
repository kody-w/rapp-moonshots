# Adversarial review

## Strongest objection

A commodity webcam cannot reliably infer gaze. Correct: this prototype uses
calibrated face position or frame motion as an explicitly labeled **coarse
webcam gaze estimate**. The invention under test is safe multimodal commitment,
not eye-tracker precision.

## Threats and responses

| Attack or failure | Current response | Residual boundary |
|---|---|---|
| Jitter crosses a sector edge | EMA smoothing, radial dead zone, angular hysteresis, capped credited sample gap | A sustained wrong pose can still arm; confirmation must remain independent |
| User stares at an option unintentionally | Dwell only arms; it never executes | User may still say an ambiguous confirmation |
| Synthesized speech triggers recognition | Recognition is aborted while the app speaks and restarted afterward | OS/browser echo behavior varies |
| Casual movement resembles a nod | Nod needs an outbound movement and timed reversal; center processing precedes gesture confirmation | Some motor patterns can false-positive; voice/switch should be preferred for high stakes |
| Camera freezes after arming | Decoded-frame identity/`currentTime` must advance; repeated pixels are ignored, the watchdog clears focus, and center recovery is required | Browser metadata quality varies, so timeout remains necessary |
| Confirmation races the watchdog | `confirm()` synchronously checks raw-frame freshness for sensor-derived arms and atomically enters sensor-loss recovery | Manual/switch arms intentionally do not depend on camera freshness |
| Motion begins before arming | Nod detector epochs are opened on arm and closed on every arm exit; pre-arm phases are discarded | Deliberate movement entirely after arming can still be ambiguous |
| End Sensors races permission | A generation token invalidates the request; any late stream is stopped before use, and parity mode replaces interrupted calibration | Browser permission UI itself remains browser-controlled |
| Confidence drops after arming | The arm and dwell are revoked immediately; explicit confirm is rejected until a full confident re-dwell | Confidence itself remains heuristic |
| Negated speech contains “confirm” | Only exact allowlisted confirmation phrases execute | Recognition can still mistranscribe an intended exact phrase |
| Low confidence later improves | Dwell time pauses rather than accumulating wall-clock time | Confidence itself is heuristic |
| FaceDetector disappears mid-session | Input clears and timed calibration restarts for the fallback coordinate space | Recalibration interrupts the task |
| Calibration cannot separate targets | Three automatic attempts, then gaze is disabled while parity remains | This user/device combination receives no gaze benefit |
| Hidden tab continues an action | Visibility loss clears arming and requires center | Camera hardware may remain powered until End sensors or page close |
| Malicious network exfiltration | CSP `connect-src 'none'`; no client, analytics, recorder, or persistence API | Browser speech processing is outside the app’s implementation boundary |
| Raw frame retained accidentally | Canvas clears each turn; only one derived grayscale fallback buffer survives until stop | Heap snapshots by a privileged browser/debugger are outside the threat model |
| Metrics drift after completion | Completion timestamp freezes at center-home; ended tracks finalize counters and export updates only active sensor time | Wall-clock suspension can still affect browser-provided monotonic timing |
| Touch or switch becomes gaze-only commit | Sector/Cycle only focuses and dwells; separate Confirm is mandatory | Assistive technology configuration must expose both operations |
| Wrong task values are confirmed | Final send is rejected unless every expected value matches | A more general product needs explicit reversible editing and authorization |

## Abuse cases

- Do not use this prototype for weapons, vehicles, medical care, financial
  transfer, or irreversible physical control.
- Do not describe it as eye tracking, biometric inference, accessibility
  certification, or guaranteed hands-free control.
- Do not add gaze-only commit, hidden recording, remote telemetry, or background
  sensor collection.

## Go/no-go

The prototype may proceed to a consented local usability study only if the
validator remains green and a facilitator can stop sensors immediately. It must
not proceed to consequential deployment until diverse live trials establish a
false-commit bound and independent accessibility/security review passes.
