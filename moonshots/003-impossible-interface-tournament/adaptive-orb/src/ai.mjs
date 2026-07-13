const AI_SCENARIOS = Object.freeze({
  create: Object.freeze({
    id: "create",
    title: "Create",
    detail: "Shape a draft from broad intent",
    prompt: "Help me create a calm launch story for a small accessibility tool.",
    mode: "orbit",
  }),
  plan: Object.freeze({
    id: "plan",
    title: "Plan",
    detail: "Compare stable priorities and next steps",
    prompt: "Plan a focused afternoon with four concrete priorities.",
    mode: "compass",
  }),
  explain: Object.freeze({
    id: "explain",
    title: "Explain",
    detail: "Travel through a layered explanation",
    prompt: "Explain how an offline-first application handles updates.",
    mode: "tunnel",
  }),
  navigate: Object.freeze({
    id: "navigate",
    title: "Navigate",
    detail: "Choose a route, tool, or scenario",
    prompt: "Navigate the cobalt beacon routing scenario.",
    mode: "compass",
  }),
});

const RESPONSE_SHAPES = Object.freeze({
  orbit: Object.freeze({
    breadth: 5,
    stable: false,
    depth: 0,
    hierarchical: false,
  }),
  compass: Object.freeze({
    breadth: 5,
    stable: true,
    depth: 1,
    hierarchical: false,
  }),
  tunnel: Object.freeze({
    breadth: 5,
    stable: false,
    depth: 3,
    hierarchical: true,
  }),
});

const DEMO_RESPONSES = Object.freeze({
  create: Object.freeze({
    message:
      "I framed the creative intent around calm confidence, local control, and one clear invitation. Choose the direction you want me to develop.",
    summary: "Creative direction framed around calm, local control",
    suggestions: Object.freeze([
      Object.freeze({
        id: "create-outline",
        label: "Outline",
        detail: "Build a concise story arc",
        prompt: "Develop a concise three-part outline.",
        branch: "outline",
      }),
      Object.freeze({
        id: "create-variations",
        label: "Variations",
        detail: "Explore several directions",
        prompt: "Generate three distinct creative directions.",
        branch: "variations",
      }),
      Object.freeze({
        id: "create-tone",
        label: "Tune the tone",
        detail: "Calm, direct, or playful",
        prompt: "Refine the voice to feel calm and direct.",
        branch: "tone",
      }),
      Object.freeze({
        id: "create-audience",
        label: "Audience",
        detail: "Focus the message",
        prompt: "Adapt the concept for first-time users.",
        branch: "audience",
      }),
      Object.freeze({
        id: "create-review",
        label: "Review",
        detail: "Inspect assumptions",
        prompt: "Review the concept for unclear assumptions.",
        branch: "review",
      }),
    ]),
    shape: RESPONSE_SHAPES.orbit,
  }),
  plan: Object.freeze({
    message:
      "I organized the plan into four stable priorities with recovery space. The compass is best here because the alternatives are bounded and comparable.",
    summary: "Four bounded priorities prepared for comparison",
    suggestions: Object.freeze([
      Object.freeze({
        id: "plan-focus",
        label: "Deep work",
        detail: "Protect the first focus block",
        prompt: "Prioritize the deep-work block.",
        branch: "focus",
      }),
      Object.freeze({
        id: "plan-people",
        label: "People",
        detail: "Group communication work",
        prompt: "Prioritize communication and collaboration.",
        branch: "people",
      }),
      Object.freeze({
        id: "plan-admin",
        label: "Admin",
        detail: "Clear bounded maintenance",
        prompt: "Prioritize the bounded administrative tasks.",
        branch: "admin",
      }),
      Object.freeze({
        id: "plan-buffer",
        label: "Recovery",
        detail: "Reserve transition time",
        prompt: "Protect recovery and transition time.",
        branch: "buffer",
      }),
      Object.freeze({
        id: "plan-risks",
        label: "Risks",
        detail: "Inspect schedule pressure",
        prompt: "Show the plan's main scheduling risks.",
        branch: "risks",
      }),
    ]),
    shape: RESPONSE_SHAPES.compass,
  }),
  explain: Object.freeze({
    message:
      "An offline-first update has nested layers: the page, the cache version, activation, and rollback. Enter a layer without losing the explanation above it.",
    summary: "Offline update explanation divided into nested layers",
    suggestions: Object.freeze([
      Object.freeze({
        id: "explain-cache",
        label: "Static cache",
        detail: "What is allowed offline",
        prompt: "Go deeper into the static cache allowlist.",
        branch: "cache",
      }),
      Object.freeze({
        id: "explain-update",
        label: "Update",
        detail: "Waiting worker and activation",
        prompt: "Go deeper into service worker update activation.",
        branch: "update",
      }),
      Object.freeze({
        id: "explain-rollback",
        label: "Rollback",
        detail: "Remove a bad worker safely",
        prompt: "Go deeper into unregister and rollback.",
        branch: "rollback",
      }),
      Object.freeze({
        id: "explain-privacy",
        label: "Privacy",
        detail: "What must never enter cache",
        prompt: "Go deeper into privacy exclusions.",
        branch: "privacy",
      }),
      Object.freeze({
        id: "explain-wrong",
        label: "Wrong branch",
        detail: "Intentional revision drill",
        prompt: "Open an intentionally irrelevant analytics branch.",
        branch: "wrong-analytics",
        intentionalWrong: true,
      }),
    ]),
    shape: RESPONSE_SHAPES.tunnel,
  }),
  navigate: Object.freeze({
    message:
      "I found a reversible local routing scenario. Choose the cobalt task for the full all-mode safety drill, or inspect another destination first.",
    summary: "Reversible navigation choices prepared",
    suggestions: Object.freeze([
      Object.freeze({
        id: "begin-cobalt-task",
        label: "Cobalt task",
        detail: "Run the exact routing scenario",
        prompt: "Begin the exact cobalt beacon task.",
        branch: "cobalt",
        effect: "task-demo",
      }),
      Object.freeze({
        id: "navigate-orion",
        label: "ORION-7",
        detail: "Inspect destination context",
        prompt: "Inspect ORION-7.",
        branch: "orion",
      }),
      Object.freeze({
        id: "navigate-gates",
        label: "Gate map",
        detail: "Compare four stable gates",
        prompt: "Show the gate map.",
        branch: "gates",
      }),
      Object.freeze({
        id: "navigate-tools",
        label: "Tools",
        detail: "Open the nested tool tunnel",
        prompt: "Open the navigation tools.",
        branch: "tools",
      }),
      Object.freeze({
        id: "navigate-home",
        label: "Home",
        detail: "Return to scenario petals",
        prompt: "Return to the scenario petals.",
        branch: "home",
      }),
    ]),
    shape: RESPONSE_SHAPES.compass,
  }),
});

const MAX_USER_INPUT = 4000;
const MAX_HISTORY_TURNS = 24;
const MAX_RESPONSE_TEXT = 12000;

function inferScenario(text, fallback = "create") {
  const normalized = String(text || "").toLowerCase();
  if (
    /\b(plan|schedule|priority|priorities|prioritize|prioritized|agenda)\b/.test(
      normalized,
    )
  ) {
    return "plan";
  }
  if (/\b(explain|understand|why|how does|how an|teach)\b/.test(normalized)) {
    return "explain";
  }
  if (/\b(navigate|route|destination|gate|cobalt|beacon)\b/.test(normalized)) {
    return "navigate";
  }
  if (/\b(create|write|design|draft|story|brainstorm)\b/.test(normalized)) {
    return "create";
  }
  return Object.hasOwn(AI_SCENARIOS, fallback) ? fallback : "create";
}

function validateConversationHistory(history) {
  if (!Array.isArray(history) || history.length > MAX_HISTORY_TURNS) {
    throw new TypeError("conversation_history must be a bounded array");
  }
  return history.map((turn) => {
    if (
      !turn ||
      !["user", "assistant"].includes(turn.role) ||
      typeof turn.content !== "string" ||
      turn.content.length === 0 ||
      turn.content.length > MAX_USER_INPUT
    ) {
      throw new TypeError("conversation_history contains an invalid turn");
    }
    return { role: turn.role, content: turn.content };
  });
}

function validateAIRequest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("AI request must be an object");
  }
  const keys = Object.keys(value).sort();
  if (
    JSON.stringify(keys) !==
    JSON.stringify(["conversation_history", "session_id", "user_input"])
  ) {
    throw new TypeError("AI request must use the Brainstem contract exactly");
  }
  if (
    typeof value.user_input !== "string" ||
    value.user_input.trim().length === 0 ||
    value.user_input.length > MAX_USER_INPUT
  ) {
    throw new TypeError("user_input is invalid");
  }
  if (
    typeof value.session_id !== "string" ||
    !/^[A-Za-z0-9._:-]{1,128}$/.test(value.session_id)
  ) {
    throw new TypeError("session_id is invalid");
  }
  return {
    user_input: value.user_input.trim(),
    conversation_history: validateConversationHistory(value.conversation_history),
    session_id: value.session_id,
  };
}

function normalizeSuggestion(value, index) {
  if (
    !value ||
    typeof value !== "object" ||
    typeof value.label !== "string" ||
    typeof value.prompt !== "string"
  ) {
    throw new TypeError("AI response contains an invalid suggestion");
  }
  const allowed = new Set([
    "id",
    "label",
    "detail",
    "prompt",
    "branch",
    "effect",
    "intentionalWrong",
  ]);
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    throw new TypeError("AI suggestion contains unsupported fields");
  }
  const label = value.label.trim().slice(0, 80);
  const prompt = value.prompt.trim().slice(0, MAX_USER_INPUT);
  if (!label || !prompt) {
    throw new TypeError("AI suggestion text is empty");
  }
  const rawId =
    typeof value.id === "string" && value.id
      ? value.id
      : `${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${index + 1}`;
  const id = rawId.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 80);
  return {
    id: id.startsWith("ai-") ? id : `ai-${id}`,
    label,
    detail:
      typeof value.detail === "string"
        ? value.detail.trim().slice(0, 120)
        : "Continue this conversation branch",
    prompt,
    branch:
      typeof value.branch === "string"
        ? value.branch.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 80)
        : id,
    effect: value.effect === "task-demo" ? "task-demo" : "conversation-action",
    intentionalWrong: value.intentionalWrong === true,
  };
}

function normalizeShape(value, scenario) {
  const fallback = DEMO_RESPONSES[scenario].shape;
  if (!value || typeof value !== "object") {
    return { ...fallback };
  }
  const breadth = Number(value.breadth);
  const depth = Number(value.depth);
  return {
    breadth:
      Number.isInteger(breadth) && breadth >= 1 && breadth <= 8
        ? breadth
        : fallback.breadth,
    stable: value.stable === true,
    depth: Number.isInteger(depth) && depth >= 0 && depth <= 12 ? depth : fallback.depth,
    hierarchical: value.hierarchical === true,
  };
}

function normalizeAIResponse(value, { scenarioHint = "create", provider = "demo" } = {}) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    typeof value.message !== "string"
  ) {
    throw new TypeError("AI response must contain message");
  }
  const allowed = new Set([
    "message",
    "scenario",
    "summary",
    "suggestions",
    "shape",
    "provider",
    "degraded",
    "notice",
  ]);
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    throw new TypeError("AI response contains unsupported fields");
  }
  const message = value.message.trim();
  if (!message || message.length > MAX_RESPONSE_TEXT) {
    throw new TypeError("AI response message is invalid");
  }
  const scenario = Object.hasOwn(AI_SCENARIOS, value.scenario)
    ? value.scenario
    : inferScenario(message, scenarioHint);
  const fallback = DEMO_RESPONSES[scenario];
  const rawSuggestions =
    Array.isArray(value.suggestions) && value.suggestions.length
      ? value.suggestions
      : fallback.suggestions;
  if (rawSuggestions.length < 4 || rawSuggestions.length > 8) {
    throw new TypeError("AI response must contain four to eight suggestions");
  }
  return {
    message,
    scenario,
    summary:
      typeof value.summary === "string" && value.summary.trim()
        ? value.summary.trim().slice(0, 180)
        : fallback.summary,
    suggestions: rawSuggestions.map(normalizeSuggestion),
    shape: normalizeShape(value.shape, scenario),
    provider: provider === "brainstem" ? "brainstem" : "demo",
    degraded: value.degraded === true,
    notice:
      typeof value.notice === "string" ? value.notice.trim().slice(0, 180) : null,
  };
}

function demoResponseFor(request, { scenarioHint } = {}) {
  const normalized = validateAIRequest(request);
  const scenario = inferScenario(normalized.user_input, scenarioHint);
  const fixture = DEMO_RESPONSES[scenario];
  let message = fixture.message;
  let summary = fixture.summary;
  const input = normalized.user_input.toLowerCase();
  if (scenario === "create" && /\boutline\b/.test(input)) {
    message =
      "I developed a three-part arc: name the human friction, show the calm adaptive moment, then close with local control. You can now revise tone, audience, or assumptions.";
    summary = "Three-part creative outline drafted";
  } else if (
    scenario === "plan" &&
    /\b(?:deep work|focus block)\b/.test(input)
  ) {
    message =
      "Deep work is now first, followed by communication, bounded admin, and a protected recovery buffer. The remaining compass petals let you inspect tradeoffs without losing the plan.";
    summary = "Deep work prioritized with recovery preserved";
  } else if (scenario === "explain" && /\banalytics\b/.test(input)) {
    message =
      "That analytics branch is intentionally outside this offline update explanation. It is marked as a wrong turn so undo can demonstrate return to the exact parent context.";
    summary = "Intentional wrong explanation branch identified";
  }
  return normalizeAIResponse(
    {
      ...fixture,
      message,
      summary,
      scenario,
    },
    { scenarioHint: scenario, provider: "demo" },
  );
}

class DemoAIAdapter {
  async respond(request, context = {}) {
    return demoResponseFor(request, context);
  }
}

class CompanionAIAdapter {
  constructor({
    fetchImpl = globalThis.fetch,
    endpoint = "/api/chat",
    timeoutMs = 9000,
  } = {}) {
    if (endpoint !== "/api/chat") {
      throw new TypeError("Companion endpoint must remain same-origin /api/chat");
    }
    this.fetchImpl = fetchImpl;
    this.endpoint = endpoint;
    this.timeoutMs = Math.min(15000, Math.max(1000, Number(timeoutMs) || 9000));
  }

  async respond(request, { scenarioHint, signal } = {}) {
    const normalized = validateAIRequest(request);
    if (typeof this.fetchImpl !== "function") {
      throw new Error("companion-fetch-unavailable");
    }
    const controller = new AbortController();
    const abortFromCaller = () => controller.abort();
    if (signal?.aborted) {
      controller.abort();
    } else {
      signal?.addEventListener("abort", abortFromCaller, { once: true });
    }
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(this.endpoint, {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        redirect: "error",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(normalized),
        signal: controller.signal,
      });
      if (!response?.ok) {
        throw new Error(`companion-http-${response?.status || "failed"}`);
      }
      const payload = await response.json();
      return normalizeAIResponse(payload, {
        scenarioHint,
        provider: "brainstem",
      });
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abortFromCaller);
    }
  }
}

class AdaptiveAIAdapter {
  constructor({
    demo = new DemoAIAdapter(),
    companion = new CompanionAIAdapter(),
  } = {}) {
    this.demo = demo;
    this.companion = companion;
  }

  async respond(
    request,
    { preferCompanion = false, scenarioHint, signal } = {},
  ) {
    if (preferCompanion) {
      try {
        return await this.companion.respond(request, { scenarioHint, signal });
      } catch {
        if (signal?.aborted) {
          throw new Error("ai-request-aborted");
        }
        const fallback = await this.demo.respond(request, { scenarioHint });
        return {
          ...fallback,
          degraded: true,
          notice: "Companion unavailable. Continued with the offline deterministic demo AI.",
        };
      }
    }
    return this.demo.respond(request, { scenarioHint });
  }
}

function createEphemeralSessionId(cryptoObject = globalThis.crypto) {
  if (typeof cryptoObject?.randomUUID === "function") {
    return `orb-${cryptoObject.randomUUID()}`;
  }
  const random = Math.random().toString(36).slice(2, 14);
  return `orb-${Date.now().toString(36)}-${random}`;
}

function buildBrainstemRequest(conversation) {
  const turns = Array.isArray(conversation?.turns) ? conversation.turns : [];
  let lastUserIndex = -1;
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    if (turns[index].role === "user") {
      lastUserIndex = index;
      break;
    }
  }
  if (lastUserIndex < 0) {
    throw new TypeError("Conversation has no user input");
  }
  const history = turns
    .slice(Math.max(0, lastUserIndex - MAX_HISTORY_TURNS), lastUserIndex)
    .filter(
      (turn) =>
        ["user", "assistant"].includes(turn.role) &&
        typeof turn.text === "string" &&
        turn.text.length > 0,
    )
    .map((turn) => ({
      role: turn.role,
      content: turn.text.slice(0, MAX_USER_INPUT),
    }))
    .slice(-MAX_HISTORY_TURNS);
  return validateAIRequest({
    user_input: turns[lastUserIndex].text,
    conversation_history: history,
    session_id: conversation.sessionId,
  });
}

function publicConversationSummary(conversation) {
  const turns = Array.isArray(conversation?.turns) ? conversation.turns : [];
  return {
    memoryOnly: true,
    textExported: false,
    turnCount: turns.length,
    activeScenario: conversation?.scenario || null,
    scenariosUsed: [...new Set(turns.map((turn) => turn.scenario).filter(Boolean))],
    branchDepth: Array.isArray(conversation?.branchPath)
      ? conversation.branchPath.length
      : 0,
    provider: conversation?.provider || "demo",
    degraded: conversation?.degraded === true,
    semanticTurns: turns.map((turn, index) => {
      const semanticTurn = {
        index: index + 1,
        role: turn.role,
        scenario: turn.scenario || null,
        semantic:
          turn.role === "assistant"
            ? `response:${turn.scenario || "general"}`
            : String(turn.semantic || "").startsWith("intent:")
              ? `intent:${turn.scenario || "general"}`
              : String(turn.semantic || "").startsWith("scenario:")
                ? `scenario:${turn.scenario || "general"}`
                : "choice-selected",
        mode: turn.mode || null,
      };
      if (turn.role === "assistant") {
        semanticTurn.provider = turn.provider || "demo";
      }
      return semanticTurn;
    }),
  };
}

export {
  AI_SCENARIOS,
  AdaptiveAIAdapter,
  CompanionAIAdapter,
  DEMO_RESPONSES,
  DemoAIAdapter,
  RESPONSE_SHAPES,
  buildBrainstemRequest,
  createEphemeralSessionId,
  demoResponseFor,
  inferScenario,
  normalizeAIResponse,
  publicConversationSummary,
  validateAIRequest,
};
