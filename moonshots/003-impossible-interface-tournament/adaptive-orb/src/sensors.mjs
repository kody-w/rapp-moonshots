class EpochGuard {
  constructor() {
    this.generation = 0;
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
    const accepted =
      token.epoch === this.epoch &&
      token.generation === generation &&
      token.contentEpoch === contentEpoch &&
      token.detectorIdentity === detectorIdentity;
    if (!accepted) {
      this.rejections += 1;
    }
    return accepted;
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
    this.lastConfirmAt = -Infinity;
  }

  sample({ zone, y, at, armed, epoch }) {
    if (!armed || zone === "center" || !Number.isFinite(y)) {
      this.phase = zone === "center" ? "center" : "idle";
      this.baseline = null;
      this.startedAt = null;
      this.armedEpoch = null;
      return { confirmed: false, phase: this.phase };
    }
    if (at - this.lastConfirmAt < this.cooldownMs) {
      return { confirmed: false, phase: "cooldown" };
    }
    if (this.armedEpoch !== epoch) {
      this.phase = "settled";
      this.baseline = y;
      this.startedAt = at;
      this.armedEpoch = epoch;
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
  } = {}) {
    this.video = video;
    this.onAction = onAction;
    this.onAim = onAim;
    this.onGesture = onGesture;
    this.onSpeech = onSpeech;
    this.onCaption = onCaption;
    this.clock = clock;
    this.lifecycle = new EpochGuard();
    this.detectorGuard = new DetectorEpochGuard();
    this.freshness = new FreshnessGate();
    this.gestureGate = new CoarseGestureGate();
    this.stream = null;
    this.active = false;
    this.frameHandle = null;
    this.frameHandleKind = null;
    this.watchdog = null;
    this.recognition = null;
    this.recognitionRetry = null;
    this.recognitionRetries = 0;
    this.recognitionTerminal = false;
    this.speaking = false;
    this.detector = null;
    this.detectorPending = false;
    this.detectorTimeout = null;
    this.contentEpoch = 0;
    this.lastFrameToken = null;
    this.previousGray = null;
    this.faceBaseline = null;
    this.motionPoint = { x: 0.5, y: 0.5 };
    this.neutralSince = null;
    this.lastMotionGestureAt = -Infinity;
    this.armed = false;
    this.armedEpoch = 0;
    this.lastAimAt = null;
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

  async start() {
    const generation = this.lifecycle.begin();
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
          facingMode: "user",
          width: { ideal: 640 },
          height: { ideal: 480 },
          frameRate: { ideal: 30, max: 30 },
        },
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      if (!this.active || !this.lifecycle.isCurrent(generation)) {
        stopStream(acquired);
        return false;
      }

      this.stream = acquired;
      this.attachTrackSafety(acquired, generation);
      if (this.video) {
        this.video.srcObject = acquired;
        this.video.muted = true;
        this.video.playsInline = true;
        await this.video.play();
      }
      if (!this.active || !this.lifecycle.isCurrent(generation)) {
        stopStream(acquired);
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

  attachTrackSafety(stream, generation) {
    for (const track of stream.getTracks()) {
      const sensor = track.kind === "audio" ? "microphone" : "camera";
      track.addEventListener(
        "ended",
        () => {
          if (this.active && this.lifecycle.isCurrent(generation)) {
            this.onAction({
              type: "SENSOR_LOSS",
              cause: `${sensor}-lost`,
              sensor,
              at: this.clock(),
            });
          }
        },
        { once: true },
      );
      track.addEventListener("mute", () => {
        if (this.active && this.lifecycle.isCurrent(generation)) {
          this.onAction({
            type: "SENSOR_LOSS",
            cause: `${sensor}-lost`,
            sensor,
            at: this.clock(),
          });
        }
      });
      track.addEventListener("unmute", () => {
        if (this.active && this.lifecycle.isCurrent(generation)) {
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

  startFrameLoop(generation) {
    const schedule = () => {
      if (!this.active || !this.lifecycle.isCurrent(generation)) {
        return;
      }
      if (this.video && typeof this.video.requestVideoFrameCallback === "function") {
        this.frameHandleKind = "video";
        this.frameHandle = this.video.requestVideoFrameCallback((at, metadata) => {
          this.processFrame(at, metadata, generation);
          schedule();
        });
      } else {
        this.frameHandleKind = "animation";
        this.frameHandle = requestAnimationFrame((at) => {
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
      }
    };
    schedule();
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
        this.contentEpoch += 1;
        this.detectorGuard.invalidate();
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
      this.contentEpoch += 1;
      this.detectorGuard.invalidate();
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
    if (this.detectorPending) {
      this.emitFreshness(sample);
      return;
    }
    this.detectorPending = true;
    const detectorIdentity = this.detector;
    const token = this.detectorGuard.capture(
      generation,
      this.contentEpoch,
      detectorIdentity,
    );
    const grayCopy = gray.slice();
    this.detectorTimeout = setTimeout(() => {
      if (
        this.detectorPending &&
        this.active &&
        this.lifecycle.isCurrent(generation) &&
        detectorIdentity === this.detector
      ) {
        this.detectorGuard.invalidate();
        this.detectorPending = false;
        this.detector = null;
        this.onAction({
          type: "SENSOR_STATUS",
          sensor: "estimator",
          status: "active",
          label: "frame-motion fallback after detector stall · not eye tracking",
          at: this.clock(),
        });
        this.processFallback(this.clock(), sample, grayCopy, motion);
      }
      grayCopy.fill(0);
    }, 900);

    Promise.resolve(detectorIdentity.detect(this.video))
      .then((faces) => {
        clearTimeout(this.detectorTimeout);
        const accepted =
          this.active &&
          this.lifecycle.isCurrent(generation) &&
          this.detectorGuard.accept(
            token,
            generation,
            this.contentEpoch,
            this.detector,
          );
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
          this.processFallback(at, sample, grayCopy, motion);
          return;
        }
        const x = (box.x + box.width / 2) / this.video.videoWidth;
        const y = (box.y + box.height / 2) / this.video.videoHeight;
        if (!this.faceBaseline) {
          this.faceBaseline = { x, y };
        }
        const point = {
          x: clamp(0.5 + (x - this.faceBaseline.x) * 3.2),
          y: clamp(0.5 + (y - this.faceBaseline.y) * 3.2),
        };
        sample.processedAt = at;
        this.emitFreshness(sample);
        this.emitAim(point, 0.72, "face-position", at);
      })
      .catch(() => {
        clearTimeout(this.detectorTimeout);
        if (
          this.active &&
          this.lifecycle.isCurrent(generation) &&
          detectorIdentity === this.detector
        ) {
          this.detectorGuard.invalidate();
          this.detectorPending = false;
          this.detector = null;
          this.onAction({
            type: "SENSOR_STATUS",
            sensor: "estimator",
            status: "active",
            label: "frame-motion fallback · not eye tracking",
            at: this.clock(),
          });
          this.processFallback(at, sample, grayCopy, motion);
        }
      })
      .finally(() => {
        grayCopy.fill(0);
      });
  }

  processFallback(at, sample, gray, motion) {
    if (motion.activeTotal > 0 && motion.difference > 0.35) {
      const centroid = {
        x:
          motion.centroidX /
          motion.activeTotal /
          Math.max(1, this.analysisCanvas.width - 1),
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
        this.onGesture({
          type: "rotate",
          delta: centroid.x > 0.5 ? 1 : -1,
          at,
        });
      }
    } else {
      if (this.neutralSince === null) {
        this.neutralSince = at;
      }
      const decay = at - this.neutralSince > 900 ? 0.18 : 0.04;
      this.motionPoint.x += (0.5 - this.motionPoint.x) * decay;
      this.motionPoint.y += (0.5 - this.motionPoint.y) * decay;
    }
    sample.processedAt = at;
    this.emitFreshness(sample);
    this.emitAim(this.motionPoint, clamp(motion.difference / 12, 0.25, 0.66), "motion", at);
    if (gray?.fill) {
      gray.fill(0);
    }
  }

  emitFreshness(sample) {
    if (!this.freshness.update(sample)) {
      return;
    }
    this.onAction({
      type: "SENSOR_SAMPLE",
      ...sample,
      at: sample.processedAt ?? sample.contentAt ?? sample.frameAt,
    });
  }

  emitAim(point, confidence, estimator, at) {
    const dx = point.x - 0.5;
    const dy = point.y - 0.5;
    const radius = Math.hypot(dx, dy);
    const zone = radius < 0.13 ? "center" : "radial";
    this.onAim({ ...point, confidence, estimator, zone, at });

    const gesture = this.gestureGate.sample({
      zone,
      y: point.y,
      at,
      armed: this.armed,
      epoch: this.armedEpoch,
    });
    if (gesture.confirmed) {
      this.onGesture({ type: "confirm", source: "gesture", at });
    }
  }

  setArmed(armed) {
    if (armed && !this.armed) {
      this.armedEpoch += 1;
    }
    if (!armed) {
      this.gestureGate.reset();
    }
    this.armed = armed;
  }

  startWatchdog(generation) {
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
      this.onAction({
        type: "SENSOR_STATUS",
        sensor: "speech",
        status: "unavailable",
        at: this.clock(),
      });
      this.onCaption("Browser speech recognition unavailable. Gesture and parity remain.");
      return;
    }
    if (!this.active || !this.lifecycle.isCurrent(generation)) {
      return;
    }
    try {
      const recognition = new Recognition();
      recognition.continuous = true;
      recognition.interimResults = false;
      recognition.lang = "en-US";
      recognition.maxAlternatives = 1;
      recognition.onresult = (event) => {
        if (!this.active || !this.lifecycle.isCurrent(generation)) {
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
            this.onSpeech(text, confidence);
          } else {
            this.onCaption("Low-confidence speech ignored. Repeat or use parity.");
          }
        }
      };
      recognition.onerror = (event) => {
        const terminal = [
          "not-allowed",
          "service-not-allowed",
          "audio-capture",
          "language-not-supported",
        ].includes(event.error);
        if (terminal) {
          this.recognitionTerminal = true;
          this.onAction({
            type: "SENSOR_STATUS",
            sensor: "speech",
            status: "denied",
            reason: event.error,
            at: this.clock(),
          });
          this.onCaption(
            "Speech service unavailable; the physical mic may still be active. Use gesture or parity.",
          );
        } else {
          this.scheduleRecognitionRestart(generation);
        }
      };
      recognition.onend = () => {
        if (
          this.active &&
          this.lifecycle.isCurrent(generation) &&
          !this.speaking &&
          !this.recognitionTerminal
        ) {
          this.scheduleRecognitionRestart(generation);
        }
      };
      this.recognition = recognition;
      recognition.start();
      this.onAction({
        type: "SENSOR_STATUS",
        sensor: "speech",
        status: "active",
        at: this.clock(),
      });
    } catch {
      this.scheduleRecognitionRestart(generation);
    }
  }

  scheduleRecognitionRestart(generation) {
    if (
      this.recognitionRetry ||
      !this.active ||
      !this.lifecycle.isCurrent(generation) ||
      this.recognitionTerminal ||
      this.recognitionRetries >= 5
    ) {
      return;
    }
    const delay = Math.min(4000, 250 * 2 ** this.recognitionRetries);
    this.recognitionRetries += 1;
    this.recognitionRetry = setTimeout(() => {
      this.recognitionRetry = null;
      if (
        this.active &&
        this.lifecycle.isCurrent(generation) &&
        !this.recognitionTerminal &&
        !this.speaking
      ) {
        this.detachRecognition();
        this.startRecognition(generation);
      }
    }, delay);
  }

  announce(text) {
    this.onCaption(text);
    if (
      !this.active ||
      typeof speechSynthesis === "undefined" ||
      typeof SpeechSynthesisUtterance === "undefined"
    ) {
      return;
    }
    const generation = this.lifecycle.generation;
    this.speaking = true;
    if (this.recognition) {
      try {
        this.recognition.abort();
      } catch {
        // Recognition may already be ending.
      }
    }
    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.05;
    const finish = () => {
      if (!this.lifecycle.isCurrent(generation)) {
        return;
      }
      this.speaking = false;
      if (!this.recognitionTerminal) {
        this.scheduleRecognitionRestart(generation);
      }
    };
    utterance.onend = finish;
    utterance.onerror = finish;
    speechSynthesis.speak(utterance);
  }

  detachRecognition() {
    if (!this.recognition) {
      return;
    }
    const recognition = this.recognition;
    this.recognition = null;
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
    if (this.frameHandle !== null) {
      if (
        this.frameHandleKind === "video" &&
        this.video &&
        typeof this.video.cancelVideoFrameCallback === "function"
      ) {
        this.video.cancelVideoFrameCallback(this.frameHandle);
      } else if (typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(this.frameHandle);
      }
    }
    this.frameHandle = null;
    clearInterval(this.watchdog);
    this.watchdog = null;
    clearTimeout(this.detectorTimeout);
    this.detectorTimeout = null;
    clearTimeout(this.recognitionRetry);
    this.recognitionRetry = null;
    this.detachRecognition();
    if (typeof speechSynthesis !== "undefined") {
      speechSynthesis.cancel();
    }
    stopStream(this.stream);
    this.stream = null;
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
    this.faceBaseline = null;
    this.motionPoint = { x: 0.5, y: 0.5 };
    this.lastFrameToken = null;
    this.gestureGate.reset();
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
  stopStream,
};
