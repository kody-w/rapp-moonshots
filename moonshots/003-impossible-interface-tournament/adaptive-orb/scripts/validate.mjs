import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runDeterministicSimulation } from "../src/core.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFile(resolve(root, path), "utf8");
const [html, template, styles, app, sensors, core, packageText, build] =
  await Promise.all([
    read("index.html"),
    read("src/index.template.html"),
    read("src/styles.css"),
    read("src/app.mjs"),
    read("src/sensors.mjs"),
    read("src/core.mjs"),
    read("package.json"),
    read("scripts/build.mjs"),
  ]);
const evidenceFiles = process.argv.includes("--check-evidence")
  ? await Promise.all([
      read("evidence/deterministic-metrics.json"),
      read("evidence/deterministic-replay.json"),
    ])
  : null;

const checks = [];
function check(name, body) {
  try {
    body();
    checks.push({ name, pass: true });
  } catch (error) {
    checks.push({ name, pass: false, error: error.message });
  }
}

check("generated artifact has no unresolved build markers", () => {
  assert.doesNotMatch(html, /__ADAPTIVE_ORB_/);
  assert.ok(html.length > 90000);
  assert.ok(html.startsWith("<!doctype html>"));
});

check("theme detection is the first script and precedes application JavaScript", () => {
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)];
  assert.ok(scripts.length >= 2);
  assert.match(
    scripts[0][1],
    /new URLSearchParams\(window\.location\.search\)\.get\("scoutTheme"\)/,
  );
  assert.match(scripts[0][1], /prefers-color-scheme: dark/);
  assert.match(scripts[0][1], /document\.documentElement\.setAttribute\("data-theme", theme\)/);
  assert.doesNotMatch(scripts[0][0], /type="module"/);
  assert.match(scripts.at(-1)[0], /type="module"/);
});

check("exact Clawpilot light and dark tokens are present", () => {
  const required = [
    "--cp-bg: #f7f4ef;",
    "--cp-bg-elevated: #fcfbf8;",
    "--cp-surface: #ffffff;",
    "--cp-surface-soft: #f5f5f5;",
    "--cp-border: #dedede;",
    "--cp-border-strong: #919191;",
    "--cp-text: #242424;",
    "--cp-text-muted: #5c5c5c;",
    "--cp-text-soft: #6f6f6f;",
    "--cp-accent: #b11f4b;",
    "--cp-accent-hover: #9a1a41;",
    "--cp-accent-soft: rgba(177, 31, 75, 0.08);",
    "--cp-accent-fg: #ffffff;",
    "--cp-success: #16a34a;",
    "--cp-danger: #dc2626;",
    "--cp-warning: #f59e0b;",
    "--cp-link: #0078d4;",
    "--cp-shadow: 0 18px 48px rgba(0, 0, 0, 0.12);",
    "--cp-overlay: rgba(255, 255, 255, 0.8);",
    "--cp-panel: rgba(255, 255, 255, 0.86);",
    "--cp-panel-strong: rgba(255, 255, 255, 0.96);",
    "--cp-sheen: rgba(255, 255, 255, 0.55);",
    "--cp-highlight: rgba(177, 31, 75, 0.12);",
    "--cp-bg: #3d3b3a;",
    "--cp-bg-elevated: #343231;",
    "--cp-surface: #292929;",
    "--cp-surface-soft: #2e2e2e;",
    "--cp-border: #474747;",
    "--cp-border-strong: #5f5f5f;",
    "--cp-text: #dedede;",
    "--cp-text-muted: #919191;",
    "--cp-text-soft: #b0b0b0;",
    "--cp-accent: #fd8ea1;",
    "--cp-accent-hover: #fb7b91;",
    "--cp-accent-soft: rgba(253, 142, 161, 0.14);",
    "--cp-accent-fg: #1a1a1a;",
    "--cp-success: #4ade80;",
    "--cp-danger: #f87171;",
    "--cp-warning: #fbbf24;",
    "--cp-link: #4da6ff;",
    "--cp-shadow: 0 18px 48px rgba(0, 0, 0, 0.32);",
    "--cp-overlay: rgba(41, 41, 41, 0.88);",
    "--cp-panel: rgba(41, 41, 41, 0.72);",
    "--cp-panel-strong: rgba(41, 41, 41, 0.96);",
    "--cp-sheen: rgba(255, 255, 255, 0.04);",
    "--cp-highlight: rgba(253, 142, 161, 0.12);",
  ];
  for (const token of required) {
    assert.ok(template.includes(token), token);
  }
  assert.match(
    styles,
    /font-family: "Segoe UI", Aptos, Calibri, -apple-system, BlinkMacSystemFont, sans-serif;/,
  );
  assert.match(styles, /font-family: Consolas, "Courier New", Courier, monospace;/);
});

check("component styles contain no hardcoded colors", () => {
  assert.doesNotMatch(styles, /#[\da-f]{3,8}\b/i);
  assert.doesNotMatch(styles, /\brgba?\(/i);
  assert.doesNotMatch(styles, /\bhsla?\(/i);
  for (const line of template.split("\n")) {
    if (/#[\da-f]{3,8}\b|rgba?\(|hsla?\(/i.test(line)) {
      assert.match(line, /--cp-/);
    }
  }
});

check("artifact is self-contained with no external assets or iframe composition", () => {
  assert.doesNotMatch(html, /<script[^>]+\bsrc\s*=/i);
  assert.doesNotMatch(html, /<link[^>]+\bhref\s*=/i);
  assert.doesNotMatch(html, /<img[^>]+\bsrc\s*=/i);
  assert.doesNotMatch(html, /<iframe\b/i);
  assert.doesNotMatch(html, /https?:\/\//i);
  assert.doesNotMatch(html, /@import\b/i);
  assert.doesNotMatch(html, /url\(\s*["']?(?:https?:|\/\/)/i);
});

check("application has a fail-closed CSP and no client networking", () => {
  assert.match(html, /connect-src 'none'/);
  for (const forbidden of [
    /\bfetch\s*\(/,
    /\bXMLHttpRequest\b/,
    /\bWebSocket\b/,
    /\bEventSource\b/,
    /\bsendBeacon\b/,
    /\bRTCPeerConnection\b/,
    /\bserviceWorker\b/,
  ]) {
    assert.doesNotMatch(html, forbidden);
  }
});

check("application uses no persistence, recording, or analytics APIs", () => {
  for (const forbidden of [
    /\blocalStorage\b/,
    /\bsessionStorage\b/,
    /\bindexedDB\b/,
    /\bcaches\.(?:open|match|put)\b/,
    /\bMediaRecorder\b/,
    /\bgetDisplayMedia\b/,
    /\banalytics\b/i,
  ]) {
    assert.doesNotMatch(`${app}\n${sensors}\n${core}`, forbidden);
  }
});

check("one browser-native media lifecycle has race and cleanup guards", () => {
  assert.match(sensors, /getUserMedia/);
  assert.match(sensors, /class EpochGuard/);
  assert.match(sensors, /lifecycle\.isCurrent\(generation\)/);
  assert.match(sensors, /stopStream\(acquired\)/);
  assert.match(sensors, /track\.stop\(\)/);
  assert.match(sensors, /video\.srcObject = null/);
  assert.match(sensors, /pagehide|cleanupRuntime/);
  assert.match(app, /window\.addEventListener\("pagehide"/);
  assert.match(app, /event\.persisted/);
});

check("fresh frame content and delayed detector results are independently guarded", () => {
  assert.match(sensors, /requestVideoFrameCallback/);
  assert.match(sensors, /presentedFrames/);
  assert.match(sensors, /contentValid/);
  assert.match(sensors, /variance > 22/);
  assert.match(sensors, /difference > 0\.18/);
  assert.match(sensors, /class DetectorEpochGuard/);
  assert.match(sensors, /contentEpoch/);
  assert.match(sensors, /detectorGuard\.accept/);
  assert.match(sensors, /pixels\.data\.fill\(0\)/);
  assert.match(sensors, /analysisContext\.clearRect/);
});

check("honest FaceDetector fallback and vendor speech disclosure are visible", () => {
  assert.match(html, /FaceDetector/);
  assert.match(html, /face-position proxy · coarse, not eye tracking/);
  assert.match(html, /frame-motion fallback · not eye tracking/);
  assert.match(html, /Web Speech API/);
  assert.match(html, /may send audio to a browser or OS vendor/);
  assert.match(html, /sensor-free access/i);
  assert.match(html, /SpeechRecognition/);
});

check("the product is one adaptive orb with three shared grammars", () => {
  assert.match(html, /class="center-orb"/);
  assert.match(html, /Voice Orbit/);
  assert.match(html, /Gaze Compass/);
  assert.match(html, /Gesture Tunnel/);
  assert.match(core, /modePreference/);
  assert.match(core, /freezeCauses/);
  assert.match(core, /history/);
  assert.match(core, /gaze-never-confirms/);
  assert.match(core, /intentionalWrongBranches/);
});

check("deterministic query and JSON export are wired", () => {
  assert.match(app, /query\.get\("simulate"\) === "1"/);
  assert.match(app, /DETERMINISTIC_SCRIPT/);
  assert.match(app, /application\/json/);
  assert.match(core, /exactTaskVerdict/);
  assert.match(core, /perMode/);
  assert.match(core, /sensorRecoveries/);
  assert.match(core, /falseCommits/);
});

check("tournament evidence is imported at build time", () => {
  assert.match(build, /01-voice-orbit\/core\.js/);
  assert.match(build, /02-gaze-compass\/evidence\/simulation-metrics\.json/);
  assert.match(build, /03-gesture-tunnel\/evidence\/deterministic-metrics\.json/);
  assert.match(html, /BUILD_TOURNAMENT_EVIDENCE/);
  assert.match(html, /Tournament comparison/);
});

check("fallback parity and safety controls remain available", () => {
  for (const id of [
    "previousChoice",
    "nextChoice",
    "confirmChoice",
    "restChoice",
    "undoChoice",
    "useAccessible",
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(app, /ArrowLeft/);
  assert.match(app, /ArrowRight/);
  assert.match(app, /event\.key === "Enter"/);
  assert.match(app, /event\.key === "Escape"/);
  assert.match(app, /key === "u"/);
  assert.match(core, /hasWord\(text, "stop"\)/);
  assert.match(core, /hasWord\(text, "cancel"\)/);
  assert.match(core, /hasWord\(text, "undo"\)/);
});

check("package is dependency-free", () => {
  const packageJson = JSON.parse(packageText);
  assert.equal(packageJson.dependencies, undefined);
  assert.equal(packageJson.devDependencies, undefined);
  assert.match(packageJson.scripts.test, /node --test/);
});

if (process.argv.includes("--check-evidence")) {
  check("checked-in evidence exactly matches deterministic core", () => {
    const { record } = runDeterministicSimulation();
    const metrics = JSON.parse(evidenceFiles[0]);
    const replay = JSON.parse(evidenceFiles[1]);
    assert.equal(metrics.deterministicFingerprint, record.deterministicFingerprint);
    assert.equal(metrics.exactTaskVerdict, record.exactTaskVerdict);
    assert.deepEqual(metrics.task, record.task);
    assert.deepEqual(metrics.modeTransitions, record.metrics.modeTransitions);
    assert.deepEqual(metrics.perMode, record.metrics.perMode);
    assert.equal(replay.deterministicFingerprint, record.deterministicFingerprint);
    assert.equal(replay.eventCount, record.events.length);
    assert.deepEqual(replay.events, record.events);
  });
}

for (const result of checks) {
  if (result.pass) {
    process.stdout.write(`✓ ${result.name}\n`);
  } else {
    process.stderr.write(`✗ ${result.name}: ${result.error}\n`);
  }
}

const failures = checks.filter((result) => !result.pass);
if (failures.length) {
  process.exitCode = 1;
} else {
  process.stdout.write(`\n${checks.length} static policy checks passed.\n`);
}
