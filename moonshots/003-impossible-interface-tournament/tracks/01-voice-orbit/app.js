(function runVoiceOrbit() {
  "use strict";

  const Core = window.VoiceOrbitCore;
  if (!Core) {
    throw new Error("Voice Orbit core failed to load.");
  }

  let machine = new Core.VoiceOrbitMachine();
  const elements = {
    launch: document.getElementById("launch-screen"),
    workspace: document.getElementById("workspace"),
    startLive: document.getElementById("start-live"),
    startFallback: document.getElementById("start-fallback"),
    startSimulation: document.getElementById("start-simulation"),
    cameraIndicator: document.getElementById("camera-indicator"),
    microphoneIndicator: document.getElementById("microphone-indicator"),
    estimatorIndicator: document.getElementById("estimator-indicator"),
    modeLabel: document.getElementById("mode-label"),
    sessionTime: document.getElementById("session-time"),
    stageLabel: document.getElementById("stage-label"),
    stageChip: document.getElementById("stage-chip"),
    manifest: document.getElementById("manifest"),
    lastHeard: document.getElementById("last-heard"),
    speechCaveat: document.getElementById("speech-caveat"),
    orbitPrompt: document.getElementById("orbit-prompt"),
    interactionMode: document.getElementById("interaction-mode"),
    orbitShell: document.getElementById("orbit-shell"),
    petalLayer: document.getElementById("petal-layer"),
    aimVector: document.getElementById("aim-vector"),
    centerOrb: document.getElementById("center-orb"),
    dwellRing: document.getElementById("dwell-ring"),
    orbState: document.getElementById("orb-state"),
    cameraPreview: document.getElementById("camera-preview"),
    canvas: document.getElementById("analysis-canvas"),
    estimatorLabel: document.getElementById("estimator-label"),
    metricTime: document.getElementById("metric-time"),
    metricErrors: document.getElementById("metric-errors"),
    metricRepairs: document.getElementById("metric-repairs"),
    metricDwell: document.getElementById("metric-dwell"),
    metricGestures: document.getElementById("metric-gestures"),
    metricLoss: document.getElementById("metric-loss"),
    exportJson: document.getElementById("export-json"),
    fallbackConfirm: document.getElementById("fallback-confirm"),
    fallbackCancel: document.getElementById("fallback-cancel"),
    fallbackUndo: document.getElementById("fallback-undo"),
    fallbackStop: document.getElementById("fallback-stop"),
    freezeBanner: document.getElementById("freeze-banner"),
    freezeReason: document.getElementById("freeze-reason"),
    announcer: document.getElementById("announcer"),
  };

  const runtime = {
    started: false,
    simulation: false,
    epoch: new Core.SessionEpoch(),
    stream: null,
    recognition: null,
    recognitionWanted: false,
    recognitionRestart: null,
    detector: null,
    detectorBusy: false,
    estimatorKind: "waiting",
    analysisFrame: null,
    lastAnalysisAt: 0,
    lastFaceAt: 0,
    baseline: null,
    baselineSamples: 0,
    previousFrame: null,
    lastMotionAt: 0,
    stableIndex: null,
    stableSince: 0,
    lastDwellSample: 0,
    dwellProgress: 0,
    nodGate: new Core.NodGestureGate(),
    petalSignature: "",
    lastExportRequest: 0,
    simulationTimers: [],
    lastRenderSecond: -1,
  };

  const stageNames = {
    intent: "Awaiting intent",
    collect: "Building route",
    review: "Reviewing draft",
    committed: "Route confirmed",
    complete: "Mission complete",
  };

  function announce(message) {
    elements.announcer.textContent = "";
    window.setTimeout(() => {
      elements.announcer.textContent = message;
    }, 20);
  }

  function showWorkspace(mode) {
    runtime.started = true;
    runtime.simulation = mode === "simulation";
    elements.launch.hidden = true;
    elements.workspace.hidden = false;
    document.body.classList.toggle("simulation-mode", runtime.simulation);
    document.body.classList.toggle("fallback-mode", mode === "fallback");
    elements.orbitPrompt.setAttribute("tabindex", "-1");
    elements.orbitPrompt.focus({ preventScroll: true });
  }

  function beginSession(mode) {
    const generation = runtime.epoch.begin();
    showWorkspace(mode);
    dispatch({ type: "START", mode });
    return generation;
  }

  function sessionIsCurrent(generation) {
    return (
      runtime.epoch.isCurrent(generation) &&
      runtime.started &&
      machine.state.status === "active"
    );
  }

  function updateIndicator(element, status, override) {
    const displayState = ["head-fallback", "motion-fallback"].includes(status) ? "active" : status;
    element.dataset.state = displayState;
    const text = element.querySelector("strong");
    text.textContent = (override || status || "off").replace(/-/g, " ").toUpperCase();
  }

  function elapsedMilliseconds() {
    if (machine.state.startedAt === null) {
      return 0;
    }
    if (machine.state.status === "stopped") {
      return machine.state.metrics.elapsedMs;
    }
    const end = machine.state.completedAt || Date.now();
    return Math.max(0, end - machine.state.startedAt);
  }

  function formatClock(milliseconds) {
    const totalTenths = Math.floor(milliseconds / 100);
    const minutes = Math.floor(totalTenths / 600);
    const seconds = Math.floor((totalTenths % 600) / 10);
    const tenths = totalTenths % 10;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${tenths}`;
  }

  function fieldValue(field, value) {
    const target = elements.manifest.querySelector(`[data-field="${field}"]`);
    target.textContent = value === null || value === undefined || value === "" ? "—" : String(value);
    target.classList.toggle("is-set", value !== null && value !== undefined && value !== "");
  }

  function petalRadius() {
    return Math.max(122, Math.min(252, elements.orbitShell.clientWidth * 0.36));
  }

  function positionPetals() {
    const petals = Array.from(elements.petalLayer.querySelectorAll(".petal"));
    const count = petals.length || 1;
    const radius = petalRadius();
    petals.forEach((petal, index) => {
      const angle = -Math.PI / 2 + (index * Math.PI * 2) / count;
      petal.style.setProperty("--petal-x", `${Math.cos(angle) * radius}px`);
      petal.style.setProperty("--petal-y", `${Math.sin(angle) * radius}px`);
    });
    updateAimVector();
  }

  function rebuildPetals() {
    const signature = machine.state.options
      .map((option) => `${option.id}:${option.label}:${option.hint || ""}`)
      .join("|");
    if (signature === runtime.petalSignature) {
      return;
    }
    runtime.petalSignature = signature;
    elements.petalLayer.replaceChildren();

    machine.state.options.forEach((option, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "petal";
      button.setAttribute("role", "option");
      button.setAttribute("aria-selected", "false");
      button.dataset.optionId = option.id;

      const number = document.createElement("span");
      number.className = "petal-index";
      number.textContent = String(index + 1).padStart(2, "0");

      const copy = document.createElement("span");
      copy.className = "petal-copy";
      const label = document.createElement("strong");
      label.textContent = option.label;
      const hint = document.createElement("small");
      hint.textContent = option.hint || "prediction";
      copy.append(label, hint);
      button.append(number, copy);

      button.addEventListener("click", () => {
        dispatch({ type: "HIGHLIGHT", index, source: "touch-aim" });
        announce(`${option.label} highlighted. Use Confirm highlighted to activate.`);
      });
      elements.petalLayer.append(button);
    });

    window.requestAnimationFrame(positionPetals);
  }

  function updateAimVector() {
    const index = machine.state.highlight;
    const count = machine.state.options.length;
    const petals = Array.from(elements.petalLayer.querySelectorAll(".petal"));
    petals.forEach((petal, petalIndex) => {
      petal.setAttribute("aria-selected", String(index === petalIndex));
    });

    if (index === null || !count) {
      elements.aimVector.style.setProperty("--aim-length", "0px");
      elements.centerOrb.dataset.state = machine.state.frozen ? "frozen" : "rest";
      elements.orbState.textContent = machine.state.frozen ? "FROZEN" : "RELAXED";
      elements.dwellRing.style.setProperty("--dwell-progress", "0deg");
      return;
    }

    const angle = -90 + (index * 360) / count;
    elements.aimVector.style.setProperty("--aim-angle", `${angle}deg`);
    elements.aimVector.style.setProperty("--aim-length", `${Math.max(70, petalRadius() - 78)}px`);
    elements.centerOrb.dataset.state = machine.state.frozen ? "frozen" : "aiming";
    elements.orbState.textContent = machine.state.frozen ? "FROZEN" : "HIGHLIGHTING";
    elements.dwellRing.style.setProperty(
      "--dwell-progress",
      `${Math.round(runtime.dwellProgress * 360)}deg`,
    );
  }

  function render() {
    const state = machine.state;
    const task = state.task;
    rebuildPetals();
    updateAimVector();

    elements.stageChip.textContent = state.stage.toUpperCase();
    elements.stageLabel.textContent = stageNames[state.stage] || state.stage;
    elements.orbitPrompt.textContent = state.prompt;
    elements.modeLabel.textContent = state.mode
      ? `${state.mode.toUpperCase()} · ${state.status.toUpperCase()}`
      : "NOT STARTED";

    fieldValue("action", task.action);
    fieldValue(
      "payload",
      task.count && task.color ? `${task.color.toUpperCase()} × ${task.count}` : task.count || task.color,
    );
    fieldValue("time", task.time);
    fieldValue(
      "fragile",
      task.fragile === true ? "FRAGILE" : task.fragile === false ? "STANDARD" : null,
    );
    fieldValue("destination", task.destination);
    fieldValue("gate", task.gate);

    updateIndicator(elements.cameraIndicator, state.sensors.camera);
    updateIndicator(elements.microphoneIndicator, state.sensors.microphone);
    updateIndicator(
      elements.estimatorIndicator,
      state.sensors.estimator,
      state.sensors.estimator === "head-fallback"
        ? "head"
        : state.sensors.estimator === "motion-fallback"
          ? "motion"
          : null,
    );

    const metrics = state.metrics;
    elements.metricTime.textContent = `${(elapsedMilliseconds() / 1000).toFixed(1)}s`;
    elements.metricErrors.textContent = String(metrics.errors);
    elements.metricRepairs.textContent = String(metrics.voiceRepairs);
    elements.metricDwell.textContent = `${(metrics.dwellMs / 1000).toFixed(1)}s`;
    elements.metricGestures.textContent = String(metrics.gesturesSeen);
    elements.metricLoss.textContent = String(metrics.sensorLosses);

    elements.freezeBanner.hidden = !state.frozen || state.status === "stopped";
    elements.freezeReason.textContent = state.freezeReason
      ? `${state.freezeReason}. No selection can execute; stop, cancel, and undo remain available.`
      : "A required sensor was lost. No selection can execute.";
    document.body.classList.toggle("session-complete", state.stage === "complete");
    elements.fallbackConfirm.disabled = state.frozen || state.highlight === null;
    elements.exportJson.disabled = state.status === "idle";
  }

  function downloadRecord() {
    const record = machine.exportRecord();
    const contents = JSON.stringify(record, null, 2);
    const blob = new Blob([contents], { type: "application/json" });
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = `voice-orbit-${record.mode || "session"}-${Date.now()}.json`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
    announce("Local instrumentation JSON exported.");
  }

  function clearAnalysisCanvas() {
    const context = elements.canvas.getContext("2d");
    context.clearRect(0, 0, elements.canvas.width, elements.canvas.height);
  }

  function stopMediaStream(stream) {
    if (!stream) {
      return;
    }
    stream.getTracks().forEach((track) => {
      track.onended = null;
      track.onmute = null;
      track.onunmute = null;
      track.stop();
    });
    if (elements.cameraPreview.srcObject === stream) {
      elements.cameraPreview.srcObject = null;
    }
  }

  function discardSessionStream(stream) {
    if (runtime.stream === stream) {
      runtime.stream = null;
    }
    stopMediaStream(stream);
  }

  function stopRuntimeSensors() {
    runtime.recognitionWanted = false;
    if (runtime.recognitionRestart) {
      window.clearTimeout(runtime.recognitionRestart);
      runtime.recognitionRestart = null;
    }
    if (runtime.recognition) {
      runtime.recognition.onstart = null;
      runtime.recognition.onresult = null;
      runtime.recognition.onerror = null;
      runtime.recognition.onend = null;
      try {
        runtime.recognition.stop();
      } catch (error) {
        void error;
      }
      runtime.recognition = null;
    }
    if (runtime.analysisFrame !== null) {
      window.cancelAnimationFrame(runtime.analysisFrame);
      runtime.analysisFrame = null;
    }
    runtime.simulationTimers.forEach((timer) => window.clearTimeout(timer));
    runtime.simulationTimers = [];
    const stream = runtime.stream;
    runtime.stream = null;
    stopMediaStream(stream);
    elements.cameraPreview.srcObject = null;
    if (runtime.previousFrame) {
      runtime.previousFrame.fill(0);
    }
    runtime.previousFrame = null;
    clearAnalysisCanvas();
    runtime.detector = null;
    runtime.detectorBusy = false;
    runtime.baseline = null;
    runtime.stableIndex = null;
    runtime.dwellProgress = 0;
    runtime.nodGate.reset();
  }

  function dispatch(action) {
    const previousExport = machine.state.exportRequested;
    const previousStatus = machine.state.status;
    machine.dispatch(action);
    render();

    if (previousStatus !== "stopped" && machine.state.status === "stopped") {
      runtime.epoch.invalidate();
    }
    if (action.type === "VOICE" && machine.state.lastAction === "route-locked") {
      elements.lastHeard.textContent =
        "Route locked after confirmation. Say “undo” or explicitly choose New route first.";
      announce("Confirmed route unchanged. Undo or choose New route before editing.");
    }
    if (action.type === "VOICE" && machine.state.lastAction === "destination-rejected") {
      elements.lastHeard.textContent =
        "Unsupported destination rejected. Choose ORION-7, LUNA-3, ATLAS-2, or POLARIS-4.";
      announce("Unsupported destination cleared from the route draft.");
    }
    if (machine.state.exportRequested > previousExport) {
      downloadRecord();
    }
    if (machine.state.status === "stopped") {
      stopRuntimeSensors();
      if (previousStatus !== "stopped") {
        elements.lastHeard.textContent = "Sensors stopped. Session data remains only in memory.";
        announce("Camera and microphone stopped.");
      }
    }
    return machine.state;
  }

  function setSensor(sensor, status, reason) {
    if (machine.state.sensors[sensor] === status) {
      return;
    }
    dispatch({ type: "SENSOR", sensor, status, reason });
  }

  function resetDwell() {
    runtime.stableIndex = null;
    runtime.stableSince = 0;
    runtime.lastDwellSample = 0;
    runtime.dwellProgress = 0;
    elements.dwellRing.style.setProperty("--dwell-progress", "0deg");
  }

  function updateDirectionalAim(dx, dy, source, now) {
    if (machine.state.frozen || machine.state.status !== "active") {
      resetDwell();
      return { zone: "blocked", index: null };
    }
    const magnitude = Math.hypot(dx, dy);
    if (magnitude < 0.15) {
      if (machine.state.highlight !== null || runtime.stableIndex !== null) {
        dispatch({ type: "HIGHLIGHT", index: null, source: "center" });
      }
      resetDwell();
      return { zone: "center", index: null };
    }

    const count = machine.state.options.length;
    if (!count) {
      return { zone: "blocked", index: null };
    }
    const angle = Math.atan2(dy, dx);
    const step = (Math.PI * 2) / count;
    const index = ((Math.round((angle + Math.PI / 2) / step) % count) + count) % count;

    if (runtime.stableIndex !== index) {
      runtime.stableIndex = index;
      runtime.stableSince = now;
      runtime.lastDwellSample = now;
      runtime.dwellProgress = 0;
      dispatch({ type: "HIGHLIGHT", index, source });
      return { zone: "petal", index };
    }

    const dwellElapsed = Math.max(0, now - runtime.stableSince);
    runtime.dwellProgress = Math.min(1, dwellElapsed / 1400);
    if (now - runtime.lastDwellSample >= 250) {
      const duration = now - runtime.lastDwellSample;
      runtime.lastDwellSample = now;
      dispatch({ type: "DWELL", duration });
    } else {
      updateAimVector();
    }
    return { zone: "petal", index };
  }

  function processGestureSample(aim, gesturePosition, now) {
    if (aim.zone !== "petal") {
      runtime.nodGate.sample({
        zone: "center",
        index: null,
        position: gesturePosition,
        now,
      });
      return;
    }
    const result = runtime.nodGate.sample({
      zone: "petal",
      index: aim.index,
      position: gesturePosition,
      now,
    });
    if (result.confirmed && machine.state.highlight === aim.index && !machine.state.frozen) {
      dispatch({ type: "GESTURE", gesture: "nod", source: "camera-motion" });
      announce("Deliberate nod confirmed the highlighted choice.");
    }
  }

  function landmarkCenter(face) {
    const landmarks = Array.isArray(face.landmarks) ? face.landmarks : [];
    const eyePoints = [];
    landmarks.forEach((landmark) => {
      if (!String(landmark.type || "").toLowerCase().includes("eye")) {
        return;
      }
      const locations = Array.isArray(landmark.locations)
        ? landmark.locations
        : landmark.location
          ? [landmark.location]
          : [];
      locations.forEach((point) => {
        if (Number.isFinite(point.x) && Number.isFinite(point.y)) {
          eyePoints.push(point);
        }
      });
    });
    if (!eyePoints.length) {
      return null;
    }
    return {
      x: eyePoints.reduce((sum, point) => sum + point.x, 0) / eyePoints.length,
      y: eyePoints.reduce((sum, point) => sum + point.y, 0) / eyePoints.length,
    };
  }

  function processFace(face, now) {
    const box = face.boundingBox;
    if (!box || !elements.cameraPreview.videoWidth || !elements.cameraPreview.videoHeight) {
      return;
    }

    runtime.lastFaceAt = now;
    const eyes = landmarkCenter(face);
    const sourcePoint = eyes || {
      x: box.x + box.width / 2,
      y: box.y + box.height / 2,
    };
    const x = 1 - sourcePoint.x / elements.cameraPreview.videoWidth;
    const y = sourcePoint.y / elements.cameraPreview.videoHeight;
    const gestureY = (box.y + box.height / 2) / elements.cameraPreview.videoHeight;
    const estimatorStatus = eyes ? "active" : "head-fallback";
    runtime.estimatorKind = eyes ? "face-landmark" : "head-position";
    elements.estimatorLabel.textContent = eyes ? "LANDMARK PROXY" : "HEAD POSITION";
    elements.interactionMode.textContent = eyes
      ? "COARSE LANDMARK GAZE PROXY"
      : "COARSE HEAD-POSITION FALLBACK";
    setSensor("estimator", estimatorStatus, eyes ? "landmarks available" : "bounding box only");

    if (!runtime.baseline || runtime.baselineSamples < 16) {
      const samples = runtime.baselineSamples;
      runtime.baseline = {
        x: runtime.baseline ? (runtime.baseline.x * samples + x) / (samples + 1) : x,
        y: runtime.baseline ? (runtime.baseline.y * samples + y) / (samples + 1) : y,
      };
      runtime.baselineSamples += 1;
      elements.estimatorLabel.textContent = `CALIBRATING ${runtime.baselineSamples}/16`;
      if (machine.state.highlight !== null) {
        dispatch({ type: "HIGHLIGHT", index: null, source: "center" });
      }
      return;
    }

    const dx = (x - runtime.baseline.x) * 3.4;
    const dy = (y - runtime.baseline.y) * 3.4;
    const magnitude = Math.hypot(dx, dy);
    if (magnitude < 0.07) {
      runtime.baseline.x = runtime.baseline.x * 0.996 + x * 0.004;
      runtime.baseline.y = runtime.baseline.y * 0.996 + y * 0.004;
    }
    const aim = updateDirectionalAim(
      dx,
      dy,
      eyes ? "face-landmark-gaze" : "head-position-fallback",
      now,
    );
    processGestureSample(aim, gestureY, now);
  }

  async function analyzeFace(now, generation) {
    const detector = runtime.detector;
    if (runtime.detectorBusy || !detector || !sessionIsCurrent(generation)) {
      return;
    }
    runtime.detectorBusy = true;
    try {
      const faces = await detector.detect(elements.cameraPreview);
      if (!sessionIsCurrent(generation) || runtime.detector !== detector) {
        return;
      }
      if (faces.length) {
        processFace(faces[0], now);
      } else if (now - runtime.lastFaceAt > 1100) {
        if (machine.state.highlight !== null) {
          dispatch({ type: "HIGHLIGHT", index: null, source: "center" });
        }
        runtime.baseline = null;
        runtime.baselineSamples = 0;
        runtime.nodGate.reset();
        setSensor("estimator", "lost", "face not visible");
        elements.estimatorLabel.textContent = "FACE LOST";
      }
    } catch (error) {
      if (!sessionIsCurrent(generation) || runtime.detector !== detector) {
        return;
      }
      setSensor("estimator", "error", "FaceDetector failed");
      dispatch({ type: "ERROR", area: "estimator", code: error.name || "face-detector" });
    } finally {
      if (runtime.detector === detector) {
        runtime.detectorBusy = false;
      }
    }
  }

  function analyzeMotion(now) {
    const context = elements.canvas.getContext("2d", { willReadFrequently: true });
    let pixels;
    try {
      context.drawImage(elements.cameraPreview, 0, 0, elements.canvas.width, elements.canvas.height);
      pixels = context.getImageData(0, 0, elements.canvas.width, elements.canvas.height).data;
    } finally {
      context.clearRect(0, 0, elements.canvas.width, elements.canvas.height);
    }
    const luminance = new Uint8Array(elements.canvas.width * elements.canvas.height);
    let weightedX = 0;
    let weightedY = 0;
    let totalDifference = 0;
    let appearanceYTotal = 0;
    let appearanceWeight = 0;

    for (let index = 0; index < luminance.length; index += 1) {
      const offset = index * 4;
      const value = Math.round(
        pixels[offset] * 0.299 + pixels[offset + 1] * 0.587 + pixels[offset + 2] * 0.114,
      );
      luminance[index] = value;
      const appearance = 255 - value;
      appearanceYTotal += Math.floor(index / elements.canvas.width) * appearance;
      appearanceWeight += appearance;
      if (runtime.previousFrame) {
        const difference = Math.abs(value - runtime.previousFrame[index]);
        if (difference > 18) {
          const x = index % elements.canvas.width;
          const y = Math.floor(index / elements.canvas.width);
          weightedX += x * difference;
          weightedY += y * difference;
          totalDifference += difference;
        }
      }
    }

    pixels.fill(0);
    runtime.previousFrame = luminance;
    setSensor("estimator", "motion-fallback", "FaceDetector unavailable");
    runtime.estimatorKind = "frame-motion";
    elements.estimatorLabel.textContent = "MOTION FALLBACK";
    elements.interactionMode.textContent = "COARSE FRAME-MOTION FALLBACK · NOT EYE TRACKING";

    if (totalDifference > 1500) {
      const centerX = weightedX / totalDifference;
      const centerY = weightedY / totalDifference;
      const dx = ((centerX / (elements.canvas.width - 1)) * 2 - 1) * -1;
      const dy = (centerY / (elements.canvas.height - 1)) * 2 - 1;
      const gesturePosition =
        appearanceWeight > 0
          ? appearanceYTotal / appearanceWeight / (elements.canvas.height - 1)
          : 0.5;
      runtime.lastMotionAt = now;
      const aim = updateDirectionalAim(dx, dy, "frame-motion-fallback", now);
      processGestureSample(aim, gesturePosition, now);
    } else if (now - runtime.lastMotionAt > 420 && machine.state.highlightSource === "frame-motion-fallback") {
      dispatch({ type: "HIGHLIGHT", index: null, source: "center" });
      resetDwell();
      runtime.nodGate.sample({ zone: "center", index: null, position: 0.5, now });
    }
  }

  function analysisLoop(timestamp, generation) {
    if (!runtime.stream || !sessionIsCurrent(generation)) {
      return;
    }
    const now = Date.now();
    if (elements.cameraPreview.readyState >= 2 && timestamp - runtime.lastAnalysisAt > 110) {
      runtime.lastAnalysisAt = timestamp;
      if (runtime.detector) {
        void analyzeFace(now, generation);
      } else {
        analyzeMotion(now);
      }
    }
    runtime.analysisFrame = window.requestAnimationFrame((nextTimestamp) =>
      analysisLoop(nextTimestamp, generation),
    );
  }

  function startEstimator(generation) {
    if (!sessionIsCurrent(generation)) {
      return;
    }
    runtime.lastFaceAt = Date.now();
    runtime.baseline = null;
    runtime.baselineSamples = 0;
    runtime.previousFrame = null;
    runtime.nodGate.reset();
    clearAnalysisCanvas();
    if ("FaceDetector" in window) {
      try {
        runtime.detector = new window.FaceDetector({ fastMode: true, maxDetectedFaces: 1 });
        runtime.estimatorKind = "face-detector";
        elements.estimatorLabel.textContent = "CALIBRATING FACE";
      } catch (error) {
        runtime.detector = null;
        void error;
      }
    }
    if (!runtime.detector) {
      elements.estimatorLabel.textContent = "MOTION FALLBACK";
      elements.interactionMode.textContent = "COARSE FRAME-MOTION FALLBACK · NOT EYE TRACKING";
    }
    runtime.analysisFrame = window.requestAnimationFrame((timestamp) =>
      analysisLoop(timestamp, generation),
    );
  }

  function speechErrorCode(event) {
    return event && event.error ? event.error : "unknown";
  }

  function startSpeechRecognition() {
    const generation = runtime.epoch.current();
    if (!sessionIsCurrent(generation) || !runtime.stream) {
      return;
    }
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) {
      setSensor("speech", "unavailable", "Web Speech API not supported");
      elements.lastHeard.textContent =
        "Web Speech API unavailable. Use camera gesture, keyboard, or touch fallback.";
      return;
    }

    const recognition = new Recognition();
    runtime.recognition = recognition;
    runtime.recognitionWanted = true;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = document.documentElement.lang || "en-US";

    recognition.onstart = () => {
      if (
        !runtime.recognitionWanted ||
        !sessionIsCurrent(generation) ||
        runtime.recognition !== recognition
      ) {
        try {
          recognition.stop();
        } catch (error) {
          void error;
        }
        return;
      }
      setSensor("speech", "active", "recognizer listening");
      elements.lastHeard.textContent = "Listening…";
    };
    recognition.onresult = (event) => {
      if (
        !runtime.recognitionWanted ||
        !sessionIsCurrent(generation) ||
        runtime.recognition !== recognition
      ) {
        return;
      }
      let interim = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const text = event.results[index][0].transcript.trim();
        if (event.results[index].isFinal) {
          elements.lastHeard.textContent = `Heard: “${text}”`;
          dispatch({ type: "VOICE", text, source: "speech" });
          if (machine.state.status === "stopped") {
            return;
          }
        } else {
          interim += `${text} `;
        }
      }
      if (interim.trim()) {
        elements.lastHeard.textContent = `Hearing: “${interim.trim()}”`;
      }
    };
    recognition.onerror = (event) => {
      if (!sessionIsCurrent(generation) || runtime.recognition !== recognition) {
        return;
      }
      const code = speechErrorCode(event);
      const serviceDenied = code === "not-allowed" || code === "service-not-allowed";
      if (serviceDenied || code === "audio-capture") {
        runtime.recognitionWanted = false;
        if (runtime.recognitionRestart) {
          window.clearTimeout(runtime.recognitionRestart);
          runtime.recognitionRestart = null;
        }
      }
      const speechStatus = serviceDenied
        ? "denied"
        : code === "audio-capture"
          ? "unavailable"
          : "error";
      setSensor("speech", speechStatus, code);
      dispatch({ type: "ERROR", area: "speech", code });
      if (serviceDenied) {
        elements.lastHeard.textContent =
          "Browser speech service denied. Camera gesture, keyboard, and touch remain available.";
        announce("Speech service disabled. Other active inputs remain available.");
      } else {
        elements.lastHeard.textContent = `Speech service error: ${code}. Camera gesture, keyboard, and touch remain available.`;
      }
    };
    recognition.onend = () => {
      if (
        !runtime.recognitionWanted ||
        !sessionIsCurrent(generation) ||
        runtime.recognition !== recognition
      ) {
        return;
      }
      runtime.recognitionRestart = window.setTimeout(() => {
        if (
          !runtime.recognitionWanted ||
          !sessionIsCurrent(generation) ||
          runtime.recognition !== recognition
        ) {
          return;
        }
        try {
          recognition.start();
        } catch (error) {
          dispatch({ type: "ERROR", area: "speech", code: error.name || "restart" });
        }
      }, 350);
    };

    try {
      recognition.start();
    } catch (error) {
      setSensor("speech", "error", error.name || "start");
      dispatch({ type: "ERROR", area: "speech", code: error.name || "start" });
    }
  }

  function bindTrackSafety(track, sensor) {
    track.onended = () => {
      setSensor(sensor, "lost", "media track ended");
      announce(`${sensor} lost. Inputs frozen.`);
    };
    track.onmute = () => {
      setSensor(sensor, "lost", "media track muted");
    };
    track.onunmute = () => {
      setSensor(sensor, "active", "media track resumed");
    };
  }

  function startFallback() {
    if (runtime.started) {
      return;
    }
    beginSession("fallback");
    elements.interactionMode.textContent = "KEYBOARD + TOUCH · NO MEDIA";
    elements.estimatorLabel.textContent = "NOT REQUESTED";
    elements.lastHeard.textContent =
      "Speech is disabled. Use arrows or touch to aim, then Enter or Confirm highlighted.";
    elements.speechCaveat.textContent =
      "No microphone, camera, or browser speech service is requested in this mode.";
    announce("No-media keyboard and touch mode started.");
  }

  async function startLive() {
    if (runtime.started) {
      return;
    }
    const generation = beginSession("live");
    announce("Requesting local camera and microphone permission.");
    elements.startLive.disabled = true;
    elements.startFallback.disabled = true;
    elements.startSimulation.disabled = true;

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setSensor("camera", "unavailable", "getUserMedia unsupported");
      setSensor("microphone", "unavailable", "getUserMedia unsupported");
      elements.lastHeard.textContent = "This browser does not expose getUserMedia.";
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
          width: { ideal: 640 },
          height: { ideal: 480 },
          frameRate: { ideal: 15, max: 24 },
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      if (!sessionIsCurrent(generation)) {
        discardSessionStream(stream);
        return;
      }
      runtime.stream = stream;
      elements.cameraPreview.srcObject = stream;
      const videoTrack = stream.getVideoTracks()[0];
      const audioTrack = stream.getAudioTracks()[0];

      if (videoTrack) {
        bindTrackSafety(videoTrack, "camera");
        setSensor("camera", "active", "local media track");
      } else {
        setSensor("camera", "lost", "no video track");
      }
      if (audioTrack) {
        bindTrackSafety(audioTrack, "microphone");
        setSensor("microphone", "active", "local media track");
      } else {
        setSensor("microphone", "unavailable", "no audio track");
      }

      try {
        await elements.cameraPreview.play();
      } catch (error) {
        if (!sessionIsCurrent(generation) || runtime.stream !== stream) {
          discardSessionStream(stream);
          return;
        }
        dispatch({
          type: "ERROR",
          area: "camera-preview",
          code: error.name || "autoplay",
        });
      }
      if (!sessionIsCurrent(generation) || runtime.stream !== stream) {
        discardSessionStream(stream);
        return;
      }
      startEstimator(generation);
      if (!sessionIsCurrent(generation) || runtime.stream !== stream) {
        discardSessionStream(stream);
        return;
      }
      startSpeechRecognition();
      announce("Sensors active. Speak a broad intent.");
    } catch (error) {
      if (!sessionIsCurrent(generation)) {
        return;
      }
      const code = error && error.name ? error.name : "permission-error";
      setSensor("camera", "denied", code);
      setSensor("microphone", "denied", code);
      setSensor("speech", "unavailable", "permission denied");
      elements.lastHeard.textContent =
        "Permission was not granted. Inputs are frozen; keyboard stop, cancel, and undo remain safe.";
      dispatch({ type: "ERROR", area: "permission", code });
    }
  }

  function simulationStep(delay, label, action, spokenText) {
    const generation = runtime.epoch.current();
    const timer = window.setTimeout(() => {
      if (!sessionIsCurrent(generation)) {
        return;
      }
      if (spokenText) {
        elements.lastHeard.textContent = `Simulated voice: “${spokenText}”`;
      }
      if (label) {
        elements.estimatorLabel.textContent = label;
      }
      dispatch(action);
    }, delay);
    runtime.simulationTimers.push(timer);
  }

  function startSimulation() {
    if (runtime.started) {
      return;
    }
    const generation = beginSession("simulation");
    elements.interactionMode.textContent = "DETERMINISTIC COARSE-GAZE SIMULATION";
    elements.estimatorLabel.textContent = "SIMULATION READY";
    elements.lastHeard.textContent = "Simulation will complete the shared mission hands-free.";
    announce("Deterministic mission simulation started.");

    simulationStep(
      700,
      "VOICE INTENT",
      {
        type: "VOICE",
        source: "simulation",
        text: "Route three cobalt beacons at 14:30, fragile, to ORION-7 through North Gate",
      },
      "Route three cobalt beacons at 14:30, fragile, to ORION-7 through North Gate",
    );
    simulationStep(1800, "GAZE → CONFIRM", {
      type: "HIGHLIGHT",
      index: 0,
      source: "simulation-gaze",
    });
    simulationStep(2700, "DWELL · NO COMMIT", {
      type: "DWELL",
      duration: 900,
      source: "simulation-gaze",
    });
    simulationStep(3400, "CENTER REST", {
      type: "HIGHLIGHT",
      index: null,
      source: "center",
    });
    simulationStep(4200, "GAZE → CONFIRM", {
      type: "HIGHLIGHT",
      index: 0,
      source: "simulation-gaze",
    });
    simulationStep(
      5000,
      "VOICE SELECT",
      { type: "VOICE", source: "simulation", text: "select" },
      "select",
    );
    simulationStep(6100, "GAZE → HOME", {
      type: "HIGHLIGHT",
      index: 0,
      source: "simulation-gaze",
    });
    simulationStep(7300, "NOD CONFIRM", {
      type: "GESTURE",
      gesture: "nod",
      source: "simulation-camera",
    });
    const finishTimer = window.setTimeout(() => {
      if (!sessionIsCurrent(generation)) {
        return;
      }
      const record = machine.exportRecord();
      if (record.complete && record.taskExact) {
        elements.lastHeard.textContent =
          "Simulation complete: exact route confirmed and returned home.";
        announce("Exact tournament mission complete. Voice Orbit returned home.");
      }
    }, 7450);
    runtime.simulationTimers.push(finishTimer);
  }

  function cycleHighlight(direction) {
    const count = machine.state.options.length;
    if (!count) {
      return;
    }
    const current = machine.state.highlight;
    const next =
      current === null ? (direction > 0 ? 0 : count - 1) : (current + direction + count) % count;
    dispatch({ type: "HIGHLIGHT", index: next, source: "keyboard" });
    announce(`${machine.state.options[next].label} highlighted.`);
  }

  function isNativeInteractiveTarget(target) {
    return (
      target instanceof Element &&
      Boolean(
        target.closest(
          'button, a[href], input, select, textarea, summary, [contenteditable="true"], [role="button"], [role="link"]',
        ),
      )
    );
  }

  function terminateForPageHide() {
    runtime.epoch.invalidate();
    if (machine.state.status === "active") {
      machine.dispatch({ type: "STOP", source: "pagehide" });
    }
    stopRuntimeSensors();
    if (runtime.started) {
      render();
    }
  }

  function restoreFromPageCache(event) {
    if (!event.persisted) {
      return;
    }
    runtime.epoch.invalidate();
    if (machine.state.status === "active") {
      machine.dispatch({ type: "STOP", source: "pageshow" });
    }
    stopRuntimeSensors();
    machine = new Core.VoiceOrbitMachine();
    runtime.started = false;
    runtime.simulation = false;
    runtime.petalSignature = "";
    elements.launch.hidden = false;
    elements.workspace.hidden = true;
    elements.startLive.disabled = false;
    elements.startFallback.disabled = false;
    elements.startSimulation.disabled = false;
    elements.lastHeard.textContent = "Listening begins after start.";
    elements.speechCaveat.textContent = "Browser speech service may be network-backed.";
    elements.estimatorLabel.textContent = "WAITING";
    elements.interactionMode.textContent = "COARSE WEBCAM ESTIMATE";
    elements.sessionTime.textContent = "00:00.0";
    document.body.classList.remove("simulation-mode", "fallback-mode", "session-complete");
    render();
    announce("Page restored safely. Start a new session when ready.");
    elements.startLive.focus({ preventScroll: true });
  }

  elements.startLive.addEventListener("click", () => void startLive());
  elements.startFallback.addEventListener("click", startFallback);
  elements.startSimulation.addEventListener("click", startSimulation);
  elements.exportJson.addEventListener("click", () => {
    dispatch({ type: "VOICE", text: "export", source: "touch" });
  });
  elements.fallbackConfirm.addEventListener("click", () => {
    dispatch({ type: "CONFIRM", source: "touch" });
  });
  elements.fallbackCancel.addEventListener("click", () => {
    dispatch({ type: "CANCEL", source: "touch" });
  });
  elements.fallbackUndo.addEventListener("click", () => {
    dispatch({ type: "UNDO", source: "touch" });
  });
  elements.fallbackStop.addEventListener("click", () => {
    dispatch({ type: "STOP", source: "touch" });
  });

  document.addEventListener("keydown", (event) => {
    if (!runtime.started) {
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      dispatch({ type: "UNDO", source: "keyboard" });
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      dispatch({ type: "CANCEL", source: "keyboard" });
      return;
    }
    if (event.key === "Enter" && isNativeInteractiveTarget(event.target)) {
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      dispatch({ type: "CONFIRM", source: "keyboard" });
      return;
    }
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      cycleHighlight(1);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      cycleHighlight(-1);
    }
  });

  window.addEventListener("resize", positionPetals);
  window.addEventListener("pagehide", terminateForPageHide);
  window.addEventListener("pageshow", restoreFromPageCache);
  window.setInterval(() => {
    if (!runtime.started) {
      return;
    }
    const elapsed = elapsedMilliseconds();
    elements.sessionTime.textContent = formatClock(elapsed);
    elements.metricTime.textContent = `${(elapsed / 1000).toFixed(1)}s`;
  }, 100);

  render();
  const query = new URLSearchParams(window.location.search);
  const initialGeneration = runtime.epoch.current();
  if (query.get("simulate") === "1") {
    window.setTimeout(() => {
      if (runtime.epoch.isCurrent(initialGeneration) && !runtime.started) {
        startSimulation();
      }
    }, 0);
  } else if (query.get("fallback") === "1") {
    window.setTimeout(() => {
      if (runtime.epoch.isCurrent(initialGeneration) && !runtime.started) {
        startFallback();
      }
    }, 0);
  }
})();
