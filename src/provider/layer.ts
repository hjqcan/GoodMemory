import type { RecallRouterAssistant } from "../recall/assistant";
import type { RecallPlanAssistant } from "../recall/recallPlan";
import type { Reranker } from "../recall/reranker";
import type {
  MemoryExtractionContext,
  MemoryExtractionInput,
  MemoryExtractor,
} from "../remember/candidates";
import type { EmbeddingAdapter } from "../embedding/contracts";
import type {
  AISDKModelConfig,
  OpenAICompatibleReasoningEffort,
} from "./ai-sdk-runtime";
import { createAISDKEmbeddingAdapter } from "./ai-sdk-runtime";
import {
  buildConversationalMemoryExtractionPrompt,
  CONVERSATIONAL_MEMORY_EXTRACTION_SYSTEM_PROMPT,
  createLLMMemoryExtractor,
} from "./memory-extractor";
import { createLLMRecallRouter } from "./recall-router";
import { createLLMRecallPlanAssistant } from "./recall-plan-assistant";
import type { RecallPlanAssistantDependencies } from "./recall-plan-assistant";
import {
  createLLMListwiseReranker,
  createLLMPointwiseReranker,
} from "./reranker";
import type {
  ListwiseRerankerDependencies,
  PointwiseRerankerDependencies,
} from "./reranker";
import type {
  ModelProviderId,
  ProviderRuntimeMetadata,
  RuntimeTargetDescriptor,
} from "./contracts";
import type { ModelUsageSink } from "./model-usage";

interface ProviderMemoryExtractorFactory {
  (input: {
    dependencies?: ProviderRequestDependencies;
    maxOutputTokens?: number;
    model: AISDKModelConfig;
    promptBuilder?: (
      input: MemoryExtractionInput,
      context?: MemoryExtractionContext,
    ) => string;
    reasoningEffort?: OpenAICompatibleReasoningEffort;
    system?: string;
    temperature?: number;
  }): MemoryExtractor;
}

interface ProviderEmbeddingAdapterFactory {
  (input: {
    dependencies?: ProviderRequestDependencies;
    model: AISDKModelConfig;
  }): EmbeddingAdapter;
}

interface ProviderRecallRouterFactory {
  (input: {
    dependencies?: ProviderRequestDependencies;
    model: AISDKModelConfig;
    planSystem?: string;
    rerankSystem?: string;
  }): RecallRouterAssistant;
}

interface ProviderRecallPlanAssistantFactory {
  (input: {
    dependencies?: RecallPlanAssistantDependencies;
    maxOutputTokens?: number;
    model: AISDKModelConfig;
    system?: string;
    temperature?: number;
  }): RecallPlanAssistant;
}

interface ProviderRerankerFactory {
  (input: {
    dependencies?: PointwiseRerankerDependencies;
    maxOutputTokens?: number;
    model: AISDKModelConfig;
    temperature?: number;
  }): Reranker;
}

interface ProviderListwiseRerankerFactory {
  (input: {
    dependencies?: ListwiseRerankerDependencies;
    maxOutputTokens?: number;
    model: AISDKModelConfig;
    reasoningEffort?: OpenAICompatibleReasoningEffort;
    temperature?: number;
  }): Reranker;
}

const DEFAULT_PROVIDER_RERANKER_REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_PROVIDER_LISTWISE_RERANKER_REQUEST_TIMEOUT_MS = 60_000;
const DEFAULT_PROVIDER_RECALL_PLAN_REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_PROVIDER_RECALL_PLAN_RETRY_LIMIT = 3;

export interface ProviderRequestDependencies {
  modelUsageSink?: ModelUsageSink;
  requestTimeoutMs?: number;
}

export interface ModelProviderDescriptorInput {
  providerId: ModelProviderId;
  modelId: string;
}

export function createFallbackAdapterDescriptor(): RuntimeTargetDescriptor {
  return {
    adapterId: "fallback",
    mode: "fallback",
  };
}

export function createLiveAdapterDescriptor(
  config: ModelProviderDescriptorInput,
): RuntimeTargetDescriptor {
  return {
    adapterId: "live-adapter",
    mode: "live",
    providerId: config.providerId,
    modelId: config.modelId,
  };
}

export function createProviderRuntimeMetadata(input: {
  generation: RuntimeTargetDescriptor;
  judge: RuntimeTargetDescriptor;
}): ProviderRuntimeMetadata {
  return {
    generationMode: input.generation.mode,
    generationAdapter: input.generation.adapterId,
    judgeMode: input.judge.mode,
    judgeAdapter: input.judge.adapterId,
    ...(input.generation.providerId
      ? { generationProviderId: input.generation.providerId }
      : {}),
    ...(input.generation.modelId ? { generationModelId: input.generation.modelId } : {}),
    ...(input.judge.providerId ? { judgeProviderId: input.judge.providerId } : {}),
    ...(input.judge.modelId ? { judgeModelId: input.judge.modelId } : {}),
  };
}

export function normalizeProviderRuntimeMetadata(
  input: ProviderRuntimeMetadata,
): ProviderRuntimeMetadata {
  return {
    ...input,
    generationAdapter:
      input.generationAdapter ??
      (input.generationMode === "live" ? "live-adapter" : "fallback"),
    judgeAdapter:
      input.judgeAdapter ??
      (input.judgeMode === "live" ? "live-adapter" : "fallback"),
  };
}

export function createProviderMemoryExtractor(input: {
  maxOutputTokens?: number;
  model: AISDKModelConfig;
  promptBuilder?: (
    input: MemoryExtractionInput,
    context?: MemoryExtractionContext,
  ) => string;
  system?: string;
  createMemoryExtractor?: ProviderMemoryExtractorFactory;
  modelUsageSink?: ModelUsageSink;
  reasoningEffort?: OpenAICompatibleReasoningEffort;
  requestTimeoutMs?: number;
  temperature?: number;
}): MemoryExtractor {
  return (input.createMemoryExtractor ?? createLLMMemoryExtractor)({
    dependencies: buildProviderRequestDependencies(
      input.requestTimeoutMs,
      input.modelUsageSink,
    ),
    maxOutputTokens: input.maxOutputTokens,
    model: input.model,
    promptBuilder: input.promptBuilder,
    reasoningEffort: input.reasoningEffort,
    system: input.system,
    temperature: input.temperature,
  });
}

// Opt-in conversational atomic-fact extractor: same provider wiring as
// createProviderMemoryExtractor, but prompts the model to decompose dialogue
// into self-contained, coreference-resolved, entity/date-normalized atomic
// claims. Inject the result as `adapters.assistedExtractor` to improve recall
// on conversational corpora (the LoCoMo phrasing-gap lever) without an embedding
// endpoint. Default extraction is unchanged unless this is injected.
export function createProviderConversationalMemoryExtractor(input: {
  model: AISDKModelConfig;
  // Opt-in: prefix each extracted fact with a brief situating context (the
  // embedding-free Contextual Retrieval lever) to fight question-to-dialogue
  // vocabulary mismatch. Off by default.
  contextualDescriptor?: boolean;
  createMemoryExtractor?: ProviderMemoryExtractorFactory;
  maxOutputTokens?: number;
  modelUsageSink?: ModelUsageSink;
  reasoningEffort?: OpenAICompatibleReasoningEffort;
  requestTimeoutMs?: number;
  temperature?: number;
}): MemoryExtractor {
  return createProviderMemoryExtractor({
    model: input.model,
    maxOutputTokens: input.maxOutputTokens,
    promptBuilder: (payload, context) =>
      buildConversationalMemoryExtractionPrompt(payload, {
        contextualDescriptor: input.contextualDescriptor,
        knownUserName: context?.knownUserName,
      }),
    system: CONVERSATIONAL_MEMORY_EXTRACTION_SYSTEM_PROMPT,
    createMemoryExtractor: input.createMemoryExtractor,
    modelUsageSink: input.modelUsageSink,
    reasoningEffort: input.reasoningEffort,
    requestTimeoutMs: input.requestTimeoutMs,
    temperature: input.temperature,
  });
}

export function createProviderEmbeddingAdapter(input: {
  model: AISDKModelConfig;
  createEmbeddingAdapter?: ProviderEmbeddingAdapterFactory;
  modelUsageSink?: ModelUsageSink;
  requestTimeoutMs?: number;
}): EmbeddingAdapter {
  return (input.createEmbeddingAdapter ?? createAISDKEmbeddingAdapter)({
    dependencies: buildProviderRequestDependencies(
      input.requestTimeoutMs,
      input.modelUsageSink,
    ),
    model: input.model,
  });
}

export function createProviderRecallRouter(input: {
  model: AISDKModelConfig;
  createRecallRouter?: ProviderRecallRouterFactory;
  modelUsageSink?: ModelUsageSink;
  planSystem?: string;
  requestTimeoutMs?: number;
  rerankSystem?: string;
}): RecallRouterAssistant {
  return (input.createRecallRouter ?? createLLMRecallRouter)({
    dependencies: buildProviderRequestDependencies(
      input.requestTimeoutMs,
      input.modelUsageSink,
    ),
    model: input.model,
    planSystem: input.planSystem,
    rerankSystem: input.rerankSystem,
  });
}

export function createProviderRecallPlanAssistant(input: {
  createRecallPlanAssistant?: ProviderRecallPlanAssistantFactory;
  maxOutputTokens?: number;
  model: AISDKModelConfig;
  modelUsageSink?: ModelUsageSink;
  requestTimeoutMs?: number;
  retryLimit?: number;
  system?: string;
  temperature?: number;
}): RecallPlanAssistant {
  const requestTimeoutMs =
    input.requestTimeoutMs ?? DEFAULT_PROVIDER_RECALL_PLAN_REQUEST_TIMEOUT_MS;
  const retryLimit =
    input.retryLimit ?? DEFAULT_PROVIDER_RECALL_PLAN_RETRY_LIMIT;
  if (!Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs <= 0) {
    throw new Error(
      "Provider recall plan requestTimeoutMs must be a positive integer.",
    );
  }
  if (!Number.isSafeInteger(retryLimit) || retryLimit <= 0) {
    throw new Error(
      "Provider recall plan retryLimit must be a positive integer.",
    );
  }

  return (input.createRecallPlanAssistant ?? createLLMRecallPlanAssistant)({
    dependencies: {
      ...(input.modelUsageSink === undefined
        ? {}
        : { modelUsageSink: input.modelUsageSink }),
      requestTimeoutMs,
      retryOptions: { retryLimit },
    },
    maxOutputTokens: input.maxOutputTokens,
    model: input.model,
    system: input.system,
    temperature: input.temperature,
  });
}

export function createProviderPointwiseReranker(input: {
  createReranker?: ProviderRerankerFactory;
  maxConcurrency?: number;
  maxOutputTokens?: number;
  model: AISDKModelConfig;
  modelUsageSink?: ModelUsageSink;
  requestTimeoutMs?: number;
  retryLimit?: number;
  temperature?: number;
}): Reranker {
  const requestTimeoutMs =
    input.requestTimeoutMs ?? DEFAULT_PROVIDER_RERANKER_REQUEST_TIMEOUT_MS;
  if (!Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs <= 0) {
    throw new Error("Provider reranker requestTimeoutMs must be a positive integer.");
  }
  if (
    input.maxConcurrency !== undefined &&
    (!Number.isSafeInteger(input.maxConcurrency) || input.maxConcurrency <= 0)
  ) {
    throw new Error("Provider reranker maxConcurrency must be a positive integer.");
  }
  if (
    input.retryLimit !== undefined &&
    (!Number.isSafeInteger(input.retryLimit) || input.retryLimit <= 0)
  ) {
    throw new Error("Provider reranker retryLimit must be a positive integer.");
  }
  return (input.createReranker ?? createLLMPointwiseReranker)({
    dependencies: {
      ...(input.maxConcurrency === undefined
        ? {}
        : { maxConcurrency: input.maxConcurrency }),
      ...(input.modelUsageSink === undefined
        ? {}
        : { modelUsageSink: input.modelUsageSink }),
      requestTimeoutMs,
      retryOptions: { retryLimit: input.retryLimit ?? 1 },
    },
    maxOutputTokens: input.maxOutputTokens,
    model: input.model,
    temperature: input.temperature,
  });
}

export function createProviderListwiseReranker(input: {
  createReranker?: ProviderListwiseRerankerFactory;
  maxConcurrency?: number;
  maxOutputTokens?: number;
  model: AISDKModelConfig;
  modelUsageSink?: ModelUsageSink;
  reasoningEffort?: OpenAICompatibleReasoningEffort;
  requestTimeoutMs?: number;
  retryLimit?: number;
  temperature?: number;
}): Reranker {
  const requestTimeoutMs =
    input.requestTimeoutMs ??
    DEFAULT_PROVIDER_LISTWISE_RERANKER_REQUEST_TIMEOUT_MS;
  if (!Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs <= 0) {
    throw new Error("Provider reranker requestTimeoutMs must be a positive integer.");
  }
  if (
    input.maxConcurrency !== undefined &&
    (!Number.isSafeInteger(input.maxConcurrency) || input.maxConcurrency <= 0)
  ) {
    throw new Error("Provider reranker maxConcurrency must be a positive integer.");
  }
  if (
    input.retryLimit !== undefined &&
    (!Number.isSafeInteger(input.retryLimit) || input.retryLimit <= 0)
  ) {
    throw new Error("Provider reranker retryLimit must be a positive integer.");
  }
  return (input.createReranker ?? createLLMListwiseReranker)({
    dependencies: {
      ...(input.maxConcurrency === undefined
        ? {}
        : { maxConcurrency: input.maxConcurrency }),
      ...(input.modelUsageSink === undefined
        ? {}
        : { modelUsageSink: input.modelUsageSink }),
      requestTimeoutMs,
      retryOptions: { retryLimit: input.retryLimit ?? 3 },
    },
    maxOutputTokens: input.maxOutputTokens,
    model: input.model,
    reasoningEffort: input.reasoningEffort,
    temperature: input.temperature,
  });
}

export function buildProviderRequestDependencies(
  requestTimeoutMs: number | undefined,
  modelUsageSink?: ModelUsageSink,
): ProviderRequestDependencies | undefined {
  if (requestTimeoutMs === undefined && modelUsageSink === undefined) {
    return undefined;
  }
  return {
    ...(modelUsageSink === undefined ? {} : { modelUsageSink }),
    ...(requestTimeoutMs === undefined ? {} : { requestTimeoutMs }),
  };
}
