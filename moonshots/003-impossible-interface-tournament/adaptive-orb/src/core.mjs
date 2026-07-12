const MODE_NAMES = Object.freeze(["orbit", "compass", "tunnel"]);
const EXPECTED_DETERMINISTIC_FINGERPRINT = "c1b6e39f";
const REPLAY_AUTHORITY = Symbol("adaptive-orb-deterministic-replay");
const SENSOR_FREE_AUTHORITY = Symbol("adaptive-orb-sensors-stopped");
const DWELL_TARGET_MS = Object.freeze({
  orbit: 700,
  compass: 800,
  tunnel: 700,
});

const EXPECTED_TASK = Object.freeze({
  action: "route",
  quantity: 3,
  color: "cobalt",
  time: "14:30",
  handling: "fragile",
  destination: "ORION-7",
  gate: "North Gate",
  confirmed: true,
  returnedHome: true,
});

function createTask() {
  return {
    action: null,
    quantity: null,
    color: null,
    time: null,
    handling: null,
    destination: null,
    gate: null,
    confirmed: false,
    returnedHome: false,
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeSpeech(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[–—]/g, "-")
    .replace(/[^a-z0-9:\-\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasWord(text, word) {
  return new RegExp(`(?:^|\\s)${word}(?:\\s|$)`).test(text);
}

function parseBroadIntent(text) {
  const normalized = normalizeSpeech(text);
  const parsed = {};

  if (hasWord(normalized, "route") || hasWord(normalized, "send")) {
    parsed.action = "route";
  }

  const quantityWords = {
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
  };
  const quantityMatch = normalized.match(/\b([1-6]|one|two|three|four|five|six)\b/);
  if (quantityMatch) {
    parsed.quantity = Number(quantityMatch[1]) || quantityWords[quantityMatch[1]];
  }

  if (hasWord(normalized, "cobalt")) {
    parsed.color = "cobalt";
  } else if (hasWord(normalized, "amber")) {
    parsed.color = "amber";
  } else if (hasWord(normalized, "silver")) {
    parsed.color = "silver";
  }

  if (/\b14:30\b/.test(normalized) || /\b2:30\s*(?:pm|p m)\b/.test(normalized)) {
    parsed.time = "14:30";
  } else {
    const timeMatch = normalized.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
    if (timeMatch) {
      parsed.time = `${timeMatch[1].padStart(2, "0")}:${timeMatch[2]}`;
    }
  }

  const handlingMentioned =
    /\bfragile\b/.test(normalized) ||
    /\bdelicate\b/.test(normalized) ||
    /\bhandle(?:d|ing)? with care\b/.test(normalized);
  if (handlingMentioned) {
    const negated =
      /\b(?:not|never)\s+(?:mark(?:ed)?\s+)?(?:as\s+)?(?:fragile|delicate)\b/.test(
        normalized,
      ) ||
      /\bdo not\s+(?:mark(?: them)?(?: as)?\s+)?(?:fragile|delicate)\b/.test(
        normalized,
      ) ||
      /\b(?:do not|not)\s+handle(?:d|ing)? with care\b/.test(normalized);
    parsed.handling = negated ? "standard" : "fragile";
  }

  return parsed;
}

function broadIntentComplete(task) {
  return (
    task.action === "route" &&
    Number.isInteger(task.quantity) &&
    Boolean(task.color) &&
    Boolean(task.time) &&
    Boolean(task.handling)
  );
}

function taskMatchesExpected(task) {
  return Object.entries(EXPECTED_TASK).every(([key, value]) => task[key] === value);
}

function taskFieldsMatch(task) {
  return Object.entries(EXPECTED_TASK)
    .filter(([key]) => key !== "confirmed" && key !== "returnedHome")
    .every(([key, value]) => task[key] === value);
}

function option(id, label, detail, effect, aliases = [], extra = {}) {
  return { id, label, detail, effect, aliases, ...extra };
}

function optionsForState(state) {
  if (state.stage === "intent") {
    if (state.broadReady) {
      return [
        option(
          "accept-intent",
          "Use this intent",
          `${state.task.quantity} ${state.task.color} · ${state.task.time} · ${state.task.handling}`,
          "accept-broad",
          ["use this intent", "accept intent"],
        ),
        option("repair-time", "Change time", "Speak a replacement time", "prompt"),
        option(
          "repair-handling",
          "Change handling",
          "Speak fragile or standard",
          "prompt",
        ),
        option("start-over", "Start over", "Clear the draft", "reset-draft"),
        option("privacy", "Privacy boundary", "Show sensor disclosure", "privacy"),
      ];
    }
    if (state.entryStep === "quantity") {
      return [1, 2, 3, 4, 5].map((value) =>
        option(
          `entry-quantity-${value}`,
          `${value} ${value === 1 ? "beacon" : "beacons"}`,
          "Semantic quantity value",
          "entry-quantity",
          [String(value)],
          { value },
        ),
      );
    }
    if (state.entryStep === "color") {
      return [
        option("entry-color-cobalt", "Cobalt", "Tournament load", "entry-color", ["cobalt"], {
          value: "cobalt",
        }),
        option("entry-color-amber", "Amber", "Alternate load", "entry-color", ["amber"], {
          value: "amber",
        }),
        option("entry-color-silver", "Silver", "Alternate load", "entry-color", ["silver"], {
          value: "silver",
        }),
        option("entry-color-white", "White", "Alternate load", "entry-color", ["white"], {
          value: "white",
        }),
      ];
    }
    if (state.entryStep === "time") {
      return [
        option("entry-time-1430", "14:30", "Tournament schedule", "entry-time", ["14:30"], {
          value: "14:30",
        }),
        option("entry-time-1200", "12:00", "Alternate schedule", "entry-time", ["12:00"], {
          value: "12:00",
        }),
        option("entry-time-1500", "15:00", "Alternate schedule", "entry-time", ["15:00"], {
          value: "15:00",
        }),
        option("entry-time-1630", "16:30", "Alternate schedule", "entry-time", ["16:30"], {
          value: "16:30",
        }),
      ];
    }
    if (state.entryStep === "handling") {
      return [
        option(
          "entry-handling-fragile",
          "Fragile",
          "Handle with care",
          "entry-handling",
          ["fragile"],
          { value: "fragile" },
        ),
        option(
          "entry-handling-standard",
          "Standard",
          "Normal handling",
          "entry-handling",
          ["standard"],
          { value: "standard" },
        ),
        option(
          "entry-handling-chilled",
          "Chilled",
          "Temperature handling",
          "entry-handling",
          ["chilled"],
          { value: "chilled" },
        ),
        option(
          "entry-handling-priority",
          "Priority",
          "Expedited handling",
          "entry-handling",
          ["priority"],
          { value: "priority" },
        ),
      ];
    }
    return [
      option(
        "route-beacons",
        "Route beacons",
        "Begin semantic quantity, color, time, and handling entry",
        "entry-action",
        ["route beacons"],
      ),
      option("schedule-load", "Schedule a load", "Describe a future route", "prompt"),
      option("inspect-route", "Inspect a route", "No route is active yet", "prompt"),
      option("privacy", "Privacy boundary", "Review local sensing", "privacy"),
      option(
        "sensor-free",
        "Sensor-free access",
        "Keyboard, touch, or switch",
        "access",
        ["sensor free", "sensor-free", "accessible mode"],
      ),
    ];
  }

  if (state.stage === "destination") {
    return [
      option(
        "destination-orion",
        "ORION-7",
        "Recommended for cobalt",
        "destination",
        ["orion 7", "orion seven", "orion-7"],
        { value: "ORION-7" },
      ),
      option(
        "destination-luna",
        "LUNA-3",
        "Lunar transfer",
        "destination",
        ["luna 3", "luna three", "luna-3"],
        { value: "LUNA-3" },
      ),
      option(
        "destination-atlas",
        "ATLAS-2",
        "Heavy logistics",
        "destination",
        ["atlas 2", "atlas two", "atlas-2"],
        { value: "ATLAS-2" },
      ),
      option(
        "destination-polaris",
        "POLARIS-4",
        "Polar relay",
        "destination",
        ["polaris 4", "polaris four", "polaris-4"],
        { value: "POLARIS-4" },
      ),
      option("destination-help", "Repeat choices", "Hear all destinations", "prompt"),
    ];
  }

  if (state.stage === "gate") {
    return [
      option(
        "gate-north",
        "North Gate",
        "Cold-chain lane",
        "gate",
        ["north", "north gate"],
        { value: "North Gate" },
      ),
      option(
        "gate-east",
        "East Gate",
        "Express lane",
        "gate",
        ["east", "east gate"],
        { value: "East Gate" },
      ),
      option(
        "gate-south",
        "South Gate",
        "General lane",
        "gate",
        ["south", "south gate"],
        { value: "South Gate" },
      ),
      option(
        "gate-west",
        "West Gate",
        "Bulk lane",
        "gate",
        ["west", "west gate"],
        { value: "West Gate" },
      ),
      option("gate-help", "Repeat choices", "Hear all gates", "prompt"),
    ];
  }

  if (state.stage === "review" && state.tunnelPath[0] === "amend") {
    return [
      option("amend-time", "Schedule", "Tunnel to time amendment", "branch"),
      option("amend-handling", "Handling", "Tunnel to handling amendment", "branch"),
      option(
        "amend-destination",
        "Destination",
        "Tunnel to destination amendment",
        "branch",
      ),
      option("amend-gate", "Gate", "Tunnel to gate amendment", "branch"),
      option("back-review", "Back to review", "Leave this branch", "back"),
    ];
  }

  if (state.stage === "review" && state.tunnelPath[0] === "inspect") {
    return [
      option("inspect-load", "Load", "3 cobalt beacons", "prompt"),
      option("inspect-time", "Schedule", "14:30", "prompt"),
      option("inspect-path", "Path", "ORION-7 · North Gate", "prompt"),
      option("inspect-safety", "Handling", "Fragile", "prompt"),
      option("back-review", "Back to review", "Leave this branch", "back"),
    ];
  }

  if (state.stage === "review") {
    return [
      option(
        "inspect-manifest",
        "Inspect manifest",
        "Open a read-only tunnel",
        "branch-inspect",
        ["inspect manifest"],
      ),
      option(
        "amend-route",
        "Amend route",
        "Open the edit hierarchy",
        "branch-amend",
        ["amend route", "edit route"],
        { intentionalWrong: true },
      ),
      option(
        "safety-check",
        "Safety check",
        "Everything remains reversible",
        "prompt",
      ),
      option(
        "confirm-route",
        "Confirm route",
        "Hold locally; no external dispatch",
        "confirm-route",
        ["confirm route", "send route"],
      ),
      option(
        "cancel-draft",
        "Cancel draft",
        "Reversible; undo restores it",
        "cancel-draft",
      ),
    ];
  }

  if (state.stage === "home") {
    return [
      option(
        "return-home",
        "Return home",
        "Complete the local task",
        "return-home",
        ["return home", "home"],
      ),
      option("review-receipt", "Review receipt", "Read-only local summary", "prompt"),
      option("undo-confirm", "Undo confirmation", "Voice undo is also available", "undo"),
      option("export-record", "Export metrics", "Download privacy-safe JSON", "export"),
    ];
  }

  return [
    option("completed", "Exact task complete", "No external action was sent", "prompt"),
    option("undo-home", "Undo home", "Return to the previous reversible step", "undo"),
    option("export-record", "Export metrics", "Download privacy-safe JSON", "export"),
    option("new-route", "New local route", "Starts only after confirmation", "prompt"),
  ];
}

function choiceShapeForState(state) {
  const options = optionsForState(state);
  if (state.stage === "intent") {
    return { breadth: options.length, stable: false, depth: 0, hierarchical: false };
  }
  if (state.stage === "destination" || state.stage === "gate") {
    return { breadth: options.length, stable: true, depth: 1, hierarchical: false };
  }
  return {
    breadth: options.length,
    stable: false,
    depth: 3 + state.tunnelPath.length,
    hierarchical: true,
  };
}

function chooseModeForShape({ breadth, stable, depth, hierarchical }) {
  if (hierarchical || depth >= 2) {
    return "tunnel";
  }
  if (stable && breadth >= 4 && breadth <= 8) {
    return "compass";
  }
  return "orbit";
}

function recommendedMode(state) {
  return chooseModeForShape(choiceShapeForState(state));
}

function initialMetrics() {
  return {
    elapsedMs: 0,
    completionTimeMs: null,
    errors: 0,
    falseCommits: 0,
    gazeCommitAttempts: 0,
    centerCancels: 0,
    voiceRepairs: 0,
    blockedActions: 0,
    commits: 0,
    undos: 0,
    cancels: 0,
    intentionalWrongBranches: 0,
    sensorLosses: 0,
    sensorRecoveries: 0,
    sensorRecoveryMs: 0,
    delayedSensorRejections: 0,
    modeTransitions: [],
    confirmationSources: {
      voice: 0,
      gesture: 0,
      keyboard: 0,
      touch: 0,
      switch: 0,
      other: 0,
    },
    perMode: {
      orbit: { activeMs: 0, dwellMs: 0, confirmations: 0, transitionsIn: 1 },
      compass: { activeMs: 0, dwellMs: 0, confirmations: 0, transitionsIn: 0 },
      tunnel: { activeMs: 0, dwellMs: 0, confirmations: 0, transitionsIn: 0 },
    },
  };
}

function initialSensors() {
  return {
    generation: 0,
    camera: "off",
    microphone: "off",
    speech: "off",
    estimator: "off",
    estimatorLabel: "not started",
    frameAt: null,
    contentAt: null,
    processedAt: null,
    freshnessMs: 1800,
  };
}

class AdaptiveOrbMachine {
  constructor({ clock = () => Date.now() } = {}) {
    this.clock = clock;
    this.recoveryStartedAt = new Map();
    this.state = {
      schemaVersion: 1,
      status: "idle",
      sessionKind: null,
      startedAt: null,
      completedAt: null,
      stage: "intent",
      broadReady: false,
      entryStep: null,
      task: createTask(),
      tunnelPath: [],
      mode: "orbit",
      modePreference: "auto",
      modeEnteredAt: null,
      options: [],
      highlight: null,
      highlightSource: null,
      armed: false,
      dwellMs: 0,
      freezeCauses: [],
      sensors: initialSensors(),
      history: [],
      events: [],
      metrics: initialMetrics(),
      lastAction: "idle",
      announcement: "Ready to start",
      replayLocked: false,
    };
    this.state.options = optionsForState(this.state);
  }

  dispatch(action) {
    const requestsReplay =
      action.type === "START" && (action.kind || "live") === "simulation";
    if (
      (this.state.replayLocked || requestsReplay) &&
      action[REPLAY_AUTHORITY] !== true
    ) {
      return {
        ok: false,
        effect: "replay-rejected",
        reason: "deterministic-replay-locked",
      };
    }
    const now = Number.isFinite(action.at) ? action.at : this.clock();
    if (action.type === "VOICE") {
      return this.handleVoice(action.text, action.source || "voice", now);
    }

    switch (action.type) {
      case "START":
        return this.start(action.kind || "live", now, action.generation);
      case "HIGHLIGHT":
        return this.highlight(action.id, action.source || "unknown", now);
      case "CYCLE":
        return this.cycle(action.delta || 1, action.source || "switch", now);
      case "DWELL":
        return this.dwell(action.durationMs, now);
      case "CENTER":
        return this.center(action.source || "center", now);
      case "CONFIRM":
        return this.confirm(action.source || "other", now);
      case "UNDO":
        return this.undo(action.source || "other", now);
      case "CANCEL":
        return this.cancel(action.source || "other", now);
      case "STOP":
        return this.stop(action.source || "other", now);
      case "RESUME":
        return this.resume(action.source || "other", now);
      case "SWITCH_MODE":
        return this.switchMode(action.mode, action.source || "manual", now, true);
      case "AUTO_MODE":
        return this.useAutoMode(action.source || "manual", now);
      case "SENSOR_STATUS":
        return this.sensorStatus(action, now);
      case "SENSOR_SAMPLE":
        return this.sensorSample(action, now);
      case "SENSOR_LOSS":
        return this.sensorLoss(action.cause, action.sensor, now);
      case "SENSOR_RECOVER":
        return this.sensorRecover(action.cause, now);
      case "TICK":
        return this.tick(now);
      case "ACCESSIBLE":
        if (action[SENSOR_FREE_AUTHORITY] !== true) {
          this.clearAim();
          this.state.announcement =
            "Sensor-free access is waiting for camera, microphone, and speech teardown.";
          this.record("access.requested", { source: action.source || "external" }, now);
          return { ok: true, effect: "access-request" };
        }
        return this.enterAccessibleMode(action.source || "manual", now);
      case "PAGEHIDE":
        this.addFreezeCause("page-hidden", now, false);
        this.state.status = "stopped";
        this.clearAim();
        return this.record("lifecycle.pagehide", {}, now);
      default:
        return this.block("unknown-action", action.source || "system", now, false);
    }
  }

  start(kind, now, generation = 1) {
    if (this.state.status !== "idle") {
      return this.block("already-started", "system", now, false);
    }
    this.state.startedAt = now;
    this.state.modeEnteredAt = now;
    this.state.sessionKind = kind;
    this.state.status = "active";
    this.state.replayLocked = kind === "simulation";
    this.state.sensors.generation = generation;

    if (kind === "accessible") {
      this.state.sensors = {
        ...initialSensors(),
        generation,
        camera: "not-requested",
        microphone: "not-requested",
        speech: "disabled",
        estimator: "not-requested",
        estimatorLabel: "sensor-free access",
      };
    } else if (kind === "simulation") {
      this.state.sensors = {
        ...initialSensors(),
        generation,
        camera: "simulated",
        microphone: "simulated",
        speech: "simulated",
        estimator: "simulated",
        estimatorLabel: "deterministic synthetic input",
        frameAt: now,
        contentAt: now,
        processedAt: now,
      };
    } else {
      this.state.sensors = {
        ...initialSensors(),
        generation,
        camera: "starting",
        microphone: "starting",
        speech: "starting",
        estimator: "waiting",
        estimatorLabel: "waiting for fresh local frames",
      };
    }

    this.state.announcement =
      kind === "accessible"
        ? "Sensor-free access active. Cycle, highlight, then confirm."
        : kind === "simulation"
          ? "Deterministic all-mode replay started."
          : "Permission granted once. Preparing local sensors.";
    this.state.lastAction = "started";
    return this.record("session.started", { kind }, now);
  }

  handleVoice(rawText, source, now) {
    const text = normalizeSpeech(rawText);
    if (!text) {
      return this.voiceRepair("empty", now);
    }

    if (hasWord(text, "stop")) {
      return this.stop(source, now);
    }
    if (hasWord(text, "cancel")) {
      return this.cancel(source, now);
    }
    if (hasWord(text, "undo")) {
      return this.undo(source, now);
    }

    const requestedMode = MODE_NAMES.find(
      (mode) => text === mode || text === `switch to ${mode}` || text === `${mode} mode`,
    );
    if (requestedMode) {
      return this.switchMode(requestedMode, "voice", now, true);
    }
    if (text === "auto" || text === "auto mode" || text === "adaptive mode") {
      return this.useAutoMode("voice", now);
    }
    if (text === "resume" || text === "continue") {
      return this.resume(source, now);
    }
    if (text === "center" || text === "rest" || text === "relax") {
      return this.center(source, now);
    }
    if (
      text === "sensor free" ||
      text === "sensor-free" ||
      text === "accessible mode"
    ) {
      this.clearAim();
      this.state.announcement = "Ending camera, microphone, and speech before sensor-free access.";
      this.record("access.requested", { source: "voice" }, now);
      return { ok: true, effect: "access-request" };
    }
    if (text === "export" || text === "export metrics") {
      this.state.lastAction = "export-request";
      this.record("export.requested", { source: "voice" }, now);
      return { ok: true, effect: "export" };
    }

    const confirmationPhrases = new Set([
      "confirm",
      "choose",
      "select",
      "approve",
      "confirm choice",
    ]);
    if (confirmationPhrases.has(text)) {
      return this.confirm("voice", now);
    }

    if (this.state.stage === "intent") {
      const parsed = parseBroadIntent(text);
      const keys = Object.keys(parsed);
      if (keys.length === 0) {
        return this.voiceRepair("broad-intent-unrecognized", now);
      }
      this.pushHistory("voice-draft");
      Object.assign(this.state.task, parsed);
      this.state.entryStep = null;
      this.state.broadReady = broadIntentComplete(this.state.task);
      this.refreshOptionsAndMode("voice-draft", now);
      if (this.state.broadReady) {
        this.highlight("accept-intent", "prediction", now);
        this.state.armed = true;
        this.state.announcement =
          "Intent captured. Say confirm, or say a correction. Nothing has been sent.";
      } else {
        this.state.announcement = "Draft updated. Add the missing route details.";
      }
      this.state.lastAction = "voice-draft";
      this.record("voice.intent-captured", { fields: keys.sort() }, now);
      return { ok: true, effect: "draft", fields: keys };
    }

    const matched = this.state.options.find((candidate) =>
      candidate.aliases.some((alias) => text === normalizeSpeech(alias)),
    );
    if (matched) {
      this.highlight(matched.id, "voice", now);
      this.state.announcement = `${matched.label} highlighted. Say confirm to choose.`;
      return { ok: true, effect: "highlight", id: matched.id };
    }

    return this.voiceRepair("choice-unrecognized", now);
  }

  highlight(id, source, now) {
    const candidate = this.state.options.find((item) => item.id === id);
    if (!candidate) {
      return this.block("option-unavailable", source, now, false);
    }
    const changed = this.state.highlight !== id;
    this.state.highlight = id;
    this.state.highlightSource = source;
    this.state.dwellMs = 0;
    this.state.armed = !["gaze", "gesture", "motion"].includes(source);
    this.state.lastAction = "highlight";
    this.state.announcement = `${candidate.label} highlighted${
      this.state.armed ? ". Confirm explicitly." : ". Hold steadily, then confirm."
    }`;
    this.record(
      "choice.highlighted",
      { id, source, changed, mode: this.state.mode },
      now,
    );
    return { ok: true, effect: "highlight", id };
  }

  cycle(delta, source, now) {
    const count = this.state.options.length;
    if (!count) {
      return this.block("no-options", source, now, false);
    }
    const current = this.state.options.findIndex(
      (candidate) => candidate.id === this.state.highlight,
    );
    const next = ((current + delta) % count + count) % count;
    return this.highlight(this.state.options[next].id, source, now);
  }

  dwell(durationMs, now) {
    if (!this.state.highlight) {
      return this.block("dwell-without-highlight", "sensor", now, false);
    }
    const duration = Number(durationMs);
    if (!Number.isFinite(duration) || duration <= 0) {
      return { ok: false, effect: "ignored", reason: "invalid-dwell" };
    }
    if (duration > 350) {
      const id = this.state.highlight;
      this.clearAim();
      this.state.lastAction = "dwell-gap-reset";
      this.state.announcement = "Sensor gap reset dwell. Reacquire the choice.";
      this.record("dwell.reset", { reason: "sample-gap", id, reacquire: true }, now);
      return { ok: false, effect: "reset" };
    }
    const credited = Math.min(duration, 250);
    this.state.dwellMs += credited;
    this.state.metrics.perMode[this.state.mode].dwellMs += credited;
    const target = DWELL_TARGET_MS[this.state.mode];
    if (this.state.dwellMs >= target && !this.state.armed) {
      this.state.armed = true;
      this.state.announcement = "Choice armed. Gaze still cannot execute it.";
      this.record(
        "choice.armed",
        { id: this.state.highlight, mode: this.state.mode, dwellMs: this.state.dwellMs },
        now,
      );
    }
    this.state.lastAction = "dwell";
    return { ok: true, effect: this.state.armed ? "armed" : "dwell" };
  }

  center(source, now) {
    const hadPending = Boolean(this.state.highlight || this.state.armed || this.state.dwellMs);
    if (hadPending) {
      this.state.metrics.centerCancels += 1;
    }
    this.clearAim();
    this.state.lastAction = "center";
    this.state.announcement = "Center rest. Aim and dwell are canceled.";
    this.record("center.rest", { source, canceledPending: hadPending }, now);
    return { ok: true, effect: "center" };
  }

  confirm(source, now) {
    if (source === "gaze" || source === "dwell") {
      this.state.metrics.gazeCommitAttempts += 1;
      return this.block("gaze-never-confirms", source, now, false);
    }
    if (this.state.freezeCauses.length > 0) {
      return this.block("frozen", source, now, source === "voice");
    }
    const candidate = this.state.options.find(
      (item) => item.id === this.state.highlight,
    );
    if (!candidate) {
      return this.block("nothing-highlighted", source, now, source === "voice");
    }
    if (!this.state.armed) {
      return this.block("choice-not-armed", source, now, source === "voice");
    }

    const sensorDerived =
      source === "gesture" ||
      ["gaze", "gesture", "motion"].includes(this.state.highlightSource);
    if (sensorDerived && !this.sensorInputFresh(now)) {
      this.checkFreshness(now);
      return this.block("sensor-not-fresh", source, now, source === "voice");
    }

    if (candidate.effect === "prompt" || candidate.effect === "privacy") {
      this.state.announcement =
        candidate.effect === "privacy"
          ? "Frames are ephemeral. Browser speech may use vendor processing."
          : candidate.detail;
      this.clearAim();
      this.record("choice.informational", { id: candidate.id, source }, now);
      return { ok: true, effect: candidate.effect };
    }
    if (candidate.effect === "export") {
      this.clearAim();
      this.record("export.requested", { source }, now);
      return { ok: true, effect: "export" };
    }
    if (candidate.effect === "undo") {
      return this.undo(source, now);
    }
    if (candidate.effect === "access") {
      this.clearAim();
      this.state.announcement = "Ending camera, microphone, and speech before sensor-free access.";
      this.record("access.requested", { source }, now);
      return { ok: true, effect: "access-request" };
    }

    this.pushHistory(`confirm:${candidate.id}`);
    const modeAtCommit = this.state.mode;
    const result = this.applyOption(candidate, now);
    if (!result.ok) {
      this.state.history.pop();
      return this.block(result.reason, source, now, source === "voice");
    }

    this.state.metrics.commits += 1;
    this.state.metrics.perMode[modeAtCommit].confirmations += 1;
    const sourceKey = Object.hasOwn(this.state.metrics.confirmationSources, source)
      ? source
      : "other";
    this.state.metrics.confirmationSources[sourceKey] += 1;
    this.state.lastAction = "confirmed";
    this.record(
      "choice.confirmed",
      { id: candidate.id, source, mode: modeAtCommit, reversible: true },
      now,
    );
    this.clearAim();
    this.refreshOptionsAndMode("task-advanced", now);
    return { ok: true, effect: result.effect, id: candidate.id };
  }

  applyOption(candidate, now) {
    switch (candidate.effect) {
      case "entry-action":
        this.state.task.action = "route";
        this.state.entryStep = "quantity";
        this.state.announcement = "Route selected. Choose beacon quantity.";
        return { ok: true, effect: "entry" };
      case "entry-quantity":
        this.state.task.quantity = candidate.value;
        this.state.entryStep = "color";
        this.state.announcement = `${candidate.value} selected. Choose beacon color.`;
        return { ok: true, effect: "entry" };
      case "entry-color":
        this.state.task.color = candidate.value;
        this.state.entryStep = "time";
        this.state.announcement = `${candidate.label} selected. Choose route time.`;
        return { ok: true, effect: "entry" };
      case "entry-time":
        this.state.task.time = candidate.value;
        this.state.entryStep = "handling";
        this.state.announcement = `${candidate.label} selected. Choose handling.`;
        return { ok: true, effect: "entry" };
      case "entry-handling":
        this.state.task.handling = candidate.value;
        this.state.entryStep = null;
        this.state.broadReady = broadIntentComplete(this.state.task);
        this.state.announcement = `${candidate.label} selected. Review the broad intent.`;
        return { ok: true, effect: "entry-review" };
      case "accept-broad":
        if (!broadIntentComplete(this.state.task)) {
          return { ok: false, reason: "broad-intent-incomplete" };
        }
        this.state.broadReady = false;
        this.state.entryStep = null;
        this.state.stage = "destination";
        this.state.announcement = "Broad intent confirmed. Compass is choosing destination.";
        return { ok: true, effect: "destination" };
      case "reset-draft":
        this.state.task = createTask();
        this.state.broadReady = false;
        this.state.entryStep = null;
        this.state.announcement = "Draft cleared. Nothing was sent.";
        return { ok: true, effect: "reset" };
      case "destination":
        this.state.task.destination = candidate.value;
        this.state.stage = "gate";
        this.state.announcement = `${candidate.label} selected. Choose a gate.`;
        return { ok: true, effect: "gate" };
      case "gate":
        this.state.task.gate = candidate.value;
        this.state.stage = "review";
        this.state.tunnelPath = [];
        this.state.announcement = "Route assembled. Tunnel review is active.";
        return { ok: true, effect: "review" };
      case "branch-inspect":
        this.state.tunnelPath = ["inspect"];
        this.state.announcement = "Inside the read-only manifest tunnel.";
        return { ok: true, effect: "branch" };
      case "branch-amend":
        this.state.tunnelPath = ["amend"];
        if (candidate.intentionalWrong) {
          this.state.metrics.intentionalWrongBranches += 1;
          this.state.metrics.errors += 1;
        }
        this.state.announcement = "Amend tunnel opened. Say undo to return safely.";
        return { ok: true, effect: "branch" };
      case "branch":
        this.state.tunnelPath.push(candidate.id.replace(/^amend-/, ""));
        this.state.announcement = `${candidate.label} branch previewed. Values are unchanged.`;
        return { ok: true, effect: "branch" };
      case "back":
        this.state.tunnelPath = [];
        this.state.announcement = "Back at route review.";
        return { ok: true, effect: "back" };
      case "confirm-route":
        if (!taskFieldsMatch(this.state.task)) {
          return { ok: false, reason: "route-does-not-match-task" };
        }
        this.state.task.confirmed = true;
        this.state.stage = "home";
        this.state.tunnelPath = [];
        this.state.announcement =
          "Route held in reversible local state. No external dispatch occurred.";
        return { ok: true, effect: "home" };
      case "return-home":
        if (!this.state.task.confirmed) {
          return { ok: false, reason: "route-not-confirmed" };
        }
        this.state.task.returnedHome = true;
        this.state.stage = "complete";
        this.state.completedAt = now;
        this.state.metrics.completionTimeMs = this.elapsedAt(now);
        this.state.announcement =
          "Exact cobalt-beacon task complete. All actions remained local and reversible.";
        return { ok: true, effect: "complete" };
      case "cancel-draft":
        this.state.task = createTask();
        this.state.stage = "intent";
        this.state.broadReady = false;
        this.state.entryStep = null;
        this.state.tunnelPath = [];
        this.state.announcement = "Draft canceled locally. Undo can restore it.";
        return { ok: true, effect: "intent" };
      default:
        return { ok: false, reason: "unsupported-effect" };
    }
  }

  undo(source, now) {
    if (!this.state.history.length) {
      if (source === "voice") {
        return this.voiceRepair("nothing-to-undo", now);
      }
      return this.block("nothing-to-undo", source, now, false);
    }
    const previous = this.state.history.pop();
    this.state.task = previous.task;
    this.state.stage = previous.stage;
    this.state.broadReady = previous.broadReady;
    this.state.entryStep = previous.entryStep;
    this.state.tunnelPath = previous.tunnelPath;
    this.state.completedAt = previous.completedAt;
    this.state.metrics.completionTimeMs = previous.completionTimeMs;
    this.state.metrics.undos += 1;
    this.clearAim();
    this.refreshOptionsAndMode("undo", now);
    this.state.lastAction = "undo";
    this.state.announcement = `Undone: ${previous.reason}. Shared sensors and safety state were preserved.`;
    this.record("history.undo", { source, restored: previous.reason }, now);
    return { ok: true, effect: "undo" };
  }

  cancel(source, now) {
    const hadPending = Boolean(this.state.highlight || this.state.tunnelPath.length);
    this.clearAim();
    if (this.state.tunnelPath.length) {
      this.state.tunnelPath = [];
      this.refreshOptionsAndMode("cancel-branch", now);
    }
    this.state.metrics.cancels += 1;
    this.state.lastAction = "cancel";
    this.state.announcement = "Canceled safely. Confirmed task values are unchanged.";
    this.record("safety.cancel", { source, canceledPending: hadPending }, now);
    return { ok: true, effect: "cancel" };
  }

  stop(source, now) {
    this.addFreezeCause("user-stop", now, false);
    this.state.status = "paused";
    this.clearAim();
    this.state.lastAction = "stop";
    this.state.announcement = "Stopped. Safety controls and undo remain available.";
    this.record("safety.stop", { source }, now);
    return { ok: true, effect: "stop" };
  }

  resume(source, now) {
    this.removeFreezeCause("user-stop", now, false);
    this.state.status = this.state.freezeCauses.length ? "frozen" : "active";
    this.state.lastAction = "resume";
    this.state.announcement = this.state.freezeCauses.length
      ? `Still frozen: ${this.state.freezeCauses.join(", ")}.`
      : "Resumed with the same task and sensor state.";
    this.record("safety.resume", { source, remaining: [...this.state.freezeCauses] }, now);
    return { ok: this.state.freezeCauses.length === 0, effect: "resume" };
  }

  switchMode(mode, source, now, manual = false) {
    if (!MODE_NAMES.includes(mode)) {
      return this.block("unknown-mode", source, now, false);
    }
    if (manual) {
      this.state.modePreference = mode;
    }
    if (this.state.mode === mode) {
      this.state.announcement = `${mode} is already active. Shared task state is unchanged.`;
      this.record("mode.retained", { mode, source }, now);
      return { ok: true, effect: "mode", mode };
    }
    const from = this.state.mode;
    if (this.state.modeEnteredAt !== null) {
      this.state.metrics.perMode[from].activeMs += Math.max(
        0,
        now - this.state.modeEnteredAt,
      );
    }
    this.state.mode = mode;
    this.state.modeEnteredAt = now;
    this.state.metrics.perMode[mode].transitionsIn += 1;
    this.state.metrics.modeTransitions.push({
      atMs: this.elapsedAt(now),
      from,
      to: mode,
      source,
    });
    this.clearAim();
    this.state.lastAction = "mode-switch";
    this.state.announcement = `${mode} active. Task, history, freezes, freshness, and metrics preserved.`;
    this.record("mode.changed", { from, to: mode, source }, now);
    return { ok: true, effect: "mode", mode };
  }

  useAutoMode(source, now) {
    this.state.modePreference = "auto";
    const mode = recommendedMode(this.state);
    const result = this.switchMode(mode, `${source}-auto`, now, false);
    this.state.announcement = `Adaptive mode restored. ${mode} matches the current choice shape.`;
    return result;
  }

  sensorStatus(action, now) {
    const { sensor, status } = action;
    if (!["camera", "microphone", "speech", "estimator"].includes(sensor)) {
      return this.block("unknown-sensor", "sensor", now, false);
    }
    this.state.sensors[sensor] = status;
    if (sensor === "estimator" && action.label) {
      this.state.sensors.estimatorLabel = action.label;
    }

    if (sensor !== "speech") {
      const cause = `${sensor}-lost`;
      if (["lost", "denied", "muted", "failed"].includes(status)) {
        this.addFreezeCause(cause, now, true);
      } else if (["active", "simulated", "not-requested"].includes(status)) {
        this.removeFreezeCause(cause, now, true);
      }
    }
    this.state.lastAction = "sensor-status";
    this.record("sensor.status", { sensor, status }, now);
    return { ok: true, effect: "sensor" };
  }

  sensorSample(action, now) {
    if (action.generation !== this.state.sensors.generation) {
      this.state.metrics.delayedSensorRejections += 1;
      this.record("sensor.sample-rejected", { reason: "generation" }, now);
      return { ok: false, effect: "rejected" };
    }
    for (const signal of ["frameAt", "contentAt", "processedAt"]) {
      if (!Number.isFinite(action[signal])) {
        continue;
      }
      const current = this.state.sensors[signal];
      if (current !== null && action[signal] < current) {
        this.state.metrics.delayedSensorRejections += 1;
        this.record("sensor.sample-rejected", { reason: signal }, now);
        return { ok: false, effect: "rejected" };
      }
      this.state.sensors[signal] = action[signal];
      this.removeFreezeCause(signal.replace("At", "-stale"), now, true);
    }
    this.state.lastAction = "sensor-sample";
    return { ok: true, effect: "sample" };
  }

  sensorLoss(cause = "sensor-lost", sensor = "estimator", now) {
    if (sensor && Object.hasOwn(this.state.sensors, sensor)) {
      this.state.sensors[sensor] = "lost";
    }
    this.addFreezeCause(cause, now, true);
    this.state.lastAction = "sensor-loss";
    this.record("sensor.loss", { cause, sensor }, now);
    return { ok: true, effect: "freeze" };
  }

  sensorRecover(cause, now) {
    const removed = this.removeFreezeCause(cause, now, true);
    this.state.lastAction = "sensor-recovery";
    this.record("sensor.recovered", { cause, removed }, now);
    return { ok: removed, effect: "recover" };
  }

  tick(now) {
    this.checkFreshness(now);
    this.updateElapsed(now);
    return { ok: true, effect: "tick" };
  }

  checkFreshness(now) {
    if (!["live", "simulation"].includes(this.state.sessionKind)) {
      return true;
    }
    const freshness = this.state.sensors.freshnessMs;
    for (const signal of ["frameAt", "contentAt", "processedAt"]) {
      const value = this.state.sensors[signal];
      const cause = signal.replace("At", "-stale");
      if (value === null || now - value > freshness) {
        this.addFreezeCause(cause, now, true);
      }
    }
    return this.sensorInputFresh(now);
  }

  sensorInputFresh(now) {
    if (this.state.sessionKind === "accessible") {
      return true;
    }
    if (!["live", "simulation"].includes(this.state.sessionKind)) {
      return false;
    }
    const validStatus = (value) => ["active", "simulated"].includes(value);
    if (
      !validStatus(this.state.sensors.camera) ||
      !validStatus(this.state.sensors.estimator)
    ) {
      return false;
    }
    return ["frameAt", "contentAt", "processedAt"].every((signal) => {
      const value = this.state.sensors[signal];
      return value !== null && now - value <= this.state.sensors.freshnessMs;
    });
  }

  enterAccessibleMode(source, now) {
    this.state.sessionKind = "accessible";
    this.state.sensors = {
      ...initialSensors(),
      generation: this.state.sensors.generation + 1,
      camera: "not-requested",
      microphone: "not-requested",
      speech: "disabled",
      estimator: "not-requested",
      estimatorLabel: "sensor-free access",
    };
    this.state.freezeCauses = this.state.freezeCauses.filter(
      (cause) => cause === "user-stop" || cause === "page-hidden",
    );
    this.state.status = this.state.freezeCauses.length ? "paused" : "active";
    this.clearAim();
    this.state.lastAction = "accessible";
    this.state.announcement =
      "Sensor-free access active. Shared route and history were preserved.";
    this.record("session.sensor-free", { source }, now);
    return { ok: true, effect: "accessible" };
  }

  addFreezeCause(cause, now, sensorCause) {
    if (this.state.freezeCauses.includes(cause)) {
      return false;
    }
    this.state.freezeCauses.push(cause);
    this.state.freezeCauses.sort();
    this.clearAim();
    if (this.state.status === "active") {
      this.state.status = "frozen";
    }
    if (sensorCause) {
      this.state.metrics.sensorLosses += 1;
      this.recoveryStartedAt.set(cause, now);
    }
    this.record("safety.freeze-added", { cause, sensorCause }, now);
    return true;
  }

  removeFreezeCause(cause, now, sensorCause) {
    const index = this.state.freezeCauses.indexOf(cause);
    if (index === -1) {
      return false;
    }
    this.state.freezeCauses.splice(index, 1);
    if (sensorCause) {
      this.state.metrics.sensorRecoveries += 1;
      const started = this.recoveryStartedAt.get(cause);
      if (Number.isFinite(started)) {
        this.state.metrics.sensorRecoveryMs += Math.max(0, now - started);
      }
      this.recoveryStartedAt.delete(cause);
    }
    if (!this.state.freezeCauses.length && this.state.status === "frozen") {
      this.state.status = "active";
    }
    this.record("safety.freeze-removed", { cause, sensorCause }, now);
    return true;
  }

  voiceRepair(reason, now) {
    this.state.metrics.voiceRepairs += 1;
    this.state.metrics.errors += 1;
    this.state.lastAction = "voice-repair";
    this.state.announcement = "I did not map that safely. Repeat a visible choice.";
    this.record("voice.repair", { reason }, now);
    return { ok: false, effect: "repair", reason };
  }

  block(reason, source, now, voiceRepair) {
    this.state.metrics.blockedActions += 1;
    if (voiceRepair) {
      this.state.metrics.voiceRepairs += 1;
    }
    this.state.lastAction = "blocked";
    this.state.announcement = `Blocked safely: ${reason.replaceAll("-", " ")}.`;
    this.record("action.blocked", { reason, source }, now);
    return { ok: false, effect: "blocked", reason };
  }

  pushHistory(reason) {
    this.state.history.push({
      reason,
      task: clone(this.state.task),
      stage: this.state.stage,
      broadReady: this.state.broadReady,
      entryStep: this.state.entryStep,
      tunnelPath: [...this.state.tunnelPath],
      completedAt: this.state.completedAt,
      completionTimeMs: this.state.metrics.completionTimeMs,
    });
    if (this.state.history.length > 40) {
      this.state.history.shift();
    }
  }

  clearAim() {
    this.state.highlight = null;
    this.state.highlightSource = null;
    this.state.armed = false;
    this.state.dwellMs = 0;
  }

  refreshOptionsAndMode(reason, now) {
    this.state.options = optionsForState(this.state);
    if (!this.state.options.some((candidate) => candidate.id === this.state.highlight)) {
      this.clearAim();
    }
    if (this.state.modePreference === "auto") {
      const next = recommendedMode(this.state);
      if (next !== this.state.mode) {
        this.switchMode(next, `auto:${reason}`, now, false);
      }
    }
  }

  elapsedAt(now) {
    if (this.state.startedAt === null) {
      return 0;
    }
    const end = this.state.completedAt === null ? now : this.state.completedAt;
    return Math.max(0, end - this.state.startedAt);
  }

  updateElapsed(now) {
    this.state.metrics.elapsedMs = this.elapsedAt(now);
  }

  record(type, detail, now) {
    this.updateElapsed(now);
    this.state.events.push({
      seq: this.state.events.length + 1,
      atMs: this.elapsedAt(now),
      type,
      detail: clone(detail),
    });
    return { ok: true, effect: type };
  }

  exportRecord(now = this.clock()) {
    this.updateElapsed(now);
    const metrics = clone(this.state.metrics);
    if (this.state.modeEnteredAt !== null) {
      const end = this.state.completedAt === null ? now : this.state.completedAt;
      metrics.perMode[this.state.mode].activeMs += Math.max(
        0,
        end - this.state.modeEnteredAt,
      );
    }
    const record = {
      schemaVersion: 1,
      product: "Adaptive Orb",
      taskId: "cobalt-beacon-route",
      sessionKind: this.state.sessionKind,
      complete: this.state.stage === "complete",
      exactTaskVerdict: taskMatchesExpected(this.state.task),
      noIrreversibleAction: true,
      task: clone(this.state.task),
      activeMode: this.state.mode,
      modePreference: this.state.modePreference,
      modesUsed: MODE_NAMES.filter(
        (mode) =>
          metrics.perMode[mode].confirmations > 0 ||
          metrics.modeTransitions.some(
            (transition) => transition.from === mode || transition.to === mode,
          ),
      ),
      historyDepth: this.state.history.length,
      freezeCauses: [...this.state.freezeCauses],
      sensors: clone(this.state.sensors),
      metrics,
      privacy: {
        rawFramesStored: false,
        rawAudioStored: false,
        rawTranscriptsStored: false,
        applicationNetworkClientsUsed: false,
        persistentStorageUsed: false,
        browserSpeechVendorProcessingDisclosed: true,
      },
      events: clone(this.state.events),
    };
    record.deterministicFingerprint = fingerprint({
      complete: record.complete,
      exactTaskVerdict: record.exactTaskVerdict,
      task: record.task,
      modesUsed: record.modesUsed,
      metrics: record.metrics,
      events: record.events,
    });
    return record;
  }
}

function fingerprint(value) {
  const text = JSON.stringify(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

const DETERMINISTIC_SCRIPT = Object.freeze([
  { at: 0, type: "START", kind: "simulation", generation: 7 },
  {
    at: 100,
    type: "VOICE",
    source: "voice",
    text: "Route three cobalt beacons at 14:30, mark them fragile",
  },
  { at: 400, type: "CONFIRM", source: "voice" },
  {
    at: 500,
    type: "SENSOR_SAMPLE",
    generation: 7,
    frameAt: 500,
    contentAt: 500,
    processedAt: 500,
  },
  { at: 550, type: "VOICE", source: "voice", text: "ORION-9" },
  { at: 600, type: "HIGHLIGHT", id: "destination-orion", source: "gaze" },
  { at: 850, type: "DWELL", durationMs: 225 },
  { at: 1075, type: "DWELL", durationMs: 225 },
  { at: 1300, type: "DWELL", durationMs: 225 },
  { at: 1525, type: "DWELL", durationMs: 225 },
  { at: 1600, type: "CONFIRM", source: "gaze" },
  { at: 1700, type: "CENTER", source: "gaze-center" },
  {
    at: 1800,
    type: "SENSOR_SAMPLE",
    generation: 7,
    frameAt: 1800,
    contentAt: 1800,
    processedAt: 1800,
  },
  { at: 1825, type: "HIGHLIGHT", id: "destination-orion", source: "gaze" },
  { at: 2050, type: "DWELL", durationMs: 225 },
  { at: 2275, type: "DWELL", durationMs: 225 },
  { at: 2500, type: "DWELL", durationMs: 225 },
  { at: 2725, type: "DWELL", durationMs: 225 },
  {
    at: 2800,
    type: "SENSOR_LOSS",
    cause: "content-stale",
    sensor: "estimator",
  },
  { at: 2850, type: "CONFIRM", source: "voice" },
  { at: 3150, type: "SENSOR_RECOVER", cause: "content-stale" },
  {
    at: 3150,
    type: "SENSOR_STATUS",
    sensor: "estimator",
    status: "simulated",
    label: "deterministic synthetic input",
  },
  {
    at: 3200,
    type: "SENSOR_SAMPLE",
    generation: 7,
    frameAt: 3200,
    contentAt: 3200,
    processedAt: 3200,
  },
  { at: 3225, type: "HIGHLIGHT", id: "destination-orion", source: "gaze" },
  { at: 3450, type: "DWELL", durationMs: 225 },
  { at: 3675, type: "DWELL", durationMs: 225 },
  { at: 3900, type: "DWELL", durationMs: 225 },
  { at: 4125, type: "DWELL", durationMs: 225 },
  { at: 4200, type: "CONFIRM", source: "voice" },
  {
    at: 4300,
    type: "SENSOR_SAMPLE",
    generation: 7,
    frameAt: 4300,
    contentAt: 4300,
    processedAt: 4300,
  },
  { at: 4325, type: "HIGHLIGHT", id: "gate-north", source: "gaze" },
  { at: 4550, type: "DWELL", durationMs: 225 },
  { at: 4775, type: "DWELL", durationMs: 225 },
  { at: 5000, type: "DWELL", durationMs: 225 },
  { at: 5225, type: "DWELL", durationMs: 225 },
  { at: 5300, type: "CONFIRM", source: "gesture" },
  {
    at: 5400,
    type: "SENSOR_SAMPLE",
    generation: 7,
    frameAt: 5400,
    contentAt: 5400,
    processedAt: 5400,
  },
  { at: 5425, type: "HIGHLIGHT", id: "amend-route", source: "gesture" },
  { at: 5650, type: "DWELL", durationMs: 225 },
  { at: 5875, type: "DWELL", durationMs: 225 },
  { at: 6100, type: "DWELL", durationMs: 225 },
  { at: 6325, type: "DWELL", durationMs: 225 },
  { at: 6400, type: "CONFIRM", source: "gesture" },
  { at: 6500, type: "VOICE", source: "voice", text: "undo" },
  {
    at: 6600,
    type: "SENSOR_SAMPLE",
    generation: 7,
    frameAt: 6600,
    contentAt: 6600,
    processedAt: 6600,
  },
  { at: 6625, type: "HIGHLIGHT", id: "confirm-route", source: "gesture" },
  { at: 6850, type: "DWELL", durationMs: 225 },
  { at: 7075, type: "DWELL", durationMs: 225 },
  { at: 7300, type: "DWELL", durationMs: 225 },
  { at: 7525, type: "DWELL", durationMs: 225 },
  { at: 7600, type: "CONFIRM", source: "voice" },
  {
    at: 7700,
    type: "SENSOR_SAMPLE",
    generation: 7,
    frameAt: 7700,
    contentAt: 7700,
    processedAt: 7700,
  },
  { at: 7725, type: "HIGHLIGHT", id: "return-home", source: "gesture" },
  { at: 7950, type: "DWELL", durationMs: 225 },
  { at: 8175, type: "DWELL", durationMs: 225 },
  { at: 8400, type: "DWELL", durationMs: 225 },
  { at: 8625, type: "DWELL", durationMs: 225 },
  { at: 8700, type: "CONFIRM", source: "gesture" },
]);

function dispatchDeterministicStep(machine, action) {
  const authorized = clone(action);
  authorized[REPLAY_AUTHORITY] = true;
  return machine.dispatch(authorized);
}

function commitSensorFreeAfterTeardown(machine, { source, at } = {}) {
  const action = { type: "ACCESSIBLE", source, at };
  action[SENSOR_FREE_AUTHORITY] = true;
  return machine.dispatch(action);
}

function verifyDeterministicRecord(record) {
  return (
    record.deterministicFingerprint === EXPECTED_DETERMINISTIC_FINGERPRINT &&
    record.complete === true &&
    record.exactTaskVerdict === true &&
    JSON.stringify(record.task) === JSON.stringify(EXPECTED_TASK) &&
    record.activeMode === "tunnel" &&
    record.modePreference === "auto" &&
    JSON.stringify(record.modesUsed) ===
      JSON.stringify(["orbit", "compass", "tunnel"]) &&
    record.freezeCauses.length === 0 &&
    record.metrics.completionTimeMs === 8700 &&
    record.metrics.falseCommits === 0 &&
    record.metrics.modeTransitions.length === 2 &&
    record.metrics.sensorLosses === 1 &&
    record.metrics.sensorRecoveries === 1 &&
    record.metrics.intentionalWrongBranches === 1 &&
    record.metrics.undos === 1
  );
}

function runDeterministicSimulation() {
  let now = 0;
  const machine = new AdaptiveOrbMachine({ clock: () => now });
  for (const action of DETERMINISTIC_SCRIPT) {
    now = action.at;
    dispatchDeterministicStep(machine, action);
  }
  const record = machine.exportRecord(now);
  if (!verifyDeterministicRecord(record)) {
    throw new Error(
      `Deterministic replay verification failed: ${record.deterministicFingerprint}`,
    );
  }
  return { machine, record };
}

export {
  AdaptiveOrbMachine,
  DETERMINISTIC_SCRIPT,
  DWELL_TARGET_MS,
  EXPECTED_DETERMINISTIC_FINGERPRINT,
  EXPECTED_TASK,
  MODE_NAMES,
  broadIntentComplete,
  choiceShapeForState,
  chooseModeForShape,
  createTask,
  commitSensorFreeAfterTeardown,
  dispatchDeterministicStep,
  fingerprint,
  normalizeSpeech,
  optionsForState,
  parseBroadIntent,
  recommendedMode,
  runDeterministicSimulation,
  taskFieldsMatch,
  taskMatchesExpected,
  verifyDeterministicRecord,
};
