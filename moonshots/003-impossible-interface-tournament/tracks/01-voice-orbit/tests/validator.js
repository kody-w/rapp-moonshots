"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const index = read("index.html");
const css = read("styles.css");
const app = read("app.js");
const core = read("core.js");
const production = `${index}\n${css}\n${app}\n${core}`;
const executable = `${app}\n${core}`;

const checks = [];

function check(name, body) {
  try {
    body();
    checks.push(name);
    process.stdout.write(`✓ ${name}\n`);
  } catch (error) {
    process.stderr.write(`✗ ${name}\n${error.message}\n`);
    process.exitCode = 1;
  }
}

check("required application and evidence files exist", () => {
  [
    "index.html",
    "styles.css",
    "core.js",
    "app.js",
    "README.md",
    "EXPERIMENT.md",
    "ADVERSARIAL_REVIEW.md",
    "ROLLBACK.md",
    "PITCH.md",
  ].forEach((file) => assert.equal(fs.existsSync(path.join(root, file)), true, `${file} missing`));
});

check("theme detection is the first script", () => {
  const firstScript = index.indexOf("<script>");
  const firstScriptSource = index.indexOf("<script src=");
  assert.ok(firstScript >= 0);
  assert.ok(firstScriptSource === -1 || firstScript < firstScriptSource);
  assert.match(index, /new URLSearchParams\(window\.location\.search\)\.get\("scoutTheme"\)/);
  assert.match(index, /document\.documentElement\.setAttribute\("data-theme", theme\)/);
});

check("all mandatory Clawpilot variables are present", () => {
  [
    "--cp-bg",
    "--cp-bg-elevated",
    "--cp-surface",
    "--cp-surface-soft",
    "--cp-border",
    "--cp-border-strong",
    "--cp-text",
    "--cp-text-muted",
    "--cp-text-soft",
    "--cp-accent",
    "--cp-accent-hover",
    "--cp-accent-soft",
    "--cp-accent-fg",
    "--cp-success",
    "--cp-danger",
    "--cp-warning",
    "--cp-link",
    "--cp-shadow",
    "--cp-overlay",
    "--cp-panel",
    "--cp-panel-strong",
    "--cp-sheen",
    "--cp-highlight",
  ].forEach((variable) => {
    assert.ok(index.includes(variable), `${variable} missing`);
  });
  assert.match(index, /html\[data-theme="dark"\]/);
});

check("Clawpilot fonts and color-token-only component CSS are enforced", () => {
  assert.match(
    css,
    /font-family: "Segoe UI", Aptos, Calibri, -apple-system, BlinkMacSystemFont, sans-serif/,
  );
  assert.match(css, /font-family: Consolas, "Courier New", Courier, monospace/);
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b/i);
  assert.doesNotMatch(css, /\brgba?\s*\(/i);
  assert.doesNotMatch(css, /\bhsla?\s*\(/i);
  assert.doesNotMatch(css, /\b(?:Inter|Geist|system-ui)\b/);
});

check("application has no external assets or network clients", () => {
  assert.doesNotMatch(index, /(?:src|href)=["']https?:/i);
  assert.doesNotMatch(production, /\bfetch\s*\(/);
  assert.doesNotMatch(production, /\bXMLHttpRequest\b/);
  assert.doesNotMatch(production, /\bWebSocket\b/);
  assert.doesNotMatch(production, /\bEventSource\b/);
  assert.doesNotMatch(production, /\.sendBeacon\s*\(/);
});

check("raw-media persistence APIs are absent", () => {
  assert.doesNotMatch(executable, /\blocalStorage\b/);
  assert.doesNotMatch(executable, /\bsessionStorage\b/);
  assert.doesNotMatch(executable, /\bindexedDB\b/);
  assert.doesNotMatch(executable, /\bMediaRecorder\b/);
  assert.doesNotMatch(executable, /\.toDataURL\s*\(/);
  assert.doesNotMatch(executable, /\.captureStream\s*\(/);
});

check("live multimodal capability and honest fallbacks are implemented", () => {
  assert.match(app, /navigator\.mediaDevices\.getUserMedia/);
  assert.match(app, /window\.SpeechRecognition \|\| window\.webkitSpeechRecognition/);
  assert.match(app, /"FaceDetector" in window/);
  assert.match(app, /face\.landmarks/);
  assert.match(app, /head-position-fallback/);
  assert.match(app, /frame-motion-fallback/);
  assert.match(app, /type: "GESTURE", gesture: "nod"/);
  assert.match(index, /coarse webcam estimate/i);
  assert.match(index, /browser\s+vendor’s network speech service/i);
});

check("safety, fallback, and local export controls are visible", () => {
  assert.match(index, /STOP<\/kbd><kbd>CANCEL<\/kbd><kbd>UNDO/);
  assert.match(index, /Gaze\/dwell only highlights · never activates/);
  assert.match(index, /Keyboard: arrows aim · Enter confirms/);
  assert.match(app, /new Blob\(\[contents\]/);
  assert.match(core, /"safety\.freeze"/);
  assert.match(core, /case "DWELL":/);
  assert.match(core, /executes: false/);
});

process.on("exit", () => {
  if (!process.exitCode) {
    process.stdout.write(`\n${checks.length} static validation gates passed.\n`);
  }
});
