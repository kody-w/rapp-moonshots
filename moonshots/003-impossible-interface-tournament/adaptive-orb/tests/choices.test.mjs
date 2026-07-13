import assert from "node:assert/strict";
import test from "node:test";
import {
  applyChoicePresentation,
  choicePresentation,
  exactChoiceSignature,
} from "../src/choices.mjs";

test("choice signatures include full content, executable fields, order, and length", () => {
  const original = {
    id: "reused",
    label: "Old label",
    detail: "Old detail",
    prompt: "Old prompt",
    effect: "conversation-action",
    branch: "old-branch",
    intentionalWrong: false,
  };
  const baseline = exactChoiceSignature("orbit", [original]);
  for (const replacement of [
    { ...original, label: "New label" },
    { ...original, detail: "New detail" },
    { ...original, prompt: "New prompt" },
    { ...original, effect: "task-demo" },
    { ...original, branch: "new-branch" },
    { ...original, intentionalWrong: true },
  ]) {
    assert.notEqual(exactChoiceSignature("orbit", [replacement]), baseline);
  }
  assert.notEqual(exactChoiceSignature("compass", [original]), baseline);
  assert.notEqual(exactChoiceSignature("orbit", [original, original]), baseline);
  assert.equal(
    exactChoiceSignature("orbit", [
      {
        branch: "old-branch",
        prompt: "Old prompt",
        detail: "Old detail",
        label: "Old label",
        id: "reused",
        effect: "conversation-action",
        intentionalWrong: false,
      },
    ]),
    baseline,
  );
});

test("reused choice nodes refresh text, ARIA, and executable data", () => {
  const strong = { textContent: "" };
  const small = { textContent: "" };
  const attributes = {};
  const button = {
    dataset: {
      optionId: "reused",
      optionEffect: "task-demo",
      optionBranch: "stale-branch",
    },
    disabled: false,
    querySelector(selector) {
      return selector === "strong" ? strong : small;
    },
    setAttribute(name, value) {
      attributes[name] = value;
    },
  };
  applyChoicePresentation(
    button,
    choicePresentation(
      {
        id: "reused",
        label: "Fresh label",
        detail: "Fresh detail",
      },
      3,
      {
        highlightedId: "reused",
        armed: true,
        disabled: true,
        visibleIds: new Set(["reused"]),
      },
    ),
  );
  assert.equal(strong.textContent, "Fresh label");
  assert.equal(small.textContent, "Fresh detail");
  assert.match(attributes["aria-label"], /Fresh label\. Fresh detail/);
  assert.equal(attributes["aria-pressed"], "true");
  assert.equal(button.dataset.optionId, "reused");
  assert.equal(button.dataset.optionIndex, "3");
  assert.equal(button.dataset.highlighted, "true");
  assert.equal(button.dataset.armed, "true");
  assert.equal(button.dataset.phoneHidden, "false");
  assert.equal("optionEffect" in button.dataset, false);
  assert.equal("optionBranch" in button.dataset, false);
  assert.equal(button.disabled, true);
});
