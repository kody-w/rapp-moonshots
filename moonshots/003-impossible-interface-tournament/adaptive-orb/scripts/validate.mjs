import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  runConversationSimulation,
  runDeterministicSimulation,
} from "../src/core.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFile(resolve(root, path), "utf8");
const [
  html,
  template,
  styles,
  app,
  ai,
  capabilities,
  sensors,
  session,
  mobile,
  core,
  packageText,
  build,
  manifestText,
  serviceWorker,
  server,
] =
  await Promise.all([
    read("index.html"),
    read("src/index.template.html"),
    read("src/styles.css"),
    read("src/app.mjs"),
    read("src/ai.mjs"),
    read("src/capabilities.mjs"),
    read("src/sensors.mjs"),
    read("src/session.mjs"),
    read("src/mobile.mjs"),
    read("src/core.mjs"),
    read("package.json"),
    read("scripts/build.mjs"),
    read("manifest.webmanifest"),
    read("service-worker.js"),
    read("server.py"),
  ]);
const evidenceFiles = process.argv.includes("--check-evidence")
  ? await Promise.all([
      read("evidence/deterministic-metrics.json"),
      read("evidence/deterministic-replay.json"),
      read("evidence/conversation-metrics.json"),
      read("evidence/conversation-replay.json"),
      read("evidence/mobile-evidence.json"),
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
      assert.ok(
        /--cp-/.test(line) || /<meta name="theme-color"/.test(line),
        line,
      );
    }
  }
});

check("artifact is self-contained with local-only PWA assets and no iframe", () => {
  assert.doesNotMatch(html, /<script[^>]+\bsrc\s*=/i);
  assert.doesNotMatch(html, /<link[^>]+\bhref\s*=\s*["'](?:https?:|\/\/)/i);
  assert.doesNotMatch(html, /<img[^>]+\bsrc\s*=/i);
  assert.doesNotMatch(html, /<iframe\b/i);
  assert.doesNotMatch(html, /https?:\/\//i);
  assert.doesNotMatch(html, /@import\b/i);
  assert.doesNotMatch(html, /url\(\s*["']?(?:https?:|\/\/)/i);
});

check("application CSP permits only same-origin companion networking", () => {
  assert.match(html, /connect-src 'self'/);
  assert.match(html, /worker-src 'self'/);
  assert.match(ai, /endpoint = "\/api\/chat"/);
  assert.match(ai, /credentials: "same-origin"/);
  assert.match(ai, /cache: "no-store"/);
  assert.match(ai, /redirect: "error"/);
  assert.doesNotMatch(html, /RAPP_BRAINSTEM_(?:URL|SECRET)/);
  for (const forbidden of [
    /\bXMLHttpRequest\b/,
    /\bWebSocket\b/,
    /\bEventSource\b/,
    /\bsendBeacon\b/,
    /\bRTCPeerConnection\b/,
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
    /\b(?:gtag|googleAnalytics|mixpanel|segment\.track)\b/i,
  ]) {
    assert.doesNotMatch(`${app}\n${ai}\n${sensors}\n${core}`, forbidden);
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
  assert.match(sensors, /this\.streams\.clear\(\)/);
  assert.match(sensors, /enableMicrophone/);
  assert.match(sensors, /enableCamera/);
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
  assert.match(sensors, /detectorTokenMatches/);
  assert.match(sensors, /freshness\.isFresh/);
  assert.match(sensors, /invalidateContent/);
  assert.match(sensors, /content-invalid/);
  assert.match(sensors, /pixels\.data\.fill\(0\)/);
  assert.match(sensors, /analysisContext\.clearRect/);
});

check("sensor-free transitions tear down before accessible render", () => {
  const stopAt = session.indexOf('controller.stop("sensor-free transition")');
  const commitAt = session.indexOf("const result = commitSensorFreeAfterTeardown");
  const renderAt = session.indexOf("render();");
  assert.ok(stopAt >= 0 && commitAt > stopAt && renderAt > commitAt);
  assert.match(core, /access-request/);
  assert.match(core, /SENSOR_FREE_AUTHORITY/);
  assert.match(app, /sensorTransitioning/);
  assert.match(app, /transitionToSensorFree/);
});

check("sensor-free semantic UI entry covers every broad task field", () => {
  for (const marker of [
    "entry-action",
    "entry-quantity",
    "entry-color",
    "entry-time",
    "entry-handling",
    "entry-review",
  ]) {
    assert.match(core, new RegExp(marker));
  }
  assert.match(app, /state\.entryStep/);
  assert.match(html, /Begin semantic quantity, color, time, and handling entry/);
});

check("aim cache gaps and gesture identity fail closed", () => {
  assert.match(session, /class RadialAimCoordinator/);
  assert.match(session, /durationMs > this\.maximumGapMs/);
  assert.match(session, /machine\.state\.highlight !== id/);
  assert.match(sensors, /armedChoiceId/);
  assert.match(sensors, /choiceId: this\.armedChoiceId/);
  assert.match(app, /gesture\.choiceId === machine\.state\.highlight/);
});

check("all detector-derived buffers are registered and zeroed", () => {
  assert.match(sensors, /pendingDetectorBuffers = new Set/);
  assert.match(sensors, /trackDetectorBuffer/);
  assert.match(sensors, /releaseDetectorBuffer/);
  assert.match(sensors, /releasePendingDetectorBuffers/);
  assert.match(
    html,
    /at most one tracked detector working copy may\s+exist; each is zeroed/,
  );
});

check("multi-turn deterministic replay is input-locked and exact before success", () => {
  assert.match(core, /REPLAY_AUTHORITY/);
  assert.match(core, /replay-rejected/);
  assert.match(core, /EXPECTED_DETERMINISTIC_FINGERPRINT = "c1b6e39f"/);
  assert.match(core, /EXPECTED_CONVERSATION_FINGERPRINT = "071ba015"/);
  assert.match(core, /verifyDeterministicRecord/);
  assert.match(core, /verifyConversationRecord/);
  assert.match(app, /replayLocked = true/);
  assert.match(app, /verifyConversationRecord\(record\)/);
  const verificationAt = app.indexOf("verifyConversationRecord(record)");
  const successAt = app.indexOf("Verified AI conversation replay");
  assert.ok(verificationAt >= 0 && successAt > verificationAt);
});

check("AI adapters provide offline default and strict same-origin failover", () => {
  for (const scenario of ["create", "plan", "explain", "navigate"]) {
    assert.match(ai, new RegExp(`${scenario}: Object\\.freeze`));
  }
  assert.match(ai, /class DemoAIAdapter/);
  assert.match(ai, /class CompanionAIAdapter/);
  assert.match(ai, /class AdaptiveAIAdapter/);
  assert.match(ai, /preferCompanion = false/);
  assert.match(ai, /Companion unavailable/);
  assert.match(ai, /conversation_history/);
  assert.match(core, /conversation\.turns/);
  assert.match(core, /publicConversationSummary/);
  assert.match(core, /events: this\.state\.events\.map\(publicEvent\)/);
  assert.match(ai, /"choice-selected"/);
  assert.match(app, /speakCurrentResponse/);
  assert.match(app, /speechSynthesis\.speak/);
  assert.match(template, /class="response-focus"/);
  assert.doesNotMatch(template, /<(?:input|textarea)\b/i);
});

check("stdlib companion keeps credentials server-side and validates strictly", () => {
  assert.match(server, /from http\.server import SimpleHTTPRequestHandler, ThreadingHTTPServer/);
  assert.match(server, /DEFAULT_BIND = "127\.0\.0\.1"/);
  assert.match(server, /BODY_CAP_BYTES = 64 \* 1024/);
  assert.match(server, /RAPP_BRAINSTEM_URL/);
  assert.match(server, /RAPP_BRAINSTEM_SECRET/);
  assert.match(server, /Authorization/);
  assert.match(server, /class NoRedirectHandler/);
  assert.match(server, /strict_json_loads/);
  assert.match(server, /timeout=configured_timeout\(\)/);
  assert.match(server, /set\(payload\) != ALLOWED_REQUEST_KEYS/);
  assert.match(server, /Cache-Control", "no-store"/);
  assert.match(server, /parsed_path = urlsplit\(self\.path\)/);
  assert.doesNotMatch(html, /server-only-secret|api[_-]?key/i);
});

check("PWA manifest and service worker cache only local static allowlist", () => {
  const manifest = JSON.parse(manifestText);
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.start_url, "./");
  assert.equal(manifest.scope, "./");
  assert.ok(manifest.icons.some((icon) => icon.sizes === "192x192"));
  assert.ok(manifest.icons.some((icon) => icon.sizes === "512x512"));
  assert.match(serviceWorker, /adaptive-orb-static-v3/);
  assert.match(serviceWorker, /STATIC_ASSETS/);
  assert.match(serviceWorker, /url\.pathname\.startsWith\("\/api\/"\)/);
  assert.match(serviceWorker, /ACTIVATE_UPDATE/);
  assert.doesNotMatch(
    serviceWorker,
    /conversation_history|user_input|MediaStream|calibration|metrics/,
  );
  assert.match(app, /navigator\.serviceWorker\.register/);
  assert.match(app, /updateViaCache: "none"/);
});

check("mobile and iOS hooks expose safe-area install and capability degradation", () => {
  assert.match(template, /apple-mobile-web-app-capable/);
  assert.match(template, /apple-touch-icon/);
  assert.match(template, /Share → Add to Home Screen/);
  assert.match(template, /require HTTPS or localhost/);
  assert.match(template, /Open in Safari for live sensors/);
  assert.match(template, /Installation works for offline/);
  assert.match(template, /id="capabilitySensorFree"/);
  assert.match(styles, /env\(safe-area-inset-top\)/);
  assert.match(styles, /env\(safe-area-inset-bottom\)/);
  assert.match(styles, /orientation: landscape/);
  assert.match(sensors, /webkitSpeechRecognition/);
  assert.match(sensors, /frame-motion fallback/);
});

check("standalone sensing is runtime-detected and fails to visible parity", () => {
  assert.match(capabilities, /display-mode: standalone/);
  assert.match(capabilities, /navigatorObject\?\.standalone === true/);
  assert.match(capabilities, /mediaDevices\?\.getUserMedia/);
  assert.match(capabilities, /webkitSpeechRecognition/);
  assert.match(capabilities, /Installability and offline access do not guarantee/);
  assert.match(capabilities, /showSafariLink/);
  assert.match(app, /refreshCapabilityGuidance/);
  assert.match(app, /sensorController\.enableMicrophone\(\)/);
  assert.match(app, /sensorController\.enableCamera\(\)/);
  assert.match(app, /liveStartFailed = !started/);
  assert.match(app, /trackRuntimeSensorCapability/);
  assert.match(app, /transitionToSensorFree\("open-browser"\)/);
  assert.match(sensors, /"NotAllowedError", "SecurityError", "NotSupportedError"/);
  assert.match(sensors, /Speech permission or service is unavailable/);
  assert.match(html, /Open in Safari for live sensors/);
  assert.match(html, /Sensor-free mode active/);
});

check("mobile-first contract is progressive, responsive, and eyes-up", () => {
  assert.match(template, /Start sensor-free AI/);
  assert.match(template, /id="permissionMic"/);
  assert.match(template, /id="permissionCamera"/);
  assert.ok(
    template.indexOf("Start sensor-free AI") <
      template.indexOf('id="permissionMic"'),
  );
  assert.ok(
    template.indexOf('id="permissionMic"') <
      template.indexOf('id="permissionCamera"'),
  );
  for (const phrase of [
    "eyes-up note",
    "workshop checklist",
    "hands-busy cooking",
    "switch-friendly",
    "Not for driving",
    "Headset and Bluetooth microphones",
  ]) {
    assert.match(template, new RegExp(phrase, "i"));
  }
  for (const id of [
    "mobileRepeat",
    "mobileWhatChanged",
    "mobileUndo",
    "mobileStop",
    "glanceProxy",
    "touchFallback",
    "interruptionRecovery",
    "permissionValue",
    "sensorOnTime",
  ]) {
    assert.match(template, new RegExp(`id="${id}"`));
  }
  assert.match(styles, /390 × 844 portrait/);
  assert.match(styles, /844 × 390/);
  assert.match(styles, /env\(safe-area-inset-left\)/);
  assert.match(styles, /env\(safe-area-inset-right\)/);
  assert.match(styles, /min-height: 44px/);
  assert.match(styles, /overflow-x: clip/);
  assert.equal((styles.match(/:hover/g) || []).length, 4);
  assert.ok((styles.match(/:active/g) || []).length >= 4);
  assert.match(mobile, /maximumPrimaryChoices: 4/);
  assert.match(mobile, /centerOrbMinimumPx: 112/);
  assert.match(app, /optionIds: \[\.\.\.visibleChoiceIds\]/);
  assert.match(app, /shortSpokenSummary/);
  assert.match(app, /ORIENTATION_CHANGE/);
  assert.match(app, /INTERRUPTION_RESUME/);
  assert.match(app, /background-interruption/);
  assert.match(app, /record\.mobile = mobileMetrics\.snapshot/);
  assert.doesNotMatch(app, /sensorController\.start\(\)/);
  assert.match(sensors, /facingMode: \{ ideal: "user" \}/);
  assert.match(sensors, /noiseSuppression: true/);
  assert.match(sensors, /autoGainControl: true/);
  assert.match(sensors, /smoothedAim/);
  assert.match(sensors, /recalibrateOrientation/);
  assert.doesNotMatch(sensors, /deviceId/);
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
  assert.match(app, /startupQuery\.get\("simulate"\) === "1"/);
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
  assert.match(app, /type: "RESUME", source: "touch"/);
  assert.match(core, /hasWord\(text, "stop"\)/);
  assert.match(core, /hasWord\(text, "cancel"\)/);
  assert.match(core, /hasWord\(text, "undo"\)/);
});

check("package is dependency-free", () => {
  const packageJson = JSON.parse(packageText);
  assert.equal(packageJson.dependencies, undefined);
  assert.equal(packageJson.devDependencies, undefined);
  assert.match(packageJson.scripts.test, /node --test/);
  assert.match(packageJson.scripts["test:python"], /unittest discover/);
});

if (process.argv.includes("--check-evidence")) {
  check("checked-in evidence exactly matches deterministic core", () => {
    const { record } = runDeterministicSimulation();
    const { record: conversationRecord } = runConversationSimulation();
    const metrics = JSON.parse(evidenceFiles[0]);
    const replay = JSON.parse(evidenceFiles[1]);
    const conversationMetrics = JSON.parse(evidenceFiles[2]);
    const conversationReplay = JSON.parse(evidenceFiles[3]);
    const mobileEvidence = JSON.parse(evidenceFiles[4]);
    assert.equal(metrics.deterministicFingerprint, record.deterministicFingerprint);
    assert.deepEqual(metrics.verification, {
      expectedFingerprint: "c1b6e39f",
      exactStateVerified: true,
      externalInputLocked: true,
    });
    assert.equal(metrics.exactTaskVerdict, record.exactTaskVerdict);
    assert.deepEqual(metrics.task, record.task);
    assert.deepEqual(metrics.modeTransitions, record.metrics.modeTransitions);
    assert.deepEqual(metrics.perMode, record.metrics.perMode);
    assert.equal(replay.deterministicFingerprint, record.deterministicFingerprint);
    assert.equal(replay.expectedFingerprint, "c1b6e39f");
    assert.equal(replay.exactStateVerified, true);
    assert.equal(replay.externalInputLocked, true);
    assert.equal(replay.eventCount, record.events.length);
    assert.deepEqual(replay.events, record.events);
    assert.equal(
      conversationMetrics.conversationFingerprint,
      conversationRecord.conversationFingerprint,
    );
    assert.equal(conversationMetrics.expectedFingerprint, "071ba015");
    assert.equal(conversationMetrics.exactStateVerified, true);
    assert.equal(conversationMetrics.externalInputLocked, true);
    assert.deepEqual(conversationMetrics.task, conversationRecord.task);
    assert.deepEqual(
      conversationMetrics.conversation,
      conversationRecord.conversation,
    );
    assert.deepEqual(
      conversationMetrics.modeTransitions,
      conversationRecord.metrics.modeTransitions,
    );
    assert.equal(
      conversationReplay.conversationFingerprint,
      conversationRecord.conversationFingerprint,
    );
    assert.equal(
      conversationReplay.semanticEventCount,
      conversationRecord.events.length,
    );
    assert.deepEqual(conversationReplay.events, conversationRecord.events);
    assert.equal(mobileEvidence.conversationFingerprint, "071ba015");
    assert.equal(mobileEvidence.exactTaskFingerprint, "c1b6e39f");
    assert.equal(mobileEvidence.layouts.portrait.width, 390);
    assert.equal(mobileEvidence.layouts.portrait.height, 844);
    assert.equal(mobileEvidence.layouts.landscape.width, 844);
    assert.equal(mobileEvidence.layouts.landscape.height, 390);
    assert.equal(mobileEvidence.layouts.portrait.noHorizontalOverflow, true);
    assert.equal(mobileEvidence.layouts.landscape.noHorizontalOverflow, true);
    assert.equal(mobileEvidence.maximumPrimaryChoices, 4);
    assert.equal(mobileEvidence.noHoverDependency, true);
    assert.deepEqual(mobileEvidence.progressivePermissions, [
      "sensor-free-value",
      "optional-microphone",
      "optional-front-camera",
    ]);
    assert.match(mobileEvidence.privacy, /no transcript, media/);
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
