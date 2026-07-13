import { AI_SCENARIOS, AdaptiveAIAdapter, createEphemeralSessionId } from "./ai.mjs";
import { buildBrowserLaunchUrl, describeRuntimeCapabilities, detectRuntimeCapabilities } from "./capabilities.mjs";
import { AdaptiveOrbMachine, CONVERSATION_DETERMINISTIC_SCRIPT, DWELL_TARGET_MS, EXPECTED_CONVERSATION_FINGERPRINT, choiceShapeForState, conversationFingerprintFor, dispatchDeterministicStep, verifyConversationRecord } from "./core.mjs";
import { AdaptiveSensorController } from "./sensors.mjs";
import {
  RadialAimCoordinator,
  cancelGlobalSpeech,
  performSensorFreeTransition,
} from "./session.mjs";
import { renderTournamentComparison } from "./comparison.mjs";
import {
  applyChoicePresentation,
  choicePresentation,
  exactChoiceSignature,
} from "./choices.mjs";
import {
  MobileFeedback,
  MobileMetricsTracker,
  phoneChoiceWindow,
  radialChoiceGeometry,
  shortSpokenSummary,
} from "./mobile.mjs";

const byId = (id) => document.getElementById(id);
const elements = {
  launchScreen: byId("launchScreen"),
  app: byId("app"),
  startAccessible: byId("startAccessible"),
  startSimulation: byId("startSimulation"),
  launchCapability: byId("launchCapability"),
  launchCapabilityTitle: byId("launchCapabilityTitle"),
  launchCapabilityDetail: byId("launchCapabilityDetail"),
  launchSafariAction: byId("launchSafariAction"),
  launchSafariLink: byId("launchSafariLink"),
  modeStatus: byId("modeStatus"),
  aiStatus: byId("aiStatus"),
  pwaStatus: byId("pwaStatus"),
  sensorStatus: byId("sensorStatus"),
  safetyBanner: byId("safetyBanner"),
  safetyTitle: byId("safetyTitle"),
  safetyDetail: byId("safetyDetail"),
  runtimeCapability: byId("runtimeCapability"),
  runtimeCapabilityTitle: byId("runtimeCapabilityTitle"),
  runtimeCapabilityDetail: byId("runtimeCapabilityDetail"),
  runtimeSafariAction: byId("runtimeSafariAction"),
  runtimeSafariLink: byId("runtimeSafariLink"),
  permissionPanel: byId("permissionPanel"),
  permissionStatus: byId("permissionStatus"),
  permissionMic: byId("permissionMic"),
  permissionCamera: byId("permissionCamera"),
  capabilitySensorFree: byId("capabilitySensorFree"),
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
  mobileChoicePage: byId("mobileChoicePage"),
  mobileRepeat: byId("mobileRepeat"),
  mobileWhatChanged: byId("mobileWhatChanged"),
  mobileUndo: byId("mobileUndo"),
  mobileStop: byId("mobileStop"),
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
  glanceProxy: byId("glanceProxy"),
  touchFallback: byId("touchFallback"),
  interruptionRecovery: byId("interruptionRecovery"),
  permissionValue: byId("permissionValue"),
  sensorOnTime: byId("sensorOnTime"),
  eventTrace: byId("eventTrace"),
  modeStats: byId("modeStats"),
  comparisonTable: byId("comparisonTable"),
  comparisonPanel: byId("comparisonPanel"),
  exportMetrics: byId("exportMetrics"),
  companionMode: byId("companionMode"),
  hapticToggle: byId("hapticToggle"),
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
const mobileMetrics = new MobileMetricsTracker({
  clock: () => performance.now(),
});
const mobileFeedback = new MobileFeedback({
  onHaptic: () => mobileMetrics.noteHaptic(),
});
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
let liveStartFailed = false;
let runtimeSensorIssues = new Set();
let runtimeCapabilities = detectRuntimeCapabilities();
let capabilityPresentation = null;
let microphonePermissionAttempted = !runtimeCapabilities.speechRecognitionApi;
let sensorPermissionBusy = false;
let visibleChoiceIds = [];
let interruptionPending = false;
let lastOrientation =
  window.innerWidth > window.innerHeight ? "landscape" : "portrait";

function sessionNow() {
  return logicalNow === null ? performance.now() : logicalNow;
}

function createMachine() {
  return new AdaptiveOrbMachine({
    clock: () => sessionNow(),
    sessionId: ephemeralSessionId,
  });
}

function refreshCapabilityGuidance({ recheck = true } = {}) {
  if (recheck) {
    runtimeCapabilities = detectRuntimeCapabilities();
  }
  capabilityPresentation = describeRuntimeCapabilities(runtimeCapabilities, {
    liveStartFailed,
    runtimeIssues: [...runtimeSensorIssues],
    browserLaunchUrl: buildBrowserLaunchUrl(),
  });

  elements.launchCapability.dataset.degraded = String(
    capabilityPresentation.degraded,
  );
  elements.launchCapabilityTitle.textContent = capabilityPresentation.title;
  elements.launchCapabilityDetail.textContent = capabilityPresentation.detail;
  elements.runtimeCapability.dataset.degraded = String(
    capabilityPresentation.degraded,
  );
  elements.runtimeCapability.hidden = !capabilityPresentation.degraded;
  elements.runtimeCapabilityTitle.textContent = capabilityPresentation.title;
  elements.runtimeCapabilityDetail.textContent = capabilityPresentation.detail;

  for (const [group, link] of [
    [elements.launchSafariAction, elements.launchSafariLink],
    [elements.runtimeSafariAction, elements.runtimeSafariLink],
  ]) {
    const showLink =
      capabilityPresentation.showSafariLink && !replayLocked;
    group.hidden = !showLink;
    if (showLink) {
      link.href = capabilityPresentation.browserLaunchUrl;
    } else {
      link.removeAttribute("href");
    }
  }

  const sessionStarted = machine.state.status !== "idle";
  const microphoneActive = machine.state.sensors.microphone === "active";
  const cameraActive = machine.state.sensors.camera === "active";
  elements.permissionMic.disabled =
    replayLocked ||
    sensorPermissionBusy ||
    !sessionStarted ||
    microphoneActive ||
    !runtimeCapabilities.liveSensorPrerequisites ||
    !runtimeCapabilities.speechRecognitionApi;
  elements.permissionMic.textContent = microphoneActive
    ? machine.state.sensors.speech === "active"
      ? "Voice enabled"
      : "Microphone enabled · voice starting"
    : !runtimeCapabilities.speechRecognitionApi
      ? "Voice unavailable · use controls"
      : "Enable voice · microphone";
  elements.permissionCamera.disabled =
    replayLocked ||
    sensorPermissionBusy ||
    !sessionStarted ||
    cameraActive ||
    !runtimeCapabilities.liveSensorPrerequisites ||
    !microphonePermissionAttempted;
  elements.permissionCamera.textContent = cameraActive
    ? "Front camera enabled"
    : "Then enable front camera";
  elements.capabilitySensorFree.disabled =
    replayLocked || (!sensorController && machine.state.sessionKind === "accessible");
  elements.capabilitySensorFree.textContent =
    !sensorController && machine.state.sessionKind === "accessible"
      ? "Sensor-free mode active"
      : "Use sensor-free mode";
  return capabilityPresentation;
}

function trackRuntimeSensorCapability(action) {
  let changed = false;
  if (action.type === "SENSOR_STATUS") {
    if (["denied", "unavailable"].includes(action.status)) {
      runtimeSensorIssues.add(action.sensor);
      changed = true;
    } else if (action.status === "active") {
      changed = runtimeSensorIssues.delete(action.sensor);
    }
  } else if (action.type === "SENSOR_LOSS" && action.sensor) {
    runtimeSensorIssues.add(action.sensor);
    changed = true;
  } else if (action.type === "SENSOR_RECOVER" && action.sensor) {
    changed = runtimeSensorIssues.delete(action.sensor);
  }
  if (changed) {
    refreshCapabilityGuidance({ recheck: false });
  }
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
    generationSeed: Math.max(0, machine.state.sensors.generation - 1),
    onAction(action) {
      if (!machine || machine.state.sessionKind === "simulation") {
        return { ok: false, effect: "ignored" };
      }
      const result = machine.dispatch(action);
      if (result.ok) {
        trackRuntimeSensorCapability(action);
      }
      if (
        action.type === "SENSOR_STATUS" &&
        ["microphone", "camera"].includes(action.sensor)
      ) {
        mobileMetrics.noteSensorStatus(action.sensor, action.status);
      }
      if (
        action.type === "SENSOR_LOSS" ||
        (action.type === "SENSOR_STATUS" &&
          ["denied", "lost", "muted", "failed"].includes(action.status))
      ) {
        elements.permissionStatus.textContent =
          "A live sensor was interrupted or revoked. Sensor-derived aim and confirmation are frozen; choose sensor-free mode or retry the optional permission.";
      }
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
        sensorController?.announce(
          shortSpokenSummary(machine.state.announcement),
        );
      }
    },
    onCaption(text) {
      elements.caption.textContent = text;
    },
  });
}

function startAccessible() {
  if (replayLocked || machine.state.status !== "idle") {
    return;
  }
  showApplication();
  logicalNow = null;
  machine.dispatch({ type: "START", kind: "accessible", generation: 1 });
  mobileMetrics.start();
  mobileFeedback.unlock();
  if (typeof navigator.vibrate === "function") {
    elements.hapticToggle.hidden = false;
  }
  render();
  refreshCapabilityGuidance({ recheck: false });
  elements.orbStage.focus();
}

async function enableMicrophone() {
  if (
    replayLocked ||
    sensorPermissionBusy ||
    machine.state.status === "idle"
  ) {
    return false;
  }
  sensorPermissionBusy = true;
  microphonePermissionAttempted = true;
  mobileMetrics.notePermissionRequest("microphone");
  elements.permissionStatus.textContent =
    "Requesting microphone for voice commands. Camera remains off.";
  refreshCapabilityGuidance();
  sensorController ||= createSensorController();
  const started = await sensorController.enableMicrophone();
  mobileMetrics.noteSensorStatus(
    "microphone",
    started ? "active" : "failed",
  );
  if (started) {
    elements.permissionStatus.textContent =
      "Voice commands enabled. Audio follows the browser/OS input route; no device ID is selected or stored.";
    elements.assertiveStatus.textContent =
      "Voice enabled. Say create, plan, explain, navigate, repeat, stop, undo, or a mode name.";
    mobileFeedback.signal("ready");
    elements.caption.textContent = "Ready tone · voice enabled.";
  } else {
    elements.permissionStatus.textContent =
      "Microphone or speech recognition unavailable. Full touch, keyboard, and switch controls remain; camera is still optional.";
    machine.dispatch({
      type: "SENSOR_STATUS",
      sensor: "microphone",
      status: "not-requested",
      at: sessionNow(),
    });
    if (!sensorController?.cameraStream) {
      sensorController?.stop("microphone unavailable");
      sensorController = null;
    }
  }
  sensorPermissionBusy = false;
  liveStartFailed = !started;
  refreshCapabilityGuidance({ recheck: false });
  render();
  return started;
}

async function enableCamera() {
  if (
    replayLocked ||
    sensorPermissionBusy ||
    machine.state.status === "idle" ||
    !microphonePermissionAttempted
  ) {
    return false;
  }
  sensorPermissionBusy = true;
  mobileMetrics.notePermissionRequest("camera");
  elements.permissionStatus.textContent =
    "Requesting the front camera for coarse, movement-tolerant aim and gestures.";
  refreshCapabilityGuidance();
  sensorController ||= createSensorController();
  const started = await sensorController.enableCamera();
  mobileMetrics.noteSensorStatus("camera", started ? "active" : "failed");
  if (started) {
    elements.permissionStatus.textContent =
      "Front camera enabled. Frames remain ephemeral; front-camera coordinates are mirrored only when the browser reports user-facing capture.";
    elements.assertiveStatus.textContent =
      "Camera gesture input enabled. Gaze-like motion highlights only; voice, gesture, or a fallback control confirms.";
    mobileFeedback.signal("ready");
    elements.caption.textContent = "Ready tone · front camera enabled.";
  } else {
    elements.permissionStatus.textContent =
      "Camera unavailable or denied. Voice and sensor-free controls remain available with the same conversation.";
    machine.dispatch({
      type: "SENSOR_STATUS",
      sensor: "camera",
      status: "not-requested",
      at: sessionNow(),
    });
    if (!sensorController?.microphoneStream) {
      sensorController?.stop("camera unavailable");
      sensorController = null;
    }
    machine.dispatch({
      type: "SENSOR_STATUS",
      sensor: "estimator",
      status: "not-requested",
      label: "camera unavailable; fallback controls active",
      at: sessionNow(),
    });
  }
  sensorPermissionBusy = false;
  liveStartFailed = !started;
  refreshCapabilityGuidance({ recheck: false });
  render();
  return started;
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
  const text =
    machine.state.conversation.responseSummary ||
    machine.state.conversation.currentResponse;
  return speakText(text);
}

function speakText(text) {
  if (!text || replayLocked) {
    return false;
  }
  const concise = shortSpokenSummary(text);
  if (sensorController) {
    sensorController.announce(concise);
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
  cancelGlobalSpeech(window);
  const utterance = new SpeechSynthesisUtterance(concise);
  utterance.rate = 1;
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
      mobileMetrics.noteValue();
      render();
      speakCurrentResponse();
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
  const result = aimCoordinator.handle(machine, {
    ...sample,
    optionIds: [...visibleChoiceIds],
  });
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
    sensorController?.announce(shortSpokenSummary(machine.state.announcement));
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
    cancelGlobalSpeech(window);
    activeAIAbort?.abort();
    activeAIAbort = null;
  }
  const result = machine.dispatch(action);
  if (
    ["stop", "cancel", "undo"].includes(result.effect) &&
    !["STOP", "CANCEL", "UNDO"].includes(action.type)
  ) {
    cancelGlobalSpeech(window);
    activeAIAbort?.abort();
    activeAIAbort = null;
  }
  mobileMetrics.noteAction(action, result);
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
    mobileMetrics.noteSensorStatus("microphone", "off");
    mobileMetrics.noteSensorStatus("camera", "off");
  }
  render();
  if (action.type === "CONFIRM" && result.ok) {
    mobileFeedback.signal("confirm");
    elements.caption.textContent = "Confirm tone · selection accepted.";
  } else if (["CENTER", "CANCEL"].includes(action.type) && result.ok) {
    mobileFeedback.signal("ready");
    elements.caption.textContent = "Rest tone · center canceled the active choice.";
  } else if (action.type === "UNDO" && result.ok) {
    mobileFeedback.signal("undo");
    elements.caption.textContent = "Undo tone · prior reversible state restored.";
  } else if (action.type === "STOP" && result.ok) {
    mobileFeedback.signal("stop");
    elements.caption.textContent = "Stop tone · sensors and speech stopped.";
  } else if (
    ["SWITCH_MODE", "AUTO_MODE"].includes(action.type) &&
    result.ok
  ) {
    mobileFeedback.signal("ready");
    elements.caption.textContent = `Mode tone · ${machine.state.mode} active.`;
  }
  if (
    ["repeat", "what-changed"].includes(result.effect) &&
    action.source !== "voice"
  ) {
    speakText(result.text || machine.state.announcement);
  }
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
  const compactViewport =
    window.innerWidth <= 600 ||
    (window.innerWidth > window.innerHeight && window.innerHeight <= 500);
  let visibleOptions = machine.state.options;
  let choiceWindow = null;
  if (compactViewport && machine.state.options.length > 4) {
    choiceWindow = phoneChoiceWindow(
      machine.state.options,
      machine.state.highlight,
    );
    const visibleSet = new Set(choiceWindow.ids);
    visibleOptions = machine.state.options.filter((option) =>
      visibleSet.has(option.id),
    );
    elements.mobileChoicePage.hidden = false;
    elements.mobileChoicePage.textContent =
      `Choices ${choiceWindow.start + 1}–${choiceWindow.end} of ${
        choiceWindow.total
      } · page ${choiceWindow.page + 1} of ${
        choiceWindow.pageCount
      }. Say “next” or use Cycle choice to refine.`;
  } else {
    elements.mobileChoicePage.hidden = true;
  }
  visibleChoiceIds = visibleOptions.map((option) => option.id);
  const visibleSet = new Set(visibleChoiceIds);
  const signature = exactChoiceSignature(
    machine.state.mode,
    machine.state.options,
  );
  if (lastChoiceSignature !== signature) {
    elements.choiceLayer.replaceChildren();
    for (const candidate of machine.state.options) {
      const button = document.createElement("button");
      const title = document.createElement("strong");
      const detail = document.createElement("small");
      button.type = "button";
      button.className = "choice";
      button.append(title, detail);
      button.addEventListener("click", () => {
        const optionId = button.dataset.optionId;
        if (!optionId) {
          return;
        }
        dispatchAndRender({
          type: "HIGHLIGHT",
          id: optionId,
          source: "touch",
        });
      });
      elements.choiceLayer.append(button);
    }
  }
  lastChoiceSignature = signature;

  [...elements.choiceLayer.querySelectorAll(".choice")].forEach(
    (button, index) => {
      applyChoicePresentation(
        button,
        choicePresentation(machine.state.options[index], index, {
          highlightedId: machine.state.highlight,
          armed: machine.state.armed,
          disabled: replayLocked || machine.state.conversation.pending,
          visibleIds: visibleSet,
        }),
      );
    },
  );
  requestAnimationFrame(layoutChoices);
}

function layoutChoices() {
  if (elements.app.hidden) {
    return;
  }
  const buttons = [
    ...elements.choiceLayer.querySelectorAll(
      '.choice:not([data-phone-hidden="true"])',
    ),
  ];
  const width = elements.orbStage.getBoundingClientRect().width;
  if (!width || !buttons.length) {
    return;
  }
  const choiceRects = buttons.map((button) => button.getBoundingClientRect());
  const centerRect = elements.centerOrb.getBoundingClientRect();
  const geometry = radialChoiceGeometry({
    stageDiameter: width,
    choiceWidth: Math.max(
      ...buttons.map((button, index) => button.offsetWidth || choiceRects[index].width),
    ),
    choiceHeight: Math.max(
      ...buttons.map((button, index) => button.offsetHeight || choiceRects[index].height),
    ),
    centerDiameter: Math.max(centerRect.width, centerRect.height),
    choiceCount: buttons.length,
    radiusRatio:
      machine.state.mode === "tunnel"
        ? 0.335
        : machine.state.mode === "orbit"
          ? 0.34
          : 0.35,
  });
  elements.orbStage.dataset.layoutSafe = String(geometry.safe);
  const radius = geometry.radius;
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
    state.sensors.camera === "active"
      ? state.freezeCauses.length
        ? "Sensor safety freeze"
        : "Voice + front camera"
      : state.sensors.microphone === "active"
        ? "Voice on · camera off"
        : "Sensor-free";
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
    state.sensors.camera !== "active"
      ? "Camera freshness: not required while camera is off"
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
  const mobileRecord = mobileMetrics.snapshot(performance.now(), {
    voiceRepairs: state.metrics.voiceRepairs,
    falseCommits: state.metrics.falseCommits,
  });
  elements.glanceProxy.textContent = `${mobileRecord.glanceTimeProxyMs} ms`;
  elements.touchFallback.textContent = String(
    mobileRecord.oneHandTouchFallbacks,
  );
  elements.interruptionRecovery.textContent =
    `${mobileRecord.interruptionRecoveries} / ${mobileRecord.interruptionRecoveryMs} ms`;
  elements.permissionValue.textContent =
    mobileRecord.permissionToValueMs === null
      ? "waiting"
      : `${mobileRecord.permissionToValueMs} ms`;
  elements.sensorOnTime.textContent = `${Math.round(
    mobileRecord.sensorOnMs.total,
  )} ms`;
  for (const step of elements.permissionPanel.querySelectorAll(
    "[data-permission-step]",
  )) {
    const sensor = step.dataset.permissionStep;
    step.dataset.complete = String(
      sensor === "sensor-free" || state.sensors[sensor] === "active",
    );
  }
  elements.confirmChoice.disabled =
    state.conversation.pending || !state.highlight || !state.armed;
  elements.undoChoice.disabled = state.history.length === 0;
  elements.resumeSession.disabled = !state.freezeCauses.includes("user-stop");
  elements.speakResponse.disabled = !state.conversation.currentResponse;
  elements.mobileUndo.disabled = state.history.length === 0;
  elements.mobileStop.disabled =
    state.status === "idle" || state.status === "stopped";
  elements.hapticToggle.textContent = mobileFeedback.hapticsEnabled
    ? "Haptics: on"
    : "Haptics: off";
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
      elements.capabilitySensorFree,
      elements.useAccessible,
      elements.stopSensors,
      elements.resumeSession,
      elements.permissionMic,
      elements.permissionCamera,
      elements.mobileRepeat,
      elements.mobileWhatChanged,
      elements.mobileUndo,
      elements.mobileStop,
      elements.hapticToggle,
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
  refreshCapabilityGuidance({ recheck: false });
}

function exportMetrics() {
  if (replayLocked) {
    return false;
  }
  const record = machine.exportRecord(sessionNow());
  record.mobile = mobileMetrics.snapshot(performance.now(), {
    voiceRepairs: record.metrics.voiceRepairs,
    falseCommits: record.metrics.falseCommits,
  });
  record.mobile.publicSafe =
    "Aggregate interaction timings and counts only; no transcript, raw media, calibration, device ID, or credential.";
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
  mobileMetrics.noteSensorStatus("microphone", "off");
  mobileMetrics.noteSensorStatus("camera", "off");
  const transition = performSensorFreeTransition({
    machine,
    controller: sensorController,
    source,
    at: sessionNow(),
    resume,
  });
  sensorController = transition.controller;
  sensorTransitioning = false;
  elements.permissionStatus.textContent =
    "Sensor-free AI active. Camera, microphone, and recognition stopped before this status rendered.";
  aimCoordinator.reset();
  render();
  refreshCapabilityGuidance({ recheck: false });
  elements.orbStage.focus();
  return transition.result;
}

function stopSession(source) {
  return dispatchAndRender({ type: "STOP", source });
}

function prepareBrowserSensorRecovery(event) {
  if (replayLocked) {
    event.preventDefault();
    return;
  }
  if (machine.state.status !== "idle" && machine.state.sessionKind === "live") {
    transitionToSensorFree("open-browser");
  }
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
  if (replayLocked) {
    return;
  }
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
  if (replayLocked) {
    elements.applyUpdate.hidden = true;
    elements.applyUpdate.disabled = true;
    return;
  }
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
    refreshCapabilityGuidance();
    elements.pwaStatus.textContent = runtimeCapabilities.standalone
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

elements.startAccessible.addEventListener("click", startAccessible);
elements.startSimulation.addEventListener("click", startSimulation);
elements.permissionMic.addEventListener("click", enableMicrophone);
elements.permissionCamera.addEventListener("click", enableCamera);
elements.launchSafariLink.addEventListener(
  "click",
  prepareBrowserSensorRecovery,
);
elements.runtimeSafariLink.addEventListener(
  "click",
  prepareBrowserSensorRecovery,
);
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
elements.mobileRepeat.addEventListener("click", () =>
  dispatchAndRender({ type: "REPEAT", source: "touch" }),
);
elements.mobileWhatChanged.addEventListener("click", () =>
  dispatchAndRender({ type: "WHAT_CHANGED", source: "touch" }),
);
elements.mobileUndo.addEventListener("click", () =>
  dispatchAndRender({ type: "UNDO", source: "touch" }),
);
elements.mobileStop.addEventListener("click", () => stopSession("touch"));
elements.hapticToggle.addEventListener("click", () => {
  if (replayLocked) {
    return;
  }
  const enabled = mobileFeedback.setHaptics(
    !mobileFeedback.hapticsEnabled,
  );
  elements.hapticToggle.textContent = enabled ? "Haptics: on" : "Haptics: off";
  elements.assertiveStatus.textContent = enabled
    ? "Optional haptics enabled on this supported device."
    : "Optional haptics disabled.";
});
elements.installApp.addEventListener("click", promptInstall);
elements.applyUpdate.addEventListener("click", () => {
  applyingServiceWorkerUpdate = true;
  waitingServiceWorker?.postMessage({ type: "ACTIVATE_UPDATE" });
});
elements.capabilitySensorFree.addEventListener("click", () =>
  transitionToSensorFree("capability-guidance"),
);
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

function handleViewportChange(source) {
  layoutChoices();
  const orientation =
    window.innerWidth > window.innerHeight ? "landscape" : "portrait";
  if (replayLocked) {
    return;
  }
  if (elements.app.hidden || machine.state.status === "idle") {
    lastOrientation = orientation;
    return;
  }
  if (orientation === lastOrientation) {
    return;
  }
  lastOrientation = orientation;
  mobileMetrics.noteOrientationChange();
  aimCoordinator.reset();
  sensorController?.handleOrientationChange();
  machine.dispatch({
    type: "ORIENTATION_CHANGE",
    source,
    orientation,
    at: sessionNow(),
  });
  render();
}

window.addEventListener("resize", () => handleViewportChange("resize"));
window.addEventListener("orientationchange", () =>
  handleViewportChange("orientationchange"),
);
window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  if (replayLocked) {
    deferredInstallPrompt = null;
    elements.installApp.disabled = true;
    return;
  }
  deferredInstallPrompt = event;
  elements.installApp.disabled = false;
  elements.pwaStatus.textContent = "Install available";
});
window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
  elements.installApp.disabled = true;
  elements.pwaStatus.textContent =
    "Installed · offline shell; live sensors separate";
  refreshCapabilityGuidance();
});
navigator.serviceWorker?.addEventListener("controllerchange", () => {
  if (applyingServiceWorkerUpdate && !reloadingForWorker) {
    reloadingForWorker = true;
    window.location.reload();
  }
});
document.addEventListener("visibilitychange", () => {
  if (
    replayLocked ||
    machine.state.status === "idle" ||
    machine.state.status === "stopped"
  ) {
    return;
  }
  if (document.hidden) {
    interruptionPending = true;
    mobileMetrics.beginInterruption();
    cancelGlobalSpeech(window);
    if (sensorController) {
      transitionToSensorFree("background-interruption");
    } else {
      machine.dispatch({ type: "CENTER", source: "visibility" });
      aimCoordinator.reset();
      render();
    }
  } else if (interruptionPending) {
    interruptionPending = false;
    mobileMetrics.recoverInterruption();
    machine.dispatch({
      type: "INTERRUPTION_RESUME",
      source: "visibility",
      at: sessionNow(),
    });
    mobileFeedback.signal("recover");
    elements.permissionStatus.textContent =
      "Interruption recovered sensor-free with conversation and task state preserved. Re-enable optional sensors when ready.";
    elements.assertiveStatus.textContent = machine.state.announcement;
    render();
  }
});
window.addEventListener("pagehide", () => {
  activeAIAbort?.abort();
  activeAIAbort = null;
  cancelGlobalSpeech(window);
  if (machine.state.status !== "idle") {
    machine.dispatch({ type: "PAGEHIDE", source: "pagehide" });
  }
  sensorController?.stop("pagehide");
  sensorController = null;
  mobileMetrics.noteSensorStatus("microphone", "off");
  mobileMetrics.noteSensorStatus("camera", "off");
  mobileFeedback.close();
});
window.addEventListener("pageshow", (event) => {
  if (event.persisted) {
    window.location.reload();
  }
});

refreshCapabilityGuidance();
void registerOfflineApp();

if (startupQuery.get("simulate") === "1") {
  elements.startAccessible.disabled = true;
  elements.startSimulation.disabled = true;
  requestAnimationFrame(startSimulation);
}
