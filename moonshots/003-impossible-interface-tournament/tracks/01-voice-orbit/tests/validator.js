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

function section(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.ok(startIndex >= 0, `${start} missing`);
  assert.ok(endIndex > startIndex, `${end} missing after ${start}`);
  return source.slice(startIndex, endIndex);
}

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

check("no-media fallback cannot request microphone or start speech", () => {
  const fallback = section(app, "function startFallback()", "async function startLive()");
  assert.match(index, /id="start-fallback"/);
  assert.match(index, /No camera · no microphone · no speech service/);
  assert.match(fallback, /type: "START", mode: "fallback"/);
  assert.doesNotMatch(fallback, /getUserMedia/);
  assert.doesNotMatch(fallback, /startSpeechRecognition/);
  assert.doesNotMatch(fallback, /SpeechRecognition/);
  assert.match(core, /action\.mode === "fallback"/);
  assert.match(core, /microphone = "not-requested"/);
  assert.match(core, /speech = "disabled"/);
});

check("preview and recognition stop races fail closed", () => {
  const live = section(app, "async function startLive()", "function simulationStep(");
  const speech = section(app, "function startSpeechRecognition()", "function bindTrackSafety(");
  const cleanup = section(app, "function stopRuntimeSensors()", "function dispatch(action)");
  const dispatcher = section(app, "function dispatch(action)", "function setSensor(");
  const playIndex = live.indexOf("await elements.cameraPreview.play()");
  const postPlayGuard = live.indexOf(
    'if (machine.state.status !== "active" || runtime.stream !== stream)',
    playIndex,
  );
  const recognitionIndex = live.indexOf("startSpeechRecognition()");
  assert.ok(playIndex >= 0 && postPlayGuard > playIndex && recognitionIndex > postPlayGuard);
  assert.match(
    speech,
    /if \(machine\.state\.status !== "active" \|\| !runtime\.stream\)\s*{\s*return;/,
  );
  assert.match(speech, /runtime\.recognition !== recognition/);
  assert.match(cleanup, /runtime\.recognition\.onstart = null/);
  assert.match(cleanup, /runtime\.recognition\.onresult = null/);
  assert.match(cleanup, /runtime\.recognition\.onerror = null/);
  assert.match(cleanup, /runtime\.recognition\.onend = null/);
  assert.match(dispatcher, /if \(machine\.state\.status === "stopped"\)\s*{\s*stopRuntimeSensors\(\)/);
});

check("speech denial cannot mark the physical microphone lost or retry", () => {
  const speech = section(app, "function startSpeechRecognition()", "function bindTrackSafety(");
  const tracks = section(app, "function bindTrackSafety(", "function startFallback()");
  assert.match(speech, /code === "not-allowed" \|\| code === "service-not-allowed"/);
  assert.match(speech, /runtime\.recognitionWanted = false/);
  assert.match(speech, /window\.clearTimeout\(runtime\.recognitionRestart\)/);
  assert.match(speech, /serviceDenied\s*\?\s*"denied"/);
  assert.match(speech, /!runtime\.recognitionWanted/);
  assert.match(speech, /Camera gesture, keyboard, and touch remain available/);
  assert.doesNotMatch(speech, /setSensor\("microphone"/);
  assert.doesNotMatch(app, /setSensor\("microphone", "lost"/);
  assert.match(tracks, /track\.onended[\s\S]+setSensor\(sensor, "lost"/);
  assert.match(tracks, /track\.onmute[\s\S]+setSensor\(sensor, "lost"/);
});

check("directed destination grammar precedes fallback mentions", () => {
  const parser = section(
    core,
    "function destinationCandidateIdentifier(value)",
    "function normalizeDestinationIdentifier(value)",
  );
  assert.match(parser, /change\|correct\|update\|set/);
  assert.match(parser, /instead\\s\+of/);
  assert.match(
    parser,
    /correction \|\| insteadOf \|\| directed \|\| assigned \|\| standalone \|\| known/,
  );
});

check("native Enter activation is preserved for interactive controls", () => {
  assert.match(app, /function isNativeInteractiveTarget\(target\)/);
  assert.match(app, /button, a\[href\], input, select, textarea, summary/);
  assert.match(app, /event\.key === "Enter" && isNativeInteractiveTarget\(event\.target\)/);
  ["fallback-cancel", "fallback-undo", "fallback-stop", "export-json"].forEach((id) => {
    assert.match(index, new RegExp(`id="${id}"`));
  });
  assert.match(app, /fallbackCancel\.addEventListener\("click"/);
  assert.match(app, /fallbackUndo\.addEventListener\("click"/);
  assert.match(app, /fallbackStop\.addEventListener\("click"/);
  assert.match(app, /exportJson\.addEventListener\("click"/);
});

check("center aim precedes the independent nod gesture signal", () => {
  const face = section(app, "function processFace(face, now)", "async function analyzeFace(now)");
  const aimIndex = face.indexOf("updateDirectionalAim(");
  const gestureIndex = face.indexOf("processGestureSample(");
  assert.ok(aimIndex >= 0 && gestureIndex > aimIndex);
  assert.match(face, /const gestureY = \(box\.y \+ box\.height \/ 2\)/);
  assert.match(app, /if \(aim\.zone !== "petal"\)/);
  assert.match(app, /zone: "center"/);
});

check("analysis canvas is cleared after sampling and during cleanup", () => {
  const motion = section(app, "function analyzeMotion(now)", "function analysisLoop(timestamp)");
  const cleanup = section(app, "function stopRuntimeSensors()", "function dispatch(action)");
  assert.match(motion, /getImageData\([^;]+;\s*}\s*finally\s*{\s*context\.clearRect\(/s);
  assert.match(motion, /pixels\.fill\(0\)/);
  assert.match(cleanup, /runtime\.previousFrame\.fill\(0\)/);
  assert.match(cleanup, /clearAnalysisCanvas\(\)/);
  assert.match(app, /window\.addEventListener\("pagehide", stopRuntimeSensors\)/);
});

check("safety, fallback, and local export controls are visible", () => {
  assert.match(index, /STOP<\/kbd><kbd>CANCEL<\/kbd><kbd>UNDO/);
  assert.match(index, /Gaze\/dwell only highlights · never activates/);
  assert.match(index, /Keyboard: arrows aim · Enter confirms/);
  assert.match(app, /new Blob\(\[contents\]/);
  assert.match(core, /"safety\.freeze"/);
  assert.match(core, /case "DWELL":/);
  assert.match(core, /executes: false/);
  assert.match(core, /class NodGestureGate/);
  assert.match(core, /sample\.zone === "center"/);
  assert.match(core, /draft\.mutation\.blocked/);
  assert.match(core, /destinationRejected/);
  assert.match(core, /SUPPORTED_DESTINATIONS/);
});

process.on("exit", () => {
  if (!process.exitCode) {
    process.stdout.write(`\n${checks.length} static validation gates passed.\n`);
  }
});
