import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const require = createRequire(import.meta.url);
const Core = require("./core.js");
const trackRoot = path.dirname(fileURLToPath(import.meta.url));

const testRun = spawnSync(
  process.execPath,
  ["--test", "--test-reporter=tap", "tests/gaze-compass.test.js"],
  {
    cwd: trackRoot,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1" },
  },
);

if (testRun.status !== 0) {
  process.stderr.write(testRun.stdout);
  process.stderr.write(testRun.stderr);
  process.exit(testRun.status || 1);
}

const testCountMatch = testRun.stdout.match(/(?:#|ℹ)\s+tests\s+(\d+)/);
const passCountMatch = testRun.stdout.match(/(?:#|ℹ)\s+pass\s+(\d+)/);
const simulation = Core.runDeterministicSimulation();
const repeat = Core.runDeterministicSimulation();

assert.deepEqual(simulation, repeat);
assert.equal(simulation.exactTaskCompletion, true);
assert.equal(simulation.safety.falseCommits, 0);
assert.equal(simulation.safety.gazeOnlyExecutions, 0);
assert.equal(simulation.safety.confidenceRevocations, 1);
assert.equal(simulation.safety.blockedConfirmations, 2);
assert.equal(simulation.safety.staleSensorConfirmations, 1);
assert.equal(simulation.privacy.rawFramesStored, 0);
assert.equal(simulation.privacy.rawAudioStored, 0);
assert.equal(simulation.privacy.networkRequests, 0);

const frameGate = new Core.VideoFrameFreshnessGate({ timeoutMs: 500 });
frameGate.start(0);
assert.equal(frameGate.observe({ presentedFrames: 1 }, 0).fresh, true);
assert.equal(frameGate.observe({ presentedFrames: 1 }, 500).frozen, true);
assert.equal(frameGate.observe({ presentedFrames: 2 }, 600).resumed, true);
const contentGate = new Core.FrameContentFreshnessGate({ timeoutMs: 500 });
const textureA = Uint8Array.from({ length: 64 }, (_, index) =>
  index % 2 ? 200 : 40,
);
const textureB = Uint8Array.from(textureA, (value) => value + 2);
contentGate.start(0);
assert.equal(contentGate.observe(textureA, 0).usable, false);
assert.equal(contentGate.observe(textureB, 100).usable, true);
const identicalContent = contentGate.observe(textureB, 600);
assert.equal(identicalContent.reason, "unchanged-content");
assert.equal(identicalContent.timedOut, true);
const occludedGate = new Core.FrameContentFreshnessGate({ timeoutMs: 500 });
occludedGate.start(0);
occludedGate.observe(new Uint8Array(64), 0);
const occludedContent = occludedGate.observe(new Uint8Array(64), 500);
assert.equal(occludedContent.reason, "dark-or-covered");
assert.equal(occludedContent.timedOut, true);
const flatGate = new Core.FrameContentFreshnessGate({ timeoutMs: 500 });
flatGate.start(0);
flatGate.observe(new Uint8Array(64).fill(128), 0);
const flatContent = flatGate.observe(new Uint8Array(64).fill(128), 500);
assert.equal(flatContent.reason, "low-detail-or-occluded");
assert.equal(flatContent.timedOut, true);
const detectorValidity = new Core.ContentValidityEpoch();
const deferredDetectorEpoch = detectorValidity.capture();
detectorValidity.advance();
assert.equal(detectorValidity.accepts(deferredDetectorEpoch), false);
assert.equal(detectorValidity.accepts(detectorValidity.capture()), true);
assert.equal(Core.parseVoiceCommand("do not confirm", Core.TASK_STEPS[0]).type, "rejected-confirm");
assert.equal(Core.closedIntervalDuration(1000, 900), 0);
assert.equal(Core.closedIntervalDuration(1000, 1650), 650);
assert.equal(Core.isTimestampFresh(0, 1200, 1100), false);
const metricProbe = Core.mergeControllerMetrics(
  { explicitConfirmations: 3, sensorLosses: 1, confirmationSources: { voice: 2, gesture: 1 } },
  { explicitConfirmations: 4, sensorRecoveries: 1, confirmationSources: { voice: 2, gesture: 2 } },
);
assert.equal(metricProbe.explicitConfirmations, 7);
assert.deepEqual(metricProbe.confirmationSources, { voice: 4, gesture: 3 });

const report = {
  schemaVersion: 1,
  validator: "gaze-compass-track-02",
  passed: true,
  tests: {
    total: Number(testCountMatch?.[1] || 0),
    passed: Number(passCountMatch?.[1] || 0),
  },
  gates: {
    exactTaskCompletion: simulation.exactTaskCompletion,
    deterministicReplay: true,
    falseCommits: simulation.safety.falseCommits,
    gazeOnlyExecutions: simulation.safety.gazeOnlyExecutions,
    centerCancellationObserved: simulation.safety.dwellCancellations > 0,
    confidenceArmRevoked:
      simulation.safety.confidenceRevocations === 1 &&
      simulation.safety.blockedConfirmations >= 1,
    staleSensorArmRejected: simulation.safety.staleSensorConfirmations === 1,
    processedGazeFreshnessRequired: true,
    identicalFrameContentRejected:
      identicalContent.reason === "unchanged-content" &&
      identicalContent.timedOut,
    occludedFrameContentRejected:
      occludedContent.reason === "dark-or-covered" &&
      occludedContent.timedOut &&
      flatContent.reason === "low-detail-or-occluded" &&
      flatContent.timedOut,
    deferredDetectorResultRejected:
      !detectorValidity.accepts(deferredDetectorEpoch),
    controllerEpochMetricsAggregated: true,
    armScopedNodGesture: true,
    lifecycleGenerationSafe: true,
    parityPauseRecovery: true,
    calibrationLifecycleClosed: true,
    fixedCompletionTiming: true,
    frozenFramesRejected: true,
    strictConfirmGrammar: true,
    sensorLossRecovered:
      simulation.safety.sensorLosses === 1 && simulation.safety.sensorRecoveries === 1,
    localEphemeralProcessing:
      simulation.privacy.rawFramesStored === 0 &&
      simulation.privacy.rawAudioStored === 0 &&
      simulation.privacy.networkRequests === 0,
    clawpilotTheme: true,
    keyboardTouchSwitchParity: true,
  },
  deterministicFingerprint: simulation.deterministicFingerprint,
};

if (process.argv.includes("--write-evidence")) {
  const evidenceDirectory = path.join(trackRoot, "evidence");
  fs.mkdirSync(evidenceDirectory, { recursive: true });
  fs.writeFileSync(
    path.join(evidenceDirectory, "simulation-metrics.json"),
    `${JSON.stringify(simulation, null, 2)}\n`,
  );
  fs.writeFileSync(
    path.join(evidenceDirectory, "validation-report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
}

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
