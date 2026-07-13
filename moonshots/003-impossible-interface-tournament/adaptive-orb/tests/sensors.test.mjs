import assert from "node:assert/strict";
import test from "node:test";
import { AdaptiveOrbMachine } from "../src/core.mjs";
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

test("gesture phase resets when the armed choice identity changes", () => {
  const gate = new CoarseGestureGate({
    downDelta: 0.05,
    returnDelta: 0.02,
    timeoutMs: 500,
    cooldownMs: 100,
  });
  gate.sample({
    zone: "radial",
    y: 0.4,
    at: 0,
    armed: true,
    epoch: 1,
    choiceId: "alpha",
  });
  gate.sample({
    zone: "radial",
    y: 0.47,
    at: 100,
    armed: true,
    epoch: 1,
    choiceId: "alpha",
  });
  const changed = gate.sample({
    zone: "radial",
    y: 0.4,
    at: 150,
    armed: true,
    epoch: 1,
    choiceId: "beta",
  });
  assert.equal(changed.confirmed, false);
  assert.equal(changed.phase, "settled");
  assert.equal(gate.armedChoiceId, "beta");
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
  controller.freshness.reset(generation);
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

test("FaceDetector aim requires accepted fresh frame content and processed sample", async () => {
  let now = 20;
  const aims = [];
  const actions = [];
  const detector = {
    detect: async () => [
      { boundingBox: { x: 100, y: 100, width: 100, height: 100 } },
    ],
  };
  const controller = new AdaptiveSensorController({
    video: { videoWidth: 640, videoHeight: 480 },
    onAction: (action) => actions.push(action),
    onAim: (aim) => aims.push(aim),
    clock: () => now,
  });
  const generation = controller.lifecycle.begin();
  controller.active = true;
  controller.freshness.reset(generation);
  controller.detector = detector;
  controller.contentEpoch = 3;
  controller.processDetector(
    generation,
    10,
    { generation, frameAt: 10, contentAt: 10 },
    new Uint8Array([4, 5, 6]),
    { activeTotal: 0, centroidX: 0, centroidY: 0, difference: 1 },
  );
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(aims.length, 1);
  assert.equal(controller.freshness.frameAt, 10);
  assert.equal(controller.freshness.contentAt, 10);
  assert.equal(controller.freshness.processedAt, 10);
  assert.equal(
    actions.some(
      (action) =>
        action.type === "SENSOR_SAMPLE" &&
        Number.isFinite(action.processedAt) &&
        !Number.isFinite(action.frameAt),
    ),
    true,
  );

  const stoppedAims = [];
  const stopped = new AdaptiveSensorController({
    video: { videoWidth: 640, videoHeight: 480 },
    onAim: (aim) => stoppedAims.push(aim),
    clock: () => now,
  });
  const stoppedGeneration = stopped.lifecycle.begin();
  stopped.active = true;
  stopped.freshness.reset(stoppedGeneration);
  stopped.detector = detector;
  stopped.onAction = (action) => {
    if (action.type === "SENSOR_SAMPLE" && Number.isFinite(action.processedAt)) {
      stopped.stop("freshness-callback-stop");
    }
  };
  stopped.processDetector(
    stoppedGeneration,
    15,
    { generation: stoppedGeneration, frameAt: 15, contentAt: 15 },
    new Uint8Array([7, 8, 9]),
    { activeTotal: 0, centroidX: 0, centroidY: 0, difference: 1 },
  );
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(stoppedAims.length, 0);

  const rejectedAims = [];
  const rejected = new AdaptiveSensorController({
    video: { videoWidth: 640, videoHeight: 480 },
    onAim: (aim) => rejectedAims.push(aim),
    onAction: (action) =>
      Number.isFinite(action.processedAt)
        ? { ok: false, effect: "rejected" }
        : { ok: true },
    clock: () => now,
  });
  const rejectedGeneration = rejected.lifecycle.begin();
  rejected.active = true;
  rejected.freshness.reset(rejectedGeneration);
  rejected.detector = detector;
  rejected.processDetector(
    rejectedGeneration,
    16,
    { generation: rejectedGeneration, frameAt: 16, contentAt: 16 },
    new Uint8Array([3, 2, 1]),
    { activeTotal: 0, centroidX: 0, centroidY: 0, difference: 1 },
  );
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(rejectedAims.length, 0);
  assert.equal(rejected.freshness.processedAt, null);
  rejected.stop("rejected-sample-test");
  controller.stop("success-test");
  now = 30;
});

test("detector error and fallback transition emit no stale aim and clear buffers", async () => {
  const aims = [];
  const actions = [];
  const detector = { detect: async () => { throw new Error("detector failed"); } };
  const controller = new AdaptiveSensorController({
    video: { videoWidth: 640, videoHeight: 480 },
    onAction: (action) => actions.push(action),
    onAim: (aim) => aims.push(aim),
    clock: () => 30,
  });
  const generation = controller.lifecycle.begin();
  controller.active = true;
  controller.freshness.reset(generation);
  controller.detector = detector;
  controller.contentEpoch = 1;
  controller.processDetector(
    generation,
    20,
    { generation, frameAt: 20, contentAt: 20 },
    new Uint8Array([9, 8, 7]),
    { activeTotal: 1, centroidX: 1, centroidY: 1, difference: 2 },
  );
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(aims.length, 0);
  assert.equal(controller.detector, null);
  assert.equal(controller.pendingDetectorBuffers.size, 0);
  assert.equal(controller.pendingRecoveryCauses.has("detector-transition"), true);
  assert.equal(
    actions.some(
      (action) =>
        action.type === "SENSOR_LOSS" &&
        action.cause === "detector-transition",
    ),
    true,
  );
  controller.stop("error-test");
});

test("old detector completion cannot cancel or unlock a replacement request", async () => {
  let resolveOld;
  let resolveNew;
  const oldDetection = new Promise((resolve) => {
    resolveOld = resolve;
  });
  const newDetection = new Promise((resolve) => {
    resolveNew = resolve;
  });
  let calls = 0;
  const detector = {
    detect() {
      calls += 1;
      return calls === 1 ? oldDetection : newDetection;
    },
  };
  const aims = [];
  const controller = new AdaptiveSensorController({
    video: { videoWidth: 640, videoHeight: 480 },
    onAim: (aim) => aims.push(aim),
    clock: () => 40,
  });
  const generation = controller.lifecycle.begin();
  controller.active = true;
  controller.freshness.reset(generation);
  controller.detector = detector;
  controller.processDetector(
    generation,
    10,
    { generation, frameAt: 10, contentAt: 10 },
    new Uint8Array([1, 2, 3]),
    { activeTotal: 0, centroidX: 0, centroidY: 0, difference: 1 },
  );
  controller.invalidateContent(generation, 20);
  controller.processDetector(
    generation,
    30,
    { generation, frameAt: 30, contentAt: 30 },
    new Uint8Array([4, 5, 6]),
    { activeTotal: 0, centroidX: 0, centroidY: 0, difference: 1 },
  );
  const replacementTimeout = controller.detectorTimeout;
  resolveOld([
    { boundingBox: { x: 100, y: 100, width: 100, height: 100 } },
  ]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(controller.detectorPending, true);
  assert.equal(controller.detectorTimeout, replacementTimeout);
  assert.equal(controller.pendingDetectorBuffers.size, 1);

  resolveNew([
    { boundingBox: { x: 120, y: 100, width: 100, height: 100 } },
  ]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(controller.detectorPending, false);
  assert.equal(controller.pendingDetectorBuffers.size, 0);
  assert.equal(aims.length, 1);
  controller.stop("replacement-test");
});

test("invalid content immediately revokes aim and requires content plus processing", () => {
  let now = 100;
  const machine = new AdaptiveOrbMachine({ clock: () => now });
  machine.dispatch({ type: "START", kind: "live", generation: 1, at: 0 });
  machine.dispatch({
    type: "SENSOR_STATUS",
    sensor: "camera",
    status: "active",
    at: 1,
  });
  machine.dispatch({
    type: "SENSOR_STATUS",
    sensor: "estimator",
    status: "active",
    at: 1,
  });
  machine.dispatch({
    type: "SENSOR_SAMPLE",
    generation: 1,
    frameAt: 10,
    contentAt: 10,
    processedAt: 10,
    at: 10,
  });
  machine.dispatch({
    type: "HIGHLIGHT",
    id: "route-beacons",
    source: "gaze",
    at: 20,
  });
  machine.dispatch({ type: "DWELL", durationMs: 250, at: 30 });

  const aims = [];
  const controller = new AdaptiveSensorController({
    video: null,
    onAction: (action) => machine.dispatch(action),
    onAim: (aim) => aims.push(aim),
    clock: () => now,
  });
  const generation = controller.lifecycle.begin();
  controller.active = true;
  controller.freshness.reset(generation);
  controller.setArmed(true, "route-beacons");
  controller.invalidateContent(generation, now);
  controller.invalidateContent(generation, now + 1);
  assert.equal(machine.state.highlight, null);
  assert.equal(machine.state.armed, false);
  assert.equal(controller.armed, false);
  assert.equal(controller.armedChoiceId, null);
  assert.deepEqual(machine.state.freezeCauses, ["content-invalid"]);
  assert.equal(machine.state.metrics.sensorLosses, 1);

  now = 200;
  controller.processFallback(
    now,
    { generation, frameAt: now, contentAt: now },
    new Uint8Array([1, 2, 3]),
    { activeTotal: 0, centroidX: 0, centroidY: 0, difference: 1 },
  );
  assert.deepEqual(machine.state.freezeCauses, []);
  assert.equal(machine.state.metrics.sensorRecoveries, 1);
  assert.equal(aims.length, 1);
  controller.stop("content-test");
});

test("shutdown zeros every pending detector-derived buffer", () => {
  const never = new Promise(() => {});
  const controller = new AdaptiveSensorController({
    video: { videoWidth: 640, videoHeight: 480 },
    clock: () => 10,
  });
  const generation = controller.lifecycle.begin();
  controller.active = true;
  controller.freshness.reset(generation);
  controller.detector = { detect: () => never };
  controller.processDetector(
    generation,
    10,
    { generation, frameAt: 10, contentAt: 10 },
    new Uint8Array([11, 12, 13]),
    { activeTotal: 0, centroidX: 0, centroidY: 0, difference: 1 },
  );
  const pending = [...controller.pendingDetectorBuffers];
  assert.equal(pending.length, 1);
  assert.equal(pending[0].some((value) => value !== 0), true);
  controller.stop("pending-buffer-test");
  assert.equal(controller.pendingDetectorBuffers.size, 0);
  assert.equal(pending[0].every((value) => value === 0), true);
});

test("synchronous speech permission failure becomes terminal and visible", () => {
  const originalRecognition = Object.getOwnPropertyDescriptor(
    globalThis,
    "SpeechRecognition",
  );
  class DeniedRecognition {
    start() {
      const error = new Error("denied");
      error.name = "NotAllowedError";
      throw error;
    }

    abort() {}
  }
  Object.defineProperty(globalThis, "SpeechRecognition", {
    configurable: true,
    value: DeniedRecognition,
  });
  const actions = [];
  const captions = [];
  try {
    const controller = new AdaptiveSensorController({
      video: null,
      clock: () => 20,
      onAction: (action) => {
        actions.push(action);
        return { ok: true };
      },
      onCaption: (caption) => captions.push(caption),
    });
    const generation = controller.lifecycle.begin();
    controller.active = true;
    controller.startRecognition(generation);
    assert.equal(controller.recognitionTerminal, true);
    assert.ok(
      actions.some(
        (action) =>
          action.type === "SENSOR_STATUS" &&
          action.sensor === "speech" &&
          action.status === "denied",
      ),
    );
    assert.match(captions.at(-1), /sensor-free parity/);
    controller.stop("speech-permission-test");
  } finally {
    if (originalRecognition) {
      Object.defineProperty(
        globalThis,
        "SpeechRecognition",
        originalRecognition,
      );
    } else {
      delete globalThis.SpeechRecognition;
    }
  }
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
