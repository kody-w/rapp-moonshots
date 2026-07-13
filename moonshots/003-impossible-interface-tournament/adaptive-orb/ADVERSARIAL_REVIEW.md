# Adaptive Orb adversarial review

## Verdict

Appropriate for a reversible AI conversation experiment and local companion
prototype. Not appropriate for consequential medical, financial, vehicle,
physical, authorization, or autonomous tool control. AI text, commodity camera
sensing, browser speech, and operator-configured Brainstem behavior remain
untrusted.

## Failure analysis

| Attack or failure | Defense | Residual risk |
|---|---|---|
| Prompt or model output executes code/tools | Responses use strict JSON normalization and `textContent`; suggestions only enter reversible local branches | A plausible but wrong answer can still mislead |
| Browser obtains an API secret | Browser code knows only `/api/chat`; secret and upstream URL are server env only; generated HTML is scanned | A compromised host process can read its environment |
| Proxy becomes openly exposed | Server bind defaults to `127.0.0.1`; non-loopback bind is explicit | Operators can intentionally expose it without TLS/auth |
| Oversized or malformed proxy input | Exact keys, JSON content type, Content-Length, 64 KiB cap, bounded turns/text/session ID | Slow-client denial of service is not comprehensively mitigated |
| SSRF through browser input | Target URL comes only from server env, never request JSON; URL credentials/fragments are rejected | A malicious operator can configure a harmful target |
| Secret appears in logs/errors | Safe logger emits method/path/status only; upstream failures return a generic code | Reverse proxies need equivalent redaction |
| Brainstem hangs or returns malformed output | Bounded timeout/response size and strict normalized shape; app visibly falls back to demo | The failed request still disclosed explicit conversation text to the configured service |
| Old AI response lands after stop/undo/new input | Request IDs and abort signals reject stale completion; stop/cancel/undo preempt | Remote processing may already have occurred before abort |
| Conversation leaks through export | Public summary includes roles/scenario/semantic labels only; session ID and text are omitted | Task fields and semantic labels may themselves be sensitive |
| Service worker caches a transcript/API response | Fetch handler accepts same-origin GET static allowlist only and explicitly bypasses `/api/` | Browser implementation/storage inspection is outside app control |
| Bad service worker persists | Versioned caches, waiting update UI, unregister/rollback procedure | Users may remain on an old offline shell until update |
| Offline AI silently differs from companion | Provider/degraded state is visible and exported; demo fixtures are deterministic | Users may overestimate either responder's quality |
| Long gaze becomes consent | Gaze/dwell only highlight and arm; their confirmation source is rejected | Explicit confirmation can still accept a wrong highlight |
| Center return completes a nod | Center resets aim, dwell, local arm, and gesture identity epoch | Coarse motion outside center may resemble a nod |
| Choice changes while gesture is armed | Gesture epoch binds to highlighted choice identity and resets on change | Webcam motion remains approximate |
| Invalid/occluded camera keeps prior aim | Invalid content immediately revokes local and machine aim/arm, freezes, and requires fresh content plus accepted processing | Conservative thresholds can interrupt a valid still user |
| Delayed FaceDetector result revives old content | Lifecycle, content, detector identity, request ID, freshness, and accepted-sample checks all must match | Experimental browser APIs vary |
| Detector copy remains in memory | Every derived detector buffer is registered and zeroed on result, loss, replacement, or shutdown | Privileged heap inspection is out of scope |
| Permission/play resolves after shutdown | Lifecycle generation is rechecked after each await and late tracks are stopped | Hardware indicator timing is browser-controlled |
| Sensor-free UI appears before media stops | One coordinator stops tracks, recognition, synthesis, timers, buffers, and pending detector work before accessible commit/render | OS indicators may extinguish asynchronously |
| Speech recognizes synthesized AI response | Recognition is detached during synthesis and restarts only under the current generation | Vendor event ordering can race |
| Recognition retries forever | Terminal errors stop; transient restart is bounded and generation-guarded | iOS/vendor outages require touch/switch parity |
| Mode change loses context or safety | One machine owns conversation, task, undo snapshots, freezes, freshness, and metrics | Rendering defects could misstate state |
| Replay is perturbed by user input | Replay authority rejects pointer, voice, keyboard, sensor, and external state actions; exact fingerprint precedes success | Rendering is not fingerprinted |
| bfcache revives torn media/AI state | `pagehide` aborts AI, stops media, invalidates lifecycle; persisted `pageshow` reloads | Reload needs another permission gesture |
| iOS lacks speech/FaceDetector/install prompt | `webkitSpeechRecognition`, coarse frame motion, visible Share instructions, and large touch/switch parity | This is not universal accessibility certification |

## Privacy boundary

Conversation text is page-memory-only by default. Demo AI is local and
deterministic. Companion mode deliberately sends the current user input,
bounded conversation history, and an ephemeral session ID to the operator's
configured Brainstem. The app stores neither. Web Speech may independently use
browser/OS vendor processing and is disclosed before permission.

Video is reduced to a transient 48×36 analysis canvas. Raw pixels are zeroed
and the canvas is cleared each turn. One rolling grayscale comparison and at
most one registered detector copy may exist; all are zeroed at invalidation or
shutdown. No media, transcript, AI response, calibration, metrics, or analytics
identifier is persisted.

## Claims deliberately rejected

- AI output is not verified truth, authority, or permission to act;
- predicted petals are not autonomous tool calls;
- coarse head/frame motion is not eye tracking, attention, identity, or consent;
- deterministic timing is not human speed;
- PWA installation is not proof of universal offline/browser support;
- parity controls are not universal accessibility certification;
- a same-origin proxy does not make a remotely configured model private.
