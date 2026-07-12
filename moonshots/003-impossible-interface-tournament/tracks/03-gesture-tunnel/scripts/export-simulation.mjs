import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { runDeterministicSimulation } from "../src/core.mjs";

const trackRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const evidenceRoot = resolve(trackRoot, "evidence");
const result = runDeterministicSimulation();

await mkdir(evidenceRoot, { recursive: true });
await Promise.all([
  writeFile(
    resolve(evidenceRoot, "deterministic-metrics.json"),
    `${JSON.stringify(result.metrics, null, 2)}\n`,
    "utf8",
  ),
  writeFile(
    resolve(evidenceRoot, "deterministic-replay.json"),
    `${JSON.stringify(result.replay, null, 2)}\n`,
    "utf8",
  ),
]);

console.log("Exported deterministic metrics and replay JSON.");
