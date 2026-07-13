import assert from "node:assert/strict";
import test from "node:test";
import { demoResponseFor } from "../src/ai.mjs";
import {
  AdaptiveOrbMachine,
  CONVERSATION_DETERMINISTIC_SCRIPT,
  DETERMINISTIC_SCRIPT,
  EXPECTED_CONVERSATION_FINGERPRINT,
  EXPECTED_TASK,
  EXPECTED_DETERMINISTIC_FINGERPRINT,
  chooseModeForShape,
  dispatchDeterministicStep,
  parseBroadIntent,
  runDeterministicSimulation,
  runConversationSimulation,
  taskMatchesExpected,
  verifyDeterministicRecord,
  verifyConversationRecord,
} from "../src/core.mjs";

function begin(kind = "live") {
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
  choose(machine, "route-beacons", "keyboard", 100);
  choose(machine, "entry-quantity-3", "touch", 200);
  machine.dispatch({ type: "CYCLE", delta: 1, source: "switch", at: 300 });
  machine.dispatch({ type: "CONFIRM", source: "switch", at: 301 });
  choose(machine, "entry-time-1430", "keyboard", 400);
  choose(machine, "entry-handling-fragile", "touch", 500);
  machine.dispatch({ type: "CYCLE", delta: 1, source: "switch", at: 600 });
  machine.dispatch({ type: "CONFIRM", source: "switch", at: 601 });
  choose(machine, "destination-orion", "touch", 700);
  choose(machine, "gate-north", "keyboard", 800);
  choose(machine, "confirm-route", "switch", 900);
  choose(machine, "return-home", "touch", 1000);
  assert.equal(machine.state.stage, "complete");
  assert.equal(taskMatchesExpected(machine.state.task), true);
  assert.deepEqual(machine.state.task, EXPECTED_TASK);
  assert.equal(machine.state.sensors.camera, "not-requested");
  assert.equal(machine.state.sensors.microphone, "not-requested");
  assert.equal(machine.state.metrics.falseCommits, 0);
  assert.equal(machine.state.metrics.confirmationSources.voice, 0);
  assert.ok(machine.state.metrics.confirmationSources.keyboard > 0);
  assert.ok(machine.state.metrics.confirmationSources.touch > 0);
  assert.ok(machine.state.metrics.confirmationSources.switch > 0);
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
  assert.equal(
    record.deterministicFingerprint,
    EXPECTED_DETERMINISTIC_FINGERPRINT,
  );
  assert.equal(verifyDeterministicRecord(record), true);
});

test("deterministic replay rejects every external action without state drift", () => {
  let now = 0;
  const machine = new AdaptiveOrbMachine({ clock: () => now });
  dispatchDeterministicStep(machine, DETERMINISTIC_SCRIPT[0]);
  const lockedState = JSON.stringify(machine.state);
  for (const action of [
    { type: "VOICE", text: "undo", source: "voice" },
    { type: "HIGHLIGHT", id: "route-beacons", source: "touch" },
    { type: "CYCLE", delta: 1, source: "keyboard" },
    { type: "CONFIRM", source: "gesture" },
    { type: "CENTER", source: "pointer" },
    { type: "ACCESSIBLE", source: "external" },
    { type: "STOP", source: "external" },
    { type: "PAGEHIDE", source: "external" },
    { type: "REPEAT", source: "touch" },
    { type: "WHAT_CHANGED", source: "touch" },
    {
      type: "ORIENTATION_CHANGE",
      orientation: "landscape",
      source: "external",
    },
    { type: "INTERRUPTION_RESUME", source: "external" },
    {
      type: "CONVERSATION_INPUT",
      text: "external prompt",
      source: "external",
    },
    {
      type: "AI_RESPONSE",
      requestId: 1,
      response: { message: "external response" },
      source: "external",
    },
    { type: "AI_PROVIDER_ATTEMPT", provider: "brainstem", source: "external" },
    { type: "TASK_FOCUS", source: "external" },
  ]) {
    const result = machine.dispatch({ ...action, at: 10 });
    assert.equal(result.effect, "replay-rejected", action.type);
    assert.equal(JSON.stringify(machine.state), lockedState, action.type);
  }
  for (const action of DETERMINISTIC_SCRIPT.slice(1)) {
    now = action.at;
    dispatchDeterministicStep(machine, action);
    machine.exportRecord(now);
  }
  const record = machine.exportRecord(now);
  assert.equal(record.deterministicFingerprint, "c1b6e39f");
  assert.equal(verifyDeterministicRecord(record), true);
  const finalState = JSON.stringify(machine.state);
  assert.equal(
    machine.dispatch({ type: "UNDO", source: "keyboard", at: 9000 }).effect,
    "replay-rejected",
  );
  assert.equal(JSON.stringify(machine.state), finalState);
});

test("export contains no raw media, transcript, persistence, or irreversible effect", () => {
  const { record } = runDeterministicSimulation();
  const serialized = JSON.stringify(record);
  assert.deepEqual(record.privacy, {
    rawFramesStored: false,
    rawAudioStored: false,
    rawTranscriptsStored: false,
    conversationTextMemoryOnly: true,
    conversationTextExported: false,
    applicationNetworkClientsUsed: false,
    sameOriginCompanionOnly: true,
    persistentStorageUsed: false,
    browserSpeechVendorProcessingDisclosed: true,
  });
  assert.equal(record.noIrreversibleAction, true);
  assert.equal(serialized.includes("Route three cobalt beacons"), false);
  assert.equal(serialized.includes("transcript"), false);
  assert.equal(serialized.includes("frameData"), false);
  assert.equal(serialized.includes("audioData"), false);
});

test("AI conversation keeps one memory and task across contextual mode changes", () => {
  const { machine } = begin("accessible");
  const request = machine.dispatch({
    type: "CONVERSATION_INPUT",
    text: "Plan a focused afternoon with four priorities.",
    source: "touch",
    at: 100,
  });
  assert.equal(request.effect, "ai-request");
  const response = demoResponseFor(request.request, { scenarioHint: "plan" });
  assert.equal(
    machine.dispatch({
      type: "AI_RESPONSE",
      requestId: request.requestId,
      response,
      at: 200,
    }).effect,
    "ai-response",
  );
  assert.equal(machine.state.mode, "compass");
  assert.equal(machine.state.conversation.turns.length, 2);
  assert.equal(machine.state.conversation.scenario, "plan");
  machine.dispatch({
    type: "AI_PROVIDER_ATTEMPT",
    provider: "brainstem",
    at: 225,
  });
  assert.equal(
    machine.exportRecord(225).privacy.applicationNetworkClientsUsed,
    true,
  );
  const conversation = structuredClone(machine.state.conversation);
  const task = structuredClone(machine.state.task);
  const history = structuredClone(machine.state.history);
  machine.dispatch({ type: "VOICE", text: "tunnel", source: "voice", at: 250 });
  assert.equal(machine.state.mode, "tunnel");
  assert.deepEqual(machine.state.conversation, conversation);
  assert.deepEqual(machine.state.task, task);
  assert.deepEqual(machine.state.history, history);
  machine.dispatch({ type: "VOICE", text: "auto mode", source: "voice", at: 300 });
  assert.equal(machine.state.mode, "compass");
  const privateSuggestionId = response.suggestions[0].id;
  machine.dispatch({
    type: "AIM",
    id: privateSuggestionId,
    source: "keyboard",
    at: 325,
  });
  machine.dispatch({ type: "CONFIRM", source: "keyboard", at: 350 });
  assert.equal(
    JSON.stringify(machine.exportRecord(350)).includes(privateSuggestionId),
    false,
  );
});

test("conversation branches are reversible and stale AI responses cannot revive stop", () => {
  const { machine } = begin("accessible");
  const explain = machine.dispatch({
    type: "CONVERSATION_INPUT",
    text: "Explain how offline updates work.",
    source: "keyboard",
    at: 100,
  });
  machine.dispatch({
    type: "AI_RESPONSE",
    requestId: explain.requestId,
    response: demoResponseFor(explain.request, { scenarioHint: "explain" }),
    at: 200,
  });
  const turns = structuredClone(machine.state.conversation.turns);
  const wrongBranch = choose(machine, "ai-explain-wrong", "keyboard", 300);
  assert.deepEqual(machine.state.conversation.branchPath, ["wrong-analytics"]);
  machine.dispatch({ type: "UNDO", source: "keyboard", at: 400 });
  assert.deepEqual(machine.state.conversation.branchPath, []);
  assert.deepEqual(machine.state.conversation.turns, turns);

  const pending = machine.dispatch({
    type: "CONVERSATION_INPUT",
    text: "Plan another option.",
    source: "keyboard",
    at: 500,
  });
  assert.ok(pending.requestId > wrongBranch.requestId);
  assert.equal(
    machine.dispatch({
      type: "AI_RESPONSE",
      requestId: wrongBranch.requestId,
      response: demoResponseFor(wrongBranch.request, {
        scenarioHint: "explain",
      }),
      at: 505,
    }).effect,
    "rejected",
  );
  assert.equal(machine.state.conversation.pending, true);
  machine.dispatch({ type: "STOP", source: "keyboard", at: 510 });
  const turnCount = machine.state.conversation.turns.length;
  const stale = machine.dispatch({
    type: "AI_RESPONSE",
    requestId: pending.requestId,
    response: demoResponseFor(pending.request, { scenarioHint: "plan" }),
    at: 520,
  });
  assert.equal(stale.effect, "rejected");
  assert.equal(machine.state.conversation.turns.length, turnCount);
});

test("an AI detour returns to the exact in-progress task checkpoint", () => {
  const { machine } = begin("accessible");
  captureBroad(machine);
  assert.equal(machine.state.stage, "destination");
  const task = structuredClone(machine.state.task);
  const request = machine.dispatch({
    type: "VOICE",
    text: "Explain how the route safety model works.",
    source: "voice",
    at: 300,
  });
  assert.equal(request.effect, "ai-request");
  machine.dispatch({
    type: "AI_RESPONSE",
    requestId: request.requestId,
    response: demoResponseFor(request.request, { scenarioHint: "explain" }),
    at: 400,
  });
  assert.equal(machine.state.conversation.focused, true);
  assert.equal(machine.state.mode, "tunnel");
  choose(machine, "resume-task", "keyboard", 500);
  assert.equal(machine.state.conversation.focused, false);
  assert.equal(machine.state.stage, "destination");
  assert.deepEqual(machine.state.task, task);
  assert.ok(
    machine.state.options.some((candidate) => candidate.id === "destination-orion"),
  );
});

test("orientation, interruption, and no-look commands preserve shared state", () => {
  const { machine } = begin("accessible");
  const request = choose(machine, "scenario-plan", "touch", 100);
  machine.dispatch({
    type: "AI_RESPONSE",
    requestId: request.requestId,
    response: demoResponseFor(request.request, { scenarioHint: "plan" }),
    at: 200,
  });
  machine.dispatch({
    type: "HIGHLIGHT",
    id: "ai-plan-focus",
    source: "touch",
    at: 250,
  });
  const before = {
    task: structuredClone(machine.state.task),
    turns: structuredClone(machine.state.conversation.turns),
    history: structuredClone(machine.state.history),
    mode: machine.state.mode,
    scenario: machine.state.conversation.scenario,
  };

  const orientation = machine.dispatch({
    type: "ORIENTATION_CHANGE",
    orientation: "landscape",
    source: "test",
    at: 300,
  });
  assert.equal(orientation.effect, "orientation");
  assert.equal(machine.state.highlight, null);
  assert.equal(machine.state.armed, false);
  const resumed = machine.dispatch({
    type: "INTERRUPTION_RESUME",
    source: "visibility",
    at: 400,
  });
  assert.equal(resumed.effect, "interruption-resume");
  assert.equal(machine.dispatch({ type: "REPEAT", source: "switch", at: 500 }).effect, "repeat");
  assert.equal(
    machine.dispatch({
      type: "WHAT_CHANGED",
      source: "switch",
      at: 600,
    }).effect,
    "what-changed",
  );

  assert.deepEqual(machine.state.task, before.task);
  assert.deepEqual(machine.state.conversation.turns, before.turns);
  assert.deepEqual(machine.state.history, before.history);
  assert.equal(machine.state.mode, before.mode);
  assert.equal(machine.state.conversation.scenario, before.scenario);
});

test("multi-turn simulation spans scenarios and modes while retaining exact task", () => {
  const { record } = runConversationSimulation();
  assert.equal(
    record.conversationFingerprint,
    EXPECTED_CONVERSATION_FINGERPRINT,
  );
  assert.equal(verifyConversationRecord(record), true);
  assert.deepEqual(record.conversation.scenariosUsed, [
    "create",
    "plan",
    "explain",
    "navigate",
  ]);
  assert.equal(record.conversation.turnCount, 12);
  assert.equal(record.conversation.textExported, false);
  assert.equal(record.exactTaskVerdict, true);
  assert.deepEqual(record.task, EXPECTED_TASK);
  assert.deepEqual(record.modesUsed, ["orbit", "compass", "tunnel"]);
  assert.ok(CONVERSATION_DETERMINISTIC_SCRIPT.length > DETERMINISTIC_SCRIPT.length);
  const serialized = JSON.stringify(record);
  assert.equal(serialized.includes("calm launch story"), false);
  assert.equal(serialized.includes("offline-first application"), false);
});
