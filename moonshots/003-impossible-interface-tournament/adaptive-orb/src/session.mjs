import { commitSensorFreeAfterTeardown } from "./core.mjs";

function performSensorFreeTransition({
  machine,
  controller,
  source,
  at,
  resume = false,
  render = () => {},
}) {
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

    const options = machine.state.options;
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

export { RadialAimCoordinator, performSensorFreeTransition };
