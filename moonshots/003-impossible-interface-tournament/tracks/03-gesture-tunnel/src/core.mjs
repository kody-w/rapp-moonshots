export const APP_VERSION = "1.0.0";
export const TASK_ID = "cobalt-beacon-route-v1";
export const OPTION_COUNT = 6;
export const COMMIT_CONFIDENCE = 0.58;
export const GESTURE_CONFIDENCE = 0.68;
export const VOICE_INTENT_CONFIDENCE = 0.55;
export const VOICE_CHOOSE_CONFIDENCE = 0.7;
export const CAMERA_DWELL_MS = 600;
export const COMMIT_COOLDOWN_MS = 500;
export const GESTURE_COOLDOWN_MS = 900;

const option = (id, label, detail, aliases) =>
  Object.freeze({ id, label, detail, aliases: Object.freeze(aliases) });

export const TASK_LAYERS = Object.freeze([
  Object.freeze({
    id: "intent",
    title: "Name the operation",
    prompt: "Say “route”",
    target: "route",
    options: Object.freeze([
      option("route", "Route", "Open a reversible route", ["route", "route beacons"]),
      option("inspect", "Inspect", "Read beacon telemetry", ["inspect", "inspect beacons"]),
      option("hold", "Hold", "Keep cargo staged", ["hold", "hold cargo"]),
      option("recall", "Recall", "Bring a route home", ["recall"]),
      option("relay", "Relay", "Forward a signal", ["relay"]),
      option("archive", "Archive", "Preserve a route record", ["archive"]),
    ]),
  }),
  Object.freeze({
    id: "payload",
    title: "Shape the payload",
    prompt: "Say “three cobalt beacons”",
    target: "cobalt-3",
    options: Object.freeze([
      option("amber-2", "2 amber", "Two amber beacons", [
        "two amber beacons",
        "2 amber beacons",
        "two amber",
        "2 amber",
      ]),
      option("cobalt-3", "3 cobalt", "Three cobalt beacons", [
        "three cobalt beacons",
        "3 cobalt beacons",
        "three cobalt",
        "3 cobalt",
      ]),
      option("cobalt-5", "5 cobalt", "Five cobalt beacons", [
        "five cobalt beacons",
        "5 cobalt beacons",
        "five cobalt",
        "5 cobalt",
      ]),
      option("silver-3", "3 silver", "Three silver beacons", [
        "three silver beacons",
        "3 silver beacons",
        "three silver",
        "3 silver",
      ]),
      option("single-cobalt", "1 cobalt", "One cobalt beacon", [
        "one cobalt beacon",
        "1 cobalt beacon",
        "one cobalt",
        "1 cobalt",
      ]),
      option("all-beacons", "All", "Every staged beacon", ["all beacons", "all"]),
    ]),
  }),
  Object.freeze({
    id: "schedule",
    title: "Set the departure",
    prompt: "Say “fourteen thirty”",
    target: "14:30",
    options: Object.freeze([
      option("13:45", "13:45", "Early window", ["thirteen forty five", "13 45"]),
      option("14:00", "14:00", "Top of the hour", ["fourteen hundred", "14 00"]),
      option("14:30", "14:30", "Requested departure", [
        "fourteen thirty",
        "14 30",
        "two thirty",
      ]),
      option("15:00", "15:00", "Late window", ["fifteen hundred", "15 00", "three o'clock"]),
      option("16:20", "16:20", "Dusk window", ["sixteen twenty", "16 20"]),
      option("on-signal", "On signal", "Wait for an external signal", ["on signal"]),
    ]),
  }),
  Object.freeze({
    id: "handling",
    title: "Mark handling",
    prompt: "Say “fragile”",
    target: "fragile",
    options: Object.freeze([
      option("standard", "Standard", "Routine handling", ["standard"]),
      option("fragile", "Fragile", "Protect from shock", ["fragile", "mark fragile"]),
      option("priority", "Priority", "Move ahead of queue", ["priority"]),
      option("sealed", "Sealed", "Do not open", ["sealed"]),
      option("cold", "Cold", "Maintain cold chain", ["cold"]),
      option("observe", "Observe", "Continuous telemetry", ["observe"]),
    ]),
  }),
  Object.freeze({
    id: "destination",
    title: "Choose the destination",
    prompt: "Say “Orion seven”",
    target: "orion-7",
    options: Object.freeze([
      option("lyra-2", "LYRA-2", "Lyra receiving station", ["lyra two", "lyra 2"]),
      option("orion-4", "ORION-4", "Orion inner station", ["orion four", "orion 4"]),
      option("orion-7", "ORION-7", "Orion seventh station", ["orion seven", "orion 7"]),
      option("vega-1", "VEGA-1", "Vega receiving station", ["vega one", "vega 1"]),
      option("atlas-9", "ATLAS-9", "Atlas ninth station", ["atlas nine", "atlas 9"]),
      option("home-dock", "HOME", "Return to home dock", ["home dock"]),
    ]),
  }),
  Object.freeze({
    id: "gate",
    title: "Open a gate",
    prompt: "Say “North Gate”",
    target: "north-gate",
    options: Object.freeze([
      option("north-gate", "North Gate", "Polar approach corridor", ["north gate", "northern gate"]),
      option("east-gate", "East Gate", "Sunrise approach corridor", ["east gate", "eastern gate"]),
      option("south-gate", "South Gate", "Lower approach corridor", ["south gate", "southern gate"]),
      option("west-gate", "West Gate", "Sunset approach corridor", ["west gate", "western gate"]),
      option("zenith-gate", "Zenith", "High approach corridor", ["zenith", "zenith gate"]),
      option("service-gate", "Service", "Maintenance approach", ["service", "service gate"]),
    ]),
  }),
  Object.freeze({
    id: "review",
    title: "Review the route",
    prompt: "Say “confirm route”, then “choose”",
    target: "confirm-route",
    options: Object.freeze([
      option("hold-review", "Hold", "Keep the draft unsent", ["hold route", "hold review"]),
      option("confirm-route", "Confirm", "Seal this exact route", ["confirm route", "seal route"]),
      option("recheck-time", "Recheck time", "Return to departure", ["recheck time"]),
      option("recheck-cargo", "Recheck cargo", "Return to payload", ["recheck cargo"]),
      option("recheck-gate", "Recheck gate", "Return to gate", ["recheck gate"]),
      option("discard", "Discard", "Cancel the complete draft", ["discard route"]),
    ]),
  }),
  Object.freeze({
    id: "return",
    title: "Return to the anchor",
    prompt: "Say “home”, then “choose”",
    target: "home",
    options: Object.freeze([
      option("linger", "Linger", "Keep the final shell open", ["linger"]),
      option("new-route", "New route", "Begin another draft", ["new route"]),
      option("home", "Home", "Return to the safe center", ["home", "return home"]),
      option("inspect-sent", "Inspect", "Read the sent route", ["inspect sent"]),
      option("export", "Evidence", "Prepare local evidence", ["evidence"]),
      option("sleep", "Sleep", "Dim the tunnel", ["sleep"]),
    ]),
  }),
]);

export const EXPECTED_ROUTE = Object.freeze(TASK_LAYERS.map((layer) => layer.target));

export function clamp(value, minimum = 0, maximum = 1) {
  const number = Number.isFinite(Number(value)) ? Number(value) : minimum;
  return Math.min(maximum, Math.max(minimum, number));
}

export class MediaFrameGate {
  constructor() {
    this.lastPresentedFrames = null;
    this.lastMediaTime = null;
  }

  accept({ presentedFrames, mediaTime } = {}) {
    if (Number.isFinite(presentedFrames)) {
      if (this.lastPresentedFrames !== null && presentedFrames <= this.lastPresentedFrames) {
        return false;
      }
      this.lastPresentedFrames = presentedFrames;
      if (Number.isFinite(mediaTime)) this.lastMediaTime = mediaTime;
      return true;
    }
    if (!Number.isFinite(mediaTime)) return false;
    if (this.lastMediaTime !== null && mediaTime <= this.lastMediaTime) return false;
    this.lastMediaTime = mediaTime;
    return true;
  }
}

export class LifecycleGate {
  constructor() {
    this.generation = 0;
    this.active = false;
  }

  start() {
    this.generation += 1;
    this.active = true;
    return this.generation;
  }

  stop() {
    this.generation += 1;
    this.active = false;
  }

  capture() {
    return this.generation;
  }

  isCurrent(generation) {
    return this.active && generation === this.generation;
  }
}

export function isCameraFrameStale(lastFreshFrameAt, now, thresholdMs = 2500) {
  return (
    Number.isFinite(lastFreshFrameAt) &&
    Number.isFinite(now) &&
    now - lastFreshFrameAt > thresholdMs
  );
}

export function shouldReloadAfterPageShow(event) {
  return event?.persisted === true;
}

export function normalizeSpeechConfidence(value, fallback = 0) {
  return Number.isFinite(value) ? clamp(value) : clamp(fallback);
}

export function allowsMediaCapture({ accessibleMode = false, simulationMode = false } = {}) {
  return !accessibleMode && !simulationMode;
}

const TUNNEL_SHORTCUT_KEYS = new Set([
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "Escape",
  "Enter",
  " ",
  "u",
  "U",
  "r",
  "R",
  "e",
  "E",
]);

export function shouldHandleTunnelShortcut({
  launched = false,
  simulationMode = false,
  targetInTunnel = false,
  nativeInteractive = false,
  key = "",
} = {}) {
  return (
    launched &&
    !simulationMode &&
    targetInTunnel &&
    !nativeInteractive &&
    TUNNEL_SHORTCUT_KEYS.has(key)
  );
}

export function releaseMediaResources(mediaStream, video) {
  let tracks = [];
  try {
    tracks = mediaStream?.getTracks?.() ?? [];
  } catch {
    tracks = [];
  }
  tracks.forEach((track) => {
    try {
      track.stop();
    } catch {
      // Continue releasing every acquired track.
    }
  });
  if (video) video.srcObject = null;
  return tracks.length;
}

export function completionAnnouncement(snapshot, committedLabel = "Tunnel") {
  if (!snapshot?.completed) return `${committedLabel} confirmed.`;
  return snapshot.exact
    ? "Exact route complete. Home."
    : "Route complete, but it does not match the cobalt mission. Say undo to repair it.";
}

export function evidencePresentation(snapshot) {
  if (!snapshot?.completed) {
    return {
      visible: false,
      label: "Evidence locked",
      description: "Complete the route before exporting local replay and metrics.",
    };
  }
  return snapshot.exact
    ? {
        visible: true,
        label: "Exact route sealed",
        description: "Exact replay and metrics were generated locally.",
      }
    : {
        visible: true,
        label: "Route mismatch captured",
        description: "Replay and metrics show a completed route that differs from the mission.",
      };
}

export function shouldRestartRecognition({
  launched = false,
  restartAllowed = false,
  speechPaused = false,
  accessibleMode = false,
  simulationMode = false,
  tearingDown = false,
} = {}) {
  return (
    launched &&
    restartAllowed &&
    !speechPaused &&
    !accessibleMode &&
    !simulationMode &&
    !tearingDown
  );
}

const TERMINAL_SPEECH_ERRORS = new Set([
  "audio-capture",
  "bad-grammar",
  "language-not-supported",
  "not-allowed",
  "phrases-not-supported",
  "service-not-allowed",
]);

export function isTerminalSpeechRecognitionError(error) {
  return TERMINAL_SPEECH_ERRORS.has(String(error ?? ""));
}

export function preservesVoiceRecoveryOnSensorLoss(kind, terminalSpeechFailure = false) {
  return kind === "camera" && !terminalSpeechFailure;
}

export function recognitionBackoffMs(
  failureCount,
  { baseMs = 250, maximumMs = 4000 } = {},
) {
  const safeFailures = Math.max(0, Math.floor(Number(failureCount) || 0));
  const exponent = Math.min(16, Math.max(0, safeFailures - 1));
  return Math.min(maximumMs, baseMs * 2 ** exponent);
}

export function wrapIndex(index, count = OPTION_COUNT) {
  const safeCount = Math.max(1, Math.floor(Number(count) || 1));
  return ((Math.floor(Number(index) || 0) % safeCount) + safeCount) % safeCount;
}

export function normalizeSpeech(text) {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function matchVoiceOption(options, text) {
  const phrase = normalizeSpeech(text);
  if (!phrase || !Array.isArray(options)) return -1;
  const paddedPhrase = ` ${phrase} `;
  const matches = [];

  options.forEach((candidate, index) => {
    candidate.aliases.forEach((rawAlias) => {
      const alias = normalizeSpeech(rawAlias);
      const exact = phrase === alias;
      if (!exact && !paddedPhrase.includes(` ${alias} `)) return;
      matches.push({
        index,
        exact,
        tokens: alias.split(" ").length,
        characters: alias.length,
      });
    });
  });

  matches.sort(
    (left, right) =>
      Number(right.exact) - Number(left.exact) ||
      right.tokens - left.tokens ||
      right.characters - left.characters,
  );
  if (matches.length === 0) return -1;
  const best = matches[0];
  const equallySpecific = matches.filter(
    (match) =>
      match.exact === best.exact &&
      match.tokens === best.tokens,
  );
  return new Set(equallySpecific.map((match) => match.index)).size === 1 ? best.index : -1;
}

export function coarseSector(point, count = OPTION_COUNT, deadzone = 0.16) {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
  const x = clamp(point.x);
  const y = clamp(point.y);
  const dx = x - 0.5;
  const dy = y - 0.5;
  const radius = Math.hypot(dx, dy);
  if (radius < deadzone) return null;
  const slice = (Math.PI * 2) / Math.max(1, count);
  const angleFromTop = Math.atan2(dy, dx) + Math.PI / 2;
  const index = wrapIndex(Math.round(angleFromTop / slice), count);
  return {
    index,
    confidence: clamp((radius - deadzone) / 0.34),
    radius: clamp(radius, 0, Math.SQRT1_2),
  };
}

export function motionCentroid(previous, current, width, height, threshold = 26) {
  const safeWidth = Math.max(1, Math.floor(width));
  const safeHeight = Math.max(1, Math.floor(height));
  const pixels = safeWidth * safeHeight;
  if (!previous || !current || previous.length < pixels || current.length < pixels) {
    return { activePixels: 0, activeRatio: 0, meanDifference: 0, centroid: null };
  }

  let activePixels = 0;
  let sumX = 0;
  let sumY = 0;
  let differenceTotal = 0;
  const safeThreshold = clamp(threshold, 1, 255);

  for (let index = 0; index < pixels; index += 1) {
    const difference = Math.abs(Number(current[index]) - Number(previous[index]));
    differenceTotal += difference;
    if (difference >= safeThreshold) {
      activePixels += 1;
      sumX += index % safeWidth;
      sumY += Math.floor(index / safeWidth);
    }
  }

  return {
    activePixels,
    activeRatio: clamp(activePixels / pixels),
    meanDifference: clamp(differenceTotal / pixels / 255),
    centroid:
      activePixels === 0
        ? null
        : {
            x: clamp(sumX / activePixels / Math.max(1, safeWidth - 1)),
            y: clamp(sumY / activePixels / Math.max(1, safeHeight - 1)),
          },
  };
}

export function classifyMotionGesture(sample = {}) {
  const start = sample.start;
  const end = sample.end;
  const durationMs = Number(sample.durationMs);
  const activeRatio = clamp(sample.activeRatio);
  if (
    !sample.neutralReady ||
    !start ||
    !end ||
    !Number.isFinite(start.x) ||
    !Number.isFinite(start.y) ||
    !Number.isFinite(end.x) ||
    !Number.isFinite(end.y) ||
    durationMs < 120 ||
    durationMs > 950 ||
    activeRatio < 0.018 ||
    activeRatio > 0.55
  ) {
    return null;
  }

  const dx = clamp(end.x) - clamp(start.x);
  const dy = clamp(end.y) - clamp(start.y);
  const distance = Math.hypot(dx, dy);
  if (distance < 0.22) return null;

  const durationQuality = 1 - Math.abs(durationMs - 420) / 1000;
  const motionQuality = 1 - Math.abs(activeRatio - 0.12) / 0.43;
  const confidence = clamp(
    ((distance - 0.16) / 0.34) * clamp(durationQuality, 0.72, 1) * clamp(motionQuality, 0.35, 1),
  );
  if (confidence < GESTURE_CONFIDENCE) return null;

  let type = null;
  if (Math.abs(dx) > Math.abs(dy) * 1.2) {
    type = dx > 0 ? "rotate-right" : "rotate-left";
  } else if (Math.abs(dy) > Math.abs(dx) * 1.12) {
    type = dy > 0 ? "enter" : "back";
  }
  return type ? { type, confidence, dx, dy, durationMs, activeRatio } : null;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createMetrics() {
  return {
    schemaVersion: 1,
    taskId: TASK_ID,
    startedAtMs: null,
    completedAtMs: null,
    completionMs: null,
    neutralCalibrationMs: null,
    exactTaskCompletion: false,
    commits: 0,
    falseCommits: 0,
    blockedCommits: 0,
    undos: 0,
    cancellations: 0,
    previews: 0,
    dwellCancellations: 0,
    voiceRepairs: 0,
    gesturesAccepted: 0,
    gesturesRejected: 0,
    fallbackUses: 0,
    voiceCommands: 0,
    confirmationSources: { voice: 0, switch: 0, simulation: 0, other: 0 },
    sensorLosses: { camera: 0, microphone: 0, unknown: 0 },
    sensorRecoveryMs: 0,
    sensorOnMs: { camera: 0, microphone: 0 },
    rawFramesStored: 0,
    audioStored: 0,
    networkRequestsByApp: 0,
  };
}

export class TunnelEngine {
  constructor({ clock = () => performance.now(), sessionId = "gesture-tunnel-live" } = {}) {
    this.clock = clock;
    this.sessionId = sessionId;
    this.replay = [];
    this.metrics = createMetrics();
    this.sensorActiveSince = { camera: null, microphone: null };
    this.lastEventAt = 0;
    this.state = {
      depth: 0,
      selections: [],
      preview: null,
      armed: false,
      frozen: false,
      freezeCauses: [],
      completed: false,
      exact: false,
      lastCommitAt: Number.NEGATIVE_INFINITY,
      lastGestureAt: Number.NEGATIVE_INFINITY,
      sensorLostAt: { camera: null, microphone: null, unknown: null },
    };
  }

  at(value) {
    return Number.isFinite(value) ? value : Math.round(this.clock());
  }

  start(at) {
    const timestamp = this.at(at);
    if (this.metrics.startedAtMs === null) this.metrics.startedAtMs = timestamp;
    this.record("session-start", {}, timestamp);
    return this.snapshot();
  }

  currentLayer() {
    return TASK_LAYERS[this.state.depth] ?? null;
  }

  record(type, payload = {}, at) {
    const timestamp = this.at(at);
    this.lastEventAt = Math.max(this.lastEventAt, timestamp);
    this.replay.push({
      sequence: this.replay.length,
      atMs: timestamp,
      type,
      depth: this.state.depth,
      ...clone(payload),
    });
  }

  snapshot() {
    const layer = this.currentLayer();
    return clone({
      depth: this.state.depth,
      layerId: layer?.id ?? "complete",
      selections: this.state.selections,
      preview: this.state.preview,
      armed: this.state.armed,
      frozen: this.state.frozen,
      freezeCauses: this.state.freezeCauses,
      completed: this.state.completed,
      exact: this.state.exact,
    });
  }

  previewOption(index, { source = "voice", confidence = 1, at } = {}) {
    const timestamp = this.at(at);
    const layer = this.currentLayer();
    if (!layer || this.state.frozen) {
      this.record(
        "preview-blocked",
        { source, reason: this.state.freezeCauses.join("+") || "complete" },
        timestamp,
      );
      return false;
    }
    const safeIndex = wrapIndex(index, layer.options.length);
    const safeConfidence = clamp(confidence);
    const previous = this.state.preview;
    if (
      previous &&
      previous.index !== safeIndex &&
      previous.source.includes("camera") &&
      timestamp - previous.sinceMs < CAMERA_DWELL_MS
    ) {
      this.metrics.dwellCancellations += 1;
    }
    const preserveSince =
      previous && previous.index === safeIndex && previous.source === source
        ? previous.sinceMs
        : timestamp;
    this.state.preview = {
      index: safeIndex,
      optionId: layer.options[safeIndex].id,
      source,
      confidence: safeConfidence,
      sinceMs: preserveSince,
    };
    this.state.armed = false;
    this.metrics.previews += 1;
    this.record(
      "preview",
      { optionId: layer.options[safeIndex].id, source, confidence: safeConfidence },
      timestamp,
    );
    return true;
  }

  rotate(delta, { source = "gesture", confidence = 1, at } = {}) {
    const layer = this.currentLayer();
    if (!layer) return false;
    const current = this.state.preview?.index ?? 0;
    return this.previewOption(current + Math.sign(delta || 1), { source, confidence, at });
  }

  arm({ source = "gesture", confidence = 1, at } = {}) {
    const timestamp = this.at(at);
    const safeConfidence = clamp(confidence);
    if (
      this.state.frozen ||
      !this.state.preview ||
      safeConfidence < GESTURE_CONFIDENCE
    ) {
      this.record("arm-blocked", { source, confidence: safeConfidence }, timestamp);
      return false;
    }
    this.state.armed = true;
    this.record("armed", { optionId: this.state.preview.optionId, source, confidence: safeConfidence }, timestamp);
    return true;
  }

  handleGesture(type, { confidence = 1, neutral = false, at } = {}) {
    const timestamp = this.at(at);
    const safeConfidence = clamp(confidence);
    if (
      this.state.frozen ||
      !neutral ||
      safeConfidence < GESTURE_CONFIDENCE ||
      timestamp - this.state.lastGestureAt < GESTURE_COOLDOWN_MS
    ) {
      this.metrics.gesturesRejected += 1;
      this.record("gesture-rejected", { gesture: type, confidence: safeConfidence, neutral }, timestamp);
      return false;
    }

    this.state.lastGestureAt = timestamp;
    this.metrics.gesturesAccepted += 1;
    this.record("gesture", { gesture: type, confidence: safeConfidence }, timestamp);
    if (type === "rotate-left") return this.rotate(-1, { source: "camera-motion", confidence: safeConfidence, at: timestamp });
    if (type === "rotate-right") return this.rotate(1, { source: "camera-motion", confidence: safeConfidence, at: timestamp });
    if (type === "enter") return this.arm({ source: "camera-motion", confidence: safeConfidence, at: timestamp });
    if (type === "back") return this.undo({ source: "camera-motion", at: timestamp });
    return false;
  }

  choose({ source = "voice", at } = {}) {
    const timestamp = this.at(at);
    const preview = this.state.preview;
    const cameraDwellSatisfied =
      !preview?.source.includes("camera") || timestamp - preview.sinceMs >= CAMERA_DWELL_MS;
    if (
      this.state.frozen ||
      !preview ||
      preview.confidence < COMMIT_CONFIDENCE ||
      !cameraDwellSatisfied ||
      timestamp - this.state.lastCommitAt < COMMIT_COOLDOWN_MS
    ) {
      this.metrics.blockedCommits += 1;
      this.record(
        "commit-blocked",
        {
          source,
          reason: this.state.frozen
            ? "frozen"
            : !preview
              ? "no-preview"
              : !cameraDwellSatisfied
                ? "dwell"
                : preview.confidence < COMMIT_CONFIDENCE
                  ? "confidence"
                  : "cooldown",
        },
        timestamp,
      );
      return false;
    }

    const layer = this.currentLayer();
    const selected = layer.options[preview.index];
    const expected = selected.id === layer.target;
    this.state.selections.push({
      depth: this.state.depth,
      layerId: layer.id,
      optionId: selected.id,
      label: selected.label,
      expected,
      source,
      atMs: timestamp,
    });
    this.metrics.commits += 1;
    const confirmationSource = Object.hasOwn(this.metrics.confirmationSources, source)
      ? source
      : "other";
    this.metrics.confirmationSources[confirmationSource] += 1;
    if (!expected) this.metrics.falseCommits += 1;
    this.record("commit", { layerId: layer.id, optionId: selected.id, expected, source }, timestamp);
    this.state.depth += 1;
    this.state.preview = null;
    this.state.armed = false;
    this.state.lastCommitAt = timestamp;

    if (this.state.depth >= TASK_LAYERS.length) {
      this.state.completed = true;
      this.state.exact =
        this.state.selections.length === EXPECTED_ROUTE.length &&
        this.state.selections.every((selection, index) => selection.optionId === EXPECTED_ROUTE[index]);
      this.metrics.completedAtMs = timestamp;
      this.metrics.completionMs =
        this.metrics.startedAtMs === null ? null : timestamp - this.metrics.startedAtMs;
      this.metrics.exactTaskCompletion = this.state.exact;
      this.record("task-complete", { exact: this.state.exact }, timestamp);
    }
    return true;
  }

  cancel({ source = "voice", at } = {}) {
    const timestamp = this.at(at);
    const hadPending = Boolean(this.state.preview || this.state.armed);
    this.state.preview = null;
    this.state.armed = false;
    this.metrics.cancellations += 1;
    this.record("cancel", { source, hadPending }, timestamp);
    return hadPending;
  }

  centerRest({ source = "camera-center-rest", at } = {}) {
    const timestamp = this.at(at);
    const preview = this.state.preview;
    if (!preview?.source.includes("camera")) return false;
    if (timestamp - preview.sinceMs < CAMERA_DWELL_MS) {
      this.metrics.dwellCancellations += 1;
    }
    this.state.preview = null;
    this.state.armed = false;
    this.metrics.cancellations += 1;
    this.record("center-rest", { source }, timestamp);
    return true;
  }

  undo({ source = "voice", at } = {}) {
    const timestamp = this.at(at);
    if (this.state.frozen || this.state.selections.length === 0) {
      this.record(
        "undo-blocked",
        { source, reason: this.state.freezeCauses.join("+") || "at-root" },
        timestamp,
      );
      return false;
    }
    const removed = this.state.selections.pop();
    this.state.depth = this.state.selections.length;
    this.state.preview = null;
    this.state.armed = false;
    this.state.completed = false;
    this.state.exact = false;
    this.metrics.undos += 1;
    this.metrics.completedAtMs = null;
    this.metrics.completionMs = null;
    this.metrics.exactTaskCompletion = false;
    this.record("undo", { source, removedOptionId: removed.optionId }, timestamp);
    return true;
  }

  sensorLost(kind = "unknown", at) {
    const timestamp = this.at(at);
    const safeKind = Object.hasOwn(this.metrics.sensorLosses, kind) ? kind : "unknown";
    const cause = `${safeKind}-lost`;
    this.closeSensorWindow(safeKind, timestamp);
    if (!this.state.freezeCauses.includes(cause)) {
      this.state.freezeCauses.push(cause);
      this.state.sensorLostAt[safeKind] = timestamp;
      this.metrics.sensorLosses[safeKind] += 1;
    }
    this.syncFrozen();
    this.state.preview = null;
    this.state.armed = false;
    this.record(
      "sensor-lost",
      { sensor: safeKind, freezeCauses: this.state.freezeCauses },
      timestamp,
    );
  }

  sensorRecovered(kind = "unknown", at) {
    const timestamp = this.at(at);
    const safeKind = Object.hasOwn(this.state.sensorLostAt, kind) ? kind : "unknown";
    const lostAt = this.state.sensorLostAt[safeKind];
    if (lostAt !== null) {
      this.metrics.sensorRecoveryMs += Math.max(0, timestamp - lostAt);
    }
    this.state.sensorLostAt[safeKind] = null;
    this.removeFreezeCause(`${safeKind}-lost`);
    this.state.preview = null;
    this.state.armed = false;
    if (
      Object.hasOwn(this.sensorActiveSince, safeKind) &&
      this.sensorActiveSince[safeKind] === null
    ) {
      this.sensorActiveSince[safeKind] = timestamp;
    }
    this.record(
      "sensor-recovered",
      { sensor: safeKind, freezeCauses: this.state.freezeCauses },
      timestamp,
    );
  }

  syncFrozen() {
    this.state.frozen = this.state.freezeCauses.length > 0;
  }

  addFreezeCause(cause) {
    if (!this.state.freezeCauses.includes(cause)) this.state.freezeCauses.push(cause);
    this.syncFrozen();
  }

  removeFreezeCause(cause) {
    this.state.freezeCauses = this.state.freezeCauses.filter((candidate) => candidate !== cause);
    this.syncFrozen();
  }

  closeSensorWindow(kind, at) {
    if (!Object.hasOwn(this.sensorActiveSince, kind)) return;
    const startedAt = this.sensorActiveSince[kind];
    if (startedAt !== null) {
      this.metrics.sensorOnMs[kind] += Math.max(0, at - startedAt);
      this.sensorActiveSince[kind] = null;
    }
  }

  sensorStarted(kind, at) {
    const timestamp = this.at(at);
    if (!Object.hasOwn(this.sensorActiveSince, kind)) return false;
    if (this.sensorActiveSince[kind] === null) this.sensorActiveSince[kind] = timestamp;
    this.record("sensor-started", { sensor: kind }, timestamp);
    return true;
  }

  sensorStopped(kind, at) {
    const timestamp = this.at(at);
    if (!Object.hasOwn(this.sensorActiveSince, kind)) return false;
    this.closeSensorWindow(kind, timestamp);
    this.record("sensor-stopped", { sensor: kind }, timestamp);
    return true;
  }

  noteNeutralReady(at) {
    const timestamp = this.at(at);
    if (this.metrics.neutralCalibrationMs === null) {
      this.metrics.neutralCalibrationMs =
        this.metrics.startedAtMs === null ? 0 : Math.max(0, timestamp - this.metrics.startedAtMs);
      this.record("neutral-ready", { calibrationMs: this.metrics.neutralCalibrationMs }, timestamp);
    }
  }

  stop(at) {
    const timestamp = this.at(at);
    this.addFreezeCause("user-stop");
    this.state.preview = null;
    this.state.armed = false;
    this.record("stop", { freezeCauses: this.state.freezeCauses }, timestamp);
  }

  resume(at) {
    const timestamp = this.at(at);
    if (!this.state.freezeCauses.includes("user-stop")) return false;
    this.removeFreezeCause("user-stop");
    this.record("resume", { freezeCauses: this.state.freezeCauses }, timestamp);
    return true;
  }

  noteFallback(at) {
    this.metrics.fallbackUses += 1;
    this.record("fallback", {}, this.at(at));
  }

  voice(text, { confidence, at } = {}) {
    const timestamp = this.at(at);
    const phrase = normalizeSpeech(text);
    const safeConfidence = normalizeSpeechConfidence(confidence);
    const source = "voice";
    this.metrics.voiceCommands += 1;
    this.record("voice-input", { confidence: safeConfidence }, timestamp);

    if (/\bstop\b/.test(phrase)) {
      this.stop(timestamp);
      return { command: "stop", accepted: true };
    }
    if (/\bresume\b/.test(phrase)) {
      return { command: "resume", accepted: this.resume(timestamp) };
    }
    if (/\brecover\b/.test(phrase)) {
      return { command: "recover", accepted: false };
    }
    if (/\b(cancel|never mind)\b/.test(phrase)) {
      return { command: "cancel", accepted: this.cancel({ source, at: timestamp }) };
    }
    if (/\b(undo|go back|back up)\b/.test(phrase)) {
      return { command: "undo", accepted: this.undo({ source, at: timestamp }) };
    }
    if (/\b(choose|select this)\b/.test(phrase)) {
      if (safeConfidence < VOICE_CHOOSE_CONFIDENCE) {
        this.metrics.blockedCommits += 1;
        this.record(
          "commit-blocked",
          { source, reason: "voice-confidence", confidence: safeConfidence },
          timestamp,
        );
        return { command: "choose", accepted: false };
      }
      return { command: "choose", accepted: this.choose({ source, at: timestamp }) };
    }

    const layer = this.currentLayer();
    if (!layer || this.state.frozen || safeConfidence < VOICE_INTENT_CONFIDENCE) {
      this.metrics.voiceRepairs += 1;
      if (safeConfidence < VOICE_INTENT_CONFIDENCE) {
        this.record("voice-repair", { reason: "confidence" }, timestamp);
      }
      return { command: "intent", accepted: false };
    }
    const index = matchVoiceOption(layer.options, phrase);
    if (index < 0) {
      this.metrics.voiceRepairs += 1;
      this.record("voice-repair", { reason: "unmatched" }, timestamp);
      return { command: "intent", accepted: false };
    }
    const accepted = this.previewOption(index, {
      source,
      confidence: Math.max(COMMIT_CONFIDENCE, safeConfidence),
      at: timestamp,
    });
    return { command: "intent", accepted, index };
  }

  exportMetrics() {
    const endAt =
      this.metrics.completedAtMs ??
      Math.max(this.lastEventAt, Number.isFinite(this.clock()) ? Math.round(this.clock()) : this.lastEventAt);
    const sensorOnMs = clone(this.metrics.sensorOnMs);
    for (const [kind, startedAt] of Object.entries(this.sensorActiveSince)) {
      if (startedAt !== null) sensorOnMs[kind] += Math.max(0, endAt - startedAt);
    }
    return clone({
      ...this.metrics,
      sensorOnMs,
      sessionId: this.sessionId,
      finalDepth: this.state.depth,
      recoveredFromSensorLoss:
        Object.values(this.metrics.sensorLosses).some((count) => count > 0) &&
        this.metrics.sensorRecoveryMs > 0,
    });
  }

  exportReplay() {
    return clone({
      schemaVersion: 1,
      appVersion: APP_VERSION,
      taskId: TASK_ID,
      sessionId: this.sessionId,
      expectedRoute: EXPECTED_ROUTE,
      replay: this.replay,
      finalState: this.snapshot(),
    });
  }
}

export const DETERMINISTIC_ACTIONS = Object.freeze([
  Object.freeze({ at: 0, type: "start", caption: "Simulation begins at the safe center" }),
  Object.freeze({ at: 0, type: "sensor-started", sensor: "camera", caption: "Ephemeral camera clock begins" }),
  Object.freeze({ at: 0, type: "sensor-started", sensor: "microphone", caption: "Browser voice clock begins" }),
  Object.freeze({ at: 100, type: "neutral-ready", caption: "Neutral gate calibrated" }),
  Object.freeze({ at: 200, type: "voice", text: "route", caption: "Voice names Route" }),
  Object.freeze({ at: 850, type: "voice", text: "choose", caption: "Choose confirms Route" }),
  Object.freeze({ at: 1450, type: "voice", text: "three cobalt beacons", caption: "Three cobalt beacons" }),
  Object.freeze({ at: 2100, type: "voice", text: "choose", caption: "Payload confirmed" }),
  Object.freeze({ at: 2700, type: "voice", text: "fifteen hundred", caption: "Intentional wrong tunnel: 15:00" }),
  Object.freeze({ at: 3350, type: "voice", text: "choose", caption: "Wrong tunnel intentionally committed" }),
  Object.freeze({ at: 3900, type: "voice", text: "undo", caption: "Undo restores the schedule shell" }),
  Object.freeze({ at: 4400, type: "sensor-stopped", sensor: "camera", caption: "Runtime camera track stops" }),
  Object.freeze({ at: 4400, type: "sensor-stopped", sensor: "microphone", caption: "Runtime microphone track stops with the stream" }),
  Object.freeze({ at: 4400, type: "sensor-lost", sensor: "camera", caption: "Camera loss freezes every layer" }),
  Object.freeze({ at: 4650, type: "voice", text: "fourteen thirty", caption: "Input is safely blocked while frozen" }),
  Object.freeze({ at: 4850, type: "voice", text: "choose", caption: "Choose is rejected while the camera is lost" }),
  Object.freeze({ at: 5300, type: "sensor-started", sensor: "camera", caption: "Recovered camera track starts" }),
  Object.freeze({ at: 5300, type: "sensor-started", sensor: "microphone", caption: "Recovered microphone track starts" }),
  Object.freeze({ at: 5300, type: "sensor-recovered", sensor: "camera", caption: "Camera recovered; pending input stays canceled" }),
  Object.freeze({ at: 5300, type: "sensor-recovered", sensor: "microphone", caption: "Microphone lifecycle matches runtime recovery" }),
  Object.freeze({ at: 5550, type: "voice", text: "fourteen thirty", caption: "Correct schedule previewed" }),
  Object.freeze({ at: 6200, type: "voice", text: "choose", caption: "14:30 confirmed" }),
  Object.freeze({ at: 6800, type: "voice", text: "fragile", caption: "Fragile handling" }),
  Object.freeze({ at: 7450, type: "voice", text: "choose", caption: "Handling confirmed" }),
  Object.freeze({ at: 8050, type: "voice", text: "orion seven", caption: "ORION-7 destination" }),
  Object.freeze({ at: 8700, type: "voice", text: "choose", caption: "Destination confirmed" }),
  Object.freeze({ at: 9300, type: "voice", text: "north gate", caption: "North Gate" }),
  Object.freeze({ at: 9950, type: "voice", text: "choose", caption: "Gate confirmed" }),
  Object.freeze({ at: 10550, type: "voice", text: "confirm route", caption: "Exact route reviewed" }),
  Object.freeze({ at: 11200, type: "voice", text: "choose", caption: "Route sent" }),
  Object.freeze({ at: 11800, type: "voice", text: "home", caption: "Return tunnel named" }),
  Object.freeze({ at: 12450, type: "voice", text: "choose", caption: "Home reached; evidence sealed" }),
]);

export function applyDeterministicAction(engine, action) {
  switch (action.type) {
    case "start":
      engine.start(action.at);
      break;
    case "voice":
      engine.voice(action.text, { confidence: 0.96, at: action.at });
      break;
    case "sensor-lost":
      engine.sensorLost(action.sensor, action.at);
      break;
    case "sensor-recovered":
      engine.sensorRecovered(action.sensor, action.at);
      break;
    case "sensor-started":
      engine.sensorStarted(action.sensor, action.at);
      break;
    case "sensor-stopped":
      engine.sensorStopped(action.sensor, action.at);
      break;
    case "neutral-ready":
      engine.noteNeutralReady(action.at);
      break;
    default:
      throw new Error(`Unknown deterministic action: ${action.type}`);
  }
  return engine.snapshot();
}

export function runDeterministicSimulation() {
  const engine = new TunnelEngine({
    clock: () => 0,
    sessionId: "gesture-tunnel-deterministic-v1",
  });
  DETERMINISTIC_ACTIONS.forEach((action) => applyDeterministicAction(engine, action));
  return {
    state: engine.snapshot(),
    metrics: engine.exportMetrics(),
    replay: engine.exportReplay(),
  };
}
