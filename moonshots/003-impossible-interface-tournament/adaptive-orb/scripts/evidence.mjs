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
import {
  MOBILE_LAYOUT_CONTRACT,
  MobileMetricsTracker,
  mobileLayoutForViewport,
  radialChoiceGeometry,
} from "../src/mobile.mjs";

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

let mobileNow = 0;
const mobileTracker = new MobileMetricsTracker({ clock: () => mobileNow });
mobileTracker.start();
mobileTracker.notePermissionRequest("microphone");
mobileNow = 100;
mobileTracker.noteSensorStatus("microphone", "active");
mobileNow = 200;
mobileTracker.noteAction(
  { type: "HIGHLIGHT", source: "touch" },
  { ok: true },
);
mobileNow = 350;
mobileTracker.noteAction(
  { type: "CONFIRM", source: "touch" },
  { ok: true },
);
mobileTracker.noteValue();
mobileNow = 400;
mobileTracker.beginInterruption();
mobileNow = 550;
mobileTracker.recoverInterruption();
mobileTracker.noteSensorStatus("microphone", "off");
mobileTracker.noteOrientationChange();
mobileNow = 600;
mobileTracker.notePermissionRequest("camera");
mobileTracker.noteSensorStatus("camera", "active");
mobileNow = 1000;
const mobileEvidence = {
  schemaVersion: 1,
  product: "Adaptive Orb mobile-first contract",
  evidenceKind: "deterministic synthetic interaction timing",
  conversationFingerprint: conversationRecord.conversationFingerprint,
  exactTaskFingerprint: record.deterministicFingerprint,
  layouts: {
    contract: MOBILE_LAYOUT_CONTRACT,
    portrait: mobileLayoutForViewport(390, 844, {
      top: 47,
      bottom: 34,
    }),
    landscape: mobileLayoutForViewport(844, 390, {
      left: 47,
      right: 47,
      bottom: 21,
    }),
    zoomEquivalent: mobileLayoutForViewport(320, 256),
  },
  radialSafety: {
    portrait: radialChoiceGeometry({
      stageDiameter: 356,
      choiceWidth: 93.6,
      choiceHeight: 68,
      centerDiameter: 124.8,
      choiceCount: 4,
    }),
    landscape: radialChoiceGeometry({
      stageDiameter: 319.8,
      choiceWidth: 90,
      choiceHeight: 56,
      centerDiameter: 104,
      choiceCount: 4,
    }),
    zoomEquivalent: radialChoiceGeometry({
      stageDiameter: 282,
      choiceWidth: 76,
      choiceHeight: 52,
      centerDiameter: 112,
      choiceCount: 4,
    }),
  },
  progressivePermissions: [
    "sensor-free-value",
    "optional-microphone",
    "optional-front-camera",
  ],
  maximumPrimaryChoices: 4,
  noHoverDependency: true,
  normalBrowserAudioRouting: true,
  interruptionResumeMode: "sensor-free",
  scenarios: [
    "eyes-up-note",
    "field-workshop-checklist",
    "hands-busy-kitchen-guide",
    "accessibility-switch-decision",
  ],
  notFor: ["driving", "safety-critical control"],
  metrics: mobileTracker.snapshot(mobileNow, {
    voiceRepairs: conversationRecord.metrics.voiceRepairs,
    falseCommits: conversationRecord.metrics.falseCommits,
  }),
  privacy:
    "Aggregate semantic timings only; no transcript, media, calibration, device ID, API response, credential, or analytics.",
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
  writeFile(
    resolve(evidenceDirectory, "mobile-evidence.json"),
    `${JSON.stringify(mobileEvidence, null, 2)}\n`,
  ),
]);

process.stdout.write(
  `Wrote task ${record.deterministicFingerprint}, conversation ${conversationRecord.conversationFingerprint}, and mobile 390x844 / 844x390 evidence: exact=${conversationRecord.exactTaskVerdict}, modes=${conversationRecord.modesUsed.join(",")}.\n`,
);
