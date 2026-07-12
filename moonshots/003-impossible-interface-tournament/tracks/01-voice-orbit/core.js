(function attachVoiceOrbitCore(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.VoiceOrbitCore = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function createVoiceOrbitCore() {
  "use strict";

  const TASK_TEMPLATE = Object.freeze({
    action: null,
    count: null,
    color: null,
    time: null,
    fragile: null,
    destination: null,
    gate: null,
  });

  const FIELD_ORDER = Object.freeze([
    "count",
    "color",
    "time",
    "fragile",
    "destination",
    "gate",
  ]);

  const SUPPORTED_DESTINATIONS = Object.freeze(["ORION-7", "LUNA-3", "ATLAS-2", "POLARIS-4"]);

  const SPOKEN_NUMBERS = Object.freeze({
    zero: 0,
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
  });

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function normalizeSpeech(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/[–—]/g, "-")
      .replace(/[.,!?]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function destinationCandidateIdentifier(value) {
    const speech = normalizeSpeech(value);
    const known = speech.match(
      /\b(orion|luna|atlas|polaris)\s*(?:-|dash|hyphen|number)?\s*(zero|one|two|three|four|five|six|seven|eight|nine|\d+)\b/,
    );
    const directed = speech.match(
      /\b(?:to|destination(?:\s+(?:is|equals))?)\s+(?:the\s+)?([a-z]+)\s*(?:-|dash|hyphen|number)?\s*(zero|one|two|three|four|five|six|seven|eight|nine|\d+)\b/,
    );
    const standalone = speech.match(
      /^([a-z]+)\s*(?:-|dash|hyphen|number)?\s*(zero|one|two|three|four|five|six|seven|eight|nine|\d+)$/,
    );
    const match = known || directed || standalone;
    if (!match) {
      return null;
    }
    const number = Object.prototype.hasOwnProperty.call(SPOKEN_NUMBERS, match[2])
      ? SPOKEN_NUMBERS[match[2]]
      : Number(match[2]);
    return `${match[1].toUpperCase()}-${number}`;
  }

  function normalizeDestinationIdentifier(value) {
    const candidate = destinationCandidateIdentifier(value);
    return candidate && SUPPORTED_DESTINATIONS.includes(candidate) ? candidate : null;
  }

  function isSupportedDestination(value) {
    return typeof value === "string" && SUPPORTED_DESTINATIONS.includes(value.toUpperCase());
  }

  function parseRouteUtterance(value) {
    const speech = normalizeSpeech(value);
    const parsed = {};

    if (/\b(route|send|dispatch|move|deliver)\b/.test(speech)) {
      parsed.action = "route";
    }

    const numberValues = {
      one: 1,
      "1": 1,
      two: 2,
      "2": 2,
      three: 3,
      "3": 3,
      four: 4,
      "4": 4,
      five: 5,
      "5": 5,
      six: 6,
      "6": 6,
      seven: 7,
      "7": 7,
      eight: 8,
      "8": 8,
    };
    const countMatch =
      speech.match(
        /\b(one|two|three|four|five|six|seven|eight|[1-8])\b(?=(?:\s+[a-z]+){0,2}\s+beacons?\b)/,
      ) ||
      speech.match(/^(?:route\s+)?(one|two|three|four|five|six|seven|eight|[1-8])$/);
    if (countMatch) {
      parsed.count = numberValues[countMatch[1]];
    }

    const color = ["cobalt", "amber", "crimson", "silver"].find((candidate) =>
      new RegExp(`\\b${candidate}\\b`).test(speech),
    );
    if (color) {
      parsed.color = color;
    }

    if (/\b(?:14\s*:?\s*30|2\s*:?\s*30\s*(?:pm|p m))\b/.test(speech)) {
      parsed.time = "14:30";
    } else {
      const timeMatch = speech.match(/\b([01]?\d|2[0-3])\s*:\s*([0-5]\d)\b/);
      if (timeMatch) {
        parsed.time = `${timeMatch[1].padStart(2, "0")}:${timeMatch[2]}`;
      }
    }

    const handlingNegated =
      /\bnon\s*-?\s*(?:fragile|delicate)\b/.test(speech) ||
      /\bnot\s+(?:marked\s+|treated\s+)?(?:as\s+)?(?:fragile|delicate)\b/.test(speech) ||
      /\b(?:do not|don'?t)\s+(?:(?:mark|make|treat)\s+)(?:(?:it|them)\s+)?(?:as\s+)?(?:fragile|delicate)\b/.test(
        speech,
      ) ||
      /\b(?:do not|don'?t|not(?:\s+to)?)\s+handle(?:d)?(?:\s+(?:it|them))?\s+with care\b/.test(
        speech,
      );
    if (handlingNegated || /\b(standard|rugged)\b/.test(speech)) {
      parsed.fragile = false;
    } else if (
      /\b(?:fragile|delicate|handle(?:\s+(?:it|them))?\s+with care)\b/.test(speech)
    ) {
      parsed.fragile = true;
    }

    const destinationCandidate = destinationCandidateIdentifier(speech);
    if (destinationCandidate) {
      if (isSupportedDestination(destinationCandidate)) {
        parsed.destination = destinationCandidate;
      } else {
        parsed.destination = null;
        parsed.destinationRejected = destinationCandidate;
      }
    }

    const gateMatch = speech.match(/\b(north|south|east|west)\s+gate\b/);
    if (gateMatch) {
      parsed.gate = `${gateMatch[1][0].toUpperCase()}${gateMatch[1].slice(1)} Gate`;
    }

    return parsed;
  }

  function taskComplete(task) {
    return (
      task.action === "route" &&
      FIELD_ORDER.every((field) => task[field] !== null && task[field] !== undefined) &&
      isSupportedDestination(task.destination)
    );
  }

  class NodGestureGate {
    constructor(configuration) {
      const options = configuration || {};
      this.settleMs = options.settleMs || 450;
      this.armDelta = options.armDelta || 0.035;
      this.returnDelta = options.returnDelta || 0.014;
      this.timeoutMs = options.timeoutMs || 1000;
      this.cooldownMs = options.cooldownMs || 1800;
      this.cooldownUntil = 0;
      this.reset();
    }

    reset() {
      this.index = null;
      this.anchor = null;
      this.enteredAt = 0;
      this.armedAt = 0;
      this.phase = "settling";
    }

    sample(sample) {
      const now = Number(sample.now) || 0;
      const position = Number(sample.position);
      const index = sample.index;
      if (sample.zone === "center" || !Number.isInteger(index) || !Number.isFinite(position)) {
        this.reset();
        return { confirmed: false, phase: "center" };
      }
      if (now < this.cooldownUntil) {
        return { confirmed: false, phase: "cooldown" };
      }
      if (this.index !== index) {
        this.index = index;
        this.anchor = position;
        this.enteredAt = now;
        this.armedAt = 0;
        this.phase = "settling";
        return { confirmed: false, phase: this.phase };
      }
      if (this.phase === "settling") {
        this.anchor = position;
        if (now - this.enteredAt >= this.settleMs) {
          this.phase = "ready";
        }
        return { confirmed: false, phase: this.phase };
      }
      if (this.phase === "ready") {
        const movement = position - this.anchor;
        if (movement >= this.armDelta) {
          this.phase = "down";
          this.armedAt = now;
          return { confirmed: false, phase: this.phase };
        }
        this.anchor = this.anchor * 0.98 + position * 0.02;
        return { confirmed: false, phase: this.phase };
      }
      if (this.phase === "down") {
        if (now - this.armedAt > this.timeoutMs) {
          this.index = index;
          this.anchor = position;
          this.enteredAt = now;
          this.armedAt = 0;
          this.phase = "settling";
          return { confirmed: false, phase: "timeout" };
        }
        if (Math.abs(position - this.anchor) <= this.returnDelta) {
          this.cooldownUntil = now + this.cooldownMs;
          this.reset();
          return { confirmed: true, phase: "confirmed" };
        }
      }
      return { confirmed: false, phase: this.phase };
    }
  }

  function taskMatchesTournament(task) {
    return (
      task.action === "route" &&
      task.count === 3 &&
      task.color === "cobalt" &&
      task.time === "14:30" &&
      task.fragile === true &&
      task.destination === "ORION-7" &&
      task.gate === "North Gate"
    );
  }

  function routeSummary(task) {
    if (!taskComplete(task)) {
      return "Route draft incomplete";
    }
    const handling = task.fragile ? "fragile" : "standard";
    return `${task.count} ${task.color} beacons · ${task.time} · ${handling} · ${task.destination} via ${task.gate}`;
  }

  function firstMissingField(task) {
    return FIELD_ORDER.find((field) => task[field] === null || task[field] === undefined) || null;
  }

  function initialMetrics() {
    return {
      errors: 0,
      voiceRepairs: 0,
      dwellMs: 0,
      dwellCancellations: 0,
      gesturesSeen: 0,
      gestureConfirmations: 0,
      voiceConfirmations: 0,
      keyboardConfirmations: 0,
      touchConfirmations: 0,
      sensorLosses: 0,
      sensorTransitions: [],
      commits: 0,
      falseCommits: 0,
      blockedActions: 0,
      undos: 0,
      cancels: 0,
      elapsedMs: 0,
    };
  }

  class VoiceOrbitMachine {
    constructor(configuration) {
      const options = configuration || {};
      this.clock = typeof options.clock === "function" ? options.clock : () => Date.now();
      this.undoStack = [];
      this.state = {
        version: "voice-orbit/1",
        status: "idle",
        stage: "intent",
        mode: null,
        frozen: false,
        freezeReason: null,
        startedAt: null,
        stoppedAt: null,
        completedAt: null,
        confirmedAt: null,
        returnedHome: false,
        committed: false,
        task: clone(TASK_TEMPLATE),
        highlight: null,
        highlightSource: null,
        prompt: "Start, then speak a broad intent.",
        options: [],
        sensors: {
          camera: "off",
          microphone: "off",
          speech: "off",
          estimator: "waiting",
        },
        metrics: initialMetrics(),
        events: [],
        exportRequested: 0,
        lastAction: "idle",
      };
      this._refresh();
    }

    _elapsed() {
      if (this.state.startedAt === null) {
        return 0;
      }
      const terminalAt =
        this.state.completedAt !== null
          ? this.state.completedAt
          : this.state.stoppedAt !== null
            ? this.state.stoppedAt
            : this.clock();
      return Math.max(0, terminalAt - this.state.startedAt);
    }

    _log(type, detail) {
      this.state.events.push({
        t: this._elapsed(),
        type,
        detail: detail ? clone(detail) : {},
      });
      if (this.state.events.length > 500) {
        this.state.events.shift();
      }
    }

    _snapshot(label) {
      this.undoStack.push({
        label,
        stage: this.state.stage,
        task: clone(this.state.task),
        committed: this.state.committed,
        returnedHome: this.state.returnedHome,
        completedAt: this.state.completedAt,
        confirmedAt: this.state.confirmedAt,
      });
      if (this.undoStack.length > 20) {
        this.undoStack.shift();
      }
    }

    _restore(snapshot) {
      this.state.stage = snapshot.stage;
      this.state.task = clone(snapshot.task);
      this.state.committed = snapshot.committed;
      this.state.returnedHome = snapshot.returnedHome;
      this.state.completedAt = snapshot.completedAt;
      this.state.confirmedAt = snapshot.confirmedAt;
      this.state.highlight = null;
      this.state.highlightSource = null;
    }

    _routeLocked() {
      return (
        this.state.committed ||
        this.state.returnedHome ||
        this.state.stage === "committed" ||
        this.state.stage === "complete"
      );
    }

    _prepareDraftMutation(source) {
      if (this._routeLocked()) {
        this.state.metrics.blockedActions += 1;
        this._log("draft.mutation.blocked", { source, stage: this.state.stage });
        return false;
      }
      this.state.committed = false;
      this.state.returnedHome = false;
      this.state.confirmedAt = null;
      this.state.completedAt = null;
      return true;
    }

    _setDraftField(field, value) {
      if (!this._prepareDraftMutation("prediction")) {
        return false;
      }
      if (field === "destination" && !isSupportedDestination(value)) {
        this.state.metrics.errors += 1;
        this._log("draft.destination.rejected", { value });
        return false;
      }
      this.state.task.action = "route";
      this.state.task[field] = value;
      this.state.stage = taskComplete(this.state.task) ? "review" : "collect";
      this.state.highlight = null;
      this.state.highlightSource = null;
      this._log("draft.updated", { field, value });
      return true;
    }

    _fieldOptions(field) {
      const options = {
        count: [
          ["count-1", "One beacon", "1", 1],
          ["count-2", "Two beacons", "2", 2],
          ["count-3", "Three beacons", "3", 3],
          ["count-4", "Four beacons", "4", 4],
          ["count-5", "Five beacons", "5", 5],
          ["cancel", "Cancel route", "rest", null],
        ],
        color: [
          ["color-cobalt", "Cobalt", "color", "cobalt"],
          ["color-amber", "Amber", "color", "amber"],
          ["color-crimson", "Crimson", "color", "crimson"],
          ["color-silver", "Silver", "color", "silver"],
          ["repeat", "Repeat prompt", "voice", null],
          ["cancel", "Cancel route", "rest", null],
        ],
        time: [
          ["time-1430", "14:30", "time", "14:30"],
          ["time-1200", "12:00", "time", "12:00"],
          ["time-1600", "16:00", "time", "16:00"],
          ["time-1800", "18:00", "time", "18:00"],
          ["repeat", "Repeat prompt", "voice", null],
          ["cancel", "Cancel route", "rest", null],
        ],
        fragile: [
          ["fragile-yes", "Mark fragile", "care", true],
          ["fragile-no", "Standard handling", "care", false],
          ["repeat", "Repeat prompt", "voice", null],
          ["cancel", "Cancel route", "rest", null],
        ],
        destination: [
          ["destination-orion", "ORION-7", "destination", "ORION-7"],
          ["destination-luna", "LUNA-3", "destination", "LUNA-3"],
          ["destination-atlas", "ATLAS-2", "destination", "ATLAS-2"],
          ["destination-polaris", "POLARIS-4", "destination", "POLARIS-4"],
          ["repeat", "Repeat prompt", "voice", null],
          ["cancel", "Cancel route", "rest", null],
        ],
        gate: [
          ["gate-north", "North Gate", "gate", "North Gate"],
          ["gate-south", "South Gate", "gate", "South Gate"],
          ["gate-east", "East Gate", "gate", "East Gate"],
          ["gate-west", "West Gate", "gate", "West Gate"],
          ["repeat", "Repeat prompt", "voice", null],
          ["cancel", "Cancel route", "rest", null],
        ],
      };
      return options[field].map(([id, label, hint, value]) => ({
        id,
        label,
        hint,
        kind: "field",
        field,
        value,
      }));
    }

    _optionsForStage() {
      if (this.state.stage === "intent") {
        return [
          { id: "intent-route", label: "Route beacons", hint: "dispatch" },
          { id: "intent-locate", label: "Locate cargo", hint: "search" },
          { id: "intent-inspect", label: "Inspect status", hint: "read only" },
          { id: "intent-hold", label: "Hold position", hint: "safe" },
          { id: "intent-help", label: "Voice guide", hint: "help" },
          { id: "stop", label: "Stop sensors", hint: "stop" },
        ];
      }
      if (this.state.stage === "collect") {
        return this._fieldOptions(firstMissingField(this.state.task));
      }
      if (this.state.stage === "review") {
        return [
          { id: "confirm-route", label: "Confirm route", hint: "explicit commit" },
          { id: "change-time", label: "Change time", hint: this.state.task.time },
          { id: "change-cargo", label: "Change cargo", hint: `${this.state.task.count} ${this.state.task.color}` },
          { id: "change-destination", label: "Change destination", hint: this.state.task.destination },
          { id: "cancel", label: "Cancel draft", hint: "safe rest" },
          { id: "stop", label: "Stop sensors", hint: "priority" },
        ];
      }
      if (this.state.stage === "committed") {
        return [
          { id: "return-home", label: "Return home", hint: "finish task" },
          { id: "undo", label: "Undo confirmation", hint: "reversible" },
          { id: "export", label: "Export local record", hint: "JSON" },
          { id: "inspect", label: "Read route summary", hint: "no change" },
          { id: "new-route", label: "New route", hint: "clear draft" },
          { id: "stop", label: "Stop sensors", hint: "priority" },
        ];
      }
      if (this.state.stage === "complete") {
        return [
          { id: "export", label: "Export local record", hint: "JSON" },
          { id: "undo", label: "Undo return home", hint: "reversible" },
          { id: "new-route", label: "New route", hint: "start again" },
          { id: "stop", label: "Stop sensors", hint: "privacy" },
        ];
      }
      return [];
    }

    _promptForStage() {
      const fallback = this.state.mode === "fallback";
      if (this.state.frozen) {
        return `Inputs frozen — ${this.state.freezeReason || "sensor unavailable"}. Stop, cancel, and undo remain available.`;
      }
      if (this.state.status === "stopped") {
        return "Sensors stopped. No media tracks remain active.";
      }
      if (this.state.stage === "intent") {
        return fallback
          ? "Use arrows or touch to highlight Route beacons, then explicitly confirm."
          : "Speak a broad intent, such as “route three cobalt beacons.”";
      }
      if (this.state.stage === "collect") {
        const field = firstMissingField(this.state.task);
        return fallback
          ? `Choose the ${field} prediction, then explicitly confirm.`
          : `Route understood. Speak ${field}, or aim at a prediction and say “select.”`;
      }
      if (this.state.stage === "review") {
        return fallback
          ? "Draft complete. Highlight Confirm route, then press Enter or the confirm button."
          : "Draft complete. Aim at Confirm route, then say “select” or nod deliberately.";
      }
      if (this.state.stage === "committed") {
        return fallback
          ? "Route confirmed locally. Highlight Return home and explicitly confirm."
          : "Route confirmed locally. Aim at Return home and explicitly confirm.";
      }
      if (this.state.stage === "complete") {
        return fallback
          ? "Task complete and home restored. Export is available as a local JSON record."
          : "Task complete and home restored. Say “export” for a local JSON record.";
      }
      return "Voice Orbit ready.";
    }

    _refresh() {
      this.state.options = this._optionsForStage();
      if (
        this.state.highlight !== null &&
        (this.state.highlight < 0 || this.state.highlight >= this.state.options.length)
      ) {
        this.state.highlight = null;
        this.state.highlightSource = null;
      }
      this.state.prompt = this._promptForStage();
      this.state.metrics.elapsedMs = this._elapsed();
    }

    _cancel(reason) {
      this.state.metrics.cancels += 1;
      this.state.highlight = null;
      this.state.highlightSource = null;
      if (!this.state.committed) {
        this.state.task = clone(TASK_TEMPLATE);
        this.state.stage = "intent";
      }
      this.state.lastAction = "cancel";
      this._log("safety.cancel", { reason: reason || "command" });
    }

    _undo(source) {
      const snapshot = this.undoStack.pop();
      if (!snapshot) {
        if (source === "voice") {
          this.state.metrics.voiceRepairs += 1;
        }
        this._log("safety.undo.empty", { source });
        return;
      }
      this._restore(snapshot);
      this.state.metrics.undos += 1;
      this.state.lastAction = "undo";
      this._log("safety.undo", { source, restored: snapshot.label });
    }

    _stop(source) {
      if (this.state.stoppedAt === null) {
        this.state.stoppedAt = this.clock();
      }
      this.state.status = "stopped";
      this.state.frozen = true;
      this.state.freezeReason = "stopped by user";
      this.state.highlight = null;
      this.state.highlightSource = null;
      this.state.sensors.camera = "off";
      this.state.sensors.microphone = "off";
      this.state.sensors.speech = "off";
      this.state.sensors.estimator = "off";
      this.state.lastAction = "stop";
      this._log("safety.stop", { source });
    }

    _sensorReady() {
      const ready = (value) => value === "active" || value === "simulated";
      const estimatorReady = ["active", "simulated", "head-fallback", "motion-fallback"].includes(
        this.state.sensors.estimator,
      );
      return (
        ready(this.state.sensors.camera) &&
        ready(this.state.sensors.microphone) &&
        estimatorReady
      );
    }

    _updateSensor(action) {
      const sensor = action.sensor;
      if (!Object.prototype.hasOwnProperty.call(this.state.sensors, sensor)) {
        return;
      }
      const previous = this.state.sensors[sensor];
      this.state.sensors[sensor] = action.status;
      const transition = {
        t: this._elapsed(),
        sensor,
        from: previous,
        to: action.status,
        reason: action.reason || null,
      };
      this.state.metrics.sensorTransitions.push(transition);
      this._log("sensor.transition", transition);

      const lossStates = ["lost", "denied", "unavailable", "error"];
      if (
        (sensor === "camera" || sensor === "microphone" || sensor === "estimator") &&
        lossStates.includes(action.status)
      ) {
        if (!this.state.frozen) {
          this.state.metrics.sensorLosses += 1;
        }
        this.state.frozen = true;
        this.state.freezeReason = `${sensor} ${action.status}`;
        this.state.highlight = null;
        this.state.highlightSource = null;
        this._log("safety.freeze", { sensor, status: action.status });
      } else if (this.state.frozen && this.state.status !== "stopped" && this._sensorReady()) {
        this.state.frozen = false;
        this.state.freezeReason = null;
        this._log("safety.resume", { reason: "required sensors restored" });
      }
    }

    _applyParsedSpeech(parsed) {
      if (!this._prepareDraftMutation("voice")) {
        return [];
      }
      if (parsed.destination && !isSupportedDestination(parsed.destination)) {
        this.state.metrics.errors += 1;
        this._log("draft.destination.rejected", { value: parsed.destination });
        return [];
      }
      const rejectedDestination = parsed.destinationRejected || null;
      const changed = [];
      if (parsed.action === "route" || this.state.task.action === "route") {
        this.state.task.action = "route";
      }
      Object.keys(parsed).forEach((field) => {
        if (field !== "action" && Object.prototype.hasOwnProperty.call(this.state.task, field)) {
          this.state.task[field] = parsed[field];
          changed.push(field);
        }
      });
      if (parsed.action === "route") {
        changed.unshift("action");
      }
      if (this.state.task.action === "route") {
        this.state.stage = taskComplete(this.state.task) ? "review" : "collect";
      }
      this.state.highlight = null;
      this.state.highlightSource = null;
      this._log("voice.values", { fields: changed });
      if (rejectedDestination) {
        this.state.metrics.errors += 1;
        this.state.metrics.voiceRepairs += 1;
        this.state.lastAction = "destination-rejected";
        this._log("draft.destination.rejected", { value: rejectedDestination });
      } else {
        this.state.lastAction = "voice-draft";
      }
      return changed;
    }

    _voice(action) {
      const speech = normalizeSpeech(action.text);
      const source = action.source || "speech";

      if (/\bstop\b/.test(speech)) {
        this._stop(source);
        return;
      }
      if (/\bcancel\b/.test(speech)) {
        this._cancel("voice");
        return;
      }
      if (/\bundo\b/.test(speech)) {
        this._undo("voice");
        return;
      }
      if (/\bexport\b/.test(speech)) {
        this.state.exportRequested += 1;
        this.state.lastAction = "export";
        this._log("record.export.requested", { source });
        return;
      }
      if (this.state.frozen) {
        this.state.metrics.blockedActions += 1;
        this._log("safety.blocked", { source, reason: this.state.freezeReason });
        return;
      }
      if (/^(select|confirm|choose|activate)(?:\s+(?:it|this|selection))?$/.test(speech)) {
        this._confirm(source === "keyboard" || source === "touch" ? source : "voice");
        return;
      }

      const exactOption = this.state.options.findIndex((option) => {
        const label = normalizeSpeech(option.label);
        return speech === label || speech.includes(label);
      });
      if (exactOption >= 0) {
        this.state.highlight = exactOption;
        this.state.highlightSource = "voice";
        this.state.lastAction = "voice-highlight";
        this._log("highlight.changed", {
          source: "voice",
          option: this.state.options[exactOption].id,
        });
        return;
      }

      const parsed = parseRouteUtterance(speech);
      if (this._routeLocked() && Object.keys(parsed).length > 0) {
        this.state.metrics.blockedActions += 1;
        this.state.lastAction = "route-locked";
        this._log("draft.mutation.blocked", { source, stage: this.state.stage });
        return;
      }
      const recognized =
        Object.keys(parsed).length > 0 ||
        (this.state.stage === "collect" &&
          Object.keys(parseRouteUtterance(`route ${speech}`)).length > 1);
      if (recognized) {
        const contextual =
          this.state.stage === "collect"
            ? { ...parseRouteUtterance(`route ${speech}`), ...parsed }
            : parsed;
        this._applyParsedSpeech(contextual);
        return;
      }

      this.state.metrics.voiceRepairs += 1;
      this.state.metrics.errors += 1;
      this.state.lastAction = "voice-repair";
      this._log("voice.repair", { reason: "no supported intent or value" });
    }

    _executeOption(option, source) {
      if (option.kind === "field") {
        if (option.id === "cancel") {
          this._cancel(source);
        } else if (option.id !== "repeat") {
          this._setDraftField(option.field, option.value);
        } else {
          this._log("prompt.repeat", { source });
        }
        return;
      }

      switch (option.id) {
        case "intent-route":
          this.state.task.action = "route";
          this.state.stage = "collect";
          this.state.lastAction = "route-intent";
          this._log("intent.selected", { intent: "route", source });
          break;
        case "confirm-route":
          if (!taskComplete(this.state.task)) {
            this.state.metrics.falseCommits += 1;
            this.state.metrics.errors += 1;
            this._log("commit.rejected", { reason: "incomplete task", source });
            break;
          }
          this._snapshot("route draft");
          this.state.committed = true;
          this.state.confirmedAt = this.clock();
          this.state.stage = "committed";
          this.state.metrics.commits += 1;
          this.state.lastAction = "route-confirmed";
          this._log("commit.route", { source, taskExact: taskMatchesTournament(this.state.task) });
          break;
        case "return-home":
          if (!this.state.committed) {
            this.state.metrics.falseCommits += 1;
            this._log("commit.rejected", { reason: "route not confirmed", source });
            break;
          }
          this._snapshot("confirmed route");
          this.state.returnedHome = true;
          this.state.stage = "complete";
          this.state.completedAt = this.clock();
          this.state.metrics.commits += 1;
          this.state.lastAction = "home";
          this._log("task.complete", {
            source,
            taskExact: taskMatchesTournament(this.state.task),
          });
          break;
        case "change-time":
          if (!this._prepareDraftMutation(source)) {
            break;
          }
          this.state.task.time = null;
          this.state.stage = "collect";
          this._log("draft.revise", { field: "time", source });
          break;
        case "change-cargo":
          if (!this._prepareDraftMutation(source)) {
            break;
          }
          this.state.task.count = null;
          this.state.task.color = null;
          this.state.stage = "collect";
          this._log("draft.revise", { field: "cargo", source });
          break;
        case "change-destination":
          if (!this._prepareDraftMutation(source)) {
            break;
          }
          this.state.task.destination = null;
          this.state.stage = "collect";
          this._log("draft.revise", { field: "destination", source });
          break;
        case "undo":
          this._undo(source);
          break;
        case "cancel":
          this._cancel(source);
          break;
        case "stop":
          this._stop(source);
          break;
        case "export":
          this.state.exportRequested += 1;
          this.state.lastAction = "export";
          this._log("record.export.requested", { source });
          break;
        case "new-route":
          this._snapshot("current route");
          this.state.task = clone(TASK_TEMPLATE);
          this.state.committed = false;
          this.state.returnedHome = false;
          this.state.completedAt = null;
          this.state.confirmedAt = null;
          this.state.stage = "intent";
          this.state.lastAction = "new-route";
          this._log("route.reset", { source });
          break;
        case "inspect":
        case "intent-inspect":
        case "intent-locate":
        case "intent-hold":
        case "intent-help":
          this.state.lastAction = option.id;
          this._log("read.only", { option: option.id, source });
          break;
        default:
          this.state.metrics.errors += 1;
          this._log("option.unsupported", { option: option.id, source });
      }
    }

    _confirm(source) {
      if (this.state.frozen || this.state.status === "stopped") {
        this.state.metrics.blockedActions += 1;
        this._log("safety.blocked", { source, reason: this.state.freezeReason || "stopped" });
        return;
      }
      if (this.state.highlight === null || !this.state.options[this.state.highlight]) {
        this.state.metrics.voiceRepairs += source === "voice" ? 1 : 0;
        this._log("confirm.rejected", { source, reason: "nothing highlighted" });
        return;
      }

      const option = this.state.options[this.state.highlight];
      if (source === "voice") {
        this.state.metrics.voiceConfirmations += 1;
      } else if (source === "gesture") {
        this.state.metrics.gestureConfirmations += 1;
      } else if (source === "keyboard") {
        this.state.metrics.keyboardConfirmations += 1;
      } else if (source === "touch") {
        this.state.metrics.touchConfirmations += 1;
      }
      this.state.highlight = null;
      this.state.highlightSource = null;
      this._executeOption(option, source);
    }

    dispatch(action) {
      if (!action || typeof action.type !== "string") {
        return this.state;
      }

      switch (action.type) {
        case "START":
          if (this.state.status === "idle" || this.state.status === "stopped") {
            this.state.status = "active";
            this.state.mode = action.mode || "live";
            this.state.frozen = false;
            this.state.freezeReason = null;
            this.state.startedAt = this.clock();
            this.state.stoppedAt = null;
            this.state.completedAt = null;
            if (action.mode === "simulation") {
              this.state.sensors.camera = "simulated";
              this.state.sensors.microphone = "simulated";
              this.state.sensors.speech = "simulated";
              this.state.sensors.estimator = "simulated";
            } else if (action.mode === "fallback") {
              this.state.sensors.camera = "not-requested";
              this.state.sensors.microphone = "not-requested";
              this.state.sensors.speech = "disabled";
              this.state.sensors.estimator = "not-requested";
            } else {
              this.state.sensors.camera = "requesting";
              this.state.sensors.microphone = "requesting";
              this.state.sensors.speech = "requesting";
              this.state.sensors.estimator = "calibrating";
            }
            this.state.lastAction = "start";
            this._log("session.start", { mode: this.state.mode });
          }
          break;
        case "VOICE":
          this._voice(action);
          break;
        case "HIGHLIGHT": {
          if (this.state.frozen || this.state.status !== "active") {
            this.state.metrics.blockedActions += 1;
            break;
          }
          const isCenter = action.index === null || action.source === "center";
          if (isCenter) {
            if (this.state.highlight !== null) {
              this.state.metrics.dwellCancellations += 1;
            }
            this.state.highlight = null;
            this.state.highlightSource = "center";
            this.state.lastAction = "rest";
            this._log("highlight.center-rest", { source: action.source || "center" });
          } else if (
            Number.isInteger(action.index) &&
            action.index >= 0 &&
            action.index < this.state.options.length
          ) {
            this.state.highlight = action.index;
            this.state.highlightSource = action.source || "gaze";
            this.state.lastAction = "highlight";
            this._log("highlight.changed", {
              source: this.state.highlightSource,
              option: this.state.options[action.index].id,
            });
          }
          break;
        }
        case "DWELL":
          if (!this.state.frozen && this.state.highlight !== null) {
            const duration = Math.max(0, Number(action.duration) || 0);
            this.state.metrics.dwellMs += duration;
            this.state.lastAction = "dwell";
            this._log("highlight.dwell", {
              duration,
              option: this.state.options[this.state.highlight].id,
              executes: false,
            });
          }
          break;
        case "CONFIRM":
          this._confirm(action.source || "keyboard");
          break;
        case "GESTURE":
          this.state.metrics.gesturesSeen += 1;
          this._log("gesture.detected", { gesture: action.gesture || "unknown" });
          if (action.gesture === "cancel" || action.gesture === "shake") {
            this._cancel("gesture");
          } else if (action.gesture === "confirm" || action.gesture === "nod") {
            this._confirm("gesture");
          }
          break;
        case "CANCEL":
          this._cancel(action.source || "keyboard");
          break;
        case "UNDO":
          this._undo(action.source || "keyboard");
          break;
        case "STOP":
          this._stop(action.source || "system");
          break;
        case "SENSOR":
          this._updateSensor(action);
          break;
        case "ERROR":
          this.state.metrics.errors += 1;
          this._log("error", { area: action.area || "unknown", code: action.code || "unspecified" });
          break;
        default:
          this.state.metrics.errors += 1;
          this._log("action.unknown", { type: action.type });
      }

      this._refresh();
      return this.state;
    }

    exportRecord() {
      this._refresh();
      return {
        schema: "voice-orbit.instrumentation.v1",
        generatedAt: new Date(this.clock()).toISOString(),
        privacy: {
          rawFramesStored: false,
          rawAudioStored: false,
          rawTranscriptsStored: false,
          applicationNetworkClientsUsed: false,
          browserSpeechServiceMayUseNetwork: this.state.mode === "live",
        },
        mode: this.state.mode,
        status: this.state.status,
        stage: this.state.stage,
        task: clone(this.state.task),
        taskExact: taskMatchesTournament(this.state.task),
        committed: this.state.committed,
        returnedHome: this.state.returnedHome,
        complete: this.state.stage === "complete" && this.state.returnedHome,
        sensors: clone(this.state.sensors),
        metrics: clone(this.state.metrics),
        events: clone(this.state.events),
      };
    }
  }

  function runDeterministicSimulation() {
    let time = 0;
    const machine = new VoiceOrbitMachine({ clock: () => time });
    machine.dispatch({ type: "START", mode: "simulation" });

    time = 400;
    machine.dispatch({
      type: "VOICE",
      source: "simulation",
      text: "Route three cobalt beacons at 14:30, fragile, to ORION-7 through North Gate",
    });

    time = 700;
    let optionIndex = machine.state.options.findIndex((option) => option.id === "confirm-route");
    machine.dispatch({ type: "HIGHLIGHT", index: optionIndex, source: "simulation-gaze" });

    time = 1500;
    machine.dispatch({ type: "DWELL", duration: 800 });

    time = 1700;
    machine.dispatch({ type: "HIGHLIGHT", index: null, source: "center" });

    time = 1900;
    optionIndex = machine.state.options.findIndex((option) => option.id === "confirm-route");
    machine.dispatch({ type: "HIGHLIGHT", index: optionIndex, source: "simulation-gaze" });

    time = 2100;
    machine.dispatch({ type: "VOICE", source: "simulation", text: "select" });

    time = 2400;
    optionIndex = machine.state.options.findIndex((option) => option.id === "return-home");
    machine.dispatch({ type: "HIGHLIGHT", index: optionIndex, source: "simulation-gaze" });

    time = 2700;
    machine.dispatch({ type: "GESTURE", gesture: "nod", source: "simulation-camera" });

    time = 12700;
    return {
      machine,
      record: machine.exportRecord(),
    };
  }

  return {
    SUPPORTED_DESTINATIONS,
    TASK_TEMPLATE,
    NodGestureGate,
    VoiceOrbitMachine,
    isSupportedDestination,
    normalizeDestinationIdentifier,
    normalizeSpeech,
    parseRouteUtterance,
    routeSummary,
    taskComplete,
    taskMatchesTournament,
    runDeterministicSimulation,
  };
});
