# Adaptive Orb experiment

## Hypothesis

One AI conversation can change interaction grammar with context without
changing ownership of memory, task, history, safety, sensing, or metrics:
broad intent should favor Orbit, stable follow-ups Compass, and nested
explanations/revisions Tunnel.

On a phone, useful sensor-free value should precede permission; optional voice
and front-camera input should then support eyes-up, hands-busy use without
breaking the same state through rotation, interruption, lock, or fallback.

The claim fails if a mode switch loses a turn/task/freeze, gaze commits,
stale sensing confirms, AI failover loses context, exported evidence contains
conversation text, or offline installation caches sensitive data.

## Deterministic protocol

Run `npm run evidence` or open `?simulate=1`.

1. Start an input-locked memory-only session.
2. Use the Create ID as an eyes-up note pack; accept Capture note in Orbit.
3. Use the Plan ID as a workshop/field checklist; automatically enter Compass,
   dwell, and explicitly gesture-confirm Inspect.
4. Use the Explain ID as a hands-busy kitchen guide; automatically enter
   Tunnel.
5. Enter an intentionally wrong analytics branch, receive a response, then
   undo to the exact prior explanation.
6. Use the Navigate ID for switch-friendly decision support and enter the
   routing scenario; automatically return to Compass.
7. Enter the exact cobalt task inside the same conversation/history.
8. Run the retained all-mode safety fixture: blocked gaze commit, center rest,
   invalid-content freeze/recovery, ORION-7/North Gate, wrong route branch,
   undo, confirm, and home.
9. Verify exact state before announcing success.

## Checked-in result

| Measure | Deterministic result |
|---|---:|
| Conversation turns | 12 |
| Scenarios | Eyes-up note, field checklist, kitchen guide, access & decide |
| Modes | Orbit, Compass, Tunnel |
| Contextual transitions | 8 |
| Exact cobalt task | true |
| Scripted completion | 12,700 ms |
| False commits | 0 |
| Blocked gaze commits | 1 |
| Center cancels | 1 |
| Sensor loss / recovery | 1 / 1 |
| Intentional wrong branches / undo | 2 / 2 |
| Conversation text exported | false |
| Application AI network in demo | false |

Conversation fingerprint: `071ba015`.

The unchanged task-only regression still verifies `c1b6e39f`. Timings prove
deterministic event ordering, not human performance.

## AI adapter protocol

For each request, compare:

1. offline `DemoAIAdapter` with a fetch stub that must remain unused;
2. valid same-origin companion response;
3. unavailable, timed-out, malformed, oversized, or stale companion response.

Acceptance requires exact Brainstem request keys, no browser credential field,
bounded response options, visible demo fallback, current request identity, and
unchanged prior turns/task/history. Companion output is text-rendered and may
suggest reversible branches; it cannot execute HTML, scripts, tools, or
external actions.

## PWA/offline protocol

Install once, then take the server offline. Root and `?simulate=1` must load
from the static cache. Inspect Cache Storage: only root/index, manifest, and the
three local icons may exist. `/api/chat`, POST, media, transcript, response,
calibration, metrics, and blob exports must never be intercepted or cached.

Verify a changed `CACHE_VERSION` produces a waiting worker, **Apply app update**
sends `ACTIVATE_UPDATE`, old versioned static caches are deleted on activation,
and the page reloads once on controller change.

This release uses `adaptive-orb-static-v3`.

## iOS standalone capability protocol

Treat installation and live sensing as independent variables. Test both a
Safari tab and Add-to-Home-Screen standalone launch on supported iPhone/iPad
hardware under these cases:

1. secure context with all APIs exposed, before and after each progressive
   microphone and front-camera permission;
2. missing `getUserMedia`;
3. missing `SpeechRecognition`/`webkitSpeechRecognition`;
4. missing speech synthesis;
5. denied camera/microphone or terminal speech permission;
6. live track loss after a successful optional grant;
7. interruption/background/lock and orientation change in both Safari and
   standalone.

Acceptance requires runtime detection on every launch, no pre-permission claim
that hardware works, useful sensor-free AI before permission, a visible
sensor-free path for every degraded case, and
**Open in Safari for live sensors** only for degraded iOS standalone on a
secure HTTP(S) URL. The link must remove `?simulate=1`; Safari performs a new
capability/permission check and the UI must not promise success. Installed
offline conversation and deterministic simulation must remain usable without
live APIs.

## Mobile-first protocol

Run the logic/layout tests at exactly 390×844 portrait and 844×390 landscape.
Acceptance requires:

1. safe-area padding on all four edges, no horizontal overflow, and every
   fallback action at least 44 px;
2. a center rest orb at least 112 px and no more than four primary phone petals
   until `next`/`previous` refines the set;
3. no action available only through hover;
4. sensor-free value first, a separate microphone request second, and a
   separate user-facing camera request third;
5. normal browser/OS headset routing with no `deviceId`;
6. mirrored front-camera mapping, low-pass aim smoothing, fresh-content
   reacquisition, and orientation calibration reset;
7. background/lock teardown before status, sensor-free resume, and unchanged
   conversation/task/history/mode;
8. short spoken summaries, captioned earcons, and haptics only after supported
   opt-in;
9. global repeat/stop/undo/what-changed parity without a text box; and
10. explicit non-driving/non-safety-critical positioning.

`evidence/mobile-evidence.json` is deterministic synthetic timing evidence, not
a human usability result. It records both viewport contracts, four-choice
limit, progressive permission order, one 150 ms glance proxy, one 150 ms
interruption recovery, two touch fallbacks, 350 ms permission-to-value, and
850 aggregate sensor-on milliseconds. Human studies must report separate
measurements.

## Live study boundary

A consented live study should record only semantic measures: completion,
repairs, mode changes, wrong highlights, false nods, center cancels, undo,
sensor loss/recovery, glance-time proxy, one-hand fallback, interruption
recovery, permission-to-value, per-sensor on-time, provider/failover, workload,
orientation, and browser capabilities.
Never record media or transcripts. Separate demo, companion, scripted, and
human results. Stop after any gaze-only execution, secret exposure, sensitive
cache entry, irreversible effect, driving use, or safety-critical use.
