const FALLBACK_TOURNAMENT_EVIDENCE = Object.freeze({
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
});

function tournamentEvidence() {
  return typeof BUILD_TOURNAMENT_EVIDENCE === "undefined"
    ? FALLBACK_TOURNAMENT_EVIDENCE
    : BUILD_TOURNAMENT_EVIDENCE;
}

function comparisonRows(adaptiveRecord) {
  const evidence = tournamentEvidence();
  return [
    {
      name: "Voice Orbit",
      role: "Broad predictive intent",
      ...evidence.voiceOrbit,
      lesson: "Fast draft capture; confirmation still needs an aimed prediction.",
    },
    {
      name: "Gaze Compass",
      role: "Stable 4–8 choice selection",
      ...evidence.gazeCompass,
      lesson: "Freshness gates and center reacquisition prevent stale arms.",
    },
    {
      name: "Gesture Tunnel",
      role: "Nested hierarchy",
      ...evidence.gestureTunnel,
      lesson: "Visible depth plus undo makes wrong branches recoverable.",
    },
    {
      name: "Adaptive Orb",
      role: "One shared adaptive product",
      exact: Boolean(adaptiveRecord?.exactTaskVerdict),
      completionMs: adaptiveRecord?.metrics?.completionTimeMs ?? null,
      falseCommits: adaptiveRecord?.metrics?.falseCommits ?? 0,
      sensorLosses: adaptiveRecord?.metrics?.sensorLosses ?? 0,
      sensorRecoveries: adaptiveRecord?.metrics?.sensorRecoveries ?? 0,
      source: "Current local session",
      lesson: "Mode changes preserve one task, one history, and one safety boundary.",
    },
  ];
}

function appendCell(row, value, className = "") {
  const cell = document.createElement("td");
  cell.textContent = value;
  if (className) {
    cell.className = className;
  }
  row.append(cell);
}

function renderTournamentComparison(container, adaptiveRecord) {
  if (!container) {
    return;
  }
  container.replaceChildren();
  const table = document.createElement("table");
  table.className = "comparison-table";
  const caption = document.createElement("caption");
  caption.textContent =
    "Deterministic scripted evidence; timings are logic fixtures, not human usability results.";
  table.append(caption);

  const head = document.createElement("thead");
  const headingRow = document.createElement("tr");
  for (const heading of [
    "Prototype",
    "Validated role",
    "Exact",
    "Scripted time",
    "False commits",
    "Loss / recovery",
  ]) {
    const cell = document.createElement("th");
    cell.scope = "col";
    cell.textContent = heading;
    headingRow.append(cell);
  }
  head.append(headingRow);
  table.append(head);

  const body = document.createElement("tbody");
  for (const item of comparisonRows(adaptiveRecord)) {
    const row = document.createElement("tr");
    appendCell(row, item.name);
    appendCell(row, item.role);
    appendCell(row, item.exact ? "Pass" : "Pending", item.exact ? "pass" : "");
    appendCell(
      row,
      Number.isFinite(item.completionMs)
        ? `${(item.completionMs / 1000).toFixed(2)} s`
        : "Pending",
    );
    appendCell(row, String(item.falseCommits));
    appendCell(row, `${item.sensorLosses} / ${item.sensorRecoveries}`);
    row.title = `${item.lesson} Source: ${item.source}`;
    body.append(row);
  }
  table.append(body);
  container.append(table);
}

export {
  FALLBACK_TOURNAMENT_EVIDENCE,
  comparisonRows,
  renderTournamentComparison,
  tournamentEvidence,
};
