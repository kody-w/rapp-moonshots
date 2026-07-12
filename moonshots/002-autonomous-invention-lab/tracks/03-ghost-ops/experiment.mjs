#!/usr/bin/env node
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const html = readFileSync(`${root}/index.html`, "utf8");
const source = html.match(/<script id="ghost-engine">([\s\S]*?)<\/script>/)?.[1];
if (!source) throw new Error("Embedded Ghost Ops engine not found.");

const context = {};
vm.createContext(context);
vm.runInContext(source, context, { filename: "ghost-engine.js" });
const Engine = context.GhostOpsEngine;

const policies = {
  "midnight-canary": {
    containment: [
      ["block-egress", "edge-03"], ["capture-snapshot", "edge-03"],
      ["rollback-release", "edge-03"], ["isolate", "auth-01"],
      ["block-egress", "cache-07"], ["capture-snapshot", "auth-01"],
      ["restart-service", "edge-03"]
    ],
    recoveryFirst: [
      ["restart-service", "edge-03"], ["rollback-release", "auth-01"],
      ["capture-snapshot", "cache-07"], ["rotate-credential", "auth-01"],
      ["capture-snapshot", "auth-01"], ["isolate", "cache-07"],
      ["block-egress", "auth-01"]
    ]
  },
  "phantom-credential": {
    containment: [
      ["block-egress", "api-12"], ["capture-snapshot", "api-12"],
      ["rotate-credential", "api-12"], ["isolate", "queue-02"],
      ["block-egress", "worker-09"], ["capture-snapshot", "queue-02"],
      ["restart-service", "api-12"]
    ],
    recoveryFirst: [
      ["restart-service", "api-12"], ["rollback-release", "api-12"],
      ["capture-snapshot", "worker-09"], ["isolate", "worker-09"],
      ["capture-snapshot", "queue-02"], ["block-egress", "queue-02"],
      ["rotate-credential", "worker-09"]
    ]
  }
};

function run(scenarioId, seed, steps) {
  let state = Engine.createScenario(scenarioId, seed);
  for (const [actionId, targetId] of steps) {
    state = Engine.applyAction(state, actionId, targetId);
  }
  return state;
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function rounded(value) {
  return Number(value.toFixed(3));
}

const rows = [];
for (const [scenarioId, scenarioPolicies] of Object.entries(policies)) {
  const samples = { containmentScore: [], recoveryScore: [], containmentSpread: [], recoverySpread: [] };
  let wins = 0;
  for (let seed = 1; seed <= 100; seed += 1) {
    const containment = run(scenarioId, seed, scenarioPolicies.containment);
    const recovery = run(scenarioId, seed, scenarioPolicies.recoveryFirst);
    samples.containmentScore.push(containment.score);
    samples.recoveryScore.push(recovery.score);
    samples.containmentSpread.push(containment.spreadEvents);
    samples.recoverySpread.push(recovery.spreadEvents);
    wins += Number(containment.score > recovery.score);
  }
  rows.push({
    scenario: scenarioId,
    seeds: 100,
    containmentMean: rounded(mean(samples.containmentScore)),
    recoveryFirstMean: rounded(mean(samples.recoveryScore)),
    scoreDelta: rounded(mean(samples.containmentScore) - mean(samples.recoveryScore)),
    containmentSpreadMean: rounded(mean(samples.containmentSpread)),
    recoveryFirstSpreadMean: rounded(mean(samples.recoverySpread)),
    pairedWins: wins
  });
}

const combined = {
  pairedRuns: rows.reduce((sum, row) => sum + row.seeds, 0),
  containmentMean: rounded(mean(rows.map((row) => row.containmentMean))),
  recoveryFirstMean: rounded(mean(rows.map((row) => row.recoveryFirstMean))),
  scoreDelta: rounded(mean(rows.map((row) => row.scoreDelta))),
  containmentSpreadMean: rounded(mean(rows.map((row) => row.containmentSpreadMean))),
  recoveryFirstSpreadMean: rounded(mean(rows.map((row) => row.recoveryFirstSpreadMean))),
  pairedWins: rows.reduce((sum, row) => sum + row.pairedWins, 0)
};

console.log(JSON.stringify({
  experiment: "ghost-ops-policy-order-v1",
  hypothesis: "Containment-first gains at least 15 score points over recovery-first.",
  engineVersion: Engine.version,
  seedRange: [1, 100],
  rows,
  combined,
  verdict: combined.scoreDelta >= 15 ? "SUPPORTED" : "NOT SUPPORTED"
}, null, 2));
