(function startGazeCompass() {
  "use strict";

  const Core = window.GazeCompassCore;
  if (!Core) throw new Error("Gaze Compass core failed to load.");

  const elements = {
    activation: document.querySelector("#activation"),
    app: document.querySelector("#app"),
    startLive: document.querySelector("#start-live"),
    startSimulation: document.querySelector("#start-simulation"),
    cameraIndicator: document.querySelector("#camera-indicator"),
    micIndicator: document.querySelector("#mic-indicator"),
    confidenceLabel: document.querySelector("#confidence-label"),
    confidenceFill: document.querySelector("#confidence-fill"),
    sectorShapes: document.querySelector("#sector-shapes"),
    sectorTargets: [...document.querySelectorAll(".sector-target")],
    safeCenter: document.querySelector("#safe-center"),
    gazeCursor: document.querySelector("#gaze-cursor"),
    dwellProgress: document.querySelector("#dwell-progress"),
    calibrationLayer: document.querySelector("#calibration-layer"),
    calibrationTarget: document.querySelector("#calibration-target"),
    calibrationTitle: document.querySelector("#calibration-title"),
    calibrationDetail: document.querySelector("#calibration-detail"),
    calibrationFill: document.querySelector("#calibration-fill"),
    sensorOverlay: document.querySelector("#sensor-overlay"),
    sensorOverlayCopy: document.querySelector("#sensor-overlay-copy"),
    stepLine: document.querySelector("#step-line"),
    stepCount: document.querySelector("#step-count"),
    missionTitle: document.querySelector("#mission-title"),
    spokenGuide: document.querySelector("#spoken-guide"),
    statusCallout: document.querySelector("#status-callout"),
    routeReadback: document.querySelector("#route-readback"),
    sensorMode: document.querySelector("#sensor-mode"),
    dwellRange: document.querySelector("#dwell-range"),
    dwellValue: document.querySelector("#dwell-value"),
    switchControls: [...document.querySelectorAll("[data-action]")],
    exportMetrics: document.querySelector("#export-metrics"),
    endSession: document.querySelector("#end-session"),
    cameraPreview: document.querySelector("#camera-preview"),
    canvas: document.querySelector("#vision-canvas"),
    completionBanner: document.querySelector("#completion-banner"),
    completionCopy: document.querySelector("#completion-copy"),
    completionExport: document.querySelector("#completion-export"),
    politeLive: document.querySelector("#polite-live"),
    assertiveLive: document.querySelector("#assertive-live"),
  };

  const state = {
    mode: "idle",
    task: new Core.TaskModel(),
    controller: null,
    nodDetector: new Core.NodDetector(),
    smoother: null,
    stream: null,
    visionSensor: null,
    sensorGeneration: 0,
    sensorsStopped: true,
    calibrationSequence: null,
    calibrationModel: null,
    calibrationAttempts: 0,
    calibrationStartedAt: null,
    calibrationEndedAt: null,
    calibrationQuality: null,
    calibrationStatus: "not-started",
    calibrationFrame: 0,
    calibrationRetryTimer: 0,
    calibrationInterruptedByFreeze: false,
    monitorTimer: 0,
    recognition: null,
    recognitionRunning: false,
    recognitionWanted: false,
    recognitionRestartTimer: 0,
    speaking: false,
    audioContext: null,
    sessionStartedAt: null,
    completedAt: null,
    cameraStartedAt: null,
    microphoneStartedAt: null,
    cameraAccumulatedMs: 0,
    microphoneAccumulatedMs: 0,
    lastMetrics: null,
    lastMappedPoint: { x: 0, y: 0, confidence: 0 },
    lastRawSampleAt: null,
    lastRawFrameAt: null,
    manualTimer: 0,
    manualDirection: null,
    manualOverrideUntil: 0,
    cycleIndex: -1,
    paused: false,
    completed: false,
    sensorModeName: "not started",
  };

  class PointSmoother {
    constructor() {
      this.point = null;
    }

    reset(point) {
      this.point = point ? { ...point } : null;
    }

    update(point) {
      if (!this.point) {
        this.point = { ...point };
        return { ...this.point };
      }
      const distance = Math.hypot(point.x - this.point.x, point.y - this.point.y);
      const alpha = Math.min(0.42, 0.14 + distance * 0.3 + point.confidence * 0.08);
      this.point = {
        x: this.point.x + (point.x - this.point.x) * alpha,
        y: this.point.y + (point.y - this.point.y) * alpha,
        confidence: point.confidence,
      };
      return { ...this.point };
    }
  }

  class FrameMotionEstimator {
    constructor(width, height) {
      this.width = width;
      this.height = height;
      this.previous = null;
      this.pose = { x: 0.5, y: 0.5 };
    }

    clear() {
      this.previous = null;
      this.pose = { x: 0.5, y: 0.5 };
    }

    estimate(imageData) {
      const pixels = imageData.data;
      const gray = new Uint8Array(this.width * this.height);
      for (let index = 0, pixel = 0; index < gray.length; index += 1, pixel += 4) {
        gray[index] = Math.round(
          pixels[pixel] * 0.299 + pixels[pixel + 1] * 0.587 + pixels[pixel + 2] * 0.114,
        );
      }

      if (!this.previous) {
        this.previous = gray;
        return { ...this.pose, confidence: 0.5 };
      }

      let frameChange = 0;
      let changeSamples = 0;
      for (let y = 8; y < this.height - 8; y += 3) {
        for (let x = 10; x < this.width - 10; x += 3) {
          const index = y * this.width + x;
          frameChange += Math.abs(gray[index] - this.previous[index]);
          changeSamples += 1;
        }
      }
      frameChange /= Math.max(1, changeSamples);

      let best = { score: Number.POSITIVE_INFINITY, dx: 0, dy: 0 };
      for (let dy = -3; dy <= 3; dy += 1) {
        for (let dx = -3; dx <= 3; dx += 1) {
          let score = 0;
          let samples = 0;
          for (let y = 12; y < this.height - 12; y += 2) {
            for (let x = 16; x < this.width - 16; x += 2) {
              const previousIndex = (y - dy) * this.width + (x - dx);
              const currentIndex = y * this.width + x;
              const gradient =
                Math.abs(this.previous[previousIndex] - this.previous[previousIndex - 1]) +
                Math.abs(this.previous[previousIndex] - this.previous[previousIndex - this.width]);
              if (gradient < 7) continue;
              score += Math.abs(gray[currentIndex] - this.previous[previousIndex]);
              samples += 1;
            }
          }
          const normalizedScore = score / Math.max(1, samples);
          if (normalizedScore < best.score) best = { score: normalizedScore, dx, dy };
        }
      }

      if (frameChange > 1.1 && best.score < 48) {
        this.pose.x = Math.min(0.86, Math.max(0.14, this.pose.x + (best.dx / this.width) * 2.7));
        this.pose.y = Math.min(0.86, Math.max(0.14, this.pose.y + (best.dy / this.height) * 2.7));
      }
      this.previous = gray;
      return {
        ...this.pose,
        confidence: frameChange > 0.45 ? 0.6 : 0.54,
      };
    }
  }

  class LocalVisionSensor {
    constructor(video, canvas, callbacks) {
      this.video = video;
      this.canvas = canvas;
      this.context = canvas.getContext("2d", { willReadFrequently: true });
      this.callbacks = callbacks;
      this.motion = new FrameMotionEstimator(canvas.width, canvas.height);
      this.detector = null;
      this.detectorBusy = false;
      this.faceMisses = 0;
      this.running = false;
      this.frameHandle = 0;
      this.videoFrameHandle = null;
      this.lastProcessedAt = 0;
      this.usesVideoFrameCallback = false;
      this.frameGate = new Core.VideoFrameFreshnessGate({ timeoutMs: 1100 });
      this.freezeReported = false;
      this.mode = "frame-motion head-pose fallback";
    }

    start() {
      if ("FaceDetector" in window) {
        try {
          this.detector = new window.FaceDetector({ fastMode: true, maxDetectedFaces: 1 });
          this.mode = "FaceDetector head-pose proxy";
        } catch (_error) {
          this.detector = null;
        }
      }
      this.callbacks.onMode(this.mode);
      this.running = true;
      this.frameGate.start(performance.now());
      this.usesVideoFrameCallback =
        typeof this.video.requestVideoFrameCallback === "function";
      this.scheduleFrame();
    }

    switchToFallback(reason) {
      if (!this.detector) return;
      this.detector = null;
      this.detectorBusy = false;
      this.motion.clear();
      this.mode = "frame-motion head-pose fallback";
      this.callbacks.onMode(this.mode, reason || "FaceDetector unavailable");
    }

    scheduleFrame() {
      if (!this.running) return;
      if (this.usesVideoFrameCallback) {
        this.videoFrameHandle = this.video.requestVideoFrameCallback((now, metadata) => {
          this.videoFrameHandle = null;
          if (!this.running) return;
          this.scheduleFrame();
          this.considerFrame(now, metadata);
        });
      } else {
        this.frameHandle = requestAnimationFrame((now) => {
          if (!this.running) return;
          this.scheduleFrame();
          this.considerFrame(now, null);
        });
      }
    }

    frameDescriptor(metadata) {
      let presentedFrames = metadata && metadata.presentedFrames;
      if (!Number.isFinite(presentedFrames) && this.video.getVideoPlaybackQuality) {
        const quality = this.video.getVideoPlaybackQuality();
        if (Number.isFinite(quality.totalVideoFrames) && quality.totalVideoFrames > 0) {
          presentedFrames = quality.totalVideoFrames;
        }
      }
      if (
        !Number.isFinite(presentedFrames) &&
        Number.isFinite(this.video.webkitDecodedFrameCount) &&
        this.video.webkitDecodedFrameCount > 0
      ) {
        presentedFrames = this.video.webkitDecodedFrameCount;
      }
      return {
        presentedFrames,
        mediaTime: metadata && metadata.mediaTime,
        currentTime: this.video.currentTime,
        timestamp: metadata && metadata.presentationTime,
      };
    }

    handleFreshness(result) {
      const shouldReport =
        !this.callbacks.shouldReportFreshness ||
        this.callbacks.shouldReportFreshness();
      if (result.frozen && shouldReport && !this.freezeReported) {
        this.freezeReported = true;
        this.callbacks.onFreeze("video frame timeout");
      } else if (!result.frozen && result.resumed) {
        const wasReported = this.freezeReported;
        this.freezeReported = false;
        if (shouldReport && wasReported) this.callbacks.onResume();
      }
    }

    checkFreshness(now) {
      const result = this.frameGate.check(now);
      this.handleFreshness(result);
      return result;
    }

    isFresh(now) {
      return this.frameGate.isFresh(now);
    }

    considerFrame(now, metadata) {
      if (
        !this.running ||
        this.video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA
      ) {
        return;
      }
      const freshness = this.frameGate.observe(this.frameDescriptor(metadata), now);
      this.handleFreshness(freshness);
      if (!freshness.fresh) return;
      if (this.callbacks.onFreshFrame) this.callbacks.onFreshFrame(now);
      if (now - this.lastProcessedAt < 82) return;
      this.lastProcessedAt = now;
      this.processFreshFrame(now);
    }

    processFreshFrame(frameObservedAt) {
      this.context.drawImage(this.video, 0, 0, this.canvas.width, this.canvas.height);
      const imageData = this.context.getImageData(0, 0, this.canvas.width, this.canvas.height);
      const fallbackSample = this.motion.estimate(imageData);
      this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);

      if (!this.detector) {
        this.callbacks.onSample(fallbackSample, this.mode, frameObservedAt);
        return;
      }
      if (this.detectorBusy) return;

      this.detectorBusy = true;
      this.detector
        .detect(this.video)
        .then((faces) => {
          if (!this.running) return;
          const freshness = this.frameGate.check(performance.now());
          this.handleFreshness(freshness);
          if (freshness.frozen) return;
          if (faces.length === 1) {
            this.faceMisses = 0;
            const box = faces[0].boundingBox;
            this.callbacks.onSample(
              {
                x: (box.x + box.width / 2) / this.video.videoWidth,
                y: (box.y + box.height / 2) / this.video.videoHeight,
                confidence: 0.9,
              },
              this.mode,
              frameObservedAt,
            );
          } else {
            this.faceMisses += 1;
            this.callbacks.onSample(
              { ...fallbackSample, confidence: 0.12 },
              this.mode,
              frameObservedAt,
            );
            if (this.faceMisses >= 8) this.switchToFallback("No stable face box");
          }
        })
        .catch(() => this.switchToFallback("FaceDetector error"))
        .finally(() => {
          this.detectorBusy = false;
        });
    }

    stop() {
      this.running = false;
      cancelAnimationFrame(this.frameHandle);
      if (
        this.videoFrameHandle !== null &&
        typeof this.video.cancelVideoFrameCallback === "function"
      ) {
        this.video.cancelVideoFrameCallback(this.videoFrameHandle);
      }
      this.videoFrameHandle = null;
      this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.motion.clear();
      this.frameGate.reset();
      this.freezeReported = false;
      this.detector = null;
    }
  }

  function setIndicator(element, stateName, label) {
    element.dataset.state = stateName;
    element.querySelector("span:last-child").textContent = label;
  }

  function setStatus(message, assertive) {
    elements.statusCallout.textContent = message;
    const live = assertive ? elements.assertiveLive : elements.politeLive;
    live.textContent = "";
    window.setTimeout(() => {
      live.textContent = message;
    }, 20);
  }

  function directionTitle(direction) {
    return direction.charAt(0).toUpperCase() + direction.slice(1);
  }

  function optionAt(direction) {
    return Core.optionForDirection(state.task.currentStep(), direction);
  }

  function polarPoint(radius, degrees) {
    const radians = (degrees * Math.PI) / 180;
    return {
      x: 300 + radius * Math.cos(radians),
      y: 300 + radius * Math.sin(radians),
    };
  }

  function annularSectorPath(centerDegrees) {
    const outerStart = polarPoint(270, centerDegrees - 43);
    const outerEnd = polarPoint(270, centerDegrees + 43);
    const innerEnd = polarPoint(116, centerDegrees + 43);
    const innerStart = polarPoint(116, centerDegrees - 43);
    return [
      `M ${innerStart.x} ${innerStart.y}`,
      `L ${outerStart.x} ${outerStart.y}`,
      `A 270 270 0 0 1 ${outerEnd.x} ${outerEnd.y}`,
      `L ${innerEnd.x} ${innerEnd.y}`,
      `A 116 116 0 0 0 ${innerStart.x} ${innerStart.y}`,
      "Z",
    ].join(" ");
  }

  function buildCompassGeometry() {
    const namespace = "http://www.w3.org/2000/svg";
    const centers = { north: -90, east: 0, south: 90, west: 180 };
    for (const direction of Core.DIRECTIONS) {
      const path = document.createElementNS(namespace, "path");
      path.setAttribute("d", annularSectorPath(centers[direction]));
      path.setAttribute("class", "sector-shape");
      path.dataset.direction = direction;
      elements.sectorShapes.append(path);
    }
  }

  function updateConfidence(confidence) {
    const percent = Math.round(Math.max(0, Math.min(1, confidence || 0)) * 100);
    elements.confidenceLabel.textContent = `${percent}%`;
    elements.confidenceFill.style.width = `${percent}%`;
    elements.gazeCursor.dataset.confidence = percent >= 46 ? "high" : "low";
  }

  function updateCursor(point) {
    const x = Math.max(7, Math.min(93, 50 + point.x * 38));
    const y = Math.max(7, Math.min(93, 50 + point.y * 38));
    elements.gazeCursor.style.left = `${x}%`;
    elements.gazeCursor.style.top = `${y}%`;
    updateConfidence(point.confidence);
  }

  function renderController(snapshot) {
    const current = snapshot || {
      sector: null,
      armed: false,
      progress: 0,
      state: "rest",
      centerRequired: false,
    };
    const shapes = [...elements.sectorShapes.querySelectorAll(".sector-shape")];
    for (const element of [...elements.sectorTargets, ...shapes]) {
      const focused = element.dataset.direction === current.sector;
      element.classList.toggle("is-focused", focused);
      element.classList.toggle("is-armed", focused && current.armed);
      if (element.matches("button")) {
        element.setAttribute("aria-pressed", String(focused));
      }
    }
    elements.safeCenter.classList.toggle(
      "is-active",
      current.state === "rest" || current.state === "dead-zone",
    );
    elements.safeCenter.classList.toggle("is-recovery", current.centerRequired);
    elements.dwellProgress.style.setProperty(
      "--dwell-progress",
      `${Math.round(current.progress * 100)}%`,
    );
  }

  function guideForStep(step) {
    if (!step) {
      return state.task.routeCommitted
        ? "Route committed. Return your gaze to the center circle to finish safely."
        : "The route does not match the task. Say “undo” to repair it.";
    }
    const expected = step.options.find((option) => option.id === step.expected);
    return `Say “${expected.label}.” It is ${directionTitle(expected.direction)}. Look there, hold, then confirm.`;
  }

  function routeValue(step, optionId) {
    if (!optionId) return "pending";
    const option = step.options.find((candidate) => candidate.id === optionId);
    return option ? option.label : optionId;
  }

  function renderTask() {
    const snapshot = state.task.snapshot();
    const step = state.task.currentStep();
    elements.stepLine.replaceChildren();
    for (let index = 0; index < Core.TASK_STEPS.length; index += 1) {
      const dot = document.createElement("span");
      dot.className = "step-dot";
      if (index < snapshot.stepIndex) dot.classList.add("is-complete");
      if (index === snapshot.stepIndex) dot.classList.add("is-current");
      elements.stepLine.append(dot);
    }
    elements.stepCount.textContent = step
      ? `Step ${snapshot.stepIndex + 1} of ${Core.TASK_STEPS.length}`
      : snapshot.routeCommitted
        ? "All 7 choices confirmed"
        : "Review needs repair";
    elements.missionTitle.textContent = step
      ? step.prompt
      : snapshot.routeCommitted
        ? "Return home to complete"
        : "Route mismatch — undo to repair";
    elements.spokenGuide.textContent = guideForStep(step);

    for (const target of elements.sectorTargets) {
      const option = Core.optionForDirection(step, target.dataset.direction);
      target.querySelector(".option-label").textContent = option ? option.label : "Safe rest";
      target.disabled = !step || state.calibrationStatus === "running";
      target.setAttribute(
        "aria-label",
        option
          ? `${directionTitle(target.dataset.direction)}: ${option.label}. Hold to focus; this does not execute.`
          : `${directionTitle(target.dataset.direction)} inactive`,
      );
    }

    elements.routeReadback.replaceChildren();
    for (const candidate of Core.TASK_STEPS) {
      const token = document.createElement("span");
      token.className = "route-token";
      if (snapshot.selections[candidate.id]) token.classList.add("is-set");
      token.textContent = `${candidate.id}: ${routeValue(candidate, snapshot.selections[candidate.id])}`;
      elements.routeReadback.append(token);
    }
  }

  function initializeAudio() {
    if (state.audioContext) return;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    state.audioContext = new AudioContextClass();
    if (state.audioContext.state === "suspended") state.audioContext.resume();
  }

  function earcon(kind) {
    if (!state.audioContext || state.audioContext.state !== "running") return;
    const profiles = {
      focus: [330, 0.05],
      armed: [520, 0.1],
      confirm: [660, 0.14],
      cancel: [230, 0.11],
      warning: [180, 0.18],
    };
    const profile = profiles[kind] || profiles.focus;
    const oscillator = state.audioContext.createOscillator();
    const gain = state.audioContext.createGain();
    const startsAt = state.audioContext.currentTime;
    oscillator.frequency.setValueAtTime(profile[0], startsAt);
    if (kind === "confirm") {
      oscillator.frequency.linearRampToValueAtTime(profile[0] * 1.28, startsAt + profile[1]);
    }
    gain.gain.setValueAtTime(0.0001, startsAt);
    gain.gain.exponentialRampToValueAtTime(0.08, startsAt + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, startsAt + profile[1]);
    oscillator.connect(gain);
    gain.connect(state.audioContext.destination);
    oscillator.start(startsAt);
    oscillator.stop(startsAt + profile[1] + 0.02);
  }

  function stopRecognitionForSpeech() {
    if (!state.recognition || !state.recognitionRunning) return;
    try {
      state.recognition.abort();
    } catch (_error) {
      state.recognitionRunning = false;
    }
  }

  function speak(message, interrupt) {
    if (!("speechSynthesis" in window) || !message) return;
    if (interrupt) window.speechSynthesis.cancel();
    stopRecognitionForSpeech();
    const utterance = new SpeechSynthesisUtterance(message);
    utterance.rate = 0.96;
    utterance.pitch = 1;
    utterance.volume = 0.9;
    utterance.onstart = () => {
      state.speaking = true;
    };
    utterance.onend = () => {
      state.speaking = false;
      scheduleRecognitionRestart(280);
    };
    utterance.onerror = () => {
      state.speaking = false;
      scheduleRecognitionRestart(280);
    };
    window.speechSynthesis.speak(utterance);
  }

  function buildController() {
    state.controller = new Core.GazeIntentController({
      dwellMs: Number(elements.dwellRange.value),
      onFocus(direction) {
        const option = optionAt(direction);
        setStatus(`${option ? option.label : direction}: hold steady.`);
        earcon("focus");
        renderController(state.controller.snapshot());
      },
      onCandidate(direction) {
        const option = optionAt(direction);
        if (!option) return;
        setStatus(`${option.label} focused. Keep holding to arm.`);
        speak(`${option.label}. Hold to arm.`, true);
      },
      onArm(direction) {
        state.nodDetector.beginArm();
        const option = optionAt(direction);
        if (!option) return;
        earcon("armed");
        setStatus(`${option.label} armed. Say confirm or nod deliberately.`, true);
        speak(`${option.label} armed. Say confirm or nod.`, true);
        renderController(state.controller.snapshot());
      },
      onExecute(direction, source, now) {
        state.nodDetector.endArm();
        const selection = state.task.choose(direction, source, now);
        if (!selection) return;
        earcon("confirm");
        renderTask();
        if (state.task.routeCommitted) {
          setStatus("Route committed. Return to the center circle to finish.", true);
          speak("Route committed. Return to center to finish.", true);
        } else if (!state.task.currentStep()) {
          setStatus("Route mismatch. Nothing was sent. Say undo to repair.", true);
          speak("Route mismatch. Nothing was sent. Say undo to repair.", true);
        } else {
          const nextStep = state.task.currentStep();
          const expected = nextStep.options.find((option) => option.id === nextStep.expected);
          setStatus(`${selection.label} confirmed. ${expected.label} is ${expected.direction}.`);
          speak(`${selection.label} confirmed. Next, ${expected.label}, ${expected.direction}.`, true);
        }
      },
      onCancel(reason, direction) {
        state.nodDetector.endArm();
        if (reason === "confirmed") return;
        earcon("cancel");
        const option = direction ? optionAt(direction) : null;
        setStatus(`${option ? option.label : "Candidate"} canceled. Center is safe.`);
      },
      onCenter() {
        state.nodDetector.endArm();
        renderController(state.controller.snapshot());
        if (state.task.routeCommitted && !state.task.home) {
          state.task.returnHome();
          completeSession();
          return;
        }
        setStatus("Safe center. No choice is armed.");
      },
      onConfidencePause() {
        state.nodDetector.endArm();
        setStatus("Confidence low. Dwell timer paused; nothing can execute.");
      },
      onSensorLost(reason) {
        state.nodDetector.endArm();
        earcon("warning");
        elements.sensorOverlay.classList.remove("is-hidden");
        elements.sensorOverlayCopy.textContent =
          "No choice can arm or execute. Reacquire the camera, then return to center.";
        setIndicator(elements.cameraIndicator, "paused", "Camera signal paused");
        setStatus(`Sensor loss: ${reason}. Armed input cleared.`, true);
        speak("Sensor signal lost. Input cleared. Return to center after recovery.", true);
      },
      onRecovered() {
        state.nodDetector.endArm();
        elements.sensorOverlay.classList.add("is-hidden");
        if (state.stream) setIndicator(elements.cameraIndicator, "on", "Camera local");
        setStatus("Signal recovered at safe center.");
        speak("Signal recovered. Center safe.", true);
      },
    });
    renderController(state.controller.snapshot());
  }

  function updateControllerFromPoint(point, now, allowNod, inputSource) {
    if (!state.controller || state.paused || state.completed) return;
    const snapshot = state.controller.update(point, now, {
      source: inputSource || "manual",
    });
    renderController(snapshot);
    if (
      allowNod &&
      snapshot.armed &&
      Core.DIRECTIONS.includes(snapshot.sector) &&
      state.nodDetector.update(point.y, point.confidence, now)
    ) {
      confirmAction("gesture");
    }
  }

  function onSensorSample(rawPoint, sensorMode, now) {
    state.lastRawSampleAt = now;
    state.sensorModeName = sensorMode;
    elements.sensorMode.textContent = `Sensor: ${sensorMode} · local, ephemeral`;

    if (state.calibrationStatus === "running" && state.calibrationSequence) {
      state.calibrationSequence.ingest(rawPoint, now);
      updateConfidence(rawPoint.confidence);
      return;
    }
    if (!state.calibrationModel || state.calibrationStatus !== "complete") {
      updateConfidence(rawPoint.confidence);
      return;
    }

    const mapped = Core.mapCalibratedPoint(state.calibrationModel, rawPoint);
    const smoothed = state.smoother.update(mapped);
    state.lastMappedPoint = smoothed;
    updateCursor(smoothed);
    if (now < state.manualOverrideUntil) return;
    updateControllerFromPoint(smoothed, now, true, "sensor");
  }

  function monitorSensor() {
    window.clearInterval(state.monitorTimer);
    state.monitorTimer = window.setInterval(() => {
      const now = performance.now();
      if (!shouldRunSensorWatchdog(now)) return;
      state.visionSensor.checkFreshness(now);
    }, 250);
  }

  function shouldRunSensorWatchdog(now) {
    return (
      state.mode === "live" &&
      Boolean(state.visionSensor) &&
      !state.sensorsStopped &&
      !state.paused &&
      !state.completed &&
      now >= state.manualOverrideUntil
    );
  }

  function calibrationPosition(target) {
    return {
      center: { left: 50, top: 50 },
      north: { left: 50, top: 16 },
      east: { left: 84, top: 50 },
      south: { left: 50, top: 84 },
      west: { left: 16, top: 50 },
    }[target];
  }

  function announceCalibrationTarget(target, phase) {
    const label = target === "center" ? "center" : directionTitle(target);
    elements.calibrationTitle.textContent = `Look at ${label}`;
    elements.calibrationDetail.textContent =
      phase === "settle" ? "Turn naturally. Capture begins automatically." : "Hold naturally. No click needed.";
    speak(`Look ${label}.`, true);
  }

  function resetCalibrationOverlay() {
    elements.calibrationLayer.classList.add("is-hidden");
    elements.calibrationFill.style.width = "0%";
    elements.calibrationTarget.style.left = "50%";
    elements.calibrationTarget.style.top = "50%";
    elements.calibrationTarget.style.transform = "translate(-50%, -50%)";
    elements.calibrationTitle.textContent = "Look at center";
    elements.calibrationDetail.textContent = "Hold naturally. No click needed.";
  }

  function beginCalibrationLifecycle(now) {
    state.calibrationStatus = "running";
    state.calibrationStartedAt = now;
    state.calibrationEndedAt = null;
    state.calibrationModel = null;
    state.calibrationQuality = null;
    state.calibrationInterruptedByFreeze = false;
  }

  function finalizeCalibrationLifecycle(status, now, model, preserveEnd) {
    const startedAt = state.calibrationStartedAt;
    if (!preserveEnd || state.calibrationEndedAt === null) {
      state.calibrationEndedAt = Number.isFinite(startedAt)
        ? Math.max(startedAt, Number.isFinite(now) ? now : startedAt)
        : null;
    }
    state.calibrationStatus = status;
    if (status === "complete" && model) {
      state.calibrationModel = model;
      state.calibrationQuality = model.quality;
    } else {
      state.calibrationModel = null;
      state.calibrationQuality = null;
    }
    state.calibrationSequence = null;
  }

  function startCalibration(reason) {
    if (state.mode === "live" && !state.stream) return;
    cancelAnimationFrame(state.calibrationFrame);
    window.clearTimeout(state.calibrationRetryTimer);
    state.calibrationAttempts += 1;
    const startedAt = performance.now();
    beginCalibrationLifecycle(startedAt);
    state.calibrationSequence = new Core.TimedCalibration({ settleMs: 350, captureMs: 950 });
    state.calibrationSequence.start(startedAt);
    state.smoother = new PointSmoother();
    resetCalibrationOverlay();
    elements.calibrationLayer.classList.remove("is-hidden");
    elements.sensorOverlay.classList.add("is-hidden");
    renderTask();
    let previousTarget = "";

    const tick = (now) => {
      if (state.calibrationStatus !== "running") return;
      const status = state.calibrationSequence.status(now);
      const position = calibrationPosition(status.target);
      elements.calibrationTarget.style.left = `${position.left}%`;
      elements.calibrationTarget.style.top = `${position.top}%`;
      elements.calibrationTarget.style.transform = "translate(-50%, -50%)";
      elements.calibrationFill.style.width = `${Math.round(status.totalProgress * 100)}%`;
      if (status.target !== previousTarget) {
        previousTarget = status.target;
        announceCalibrationTarget(status.target, status.phase);
      } else {
        elements.calibrationDetail.textContent =
          status.phase === "settle"
            ? "Turn naturally. Capture begins automatically."
            : "Hold naturally. No click needed.";
      }

      if (!status.done) {
        state.calibrationFrame = requestAnimationFrame(tick);
        return;
      }

      try {
        const model = state.calibrationSequence.finish(now);
        finalizeCalibrationLifecycle("complete", now, model, false);
        resetCalibrationOverlay();
        state.smoother.reset({ x: 0, y: 0, confidence: 1 });
        buildController();
        renderTask();
        const quality = Math.round(state.calibrationQuality * 100);
        setStatus(`Calibration complete at ${quality}% quality. Center is safe.`);
        speak("Calibration complete. Center is safe. Say route, then look north.", true);
      } catch (error) {
        if (state.calibrationAttempts < 3) {
          finalizeCalibrationLifecycle("retrying", now, null, false);
          resetCalibrationOverlay();
          setStatus("Signal was not separated enough. Calibration restarts automatically.", true);
          state.calibrationRetryTimer = window.setTimeout(
            () => startCalibration("automatic retry"),
            700,
          );
        } else {
          finalizeCalibrationLifecycle("failed", now, null, false);
          resetCalibrationOverlay();
          state.paused = false;
          buildController();
          renderTask();
          elements.sensorOverlay.classList.remove("is-hidden");
          elements.sensorOverlayCopy.textContent =
            "Camera calibration was inconclusive. Voice, keyboard, touch, and switch controls remain available.";
          setStatus(`${error.message} Gaze paused; parity controls remain available.`, true);
          speak("Camera calibration inconclusive. Use voice, keyboard, touch, or switch controls.", true);
        }
      }
    };

    setStatus(
      reason
        ? `Calibration restarted automatically: ${reason}.`
        : "Timed calibration started. Follow the moving target; no clicks needed.",
    );
    state.calibrationFrame = requestAnimationFrame(tick);
  }

  function onSensorMode(mode, reason) {
    const changed = state.sensorModeName !== "not started" && state.sensorModeName !== mode;
    state.sensorModeName = mode;
    elements.sensorMode.textContent = `Sensor: ${mode} · local, ephemeral`;
    if (
      changed &&
      state.mode === "live" &&
      (state.calibrationStatus === "running" || state.calibrationStatus === "complete")
    ) {
      if (state.controller) state.controller.markSensorLost(performance.now(), "estimator changed");
      state.calibrationAttempts = 0;
      startCalibration(reason || "estimator changed");
    }
  }

  function handleVideoFreeze(reason) {
    if (state.calibrationStatus === "running") {
      cancelAnimationFrame(state.calibrationFrame);
      finalizeCalibrationLifecycle("frozen", performance.now(), null, false);
      state.calibrationInterruptedByFreeze = true;
      resetCalibrationOverlay();
    }
    handleTrackLoss(reason);
    elements.sensorOverlay.classList.remove("is-hidden");
    elements.sensorOverlayCopy.textContent =
      "Video frames stopped advancing. Stale pixels are ignored; input is cleared until fresh frames return and center is reacquired.";
    setStatus("Video frozen. No stale frame can refresh or arm a choice.", true);
  }

  function handleVideoResume() {
    if (state.calibrationInterruptedByFreeze && state.stream) {
      state.calibrationAttempts = 0;
      startCalibration("fresh video frames resumed");
      return;
    }
    setStatus("Fresh video frames resumed. Return to center to recover.");
  }

  function activateApplication(mode) {
    state.mode = mode;
    state.sessionStartedAt = performance.now();
    elements.activation.classList.add("is-hidden");
    elements.app.classList.remove("is-hidden");
    buildCompassGeometry();
    renderTask();
    updateCursor({ x: 0, y: 0, confidence: mode === "simulation" ? 1 : 0 });
  }

  function beginSensorLifecycle() {
    state.sensorGeneration += 1;
    state.sensorsStopped = false;
    return state.sensorGeneration;
  }

  function stopSensorLifecycle() {
    state.sensorGeneration += 1;
    state.sensorsStopped = true;
  }

  function isCurrentSensorLifecycle(generation) {
    return !state.sensorsStopped && generation === state.sensorGeneration;
  }

  function disposeDetachedStream(stream) {
    if (!stream) return;
    let tracks = [];
    try {
      tracks = stream.getTracks();
    } catch (_error) {
      tracks = [];
    }
    for (const track of tracks) {
      try {
        track.stop();
      } catch (_error) {
        // The detached track may already have ended.
      }
    }
  }

  function finalizeCameraOnTime(now) {
    if (state.cameraStartedAt === null) return;
    state.cameraAccumulatedMs = Core.sensorOnDuration(
      state.cameraAccumulatedMs,
      state.cameraStartedAt,
      now,
    );
    state.cameraStartedAt = null;
  }

  function finalizeMicrophoneOnTime(now) {
    if (state.microphoneStartedAt === null) return;
    state.microphoneAccumulatedMs = Core.sensorOnDuration(
      state.microphoneAccumulatedMs,
      state.microphoneStartedAt,
      now,
    );
    state.microphoneStartedAt = null;
  }

  function releaseMediaResources(options) {
    const config = { markSensorLoss: false, ...(options || {}) };
    cancelAnimationFrame(state.calibrationFrame);
    state.calibrationFrame = 0;
    window.clearTimeout(state.calibrationRetryTimer);
    state.calibrationRetryTimer = 0;
    window.clearInterval(state.monitorTimer);
    state.monitorTimer = 0;
    if (["running", "retrying", "frozen"].includes(state.calibrationStatus)) {
      finalizeCalibrationLifecycle(
        "shutdown",
        performance.now(),
        null,
        state.calibrationEndedAt !== null,
      );
    }
    resetCalibrationOverlay();

    if (state.visionSensor) {
      try {
        state.visionSensor.stop();
      } catch (_error) {
        // Track cleanup below remains authoritative if the processing loop failed.
      }
      state.visionSensor = null;
    }
    state.recognitionWanted = false;
    window.clearTimeout(state.recognitionRestartTimer);
    state.recognitionRestartTimer = 0;
    if (state.recognition) {
      try {
        state.recognition.abort();
      } catch (_error) {
        state.recognitionRunning = false;
      }
      state.recognition = null;
    }

    const now = performance.now();
    finalizeCameraOnTime(now);
    finalizeMicrophoneOnTime(now);
    const stream = state.stream;
    state.stream = null;
    if (stream) {
      let tracks = [];
      try {
        tracks = stream.getTracks();
      } catch (_error) {
        tracks = [];
      }
      for (const track of tracks) {
        try {
          track.stop();
        } catch (_error) {
          // A track that ended during cleanup is already stopped.
        }
      }
    }

    try {
      elements.cameraPreview.pause();
    } catch (_error) {
      // The preview may not have reached a playable state.
    }
    elements.cameraPreview.srcObject = null;
    elements.cameraPreview.classList.add("is-hidden");
    const context = elements.canvas.getContext("2d");
    if (context) context.clearRect(0, 0, elements.canvas.width, elements.canvas.height);
    state.calibrationSequence = null;
    state.smoother = null;
    state.calibrationInterruptedByFreeze = false;
    state.lastRawFrameAt = null;
    state.nodDetector.endArm();

    setIndicator(elements.cameraIndicator, "off", "Camera off");
    setIndicator(elements.micIndicator, "off", "Mic off");
    if (config.markSensorLoss && state.controller && !state.completed) {
      state.controller.markSensorLost(now, "sensors ended");
      renderController(state.controller.snapshot());
    }
  }

  async function startLive() {
    if (state.mode !== "idle") return;
    const generation = beginSensorLifecycle();
    let acquiredStream = null;
    elements.startLive.disabled = true;
    initializeAudio();
    activateApplication("live");
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      stopSensorLifecycle();
      enterParityOnlyMode("Camera and microphone APIs are unavailable in this browser.");
      return;
    }

    try {
      acquiredStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
          width: { ideal: 640 },
          height: { ideal: 480 },
          frameRate: { ideal: 24, max: 30 },
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      if (!isCurrentSensorLifecycle(generation)) {
        disposeDetachedStream(acquiredStream);
        return;
      }
      state.stream = acquiredStream;
      const now = performance.now();
      state.cameraStartedAt = now;
      state.microphoneStartedAt = now;
      setIndicator(elements.cameraIndicator, "on", "Camera local");
      setIndicator(elements.micIndicator, "on", "Mic listening");
      elements.cameraPreview.srcObject = state.stream;
      elements.cameraPreview.classList.remove("is-hidden");
      await elements.cameraPreview.play();
      if (!isCurrentSensorLifecycle(generation)) {
        disposeDetachedStream(acquiredStream);
        return;
      }

      const videoTrack = state.stream.getVideoTracks()[0];
      const audioTrack = state.stream.getAudioTracks()[0];
      if (videoTrack) {
        videoTrack.addEventListener("ended", () => {
          finalizeCameraOnTime(performance.now());
          handleTrackLoss("camera track ended");
          setIndicator(elements.cameraIndicator, "off", "Camera ended");
        });
        videoTrack.addEventListener("mute", () => handleTrackLoss("camera muted"));
      } else {
        finalizeCameraOnTime(performance.now());
      }
      if (audioTrack) {
        audioTrack.addEventListener("ended", () => {
          finalizeMicrophoneOnTime(performance.now());
          setIndicator(elements.micIndicator, "off", "Mic unavailable");
          state.recognitionWanted = false;
        });
      } else {
        finalizeMicrophoneOnTime(performance.now());
      }

      state.visionSensor = new LocalVisionSensor(
        elements.cameraPreview,
        elements.canvas,
        {
          onSample: onSensorSample,
          onMode: onSensorMode,
          onFreeze: handleVideoFreeze,
          onResume: handleVideoResume,
          onFreshFrame(now) {
            state.lastRawFrameAt = now;
          },
          shouldReportFreshness() {
            return shouldRunSensorWatchdog(performance.now());
          },
        },
      );
      state.visionSensor.start();
      monitorSensor();
      initializeRecognition();
      startCalibration();
    } catch (error) {
      if (!isCurrentSensorLifecycle(generation)) {
        if (acquiredStream && state.stream !== acquiredStream) {
          disposeDetachedStream(acquiredStream);
        }
        return;
      }
      stopSensorLifecycle();
      releaseMediaResources({ markSensorLoss: false });
      enterParityOnlyMode(
        `Permission or sensor start failed: ${error && error.name ? error.name : "unavailable"}.`,
      );
    }
  }

  function enterParityOnlyMode(message) {
    state.sensorsStopped = true;
    state.paused = false;
    if (state.calibrationStartedAt === null) {
      state.calibrationStatus = "parity-only";
      state.calibrationEndedAt = null;
      state.calibrationModel = null;
      state.calibrationQuality = null;
    } else if (["running", "retrying", "frozen"].includes(state.calibrationStatus)) {
      finalizeCalibrationLifecycle(
        "interrupted",
        performance.now(),
        null,
        state.calibrationEndedAt !== null,
      );
    }
    resetCalibrationOverlay();
    state.sensorModeName = "parity controls only";
    elements.sensorMode.textContent = "Sensor: parity controls only · no camera frames";
    setIndicator(elements.cameraIndicator, "off", "Camera off");
    setIndicator(elements.micIndicator, "off", "Mic off");
    elements.sensorOverlay.classList.remove("is-hidden");
    elements.sensorOverlayCopy.textContent =
      "No sensor permission is active. Keyboard, touch, and switch controls can still complete the identical task.";
    if (!state.controller) buildController();
    renderTask();
    setStatus(`${message} No action was taken; parity controls are ready.`, true);
  }

  function handleTrackLoss(reason) {
    if (state.completed || !state.stream) return;
    if (state.controller) state.controller.markSensorLost(performance.now(), reason);
    setIndicator(elements.cameraIndicator, "paused", "Camera signal lost");
  }

  function initializeRecognition() {
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) {
      state.recognitionWanted = false;
      elements.sensorMode.textContent += " · voice recognition unavailable";
      setStatus("Camera ready. Browser voice recognition unavailable; gesture and parity controls remain.");
      return;
    }
    state.recognition = new Recognition();
    state.recognition.continuous = true;
    state.recognition.interimResults = false;
    state.recognition.lang = "en-US";
    state.recognition.maxAlternatives = 1;
    state.recognition.onstart = () => {
      state.recognitionRunning = true;
      setIndicator(elements.micIndicator, "on", "Mic listening");
    };
    state.recognition.onresult = (event) => {
      const result = event.results[event.results.length - 1];
      if (!result.isFinal || state.speaking) return;
      handleVoice(result[0].transcript);
    };
    state.recognition.onerror = (event) => {
      state.recognitionRunning = false;
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        state.recognitionWanted = false;
        setIndicator(elements.micIndicator, "paused", "Voice unavailable");
        setStatus("Browser speech recognition is unavailable. Camera, gesture, and parity controls remain.");
      }
    };
    state.recognition.onend = () => {
      state.recognitionRunning = false;
      scheduleRecognitionRestart(350);
    };
    state.recognitionWanted = true;
    scheduleRecognitionRestart(0);
  }

  function scheduleRecognitionRestart(delay) {
    window.clearTimeout(state.recognitionRestartTimer);
    if (
      !state.recognitionWanted ||
      !state.recognition ||
      state.recognitionRunning ||
      state.speaking ||
      state.mode !== "live"
    ) {
      return;
    }
    state.recognitionRestartTimer = window.setTimeout(() => {
      if (state.speaking || state.recognitionRunning || !state.recognitionWanted) return;
      try {
        state.recognition.start();
      } catch (_error) {
        scheduleRecognitionRestart(700);
      }
    }, delay);
  }

  function repeatCurrentGuide() {
    const step = state.task.currentStep();
    if (!step) {
      speak(guideForStep(step), true);
      return;
    }
    const options = step.options
      .map((option) => `${directionTitle(option.direction)}, ${option.label}`)
      .join(". ");
    speak(`${step.prompt}. ${options}.`, true);
  }

  function undoLastChoice(source) {
    if (!state.task.undo()) return false;
    stopManualHold();
    state.nodDetector.endArm();
    if (state.controller) {
      state.controller.cancel(`${source}-undo`);
      renderController(state.controller.snapshot());
    }
    state.completed = false;
    state.completedAt = null;
    state.lastMetrics = null;
    elements.completionBanner.classList.add("is-hidden");
    elements.exportMetrics.disabled = true;
    renderTask();
    setStatus("Last choice undone. Return to center, then choose again.", true);
    speak("Last choice undone. Return to center.", true);
    return true;
  }

  function handleVoice(transcript) {
    const command = Core.parseVoiceCommand(transcript, state.task.currentStep());
    switch (command.type) {
      case "confirm":
        confirmAction("voice");
        break;
      case "cancel":
        stopManualHold();
        state.nodDetector.endArm();
        if (state.controller) {
          renderController(state.controller.cancel("voice-cancel"));
          setStatus("Canceled by voice. Return to center to continue.", true);
        }
        break;
      case "stop":
        state.paused = true;
        stopManualHold();
        state.nodDetector.endArm();
        if (state.controller) state.controller.cancel("voice-stop");
        elements.sensorOverlay.classList.remove("is-hidden");
        elements.sensorOverlayCopy.textContent =
          "Stopped by voice. No input can arm. Say “resume” or use Center.";
        setIndicator(elements.cameraIndicator, "paused", "Input stopped");
        setStatus("Stopped. All armed input cleared.", true);
        speak("Stopped. All input cleared. Say resume when ready.", true);
        break;
      case "resume":
        state.paused = false;
        state.nodDetector.endArm();
        elements.sensorOverlay.classList.add("is-hidden");
        if (state.stream) setIndicator(elements.cameraIndicator, "on", "Camera local");
        if (state.controller) state.controller.cancel("resume-center");
        setStatus("Resumed. Return to center before choosing.", true);
        speak("Resumed. Return to center.", true);
        break;
      case "undo":
        undoLastChoice("voice");
        break;
      case "rejected-confirm":
        setStatus("Confirmation rejected. Say exactly “confirm” or “approve.” Nothing changed.", true);
        speak("Confirmation rejected. Say confirm or approve exactly.", true);
        break;
      case "center":
        centerAction("voice");
        break;
      case "dwell": {
        const nextValue = Math.max(
          Number(elements.dwellRange.min),
          Math.min(Number(elements.dwellRange.max), Number(elements.dwellRange.value) + command.delta),
        );
        elements.dwellRange.value = String(nextValue);
        updateDwell();
        speak(`Dwell ${nextValue / 1000} seconds.`, true);
        break;
      }
      case "repeat":
        repeatCurrentGuide();
        break;
      case "export":
        if (state.lastMetrics) downloadMetrics();
        else speak("Metrics become available after completion.", true);
        break;
      case "value":
        if (command.option) {
          setStatus(
            `${command.option.label} is ${directionTitle(command.option.direction)}. Look there and hold.`,
          );
          speak(`${command.option.label} is ${command.option.direction}. Look there and hold.`, true);
        }
        break;
      default:
        setStatus(`Heard “${transcript.trim()}.” No safe command matched; nothing changed.`);
    }
  }

  function stopManualHold(returnCenterIfUnarmed) {
    window.clearInterval(state.manualTimer);
    state.manualTimer = 0;
    state.manualDirection = null;
    if (
      returnCenterIfUnarmed &&
      state.controller &&
      !state.controller.snapshot().armed
    ) {
      updateControllerFromPoint({ x: 0, y: 0, confidence: 1 }, performance.now(), false);
      updateCursor({ x: 0, y: 0, confidence: 1 });
    }
  }

  function startManualHold(direction, autoHold) {
    if (
      !state.controller ||
      state.paused ||
      state.completed ||
      !Core.DIRECTIONS.includes(direction)
    ) {
      return;
    }
    stopManualHold();
    state.manualDirection = direction;
    state.manualOverrideUntil = performance.now() + 4000;
    const point = { ...Core.DIRECTION_POINTS[direction], confidence: 1 };
    const tick = () => {
      const now = performance.now();
      updateCursor(point);
      updateControllerFromPoint(point, now, false);
      if (state.controller.snapshot().armed && autoHold) stopManualHold(false);
    };
    tick();
    state.manualTimer = window.setInterval(tick, 60);
  }

  function centerAction(source) {
    if (!state.controller) return;
    const resumedFromPause = state.paused;
    state.paused = false;
    if (resumedFromPause) {
      elements.sensorOverlay.classList.add("is-hidden");
      if (state.stream) setIndicator(elements.cameraIndicator, "on", "Camera local");
    }
    state.nodDetector.endArm();
    stopManualHold();
    state.manualOverrideUntil = performance.now() + 600;
    const center = { x: 0, y: 0, confidence: 1 };
    updateCursor(center);
    updateControllerFromPoint(center, performance.now(), false);
    if (!state.completed) setStatus(`Safe center reached by ${source}. No choice is armed.`);
  }

  function confirmAction(source) {
    if (!state.controller || state.paused || state.completed) return false;
    const now = performance.now();
    const arm = state.controller.snapshot();
    const sensorFresh =
      arm.armedSource !== "sensor" ||
      (!state.sensorsStopped &&
        Boolean(state.visionSensor) &&
        state.visionSensor.isFresh(now));
    state.nodDetector.endArm();
    const confirmed = state.controller.confirm(source, now, { sensorFresh });
    renderController(state.controller.snapshot());
    if (!confirmed) {
      earcon("cancel");
      setStatus("Confirm blocked: hold one sector until it is armed.", true);
      speak("Not armed. Hold a direction first.", true);
    }
    return confirmed;
  }

  function cycleDirection() {
    state.cycleIndex = (state.cycleIndex + 1) % Core.DIRECTIONS.length;
    const direction = Core.DIRECTIONS[state.cycleIndex];
    startManualHold(direction, true);
    const option = optionAt(direction);
    setStatus(`Switch scan: ${directionTitle(direction)}, ${option ? option.label : "inactive"}.`);
  }

  function updateDwell() {
    const dwell = Number(elements.dwellRange.value);
    elements.dwellValue.value = `${(dwell / 1000).toFixed(1)} s`;
    elements.dwellValue.textContent = `${(dwell / 1000).toFixed(1)} s`;
    if (state.controller) state.controller.setDwell(dwell);
  }

  function privacyTiming(now) {
    const timestamp = now || performance.now();
    return {
      cameraOnMs: Math.round(
        Core.sensorOnDuration(state.cameraAccumulatedMs, state.cameraStartedAt, timestamp),
      ),
      microphoneOnMs: Math.round(
        Core.sensorOnDuration(
          state.microphoneAccumulatedMs,
          state.microphoneStartedAt,
          timestamp,
        ),
      ),
    };
  }

  function buildLiveMetrics(nowOverride) {
    const now = Number.isFinite(nowOverride) ? nowOverride : performance.now();
    const completionAt = state.completedAt === null ? now : state.completedAt;
    const task = state.task.snapshot();
    const timing = privacyTiming(now);
    const metrics = state.controller ? state.controller.metrics : {};
    return {
      schemaVersion: 1,
      mode: state.mode,
      taskId: "cobalt-beacon-route",
      exactTaskCompletion: state.task.isExactComplete(),
      route: {
        verb: task.selections.intent,
        beaconCount: task.selections.quantity === "three" ? 3 : null,
        beaconColor: "cobalt",
        departure: task.selections.schedule === "1430" ? "14:30" : task.selections.schedule,
        handling: task.selections.handling,
        destination: task.selections.destination === "orion-7" ? "ORION-7" : task.selections.destination,
        gate: task.selections.gate === "north-gate" ? "North Gate" : task.selections.gate,
        confirmed: task.routeCommitted,
        returnedHome: task.home,
      },
      calibration: {
        method: "center-plus-four-radial-timed",
        status: state.calibrationStatus,
        durationMs: Math.round(
          Core.closedIntervalDuration(
            state.calibrationStartedAt,
            state.calibrationEndedAt,
          ),
        ),
        quality: state.calibrationQuality !== null
          ? Math.round(state.calibrationQuality * 10000) / 10000
          : null,
        estimator: state.sensorModeName,
      },
      timing: {
        dwellMs: state.controller ? state.controller.config.dwellMs : Number(elements.dwellRange.value),
        candidateSpeechMs: 400,
        completionMs: Math.round(
          Core.completionDuration(state.sessionStartedAt, completionAt, now),
        ),
      },
      safety: {
        falseCommits: metrics.falseCommits || 0,
        gazeOnlyExecutions: 0,
        blockedConfirmations: metrics.blockedConfirmations || 0,
        dwellCancellations: metrics.dwellCancellations || 0,
        confidencePauses: metrics.confidencePauses || 0,
        confidenceRevocations: metrics.confidenceRevocations || 0,
        staleSensorConfirmations: metrics.staleSensorConfirmations || 0,
        sensorLosses: metrics.sensorLosses || 0,
        sensorRecoveries: metrics.sensorRecoveries || 0,
      },
      interaction: {
        focusEvents: metrics.focusEvents || 0,
        candidateAnnouncements: metrics.candidateAnnouncements || 0,
        arms: metrics.arms || 0,
        explicitConfirmations: metrics.explicitConfirmations || 0,
        confirmationSources: { ...(metrics.confirmationSources || {}) },
      },
      privacy: {
        ...timing,
        rawFramesStored: 0,
        rawAudioStored: 0,
        networkRequests: 0,
      },
    };
  }

  function completeSession(simulationMetrics) {
    if (state.completed) return;
    state.completedAt = performance.now();
    state.completed = true;
    state.lastMetrics = simulationMetrics || buildLiveMetrics(state.completedAt);
    elements.completionBanner.classList.remove("is-hidden");
    elements.exportMetrics.disabled = false;
    elements.completionCopy.textContent =
      "Three cobalt beacons route at 14:30, marked fragile, to ORION-7 through North Gate. No gaze-only commit occurred.";
    setStatus("Exact cobalt-beacon task complete. Metrics are ready to export.", true);
    earcon("confirm");
    speak("Route complete. Home safe. Metrics ready.", true);
  }

  function metricsForExport() {
    if (state.mode === "live" && state.completed) {
      refreshMetricSensorCounters();
    }
    return state.lastMetrics;
  }

  function refreshMetricSensorCounters() {
    if (!state.lastMetrics) return null;
    const counters = privacyTiming(performance.now());
    state.lastMetrics = {
      ...state.lastMetrics,
      privacy: {
        ...state.lastMetrics.privacy,
        ...counters,
      },
    };
    return state.lastMetrics;
  }

  function downloadMetrics() {
    const metrics = metricsForExport();
    if (!metrics) return;
    const payload = JSON.stringify(metrics, null, 2);
    const blob = new Blob([payload], { type: "application/json" });
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = `gaze-compass-${metrics.mode}-metrics.json`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  }

  function stopSensors() {
    stopSensorLifecycle();
    releaseMediaResources({ markSensorLoss: true });
    if (state.completed) {
      if (state.mode === "live") refreshMetricSensorCounters();
      setStatus("Sensors ended. Frames and derived frame buffers cleared.");
      return;
    }
    enterParityOnlyMode(
      "Sensors ended. Camera calibration was interrupted safely.",
    );
  }

  function wait(milliseconds) {
    return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
  }

  async function replaySimulation(result) {
    state.calibrationStatus = "running";
    elements.calibrationLayer.classList.remove("is-hidden");
    const targets = Core.CALIBRATION_TARGETS;
    for (let index = 0; index < targets.length; index += 1) {
      const target = targets[index];
      const position = calibrationPosition(target);
      elements.calibrationTarget.style.left = `${position.left}%`;
      elements.calibrationTarget.style.top = `${position.top}%`;
      elements.calibrationTarget.style.transform = "translate(-50%, -50%)";
      elements.calibrationTitle.textContent = `Simulated ${target}`;
      elements.calibrationDetail.textContent = "Fixed seed · synthetic coordinates · no sensor";
      elements.calibrationFill.style.width = `${Math.round(((index + 1) / targets.length) * 100)}%`;
      await wait(150);
    }
    state.calibrationStatus = "complete";
    elements.calibrationLayer.classList.add("is-hidden");
    buildController();
    state.controller.setDwell(900);
    elements.dwellRange.value = "900";
    updateDwell();
    state.task.reset();
    renderTask();

    let previousTime = result.calibration.durationMs;
    for (const event of result.trace) {
      const gap = Math.max(24, Math.min(150, (event.atMs - previousTime) * 0.08));
      previousTime = event.atMs;
      await wait(gap);
      if (event.direction && Core.DIRECTION_POINTS[event.direction]) {
        updateCursor({ ...Core.DIRECTION_POINTS[event.direction], confidence: 0.96 });
      }
      if (event.type === "focus") {
        renderController({
          sector: event.direction,
          armed: false,
          progress: 0.1,
          state: "focusing",
          centerRequired: false,
        });
        setStatus(`Simulation focus: ${directionTitle(event.direction)}.`);
      } else if (event.type === "candidate") {
        renderController({
          sector: event.direction,
          armed: false,
          progress: 0.45,
          state: "focusing",
          centerRequired: false,
        });
        setStatus(`${event.label} spoken after 400 ms.`);
      } else if (event.type === "armed") {
        renderController({
          sector: event.direction,
          armed: true,
          progress: 1,
          state: "armed",
          centerRequired: false,
        });
        setStatus(`${directionTitle(event.direction)} armed; waiting for explicit confirmation.`);
      } else if (event.type === "execute") {
        state.task.choose(event.direction, event.source, event.atMs);
        renderTask();
        setStatus(`Explicit ${event.source} confirmation: ${event.option}.`);
      } else if (event.type === "cancel") {
        renderController({
          sector: null,
          armed: false,
          progress: 0,
          state: "rest",
          centerRequired: false,
        });
        setStatus(
          event.reason === "confidence-pause"
            ? "Low confidence revoked the armed candidate; confirmation is blocked."
            : event.reason === "sensor-loss"
              ? "Raw-frame freshness expired; the sensor-derived arm was revoked."
            : "Center canceled the candidate; zero execution.",
        );
      } else if (event.type === "confidence-revoked") {
        setStatus("Simulation rejected confirmation after confidence loss.");
      } else if (event.type === "stale-sensor-confirm") {
        setStatus("Simulation atomically rejected a stale sensor-derived arm.");
      } else if (event.type === "center") {
        updateCursor({ x: 0, y: 0, confidence: 0.96 });
        renderController({
          sector: null,
          armed: false,
          progress: 0,
          state: "rest",
          centerRequired: false,
        });
        if (state.task.routeCommitted) state.task.returnHome();
      } else if (event.type === "sensor-lost") {
        elements.sensorOverlay.classList.remove("is-hidden");
        elements.sensorOverlayCopy.textContent =
          "Deterministic sensor-loss challenge: arm cleared; center reacquisition required.";
        setStatus("Simulation sensor loss: fail-safe active.");
      } else if (event.type === "sensor-recovered") {
        elements.sensorOverlay.classList.add("is-hidden");
        setStatus("Simulation recovered through center.");
      }
    }
    state.task.returnHome();
    renderTask();
    completeSession(result);
  }

  async function startSimulation() {
    if (state.mode !== "idle") return;
    elements.startSimulation.disabled = true;
    initializeAudio();
    activateApplication("simulation");
    state.sensorModeName = "deterministic synthetic gaze";
    elements.sensorMode.textContent = "Sensor: deterministic synthetic gaze · fixed seed";
    setIndicator(elements.cameraIndicator, "off", "Camera off · simulation");
    setIndicator(elements.micIndicator, "off", "Mic off · simulation");
    const result = Core.runDeterministicSimulation();
    await replaySimulation(result);
  }

  function isNativeInteractiveTarget(target) {
    if (!(target instanceof Element)) return false;
    return Boolean(
      target.closest(
        "button, a[href], input, select, textarea, summary, [contenteditable]:not([contenteditable='false']), [role='button'], [role='link'], [role='slider'], [role='switch'], [role='checkbox'], [role='radio'], [tabindex]:not([tabindex='-1'])",
      ),
    );
  }

  function bindEvents() {
    elements.startLive.addEventListener("click", startLive, { once: true });
    elements.startSimulation.addEventListener("click", startSimulation, { once: true });
    elements.safeCenter.addEventListener("click", () => centerAction("touch"));
    elements.dwellRange.addEventListener("input", updateDwell);
    elements.exportMetrics.addEventListener("click", downloadMetrics);
    elements.completionExport.addEventListener("click", downloadMetrics);
    elements.endSession.addEventListener("click", stopSensors);

    for (const target of elements.sectorTargets) {
      target.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        target.setPointerCapture(event.pointerId);
        startManualHold(target.dataset.direction, false);
      });
      target.addEventListener("pointerup", (event) => {
        event.preventDefault();
        if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
        stopManualHold(true);
      });
      target.addEventListener("pointercancel", () => stopManualHold(true));
      target.addEventListener("click", (event) => {
        event.preventDefault();
        if (event.detail === 0) startManualHold(target.dataset.direction, true);
      });
    }

    for (const control of elements.switchControls) {
      control.addEventListener("click", () => {
        if (control.dataset.action === "cycle") cycleDirection();
        if (control.dataset.action === "center") centerAction("switch");
        if (control.dataset.action === "confirm") confirmAction("switch");
      });
    }

    const keyDirections = {
      ArrowUp: "north",
      ArrowRight: "east",
      ArrowDown: "south",
      ArrowLeft: "west",
    };
    document.addEventListener("keydown", (event) => {
      const interactiveTarget = isNativeInteractiveTarget(event.target);
      if (keyDirections[event.key]) {
        if (interactiveTarget) return;
        event.preventDefault();
        if (!event.repeat) startManualHold(keyDirections[event.key], false);
      } else if (event.key === "Enter" || event.key === " ") {
        if (!Core.shouldHandleGlobalConfirmKey(event.key, interactiveTarget)) return;
        event.preventDefault();
        confirmAction("keyboard");
      } else if (event.key === "Escape" || event.key === "Backspace") {
        if (interactiveTarget) return;
        event.preventDefault();
        centerAction("keyboard");
      } else if (interactiveTarget) {
        return;
      } else if (event.key.toLowerCase() === "r") {
        repeatCurrentGuide();
      } else if (event.key.toLowerCase() === "u") {
        undoLastChoice("keyboard");
      }
    });
    document.addEventListener("keyup", (event) => {
      if (keyDirections[event.key] && state.manualDirection === keyDirections[event.key]) {
        event.preventDefault();
        stopManualHold(true);
      }
    });

    document.addEventListener("visibilitychange", () => {
      if (document.hidden && state.controller && !state.completed) {
        stopManualHold();
        state.controller.markSensorLost(performance.now(), "page hidden");
        renderController(state.controller.snapshot());
      }
    });
    window.addEventListener("beforeunload", stopSensors);
  }

  updateDwell();
  bindEvents();

  window.__GAZE_COMPASS__ = Object.freeze({
    runDeterministicSimulation: Core.runDeterministicSimulation,
    snapshot() {
      return {
        mode: state.mode,
        task: state.task.snapshot(),
        controller: state.controller ? state.controller.snapshot() : null,
        sensorLifecycle: {
          generation: state.sensorGeneration,
          stopped: state.sensorsStopped,
          lastRawFrameAt: state.lastRawFrameAt,
        },
        calibration: {
          status: state.calibrationStatus,
          startedAt: state.calibrationStartedAt,
          endedAt: state.calibrationEndedAt,
          quality: state.calibrationQuality,
          durationMs: Core.closedIntervalDuration(
            state.calibrationStartedAt,
            state.calibrationEndedAt,
          ),
        },
        paused: state.paused,
        completedAt: state.completedAt,
        metrics: state.lastMetrics,
      };
    },
  });

  if (new URLSearchParams(window.location.search).get("simulate") === "1") {
    startSimulation();
  }
})();
