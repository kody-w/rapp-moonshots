import { AdaptiveOrbMachine, DETERMINISTIC_SCRIPT, DWELL_TARGET_MS, choiceShapeForState } from "./core.mjs";
import { AdaptiveSensorController } from "./sensors.mjs";
import { renderTournamentComparison } from "./comparison.mjs";

const byId = (id) => document.getElementById(id);
const elements = {
  launchScreen: byId("launchScreen"),
  app: byId("app"),
  startLive: byId("startLive"),
  startAccessible: byId("startAccessible"),
  startSimulation: byId("startSimulation"),
  modeStatus: byId("modeStatus"),
  sensorStatus: byId("sensorStatus"),
  safetyBanner: byId("safetyBanner"),
  safetyTitle: byId("safetyTitle"),
  safetyDetail: byId("safetyDetail"),
  taskValues: byId("taskValues"),
  grammarTitle: byId("grammarTitle"),
  grammarDescription: byId("grammarDescription"),
  cameraState: byId("cameraState"),
  microphoneState: byId("microphoneState"),
  speechState: byId("speechState"),
  estimatorState: byId("estimatorState"),
  freshnessState: byId("freshnessState"),
  sensorPreview: byId("sensorPreview"),
  stageKicker: byId("stageKicker"),
  stageTitle: byId("stageTitle"),
  modeMeter: byId("modeMeter"),
  orbStage: byId("orbStage"),
  choiceLayer: byId("choiceLayer"),
  centerOrb: byId("centerOrb"),
  orbLabel: byId("orbLabel"),
  orbSubLabel: byId("orbSubLabel"),
  dwellRing: byId("dwellRing"),
  caption: byId("caption"),
  previousChoice: byId("previousChoice"),
  nextChoice: byId("nextChoice"),
  confirmChoice: byId("confirmChoice"),
  restChoice: byId("restChoice"),
  undoChoice: byId("undoChoice"),
  modeTransitions: byId("modeTransitions"),
  falseCommits: byId("falseCommits"),
  centerCancels: byId("centerCancels"),
  voiceRepairs: byId("voiceRepairs"),
  sensorRecovery: byId("sensorRecovery"),
  eventTrace: byId("eventTrace"),
  modeStats: byId("modeStats"),
  comparisonTable: byId("comparisonTable"),
  comparisonPanel: byId("comparisonPanel"),
  exportMetrics: byId("exportMetrics"),
  useAccessible: byId("useAccessible"),
  stopSensors: byId("stopSensors"),
  resumeSession: byId("resumeSession"),
  assertiveStatus: byId("assertiveStatus"),
};

const grammarCopy = {
  orbit: {
    title: "Voice Orbit",
    description:
      "Speak broad intent. Predictive petals orbit the same persistent center; a second explicit confirmation advances.",
  },
  compass: {
    title: "Gaze Compass",
    description:
      "Four to eight stable radial choices. Coarse gaze/head direction highlights and dwells; it never executes.",
  },
  tunnel: {
    title: "Gesture Tunnel",
    description:
      "Nested route layers remain in one history. Coarse motion navigates; a nod or spoken confirmation chooses.",
  },
};

const stageCopy = {
  intent: ["Broad intent · depth 0", "Speak the route intent"],
  destination: ["Stable choices · depth 1", "Select destination"],
  gate: ["Stable choices · depth 1", "Select gate"],
  review: ["Nested review · depth 3", "Traverse and review"],
  home: ["Nested completion · depth 4", "Return home"],
  complete: ["Exact task verdict", "Task complete"],
};

let logicalNow = null;
let machine = createMachine();
let sensorController = null;
let lastAimId = null;
let lastAimAt = null;
let lastAimZone = null;
let lastChoiceSignature = "";
let lastTaskSignature = "";
let lastEventSignature = "";
let lastComparisonSignature = "";
let lastModeStatsSignature = "";
let simulationRunning = false;

function sessionNow() {
  return logicalNow === null ? performance.now() : logicalNow;
}

function createMachine() {
  return new AdaptiveOrbMachine({ clock: () => sessionNow() });
}

function showApplication() {
  elements.launchScreen.hidden = true;
  elements.app.hidden = false;
  requestAnimationFrame(layoutChoices);
}

function createSensorController() {
  return new AdaptiveSensorController({
    video: elements.sensorPreview,
    clock: () => performance.now(),
    onAction(action) {
      if (!machine || machine.state.sessionKind === "simulation") {
        return;
      }
      machine.dispatch(action);
      render();
    },
    onAim: handleSensorAim,
    onGesture: handleSensorGesture,
    onSpeech(text) {
      const result = machine.dispatch({ type: "VOICE", text, source: "voice" });
      if (result.effect === "export") {
        exportMetrics();
      }
      render();
      sensorController?.announce(machine.state.announcement);
      if (result.effect === "stop") {
        sensorController?.stop("spoken stop");
      }
    },
    onCaption(text) {
      elements.caption.textContent = text;
    },
  });
}

async function startLive() {
  if (machine.state.status !== "idle") {
    return;
  }
  showApplication();
  logicalNow = null;
  machine.dispatch({ type: "START", kind: "live", generation: 1 });
  sensorController = createSensorController();
  render();
  const started = await sensorController.start();
  if (!started) {
    sensorController.stop("permission or startup failure");
    machine.dispatch({ type: "ACCESSIBLE", source: "startup-fallback" });
    elements.assertiveStatus.textContent =
      "Sensors unavailable. Sensor-free controls are active with the same task.";
  } else {
    sensorController.announce(
      "Adaptive Orb ready. Speak: route three cobalt beacons at fourteen thirty, fragile.",
    );
  }
  render();
}

function startAccessible() {
  if (machine.state.status !== "idle") {
    return;
  }
  showApplication();
  logicalNow = null;
  machine.dispatch({ type: "START", kind: "accessible", generation: 1 });
  render();
  elements.orbStage.focus();
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function startSimulation() {
  if (simulationRunning || machine.state.status !== "idle") {
    return;
  }
  simulationRunning = true;
  showApplication();
  logicalNow = 0;
  elements.assertiveStatus.textContent =
    "Deterministic simulation started. It will visibly use Orbit, Compass, and Tunnel.";
  for (const scripted of DETERMINISTIC_SCRIPT) {
    logicalNow = scripted.at;
    machine.dispatch(structuredClone(scripted));
    render();
    const important =
      scripted.type === "CONFIRM" ||
      scripted.type === "VOICE" ||
      scripted.type === "SENSOR_LOSS" ||
      scripted.type === "SENSOR_RECOVER" ||
      scripted.type === "CENTER";
    await sleep(important ? 210 : 70);
  }
  simulationRunning = false;
  elements.comparisonPanel.open = true;
  elements.assertiveStatus.textContent =
    "Exact task complete using all three modes, one sensor loss recovery, one wrong branch, and undo.";
  elements.app.dataset.simulationComplete = "true";
  render();
}

function handleSensorAim(sample) {
  if (
    !machine ||
    machine.state.sessionKind !== "live" ||
    machine.state.status === "paused" ||
    machine.state.freezeCauses.includes("user-stop")
  ) {
    return;
  }
  if (sample.zone === "center") {
    if (lastAimZone !== "center") {
      machine.dispatch({ type: "CENTER", source: "sensor-center", at: sample.at });
    }
    lastAimId = null;
    lastAimAt = sample.at;
    lastAimZone = "center";
    render();
    return;
  }

  const options = machine.state.options;
  if (!options.length) {
    return;
  }
  let angle = Math.atan2(sample.y - 0.5, sample.x - 0.5) + Math.PI / 2;
  if (angle < 0) {
    angle += Math.PI * 2;
  }
  const index = Math.floor((angle / (Math.PI * 2)) * options.length) % options.length;
  const id = options[index].id;
  if (id !== lastAimId || lastAimZone === "center") {
    machine.dispatch({ type: "HIGHLIGHT", id, source: "gaze", at: sample.at });
  } else if (lastAimAt !== null) {
    const durationMs = Math.max(0, sample.at - lastAimAt);
    if (durationMs <= 350) {
      machine.dispatch({ type: "DWELL", durationMs, at: sample.at });
    }
  }
  lastAimId = id;
  lastAimAt = sample.at;
  lastAimZone = "radial";
  render();
}

function handleSensorGesture(gesture) {
  if (!machine || machine.state.sessionKind !== "live") {
    return;
  }
  let result;
  if (gesture.type === "rotate" && machine.state.mode === "tunnel") {
    result = machine.dispatch({
      type: "CYCLE",
      delta: gesture.delta,
      source: "gesture",
      at: gesture.at,
    });
  } else if (gesture.type === "confirm") {
    result = machine.dispatch({
      type: "CONFIRM",
      source: "gesture",
      at: gesture.at,
    });
  }
  if (result?.ok) {
    sensorController?.announce(machine.state.announcement);
  }
  render();
}

function dispatchAndRender(action) {
  const result = machine.dispatch(action);
  if (result.effect === "export") {
    exportMetrics();
  }
  render();
  return result;
}

function fieldLabel(key) {
  return {
    action: "Intent",
    quantity: "Quantity",
    color: "Color",
    time: "Time",
    handling: "Handling",
    destination: "Destination",
    gate: "Gate",
    confirmed: "Confirmed",
    returnedHome: "Home",
  }[key];
}

function displayValue(value) {
  if (value === true) {
    return "yes";
  }
  if (value === false || value === null) {
    return "—";
  }
  return String(value);
}

function renderTask() {
  const signature = JSON.stringify(machine.state.task);
  if (signature === lastTaskSignature) {
    return;
  }
  lastTaskSignature = signature;
  elements.taskValues.replaceChildren();
  for (const [key, value] of Object.entries(machine.state.task)) {
    const item = document.createElement("li");
    const label = document.createElement("span");
    const current = document.createElement("strong");
    label.textContent = fieldLabel(key);
    current.textContent = displayValue(value);
    item.append(label, current);
    elements.taskValues.append(item);
  }
}

function renderChoices() {
  const signature = `${machine.state.mode}:${machine.state.options
    .map((candidate) => candidate.id)
    .join("|")}`;
  if (signature !== lastChoiceSignature) {
    lastChoiceSignature = signature;
    elements.choiceLayer.replaceChildren();
    for (const candidate of machine.state.options) {
      const button = document.createElement("button");
      const title = document.createElement("strong");
      const detail = document.createElement("small");
      button.type = "button";
      button.className = "choice";
      button.dataset.optionId = candidate.id;
      button.setAttribute(
        "aria-label",
        `${candidate.label}. ${candidate.detail}. Highlight only; separate confirmation required.`,
      );
      title.textContent = candidate.label;
      detail.textContent = candidate.detail;
      button.append(title, detail);
      button.addEventListener("click", () => {
        dispatchAndRender({
          type: "HIGHLIGHT",
          id: candidate.id,
          source: "touch",
        });
      });
      elements.choiceLayer.append(button);
    }
    requestAnimationFrame(layoutChoices);
  }

  for (const button of elements.choiceLayer.querySelectorAll(".choice")) {
    const highlighted = button.dataset.optionId === machine.state.highlight;
    button.dataset.highlighted = String(highlighted);
    button.dataset.armed = String(highlighted && machine.state.armed);
    button.setAttribute("aria-pressed", String(highlighted));
  }
}

function layoutChoices() {
  if (elements.app.hidden) {
    return;
  }
  const buttons = [...elements.choiceLayer.querySelectorAll(".choice")];
  const width = elements.orbStage.getBoundingClientRect().width;
  if (!width || !buttons.length) {
    return;
  }
  const radius =
    width * (machine.state.mode === "tunnel" ? 0.335 : machine.state.mode === "orbit" ? 0.34 : 0.35);
  buttons.forEach((button, index) => {
    const angle = -Math.PI / 2 + (index / buttons.length) * Math.PI * 2;
    button.style.setProperty("--x", `${Math.cos(angle) * radius}px`);
    button.style.setProperty("--y", `${Math.sin(angle) * radius}px`);
  });
}

function renderEvents() {
  const recent = machine.state.events.slice(-8);
  const signature = recent.map((event) => `${event.seq}:${event.type}`).join("|");
  if (signature === lastEventSignature) {
    return;
  }
  lastEventSignature = signature;
  elements.eventTrace.replaceChildren();
  for (const event of recent.toReversed()) {
    const item = document.createElement("li");
    item.textContent = `${String(event.atMs).padStart(4, "0")} ms · ${event.type}`;
    item.dataset.important = String(
      /confirmed|mode\.changed|sensor\.loss|history\.undo|center\.rest/.test(event.type),
    );
    elements.eventTrace.append(item);
  }
}

function renderModeStats(record) {
  const signature = JSON.stringify(record.metrics.perMode);
  if (signature === lastModeStatsSignature) {
    return;
  }
  lastModeStatsSignature = signature;
  elements.modeStats.replaceChildren();
  for (const mode of ["orbit", "compass", "tunnel"]) {
    const data = record.metrics.perMode[mode];
    const card = document.createElement("div");
    const title = document.createElement("strong");
    const detail = document.createElement("span");
    card.className = "mode-stat";
    title.textContent = grammarCopy[mode].title;
    detail.textContent = `${data.dwellMs} ms dwell · ${data.confirmations} confirmations · ${data.activeMs} ms active`;
    card.append(title, detail);
    elements.modeStats.append(card);
  }
}

function render() {
  const state = machine.state;
  const record = machine.exportRecord(sessionNow());
  const grammar = grammarCopy[state.mode];
  const stage = stageCopy[state.stage];
  const shape = choiceShapeForState(state);

  elements.modeStatus.textContent = `${grammar.title} · ${
    state.modePreference === "auto" ? "auto" : "spoken/manual"
  }`;
  elements.modeStatus.dataset.active = "true";
  elements.sensorStatus.textContent =
    state.sessionKind === "accessible"
      ? "Sensor-free"
      : state.freezeCauses.length
        ? "Sensor safety freeze"
        : `${state.sensors.camera} camera`;
  elements.grammarTitle.textContent = grammar.title;
  elements.grammarDescription.textContent = grammar.description;
  elements.cameraState.textContent = state.sensors.camera;
  elements.microphoneState.textContent = state.sensors.microphone;
  elements.speechState.textContent = state.sensors.speech;
  elements.estimatorState.textContent = state.sensors.estimatorLabel;

  const now = sessionNow();
  const ages = ["frameAt", "contentAt", "processedAt"].map((signal) =>
    state.sensors[signal] === null ? "—" : `${Math.max(0, Math.round(now - state.sensors[signal]))}`,
  );
  elements.freshnessState.textContent =
    state.sessionKind === "accessible"
      ? "Freshness: not required in sensor-free access"
      : `Freshness ms · frame ${ages[0]} · content ${ages[1]} · estimate ${ages[2]}`;

  elements.safetyBanner.dataset.frozen = String(state.freezeCauses.length > 0);
  elements.safetyTitle.textContent = state.freezeCauses.length
    ? "Confirmation frozen."
    : "Safe to explore.";
  elements.safetyDetail.textContent = state.freezeCauses.length
    ? `Independent causes: ${state.freezeCauses.join(", ")}. Stop, cancel, undo, and sensor-free access remain.`
    : "Gaze highlights; explicit voice, gesture, keyboard, touch, or switch confirms.";

  elements.stageKicker.textContent = `${stage[0]} · ${shape.breadth} choices`;
  elements.stageTitle.textContent = stage[1];
  elements.orbStage.className = `orb-stage mode-${state.mode}`;
  for (const meter of elements.modeMeter.querySelectorAll("[data-mode-meter]")) {
    meter.dataset.active = String(meter.dataset.modeMeter === state.mode);
  }

  elements.caption.textContent = state.announcement;
  elements.orbLabel.textContent = state.armed ? "RELAX" : "REST";
  elements.orbSubLabel.textContent = state.armed ? "cancel armed choice" : "center cancels";
  const target = DWELL_TARGET_MS[state.mode];
  const percentage = Math.min(100, Math.round((state.dwellMs / target) * 100));
  elements.dwellRing.style.setProperty("--dwell", `${percentage}%`);

  elements.modeTransitions.textContent = String(state.metrics.modeTransitions.length);
  elements.falseCommits.textContent = String(state.metrics.falseCommits);
  elements.centerCancels.textContent = String(state.metrics.centerCancels);
  elements.voiceRepairs.textContent = String(state.metrics.voiceRepairs);
  elements.sensorRecovery.textContent = `${state.metrics.sensorLosses} / ${state.metrics.sensorRecoveries}`;
  elements.confirmChoice.disabled = !state.highlight || !state.armed;
  elements.undoChoice.disabled = state.history.length === 0;
  elements.resumeSession.disabled = !state.freezeCauses.includes("user-stop");

  renderTask();
  renderChoices();
  renderEvents();
  renderModeStats(record);
  sensorController?.setArmed(state.armed && state.freezeCauses.length === 0);

  const comparisonSignature = JSON.stringify({
    exact: record.exactTaskVerdict,
    complete: record.complete,
    completion: record.metrics.completionTimeMs,
    falseCommits: record.metrics.falseCommits,
    sensorLosses: record.metrics.sensorLosses,
    sensorRecoveries: record.metrics.sensorRecoveries,
  });
  if (comparisonSignature !== lastComparisonSignature) {
    lastComparisonSignature = comparisonSignature;
    renderTournamentComparison(elements.comparisonTable, record);
  }
}

function exportMetrics() {
  const record = machine.exportRecord(sessionNow());
  const blob = new Blob([`${JSON.stringify(record, null, 2)}\n`], {
    type: "application/json",
  });
  const localUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = localUrl;
  anchor.download = `adaptive-orb-${record.sessionKind || "session"}-metrics.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(localUrl), 0);
}

function continueSensorFree(source) {
  sensorController?.stop("sensor-free transition");
  sensorController = null;
  machine.dispatch({ type: "ACCESSIBLE", source });
  machine.dispatch({ type: "RESUME", source });
  render();
  elements.orbStage.focus();
}

function stopSession(source) {
  machine.dispatch({ type: "STOP", source });
  sensorController?.stop("safety stop");
  sensorController = null;
  render();
}

elements.startLive.addEventListener("click", startLive);
elements.startAccessible.addEventListener("click", startAccessible);
elements.startSimulation.addEventListener("click", startSimulation);
elements.previousChoice.addEventListener("click", () =>
  dispatchAndRender({ type: "CYCLE", delta: -1, source: "touch" }),
);
elements.nextChoice.addEventListener("click", () =>
  dispatchAndRender({ type: "CYCLE", delta: 1, source: "switch" }),
);
elements.confirmChoice.addEventListener("click", () =>
  dispatchAndRender({ type: "CONFIRM", source: "touch" }),
);
elements.restChoice.addEventListener("click", () =>
  dispatchAndRender({ type: "CENTER", source: "touch" }),
);
elements.centerOrb.addEventListener("click", () =>
  dispatchAndRender({ type: "CENTER", source: "center-orb" }),
);
elements.undoChoice.addEventListener("click", () =>
  dispatchAndRender({ type: "UNDO", source: "touch" }),
);
elements.exportMetrics.addEventListener("click", exportMetrics);
elements.useAccessible.addEventListener("click", () => continueSensorFree("touch"));
elements.stopSensors.addEventListener("click", () => continueSensorFree("end-sensors"));
elements.resumeSession.addEventListener("click", () => continueSensorFree("resume"));

document.addEventListener("keydown", (event) => {
  if (elements.app.hidden || simulationRunning) {
    return;
  }
  const interactive = event.target.closest?.(
    "button, a, summary, input, select, textarea",
  );
  if (interactive && event.target !== elements.orbStage) {
    return;
  }
  const key = event.key.toLowerCase();
  let action = null;
  if (event.key === "ArrowLeft") {
    action = { type: "CYCLE", delta: -1, source: "keyboard" };
  } else if (event.key === "ArrowRight") {
    action = { type: "CYCLE", delta: 1, source: "keyboard" };
  } else if (event.key === "Enter" || event.key === " ") {
    action = { type: "CONFIRM", source: "keyboard" };
  } else if (event.key === "Escape" || event.key === "Backspace") {
    action = { type: "CENTER", source: "keyboard" };
  } else if (key === "u") {
    action = { type: "UNDO", source: "keyboard" };
  } else if (key === "s") {
    event.preventDefault();
    stopSession("keyboard");
    return;
  } else if (key === "o") {
    action = { type: "SWITCH_MODE", mode: "orbit", source: "keyboard" };
  } else if (key === "c") {
    action = { type: "SWITCH_MODE", mode: "compass", source: "keyboard" };
  } else if (key === "t") {
    action = { type: "SWITCH_MODE", mode: "tunnel", source: "keyboard" };
  }
  if (action) {
    event.preventDefault();
    dispatchAndRender(action);
  }
});

window.addEventListener("resize", layoutChoices);
document.addEventListener("visibilitychange", () => {
  if (document.hidden && machine.state.status !== "idle") {
    machine.dispatch({ type: "CENTER", source: "visibility" });
    render();
  }
});
window.addEventListener("pagehide", () => {
  if (machine.state.status !== "idle") {
    machine.dispatch({ type: "PAGEHIDE", source: "pagehide" });
  }
  sensorController?.stop("pagehide");
  sensorController = null;
});
window.addEventListener("pageshow", (event) => {
  if (event.persisted) {
    window.location.reload();
  }
});

const query = new URLSearchParams(window.location.search);
if (query.get("simulate") === "1") {
  requestAnimationFrame(startSimulation);
}
