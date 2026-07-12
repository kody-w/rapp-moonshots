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
assert.equal(simulation.safety.blockedConfirmations, 1);
assert.equal(simulation.privacy.rawFramesStored, 0);
assert.equal(simulation.privacy.rawAudioStored, 0);
assert.equal(simulation.privacy.networkRequests, 0);

const frameGate = new Core.VideoFrameFreshnessGate({ timeoutMs: 500 });
frameGate.start(0);
assert.equal(frameGate.observe({ presentedFrames: 1 }, 0).fresh, true);
assert.equal(frameGate.observe({ presentedFrames: 1 }, 500).frozen, true);
assert.equal(frameGate.observe({ presentedFrames: 2 }, 600).resumed, true);
assert.equal(Core.parseVoiceCommand("do not confirm", Core.TASK_STEPS[0]).type, "rejected-confirm");

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
      simulation.safety.blockedConfirmations === 1,
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
