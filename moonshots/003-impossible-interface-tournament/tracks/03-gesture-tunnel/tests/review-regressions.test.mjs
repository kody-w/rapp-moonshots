import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  TunnelEngine,
  allowsMediaCapture,
  completionAnnouncement,
  normalizeSpeechConfidence,
  releaseMediaResources,
  shouldHandleTunnelShortcut,
} from "../src/core.mjs";

const trackRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const [appSource, template] = await Promise.all([
  readFile(resolve(trackRoot, "src/app.mjs"), "utf8"),
  readFile(resolve(trackRoot, "src/index.template.html"), "utf8"),
]);

test("zero, missing, and nonfinite speech confidence remain below threshold", () => {
  assert.equal(normalizeSpeechConfidence(0), 0);
  assert.equal(normalizeSpeechConfidence(undefined), 0);
  assert.equal(normalizeSpeechConfidence(Number.NaN), 0);
  assert.equal(normalizeSpeechConfidence(Number.POSITIVE_INFINITY), 0);
  assert.equal(normalizeSpeechConfidence("0.96"), 0);

  for (const confidence of [0, undefined, Number.NaN, Number.POSITIVE_INFINITY]) {
    const engine = new TunnelEngine({ clock: () => 0, sessionId: "confidence-regression" });
    engine.start(0);
    const result = engine.voice("route", { confidence, at: 100 });
    assert.equal(result.accepted, false);
    assert.equal(engine.snapshot().preview, null);
    const voiceEvent = engine.exportReplay().replay.find((event) => event.type === "voice-input");
    assert.equal(voiceEvent.confidence, 0);
  }

  const chooseEngine = new TunnelEngine({ clock: () => 0, sessionId: "choose-confidence" });
  chooseEngine.start(0);
  chooseEngine.voice("route", { confidence: 0.96, at: 100 });
  assert.equal(chooseEngine.voice("choose", { confidence: 0, at: 800 }).accepted, false);
  assert.equal(chooseEngine.voice("choose", { at: 1400 }).accepted, false);
  assert.equal(chooseEngine.snapshot().selections.length, 0);

  assert.doesNotMatch(appSource, /alternative\.confidence\s*\|\|/);
  assert.match(appSource, /handleVoice\(alternative\.transcript, alternative\.confidence\)/);
});

test("sensor recovery and user resume clear only their own freeze causes", () => {
  const recoveryFirst = new TunnelEngine({ clock: () => 0, sessionId: "freeze-recovery-first" });
  recoveryFirst.start(0);
  recoveryFirst.sensorLost("camera", 100);
  recoveryFirst.stop(200);
  assert.deepEqual(recoveryFirst.snapshot().freezeCauses, ["camera-lost", "user-stop"]);

  recoveryFirst.sensorRecovered("camera", 300);
  assert.equal(recoveryFirst.snapshot().frozen, true);
  assert.deepEqual(recoveryFirst.snapshot().freezeCauses, ["user-stop"]);
  recoveryFirst.voice("resume", { confidence: 0, at: 400 });
  assert.equal(recoveryFirst.snapshot().frozen, false);

  const resumeFirst = new TunnelEngine({ clock: () => 0, sessionId: "freeze-resume-first" });
  resumeFirst.start(0);
  resumeFirst.stop(100);
  resumeFirst.sensorLost("camera", 200);
  resumeFirst.sensorLost("microphone", 250);
  resumeFirst.voice("resume", { confidence: 0, at: 300 });
  assert.deepEqual(resumeFirst.snapshot().freezeCauses, ["camera-lost", "microphone-lost"]);
  resumeFirst.sensorRecovered("camera", 400);
  assert.equal(resumeFirst.snapshot().frozen, true);
  assert.deepEqual(resumeFirst.snapshot().freezeCauses, ["microphone-lost"]);
  resumeFirst.sensorRecovered("microphone", 500);
  assert.equal(resumeFirst.snapshot().frozen, false);
});

test("accessible and simulation modes categorically deny media capture", () => {
  assert.equal(allowsMediaCapture({ accessibleMode: true, simulationMode: false }), false);
  assert.equal(allowsMediaCapture({ accessibleMode: false, simulationMode: true }), false);
  assert.equal(allowsMediaCapture({ accessibleMode: true, simulationMode: true }), false);
  assert.equal(allowsMediaCapture({ accessibleMode: false, simulationMode: false }), true);

  const startSensors = appSource.slice(
    appSource.indexOf("async function startSensors"),
    appSource.indexOf("async function recoverSensors"),
  );
  assert.match(startSensors, /allowsMediaCapture\(\{ accessibleMode, simulationMode \}\)/);
  assert.ok(startSensors.indexOf("allowsMediaCapture") < startSensors.indexOf("getUserMedia"));
});

test("deterministic simulation rejects state-changing tunnel shortcuts", () => {
  assert.equal(
    shouldHandleTunnelShortcut({
      launched: true,
      simulationMode: true,
      targetInTunnel: true,
      nativeInteractive: false,
      key: "Enter",
    }),
    false,
  );
  assert.match(appSource, /function useFallback\(action\) \{\s*if \(!engine \|\| !launched \|\| simulationMode\) return;/);
});

test("media release stops every track and always detaches the video element", () => {
  const stops = [];
  const stream = {
    getTracks: () => [
      { stop: () => stops.push("camera") },
      {
        stop: () => {
          stops.push("microphone-error");
          throw new Error("simulated stop failure");
        },
      },
      { stop: () => stops.push("remaining-track") },
    ],
  };
  const video = { srcObject: stream };
  assert.equal(releaseMediaResources(stream, video), 3);
  assert.deepEqual(stops, ["camera", "microphone-error", "remaining-track"]);
  assert.equal(video.srcObject, null);

  const lossHandler = appSource.slice(
    appSource.indexOf("function handleSensorLoss"),
    appSource.indexOf("async function startSensors"),
  );
  assert.match(lossHandler, /stopMedia\(\{ preserveVoiceRecovery \}\)/);
  const sensorCatch = appSource.slice(
    appSource.indexOf("} catch (error) {", appSource.indexOf("async function startSensors")),
    appSource.indexOf("async function recoverSensors"),
  );
  assert.match(sensorCatch, /handleSensorLoss\(kind\)/);
});

test("completion speech distinguishes exact and mismatched routes", () => {
  assert.equal(
    completionAnnouncement({ completed: true, exact: true }, "Home"),
    "Exact route complete. Home.",
  );
  assert.match(
    completionAnnouncement({ completed: true, exact: false }, "Home"),
    /does not match.*undo/i,
  );
  assert.equal(
    completionAnnouncement({ completed: false, exact: false }, "North Gate"),
    "North Gate confirmed.",
  );
  assert.match(appSource, /announce\(completionAnnouncement\(after, committed\.label\)\)/);
});

test("shortcut handling is tunnel-scoped and preserves native controls", () => {
  const base = {
    launched: true,
    simulationMode: false,
    targetInTunnel: true,
    nativeInteractive: false,
  };
  assert.equal(shouldHandleTunnelShortcut({ ...base, key: "Enter" }), true);
  assert.equal(shouldHandleTunnelShortcut({ ...base, key: " " }), true);
  assert.equal(
    shouldHandleTunnelShortcut({ ...base, key: "Enter", nativeInteractive: true }),
    false,
  );
  assert.equal(
    shouldHandleTunnelShortcut({ ...base, key: "Enter", targetInTunnel: false }),
    false,
  );
  assert.equal(
    shouldHandleTunnelShortcut({ ...base, key: "Enter", launched: false }),
    false,
  );
  assert.match(appSource, /event\.target\?\.closest\?\.\("button, a\[href\]/);
  assert.match(appSource, /elements\.tunnelStage\.contains\(event\.target\)/);
  assert.match(template, /id="tunnel-stage"\s+tabindex="0"/);
});
