import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const html = readFileSync(`${root}/index.html`, "utf8");
const match = html.match(/<script id="ghost-engine">([\s\S]*?)<\/script>/);
assert.ok(match, "embedded Ghost Ops engine must exist");

const context = {};
vm.createContext(context);
vm.runInContext(match[1], context, { filename: "ghost-engine.js" });
const Engine = context.GhostOpsEngine;

const plans = {
  "midnight-canary": {
    containment: [
      ["block-egress", "edge-03"],
      ["capture-snapshot", "edge-03"],
      ["rollback-release", "edge-03"],
      ["isolate", "auth-01"],
      ["block-egress", "cache-07"],
      ["capture-snapshot", "auth-01"],
      ["restart-service", "edge-03"]
    ],
    recoveryFirst: [
      ["restart-service", "edge-03"],
      ["rollback-release", "auth-01"],
      ["capture-snapshot", "cache-07"],
      ["rotate-credential", "auth-01"],
      ["capture-snapshot", "auth-01"],
      ["isolate", "cache-07"],
      ["block-egress", "auth-01"]
    ]
  },
  "phantom-credential": {
    containment: [
      ["block-egress", "api-12"],
      ["capture-snapshot", "api-12"],
      ["rotate-credential", "api-12"],
      ["isolate", "queue-02"],
      ["block-egress", "worker-09"],
      ["capture-snapshot", "queue-02"],
      ["restart-service", "api-12"]
    ],
    recoveryFirst: [
      ["restart-service", "api-12"],
      ["rollback-release", "api-12"],
      ["capture-snapshot", "worker-09"],
      ["isolate", "worker-09"],
      ["capture-snapshot", "queue-02"],
      ["block-egress", "queue-02"],
      ["rotate-credential", "worker-09"]
    ]
  }
};

function run(scenarioId, seed, plan) {
  let state = Engine.createScenario(scenarioId, seed);
  for (const [actionId, targetId] of plan) {
    state = Engine.applyAction(state, actionId, targetId);
  }
  return state;
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test("ships two safe scenarios with exactly three machine personas each", () => {
  assert.equal(Engine.scenarios.length, 2);
  for (const scenario of Engine.scenarios) {
    assert.equal(scenario.machines.length, 3);
    assert.ok(scenario.machines.every((machine) => machine.name && machine.symptom));
  }
  assert.equal(html.includes("fetch("), false);
  assert.equal(html.includes("XMLHttpRequest"), false);
  assert.equal(html.includes("WebSocket"), false);
});

test("same seed and action sequence produce an identical snapshot and digest", () => {
  const first = run("midnight-canary", 30317, plans["midnight-canary"].containment);
  const second = run("midnight-canary", 30317, plans["midnight-canary"].containment);
  assert.deepEqual(plain(Engine.stableSnapshot(first)), plain(Engine.stableSnapshot(second)));
  assert.equal(Engine.digest(first), Engine.digest(second));
  assert.equal(first.status, "resolved");
});

test("seed affects fixture dynamics without changing the bounded action contract", () => {
  const first = run("phantom-credential", 7, plans["phantom-credential"].containment);
  const second = run("phantom-credential", 8, plans["phantom-credential"].containment);
  assert.notEqual(Engine.digest(first), Engine.digest(second));
  assert.deepEqual(
    plain(first.actionHistory.map(({ actionId, targetId }) => ({ actionId, targetId }))),
    plain(second.actionHistory.map(({ actionId, targetId }) => ({ actionId, targetId })))
  );
});

test("action inventory and fixture targets are enforced", () => {
  let state = Engine.createScenario("midnight-canary", 10);
  state = Engine.applyAction(state, "isolate", "edge-03");
  assert.throws(() => Engine.applyAction(state, "isolate", "edge-03"), /already isolated/);
  assert.throws(() => Engine.applyAction(state, "shell-command", "edge-03"), /not in the bounded/);
  assert.throws(() => Engine.applyAction(state, "block-egress", "production-host"), /not a fixture/);
});

test("serialized replay reconstructs the exact event digest", () => {
  const original = run("phantom-credential", 90210, plans["phantom-credential"].containment);
  const replay = Engine.serializeReplay(original);
  const reconstructed = Engine.replay(replay);
  assert.equal(Engine.digest(reconstructed), replay.expectedDigest);
  assert.deepEqual(plain(Engine.stableSnapshot(reconstructed)), plain(Engine.stableSnapshot(original)));
});

test("replay parser rejects extra fields and out-of-fixture targets", () => {
  assert.throws(() => Engine.validateReplay({
    schema: "ghost-ops/replay/v1",
    scenarioId: "midnight-canary",
    seed: 1,
    actions: [],
    command: "connect to production"
  }), /unsupported top-level field/);
  assert.throws(() => Engine.validateReplay({
    schema: "ghost-ops/replay/v1",
    scenarioId: "midnight-canary",
    seed: "1",
    actions: []
  }), /seed must be an integer/);
  assert.throws(() => Engine.validateReplay({
    schema: "ghost-ops/replay/v1",
    scenarioId: "midnight-canary",
    seed: 1,
    actions: [{ actionId: "isolate", targetId: "edge-03", command: "rm -rf" }]
  }), /unsupported field/);
  assert.throws(() => Engine.validateReplay({
    schema: "ghost-ops/replay/v1",
    scenarioId: "midnight-canary",
    seed: 1,
    actions: [{ actionId: "isolate", targetId: "real-host" }]
  }), /outside the fixture/);
});

test("containment-first policy beats recovery-first policy across a matched cohort", () => {
  const scores = { containment: 0, recoveryFirst: 0, wins: 0 };
  for (const scenarioId of Object.keys(plans)) {
    for (let seed = 1; seed <= 25; seed += 1) {
      const containment = run(scenarioId, seed, plans[scenarioId].containment);
      const recoveryFirst = run(scenarioId, seed, plans[scenarioId].recoveryFirst);
      scores.containment += containment.score;
      scores.recoveryFirst += recoveryFirst.score;
      scores.wins += Number(containment.score > recoveryFirst.score);
    }
  }
  const averageDelta = (scores.containment - scores.recoveryFirst) / 50;
  assert.ok(averageDelta >= 15, `expected >=15 point advantage, got ${averageDelta}`);
  assert.equal(scores.wins, 50);
});

test("finale exports Obsidian Markdown and a safe JSON event log", () => {
  const state = run("midnight-canary", 30317, plans["midnight-canary"].containment);
  const playbook = Engine.makePlaybook(state);
  const log = Engine.makeEventLog(state);
  assert.match(playbook, /^---\n/);
  assert.match(playbook, /tags:\n  - ghost-ops/);
  assert.match(playbook, /> \[!.*\] Outcome/);
  assert.match(playbook, /\[\[Incident rehearsals\]\]/);
  assert.match(playbook, /## Deterministic replay/);
  assert.equal(log.fixtureOnly, true);
  assert.equal(log.networkCalls, 0);
  assert.equal(log.result.digest, Engine.digest(state));
  assert.ok(log.events.some((event) => event.type === "operator.action"));
  assert.ok(log.events.some((event) => event.type === "drill.completed"));
});
