import assert from "node:assert/strict";
import test from "node:test";
import {
  AdaptiveOrbMachine,
  commitSensorFreeAfterTeardown,
} from "../src/core.mjs";
import {
  AdaptiveSensorController,
  CoarseGestureGate,
  DetectorEpochGuard,
  EpochGuard,
  FreshnessGate,
  streamHasLiveTrack,
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

  const resumed = new EpochGuard(7);
  assert.equal(resumed.begin(), 8);
  assert.equal(resumed.isCurrent(8), true);
});

test("sensor re-enable generation aligns after sensor-free interruption", () => {
  const machine = new AdaptiveOrbMachine({ clock: () => 20 });
  machine.dispatch({
    type: "START",
    kind: "accessible",
    generation: 1,
    at: 0,
  });
  commitSensorFreeAfterTeardown(machine, {
    source: "background-interruption",
    at: 10,
  });
  assert.equal(machine.state.sensors.generation, 2);
  const controller = new AdaptiveSensorController({
    video: null,
    generationSeed: machine.state.sensors.generation - 1,
    clock: () => 20,
  });
  const generation = controller.ensureProgressiveLifecycle();
  assert.equal(generation, machine.state.sensors.generation);
  assert.equal(
    machine.dispatch({
      type: "SENSOR_SAMPLE",
      generation,
      frameAt: 20,
      contentAt: 20,
      processedAt: 20,
      at: 20,
    }).effect,
    "sample",
  );
  controller.stop("generation-alignment-test");
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

test("aim smoothing tolerates motion noise and orientation revokes stale calibration", () => {
  const aims = [];
  const actions = [];
  const controller = new AdaptiveSensorController({
    video: null,
    onAim: (aim) => aims.push(aim),
    onAction: (action) => actions.push(action),
    clock: () => 100,
  });
  const generation = controller.lifecycle.begin();
  controller.lifecycleGeneration = generation;
  controller.active = true;
  controller.cameraStream = { getTracks: () => [] };
  controller.freshness.reset(generation);
  controller.emitAim({ x: 0.2, y: 0.4 }, 0.5, "fallback", 10);
  controller.emitAim({ x: 0.8, y: 0.6 }, 0.5, "fallback", 20);
  assert.equal(aims.length, 2);
  assert.ok(aims[1].x > 0.2 && aims[1].x < 0.8);
  assert.ok(aims[1].y > 0.4 && aims[1].y < 0.6);

  const previous = new Uint8Array([2, 4, 6]);
  controller.previousGray = previous;
  controller.setArmed(true, "choice-a");
  controller.recalibrateOrientation();
  assert.equal(controller.smoothedAim, null);
  assert.equal(controller.previousGray, null);
  assert.deepEqual([...previous], [0, 0, 0]);
  assert.equal(controller.armed, false);
  assert.equal(controller.contentBlocked, true);
  assert.ok(
    actions.some(
      (action) =>
        action.type === "SENSOR_LOSS" &&
        action.cause === "content-invalid",
    ),
  );
  controller.stop("orientation-test");
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

test("six ordinary recognition onend cycles reset retry state", async () => {
  const originalRecognition = Object.getOwnPropertyDescriptor(
    globalThis,
    "SpeechRecognition",
  );
  class CyclingRecognition {
    static instances = [];

    constructor() {
      CyclingRecognition.instances.push(this);
    }

    start() {
      this.onstart?.();
    }

    abort() {}
  }
  Object.defineProperty(globalThis, "SpeechRecognition", {
    configurable: true,
    value: CyclingRecognition,
  });
  const actions = [];
  const track = {
    kind: "audio",
    readyState: "live",
    stopped: false,
    stop() {
      this.stopped = true;
      this.readyState = "ended";
    },
  };
  const stream = {
    active: true,
    getTracks: () => [track],
  };
  const controller = new AdaptiveSensorController({
    video: null,
    recognitionRetryBaseMs: 0,
    onAction: (action) => {
      actions.push(action);
      return { ok: true };
    },
  });
  const generation = controller.lifecycle.begin();
  controller.lifecycleGeneration = generation;
  controller.active = true;
  controller.microphoneStream = stream;
  controller.registerStream(stream);
  try {
    controller.startRecognition(generation);
    for (let cycle = 0; cycle < 6; cycle += 1) {
      const recognition = controller.recognition;
      recognition.onend();
      await new Promise((resolve) => setTimeout(resolve, 2));
      assert.notEqual(controller.recognition, recognition);
      assert.equal(controller.recognitionTerminal, false);
      assert.equal(controller.recognitionRetries, 0);
      assert.equal(controller.recognitionTransientFailures, 0);
    }
    assert.equal(track.stopped, false);
    assert.equal(
      actions.some(
        (action) =>
          action.sensor === "speech" && action.status === "unavailable",
      ),
      false,
    );
    assert.ok(
      actions.filter(
        (action) =>
          action.sensor === "speech" && action.status === "active",
      ).length >= 7,
    );
  } finally {
    controller.stop("ordinary-onend-test");
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

test("repeated announce aborts stay expected while unexpected abort remains transient", async () => {
  const originalRecognition = Object.getOwnPropertyDescriptor(
    globalThis,
    "SpeechRecognition",
  );
  const originalSynthesis = Object.getOwnPropertyDescriptor(
    globalThis,
    "speechSynthesis",
  );
  const originalUtterance = Object.getOwnPropertyDescriptor(
    globalThis,
    "SpeechSynthesisUtterance",
  );
  class AnnounceRecognition {
    start() {
      this.onstart?.();
    }

    abort() {
      this.onerror?.({ error: "aborted" });
      this.onend?.();
    }
  }
  class TestUtterance {
    constructor(text) {
      this.text = text;
    }
  }
  Object.defineProperty(globalThis, "SpeechRecognition", {
    configurable: true,
    value: AnnounceRecognition,
  });
  Object.defineProperty(globalThis, "SpeechSynthesisUtterance", {
    configurable: true,
    value: TestUtterance,
  });
  Object.defineProperty(globalThis, "speechSynthesis", {
    configurable: true,
    value: {
      cancel() {},
      speak(utterance) {
        utterance.onend?.();
      },
    },
  });
  const actions = [];
  const track = {
    kind: "audio",
    readyState: "live",
    stopped: false,
    stop() {
      this.stopped = true;
      this.readyState = "ended";
    },
  };
  const stream = {
    active: true,
    getTracks: () => [track],
  };
  const controller = new AdaptiveSensorController({
    video: null,
    recognitionRetryBaseMs: 0,
    onAction: (action) => {
      actions.push(action);
      return { ok: true };
    },
  });
  const generation = controller.lifecycle.begin();
  controller.lifecycleGeneration = generation;
  controller.active = true;
  controller.microphoneStream = stream;
  controller.registerStream(stream);
  try {
    controller.startRecognition(generation);
    for (let cycle = 0; cycle < 8; cycle += 1) {
      const recognition = controller.recognition;
      controller.announce(`summary ${cycle + 1}`);
      await new Promise((resolve) => setTimeout(resolve, 2));
      assert.notEqual(controller.recognition, recognition);
      assert.equal(controller.recognitionTerminal, false);
      assert.equal(controller.recognitionRetries, 0);
      assert.equal(controller.recognitionTransientFailures, 0);
      assert.equal(controller.microphoneStream, stream);
      assert.equal(track.stopped, false);
    }
    assert.equal(
      actions.some(
        (action) =>
          action.sensor === "speech" && action.status === "unavailable",
      ),
      false,
    );

    const recognition = controller.recognition;
    recognition.onerror({ error: "aborted" });
    assert.equal(controller.recognitionTransientFailures, 1);
    assert.ok(
      actions.some(
        (action) =>
          action.sensor === "speech" &&
          action.status === "recovering" &&
          action.reason === "unexpected-aborted",
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 2));
    assert.notEqual(controller.recognition, recognition);
    assert.equal(controller.recognitionTerminal, false);
    assert.equal(controller.microphoneStream, stream);
    assert.equal(track.stopped, false);
  } finally {
    controller.stop("announce-abort-test");
    for (const [name, descriptor] of [
      ["SpeechRecognition", originalRecognition],
      ["speechSynthesis", originalSynthesis],
      ["SpeechSynthesisUtterance", originalUtterance],
    ]) {
      if (descriptor) {
        Object.defineProperty(globalThis, name, descriptor);
      } else {
        delete globalThis[name];
      }
    }
  }
});

test("stale replaced utterance cannot restart recognition during current narration", async () => {
  const originalRecognition = Object.getOwnPropertyDescriptor(
    globalThis,
    "SpeechRecognition",
  );
  const originalSynthesis = Object.getOwnPropertyDescriptor(
    globalThis,
    "speechSynthesis",
  );
  const originalUtterance = Object.getOwnPropertyDescriptor(
    globalThis,
    "SpeechSynthesisUtterance",
  );
  let recognitionStarts = 0;
  class RaceRecognition {
    start() {
      recognitionStarts += 1;
      this.stopped = false;
      this.onstart?.();
    }

    abort() {
      this.stopped = true;
      this.onerror?.({ error: "aborted" });
      this.onend?.();
    }
  }
  class RaceUtterance {
    constructor(text) {
      this.text = text;
    }
  }
  const utterances = [];
  Object.defineProperty(globalThis, "SpeechRecognition", {
    configurable: true,
    value: RaceRecognition,
  });
  Object.defineProperty(globalThis, "SpeechSynthesisUtterance", {
    configurable: true,
    value: RaceUtterance,
  });
  Object.defineProperty(globalThis, "speechSynthesis", {
    configurable: true,
    value: {
      cancel() {},
      speak(utterance) {
        utterances.push(utterance);
      },
    },
  });
  const track = {
    kind: "audio",
    readyState: "live",
    stopped: false,
    stop() {
      this.stopped = true;
      this.readyState = "ended";
    },
  };
  const stream = {
    active: true,
    getTracks: () => [track],
  };
  const controller = new AdaptiveSensorController({
    video: null,
    recognitionRetryBaseMs: 0,
  });
  const generation = controller.lifecycle.begin();
  controller.lifecycleGeneration = generation;
  controller.active = true;
  controller.microphoneStream = stream;
  controller.registerStream(stream);
  try {
    controller.startRecognition(generation);
    const initialRecognition = controller.recognition;
    assert.equal(recognitionStarts, 1);

    controller.announce("A");
    controller.announce("B");
    assert.equal(utterances.length, 2);
    assert.equal(controller.speaking, true);
    assert.equal(initialRecognition.stopped, true);
    assert.equal(controller.recognition, initialRecognition);
    const expectedEndBeforeStaleError = controller.recognitionExpectedEnd;

    utterances[0].onerror();
    await new Promise((resolve) => setTimeout(resolve, 2));
    assert.equal(controller.speaking, true);
    assert.equal(
      controller.recognitionExpectedEnd,
      expectedEndBeforeStaleError,
    );
    assert.equal(controller.recognitionRetry, null);
    assert.equal(controller.recognition, initialRecognition);
    assert.equal(recognitionStarts, 1);

    utterances[1].onend();
    await new Promise((resolve) => setTimeout(resolve, 2));
    assert.equal(controller.speaking, false);
    assert.notEqual(controller.recognition, initialRecognition);
    assert.equal(recognitionStarts, 2);
    assert.equal(controller.recognitionRetries, 0);
    assert.equal(controller.recognitionTransientFailures, 0);
    assert.equal(controller.microphoneStream, stream);
    assert.equal(track.stopped, false);
  } finally {
    controller.stop("utterance-epoch-test");
    for (const [name, descriptor] of [
      ["SpeechRecognition", originalRecognition],
      ["speechSynthesis", originalSynthesis],
      ["SpeechSynthesisUtterance", originalUtterance],
    ]) {
      if (descriptor) {
        Object.defineProperty(globalThis, name, descriptor);
      } else {
        delete globalThis[name];
      }
    }
  }
});

test("microphone regrant cancels narration before recognition starts", async () => {
  const originalRecognition = Object.getOwnPropertyDescriptor(
    globalThis,
    "SpeechRecognition",
  );
  const originalSynthesis = Object.getOwnPropertyDescriptor(
    globalThis,
    "speechSynthesis",
  );
  const originalUtterance = Object.getOwnPropertyDescriptor(
    globalThis,
    "SpeechSynthesisUtterance",
  );
  const originalNavigator = Object.getOwnPropertyDescriptor(
    globalThis,
    "navigator",
  );
  let recognitionStarts = 0;
  let synthesisCancels = 0;
  let resolvePermission;
  const permission = new Promise((resolve) => {
    resolvePermission = resolve;
  });
  class RecoveryRecognition {
    start() {
      recognitionStarts += 1;
      this.onstart?.();
    }

    abort() {}
  }
  class RecoveryUtterance {
    constructor(text) {
      this.text = text;
    }
  }
  const utterances = [];
  Object.defineProperty(globalThis, "SpeechRecognition", {
    configurable: true,
    value: RecoveryRecognition,
  });
  Object.defineProperty(globalThis, "SpeechSynthesisUtterance", {
    configurable: true,
    value: RecoveryUtterance,
  });
  Object.defineProperty(globalThis, "speechSynthesis", {
    configurable: true,
    value: {
      cancel() {
        synthesisCancels += 1;
      },
      speak(utterance) {
        utterances.push(utterance);
      },
    },
  });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      mediaDevices: {
        getUserMedia: () => permission,
      },
    },
  });
  const track = {
    kind: "audio",
    readyState: "live",
    stopped: false,
    addEventListener() {},
    stop() {
      this.stopped = true;
      this.readyState = "ended";
    },
  };
  const stream = {
    active: true,
    getTracks: () => [track],
  };
  const controller = new AdaptiveSensorController({
    video: null,
    recognitionRetryBaseMs: 0,
  });
  try {
    const enabling = controller.enableMicrophone();
    controller.announce("Narration during permission regrant");
    assert.equal(controller.speaking, true);
    assert.equal(utterances.length, 1);
    assert.equal(recognitionStarts, 0);
    const narrationEpoch = controller.announcementEpoch;

    resolvePermission(stream);
    assert.equal(await enabling, true);
    assert.equal(controller.speaking, false);
    assert.ok(controller.announcementEpoch > narrationEpoch);
    assert.ok(synthesisCancels >= 2);
    assert.equal(recognitionStarts, 1);
    assert.equal(controller.microphoneStream, stream);

    utterances[0].onend();
    await new Promise((resolve) => setTimeout(resolve, 2));
    assert.equal(recognitionStarts, 1);
    assert.equal(controller.recognitionRetry, null);
    assert.equal(controller.recognitionTerminal, false);
    assert.equal(controller.microphoneStream, stream);
    assert.equal(track.stopped, false);
  } finally {
    controller.stop("microphone-regrant-narration-test");
    for (const [name, descriptor] of [
      ["SpeechRecognition", originalRecognition],
      ["speechSynthesis", originalSynthesis],
      ["SpeechSynthesisUtterance", originalUtterance],
      ["navigator", originalNavigator],
    ]) {
      if (descriptor) {
        Object.defineProperty(globalThis, name, descriptor);
      } else {
        delete globalThis[name];
      }
    }
  }
});

test("recognition exhaustion stops capture and explicit enable recovers", async () => {
  const originalRecognition = Object.getOwnPropertyDescriptor(
    globalThis,
    "SpeechRecognition",
  );
  const originalNavigator = Object.getOwnPropertyDescriptor(
    globalThis,
    "navigator",
  );
  let failStart = true;
  class RecoverableRecognition {
    start() {
      this.onstart?.();
      if (failStart) {
        this.onerror?.({ error: "network" });
      }
    }

    abort() {}
  }
  Object.defineProperty(globalThis, "SpeechRecognition", {
    configurable: true,
    value: RecoverableRecognition,
  });
  const actions = [];
  const captions = [];
  const initialTrack = {
    kind: "audio",
    readyState: "live",
    stopped: false,
    stop() {
      this.stopped = true;
      this.readyState = "ended";
    },
  };
  const initialStream = {
    active: true,
    getTracks: () => [initialTrack],
  };
  const replacementTrack = {
    kind: "audio",
    readyState: "live",
    stopped: false,
    addEventListener() {},
    stop() {
      this.stopped = true;
      this.readyState = "ended";
    },
  };
  const replacementStream = {
    active: true,
    getTracks: () => [replacementTrack],
  };
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      mediaDevices: {
        getUserMedia: async () => replacementStream,
      },
    },
  });
  const controller = new AdaptiveSensorController({
    video: null,
    recognitionRetryBaseMs: 0,
    onAction: (action) => {
      actions.push(action);
      return { ok: true };
    },
    onCaption: (caption) => captions.push(caption),
  });
  const generation = controller.lifecycle.begin();
  controller.lifecycleGeneration = generation;
  controller.active = true;
  controller.microphoneStream = initialStream;
  controller.registerStream(initialStream);
  try {
    controller.startRecognition(generation);
    for (let tick = 0; tick < 100 && !controller.recognitionTerminal; tick += 1) {
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    assert.equal(controller.recognitionTerminal, true);
    assert.equal(controller.recognition, null);
    assert.equal(controller.microphoneStream, null);
    assert.equal(initialTrack.stopped, true);
    assert.ok(
      actions.some(
        (action) =>
          action.sensor === "speech" &&
          action.status === "unavailable" &&
          action.reason === "restart-exhausted",
      ),
    );
    assert.ok(
      actions.some(
        (action) =>
          action.sensor === "microphone" &&
          action.status === "unavailable",
      ),
    );
    assert.match(captions.at(-1), /parity, then retry explicitly/);

    failStart = false;
    assert.equal(await controller.enableMicrophone(), true);
    assert.equal(controller.recognitionTerminal, false);
    assert.equal(controller.recognitionRetries, 0);
    assert.equal(controller.recognitionTransientFailures, 0);
    assert.equal(controller.microphoneStream, replacementStream);
    assert.equal(replacementTrack.stopped, false);
    assert.equal(
      actions.at(-1).sensor,
      "speech",
    );
    assert.equal(actions.at(-1).status, "active");
  } finally {
    controller.stop("explicit-recognition-recovery-test");
    if (originalRecognition) {
      Object.defineProperty(
        globalThis,
        "SpeechRecognition",
        originalRecognition,
      );
    } else {
      delete globalThis.SpeechRecognition;
    }
    if (originalNavigator) {
      Object.defineProperty(globalThis, "navigator", originalNavigator);
    } else {
      delete globalThis.navigator;
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

test("progressive microphone then front-camera grants share one guarded lifecycle", async () => {
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const originalRecognition = Object.getOwnPropertyDescriptor(
    globalThis,
    "SpeechRecognition",
  );
  const constraints = [];
  const audioTrack = {
    kind: "audio",
    stopped: false,
    stop() {
      this.stopped = true;
    },
    addEventListener() {},
  };
  const videoTrack = {
    kind: "video",
    stopped: false,
    stop() {
      this.stopped = true;
    },
    addEventListener() {},
    getSettings() {
      return { facingMode: "user" };
    },
  };
  const audioStream = { getTracks: () => [audioTrack] };
  const videoStream = {
    getTracks: () => [videoTrack],
    getVideoTracks: () => [videoTrack],
  };
  class Recognition {
    start() {
      this.onstart?.();
    }

    abort() {}
  }
  Object.defineProperty(globalThis, "SpeechRecognition", {
    configurable: true,
    value: Recognition,
  });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      mediaDevices: {
        async getUserMedia(request) {
          constraints.push(request);
          return request.video ? videoStream : audioStream;
        },
      },
    },
  });
  const video = {
    dataset: {},
    srcObject: null,
    async play() {},
    pause() {},
    setAttribute() {},
  };
  const controller = new AdaptiveSensorController({
    video,
    clock: () => 10,
  });
  try {
    assert.equal(await controller.enableMicrophone(), true);
    const generation = controller.lifecycleGeneration;
    assert.equal(controller.streams.size, 1);
    assert.equal(controller.cameraStream, null);
    assert.equal(await controller.enableCamera(), true);
    assert.equal(controller.lifecycleGeneration, generation);
    assert.equal(controller.streams.size, 2);
    assert.equal(video.dataset.mirrored, "true");
    assert.equal(constraints[0].video, false);
    assert.equal(constraints[0].audio.echoCancellation, true);
    assert.equal(constraints[0].audio.noiseSuppression, true);
    assert.equal(constraints[0].audio.autoGainControl, true);
    assert.equal(constraints[1].audio, false);
    assert.equal(constraints[1].video.facingMode.ideal, "user");

    controller.stop("progressive-test");
    assert.equal(audioTrack.stopped, true);
    assert.equal(videoTrack.stopped, true);
    assert.equal(controller.streams.size, 0);
    assert.equal(controller.microphoneStream, null);
    assert.equal(controller.cameraStream, null);
    assert.equal(video.srcObject, null);
  } finally {
    controller.stop("progressive-test-finally");
    if (originalNavigator) {
      Object.defineProperty(globalThis, "navigator", originalNavigator);
    } else {
      delete globalThis.navigator;
    }
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

test("ended camera tracks are released and retry reacquires before recovery", async () => {
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const actions = [];
  const streams = [];
  let requests = 0;
  function makeCameraStream() {
    const listeners = new Map();
    const track = {
      kind: "video",
      readyState: "live",
      stopped: false,
      addEventListener(type, listener) {
        listeners.set(type, listener);
      },
      getSettings() {
        return { facingMode: "user" };
      },
      stop() {
        this.stopped = true;
        this.readyState = "ended";
      },
      end() {
        this.readyState = "ended";
        stream.active = false;
        listeners.get("ended")?.();
      },
    };
    const stream = {
      active: true,
      getTracks: () => [track],
      getVideoTracks: () => [track],
    };
    streams.push({ stream, track });
    return stream;
  }
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      mediaDevices: {
        async getUserMedia() {
          requests += 1;
          return makeCameraStream();
        },
      },
    },
  });
  const video = {
    dataset: {},
    srcObject: null,
    async play() {},
    pause() {},
  };
  const machine = new AdaptiveOrbMachine({ clock: () => 40 });
  machine.dispatch({
    type: "START",
    kind: "accessible",
    generation: 1,
    at: 0,
  });
  const controller = new AdaptiveSensorController({
    video,
    clock: () => 40,
    onAction: (action) => {
      actions.push(action);
      return machine.dispatch(action);
    },
  });
  try {
    assert.equal(await controller.enableCamera(), true);
    assert.equal(requests, 1);
    assert.equal(streamHasLiveTrack(controller.cameraStream, "video"), true);
    streams[0].track.end();
    assert.equal(streams[0].track.stopped, true);
    assert.equal(controller.cameraStream, null);
    assert.equal(controller.stream, null);
    assert.equal(video.srcObject, null);
    assert.equal(streamHasLiveTrack(streams[0].stream, "video"), false);
    assert.ok(machine.state.freezeCauses.includes("camera-lost"));
    assert.ok(machine.state.freezeCauses.includes("content-invalid"));
    assert.ok(
      actions.some(
        (action) =>
          action.type === "SENSOR_LOSS" && action.cause === "camera-lost",
      ),
    );
    assert.equal(await controller.enableCamera(), true);
    assert.equal(requests, 2);
    assert.notEqual(controller.cameraStream, streams[0].stream);
    assert.equal(streamHasLiveTrack(controller.cameraStream, "video"), true);
    assert.equal(machine.state.freezeCauses.includes("camera-lost"), false);
    assert.ok(machine.state.freezeCauses.includes("content-invalid"));
    const lossAt = actions.findLastIndex(
      (action) =>
        action.type === "SENSOR_LOSS" && action.cause === "camera-lost",
    );
    const recoveryAt = actions.findLastIndex(
      (action) =>
        action.type === "SENSOR_STATUS" &&
        action.sensor === "camera" &&
        action.status === "active",
    );
    assert.ok(recoveryAt > lossAt);
  } finally {
    controller.stop("ended-track-test");
    if (originalNavigator) {
      Object.defineProperty(globalThis, "navigator", originalNavigator);
    } else {
      delete globalThis.navigator;
    }
  }
});

test("terminal speech denial stops separately granted microphone capture", async () => {
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const originalRecognition = Object.getOwnPropertyDescriptor(
    globalThis,
    "SpeechRecognition",
  );
  const track = {
    kind: "audio",
    stopped: false,
    stop() {
      this.stopped = true;
    },
    addEventListener() {},
  };
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
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      mediaDevices: {
        async getUserMedia() {
          return { getTracks: () => [track] };
        },
      },
    },
  });
  const actions = [];
  const controller = new AdaptiveSensorController({
    video: null,
    clock: () => 15,
    onAction: (action) => actions.push(action),
  });
  try {
    assert.equal(await controller.enableMicrophone(), false);
    assert.equal(track.stopped, true);
    assert.equal(controller.microphoneStream, null);
    assert.equal(controller.streams.size, 0);
    assert.ok(
      actions.some(
        (action) =>
          action.type === "SENSOR_STATUS" &&
          action.sensor === "microphone" &&
          action.status === "denied",
      ),
    );
  } finally {
    controller.stop("speech-denial-test");
    if (originalNavigator) {
      Object.defineProperty(globalThis, "navigator", originalNavigator);
    } else {
      delete globalThis.navigator;
    }
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

test("camera denial does not restart or discard an already granted microphone", async () => {
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const originalRecognition = Object.getOwnPropertyDescriptor(
    globalThis,
    "SpeechRecognition",
  );
  let cameraRequests = 0;
  const audioTrack = {
    kind: "audio",
    stopped: false,
    stop() {
      this.stopped = true;
    },
    addEventListener() {},
  };
  const audioStream = { getTracks: () => [audioTrack] };
  class Recognition {
    start() {
      this.onstart?.();
    }

    abort() {}
  }
  Object.defineProperty(globalThis, "SpeechRecognition", {
    configurable: true,
    value: Recognition,
  });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      mediaDevices: {
        async getUserMedia(request) {
          if (request.video) {
            cameraRequests += 1;
            const error = new Error("denied");
            error.name = "NotAllowedError";
            throw error;
          }
          return audioStream;
        },
      },
    },
  });
  const actions = [];
  const controller = new AdaptiveSensorController({
    video: null,
    clock: () => 20,
    onAction: (action) => actions.push(action),
  });
  try {
    assert.equal(await controller.enableMicrophone(), true);
    assert.equal(await controller.enableCamera(), false);
    assert.equal(cameraRequests, 1);
    assert.equal(audioTrack.stopped, false);
    assert.equal(controller.microphoneStream, audioStream);
    assert.equal(controller.streams.has(audioStream), true);
    assert.equal(
      actions.filter(
        (action) =>
          action.type === "SENSOR_STATUS" &&
          action.sensor === "camera" &&
          action.status === "denied",
      ).length,
      1,
    );
    controller.stop("camera-denial-test");
    assert.equal(audioTrack.stopped, true);
  } finally {
    if (originalNavigator) {
      Object.defineProperty(globalThis, "navigator", originalNavigator);
    } else {
      delete globalThis.navigator;
    }
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

test("late progressive permission resolution is stopped after interruption teardown", async () => {
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  let resolvePermission;
  const permission = new Promise((resolve) => {
    resolvePermission = resolve;
  });
  const track = {
    kind: "audio",
    stopped: false,
    stop() {
      this.stopped = true;
    },
    addEventListener() {},
  };
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      mediaDevices: {
        getUserMedia: () => permission,
      },
    },
  });
  const controller = new AdaptiveSensorController({
    video: null,
    clock: () => 30,
  });
  try {
    const requested = controller.enableMicrophone();
    controller.stop("background-interruption");
    resolvePermission({ getTracks: () => [track] });
    assert.equal(await requested, false);
    assert.equal(track.stopped, true);
    assert.equal(controller.streams.size, 0);
  } finally {
    if (originalNavigator) {
      Object.defineProperty(globalThis, "navigator", originalNavigator);
    } else {
      delete globalThis.navigator;
    }
  }
});
