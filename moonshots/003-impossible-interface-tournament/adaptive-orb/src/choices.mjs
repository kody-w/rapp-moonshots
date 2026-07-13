function canonicalChoiceValue(value) {
  if (value === null) {
    return null;
  }
  if (Array.isArray(value)) {
    return value.map(canonicalChoiceValue);
  }
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalChoiceValue(value[key])]),
    );
  }
  if (["string", "boolean"].includes(typeof value)) {
    return value;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : { $number: String(value) };
  }
  if (typeof value === "undefined") {
    return { $undefined: true };
  }
  throw new TypeError("Choice fields must be public-safe serializable values");
}

function exactChoiceSignature(mode, choices) {
  const normalized = Array.isArray(choices) ? choices : [];
  return JSON.stringify({
    mode: String(mode || ""),
    length: normalized.length,
    choices: normalized.map(canonicalChoiceValue),
  });
}

function choicePresentation(
  candidate,
  index,
  {
    highlightedId = null,
    armed = false,
    disabled = false,
    visibleIds = null,
  } = {},
) {
  const id = String(candidate?.id || "");
  const label = String(candidate?.label || id);
  const detail = String(candidate?.detail || "");
  const visible =
    !(visibleIds instanceof Set) || visibleIds.size === 0 || visibleIds.has(id);
  return {
    id,
    label,
    detail,
    ariaLabel: `${detail ? `${label}. ${detail}.` : `${label}.`} Highlight only; separate confirmation required.`,
    highlighted: highlightedId === id,
    armed: armed && highlightedId === id,
    disabled: disabled === true,
    phoneHidden: !visible,
    index: String(index),
    effect: String(candidate?.effect || ""),
    branch: String(candidate?.branch || ""),
  };
}

function applyChoicePresentation(button, presentation) {
  const title = button.querySelector("strong");
  const detail = button.querySelector("small");
  title.textContent = presentation.label;
  detail.textContent = presentation.detail;
  button.disabled = presentation.disabled;
  button.dataset.optionId = presentation.id;
  button.dataset.optionIndex = presentation.index;
  button.dataset.highlighted = String(presentation.highlighted);
  button.dataset.armed = String(presentation.armed);
  button.dataset.phoneHidden = String(presentation.phoneHidden);
  if (presentation.effect) {
    button.dataset.optionEffect = presentation.effect;
  } else {
    delete button.dataset.optionEffect;
  }
  if (presentation.branch) {
    button.dataset.optionBranch = presentation.branch;
  } else {
    delete button.dataset.optionBranch;
  }
  button.setAttribute("aria-label", presentation.ariaLabel);
  button.setAttribute("aria-pressed", String(presentation.highlighted));
}

export {
  applyChoicePresentation,
  choicePresentation,
  exactChoiceSignature,
};
