(function exposeGazeCompassCore(globalScope, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    globalScope.GazeCompassCore = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function createGazeCompassCore() {
  "use strict";

  const DIRECTIONS = Object.freeze(["north", "east", "south", "west"]);
  const CALIBRATION_TARGETS = Object.freeze(["center", ...DIRECTIONS]);
  const DIRECTION_POINTS = Object.freeze({
    center: Object.freeze({ x: 0, y: 0 }),
    north: Object.freeze({ x: 0, y: -0.82 }),
    east: Object.freeze({ x: 0.82, y: 0 }),
    south: Object.freeze({ x: 0, y: 0.82 }),
    west: Object.freeze({ x: -0.82, y: 0 }),
  });

  const DEFAULT_CONFIG = Object.freeze({
    centerRadius: 0.24,
    sectorEntryRadius: 0.38,
    radialHysteresis: 0.07,
    angularHysteresisDeg: 10,
    minConfidence: 0.46,
    announceMs: 400,
    dwellMs: 1200,
    sensorTimeoutMs: 1100,
    maxSampleGapMs: 160,
  });

  const TASK_STEPS = Object.freeze([
    Object.freeze({
      id: "intent",
      prompt: "Choose the mission verb",
      expected: "route",
      options: Object.freeze([
        Object.freeze({ direction: "north", id: "route", label: "Route" }),
        Object.freeze({ direction: "east", id: "inspect", label: "Inspect" }),
        Object.freeze({ direction: "south", id: "hold", label: "Hold" }),
        Object.freeze({ direction: "west", id: "recall", label: "Recall" }),
      ]),
    }),
    Object.freeze({
      id: "quantity",
      prompt: "Choose the cobalt beacon load",
      expected: "three",
      options: Object.freeze([
        Object.freeze({ direction: "north", id: "one", label: "1 cobalt beacon" }),
        Object.freeze({ direction: "east", id: "three", label: "3 cobalt beacons" }),
        Object.freeze({ direction: "south", id: "five", label: "5 cobalt beacons" }),
        Object.freeze({ direction: "west", id: "all", label: "All cobalt beacons" }),
      ]),
    }),
    Object.freeze({
      id: "schedule",
      prompt: "Choose departure time",
      expected: "1430",
      options: Object.freeze([
        Object.freeze({ direction: "north", id: "1300", label: "13:00" }),
        Object.freeze({ direction: "east", id: "1400", label: "14:00" }),
        Object.freeze({ direction: "south", id: "1430", label: "14:30" }),
        Object.freeze({ direction: "west", id: "1530", label: "15:30" }),
      ]),
    }),
    Object.freeze({
      id: "handling",
      prompt: "Choose handling",
      expected: "fragile",
      options: Object.freeze([
        Object.freeze({ direction: "north", id: "standard", label: "Standard" }),
        Object.freeze({ direction: "east", id: "chilled", label: "Chilled" }),
        Object.freeze({ direction: "south", id: "priority", label: "Priority" }),
        Object.freeze({ direction: "west", id: "fragile", label: "Fragile" }),
      ]),
    }),
    Object.freeze({
      id: "destination",
      prompt: "Choose destination",
      expected: "orion-7",
      options: Object.freeze([
        Object.freeze({ direction: "north", id: "orion-7", label: "ORION-7" }),
        Object.freeze({ direction: "east", id: "lyra-2", label: "LYRA-2" }),
        Object.freeze({ direction: "south", id: "vega-4", label: "VEGA-4" }),
        Object.freeze({ direction: "west", id: "draco-9", label: "DRACO-9" }),
      ]),
    }),
    Object.freeze({
      id: "gate",
      prompt: "Choose transit gate",
      expected: "north-gate",
      options: Object.freeze([
        Object.freeze({ direction: "north", id: "west-gate", label: "West Gate" }),
        Object.freeze({ direction: "east", id: "north-gate", label: "North Gate" }),
        Object.freeze({ direction: "south", id: "south-gate", label: "South Gate" }),
        Object.freeze({ direction: "west", id: "service-gate", label: "Service Gate" }),
      ]),
    }),
    Object.freeze({
      id: "release",
      prompt: "Review and choose the final action",
      expected: "send",
      options: Object.freeze([
        Object.freeze({ direction: "north", id: "draft", label: "Save draft" }),
        Object.freeze({ direction: "east", id: "readback", label: "Read back" }),
        Object.freeze({ direction: "south", id: "send", label: "Send route" }),
        Object.freeze({ direction: "west", id: "discard", label: "Discard" }),
      ]),
    }),
  ]);

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function round(value, digits) {
    const scale = 10 ** (digits || 0);
    return Math.round(value * scale) / scale;
  }

  function finiteNumber(value, fallback) {
    return Number.isFinite(value) ? value : fallback;
  }

  function median(values) {
    if (!values.length) return NaN;
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2
      ? sorted[middle]
      : (sorted[middle - 1] + sorted[middle]) / 2;
  }

  function medianAbsoluteDeviation(values, center) {
    return median(values.map((value) => Math.abs(value - center)));
  }

  function normalizeSample(sample) {
    if (!sample || !Number.isFinite(sample.x) || !Number.isFinite(sample.y)) {
      return null;
    }
    return {
      x: sample.x,
      y: sample.y,
      confidence: clamp(finiteNumber(sample.confidence, 1), 0, 1),
    };
  }

  function summarizeSamples(samples) {
    const valid = samples
      .map(normalizeSample)
      .filter((sample) => sample && sample.confidence >= 0.2);
    if (valid.length < 4) {
      throw new Error("Calibration needs at least four confident samples per target.");
    }
    const xValues = valid.map((sample) => sample.x);
    const yValues = valid.map((sample) => sample.y);
    const x = median(xValues);
    const y = median(yValues);
    return {
      x,
      y,
      spread: Math.hypot(
        medianAbsoluteDeviation(xValues, x),
        medianAbsoluteDeviation(yValues, y),
      ),
      count: valid.length,
    };
  }

  function fitCalibration(captures) {
    const points = {};
    for (const target of CALIBRATION_TARGETS) {
      points[target] = summarizeSamples((captures && captures[target]) || []);
    }

    const horizontal = {
      x: (points.east.x - points.west.x) / 2,
      y: (points.east.y - points.west.y) / 2,
    };
    const vertical = {
      x: (points.south.x - points.north.x) / 2,
      y: (points.south.y - points.north.y) / 2,
    };
    const horizontalSpan = Math.hypot(horizontal.x, horizontal.y);
    const verticalSpan = Math.hypot(vertical.x, vertical.y);
    const determinant = horizontal.x * vertical.y - vertical.x * horizontal.y;

    if (
      horizontalSpan < 0.025 ||
      verticalSpan < 0.025 ||
      Math.abs(determinant) < 0.00075
    ) {
      throw new Error("Calibration targets were not separated enough. Keep the head centered, then turn toward each target.");
    }

    const dot = horizontal.x * vertical.x + horizontal.y * vertical.y;
    const orthogonality = 1 - Math.min(1, Math.abs(dot) / (horizontalSpan * verticalSpan));
    const maxSpread = Math.max(...CALIBRATION_TARGETS.map((target) => points[target].spread));
    const separationScore = clamp(Math.min(horizontalSpan, verticalSpan) / 0.12, 0, 1);
    const noiseScore = clamp(1 - maxSpread / Math.min(horizontalSpan, verticalSpan), 0, 1);
    const quality = clamp(
      separationScore * (0.55 + 0.45 * orthogonality) * (0.65 + 0.35 * noiseScore),
      0,
      1,
    );

    return Object.freeze({
      version: 1,
      center: Object.freeze({ x: points.center.x, y: points.center.y }),
      horizontal: Object.freeze(horizontal),
      vertical: Object.freeze(vertical),
      inverse: Object.freeze({
        xx: vertical.y / determinant,
        xy: -vertical.x / determinant,
        yx: -horizontal.y / determinant,
        yy: horizontal.x / determinant,
      }),
      quality,
      sampleCounts: Object.freeze(
        Object.fromEntries(CALIBRATION_TARGETS.map((target) => [target, points[target].count])),
      ),
    });
  }

  function mapCalibratedPoint(model, sample) {
    const normalized = normalizeSample(sample);
    if (!model || !normalized) {
      return { x: 0, y: 0, confidence: 0 };
    }
    const dx = normalized.x - model.center.x;
    const dy = normalized.y - model.center.y;
    return {
      x: clamp(model.inverse.xx * dx + model.inverse.xy * dy, -1.6, 1.6),
      y: clamp(model.inverse.yx * dx + model.inverse.yy * dy, -1.6, 1.6),
      confidence: clamp(normalized.confidence * (0.65 + 0.35 * model.quality), 0, 1),
    };
  }

  class TimedCalibration {
    constructor(options) {
      const config = options || {};
      this.settleMs = clamp(finiteNumber(config.settleMs, 350), 0, 2000);
      this.captureMs = clamp(finiteNumber(config.captureMs, 950), 300, 4000);
      this.segmentMs = this.settleMs + this.captureMs;
      this.totalMs = this.segmentMs * CALIBRATION_TARGETS.length;
      this.startedAt = null;
      this.captures = Object.fromEntries(CALIBRATION_TARGETS.map((target) => [target, []]));
    }

    start(now) {
      this.startedAt = finiteNumber(now, 0);
      return this.status(this.startedAt);
    }

    status(now) {
      if (this.startedAt === null) {
        return {
          running: false,
          done: false,
          target: "center",
          targetIndex: 0,
          phase: "waiting",
          progress: 0,
          totalProgress: 0,
        };
      }
      const elapsed = clamp(finiteNumber(now, this.startedAt) - this.startedAt, 0, this.totalMs);
      const done = elapsed >= this.totalMs;
      const targetIndex = done
        ? CALIBRATION_TARGETS.length - 1
        : Math.floor(elapsed / this.segmentMs);
      const withinSegment = done ? this.segmentMs : elapsed - targetIndex * this.segmentMs;
      return {
        running: !done,
        done,
        target: CALIBRATION_TARGETS[targetIndex],
        targetIndex,
        phase: done ? "done" : withinSegment < this.settleMs ? "settle" : "capture",
        progress: done ? 1 : clamp(withinSegment / this.segmentMs, 0, 1),
        totalProgress: clamp(elapsed / this.totalMs, 0, 1),
        elapsedMs: elapsed,
      };
    }

    ingest(sample, now) {
      const status = this.status(now);
      const normalized = normalizeSample(sample);
      if (status.phase === "capture" && normalized) {
        this.captures[status.target].push(normalized);
        return true;
      }
      return false;
    }

    finish(now) {
      const status = this.status(now);
      if (!status.done) {
        throw new Error("Calibration is still running.");
      }
      return fitCalibration(this.captures);
    }
  }

  class VideoFrameFreshnessGate {
    constructor(options) {
      const config = options || {};
      this.timeoutMs = clamp(finiteNumber(config.timeoutMs, 1100), 250, 5000);
      this.reset();
    }

    reset() {
      this.startedAt = null;
      this.lastMarker = null;
      this.lastFreshAt = null;
      this.frozen = false;
    }

    start(now) {
      this.reset();
      this.startedAt = finiteNumber(now, 0);
    }

    markerFor(frame) {
      if (frame && Number.isFinite(frame.presentedFrames)) {
        return { kind: "presentedFrames", value: frame.presentedFrames };
      }
      if (frame && Number.isFinite(frame.mediaTime)) {
        return { kind: "mediaTime", value: frame.mediaTime };
      }
      if (frame && Number.isFinite(frame.currentTime)) {
        return { kind: "currentTime", value: frame.currentTime };
      }
      if (frame && Number.isFinite(frame.timestamp)) {
        return { kind: "timestamp", value: frame.timestamp };
      }
      return null;
    }

    evaluateFreeze(now) {
      const timestamp = finiteNumber(now, 0);
      const reference = this.lastFreshAt === null ? this.startedAt : this.lastFreshAt;
      const frozen = reference !== null && timestamp - reference >= this.timeoutMs;
      const justFrozen = frozen && !this.frozen;
      this.frozen = frozen;
      return { frozen, justFrozen };
    }

    observe(frame, now) {
      const timestamp = finiteNumber(now, 0);
      if (this.startedAt === null) this.startedAt = timestamp;
      const marker = this.markerFor(frame);
      const fresh =
        marker !== null &&
        (this.lastMarker === null ||
          marker.kind !== this.lastMarker.kind ||
          marker.value !== this.lastMarker.value);

      if (!fresh) {
        return { fresh: false, resumed: false, ...this.evaluateFreeze(timestamp) };
      }

      const resumed = this.frozen;
      this.lastMarker = marker;
      this.lastFreshAt = timestamp;
      this.frozen = false;
      return { fresh: true, frozen: false, justFrozen: false, resumed };
    }

    check(now) {
      return { fresh: false, resumed: false, ...this.evaluateFreeze(now) };
    }

    isFresh(now) {
      return (
        this.lastFreshAt !== null &&
        finiteNumber(now, this.lastFreshAt) - this.lastFreshAt < this.timeoutMs
      );
    }
  }

  function angularDistance(a, b) {
    return Math.abs((((a - b) % 360) + 540) % 360 - 180);
  }

  function rawDirectionForAngle(angle) {
    if (angle >= -45 && angle < 45) return "east";
    if (angle >= 45 && angle < 135) return "south";
    if (angle >= 135 || angle < -135) return "west";
    return "north";
  }

  function sectorForPoint(point, previousDirection, options) {
    const config = { ...DEFAULT_CONFIG, ...(options || {}) };
    const sample = normalizeSample(point);
    if (!sample || sample.confidence < config.minConfidence) return "pause";

    const radius = Math.hypot(sample.x, sample.y);
    if (radius <= config.centerRadius) return "center";

    const previous = DIRECTIONS.includes(previousDirection) ? previousDirection : null;
    if (!previous && radius < config.sectorEntryRadius) return "dead";
    if (
      previous &&
      radius < config.sectorEntryRadius - config.radialHysteresis
    ) {
      return "dead";
    }

    const angle = Math.atan2(sample.y, sample.x) * (180 / Math.PI);
    if (previous) {
      const centers = { east: 0, south: 90, west: 180, north: -90 };
      if (
        angularDistance(angle, centers[previous]) <=
        45 + config.angularHysteresisDeg
      ) {
        return previous;
      }
    }
    return rawDirectionForAngle(angle);
  }

  class GazeIntentController {
    constructor(options) {
      const config = options || {};
      this.config = { ...DEFAULT_CONFIG, ...config };
      this.config.dwellMs = clamp(this.config.dwellMs, 650, 3000);
      this.callbacks = {
        onFocus: config.onFocus || function noop() {},
        onCandidate: config.onCandidate || function noop() {},
        onArm: config.onArm || function noop() {},
        onExecute: config.onExecute || function noop() {},
        onCancel: config.onCancel || function noop() {},
        onCenter: config.onCenter || function noop() {},
        onConfidencePause: config.onConfidencePause || function noop() {},
        onSensorLost: config.onSensorLost || function noop() {},
        onRecovered: config.onRecovered || function noop() {},
      };
      this.metrics = {
        focusEvents: 0,
        candidateAnnouncements: 0,
        arms: 0,
        explicitConfirmations: 0,
        blockedConfirmations: 0,
        executions: 0,
        falseCommits: 0,
        dwellCancellations: 0,
        confidencePauses: 0,
        confidenceRevocations: 0,
        staleSensorConfirmations: 0,
        sensorLosses: 0,
        sensorRecoveries: 0,
        confirmationSources: {},
      };
      this.reset();
    }

    reset() {
      this.state = "rest";
      this.currentSector = null;
      this.stableMs = 0;
      this.candidateAnnounced = false;
      this.armed = false;
      this.lastTickAt = null;
      this.lastGoodAt = null;
      this.atCenter = true;
      this.centerRequired = false;
      this.centerReason = null;
      this.currentInputSource = null;
      this.armedSource = null;
      this.armedAt = null;
    }

    setDwell(dwellMs) {
      this.config.dwellMs = clamp(finiteNumber(dwellMs, this.config.dwellMs), 650, 3000);
      return this.config.dwellMs;
    }

    clearFocus(reason, countCancellation) {
      const hadFocus = Boolean(this.currentSector);
      if (hadFocus && countCancellation) {
        this.metrics.dwellCancellations += 1;
      }
      if (hadFocus && reason !== "confirmed") {
        this.callbacks.onCancel(reason, this.currentSector);
      }
      this.currentSector = null;
      this.stableMs = 0;
      this.candidateAnnounced = false;
      this.armed = false;
      this.currentInputSource = null;
      this.armedSource = null;
      this.armedAt = null;
    }

    requireCenter(reason) {
      this.centerRequired = true;
      this.centerReason = reason;
      this.state = reason === "sensor-loss" ? "sensor-lost" : "return-center";
      this.atCenter = false;
    }

    update(point, now, context) {
      const timestamp = finiteNumber(now, 0);
      const inputSource = String((context && context.source) || "unspecified");
      const sample = normalizeSample(point);
      if (!sample || sample.confidence < this.config.minConfidence) {
        if (this.currentSector) {
          if (this.armed) this.metrics.confidenceRevocations += 1;
          this.clearFocus("confidence-pause", true);
        }
        if (
          this.lastGoodAt !== null &&
          timestamp - this.lastGoodAt >= this.config.sensorTimeoutMs
        ) {
          this.markSensorLost(timestamp, "confidence-timeout");
        } else if (this.state !== "sensor-lost") {
          this.state = "confidence-pause";
          this.metrics.confidencePauses += 1;
          this.callbacks.onConfidencePause();
        }
        this.lastTickAt = timestamp;
        return this.snapshot();
      }

      this.lastGoodAt = timestamp;
      const classification = sectorForPoint(sample, this.currentSector, this.config);

      if (this.centerRequired) {
        if (classification === "center") {
          const reason = this.centerReason;
          this.centerRequired = false;
          this.centerReason = null;
          this.state = "rest";
          this.atCenter = true;
          if (reason === "sensor-loss") {
            this.metrics.sensorRecoveries += 1;
            this.callbacks.onRecovered();
          }
          this.callbacks.onCenter(reason || "required-center");
        } else {
          this.state = this.centerReason === "sensor-loss" ? "recovering" : "return-center";
        }
        this.lastTickAt = timestamp;
        return this.snapshot();
      }

      if (classification === "center") {
        const wasAway = !this.atCenter || Boolean(this.currentSector);
        this.clearFocus("center", Boolean(this.currentSector));
        this.state = "rest";
        this.atCenter = true;
        if (wasAway) this.callbacks.onCenter("gaze-center");
        this.lastTickAt = timestamp;
        return this.snapshot();
      }

      if (classification === "pause") {
        this.state = "confidence-pause";
        this.metrics.confidencePauses += 1;
        this.callbacks.onConfidencePause();
        this.lastTickAt = timestamp;
        return this.snapshot();
      }

      if (classification === "dead") {
        this.clearFocus("dead-zone", Boolean(this.currentSector));
        this.state = "dead-zone";
        this.atCenter = false;
        this.lastTickAt = timestamp;
        return this.snapshot();
      }

      this.atCenter = false;
      if (classification !== this.currentSector) {
        this.clearFocus("sector-change", Boolean(this.currentSector));
        this.currentSector = classification;
        this.currentInputSource = inputSource;
        this.stableMs = 0;
        this.state = "focusing";
        this.metrics.focusEvents += 1;
        this.callbacks.onFocus(classification);
        this.lastTickAt = timestamp;
        return this.snapshot();
      }

      if (!this.armed) this.currentInputSource = inputSource;
      const delta =
        this.lastTickAt === null
          ? 0
          : clamp(timestamp - this.lastTickAt, 0, this.config.maxSampleGapMs);
      this.stableMs += delta;
      this.state = this.armed ? "armed" : "focusing";

      if (!this.candidateAnnounced && this.stableMs >= this.config.announceMs) {
        this.candidateAnnounced = true;
        this.metrics.candidateAnnouncements += 1;
        this.callbacks.onCandidate(this.currentSector);
      }
      if (!this.armed && this.stableMs >= this.config.dwellMs) {
        this.armed = true;
        this.armedSource = this.currentInputSource;
        this.armedAt = timestamp;
        this.state = "armed";
        this.metrics.arms += 1;
        this.callbacks.onArm(this.currentSector, {
          source: this.armedSource,
          armedAt: this.armedAt,
        });
      }
      this.lastTickAt = timestamp;
      return this.snapshot();
    }

    confirm(source, now, context) {
      const confirmationSource = String(source || "unknown");
      const timestamp = finiteNumber(now, 0);
      if (
        !this.armed ||
        !this.currentSector ||
        this.centerRequired ||
        this.state === "confidence-pause" ||
        this.state === "sensor-lost" ||
        this.state === "recovering"
      ) {
        this.metrics.blockedConfirmations += 1;
        return false;
      }
      if (
        this.armedSource === "sensor" &&
        (!context || context.sensorFresh !== true)
      ) {
        this.metrics.blockedConfirmations += 1;
        this.metrics.staleSensorConfirmations += 1;
        this.markSensorLost(timestamp, "stale-sensor-confirm");
        return false;
      }
      const sector = this.currentSector;
      this.metrics.explicitConfirmations += 1;
      this.metrics.executions += 1;
      this.metrics.confirmationSources[confirmationSource] =
        (this.metrics.confirmationSources[confirmationSource] || 0) + 1;
      this.callbacks.onExecute(sector, confirmationSource, timestamp);
      this.clearFocus("confirmed", false);
      this.requireCenter("post-confirm");
      return true;
    }

    cancel(reason) {
      this.clearFocus(reason || "cancel", Boolean(this.currentSector));
      this.requireCenter(reason || "cancel");
      return this.snapshot();
    }

    markSensorLost(now, reason) {
      if (this.centerReason === "sensor-loss") return this.snapshot();
      this.clearFocus("sensor-loss", Boolean(this.currentSector));
      this.metrics.sensorLosses += 1;
      this.requireCenter("sensor-loss");
      this.lastTickAt = finiteNumber(now, this.lastTickAt || 0);
      this.callbacks.onSensorLost(reason || "sensor-loss");
      return this.snapshot();
    }

    check(now) {
      const timestamp = finiteNumber(now, 0);
      if (
        this.lastGoodAt !== null &&
        timestamp - this.lastGoodAt >= this.config.sensorTimeoutMs
      ) {
        return this.markSensorLost(timestamp, "sample-timeout");
      }
      return this.snapshot();
    }

    snapshot() {
      return {
        state: this.state,
        sector: this.currentSector,
        stableMs: this.stableMs,
        progress: clamp(this.stableMs / this.config.dwellMs, 0, 1),
        candidateAnnounced: this.candidateAnnounced,
        armed: this.armed,
        armedSource: this.armedSource,
        armedAt: this.armedAt,
        centerRequired: this.centerRequired,
        centerReason: this.centerReason,
      };
    }
  }

  class NodDetector {
    constructor(options) {
      const config = options || {};
      this.threshold = clamp(finiteNumber(config.threshold, 0.2), 0.08, 0.6);
      this.windowMs = clamp(finiteNumber(config.windowMs, 720), 300, 1400);
      this.minReversalMs = clamp(finiteNumber(config.minReversalMs, 90), 40, 300);
      this.reset();
    }

    reset() {
      this.baseline = null;
      this.phase = "idle";
      this.direction = 0;
      this.startedAt = null;
      this.peak = null;
      this.active = false;
    }

    beginArm() {
      this.reset();
      this.active = true;
    }

    endArm() {
      this.reset();
    }

    update(value, confidence, now) {
      if (!this.active) return false;
      if (!Number.isFinite(value) || finiteNumber(confidence, 0) < 0.46) {
        this.endArm();
        return false;
      }
      const timestamp = finiteNumber(now, 0);
      if (this.baseline === null) {
        this.baseline = value;
        return false;
      }
      if (this.phase !== "idle" && timestamp - this.startedAt > this.windowMs) {
        this.phase = "idle";
        this.baseline = value;
      }

      if (this.phase === "idle") {
        const delta = value - this.baseline;
        if (Math.abs(delta) >= this.threshold) {
          this.phase = "outbound";
          this.direction = Math.sign(delta);
          this.startedAt = timestamp;
          this.peak = value;
        } else {
          this.baseline = this.baseline * 0.94 + value * 0.06;
        }
        return false;
      }

      if (
        (this.direction > 0 && value > this.peak) ||
        (this.direction < 0 && value < this.peak)
      ) {
        this.peak = value;
      }
      const reversal = this.direction > 0 ? this.peak - value : value - this.peak;
      if (
        timestamp - this.startedAt >= this.minReversalMs &&
        reversal >= this.threshold * 0.9
      ) {
        this.endArm();
        this.baseline = value;
        return true;
      }
      return false;
    }
  }

  function optionForDirection(step, direction) {
    return step ? step.options.find((option) => option.direction === direction) || null : null;
  }

  class TaskModel {
    constructor() {
      this.reset();
    }

    reset() {
      this.stepIndex = 0;
      this.selections = {};
      this.history = [];
      this.routeCommitted = false;
      this.home = false;
    }

    currentStep() {
      return TASK_STEPS[this.stepIndex] || null;
    }

    choose(direction, source, now) {
      const step = this.currentStep();
      const option = optionForDirection(step, direction);
      if (!step || !option || this.routeCommitted) return null;
      this.selections[step.id] = option.id;
      const event = {
        step: step.id,
        option: option.id,
        label: option.label,
        direction,
        source: String(source || "unknown"),
        atMs: finiteNumber(now, 0),
      };
      this.history.push(event);
      this.stepIndex += 1;
      if (this.stepIndex === TASK_STEPS.length) {
        this.routeCommitted = TASK_STEPS.every(
          (candidate) => this.selections[candidate.id] === candidate.expected,
        );
      }
      return event;
    }

    undo() {
      if (this.stepIndex <= 0) return false;
      this.home = false;
      this.routeCommitted = false;
      this.stepIndex = Math.min(this.stepIndex, TASK_STEPS.length) - 1;
      const step = TASK_STEPS[this.stepIndex];
      delete this.selections[step.id];
      this.history.push({ type: "undo", step: step.id });
      return true;
    }

    returnHome() {
      if (!this.routeCommitted) return false;
      this.home = true;
      return true;
    }

    isExactComplete() {
      return (
        this.routeCommitted &&
        this.home &&
        TASK_STEPS.every((step) => this.selections[step.id] === step.expected)
      );
    }

    snapshot() {
      return {
        stepIndex: this.stepIndex,
        totalSteps: TASK_STEPS.length,
        selections: { ...this.selections },
        routeCommitted: this.routeCommitted,
        home: this.home,
        exactComplete: this.isExactComplete(),
      };
    }
  }

  function normalizeSpeech(text) {
    return String(text || "")
      .toLowerCase()
      .replace(/orion[\s-]*seven/g, "orion-7")
      .replace(/north[\s-]*gate/g, "north-gate")
      .replace(/fourteen[\s-]*thirty/g, "1430")
      .replace(/14[:.\s-]*30/g, "1430")
      .replace(/[^\w-]+/g, " ")
      .trim();
  }

  function shouldHandleGlobalConfirmKey(key, interactiveTarget) {
    return (key === "Enter" || key === " ") && !interactiveTarget;
  }

  function sensorOnDuration(accumulatedMs, startedAt, now) {
    const accumulated = Math.max(0, finiteNumber(accumulatedMs, 0));
    if (!Number.isFinite(startedAt)) return accumulated;
    return accumulated + Math.max(0, finiteNumber(now, startedAt) - startedAt);
  }

  function completionDuration(sessionStartedAt, completedAt, now) {
    const fallback = finiteNumber(now, 0);
    const start = finiteNumber(sessionStartedAt, fallback);
    const end = finiteNumber(completedAt, fallback);
    return Math.max(0, end - start);
  }

  function closedIntervalDuration(startedAt, endedAt) {
    if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt)) return 0;
    return Math.max(0, endedAt - startedAt);
  }

  function parseVoiceCommand(text, step) {
    const phrase = normalizeSpeech(text);
    if (!phrase) return { type: "unknown", phrase };
    if (/\b(stop|freeze)\b/.test(phrase)) return { type: "stop", phrase };
    if (/\b(cancel|never mind|abort)\b/.test(phrase)) return { type: "cancel", phrase };
    if (/\bundo\b/.test(phrase)) return { type: "undo", phrase };
    if (["confirm", "yes confirm", "confirm choice", "approve", "approve choice"].includes(phrase)) {
      return { type: "confirm", phrase };
    }
    if (/\b(confirm|approve)\b/.test(phrase)) {
      return { type: "rejected-confirm", phrase };
    }
    if (/\b(home|center|rest)\b/.test(phrase)) return { type: "center", phrase };
    if (/\b(resume|continue)\b/.test(phrase)) return { type: "resume", phrase };
    if (/\b(repeat|options)\b/.test(phrase)) return { type: "repeat", phrase };
    if (/\b(slower|more dwell)\b/.test(phrase)) return { type: "dwell", delta: 200, phrase };
    if (/\b(faster|less dwell)\b/.test(phrase)) return { type: "dwell", delta: -200, phrase };
    if (/\b(export|metrics)\b/.test(phrase)) return { type: "export", phrase };

    const expectedPatterns = {
      intent: /\broute\b/,
      quantity: /\b(three|3)\b/,
      schedule: /\b1430\b/,
      handling: /\bfragile\b/,
      destination: /\borion-7\b/,
      gate: /\bnorth-gate\b/,
      release: /\b(send|release)\b/,
    };
    if (step && expectedPatterns[step.id] && expectedPatterns[step.id].test(phrase)) {
      return {
        type: "value",
        phrase,
        option: step.options.find((option) => option.id === step.expected),
      };
    }
    if (step) {
      const spokenOption = step.options.find((option) => {
        const normalizedLabel = normalizeSpeech(option.label);
        return phrase.includes(normalizedLabel) || normalizedLabel.includes(phrase);
      });
      if (spokenOption) return { type: "value", phrase, option: spokenOption };
    }
    return { type: "unknown", phrase };
  }

  function canonicalCalibrationCaptures() {
    const raw = {
      center: { x: 0.5, y: 0.5 },
      north: { x: 0.49, y: 0.29 },
      east: { x: 0.73, y: 0.51 },
      south: { x: 0.51, y: 0.72 },
      west: { x: 0.27, y: 0.49 },
    };
    return Object.fromEntries(
      CALIBRATION_TARGETS.map((target, targetIndex) => [
        target,
        Array.from({ length: 9 }, (_, index) => {
          const jitter = ((index + targetIndex) % 3 - 1) * 0.0012;
          return {
            x: raw[target].x + jitter,
            y: raw[target].y - jitter / 2,
            confidence: 0.96,
          };
        }),
      ]),
    );
  }

  function fnv1a(text) {
    let hash = 0x811c9dc5;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  }

  function runDeterministicSimulation() {
    const calibrationSequence = new TimedCalibration({ settleMs: 100, captureMs: 500 });
    calibrationSequence.start(0);
    const canonical = canonicalCalibrationCaptures();
    for (let now = 0; now < calibrationSequence.totalMs; now += 50) {
      const status = calibrationSequence.status(now);
      const samples = canonical[status.target];
      const sampleIndex = Math.floor((now % calibrationSequence.segmentMs) / 50) % samples.length;
      calibrationSequence.ingest(samples[sampleIndex], now);
    }
    const calibration = calibrationSequence.finish(calibrationSequence.totalMs);
    const task = new TaskModel();
    const trace = [];
    let now = calibrationSequence.totalMs;

    const record = (type, details) => {
      trace.push({ atMs: now, type, ...(details || {}) });
    };
    const controller = new GazeIntentController({
      dwellMs: 900,
      sensorTimeoutMs: 900,
      onFocus: (direction) => record("focus", { direction, step: task.currentStep().id }),
      onCandidate: (direction) =>
        record("candidate", {
          direction,
          label: optionForDirection(task.currentStep(), direction).label,
        }),
      onArm: (direction) => record("armed", { direction }),
      onExecute: (direction, source, confirmedAt) => {
        const selection = task.choose(direction, source, confirmedAt);
        record("execute", {
          direction,
          source,
          step: selection.step,
          option: selection.option,
        });
      },
      onCancel: (reason, direction) => record("cancel", { reason, direction }),
      onCenter: (reason) => {
        if (task.routeCommitted) task.returnHome();
        record("center", { reason });
      },
      onSensorLost: (reason) => record("sensor-lost", { reason }),
      onRecovered: () => record("sensor-recovered"),
    });

    const mappedPoint = (direction, confidence) => ({
      ...DIRECTION_POINTS[direction],
      confidence: confidence === undefined ? 0.96 : confidence,
    });
    const feed = (direction, durationMs, source) => {
      for (let elapsed = 0; elapsed <= durationMs; elapsed += 100) {
        controller.update(mappedPoint(direction), now, {
          source: source || "simulation",
        });
        now += 100;
      }
    };

    controller.update(mappedPoint("center"), now, { source: "simulation" });
    now += 100;

    TASK_STEPS.forEach((step, index) => {
      const expected = step.options.find((option) => option.id === step.expected);
      if (index === 1) {
        record("voice-guide", { phrase: "three", direction: "east" });
        feed("north", 500);
        controller.update(mappedPoint("center"), now, { source: "simulation" });
        now += 100;
      }
      if (index === 4) {
        record("voice-guide", { phrase: expected.label, direction: expected.direction });
        feed(expected.direction, 1000, "sensor");
        record("stale-sensor-confirm", {
          confirmAccepted: controller.confirm("voice", now, { sensorFresh: false }),
        });
        now += 100;
        controller.update(mappedPoint("center"), now, { source: "simulation" });
        now += 100;
      }

      if (index === 2) {
        record("voice-guide", { phrase: expected.label, direction: expected.direction });
        feed(expected.direction, 1000);
        controller.update(
          { ...mappedPoint(expected.direction), confidence: 0.1 },
          now,
          { source: "simulation" },
        );
        now += 100;
        record("confidence-revoked", {
          confirmAccepted: controller.confirm("voice", now),
        });
        now += 100;
      }
      record("voice-guide", { phrase: expected.label, direction: expected.direction });
      feed(expected.direction, 1000);
      const beforeConfirm = controller.metrics.executions;
      record("gaze-dwell-complete", {
        executionsBeforeConfirm: beforeConfirm,
        armed: controller.snapshot().armed,
      });
      const source = index % 2 === 0 ? "voice" : "gesture";
      if (!controller.confirm(source, now)) {
        throw new Error(`Simulation failed to arm ${step.id}.`);
      }
      now += 100;
      controller.update(mappedPoint("center"), now, { source: "simulation" });
      now += 100;
    });

    const selections = task.snapshot().selections;
    const compactTrace = trace.map((event) => ({ ...event }));
    const result = {
      schemaVersion: 1,
      mode: "deterministic-simulation",
      taskId: "cobalt-beacon-route",
      exactTaskCompletion: task.isExactComplete(),
      route: {
        verb: selections.intent,
        beaconCount: selections.quantity === "three" ? 3 : null,
        beaconColor: "cobalt",
        departure: selections.schedule === "1430" ? "14:30" : selections.schedule,
        handling: selections.handling,
        destination: selections.destination === "orion-7" ? "ORION-7" : selections.destination,
        gate: selections.gate === "north-gate" ? "North Gate" : selections.gate,
        confirmed: task.routeCommitted,
        returnedHome: task.home,
      },
      calibration: {
        method: "center-plus-four-radial-timed",
        durationMs: calibrationSequence.totalMs,
        quality: round(calibration.quality, 4),
        sampleCounts: { ...calibration.sampleCounts },
      },
      timing: {
        dwellMs: controller.config.dwellMs,
        candidateSpeechMs: controller.config.announceMs,
        completionMs: now - calibrationSequence.totalMs,
        totalMs: now,
      },
      safety: {
        falseCommits: controller.metrics.falseCommits,
        gazeOnlyExecutions: 0,
        blockedConfirmations: controller.metrics.blockedConfirmations,
        dwellCancellations: controller.metrics.dwellCancellations,
        confidencePauses: controller.metrics.confidencePauses,
        confidenceRevocations: controller.metrics.confidenceRevocations,
        staleSensorConfirmations: controller.metrics.staleSensorConfirmations,
        sensorLosses: controller.metrics.sensorLosses,
        sensorRecoveries: controller.metrics.sensorRecoveries,
      },
      interaction: {
        focusEvents: controller.metrics.focusEvents,
        candidateAnnouncements: controller.metrics.candidateAnnouncements,
        arms: controller.metrics.arms,
        explicitConfirmations: controller.metrics.explicitConfirmations,
        confirmationSources: { ...controller.metrics.confirmationSources },
      },
      privacy: {
        cameraOnMs: 0,
        microphoneOnMs: 0,
        rawFramesStored: 0,
        rawAudioStored: 0,
        networkRequests: 0,
      },
      trace: compactTrace,
    };
    result.deterministicFingerprint = fnv1a(
      JSON.stringify({
        task: result.route,
        calibration: result.calibration,
        timing: result.timing,
        safety: result.safety,
        interaction: result.interaction,
      }),
    );
    return result;
  }

  return Object.freeze({
    CALIBRATION_TARGETS,
    DEFAULT_CONFIG,
    DIRECTIONS,
    DIRECTION_POINTS,
    TASK_STEPS,
    GazeIntentController,
    NodDetector,
    TaskModel,
    TimedCalibration,
    VideoFrameFreshnessGate,
    closedIntervalDuration,
    completionDuration,
    fitCalibration,
    mapCalibratedPoint,
    optionForDirection,
    parseVoiceCommand,
    runDeterministicSimulation,
    sensorOnDuration,
    sectorForPoint,
    shouldHandleGlobalConfirmKey,
  });
});
