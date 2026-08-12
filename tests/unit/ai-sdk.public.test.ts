import { describe, expect, it, setSystemTime } from "bun:test";
import { generateText, streamText } from "ai";
import type { ModelMessage } from "@ai-sdk/provider-utils";

import type {
  BuildContextResult,
  GoodMemory,
  RecallInput,
  RecallResult,
  RememberInput,
  RememberResult,
} from "../../src/api/contracts";
import { createGoodMemoryAISDK } from "../../src/ai-sdk";
import type {
  GoodMemoryAISDKErrorEvent,
  GoodMemoryAISDKEvent,
  GoodMemoryModelMessage,
} from "../../src/ai-sdk";
import {
  createNoopGoodMemoryJobsFacade,
  createNoopGoodMemoryRuntimeFacade,
} from "../../src/testing/fakes";

function createRecallResult(): RecallResult {
  return {
    profile: null,
    preferences: [],
    references: [],
    facts: [],
    feedback: [],
    archives: [],
    evidence: [],
    episodes: [],
    workingMemory: null,
    journal: null,
    packet: {} as RecallResult["packet"],
    metadata: {
      routingDecision: {} as RecallResult["metadata"]["routingDecision"],
      tokenCount: 0,
      latencyMs: 0,
      hits: [],
      candidateTraces: [],
      verificationHints: [],
      policyApplied: [],
    },
  } as RecallResult;
}

function createBuildContextResult(content: string): BuildContextResult {
  return {
    output: "system_prompt_fragment",
    content,
    estimatedTokens: content.length,
    omittedSections: [],
  };
}

function createRememberResult(): RememberResult {
  return {
    accepted: 2,
    rejected: 0,
    events: [],
  };
}

function createGoodMemoryStub(input?: {
  buildContext?: () => Promise<BuildContextResult>;
  recall?: (payload: RecallInput) => Promise<RecallResult>;
  remember?: (payload: RememberInput) => Promise<RememberResult>;
}): GoodMemory {
  return {
    jobs: createNoopGoodMemoryJobsFacade(),
    runtime: createNoopGoodMemoryRuntimeFacade(),
    async recall(payload) {
      return (
        input?.recall?.(payload) ?? createRecallResult()
      );
    },
    async buildContext() {
      return input?.buildContext?.() ?? createBuildContextResult("## Facts\n- blocker");
    },
    async remember(payload) {
      return input?.remember?.(payload) ?? createRememberResult();
    },
    async forget() {
      return {
        forgotten: false,
      };
    },
    async exportMemory() {
      throw new Error("not implemented");
    },
    async deleteAllMemory() {
      throw new Error("not implemented");
    },
    async feedback() {
      throw new Error("not implemented");
    },
    async reviseMemory() {
      throw new Error("not used");
    },
    async runMaintenance() {
      throw new Error("not implemented");
    },
  };
}

function createGenerateTextDependency(input: {
  finalText?: string;
  onCall?: (payload: Record<string, unknown>) => void;
  responseTimestamp?: Date;
} = {}): typeof generateText {
  return (async (payload) => {
    input.onCall?.(payload as Record<string, unknown>);
    await payload.onFinish?.({
      text: input.finalText ?? "Final assistant answer",
      response: {
        timestamp: input.responseTimestamp ?? new Date("2026-04-26T00:00:00.000Z"),
      },
    } as never);

    return {
      text: input.finalText ?? "Final assistant answer",
    } as never;
  }) as typeof generateText;
}

function createStreamTextDependency(input: {
  finalText?: string;
  onCall?: (payload: Record<string, unknown>) => void;
} = {}): typeof streamText {
  return ((payload) => {
    input.onCall?.(payload as Record<string, unknown>);
    const finishPromise = Promise.resolve(payload.onFinish?.({
      text: input.finalText ?? "Streamed assistant answer",
    } as never));

    return {
      text: finishPromise.then(
        () => input.finalText ?? "Streamed assistant answer",
      ),
      finishReason: Promise.resolve("stop"),
    } as never;
  }) as typeof streamText;
}

function createAsyncIterableStream<T>(
  chunks: T[],
): ReadableStream<T> & AsyncIterable<T> {
  const stream = new ReadableStream<T>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk);
      }
      controller.close();
    },
  });

  return Object.assign(stream, {
    async *[Symbol.asyncIterator]() {
      const reader = stream.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }

          yield value;
        }
      } finally {
        reader.releaseLock();
      }
    },
  });
}

async function* createAsyncIterable<T>(chunks: T[]): AsyncIterable<T> {
  for (const chunk of chunks) {
    yield chunk;
  }
}

function flushAsyncWork(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("goodmemory ai-sdk adapter", () => {
  it("derives the recall query from the last text-bearing user message", async () => {
    let recalledQuery = "";

    const memory = createGoodMemoryStub({
      recall: async ({ query }) => {
        recalledQuery = query;
        return createRecallResult();
      },
    });
    const aiSDK = createGoodMemoryAISDK({
      memory,
      dependencies: {
        generateText: createGenerateTextDependency(),
      },
    });

    await aiSDK.generateText({
      scope: {
        userId: "u-1",
      },
      messages: [
        {
          role: "assistant",
          content: "Earlier answer",
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Latest user ask",
            },
          ],
        },
      ],
      model: {} as never,
    });

    expect(recalledQuery).toBe("Latest user ask");
  });

  it("propagates one turn temporal context without leaking adapter fields to the provider", async () => {
    const recallInputs: RecallInput[] = [];
    const rememberInputs: RememberInput[] = [];
    let providerPayload: Record<string, unknown> = {};
    const messages: GoodMemoryModelMessage[] = [
      {
        role: "user",
        content: "What happened yesterday?",
        id: "current-user",
        observedAt: "2026-11-01T05:29:00.000Z",
        timezone: "Europe/Paris",
      },
    ];
    const memory = createGoodMemoryStub({
      recall: async (input) => {
        recallInputs.push(input);
        return createRecallResult();
      },
      remember: async (input) => {
        rememberInputs.push(input);
        return createRememberResult();
      },
    });
    const aiSDK = createGoodMemoryAISDK({
      memory,
      dependencies: {
        generateText: createGenerateTextDependency({
          onCall: (payload) => {
            providerPayload = payload;
          },
        }),
      },
    });

    await aiSDK.generateText({
      model: {} as never,
      scope: { userId: "u-1" },
      messages,
      query: "What happened yesterday?",
      locale: "en-US",
      retrievalProfile: "general_chat",
      maxMemoryTokens: 64,
      referenceTime: "2026-11-01T05:30:00.000Z",
      timezone: "America/New_York",
      assistantObservedAt: "2026-11-01T05:30:03.000Z",
      assistantTimezone: "Asia/Tokyo",
    });

    expect(recallInputs[0]).toMatchObject({
      referenceTime: "2026-11-01T05:30:00.000Z",
      timezone: "America/New_York",
    });
    expect(rememberInputs[0]).toMatchObject({
      timezone: "America/New_York",
      messages: [
        {
          id: "current-user",
          role: "user",
          content: "What happened yesterday?",
          observedAt: "2026-11-01T05:29:00.000Z",
          timezone: "Europe/Paris",
        },
        {
          role: "assistant",
          content: "Final assistant answer",
          observedAt: "2026-11-01T05:30:03.000Z",
          timezone: "Asia/Tokyo",
        },
      ],
    });
    for (const key of [
      "assistantObservedAt",
      "assistantTimezone",
      "ignoreMemory",
      "locale",
      "maxMemoryTokens",
      "query",
      "referenceTime",
      "retrievalProfile",
      "scope",
      "timezone",
    ]) {
      expect(providerPayload).not.toHaveProperty(key);
    }
    expect(providerPayload.messages).toEqual([
      {
        role: "user",
        content: "What happened yesterday?",
      },
    ]);
  });

  it("captures one reference time and prefers the provider response timestamp for the assistant", async () => {
    const recallInputs: RecallInput[] = [];
    const rememberInputs: RememberInput[] = [];
    const responseTimestamp = new Date("2026-11-01T05:30:03.000Z");
    const aiSDK = createGoodMemoryAISDK({
      memory: createGoodMemoryStub({
        recall: async (input) => {
          recallInputs.push(input);
          return createRecallResult();
        },
        remember: async (input) => {
          rememberInputs.push(input);
          return createRememberResult();
        },
      }),
      dependencies: {
        generateText: createGenerateTextDependency({ responseTimestamp }),
      },
    });

    await aiSDK.generateText({
      model: {} as never,
      scope: { userId: "u-1" },
      messages: [{ role: "user", content: "Remember this turn." }],
      timezone: "America/New_York",
    });

    const capturedReferenceTime = recallInputs[0]?.referenceTime;
    expect(capturedReferenceTime).toBeString();
    expect(rememberInputs[0]?.messages).toEqual([
      {
        role: "user",
        content: "Remember this turn.",
        observedAt: capturedReferenceTime,
        timezone: "America/New_York",
      },
      {
        role: "assistant",
        content: "Final assistant answer",
        observedAt: responseTimestamp.toISOString(),
        timezone: "America/New_York",
      },
    ]);
  });

  it("captures an implicit stream reference time when the deferred model call starts", async () => {
    const recallInputs: RecallInput[] = [];
    const rememberInputs: RememberInput[] = [];
    const aiSDK = createGoodMemoryAISDK({
      memory: createGoodMemoryStub({
        recall: async (input) => {
          recallInputs.push(input);
          return createRecallResult();
        },
        remember: async (input) => {
          rememberInputs.push(input);
          return createRememberResult();
        },
      }),
      dependencies: {
        streamText: createStreamTextDependency(),
      },
    });

    try {
      setSystemTime(new Date("2026-11-01T05:30:00.000Z"));
      const result = aiSDK.streamText({
        model: {} as never,
        scope: { userId: "u-1" },
        messages: [{ role: "user", content: "Stream this turn." }],
      });

      setSystemTime(new Date("2026-11-01T05:30:05.000Z"));
      await result.text;

      expect(recallInputs[0]?.referenceTime).toBe("2026-11-01T05:30:05.000Z");
      expect(rememberInputs[0]?.messages).toEqual([
        {
          role: "user",
          content: "Stream this turn.",
          observedAt: "2026-11-01T05:30:05.000Z",
        },
        {
          role: "assistant",
          content: "Streamed assistant answer",
          observedAt: "2026-11-01T05:30:05.000Z",
        },
      ]);
    } finally {
      setSystemTime();
    }
  });

  it("rejects invalid explicit message temporal strings before model or memory work", async () => {
    const rememberInputs: RememberInput[] = [];
    let providerCalls = 0;
    const aiSDK = createGoodMemoryAISDK({
      memory: createGoodMemoryStub({
        remember: async (input) => {
          rememberInputs.push(input);
          return createRememberResult();
        },
      }),
      dependencies: {
        generateText: createGenerateTextDependency({
          onCall() {
            providerCalls += 1;
          },
        }),
      },
    });

    await expect(aiSDK.generateText({
      model: {} as never,
      scope: { userId: "u-1" },
      messages: [{
        role: "user",
        content: "Remember this.",
        observedAt: "",
        timezone: "",
      }],
      referenceTime: "2026-11-01T05:30:00.000Z",
    })).rejects.toThrow("Invalid messages[0].observedAt");
    expect(providerCalls).toBe(0);
    expect(rememberInputs).toEqual([]);
  });

  it("does not recall or write an earlier user when the current user has no text", async () => {
    let recallCalls = 0;
    let rememberCalls = 0;
    const aiSDK = createGoodMemoryAISDK({
      memory: createGoodMemoryStub({
        recall: async () => {
          recallCalls += 1;
          return createRecallResult();
        },
        remember: async () => {
          rememberCalls += 1;
          return createRememberResult();
        },
      }),
      dependencies: {
        generateText: createGenerateTextDependency(),
      },
    });

    await aiSDK.generateText({
      model: {} as never,
      scope: { userId: "u-1" },
      messages: [
        { role: "user", content: "Historical text turn" },
        { role: "user", content: [] },
      ],
    });

    expect(recallCalls).toBe(0);
    expect(rememberCalls).toBe(0);
  });

  it("skips recall and remember when ignoreMemory is true", async () => {
    const events: GoodMemoryAISDKEvent[] = [];
    let recallCalls = 0;
    let rememberCalls = 0;

    const memory = createGoodMemoryStub({
      recall: async () => {
        recallCalls += 1;
        return createRecallResult();
      },
      remember: async () => {
        rememberCalls += 1;
        return createRememberResult();
      },
    });
    const aiSDK = createGoodMemoryAISDK({
      memory,
      onMemoryEvent: async (event) => {
        events.push(event);
      },
      dependencies: {
        generateText: createGenerateTextDependency(),
      },
    });

    await aiSDK.generateText({
      scope: {
        userId: "u-1",
      },
      ignoreMemory: true,
      messages: [
        {
          role: "user",
          content: "Should skip recall",
        },
      ],
      model: {} as never,
    });

    expect(recallCalls).toBe(0);
    expect(rememberCalls).toBe(0);
    expect(events).toContainEqual({
      phase: "recall",
      status: "skipped",
      reason: "ignore_memory",
      retrievalProfile: "general_chat",
      scope: {
        userId: "u-1",
      },
    });
    expect(events).toContainEqual({
      phase: "remember",
      status: "skipped",
      reason: "ignore_memory",
      scope: {
        userId: "u-1",
      },
    });
  });

  it("skips recall when no recall query can be derived", async () => {
    const events: GoodMemoryAISDKEvent[] = [];
    let recallCalls = 0;

    const memory = createGoodMemoryStub({
      recall: async () => {
        recallCalls += 1;
        return createRecallResult();
      },
    });
    const aiSDK = createGoodMemoryAISDK({
      memory,
      onMemoryEvent: async (event) => {
        events.push(event);
      },
      dependencies: {
        generateText: createGenerateTextDependency(),
      },
    });

    await aiSDK.generateText({
      scope: {
        userId: "u-1",
      },
      messages: [
        {
          role: "assistant",
          content: "Only assistant context",
        },
      ],
      model: {} as never,
    });

    expect(recallCalls).toBe(0);
    expect(events).toContainEqual({
      phase: "recall",
      status: "skipped",
      reason: "no_query",
      retrievalProfile: "general_chat",
      scope: {
        userId: "u-1",
      },
    });
  });

  it("appends the built memory fragment after the existing system prompt", async () => {
    let seenSystem: unknown;

    const memory = createGoodMemoryStub({
      buildContext: async () =>
        createBuildContextResult("## Facts\n- migration blocker"),
    });
    const aiSDK = createGoodMemoryAISDK({
      memory,
      dependencies: {
        generateText: createGenerateTextDependency({
          onCall: (payload) => {
            seenSystem = payload.system;
          },
        }),
      },
    });

    await aiSDK.generateText({
      scope: {
        userId: "u-1",
      },
      system: "You are a concise copilot.",
      messages: [
        {
          role: "user",
          content: "What is the blocker?",
        },
      ],
      model: {} as never,
    });

    expect(seenSystem).toBe(
      "You are a concise copilot.\n\n## Facts\n- migration blocker",
    );
  });

  it("appends the built memory fragment to structured system prompts", async () => {
    const seenSystems: unknown[] = [];
    const memory = createGoodMemoryStub({
      buildContext: async () => createBuildContextResult("## Facts\n- structured"),
    });
    const aiSDK = createGoodMemoryAISDK({
      memory,
      dependencies: {
        generateText: createGenerateTextDependency({
          onCall: (payload) => {
            seenSystems.push(payload.system);
          },
        }),
      },
    });

    await aiSDK.generateText({
      scope: {
        userId: "u-1",
      },
      system: {
        role: "system",
        content: "Base system",
      },
      messages: [
        {
          role: "user",
          content: "What should I remember?",
        },
      ],
      model: {} as never,
    });
    await aiSDK.generateText({
      scope: {
        userId: "u-1",
      },
      system: [
        {
          role: "system",
          content: "First system",
        },
      ],
      messages: [
        {
          role: "user",
          content: "What should I remember next?",
        },
      ],
      model: {} as never,
    });

    expect(seenSystems[0]).toEqual([
      {
        role: "system",
        content: "Base system",
      },
      {
        role: "system",
        content: "## Facts\n- structured",
      },
    ]);
    expect(seenSystems[1]).toEqual([
      {
        role: "system",
        content: "First system",
      },
      {
        role: "system",
        content: "## Facts\n- structured",
      },
    ]);
  });

  it("emits skip events for empty context and non-text conversations", async () => {
    const originalConsoleError = console.error;
    const events: GoodMemoryAISDKEvent[] = [];
    console.error = () => {};

    try {
      const aiSDK = createGoodMemoryAISDK({
        memory: createGoodMemoryStub({
          buildContext: async () => createBuildContextResult("   "),
        }),
        onMemoryEvent: async (event) => {
          events.push(event);
          throw new Error("callback failure should not fail generation");
        },
        dependencies: {
          generateText: createGenerateTextDependency(),
        },
      });

      await aiSDK.generateText({
        scope: {
          userId: "u-1",
        },
        messages: [
          {
            role: "user",
            content: "What is the release blocker?",
          },
        ],
        model: {} as never,
      });
      await aiSDK.generateText({
        scope: {
          userId: "u-1",
        },
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                image: new URL("https://example.com/screenshot.png"),
              },
            ],
          },
        ],
        model: {} as never,
      });
    } finally {
      console.error = originalConsoleError;
    }

    expect(events).toContainEqual({
      phase: "recall",
      status: "skipped",
      reason: "empty_context",
      retrievalProfile: "general_chat",
      scope: {
        userId: "u-1",
      },
    });
    expect(events).toContainEqual({
      phase: "remember",
      status: "skipped",
      reason: "no_text_messages",
      scope: {
        userId: "u-1",
      },
    });
  });

  it("soft-fails recall and leaves the caller input untouched", async () => {
    const errors: GoodMemoryAISDKErrorEvent[] = [];
    let seenSystem: unknown;

    const memory = createGoodMemoryStub({
      recall: async () => {
        throw new Error("recall failed");
      },
    });
    const aiSDK = createGoodMemoryAISDK({
      memory,
      onMemoryError: async (event) => {
        errors.push(event);
      },
      dependencies: {
        generateText: createGenerateTextDependency({
          onCall: (payload) => {
            seenSystem = payload.system;
          },
        }),
      },
    });

    await aiSDK.generateText({
      scope: {
        userId: "u-1",
      },
      system: "App system",
      messages: [
        {
          role: "user",
          content: "What is the blocker?",
        },
      ],
      model: {} as never,
    });

    expect(seenSystem).toBe("App system");
    expect(errors).toHaveLength(1);
    expect(errors[0]?.phase).toBe("recall");
  });

  it("remembers only the current text-bearing user turn and generated answer", async () => {
    let rememberedMessages: RememberInput["messages"] = [];

    const memory = createGoodMemoryStub({
      remember: async ({ messages }) => {
        rememberedMessages = messages;
        return createRememberResult();
      },
    });
    const aiSDK = createGoodMemoryAISDK({
      memory,
      dependencies: {
        generateText: createGenerateTextDependency({
          finalText: "Final answer",
        }),
      },
    });

    await aiSDK.generateText({
      scope: {
        userId: "u-1",
      },
      messages: [
        {
          role: "system",
          content: "Hidden system",
        },
        {
          role: "user",
          content: "Earlier user text",
        },
        {
          role: "assistant",
          content: "Earlier assistant text",
        },
        {
          role: "user",
          content: [
            {
              type: "image",
              image: new URL("https://example.com/example.png"),
            },
            {
              type: "text",
              text: "Current user text",
            },
          ],
        },
        {
          role: "assistant",
          content: [
            {
              type: "reasoning",
              text: "internal reasoning",
            },
            {
              type: "tool-call",
              toolCallId: "tool-1",
              toolName: "lookup",
              input: {},
            },
            {
              type: "text",
              text: "Context assistant text",
            },
          ],
        },
        {
          role: "tool",
          content: [
            {
              type: "tool-approval-response",
              approvalId: "approval-1",
              approved: true,
            },
          ],
        },
      ],
      model: {} as never,
    });

    expect(rememberedMessages).toEqual([
      {
        role: "user",
        content: "Current user text",
        observedAt: expect.any(String),
      },
      {
        role: "assistant",
        content: "Final answer",
        observedAt: "2026-04-26T00:00:00.000Z",
      },
    ]);
  });

  it("preserves streamText laziness and synchronous response helpers", async () => {
    const accessed: string[] = [];
    let streamTextCalls = 0;

    const memory = createGoodMemoryStub();
    const aiSDK = createGoodMemoryAISDK({
      memory,
      dependencies: {
        streamText: ((payload) => {
          streamTextCalls += 1;
          void payload.onFinish?.({
            text: "Tracked answer",
          } as never);

          return {
            get text() {
              accessed.push("text");
              return Promise.resolve("Tracked answer");
            },
            get finishReason() {
              accessed.push("finishReason");
              return Promise.resolve("stop");
            },
            get textStream() {
              accessed.push("textStream");
              return createAsyncIterableStream(["Tracked answer"]);
            },
            get fullStream() {
              accessed.push("fullStream");
              return createAsyncIterableStream([]);
            },
            get experimental_partialOutputStream() {
              accessed.push("experimental_partialOutputStream");
              return createAsyncIterableStream([]);
            },
            get partialOutputStream() {
              accessed.push("partialOutputStream");
              return createAsyncIterableStream([]);
            },
            get elementStream() {
              accessed.push("elementStream");
              return createAsyncIterableStream([]);
            },
          } as never;
        }) as typeof streamText,
      },
    });

    const result = aiSDK.streamText({
      scope: {
        userId: "u-1",
      },
      messages: [
        {
          role: "user",
          content: "Stream this",
        },
      ],
      model: {} as never,
    });

    await flushAsyncWork();

    expect(streamTextCalls).toBe(0);
    expect(accessed).toEqual([]);

    const response = result.toTextStreamResponse();

    expect(response).toBeInstanceOf(Response);
    await flushAsyncWork();
    expect(streamTextCalls).toBe(1);
    expect(accessed).toEqual(["textStream"]);
    expect(await response.text()).toBe("Tracked answer");
    expect(streamTextCalls).toBe(1);
    expect(accessed).toEqual(["textStream"]);
  });

  it("defers stream promise properties, async iterables, and methods", async () => {
    const accessed: string[] = [];
    let consumed = false;
    let streamTextCalls = 0;

    const memory = createGoodMemoryStub();
    const aiSDK = createGoodMemoryAISDK({
      memory,
      dependencies: {
        streamText: ((payload) => {
          streamTextCalls += 1;
          void payload.onFinish?.({
            text: "Deferred answer",
          } as never);

          return {
            get text() {
              accessed.push("text");
              return Promise.resolve("Deferred answer");
            },
            get finishReason() {
              accessed.push("finishReason");
              return Promise.resolve("stop");
            },
            get textStream() {
              accessed.push("textStream");
              return createAsyncIterable(["part-a", "part-b"]);
            },
            toUIMessageStream(options: unknown) {
              accessed.push(`toUIMessageStream:${JSON.stringify(options)}`);
              return createAsyncIterable(["ui-part"]);
            },
            async consumeStream() {
              consumed = true;
            },
          } as never;
        }) as typeof streamText,
      },
    });

    const result = aiSDK.streamText({
      scope: {
        userId: "u-1",
      },
      messages: [
        {
          role: "user",
          content: "Stream this lazily",
        },
      ],
      model: {} as never,
    });

    expect(streamTextCalls).toBe(0);
    expect(await result.text).toBe("Deferred answer");
    expect(await result.finishReason).toBe("stop");

    const chunks: string[] = [];
    for await (const chunk of result.textStream as AsyncIterable<string>) {
      chunks.push(chunk);
    }
    const uiChunks: string[] = [];
    for await (const chunk of result.toUIMessageStream({
      sendStart: false,
    }) as AsyncIterable<string>) {
      uiChunks.push(chunk);
    }
    await result.consumeStream();

    expect(chunks).toEqual(["part-a", "part-b"]);
    expect(uiChunks).toEqual(["ui-part"]);
    expect(consumed).toBeTrue();
    expect(streamTextCalls).toBe(1);
    expect(accessed).toEqual([
      "text",
      "finishReason",
      "textStream",
      "toUIMessageStream:{\"sendStart\":false}",
    ]);
  });

  it("remembers before the caller onFinish runs", async () => {
    const order: string[] = [];

    const memory = createGoodMemoryStub({
      remember: async ({ messages }) => {
        order.push(`remember:${messages.at(-1)?.content}`);
        return createRememberResult();
      },
    });
    const aiSDK = createGoodMemoryAISDK({
      memory,
      dependencies: {
        generateText: createGenerateTextDependency({
          finalText: "Sequenced answer",
        }),
      },
    });

    await aiSDK.generateText({
      scope: {
        userId: "u-1",
      },
      messages: [
        {
          role: "user",
          content: "Sequence this",
        },
      ],
      onFinish: async () => {
        order.push("caller");
      },
      model: {} as never,
    });

    expect(order).toEqual(["remember:Sequenced answer", "caller"]);
  });

  it("emits compact memory events and soft-fails remember errors", async () => {
    const events: GoodMemoryAISDKEvent[] = [];
    const errors: GoodMemoryAISDKErrorEvent[] = [];

    const memory = createGoodMemoryStub({
      remember: async () => {
        throw new Error("remember failed");
      },
    });
    const aiSDK = createGoodMemoryAISDK({
      memory,
      onMemoryEvent: async (event) => {
        events.push(event);
      },
      onMemoryError: async (event) => {
        errors.push(event);
      },
      dependencies: {
        streamText: createStreamTextDependency({
          finalText: "Streamed answer",
        }),
      },
    });

    const result = aiSDK.streamText({
      scope: {
        userId: "u-1",
      },
      messages: [
        {
          role: "user",
          content: "What is the blocker?",
        },
      ],
      model: {} as never,
    });

    await result.text;

    expect(events).toContainEqual({
      phase: "recall",
      status: "applied",
      retrievalProfile: "general_chat",
      scope: {
        userId: "u-1",
      },
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]?.phase).toBe("remember");
  });

  it("skips remember when the final assistant text is empty", async () => {
    const events: GoodMemoryAISDKEvent[] = [];

    const memory = createGoodMemoryStub();
    const aiSDK = createGoodMemoryAISDK({
      memory,
      onMemoryEvent: async (event) => {
        events.push(event);
      },
      dependencies: {
        generateText: createGenerateTextDependency({
          finalText: "   ",
        }),
      },
    });

    await aiSDK.generateText({
      scope: {
        userId: "u-1",
      },
      messages: [
        {
          role: "user",
          content: "What is the blocker?",
        },
      ],
      model: {} as never,
    });

    expect(events).toContainEqual({
      phase: "remember",
      status: "skipped",
      reason: "no_final_assistant_text",
      scope: {
        userId: "u-1",
      },
    });
  });
});
