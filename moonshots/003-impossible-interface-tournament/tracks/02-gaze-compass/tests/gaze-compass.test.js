"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const Core = require("../core.js");
const trackRoot = path.resolve(__dirname, "..");

function repeated(point, count = 8) {
  return Array.from({ length: count }, (_, index) => {
    const jitter = ((index % 3) - 1) * 0.0005;
    return {
      x: point.x + jitter,
      y: point.y - jitter,
      confidence: 0.95,
    };
  });
}

function hold(controller, point, startAt, duration = 900, context) {
  for (let elapsed = 0; elapsed <= duration; elapsed += 100) {
    controller.update({ ...point, confidence: 0.95 }, startAt + elapsed, context);
  }
}

test("timed center-plus-radial calibration maps a rotated sensor basis", () => {
  const center = { x: 0.51, y: 0.48 };
  const horizontal = { x: 0.2, y: 0.035 };
  const vertical = { x: -0.025, y: 0.19 };
  const captures = {
    center: repeated(center),
    north: repeated({ x: center.x - vertical.x, y: center.y - vertical.y }),
    east: repeated({ x: center.x + horizontal.x, y: center.y + horizontal.y }),
    south: repeated({ x: center.x + vertical.x, y: center.y + vertical.y }),
    west: repeated({ x: center.x - horizontal.x, y: center.y - horizontal.y }),
  };
  const model = Core.fitCalibration(captures);

  const mappedEast = Core.mapCalibratedPoint(model, {
    x: center.x + horizontal.x,
    y: center.y + horizontal.y,
    confidence: 1,
  });
  const mappedNorth = Core.mapCalibratedPoint(model, {
    x: center.x - vertical.x,
    y: center.y - vertical.y,
    confidence: 1,
  });

  assert.ok(Math.abs(mappedEast.x - 1) < 0.02);
  assert.ok(Math.abs(mappedEast.y) < 0.02);
  assert.ok(Math.abs(mappedNorth.x) < 0.02);
  assert.ok(Math.abs(mappedNorth.y + 1) < 0.02);
  assert.ok(model.quality > 0.8);

  const sequence = new Core.TimedCalibration({ settleMs: 100, captureMs: 400 });
  sequence.start(0);
  assert.equal(sequence.status(0).target, "center");
  assert.equal(sequence.status(500).target, "north");
  assert.equal(sequence.status(1000).target, "east");
  assert.equal(sequence.status(sequence.totalMs).done, true);
});

test("sector math enforces center, dead zone, confidence pause, and angular hysteresis", () => {
  assert.equal(Core.sectorForPoint({ x: 0.1, y: 0.1, confidence: 1 }), "center");
  assert.equal(Core.sectorForPoint({ x: 0.31, y: 0, confidence: 1 }), "dead");
  assert.equal(Core.sectorForPoint({ x: 0.8, y: 0, confidence: 1 }), "east");
  assert.equal(Core.sectorForPoint({ x: 0, y: 0.8, confidence: 1 }), "south");
  assert.equal(Core.sectorForPoint({ x: -0.8, y: 0, confidence: 1 }), "west");
  assert.equal(Core.sectorForPoint({ x: 0, y: -0.8, confidence: 1 }), "north");
  assert.equal(Core.sectorForPoint({ x: 0.8, y: 0, confidence: 0.2 }), "pause");

  const nearBoundary = {
    x: Math.cos((-38 * Math.PI) / 180) * 0.8,
    y: Math.sin((-38 * Math.PI) / 180) * 0.8,
    confidence: 1,
  };
  const beyondHysteresis = {
    x: Math.cos((-28 * Math.PI) / 180) * 0.8,
    y: Math.sin((-28 * Math.PI) / 180) * 0.8,
    confidence: 1,
  };
  assert.equal(Core.sectorForPoint(nearBoundary, "north"), "north");
  assert.equal(Core.sectorForPoint(beyondHysteresis, "north"), "east");
});

test("returning to center cancels dwell and blocks a later confirmation", () => {
  const executions = [];
  const controller = new Core.GazeIntentController({
    dwellMs: 800,
    onExecute: (...args) => executions.push(args),
  });

  hold(controller, Core.DIRECTION_POINTS.east, 0, 900);
  assert.equal(controller.snapshot().armed, true);
  controller.update({ ...Core.DIRECTION_POINTS.center, confidence: 1 }, 1000);

  assert.equal(controller.snapshot().state, "rest");
  assert.equal(controller.snapshot().armed, false);
  assert.equal(controller.confirm("voice", 1100), false);
  assert.equal(executions.length, 0);
  assert.equal(controller.metrics.executions, 0);
  assert.equal(controller.metrics.dwellCancellations, 1);
});

test("dwell never commits by itself and sensor loss requires center recovery", () => {
  const executions = [];
  const controller = new Core.GazeIntentController({
    dwellMs: 800,
    sensorTimeoutMs: 700,
    onExecute: (direction, source) => executions.push({ direction, source }),
  });

  hold(controller, Core.DIRECTION_POINTS.north, 0, 900);
  assert.equal(controller.snapshot().armed, true);
  assert.equal(executions.length, 0, "gaze-only dwell must not execute");

  controller.check(1700);
  assert.equal(controller.snapshot().centerReason, "sensor-loss");
  assert.equal(controller.confirm("gesture", 1710), false);
  controller.update({ ...Core.DIRECTION_POINTS.north, confidence: 1 }, 1800);
  assert.equal(controller.snapshot().state, "recovering");
  controller.update({ ...Core.DIRECTION_POINTS.center, confidence: 1 }, 1900);
  assert.equal(controller.metrics.sensorRecoveries, 1);

  hold(controller, Core.DIRECTION_POINTS.north, 2000, 900);
  assert.equal(executions.length, 0);
  assert.equal(controller.confirm("gesture", 3000), true);
  assert.deepEqual(executions, [{ direction: "north", source: "gesture" }]);
  assert.equal(controller.metrics.falseCommits, 0);
});

test("confidence loss revokes an armed candidate until a full confident re-dwell", () => {
  const executions = [];
  const controller = new Core.GazeIntentController({
    dwellMs: 800,
    onExecute: (direction) => executions.push(direction),
  });

  hold(controller, Core.DIRECTION_POINTS.south, 0, 900);
  assert.equal(controller.snapshot().armed, true);
  controller.update({ ...Core.DIRECTION_POINTS.south, confidence: 0.1 }, 1000);

  assert.equal(controller.snapshot().state, "confidence-pause");
  assert.equal(controller.snapshot().armed, false);
  assert.equal(controller.snapshot().sector, null);
  assert.equal(controller.metrics.confidenceRevocations, 1);
  assert.equal(controller.confirm("voice", 1010), false);
  controller.update({ ...Core.DIRECTION_POINTS.south, confidence: 0.95 }, 1100);
  assert.equal(controller.snapshot().armed, false);
  assert.equal(executions.length, 0);

  hold(controller, Core.DIRECTION_POINTS.south, 1200, 900);
  assert.equal(controller.snapshot().armed, true);
  assert.equal(controller.confirm("voice", 2200), true);
  assert.deepEqual(executions, ["south"]);

  const app = fs.readFileSync(path.join(trackRoot, "app.js"), "utf8");
  assert.match(app, /confidence: point\.confidence/);
});

test("frame freshness gate rejects frozen pixels and cannot arm from stale samples", () => {
  const gate = new Core.VideoFrameFreshnessGate({ timeoutMs: 700 });
  const controller = new Core.GazeIntentController({
    dwellMs: 800,
    sensorTimeoutMs: 700,
  });
  gate.start(0);

  const first = gate.observe({ presentedFrames: 1, mediaTime: 0 }, 0);
  assert.equal(first.fresh, true);
  if (first.fresh) {
    controller.update({ ...Core.DIRECTION_POINTS.east, confidence: 0.95 }, 0);
  }
  for (const now of [100, 200, 300, 400, 500, 600]) {
    const repeatedFrame = gate.observe({ presentedFrames: 1, mediaTime: 0 }, now);
    assert.equal(repeatedFrame.fresh, false);
  }
  const frozen = gate.observe({ presentedFrames: 1, mediaTime: 0 }, 700);
  assert.equal(frozen.frozen, true);
  assert.equal(frozen.justFrozen, true);
  controller.check(700);

  assert.equal(controller.snapshot().centerReason, "sensor-loss");
  assert.equal(controller.snapshot().armed, false);
  assert.equal(controller.confirm("voice", 710), false);
  assert.equal(controller.lastGoodAt, 0);

  const resumed = gate.observe({ presentedFrames: 2, mediaTime: 0.04 }, 800);
  assert.equal(resumed.fresh, true);
  assert.equal(resumed.resumed, true);

  const currentTimeGate = new Core.VideoFrameFreshnessGate({ timeoutMs: 700 });
  currentTimeGate.start(0);
  assert.equal(currentTimeGate.observe({ currentTime: 1 }, 0).fresh, true);
  assert.equal(currentTimeGate.observe({ currentTime: 1 }, 100).fresh, false);
  assert.equal(currentTimeGate.observe({ currentTime: 1.04 }, 200).fresh, true);
});

test("stale sensor-derived arms are atomically rejected before watchdog execution", () => {
  const executions = [];
  const staleController = new Core.GazeIntentController({
    dwellMs: 800,
    sensorTimeoutMs: 2000,
    onExecute: (direction) => executions.push(direction),
  });
  hold(
    staleController,
    Core.DIRECTION_POINTS.west,
    0,
    900,
    { source: "sensor" },
  );
  assert.equal(staleController.snapshot().armedSource, "sensor");
  const rawFrames = new Core.VideoFrameFreshnessGate({ timeoutMs: 1100 });
  rawFrames.start(0);
  for (let now = 0, frame = 1; now <= 1200; now += 100, frame += 1) {
    rawFrames.observe({ presentedFrames: frame }, now);
  }
  assert.equal(rawFrames.isFresh(1200), true, "raw video is still advancing");
  assert.equal(
    Core.isTimestampFresh(0, 1200, 1100),
    false,
    "processed gaze stalled despite fresh raw frames",
  );
  assert.equal(
    staleController.confirm("voice", 1200, {
      sensorFresh:
        rawFrames.isFresh(1200) &&
        Core.isTimestampFresh(0, 1200, 1100),
    }),
    false,
  );
  assert.equal(staleController.snapshot().centerReason, "sensor-loss");
  assert.equal(staleController.metrics.staleSensorConfirmations, 1);
  assert.equal(staleController.metrics.sensorLosses, 1);
  assert.equal(executions.length, 0);

  const freshController = new Core.GazeIntentController({
    dwellMs: 800,
    onExecute: (direction) => executions.push(direction),
  });
  hold(
    freshController,
    Core.DIRECTION_POINTS.west,
    0,
    900,
    { source: "sensor" },
  );
  assert.equal(
    freshController.confirm("voice", 950, { sensorFresh: true }),
    true,
  );
  assert.deepEqual(executions, ["west"]);

  const app = fs.readFileSync(path.join(trackRoot, "app.js"), "utf8");
  assert.match(
    app,
    /switchToFallback\("FaceDetector processing timeout"\)/,
  );
  assert.match(
    app,
    /estimatorGeneration !== this\.estimatorGeneration/,
  );
  assert.match(
    app,
    /const sensorFresh =[\s\S]*?\(rawFrameFresh && processedGazeFresh\)/,
  );
});

test("nod detector requires a complete gesture epoch after each arm begins", () => {
  const nod = new Core.NodDetector({ threshold: 0.2, minReversalMs: 90 });
  assert.equal(nod.update(0, 1, 0), false);
  assert.equal(nod.update(0.3, 1, 100), false);

  nod.beginArm();
  assert.equal(nod.update(0, 1, 200), false);
  assert.equal(nod.update(0.25, 1, 320), false);
  nod.endArm();
  nod.beginArm();
  assert.equal(nod.update(0, 1, 400), false);
  assert.equal(nod.update(0, 1, 520), false);
  assert.equal(nod.update(0.25, 1, 640), false);
  assert.equal(nod.update(0, 1, 780), true);
  assert.equal(nod.active, false);

  const app = fs.readFileSync(path.join(trackRoot, "app.js"), "utf8");
  assert.match(app, /onArm\(direction\) \{\s*state\.nodDetector\.beginArm\(\)/);
  assert.ok((app.match(/state\.nodDetector\.endArm\(\)/g) || []).length >= 8);
});

test("voice values guide a sector while only explicit confirm is a commit command", () => {
  const quantity = Core.TASK_STEPS.find((step) => step.id === "quantity");
  const value = Core.parseVoiceCommand("route three cobalt beacons", quantity);
  const confirmation = Core.parseVoiceCommand("confirm", quantity);
  const stop = Core.parseVoiceCommand("stop now", quantity);

  assert.equal(value.type, "value");
  assert.equal(value.option.id, "three");
  assert.equal(value.option.direction, "east");
  assert.equal(confirmation.type, "confirm");
  assert.equal(stop.type, "stop");
});

test("strict confirm grammar rejects negated and contextual phrases", () => {
  const step = Core.TASK_STEPS[0];
  for (const phrase of ["confirm", "yes confirm", "confirm choice", "approve", "approve choice"]) {
    assert.equal(Core.parseVoiceCommand(phrase, step).type, "confirm", phrase);
  }
  for (const phrase of [
    "do not confirm",
    "cannot approve",
    "please confirm",
    "confirm later",
    "they said confirm",
    "can you approve",
    "not confirm",
  ]) {
    assert.equal(Core.parseVoiceCommand(phrase, step).type, "rejected-confirm", phrase);
  }
});

test("global confirm keys are ignored on native interactive controls", () => {
  assert.equal(Core.shouldHandleGlobalConfirmKey("Enter", false), true);
  assert.equal(Core.shouldHandleGlobalConfirmKey(" ", false), true);
  assert.equal(Core.shouldHandleGlobalConfirmKey("Enter", true), false);
  assert.equal(Core.shouldHandleGlobalConfirmKey(" ", true), false);
  assert.equal(Core.shouldHandleGlobalConfirmKey("Escape", false), false);

  const app = fs.readFileSync(path.join(trackRoot, "app.js"), "utf8");
  assert.match(app, /function isNativeInteractiveTarget\(target\)/);
  assert.match(app, /target\.closest\(\s*"button, a\[href\], input, select, textarea/);
  assert.match(
    app,
    /if \(!Core\.shouldHandleGlobalConfirmKey\(event\.key, interactiveTarget\)\) return;/,
  );
});

test("completion-aware undo removes the final choice in one operation", () => {
  const task = new Core.TaskModel();
  for (const step of Core.TASK_STEPS) {
    const expected = step.options.find((option) => option.id === step.expected);
    task.choose(expected.direction, "voice", task.stepIndex * 1000);
  }
  task.returnHome();
  assert.equal(task.isExactComplete(), true);

  assert.equal(task.undo(), true);
  const snapshot = task.snapshot();
  assert.equal(snapshot.home, false);
  assert.equal(snapshot.routeCommitted, false);
  assert.equal(snapshot.exactComplete, false);
  assert.equal(snapshot.stepIndex, Core.TASK_STEPS.length - 1);
  assert.equal(snapshot.selections.release, undefined);
  assert.equal(task.currentStep().id, "release");

  const app = fs.readFileSync(path.join(trackRoot, "app.js"), "utf8");
  assert.equal((app.match(/state\.task\.undo\(\)/g) || []).length, 1);
  assert.match(app, /undoLastChoice\("voice"\)/);
  assert.match(app, /undoLastChoice\("keyboard"\)/);
  assert.match(app, /elements\.completionBanner\.classList\.add\("is-hidden"\)/);
});

test("startup cleanup releases acquired media before parity fallback", () => {
  const app = fs.readFileSync(path.join(trackRoot, "app.js"), "utf8");
  assert.match(
    app,
    /catch \(error\) \{[\s\S]*?stopSensorLifecycle\(\);\s*releaseMediaResources\(\{ markSensorLoss: false \}\);\s*enterParityOnlyMode/,
  );
  assert.match(app, /function releaseMediaResources\(options\)[\s\S]*state\.visionSensor\.stop\(\)/);
  assert.match(app, /window\.clearInterval\(state\.monitorTimer\)/);
  assert.match(app, /window\.clearTimeout\(state\.calibrationRetryTimer\)/);
  assert.match(app, /const stream = state\.stream;\s*state\.stream = null/);
  assert.match(app, /tracks = stream\.getTracks\(\)/);
  assert.match(app, /for \(const track of tracks\)[\s\S]*track\.stop\(\)/);
  assert.match(app, /elements\.cameraPreview\.srcObject = null/);
});

test("sensor lifecycle generation disposes late streams and End Sensors enables parity", () => {
  const app = fs.readFileSync(path.join(trackRoot, "app.js"), "utf8");
  assert.match(app, /sensorGeneration: 0/);
  assert.match(app, /sensorsStopped: true/);
  assert.match(
    app,
    /const generation = beginSensorLifecycle\(\);\s*let acquiredStream = null/,
  );
  assert.match(
    app,
    /acquiredStream = await navigator\.mediaDevices\.getUserMedia[\s\S]*if \(!isCurrentSensorLifecycle\(generation\)\) \{\s*disposeDetachedStream\(acquiredStream\);\s*return;/,
  );
  assert.match(
    app,
    /function stopSensors\(\) \{\s*stopSensorLifecycle\(\);[\s\S]*enterParityOnlyMode\(/,
  );
  assert.match(
    app,
    /function enterParityOnlyMode\(message\) \{\s*state\.sensorsStopped = true;\s*state\.paused = false;/,
  );
  assert.match(app, /if \(!state\.controller\) buildController\(\)/);
});

test("parity and center resume voice-paused input and clear calibration overlay", () => {
  const app = fs.readFileSync(path.join(trackRoot, "app.js"), "utf8");
  assert.match(
    app,
    /function enterParityOnlyMode\(message\) \{\s*state\.sensorsStopped = true;\s*state\.paused = false;/,
  );
  assert.match(
    app,
    /function centerAction\(source\) \{[\s\S]*?const resumedFromPause = state\.paused;\s*state\.paused = false;/,
  );
  assert.match(
    app,
    /function resetCalibrationOverlay\(\) \{\s*elements\.calibrationLayer\.classList\.add\("is-hidden"\)/,
  );
  assert.match(
    app,
    /function releaseMediaResources\(options\)[\s\S]*?resetCalibrationOverlay\(\)/,
  );
  assert.match(
    app,
    /function enterParityOnlyMode\(message\)[\s\S]*?resetCalibrationOverlay\(\)/,
  );
});

test("calibration lifecycle closes every attempt without stale duration or quality", () => {
  assert.equal(Core.closedIntervalDuration(null, 1000), 0);
  assert.equal(Core.closedIntervalDuration(1000, null), 0);
  assert.equal(Core.closedIntervalDuration(1000, 900), 0);
  assert.equal(Core.closedIntervalDuration(1000, 1650), 650);

  const app = fs.readFileSync(path.join(trackRoot, "app.js"), "utf8");
  assert.match(
    app,
    /function beginCalibrationLifecycle\(now\) \{[\s\S]*?state\.calibrationEndedAt = null;[\s\S]*?state\.calibrationModel = null;[\s\S]*?state\.calibrationQuality = null;/,
  );
  assert.match(
    app,
    /finalizeCalibrationLifecycle\("complete", now, model, false\)/,
  );
  assert.match(app, /finalizeCalibrationLifecycle\("retrying", now, null, false\)/);
  assert.match(app, /finalizeCalibrationLifecycle\("failed", now, null, false\)/);
  assert.match(
    app,
    /finalizeCalibrationLifecycle\("frozen", performance\.now\(\), null, false\)/,
  );
  assert.match(
    app,
    /finalizeCalibrationLifecycle\(\s*"shutdown",\s*performance\.now\(\)/,
  );
  assert.match(
    app,
    /Core\.closedIntervalDuration\(\s*state\.calibrationStartedAt,\s*state\.calibrationEndedAt/,
  );
  assert.doesNotMatch(
    app,
    /state\.calibrationEndedAt \|\| now/,
  );
});

test("controller metrics aggregate across rebuild epochs while task progress continues", () => {
  const task = new Core.TaskModel();
  const controllers = [];
  let now = 0;
  const buildEpoch = () => {
    const controller = new Core.GazeIntentController({
      dwellMs: 800,
      onExecute(direction, source, confirmedAt) {
        task.choose(direction, source, confirmedAt);
      },
    });
    controllers.push(controller);
    return controller;
  };
  const executeCurrentStep = (controller, source) => {
    const step = task.currentStep();
    const expected = step.options.find((option) => option.id === step.expected);
    hold(
      controller,
      Core.DIRECTION_POINTS[expected.direction],
      now,
      900,
      { source: "simulation" },
    );
    now += 1000;
    assert.equal(controller.confirm(source, now), true);
    now += 100;
    controller.update(
      { ...Core.DIRECTION_POINTS.center, confidence: 1 },
      now,
      { source: "simulation" },
    );
    now += 100;
  };

  const firstEpoch = buildEpoch();
  executeCurrentStep(firstEpoch, "voice");
  executeCurrentStep(firstEpoch, "gesture");
  executeCurrentStep(firstEpoch, "voice");
  firstEpoch.markSensorLost(now, "recalibration");
  now += 100;
  firstEpoch.update(
    { ...Core.DIRECTION_POINTS.center, confidence: 1 },
    now,
    { source: "simulation" },
  );
  now += 100;
  assert.equal(firstEpoch.confirm("voice", now), false);

  const secondEpoch = buildEpoch();
  executeCurrentStep(secondEpoch, "gesture");
  executeCurrentStep(secondEpoch, "voice");
  executeCurrentStep(secondEpoch, "gesture");
  executeCurrentStep(secondEpoch, "voice");
  assert.equal(secondEpoch.confirm("voice", now), false);
  task.returnHome();

  const merged = Core.mergeControllerMetrics(
    ...controllers.map((controller) => controller.metrics),
  );
  assert.equal(task.isExactComplete(), true);
  assert.equal(merged.explicitConfirmations, 7);
  assert.equal(merged.executions, 7);
  assert.equal(merged.sensorLosses, 1);
  assert.equal(merged.sensorRecoveries, 1);
  assert.equal(merged.blockedConfirmations, 2);
  assert.deepEqual(merged.confirmationSources, { voice: 4, gesture: 3 });

  const app = fs.readFileSync(path.join(trackRoot, "app.js"), "utf8");
  assert.match(
    app,
    /function buildController\(\) \{\s*archiveCurrentControllerMetrics\(\)/,
  );
  assert.match(app, /const metrics = combinedControllerMetrics\(\)/);
  assert.match(app, /controllerEpochs: state\.controllerEpochs/);
});

test("raw-frame watchdog ignores controller suppression and suspends for manual or completion", () => {
  const app = fs.readFileSync(path.join(trackRoot, "app.js"), "utf8");
  const monitor = app.match(
    /function monitorSensor\(\) \{([\s\S]*?)\n  \}\n\n  function shouldRunSensorWatchdog/,
  )[1];
  assert.match(monitor, /state\.visionSensor\.checkFreshness\(now\)/);
  assert.doesNotMatch(monitor, /controller\.check/);
  assert.match(
    app,
    /function shouldRunSensorWatchdog\(now\)[\s\S]*!state\.completed[\s\S]*now >= state\.manualOverrideUntil/,
  );
  assert.match(app, /onFreshFrame\(now\) \{\s*state\.lastRawFrameAt = now/);
  assert.match(
    app,
    /state\.visionSensor\.isFresh\(now\)[\s\S]*isProcessedGazeFresh\(now\)[\s\S]*controller\.confirm\(source, now, \{ sensorFresh \}\)/,
  );
  assert.match(
    app,
    /state\.visionSensor\.isFresh\(now\) &&\s*processedGazeHasTimedOut\(now\)/,
  );
});

test("sensor timing continues through export and is finalized on stop", () => {
  assert.equal(Core.sensorOnDuration(250, 1000, 1600), 850);
  assert.equal(Core.sensorOnDuration(850, null, 2200), 850);
  assert.equal(Core.sensorOnDuration(0, 2000, 1500), 0);
  assert.equal(Core.completionDuration(1000, 1650, 5000), 650);
  assert.equal(Core.completionDuration(1000, 1650, 9000), 650);

  const app = fs.readFileSync(path.join(trackRoot, "app.js"), "utf8");
  assert.match(
    app,
    /function metricsForExport\(\)[\s\S]*refreshMetricSensorCounters\(\)/,
  );
  assert.match(app, /function downloadMetrics\(\) \{\s*const metrics = metricsForExport\(\)/);
  assert.match(
    app,
    /state\.completedAt = performance\.now\(\);[\s\S]*buildLiveMetrics\(state\.completedAt\)/,
  );
  assert.match(app, /finalizeCameraOnTime\(performance\.now\(\)\)/);
  assert.match(app, /finalizeMicrophoneOnTime\(performance\.now\(\)\)/);
  const exportRefresh = app.match(
    /function refreshMetricSensorCounters\(\) \{([\s\S]*?)\n  \}\n\n  function downloadMetrics/,
  )[1];
  assert.match(exportRefresh, /privacyTiming\(performance\.now\(\)\)/);
  assert.doesNotMatch(exportRefresh, /completionMs|buildLiveMetrics/);
});

test("deterministic simulation completes the exact cobalt-beacon task identically", () => {
  const first = Core.runDeterministicSimulation();
  const second = Core.runDeterministicSimulation();

  assert.deepEqual(first, second);
  assert.equal(first.exactTaskCompletion, true);
  assert.deepEqual(first.route, {
    verb: "route",
    beaconCount: 3,
    beaconColor: "cobalt",
    departure: "14:30",
    handling: "fragile",
    destination: "ORION-7",
    gate: "North Gate",
    confirmed: true,
    returnedHome: true,
  });
  assert.equal(first.safety.falseCommits, 0);
  assert.equal(first.safety.gazeOnlyExecutions, 0);
  assert.equal(first.safety.blockedConfirmations, 2);
  assert.equal(first.safety.confidencePauses, 1);
  assert.equal(first.safety.confidenceRevocations, 1);
  assert.equal(first.safety.staleSensorConfirmations, 1);
  assert.equal(first.safety.sensorLosses, 1);
  assert.equal(first.safety.sensorRecoveries, 1);
  assert.equal(first.interaction.explicitConfirmations, Core.TASK_STEPS.length);
  assert.deepEqual(first.interaction.confirmationSources, { voice: 4, gesture: 3 });
  assert.match(first.deterministicFingerprint, /^[a-f0-9]{8}$/);
});

test("privacy validator finds no network client, recording, or durable frame storage", () => {
  const index = fs.readFileSync(path.join(trackRoot, "index.html"), "utf8");
  const app = fs.readFileSync(path.join(trackRoot, "app.js"), "utf8");
  const core = fs.readFileSync(path.join(trackRoot, "core.js"), "utf8");
  const executable = `${index}\n${app}\n${core}`;
  const prohibited = [
    /\bfetch\s*\(/,
    /\bXMLHttpRequest\b/,
    /\bWebSocket\b/,
    /\bEventSource\b/,
    /\bsendBeacon\b/,
    /\bMediaRecorder\b/,
    /\.toDataURL\s*\(/,
    /\.toBlob\s*\(/,
    /\blocalStorage\b/,
    /\bsessionStorage\b/,
    /\bindexedDB\b/,
  ];

  for (const pattern of prohibited) {
    assert.doesNotMatch(executable, pattern);
  }
  assert.match(index, /connect-src 'none'/);
  assert.doesNotMatch(index, /(?:src|href)=["']https?:\/\//);
  assert.match(app, /navigator\.mediaDevices\.getUserMedia/);
  assert.match(app, /FaceDetector/);
  assert.match(app, /frame-motion head-pose fallback/);
  assert.match(app, /requestVideoFrameCallback/);
  assert.match(app, /VideoFrameFreshnessGate/);
  assert.match(app, /clearRect/);
  assert.match(index, /Frames ephemeral/);
  assert.match(index, /coarse webcam gaze estimate/i);
});

test("Clawpilot theme, local assets, and input parity are present", () => {
  const index = fs.readFileSync(path.join(trackRoot, "index.html"), "utf8");
  const scriptBodies = [...index.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(
    (match) => match[1],
  );
  assert.match(scriptBodies[0], /scoutTheme/);
  assert.match(scriptBodies[0], /document\.documentElement\.setAttribute\("data-theme", theme\)/);

  const requiredThemeTokens = [
    "--cp-bg: #f7f4ef",
    "--cp-surface: #ffffff",
    "--cp-accent: #b11f4b",
    "--cp-text: #242424",
    "--cp-bg: #3d3b3a",
    "--cp-accent: #fd8ea1",
    "--cp-panel-strong:",
    "--cp-highlight:",
  ];
  for (const token of requiredThemeTokens) assert.match(index, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

  const style = index.match(/<style>([\s\S]*?)<\/style>/)[1];
  const withoutThemeDefinitions = style
    .replace(/:root\s*\{[\s\S]*?\}\s*html\[data-theme="dark"\]\s*\{[\s\S]*?\}/, "");
  assert.doesNotMatch(withoutThemeDefinitions, /#[\da-f]{3,8}\b|rgba?\s*\(|hsla?\s*\(/i);
  assert.match(style, /font-family:\s*"Segoe UI", Aptos, Calibri/);
  assert.match(index, /id="dwell-range"/);
  assert.match(index, /data-action="cycle"/);
  assert.match(index, /data-action="center"/);
  assert.match(index, /data-action="confirm"/);
  assert.match(index, /aria-live="polite"/);
  assert.match(index, /\.sensor-overlay\s*\{[\s\S]*?pointer-events:\s*none;/);
  assert.match(index, /<script src="\.\/core\.js"><\/script>/);
  assert.match(index, /<script src="\.\/app\.js"><\/script>/);
});
