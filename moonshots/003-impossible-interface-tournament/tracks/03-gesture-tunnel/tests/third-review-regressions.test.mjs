import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  MediaFrameGate,
  classifyMotionGesture,
  isCameraFrameStale,
  isTerminalSpeechRecognitionError,
  preservesVoiceRecoveryOnSensorLoss,
  recognitionBackoffMs,
} from "../src/core.mjs";

const trackRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const appSource = await readFile(resolve(trackRoot, "src/app.mjs"), "utf8");

test("60 Hz display ticks process only fresh 30 fps camera frames", () => {
  const gate = new MediaFrameGate();
  const freshTimes = [];
  let duplicateTicks = 0;

  for (let displayTick = 0; displayTick <= 8; displayTick += 1) {
    const now = displayTick * (1000 / 60);
    const cameraFrame = Math.floor(displayTick / 2);
    if (
      gate.accept({
        presentedFrames: cameraFrame,
        mediaTime: cameraFrame / 30,
      })
    ) {
      freshTimes.push(now);
    } else {
      duplicateTicks += 1;
    }
  }

  assert.equal(freshTimes.length, 5);
  assert.equal(duplicateTicks, 4);
  const gesture = classifyMotionGesture({
    start: { x: 0.1, y: 0.5 },
    end: { x: 0.82, y: 0.5 },
    durationMs: freshTimes.at(-1) - freshTimes[0],
    activeRatio: 0.12,
    neutralReady: true,
  });
  assert.equal(gesture.type, "rotate-right");
  assert.ok(gesture.durationMs >= 120);
  assert.equal(
    classifyMotionGesture({
      start: { x: 0.1, y: 0.5 },
      end: { x: 0.82, y: 0.5 },
      durationMs: 120,
      activeRatio: 0.12,
      neutralReady: true,
    }).type,
    "rotate-right",
  );

  const fallbackGate = new MediaFrameGate();
  assert.equal(fallbackGate.accept({ mediaTime: 0 }), true);
  assert.equal(fallbackGate.accept({ mediaTime: 0 }), false);
  assert.equal(fallbackGate.accept({ mediaTime: 1 / 30 }), true);
});

test("duplicate display frames do not refresh camera liveness", () => {
  const gate = new MediaFrameGate();
  let lastFreshFrameAt = 0;
  assert.equal(gate.accept({ presentedFrames: 12, mediaTime: 0.4 }), true);
  lastFreshFrameAt = 400;

  for (let now = 416; now <= 3000; now += 16) {
    if (gate.accept({ presentedFrames: 12, mediaTime: 0.4 })) lastFreshFrameAt = now;
  }

  assert.equal(lastFreshFrameAt, 400);
  assert.equal(isCameraFrameStale(lastFreshFrameAt, 2900), false);
  assert.equal(isCameraFrameStale(lastFreshFrameAt, 2901), true);

  const trackerSource = appSource.slice(
    appSource.indexOf("class LocalMotionTracker"),
    appSource.indexOf("function onGesture"),
  );
  assert.match(trackerSource, /requestVideoFrameCallback/);
  assert.match(trackerSource, /playbackQuality\.totalVideoFrames/);
  assert.match(trackerSource, /mediaTime: this\.video\.currentTime/);
  assert.ok(trackerSource.indexOf("if (!fresh) return") < trackerSource.indexOf("this.lastFrameAt = now"));
  assert.match(appSource, /isCameraFrameStale\(tracker\.lastFrameAt, performance\.now\(\)\)/);
});

test("camera loss preserves a recover-only voice listener", () => {
  assert.equal(preservesVoiceRecoveryOnSensorLoss("camera"), true);
  assert.equal(preservesVoiceRecoveryOnSensorLoss("microphone"), false);
  assert.equal(preservesVoiceRecoveryOnSensorLoss("camera", true), false);

  const lossSource = appSource.slice(
    appSource.indexOf("function handleSensorLoss"),
    appSource.indexOf("async function startSensors"),
  );
  assert.match(lossSource, /stopMedia\(\{ preserveVoiceRecovery \}\)/);
  assert.match(lossSource, /if \(preserveVoiceRecovery\) startRecognition\(\)/);
  assert.match(lossSource, /Camera lost\. State frozen\. Say recover/);

  const voiceSource = appSource.slice(
    appSource.indexOf("function handleVoice"),
    appSource.indexOf("function prepareEvidence"),
  );
  assert.match(voiceSource, /if \(recognitionRecoveryOnly\)/);
  assert.match(voiceSource, /restricted voice listener accepts only “recover”/);
  assert.match(voiceSource, /recoverSensors\(\{ explicit: true \}\)/);
});

test("permanent speech errors fail closed while transient retries use bounded backoff", () => {
  for (const error of [
    "audio-capture",
    "bad-grammar",
    "language-not-supported",
    "not-allowed",
    "phrases-not-supported",
    "service-not-allowed",
  ]) {
    assert.equal(isTerminalSpeechRecognitionError(error), true);
  }
  for (const error of ["aborted", "network", "no-speech"]) {
    assert.equal(isTerminalSpeechRecognitionError(error), false);
  }
  assert.deepEqual(
    [0, 1, 2, 3, 4, 5, 20].map((failures) => recognitionBackoffMs(failures)),
    [250, 250, 500, 1000, 2000, 4000, 4000],
  );

  const errorSource = appSource.slice(
    appSource.indexOf("recognition.onerror"),
    appSource.indexOf("function handleVoice"),
  );
  assert.match(errorSource, /isTerminalSpeechRecognitionError\(event\.error\)/);
  assert.match(errorSource, /recognitionRestartAllowed = false/);
  assert.match(errorSource, /recognitionTransientFailures \+= 1/);
  assert.match(errorSource, /const delay = recognitionBackoffMs\(recognitionTransientFailures\)/);
  assert.match(errorSource, /window\.setTimeout\(\(\) =>/);
});
