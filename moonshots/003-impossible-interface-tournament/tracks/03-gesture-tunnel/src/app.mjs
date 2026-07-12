import {
  CAMERA_DWELL_MS,
  DETERMINISTIC_ACTIONS,
  EXPECTED_ROUTE,
  TASK_LAYERS,
  TunnelEngine,
  applyDeterministicAction,
  classifyMotionGesture,
  coarseSector,
  motionCentroid,
  normalizeSpeech,
} from "./core.mjs";

const query = new URLSearchParams(window.location.search);
const simulationMode = query.get("simulate") === "1";
const accessibleMode = query.get("accessible") === "1";
const frameWidth = 96;
const frameHeight = 72;

const elements = {
  gateway: document.querySelector("#gateway"),
  gatewayCopy: document.querySelector("#gateway-copy"),
  privacyCopy: document.querySelector("#privacy-copy"),
  launch: document.querySelector("#launch-control"),
  app: document.querySelector("#app-shell"),
  cameraStatus: document.querySelector("#camera-status"),
  voiceStatus: document.querySelector("#voice-status"),
  neutralStatus: document.querySelector("#neutral-status"),
  history: document.querySelector("#history-shells"),
  mouths: document.querySelector("#mouth-orbit"),
  orbCluster: document.querySelector("#orb-cluster"),
  orbDepth: document.querySelector("#orb-depth"),
  orbTitle: document.querySelector("#orb-title"),
  orbState: document.querySelector("#orb-state"),
  confidence: document.querySelector("#confidence-fill"),
  voiceCommand: document.querySelector("#voice-command"),
  caption: document.querySelector("#voice-caption"),
  route: document.querySelector("#route-sequence"),
  evidence: document.querySelector("#evidence-seal"),
  metricsDownload: document.querySelector("#metrics-download"),
  replayDownload: document.querySelector("#replay-download"),
  srState: document.querySelector("#sr-state"),
  video: document.querySelector("#camera"),
  canvas: document.querySelector("#motion-canvas"),
};

let launchEpoch = performance.now();
let engine = null;
let stream = null;
let tracker = null;
let recognition = null;
let recognitionActive = false;
let speechPaused = false;
let launched = false;
let replacingSensors = false;
let recoveryInFlight = false;
let frameWatchdog = 0;
const evidenceUrls = [];

const elapsed = () => Math.round(performance.now() - launchEpoch);
const wait = (milliseconds) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));

function configureGateway() {
  if (simulationMode) {
    elements.gatewayCopy.textContent =
      "A deterministic local replay will route the same cobalt-beacon task, intentionally enter and undo a wrong tunnel, freeze on camera loss, recover, and return home.";
    elements.privacyCopy.textContent =
      "Simulation requests no sensors. It executes the same confidence, cooldown, freeze, replay, and task-completion state machine with fixed timestamps.";
    elements.launch.textContent = "Run deterministic cobalt route";
    return;
  }
  if (accessibleMode) {
    elements.gatewayCopy.textContent =
      "The switch-access path preserves every route and safety gate without camera or microphone. After this one start action, use arrow keys, Enter, Escape, U, R, and E.";
    elements.privacyCopy.textContent =
      "Accessible mode never requests media. Browser speech synthesis can announce major state changes; disable device audio if you prefer captions only. No state is persisted or sent.";
    elements.launch.textContent = "Begin accessible switch path";
  }
}

function setSensor(element, label, state) {
  element.textContent = label;
  element.dataset.state = state;
}

function setCaption(message, transcript = "") {
  elements.caption.textContent = transcript ? `heard “${transcript}” · ${message}` : message;
}

function announce(message) {
  if (!("speechSynthesis" in window) || simulationMode) return;
  window.speechSynthesis.cancel();
  speechPaused = true;
  if (recognitionActive) recognition.abort();
  const utterance = new SpeechSynthesisUtterance(message);
  utterance.rate = 1.02;
  utterance.pitch = 0.94;
  utterance.onend = () => {
    speechPaused = false;
    startRecognition();
  };
  utterance.onerror = () => {
    speechPaused = false;
    startRecognition();
  };
  window.speechSynthesis.speak(utterance);
}

function makeNode(tag, className, text) {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function renderHistory(snapshot) {
  elements.history.replaceChildren();
  snapshot.selections.forEach((selection, index) => {
    const shell = makeNode("div", "history-shell");
    shell.dataset.expected = String(selection.expected);
    shell.style.setProperty("--shell-scale", String(0.58 + index * 0.085));
    shell.style.setProperty("--shell-turn", `${index * 17 - 23}deg`);
    shell.style.setProperty("--shell-opacity", String(Math.min(0.76, 0.26 + index * 0.07)));
    const label = makeNode(
      "span",
      "shell-label",
      `${String(index + 1).padStart(2, "0")} · ${selection.label}`,
    );
    shell.append(label);
    elements.history.append(shell);
  });
}

function renderMouths(snapshot) {
  elements.mouths.replaceChildren();
  const layer = engine.currentLayer();
  if (!layer) return;
  layer.options.forEach((candidate, index) => {
    const mouth = makeNode("div", "mouth");
    mouth.setAttribute("role", "img");
    mouth.setAttribute(
      "aria-label",
      `Tunnel ${index + 1}: ${candidate.label}. ${candidate.detail}${
        snapshot.preview?.index === index ? ". Previewed" : ""
      }`,
    );
    mouth.dataset.preview = String(snapshot.preview?.index === index);
    mouth.dataset.armed = String(snapshot.armed && snapshot.preview?.index === index);
    mouth.style.setProperty("--angle", `${index * 60 - 90}deg`);
    const content = makeNode("span", "mouth-content");
    content.append(
      makeNode("span", "mouth-index", `T-${String(index + 1).padStart(2, "0")}`),
      makeNode("span", "mouth-name", candidate.label),
      makeNode("span", "mouth-detail", candidate.detail),
    );
    mouth.append(content);
    elements.mouths.append(mouth);
  });
}

function renderRoute(snapshot) {
  elements.route.replaceChildren();
  TASK_LAYERS.forEach((layer, index) => {
    const selection = snapshot.selections[index];
    const node = makeNode("span", "route-node", selection?.label ?? `· ${index + 1}`);
    node.dataset.filled = String(Boolean(selection));
    node.dataset.expected = String(selection?.expected ?? true);
    node.title = selection ? `${layer.title}: ${selection.label}` : layer.title;
    elements.route.append(node);
  });
}

function render() {
  if (!engine) return;
  const snapshot = engine.snapshot();
  const layer = engine.currentLayer();
  const confidence = snapshot.preview?.confidence ?? 0;
  renderHistory(snapshot);
  renderMouths(snapshot);
  renderRoute(snapshot);
  elements.orbCluster.dataset.frozen = String(snapshot.frozen);
  elements.orbCluster.dataset.exact = String(snapshot.exact);
  elements.confidence.style.setProperty("--confidence", String(confidence));

  if (snapshot.completed) {
    elements.orbDepth.textContent = "Depth 8 / 8";
    elements.orbTitle.textContent = snapshot.exact ? "Home · exact" : "Home · review";
    elements.orbState.textContent = snapshot.exact ? "Cobalt route sealed" : "Route differs";
    elements.voiceCommand.textContent = snapshot.exact
      ? "Task complete · say “export” for local evidence"
      : "Task ended with a mismatch · say “undo”";
  } else if (snapshot.frozen) {
    elements.orbDepth.textContent = `Depth ${snapshot.depth} / ${TASK_LAYERS.length}`;
    elements.orbTitle.textContent = "Input frozen";
    elements.orbState.textContent = snapshot.freezeReason ?? "sensor safety";
    elements.voiceCommand.textContent =
      snapshot.freezeReason === "stopped"
        ? "Say “resume” or press R"
        : "State held · say “recover” or press R";
  } else {
    elements.orbDepth.textContent = `Depth ${snapshot.depth} / ${TASK_LAYERS.length}`;
    elements.orbTitle.textContent = snapshot.preview
      ? layer.options[snapshot.preview.index].label
      : layer.title;
    elements.orbState.textContent = snapshot.armed
      ? "Threshold open · choose to commit"
      : snapshot.preview
        ? `${snapshot.preview.source} · ${Math.round(confidence * 100)}%`
        : "Safe center · no pending action";
    elements.voiceCommand.textContent = snapshot.preview
      ? `Preview: ${layer.options[snapshot.preview.index].label} · say “choose”`
      : layer.prompt;
  }

  const optionSummary = layer
    ? layer.options.map((candidate, index) => `${index + 1}, ${candidate.label}`).join("; ")
    : "No remaining tunnels";
  elements.srState.textContent = snapshot.completed
    ? `Task complete. Exact route ${snapshot.exact ? "confirmed" : "not confirmed"}.`
    : `Depth ${snapshot.depth + 1}. ${snapshot.frozen ? "Input frozen. " : ""}${layer.title}. ${optionSummary}.`;

  if (snapshot.completed) prepareEvidence();
}

class LocalMotionTracker {
  constructor(video, canvas, callbacks) {
    this.video = video;
    this.canvas = canvas;
    this.context = canvas.getContext("2d", { willReadFrequently: true });
    this.callbacks = callbacks;
    this.previous = null;
    this.running = false;
    this.animationFrame = 0;
    this.neutralSince = performance.now();
    this.neutralReady = false;
    this.gestureWindow = null;
    this.lastPreviewAt = 0;
    this.lastFaceAt = 0;
    this.lastFrameAt = performance.now();
    this.centerRestSent = false;
    this.faceDetector = null;
    this.faceDetectionPending = false;
    if ("FaceDetector" in window) {
      try {
        this.faceDetector = new window.FaceDetector({ fastMode: true, maxDetectedFaces: 1 });
      } catch {
        this.faceDetector = null;
      }
    }
  }

  start() {
    this.running = true;
    this.loop();
  }

  stop() {
    this.running = false;
    window.cancelAnimationFrame(this.animationFrame);
  }

  loop = () => {
    if (!this.running) return;
    const now = performance.now();
    if (this.video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      this.context.save();
      this.context.translate(frameWidth, 0);
      this.context.scale(-1, 1);
      this.context.drawImage(this.video, 0, 0, frameWidth, frameHeight);
      this.context.restore();
      const rgba = this.context.getImageData(0, 0, frameWidth, frameHeight).data;
      const grayscale = new Uint8Array(frameWidth * frameHeight);
      for (let pixel = 0, offset = 0; pixel < grayscale.length; pixel += 1, offset += 4) {
        grayscale[pixel] = Math.round(
          rgba[offset] * 0.299 + rgba[offset + 1] * 0.587 + rgba[offset + 2] * 0.114,
        );
      }
      if (this.previous) this.consumeFrame(motionCentroid(this.previous, grayscale, frameWidth, frameHeight), now);
      this.previous = grayscale;
      this.lastFrameAt = now;
      if (this.faceDetector && now - this.lastFaceAt > 620) this.detectFace(now);
    }
    this.animationFrame = window.requestAnimationFrame(this.loop);
  };

  consumeFrame(motion, now) {
    const neutral = motion.activeRatio < 0.012;
    if (neutral) {
      if (!this.neutralSince) this.neutralSince = now;
      if (now - this.neutralSince >= 480) this.neutralReady = true;
      if (now - this.neutralSince >= 1200 && !this.centerRestSent) {
        this.centerRestSent = true;
        this.callbacks.onCenterRest("camera-motion-rest");
      }
      if (this.gestureWindow) {
        const sample = {
          start: this.gestureWindow.start,
          end: this.gestureWindow.end,
          durationMs: now - this.gestureWindow.startedAt,
          activeRatio: this.gestureWindow.ratioTotal / this.gestureWindow.frames,
          neutralReady: this.gestureWindow.neutralReady,
        };
        const gesture = classifyMotionGesture(sample);
        this.gestureWindow = null;
        this.neutralReady = false;
        this.neutralSince = now;
        if (gesture) this.callbacks.onGesture(gesture);
      }
    } else {
      this.neutralSince = 0;
      this.centerRestSent = false;
      if (motion.activeRatio > 0.55) {
        this.gestureWindow = null;
        this.neutralReady = false;
      } else if (motion.centroid && motion.activeRatio >= 0.018) {
        if (!this.gestureWindow && this.neutralReady) {
          this.gestureWindow = {
            start: motion.centroid,
            end: motion.centroid,
            startedAt: now,
            ratioTotal: 0,
            frames: 0,
            neutralReady: true,
          };
        }
        if (this.gestureWindow) {
          this.gestureWindow.end = motion.centroid;
          this.gestureWindow.ratioTotal += motion.activeRatio;
          this.gestureWindow.frames += 1;
        }
        if (now - this.lastPreviewAt > 340) {
          const sector = coarseSector(motion.centroid);
          if (sector && sector.confidence >= 0.58) {
            this.lastPreviewAt = now;
            this.callbacks.onCoarsePreview(sector, "camera-motion-gaze");
          }
        }
      }
    }
    this.callbacks.onNeutral(this.neutralReady, motion);
  }

  async detectFace(now) {
    if (this.faceDetectionPending) return;
    this.faceDetectionPending = true;
    this.lastFaceAt = now;
    try {
      const faces = await this.faceDetector.detect(this.video);
      const box = faces[0]?.boundingBox;
      if (box && this.video.videoWidth && this.video.videoHeight) {
        const point = {
          x: 1 - (box.x + box.width / 2) / this.video.videoWidth,
          y: (box.y + box.height / 2) / this.video.videoHeight,
        };
        const sector = coarseSector(point);
        if (sector && sector.confidence >= 0.58) {
          this.callbacks.onCoarsePreview(sector, "camera-head-position");
        } else if (!sector) {
          this.callbacks.onCenterRest("camera-head-center");
        }
      }
    } catch {
      this.faceDetector = null;
    } finally {
      this.faceDetectionPending = false;
    }
  }
}

function onGesture(gesture) {
  const accepted = engine.handleGesture(gesture.type, {
    confidence: gesture.confidence,
    neutral: true,
    at: elapsed(),
  });
  if (!accepted) return;
  const descriptions = {
    "rotate-left": "Motion rotated one tunnel left",
    "rotate-right": "Motion rotated one tunnel right",
    enter: "Motion crossed the threshold; say “choose” to commit",
    back: "Upward motion returned one shell",
  };
  setCaption(descriptions[gesture.type]);
  render();
}

function onCoarsePreview(sector, source) {
  if (!engine || engine.state.frozen || engine.state.completed) return;
  const accepted = engine.previewOption(sector.index, {
    source,
    confidence: sector.confidence,
    at: elapsed(),
  });
  if (accepted) render();
}

function onNeutral(ready, motion) {
  if (ready) engine?.noteNeutralReady(elapsed());
  setSensor(
    elements.neutralStatus,
    ready ? "neutral · ready" : `motion · ${Math.round(motion.activeRatio * 100)}%`,
    ready ? "ok" : "warn",
  );
}

function onCenterRest(source) {
  if (!engine || engine.state.frozen) return;
  if (engine.centerRest({ source, at: elapsed() })) {
    setCaption("Center rest canceled the coarse camera preview");
    render();
  }
}

function stopMedia() {
  replacingSensors = true;
  tracker?.stop();
  tracker = null;
  if (engine) {
    engine.sensorStopped("camera", elapsed());
    engine.sensorStopped("microphone", elapsed());
  }
  if (stream) stream.getTracks().forEach((track) => track.stop());
  stream = null;
  elements.video.srcObject = null;
  replacingSensors = false;
}

function handleSensorLoss(kind) {
  if (!engine || replacingSensors || engine.state.freezeReason === `${kind}-lost`) return;
  tracker?.stop();
  engine.sensorLost(kind, elapsed());
  setSensor(
    kind === "camera" ? elements.cameraStatus : elements.voiceStatus,
    `${kind} · lost`,
    "bad",
  );
  setSensor(elements.neutralStatus, "neutral · canceled", "bad");
  setCaption(`${kind} lost; state frozen and every pending preview canceled`);
  announce(`${kind} lost. State frozen. Say recover, or press R.`);
  render();
}

async function startSensors({ recovery = false } = {}) {
  if (!navigator.mediaDevices?.getUserMedia) {
    handleSensorLoss("camera");
    setCaption("Media APIs unavailable; reload with ?accessible=1 for switch access");
    return false;
  }
  setSensor(elements.cameraStatus, recovery ? "camera · recovering" : "camera · requesting", "warn");
  setSensor(elements.voiceStatus, recovery ? "voice · recovering" : "voice · requesting", "warn");
  try {
    if (stream) stopMedia();
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 640 },
        height: { ideal: 480 },
        facingMode: "user",
        frameRate: { ideal: 24, max: 30 },
      },
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    elements.video.srcObject = stream;
    await elements.video.play();
    const cameraTrack = stream.getVideoTracks()[0];
    const microphoneTrack = stream.getAudioTracks()[0];
    if (cameraTrack) engine.sensorStarted("camera", elapsed());
    if (microphoneTrack) engine.sensorStarted("microphone", elapsed());
    if (cameraTrack) cameraTrack.addEventListener("ended", () => handleSensorLoss("camera"), { once: true });
    if (microphoneTrack) {
      microphoneTrack.addEventListener("ended", () => handleSensorLoss("microphone"), { once: true });
    }
    setSensor(elements.cameraStatus, "camera · local 96×72", "ok");
    setSensor(
      elements.voiceStatus,
      microphoneTrack ? "voice · browser service" : "voice · fallback",
      microphoneTrack ? "ok" : "warn",
    );
    tracker = new LocalMotionTracker(elements.video, elements.canvas, {
      onGesture,
      onCoarsePreview,
      onNeutral,
      onCenterRest,
    });
    tracker.start();
    if (recovery && engine.state.frozen) engine.sensorRecovered("camera", elapsed());
    startRecognition();
    setCaption(
      tracker.faceDetector
        ? "Ready · optional face position gives coarse preview; no eye tracking"
        : "Ready · frame-difference centroid gives coarse preview; no hand classification",
    );
    render();
    return true;
  } catch (error) {
    const kind =
      error?.name === "NotAllowedError" || error?.name === "NotFoundError" ? "camera" : "unknown";
    handleSensorLoss(kind);
    setCaption(`Sensor permission unavailable (${error?.name ?? "error"}); switch fallback remains available`);
    render();
    return false;
  }
}

async function recoverSensors() {
  if (recoveryInFlight) return;
  if (engine.state.freezeReason === "stopped") {
    engine.resume(elapsed());
    setCaption("Route resumed at the same committed depth");
    announce("Route resumed.");
    render();
    return;
  }
  recoveryInFlight = true;
  const recovered = await startSensors({ recovery: true });
  recoveryInFlight = false;
  if (recovered) {
    setCaption("Sensors recovered; pending input stayed canceled");
    announce("Sensors recovered. Pending input remained canceled.");
  }
}

function startRecognition() {
  if (!launched || simulationMode || accessibleMode || speechPaused || recognitionActive) return;
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    setSensor(elements.voiceStatus, "voice · switch fallback", "warn");
    return;
  }
  if (!recognition) {
    recognition = new SpeechRecognition();
    recognition.lang = "en-US";
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.onstart = () => {
      recognitionActive = true;
      setSensor(elements.voiceStatus, "voice · listening", "ok");
    };
    recognition.onresult = (event) => {
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const alternative = result[0];
        if (result.isFinal) {
          handleVoice(alternative.transcript, alternative.confidence || 0.7);
        } else {
          setCaption("listening", alternative.transcript);
        }
      }
    };
    recognition.onerror = (event) => {
      if (event.error === "audio-capture" || event.error === "not-allowed") {
        handleSensorLoss("microphone");
      } else {
        setSensor(elements.voiceStatus, `voice · ${event.error}`, "warn");
      }
    };
    recognition.onend = () => {
      recognitionActive = false;
      if (launched && !speechPaused && !accessibleMode && !simulationMode) {
        window.setTimeout(startRecognition, 450);
      }
    };
  }
  try {
    recognition.start();
  } catch {
    recognitionActive = false;
  }
}

function handleVoice(transcript, confidence = 1) {
  const phrase = normalizeSpeech(transcript);
  if (!phrase) return;
  if (/\bexport\b/.test(phrase)) {
    prepareEvidence();
    setCaption("Local metrics and replay exports are ready", transcript);
    announce("Local evidence is ready.");
    return;
  }
  if (/\b(recover|resume)\b/.test(phrase) && engine.state.frozen) {
    setCaption("Recovery requested", transcript);
    recoverSensors();
    return;
  }

  const before = engine.snapshot();
  const result = engine.voice(phrase, { confidence, at: elapsed() });
  const after = engine.snapshot();
  if (result.command === "intent" && result.accepted) {
    const selected = engine.currentLayer().options[after.preview.index];
    setCaption(`Previewing ${selected.label}; say “choose” to confirm`, transcript);
  } else if (result.command === "choose" && result.accepted) {
    const committed = after.selections.at(-1);
    setCaption(`${committed.label} entered; prior shells remain visible`, transcript);
    announce(after.completed ? "Exact route complete. Home." : `${committed.label} confirmed.`);
  } else if (result.command === "undo" && result.accepted) {
    setCaption("Last committed tunnel undone", transcript);
    announce("Last tunnel undone.");
  } else if (result.command === "cancel") {
    setCaption("Pending preview canceled; committed shells unchanged", transcript);
  } else if (result.command === "stop") {
    setCaption("Stopped; state frozen. The voice listener remains only for “resume”.", transcript);
    announce("Stopped. Say resume when ready.");
  } else if (!result.accepted) {
    const reason = before.frozen ? "input is frozen" : "repeat the intent or build confidence";
    setCaption(`Not committed: ${reason}`, transcript);
  }
  render();
}

function prepareEvidence() {
  if (!engine) return;
  evidenceUrls.splice(0).forEach((url) => URL.revokeObjectURL(url));
  const pairs = [
    [elements.metricsDownload, engine.exportMetrics()],
    [elements.replayDownload, engine.exportReplay()],
  ];
  pairs.forEach(([anchor, payload]) => {
    const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    evidenceUrls.push(url);
    anchor.href = url;
  });
  elements.evidence.dataset.visible = "true";
}

function useFallback(action) {
  if (!engine || !launched) return;
  engine.noteFallback(elapsed());
  const snapshot = engine.snapshot();
  if (action === "recover") {
    recoverSensors();
    return;
  }
  if (snapshot.frozen) {
    setCaption("State is frozen; press R to recover");
    return;
  }
  if (action === "left") engine.rotate(-1, { source: "switch", confidence: 1, at: elapsed() });
  if (action === "right") engine.rotate(1, { source: "switch", confidence: 1, at: elapsed() });
  if (action === "choose") engine.choose({ source: "switch", at: elapsed() });
  if (action === "undo") engine.undo({ source: "switch", at: elapsed() });
  if (action === "cancel") engine.cancel({ source: "switch", at: elapsed() });
  if (action === "export") prepareEvidence();
  setCaption(`Accessibility fallback: ${action}`);
  render();
}

async function runSimulation() {
  setSensor(elements.cameraStatus, "camera · simulated", "ok");
  setSensor(elements.voiceStatus, "voice · scripted", "ok");
  setSensor(elements.neutralStatus, "neutral · deterministic", "ok");
  let priorAt = 0;
  for (const action of DETERMINISTIC_ACTIONS) {
    await wait(Math.max(120, (action.at - priorAt) * 0.18));
    priorAt = action.at;
    applyDeterministicAction(engine, action);
    if (action.type === "sensor-lost") {
      setSensor(elements.cameraStatus, "camera · lost", "bad");
      setSensor(elements.neutralStatus, "neutral · canceled", "bad");
    }
    if (action.type === "sensor-recovered") {
      setSensor(elements.cameraStatus, "camera · recovered", "ok");
      setSensor(elements.neutralStatus, "neutral · deterministic", "ok");
    }
    setCaption(action.caption, action.text ?? "");
    render();
  }
  const metrics = engine.exportMetrics();
  setCaption(
    `Exact task complete · ${metrics.falseCommits} intentional wrong commit · ${metrics.undos} undo · ${metrics.sensorRecoveryMs}ms recovery`,
  );
  prepareEvidence();
}

async function launch() {
  if (launched) return;
  launched = true;
  launchEpoch = performance.now();
  elements.gateway.hidden = true;
  elements.app.focus({ preventScroll: true });
  if (simulationMode) {
    engine = new TunnelEngine({
      clock: () => 0,
      sessionId: "gesture-tunnel-deterministic-v1",
    });
    render();
    await runSimulation();
    return;
  }

  engine = new TunnelEngine({
    clock: elapsed,
    sessionId: accessibleMode ? "gesture-tunnel-accessible" : "gesture-tunnel-live",
  });
  engine.start(0);
  if (accessibleMode) {
    engine.noteFallback(0);
    setSensor(elements.cameraStatus, "camera · disabled", "warn");
    setSensor(elements.voiceStatus, "voice · captions", "warn");
    setSensor(elements.neutralStatus, "neutral · switch", "ok");
    setCaption("Accessible path ready; use arrows and Enter");
    render();
    announce("Gesture Tunnel accessible path ready.");
    return;
  }

  render();
  await startSensors();
  announce("Gesture Tunnel ready. Say route.");
}

elements.launch.addEventListener("click", launch, { once: true });
window.addEventListener("keydown", (event) => {
  if (!launched && event.key === "Enter") {
    elements.launch.click();
    return;
  }
  const actions = {
    ArrowLeft: "left",
    ArrowRight: "right",
    ArrowUp: "undo",
    Escape: "cancel",
    Enter: "choose",
    " ": "choose",
    u: "undo",
    U: "undo",
    r: "recover",
    R: "recover",
    e: "export",
    E: "export",
  };
  const action = actions[event.key];
  if (!action) return;
  event.preventDefault();
  useFallback(action);
});

if (navigator.mediaDevices?.addEventListener) {
  navigator.mediaDevices.addEventListener("devicechange", () => {
    if (launched && engine?.state.frozen && !accessibleMode && !simulationMode) recoverSensors();
  });
}

document.addEventListener("visibilitychange", () => {
  if (
    document.visibilityState === "visible" &&
    launched &&
    engine?.state.frozen &&
    !accessibleMode &&
    !simulationMode
  ) {
    recoverSensors();
  }
});

frameWatchdog = window.setInterval(() => {
  if (
    launched &&
    tracker?.running &&
    document.visibilityState === "visible" &&
    performance.now() - tracker.lastFrameAt > 2500
  ) {
    handleSensorLoss("camera");
  }
}, 1000);

window.addEventListener(
  "pagehide",
  () => {
    window.clearInterval(frameWatchdog);
    recognition?.abort();
    stopMedia();
    evidenceUrls.forEach((url) => URL.revokeObjectURL(url));
  },
  { once: true },
);

configureGateway();
render();
