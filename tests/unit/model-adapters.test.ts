import { afterEach, describe, expect, it } from "bun:test";
import {
  buildEvalAnswerPrompt as buildAISDKTextPrompt,
  createEvalAnswerGenerator as createAISDKTextGenerator,
} from "../../src/eval/answer-generator";
import {
  createEvalJudgeModel as createAISDKJudgeModel,
} from "../../src/eval/judge-model";
import {
  createAISDKEmbeddingAdapter,
  createOpenAICompatibleFetch,
  DEFAULT_AISDK_REQUEST_TIMEOUT_MS,
  parseAISDKModelConfigFromEnv,
  requestOpenAICompatibleText,
  requestOpenAICompatibleTextResult,
  resolveAISDKEmbeddingModel,
  resolveAISDKModel,
  stripThinkingBlocks,
  withAISDKRetries,
} from "../../src/provider/ai-sdk-runtime";
import type { ModelUsageAttempt } from "../../src/provider/model-usage";
import type { RoutingDecision } from "../../src/recall/router";
import {
  createLLMMemoryExtractor as createAISDKMemoryExtractor,
} from "../../src/provider/memory-extractor";
import {
  createLLMRecallRouter,
} from "../../src/provider/recall-router";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("model adapters", () => {
  it("forwards an explicit temperature to openai-compatible gateways", async () => {
    let requestBody = "";

    const result = await requestOpenAICompatibleText({
      fetch: async (_url, init) => {
        requestBody = String(init?.body);
        return new Response(
          "data: {\"choices\":[{\"delta\":{\"content\":\"stable\"},\"index\":0}]}\n\ndata: [DONE]\n\n",
          {
            headers: { "content-type": "text/event-stream" },
            status: 200,
          },
        );
      },
      model: {
        apiKey: "gateway-key",
        baseURL: "https://gateway.example/v1",
        model: "gpt-5.6-terra",
        provider: "openai",
      },
      prompt: "return stable output",
      reasoningEffort: "low",
      temperature: 0,
    });

    expect(result).toBe("stable");
    expect(JSON.parse(requestBody)).toMatchObject({
      model: "gpt-5.6-terra",
      reasoning_effort: "low",
      temperature: 0,
    });
    expect(JSON.parse(requestBody).stream_options).toBeUndefined();
  });

  it("forwards the frozen output-token budget to openai-compatible gateways", async () => {
    let requestBody = "";
    await requestOpenAICompatibleText({
      fetch: async (_url, init) => {
        requestBody = String(init?.body);
        return new Response("data: [DONE]\n\n", {
          headers: { "content-type": "text/event-stream" },
          status: 200,
        });
      },
      maxOutputTokens: 512,
      model: {
        apiKey: "gateway-key",
        baseURL: "https://gateway.example/v1",
        model: "gpt-5.6-terra",
        provider: "openai",
      },
      prompt: "answer",
    });

    expect(JSON.parse(requestBody)).toMatchObject({ max_tokens: 512 });
  });

  it("captures usage from the final OpenAI-compatible stream chunk without changing legacy calls", async () => {
    let requestBody = "";
    const result = await requestOpenAICompatibleTextResult({
      fetch: async (_url, init) => {
        requestBody = String(init?.body);
        return new Response(
          [
            'data: {"choices":[{"delta":{"content":"stable"},"index":0}]}',
            'data: {"choices":[],"usage":{"prompt_tokens":12,"completion_tokens":3,"prompt_tokens_details":{"cached_tokens":4}}}',
            "data: [DONE]",
            "",
          ].join("\n\n"),
          {
            headers: { "content-type": "text/event-stream" },
            status: 200,
          },
        );
      },
      model: {
        apiKey: "gateway-key",
        baseURL: "https://gateway.example/v1",
        model: "gpt-5.6-terra",
        provider: "openai",
      },
      prompt: "return stable output",
    });

    expect(result).toEqual({
      text: "stable",
      usage: {
        cacheCreationInputTokens: null,
        cacheReadInputTokens: 4,
        inputTokens: 12,
        outputTokens: 3,
        uncachedInputTokens: 8,
      },
    });
    expect(JSON.parse(requestBody).stream_options).toEqual({
      include_usage: true,
    });
  });

  it("captures usage from OpenAI-compatible JSON responses", async () => {
    const result = await requestOpenAICompatibleTextResult({
      fetch: async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "json-answer" } }],
            usage: {
              cache_creation_input_tokens: 2,
              cache_read_input_tokens: 3,
              input_tokens: 10,
              output_tokens: 4,
            },
          }),
          {
            headers: { "content-type": "application/json" },
            status: 200,
          },
        ),
      model: {
        apiKey: "gateway-key",
        baseURL: "https://gateway.example/v1",
        model: "gpt-5.6-terra",
        provider: "openai",
      },
      prompt: "return stable output",
    });

    expect(result).toEqual({
      text: "json-answer",
      usage: {
        cacheCreationInputTokens: 2,
        cacheReadInputTokens: 3,
        inputTokens: 15,
        outputTokens: 4,
        uncachedInputTokens: 10,
      },
    });
  });

  it("strips closed and unclosed thinking blocks before exposing model text", () => {
    expect(stripThinkingBlocks("<think>hidden</think>\n\ngenerated-answer")).toBe(
      "generated-answer",
    );
    expect(stripThinkingBlocks("<think>hidden memory note")).toBe("");
    expect(stripThinkingBlocks("visible answer\n<think>hidden scratchpad")).toBe(
      "visible answer",
    );
  });

  it("parses model config from environment variables", () => {
    process.env.GOODMEMORY_EVAL_PROVIDER = "openai";
    process.env.GOODMEMORY_EVAL_MODEL = "gpt-5";
    process.env.GOODMEMORY_EVAL_API_KEY = "test-key";
    process.env.GOODMEMORY_EVAL_BASE_URL = "https://gateway.example/v1";

    expect(parseAISDKModelConfigFromEnv("GOODMEMORY_EVAL")).toEqual({
      provider: "openai",
      model: "gpt-5",
      apiKey: "test-key",
      baseURL: "https://gateway.example/v1",
    });
  });

  it("returns null when required env variables are missing", () => {
    delete process.env.GOODMEMORY_EVAL_PROVIDER;
    delete process.env.GOODMEMORY_EVAL_MODEL;

    expect(parseAISDKModelConfigFromEnv("GOODMEMORY_EVAL")).toBeNull();
  });

  it("rejects unsupported providers", () => {
    expect(() =>
      resolveAISDKModel({
        provider: "unsupported" as "openai",
        model: "x",
      }),
    ).toThrow("Unsupported Vercel AI SDK provider");
  });

  it("parses env providers strictly", () => {
    process.env.GOODMEMORY_JUDGE_PROVIDER = "unsupported";
    process.env.GOODMEMORY_JUDGE_MODEL = "judge-model";

    expect(() => parseAISDKModelConfigFromEnv("GOODMEMORY_JUDGE")).toThrow(
      "Unsupported Vercel AI SDK provider",
    );
  });

  it("resolves openai and anthropic models with and without explicit api keys", () => {
    expect(
      resolveAISDKModel({
        provider: "openai",
        model: "gpt-5",
      }),
    ).toBeTruthy();
    expect(
      resolveAISDKModel({
        provider: "openai",
        model: "gpt-5",
        apiKey: "openai-key",
      }),
    ).toBeTruthy();
    expect(
      resolveAISDKModel({
        provider: "openai",
        model: "gpt-5",
        apiKey: "gateway-key",
        baseURL: "https://gateway.example/v1",
      }),
    ).toBeTruthy();
    expect(
      resolveAISDKModel({
        provider: "anthropic",
        model: "claude-sonnet",
      }),
    ).toBeTruthy();
    expect(
      resolveAISDKModel({
        provider: "anthropic",
        model: "claude-sonnet",
        apiKey: "anthropic-key",
      }),
    ).toBeTruthy();
    expect(
      resolveAISDKModel({
        provider: "anthropic",
        model: "claude-sonnet",
        apiKey: "anthropic-key",
        baseURL: "https://gateway.example/v1",
      }),
    ).toBeTruthy();
  });

  it("builds prompts with transcript, memory context, and user request", () => {
    expect(
      buildAISDKTextPrompt({
        persona: {} as never,
        scenario: {} as never,
        transcript: "user: hi",
        memoryContext: "## Facts\n- migration open loop",
        prompt: "continue",
      }),
    ).toContain("Memory context");

    expect(
      buildAISDKTextPrompt({
        persona: {} as never,
        scenario: {} as never,
        transcript: "user: hi",
        prompt: "continue",
      }),
    ).not.toContain("Memory context");
  });

  it("creates a text generator using injected dependencies", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const generator = createAISDKTextGenerator({
      model: {
        provider: "openai",
        model: "gpt-5",
      },
      system: "system prompt",
      dependencies: {
        resolveModel: (config) => ({ resolvedFrom: config.model }) as never,
        generateText: async (input) => {
          calls.push(input as unknown as Record<string, unknown>);
          return { text: "<think>hidden</think>\n\ngenerated-answer" } as never;
        },
      },
    });

    const result = await generator({
      persona: {} as never,
      scenario: {} as never,
      transcript: "user: hi",
      memoryContext: "## Facts\n- migration open loop",
      prompt: "continue",
    });

    expect(result.content).toBe("generated-answer");
    expect(calls[0]?.system).toBe("system prompt");
    expect(String(calls[0]?.prompt)).toContain("migration open loop");
    expect(calls[0]?.maxRetries).toBe(0);
    expect(calls[0]?.timeout).toBe(DEFAULT_AISDK_REQUEST_TIMEOUT_MS);
  });

  it("emits independent AI SDK usage sidecars for answer and judge calls", async () => {
    const answerEvents: ModelUsageAttempt[] = [];
    const judgeEvents: ModelUsageAttempt[] = [];
    const usage = {
      inputTokenDetails: {
        cacheReadTokens: 3,
        cacheWriteTokens: 2,
        noCacheTokens: 5,
      },
      inputTokens: 10,
      outputTokens: 4,
    };
    const generator = createAISDKTextGenerator({
      dependencies: {
        generateText: async () => ({ text: "answer", usage }) as never,
        modelUsageSink: { emit(event) { answerEvents.push(event); } },
        resolveModel: () => ({}) as never,
      },
      model: { model: "gpt-5.6-terra", provider: "openai" },
    });
    const judge = createAISDKJudgeModel({
      dependencies: {
        generateObject: async () => ({
          object: {
            failure_tags: [],
            reasoning: "ok",
            scores: {
              contamination_penalty: 7,
              cross_domain_transfer: 7,
              factual_recall: 7,
              personalization_usefulness: 7,
              preference_consistency: 7,
              provenance_explainability: 7,
              update_correctness: 7,
            },
            winner: "tie",
          },
          usage,
        }) as never,
        modelUsageSink: { emit(event) { judgeEvents.push(event); } },
        resolveModel: () => ({}) as never,
      },
      model: { model: "judge-model", provider: "anthropic" },
    });

    await generator({
      persona: {} as never,
      prompt: "continue",
      scenario: {} as never,
      transcript: "user: hi",
    });
    await judge.complete({ purpose: "eval_judge", prompt: "judge" });

    expect(answerEvents).toHaveLength(1);
    expect(answerEvents[0]).toMatchObject({
      completeness: "complete",
      modelId: "gpt-5.6-terra",
      operation: "answer_generation",
      usage: { inputTokens: 10, outputTokens: 4 },
    });
    expect(judgeEvents).toHaveLength(1);
    expect(judgeEvents[0]).toMatchObject({
      completeness: "complete",
      modelId: "judge-model",
      operation: "judge",
      usage: { inputTokens: 10, outputTokens: 4 },
    });
  });

  it("emits usage from an OpenAI-compatible answer stream only on the usage-aware path", async () => {
    const events: ModelUsageAttempt[] = [];
    let requestBody = "";
    const generator = createAISDKTextGenerator({
      dependencies: {
        fetch: async (_url, init) => {
          requestBody = String(init?.body);
          return new Response(
            [
              'data: {"choices":[{"delta":{"content":"answer"},"index":0}]}',
              'data: {"choices":[],"usage":{"prompt_tokens":18,"completion_tokens":2}}',
              "data: [DONE]",
              "",
            ].join("\n\n"),
            {
              headers: { "content-type": "text/event-stream" },
              status: 200,
            },
          );
        },
        modelUsageSink: { emit(event) { events.push(event); } },
        retryOptions: { retryLimit: 1 },
      },
      model: {
        apiKey: "gateway-key",
        baseURL: "https://gateway.example/v1",
        model: "gpt-5.6-terra",
        provider: "openai",
      },
    });

    const result = await generator({
      persona: {} as never,
      prompt: "continue",
      scenario: {} as never,
      transcript: "user: hi",
    });

    expect(result.content).toBe("answer");
    expect(JSON.parse(requestBody).stream_options).toEqual({
      include_usage: true,
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      operation: "answer_generation",
      usage: { inputTokens: 18, outputTokens: 2 },
    });
  });

  it("records a missing failed attempt separately from a successful retry", async () => {
    const events: ModelUsageAttempt[] = [];
    let calls = 0;
    const generator = createAISDKTextGenerator({
      dependencies: {
        generateText: async () => {
          calls += 1;
          if (calls === 1) {
            throw new Error(
              "OpenAI-compatible gateway error 503: Service temporarily unavailable",
            );
          }
          return {
            text: "recovered",
            usage: { inputTokens: 9, outputTokens: 1 },
          } as never;
        },
        modelUsageSink: { emit(event) { events.push(event); } },
        resolveModel: () => ({}) as never,
        retryOptions: { retryLimit: 2, sleep: async () => {} },
      },
      model: { model: "gpt-5.6-terra", provider: "openai" },
    });

    await expect(generator({
      persona: {} as never,
      prompt: "continue",
      scenario: {} as never,
      transcript: "user: hi",
    })).resolves.toEqual({ content: "recovered" });

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      attempt: 1,
      completeness: "missing",
      outcome: "failed",
    });
    expect(events[1]).toMatchObject({
      attempt: 2,
      completeness: "complete",
      outcome: "succeeded",
      usage: { inputTokens: 9, outputTokens: 1 },
    });
  });

  it("honors custom AI SDK text request timeouts", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const generator = createAISDKTextGenerator({
      model: {
        provider: "openai",
        model: "gpt-5",
      },
      dependencies: {
        generateText: async (input) => {
          calls.push(input as unknown as Record<string, unknown>);
          return { text: "generated-answer" } as never;
        },
        requestTimeoutMs: 1234,
        resolveModel: (config) => ({ resolvedFrom: config.model }) as never,
      },
    });

    await generator({
      persona: {} as never,
      prompt: "continue",
      scenario: {} as never,
      transcript: "user: hi",
    });

    expect(calls[0]?.timeout).toBe(1234);
  });

  it("retries transient gateway validation failures for text generation", async () => {
    let attempts = 0;
    const generator = createAISDKTextGenerator({
      model: {
        provider: "openai",
        model: "gpt-5",
      },
      dependencies: {
        resolveModel: (config) => ({ resolvedFrom: config.model }) as never,
        generateText: async () => {
          attempts += 1;
          if (attempts < 3) {
            throw new Error(
              "AI_TypeValidationError: Type validation failed: Invalid input: expected array, received null",
            );
          }

          return { text: "recovered-answer" } as never;
        },
      },
    });

    const result = await generator({
      persona: {} as never,
      scenario: {} as never,
      transcript: "user: hi",
      prompt: "continue",
    });

    expect(result.content).toBe("recovered-answer");
    expect(attempts).toBe(3);
  });

  it("retries empty text generations instead of returning a blank answer", async () => {
    let attempts = 0;
    const generator = createAISDKTextGenerator({
      model: {
        provider: "openai",
        model: "gpt-5",
      },
      dependencies: {
        resolveModel: (config) => ({ resolvedFrom: config.model }) as never,
        generateText: async () => {
          attempts += 1;
          if (attempts < 3) {
            return { text: "   " } as never;
          }

          return { text: "non-empty-answer" } as never;
        },
      },
    });

    const result = await generator({
      persona: {} as never,
      scenario: {} as never,
      transcript: "user: hi",
      prompt: "continue",
    });

    expect(result.content).toBe("non-empty-answer");
    expect(attempts).toBe(3);
  });

  it("uses escalating backoff for transient service availability failures", async () => {
    let attempts = 0;
    const delays: number[] = [];

    const result = await withAISDKRetries(
      async () => {
        attempts += 1;
        if (attempts < 4) {
          throw new Error(
            "Error: OpenAI-compatible gateway error 503: Service temporarily unavailable",
          );
        }

        return "recovered";
      },
      {
        sleep: async (ms) => {
          delays.push(ms);
        },
      },
    );

    expect(result).toBe("recovered");
    expect(attempts).toBe(4);
    expect(delays).toEqual([2_000, 5_000, 10_000]);
  });

  it("retries transient gateway invalid-json responses from provider proxies", async () => {
    let attempts = 0;
    const delays: number[] = [];

    const result = await withAISDKRetries(
      async () => {
        attempts += 1;
        if (attempts < 3) {
          throw new Error("Invalid JSON response");
        }

        return "recovered";
      },
      {
        sleep: async (ms) => {
          delays.push(ms);
        },
      },
    );

    expect(result).toBe("recovered");
    expect(attempts).toBe(3);
    expect(delays).toEqual([2_000, 5_000]);
  });

  it("retries transient provider socket closures", async () => {
    let attempts = 0;
    const delays: number[] = [];

    const result = await withAISDKRetries(
      async () => {
        attempts += 1;
        if (attempts < 3) {
          throw new Error(
            "The socket connection was closed unexpectedly. For more information, pass `verbose: true` in the second argument to fetch()",
          );
        }

        return "recovered";
      },
      {
        sleep: async (ms) => {
          delays.push(ms);
        },
      },
    );

    expect(result).toBe("recovered");
    expect(attempts).toBe(3);
    expect(delays).toEqual([2_000, 5_000]);
  });

  it("retries transient certificate verification failures", async () => {
    let attempts = 0;
    const delays: number[] = [];

    const result = await withAISDKRetries(
      async () => {
        attempts += 1;
        if (attempts < 3) {
          throw new Error("unknown certificate verification error");
        }

        return "recovered";
      },
      {
        sleep: async (ms) => {
          delays.push(ms);
        },
      },
    );

    expect(result).toBe("recovered");
    expect(attempts).toBe(3);
    expect(delays).toEqual([2_000, 5_000]);
  });

  it("retries transient TLS certificate hostname mismatches", async () => {
    let attempts = 0;
    const delays: number[] = [];

    const result = await withAISDKRetries(
      async () => {
        attempts += 1;
        if (attempts < 3) {
          throw new Error(
            "Hostname/IP does not match certificate's altnames: Host: openrouter.ai. is not in the cert's altnames (code: ERR_TLS_CERT_ALTNAME_INVALID)",
          );
        }

        return "recovered";
      },
      {
        sleep: async (ms) => {
          delays.push(ms);
        },
      },
    );

    expect(result).toBe("recovered");
    expect(attempts).toBe(3);
    expect(delays).toEqual([2_000, 5_000]);
  });

  it("retries transient provider model cooldown errors", async () => {
    let attempts = 0;
    const delays: number[] = [];

    const result = await withAISDKRetries(
      async () => {
        attempts += 1;
        if (attempts < 3) {
          throw new Error("Provider returned model_cooldown for gpt-5.5");
        }

        return "recovered";
      },
      {
        sleep: async (ms) => {
          delays.push(ms);
        },
      },
    );

    expect(result).toBe("recovered");
    expect(attempts).toBe(3);
    expect(delays).toEqual([2_000, 5_000]);
  });

  it("retries transient provider usage-limit errors", async () => {
    let attempts = 0;
    const delays: number[] = [];

    const result = await withAISDKRetries(
      async () => {
        attempts += 1;
        if (attempts < 3) {
          throw new Error("The usage limit has been reached");
        }

        return "recovered";
      },
      {
        sleep: async (ms) => {
          delays.push(ms);
        },
      },
    );

    expect(result).toBe("recovered");
    expect(attempts).toBe(3);
    expect(delays).toEqual([2_000, 5_000]);
  });

  it("keeps validation retries on a short backoff schedule", async () => {
    let attempts = 0;
    const delays: number[] = [];

    const result = await withAISDKRetries(
      async () => {
        attempts += 1;
        if (attempts < 3) {
          throw new Error(
            "AI_TypeValidationError: Type validation failed: Invalid input: expected array, received null",
          );
        }

        return "recovered";
      },
      {
        sleep: async (ms) => {
          delays.push(ms);
        },
      },
    );

    expect(result).toBe("recovered");
    expect(attempts).toBe(3);
    expect(delays).toEqual([250, 500]);
  });

  it("creates a judge model using injected dependencies", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const judge = createAISDKJudgeModel({
      model: {
        provider: "anthropic",
        model: "claude-sonnet",
      },
      system: "judge system",
      dependencies: {
        resolveModel: (config) => ({ resolvedFrom: config.model }) as never,
        generateObject: async (input) => {
          calls.push(input as unknown as Record<string, unknown>);
          return {
            object: {
              winner: "goodmemory",
              scores: {
                identity_understanding: 9,
                history_continuation: 9,
                factual_alignment: 8,
                relevance: 9,
              },
              reasoning: "comparison complete",
              failure_tags: [],
            },
          } as never;
        },
      },
    });

    const result = await judge.complete({
      purpose: "eval_judge",
      prompt: "judge this",
    });

    expect(JSON.parse(result.content).winner).toBe("goodmemory");
    expect(calls[0]?.system).toBe("judge system");
    expect(calls[0]?.maxRetries).toBe(0);
    expect(calls[0]?.schema).toBeTruthy();
    expect(calls[0]?.timeout).toBe(DEFAULT_AISDK_REQUEST_TIMEOUT_MS);
  });

  it("creates a structured memory extractor using generateObject", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const extractor = createAISDKMemoryExtractor({
      maxOutputTokens: 4_096,
      model: {
        provider: "anthropic",
        model: "claude-sonnet",
      },
      system: "extract durable memory",
      temperature: 0,
      dependencies: {
        resolveModel: (config) => ({ resolvedFrom: config.model }) as never,
        generateObject: async (input) => {
          calls.push(input as unknown as Record<string, unknown>);
          return {
            object: {
              candidates: [
                {
                  id: "llm-1",
                  kindHint: "fact",
                  explicitness: "explicit",
                  content: "Runtime rollout still needs legal signoff.",
                  sourceMessageIndex: 0,
                  sourceRole: "user",
                  metadata: {
                    category: "project",
                    factKind: "open_loop",
                    subject: "runtime rollout",
                  },
                },
              ],
              ignoredMessageCount: 0,
            },
          } as never;
        },
      },
    });

    const result = await extractor.extract({
      scope: { userId: "u-1" },
      messages: [
        {
          role: "user",
          content: "Heads up: legal still needs to sign off on the runtime rollout.",
        },
      ],
    });

    expect(result.candidates[0]?.kindHint).toBe("fact");
    expect(result.candidates[0]?.content).toContain("legal signoff");
    expect(calls[0]?.maxRetries).toBe(0);
    expect(calls[0]?.maxOutputTokens).toBe(4_096);
    expect(calls[0]?.schema).toBeTruthy();
    expect(String(calls[0]?.prompt)).toContain("runtime rollout");
    expect(calls[0]?.temperature).toBe(0);
    expect(calls[0]?.timeout).toBe(DEFAULT_AISDK_REQUEST_TIMEOUT_MS);
  });

  it("emits AI SDK usage for assisted extraction and embedding batches", async () => {
    const events: ModelUsageAttempt[] = [];
    const sink = { emit(event: ModelUsageAttempt) { events.push(event); } };
    const extractor = createAISDKMemoryExtractor({
      dependencies: {
        generateObject: async () => ({
          object: { candidates: [], ignoredMessageCount: 1 },
          usage: { inputTokens: 21, outputTokens: 5 },
        }) as never,
        modelUsageSink: sink,
        resolveModel: () => ({}) as never,
      },
      model: { model: "gpt-5.6-terra", provider: "openai" },
    });
    const embedding = createAISDKEmbeddingAdapter({
      dependencies: {
        embedMany: async () => ({
          embeddings: [[1, 0]],
          usage: { tokens: 6 },
        }) as never,
        modelUsageSink: sink,
        resolveEmbeddingModel: () => ({}) as never,
      },
      model: { model: "text-embedding-3-small", provider: "openai" },
    });

    await extractor.extract({
      messages: [{ content: "hello", role: "user" }],
      scope: { userId: "u-1" },
    });
    await embedding.embed(["hello"]);

    expect(events.map((event) => event.operation)).toEqual([
      "assisted_extraction",
      "embedding",
    ]);
    expect(events[1]?.usage).toEqual({
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      inputTokens: 6,
      outputTokens: 0,
      uncachedInputTokens: 6,
    });
  });

  it("creates an embedding adapter using injected dependencies", async () => {
    const calls: Array<Record<string, unknown>> = [];
    const adapter = createAISDKEmbeddingAdapter({
      model: {
        provider: "openai",
        model: "text-embedding-3-small",
      },
      dependencies: {
        resolveEmbeddingModel: (config) => ({ resolvedFrom: config.model }) as never,
        embedMany: async (input) => {
          calls.push(input as unknown as Record<string, unknown>);
          return {
            embeddings: [[1, 0, 0], [0, 1, 0]],
          } as never;
        },
      },
    });

    const result = await adapter.embed(["alpha", "beta"]);

    expect(result).toEqual([[1, 0, 0], [0, 1, 0]]);
    expect(calls[0]?.maxRetries).toBe(0);
    expect(calls[0]?.values).toEqual(["alpha", "beta"]);
  });

  it("batches large embedding requests while preserving input order", async () => {
    const calls: string[][] = [];
    let activeCalls = 0;
    let peakActiveCalls = 0;
    const adapter = createAISDKEmbeddingAdapter({
      model: {
        provider: "openai",
        model: "text-embedding-3-small",
      },
      dependencies: {
        resolveEmbeddingModel: (config) => ({ resolvedFrom: config.model }) as never,
        embedMany: async ({ values }) => {
          activeCalls += 1;
          peakActiveCalls = Math.max(peakActiveCalls, activeCalls);
          calls.push([...values]);
          await new Promise((resolve) => setTimeout(resolve, 1));
          activeCalls -= 1;
          return {
            embeddings: values.map((value) => [value.charCodeAt(0), value.length]),
          } as never;
        },
      },
    });
    const texts = [
      `a${"x".repeat(119_999)}`,
      `b${"x".repeat(119_999)}`,
      "charlie",
    ];

    const result = await adapter.embed(texts);

    expect(calls).toHaveLength(2);
    expect(peakActiveCalls).toBe(2);
    expect(calls.map((batch) => batch.map((value) => value[0]))).toEqual([
      ["a"],
      ["b", "c"],
    ]);
    expect(result).toEqual([
      ["a".charCodeAt(0), 120_000],
      ["b".charCodeAt(0), 120_000],
      ["c".charCodeAt(0), 7],
    ]);
  });

  it("honors explicit embedding batch limits", async () => {
    const calls: string[][] = [];
    let activeCalls = 0;
    let peakActiveCalls = 0;
    const adapter = createAISDKEmbeddingAdapter({
      batchMaxConcurrency: 1,
      batchMaxInputs: 2,
      batchMaxUtf8Bytes: 6,
      model: {
        provider: "openai",
        model: "text-embedding-3-small",
      },
      dependencies: {
        resolveEmbeddingModel: () => ({}) as never,
        embedMany: async ({ values }) => {
          activeCalls += 1;
          peakActiveCalls = Math.max(peakActiveCalls, activeCalls);
          calls.push([...values]);
          await Bun.sleep(1);
          activeCalls -= 1;
          return {
            embeddings: values.map((value) => [value.length]),
          } as never;
        },
      },
    });

    await adapter.embed(["aa", "bb", "cccc", "d"]);

    expect(calls).toEqual([["aa", "bb"], ["cccc", "d"]]);
    expect(peakActiveCalls).toBe(1);
  });

  it("budgets embedding batches by UTF-8 bytes", async () => {
    const calls: string[][] = [];
    const adapter = createAISDKEmbeddingAdapter({
      model: {
        provider: "openai",
        model: "text-embedding-3-small",
      },
      dependencies: {
        resolveEmbeddingModel: (config) => ({ resolvedFrom: config.model }) as never,
        embedMany: async ({ values }) => {
          calls.push([...values]);
          return {
            embeddings: values.map((value) => [Buffer.byteLength(value, "utf8")]),
          } as never;
        },
      },
    });

    await adapter.embed(["a".repeat(110_000), "🧠".repeat(30_000)]);

    expect(calls).toHaveLength(2);
  });

  it("aborts embedding requests that exceed the adapter timeout", async () => {
    let aborted = false;
    const adapter = createAISDKEmbeddingAdapter({
      model: {
        provider: "openai",
        model: "text-embedding-3-small",
      },
      dependencies: {
        embedMany: (input) =>
          new Promise((_, reject) => {
            input.abortSignal?.addEventListener("abort", () => {
              aborted = true;
              reject(input.abortSignal?.reason ?? new Error("aborted"));
            });
          }) as never,
        requestTimeoutMs: 5,
        retryOptions: {
          retryLimit: 1,
        },
      },
    });

    await expect(adapter.embed(["alpha"])).rejects.toThrow(
      "AI SDK embedding timeout after 5ms",
    );
    expect(aborted).toBe(true);
  });

  it("creates a structured recall router using generateObject", async () => {
    const calls: Array<Record<string, unknown>> = [];
    let invocation = 0;
    const router = createLLMRecallRouter({
      model: {
        provider: "anthropic",
        model: "claude-sonnet",
      },
      dependencies: {
        resolveModel: (config) => ({ resolvedFrom: config.model }) as never,
        generateObject: async (input) => {
          calls.push(input as unknown as Record<string, unknown>);
          invocation += 1;

          if (invocation === 1) {
            return {
              object: {
                querySummary: "migration blocker source of truth",
                rationale: "reference lookup needs project-state support",
                requestedSlotAdditions: ["reference"],
                sourcePriorityOrder: ["fact", "profile", "feedback", "episode"],
                supportSlotAdditions: ["project_state_support"],
              },
            } as never;
          }

          return {
            object: {
              orderedCandidateIds: ["ref-1", "fact-1"],
              rationale: "runbook before blocker fact",
              suppressCandidateIds: [],
              decisions: [
                {
                  candidateId: "ref-1",
                  decision: "promote",
                  reason: "source_of_truth",
                },
              ],
            },
          } as never;
        },
      },
    });

    const plan = await router.plan({
      locale: "en",
      query: "which runbook is the source of truth",
      routingDecision: {
        retrievalProfile: "general_chat",
        intent: "general_assistance",
        strategy: "llm-assisted",
        strategyExplanation: {
          requestedStrategy: "llm-assisted",
          resolvedStrategy: "llm-assisted",
          summary: "llm-assisted routing enabled refinement",
          hardFloor: "lexical_runtime_procedural_priors",
          semanticTieBreaking: false,
          llmRefinement: true,
        },
        sourcePriorities: ["profile", "feedback", "fact", "episode"],
        requestedSlots: [],
        supportSlots: [],
        actionDriving: false,
        referenceSeeking: true,
        continuation: false,
      },
      runtime: {
        hasJournal: false,
        hasWorkingMemory: false,
      },
    });
    const rerank = await router.rerank({
      candidates: [
        {
          id: "fact-1",
          protected: false,
          summary: "Current blocker is service account rotation.",
          type: "fact",
        },
        {
          id: "ref-1",
          protected: false,
          summary: "Migration runbook docs/migration-runbook.md",
          type: "reference",
        },
      ],
      locale: "en",
      query: "which runbook is the source of truth",
      querySummary: plan.querySummary,
      routingDecision: {
        retrievalProfile: "general_chat",
        intent: "general_assistance",
        strategy: "llm-assisted",
        strategyExplanation: {
          requestedStrategy: "llm-assisted",
          resolvedStrategy: "llm-assisted",
          summary: "llm-assisted routing enabled refinement",
          hardFloor: "lexical_runtime_procedural_priors",
          semanticTieBreaking: false,
          llmRefinement: true,
        },
        sourcePriorities: ["profile", "feedback", "fact", "episode"],
        requestedSlots: ["reference"],
        supportSlots: ["project_state_support"],
        actionDriving: false,
        referenceSeeking: true,
        continuation: false,
      },
    });

    expect(plan.querySummary).toContain("source of truth");
    expect(plan.requestedSlotAdditions).toEqual(["reference"]);
    expect(rerank.orderedCandidateIds).toEqual(["ref-1", "fact-1"]);
    expect(rerank.decisions?.[0]?.reason).toBe("source_of_truth");
    expect(calls[0]?.maxRetries).toBe(0);
    expect(calls[0]?.schema).toBeTruthy();
    expect(calls[1]?.maxRetries).toBe(0);
    expect(calls[1]?.schema).toBeTruthy();
    expect(calls[0]?.timeout).toBe(DEFAULT_AISDK_REQUEST_TIMEOUT_MS);
    expect(calls[1]?.timeout).toBe(DEFAULT_AISDK_REQUEST_TIMEOUT_MS);
  });

  it("records legacy assisted recall plan and rerank calls separately", async () => {
    const events: ModelUsageAttempt[] = [];
    let invocation = 0;
    const router = createLLMRecallRouter({
      dependencies: {
        generateObject: async () => {
          invocation += 1;
          return {
            object: invocation === 1
              ? { querySummary: "summary", rationale: "reason" }
              : { orderedCandidateIds: ["fact-1"], rationale: "reason" },
            usage: { inputTokens: 8, outputTokens: 2 },
          } as never;
        },
        modelUsageSink: { emit(event) { events.push(event); } },
        resolveModel: () => ({}) as never,
      },
      model: { model: "gpt-5.6-terra", provider: "openai" },
    });
    const routingDecision: RoutingDecision = {
      actionDriving: false,
      continuation: false,
      intent: "general_assistance",
      referenceSeeking: false,
      requestedSlots: [],
      retrievalProfile: "general_chat",
      sourcePriorities: ["fact"],
      strategy: "llm-assisted",
      strategyExplanation: {
        hardFloor: "lexical_runtime_procedural_priors",
        llmRefinement: true,
        requestedStrategy: "llm-assisted",
        resolvedStrategy: "llm-assisted",
        semanticTieBreaking: false,
        summary: "assisted",
      },
      supportSlots: [],
    };

    const plan = await router.plan({
      locale: "en",
      query: "current project",
      routingDecision,
      runtime: { hasJournal: false, hasWorkingMemory: false },
    });
    await router.rerank({
      candidates: [{
        id: "fact-1",
        protected: false,
        summary: "current project",
        type: "fact",
      }],
      locale: "en",
      query: "current project",
      querySummary: plan.querySummary,
      routingDecision,
    });

    expect(events.map((event) => event.operation)).toEqual([
      "recall_router_plan",
      "recall_router_rerank",
    ]);
  });

  it("normalizes openai-compatible recall router alias payloads before schema validation", async () => {
    const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
    let invocation = 0;
    const router = createLLMRecallRouter({
      model: {
        provider: "openai",
        model: "gpt-5.4",
        apiKey: "gateway-key",
        baseURL: "https://gateway.example/v1",
      },
      dependencies: {
        fetch: async (url, init) => {
          fetchCalls.push({ url: String(url), init });
          invocation += 1;
          const content =
            invocation === 1
              ? "{\"query_summary\":\"migration source\",\"requested_slots\":[\"source_of_truth\"],\"support_slots\":[\"project_state\"],\"source_priorities\":[\"fact\",\"profile\",\"feedback\",\"episode\"]}"
              : "{\"ranked_ids\":[\"ref-1\",\"fact-1\"],\"suppressed_ids\":[\"episode-1\"]}";

          return new Response(
            [
              "data: {\"choices\":[{\"delta\":{\"role\":\"assistant\"},\"index\":0}]}",
              `data: {\"choices\":[{\"delta\":{\"content\":${JSON.stringify(content)}},\"index\":0}]}`,
              "data: [DONE]",
            ].join("\n\n") + "\n\n",
            {
              status: 200,
            },
          );
        },
      },
    });

    const plan = await router.plan({
      locale: "en",
      query: "which runbook is the source of truth",
      routingDecision: {
        retrievalProfile: "general_chat",
        intent: "general_assistance",
        strategy: "llm-assisted",
        strategyExplanation: {
          requestedStrategy: "llm-assisted",
          resolvedStrategy: "llm-assisted",
          summary: "llm-assisted routing enabled refinement",
          hardFloor: "lexical_runtime_procedural_priors",
          semanticTieBreaking: false,
          llmRefinement: true,
        },
        sourcePriorities: ["profile", "feedback", "fact", "episode"],
        requestedSlots: [],
        supportSlots: [],
        actionDriving: false,
        referenceSeeking: true,
        continuation: false,
      },
      runtime: {
        hasJournal: false,
        hasWorkingMemory: false,
      },
    });
    const rerank = await router.rerank({
      candidates: [
        {
          id: "fact-1",
          protected: false,
          summary: "Current blocker is service account rotation.",
          type: "fact",
        },
        {
          id: "ref-1",
          protected: false,
          summary: "Migration runbook docs/migration-runbook.md",
          type: "reference",
        },
        {
          id: "episode-1",
          protected: false,
          summary: "Prior episode about the migration.",
          type: "episode",
        },
      ],
      locale: "en",
      query: "which runbook is the source of truth",
      querySummary: plan.querySummary,
      routingDecision: {
        retrievalProfile: "general_chat",
        intent: "general_assistance",
        strategy: "llm-assisted",
        strategyExplanation: {
          requestedStrategy: "llm-assisted",
          resolvedStrategy: "llm-assisted",
          summary: "llm-assisted routing enabled refinement",
          hardFloor: "lexical_runtime_procedural_priors",
          semanticTieBreaking: false,
          llmRefinement: true,
        },
        sourcePriorities: ["fact", "profile", "feedback", "episode"],
        requestedSlots: ["reference"],
        supportSlots: ["project_state_support"],
        actionDriving: false,
        referenceSeeking: true,
        continuation: false,
      },
    });

    expect(plan.querySummary).toBe("migration source");
    expect(plan.requestedSlotAdditions).toEqual(["reference"]);
    expect(plan.supportSlotAdditions).toEqual(["project_state_support"]);
    expect(plan.sourcePriorityOrder).toEqual(["fact", "profile", "feedback", "episode"]);
    expect(rerank.orderedCandidateIds).toEqual(["ref-1", "fact-1"]);
    expect(rerank.suppressCandidateIds).toEqual(["episode-1"]);
    expect(rerank.decisions?.map((decision) => decision.decision)).toEqual([
      "promote",
      "promote",
      "suppress",
    ]);
    expect(fetchCalls).toHaveLength(2);
  });

  it("normalizes openai-compatible recall router decision aliases and object candidate ids", async () => {
    const router = createLLMRecallRouter({
      model: {
        provider: "openai",
        model: "gpt-5.4",
        apiKey: "gateway-key",
        baseURL: "https://gateway.example/v1",
      },
      dependencies: {
        fetch: async () =>
          new Response(
            [
              "data: {\"choices\":[{\"delta\":{\"role\":\"assistant\"},\"index\":0}]}",
              "data: {\"choices\":[{\"delta\":{\"content\":\"{\\\"ordered_candidates\\\":[{\\\"candidate_id\\\":\\\" ref-1 \\\"},{\\\"id\\\":\\\"fact-1\\\"}],\\\"suppressed\\\":[{\\\"memory_id\\\":\\\"archive-1\\\"}],\\\"decisions\\\":[{\\\"candidate_id\\\":\\\" ref-1 \\\",\\\"decision\\\":\\\"prioritize\\\",\\\"rationale\\\":\\\"source_reference\\\"},{\\\"id\\\":\\\"fact-1\\\",\\\"decision\\\":\\\"demote\\\",\\\"reason\\\":\\\"blocker_priority\\\"},{\\\"id\\\":\\\"archive-1\\\",\\\"decision\\\":\\\"suppress\\\"}],\\\"reasoning\\\":\\\"rerank aliases\\\"}\"},\"index\":0}]}",
              "data: [DONE]",
              "",
            ].join("\n\n"),
            {
              status: 200,
              headers: {
                "content-type": "text/event-stream",
              },
            },
          ),
      },
    });

    const rerank = await router.rerank({
      candidates: [
        {
          id: "fact-1",
          protected: false,
          summary: "Current blocker is service account rotation.",
          type: "fact",
        },
        {
          id: "ref-1",
          protected: false,
          summary: "Migration runbook docs/migration-runbook.md",
          type: "reference",
        },
        {
          id: "archive-1",
          protected: false,
          summary: "Paused while waiting on the migration runbook confirmation.",
          type: "archive",
        },
      ],
      locale: "en",
      query: "which runbook is the source of truth",
      routingDecision: {
        retrievalProfile: "general_chat",
        intent: "general_assistance",
        strategy: "llm-assisted",
        strategyExplanation: {
          requestedStrategy: "llm-assisted",
          resolvedStrategy: "llm-assisted",
          summary: "llm-assisted routing enabled refinement",
          hardFloor: "lexical_runtime_procedural_priors",
          semanticTieBreaking: false,
          llmRefinement: true,
        },
        sourcePriorities: ["fact", "profile", "feedback", "episode"],
        requestedSlots: ["reference"],
        supportSlots: ["project_state_support"],
        actionDriving: false,
        referenceSeeking: true,
        continuation: false,
      },
    });

    expect(rerank.orderedCandidateIds).toEqual(["ref-1", "fact-1"]);
    expect(rerank.suppressCandidateIds).toEqual(["archive-1"]);
    expect(rerank.rationale).toBe("rerank aliases");
    expect(rerank.decisions).toEqual([
      {
        candidateId: "ref-1",
        decision: "promote",
        reason: "source_of_truth",
      },
      {
        candidateId: "fact-1",
        decision: "suppress",
        reason: "task_blocker",
      },
      {
        candidateId: "archive-1",
        decision: "suppress",
        reason: "query_alignment",
      },
    ]);
  });

  it("falls back to undefined alias arrays when openai-compatible recall plan payload fields are not arrays", async () => {
    const router = createLLMRecallRouter({
      model: {
        provider: "openai",
        model: "gpt-5.4",
        apiKey: "gateway-key",
        baseURL: "https://gateway.example/v1",
      },
      dependencies: {
        fetch: async () =>
          new Response(
            [
              "data: {\"choices\":[{\"delta\":{\"role\":\"assistant\"},\"index\":0}]}",
              "data: {\"choices\":[{\"delta\":{\"content\":\"{\\\"query_summary\\\":\\\"migration source\\\",\\\"requested_slots\\\":[],\\\"support_slots\\\":\\\"project_state\\\",\\\"source_priorities\\\":\\\"fact\\\"}\"},\"index\":0}]}",
              "data: [DONE]",
              "",
            ].join("\n\n"),
            {
              status: 200,
              headers: {
                "content-type": "text/event-stream",
              },
            },
          ),
      },
    });

    const plan = await router.plan({
      locale: "en",
      query: "which runbook is the source of truth",
      routingDecision: {
        retrievalProfile: "general_chat",
        intent: "general_assistance",
        strategy: "llm-assisted",
        strategyExplanation: {
          requestedStrategy: "llm-assisted",
          resolvedStrategy: "llm-assisted",
          summary: "llm-assisted routing enabled refinement",
          hardFloor: "lexical_runtime_procedural_priors",
          semanticTieBreaking: false,
          llmRefinement: true,
        },
        sourcePriorities: ["profile", "feedback", "fact", "episode"],
        requestedSlots: [],
        supportSlots: [],
        actionDriving: false,
        referenceSeeking: true,
        continuation: false,
      },
      runtime: {
        hasJournal: false,
        hasWorkingMemory: false,
      },
    });

    expect(plan.querySummary).toBe("migration source");
    expect(plan.requestedSlotAdditions).toBeUndefined();
    expect(plan.supportSlotAdditions).toBeUndefined();
    expect(plan.sourcePriorityOrder).toBeUndefined();
  });

  it("rejects anthropic embedding model resolution because embeddings are unsupported", () => {
    expect(() =>
      resolveAISDKEmbeddingModel({
        provider: "anthropic",
        model: "claude-sonnet",
      }),
    ).toThrow("does not currently support text embeddings");
  });

  it("uses fetch-based memory extraction for openai-compatible base URLs", async () => {
    const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
    const extractor = createAISDKMemoryExtractor({
      maxOutputTokens: 4_096,
      responseFormat: "json_schema",
      model: {
        provider: "openai",
        model: "gpt-5.4",
        apiKey: "gateway-key",
        baseURL: "https://gateway.example/v1",
      },
      system: "extract durable memory",
      temperature: 0,
      dependencies: {
        fetch: async (url, init) => {
          fetchCalls.push({ url: String(url), init });
          return new Response(
            [
              "data: {\"choices\":[{\"delta\":{\"role\":\"assistant\"},\"index\":0}]}",
              "data: {\"choices\":[{\"delta\":{\"content\":\"{\\\"candidates\\\":[{\\\"id\\\":\\\"llm-1\\\",\\\"kindHint\\\":\\\"fact\\\",\\\"explicitness\\\":\\\"explicit\\\",\\\"content\\\":\\\"Runtime rollout still needs legal signoff.\\\",\\\"sourceMessageIndex\\\":0,\\\"sourceRole\\\":\\\"user\\\",\\\"metadata\\\":{\\\"category\\\":\\\"project\\\",\\\"factKind\\\":\\\"open_loop\\\",\\\"subject\\\":\\\"runtime rollout\\\"}}],\\\"ignoredMessageCount\\\":0}\"},\"index\":0}]}",
              "data: [DONE]",
              "",
            ].join("\n\n"),
            {
              status: 200,
              headers: {
                "content-type": "text/event-stream",
              },
            },
          );
        },
        generateObject: async () => {
          throw new Error("generateObject should not run for openai-compatible base URLs");
        },
      },
    });

    const result = await extractor.extract({
      scope: { userId: "u-1" },
      messages: [
        {
          role: "user",
          content: "Heads up: legal still needs to sign off on the runtime rollout.",
        },
      ],
    });

    expect(result.candidates[0]?.metadata?.subject).toBe("runtime rollout");
    expect(fetchCalls[0]?.url).toBe("https://gateway.example/v1/chat/completions");
    expect(fetchCalls[0]?.init?.method).toBe("POST");
    const requestBody = JSON.parse(String(fetchCalls[0]?.init?.body));
    expect(requestBody).toMatchObject({
      max_tokens: 4_096,
      reasoning_effort: "medium",
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "structured_response",
          strict: false,
          schema: {
            type: "object",
            required: ["candidates", "ignoredMessageCount"],
          },
        },
      },
      temperature: 0,
    });
    expect(JSON.stringify(requestBody.response_format)).not.toContain(
      "propertyNames",
    );
    expect(String(fetchCalls[0]?.init?.body)).toContain("\"content\":\"extract durable memory\"");
    expect(String(fetchCalls[0]?.init?.body)).toContain("runtime rollout");
  });

  it("uses schema-constrained structured output on every metered extraction retry", async () => {
    const events: ModelUsageAttempt[] = [];
    const requestBodies: Array<Record<string, unknown>> = [];
    let calls = 0;
    const extractor = createAISDKMemoryExtractor({
      responseFormat: "json_schema",
      model: {
        provider: "openai",
        model: "gpt-5.6-terra",
        apiKey: "gateway-key",
        baseURL: "https://gateway.example/v1",
      },
      dependencies: {
        fetch: async (_url, init) => {
          calls += 1;
          requestBodies.push(JSON.parse(String(init?.body)));
          const content = calls === 1
            ? '{"candidates":[],"ignoredMessageCount":0'
            : '{"candidates":[],"ignoredMessageCount":1}';
          return new Response(
            [
              `data: ${JSON.stringify({
                choices: [{ delta: { content }, index: 0 }],
              })}`,
              `data: ${JSON.stringify({
                choices: [],
                usage: { prompt_tokens: 21, completion_tokens: 5 },
              })}`,
              "data: [DONE]",
              "",
            ].join("\n\n"),
            {
              status: 200,
              headers: { "content-type": "text/event-stream" },
            },
          );
        },
        modelUsageSink: { emit(event) { events.push(event); } },
        retryOptions: { retryLimit: 2, sleep: async () => {} },
      },
    });

    await expect(extractor.extract({
      scope: { userId: "u-1" },
      messages: [{ role: "user", content: "hello" }],
    })).resolves.toEqual({ candidates: [], ignoredMessageCount: 1 });

    expect(requestBodies).toHaveLength(2);
    for (const body of requestBodies) {
      expect(body.response_format).toMatchObject({
        type: "json_schema",
        json_schema: {
          name: "structured_response",
          strict: false,
        },
      });
    }
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      attempt: 1,
      completeness: "complete",
      operation: "assisted_extraction",
      outcome: "failed",
    });
    expect(events[1]).toMatchObject({
      attempt: 2,
      completeness: "complete",
      operation: "assisted_extraction",
      outcome: "succeeded",
    });
  });

  it("normalizes openai-compatible memory extraction enum aliases before schema validation", async () => {
    const extractor = createAISDKMemoryExtractor({
      model: {
        provider: "openai",
        model: "gpt-5.4",
        apiKey: "gateway-key",
        baseURL: "https://gateway.example/v1",
      },
      dependencies: {
        fetch: async () =>
          new Response(
            [
              "data: {\"choices\":[{\"delta\":{\"role\":\"assistant\"},\"index\":0}]}",
              "data: {\"choices\":[{\"delta\":{\"content\":\"{\\\"candidates\\\":[{\\\"id\\\":1,\\\"kindHint\\\":\\\"durable_fact\\\",\\\"explicitness\\\":\\\"direct\\\",\\\"content\\\":\\\"Runtime rollout still needs legal signoff.\\\",\\\"sourceMessageIndex\\\":\\\"0\\\",\\\"sourceRole\\\":\\\"USER\\\"}],\\\"ignoredMessageCount\\\":\\\"0\\\"}\"},\"index\":0}]}",
              "data: [DONE]",
              "",
            ].join("\n\n"),
            {
              status: 200,
              headers: {
                "content-type": "text/event-stream",
              },
            },
          ),
      },
    });

    const result = await extractor.extract({
      scope: { userId: "u-1" },
      messages: [
        {
          role: "user",
          content: "Heads up: legal still needs to sign off on the runtime rollout.",
        },
      ],
    });

    expect(result).toEqual({
      candidates: [
        {
          id: "1",
          kindHint: "fact",
          explicitness: "explicit",
          content: "Runtime rollout still needs legal signoff.",
          sourceMessageIndex: 0,
          sourceRole: "user",
        },
      ],
      ignoredMessageCount: 0,
    });
  });

  it("preserves durable extraction candidates when optional taxonomy labels are unknown", async () => {
    const payload = JSON.stringify({
      candidates: [{
        content: "Tim values the friends he made through fantasy conventions.",
        explicitness: "explicit",
        id: "llm-1",
        kindHint: "relationship_memory",
        metadata: {
          claim: {
            modality: "currently_true",
            objectText: "the friends he made through fantasy conventions",
            polarity: "positive",
            predicateKey: "relationships.values",
          },
          subject: "Tim",
        },
        sourceMessageIndex: 0,
        sourceRole: "user",
      }],
      ignoredMessageCount: 0,
    });
    const extractor = createAISDKMemoryExtractor({
      model: {
        apiKey: "gateway-key",
        baseURL: "https://gateway.example/v1",
        model: "gpt-5.4",
        provider: "openai",
      },
      dependencies: {
        fetch: async () => new Response(
          `data: ${JSON.stringify({
            choices: [{ delta: { content: payload }, index: 0 }],
          })}\n\ndata: [DONE]\n\n`,
          {
            headers: { "content-type": "text/event-stream" },
            status: 200,
          },
        ),
      },
    });

    const result = await extractor.extract({
      messages: [{
        content: "The friends I made through fantasy conventions mean a lot to me.",
        role: "user",
      }],
      scope: { userId: "u-1" },
    });

    expect(result.candidates[0]).toMatchObject({
      kindHint: "fact",
      metadata: {
        claim: {
          modality: "unknown",
          objectText: "the friends he made through fantasy conventions",
          polarity: "positive",
          predicateKey: "relationships.values",
        },
      },
    });
  });

  it("accepts domain-defined memory categories from provider extraction", async () => {
    const extractor = createAISDKMemoryExtractor({
      model: {
        provider: "openai",
        model: "gpt-5.4",
        apiKey: "gateway-key",
        baseURL: "https://gateway.example/v1",
      },
      dependencies: {
        fetch: async () =>
          new Response(
            [
              "data: {\"choices\":[{\"delta\":{\"content\":\"{\\\"candidates\\\":[{\\\"id\\\":\\\"llm-1\\\",\\\"kindHint\\\":\\\"fact\\\",\\\"explicitness\\\":\\\"explicit\\\",\\\"content\\\":\\\"The user rides a mountain bike.\\\",\\\"sourceMessageIndex\\\":0,\\\"sourceRole\\\":\\\"user\\\",\\\"metadata\\\":{\\\"category\\\":\\\"cycling\\\",\\\"subject\\\":\\\"the user\\\"}}],\\\"ignoredMessageCount\\\":0}\"},\"index\":0}]}",
              "data: [DONE]",
              "",
            ].join("\n\n"),
            {
              status: 200,
              headers: {
                "content-type": "text/event-stream",
              },
            },
          ),
      },
    });

    const result = await extractor.extract({
      scope: { userId: "u-1" },
      messages: [{ role: "user", content: "I ride a mountain bike." }],
    });

    expect(result.candidates[0]?.metadata).toEqual({
      category: "cycling",
      subject: "the user",
    });
  });

  it("retries invalid structured memory extraction payloads for openai-compatible base URLs", async () => {
    let attempts = 0;
    const extractor = createAISDKMemoryExtractor({
      model: {
        provider: "openai",
        model: "gpt-5.4",
        apiKey: "gateway-key",
        baseURL: "https://gateway.example/v1",
      },
      dependencies: {
        fetch: async () => {
          attempts += 1;
          return new Response(
            attempts < 3
              ? "data: {\"choices\":[{\"delta\":{\"content\":\"{\\\"candidates\\\":[],\\\"ignoredMessageCount\\\":\\\"oops\\\"}\"},\"index\":0}]}\n\ndata: [DONE]\n\n"
              : "data: {\"choices\":[{\"delta\":{\"content\":\"{\\\"candidates\\\":[{\\\"id\\\":\\\"llm-1\\\",\\\"kindHint\\\":\\\"fact\\\",\\\"explicitness\\\":\\\"explicit\\\",\\\"content\\\":\\\"Runtime rollout still needs legal signoff.\\\",\\\"sourceMessageIndex\\\":0,\\\"sourceRole\\\":\\\"user\\\"}],\\\"ignoredMessageCount\\\":0}\"},\"index\":0}]}\n\ndata: [DONE]\n\n",
            {
              status: 200,
              headers: {
                "content-type": "text/event-stream",
              },
            },
          );
        },
      },
    });

    const result = await extractor.extract({
      scope: { userId: "u-1" },
      messages: [
        {
          role: "user",
          content: "Heads up: legal still needs to sign off on the runtime rollout.",
        },
      ],
    });

    expect(result.ignoredMessageCount).toBe(0);
    expect(result.candidates[0]?.id).toBe("llm-1");
    expect(attempts).toBe(3);
  });

  it("retries transient gateway validation failures for judge generation", async () => {
    let attempts = 0;
    const judge = createAISDKJudgeModel({
      model: {
        provider: "anthropic",
        model: "claude-sonnet",
      },
      dependencies: {
        resolveModel: (config) => ({ resolvedFrom: config.model }) as never,
        generateObject: async () => {
          attempts += 1;
          if (attempts < 3) {
            throw new Error(
              "AI_TypeValidationError: Type validation failed: Invalid input: expected array, received null",
            );
          }

          return {
            object: {
              winner: "goodmemory",
              scores: {
                factual_recall: 9,
                preference_consistency: 9,
                cross_domain_transfer: 9,
                contamination_penalty: 9,
                update_correctness: 9,
                personalization_usefulness: 9,
                provenance_explainability: 9,
              },
              reasoning: "comparison complete",
              failure_tags: [],
            },
          } as never;
        },
      },
    });

    const result = await judge.complete({
      purpose: "eval_judge",
      prompt: "judge this",
    });

    expect(JSON.parse(result.content).winner).toBe("goodmemory");
    expect(attempts).toBe(3);
  });

  it("retries empty judge responses instead of returning blank content", async () => {
    let attempts = 0;
    const judge = createAISDKJudgeModel({
      model: {
        provider: "openai",
        model: "gpt-5.4",
        apiKey: "gateway-key",
        baseURL: "https://gateway.example/v1",
      },
      dependencies: {
        fetch: async () => {
          attempts += 1;
          return new Response(
            attempts < 3
              ? "data: {\"choices\":[{\"delta\":{\"content\":\"   \"},\"index\":0}]}\n\ndata: [DONE]\n\n"
              : "data: {\"choices\":[{\"delta\":{\"content\":\"{\\\"winner\\\":\\\"tie\\\",\\\"scores\\\":{\\\"factual_recall\\\":7,\\\"preference_consistency\\\":7,\\\"cross_domain_transfer\\\":7,\\\"contamination_penalty\\\":7,\\\"update_correctness\\\":7,\\\"personalization_usefulness\\\":7,\\\"provenance_explainability\\\":7},\\\"reasoning\\\":\\\"ok\\\",\\\"failure_tags\\\":[]}\"},\"index\":0}]}\n\ndata: [DONE]\n\n",
            {
              status: 200,
              headers: {
                "content-type": "text/event-stream",
              },
            },
          );
        },
      },
    });

    const result = await judge.complete({
      purpose: "eval_judge",
      prompt: "judge this",
    });

    expect(JSON.parse(result.content).winner).toBe("tie");
    expect(attempts).toBe(3);
  });

  it("uses fetch-based judge generation for openai-compatible base URLs", async () => {
    const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
    const judge = createAISDKJudgeModel({
      model: {
        provider: "openai",
        model: "gpt-5.4",
        apiKey: "gateway-key",
        baseURL: "https://gateway.example/v1",
      },
      system: "judge system",
      dependencies: {
        fetch: async (url, init) => {
          fetchCalls.push({ url: String(url), init });
          return new Response(
            "data: {\"choices\":[{\"delta\":{\"content\":\"<think>{\\\"scratch\\\":1}</think>\\n{\\\"winner\\\":\\\"tie\\\",\\\"scores\\\":{\\\"factual_recall\\\":7,\\\"preference_consistency\\\":7,\\\"cross_domain_transfer\\\":7,\\\"contamination_penalty\\\":7,\\\"update_correctness\\\":7,\\\"personalization_usefulness\\\":7,\\\"provenance_explainability\\\":7},\\\"reasoning\\\":\\\"ok\\\",\\\"failure_tags\\\":[]}\"},\"index\":0}]}\n\ndata: [DONE]\n\n",
            {
              status: 200,
              headers: {
                "content-type": "text/event-stream",
              },
            },
          );
        },
        generateObject: async () => {
          throw new Error("generateObject should not run for openai-compatible base URLs");
        },
      },
    });

    const result = await judge.complete({
      purpose: "eval_judge",
      prompt: "judge this",
    });

    expect(JSON.parse(result.content).winner).toBe("tie");
    expect(fetchCalls[0]?.url).toBe("https://gateway.example/v1/chat/completions");
    expect(fetchCalls[0]?.init?.method).toBe("POST");
    expect(String(fetchCalls[0]?.init?.body)).toContain("\"reasoning_effort\":\"medium\"");
    expect(String(fetchCalls[0]?.init?.body)).toContain("\"content\":\"judge system\"");
    expect(String(fetchCalls[0]?.init?.body)).toContain("\"content\":\"judge this\"");
  });

  it("uses fetch-based text generation for openai-compatible base URLs", async () => {
    const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
    const generator = createAISDKTextGenerator({
      model: {
        provider: "openai",
        model: "gpt-5.4",
        apiKey: "gateway-key",
        baseURL: "https://gateway.example/v1",
      },
      system: "system prompt",
      dependencies: {
        fetch: async (url, init) => {
          fetchCalls.push({ url: String(url), init });
          return new Response(
            [
              "data: {\"choices\":[{\"delta\":{\"role\":\"assistant\"},\"index\":0}]}",
              "data: {\"choices\":[{\"delta\":{\"content\":\"<think>hidden</think>\\n\\nfetch-answer\"},\"index\":0}]}",
              "data: [DONE]",
              "",
            ].join("\n\n"),
            {
              status: 200,
              headers: {
                "content-type": "text/event-stream",
              },
            },
          );
        },
      },
    });

    const result = await generator({
      persona: {} as never,
      scenario: {} as never,
      transcript: "user: hi",
      prompt: "continue",
    });

    expect(result.content).toBe("fetch-answer");
    expect(fetchCalls[0]?.url).toBe("https://gateway.example/v1/chat/completions");
    expect(fetchCalls[0]?.init?.method).toBe("POST");
    expect(String(fetchCalls[0]?.init?.body)).toContain("\"reasoning_effort\":\"medium\"");
    expect(String(fetchCalls[0]?.init?.body)).toContain("\"content\":\"system prompt\"");
    expect(String(fetchCalls[0]?.init?.body)).toContain("User request:\\ncontinue");
  });

  it("retries malformed openai-compatible stream chunks and recovers on a later attempt", async () => {
    let attempts = 0;
    const generator = createAISDKTextGenerator({
      model: {
        provider: "openai",
        model: "gpt-5.4",
        apiKey: "gateway-key",
        baseURL: "https://gateway.example/v1",
      },
      dependencies: {
        fetch: async () => {
          attempts += 1;
          return new Response(
            attempts < 3
              ? "data: {\"id\":\"resp_bad\",\"choices\":null}\n\ndata: [DONE]\n\n"
              : "data: {\"choices\":[{\"delta\":{\"content\":\"recovered-stream-answer\"},\"index\":0}]}\n\ndata: [DONE]\n\n",
            {
              status: 200,
              headers: {
                "content-type": "text/event-stream",
              },
            },
          );
        },
      },
    });

    const result = await generator({
      persona: {} as never,
      scenario: {} as never,
      transcript: "user: hi",
      prompt: "continue",
    });

    expect(result.content).toBe("recovered-stream-answer");
    expect(attempts).toBe(3);
  });

  it("retries timed out openai-compatible requests and succeeds on a later attempt", async () => {
    let attempts = 0;
    const generator = createAISDKTextGenerator({
      model: {
        provider: "openai",
        model: "gpt-5.4",
        apiKey: "gateway-key",
        baseURL: "https://gateway.example/v1",
      },
      dependencies: {
        requestTimeoutMs: 10,
        retryOptions: {
          sleep: async () => undefined,
        },
        fetch: async (_url, init) => {
          attempts += 1;
          if (attempts < 3) {
            return new Promise<Response>((_resolve, reject) => {
              init?.signal?.addEventListener(
                "abort",
                () => {
                  reject(init.signal?.reason ?? new Error("aborted"));
                },
                { once: true },
              );
            });
          }

          return new Response(
            "data: {\"choices\":[{\"delta\":{\"content\":\"timeout-recovered-answer\"},\"index\":0}]}\n\ndata: [DONE]\n\n",
            {
              status: 200,
              headers: {
                "content-type": "text/event-stream",
              },
            },
          );
        },
      },
    });

    const result = await generator({
      persona: {} as never,
      scenario: {} as never,
      transcript: "user: hi",
      prompt: "continue",
    });

    expect(result.content).toBe("timeout-recovered-answer");
    expect(attempts).toBe(3);
  });

  it("retries when the response body hangs after the stream starts", async () => {
    let attempts = 0;
    const generator = createAISDKTextGenerator({
      model: {
        provider: "openai",
        model: "gpt-5.4",
        apiKey: "gateway-key",
        baseURL: "https://gateway.example/v1",
      },
      dependencies: {
        requestTimeoutMs: 10,
        retryOptions: {
          sleep: async () => undefined,
        },
        fetch: async (_url, init) => {
          attempts += 1;
          if (attempts < 3) {
            return new Response(
              new ReadableStream({
                start(controller) {
                  controller.enqueue(
                    new TextEncoder().encode(
                      "data: {\"choices\":[{\"delta\":{\"role\":\"assistant\"},\"index\":0}]}\n\n",
                    ),
                  );
                  init?.signal?.addEventListener(
                    "abort",
                    () => {
                      controller.error(init.signal?.reason ?? new Error("aborted"));
                    },
                    { once: true },
                  );
                },
              }),
              {
                status: 200,
                headers: {
                  "content-type": "text/event-stream",
                },
              },
            );
          }

          return new Response(
            "data: {\"choices\":[{\"delta\":{\"content\":\"stream-timeout-recovered\"},\"index\":0}]}\n\ndata: [DONE]\n\n",
            {
              status: 200,
              headers: {
                "content-type": "text/event-stream",
              },
            },
          );
        },
      },
    });

    const result = await generator({
      persona: {} as never,
      scenario: {} as never,
      transcript: "user: hi",
      prompt: "continue",
    });

    expect(result.content).toBe("stream-timeout-recovered");
    expect(attempts).toBe(3);
  });

  it("enforces one wall-clock deadline across a streaming response", async () => {
    const startedAt = Date.now();

    await expect(requestOpenAICompatibleText({
      fetch: async (_url, init) => new Response(
        new ReadableStream({
          start(controller) {
            const interval = setInterval(() => {
              controller.enqueue(new TextEncoder().encode(
                'data: {"choices":[{"delta":{"role":"assistant"},"index":0}]}\n\n',
              ));
            }, 5);
            const done = setTimeout(() => {
              clearInterval(interval);
              controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
              controller.close();
            }, 50);
            init?.signal?.addEventListener("abort", () => {
              clearInterval(interval);
              clearTimeout(done);
              controller.error(init.signal?.reason ?? new Error("aborted"));
            }, { once: true });
          },
        }),
        {
          headers: { "content-type": "text/event-stream" },
          status: 200,
        },
      ),
      model: {
        apiKey: "gateway-key",
        baseURL: "https://gateway.example/v1",
        model: "gpt-5.6-terra",
        provider: "openai",
      },
      prompt: "answer",
      timeoutMs: 15,
    })).rejects.toThrow("gateway timeout after 15ms");

    expect(Date.now() - startedAt).toBeLessThan(45);
  });

  it("retries truncated judge streams instead of returning partial json", async () => {
    let attempts = 0;
    const judge = createAISDKJudgeModel({
      model: {
        provider: "openai",
        model: "gpt-5.4",
        apiKey: "gateway-key",
        baseURL: "https://gateway.example/v1",
      },
      dependencies: {
        fetch: async () => {
          attempts += 1;
          return new Response(
            attempts < 3
              ? "data: {\"choices\":[{\"delta\":{\"content\":\"{\\\"winner\\\":\\\"ti\"},\"index\":0}]}\n\n"
              : "data: {\"choices\":[{\"delta\":{\"content\":\"{\\\"winner\\\":\\\"tie\\\",\\\"scores\\\":{\\\"factual_recall\\\":7,\\\"preference_consistency\\\":7,\\\"cross_domain_transfer\\\":7,\\\"contamination_penalty\\\":7,\\\"update_correctness\\\":7,\\\"personalization_usefulness\\\":7,\\\"provenance_explainability\\\":7},\\\"reasoning\\\":\\\"ok\\\",\\\"failure_tags\\\":[]}\"},\"index\":0}]}\n\ndata: [DONE]\n\n",
            {
              status: 200,
              headers: {
                "content-type": "text/event-stream",
              },
            },
          );
        },
      },
    });

    const result = await judge.complete({
      purpose: "eval_judge",
      prompt: "judge this",
    });

    expect(JSON.parse(result.content).winner).toBe("tie");
    expect(attempts).toBe(3);
  });

  it("turns malformed openai-compatible json payloads into concise retryable fetch errors", async () => {
    const wrappedFetch = createOpenAICompatibleFetch(async () =>
      new Response(
        JSON.stringify({
          id: "",
          object: "",
          created: 0,
          model: "",
          system_fingerprint: null,
          choices: null,
          usage: null,
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
          },
        },
      ),
    );

    await expect(
      wrappedFetch("https://gateway.example/v1/chat/completions", {
        method: "POST",
      }),
    ).rejects.toThrow(
      "Malformed openai-compatible gateway response: expected choices array or error object.",
    );
  });

  it("passes through valid event streams without buffering them", async () => {
    const response = new Response("data: {\"choices\":[{\"delta\":{\"content\":\"ok\"}}]}\n\n", {
      status: 200,
      headers: {
        "content-type": "text/event-stream",
      },
    });
    const wrappedFetch = createOpenAICompatibleFetch(async () => response);

    await expect(
      wrappedFetch("https://gateway.example/v1/chat/completions", {
        method: "POST",
      }),
    ).resolves.toBe(response);
  });
});
