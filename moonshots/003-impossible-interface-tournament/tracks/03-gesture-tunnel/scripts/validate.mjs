import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CameraVisibilityGuard,
  DETERMINISTIC_ACTIONS,
  LifecycleGate,
  MediaFrameGate,
  OPTION_COUNT,
  TASK_LAYERS,
  TunnelEngine,
  allowsMediaCapture,
  completionAnnouncement,
  evidencePresentation,
  isCameraFrameStale,
  isTerminalSpeechRecognitionError,
  matchVoiceOption,
  normalizeSpeechConfidence,
  preservesVoiceRecoveryOnSensorLoss,
  recognitionBackoffMs,
  runDeterministicSimulation,
  shouldRestartRecognition,
  shouldReloadAfterPageShow,
  shouldHandleTunnelShortcut,
} from "../src/core.mjs";

const trackRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFile(resolve(trackRoot, path), "utf8");
const [
  html,
  styles,
  app,
  readme,
  experiment,
  adversarial,
  rollback,
  pitch,
  experimentSummaryText,
] = await Promise.all([
  read("index.html"),
  read("src/styles.css"),
  read("src/app.mjs"),
  read("README.md"),
  read("EXPERIMENT.md"),
  read("ADVERSARIAL_REVIEW.md"),
  read("ROLLBACK.md"),
  read("PITCH.md"),
  read("evidence/experiment-summary.json"),
]);
const experimentSummary = JSON.parse(experimentSummaryText);

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

gate("reviewed runtime invariants", () => {
  assert.equal(normalizeSpeechConfidence(0), 0);
  assert.equal(normalizeSpeechConfidence(undefined), 0);
  assert.equal(allowsMediaCapture({ accessibleMode: true }), false);
  assert.equal(allowsMediaCapture({ simulationMode: true }), false);
  assert.equal(
    shouldHandleTunnelShortcut({
      launched: true,
      simulationMode: true,
      targetInTunnel: true,
      key: "Enter",
    }),
    false,
  );
  assert.match(completionAnnouncement({ completed: true, exact: false }), /does not match/i);

  const engine = new TunnelEngine({ clock: () => 0, sessionId: "validator-freeze-causes" });
  engine.start(0);
  engine.sensorLost("camera", 100);
  engine.stop(200);
  engine.sensorRecovered("camera", 300);
  assert.deepEqual(engine.snapshot().freezeCauses, ["user-stop"]);
  engine.resume(400);
  assert.equal(engine.snapshot().frozen, false);

  assert.match(app, /releaseMediaResources\(activeStream, elements\.video\)/);
  assert.match(app, /allowsMediaCapture\(\{ accessibleMode, simulationMode \}\)/);
  assert.doesNotMatch(app, /alternative\.confidence\s*\|\|/);
});

gate("second review invariants", () => {
  const payload = TASK_LAYERS.find((layer) => layer.id === "payload");
  assert.equal(payload.options[matchVoiceOption(payload.options, "five cobalt beacons")].id, "cobalt-5");
  assert.equal(payload.options[matchVoiceOption(payload.options, "three cobalt beacons")].id, "cobalt-3");
  assert.equal(evidencePresentation({ completed: false, exact: false }).visible, false);
  assert.match(evidencePresentation({ completed: true, exact: false }).label, /mismatch/i);
  assert.equal(evidencePresentation({ completed: true, exact: true }).label, "Exact route sealed");
  assert.equal(
    shouldRestartRecognition({
      launched: true,
      restartAllowed: false,
      tearingDown: false,
    }),
    false,
  );
  assert.deepEqual(
    DETERMINISTIC_ACTIONS.filter((action) => action.at === 4400).map(
      ({ type, sensor }) => `${type}:${sensor}`,
    ),
    ["sensor-stopped:camera", "sensor-stopped:microphone", "sensor-lost:camera"],
  );
  assert.match(app, /if \(sensorsReady\) announce\("Gesture Tunnel ready\. Say route\."\)/);
  assert.match(app, /recognitionRecoveryRequired && !explicit/);
});

gate("live sensor invariants", () => {
  const frameGate = new MediaFrameGate();
  assert.equal(frameGate.accept({ presentedFrames: 1, mediaTime: 0 }), true);
  assert.equal(frameGate.accept({ presentedFrames: 1, mediaTime: 0 }), false);
  assert.equal(frameGate.accept({ presentedFrames: 2, mediaTime: 1 / 30 }), true);
  assert.equal(isCameraFrameStale(100, 2601), true);
  assert.equal(preservesVoiceRecoveryOnSensorLoss("camera"), true);
  assert.equal(preservesVoiceRecoveryOnSensorLoss("microphone"), false);
  assert.equal(isTerminalSpeechRecognitionError("service-not-allowed"), true);
  assert.equal(isTerminalSpeechRecognitionError("language-not-supported"), true);
  assert.equal(isTerminalSpeechRecognitionError("network"), false);
  assert.equal(recognitionBackoffMs(20), 4000);
  assert.match(app, /requestVideoFrameCallback/);
  assert.match(app, /if \(!fresh\) return/);
  assert.match(app, /recognitionRecoveryOnly/);
  assert.match(app, /const delay = recognitionBackoffMs\(recognitionTransientFailures\)/);
});

gate("final lifecycle invariants", () => {
  const lifecycle = new LifecycleGate();
  lifecycle.start();
  const detectionGeneration = lifecycle.capture();
  lifecycle.stop();
  assert.equal(lifecycle.isCurrent(detectionGeneration), false);
  assert.equal(shouldReloadAfterPageShow({ persisted: true }), true);
  assert.equal(shouldReloadAfterPageShow({ persisted: false }), false);
  assert.match(app, /await detector\.detect\(this\.video\)/);
  assert.match(app, /!this\.lifecycle\.isCurrent\(detectionGeneration\)/);
  assert.match(app, /window\.addEventListener\("pageshow"/);
  assert.match(app, /if \(shouldReloadAfterPageShow\(event\)\) window\.location\.reload\(\)/);
});

gate("visibility release invariant", () => {
  const visibilityGuard = new CameraVisibilityGuard({ foregroundGraceMs: 2500 });
  visibilityGuard.resume(0);
  visibilityGuard.noteFreshFrame();
  visibilityGuard.suspend();
  assert.equal(visibilityGuard.shouldDeclareStale(100, 100000), false);
  visibilityGuard.resume(100000);
  assert.equal(visibilityGuard.shouldDeclareStale(100, 100001), false);
  visibilityGuard.noteFreshFrame();
  assert.equal(visibilityGuard.shouldDeclareStale(100020, 100021), false);
  assert.match(app, /suspendForVisibility\(\)/);
  assert.match(app, /resumeFromVisibility\(foregroundAt\)/);
  assert.match(app, /cancelPendingForVisibility\("visibility-foreground"\)/);
  assert.match(app, /tracker\.shouldDeclareCameraLoss\(performance\.now\(\)\)/);
});

gate("evidence and rollback docs", () => {
  assert.match(experiment, /hypothesis/i);
  assert.match(experiment, /measured/i);
  assert.match(adversarial, /residual/i);
  assert.match(adversarial, /false commit/i);
  assert.match(rollback, /git revert/i);
  assert.match(pitch, /Gesture Tunnel/);
  assert.equal(experimentSummary.status, "pass");
  assert.equal(experimentSummary.repeatedRunsIdentical, true);
  assert.equal(experimentSummary.exactTaskCompletion, true);
});

console.log(`Gesture Tunnel validator: ${gates.length}/${gates.length} gates passed`);
gates.forEach((name) => console.log(`  ✓ ${name}`));
