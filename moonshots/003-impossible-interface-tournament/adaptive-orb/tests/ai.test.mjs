import assert from "node:assert/strict";
import test from "node:test";
import {
  AdaptiveAIAdapter,
  CLIENT_REQUEST_BUDGET_BYTES,
  CompanionAIAdapter,
  DemoAIAdapter,
  buildBrainstemRequest,
  demoResponseFor,
  normalizeAIResponse,
  publicConversationSummary,
  validateAIRequest,
} from "../src/ai.mjs";

const request = {
  user_input: "Plan four priorities.",
  conversation_history: [
    { role: "user", content: "Create a calm concept." },
    { role: "assistant", content: "A calm concept is ready." },
  ],
  session_id: "orb-test-session",
};

test("demo AI is deterministic, offline, and covers scenario response shapes", async () => {
  let networkCalls = 0;
  const ai = new AdaptiveAIAdapter({
    demo: new DemoAIAdapter(),
    companion: new CompanionAIAdapter({
      fetchImpl: async () => {
        networkCalls += 1;
        throw new Error("must not run");
      },
    }),
  });
  const first = await ai.respond(request);
  const second = await ai.respond(request);
  assert.deepEqual(first, second);
  assert.equal(first.provider, "demo");
  assert.equal(first.scenario, "plan");
  assert.equal(first.shape.stable, true);
  assert.equal(first.suggestions.length, 5);
  assert.equal(networkCalls, 0);
  const followUp = await ai.respond({
    ...request,
    user_input: "Prioritize the deep work block.",
  });
  assert.notEqual(followUp.message, first.message);
  assert.equal(
    followUp.summary,
    "Workshop checklist reordered with inspection first",
  );
});

test("companion uses only the exact same-origin Brainstem request contract", async () => {
  const calls = [];
  const companion = new CompanionAIAdapter({
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        async json() {
          return {
            message: "The companion prepared four bounded priorities.",
            scenario: "plan",
            summary: "Companion plan ready",
            suggestions: demoResponseFor(request).suggestions,
            shape: {
              breadth: 5,
              stable: true,
              depth: 1,
              hierarchical: false,
            },
          };
        },
      };
    },
  });
  const result = await companion.respond(request, { scenarioHint: "plan" });
  assert.equal(result.provider, "brainstem");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, "/api/session");
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.credentials, "same-origin");
  assert.equal(calls[0].options.cache, "no-store");
  assert.equal("body" in calls[0].options, false);
  assert.equal(calls[1].url, "/api/chat");
  assert.deepEqual(JSON.parse(calls[1].options.body), request);
  assert.equal(calls[1].options.credentials, "same-origin");
  assert.deepEqual(Object.keys(JSON.parse(calls[1].options.body)).sort(), [
    "conversation_history",
    "session_id",
    "user_input",
  ]);
  assert.equal("Authorization" in calls[1].options.headers, false);

  const maxHistory = Array.from({ length: 24 }, (_, index) => ({
    role: index % 2 === 0 ? "user" : "assistant",
    content: `${String(index).padStart(3, "0")}${"界".repeat(3997)}`,
  }));
  const maxResult = await companion.respond({
    ...request,
    user_input: "Preserve this current input.",
    conversation_history: maxHistory,
  });
  assert.equal(calls[2].url, "/api/session");
  assert.equal(calls[3].url, "/api/chat");
  const boundedBody = calls[3].options.body;
  const boundedRequest = JSON.parse(boundedBody);
  const byteLength = new TextEncoder().encode(boundedBody).byteLength;
  assert.equal(maxResult.provider, "brainstem");
  assert.ok(byteLength <= CLIENT_REQUEST_BUDGET_BYTES);
  assert.ok(byteLength < 64 * 1024);
  assert.ok(boundedRequest.conversation_history.length > 0);
  assert.ok(boundedRequest.conversation_history.length < maxHistory.length);
  assert.equal(boundedRequest.user_input, "Preserve this current input.");
  assert.deepEqual(
    boundedRequest.conversation_history,
    maxHistory.slice(-boundedRequest.conversation_history.length),
  );
});

test("companion failure visibly degrades to deterministic demo AI", async () => {
  const ai = new AdaptiveAIAdapter({
    companion: new CompanionAIAdapter({
      fetchImpl: async () => {
        throw new Error("offline");
      },
      timeoutMs: 1000,
    }),
  });
  const response = await ai.respond(request, {
    preferCompanion: true,
    scenarioHint: "plan",
  });
  assert.equal(response.provider, "demo");
  assert.equal(response.degraded, true);
  assert.match(response.notice, /Companion unavailable/);
});

test("caller abort stops companion work instead of producing a late fallback", async () => {
  const controller = new AbortController();
  const ai = new AdaptiveAIAdapter({
    companion: new CompanionAIAdapter({
      fetchImpl: async (_url, options) =>
        new Promise((_resolve, reject) => {
          options.signal.addEventListener(
            "abort",
            () => reject(new Error("aborted")),
            { once: true },
          );
        }),
      timeoutMs: 1000,
    }),
  });
  const pending = ai.respond(request, {
    preferCompanion: true,
    scenarioHint: "plan",
    signal: controller.signal,
  });
  controller.abort();
  await assert.rejects(pending, /ai-request-aborted/);
});

test("AI contract and response validation reject ambiguous or oversized shapes", () => {
  assert.throws(
    () => validateAIRequest({ ...request, api_key: "not-allowed" }),
    /contract exactly/,
  );
  assert.throws(
    () =>
      validateAIRequest({
        ...request,
        conversation_history: Array.from({ length: 25 }, () => ({
          role: "user",
          content: "bounded",
        })),
      }),
    /bounded array/,
  );
  assert.throws(() => normalizeAIResponse({ response: "wrong key" }), /message/);
  assert.throws(
    () => normalizeAIResponse({ message: "Valid text", debug: "forbidden" }),
    /unsupported fields/,
  );
  assert.throws(
    () =>
      normalizeAIResponse({
        message: "Valid text",
        suggestions: [{ label: "Only one", prompt: "Continue" }],
      }),
    /four to eight/,
  );
});

test("AI response rejects suggestion IDs that collide after normalization", () => {
  const responseWithIds = (ids) => ({
    message: "Choose one of four bounded options.",
    suggestions: ids.map((id, index) => ({
      id,
      label: `Option ${index + 1}`,
      prompt: `Continue option ${index + 1}`,
    })),
  });

  assert.throws(
    () =>
      normalizeAIResponse(
        responseWithIds(["same", "same", "third", "fourth"]),
      ),
    /unique after normalization/,
  );
  assert.throws(
    () =>
      normalizeAIResponse(
        responseWithIds([
          "North Gate",
          "North/Gate",
          "third",
          "fourth",
        ]),
      ),
    /unique after normalization/,
  );
  assert.throws(
    () =>
      normalizeAIResponse(
        responseWithIds(["ai-choice", "CHOICE", "third", "fourth"]),
      ),
    /unique after normalization/,
  );
});

test("conversation request preserves memory while public summary strips all text", () => {
  const conversation = {
    sessionId: "orb-test-session",
    scenario: "explain",
    provider: "demo",
    degraded: false,
    branchPath: ["cache"],
    turns: [
      {
        role: "user",
        text: "Explain a confidential phrase.",
        semantic: "intent:explain",
        scenario: "explain",
        mode: "orbit",
      },
      {
        role: "assistant",
        text: "A private answer.",
        semantic: "private semantic answer",
        scenario: "explain",
        mode: "tunnel",
        provider: "demo",
      },
      {
        role: "user",
        text: "Go deeper.",
        semantic: "choice:private-branch-token",
        scenario: "explain",
        mode: "tunnel",
      },
    ],
    branchPath: ["private-branch-token"],
  };
  const brainstem = buildBrainstemRequest(conversation);
  assert.equal(brainstem.user_input, "Go deeper.");
  assert.equal(brainstem.conversation_history.length, 2);
  const summary = publicConversationSummary(conversation);
  const serialized = JSON.stringify(summary);
  assert.equal(summary.turnCount, 3);
  assert.equal(summary.textExported, false);
  assert.equal(serialized.includes("confidential phrase"), false);
  assert.equal(serialized.includes("private answer"), false);
  assert.equal(serialized.includes("Go deeper"), false);
  assert.equal(serialized.includes("private semantic answer"), false);
  assert.equal(serialized.includes("private-branch-token"), false);
  assert.deepEqual(
    summary.semanticTurns.map((turn) => turn.semantic),
    ["intent:explain", "response:explain", "choice-selected"],
  );
});
