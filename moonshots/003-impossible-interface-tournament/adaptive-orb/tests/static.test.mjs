import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

function cssBlock(source, marker) {
  const markerAt = source.indexOf(marker);
  assert.ok(markerAt >= 0, `Missing CSS marker: ${marker}`);
  const openAt = source.indexOf("{", markerAt);
  let depth = 0;
  for (let index = openAt; index < source.length; index += 1) {
    if (source[index] === "{") {
      depth += 1;
    } else if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(markerAt, index + 1);
      }
    }
  }
  throw new Error(`Unclosed CSS block: ${marker}`);
}

test("generated index is self-contained and has the required product hooks", async () => {
  const html = await readFile(new URL("index.html", root), "utf8");
  assert.match(html, /Adaptive Orb/);
  assert.match(html, /Voice Orbit/);
  assert.match(html, /Gaze Compass/);
  assert.match(html, /Gesture Tunnel/);
  assert.match(html, /class="center-orb"/);
  assert.match(html, /class="response-focus"/);
  assert.match(html, /getUserMedia/);
  assert.match(html, /FaceDetector/);
  assert.match(html, /SpeechRecognition/);
  assert.match(html, /pagehide/);
  assert.match(html, /event\.persisted/);
  assert.match(html, /BUILD_TOURNAMENT_EVIDENCE/);
  assert.match(html, /entry-quantity-/);
  assert.match(html, /class RadialAimCoordinator/);
  assert.match(html, /class ForegroundDeliveryGuard/);
  assert.match(html, /deliverForegroundAIResponse/);
  assert.match(html, /paused on background/);
  assert.match(html, /recognitionSessionStarted/);
  assert.match(html, /utteranceEpoch !== this\.announcementEpoch/);
  assert.match(html, /unexpected-aborted/);
  assert.match(html, /kind: "ordinary-end"/);
  assert.match(html, /reason: "restart-exhausted"/);
  assert.match(html, /unique after normalization/);
  assert.match(html, /ai-canceled:/);
  assert.match(html, /PRIVATE_EVENT_DETAIL_KEYS/);
  assert.match(html, /PUBLIC_EVENT_DETAIL_KEYS/);
  assert.match(html, /confirmed-ai-option/);
  assert.match(html, /superseded by newer input/);
  assert.match(html, /Pending AI response was not restored by undo/);
  assert.match(
    html,
    /cancelNarrationForRecognitionRecovery\(\);\s+recognition\.start\(\)/,
  );
  assert.match(html, /pendingDetectorBuffers/);
  assert.match(html, /EXPECTED_DETERMINISTIC_FINGERPRINT = "c1b6e39f"/);
  assert.match(html, /EXPECTED_CONVERSATION_FINGERPRINT = "071ba015"/);
  assert.match(html, /class AdaptiveAIAdapter/);
  assert.match(html, /navigator\.serviceWorker\.register/);
  assert.match(html, /detectRuntimeCapabilities/);
  assert.match(html, /Open in Safari for live sensors/);
  assert.match(html, /id="capabilitySensorFree"/);
  assert.match(html, /\/api\/chat/);
  assert.match(html, /replay-rejected/);
  assert.doesNotMatch(html, /<iframe\b/i);
  assert.doesNotMatch(html, /<(?:input|textarea)\b/i);
  assert.doesNotMatch(html, /<script[^>]+\bsrc=/i);
  assert.doesNotMatch(html, /<link[^>]+\bhref=["'](?:https?:|\/\/)/i);
  assert.doesNotMatch(html, /https?:\/\//i);
});

test("Clawpilot theme tokens are exact and component styles use variables", async () => {
  const [template, styles] = await Promise.all([
    readFile(new URL("src/index.template.html", root), "utf8"),
    readFile(new URL("src/styles.css", root), "utf8"),
  ]);
  for (const token of [
    "--cp-bg: #f7f4ef;",
    "--cp-accent: #b11f4b;",
    "--cp-surface: #ffffff;",
    "--cp-bg: #3d3b3a;",
    "--cp-accent: #fd8ea1;",
    "--cp-surface: #292929;",
  ]) {
    assert.ok(template.includes(token), token);
  }
  assert.match(
    styles,
    /font-family: "Segoe UI", Aptos, Calibri, -apple-system, BlinkMacSystemFont, sans-serif/,
  );
  assert.doesNotMatch(styles, /#[\da-f]{3,8}\b/i);
  assert.doesNotMatch(styles, /\brgba?\(/i);
  assert.doesNotMatch(styles, /\bhsla?\(/i);
});

test("mobile-first UI has progressive permissions, exact layouts, and no hover-only action", async () => {
  const [template, styles, app, sensors, mobile, generated] = await Promise.all([
    readFile(new URL("src/index.template.html", root), "utf8"),
    readFile(new URL("src/styles.css", root), "utf8"),
    readFile(new URL("src/app.mjs", root), "utf8"),
    readFile(new URL("src/sensors.mjs", root), "utf8"),
    readFile(new URL("src/mobile.mjs", root), "utf8"),
    readFile(new URL("index.html", root), "utf8"),
  ]);

  assert.ok(
    template.indexOf("Start sensor-free AI") <
      template.indexOf('id="permissionMic"'),
  );
  assert.ok(
    template.indexOf('id="permissionMic"') <
      template.indexOf('id="permissionCamera"'),
  );
  for (const id of [
    "mobileRepeat",
    "mobileWhatChanged",
    "mobileUndo",
    "mobileStop",
    "hapticToggle",
    "glanceProxy",
    "permissionValue",
    "sensorOnTime",
  ]) {
    assert.match(template, new RegExp(`id="${id}"`));
  }
  assert.match(template, /Not for driving/);
  assert.match(template, /Headset and Bluetooth microphones/);
  assert.match(styles, /390 × 844 portrait/);
  assert.match(styles, /844 × 390/);
  assert.match(styles, /max-width: 600px/);
  assert.match(styles, /max-height: 500px/);
  assert.match(styles, /env\(safe-area-inset-left\)/);
  assert.match(styles, /env\(safe-area-inset-right\)/);
  assert.match(styles, /min-height: 44px/);
  assert.match(styles, /overflow-x: clip/);
  assert.match(styles, /container-type: inline-size/);
  assert.match(styles, /\.choice\[data-phone-hidden="true"\]/);
  assert.equal((styles.match(/:hover/g) || []).length, 4);
  assert.equal((styles.match(/:active/g) || []).length >= 4, true);
  const narrowBlock = cssBlock(styles, "@media (max-width: 520px)");
  const portraitBlock = cssBlock(
    styles,
    "@media (orientation: portrait) and (max-width: 600px)",
  );
  const landscapeBlock = cssBlock(
    styles,
    "@media (orientation: landscape) and (max-height: 500px)",
  );
  assert.doesNotMatch(narrowBlock, /844 × 390|orientation: landscape/);
  assert.match(portraitBlock, /width: clamp\(76px, 24vw, 96px\)/);
  assert.match(portraitBlock, /height: 68px/);
  assert.match(portraitBlock, /\.orb-stage[\s\S]*min-height: 0/);
  assert.match(landscapeBlock, /width: 90px/);
  assert.match(landscapeBlock, /height: 56px/);
  assert.match(landscapeBlock, /grid-template-columns: 1fr/);
  assert.match(landscapeBlock, /@container \(min-width: 620px\)/);
  assert.match(landscapeBlock, /width: 76px/);
  assert.match(landscapeBlock, /height: 52px/);
  assert.match(landscapeBlock, /max-height: none/);
  assert.match(portraitBlock, /\.choice\[data-phone-hidden="true"\][\s\S]*display: none/);
  assert.match(landscapeBlock, /\.choice\[data-phone-hidden="true"\][\s\S]*display: none/);
  assert.ok(styles.indexOf(portraitBlock) > styles.indexOf(narrowBlock));
  assert.ok(styles.indexOf(landscapeBlock) > styles.indexOf(narrowBlock));

  assert.match(mobile, /maximumPrimaryChoices: 4/);
  assert.match(mobile, /centerOrbMinimumPx: 112/);
  assert.match(mobile, /compactLandscapeMultiColumnMinWidth: 620/);
  assert.match(app, /shortSpokenSummary/);
  assert.match(app, /visibleChoiceIds/);
  assert.match(app, /optionIds: \[\.\.\.visibleChoiceIds\]/);
  assert.match(app, /ORIENTATION_CHANGE/);
  assert.match(app, /background-interruption/);
  assert.match(app, /record\.mobile = mobileMetrics\.snapshot/);
  assert.match(app, /lastChoiceSignature !== signature/);
  assert.doesNotMatch(app, /lastChoiceSignature\.startsWith/);
  assert.match(app, /button\.dataset\.optionId/);
  assert.match(app, /radialChoiceGeometry/);
  assert.doesNotMatch(app, /sensorController\.start\(\)/);

  assert.match(sensors, /facingMode: \{ ideal: "user" \}/);
  assert.match(sensors, /noiseSuppression: true/);
  assert.match(sensors, /autoGainControl: true/);
  assert.match(sensors, /dataset\.mirrored/);
  assert.match(sensors, /smoothedAim/);
  assert.doesNotMatch(sensors, /deviceId/);
  assert.match(generated, /Start sensor-free AI/);
  assert.match(generated, /maximumPrimaryChoices: 4/);
});
