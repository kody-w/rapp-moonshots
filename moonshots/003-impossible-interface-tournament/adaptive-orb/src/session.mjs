import { commitSensorFreeAfterTeardown } from "./core.mjs";

function cancelGlobalSpeech(globalObject = globalThis) {
  try {
    globalObject?.speechSynthesis?.cancel?.();
    return typeof globalObject?.speechSynthesis?.cancel === "function";
  } catch {
    return false;
  }
}

function performSensorFreeTransition({
  machine,
  controller,
  source,
  at,
  resume = false,
  render = () => {},
  globalObject = globalThis,
}) {
  cancelGlobalSpeech(globalObject);
  if (controller) {
    controller.stop("sensor-free transition");
  }
  const result = commitSensorFreeAfterTeardown(machine, { source, at });
  if (resume && machine.state.freezeCauses.includes("user-stop")) {
    machine.dispatch({ type: "RESUME", source, at });
  }
  render();
  return { controller: null, result };
}

class ForegroundDeliveryGuard {
  constructor({
    isForeground = () =>
      typeof document === "undefined" ||
      (!document.hidden && document.visibilityState === "visible"),
  } = {}) {
    this.isForeground = isForeground;
    this.epoch = 0;
    this.foreground = Boolean(this.isForeground());
    this.interactionRequired = false;
  }

  capture() {
    return this.epoch;
  }

  background() {
    this.epoch += 1;
    this.foreground = false;
    this.interactionRequired = true;
    return this.epoch;
  }

  resume() {
    this.foreground = Boolean(this.isForeground());
    return this.foreground;
  }

  noteInteraction() {
    if (!this.isAvailable()) {
      return false;
    }
    this.interactionRequired = false;
    return true;
  }

  isAvailable() {
    return this.foreground && Boolean(this.isForeground());
  }

  canReveal(token = this.epoch) {
    return this.isAvailable() && token === this.epoch;
  }

  canDeliver(token) {
    return this.canReveal(token) && !this.interactionRequired;
  }

  canSpeak(token = this.epoch, { explicit = false } = {}) {
    return this.canReveal(token) && (explicit || !this.interactionRequired);
  }
}

async function deliverForegroundAIResponse({
  response,
  guard,
  token,
  signal,
  accept,
  reveal = () => {},
  speak = () => false,
}) {
  const value = await response;
  if (signal?.aborted) {
    return { delivered: false, reason: "aborted" };
  }
  if (!guard.canDeliver(token)) {
    return { delivered: false, reason: "foreground-invalidated" };
  }
  const accepted = accept(value);
  if (accepted === false || accepted?.ok === false) {
    return { delivered: false, reason: "response-rejected" };
  }
  if (!guard.canReveal(token)) {
    return { delivered: false, reason: "foreground-invalidated" };
  }
  reveal(value);
  const spoken = guard.canSpeak(token) ? speak(value) !== false : false;
  return { delivered: true, spoken };
}

class RadialAimCoordinator {
  constructor({ maximumGapMs = 350 } = {}) {
    this.maximumGapMs = maximumGapMs;
    this.reset();
  }

  reset() {
    this.id = null;
    this.at = null;
    this.zone = null;
  }

  synchronize(state) {
    if (state.freezeCauses.length || ["paused", "frozen", "stopped"].includes(state.status)) {
      this.reset();
      return;
    }
    if (this.zone === "center" && state.highlight === null) {
      return;
    }
    if (
      !state.highlight ||
      state.highlightSource !== "gaze" ||
      state.highlight !== this.id
    ) {
      this.reset();
    }
  }

  handle(machine, sample) {
    if (
      !sample ||
      !Number.isFinite(sample.at) ||
      machine.state.sessionKind !== "live" ||
      machine.state.freezeCauses.length ||
      ["paused", "frozen", "stopped"].includes(machine.state.status)
    ) {
      this.reset();
      return { ok: false, effect: "ignored", changed: false };
    }

    if (sample.zone === "center") {
      const changed = this.zone !== "center" || machine.state.highlight !== null;
      if (changed) {
        machine.dispatch({ type: "CENTER", source: "sensor-center", at: sample.at });
      }
      this.id = null;
      this.at = sample.at;
      this.zone = "center";
      return { ok: true, effect: "center", changed };
    }

    const requestedIds = Array.isArray(sample.optionIds)
      ? new Set(sample.optionIds)
      : null;
    const options = requestedIds
      ? machine.state.options.filter((option) => requestedIds.has(option.id))
      : machine.state.options;
    if (!options.length) {
      this.reset();
      return { ok: false, effect: "ignored", changed: false };
    }
    let angle = Math.atan2(sample.y - 0.5, sample.x - 0.5) + Math.PI / 2;
    if (angle < 0) {
      angle += Math.PI * 2;
    }
    const index =
      Math.floor((angle / (Math.PI * 2)) * options.length) % options.length;
    const id = options[index].id;

    if (
      id !== this.id ||
      this.zone === "center" ||
      machine.state.highlight !== id ||
      machine.state.highlightSource !== "gaze"
    ) {
      const result = machine.dispatch({
        type: "HIGHLIGHT",
        id,
        source: "gaze",
        at: sample.at,
      });
      this.id = id;
      this.at = sample.at;
      this.zone = "radial";
      return { ...result, changed: true };
    }

    const durationMs = sample.at - this.at;
    if (!Number.isFinite(durationMs) || durationMs <= 0) {
      return { ok: false, effect: "ignored", changed: false };
    }
    if (durationMs > this.maximumGapMs) {
      const result = machine.dispatch({ type: "DWELL", durationMs, at: sample.at });
      this.reset();
      return { ...result, changed: true };
    }

    const result = machine.dispatch({ type: "DWELL", durationMs, at: sample.at });
    this.at = sample.at;
    this.zone = "radial";
    return { ...result, changed: result.effect !== "ignored" };
  }
}

export {
  ForegroundDeliveryGuard,
  RadialAimCoordinator,
  cancelGlobalSpeech,
  deliverForegroundAIResponse,
  performSensorFreeTransition,
};
