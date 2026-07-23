import { describe, expect, it } from "bun:test";
import type { JudgeModel } from "../../src/eval/judge";
import type { EmbeddingAdapter } from "../../src/embedding/contracts";
import type { EvalAnswerGenerator } from "../../src/eval/runners";
import type { RecallRouterAssistant } from "../../src/recall/assistant";
import type { MemoryExtractor } from "../../src/remember/candidates";
import {
  createFallbackAdapterDescriptor,
  createLiveAdapterDescriptor,
  createProviderEmbeddingAdapter,
  createProviderConversationalMemoryExtractor,
  createProviderJudgeModel,
  createProviderListwiseReranker,
  createProviderMemoryExtractor,
  createProviderPointwiseReranker,
  createProviderRecallPlanAssistant,
  createProviderRecallRouter,
  createProviderRuntimeMetadata,
  createProviderTextGenerator,
} from "../../src/eval/provider-harness";

describe("provider layer contract", () => {
  it("builds explicit runtime metadata for fallback and live provider targets", () => {
    expect(
      createProviderRuntimeMetadata({
        generation: createFallbackAdapterDescriptor(),
        judge: createFallbackAdapterDescriptor(),
      }),
    ).toEqual({
      generationAdapter: "fallback",
      generationMode: "fallback",
      judgeAdapter: "fallback",
      judgeMode: "fallback",
    });

    expect(
      createProviderRuntimeMetadata({
        generation: createLiveAdapterDescriptor({
          providerId: "openai",
          modelId: "gpt-5",
        }),
        judge: createLiveAdapterDescriptor({
          providerId: "anthropic",
          modelId: "claude-sonnet",
        }),
      }),
    ).toEqual({
      generationAdapter: "live-adapter",
      generationMode: "live",
      generationModelId: "gpt-5",
      generationProviderId: "openai",
      judgeAdapter: "live-adapter",
      judgeMode: "live",
      judgeModelId: "claude-sonnet",
      judgeProviderId: "anthropic",
    });
  });

  it("routes provider-backed text and judge creation through one internal contract", async () => {
    const textCalls: Array<Record<string, unknown>> = [];
    const judgeCalls: Array<Record<string, unknown>> = [];

    const textGenerator = createProviderTextGenerator({
      model: {
        provider: "openai",
        model: "gpt-5",
      },
      requestTimeoutMs: 1234,
      system: "provider-system",
      createTextGenerator: (input) => {
        textCalls.push(input as unknown as Record<string, unknown>);
        const generator: EvalAnswerGenerator = async () => ({
          content: "provider-answer",
        });
        return generator;
      },
    });
    const judgeModel = createProviderJudgeModel({
      model: {
        provider: "anthropic",
        model: "claude-sonnet",
      },
      requestTimeoutMs: 1234,
      createJudgeModel: (input) => {
        judgeCalls.push(input as unknown as Record<string, unknown>);
        const judge: JudgeModel = {
          async complete() {
            return {
              content: "{\"winner\":\"tie\",\"scores\":{\"factual_recall\":7,\"preference_consistency\":7,\"cross_domain_transfer\":7,\"contamination_penalty\":7,\"update_correctness\":7,\"personalization_usefulness\":7,\"provenance_explainability\":7},\"reasoning\":\"ok\",\"failure_tags\":[]}",
            };
          },
        };

        return judge;
      },
    });

    const textResult = await textGenerator({
      persona: {} as never,
      scenario: {} as never,
      prompt: "continue",
      transcript: "user: hi",
    });
    const judgeResult = await judgeModel.complete({
      purpose: "judge",
      prompt: "judge this",
    });

    expect(textResult.content).toBe("provider-answer");
    expect(judgeResult.content).toContain("\"winner\":\"tie\"");
    expect(textCalls[0]?.model).toEqual({
      provider: "openai",
      model: "gpt-5",
    });
    expect(judgeCalls[0]?.model).toEqual({
      provider: "anthropic",
      model: "claude-sonnet",
    });
    expect(textCalls[0]?.dependencies).toEqual({ requestTimeoutMs: 1234 });
    expect(judgeCalls[0]?.dependencies).toEqual({ requestTimeoutMs: 1234 });
  });

  it("routes provider-backed memory extraction through the same provider layer", async () => {
    const extractorCalls: Array<Record<string, unknown>> = [];

    const extractor = createProviderMemoryExtractor({
      maxOutputTokens: 4_096,
      model: {
        provider: "openai",
        model: "gpt-5",
      },
      requestTimeoutMs: 1234,
      retryLimit: 4,
      reasoningEffort: "low",
      temperature: 0,
      createMemoryExtractor: (input) => {
        extractorCalls.push(input as unknown as Record<string, unknown>);
        const memoryExtractor: MemoryExtractor = {
          async extract() {
            return {
              candidates: [],
              ignoredMessageCount: 1,
            };
          },
        };

        return memoryExtractor;
      },
    });

    const result = await extractor.extract({
      scope: { userId: "u-1" },
      messages: [{ role: "user", content: "hi" }],
    });

    expect(result.ignoredMessageCount).toBe(1);
    expect(extractorCalls[0]?.model).toEqual({
      provider: "openai",
      model: "gpt-5",
    });
    expect(extractorCalls[0]?.dependencies).toEqual({
      requestTimeoutMs: 1234,
      retryOptions: { retryLimit: 4 },
    });
    expect(extractorCalls[0]?.maxOutputTokens).toBe(4_096);
    expect(extractorCalls[0]?.reasoningEffort).toBe("low");
    expect(extractorCalls[0]?.temperature).toBe(0);
  });

  it("routes provider-backed embedding creation through the same provider layer", async () => {
    const embeddingCalls: Array<Record<string, unknown>> = [];
    const fetch = async () => new Response("{}");

    const adapter = createProviderEmbeddingAdapter({
      batchMaxConcurrency: 2,
      batchMaxInputs: 64,
      batchMaxUtf8Bytes: 12_345,
      expectedDimensions: 1_024,
      fetch,
      model: {
        provider: "openai",
        model: "baai/bge-m3",
      },
      normalization: "l2-v1",
      requestTimeoutMs: 1234,
      retryLimit: 4,
      createEmbeddingAdapter: (input) => {
        embeddingCalls.push(input as unknown as Record<string, unknown>);
        const embeddingAdapter: EmbeddingAdapter = {
          async embed(texts) {
            return texts.map(() => [1, 0, 0]);
          },
        };

        return embeddingAdapter;
      },
    });

    const vectors = await adapter.embed(["alpha"]);

    expect(vectors).toEqual([[1, 0, 0]]);
    expect(embeddingCalls[0]?.model).toEqual({
      provider: "openai",
      model: "baai/bge-m3",
    });
    expect(embeddingCalls[0]).toMatchObject({
      batchMaxConcurrency: 2,
      batchMaxInputs: 64,
      batchMaxUtf8Bytes: 12_345,
      expectedDimensions: 1_024,
      fetch,
      normalization: "l2-v1",
      dependencies: {
        requestTimeoutMs: 1234,
        retryOptions: { retryLimit: 4 },
      },
    });
  });

  it("routes provider-backed recall router creation through the same provider layer", async () => {
    const routerCalls: Array<Record<string, unknown>> = [];

    const router = createProviderRecallRouter({
      model: {
        provider: "openai",
        model: "gpt-4o-mini",
      },
      requestTimeoutMs: 1234,
      createRecallRouter: (input) => {
        routerCalls.push(input as unknown as Record<string, unknown>);
        const recallRouter: RecallRouterAssistant = {
          async plan() {
            return {
              querySummary: "refined query",
              rationale: "provider-routed plan",
            };
          },
          async rerank() {
            return {
              orderedCandidateIds: ["fact-1"],
              rationale: "provider-routed rerank",
            };
          },
        };

        return recallRouter;
      },
    });

    const plan = await router.plan({
      locale: "en",
      query: "what is the blocker",
      routingDecision: {
        retrievalProfile: "general_chat",
        intent: "general_assistance",
        strategy: "llm-assisted",
        strategyExplanation: {
          requestedStrategy: "llm-assisted",
          resolvedStrategy: "llm-assisted",
          summary: "llm assisted",
          hardFloor: "lexical_runtime_procedural_priors",
          semanticTieBreaking: false,
          llmRefinement: true,
        },
        sourcePriorities: ["profile", "feedback", "fact", "episode"],
        requestedSlots: ["blocker"],
        supportSlots: [],
        actionDriving: false,
        referenceSeeking: false,
        continuation: false,
      },
      runtime: {
        hasJournal: false,
        hasWorkingMemory: false,
      },
    });

    expect(plan.querySummary).toBe("refined query");
    expect(routerCalls[0]?.model).toEqual({
      provider: "openai",
      model: "gpt-4o-mini",
    });
    expect(routerCalls[0]?.dependencies).toEqual({ requestTimeoutMs: 1234 });
  });

  it("forwards one usage sink to every provider-layer model adapter", () => {
    const sink = { emit() {} };
    const dependencies: Array<Record<string, unknown> | undefined> = [];
    const capture = (value: unknown) => {
      dependencies.push(value as Record<string, unknown> | undefined);
    };
    const model = { model: "gpt-5.6-terra", provider: "openai" } as const;

    const createMemoryExtractor = (input: {
      dependencies?: unknown;
    }): MemoryExtractor => {
      capture(input.dependencies);
      return {
        async extract() {
          return { candidates: [], ignoredMessageCount: 0 };
        },
      };
    };
    createProviderMemoryExtractor({
      createMemoryExtractor,
      model,
      modelUsageSink: sink,
    });
    createProviderConversationalMemoryExtractor({
      createMemoryExtractor,
      model,
      modelUsageSink: sink,
    });
    createProviderEmbeddingAdapter({
      createEmbeddingAdapter(input) {
        capture(input.dependencies);
        return { async embed() { return []; } };
      },
      model,
      modelUsageSink: sink,
    });
    createProviderRecallRouter({
      createRecallRouter(input) {
        capture(input.dependencies);
        return {
          async plan() {
            return { querySummary: "summary", rationale: "reason" };
          },
          async rerank() {
            return { orderedCandidateIds: [], rationale: "reason" };
          },
        };
      },
      model,
      modelUsageSink: sink,
    });
    createProviderRecallPlanAssistant({
      createRecallPlanAssistant(input) {
        capture(input.dependencies);
        return { async plan() { return {}; } };
      },
      model,
      modelUsageSink: sink,
    });
    createProviderPointwiseReranker({
      createReranker(input) {
        capture(input.dependencies);
        return { async rerank() { return []; } };
      },
      model,
      modelUsageSink: sink,
    });
    createProviderListwiseReranker({
      createReranker(input) {
        capture(input.dependencies);
        return { async rerank() { return []; } };
      },
      model,
      modelUsageSink: sink,
    });
    createProviderTextGenerator({
      createTextGenerator(input) {
        capture(input.dependencies);
        return async () => ({ content: "answer" });
      },
      model,
      modelUsageSink: sink,
    });
    createProviderJudgeModel({
      createJudgeModel(input) {
        capture(input.dependencies);
        return {
          async complete() {
            return { content: "judge" };
          },
        };
      },
      model,
      modelUsageSink: sink,
    });

    expect(dependencies).toHaveLength(9);
    for (const dependency of dependencies) {
      expect(dependency?.modelUsageSink).toBe(sink);
    }
  });
});
