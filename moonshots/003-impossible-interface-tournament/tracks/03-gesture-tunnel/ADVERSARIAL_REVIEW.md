# Adversarial review

## Review posture

Assume poor light, a moving background, speech errors, unavailable experimental
APIs, camera unplug, repeated browser events, motor or visual disability, and a
user who interprets “gaze” more literally than the implementation warrants.

| Attack or failure | Defense | Residual risk |
|---|---|---|
| Background motion resembles a swipe | 480 ms neutral gate, full-frame-motion rejection, confidence threshold, 900 ms cooldown | Fans, screens, or another person can still move the centroid |
| A head-position preview is mistaken for eye tracking | UI and docs say coarse webcam gaze estimate/head-position proxy; no eye or identity claim | “Gaze” can still create an inflated expectation |
| Preview causes a false commit | Preview and motion-enter cannot call commit; voice “choose” or switch Enter is required | Misrecognized “choose” remains possible, so voice confidence and commit cooldown apply |
| Camera disappears while a tunnel is armed | Sensor loss freezes depth and clears preview/armed state | Browser track-ended timing varies; a 2.5 s stale-frame watchdog is the backup |
| Camera returns and stale intent executes | Recovery starts with no pending preview | User must name/preview the tunnel again |
| Recognition hears speech synthesis | Recognition is aborted while synthesis speaks, then restarted | Browser events can race; captions and switch fallback remain authoritative |
| Browser recognition sends audio remotely | Launch disclosure calls out vendor/cloud processing | The app cannot audit browser internals; `?accessible=1` is the strictly local path |
| `FaceDetector` is absent | Frame-difference centroid remains available | Coarse preview is less stable and should not be described as gaze tracking |
| Permissions are denied | State freezes and visible switch instructions remain | Primary voice/motion path is unavailable |
| Repeated “choose” commits twice | Preview clears after commit plus a 500 ms commit cooldown | A new preview plus a later choose is intentionally a new action |
| A wrong tunnel is committed | Undo is available from voice, upward motion, or switch fallback; old shells stay legible | Wrong commits still cost time and are counted |
| User cannot speak or move on camera | Full switch-access path uses the same task and safety state | This is not proof of compatibility with every assistive technology |
| Motion causes nausea | `prefers-reduced-motion` removes animation/transitions | Spatial density can remain cognitively demanding |
| Export leaks media | Export contains semantic option events/metrics, never pixels, audio, face boxes, or free-form transcript text | Users should still inspect any JSON before sharing |

## Code-level findings

1. **No gaze or hand classifier exists.** The only general detector compares
   adjacent 96×72 grayscale frames and computes active-pixel centroid. Optional
   `FaceDetector` contributes only a transient bounding-box center.
2. **No camera-only commit path exists.** `previewOption`, `rotate`, and `arm`
   do not append a selection. `choose` performs all confidence/dwell/freeze and
   cooldown checks.
3. **Sensor loss is fail-closed.** It preserves committed selections, clears
   pending state, records the loss, and rejects mutation until recovery.
4. **Privacy claims are scoped to this app.** Static validation rejects common
   networking, recording, peer-connection, and browser persistence APIs.
5. **The simulation is not human evidence.** Its 12.45 seconds are scripted
   logical time and must never be presented as a measured user completion time.

## Residual-risk verdict

Suitable as a reversible experiment, not as safety-critical control, biometric
input, or an accessibility certification. The greatest residual risks are
environmental motion and browser/vendor speech processing. Explicit commit,
undo, freeze, disclosure, and the media-free fallback reduce those risks enough
for the tournament task.
