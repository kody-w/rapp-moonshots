import { cancelGlobalSpeech } from "./session.mjs";

class EpochGuard {
  constructor(initialGeneration = 0) {
    this.generation = Math.max(0, Number(initialGeneration) || 0);
  }

  begin() {
    this.generation += 1;
    return this.generation;
  }

  invalidate() {
    this.generation += 1;
    return this.generation;
  }

  isCurrent(generation) {
    return generation === this.generation;
  }
}

class DetectorEpochGuard {
  constructor() {
    this.epoch = 0;
    this.rejections = 0;
  }

  capture(generation, contentEpoch, detectorIdentity) {
    return {
      epoch: this.epoch,
      generation,
      contentEpoch,
      detectorIdentity,
    };
  }

  invalidate() {
    this.epoch += 1;
  }

  accept(token, generation, contentEpoch, detectorIdentity) {
    const accepted = this.matches(
      token,
      generation,
      contentEpoch,
      detectorIdentity,
    );
    if (!accepted) {
      this.rejections += 1;
    }
    return accepted;
  }

  matches(token, generation, contentEpoch, detectorIdentity) {
    return (
      token.epoch === this.epoch &&
      token.generation === generation &&
      token.contentEpoch === contentEpoch &&
      token.detectorIdentity === detectorIdentity
    );
  }
}

class FreshnessGate {
  constructor({ maxAgeMs = 1800 } = {}) {
    this.maxAgeMs = maxAgeMs;
    this.generation = 0;
    this.frameAt = null;
    this.contentAt = null;
    this.processedAt = null;
  }

  reset(generation) {
    this.generation = generation;
    this.frameAt = null;
    this.contentAt = null;
    this.processedAt = null;
  }

  invalidate(signals) {
    for (const signal of signals) {
      if (["frameAt", "contentAt", "processedAt"].includes(signal)) {
        this[signal] = null;
      }
    }
  }

  update(sample) {
    if (sample.generation !== this.generation) {
      return false;
    }
    for (const signal of ["frameAt", "contentAt", "processedAt"]) {
      if (!Number.isFinite(sample[signal])) {
        continue;
      }
      if (this[signal] !== null && sample[signal] < this[signal]) {
        return false;
      }
    }
    for (const signal of ["frameAt", "contentAt", "processedAt"]) {
      if (Number.isFinite(sample[signal])) {
        this[signal] = sample[signal];
      }
    }
    return true;
  }

  staleCauses(now) {
    return ["frameAt", "contentAt", "processedAt"]
      .filter((signal) => this[signal] === null || now - this[signal] > this.maxAgeMs)
      .map((signal) => signal.replace("At", "-stale"));
  }

  isFresh(now) {
    return this.staleCauses(now).length === 0;
  }
}

class CoarseGestureGate {
  constructor({
    downDelta = 0.075,
    returnDelta = 0.035,
    timeoutMs = 850,
    cooldownMs = 700,
  } = {}) {
    this.downDelta = downDelta;
    this.returnDelta = returnDelta;
    this.timeoutMs = timeoutMs;
    this.cooldownMs = cooldownMs;
    this.reset();
  }

  reset() {
    this.phase = "idle";
    this.baseline = null;
    this.startedAt = null;
    this.armedEpoch = null;
    this.armedChoiceId = null;
    this.lastConfirmAt = -Infinity;
  }

  sample({ zone, y, at, armed, epoch, choiceId }) {
    if (!armed || zone === "center" || !Number.isFinite(y)) {
      this.phase = zone === "center" ? "center" : "idle";
      this.baseline = null;
      this.startedAt = null;
      this.armedEpoch = null;
      this.armedChoiceId = null;
      return { confirmed: false, phase: this.phase };
    }
    if (at - this.lastConfirmAt < this.cooldownMs) {
      return { confirmed: false, phase: "cooldown" };
    }
    if (this.armedEpoch !== epoch || this.armedChoiceId !== choiceId) {
      this.phase = "settled";
      this.baseline = y;
      this.startedAt = at;
      this.armedEpoch = epoch;
      this.armedChoiceId = choiceId;
      return { confirmed: false, phase: this.phase };
    }
    if (at - this.startedAt > this.timeoutMs) {
      this.phase = "settled";
      this.baseline = y;
      this.startedAt = at;
      return { confirmed: false, phase: "reset" };
    }
    if (this.phase === "settled" && y - this.baseline >= this.downDelta) {
      this.phase = "down";
      return { confirmed: false, phase: this.phase };
    }
    if (this.phase === "down" && Math.abs(y - this.baseline) <= this.returnDelta) {
      this.lastConfirmAt = at;
      this.phase = "confirmed";
      return { confirmed: true, phase: this.phase };
    }
    return { confirmed: false, phase: this.phase };
  }
}

function stopStream(stream) {
  if (!stream || typeof stream.getTracks !== "function") {
    return;
  }
  for (const track of stream.getTracks()) {
    try {
      track.stop();
    } catch {
      // A browser may already have ended the track.
    }
  }
}

function streamHasLiveTrack(stream, kind) {
  if (
    !stream ||
    stream.active === false ||
    typeof stream.getTracks !== "function"
  ) {
    return false;
  }
  return stream
    .getTracks()
    .some(
      (track) =>
        (!kind || track.kind === kind) &&
        track.readyState !== "ended",
    );
}

function documentIsForeground() {
  return (
    typeof document === "undefined" ||
    (!document.hidden && document.visibilityState === "visible")
  );
}

function clamp(value, minimum = 0, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, value));
}

class AdaptiveSensorController {
  constructor({
    video,
    onAction = () => {},
    onAim = () => {},
    onGesture = () => {},
    onSpeech = () => {},
    onCaption = () => {},
    clock = () => performance.now(),
    generationSeed = 0,
    recognitionRetryBaseMs = 250,
  } = {}) {
    this.video = video;
    this.onAction = onAction;
    this.onAim = onAim;
    this.onGesture = onGesture;
    this.onSpeech = onSpeech;
    this.onCaption = onCaption;
    this.clock = clock;
    this.lifecycle = new EpochGuard(generationSeed);
    this.detectorGuard = new DetectorEpochGuard();
    this.freshness = new FreshnessGate();
    this.gestureGate = new CoarseGestureGate();
    this.stream = null;
    this.streams = new Set();
    this.microphoneStream = null;
    this.cameraStream = null;
    this.lifecycleGeneration = 0;
    this.frontCameraMirrored = true;
    this.active = false;
    this.frameHandle = null;
    this.frameHandleKind = null;
    this.watchdog = null;
    this.recognition = null;
    this.recognitionRetry = null;
    this.recognitionRetries = 0;
    this.recognitionTransientFailures = 0;
    this.recognitionTerminal = false;
    this.recognitionSessionStarted = false;
    this.recognitionSessionFailed = false;
    this.recognitionExpectedEnd = false;
    this.recognitionRetryBaseMs = Math.max(
      0,
      Number(recognitionRetryBaseMs) || 0,
    );
    this.announcementEpoch = 0;
    this.speaking = false;
    this.detector = null;
    this.detectorPending = false;
    this.detectorRequestId = 0;
    this.detectorTimeout = null;
    this.pendingDetectorBuffers = new Set();
    this.pendingRecoveryCauses = new Set();
    this.contentBlocked = false;
    this.contentEpoch = 0;
    this.lastFrameToken = null;
    this.previousGray = null;
    this.faceBaseline = null;
    this.motionPoint = { x: 0.5, y: 0.5 };
    this.smoothedAim = null;
    this.neutralSince = null;
    this.lastMotionGestureAt = -Infinity;
    this.armed = false;
    this.armedEpoch = 0;
    this.armedChoiceId = null;
    this.analysisCanvas =
      typeof document === "undefined" ? null : document.createElement("canvas");
    if (this.analysisCanvas) {
      this.analysisCanvas.width = 48;
      this.analysisCanvas.height = 36;
    }
    this.analysisContext = this.analysisCanvas?.getContext("2d", {
      willReadFrequently: true,
      alpha: false,
    });
  }

  ensureProgressiveLifecycle() {
    if (
      this.active &&
      this.lifecycle.isCurrent(this.lifecycleGeneration)
    ) {
      return this.lifecycleGeneration;
    }
    const generation = this.lifecycle.begin();
    this.lifecycleGeneration = generation;
    this.active = true;
    this.freshness.reset(generation);
    this.recognitionTerminal = false;
    this.recognitionRetries = 0;
    this.recognitionTransientFailures = 0;
    this.recognitionSessionStarted = false;
    this.recognitionSessionFailed = false;
    this.recognitionExpectedEnd = false;
    return generation;
  }

  recalibrateOrientation() {
    this.smoothedAim = null;
    this.faceBaseline = null;
    this.motionPoint = { x: 0.5, y: 0.5 };
    if (this.previousGray) {
      this.previousGray.fill(0);
      this.previousGray = null;
    }
    this.gestureGate.reset();
    if (
      this.cameraStream &&
      this.active &&
      this.lifecycle.isCurrent(this.lifecycleGeneration)
    ) {
      this.invalidateContent(this.lifecycleGeneration, this.clock());
    }
  }

  registerStream(stream) {
    this.streams.add(stream);
    if (!this.stream) {
      this.stream = stream;
    }
  }

  releaseStream(stream) {
    if (!stream) {
      return;
    }
    stopStream(stream);
    this.streams.delete(stream);
    if (this.microphoneStream === stream) {
      this.microphoneStream = null;
    }
    if (this.cameraStream === stream) {
      this.cameraStream = null;
    }
    if (this.stream === stream) {
      this.stream = this.streams.values().next().value || null;
    }
  }

  releaseMicrophoneCapture(status = "denied") {
    const stream = this.microphoneStream;
    if (!stream) {
      return;
    }
    if (stream === this.cameraStream) {
      for (const track of stream.getTracks?.() || []) {
        if (track.kind === "audio") {
          try {
            track.stop();
          } catch {
            // Track may already be stopped.
          }
        }
      }
      this.microphoneStream = null;
    } else {
      this.releaseStream(stream);
    }
    this.onAction({
      type: "SENSOR_STATUS",
      sensor: "microphone",
      status,
      at: this.clock(),
    });
  }

  async enableMicrophone() {
    const microphoneLive = streamHasLiveTrack(
      this.microphoneStream,
      "audio",
    );
    if (
      microphoneLive &&
      !this.recognitionTerminal &&
      (this.recognition || this.recognitionRetry || this.speaking)
    ) {
      return true;
    }
    this.resetRecognitionForExplicitRecovery();
    if (this.microphoneStream) {
      if (
        this.active &&
        this.lifecycle.isCurrent(this.lifecycleGeneration)
      ) {
        this.handleTrackEnded(
          this.microphoneStream,
          this.lifecycleGeneration,
        );
      } else {
        this.releaseStream(this.microphoneStream);
      }
    }
    const generation = this.ensureProgressiveLifecycle();
    this.onAction({
      type: "SENSOR_STATUS",
      sensor: "microphone",
      status: "starting",
      at: this.clock(),
    });
    let acquired = null;
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("media-unsupported");
      }
      acquired = await navigator.mediaDevices.getUserMedia({
        video: false,
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      if (!this.active || !this.lifecycle.isCurrent(generation)) {
        stopStream(acquired);
        return false;
      }
      if (!streamHasLiveTrack(acquired, "audio")) {
        throw new Error("microphone-track-not-live");
      }
      this.microphoneStream = acquired;
      this.registerStream(acquired);
      this.attachTrackSafety(acquired, generation);
      this.onAction({
        type: "SENSOR_STATUS",
        sensor: "microphone",
        status: "active",
        at: this.clock(),
      });
      this.startWatchdog(generation);
      this.cancelNarrationForRecognitionRecovery();
      this.startRecognition(generation);
      if (this.recognitionTerminal || !this.recognition) {
        this.releaseMicrophoneCapture(
          this.recognitionTerminal ? "denied" : "not-requested",
        );
        return false;
      }
      return true;
    } catch (error) {
      this.releaseStream(acquired);
      if (this.active && this.lifecycle.isCurrent(generation)) {
        const reason = error?.name || error?.message || "microphone-failed";
        this.onAction({
          type: "SENSOR_STATUS",
          sensor: "microphone",
          status: "denied",
          reason,
          at: this.clock(),
        });
        this.onCaption(
          "Microphone unavailable. Sensor-free AI and camera permission remain separate.",
        );
      }
      return false;
    }
  }

  async enableCamera() {
    if (streamHasLiveTrack(this.cameraStream, "video")) {
      return true;
    }
    if (this.cameraStream) {
      if (
        this.active &&
        this.lifecycle.isCurrent(this.lifecycleGeneration)
      ) {
        this.handleTrackEnded(this.cameraStream, this.lifecycleGeneration);
      } else {
        this.releaseStream(this.cameraStream);
      }
    }
    const generation = this.ensureProgressiveLifecycle();
    this.onAction({
      type: "SENSOR_STATUS",
      sensor: "camera",
      status: "starting",
      at: this.clock(),
    });
    let acquired = null;
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("media-unsupported");
      }
      acquired = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "user" },
          width: { ideal: 640 },
          height: { ideal: 480 },
          frameRate: { ideal: 24, max: 30 },
        },
        audio: false,
      });
      if (!this.active || !this.lifecycle.isCurrent(generation)) {
        stopStream(acquired);
        return false;
      }
      if (!streamHasLiveTrack(acquired, "video")) {
        throw new Error("camera-track-not-live");
      }
      const videoTrack = acquired.getVideoTracks?.()[0];
      const facingMode = videoTrack?.getSettings?.().facingMode;
      this.frontCameraMirrored = facingMode !== "environment";
      this.cameraStream = acquired;
      this.registerStream(acquired);
      this.attachTrackSafety(acquired, generation);
      if (this.video) {
        this.video.srcObject = acquired;
        this.video.muted = true;
        this.video.playsInline = true;
        if (this.video.dataset) {
          this.video.dataset.mirrored = String(this.frontCameraMirrored);
          this.video.dataset.facingMode =
            this.frontCameraMirrored ? "user" : "environment";
        }
        await this.video.play();
      }
      if (
        !this.active ||
        !this.lifecycle.isCurrent(generation) ||
        this.cameraStream !== acquired ||
        !streamHasLiveTrack(acquired, "video")
      ) {
        this.releaseStream(acquired);
        if (this.video) {
          this.video.srcObject = null;
        }
        return false;
      }
      this.onAction({
        type: "SENSOR_STATUS",
        sensor: "camera",
        status: "active",
        at: this.clock(),
      });
      this.configureEstimator();
      this.startFrameLoop(generation);
      this.startWatchdog(generation);
      return true;
    } catch (error) {
      this.releaseStream(acquired);
      if (this.video) {
        this.video.srcObject = null;
      }
      if (this.active && this.lifecycle.isCurrent(generation)) {
        const reason = error?.name || error?.message || "camera-failed";
        this.onAction({
          type: "SENSOR_STATUS",
          sensor: "camera",
          status: "denied",
          reason,
          at: this.clock(),
        });
        this.onAction({
          type: "SENSOR_STATUS",
          sensor: "estimator",
          status: "not-requested",
          label: "camera unavailable · sensor-free parity active",
          at: this.clock(),
        });
        this.onCaption(
          "Camera unavailable. Microphone and sensor-free AI remain usable.",
        );
      }
      return false;
    }
  }

  async start() {
    const generation = this.lifecycle.begin();
    this.lifecycleGeneration = generation;
    this.active = true;
    this.freshness.reset(generation);
    this.onAction({
      type: "SENSOR_STATUS",
      sensor: "camera",
      status: "starting",
      at: this.clock(),
    });
    this.onAction({
      type: "SENSOR_STATUS",
      sensor: "microphone",
      status: "starting",
      at: this.clock(),
    });

    let acquired = null;
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("media-unsupported");
      }
      acquired = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "user" },
          width: { ideal: 640 },
          height: { ideal: 480 },
          frameRate: { ideal: 30, max: 30 },
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      if (!this.active || !this.lifecycle.isCurrent(generation)) {
        stopStream(acquired);
        return false;
      }
      if (
        !streamHasLiveTrack(acquired, "audio") ||
        !streamHasLiveTrack(acquired, "video")
      ) {
        throw new Error("media-tracks-not-live");
      }

      this.stream = acquired;
      this.streams.add(acquired);
      this.microphoneStream = acquired;
      this.cameraStream = acquired;
      const videoTrack = acquired.getVideoTracks?.()[0];
      const facingMode = videoTrack?.getSettings?.().facingMode;
      this.frontCameraMirrored = facingMode !== "environment";
      this.attachTrackSafety(acquired, generation);
      if (this.video) {
        this.video.srcObject = acquired;
        this.video.muted = true;
        this.video.playsInline = true;
        if (this.video.dataset) {
          this.video.dataset.mirrored = String(this.frontCameraMirrored);
          this.video.dataset.facingMode =
            this.frontCameraMirrored ? "user" : "environment";
        }
        await this.video.play();
      }
      if (
        !this.active ||
        !this.lifecycle.isCurrent(generation) ||
        this.stream !== acquired ||
        !streamHasLiveTrack(acquired, "audio") ||
        !streamHasLiveTrack(acquired, "video")
      ) {
        this.releaseStream(acquired);
        if (this.video) {
          this.video.srcObject = null;
        }
        return false;
      }

      this.onAction({
        type: "SENSOR_STATUS",
        sensor: "camera",
        status: "active",
        at: this.clock(),
      });
      this.onAction({
        type: "SENSOR_STATUS",
        sensor: "microphone",
        status: "active",
        at: this.clock(),
      });
      this.configureEstimator();
      this.startFrameLoop(generation);
      this.startWatchdog(generation);
      this.startRecognition(generation);
      return true;
    } catch (error) {
      stopStream(acquired);
      if (this.lifecycle.isCurrent(generation)) {
        this.cleanupRuntime(false);
        const reason = error?.name || error?.message || "media-failed";
        this.onAction({
          type: "SENSOR_STATUS",
          sensor: "camera",
          status: "denied",
          reason,
          at: this.clock(),
        });
        this.onAction({
          type: "SENSOR_STATUS",
          sensor: "microphone",
          status: "denied",
          reason,
          at: this.clock(),
        });
        this.onCaption("Sensors unavailable. Sensor-free access remains fully usable.");
      }
      return false;
    }
  }

  handleTrackEnded(stream, generation) {
    if (
      !this.active ||
      !this.lifecycle.isCurrent(generation) ||
      (!this.streams.has(stream) &&
        this.microphoneStream !== stream &&
        this.cameraStream !== stream)
    ) {
      return;
    }
    const microphoneEnded = this.microphoneStream === stream;
    const cameraEnded = this.cameraStream === stream;
    const at = this.clock();
    if (cameraEnded) {
      this.cancelFrameLoop();
      this.invalidateContent(generation, at);
      if (this.previousGray) {
        this.previousGray.fill(0);
        this.previousGray = null;
      }
      if (this.analysisContext && this.analysisCanvas) {
        this.analysisContext.clearRect(
          0,
          0,
          this.analysisCanvas.width,
          this.analysisCanvas.height,
        );
      }
      if (this.video?.srcObject === stream) {
        try {
          this.video.pause();
        } catch {
          // A detached preview may not be pausable.
        }
        this.video.srcObject = null;
      }
    }
    if (microphoneEnded) {
      clearTimeout(this.recognitionRetry);
      this.recognitionRetry = null;
      this.detachRecognition();
    }
    this.releaseStream(stream);
    for (const sensor of [
      ...(cameraEnded ? ["camera"] : []),
      ...(microphoneEnded ? ["microphone"] : []),
    ]) {
      this.onAction({
        type: "SENSOR_LOSS",
        cause: `${sensor}-lost`,
        sensor,
        at,
      });
    }
    this.onCaption(
      "A media track ended. Capture was released; retry permission to reacquire it.",
    );
  }

  attachTrackSafety(stream, generation) {
    for (const track of stream.getTracks()) {
      const sensor = track.kind === "audio" ? "microphone" : "camera";
      track.addEventListener(
        "ended",
        () => this.handleTrackEnded(stream, generation),
        { once: true },
      );
      track.addEventListener("mute", () => {
        if (
          this.active &&
          this.lifecycle.isCurrent(generation) &&
          (this.microphoneStream === stream || this.cameraStream === stream)
        ) {
          this.onAction({
            type: "SENSOR_LOSS",
            cause: `${sensor}-lost`,
            sensor,
            at: this.clock(),
          });
        }
      });
      track.addEventListener("unmute", () => {
        if (
          this.active &&
          this.lifecycle.isCurrent(generation) &&
          (this.microphoneStream === stream || this.cameraStream === stream) &&
          streamHasLiveTrack(stream, track.kind)
        ) {
          this.onAction({
            type: "SENSOR_STATUS",
            sensor,
            status: "active",
            at: this.clock(),
          });
        }
      });
    }
  }

  configureEstimator() {
    if (typeof globalThis.FaceDetector === "function") {
      try {
        this.detector = new globalThis.FaceDetector({
          fastMode: true,
          maxDetectedFaces: 1,
        });
        this.onAction({
          type: "SENSOR_STATUS",
          sensor: "estimator",
          status: "active",
          label: "face-position proxy · coarse, not eye tracking",
          at: this.clock(),
        });
        return;
      } catch {
        this.detector = null;
      }
    }
    this.onAction({
      type: "SENSOR_STATUS",
      sensor: "estimator",
      status: "active",
      label: "frame-motion fallback · not eye tracking",
      at: this.clock(),
    });
  }

  cancelFrameLoop() {
    if (this.frameHandle === null) {
      return;
    }
    if (
      this.frameHandleKind === "video" &&
      this.video &&
      typeof this.video.cancelVideoFrameCallback === "function"
    ) {
      this.video.cancelVideoFrameCallback(this.frameHandle);
    } else if (
      this.frameHandleKind === "animation" &&
      typeof globalThis.cancelAnimationFrame === "function"
    ) {
      globalThis.cancelAnimationFrame(this.frameHandle);
    } else if (this.frameHandleKind === "timer") {
      clearTimeout(this.frameHandle);
    }
    this.frameHandle = null;
    this.frameHandleKind = null;
  }

  startFrameLoop(generation) {
    this.cancelFrameLoop();
    const schedule = () => {
      if (
        !this.active ||
        !this.lifecycle.isCurrent(generation) ||
        !streamHasLiveTrack(this.cameraStream, "video")
      ) {
        this.frameHandle = null;
        this.frameHandleKind = null;
        return;
      }
      if (this.video && typeof this.video.requestVideoFrameCallback === "function") {
        this.frameHandleKind = "video";
        this.frameHandle = this.video.requestVideoFrameCallback((at, metadata) => {
          this.processFrame(at, metadata, generation);
          schedule();
        });
      } else if (typeof globalThis.requestAnimationFrame === "function") {
        this.frameHandleKind = "animation";
        this.frameHandle = globalThis.requestAnimationFrame((at) => {
          this.processFrame(
            at,
            {
              mediaTime: this.video?.currentTime,
              presentedFrames: this.video?.webkitDecodedFrameCount,
            },
            generation,
          );
          schedule();
        });
      } else {
        this.frameHandleKind = "timer";
        this.frameHandle = setTimeout(() => {
          const at = this.clock();
          this.processFrame(
            at,
            {
              mediaTime: this.video?.currentTime,
              presentedFrames: this.video?.webkitDecodedFrameCount,
            },
            generation,
          );
          schedule();
        }, 34);
      }
    };
    schedule();
  }

  trackDetectorBuffer(gray) {
    const buffer = gray.slice();
    this.pendingDetectorBuffers.add(buffer);
    return buffer;
  }

  releaseDetectorBuffer(buffer) {
    if (!buffer) {
      return;
    }
    buffer.fill(0);
    this.pendingDetectorBuffers.delete(buffer);
  }

  releasePendingDetectorBuffers() {
    for (const buffer of this.pendingDetectorBuffers) {
      buffer.fill(0);
    }
    this.pendingDetectorBuffers.clear();
  }

  markRecoveryRequired(cause, at) {
    if (this.pendingRecoveryCauses.has(cause)) {
      return;
    }
    this.pendingRecoveryCauses.add(cause);
    this.onAction({
      type: "SENSOR_LOSS",
      cause,
      sensor: null,
      at,
    });
  }

  revokeSensorArm() {
    this.armed = false;
    this.armedChoiceId = null;
    this.armedEpoch += 1;
    this.gestureGate.reset();
  }

  invalidateContent(generation, at) {
    this.contentEpoch += 1;
    this.detectorGuard.invalidate();
    this.detectorRequestId += 1;
    this.detectorPending = false;
    clearTimeout(this.detectorTimeout);
    this.detectorTimeout = null;
    this.freshness.invalidate(["contentAt", "processedAt"]);
    this.releasePendingDetectorBuffers();
    this.faceBaseline = null;
    this.motionPoint = { x: 0.5, y: 0.5 };
    this.smoothedAim = null;
    this.revokeSensorArm();
    this.contentBlocked = true;
    if (this.active && this.lifecycle.isCurrent(generation)) {
      this.markRecoveryRequired("content-invalid", at);
    }
  }

  detectorTokenMatches(token, generation, detectorIdentity) {
    return (
      this.active &&
      this.lifecycle.isCurrent(generation) &&
      this.detectorGuard.matches(
        token,
        generation,
        this.contentEpoch,
        detectorIdentity,
      )
    );
  }

  transitionDetectorToFallback(token, generation, detectorIdentity, label, at) {
    if (!this.detectorTokenMatches(token, generation, detectorIdentity)) {
      return false;
    }
    this.detectorGuard.invalidate();
    this.detectorRequestId += 1;
    this.detectorPending = false;
    this.detector = null;
    this.freshness.invalidate(["processedAt"]);
    this.releasePendingDetectorBuffers();
    this.revokeSensorArm();
    this.markRecoveryRequired("detector-transition", at);
    this.onAction({
      type: "SENSOR_STATUS",
      sensor: "estimator",
      status: "active",
      label,
      at,
    });
    return true;
  }

  processFrame(at, metadata, generation) {
    if (
      !this.active ||
      !this.lifecycle.isCurrent(generation) ||
      !this.analysisContext ||
      !this.video ||
      this.video.readyState < 2
    ) {
      return;
    }

    const frameToken = Number.isFinite(metadata?.presentedFrames)
      ? `f:${metadata.presentedFrames}`
      : Number.isFinite(metadata?.mediaTime)
        ? `t:${metadata.mediaTime}`
        : `t:${this.video.currentTime}`;
    if (frameToken === this.lastFrameToken) {
      return;
    }
    this.lastFrameToken = frameToken;
    const sample = { generation, frameAt: at };
    let pixels = null;
    let gray = null;

    try {
      this.analysisContext.drawImage(
        this.video,
        0,
        0,
        this.analysisCanvas.width,
        this.analysisCanvas.height,
      );
      pixels = this.analysisContext.getImageData(
        0,
        0,
        this.analysisCanvas.width,
        this.analysisCanvas.height,
      );
      const count = this.analysisCanvas.width * this.analysisCanvas.height;
      gray = new Uint8Array(count);
      let total = 0;
      for (let index = 0; index < count; index += 1) {
        const offset = index * 4;
        const luminance = Math.round(
          pixels.data[offset] * 0.299 +
            pixels.data[offset + 1] * 0.587 +
            pixels.data[offset + 2] * 0.114,
        );
        gray[index] = luminance;
        total += luminance;
      }
      const mean = total / count;
      let varianceTotal = 0;
      let differenceTotal = 0;
      let activeTotal = 0;
      let centroidX = 0;
      let centroidY = 0;
      for (let index = 0; index < count; index += 1) {
        const deviation = gray[index] - mean;
        varianceTotal += deviation * deviation;
        if (this.previousGray) {
          const difference = Math.abs(gray[index] - this.previousGray[index]);
          differenceTotal += difference;
          if (difference > 14) {
            const x = index % this.analysisCanvas.width;
            const y = Math.floor(index / this.analysisCanvas.width);
            activeTotal += difference;
            centroidX += x * difference;
            centroidY += y * difference;
          }
        }
      }
      const variance = varianceTotal / count;
      const difference = this.previousGray ? differenceTotal / count : 255;
      const contentValid =
        mean > 12 && mean < 243 && variance > 22 && difference > 0.18;

      if (contentValid) {
        sample.contentAt = at;
      } else {
        this.invalidateContent(generation, at);
      }

      if (contentValid) {
        if (this.detector) {
          this.processDetector(generation, at, sample, gray, {
            activeTotal,
            centroidX,
            centroidY,
            difference,
          });
        } else {
          this.processFallback(at, sample, gray, {
            activeTotal,
            centroidX,
            centroidY,
            difference,
          });
        }
      } else {
        this.emitFreshness(sample);
      }

      if (this.previousGray) {
        this.previousGray.fill(0);
      }
      this.previousGray = gray;
      gray = null;
    } catch {
      this.invalidateContent(generation, at);
      this.emitFreshness(sample);
    } finally {
      if (pixels?.data?.fill) {
        pixels.data.fill(0);
      }
      if (gray) {
        gray.fill(0);
      }
      this.analysisContext.clearRect(
        0,
        0,
        this.analysisCanvas.width,
        this.analysisCanvas.height,
      );
    }
  }

  processDetector(generation, at, sample, gray, motion) {
    const frameAccepted = this.emitFreshness(sample);
    if (!frameAccepted) {
      return false;
    }
    if (this.detectorPending) {
      return true;
    }
    this.detectorPending = true;
    const requestId = ++this.detectorRequestId;
    const detectorIdentity = this.detector;
    const token = this.detectorGuard.capture(
      generation,
      this.contentEpoch,
      detectorIdentity,
    );
    const grayCopy = this.trackDetectorBuffer(gray);
    const timeoutHandle = setTimeout(() => {
      if (this.detectorTimeout === timeoutHandle) {
        this.detectorTimeout = null;
      }
      if (
        requestId !== this.detectorRequestId ||
        !this.detectorPending
      ) {
        this.releaseDetectorBuffer(grayCopy);
        return;
      }
      if (!this.detectorTokenMatches(token, generation, detectorIdentity)) {
        this.detectorPending = false;
        this.releaseDetectorBuffer(grayCopy);
        return;
      }
      this.transitionDetectorToFallback(
        token,
        generation,
        detectorIdentity,
        "frame-motion fallback after detector stall · not eye tracking",
        this.clock(),
      );
      this.releaseDetectorBuffer(grayCopy);
    }, 900);
    this.detectorTimeout = timeoutHandle;

    Promise.resolve(detectorIdentity.detect(this.video))
      .then((faces) => {
        clearTimeout(timeoutHandle);
        if (this.detectorTimeout === timeoutHandle) {
          this.detectorTimeout = null;
        }
        if (requestId !== this.detectorRequestId) {
          return;
        }
        const accepted =
          this.detectorGuard.accept(
            token,
            generation,
            this.contentEpoch,
            this.detector,
          ) && this.detectorTokenMatches(token, generation, detectorIdentity);
        if (!accepted) {
          this.detectorPending = false;
          this.onAction({
            type: "SENSOR_SAMPLE",
            generation: -1,
            frameAt: at,
            at: this.clock(),
          });
          return;
        }
        this.detectorPending = false;
        const face = Array.isArray(faces) ? faces[0] : null;
        const box = face?.boundingBox;
        if (!box || !this.video.videoWidth || !this.video.videoHeight) {
          this.processFallback(at, sample, grayCopy, motion, {
            token,
            generation,
            detectorIdentity,
          });
          return;
        }
        const rawX = (box.x + box.width / 2) / this.video.videoWidth;
        const x = this.frontCameraMirrored ? 1 - rawX : rawX;
        const y = (box.y + box.height / 2) / this.video.videoHeight;
        if (!this.faceBaseline) {
          this.faceBaseline = { x, y };
        }
        const target = {
          x: clamp(0.5 + (x - this.faceBaseline.x) * 3.2),
          y: clamp(0.5 + (y - this.faceBaseline.y) * 3.2),
        };
        this.motionPoint.x += (target.x - this.motionPoint.x) * 0.34;
        this.motionPoint.y += (target.y - this.motionPoint.y) * 0.34;
        const point = { ...this.motionPoint };
        const processedSample = { generation, processedAt: at };
        const freshnessAccepted = this.emitFreshness(processedSample);
        if (
          freshnessAccepted &&
          this.freshness.isFresh(this.clock()) &&
          this.detectorTokenMatches(token, generation, detectorIdentity)
        ) {
          this.emitAim(point, 0.72, "face-position", at);
        }
      })
      .catch(() => {
        clearTimeout(timeoutHandle);
        if (this.detectorTimeout === timeoutHandle) {
          this.detectorTimeout = null;
        }
        if (requestId !== this.detectorRequestId) {
          return;
        }
        if (this.detectorTokenMatches(token, generation, detectorIdentity)) {
          this.transitionDetectorToFallback(
            token,
            generation,
            detectorIdentity,
            "frame-motion fallback · not eye tracking",
            this.clock(),
          );
        } else {
          this.detectorPending = false;
        }
      })
      .finally(() => {
        this.releaseDetectorBuffer(grayCopy);
      });
  }

  processFallback(at, sample, gray, motion, detectorContext = null) {
    if (
      detectorContext &&
      !this.detectorTokenMatches(
        detectorContext.token,
        detectorContext.generation,
        detectorContext.detectorIdentity,
      )
    ) {
      return false;
    }
    const contentEpoch = this.contentEpoch;
    let rotationDelta = null;
    if (motion.activeTotal > 0 && motion.difference > 0.35) {
      const rawCentroidX =
        motion.centroidX /
        motion.activeTotal /
        Math.max(1, this.analysisCanvas.width - 1);
      const centroid = {
        x: this.frontCameraMirrored ? 1 - rawCentroidX : rawCentroidX,
        y:
          motion.centroidY /
          motion.activeTotal /
          Math.max(1, this.analysisCanvas.height - 1),
      };
      const strength = clamp(motion.difference / 20, 0.05, 0.22);
      this.motionPoint.x = clamp(
        this.motionPoint.x + (centroid.x - 0.5) * strength,
        0.08,
        0.92,
      );
      this.motionPoint.y = clamp(
        this.motionPoint.y + (centroid.y - 0.5) * strength,
        0.08,
        0.92,
      );
      this.neutralSince = null;

      if (
        Math.abs(centroid.x - 0.5) > 0.28 &&
        at - this.lastMotionGestureAt > 900
      ) {
        this.lastMotionGestureAt = at;
        rotationDelta = centroid.x > 0.5 ? 1 : -1;
      }
    } else {
      if (this.neutralSince === null) {
        this.neutralSince = at;
      }
      const decay = at - this.neutralSince > 900 ? 0.18 : 0.04;
      this.motionPoint.x += (0.5 - this.motionPoint.x) * decay;
      this.motionPoint.y += (0.5 - this.motionPoint.y) * decay;
    }
    const processedSample = detectorContext
      ? { generation: sample.generation, processedAt: at }
      : { ...sample, processedAt: at };
    const freshnessAccepted = this.emitFreshness(processedSample);
    const contextAccepted =
      this.active &&
      this.lifecycle.isCurrent(sample.generation) &&
      this.contentEpoch === contentEpoch &&
      (!detectorContext ||
        this.detectorTokenMatches(
          detectorContext.token,
          detectorContext.generation,
          detectorContext.detectorIdentity,
        ));
    if (
      !freshnessAccepted ||
      !this.freshness.isFresh(this.clock()) ||
      !contextAccepted
    ) {
      return false;
    }
    if (rotationDelta !== null) {
      this.onGesture({ type: "rotate", delta: rotationDelta, at });
    }
    this.emitAim(this.motionPoint, clamp(motion.difference / 12, 0.25, 0.66), "motion", at);
    return true;
  }

  emitFreshness(sample) {
    const previous = {
      frameAt: this.freshness.frameAt,
      contentAt: this.freshness.contentAt,
      processedAt: this.freshness.processedAt,
    };
    if (!this.freshness.update(sample)) {
      return false;
    }
    const actionResult = this.onAction({
      type: "SENSOR_SAMPLE",
      ...sample,
      at: sample.processedAt ?? sample.contentAt ?? sample.frameAt,
    });
    if (actionResult?.ok === false) {
      this.freshness.frameAt = previous.frameAt;
      this.freshness.contentAt = previous.contentAt;
      this.freshness.processedAt = previous.processedAt;
      return false;
    }
    if (!this.active || !this.lifecycle.isCurrent(sample.generation)) {
      return false;
    }
    const freshnessNow = this.clock();
    const hasProcessed =
      this.freshness.processedAt !== null &&
      Math.max(0, freshnessNow - this.freshness.processedAt) <=
        this.freshness.maxAgeMs;
    const hasContent =
      this.freshness.contentAt !== null &&
      Math.max(0, freshnessNow - this.freshness.contentAt) <=
        this.freshness.maxAgeMs;
    for (const cause of [...this.pendingRecoveryCauses]) {
      const recovered =
        cause === "content-invalid"
          ? hasContent && hasProcessed
          : cause === "detector-transition"
            ? hasProcessed
            : false;
      if (recovered) {
        this.pendingRecoveryCauses.delete(cause);
        if (cause === "content-invalid") {
          this.contentBlocked = false;
        }
        this.onAction({
          type: "SENSOR_RECOVER",
          cause,
          at: sample.processedAt,
        });
      }
    }
    return this.active && this.lifecycle.isCurrent(sample.generation);
  }

  emitAim(point, confidence, estimator, at) {
    const alpha = confidence >= 0.7 ? 0.38 : 0.24;
    const smoothed = this.smoothedAim
      ? {
          x: this.smoothedAim.x + (point.x - this.smoothedAim.x) * alpha,
          y: this.smoothedAim.y + (point.y - this.smoothedAim.y) * alpha,
        }
      : { x: point.x, y: point.y };
    this.smoothedAim = smoothed;
    const dx = smoothed.x - 0.5;
    const dy = smoothed.y - 0.5;
    const radius = Math.hypot(dx, dy);
    const zone = radius < 0.13 ? "center" : "radial";
    this.onAim({ ...smoothed, confidence, estimator, zone, at });

    const gesture = this.gestureGate.sample({
      zone,
      y: smoothed.y,
      at,
      armed: this.armed,
      epoch: this.armedEpoch,
      choiceId: this.armedChoiceId,
    });
    if (gesture.confirmed) {
      this.onGesture({
        type: "confirm",
        source: "gesture",
        choiceId: this.armedChoiceId,
        at,
      });
    }
  }

  setArmed(armed, choiceId = null) {
    const normalizedChoice = armed ? choiceId : null;
    const changedChoice =
      armed && this.armed && normalizedChoice !== this.armedChoiceId;
    if (armed && (!this.armed || changedChoice)) {
      this.armedEpoch += 1;
      this.gestureGate.reset();
    }
    if (!armed) {
      this.gestureGate.reset();
    }
    this.armed = armed;
    this.armedChoiceId = normalizedChoice;
  }

  handleOrientationChange() {
    if (
      !this.active ||
      !this.cameraStream ||
      !this.lifecycle.isCurrent(this.lifecycleGeneration)
    ) {
      return false;
    }
    this.recalibrateOrientation();
    this.onCaption(
      "Orientation changed. Camera aim is recalibrating from fresh frames.",
    );
    return true;
  }

  startWatchdog(generation) {
    if (this.watchdog !== null) {
      return;
    }
    this.watchdog = setInterval(() => {
      if (!this.active || !this.lifecycle.isCurrent(generation)) {
        return;
      }
      const now = this.clock();
      this.onAction({ type: "TICK", at: now });
    }, 500);
  }

  startRecognition(generation) {
    const Recognition =
      globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
    if (!Recognition) {
      this.markRecognitionUnavailable(generation, {
        reason: "unsupported",
        caption:
          "Browser speech recognition unavailable. Microphone capture stopped; gesture and parity remain.",
      });
      return;
    }
    if (
      !this.active ||
      !this.lifecycle.isCurrent(generation) ||
      this.recognitionTerminal
    ) {
      return;
    }
    try {
      const recognition = new Recognition();
      this.recognitionSessionStarted = false;
      this.recognitionSessionFailed = false;
      this.recognitionExpectedEnd = false;
      recognition.continuous = true;
      recognition.interimResults = false;
      recognition.lang = "en-US";
      recognition.maxAlternatives = 1;
      recognition.onstart = () => {
        if (
          !this.active ||
          !this.lifecycle.isCurrent(generation) ||
          this.recognition !== recognition ||
          this.recognitionTerminal
        ) {
          return;
        }
        this.recognitionSessionStarted = true;
        this.recognitionSessionFailed = false;
        this.recognitionRetries = 0;
        this.onAction({
          type: "SENSOR_STATUS",
          sensor: "speech",
          status: "active",
          at: this.clock(),
        });
      };
      recognition.onresult = (event) => {
        if (
          !this.active ||
          !this.lifecycle.isCurrent(generation) ||
          this.recognition !== recognition
        ) {
          return;
        }
        for (let index = event.resultIndex; index < event.results.length; index += 1) {
          const result = event.results[index];
          if (!result.isFinal) {
            continue;
          }
          const alternative = result[0];
          const text = String(alternative.transcript || "").trim();
          const confidence = Number.isFinite(alternative.confidence)
            ? alternative.confidence
            : 0;
          const normalized = text.toLowerCase();
          const safety = /\b(?:stop|cancel|undo)\b/.test(normalized);
          if (safety || confidence >= 0.42) {
            this.recognitionRetries = 0;
            this.recognitionTransientFailures = 0;
            this.onSpeech(text, confidence);
          } else {
            this.onCaption("Low-confidence speech ignored. Repeat or use parity.");
          }
        }
      };
      recognition.onerror = (event) => {
        if (
          !this.active ||
          !this.lifecycle.isCurrent(generation) ||
          this.recognition !== recognition
        ) {
          return;
        }
        const error = String(event.error || "recognition-error").toLowerCase();
        if (
          error === "aborted" &&
          (this.recognitionExpectedEnd || this.speaking)
        ) {
          return;
        }
        const terminal = [
          "not-allowed",
          "service-not-allowed",
          "audio-capture",
          "language-not-supported",
        ].includes(error);
        if (terminal) {
          this.markRecognitionUnavailable(generation, {
            status: "denied",
            reason: error,
            caption:
              "Speech service unavailable; microphone capture stopped. Use gesture or parity.",
          });
        } else {
          this.recognitionSessionFailed = true;
          this.scheduleRecognitionRestart(generation, {
            kind: "transient-failure",
            reason: error === "aborted" ? "unexpected-aborted" : error,
          });
        }
      };
      recognition.onend = () => {
        if (
          !this.active ||
          !this.lifecycle.isCurrent(generation) ||
          this.recognition !== recognition ||
          this.recognitionTerminal
        ) {
          return;
        }
        const expected = this.recognitionExpectedEnd || this.speaking;
        const completedSession =
          this.recognitionSessionStarted && !this.recognitionSessionFailed;
        this.recognitionSessionStarted = false;
        this.recognitionExpectedEnd = false;
        if (expected) {
          return;
        }
        if (completedSession) {
          this.recognitionRetries = 0;
          this.recognitionTransientFailures = 0;
          this.scheduleRecognitionRestart(generation, {
            kind: "ordinary-end",
          });
        } else {
          this.scheduleRecognitionRestart(generation, {
            kind: "transient-failure",
            reason: "ended-before-session",
          });
        }
      };
      this.recognition = recognition;
      this.onAction({
        type: "SENSOR_STATUS",
        sensor: "speech",
        status: "starting",
        at: this.clock(),
      });
      recognition.start();
    } catch (error) {
      const terminal = ["NotAllowedError", "SecurityError", "NotSupportedError"].includes(
        error?.name,
      );
      if (terminal) {
        this.markRecognitionUnavailable(generation, {
          status: "denied",
          reason: error.name,
          caption:
            "Speech permission or service is unavailable. Microphone capture stopped; use gesture or sensor-free parity.",
        });
      } else {
        this.recognitionSessionFailed = true;
        this.scheduleRecognitionRestart(generation, {
          kind: "transient-failure",
          reason: error?.name || "start-failed",
        });
      }
    }
  }

  resetRecognitionForExplicitRecovery() {
    this.cancelNarrationForRecognitionRecovery();
    clearTimeout(this.recognitionRetry);
    this.recognitionRetry = null;
    this.detachRecognition();
    this.recognitionTerminal = false;
    this.recognitionRetries = 0;
    this.recognitionTransientFailures = 0;
    this.recognitionSessionStarted = false;
    this.recognitionSessionFailed = false;
    this.recognitionExpectedEnd = false;
    this.speaking = false;
  }

  cancelNarrationForRecognitionRecovery() {
    if (!this.speaking) {
      return false;
    }
    this.announcementEpoch += 1;
    this.speaking = false;
    this.recognitionExpectedEnd = false;
    cancelGlobalSpeech(globalThis);
    return true;
  }

  markRecognitionUnavailable(
    generation,
    {
      status = "unavailable",
      reason = "restart-exhausted",
      caption =
        "Speech recognition could not recover. Microphone capture stopped; use touch, switch, keyboard, or gesture parity, then retry explicitly.",
    } = {},
  ) {
    if (!this.active || !this.lifecycle.isCurrent(generation)) {
      return false;
    }
    this.recognitionTerminal = true;
    clearTimeout(this.recognitionRetry);
    this.recognitionRetry = null;
    this.detachRecognition();
    this.releaseMicrophoneCapture(
      status === "denied" ? "denied" : "unavailable",
    );
    this.onAction({
      type: "SENSOR_STATUS",
      sensor: "speech",
      status,
      reason,
      at: this.clock(),
    });
    this.onCaption(caption);
    return true;
  }

  scheduleRecognitionRestart(
    generation,
    { kind = "transient-failure", reason = kind } = {},
  ) {
    if (
      this.recognitionRetry ||
      !this.active ||
      !this.lifecycle.isCurrent(generation) ||
      this.recognitionTerminal
    ) {
      return false;
    }
    const consumesRetry = kind === "transient-failure";
    if (consumesRetry && this.recognitionTransientFailures >= 5) {
      return this.markRecognitionUnavailable(generation, {
        reason: "restart-exhausted",
      });
    }
    const retryIndex = consumesRetry ? this.recognitionRetries : 0;
    const delay = Math.min(
      4000,
      this.recognitionRetryBaseMs * 2 ** retryIndex,
    );
    if (consumesRetry) {
      this.recognitionRetries += 1;
      this.recognitionTransientFailures += 1;
      this.onAction({
        type: "SENSOR_STATUS",
        sensor: "speech",
        status: "recovering",
        reason,
        at: this.clock(),
      });
    } else {
      this.recognitionRetries = 0;
    }
    this.recognitionRetry = setTimeout(() => {
      this.recognitionRetry = null;
      if (
        this.active &&
        this.lifecycle.isCurrent(generation) &&
        !this.recognitionTerminal &&
        !this.speaking &&
        documentIsForeground() &&
        streamHasLiveTrack(this.microphoneStream, "audio")
      ) {
        this.detachRecognition();
        this.startRecognition(generation);
      }
    }, delay);
    return true;
  }

  announce(text) {
    const utteranceEpoch = ++this.announcementEpoch;
    this.onCaption(text);
    if (
      !this.active ||
      !documentIsForeground() ||
      typeof speechSynthesis === "undefined" ||
      typeof SpeechSynthesisUtterance === "undefined"
    ) {
      cancelGlobalSpeech(globalThis);
      this.speaking = false;
      this.recognitionExpectedEnd = false;
      return false;
    }
    const generation = this.lifecycle.generation;
    this.speaking = true;
    if (this.recognition) {
      this.recognitionExpectedEnd = true;
      try {
        this.recognition.abort();
      } catch {
        // Recognition may already be ending.
      }
    }
    cancelGlobalSpeech(globalThis);
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.05;
    const finish = () => {
      if (
        !this.lifecycle.isCurrent(generation) ||
        utteranceEpoch !== this.announcementEpoch
      ) {
        return;
      }
      this.speaking = false;
      this.recognitionExpectedEnd = false;
      if (
        this.active &&
        !this.recognitionTerminal &&
        documentIsForeground() &&
        streamHasLiveTrack(this.microphoneStream, "audio")
      ) {
        this.scheduleRecognitionRestart(generation, {
          kind: "expected-resume",
        });
      }
    };
    utterance.onend = finish;
    utterance.onerror = finish;
    speechSynthesis.speak(utterance);
    return true;
  }

  detachRecognition() {
    const recognition = this.recognition;
    this.recognition = null;
    this.recognitionSessionStarted = false;
    this.recognitionSessionFailed = false;
    this.recognitionExpectedEnd = false;
    if (!recognition) {
      return;
    }
    recognition.onstart = null;
    recognition.onresult = null;
    recognition.onerror = null;
    recognition.onend = null;
    try {
      recognition.abort();
    } catch {
      // Recognition may already be stopped.
    }
  }

  stop(reason = "user") {
    this.active = false;
    this.lifecycle.invalidate();
    this.detectorGuard.invalidate();
    this.contentEpoch += 1;
    this.cleanupRuntime(true);
    this.onCaption(`Sensors ended: ${reason}.`);
  }

  cleanupRuntime(reportOff) {
    this.cancelFrameLoop();
    clearInterval(this.watchdog);
    this.watchdog = null;
    clearTimeout(this.detectorTimeout);
    this.detectorTimeout = null;
    clearTimeout(this.recognitionRetry);
    this.recognitionRetry = null;
    this.detachRecognition();
    this.recognitionRetries = 0;
    this.recognitionTransientFailures = 0;
    this.announcementEpoch += 1;
    this.speaking = false;
    cancelGlobalSpeech(globalThis);
    const streams = new Set(this.streams);
    if (this.stream) {
      streams.add(this.stream);
    }
    for (const stream of streams) {
      stopStream(stream);
    }
    this.streams.clear();
    this.stream = null;
    this.microphoneStream = null;
    this.cameraStream = null;
    if (this.video) {
      try {
        this.video.pause();
      } catch {
        // A detached preview may not be pausable.
      }
      this.video.srcObject = null;
    }
    if (this.previousGray) {
      this.previousGray.fill(0);
      this.previousGray = null;
    }
    this.releasePendingDetectorBuffers();
    this.pendingRecoveryCauses.clear();
    this.contentBlocked = false;
    if (this.analysisContext && this.analysisCanvas) {
      this.analysisContext.clearRect(
        0,
        0,
        this.analysisCanvas.width,
        this.analysisCanvas.height,
      );
    }
    this.detector = null;
    this.detectorPending = false;
    this.detectorRequestId += 1;
    this.faceBaseline = null;
    this.motionPoint = { x: 0.5, y: 0.5 };
    this.smoothedAim = null;
    this.lastFrameToken = null;
    this.gestureGate.reset();
    this.armed = false;
    this.armedChoiceId = null;
    if (reportOff) {
      const at = this.clock();
      this.onAction({
        type: "SENSOR_STATUS",
        sensor: "camera",
        status: "off",
        at,
      });
      this.onAction({
        type: "SENSOR_STATUS",
        sensor: "microphone",
        status: "off",
        at,
      });
      this.onAction({
        type: "SENSOR_STATUS",
        sensor: "speech",
        status: "off",
        at,
      });
      this.onAction({
        type: "SENSOR_STATUS",
        sensor: "estimator",
        status: "off",
        at,
      });
    }
  }
}

export {
  AdaptiveSensorController,
  CoarseGestureGate,
  DetectorEpochGuard,
  EpochGuard,
  FreshnessGate,
  clamp,
  streamHasLiveTrack,
  stopStream,
};
