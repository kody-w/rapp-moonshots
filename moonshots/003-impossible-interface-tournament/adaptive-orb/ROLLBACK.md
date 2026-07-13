# Adaptive Orb rollback

All product, PWA, companion, tests, and evidence files are isolated to:

```text
moonshots/003-impossible-interface-tournament/adaptive-orb/
```

## Immediate runtime stop

1. Say **stop**, press `S`, choose the large **Stop** control, or choose
   **End sensors**.
2. The app aborts pending AI work, invalidates media/detector generations,
   cancels recognition/synthesis/retries, stops every media track, zeroes
   derived buffers, clears the canvas, and detaches the preview.
3. Close the tab. Conversation memory disappears; there is no transcript or
   app database to delete.
4. If the companion is running, interrupt `server.py`. Remove
   `RAPP_BRAINSTEM_SECRET` from the process environment and rotate it according
   to the upstream operator's policy if exposure is suspected.

## Disable the companion only

Use the footer to select **AI: offline demo**, omit `?companion=1`, or serve the
directory with a static server/GitHub Pages. `/api/chat` is optional; a missing
endpoint already degrades visibly to demo AI.

## Unregister the PWA

In browser DevTools → Application:

1. Service Workers → **Unregister** Adaptive Orb.
2. Storage/Cache Storage → delete keys beginning `adaptive-orb-static-`.
3. Remove the Home Screen app if installed.
4. Reload online.

The current cache is `adaptive-orb-static-v6`; the prefix-based cleanup also
removes older v1/v2/v3/v4/v5 caches.

For a controlled same-origin console:

```js
await Promise.all((await navigator.serviceWorker.getRegistrations()).map((r) => r.unregister()));
await Promise.all((await caches.keys())
  .filter((key) => key.startsWith("adaptive-orb-static-"))
  .map((key) => caches.delete(key)));
location.reload();
```

These caches contain static shell assets only. No conversation/API/media data
cleanup is required.

## Service worker update rollback

Revert the faulty application files, then increment `CACHE_VERSION` in
`service-worker.js` so clients detect a distinct corrected worker. Deploy the
corrected static files together. Users can choose **Apply app update**; the new
worker deletes older versioned static caches during activation.

For an emergency kill-switch release, deploy a minimal same-scope worker that
deletes `adaptive-orb-static-*`, unregisters itself, and claims clients, then
deploy the known-good application. Test this procedure on the exact hosted
scope before production use.

## Repository rollback

Do not rewrite history. Revert the Adaptive Orb follow-up commit:

```bash
git revert <adaptive-orb-conversation-commit>
```

Verify the revert is isolated:

```bash
git diff --name-only <before>..<after>
```

Every listed path must begin
`moonshots/003-impossible-interface-tournament/adaptive-orb/`.

If live sensing or companion quality is uncertain but the artifact should stay
available, keep public demo AI and use **Start sensor-free AI** or
`?simulate=1`. For iOS standalone capability or permission failures, retain the
visible sensor-free offer and **Open in Safari for live sensors** guidance; do
not claim that installation implies hardware access. Safari must repeat its own
runtime and permission check and may also degrade. Never weaken capability
preflight, no-gaze-commit, freshness, request identity, Host/Origin allowlists,
the process-session cookie, no-store, request-byte budget, or static-cache
allowlist gates as a workaround. Restarting `server.py` intentionally
invalidates every prior companion session cookie.

## Mobile sensor fallback

The default launch is already **Start sensor-free AI**. Microphone and front
camera are separate optional upgrades. To roll live input back without losing
the in-memory conversation, choose **End sensors** or **Use sensor-free mode**;
teardown completes before the sensor-free status renders. After background,
lock, permission revocation, or orientation uncertainty, remain sensor-free
until the user deliberately re-enables each needed permission.

Do not add an automatic permission restart, combine the two permission steps,
pin a headset with `deviceId`, remove the four-choice phone window, or bypass
fresh-content reacquisition. If 390×844 or 844×390 rendering regresses, revert
the mobile follow-up rather than weakening safe areas, 44 px targets, center
rest, or touch/switch parity. Never present the product for driving or
safety-critical control.
