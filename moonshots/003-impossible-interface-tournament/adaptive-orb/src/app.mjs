import { AI_SCENARIOS, AdaptiveAIAdapter, createEphemeralSessionId } from "./ai.mjs";
import { AdaptiveOrbMachine, CONVERSATION_DETERMINISTIC_SCRIPT, DWELL_TARGET_MS, EXPECTED_CONVERSATION_FINGERPRINT, choiceShapeForState, conversationFingerprintFor, dispatchDeterministicStep, verifyConversationRecord } from "./core.mjs";
import { AdaptiveSensorController } from "./sensors.mjs";
import { RadialAimCoordinator, performSensorFreeTransition } from "./session.mjs";
import { renderTournamentComparison } from "./comparison.mjs";

const byId = (id) => document.getElementById(id);
const elements = {
  launchScreen: byId("launchScreen"),
  app: byId("app"),
  startLive: byId("startLive"),
  startAccessible: byId("startAccessible"),
  startSimulation: byId("startSimulation"),
  modeStatus: byId("modeStatus"),
  aiStatus: byId("aiStatus"),
  pwaStatus: byId("pwaStatus"),
  sensorStatus: byId("sensorStatus"),
  safetyBanner: byId("safetyBanner"),
  safetyTitle: byId("safetyTitle"),
  safetyDetail: byId("safetyDetail"),
  taskValues: byId("taskValues"),
  responseKicker: byId("responseKicker"),
  responseTitle: byId("responseTitle"),
  responseText: byId("responseText"),
  conversationLandmarks: byId("conversationLandmarks"),
  speakResponse: byId("speakResponse"),
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
  conversationTurns: byId("conversationTurns"),
  aiResponses: byId("aiResponses"),
  falseCommits: byId("falseCommits"),
  centerCancels: byId("centerCancels"),
  voiceRepairs: byId("voiceRepairs"),
  sensorRecovery: byId("sensorRecovery"),
  eventTrace: byId("eventTrace"),
  modeStats: byId("modeStats"),
  comparisonTable: byId("comparisonTable"),
  comparisonPanel: byId("comparisonPanel"),
  exportMetrics: byId("exportMetrics"),
  companionMode: byId("companionMode"),
  installApp: byId("installApp"),
  applyUpdate: byId("applyUpdate"),
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
      "Nested explanations, revisions, tools, and route layers remain in one history. Coarse motion navigates; a nod or spoken confirmation chooses.",
  },
};

const stageCopy = {
  intent: ["Broad intent · depth 0", "Speak or choose an AI scenario"],
  destination: ["Stable choices · depth 1", "Select destination"],
  gate: ["Stable choices · depth 1", "Select gate"],
  review: ["Nested review · depth 3", "Traverse and review"],
  home: ["Nested completion · depth 4", "Return home"],
  complete: ["Exact task verdict", "Task complete"],
};

const startupQuery = new URLSearchParams(window.location.search);
const ephemeralSessionId = createEphemeralSessionId();
const aiAdapter = new AdaptiveAIAdapter();
let logicalNow = null;
let machine = createMachine();
let sensorController = null;
const aimCoordinator = new RadialAimCoordinator();
let lastChoiceSignature = "";
let lastTaskSignature = "";
let lastConversationSignature = "";
let lastEventSignature = "";
let lastComparisonSignature = "";
let lastModeStatsSignature = "";
let simulationRunning = false;
let replayLocked = startupQuery.get("simulate") === "1";
let sensorTransitioning = false;
let preferCompanion = startupQuery.get("companion") === "1";
let deferredInstallPrompt = null;
let waitingServiceWorker = null;
let reloadingForWorker = false;
let applyingServiceWorkerUpdate = false;
let activeAIAbort = null;

function sessionNow() {
  return logicalNow === null ? performance.now() : logicalNow;
}

function createMachine() {
  return new AdaptiveOrbMachine({
    clock: () => sessionNow(),
    sessionId: ephemeralSessionId,
  });
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
        return { ok: false, effect: "ignored" };
      }
      const result = machine.dispatch(action);
      aimCoordinator.synchronize(machine.state);
      if (!sensorTransitioning) {
        render();
      }
      return result;
    },
    onAim: handleSensorAim,
    onGesture: handleSensorGesture,
    onSpeech(text) {
      if (replayLocked) {
        return;
      }
      const result = dispatchAndRender({
        type: "VOICE",
        text,
        source: "voice",
      });
      if (!["access-request", "ai-request"].includes(result.effect)) {
        sensorController?.announce(machine.state.announcement);
      }
    },
    onCaption(text) {
      elements.caption.textContent = text;
    },
  });
}

async function startLive() {
  if (replayLocked || machine.state.status !== "idle") {
    return;
  }
  showApplication();
  logicalNow = null;
  machine.dispatch({ type: "START", kind: "live", generation: 1 });
  sensorController = createSensorController();
  render();
  const started = await sensorController.start();
  if (!started) {
    transitionToSensorFree("startup-fallback");
    elements.assertiveStatus.textContent =
      "Sensors unavailable. Sensor-free controls are active with the same task.";
  } else {
    sensorController.announce(
      "Adaptive Orb ready. Ask me to create, plan, explain, or navigate. Say a mode name at any time.",
    );
  }
  render();
}

function startAccessible() {
  if (replayLocked || machine.state.status !== "idle") {
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
  if (
    simulationRunning ||
    machine.state.status !== "idle" ||
    (replayLocked && startupQuery.get("simulate") !== "1")
  ) {
    return;
  }
  simulationRunning = true;
  replayLocked = true;
  showApplication();
  logicalNow = 0;
  elements.assertiveStatus.textContent =
    "Deterministic multi-turn AI conversation started across Orbit, Compass, and Tunnel.";
  for (let index = 0; index < CONVERSATION_DETERMINISTIC_SCRIPT.length; index += 1) {
    const scripted = CONVERSATION_DETERMINISTIC_SCRIPT[index];
    logicalNow = scripted.at;
    dispatchDeterministicStep(machine, scripted);
    if (index < CONVERSATION_DETERMINISTIC_SCRIPT.length - 1) {
      render();
    }
    const important =
      scripted.type === "CONFIRM" ||
      scripted.type === "VOICE" ||
      scripted.type === "SENSOR_LOSS" ||
      scripted.type === "SENSOR_RECOVER" ||
      scripted.type === "CENTER";
    await sleep(important ? 210 : 70);
  }
  simulationRunning = false;
  const record = machine.exportRecord(logicalNow);
  record.conversationFingerprint = conversationFingerprintFor(record);
  const verified =
    record.conversationFingerprint === EXPECTED_CONVERSATION_FINGERPRINT &&
    verifyConversationRecord(record);
  if (verified) {
    machine.state.announcement =
      `Verified AI conversation replay ${EXPECTED_CONVERSATION_FINGERPRINT}. All three modes and the exact cobalt task passed.`;
    elements.comparisonPanel.open = true;
    elements.assertiveStatus.textContent =
      "Verified one multi-turn AI conversation across all scenarios and modes, plus the exact reversible cobalt task.";
    elements.app.dataset.simulationComplete = "true";
    elements.app.dataset.replayFingerprint = record.conversationFingerprint;
  } else {
    machine.state.announcement =
      `Replay verification failed. Expected ${EXPECTED_CONVERSATION_FINGERPRINT}; no success is claimed.`;
    elements.assertiveStatus.textContent = machine.state.announcement;
    elements.app.dataset.simulationComplete = "false";
  }
  render();
}

function speakCurrentResponse() {
  const text = machine.state.conversation.currentResponse;
  if (!text || replayLocked) {
    return false;
  }
  if (sensorController) {
    sensorController.announce(text);
    return true;
  }
  if (
    typeof speechSynthesis === "undefined" ||
    typeof SpeechSynthesisUtterance === "undefined"
  ) {
    elements.assertiveStatus.textContent =
      "Speech synthesis is unavailable. The response remains visible.";
    return false;
  }
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 0.96;
  utterance.pitch = 1;
  speechSynthesis.speak(utterance);
  return true;
}

async function requestAIResponse(result) {
  if (
    replayLocked ||
    result.effect !== "ai-request" ||
    !result.request ||
    !Number.isInteger(result.requestId)
  ) {
    return;
  }
  activeAIAbort?.abort();
  const controller = new AbortController();
  activeAIAbort = controller;
  const companionRequested = preferCompanion;
  if (companionRequested) {
    machine.dispatch({
      type: "AI_PROVIDER_ATTEMPT",
      provider: "brainstem",
      at: sessionNow(),
    });
  }
  try {
    const response = await aiAdapter.respond(result.request, {
      preferCompanion: companionRequested,
      scenarioHint: result.scenario,
      signal: controller.signal,
    });
    if (controller.signal.aborted || replayLocked) {
      return;
    }
    const accepted = machine.dispatch({
      type: "AI_RESPONSE",
      requestId: result.requestId,
      response,
      companionAttempted: companionRequested,
      at: sessionNow(),
    });
    if (accepted.ok) {
      render();
      if (machine.state.sessionKind === "live") {
        sensorController?.announce(machine.state.conversation.currentResponse);
      }
    }
  } catch {
    if (!controller.signal.aborted) {
      elements.assertiveStatus.textContent =
        "AI response could not be validated. Conversation state was preserved.";
    }
  } finally {
    if (activeAIAbort === controller) {
      activeAIAbort = null;
    }
  }
}

function handleSensorAim(sample) {
  if (!machine || replayLocked) {
    return;
  }
  const result = aimCoordinator.handle(machine, sample);
  if (result.changed) {
    render();
  }
}

function handleSensorGesture(gesture) {
  if (!machine || machine.state.sessionKind !== "live" || replayLocked) {
    return;
  }
  let result;
  if (gesture.type === "rotate" && machine.state.mode === "tunnel") {
    result = dispatchAndRender({
      type: "CYCLE",
      delta: gesture.delta,
      source: "gesture",
      at: gesture.at,
    });
  } else if (
    gesture.type === "confirm" &&
    gesture.choiceId === machine.state.highlight
  ) {
    result = dispatchAndRender({
      type: "CONFIRM",
      source: "gesture",
      at: gesture.at,
    });
  }
  if (
    result?.ok &&
    !["access-request", "ai-request"].includes(result.effect)
  ) {
    sensorController?.announce(machine.state.announcement);
  }
}

function dispatchAndRender(action) {
  if (replayLocked) {
    return {
      ok: false,
      effect: "replay-rejected",
      reason: "deterministic-replay-locked",
    };
  }
  if (["STOP", "CANCEL", "UNDO"].includes(action.type)) {
    activeAIAbort?.abort();
    activeAIAbort = null;
  }
  const result = machine.dispatch(action);
  if (result.effect === "access-request") {
    transitionToSensorFree(action.source || "access-option");
    return result;
  }
  if (result.effect === "export") {
    exportMetrics();
  }
  if (
    ["CENTER", "SWITCH_MODE", "AUTO_MODE", "STOP", "CANCEL", "UNDO"].includes(
      action.type,
    ) ||
    machine.state.freezeCauses.length
  ) {
    aimCoordinator.reset();
  } else {
    aimCoordinator.synchronize(machine.state);
  }
  if (result.effect === "stop") {
    sensorController?.stop("safety stop");
    sensorController = null;
  }
  render();
  if (result.effect === "ai-request") {
    void requestAIResponse(result);
  }
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
  const conversation = machine.state.conversation;
  const signature = JSON.stringify({
    task: machine.state.task,
    scenario: conversation.scenario,
    turns: conversation.turns.length,
    branch: conversation.branchPath,
    provider: conversation.provider,
  });
  if (signature === lastTaskSignature) {
    return;
  }
  lastTaskSignature = signature;
  elements.taskValues.replaceChildren();
  const values = [
    ["Scenario", conversation.scenario || "choose"],
    ["Turns", conversation.turns.length],
    ["Branch", conversation.branchPath.at(-1) || "root"],
    ["AI", conversation.provider],
    ...Object.entries(machine.state.task)
      .filter(([, value]) => value !== null && value !== false)
      .map(([key, value]) => [fieldLabel(key), displayValue(value)]),
  ];
  for (const [key, value] of values) {
    const item = document.createElement("li");
    const label = document.createElement("span");
    const current = document.createElement("strong");
    label.textContent = key;
    current.textContent = displayValue(value);
    item.append(label, current);
    elements.taskValues.append(item);
  }
}

function renderConversation() {
  const conversation = machine.state.conversation;
  const recent = conversation.turns.slice(-6);
  const signature = JSON.stringify({
    pending: conversation.pending,
    scenario: conversation.scenario,
    response: conversation.currentResponse,
    provider: conversation.provider,
    degraded: conversation.degraded,
    notice: conversation.notice,
    recent: recent.map((turn) => [
      turn.role,
      turn.semantic,
      turn.scenario,
      turn.mode,
    ]),
  });
  if (signature === lastConversationSignature) {
    return;
  }
  lastConversationSignature = signature;
  const scenario = conversation.scenario
    ? AI_SCENARIOS[conversation.scenario]
    : null;
  elements.responseKicker.textContent =
    `${conversation.provider === "brainstem" ? "RAPP Brainstem" : "Offline demo AI"} · memory-only`;
  elements.responseTitle.textContent = conversation.pending
    ? `Preparing ${scenario?.title || "AI"} response`
    : scenario
      ? `${scenario.title} · adaptive response`
      : "Choose a scenario or speak broadly";
  elements.responseText.textContent =
    conversation.currentResponse ||
    "Demo AI is ready offline. Voice Orbit will turn broad intent into predicted response and action petals.";
  elements.conversationLandmarks.replaceChildren();
  for (const [index, turn] of recent.entries()) {
    const item = document.createElement("li");
    const role = turn.role === "assistant" ? "AI" : "You";
    item.textContent =
      `${role} · ${turn.semantic} · ${turn.mode || "orbit"}`;
    item.dataset.role = turn.role;
    item.style.setProperty("--turn-index", String(index));
    elements.conversationLandmarks.append(item);
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
      button.disabled = replayLocked || machine.state.conversation.pending;
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
    button.disabled = replayLocked || machine.state.conversation.pending;
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
  for (const event of [...recent].reverse()) {
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
  aimCoordinator.synchronize(state);
  const record = machine.exportRecord(sessionNow());
  const grammar = grammarCopy[state.mode];
  const stage =
    state.conversation.focused
      ? [
          `${state.conversation.scenario || "Scenario"} conversation · depth ${state.conversation.shape.depth}`,
          state.conversation.pending
            ? "AI response pending"
            : `${AI_SCENARIOS[state.conversation.scenario]?.title || "Choose"} response petals`,
        ]
      : state.stage === "intent" && state.entryStep
      ? [
          `Semantic entry · ${state.entryStep}`,
          `Select ${state.entryStep}`,
        ]
      : stageCopy[state.stage];
  const shape = choiceShapeForState(state);

  elements.modeStatus.textContent = `${grammar.title} · ${
    state.modePreference === "auto" ? "auto" : "spoken/manual"
  }`;
  elements.modeStatus.dataset.active = "true";
  elements.aiStatus.textContent = state.conversation.degraded
    ? "Companion unavailable · demo AI"
    : state.conversation.provider === "brainstem"
      ? "RAPP Brainstem · same origin"
      : "Demo AI · offline";
  elements.aiStatus.dataset.active = String(state.conversation.provider === "brainstem");
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
  elements.conversationTurns.textContent = String(state.conversation.turns.length);
  elements.aiResponses.textContent =
    `${state.conversation.metrics.responses} / ${state.conversation.metrics.failovers}`;
  elements.falseCommits.textContent = String(state.metrics.falseCommits);
  elements.centerCancels.textContent = String(state.metrics.centerCancels);
  elements.voiceRepairs.textContent = String(state.metrics.voiceRepairs);
  elements.sensorRecovery.textContent = `${state.metrics.sensorLosses} / ${state.metrics.sensorRecoveries}`;
  elements.confirmChoice.disabled =
    state.conversation.pending || !state.highlight || !state.armed;
  elements.undoChoice.disabled = state.history.length === 0;
  elements.resumeSession.disabled = !state.freezeCauses.includes("user-stop");
  elements.speakResponse.disabled = !state.conversation.currentResponse;
  elements.companionMode.textContent = preferCompanion
    ? "AI: prefer companion"
    : "AI: offline demo";
  if (replayLocked) {
    for (const control of [
      elements.previousChoice,
      elements.nextChoice,
      elements.confirmChoice,
      elements.restChoice,
      elements.undoChoice,
      elements.centerOrb,
      elements.speakResponse,
      elements.companionMode,
      elements.installApp,
      elements.applyUpdate,
      elements.exportMetrics,
      elements.useAccessible,
      elements.stopSensors,
      elements.resumeSession,
    ]) {
      control.disabled = true;
    }
  }

  renderTask();
  renderConversation();
  renderChoices();
  renderEvents();
  renderModeStats(record);
  sensorController?.setArmed(
    state.armed && state.freezeCauses.length === 0,
    state.highlight,
  );

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
  if (replayLocked) {
    return false;
  }
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
  return true;
}

function transitionToSensorFree(source, { resume = false } = {}) {
  if (replayLocked) {
    return {
      ok: false,
      effect: "replay-rejected",
      reason: "deterministic-replay-locked",
    };
  }
  sensorTransitioning = true;
  const transition = performSensorFreeTransition({
    machine,
    controller: sensorController,
    source,
    at: sessionNow(),
    resume,
  });
  sensorController = transition.controller;
  sensorTransitioning = false;
  aimCoordinator.reset();
  render();
  elements.orbStage.focus();
  return transition.result;
}

function stopSession(source) {
  return dispatchAndRender({ type: "STOP", source });
}

function toggleCompanion() {
  if (replayLocked) {
    return;
  }
  preferCompanion = !preferCompanion;
  machine.state.conversation.notice = preferCompanion
    ? "Companion preferred. The next AI turn will use same-origin /api/chat and fail over safely."
    : "Offline deterministic demo AI selected. No application AI request will be made.";
  machine.state.announcement = machine.state.conversation.notice;
  elements.assertiveStatus.textContent = machine.state.conversation.notice;
  render();
}

async function promptInstall() {
  if (deferredInstallPrompt) {
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    elements.installApp.disabled = true;
    return;
  }
  byId("installHelp").open = true;
  elements.assertiveStatus.textContent =
    "On iPhone or iPad, use Safari Share, then Add to Home Screen.";
}

function offerServiceWorkerUpdate(worker) {
  waitingServiceWorker = worker;
  elements.applyUpdate.hidden = false;
  elements.pwaStatus.textContent = "App update ready";
}

async function registerOfflineApp() {
  if (!("serviceWorker" in navigator)) {
    elements.pwaStatus.textContent = "Offline install unavailable";
    return;
  }
  try {
    const registration = await navigator.serviceWorker.register(
      "./service-worker.js",
      {
        scope: "./",
        updateViaCache: "none",
      },
    );
    elements.pwaStatus.textContent = navigator.standalone
      ? "Installed · offline shell"
      : "Offline shell ready";
    if (registration.waiting) {
      offerServiceWorkerUpdate(registration.waiting);
    }
    registration.addEventListener("updatefound", () => {
      const installing = registration.installing;
      installing?.addEventListener("statechange", () => {
        if (
          installing.state === "installed" &&
          navigator.serviceWorker.controller
        ) {
          offerServiceWorkerUpdate(installing);
        }
      });
    });
  } catch {
    elements.pwaStatus.textContent = "Online only · install help available";
  }
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
elements.speakResponse.addEventListener("click", speakCurrentResponse);
elements.companionMode.addEventListener("click", toggleCompanion);
elements.installApp.addEventListener("click", promptInstall);
elements.applyUpdate.addEventListener("click", () => {
  applyingServiceWorkerUpdate = true;
  waitingServiceWorker?.postMessage({ type: "ACTIVATE_UPDATE" });
});
elements.useAccessible.addEventListener("click", () => transitionToSensorFree("touch"));
elements.stopSensors.addEventListener("click", () => transitionToSensorFree("end-sensors"));
elements.resumeSession.addEventListener("click", () => {
  if (machine.state.sessionKind === "live" && !sensorController) {
    transitionToSensorFree("resume", { resume: true });
  } else {
    dispatchAndRender({ type: "RESUME", source: "touch" });
  }
});

document.addEventListener("keydown", (event) => {
  if (elements.app.hidden || simulationRunning || replayLocked) {
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
window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  elements.installApp.disabled = false;
  elements.pwaStatus.textContent = "Install available";
});
window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
  elements.installApp.disabled = true;
  elements.pwaStatus.textContent = "Installed · offline shell";
});
navigator.serviceWorker?.addEventListener("controllerchange", () => {
  if (applyingServiceWorkerUpdate && !reloadingForWorker) {
    reloadingForWorker = true;
    window.location.reload();
  }
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden && machine.state.status !== "idle") {
    machine.dispatch({ type: "CENTER", source: "visibility" });
    render();
  }
});
window.addEventListener("pagehide", () => {
  activeAIAbort?.abort();
  activeAIAbort = null;
  if (typeof speechSynthesis !== "undefined") {
    speechSynthesis.cancel();
  }
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

void registerOfflineApp();

if (startupQuery.get("simulate") === "1") {
  elements.startLive.disabled = true;
  elements.startAccessible.disabled = true;
  elements.startSimulation.disabled = true;
  requestAnimationFrame(startSimulation);
}
