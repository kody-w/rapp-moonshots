import assert from "node:assert/strict";
import test from "node:test";
import {
  AdaptiveSensorController,
  CoarseGestureGate,
  DetectorEpochGuard,
  EpochGuard,
  FreshnessGate,
  stopStream,
} from "../src/sensors.mjs";

test("media lifecycle generations reject delayed work", () => {
  const guard = new EpochGuard();
  const first = guard.begin();
  assert.equal(guard.isCurrent(first), true);
  guard.invalidate();
  assert.equal(guard.isCurrent(first), false);
  const second = guard.begin();
  assert.equal(guard.isCurrent(second), true);
  assert.notEqual(first, second);
});

test("detector results require matching generation content epoch and identity", () => {
  const guard = new DetectorEpochGuard();
  const detector = {};
  const token = guard.capture(3, 8, detector);
  assert.equal(guard.accept(token, 3, 8, detector), true);
  assert.equal(guard.accept(token, 4, 8, detector), false);
  const tokenAfterGeneration = guard.capture(4, 9, detector);
  guard.invalidate();
  assert.equal(guard.accept(tokenAfterGeneration, 4, 9, detector), false);
  const replacement = {};
  const replacementToken = guard.capture(4, 10, detector);
  assert.equal(guard.accept(replacementToken, 4, 10, replacement), false);
  assert.equal(guard.rejections, 3);
});

test("freshness gate treats frame content and processing independently", () => {
  const gate = new FreshnessGate({ maxAgeMs: 100 });
  gate.reset(2);
  assert.equal(
    gate.update({
      generation: 2,
      frameAt: 10,
      contentAt: 10,
      processedAt: 10,
    }),
    true,
  );
  assert.equal(gate.isFresh(90), true);
  gate.update({ generation: 2, frameAt: 150 });
  assert.deepEqual(gate.staleCauses(151), ["content-stale", "processed-stale"]);
  assert.equal(
    gate.update({
      generation: 1,
      frameAt: 200,
      contentAt: 200,
      processedAt: 200,
    }),
    false,
  );
  assert.deepEqual(gate.staleCauses(151), ["content-stale", "processed-stale"]);
});

test("gesture gate cannot confirm by returning through center", () => {
  const gate = new CoarseGestureGate({
    downDelta: 0.05,
    returnDelta: 0.02,
    timeoutMs: 500,
    cooldownMs: 100,
  });
  gate.sample({ zone: "radial", y: 0.4, at: 0, armed: true, epoch: 1 });
  gate.sample({ zone: "radial", y: 0.47, at: 100, armed: true, epoch: 1 });
  const center = gate.sample({
    zone: "center",
    y: 0.4,
    at: 150,
    armed: true,
    epoch: 1,
  });
  assert.equal(center.confirmed, false);
  assert.equal(center.phase, "center");

  gate.sample({ zone: "radial", y: 0.4, at: 200, armed: true, epoch: 2 });
  gate.sample({ zone: "radial", y: 0.47, at: 260, armed: true, epoch: 2 });
  const returnToRadial = gate.sample({
    zone: "radial",
    y: 0.4,
    at: 320,
    armed: true,
    epoch: 2,
  });
  assert.equal(returnToRadial.confirmed, true);
});

test("delayed detector completion is rejected and releases the pending gate", async () => {
  let resolveDetection;
  const detection = new Promise((resolve) => {
    resolveDetection = resolve;
  });
  const actions = [];
  const detector = { detect: () => detection };
  const controller = new AdaptiveSensorController({
    video: { videoWidth: 640, videoHeight: 480 },
    onAction: (action) => actions.push(action),
    clock: () => 50,
  });
  const generation = controller.lifecycle.begin();
  controller.active = true;
  controller.detector = detector;
  controller.contentEpoch = 2;
  controller.processDetector(
    generation,
    10,
    { generation, frameAt: 10, contentAt: 10 },
    new Uint8Array([1, 2, 3]),
    { activeTotal: 0, centroidX: 0, centroidY: 0, difference: 1 },
  );
  controller.contentEpoch += 1;
  controller.detectorGuard.invalidate();
  resolveDetection([
    { boundingBox: { x: 100, y: 100, width: 100, height: 100 } },
  ]);
  await detection;
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(controller.detectorPending, false);
  assert.equal(
    actions.some(
      (action) => action.type === "SENSOR_SAMPLE" && action.generation === -1,
    ),
    true,
  );
  controller.stop("detector-test");
});

test("stopStream stops every acquired media track", () => {
  const tracks = [
    { stopped: false, stop() { this.stopped = true; } },
    { stopped: false, stop() { this.stopped = true; } },
  ];
  stopStream({ getTracks: () => tracks });
  assert.equal(tracks.every((track) => track.stopped), true);
});

test("controller disposes a permission stream that resolves after stop", async () => {
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  let resolvePermission;
  const permission = new Promise((resolve) => {
    resolvePermission = resolve;
  });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { mediaDevices: { getUserMedia: () => permission } },
  });
  const track = {
    stopped: false,
    stop() {
      this.stopped = true;
    },
  };
  const controller = new AdaptiveSensorController({
    video: null,
    clock: () => 10,
  });
  const started = controller.start();
  controller.stop("race-test");
  resolvePermission({ getTracks: () => [track] });
  assert.equal(await started, false);
  assert.equal(track.stopped, true);
  assert.equal(controller.stream, null);
  if (originalNavigator) {
    Object.defineProperty(globalThis, "navigator", originalNavigator);
  } else {
    delete globalThis.navigator;
  }
});

test("controller disposes media when stop races delayed preview play", async () => {
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  let resolvePlay;
  const play = new Promise((resolve) => {
    resolvePlay = resolve;
  });
  const track = {
    kind: "video",
    stopped: false,
    stop() {
      this.stopped = true;
    },
    addEventListener() {},
  };
  const stream = { getTracks: () => [track] };
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { mediaDevices: { getUserMedia: async () => stream } },
  });
  const video = {
    srcObject: null,
    muted: false,
    playsInline: false,
    play: () => play,
    pause() {},
  };
  const controller = new AdaptiveSensorController({ video, clock: () => 20 });
  const started = controller.start();
  await Promise.resolve();
  await Promise.resolve();
  controller.stop("preview-race");
  resolvePlay();
  assert.equal(await started, false);
  assert.equal(track.stopped, true);
  assert.equal(video.srcObject, null);
  if (originalNavigator) {
    Object.defineProperty(globalThis, "navigator", originalNavigator);
  } else {
    delete globalThis.navigator;
  }
});
