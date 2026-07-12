import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { runDeterministicSimulation } from "../src/core.mjs";

const trackRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const evidenceRoot = resolve(trackRoot, "evidence");
const first = runDeterministicSimulation();
const second = runDeterministicSimulation();
const storedMetrics = JSON.parse(
  await readFile(resolve(evidenceRoot, "deterministic-metrics.json"), "utf8"),
);
const storedReplay = JSON.parse(
  await readFile(resolve(evidenceRoot, "deterministic-replay.json"), "utf8"),
);

assert.deepEqual(first, second);
assert.deepEqual(storedMetrics, first.metrics);
assert.deepEqual(storedReplay, first.replay);
assert.equal(first.state.exact, true);
assert.equal(first.metrics.falseCommits, 1);
assert.equal(first.metrics.undos, 1);
assert.equal(first.metrics.blockedCommits, 1);
assert.equal(first.metrics.recoveredFromSensorLoss, true);
assert.equal(first.metrics.rawFramesStored, 0);
assert.equal(first.metrics.audioStored, 0);
assert.equal(first.metrics.networkRequestsByApp, 0);

const summary = {
  schemaVersion: 1,
  experiment: "gesture-tunnel-deterministic-cobalt-route",
  status: "pass",
  repeatedRunsIdentical: true,
  exactTaskCompletion: first.state.exact,
  finalDepth: first.state.depth,
  completionMs: first.metrics.completionMs,
  intentionalWrongCommits: first.metrics.falseCommits,
  undos: first.metrics.undos,
  blockedCommitsDuringLoss: first.metrics.blockedCommits,
  sensorRecoveryMs: first.metrics.sensorRecoveryMs,
  noMediaOrNetworkPersistence:
    first.metrics.rawFramesStored === 0 &&
    first.metrics.audioStored === 0 &&
    first.metrics.networkRequestsByApp === 0,
};

await writeFile(
  resolve(evidenceRoot, "experiment-summary.json"),
  `${JSON.stringify(summary, null, 2)}\n`,
  "utf8",
);

console.log(JSON.stringify(summary, null, 2));
