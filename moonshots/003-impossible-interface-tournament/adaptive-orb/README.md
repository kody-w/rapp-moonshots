# Adaptive Orb

Adaptive Orb is a mobile-first, eyes-up operating layer for AI in kitchens,
workshops, field work, accessibility, and other moments when hands or attention
are occupied. It is one conversation—not a chat box and not three separate
pages. One memory-only conversation, task, undo history, safety state, sensor
lifecycle, and metrics model moves between three contextual grammars:

- **Voice Orbit** accepts broad spoken intent and offers predicted response or
  action petals.
- **Gaze Compass** stabilizes four to eight bounded follow-ups for fine
  highlighting. Gaze never commits.
- **Gesture Tunnel** keeps nested explanations, revisions, tools, and scenarios
  navigable without losing the parent conversation.

Automatic selection uses the current response shape. Say `orbit`, `compass`,
`tunnel`, or `auto mode` to override it without replacing state. Center relaxes
and clears aim; explicit voice, gesture, keyboard, touch, or switch confirmation
is always separate.

It is not for driving, safety-critical control, or replacing attention to
people, tools, heat, traffic, terrain, or other surroundings.

## Public PWA

No install step or dependency is required:

```bash
cd moonshots/003-impossible-interface-tournament/adaptive-orb
python3 -m http.server 8073
```

Open:

- public/offline conversation: <http://localhost:8073/>
- deterministic multi-turn replay: <http://localhost:8073/?simulate=1>
- light/dark theme: append `&scoutTheme=light` or `&scoutTheme=dark`

GitHub Pages works without credentials. The default deterministic demo AI makes
no AI request and covers four scenario packs:

| Pack | AI situation | Natural grammar |
|---|---|---|
| Eyes-up note (`create`) | walking note capture or quick decision support | Orbit |
| Field checklist (`plan`) | workshop/field steps that can be compared | Compass |
| Kitchen guide (`explain`) | nested hands-busy guidance and revisions | Tunnel |
| Access & decide (`navigate`) | switch-friendly choices and deeper tasks | Compass → Tunnel |

The exact cobalt-beacon task remains a reversible Navigate scenario.

## Optional RAPP Brainstem companion

`server.py` serves the same static PWA and owns the only network bridge:

```bash
RAPP_BRAINSTEM_URL=http://127.0.0.1:7071/chat \
python3 server.py --bind 127.0.0.1 --port 8073
```

Optional server-only settings:

- `RAPP_BRAINSTEM_SECRET` — sent upstream as a bearer secret;
- `RAPP_BRAINSTEM_TIMEOUT` — 1–30 seconds, default 8;
- `ADAPTIVE_ORB_BIND` / `ADAPTIVE_ORB_PORT` — CLI flags take precedence;
- `ADAPTIVE_ORB_ALLOWED_HOSTS` — comma-separated explicit hostnames/addresses;
  `--allow-host HOST` may also be repeated.

The bind and Brainstem URL defaults are loopback. Host headers are restricted
to `localhost`, `127.0.0.1`, `::1`, plus explicit configuration. Before each
chat, a same-origin `POST /api/session` bootstrap issues an unguessable
per-process `HttpOnly; SameSite=Strict` cookie in a no-store response;
`/api/chat` requires that cookie and an exact same-origin `Origin`. Static shell
responses never carry the token, and the service worker bypasses `/api/`.
Restarting the server invalidates the authorization. The browser never
receives, stores, or logs the upstream key. Companion mode is opt-in in the
footer (or `?companion=1`) and posts only this strict same-origin contract to
`/api/chat`:

```json
{
  "user_input": "bounded text",
  "conversation_history": [{"role": "user", "content": "bounded text"}],
  "session_id": "ephemeral-session-id"
}
```

The client UTF-8-measures JSON against a 60 KiB budget and deterministically
removes oldest history first while preserving current input and the newest
bounded context. The stdlib proxy independently enforces an exact JSON shape,
64 KiB cap, bounded history/text, upstream timeout and response cap, no CORS,
no-store responses, safe logs, and normalized output. Unavailable or invalid
Brainstem output visibly falls back to deterministic demo AI with the same
conversation intact.

## PWA and iOS

- `manifest.webmanifest` uses standalone display and only local PNG icons,
  including a 180 px Apple touch icon.
- On iPhone/iPad Safari: **Share → Add to Home Screen**.
- Installability/offline readiness is **not** evidence that camera, microphone,
  `SpeechRecognition`, or speech synthesis works in iOS standalone mode.
- Every launch capability-detects standalone display, secure context,
  `getUserMedia`, `SpeechRecognition`/`webkitSpeechRecognition`, and speech
  synthesis. Hardware and permission remain unknown until each optional
  permission step is chosen.
- When an installed iOS runtime lacks an API or live permission/startup fails,
  visible guidance activates sensor-free parity and offers **Open in Safari for
  live sensors**. The same HTTPS URL opens externally where iOS permits; Safari
  performs a separate capability/permission check, so availability is still
  not guaranteed. Any active local sensor session is torn down before opening
  the external browser URL.
- Camera and microphone require HTTPS or localhost. Touch, keyboard, and switch
  parity remain when speech, `FaceDetector`, or camera sensing is unavailable.
- The primary contracts are 390×844 portrait and 844×390 landscape. Safe-area
  insets, dynamic viewport units, 44 px fallback targets, a 112 px+ center orb,
  no horizontal overflow, and touch/active parity are explicit.
- Phones show at most four primary petals. Cycling or saying `next`/`previous`
  refines larger sets without changing shared state.
- The versioned service worker caches only the static shell, manifest, and local
  icons. It bypasses `/api/`, POST, cross-origin, media, conversation, AI
  responses, calibration, metrics, and exports.
- A waiting update is applied only through **Apply app update**, then reloads
  under the new controller.

See [ROLLBACK.md](ROLLBACK.md) for unregister and cache cleanup.

## Progressive permission and safety flow

1. **Start sensor-free AI** immediately exposes the complete semantic
   conversation/task path and requests no hardware.
2. **Enable voice · microphone** is optional. Recognition uses the normal
   browser/OS input route, including a selected wired or Bluetooth headset; the
   app never requests, stores, or exports a `deviceId`.
3. **Then enable front camera** is optional. It requests user-facing capture,
   mirrors coordinates only when appropriate, and adds coarse aim/gesture.

The camera is never required to begin, and a microphone denial does not trigger
an unbounded restart loop. A clean recognition `onend` starts a fresh session
without spending a lifetime failure budget; confirmed session start resets
transient backoff. Repeated start failures exhaust visibly: speech becomes
unavailable, microphone capture stops, parity remains, and only another
explicit **Enable voice** action retries. Terminal speech denial follows the
same capture-release rule. Synthesis intentionally aborts recognition; an
`aborted` error while that abort is expected or synthesis is speaking consumes
no failure budget, and utterance completion restarts recognition only while
the microphone is still live and the page is foreground. An unexpected
`aborted` error remains a bounded transient failure. Every narration also owns
an utterance epoch: callbacks from speech canceled by a newer announcement
cannot clear the newer speaking state, alter expected-abort state, or restart
recognition. Any transition back to sensor-free stops camera, microphone,
recognition, and synthesis before sensor-free status renders.

After optional grants, the intended flow is hands-free: speak broad intent,
hold a coarse direction to highlight, and gesture or speak to confirm. Global
`repeat`, `stop`, `undo`, `what changed`, `next`, and `previous` commands are
also exposed as large touch/switch controls. AI speech uses a short first
summary; captions mirror earcon meaning. Haptics are hidden when unsupported
and off until the user explicitly opts in.

Sensing remains deliberately coarse. `FaceDetector`, when available, supplies
only a transient face-box/head-position proxy. Otherwise a 48×36 local
frame-motion estimate is used. Neither is eye tracking. Fresh frame, valid
content, and accepted processing timestamps expire independently. Invalid
content immediately revokes sensor aim/arm. Delayed detector and permission
work is generation-, content-, identity-, and request-gated.

An ended camera or microphone track is immediately released and nulled; a
retry must acquire a new live track before that sensor can report active.
Camera loss also revokes derived aim/arm and requires fresh valid content plus
accepted processing. There is no automatic reacquisition loop.

Front-camera coordinates are mirrored consistently and low-confidence aim is
smoothed to tolerate ordinary movement/noise. Orientation changes clear aim,
gesture phase, stale calibration, and dwell while preserving conversation,
task, undo history, mode, and safety state. Backgrounding, lock, visibility
loss, or interruption tears optional sensors down, aborts pending AI delivery,
and invalidates its foreground epoch. A delayed response cannot update visible
content or call synthesis while hidden. Resume is sensor-free, reports recovery
instead of silently restarting permission, and requires a new foreground
interaction or an explicit **Repeat** before speech can resume.

`stop`, `cancel`, and `undo` preempt normal speech and unconditionally cancel
global synthesis even when no sensor controller exists. Stop also aborts
pending AI work and tears down camera, microphone, recognition, derived frame
buffers, and pending detector copies. Sensor-free transitions cancel synthesis
and stop those resources before accessible status is committed or rendered.

## Memory and export

Conversation text exists only in the current page memory (or is sent to the
companion when explicitly enabled). There is no transcript, media, AI response,
calibration, or metrics persistence. Web Speech itself may use browser/OS
vendor processing; that boundary is disclosed before permission.

**Export public-safe semantic JSON** is explicit. It contains scenario IDs,
turn roles, fixed application-owned semantic labels, modes, task fields, safety
metrics, and provider status—not conversation/model text, model-supplied option
IDs, session ID, frames, audio, face boxes, or secrets.

Mobile aggregates are added only at explicit export: glance-time proxy, voice
repairs, false commits, one-hand touch/switch fallback, interruption/recovery
time, permission-to-first-value time, and per-sensor on-time. They contain no
raw interaction coordinates or transcript.

## Deterministic evidence

`?simulate=1` locks all external input and conducts one 12-turn semantic AI
conversation through Create, Plan, Explain, and Navigate. It automatically uses
all three grammars, enters and undoes an intentional wrong explanation branch,
then completes the exact cobalt task with the prior gaze/freshness/undo safety
drill.

- conversation fingerprint: `071ba015`;
- retained task-safety fingerprint: `c1b6e39f`;
- exact task: true;
- false commits: 0;
- scripted completion: 12,700 ms (logic timing, not human speed).

Success is announced only after exact semantic state and the conversation
fingerprint match. Evidence exports contain no prompt or response text.
`evidence/mobile-evidence.json` separately records the deterministic 390×844 /
844×390 layout, progressive-permission, interruption, and aggregate metric
contract without changing either safety fingerprint.

## Build and verify

```bash
npm run build
npm test
npm run evidence
npm run verify
```

The suite uses Node's test runner and Python's stdlib `unittest`; no packages are
installed. It covers AI adapter failover, shared conversation/task/history,
automatic/manual modes, replay locking, PWA assets/cache policy, iOS hooks,
standalone capability/permission degradation, Safari recovery guidance, proxy
validation and secret handling, sensor-free parity, detector races, privacy,
orientation/background recovery, progressive sensor grants, exact mobile
layouts and radial center/edge clearance, exact choice DOM reconciliation,
ended-track reacquisition, Host/Origin/session authorization, UTF-8 request
budgets, touch sizing, no hover-only action, Clawpilot theming, and checked-in
evidence.

## Important files

- `index.html` — generated self-contained application shell;
- `src/ai.mjs` — scenario packs, deterministic responder, strict adapters;
- `src/capabilities.mjs` — standalone/live API detection and honest fallback;
- `src/core.mjs` — shared conversation/task/history/safety machine;
- `src/mobile.mjs` — mobile layout, four-choice window, no-look summaries,
  aggregate metrics, earcons, and opt-in haptics;
- `src/choices.mjs` — exact choice signatures and fresh semantic DOM state;
- `src/sensors.mjs` / `src/session.mjs` — guarded media and aim lifecycles;
- `server.py` — optional same-origin Brainstem companion;
- `manifest.webmanifest`, `service-worker.js`, `icons/` — local PWA;
- `evidence/` — public-safe task and conversation replay records.
