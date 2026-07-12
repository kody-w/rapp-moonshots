import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  EXPECTED_DETERMINISTIC_FINGERPRINT,
  runDeterministicSimulation,
  verifyDeterministicRecord,
} from "../src/core.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const evidenceDirectory = resolve(root, "evidence");
const { machine, record } = runDeterministicSimulation();

const metrics = {
  schemaVersion: record.schemaVersion,
  product: record.product,
  taskId: record.taskId,
  deterministicFingerprint: record.deterministicFingerprint,
  verification: {
    expectedFingerprint: EXPECTED_DETERMINISTIC_FINGERPRINT,
    exactStateVerified: verifyDeterministicRecord(record),
    externalInputLocked: machine.state.replayLocked,
  },
  exactTaskVerdict: record.exactTaskVerdict,
  complete: record.complete,
  noIrreversibleAction: record.noIrreversibleAction,
  task: record.task,
  modesUsed: record.modesUsed,
  modeTransitions: record.metrics.modeTransitions,
  completionTimeMs: record.metrics.completionTimeMs,
  errors: record.metrics.errors,
  falseCommits: record.metrics.falseCommits,
  gazeCommitAttemptsBlocked: record.metrics.gazeCommitAttempts,
  centerCancels: record.metrics.centerCancels,
  voiceRepairs: record.metrics.voiceRepairs,
  sensorLosses: record.metrics.sensorLosses,
  sensorRecoveries: record.metrics.sensorRecoveries,
  sensorRecoveryMs: record.metrics.sensorRecoveryMs,
  intentionalWrongBranches: record.metrics.intentionalWrongBranches,
  undos: record.metrics.undos,
  perMode: record.metrics.perMode,
  confirmationSources: record.metrics.confirmationSources,
  privacy: record.privacy,
};

const replay = {
  schemaVersion: 1,
  taskId: record.taskId,
  deterministicFingerprint: record.deterministicFingerprint,
  expectedFingerprint: EXPECTED_DETERMINISTIC_FINGERPRINT,
  exactStateVerified: verifyDeterministicRecord(record),
  externalInputLocked: machine.state.replayLocked,
  eventCount: record.events.length,
  events: record.events,
};

await mkdir(evidenceDirectory, { recursive: true });
await Promise.all([
  writeFile(
    resolve(evidenceDirectory, "deterministic-metrics.json"),
    `${JSON.stringify(metrics, null, 2)}\n`,
  ),
  writeFile(
    resolve(evidenceDirectory, "deterministic-replay.json"),
    `${JSON.stringify(replay, null, 2)}\n`,
  ),
]);

process.stdout.write(
  `Wrote deterministic evidence ${record.deterministicFingerprint}: exact=${record.exactTaskVerdict}, modes=${record.modesUsed.join(",")}.\n`,
);
