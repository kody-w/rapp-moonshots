# Adaptive Orb adversarial review

## Verdict

Appropriate for a reversible AI conversation experiment and local companion
prototype. Not appropriate for consequential medical, financial, vehicle,
physical, authorization, or autonomous tool control. AI text, commodity camera
sensing, browser speech, and operator-configured Brainstem behavior remain
untrusted.

The mobile scenarios are demonstrations for occupied hands/attention, not
permission to use the app while driving or controlling safety-critical work.

## Failure analysis

| Attack or failure | Defense | Residual risk |
|---|---|---|
| Prompt or model output executes code/tools | Responses use strict JSON normalization and `textContent`; suggestions only enter reversible local branches | A plausible but wrong answer can still mislead |
| Browser obtains an API secret | Browser code knows only `/api/chat`; secret and upstream URL are server env only; generated HTML is scanned | A compromised host process can read its environment |
| Proxy becomes openly exposed or DNS-rebound | Bind defaults to `127.0.0.1`; Host is limited to loopback plus explicit allowlist; static and API requests reject unapproved Host/Origin before routing | Operators can explicitly allow and expose a host without TLS |
| Cross-site request reaches Brainstem | A no-store same-origin `/api/session` bootstrap issues an unguessable per-process `HttpOnly; SameSite=Strict` cookie; chat requires that cookie and exact same-origin Origin; static/cache responses carry no token and there is no wildcard CORS | A same-origin script compromise can use the current session |
| Oversized or malformed proxy input | Client UTF-8-measures a 60 KiB body and removes oldest history first; server independently requires exact keys, JSON content type, Content-Length, a 64 KiB cap, and bounded turns/text/session ID | Slow-client denial of service is not comprehensively mitigated |
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
| Ended media track remains truthy and skips permission retry | End handler revokes camera-derived state, stops/releases the owned stream, clears references/preview, and active short-circuit requires a live matching track; retry reacquires before active | Browser hardware indicators and permission prompts remain platform-controlled |
| Delayed FaceDetector result revives old content | Lifecycle, content, detector identity, request ID, freshness, and accepted-sample checks all must match | Experimental browser APIs vary |
| Detector copy remains in memory | Every derived detector buffer is registered and zeroed on result, loss, replacement, or shutdown | Privileged heap inspection is out of scope |
| Permission/play resolves after shutdown | Lifecycle generation is rechecked after each await and late tracks are stopped | Hardware indicator timing is browser-controlled |
| Sensor-free UI appears before media stops | One coordinator stops tracks, recognition, synthesis, timers, buffers, and pending detector work before accessible commit/render | OS indicators may extinguish asynchronously |
| Speech continues after cancel/undo without a sensor controller | Stop, cancel, undo, sensor-free transition, teardown, background, and pagehide call one global synthesis cancellation path independently of controller presence | The speech engine may report cancellation asynchronously |
| Intentional synthesis abort is counted as a recognition failure | `aborted` is ignored only while the controller expects its synthesis abort or is speaking; completion restarts only with a live microphone in the foreground, while unexpected aborts remain bounded transient failures | Vendor event ordering can race beyond the expected-state window |
| Canceled narration A finishes during replacement B | Each announcement captures a unique utterance epoch; stale completion/error callbacks cannot clear B's speaking/expected state or restart recognition, and only B may resume once | Browser synthesis cancellation timing remains vendor-controlled |
| Ordinary recognition `onend` consumes a lifetime budget | Successful session start and clean end reset backoff; expected synthesis aborts are classified separately from transient start/error failures | Browser event classification remains vendor-dependent |
| Recognition restart exhausts but UI still says active | Exhaustion marks speech unavailable, stops/releases microphone capture, announces visible parity, and permits recovery only through an explicit Enable voice action | iOS/vendor outages still require touch/switch parity |
| Launch requests unnecessary sensors | Sensor-free AI is useful first; microphone and front camera are separate, explicit later permissions | Browser permission copy remains browser-controlled |
| Speech permission fails after mic capture | Terminal recognition errors stop the separately granted microphone stream and expose parity | OS hardware indicators can lag track shutdown |
| Camera denial destroys voice/conversation | Separate streams share one lifecycle generation; camera failure is bounded and state remains | Choosing full sensor-free teardown intentionally stops both |
| Hidden fifth/sixth phone petal receives gaze | Phone window passes only its visible IDs to the aim coordinator | Cycling can still expose a wrong but reversible choice |
| Walking or hand motion creates noisy aim | Front-camera mapping is mirror-aware, low-pass smoothed, dwell-gated, and never confirms | Coarse sensing can still highlight incorrectly |
| Orientation reuses stale coordinates | Orientation clears smoothed aim, dwell, gesture phase, frame baseline, and requires fresh content while preserving shared state | Browser orientation events can be delayed or duplicated |
| Delayed AI response speaks or appears after background/lock | Visibility loss aborts delivery and advances a foreground epoch; accept, reveal, and synthesis recheck that epoch plus live visibility, while resume requires interaction or explicit Repeat for speech | The browser may already have handed earlier audio to the OS before cancellation |
| Background, lock, or interruption leaves sensors active | Visibility loss tears down optional streams before sensor-free status; resume never silently re-prompts | OS suspension can preempt JavaScript before the final callback |
| Headset/Bluetooth input is silently pinned | No `deviceId` is requested; normal browser/OS routing is disclosed | Route changes and Bluetooth quality remain platform behavior |
| Earcon is mistaken for confirmation | Captions state earcon meaning; confirmation still follows machine result | Audio can be inaudible in noisy environments |
| Haptic surprises or implies consent | Haptics are capability-detected, hidden when absent, off by default, and optional | Vibration semantics vary by device/browser |
| Mobile UI clips or requires hover | 390×844 and 844×390 contracts enforce safe areas, overflow clipping, 44 px targets, and active/touch equivalents | Automated CSS checks are not a full device/accessibility audit |
| Landscape contract is trapped in a narrow portrait query | Portrait and 844×390 landscape media blocks are independent; radial geometry caps radius and tests edge/center clearance with hidden choices removed | Browser text scaling can still require additional scrolling |
| Reused choice ID shows stale text or prompt | Full canonical choice signature includes length and every semantic/executable field; changed content rebuilds nodes and every render refreshes text, ARIA, and data while clicks resolve the current ID | Model wording can still be misleading |
| Mode change loses context or safety | One machine owns conversation, task, undo snapshots, freezes, freshness, and metrics | Rendering defects could misstate state |
| Replay is perturbed by user input | Replay authority rejects pointer, voice, keyboard, sensor, and external state actions; exact fingerprint precedes success | Rendering is not fingerprinted |
| bfcache revives torn media/AI state | `pagehide` aborts AI, stops media, invalidates lifecycle; persisted `pageshow` reloads | Reload needs another permission gesture |
| Installed iOS icon is mistaken for live-sensor support | Every launch separately detects standalone display, secure context, media capture, recognition, and synthesis; copy explicitly says installability is not capability | API presence still cannot prove hardware or permission before each optional request |
| iOS standalone lacks APIs or rejects permission | Visible sensor-free parity activates; degraded installed iOS gets an **Open in Safari for live sensors** same-URL link where feasible, after current sensors are torn down | Safari performs a separate check and may also lack or deny access; the link cannot guarantee success |
| iOS lacks FaceDetector/install prompt | Coarse frame motion, visible Share instructions, and large touch/switch parity remain | This is not universal accessibility certification |

## Privacy boundary

Conversation text is page-memory-only by default. Demo AI is local and
deterministic. Companion mode deliberately sends the current user input,
bounded conversation history, and an ephemeral session ID to the operator's
configured Brainstem. The app stores neither. Web Speech may independently use
browser/OS vendor processing and is disclosed before permission.
Terminal recognition denial stops the app-owned microphone track; it cannot
cancel audio already sent to a browser/OS speech vendor.

The companion authorization cookie contains only a random process token. It is
HttpOnly, same-site, memory-invalidated on server restart, and is neither a user
identity nor analytics identifier.

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
- short spoken summaries and glance-time proxy are not proof of safe no-look use;
- installability is not live-sensor capability, even on the same iOS device;
- eyes-up scenarios do not authorize driving or safety-critical control;
- a same-origin proxy does not make a remotely configured model private.
