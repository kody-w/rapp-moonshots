import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  DETERMINISTIC_ACTIONS,
  TASK_LAYERS,
  TunnelEngine,
  evidencePresentation,
  matchVoiceOption,
  runDeterministicSimulation,
  shouldRestartRecognition,
} from "../src/core.mjs";

const trackRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const [appSource, template] = await Promise.all([
  readFile(resolve(trackRoot, "src/app.mjs"), "utf8"),
  readFile(resolve(trackRoot, "src/index.template.html"), "utf8"),
]);

test("payload aliases use whole phrases and prefer specific cobalt quantities", () => {
  const payload = TASK_LAYERS.find((layer) => layer.id === "payload");
  assert.equal(payload.options[matchVoiceOption(payload.options, "three cobalt beacons")].id, "cobalt-3");
  assert.equal(payload.options[matchVoiceOption(payload.options, "five cobalt beacons")].id, "cobalt-5");
  assert.equal(
    payload.options[matchVoiceOption(payload.options, "please route five cobalt beacons")].id,
    "cobalt-5",
  );
  assert.equal(
    matchVoiceOption(payload.options, "three cobalt beacons and five cobalt beacons"),
    -1,
  );
  assert.equal(matchVoiceOption(payload.options, "install the relay"), -1);

  const engine = new TunnelEngine({ clock: () => 0, sessionId: "overlap-regression" });
  engine.start(0);
  engine.voice("route", { confidence: 0.96, at: 100 });
  engine.voice("choose", { confidence: 0.96, at: 800 });
  engine.voice("five cobalt beacons", { confidence: 0.96, at: 1500 });
  assert.equal(engine.snapshot().preview.optionId, "cobalt-5");
});

test("evidence visibility and labels derive only from completion and exactness", () => {
  const incomplete = evidencePresentation({ completed: false, exact: false });
  assert.equal(incomplete.visible, false);
  assert.doesNotMatch(incomplete.label, /exact route sealed/i);

  const mismatch = evidencePresentation({ completed: true, exact: false });
  assert.equal(mismatch.visible, true);
  assert.match(mismatch.label, /mismatch/i);
  assert.doesNotMatch(mismatch.label, /exact route sealed/i);

  const exact = evidencePresentation({ completed: true, exact: true });
  assert.equal(exact.visible, true);
  assert.equal(exact.label, "Exact route sealed");

  assert.match(template, /id="evidence-title">Evidence locked</);
  assert.doesNotMatch(template, /<strong[^>]*>Exact route sealed<\/strong>/);
  assert.match(appSource, /const presentation = evidencePresentation\(snapshot\)/);
});

test("terminal recognition errors and teardown make restart fail closed", () => {
  const ready = {
    launched: true,
    restartAllowed: true,
    speechPaused: false,
    accessibleMode: false,
    simulationMode: false,
    tearingDown: false,
  };
  assert.equal(shouldRestartRecognition(ready), true);
  assert.equal(shouldRestartRecognition({ ...ready, restartAllowed: false }), false);
  assert.equal(shouldRestartRecognition({ ...ready, tearingDown: true }), false);
  assert.equal(shouldRestartRecognition({ ...ready, launched: false }), false);

  const recognitionError = appSource.slice(
    appSource.indexOf("recognition.onerror"),
    appSource.indexOf("recognition.onend"),
  );
  assert.match(recognitionError, /isTerminalSpeechRecognitionError\(event\.error\)/);
  assert.match(recognitionError, /recognitionRestartAllowed = false/);
  assert.match(recognitionError, /recognitionRecoveryRequired = true/);

  const pagehide = appSource.slice(appSource.indexOf('"pagehide"'));
  assert.match(pagehide, /tearingDown = true/);
  assert.match(pagehide, /launched = false/);
  assert.match(pagehide, /recognitionRestartAllowed = false/);
  assert.match(pagehide, /recognition\?\.abort\(\)/);
  assert.match(appSource, /recognitionRecoveryRequired && !explicit/);
});

test("deterministic sensor lifecycle mirrors runtime stream teardown and recovery", () => {
  assert.deepEqual(
    DETERMINISTIC_ACTIONS.filter((action) => action.at === 4400).map(
      ({ type, sensor }) => `${type}:${sensor}`,
    ),
    ["sensor-stopped:camera", "sensor-stopped:microphone", "sensor-lost:camera"],
  );
  assert.deepEqual(
    DETERMINISTIC_ACTIONS.filter((action) => action.at === 5300).map(
      ({ type, sensor }) => `${type}:${sensor}`,
    ),
    [
      "sensor-started:camera",
      "sensor-started:microphone",
      "sensor-recovered:camera",
      "sensor-recovered:microphone",
    ],
  );

  const result = runDeterministicSimulation();
  assert.deepEqual(result.metrics.sensorOnMs, { camera: 11550, microphone: 11550 });
  assert.ok(
    result.replay.replay.some(
      (event) =>
        event.type === "sensor-stopped" &&
        event.sensor === "microphone" &&
        event.atMs === 4400,
    ),
  );
  assert.ok(
    result.replay.replay.some(
      (event) =>
        event.type === "sensor-started" &&
        event.sensor === "microphone" &&
        event.atMs === 5300,
    ),
  );
});

test("launch announces ready only after successful sensor startup", () => {
  const launchSource = appSource.slice(
    appSource.indexOf("async function launch"),
    appSource.indexOf("elements.launch.addEventListener"),
  );
  assert.match(launchSource, /const sensorsReady = await startSensors\(\)/);
  assert.match(
    launchSource,
    /if \(sensorsReady\) announce\("Gesture Tunnel ready\. Say route\."\)/,
  );
  assert.doesNotMatch(launchSource, /await startSensors\(\);\s*announce\("Gesture Tunnel ready/);

  const failureSource = appSource.slice(
    appSource.indexOf("function handleSensorLoss"),
    appSource.indexOf("async function startSensors"),
  );
  assert.match(failureSource, /Camera lost\. State frozen\. Say recover/);
  assert.match(failureSource, /Voice recognition unavailable\. State frozen/);
  const recoverySource = appSource.slice(
    appSource.indexOf("async function recoverSensors"),
    appSource.indexOf("function startRecognition"),
  );
  assert.match(recoverySource, /if \(recovered\)/);
  assert.match(recoverySource, /Sensors recovered/);
});
