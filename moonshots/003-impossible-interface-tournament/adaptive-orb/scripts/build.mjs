import { createRequire } from "node:module";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tracks = resolve(root, "../tracks");
const require = createRequire(import.meta.url);

const fallback = {
  voiceOrbit: {
    exact: true,
    completionMs: 2700,
    falseCommits: 0,
    sensorLosses: 0,
    sensorRecoveries: 0,
    source: "Track 01 deterministic state-machine summary",
  },
  gazeCompass: {
    exact: true,
    completionMs: 12500,
    falseCommits: 0,
    sensorLosses: 1,
    sensorRecoveries: 1,
    source: "Track 02 evidence/simulation-metrics.json",
  },
  gestureTunnel: {
    exact: true,
    completionMs: 12450,
    falseCommits: 1,
    sensorLosses: 1,
    sensorRecoveries: 1,
    source: "Track 03 evidence/deterministic-metrics.json",
  },
};

async function loadTournamentEvidence() {
  const summary = structuredClone(fallback);
  try {
    const voiceCore = require(resolve(tracks, "01-voice-orbit/core.js"));
    const voice = voiceCore.runDeterministicSimulation().record;
    summary.voiceOrbit = {
      exact: Boolean(voice.taskExact),
      completionMs: voice.metrics.elapsedMs,
      falseCommits: voice.metrics.falseCommits,
      sensorLosses: voice.metrics.sensorLosses,
      sensorRecoveries: voice.metrics.sensorTransitions.filter(
        (transition) => transition.status === "active",
      ).length,
      source: "Track 01 runDeterministicSimulation()",
    };
  } catch {
    // The embedded public-safe summary keeps standalone builds reproducible.
  }
  try {
    const gaze = JSON.parse(
      await readFile(
        resolve(tracks, "02-gaze-compass/evidence/simulation-metrics.json"),
        "utf8",
      ),
    );
    summary.gazeCompass = {
      exact: Boolean(gaze.exactTaskCompletion),
      completionMs: gaze.timing.completionMs,
      falseCommits: gaze.safety.falseCommits,
      sensorLosses: gaze.safety.sensorLosses,
      sensorRecoveries: gaze.safety.sensorRecoveries,
      source: "Track 02 evidence/simulation-metrics.json",
    };
  } catch {
    // The embedded public-safe summary keeps standalone builds reproducible.
  }
  try {
    const tunnel = JSON.parse(
      await readFile(
        resolve(tracks, "03-gesture-tunnel/evidence/deterministic-metrics.json"),
        "utf8",
      ),
    );
    summary.gestureTunnel = {
      exact: Boolean(tunnel.exactTaskCompletion),
      completionMs: tunnel.completionMs,
      falseCommits: tunnel.falseCommits,
      sensorLosses: Object.values(tunnel.sensorLosses).reduce(
        (total, count) => total + count,
        0,
      ),
      sensorRecoveries: tunnel.recoveredFromSensorLoss ? 1 : 0,
      source: "Track 03 evidence/deterministic-metrics.json",
    };
  } catch {
    // The embedded public-safe summary keeps standalone builds reproducible.
  }
  return summary;
}

function stripModuleSyntax(source) {
  return source
    .replace(/^import\s+.*?;\s*$/gm, "")
    .replace(/\nexport\s*\{[\s\S]*?\};\s*$/m, "\n")
    .trim();
}

const [template, styles, core, sensors, comparison, app, evidence] =
  await Promise.all([
    readFile(resolve(root, "src/index.template.html"), "utf8"),
    readFile(resolve(root, "src/styles.css"), "utf8"),
    readFile(resolve(root, "src/core.mjs"), "utf8"),
    readFile(resolve(root, "src/sensors.mjs"), "utf8"),
    readFile(resolve(root, "src/comparison.mjs"), "utf8"),
    readFile(resolve(root, "src/app.mjs"), "utf8"),
    loadTournamentEvidence(),
  ]);

const bundledScript = [
  `const BUILD_TOURNAMENT_EVIDENCE = Object.freeze(${JSON.stringify(evidence)});`,
  stripModuleSyntax(core),
  stripModuleSyntax(sensors),
  stripModuleSyntax(comparison),
  stripModuleSyntax(app),
].join("\n\n");

const output = template
  .replace("/*__ADAPTIVE_ORB_STYLES__*/", styles.trim())
  .replace("/*__ADAPTIVE_ORB_SCRIPT__*/", bundledScript);

if (
  output.includes("__ADAPTIVE_ORB_") ||
  /^\s*(?:import|export)\s/m.test(bundledScript)
) {
  throw new Error("Generated artifact still contains an unresolved module marker.");
}

await writeFile(resolve(root, "index.html"), output);
process.stdout.write(
  `Built self-contained index.html (${Buffer.byteLength(output).toLocaleString()} bytes).\n`,
);
