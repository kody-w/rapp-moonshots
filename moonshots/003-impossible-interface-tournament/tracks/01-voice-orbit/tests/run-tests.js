"use strict";

const assert = require("node:assert/strict");
const {
  VoiceOrbitMachine,
  parseRouteUtterance,
  runDeterministicSimulation,
  taskMatchesTournament,
} = require("../core.js");

let passed = 0;

function test(name, body) {
  try {
    body();
    passed += 1;
    process.stdout.write(`✓ ${name}\n`);
  } catch (error) {
    process.stderr.write(`✗ ${name}\n${error.stack}\n`);
    process.exitCode = 1;
  }
}

function exactRoute(machine) {
  machine.dispatch({
    type: "VOICE",
    source: "speech",
    text: "Route three cobalt beacons at 14:30, fragile, to ORION-7 through North Gate",
  });
}

function highlight(machine, id, source = "gaze") {
  const index = machine.state.options.findIndex((option) => option.id === id);
  assert.notEqual(index, -1, `option ${id} should exist`);
  machine.dispatch({ type: "HIGHLIGHT", index, source });
  return index;
}

test("parses all shared tournament values", () => {
  const parsed = parseRouteUtterance(
    "Send three cobalt beacons at 2:30 PM, mark fragile, to Orion seven through north gate.",
  );
  assert.deepEqual(parsed, {
    action: "route",
    count: 3,
    color: "cobalt",
    time: "14:30",
    fragile: true,
    destination: "ORION-7",
    gate: "North Gate",
  });
});

test("every interaction stage emits four to eight petals", () => {
  const machine = new VoiceOrbitMachine();
  machine.dispatch({ type: "START", mode: "simulation" });
  assert.ok(machine.state.options.length >= 4 && machine.state.options.length <= 8);
  machine.dispatch({ type: "VOICE", text: "route", source: "speech" });
  assert.equal(machine.state.stage, "collect");
  assert.ok(machine.state.options.length >= 4 && machine.state.options.length <= 8);
  exactRoute(machine);
  assert.equal(machine.state.stage, "review");
  assert.ok(machine.state.options.length >= 4 && machine.state.options.length <= 8);
  highlight(machine, "confirm-route");
  machine.dispatch({ type: "VOICE", text: "select", source: "speech" });
  assert.equal(machine.state.stage, "committed");
  assert.ok(machine.state.options.length >= 4 && machine.state.options.length <= 8);
  highlight(machine, "return-home");
  machine.dispatch({ type: "GESTURE", gesture: "nod" });
  assert.equal(machine.state.stage, "complete");
  assert.ok(machine.state.options.length >= 4 && machine.state.options.length <= 8);
});

test("gaze and dwell never commit", () => {
  let now = 0;
  const machine = new VoiceOrbitMachine({ clock: () => now });
  machine.dispatch({ type: "START", mode: "simulation" });
  exactRoute(machine);
  highlight(machine, "confirm-route", "face-landmark-gaze");
  const taskBefore = JSON.stringify(machine.state.task);
  for (let count = 0; count < 20; count += 1) {
    now += 250;
    machine.dispatch({ type: "DWELL", duration: 250 });
  }
  assert.equal(machine.state.stage, "review");
  assert.equal(machine.state.committed, false);
  assert.equal(machine.state.metrics.commits, 0);
  assert.equal(JSON.stringify(machine.state.task), taskBefore);
  machine.dispatch({ type: "HIGHLIGHT", index: null, source: "center" });
  assert.equal(machine.state.highlight, null);
  assert.equal(machine.state.metrics.dwellCancellations, 1);
});

test("voice select and explicit nod are the committing actions", () => {
  const machine = new VoiceOrbitMachine();
  machine.dispatch({ type: "START", mode: "simulation" });
  exactRoute(machine);
  highlight(machine, "confirm-route");
  machine.dispatch({ type: "VOICE", text: "select", source: "speech" });
  assert.equal(machine.state.committed, true);
  assert.equal(machine.state.metrics.voiceConfirmations, 1);
  highlight(machine, "return-home");
  machine.dispatch({ type: "GESTURE", gesture: "nod" });
  assert.equal(machine.state.returnedHome, true);
  assert.equal(machine.state.stage, "complete");
  assert.equal(machine.state.metrics.gestureConfirmations, 1);
});

test("sensor loss freezes commits and restoration preserves the draft", () => {
  const machine = new VoiceOrbitMachine();
  machine.dispatch({ type: "START", mode: "simulation" });
  exactRoute(machine);
  highlight(machine, "confirm-route");
  machine.dispatch({
    type: "SENSOR",
    sensor: "estimator",
    status: "lost",
    reason: "face not visible",
  });
  assert.equal(machine.state.frozen, true);
  assert.equal(machine.state.highlight, null);
  machine.dispatch({ type: "VOICE", text: "confirm", source: "speech" });
  assert.equal(machine.state.committed, false);
  assert.equal(machine.state.metrics.blockedActions, 1);
  machine.dispatch({
    type: "SENSOR",
    sensor: "estimator",
    status: "active",
    reason: "face restored",
  });
  assert.equal(machine.state.frozen, false);
  assert.equal(machine.state.stage, "review");
  assert.equal(taskMatchesTournament(machine.state.task), true);
});

test("stop, cancel, and undo win over mixed voice phrases", () => {
  const stopped = new VoiceOrbitMachine();
  stopped.dispatch({ type: "START", mode: "simulation" });
  exactRoute(stopped);
  highlight(stopped, "confirm-route");
  stopped.dispatch({ type: "VOICE", text: "select and stop now", source: "speech" });
  assert.equal(stopped.state.status, "stopped");
  assert.equal(stopped.state.committed, false);

  const cancelled = new VoiceOrbitMachine();
  cancelled.dispatch({ type: "START", mode: "simulation" });
  exactRoute(cancelled);
  cancelled.dispatch({ type: "VOICE", text: "confirm but cancel", source: "speech" });
  assert.equal(cancelled.state.stage, "intent");
  assert.equal(cancelled.state.committed, false);

  const undone = new VoiceOrbitMachine();
  undone.dispatch({ type: "START", mode: "simulation" });
  exactRoute(undone);
  highlight(undone, "confirm-route");
  undone.dispatch({ type: "VOICE", text: "select", source: "speech" });
  assert.equal(undone.state.committed, true);
  undone.dispatch({ type: "VOICE", text: "select then undo", source: "speech" });
  assert.equal(undone.state.committed, false);
  assert.equal(undone.state.stage, "review");
});

test("deterministic simulation completes the exact shared task", () => {
  const { record } = runDeterministicSimulation();
  assert.equal(record.complete, true);
  assert.equal(record.taskExact, true);
  assert.equal(record.committed, true);
  assert.equal(record.returnedHome, true);
  assert.deepEqual(record.task, {
    action: "route",
    count: 3,
    color: "cobalt",
    time: "14:30",
    fragile: true,
    destination: "ORION-7",
    gate: "North Gate",
  });
  assert.equal(record.metrics.falseCommits, 0);
  assert.equal(record.metrics.dwellCancellations, 1);
  assert.equal(record.metrics.voiceConfirmations, 1);
  assert.equal(record.metrics.gestureConfirmations, 1);
});

test("instrumentation export excludes raw media and transcripts", () => {
  const { machine, record } = runDeterministicSimulation();
  const serialized = JSON.stringify(record);
  assert.deepEqual(record.privacy, {
    rawFramesStored: false,
    rawAudioStored: false,
    rawTranscriptsStored: false,
    applicationNetworkClientsUsed: false,
    browserSpeechServiceMayUseNetwork: true,
  });
  assert.equal(serialized.includes("Route three cobalt"), false);
  assert.equal(serialized.includes("frameData"), false);
  assert.equal(serialized.includes("audioData"), false);
  assert.equal(machine.state.events.every((event) => !("transcript" in event.detail)), true);
});

process.on("exit", () => {
  if (!process.exitCode) {
    process.stdout.write(`\n${passed} state-machine tests passed.\n`);
  }
});
