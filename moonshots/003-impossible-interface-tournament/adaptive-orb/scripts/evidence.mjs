import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  EXPECTED_DETERMINISTIC_FINGERPRINT,
  EXPECTED_CONVERSATION_FINGERPRINT,
  runDeterministicSimulation,
  runConversationSimulation,
  verifyDeterministicRecord,
  verifyConversationRecord,
} from "../src/core.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const evidenceDirectory = resolve(root, "evidence");
const { machine, record } = runDeterministicSimulation();
const { machine: conversationMachine, record: conversationRecord } =
  runConversationSimulation();

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

const conversationMetrics = {
  schemaVersion: 1,
  product: "Adaptive Orb AI conversation",
  conversationFingerprint: conversationRecord.conversationFingerprint,
  expectedFingerprint: EXPECTED_CONVERSATION_FINGERPRINT,
  exactStateVerified: verifyConversationRecord(conversationRecord),
  externalInputLocked: conversationMachine.state.replayLocked,
  complete: conversationRecord.complete,
  exactTaskVerdict: conversationRecord.exactTaskVerdict,
  task: conversationRecord.task,
  conversation: conversationRecord.conversation,
  modesUsed: conversationRecord.modesUsed,
  modeTransitions: conversationRecord.metrics.modeTransitions,
  completionTimeMs: conversationRecord.metrics.completionTimeMs,
  errors: conversationRecord.metrics.errors,
  falseCommits: conversationRecord.metrics.falseCommits,
  gazeCommitAttemptsBlocked: conversationRecord.metrics.gazeCommitAttempts,
  centerCancels: conversationRecord.metrics.centerCancels,
  sensorLosses: conversationRecord.metrics.sensorLosses,
  sensorRecoveries: conversationRecord.metrics.sensorRecoveries,
  intentionalWrongBranches: conversationRecord.metrics.intentionalWrongBranches,
  undos: conversationRecord.metrics.undos,
  perMode: conversationRecord.metrics.perMode,
  privacy: conversationRecord.privacy,
  legacyTaskSafetyFingerprint: EXPECTED_DETERMINISTIC_FINGERPRINT,
};

const conversationReplay = {
  schemaVersion: 1,
  conversationFingerprint: conversationRecord.conversationFingerprint,
  expectedFingerprint: EXPECTED_CONVERSATION_FINGERPRINT,
  exactStateVerified: verifyConversationRecord(conversationRecord),
  externalInputLocked: conversationMachine.state.replayLocked,
  semanticEventCount: conversationRecord.events.length,
  events: conversationRecord.events,
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
  writeFile(
    resolve(evidenceDirectory, "conversation-metrics.json"),
    `${JSON.stringify(conversationMetrics, null, 2)}\n`,
  ),
  writeFile(
    resolve(evidenceDirectory, "conversation-replay.json"),
    `${JSON.stringify(conversationReplay, null, 2)}\n`,
  ),
]);

process.stdout.write(
  `Wrote task evidence ${record.deterministicFingerprint} and conversation evidence ${conversationRecord.conversationFingerprint}: exact=${conversationRecord.exactTaskVerdict}, modes=${conversationRecord.modesUsed.join(",")}.\n`,
);
