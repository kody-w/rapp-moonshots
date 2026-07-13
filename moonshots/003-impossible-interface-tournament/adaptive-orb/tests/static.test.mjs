import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

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
