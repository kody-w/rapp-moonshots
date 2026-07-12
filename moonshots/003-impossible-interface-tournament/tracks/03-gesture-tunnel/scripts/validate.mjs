import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  OPTION_COUNT,
  TASK_LAYERS,
  runDeterministicSimulation,
} from "../src/core.mjs";

const trackRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFile(resolve(trackRoot, path), "utf8");
const [html, styles, app, readme, experiment, adversarial, rollback, pitch] = await Promise.all([
  read("index.html"),
  read("src/styles.css"),
  read("src/app.mjs"),
  read("README.md"),
  read("EXPERIMENT.md"),
  read("ADVERSARIAL_REVIEW.md"),
  read("ROLLBACK.md"),
  read("PITCH.md"),
]);

const gates = [];
function gate(name, assertion) {
  assertion();
  gates.push(name);
}

gate("deterministic exact task", () => {
  const first = runDeterministicSimulation();
  const second = runDeterministicSimulation();
  assert.deepEqual(first, second);
  assert.equal(first.state.completed, true);
  assert.equal(first.state.exact, true);
  assert.equal(first.metrics.falseCommits, 1);
  assert.equal(first.metrics.blockedCommits, 1);
  assert.equal(first.metrics.undos, 1);
  assert.equal(first.metrics.sensorLosses.camera, 1);
  assert.equal(first.metrics.recoveredFromSensorLoss, true);
});

gate("six bounded tunnel mouths", () => {
  assert.ok(OPTION_COUNT >= 5 && OPTION_COUNT <= 7);
  TASK_LAYERS.forEach((layer) => assert.equal(layer.options.length, OPTION_COUNT));
});

gate("self-contained artifact", () => {
  assert.doesNotMatch(html, /__(?:STYLES|CORE|APP)__/);
  assert.doesNotMatch(html, /<(?:script|img)[^>]+\bsrc\s*=/i);
  assert.doesNotMatch(html, /<link[^>]+\bhref\s*=/i);
  assert.doesNotMatch(html, /\bhttps?:\/\//i);
});

gate("Clawpilot theme", () => {
  assert.match(html, /const param = new URLSearchParams\(window\.location\.search\)\.get\("scoutTheme"\)/);
  assert.match(styles, /--cp-bg: #f7f4ef;/);
  assert.match(styles, /--cp-accent: #b11f4b;/);
  assert.match(styles, /html\[data-theme="dark"\]/);
  assert.match(styles, /font-family: "Segoe UI", Aptos, Calibri, -apple-system/);
  const outsideTokens = styles.replace(/^\s*--cp-[^;]+;\s*$/gm, "");
  assert.doesNotMatch(outsideTokens, /#[\da-f]{3,8}\b|\brgba?\(|\bhsla?\(/i);
});

gate("ephemeral local sensing", () => {
  assert.match(app, /getUserMedia/);
  assert.match(app, /getImageData/);
  assert.match(app, /frameWidth = 96/);
  assert.match(app, /frameHeight = 72/);
  assert.match(app, /FaceDetector/);
  assert.doesNotMatch(
    app,
    /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|MediaRecorder|RTCPeerConnection|localStorage|sessionStorage|indexedDB)\b/,
  );
});

gate("voice and access fallback", () => {
  assert.match(app, /SpeechRecognition/);
  assert.match(app, /speechSynthesis/);
  assert.match(app, /ArrowLeft/);
  assert.match(app, /ArrowRight/);
  assert.match(styles, /prefers-reduced-motion/);
  assert.match(readme, /strictly local.*accessible/i);
});

gate("safety controls and disclosure", () => {
  assert.match(html, /Gaze preview and motion never commit/);
  assert.match(html, /no hand classification/i);
  assert.match(html, /vendor\/cloud-backed/i);
  assert.match(app, /handleSensorLoss/);
  assert.match(app, /pending preview canceled/i);
});

gate("evidence and rollback docs", () => {
  assert.match(experiment, /hypothesis/i);
  assert.match(experiment, /measured/i);
  assert.match(adversarial, /residual/i);
  assert.match(adversarial, /false commit/i);
  assert.match(rollback, /git revert/i);
  assert.match(pitch, /Gesture Tunnel/);
});

console.log(`Gesture Tunnel validator: ${gates.length}/${gates.length} gates passed`);
gates.forEach((name) => console.log(`  ✓ ${name}`));
