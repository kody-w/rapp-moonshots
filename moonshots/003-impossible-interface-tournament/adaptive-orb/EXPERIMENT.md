# Adaptive Orb experiment

## Hypothesis

One AI conversation can change interaction grammar with context without
changing ownership of memory, task, history, safety, sensing, or metrics:
broad intent should favor Orbit, stable follow-ups Compass, and nested
explanations/revisions Tunnel.

The claim fails if a mode switch loses a turn/task/freeze, gaze commits,
stale sensing confirms, AI failover loses context, exported evidence contains
conversation text, or offline installation caches sensitive data.

## Deterministic protocol

Run `npm run evidence` or open `?simulate=1`.

1. Start an input-locked memory-only session.
2. Ask Create for broad creative help; accept an Outline petal in Orbit.
3. Ask Plan for four bounded priorities; automatically enter Compass, dwell,
   and explicitly gesture-confirm Deep work.
4. Ask Explain about offline updates; automatically enter Tunnel.
5. Enter an intentionally wrong analytics branch, receive a response, then
   undo to the exact prior explanation.
6. Ask Navigate for the routing scenario; automatically return to Compass.
7. Enter the exact cobalt task inside the same conversation/history.
8. Run the retained all-mode safety fixture: blocked gaze commit, center rest,
   invalid-content freeze/recovery, ORION-7/North Gate, wrong route branch,
   undo, confirm, and home.
9. Verify exact state before announcing success.

## Checked-in result

| Measure | Deterministic result |
|---|---:|
| Conversation turns | 12 |
| Scenarios | Create, Plan, Explain, Navigate |
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

## iOS standalone capability protocol

Treat installation and live sensing as independent variables. Test both a
Safari tab and Add-to-Home-Screen standalone launch on supported iPhone/iPad
hardware under these cases:

1. secure context with all APIs exposed, before and after permission;
2. missing `getUserMedia`;
3. missing `SpeechRecognition`/`webkitSpeechRecognition`;
4. missing speech synthesis;
5. denied camera/microphone or terminal speech permission;
6. live track loss after a successful start.

Acceptance requires runtime detection on every launch, no pre-permission claim
that hardware works, a visible sensor-free path for every degraded case, and
**Open in Safari for live sensors** only for degraded iOS standalone on a
secure HTTP(S) URL. The link must remove `?simulate=1`; Safari performs a new
capability/permission check and the UI must not promise success. Installed
offline conversation and deterministic simulation must remain usable without
live APIs.

## Live study boundary

A consented live study should record only semantic measures: completion,
repairs, mode changes, wrong highlights, false nods, center cancels, undo,
sensor loss/recovery, provider/failover, workload, and browser capabilities.
Never record media or transcripts. Separate demo, companion, scripted, and
human results. Stop after any gaze-only execution, secret exposure, sensitive
cache entry, or irreversible effect.
