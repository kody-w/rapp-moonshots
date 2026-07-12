import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
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
