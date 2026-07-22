import {
  createChineseLanguagePack,
  createFrenchLanguagePack,
  createGoodMemory,
  createJapaneseLanguagePack,
  createKoreanLanguagePack,
  createLanguageService,
  createSpanishLanguagePack,
  inspectGoodMemoryRuntime,
} from "goodmemory";
import {
  createGoodMemoryAISDK,
  validateAgentInputEvent,
} from "goodmemory/ai-sdk";
import {
  createHostAdapter,
  resolveHostActionExecutionPlan,
  validateHostActionIntent,
  validateHostAgentEvent,
} from "goodmemory/host";
import { createGoodMemoryHttpMemoryBridge } from "goodmemory/http";

const LOCAL_DEFAULT_RUNTIME_ENV_KEYS = [
  "GOODMEMORY_STORAGE_PROVIDER",
  "GOODMEMORY_STORAGE_URL",
  "GOODMEMORY_EMBEDDING_PROVIDER",
  "GOODMEMORY_EMBEDDING_MODEL",
  "GOODMEMORY_EMBEDDING_API_KEY",
  "GOODMEMORY_EMBEDDING_BASE_URL",
  "GOODMEMORY_SQLITE_CUSTOM_LIBRARY_PATH",
  "GOODMEMORY_SQLITE_VECTOR_EXTENSION_PATH",
  "GOODMEMORY_SQLITE_VECTOR_EXTENSION_ENTRYPOINT",
  "GOODMEMORY_SQLITE_VECTOR_MODE",
  "GOODMEMORY_SQLITE_VECTOR_SEARCH_FUNCTION",
];

for (const key of LOCAL_DEFAULT_RUNTIME_ENV_KEYS) {
  delete process.env[key];
}

function createSingleChunkStream(value) {
  return {
    async *[Symbol.asyncIterator]() {
      yield value;
    },
  };
}

function serializeSystemPrompt(value) {
  if (typeof value === "string") {
    return value;
  }

  if (value === undefined) {
    return undefined;
  }

  return JSON.stringify(value);
}

function buildDeterministicStreamText() {
  return (input) => {
    const messages = input.messages ?? [];
    let lastUserMessage;

    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (message?.role === "user") {
        lastUserMessage = message;
        break;
      }
    }

    const userText =
      lastUserMessage && typeof lastUserMessage.content === "string"
        ? lastUserMessage.content
        : "What should I know?";
    const systemText = serializeSystemPrompt(input.system)?.toLowerCase() ?? "";
    const responseText = /remember/i.test(userText)
      ? "Noted. The blocker is prod verification."
      : systemText.includes("prod verification")
        ? "The blocker is still prod verification."
        : "I do not have a stored blocker yet.";
    const finishPromise = Promise.resolve(
      input.onFinish?.({
        text: responseText,
      }),
    );

    return {
      finishReason: Promise.resolve("stop"),
      text: finishPromise.then(() => responseText),
      textStream: {
        async *[Symbol.asyncIterator]() {
          await finishPromise;
          yield* createSingleChunkStream(responseText);
        },
      },
    };
  };
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isOptionalNonEmptyString(value) {
  return value === undefined || isNonEmptyString(value);
}

function isPlainServerScope(value) {
  return !!value
    && typeof value === "object"
    && !Array.isArray(value)
    && isNonEmptyString(value.userId)
    && isOptionalNonEmptyString(value.tenantId)
    && isOptionalNonEmptyString(value.workspaceId)
    && isOptionalNonEmptyString(value.agentId)
    && isOptionalNonEmptyString(value.sessionId);
}

function isPlainServerRequestBody(value) {
  return !!value && typeof value === "object" && !Array.isArray(value)
    && isPlainServerScope(value.scope) && Array.isArray(value.messages);
}

function createPlainAISDKServerHandler({ memory, onMemoryEvent, seenSystems }) {
  const aiSDK = createGoodMemoryAISDK({
    memory,
    onMemoryEvent,
    dependencies: {
      streamText: (input) => {
        seenSystems?.push(serializeSystemPrompt(input.system));
        return buildDeterministicStreamText()(input);
      },
    },
  });

  return async (request) => {
    const payload = await request.json();
    if (!isPlainServerRequestBody(payload)) {
      return new Response(
        JSON.stringify({
          error: "Expected a request body with a messages array and scope.userId.",
        }),
        {
          headers: {
            "content-type": "application/json; charset=utf-8",
          },
          status: 400,
        },
      );
    }

    const result = aiSDK.streamText({
      ...payload,
      model: {},
    });

    return result.toTextStreamResponse({
      headers: {
        "content-type": "text/plain; charset=utf-8",
      },
      status: 200,
    });
  };
}

const memoryScope = {
  userId: "consumer-memory-user",
  workspaceId: "consumer-memory-workspace",
};
const aiSDKScope = {
  userId: "consumer-ai-sdk-user",
  workspaceId: "consumer-ai-sdk-workspace",
};
const serverScope = {
  userId: "consumer-server-user",
  workspaceId: "consumer-server-workspace",
};

const memory = createGoodMemory({});
const runtimeInfo = inspectGoodMemoryRuntime(memory);
const language = createLanguageService({
  defaultLocale: "zh-TW",
  packs: [
    createChineseLanguagePack("Hant"),
    createJapaneseLanguagePack(),
    createKoreanLanguagePack(),
    createFrenchLanguagePack(),
    createSpanishLanguagePack(),
  ],
});
const traditionalChineseContext = language.resolveFromText({
  locale: "zh-TW",
  text: "繁體中文",
});
const traditionalChineseSearchTerms = language.buildSearchTerms(
  "繁體中文",
  traditionalChineseContext,
);
const japaneseContext = language.resolveFromText({
  locale: "ja-JP",
  text: "日本語の記憶",
});
const japaneseSearchTerms = language.buildSearchTerms(
  "日本語の記憶",
  japaneseContext,
);
const koreanContext = language.resolveFromText({
  locale: "ko-KR",
  text: "한국어 기억",
});
const koreanSearchTerms = language.buildSearchTerms(
  "한국어 기억",
  koreanContext,
);
const frenchContext = language.resolveFromText({
  locale: "fr-FR",
  text: "mémoire française",
});
const frenchSearchTerms = language.buildSearchTerms(
  "mémoire française",
  frenchContext,
);
const spanishContext = language.resolveFromText({
  locale: "es-ES",
  text: "memoria española",
});
const spanishSearchTerms = language.buildSearchTerms(
  "memoria española",
  spanishContext,
);
const serverEvents = [];
const serverSeenSystems = [];
const serverHandler = createPlainAISDKServerHandler({
  memory,
  onMemoryEvent: async (event) => {
    serverEvents.push(event);
  },
  seenSystems: serverSeenSystems,
});
const httpBridge = createGoodMemoryHttpMemoryBridge({ memory });

const explicitSqliteMemory = createGoodMemory({
  storage: {
    provider: "sqlite",
    url: "./consumer-node.sqlite",
  },
});
const explicitSqliteRuntimeInfo = inspectGoodMemoryRuntime(explicitSqliteMemory);

let explicitSqliteRememberError;

try {
  await explicitSqliteMemory.remember({
    scope: {
      userId: "consumer-user",
      workspaceId: "consumer-workspace",
      sessionId: "consumer-explicit-sqlite",
    },
    messages: [
      {
        role: "user",
        content: "Remember that explicit sqlite should not pretend to be durable on unsupported runtimes.",
      },
    ],
  });
} catch (error) {
  explicitSqliteRememberError = error instanceof Error ? error.message : String(error);
}

const explicitPostgresMemory = createGoodMemory({
  storage: {
    provider: "postgres",
    url: "postgres://localhost:5432/goodmemory",
  },
});
const explicitPostgresRuntimeInfo = inspectGoodMemoryRuntime(explicitPostgresMemory);

let explicitPostgresRememberError;

try {
  await explicitPostgresMemory.remember({
    scope: {
      userId: "consumer-user",
      workspaceId: "consumer-workspace",
      sessionId: "consumer-explicit-postgres",
    },
    messages: [
      {
        role: "user",
        content: "Remember that explicit postgres should not pretend to be durable on unsupported runtimes.",
      },
    ],
  });
} catch (error) {
  explicitPostgresRememberError = error instanceof Error ? error.message : String(error);
}

await memory.remember({
  scope: {
    ...memoryScope,
    sessionId: "consumer-memory-s0",
  },
  messages: [
    {
      role: "user",
      content: "Remember that I prefer concise release checklists.",
    },
  ],
});

const aiSDK = createGoodMemoryAISDK({
  memory,
  dependencies: {
    streamText: buildDeterministicStreamText(),
  },
});

const validatedToolEvent = validateAgentInputEvent({
  surface: "ai-sdk",
  kind: "tool_call",
  eventId: "consumer-event-1",
  runId: "consumer-run-1",
  turnId: "consumer-turn-1",
  sequence: 0,
  occurredAt: "2026-04-22T00:00:00.000Z",
  hostKind: "codex",
  scope: {
    ...memoryScope,
    sessionId: "consumer-memory-s1",
  },
  toolName: "QuickCheck",
  payload: {
    checks: ["network"],
    dryRun: true,
  },
});

const validatedFileEditEvent = validateHostAgentEvent({
  surface: "host",
  kind: "file_edit",
  eventId: "consumer-event-2",
  attemptId: "consumer-attempt-1",
  turnId: "consumer-turn-1",
  sequence: 1,
  occurredAt: "2026-04-22T00:00:01.000Z",
  parentEventId: "consumer-event-1",
  hostKind: "claude",
  scope: {
    ...memoryScope,
    sessionId: "consumer-memory-s1",
  },
  operation: "update",
  relativePath: "playbooks/consumer-checklist.md",
  summary: "Capture the installed-package smoke edit shape.",
});
const validatedHostActionIntent = validateHostActionIntent({
  actionId: "consumer-action-1",
  runId: "consumer-run-1",
  turnId: "consumer-turn-2",
  sequence: 2,
  occurredAt: "2026-04-22T00:00:02.000Z",
  hostKind: "claude",
  scope: {
    ...memoryScope,
    sessionId: "consumer-memory-s1",
  },
  action: {
    kind: "command",
    command: "deploy preview",
  },
});

const aiSDKResponseText = await aiSDK.streamText({
  scope: {
    ...aiSDKScope,
    sessionId: "consumer-ai-sdk-s1",
  },
  messages: [
    {
      role: "user",
      content: "Remember that the blocker is prod verification.",
    },
  ],
  system: "You are a concise project copilot.",
  model: {},
}).text;

const httpHeaders = {
  "content-type": "application/json",
  "x-goodmemory-operations": "recall-context,remember",
  "x-goodmemory-user-id": memoryScope.userId,
  "x-goodmemory-workspace-id": memoryScope.workspaceId,
};
const httpRememberResponse = await httpBridge.fetch(
  new Request("http://localhost/memory/remember", {
    body: JSON.stringify({
      idempotencyKey: "consumer-http-bridge-turn-1",
      messages: [
        {
          role: "user",
          content:
            "Remember that the HTTP package import works for Python bridge consumers.",
        },
      ],
      mode: "sync",
      scope: {
        ...memoryScope,
        sessionId: "consumer-http-bridge-s1",
      },
    }),
    headers: httpHeaders,
    method: "POST",
  }),
);
const httpRememberPayload = await httpRememberResponse.json();
const httpRecallResponse = await httpBridge.fetch(
  new Request("http://localhost/memory/recall-context", {
    body: JSON.stringify({
      query: "Which package import works for Python bridge consumers?",
      scope: {
        ...memoryScope,
        sessionId: "consumer-http-bridge-s2",
      },
    }),
    headers: httpHeaders,
    method: "POST",
  }),
);
const httpRecallPayload = await httpRecallResponse.json();

const firstServerResponse = await serverHandler(
  new Request("http://localhost/api/memory-chat", {
    body: JSON.stringify({
      messages: [
        {
          role: "user",
          content: "Remember that the blocker is prod verification.",
        },
      ],
      scope: {
        ...serverScope,
        sessionId: "consumer-server-s1",
      },
      system: "You are a concise project copilot.",
    }),
    headers: {
      "content-type": "application/json",
    },
    method: "POST",
  }),
);
const serverFirstResponseText = await firstServerResponse.text();

const secondServerResponse = await serverHandler(
  new Request("http://localhost/api/memory-chat", {
    body: JSON.stringify({
      messages: [
        {
          role: "user",
          content: "What is the blocker?",
        },
      ],
      query: "blocker prod verification",
      scope: {
        ...serverScope,
        sessionId: "consumer-server-s2",
      },
      system: "You are a concise project copilot.",
    }),
    headers: {
      "content-type": "application/json",
    },
    method: "POST",
  }),
);
const serverSecondResponseText = await secondServerResponse.text();

const invalidScopeResponse = await serverHandler(
  new Request("http://localhost/api/memory-chat", {
    body: JSON.stringify({
      messages: [
        {
          role: "user",
          content: "What is the blocker?",
        },
      ],
      scope: "consumer-server-user",
    }),
    headers: {
      "content-type": "application/json",
    },
    method: "POST",
  }),
);
const invalidScopeStatus = invalidScopeResponse.status;
const invalidScopeError = invalidScopeStatus === 400
  ? JSON.parse(await invalidScopeResponse.text()).error
  : undefined;

const recall = await memory.recall({
  scope: {
    ...memoryScope,
    sessionId: "consumer-memory-s2",
  },
  query: "What do I prefer in release communication?",
  retrievalProfile: "general_chat",
});
const context = await memory.buildContext({
  recall,
  output: "markdown",
  maxTokens: 160,
});

const adapter = createHostAdapter({
  id: "consumer-host",
  hostKind: "claude",
  memory,
  readableArtifactTypes: ["memory_index"],
});

const artifacts = await adapter.readArtifacts({
  scope: {
    ...memoryScope,
    sessionId: "consumer-memory-s1",
  },
});
const assessment = await adapter.assessAction(validatedHostActionIntent);
const executionPlan = resolveHostActionExecutionPlan({
  assessment,
  intent: validatedHostActionIntent,
});

console.log(
  JSON.stringify({
    aiSDKResponseText,
    assessmentDecision: assessment.decision,
    artifactPaths: artifacts.artifacts.map((artifact) => artifact.relativePath),
    contextIncludesChecklist: context.content.includes("concise release checklists"),
    executionPlanParentEventId: executionPlan.realizedEventParentId,
    executionPlanRewritten: executionPlan.rewritten,
    invalidScopeError,
    invalidScopeStatus,
    validatedFileEditPath:
      validatedFileEditEvent.kind === "file_edit"
        ? validatedFileEditEvent.relativePath
        : undefined,
    validatedHostActionIntentId: validatedHostActionIntent.actionId,
    validatedToolPayloadShape:
      validatedToolEvent.kind === "tool_call" &&
      validatedToolEvent.payload &&
      !Array.isArray(validatedToolEvent.payload)
        ? typeof validatedToolEvent.payload
        : "missing",
    ok: true,
    recallHitCount: recall.metadata.hits.length,
    explicitPostgresRememberError,
    explicitPostgresRuntimeInfo,
    explicitSqliteRememberError,
    explicitSqliteRuntimeInfo,
    httpBridgeContextIncludesPackageImport:
      httpRecallPayload.contextText.includes("HTTP package import works"),
    httpBridgeItemCount: httpRecallPayload.itemCount,
    httpBridgeRememberOk: httpRememberPayload.ok,
    runtimeInfo,
    frenchPackId: frenchContext.languagePackId,
    frenchSearchTerms,
    japanesePackId: japaneseContext.languagePackId,
    japaneseSearchTerms,
    koreanPackId: koreanContext.languagePackId,
    koreanSearchTerms,
    spanishPackId: spanishContext.languagePackId,
    spanishSearchTerms,
    traditionalChinesePackId: traditionalChineseContext.languagePackId,
    traditionalChineseSearchTerms,
    serverFirstResponseText,
    serverRecallApplied: serverEvents.some(
      (event) => event.phase === "recall" && event.status === "applied",
    ),
    serverRememberSucceeded: serverEvents.some(
      (event) => event.phase === "remember" && event.status === "succeeded",
    ),
    serverSecondResponseText,
    serverSecondSystem: serverSeenSystems[1],
  }),
);
