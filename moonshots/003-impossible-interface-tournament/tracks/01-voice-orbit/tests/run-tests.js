"use strict";

const assert = require("node:assert/strict");
const {
  NodGestureGate,
  VoiceOrbitMachine,
  isSupportedDestination,
  normalizeDestinationIdentifier,
  parseRouteUtterance,
  runDeterministicSimulation,
  taskComplete,
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

function choose(machine, id, source = "keyboard") {
  highlight(machine, id, source);
  machine.dispatch({ type: "CONFIRM", source });
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

test("negation wins over fragile and spoken destinations are validated", () => {
  const parsed = parseRouteUtterance(
    "Route two amber beacons at 12:00, do not mark as fragile, to Luna three through south gate",
  );
  assert.equal(parsed.fragile, false);
  assert.equal(parsed.destination, "LUNA-3");
  [
    "not fragile",
    "not delicate",
    "do not handle with care",
    "don't mark them as delicate",
    "not handled with care",
  ].forEach((handling) => {
    assert.equal(parseRouteUtterance(handling).fragile, false, handling);
  });
  assert.equal(parseRouteUtterance("do not delay; handle with care").fragile, true);
  assert.equal(parseRouteUtterance("mark delicate").fragile, true);
  assert.equal(normalizeDestinationIdentifier("Atlas number two"), "ATLAS-2");
  assert.equal(normalizeDestinationIdentifier("Polaris dash four"), "POLARIS-4");
  assert.equal(normalizeDestinationIdentifier("Orion eight"), null);
  assert.equal(normalizeDestinationIdentifier("Vega nine"), null);
  assert.equal(isSupportedDestination("ORION-7"), true);
  assert.equal(isSupportedDestination("VEGA-9"), false);
  const invalidRoute = parseRouteUtterance("route one beacon to Vega nine");
  assert.equal(invalidRoute.destination, null);
  assert.equal(invalidRoute.destinationRejected, "VEGA-9");
  assert.equal(
    taskComplete({
      action: "route",
      count: 1,
      color: "cobalt",
      time: "12:00",
      fragile: false,
      destination: "VEGA-9",
      gate: "North Gate",
    }),
    false,
  );
});

test("unsupported destination speech clears a stale valid draft value", () => {
  const rejected = parseRouteUtterance("destination Vega nine");
  assert.equal(rejected.destination, null);
  assert.equal(rejected.destinationRejected, "VEGA-9");

  const machine = new VoiceOrbitMachine();
  machine.dispatch({ type: "START", mode: "simulation" });
  exactRoute(machine);
  assert.equal(machine.state.stage, "review");
  assert.equal(machine.state.task.destination, "ORION-7");
  machine.dispatch({ type: "VOICE", text: "destination Vega nine", source: "speech" });
  assert.equal(machine.state.task.destination, null);
  assert.equal(machine.state.stage, "collect");
  assert.equal(machine.state.lastAction, "destination-rejected");
  assert.equal(machine.state.metrics.errors, 1);
  assert.equal(machine.state.metrics.voiceRepairs, 1);
  assert.equal(machine.state.events.at(-1).type, "draft.destination.rejected");
  machine.dispatch({ type: "VOICE", text: "Orion seven", source: "speech" });
  assert.equal(machine.state.task.destination, "ORION-7");
  assert.equal(machine.state.stage, "review");
});

test("directed destination corrections override every fallback mention", () => {
  const supportedCorrection = parseRouteUtterance(
    "route to Orion seven then change destination to Luna three",
  );
  assert.equal(supportedCorrection.destination, "LUNA-3");
  assert.equal(
    parseRouteUtterance("send to Luna three instead of Orion seven").destination,
    "LUNA-3",
  );

  const unsupportedCorrection = parseRouteUtterance(
    "send to Vega nine instead of Orion seven",
  );
  assert.equal(unsupportedCorrection.destination, null);
  assert.equal(unsupportedCorrection.destinationRejected, "VEGA-9");

  const machine = new VoiceOrbitMachine();
  machine.dispatch({ type: "START", mode: "simulation" });
  exactRoute(machine);
  machine.dispatch({
    type: "VOICE",
    text: "change destination to Luna three instead of Orion seven",
    source: "speech",
  });
  assert.equal(machine.state.task.destination, "LUNA-3");
  assert.equal(machine.state.stage, "review");
  assert.equal(machine.state.metrics.errors, 0);

  machine.dispatch({
    type: "VOICE",
    text: "send to Vega nine instead of Luna three",
    source: "speech",
  });
  assert.equal(machine.state.task.destination, null);
  assert.equal(machine.state.stage, "collect");
  assert.equal(machine.state.lastAction, "destination-rejected");
  assert.equal(machine.state.metrics.errors, 1);
  assert.equal(machine.state.metrics.voiceRepairs, 1);
});

test("center rest cancels a downward aim without completing a nod", () => {
  const gate = new NodGestureGate({
    settleMs: 100,
    armDelta: 0.03,
    returnDelta: 0.01,
    timeoutMs: 500,
    cooldownMs: 200,
  });
  assert.equal(
    gate.sample({ zone: "petal", index: 3, position: 0.7, now: 0 }).confirmed,
    false,
  );
  assert.equal(
    gate.sample({ zone: "petal", index: 3, position: 0.7, now: 120 }).confirmed,
    false,
  );
  assert.equal(
    gate.sample({ zone: "petal", index: 3, position: 0.75, now: 160 }).phase,
    "down",
  );
  const centerReturn = gate.sample({ zone: "center", index: null, position: 0.5, now: 200 });
  assert.equal(centerReturn.confirmed, false);
  assert.equal(centerReturn.phase, "center");
  assert.equal(
    gate.sample({ zone: "petal", index: 3, position: 0.7, now: 220 }).phase,
    "settling",
  );

  gate.sample({ zone: "petal", index: 3, position: 0.7, now: 340 });
  gate.sample({ zone: "petal", index: 3, position: 0.75, now: 380 });
  const explicitReturnToPetalPose = gate.sample({
    zone: "petal",
    index: 3,
    position: 0.7,
    now: 430,
  });
  assert.equal(explicitReturnToPetalPose.confirmed, true);
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

test("speech service denial leaves physical mic and gesture confirmation available", () => {
  const machine = new VoiceOrbitMachine();
  machine.dispatch({ type: "START", mode: "live" });
  machine.dispatch({ type: "SENSOR", sensor: "camera", status: "active" });
  machine.dispatch({ type: "SENSOR", sensor: "microphone", status: "active" });
  machine.dispatch({ type: "SENSOR", sensor: "estimator", status: "active" });
  machine.dispatch({ type: "SENSOR", sensor: "speech", status: "active" });
  exactRoute(machine);
  highlight(machine, "confirm-route", "gaze");

  machine.dispatch({
    type: "SENSOR",
    sensor: "speech",
    status: "denied",
    reason: "service-not-allowed",
  });
  assert.equal(machine.state.sensors.microphone, "active");
  assert.equal(machine.state.sensors.speech, "denied");
  assert.equal(machine.state.frozen, false);
  assert.equal(machine.state.metrics.sensorLosses, 0);
  machine.dispatch({ type: "GESTURE", gesture: "nod" });
  assert.equal(machine.state.committed, true);
  highlight(machine, "return-home", "keyboard");
  machine.dispatch({ type: "CONFIRM", source: "touch" });
  assert.equal(machine.state.stage, "complete");
  assert.equal(machine.state.metrics.gestureConfirmations, 1);
  assert.equal(machine.state.metrics.touchConfirmations, 1);
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

test("committed and complete routes reject speech mutation until explicit undo", () => {
  const machine = new VoiceOrbitMachine();
  machine.dispatch({ type: "START", mode: "simulation" });
  exactRoute(machine);
  choose(machine, "confirm-route", "voice");
  const committedTask = JSON.stringify(machine.state.task);

  machine.dispatch({
    type: "VOICE",
    source: "speech",
    text: "route two amber beacons at 12:00 not fragile to LUNA-3 through South Gate",
  });
  assert.equal(machine.state.stage, "committed");
  assert.equal(machine.state.committed, true);
  assert.equal(JSON.stringify(machine.state.task), committedTask);

  choose(machine, "return-home", "gesture");
  machine.dispatch({
    type: "VOICE",
    source: "speech",
    text: "send one silver beacon at 16:00 to ATLAS-2 through East Gate",
  });
  assert.equal(machine.state.stage, "complete");
  assert.equal(machine.state.committed, true);
  assert.equal(JSON.stringify(machine.state.task), committedTask);
  assert.equal(machine.state.metrics.blockedActions, 2);

  machine.dispatch({ type: "UNDO", source: "keyboard" });
  machine.dispatch({ type: "UNDO", source: "keyboard" });
  assert.equal(machine.state.stage, "review");
  assert.equal(machine.state.committed, false);
  machine.dispatch({
    type: "VOICE",
    source: "speech",
    text: "route two amber beacons at 12:00 not fragile to LUNA-3 through South Gate",
  });
  assert.equal(machine.state.committed, false);
  assert.equal(machine.state.task.count, 2);
  assert.equal(machine.state.task.fragile, false);
  assert.equal(machine.state.task.destination, "LUNA-3");
});

test("no-speech fallback completes by keyboard and touch with sensors unrequested", () => {
  const machine = new VoiceOrbitMachine();
  machine.dispatch({ type: "START", mode: "fallback" });
  assert.deepEqual(machine.state.sensors, {
    camera: "not-requested",
    microphone: "not-requested",
    speech: "disabled",
    estimator: "not-requested",
  });
  choose(machine, "intent-route", "keyboard");
  choose(machine, "count-3", "touch");
  choose(machine, "color-cobalt", "keyboard");
  choose(machine, "time-1430", "touch");
  choose(machine, "fragile-yes", "keyboard");
  choose(machine, "destination-orion", "touch");
  choose(machine, "gate-north", "keyboard");
  choose(machine, "confirm-route", "touch");
  choose(machine, "return-home", "keyboard");
  assert.equal(machine.state.stage, "complete");
  assert.equal(taskMatchesTournament(machine.state.task), true);
  assert.equal(machine.state.metrics.voiceConfirmations, 0);
  assert.ok(machine.state.metrics.keyboardConfirmations > 0);
  assert.ok(machine.state.metrics.touchConfirmations > 0);
});

test("completion time stays frozen across delayed export", () => {
  let now = 100;
  const machine = new VoiceOrbitMachine({ clock: () => now });
  machine.dispatch({ type: "START", mode: "simulation" });
  now = 400;
  exactRoute(machine);
  choose(machine, "confirm-route", "voice");
  now = 1000;
  choose(machine, "return-home", "gesture");
  assert.equal(machine.state.metrics.elapsedMs, 900);
  now = 9100;
  machine.dispatch({ type: "VOICE", text: "export", source: "speech" });
  const record = machine.exportRecord();
  assert.equal(record.metrics.elapsedMs, 900);
  assert.equal(record.events.at(-1).t, 900);
});

test("repeated stop preserves the first stop time", () => {
  let now = 100;
  const machine = new VoiceOrbitMachine({ clock: () => now });
  machine.dispatch({ type: "START", mode: "simulation" });
  now = 500;
  machine.dispatch({ type: "STOP", source: "keyboard" });
  assert.equal(machine.state.stoppedAt, 500);
  assert.equal(machine.state.metrics.elapsedMs, 400);
  now = 900;
  machine.dispatch({ type: "STOP", source: "touch" });
  assert.equal(machine.state.stoppedAt, 500);
  assert.equal(machine.state.metrics.elapsedMs, 400);
  assert.equal(machine.state.events.at(-1).t, 400);
});

test("empty undo counts a repair only for voice", () => {
  const machine = new VoiceOrbitMachine();
  machine.dispatch({ type: "START", mode: "fallback" });
  machine.dispatch({ type: "UNDO", source: "keyboard" });
  machine.dispatch({ type: "UNDO", source: "touch" });
  assert.equal(machine.state.metrics.voiceRepairs, 0);
  machine.dispatch({ type: "VOICE", text: "undo", source: "speech" });
  assert.equal(machine.state.metrics.voiceRepairs, 1);
  assert.equal(machine.state.events.at(-1).detail.source, "voice");
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
  assert.equal(record.metrics.elapsedMs, 2700);
});

test("instrumentation export excludes raw media and transcripts", () => {
  const { machine, record } = runDeterministicSimulation();
  const serialized = JSON.stringify(record);
  assert.deepEqual(record.privacy, {
    rawFramesStored: false,
    rawAudioStored: false,
    rawTranscriptsStored: false,
    applicationNetworkClientsUsed: false,
    browserSpeechServiceMayUseNetwork: false,
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
