const MOBILE_LAYOUT_CONTRACT = Object.freeze({
  portrait: Object.freeze({ width: 390, height: 844 }),
  landscape: Object.freeze({ width: 844, height: 390 }),
  minimumTargetPx: 44,
  maximumPrimaryChoices: 4,
  centerOrbMinimumPx: 112,
  compactLandscapeMultiColumnMinWidth: 620,
});

function mobileLayoutForViewport(
  width,
  height,
  {
    top = 0,
    right = 0,
    bottom = 0,
    left = 0,
  } = {},
) {
  const viewportWidth = Math.max(320, Number(width) || 0);
  const viewportHeight = Math.max(1, Number(height) || 0);
  const orientation =
    viewportWidth > viewportHeight ? "landscape" : "portrait";
  const usableWidth = Math.max(0, viewportWidth - left - right);
  const usableHeight = Math.max(0, viewportHeight - top - bottom);
  const compactLandscape =
    orientation === "landscape" && viewportHeight <= 500;
  const availableContentWidth = Math.max(
    0,
    usableWidth - (compactLandscape ? 20 : 0),
  );
  const usesMultiColumn =
    compactLandscape &&
    availableContentWidth >=
      MOBILE_LAYOUT_CONTRACT.compactLandscapeMultiColumnMinWidth;
  const targetOrbDiameter =
    orientation === "portrait"
      ? Math.min(374, Math.max(280, usableWidth - 34))
      : compactLandscape && !usesMultiColumn
        ? Math.min(284, Math.max(1, availableContentWidth - 16))
        : Math.min(350, Math.max(248, viewportHeight * 0.82));
  const orbDiameter = Math.min(
    compactLandscape ? availableContentWidth : usableWidth,
    targetOrbDiameter,
  );
  return Object.freeze({
    width: viewportWidth,
    height: viewportHeight,
    orientation,
    usableWidth,
    usableHeight,
    availableContentWidth,
    compactLandscape,
    usesMultiColumn,
    scrollSafeSingleColumn: compactLandscape && !usesMultiColumn,
    orbDiameter,
    minimumTargetPx: MOBILE_LAYOUT_CONTRACT.minimumTargetPx,
    maximumPrimaryChoices: MOBILE_LAYOUT_CONTRACT.maximumPrimaryChoices,
    noHorizontalOverflow:
      orbDiameter <=
      (compactLandscape ? availableContentWidth : usableWidth),
  });
}

function phoneChoiceWindow(options, highlightedId, limit = 4) {
  const normalized = Array.isArray(options) ? options : [];
  const pageSize = Math.max(1, Math.min(4, Number(limit) || 4));
  const highlightedIndex = normalized.findIndex(
    (option) => option.id === highlightedId,
  );
  const page = highlightedIndex < 0 ? 0 : Math.floor(highlightedIndex / pageSize);
  const start = page * pageSize;
  const visible = normalized.slice(start, start + pageSize);
  return Object.freeze({
    ids: Object.freeze(visible.map((option) => option.id)),
    page,
    pageCount: Math.max(1, Math.ceil(normalized.length / pageSize)),
    start,
    end: start + visible.length,
    total: normalized.length,
    refined: normalized.length > pageSize,
  });
}

function radialChoiceGeometry({
  stageDiameter,
  choiceWidth,
  choiceHeight,
  centerDiameter,
  choiceCount,
  radiusRatio = 0.35,
  choiceScale = 1.06,
  edgeInset = 2,
  centerGap = 1,
}) {
  const stage = Math.max(1, Number(stageDiameter) || 0);
  const width = Math.max(1, Number(choiceWidth) || 0) * choiceScale;
  const height = Math.max(1, Number(choiceHeight) || 0) * choiceScale;
  const centerRadius = Math.max(0, Number(centerDiameter) || 0) / 2;
  const count = Math.max(1, Math.min(8, Math.floor(Number(choiceCount) || 1)));
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  const stageRadius = stage / 2;
  const angles = Array.from(
    { length: count },
    (_, index) => -Math.PI / 2 + (index / count) * Math.PI * 2,
  );
  const maximumRadius = Math.max(
    0,
    Math.min(
      ...angles.map((angle) => {
        const cosine = Math.abs(Math.cos(angle));
        const sine = Math.abs(Math.sin(angle));
        const horizontal =
          cosine < 1e-9
            ? Number.POSITIVE_INFINITY
            : (stageRadius - edgeInset - halfWidth) / cosine;
        const vertical =
          sine < 1e-9
            ? Number.POSITIVE_INFINITY
            : (stageRadius - edgeInset - halfHeight) / sine;
        return Math.max(0, Math.min(horizontal, vertical));
      }),
    ),
  );
  const clearsCenter = (radius) =>
    angles.every((angle) => {
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;
      const dx = Math.max(Math.abs(x) - halfWidth, 0);
      const dy = Math.max(Math.abs(y) - halfHeight, 0);
      return Math.hypot(dx, dy) >= centerRadius + centerGap;
    });
  let minimumRadius = maximumRadius;
  const feasible = clearsCenter(maximumRadius);
  if (feasible) {
    let low = 0;
    let high = maximumRadius;
    for (let attempt = 0; attempt < 32; attempt += 1) {
      const midpoint = (low + high) / 2;
      if (clearsCenter(midpoint)) {
        high = midpoint;
      } else {
        low = midpoint;
      }
    }
    minimumRadius = high;
  }
  const desiredRadius = stage * Math.max(0, Number(radiusRatio) || 0);
  const radius = feasible
    ? Math.min(maximumRadius, Math.max(minimumRadius, desiredRadius))
    : maximumRadius;
  const positions = angles.map((angle) => {
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    const dx = Math.max(Math.abs(x) - halfWidth, 0);
    const dy = Math.max(Math.abs(y) - halfHeight, 0);
    return Object.freeze({
      x,
      y,
      left: stageRadius + x - halfWidth,
      right: stageRadius + x + halfWidth,
      top: stageRadius + y - halfHeight,
      bottom: stageRadius + y + halfHeight,
      centerClearance: Math.hypot(dx, dy) - centerRadius,
    });
  });
  const overflow = positions.some(
    (position) =>
      position.left < -1e-6 ||
      position.top < -1e-6 ||
      position.right > stage + 1e-6 ||
      position.bottom > stage + 1e-6,
  );
  const centerOverlap = positions.some(
    (position) => position.centerClearance < -1e-6,
  );
  return Object.freeze({
    radius,
    minimumRadius,
    maximumRadius,
    feasible,
    overflow,
    centerOverlap,
    safe: feasible && !overflow && !centerOverlap,
    positions: Object.freeze(positions),
  });
}

function shortSpokenSummary(text, maximumWords = 16) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "";
  }
  const firstSentence = normalized.match(/^.*?[.!?](?:\s|$)/)?.[0]?.trim();
  const candidate = firstSentence || normalized;
  const words = candidate.split(" ");
  if (words.length <= maximumWords) {
    return candidate;
  }
  return `${words.slice(0, maximumWords).join(" ")}…`;
}

class MobileMetricsTracker {
  constructor({ clock = () => performance.now() } = {}) {
    this.clock = clock;
    this.startedAt = null;
    this.firstValueAt = null;
    this.glanceStartedAt = null;
    this.glanceTimeProxyMs = 0;
    this.glanceSamples = 0;
    this.oneHandTouchFallbacks = 0;
    this.interruptionStartedAt = null;
    this.interruptions = 0;
    this.interruptionRecoveries = 0;
    this.interruptionRecoveryMs = 0;
    this.permissionRequests = { microphone: 0, camera: 0 };
    this.sensorStartedAt = { microphone: null, camera: null };
    this.sensorOnMs = { microphone: 0, camera: 0 };
    this.orientationChanges = 0;
    this.hapticSignals = 0;
  }

  start(at = this.clock()) {
    if (this.startedAt === null) {
      this.startedAt = at;
    }
  }

  noteAction(action, result, at = this.clock()) {
    const source = action?.source;
    if (["touch", "switch"].includes(source)) {
      this.oneHandTouchFallbacks += 1;
    }
    if (action?.type === "HIGHLIGHT" && source === "touch") {
      this.glanceStartedAt = at;
    }
    if (
      action?.type === "CONFIRM" &&
      result?.ok &&
      ["touch", "switch"].includes(source) &&
      Number.isFinite(this.glanceStartedAt)
    ) {
      this.glanceTimeProxyMs += Math.max(
        0,
        Math.min(10000, at - this.glanceStartedAt),
      );
      this.glanceSamples += 1;
      this.glanceStartedAt = null;
    }
  }

  noteValue(at = this.clock()) {
    if (this.firstValueAt === null) {
      this.firstValueAt = at;
    }
  }

  notePermissionRequest(sensor) {
    if (Object.hasOwn(this.permissionRequests, sensor)) {
      this.permissionRequests[sensor] += 1;
    }
  }

  noteSensorStatus(sensor, status, at = this.clock()) {
    if (!Object.hasOwn(this.sensorStartedAt, sensor)) {
      return;
    }
    if (status === "active" && this.sensorStartedAt[sensor] === null) {
      this.sensorStartedAt[sensor] = at;
      return;
    }
    if (
      ["off", "denied", "failed", "lost", "not-requested"].includes(status) &&
      Number.isFinite(this.sensorStartedAt[sensor])
    ) {
      this.sensorOnMs[sensor] += Math.max(0, at - this.sensorStartedAt[sensor]);
      this.sensorStartedAt[sensor] = null;
    }
  }

  beginInterruption(at = this.clock()) {
    if (this.interruptionStartedAt === null) {
      this.interruptionStartedAt = at;
      this.interruptions += 1;
    }
  }

  recoverInterruption(at = this.clock()) {
    if (this.interruptionStartedAt === null) {
      return false;
    }
    this.interruptionRecoveryMs += Math.max(0, at - this.interruptionStartedAt);
    this.interruptionStartedAt = null;
    this.interruptionRecoveries += 1;
    return true;
  }

  noteOrientationChange() {
    this.orientationChanges += 1;
    this.glanceStartedAt = null;
  }

  noteHaptic() {
    this.hapticSignals += 1;
  }

  snapshot(
    at = this.clock(),
    {
      voiceRepairs = 0,
      falseCommits = 0,
    } = {},
  ) {
    const sensorOnMs = { ...this.sensorOnMs };
    for (const sensor of Object.keys(this.sensorStartedAt)) {
      if (Number.isFinite(this.sensorStartedAt[sensor])) {
        sensorOnMs[sensor] += Math.max(0, at - this.sensorStartedAt[sensor]);
      }
    }
    return {
      viewportContract: "390x844 portrait · 844x390 landscape",
      glanceTimeProxyMs: this.glanceTimeProxyMs,
      glanceSamples: this.glanceSamples,
      voiceRepairs,
      falseCommits,
      oneHandTouchFallbacks: this.oneHandTouchFallbacks,
      interruptions: this.interruptions,
      interruptionRecoveries: this.interruptionRecoveries,
      interruptionRecoveryMs: this.interruptionRecoveryMs,
      permissionToValueMs:
        this.startedAt === null || this.firstValueAt === null
          ? null
          : Math.max(0, this.firstValueAt - this.startedAt),
      permissionRequests: { ...this.permissionRequests },
      sensorOnMs: {
        ...sensorOnMs,
        total: sensorOnMs.microphone + sensorOnMs.camera,
      },
      orientationChanges: this.orientationChanges,
      hapticSignals: this.hapticSignals,
    };
  }
}

class MobileFeedback {
  constructor({
    globalObject = globalThis,
    navigatorObject = globalThis.navigator,
    onHaptic = () => {},
  } = {}) {
    this.globalObject = globalObject;
    this.navigatorObject = navigatorObject;
    this.onHaptic = onHaptic;
    this.audioContext = null;
    this.hapticsEnabled = false;
  }

  get hapticsSupported() {
    return typeof this.navigatorObject?.vibrate === "function";
  }

  setHaptics(enabled) {
    this.hapticsEnabled = this.hapticsSupported && enabled === true;
    return this.hapticsEnabled;
  }

  async unlock() {
    const AudioContext =
      this.globalObject?.AudioContext || this.globalObject?.webkitAudioContext;
    if (!this.audioContext && typeof AudioContext === "function") {
      try {
        this.audioContext = new AudioContext();
      } catch {
        this.audioContext = null;
      }
    }
    try {
      await this.audioContext?.resume?.();
    } catch {
      // Captions remain the authoritative feedback path.
    }
  }

  signal(kind = "ready") {
    const frequencies = {
      ready: 520,
      confirm: 660,
      undo: 420,
      stop: 240,
      recover: 580,
      error: 180,
    };
    const frequency = frequencies[kind] || frequencies.ready;
    const context = this.audioContext;
    if (context?.createOscillator && context?.createGain) {
      try {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        const now = context.currentTime;
        oscillator.frequency.value = frequency;
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(0.035, now + 0.008);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.07);
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start(now);
        oscillator.stop(now + 0.075);
      } catch {
        // Captions remain the authoritative feedback path.
      }
    }
    if (this.hapticsEnabled) {
      const pattern = kind === "error" || kind === "stop" ? [20, 35, 20] : 18;
      try {
        if (this.navigatorObject.vibrate(pattern)) {
          this.onHaptic();
        }
      } catch {
        // Haptics are optional and never gate interaction.
      }
    }
  }

  close() {
    try {
      this.navigatorObject?.vibrate?.(0);
      this.audioContext?.close?.();
    } catch {
      // The browser may already have suspended output.
    }
    this.audioContext = null;
  }
}

export {
  MOBILE_LAYOUT_CONTRACT,
  MobileFeedback,
  MobileMetricsTracker,
  mobileLayoutForViewport,
  phoneChoiceWindow,
  radialChoiceGeometry,
  shortSpokenSummary,
};
