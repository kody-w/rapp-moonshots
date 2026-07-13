# Adaptive Orb

Adaptive Orb is one AI conversation—not a chat box and not three separate
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
| Create | broad creative direction and predicted actions | Orbit |
| Plan | bounded priorities that can be compared | Compass |
| Explain | nested concepts and revisions | Tunnel |
| Navigate | stable routes that can open deeper tools/tasks | Compass → Tunnel |

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
- `ADAPTIVE_ORB_BIND` / `ADAPTIVE_ORB_PORT` — CLI flags take precedence.

The bind default and Brainstem URL default are loopback. The browser never
receives, stores, or logs a key. Companion mode is opt-in in the footer (or
`?companion=1`) and posts only this strict same-origin contract to `/api/chat`:

```json
{
  "user_input": "bounded text",
  "conversation_history": [{"role": "user", "content": "bounded text"}],
  "session_id": "ephemeral-session-id"
}
```

The stdlib proxy enforces an exact JSON shape, 64 KiB request cap, bounded
history/text, upstream timeout and response cap, no CORS, no-store responses,
safe logs, and normalized output. Unavailable or invalid Brainstem output
visibly falls back to deterministic demo AI with the same conversation intact.

## PWA and iOS

- `manifest.webmanifest` uses standalone display and only local PNG icons,
  including a 180 px Apple touch icon.
- On iPhone/iPad Safari: **Share → Add to Home Screen**.
- Camera and microphone require HTTPS or localhost.
- `webkitSpeechRecognition` is used when available. Touch, keyboard, and
  switch parity remain when iOS speech, `FaceDetector`, or camera sensing is
  unavailable.
- Portrait, landscape, dynamic viewport, large radial targets, and safe-area
  insets are supported.
- The versioned service worker caches only the static shell, manifest, and local
  icons. It bypasses `/api/`, POST, cross-origin, media, conversation, AI
  responses, calibration, metrics, and exports.
- A waiting update is applied only through **Apply app update**, then reloads
  under the new controller.

See [ROLLBACK.md](ROLLBACK.md) for unregister and cache cleanup.

## Permission and safety flow

One **Start voice + camera** click requests one combined media stream. After
that, the intended primary flow is hands-free: speak broad intent, hold a coarse
direction to highlight, and nod or speak to confirm. **Start sensor-free
access** creates no media or recognition and exposes the same semantic
scenario/task path to touch, keyboard, and switch controls.

Sensing remains deliberately coarse. `FaceDetector`, when available, supplies
only a transient face-box/head-position proxy. Otherwise a 48×36 local
frame-motion estimate is used. Neither is eye tracking. Fresh frame, valid
content, and accepted processing timestamps expire independently. Invalid
content immediately revokes sensor aim/arm. Delayed detector and permission
work is generation-, content-, identity-, and request-gated.

`stop`, `cancel`, and `undo` preempt normal speech. Stop also aborts pending AI
work and tears down camera, microphone, recognition, synthesis, derived frame
buffers, and pending detector copies. Sensor-free transitions stop those
resources before accessible status is committed or rendered.

## Memory and export

Conversation text exists only in the current page memory (or is sent to the
companion when explicitly enabled). There is no transcript, media, AI response,
calibration, or metrics persistence. Web Speech itself may use browser/OS
vendor processing; that boundary is disclosed before permission.

**Export public-safe semantic JSON** is explicit. It contains scenario IDs,
turn roles, fixed application-owned semantic labels, modes, task fields, safety
metrics, and provider status—not conversation/model text, model-supplied option
IDs, session ID, frames, audio, face boxes, or secrets.

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
proxy validation and secret handling, sensor-free parity, detector races,
privacy, Clawpilot theming, and checked-in evidence.

## Important files

- `index.html` — generated self-contained application shell;
- `src/ai.mjs` — scenario packs, deterministic responder, strict adapters;
- `src/core.mjs` — shared conversation/task/history/safety machine;
- `src/sensors.mjs` / `src/session.mjs` — guarded media and aim lifecycles;
- `server.py` — optional same-origin Brainstem companion;
- `manifest.webmanifest`, `service-worker.js`, `icons/` — local PWA;
- `evidence/` — public-safe task and conversation replay records.
