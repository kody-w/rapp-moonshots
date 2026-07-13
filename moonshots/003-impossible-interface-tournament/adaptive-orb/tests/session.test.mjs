import assert from "node:assert/strict";
import test from "node:test";
import { AdaptiveOrbMachine } from "../src/core.mjs";
import {
  RadialAimCoordinator,
  cancelGlobalSpeech,
  performSensorFreeTransition,
} from "../src/session.mjs";

function liveMachine() {
  const machine = new AdaptiveOrbMachine({ clock: () => 0 });
  machine.dispatch({ type: "START", kind: "live", generation: 1, at: 0 });
  return machine;
}

test("voice and gesture access options request teardown before changing state", () => {
  const voiced = liveMachine();
  const voiceResult = voiced.dispatch({
    type: "VOICE",
    text: "sensor free",
    source: "voice",
    at: 10,
  });
  assert.equal(voiceResult.effect, "access-request");
  assert.equal(voiced.state.sessionKind, "live");
  assert.equal(voiced.state.sensors.camera, "starting");
  assert.equal(
    voiced.dispatch({
      type: "ACCESSIBLE",
      source: "external",
      at: 11,
    }).effect,
    "access-request",
  );
  assert.equal(voiced.state.sessionKind, "live");

  const gestured = liveMachine();
  gestured.dispatch({
    type: "SENSOR_STATUS",
    sensor: "camera",
    status: "active",
    at: 5,
  });
  gestured.dispatch({
    type: "SENSOR_STATUS",
    sensor: "estimator",
    status: "active",
    at: 5,
  });
  gestured.dispatch({
    type: "SENSOR_SAMPLE",
    generation: 1,
    frameAt: 5,
    contentAt: 5,
    processedAt: 5,
    at: 5,
  });
  gestured.dispatch({
    type: "HIGHLIGHT",
    id: "sensor-free",
    source: "gesture",
    at: 20,
  });
  for (const at of [200, 400, 600]) {
    gestured.dispatch({ type: "DWELL", durationMs: 250, at });
  }
  const gestureResult = gestured.dispatch({
    type: "CONFIRM",
    source: "gesture",
    at: 650,
  });
  assert.equal(gestureResult.effect, "access-request");
  assert.equal(gestured.state.sessionKind, "live");
});

test("sensor-free transition stops all live resources before accessible render", () => {
  const machine = liveMachine();
  const order = [];
  const resources = {
    camera: true,
    microphone: true,
    speech: true,
  };
  const controller = {
    stop() {
      order.push("stop");
      resources.camera = false;
      resources.microphone = false;
      assert.equal(resources.speech, false);
    },
  };
  const transition = performSensorFreeTransition({
    machine,
    controller,
    source: "gesture",
    at: 100,
    globalObject: {
      speechSynthesis: {
        cancel() {
          order.push("speech");
          resources.speech = false;
        },
      },
    },
    render() {
      order.push("render");
      assert.deepEqual(resources, {
        camera: false,
        microphone: false,
        speech: false,
      });
      assert.equal(machine.state.sessionKind, "accessible");
      assert.equal(machine.state.sensors.camera, "not-requested");
      assert.equal(machine.state.sensors.microphone, "not-requested");
      assert.equal(machine.state.sensors.speech, "disabled");
    },
  });
  assert.deepEqual(order, ["speech", "stop", "render"]);
  assert.equal(transition.controller, null);

  const stopped = liveMachine();
  stopped.dispatch({ type: "STOP", source: "switch", at: 20 });
  performSensorFreeTransition({
    machine: stopped,
    controller: null,
    source: "switch",
    at: 21,
  });
  assert.deepEqual(stopped.state.freezeCauses, ["user-stop"]);
  assert.equal(stopped.state.status, "paused");

  performSensorFreeTransition({
    machine: stopped,
    controller: null,
    source: "resume",
    at: 22,
    resume: true,
  });
  assert.deepEqual(stopped.state.freezeCauses, []);
  assert.equal(stopped.state.status, "active");
  assert.equal(stopped.state.sessionKind, "accessible");
});

test("stop cancel undo and teardown cancel global speech without a controller", () => {
  const canceled = [];
  const globalObject = {
    speechSynthesis: {
      cancel() {
        canceled.push("cancel");
      },
    },
  };
  for (const action of ["STOP", "CANCEL", "UNDO"]) {
    assert.equal(cancelGlobalSpeech(globalObject), true, action);
  }
  const machine = liveMachine();
  performSensorFreeTransition({
    machine,
    controller: null,
    source: "switch",
    at: 30,
    globalObject,
  });
  assert.equal(canceled.length, 4);
});

test("aim cache follows machine highlight and long gaps require reacquisition", () => {
  const machine = liveMachine();
  const aim = new RadialAimCoordinator({ maximumGapMs: 350 });
  const north = { x: 0.5, y: 0.1, zone: "radial" };

  assert.equal(aim.handle(machine, { ...north, at: 100 }).effect, "highlight");
  assert.equal(machine.state.highlight, "scenario-create");
  aim.handle(machine, { ...north, at: 300 });
  assert.equal(machine.state.dwellMs, 200);

  const reset = aim.handle(machine, { ...north, at: 800 });
  assert.equal(reset.effect, "reset");
  assert.equal(machine.state.highlight, null);
  assert.equal(machine.state.dwellMs, 0);
  assert.equal(machine.state.events.at(-1).type, "dwell.reset");
  assert.equal(machine.state.events.at(-1).detail.reacquire, true);

  aim.handle(machine, { ...north, at: 900 });
  assert.equal(machine.state.highlight, "scenario-create");
  assert.equal(machine.state.dwellMs, 0);
  const eventCount = machine.state.events.length;
  const duplicate = aim.handle(machine, { ...north, at: 900 });
  assert.equal(duplicate.effect, "ignored");
  assert.equal(duplicate.changed, false);
  assert.equal(machine.state.events.length, eventCount);

  machine.dispatch({
    type: "SWITCH_MODE",
    mode: "compass",
    source: "voice",
    at: 950,
  });
  aim.synchronize(machine.state);
  assert.equal(aim.id, null);

  aim.handle(machine, { ...north, at: 1000 });
  machine.dispatch({
    type: "SENSOR_LOSS",
    cause: "content-invalid",
    sensor: null,
    at: 1010,
  });
  aim.synchronize(machine.state);
  assert.equal(aim.id, null);
  assert.equal(machine.state.highlight, null);
});

test("invalid dwell samples are ignored without event growth", () => {
  const machine = liveMachine();
  machine.dispatch({
    type: "HIGHLIGHT",
    id: "route-beacons",
    source: "gaze",
    at: 10,
  });
  const eventCount = machine.state.events.length;
  assert.equal(
    machine.dispatch({ type: "DWELL", durationMs: 0, at: 10 }).effect,
    "ignored",
  );
  assert.equal(
    machine.dispatch({ type: "DWELL", durationMs: Number.NaN, at: 10 }).effect,
    "ignored",
  );
  assert.equal(machine.state.events.length, eventCount);
});

test("sensor aim cannot select choices outside the visible phone window", () => {
  const machine = liveMachine();
  const aim = new RadialAimCoordinator();
  const result = aim.handle(machine, {
    x: 0.5,
    y: 0.1,
    zone: "radial",
    at: 100,
    optionIds: ["route-beacons", "sensor-free"],
  });
  assert.equal(result.effect, "highlight");
  assert.equal(machine.state.highlight, "route-beacons");
  assert.equal(
    machine.state.options
      .slice(0, 4)
      .some((option) => option.id === machine.state.highlight),
    false,
  );
});
