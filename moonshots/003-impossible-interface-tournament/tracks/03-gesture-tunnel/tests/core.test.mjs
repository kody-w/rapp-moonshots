import test from "node:test";
import assert from "node:assert/strict";

import {
  CAMERA_DWELL_MS,
  EXPECTED_ROUTE,
  TASK_LAYERS,
  TunnelEngine,
  classifyMotionGesture,
  coarseSector,
  motionCentroid,
  runDeterministicSimulation,
} from "../src/core.mjs";

test("depth advances only after an explicit qualified choose", () => {
  const engine = new TunnelEngine({ clock: () => 0, sessionId: "depth-test" });
  engine.start(0);
  assert.equal(engine.snapshot().depth, 0);

  engine.voice("route", { confidence: 0.96, at: 100 });
  assert.equal(engine.snapshot().depth, 0);
  assert.equal(engine.snapshot().preview.optionId, "route");

  engine.handleGesture("enter", { confidence: 0.92, neutral: true, at: 1000 });
  assert.equal(engine.snapshot().armed, true);
  assert.equal(engine.snapshot().depth, 0);

  assert.equal(engine.voice("choose", { confidence: 0.96, at: 1600 }).accepted, true);
  assert.equal(engine.snapshot().depth, 1);
  assert.deepEqual(engine.snapshot().selections.map((selection) => selection.optionId), ["route"]);

  assert.equal(engine.undo({ source: "test", at: 2300 }), true);
  assert.equal(engine.snapshot().depth, 0);
  assert.equal(engine.snapshot().selections.length, 0);
});

test("motion centroid and gesture classifiers stay bounded and neutral-gated", () => {
  const previous = new Uint8Array(16);
  const current = new Uint8Array(16);
  current[3] = 255;
  current[7] = 255;
  current[11] = 255;
  const motion = motionCentroid(previous, current, 4, 4, 20);
  assert.equal(motion.activePixels, 3);
  assert.ok(motion.activeRatio >= 0 && motion.activeRatio <= 1);
  assert.ok(motion.meanDifference >= 0 && motion.meanDifference <= 1);
  assert.ok(motion.centroid.x >= 0 && motion.centroid.x <= 1);
  assert.ok(motion.centroid.y >= 0 && motion.centroid.y <= 1);

  const swipe = classifyMotionGesture({
    start: { x: 0.1, y: 0.5 },
    end: { x: 0.82, y: 0.52 },
    durationMs: 420,
    activeRatio: 0.12,
    neutralReady: true,
  });
  assert.equal(swipe.type, "rotate-right");
  assert.ok(swipe.confidence >= 0 && swipe.confidence <= 1);

  assert.equal(
    classifyMotionGesture({
      start: { x: 0.1, y: 0.5 },
      end: { x: 0.82, y: 0.52 },
      durationMs: 420,
      activeRatio: 0.12,
      neutralReady: false,
    }),
    null,
  );
  assert.equal(
    classifyMotionGesture({
      start: { x: -20, y: 4 },
      end: { x: 20, y: -4 },
      durationMs: 420,
      activeRatio: 0.9,
      neutralReady: true,
    }),
    null,
  );

  const sector = coarseSector({ x: 4, y: -3 }, 6);
  assert.ok(sector.index >= 0 && sector.index < 6);
  assert.ok(sector.confidence >= 0 && sector.confidence <= 1);
  assert.equal(coarseSector({ x: 0.5, y: 0.5 }, 6), null);
});

test("preview, gaze, motion, low confidence, and sensor loss cannot false-commit", () => {
  const engine = new TunnelEngine({ clock: () => 0, sessionId: "safety-test" });
  engine.start(0);
  engine.previewOption(0, { source: "camera-head-position", confidence: 0.9, at: 100 });
  assert.equal(engine.snapshot().selections.length, 0);
  assert.equal(engine.centerRest({ at: 400 }), true);
  assert.equal(engine.snapshot().preview, null);
  assert.equal(engine.exportMetrics().dwellCancellations, 1);
  engine.previewOption(0, { source: "camera-head-position", confidence: 0.9, at: 500 });

  assert.equal(engine.choose({ source: "voice", at: 500 + CAMERA_DWELL_MS - 1 }), false);
  assert.equal(engine.snapshot().selections.length, 0);
  assert.equal(engine.handleGesture("enter", { confidence: 0.94, neutral: true, at: 1200 }), true);
  assert.equal(engine.snapshot().selections.length, 0);

  engine.sensorLost("camera", 1800);
  assert.equal(engine.choose({ source: "voice", at: 2500 }), false);
  assert.equal(engine.snapshot().selections.length, 0);
  assert.equal(engine.snapshot().preview, null);
  assert.equal(engine.snapshot().armed, false);

  engine.sensorRecovered("camera", 3000);
  assert.equal(engine.voice("route", { confidence: 0.2, at: 3200 }).accepted, false);
  assert.equal(engine.snapshot().preview, null);
  engine.voice("route", { confidence: 0.96, at: 3500 });
  assert.equal(engine.voice("choose", { confidence: 0.2, at: 4200 }).accepted, false);
  assert.equal(engine.snapshot().selections.length, 0);
  assert.equal(engine.voice("choose", { confidence: 0.96, at: 4800 }).accepted, true);
  assert.equal(engine.snapshot().selections.length, 1);
});

test("deterministic simulation completes the exact cobalt route after undo and recovery", () => {
  const result = runDeterministicSimulation();
  assert.equal(result.state.depth, TASK_LAYERS.length);
  assert.equal(result.state.completed, true);
  assert.equal(result.state.exact, true);
  assert.deepEqual(
    result.state.selections.map((selection) => selection.optionId),
    EXPECTED_ROUTE,
  );
  assert.equal(result.metrics.exactTaskCompletion, true);
  assert.equal(result.metrics.falseCommits, 1);
  assert.equal(result.metrics.blockedCommits, 1);
  assert.equal(result.metrics.undos, 1);
  assert.equal(result.metrics.sensorLosses.camera, 1);
  assert.equal(result.metrics.recoveredFromSensorLoss, true);
  assert.equal(result.metrics.neutralCalibrationMs, 100);
  assert.equal(result.metrics.sensorOnMs.camera, 11550);
  assert.equal(result.metrics.sensorOnMs.microphone, 11550);
  assert.equal(result.metrics.confirmationSources.voice, 9);
  assert.equal(result.metrics.rawFramesStored, 0);
  assert.equal(result.metrics.audioStored, 0);
  assert.equal(result.metrics.networkRequestsByApp, 0);
});

test("deterministic replay is stable, ordered, and sufficient to prove completion", () => {
  const first = runDeterministicSimulation();
  const second = runDeterministicSimulation();
  assert.deepEqual(first, second);
  assert.ok(first.replay.replay.length > 20);
  first.replay.replay.forEach((event, index) => {
    assert.equal(event.sequence, index);
    assert.ok(Number.isFinite(event.atMs));
    assert.equal(Object.hasOwn(event, "phrase"), false);
  });
  assert.equal(first.replay.finalState.exact, true);
  assert.equal(first.replay.taskId, "cobalt-beacon-route-v1");
  assert.deepEqual(first.replay.expectedRoute, EXPECTED_ROUTE);
});

test("every layer exposes exactly six tunnel mouths", () => {
  assert.equal(TASK_LAYERS.length, 8);
  TASK_LAYERS.forEach((layer) => {
    assert.equal(layer.options.length, 6);
    assert.ok(layer.options.some((candidate) => candidate.id === layer.target));
  });
});
