# Adversarial review

## Verdict

Suitable for a local tournament prototype, not for safety-critical routing or
an accessibility guarantee. The commit boundary is strong; sensing remains
coarse and browser-dependent.

## Attacks and failures

| Failure | Consequence | Mitigation | Residual risk |
|---|---|---|---|
| Long gaze mistaken for intent | Unwanted armed petal | Dwell never executes; center clears it | User may still confirm the wrong highlight |
| Natural head bob looks like a nod | Accidental confirmation | Down-return sequence, active highlight, time window, cooldown | Coarse motion can still false-trigger |
| Face leaves frame | Stale highlight | Estimator loss clears highlight and freezes commits | Detection may report loss late |
| Camera/mic track ends or mutes | Missing modality | Immediate freeze; priority controls remain | Voice stop cannot work after mic loss; keyboard/touch stop remains |
| Speech hears `confirm` incorrectly | Wrong commit | Confirmation requires an existing highlight | Highlight itself can be wrong |
| Phrase contains `stop`, `cancel`, or `undo` | Ordinary parse could override safety | Priority scan occurs before all other parsing | Benign sentences containing those words fail safe |
| `FaceDetector` unavailable | Claimed gaze quality collapses | Explicit head/motion fallback label | Motion fallback is substantially less useful |
| Browser speech is remote | Audio crosses app’s local boundary | Pre-permission and in-session caveat | Vendor behavior is outside app control |
| Export exposes mission data | Sensitive values saved to disk | User-initiated local download; no automatic export | User controls the downloaded file afterward |
| Malicious extension/page modification | Media or task interception | No third-party scripts or app network code | Browser/extension trust is out of scope |
| Repeated speech service errors | Hands-free path degrades | Gesture plus accessible fallback; errors counted | Gesture cannot provide arbitrary values |
| Low light/backlighting | Unstable estimator | Large sectors, calibration, center dead zone | No universal environment guarantee |

## Privacy inspection

The application requests one combined media stream. Video is shown locally and
is passed either to the browser `FaceDetector` or an in-memory 32×24 analysis
canvas. The previous low-resolution luminance sample is replaced every frame
and cleared on stop/page exit. Audio is not read by application code; it is
available to the browser Web Speech implementation.

There is no `fetch`, XHR, WebSocket, EventSource, beacon, recorder, storage API,
canvas serialization, third-party script, external font, or analytics hook.
The JSON recorder stores event categories and recognized field names, not raw
speech text.

## Claims deliberately rejected

- webcam gaze is not pixel-precise or medical-grade;
- landmark presence does not prove eye direction;
- motion fallback is not eye tracking;
- recognition is not guaranteed offline;
- gaze/dwell is not consent;
- a browser cannot guarantee vendor speech retention behavior; and
- keyboard/touch parity does not establish universal accessibility.

## Required follow-up before real use

Measure false nods, missed center rests, repair count, and recovery time across
lighting, skin tones, glasses, mobility patterns, browsers, cameras, and speech
services. Add a user-adjustable calibration/dead-zone mechanism only if it can
remain voice-first and independently safety-tested.
