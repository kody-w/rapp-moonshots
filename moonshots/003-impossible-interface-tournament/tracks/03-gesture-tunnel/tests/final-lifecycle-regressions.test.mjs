import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CameraVisibilityGuard,
  FreshNeutralGate,
  LifecycleGate,
  shouldReloadAfterPageShow,
} from "../src/core.mjs";

const trackRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const appSource = await readFile(resolve(trackRoot, "src/app.mjs"), "utf8");

test("delayed face detection cannot preview after tracker stop or replacement", async () => {
  const oldTracker = new LifecycleGate();
  const replacementTracker = new LifecycleGate();
  oldTracker.start();
  const detectionGeneration = oldTracker.capture();
  let resolveDetection;
  const delayedDetection = new Promise((resolve) => {
    resolveDetection = resolve;
  });
  let stalePreviews = 0;

  const pending = (async () => {
    await delayedDetection;
    if (!oldTracker.isCurrent(detectionGeneration)) return;
    stalePreviews += 1;
  })();

  oldTracker.stop();
  const replacementGeneration = replacementTracker.start();
  resolveDetection([{ boundingBox: { x: 1, y: 1, width: 1, height: 1 } }]);
  await pending;

  assert.equal(stalePreviews, 0);
  assert.equal(oldTracker.isCurrent(detectionGeneration), false);
  assert.equal(replacementTracker.isCurrent(replacementGeneration), true);

  const detectorSource = appSource.slice(
    appSource.indexOf("async detectFace"),
    appSource.indexOf("function onGesture"),
  );
  const awaited = detectorSource.indexOf("await detector.detect");
  const lifecycleCheck = detectorSource.indexOf(
    "!this.lifecycle.isCurrent(detectionGeneration)",
  );
  const previewCallback = detectorSource.indexOf("this.callbacks.onCoarsePreview");
  assert.ok(awaited >= 0 && awaited < lifecycleCheck);
  assert.ok(lifecycleCheck < previewCallback);
  assert.match(detectorSource, /detector !== this\.faceDetector/);
});

test("persisted bfcache restore reloads every application mode", () => {
  assert.equal(shouldReloadAfterPageShow({ persisted: true }), true);
  assert.equal(shouldReloadAfterPageShow({ persisted: false }), false);
  assert.equal(shouldReloadAfterPageShow(undefined), false);

  const pageshowSource = appSource.slice(
    appSource.indexOf('window.addEventListener("pageshow"'),
    appSource.indexOf('window.addEventListener(\n  "pagehide"'),
  );
  assert.match(pageshowSource, /shouldReloadAfterPageShow\(event\)/);
  assert.match(pageshowSource, /window\.location\.reload\(\)/);
  assert.doesNotMatch(pageshowSource, /accessibleMode|simulationMode/);
});

test("foreground watchdog grants grace after lastFrameAt ages while hidden", () => {
  const guard = new CameraVisibilityGuard({ foregroundGraceMs: 2500 });
  guard.resume(0);
  guard.noteFreshFrame();
  const lastFrameAt = 100;

  guard.suspend();
  assert.equal(guard.shouldDeclareStale(lastFrameAt, 100000), false);

  guard.resume(100000);
  let sensorsStopped = false;
  if (guard.shouldDeclareStale(lastFrameAt, 100001)) sensorsStopped = true;
  assert.equal(sensorsStopped, false);
  assert.equal(guard.shouldDeclareStale(lastFrameAt, 102500), false);
  assert.equal(guard.shouldDeclareStale(lastFrameAt, 102501), true);

  guard.resume(200000);
  assert.equal(guard.shouldDeclareStale(lastFrameAt, 200001), false);
  const freshForegroundFrameAt = 200020;
  guard.noteFreshFrame();
  assert.equal(guard.shouldDeclareStale(freshForegroundFrameAt, 200021), false);

  const visibilityStart = appSource.indexOf('document.addEventListener("visibilitychange"');
  const visibilitySource = appSource.slice(
    visibilityStart,
    appSource.indexOf("frameWatchdog = window.setInterval", visibilityStart),
  );
  assert.match(visibilitySource, /tracker\?\.suspendForVisibility\(\)/);
  assert.match(visibilitySource, /tracker\?\.resumeFromVisibility\(foregroundAt\)/);
  assert.match(visibilitySource, /cancelPendingForVisibility\("visibility-hidden"\)/);
  assert.match(visibilitySource, /cancelPendingForVisibility\("visibility-foreground"\)/);
  assert.match(appSource, /tracker\.shouldDeclareCameraLoss\(performance\.now\(\)\)/);
});

test("foreground grace never counts as observed fresh-frame neutrality", () => {
  const neutralGate = new FreshNeutralGate({ requiredMs: 480 });
  neutralGate.reset();
  let hasPreviousFrame = false;
  const processFreshNeutralFrame = (at) => {
    if (!hasPreviousFrame) {
      hasPreviousFrame = true;
      return neutralGate.ready;
    }
    return neutralGate.observeNeutral(at);
  };

  assert.equal(processFreshNeutralFrame(700), false);
  assert.equal(neutralGate.since, null);
  assert.equal(processFreshNeutralFrame(733), false);
  assert.equal(neutralGate.since, 733);
  assert.equal(processFreshNeutralFrame(1195), false);
  assert.equal(processFreshNeutralFrame(1228), true);
  assert.ok(1228 - neutralGate.since >= 480);

  const trackerSource = appSource.slice(
    appSource.indexOf("class LocalMotionTracker"),
    appSource.indexOf("function onGesture"),
  );
  assert.match(trackerSource, /this\.neutralGate = new FreshNeutralGate\(\)/);
  assert.match(trackerSource, /resetMotionState\(\) \{[\s\S]*?this\.neutralGate\.reset\(\)/);
  assert.match(trackerSource, /this\.neutralGate\.observeNeutral\(now\)/);
  assert.doesNotMatch(trackerSource, /neutralSince\s*=\s*now/);
});
