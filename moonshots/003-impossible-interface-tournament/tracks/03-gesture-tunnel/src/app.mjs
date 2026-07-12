import {
  DETERMINISTIC_ACTIONS,
  LifecycleGate,
  MediaFrameGate,
  TASK_LAYERS,
  TunnelEngine,
  allowsMediaCapture,
  applyDeterministicAction,
  classifyMotionGesture,
  coarseSector,
  completionAnnouncement,
  evidencePresentation,
  isCameraFrameStale,
  isTerminalSpeechRecognitionError,
  motionCentroid,
  normalizeSpeech,
  preservesVoiceRecoveryOnSensorLoss,
  recognitionBackoffMs,
  releaseMediaResources,
  shouldRestartRecognition,
  shouldReloadAfterPageShow,
  shouldHandleTunnelShortcut,
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
  tunnelStage: document.querySelector("#tunnel-stage"),
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
  evidenceTitle: document.querySelector("#evidence-title"),
  evidenceCopy: document.querySelector("#evidence-copy"),
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
let recognitionRestartAllowed = false;
let recognitionRecoveryRequired = false;
let recognitionRecoveryOnly = false;
let recognitionTerminalFailure = false;
let recognitionTransientFailures = 0;
let recognitionRestartTimer = 0;
let speechPaused = false;
let launched = false;
let tearingDown = false;
let replacingSensors = false;
let recoveryInFlight = false;
let frameWatchdog = 0;
const evidenceUrls = [];

const elapsed = () => Math.round(performance.now() - launchEpoch);
const wait = (milliseconds) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));

function clearRecognitionRestartTimer() {
  if (recognitionRestartTimer) window.clearTimeout(recognitionRestartTimer);
  recognitionRestartTimer = 0;
}

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

function clearEvidenceUrls() {
  evidenceUrls.splice(0).forEach((url) => URL.revokeObjectURL(url));
  elements.metricsDownload.removeAttribute("href");
  elements.replayDownload.removeAttribute("href");
}

function renderEvidenceState(snapshot) {
  const presentation = evidencePresentation(snapshot);
  elements.evidence.dataset.visible = String(presentation.visible);
  elements.evidenceTitle.textContent = presentation.label;
  elements.evidenceCopy.textContent = presentation.description;
  if (!presentation.visible) clearEvidenceUrls();
  return presentation;
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
    const causes = snapshot.freezeCauses.join(" + ");
    const userStopped = snapshot.freezeCauses.includes("user-stop");
    const sensorLost = snapshot.freezeCauses.some((cause) => cause.endsWith("-lost"));
    elements.orbDepth.textContent = `Depth ${snapshot.depth} / ${TASK_LAYERS.length}`;
    elements.orbTitle.textContent = "Input frozen";
    elements.orbState.textContent = causes || "safety gate";
    elements.voiceCommand.textContent =
      userStopped && sensorLost
        ? "State held · say “recover,” then “resume”"
        : userStopped
          ? "Say “resume” to clear the user stop"
          : recognitionRecoveryOnly
            ? "Voice recovery only · say “recover” or press R"
            : "Voice unavailable · press R to recover";
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

  const evidenceState = renderEvidenceState(snapshot);
  if (evidenceState.visible) prepareEvidence(snapshot);
}

class LocalMotionTracker {
  constructor(video, canvas, callbacks) {
    this.video = video;
    this.canvas = canvas;
    this.context = canvas.getContext("2d", { willReadFrequently: true });
    this.callbacks = callbacks;
    this.previous = null;
    this.running = false;
    this.frameRequest = 0;
    this.usesVideoFrameCallback =
      typeof this.video.requestVideoFrameCallback === "function";
    this.frameGate = new MediaFrameGate();
    this.lifecycle = new LifecycleGate();
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
    this.lifecycle.start();
    this.running = true;
    this.scheduleFrame();
  }

  stop() {
    this.running = false;
    this.lifecycle.stop();
    this.faceDetectionPending = false;
    if (
      this.usesVideoFrameCallback &&
      typeof this.video.cancelVideoFrameCallback === "function"
    ) {
      this.video.cancelVideoFrameCallback(this.frameRequest);
    } else {
      window.cancelAnimationFrame(this.frameRequest);
    }
  }

  scheduleFrame() {
    if (!this.running) return;
    this.frameRequest = this.usesVideoFrameCallback
      ? this.video.requestVideoFrameCallback(this.onVideoFrame)
      : window.requestAnimationFrame(this.onAnimationFrame);
  }

  onVideoFrame = (now, metadata) => {
    if (!this.running) return;
    try {
      this.processFrame(now, metadata);
    } finally {
      this.scheduleFrame();
    }
  };

  onAnimationFrame = (now) => {
    if (!this.running) return;
    try {
      const playbackQuality = this.video.getVideoPlaybackQuality?.();
      const presentedFrames = Number.isFinite(playbackQuality?.totalVideoFrames)
        ? playbackQuality.totalVideoFrames
        : this.video.webkitDecodedFrameCount;
      this.processFrame(now, {
        presentedFrames,
        mediaTime: this.video.currentTime,
      });
    } finally {
      this.scheduleFrame();
    }
  };

  processFrame(now, metadata = {}) {
    if (!this.running) return;
    if (this.video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
    const fresh = this.frameGate.accept({
      presentedFrames: metadata.presentedFrames,
      mediaTime: Number.isFinite(metadata.mediaTime)
        ? metadata.mediaTime
        : this.video.currentTime,
    });
    if (!fresh) return;

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
    if (this.previous) {
      this.consumeFrame(
        motionCentroid(this.previous, grayscale, frameWidth, frameHeight),
        now,
      );
    }
    this.previous = grayscale;
    this.lastFrameAt = now;
    if (this.faceDetector && now - this.lastFaceAt > 620) this.detectFace(now);
  }

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
    const detectionGeneration = this.lifecycle.capture();
    const detector = this.faceDetector;
    try {
      const faces = await detector.detect(this.video);
      if (
        !this.lifecycle.isCurrent(detectionGeneration) ||
        detector !== this.faceDetector
      ) {
        return;
      }
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
      if (
        this.lifecycle.isCurrent(detectionGeneration) &&
        detector === this.faceDetector
      ) {
        this.faceDetector = null;
      }
    } finally {
      if (this.lifecycle.isCurrent(detectionGeneration)) {
        this.faceDetectionPending = false;
      }
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

function stopMedia({ preserveVoiceRecovery = false } = {}) {
  clearRecognitionRestartTimer();
  const keepRecoveryListener = preserveVoiceRecovery && !recognitionTerminalFailure;
  recognitionRestartAllowed = keepRecoveryListener;
  recognitionRecoveryRequired = true;
  recognitionRecoveryOnly = keepRecoveryListener;
  if (!keepRecoveryListener && recognitionActive) recognition.abort();
  replacingSensors = true;
  const activeStream = stream;
  try {
    try {
      tracker?.stop();
    } catch {
      // Media release must continue even if frame processing teardown fails.
    }
    tracker = null;
    releaseMediaResources(activeStream, elements.video);
    stream = null;
    if (engine && activeStream) {
      engine.sensorStopped("camera", elapsed());
      engine.sensorStopped("microphone", elapsed());
    }
  } finally {
    stream = null;
    elements.video.srcObject = null;
    replacingSensors = false;
  }
}

function handleSensorLoss(kind, { terminalSpeechFailure = false, speechError = "" } = {}) {
  if (!engine || replacingSensors) return;
  if (terminalSpeechFailure) {
    recognitionTerminalFailure = true;
    recognitionRestartAllowed = false;
    recognitionRecoveryOnly = false;
    clearRecognitionRestartTimer();
  }
  const cause = `${kind}-lost`;
  const alreadyFrozenForSensor = engine.state.freezeCauses.includes(cause);
  const lostAt = elapsed();
  const preserveVoiceRecovery = preservesVoiceRecoveryOnSensorLoss(
    kind,
    recognitionTerminalFailure,
  );
  stopMedia({ preserveVoiceRecovery });
  if (!alreadyFrozenForSensor) engine.sensorLost(kind, lostAt);
  setSensor(
    kind === "camera" ? elements.cameraStatus : elements.voiceStatus,
    `${kind} · lost`,
    "bad",
  );
  if (preserveVoiceRecovery) {
    setSensor(elements.voiceStatus, "voice · recovery only", "warn");
  } else {
    setSensor(elements.voiceStatus, "voice · unavailable", "bad");
  }
  setSensor(elements.neutralStatus, "neutral · canceled", "bad");
  setCaption(
    terminalSpeechFailure
      ? `Voice recognition stopped permanently (${speechError}); press R for explicit recovery`
      : `${kind} lost; state frozen and every pending preview canceled`,
  );
  announce(
    preserveVoiceRecovery
      ? "Camera lost. State frozen. Say recover, or press R."
      : "Voice recognition unavailable. State frozen. Press R to recover.",
  );
  if (preserveVoiceRecovery) startRecognition();
  render();
}

async function startSensors({ recovery = false } = {}) {
  if (!allowsMediaCapture({ accessibleMode, simulationMode })) return false;
  if (!navigator.mediaDevices?.getUserMedia) {
    handleSensorLoss("camera");
    setCaption("Media APIs unavailable; reload with ?accessible=1 for switch access");
    return false;
  }
  setSensor(elements.cameraStatus, recovery ? "camera · recovering" : "camera · requesting", "warn");
  setSensor(elements.voiceStatus, recovery ? "voice · recovering" : "voice · requesting", "warn");
  try {
    if (stream) stopMedia();
    const acquiredStream = await navigator.mediaDevices.getUserMedia({
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
    stream = acquiredStream;
    elements.video.srcObject = stream;
    await elements.video.play();
    const cameraTrack = stream.getVideoTracks()[0];
    const microphoneTrack = stream.getAudioTracks()[0];
    if (cameraTrack) engine.sensorStarted("camera", elapsed());
    if (microphoneTrack) engine.sensorStarted("microphone", elapsed());
    if (cameraTrack) {
      cameraTrack.addEventListener(
        "ended",
        () => {
          if (stream === acquiredStream) handleSensorLoss("camera");
        },
        { once: true },
      );
    }
    if (microphoneTrack) {
      microphoneTrack.addEventListener(
        "ended",
        () => {
          if (stream === acquiredStream) handleSensorLoss("microphone");
        },
        { once: true },
      );
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
    if (recovery) {
      if (cameraTrack) engine.sensorRecovered("camera", elapsed());
      if (microphoneTrack) engine.sensorRecovered("microphone", elapsed());
      if (engine.state.freezeCauses.includes("unknown-lost") && cameraTrack && microphoneTrack) {
        engine.sensorRecovered("unknown", elapsed());
      }
    }
    recognitionRestartAllowed = true;
    recognitionRecoveryRequired = false;
    recognitionRecoveryOnly = false;
    recognitionTerminalFailure = false;
    recognitionTransientFailures = 0;
    clearRecognitionRestartTimer();
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

async function recoverSensors({ explicit = false } = {}) {
  if (recoveryInFlight) return;
  if (!allowsMediaCapture({ accessibleMode, simulationMode })) {
    setCaption("This mode never requests camera or microphone access");
    return;
  }
  if (recognitionRecoveryRequired && !explicit) return;
  const sensorCauses = engine.state.freezeCauses.filter((cause) => cause.endsWith("-lost"));
  if (sensorCauses.length === 0) {
    setCaption(
      engine.state.freezeCauses.includes("user-stop")
        ? "User stop remains; say “resume”"
        : "No lost sensor needs recovery",
    );
    return;
  }
  recoveryInFlight = true;
  const recovered = await startSensors({ recovery: true });
  recoveryInFlight = false;
  if (recovered) {
    const remaining = engine.snapshot().freezeCauses;
    setCaption(
      remaining.length
        ? `Sensors recovered; still frozen by ${remaining.join(" + ")}`
        : "Sensors recovered; pending input stayed canceled",
    );
    announce(
      remaining.length
        ? "Sensors recovered. The user stop remains."
        : "Sensors recovered. Pending input remained canceled.",
    );
    render();
  }
}

function startRecognition() {
  if (
    recognitionActive ||
    !shouldRestartRecognition({
      launched,
      restartAllowed: recognitionRestartAllowed,
      speechPaused,
      accessibleMode,
      simulationMode,
      tearingDown,
    })
  ) {
    return;
  }
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
      if (
        !shouldRestartRecognition({
          launched,
          restartAllowed: recognitionRestartAllowed,
          speechPaused,
          accessibleMode,
          simulationMode,
          tearingDown,
        })
      ) {
        recognitionActive = false;
        recognition.abort();
        return;
      }
      recognitionActive = true;
      setSensor(
        elements.voiceStatus,
        recognitionRecoveryOnly ? "voice · recovery only" : "voice · listening",
        recognitionRecoveryOnly ? "warn" : "ok",
      );
    };
    recognition.onresult = (event) => {
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const alternative = result[0];
        recognitionTransientFailures = 0;
        if (result.isFinal) {
          handleVoice(alternative.transcript, alternative.confidence);
        } else {
          setCaption("listening", alternative.transcript);
        }
      }
    };
    recognition.onerror = (event) => {
      if (isTerminalSpeechRecognitionError(event.error)) {
        recognitionRestartAllowed = false;
        recognitionRecoveryRequired = true;
        recognitionRecoveryOnly = false;
        recognitionTerminalFailure = true;
        recognitionActive = false;
        clearRecognitionRestartTimer();
        handleSensorLoss("microphone", {
          terminalSpeechFailure: true,
          speechError: event.error,
        });
      } else {
        const expectedAbort =
          event.error === "aborted" &&
          (speechPaused || tearingDown || !recognitionRestartAllowed);
        if (!expectedAbort) recognitionTransientFailures += 1;
        setSensor(elements.voiceStatus, `voice · ${event.error}`, "warn");
      }
    };
    recognition.onend = () => {
      recognitionActive = false;
      if (
        shouldRestartRecognition({
          launched,
          restartAllowed: recognitionRestartAllowed,
          speechPaused,
          accessibleMode,
          simulationMode,
          tearingDown,
        })
      ) {
        clearRecognitionRestartTimer();
        const delay = recognitionBackoffMs(recognitionTransientFailures);
        recognitionRestartTimer = window.setTimeout(() => {
          recognitionRestartTimer = 0;
          startRecognition();
        }, delay);
      }
    };
  }
  try {
    recognition.start();
  } catch {
    recognitionActive = false;
  }
}

function handleVoice(transcript, confidence) {
  const phrase = normalizeSpeech(transcript);
  if (!phrase) return;
  if (recognitionRecoveryOnly) {
    if (/\brecover\b/.test(phrase)) {
      setCaption("Restricted voice recovery requested", transcript);
      recoverSensors({ explicit: true });
    } else {
      setCaption("Camera is lost; restricted voice listener accepts only “recover”", transcript);
    }
    return;
  }
  if (/\bexport\b/.test(phrase)) {
    if (prepareEvidence()) {
      setCaption("Local metrics and replay exports are ready", transcript);
      announce("Local evidence is ready.");
    } else {
      setCaption("Evidence remains locked until the route is complete", transcript);
    }
    return;
  }
  if (/\brecover\b/.test(phrase) && engine.state.frozen) {
    setCaption("Recovery requested", transcript);
    recoverSensors({ explicit: true });
    return;
  }
  if (/\bresume\b/.test(phrase)) {
    const result = engine.voice(phrase, { confidence, at: elapsed() });
    const remaining = engine.snapshot().freezeCauses;
    setCaption(
      result.accepted
        ? remaining.length
          ? `User stop cleared; still frozen by ${remaining.join(" + ")}`
          : "Route resumed at the same committed depth"
        : "No user stop is active",
      transcript,
    );
    if (result.accepted && remaining.length === 0) announce("Route resumed.");
    render();
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
    announce(completionAnnouncement(after, committed.label));
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

function prepareEvidence(snapshot = engine?.snapshot()) {
  if (!engine) return;
  const presentation = renderEvidenceState(snapshot);
  if (!presentation.visible) return false;
  clearEvidenceUrls();
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
  return true;
}

function useFallback(action) {
  if (!engine || !launched || simulationMode) return;
  engine.noteFallback(elapsed());
  const snapshot = engine.snapshot();
  if (action === "recover") {
    recoverSensors({ explicit: true });
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
  if (action === "export" && !prepareEvidence()) {
    setCaption("Accessibility fallback: evidence remains locked until completion");
    render();
    return;
  }
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
    if (action.type === "sensor-stopped") {
      setSensor(
        action.sensor === "camera" ? elements.cameraStatus : elements.voiceStatus,
        `${action.sensor} · stopped`,
        "warn",
      );
    }
    if (action.type === "sensor-started") {
      setSensor(
        action.sensor === "camera" ? elements.cameraStatus : elements.voiceStatus,
        `${action.sensor} · restarted`,
        "ok",
      );
    }
    if (action.type === "sensor-recovered") {
      setSensor(
        action.sensor === "camera" ? elements.cameraStatus : elements.voiceStatus,
        `${action.sensor} · recovered`,
        "ok",
      );
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
  elements.tunnelStage.focus({ preventScroll: true });
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
  const sensorsReady = await startSensors();
  if (sensorsReady) announce("Gesture Tunnel ready. Say route.");
}

elements.launch.addEventListener("click", launch, { once: true });
window.addEventListener("keydown", (event) => {
  const nativeInteractive = Boolean(
    event.target?.closest?.("button, a[href], input, select, textarea, [contenteditable]"),
  );
  const targetInTunnel = Boolean(
    event.target?.nodeType && elements.tunnelStage.contains(event.target),
  );
  if (
    !shouldHandleTunnelShortcut({
      launched,
      simulationMode,
      targetInTunnel,
      nativeInteractive,
      key: event.key,
    })
  ) {
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
  event.preventDefault();
  useFallback(action);
});

if (navigator.mediaDevices?.addEventListener) {
  navigator.mediaDevices.addEventListener("devicechange", () => {
    if (launched && engine?.state.frozen && !accessibleMode && !simulationMode) {
      recoverSensors({ explicit: false });
    }
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
    recoverSensors({ explicit: false });
  }
});

frameWatchdog = window.setInterval(() => {
  if (
    launched &&
    tracker?.running &&
    document.visibilityState === "visible" &&
    isCameraFrameStale(tracker.lastFrameAt, performance.now())
  ) {
    handleSensorLoss("camera");
  }
}, 1000);

window.addEventListener("pageshow", (event) => {
  if (shouldReloadAfterPageShow(event)) window.location.reload();
});

window.addEventListener(
  "pagehide",
  () => {
    tearingDown = true;
    launched = false;
    recognitionRestartAllowed = false;
    recognitionRecoveryRequired = true;
    recognitionRecoveryOnly = false;
    recognitionTerminalFailure = true;
    clearRecognitionRestartTimer();
    window.clearInterval(frameWatchdog);
    recognition?.abort();
    recognitionActive = false;
    stopMedia();
    clearEvidenceUrls();
  },
  { once: true },
);

configureGateway();
render();
