import assert from "node:assert/strict";
import test from "node:test";
import {
  AdaptiveOrbMachine,
  EXPECTED_TASK,
  chooseModeForShape,
  parseBroadIntent,
  runDeterministicSimulation,
  taskMatchesExpected,
} from "../src/core.mjs";

function begin(kind = "simulation") {
  let now = 0;
  const machine = new AdaptiveOrbMachine({ clock: () => now });
  machine.dispatch({ type: "START", kind, generation: 4, at: now });
  return {
    machine,
    setNow(value) {
      now = value;
    },
  };
}

function captureBroad(machine, at = 100) {
  machine.dispatch({
    type: "VOICE",
    source: "voice",
    text: "Route three cobalt beacons at 14:30 and mark them fragile",
    at,
  });
  machine.dispatch({ type: "CONFIRM", source: "voice", at: at + 100 });
}

function choose(machine, id, source, at) {
  machine.dispatch({ type: "HIGHLIGHT", id, source, at });
  return machine.dispatch({ type: "CONFIRM", source, at: at + 1 });
}

test("broad voice parser captures task semantics without retaining speech", () => {
  assert.deepEqual(
    parseBroadIntent(
      "Route three cobalt beacons at 2:30 PM and mark them fragile.",
    ),
    {
      action: "route",
      quantity: 3,
      color: "cobalt",
      time: "14:30",
      handling: "fragile",
    },
  );
  assert.equal(
    parseBroadIntent("do not mark as fragile; route two amber at 09:15").handling,
    "standard",
  );
});

test("automatic mode follows choice shape", () => {
  assert.equal(
    chooseModeForShape({ breadth: 6, stable: false, depth: 0, hierarchical: false }),
    "orbit",
  );
  assert.equal(
    chooseModeForShape({ breadth: 4, stable: true, depth: 1, hierarchical: false }),
    "compass",
  );
  assert.equal(
    chooseModeForShape({ breadth: 5, stable: false, depth: 3, hierarchical: true }),
    "tunnel",
  );

  const { machine } = begin();
  captureBroad(machine);
  assert.equal(machine.state.stage, "destination");
  assert.equal(machine.state.mode, "compass");
  choose(machine, "destination-orion", "touch", 300);
  choose(machine, "gate-north", "touch", 400);
  assert.equal(machine.state.stage, "review");
  assert.equal(machine.state.mode, "tunnel");
});

test("spoken and manual mode switches preserve all shared safety state", () => {
  const { machine } = begin();
  captureBroad(machine);
  machine.dispatch({
    type: "SENSOR_SAMPLE",
    generation: 4,
    frameAt: 250,
    contentAt: 250,
    processedAt: 250,
    at: 250,
  });
  machine.dispatch({
    type: "SENSOR_LOSS",
    cause: "content-stale",
    sensor: "estimator",
    at: 300,
  });
  const taskBefore = structuredClone(machine.state.task);
  const historyBefore = structuredClone(machine.state.history);
  const sensorsBefore = structuredClone(machine.state.sensors);
  const freezeBefore = [...machine.state.freezeCauses];
  machine.state.highlight = "destination-orion";
  machine.state.armed = true;
  machine.state.dwellMs = 800;

  machine.dispatch({ type: "VOICE", text: "tunnel", source: "voice", at: 320 });
  assert.equal(machine.state.mode, "tunnel");
  assert.equal(machine.state.modePreference, "tunnel");
  assert.deepEqual(machine.state.task, taskBefore);
  assert.deepEqual(machine.state.history, historyBefore);
  assert.deepEqual(machine.state.sensors, sensorsBefore);
  assert.deepEqual(machine.state.freezeCauses, freezeBefore);
  assert.equal(machine.state.highlight, null);
  assert.equal(machine.state.armed, false);
  assert.equal(machine.state.dwellMs, 0);

  machine.dispatch({ type: "VOICE", text: "compass", source: "voice", at: 340 });
  assert.equal(machine.state.mode, "compass");
  assert.deepEqual(machine.state.task, taskBefore);
  assert.deepEqual(machine.state.freezeCauses, freezeBefore);
  assert.equal(machine.state.metrics.modeTransitions.length, 3);

  machine.dispatch({ type: "VOICE", text: "auto mode", source: "voice", at: 360 });
  assert.equal(machine.state.mode, "compass");
  assert.equal(machine.state.modePreference, "auto");
});

test("gaze and dwell can arm but can never commit", () => {
  const { machine } = begin();
  captureBroad(machine);
  machine.dispatch({
    type: "SENSOR_SAMPLE",
    generation: 4,
    frameAt: 300,
    contentAt: 300,
    processedAt: 300,
    at: 300,
  });
  machine.dispatch({
    type: "HIGHLIGHT",
    id: "destination-orion",
    source: "gaze",
    at: 320,
  });
  for (const at of [500, 700, 900, 1100]) {
    machine.dispatch({ type: "DWELL", durationMs: 225, at });
  }
  assert.equal(machine.state.armed, true);
  const result = machine.dispatch({ type: "CONFIRM", source: "gaze", at: 1150 });
  assert.equal(result.ok, false);
  assert.equal(machine.state.task.destination, null);
  assert.equal(machine.state.metrics.falseCommits, 0);
  assert.equal(machine.state.metrics.gazeCommitAttempts, 1);
});

test("center always cancels aim without mutating the task", () => {
  const { machine } = begin();
  captureBroad(machine);
  machine.dispatch({
    type: "HIGHLIGHT",
    id: "destination-orion",
    source: "gaze",
    at: 300,
  });
  machine.dispatch({ type: "DWELL", durationMs: 200, at: 500 });
  const task = structuredClone(machine.state.task);
  machine.dispatch({ type: "CENTER", source: "gaze-center", at: 600 });
  assert.equal(machine.state.highlight, null);
  assert.equal(machine.state.armed, false);
  assert.equal(machine.state.dwellMs, 0);
  assert.equal(machine.state.metrics.centerCancels, 1);
  assert.deepEqual(machine.state.task, task);
});

test("independent freeze causes recover independently and preserve task", () => {
  const { machine } = begin();
  captureBroad(machine);
  const task = structuredClone(machine.state.task);
  machine.dispatch({
    type: "SENSOR_LOSS",
    cause: "camera-lost",
    sensor: "camera",
    at: 500,
  });
  machine.dispatch({
    type: "SENSOR_LOSS",
    cause: "microphone-lost",
    sensor: "microphone",
    at: 600,
  });
  assert.deepEqual(machine.state.freezeCauses, ["camera-lost", "microphone-lost"]);
  machine.dispatch({ type: "SENSOR_RECOVER", cause: "camera-lost", at: 900 });
  assert.deepEqual(machine.state.freezeCauses, ["microphone-lost"]);
  assert.equal(machine.state.status, "frozen");
  machine.dispatch({ type: "SENSOR_RECOVER", cause: "microphone-lost", at: 1100 });
  assert.deepEqual(machine.state.freezeCauses, []);
  assert.equal(machine.state.status, "active");
  assert.deepEqual(machine.state.task, task);
  assert.equal(machine.state.metrics.sensorLosses, 2);
  assert.equal(machine.state.metrics.sensorRecoveries, 2);
  assert.equal(machine.state.metrics.sensorRecoveryMs, 900);
});

test("freshness rejects old generations and freezes all stale signals", () => {
  const { machine } = begin();
  machine.dispatch({
    type: "SENSOR_SAMPLE",
    generation: 3,
    frameAt: 100,
    contentAt: 100,
    processedAt: 100,
    at: 100,
  });
  assert.equal(machine.state.metrics.delayedSensorRejections, 1);
  machine.dispatch({ type: "TICK", at: 2000 });
  assert.deepEqual(machine.state.freezeCauses, [
    "content-stale",
    "frame-stale",
    "processed-stale",
  ]);
  machine.dispatch({
    type: "SENSOR_SAMPLE",
    generation: 4,
    frameAt: 2100,
    contentAt: 2100,
    processedAt: 2100,
    at: 2100,
  });
  assert.deepEqual(machine.state.freezeCauses, []);
});

test("stop cancel and undo preempt mixed voice phrases", () => {
  const stopped = begin().machine;
  captureBroad(stopped);
  stopped.dispatch({
    type: "VOICE",
    text: "confirm destination and stop now",
    source: "voice",
    at: 300,
  });
  assert.ok(stopped.state.freezeCauses.includes("user-stop"));
  assert.equal(stopped.state.task.destination, null);

  const canceled = begin().machine;
  captureBroad(canceled);
  canceled.dispatch({
    type: "VOICE",
    text: "ORION seven but cancel",
    source: "voice",
    at: 300,
  });
  assert.equal(canceled.state.highlight, null);
  assert.equal(canceled.state.task.destination, null);

  const undone = begin().machine;
  captureBroad(undone);
  choose(undone, "destination-orion", "touch", 300);
  undone.dispatch({
    type: "VOICE",
    text: "choose North Gate then undo",
    source: "voice",
    at: 400,
  });
  assert.equal(undone.state.stage, "destination");
  assert.equal(undone.state.task.destination, null);
});

test("intentional tunnel branch is reversible without losing route values", () => {
  const { machine } = begin("accessible");
  captureBroad(machine);
  choose(machine, "destination-orion", "touch", 300);
  choose(machine, "gate-north", "touch", 400);
  const route = structuredClone(machine.state.task);
  choose(machine, "amend-route", "touch", 500);
  assert.deepEqual(machine.state.tunnelPath, ["amend"]);
  assert.equal(machine.state.metrics.intentionalWrongBranches, 1);
  machine.dispatch({ type: "UNDO", source: "keyboard", at: 600 });
  assert.deepEqual(machine.state.tunnelPath, []);
  assert.deepEqual(machine.state.task, route);
  assert.equal(machine.state.mode, "tunnel");
});

test("sensor-free parity completes the exact task with separate aim and confirm", () => {
  const { machine } = begin("accessible");
  captureBroad(machine);
  choose(machine, "destination-orion", "keyboard", 300);
  choose(machine, "gate-north", "touch", 400);
  choose(machine, "confirm-route", "switch", 500);
  choose(machine, "return-home", "keyboard", 600);
  assert.equal(machine.state.stage, "complete");
  assert.equal(taskMatchesExpected(machine.state.task), true);
  assert.deepEqual(machine.state.task, EXPECTED_TASK);
  assert.equal(machine.state.sensors.camera, "not-requested");
  assert.equal(machine.state.sensors.microphone, "not-requested");
  assert.equal(machine.state.metrics.falseCommits, 0);
});

test("deterministic replay uses all modes and proves the exact shared task", () => {
  const { record } = runDeterministicSimulation();
  assert.equal(record.complete, true);
  assert.equal(record.exactTaskVerdict, true);
  assert.deepEqual(record.task, EXPECTED_TASK);
  assert.deepEqual(record.modesUsed, ["orbit", "compass", "tunnel"]);
  assert.deepEqual(
    record.metrics.modeTransitions.map(({ from, to }) => `${from}->${to}`),
    ["orbit->compass", "compass->tunnel"],
  );
  assert.equal(record.metrics.completionTimeMs, 8700);
  assert.equal(record.metrics.falseCommits, 0);
  assert.equal(record.metrics.gazeCommitAttempts, 1);
  assert.equal(record.metrics.centerCancels, 1);
  assert.equal(record.metrics.voiceRepairs, 2);
  assert.equal(record.metrics.sensorLosses, 1);
  assert.equal(record.metrics.sensorRecoveries, 1);
  assert.equal(record.metrics.intentionalWrongBranches, 1);
  assert.equal(record.metrics.undos, 1);
  for (const mode of ["orbit", "compass", "tunnel"]) {
    assert.ok(record.metrics.perMode[mode].confirmations > 0, mode);
  }
  assert.ok(record.metrics.perMode.compass.dwellMs > 0);
  assert.ok(record.metrics.perMode.tunnel.dwellMs > 0);
});

test("export contains no raw media, transcript, persistence, or irreversible effect", () => {
  const { record } = runDeterministicSimulation();
  const serialized = JSON.stringify(record);
  assert.deepEqual(record.privacy, {
    rawFramesStored: false,
    rawAudioStored: false,
    rawTranscriptsStored: false,
    applicationNetworkClientsUsed: false,
    persistentStorageUsed: false,
    browserSpeechVendorProcessingDisclosed: true,
  });
  assert.equal(record.noIrreversibleAction, true);
  assert.equal(serialized.includes("Route three cobalt beacons"), false);
  assert.equal(serialized.includes("transcript"), false);
  assert.equal(serialized.includes("frameData"), false);
  assert.equal(serialized.includes("audioData"), false);
});
