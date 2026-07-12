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

function hold(controller, point, startAt, duration = 900) {
  for (let elapsed = 0; elapsed <= duration; elapsed += 100) {
    controller.update({ ...point, confidence: 0.95 }, startAt + elapsed);
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
  assert.match(index, /<script src="\.\/core\.js"><\/script>/);
  assert.match(index, /<script src="\.\/app\.js"><\/script>/);
});
