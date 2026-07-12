# Adaptive Orb adversarial review

## Verdict

Appropriate for a reversible local tournament experiment. Not appropriate for
medical, vehicle, financial, physical, or other consequential control. The
state and lifecycle safety boundaries are testable; commodity webcam sensing
and vendor speech behavior remain inherently uncertain.

## Failure analysis

| Attack or failure | Defense | Residual risk |
|---|---|---|
| Long gaze becomes consent | Gaze only highlights/arms; confirmation rejects `gaze` and `dwell` sources | User can explicitly confirm a wrongly highlighted choice |
| Center return completes a nod | Center is processed first and resets the gesture epoch | Coarse motion away from center may still resemble a nod |
| A mode switch resets safety | One machine owns task, history, freezes, freshness, and metrics; switching changes only grammar preference and timing | UI rendering defects could misstate preserved state |
| Stop/cancel/undo appears inside ordinary speech | Word-boundary priority scan runs before modes, confirmation, or option parsing | Benign phrases containing those words fail safe |
| Camera metadata advances over frozen/covered pixels | Frame identity, luminance, variance, and content-change gates are independent | Thresholds need tuning across cameras and lighting |
| Invalid content leaves a prior arm live | Invalid content immediately adds an independent freeze, clears machine aim, invalidates content/processing freshness, and requires both before recovery | Conservative thresholds may interrupt a valid stationary user |
| FaceDetector hangs | Processed freshness expires; a 900 ms guard invalidates its epoch and enters honest motion fallback | Experimental API behavior differs by browser |
| Old detector result arrives after loss/replacement | Result must match lifecycle generation, content epoch, and detector identity | Browser internals remain outside app control |
| Detector promise retains a derived frame forever | Every detector copy is registered and zeroed on result, invalidation, replacement, or shutdown | Privileged heap inspection is outside app control |
| Permission resolves after stop/pagehide | Generation mismatch immediately stops every late track | Browser permission UI itself may remain visible briefly |
| Preview `play()` resolves after stop | Generation is rechecked after the await; stream is stopped and preview detached | Hardware indicator shutdown timing is platform-controlled |
| Camera and microphone fail together | Independent causes remain until each matching recovery; accessible transition explicitly changes requirements | Voice recovery is impossible after mic loss without parity |
| UI claims sensor-free before capture stops | Access options only request transition; one coordinator synchronously stops media and speech before committing and rendering accessible state | Browser hardware indicators may extinguish asynchronously after track stop |
| Speech service fails while mic track lives | Speech status is separate and does not mislabel the physical microphone | Gesture cannot express arbitrary new route text |
| Recognition restarts forever | Terminal errors disable restart; transient retry is bounded to five exponential attempts | Vendor outages still require parity |
| Synthesized prompts are re-recognized | Recognition aborts during synthesis and restarts under the current generation | Browser event ordering can race |
| A wrong review branch mutates the task | Tunnel branches are navigation snapshots; undo restores them without touching sensor/safety state | Wrong navigation still costs time and counts as an error |
| Repeated confirmation changes a completed route | Completed stages expose no route mutation path; undo is required first | More general products need explicit authorization/versioning |
| Touching a petal executes | Choice buttons highlight only; a separate Confirm control is mandatory | Some assistive tooling may synthesize multiple actions |
| Input perturbs deterministic evidence | Replay authority rejects all external state actions and success waits for exact state plus fingerprint `c1b6e39f` | Browser rendering itself is not part of the semantic fingerprint |
| Global Enter hijacks native controls | Shortcuts ignore interactive targets and require the orb surface | Event retargeting varies across assistive technology |
| Export leaks speech/media | Events contain semantic IDs/fields only; privacy flags are explicit | Route values themselves may still be sensitive after download |
| Hidden app transmits data | CSP has `connect-src 'none'`; no network, recorder, persistence, analytics, or external asset APIs exist | Browser Web Speech may independently use vendor processing |
| bfcache restores torn sensor state | `pagehide` invalidates/tears down; persisted `pageshow` reloads a clean session | Reload requires another intentional start click |
| User cannot speak, see, or move on camera | Sensor-free keyboard, touch, and switch parity uses the same task and confirmation boundary | This is not universal accessibility certification |

## Privacy inspection

One combined `getUserMedia` stream supplies camera and microphone. Video is
downsampled to a 48×36 analysis canvas. `ImageData` is reduced inside one turn,
raw bytes are filled with zero, and the canvas is cleared in `finally`. One
rolling derived grayscale comparison and at most one registered detector
working copy may coexist. Every registered copy is zeroed on result,
invalidation, replacement, or shutdown. Face boxes and free-form speech are not
recorded.

Web Speech consumes no application audio buffer, but the browser/OS may process
speech remotely. That boundary is disclosed before permission and in the live
experience. Sensor-free access constructs neither media capture nor speech
recognition.

Static validation rejects client networking, peer communication, recording,
persistence, service worker, analytics, iframe, external asset, and non-theme
color patterns.

## Claims deliberately rejected

- webcam head position or frame motion is not eye tracking;
- FaceDetector is not identity, attention, or consent;
- deterministic time is not human speed;
- fallback parity is not proof of accessibility for every person;
- browser speech is not guaranteed local or private;
- a local reversible route mock is not authorization to dispatch anything.

## Required next evidence

Before any broader trial, measure false nods, wrong highlights, missed center
rests, repair rate, recovery time, fatigue, and switch parity across browsers,
lighting, cameras, glasses, skin tones, speech patterns, and motor ranges.
Retain the no-gaze-commit and no-irreversible-action gates unchanged.
