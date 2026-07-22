import { anthropic, createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI, openai } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { FetchFunction } from "@ai-sdk/provider-utils";
import {
  embedMany,
  type EmbeddingModel,
  type LanguageModel,
} from "ai";
import { z } from "zod";
import type { EmbeddingAdapter } from "../embedding/contracts";
import { isModelProviderId } from "./model-provider";
import type { ModelProviderId } from "./model-provider";
import {
  normalizeAISDKEmbeddingUsage,
  normalizeOpenAICompatibleUsage,
  runWithModelUsageAttempt,
} from "./model-usage";
import type { ModelTokenUsage, ModelUsageSink } from "./model-usage";

export interface AISDKModelConfig {
  provider: ModelProviderId;
  model: string;
  apiKey?: string;
  baseURL?: string;
}

export type OpenAICompatibleReasoningEffort = "low" | "medium" | "high";
export type OpenAICompatibleObjectResponseFormat =
  | "json_object"
  | "json_schema";

type OpenAICompatibleResponseFormat =
  | { type: "json_object" }
  | {
      type: "json_schema";
      json_schema: {
        name: "structured_response";
        strict: false;
        schema: unknown;
      };
    };

interface EmbeddingAdapterDependencies {
  embedMany?: typeof embedMany;
  modelUsageSink?: ModelUsageSink;
  requestTimeoutMs?: number;
  resolveEmbeddingModel?: typeof resolveAISDKEmbeddingModel;
  retryOptions?: AISDKRetryOptions;
}

type FetchInput = Parameters<FetchFunction>[0];
type FetchInit = Parameters<FetchFunction>[1];
export type FetchLike = (input: FetchInput, init?: FetchInit) => Promise<Response>;
export const DEFAULT_AISDK_REQUEST_TIMEOUT_MS = 45_000;
export const DEFAULT_AISDK_EMBEDDING_BATCH_MAX_UTF8_BYTES = 200_000;
export const DEFAULT_AISDK_EMBEDDING_BATCH_MAX_CONCURRENCY = 8;
export const DEFAULT_AISDK_EMBEDDING_BATCH_MAX_INPUTS = 256;
const DEFAULT_OPENAI_COMPATIBLE_REQUEST_TIMEOUT_MS =
  DEFAULT_AISDK_REQUEST_TIMEOUT_MS;
export const DEFAULT_AISDK_RETRY_LIMIT = 4;
const FAST_AISDK_RETRY_DELAYS_MS = [250, 500, 1_000] as const;
const SLOW_AISDK_RETRY_DELAYS_MS = [2_000, 5_000, 10_000] as const;

export interface AISDKRetryOptions {
  retryLimit?: number;
  sleep?: (ms: number) => Promise<void>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }

  if (typeof error === "string") {
    return error;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function isJsonContentType(value: string | null): boolean {
  if (!value) {
    return false;
  }

  const normalized = value.toLowerCase();
  return normalized.includes("application/json") || normalized.includes("+json");
}

function isMalformedOpenAICompatiblePayload(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const payload = value as Record<string, unknown>;
  const error = payload.error;

  return payload.choices === null && (!error || typeof error !== "object");
}

function resolveFetchUrl(input: Parameters<FetchFunction>[0]): string {
  if (typeof input === "string") {
    return input;
  }

  if (input instanceof URL) {
    return input.toString();
  }

  return input.url;
}

export function createOpenAICompatibleFetch(
  baseFetch: FetchLike = globalThis.fetch.bind(globalThis) as FetchLike,
): FetchFunction {
  const wrappedFetch = (async (input: FetchInput, init?: FetchInit) => {
    const response = await baseFetch(input, init);

    if (!response.ok || !isJsonContentType(response.headers.get("content-type"))) {
      return response;
    }

    let payload: unknown;

    try {
      payload = await response.clone().json();
    } catch {
      return response;
    }

    if (!isMalformedOpenAICompatiblePayload(payload)) {
      return response;
    }

    throw new Error(
      [
        "Malformed openai-compatible gateway response: expected choices array or error object.",
        `Received choices=null from ${resolveFetchUrl(input)}.`,
      ].join(" "),
    );
  }) as FetchFunction;

  wrappedFetch.preconnect = (globalThis.fetch as FetchFunction).preconnect;

  return wrappedFetch;
}

function resolveAISDKRetryDelayMs(
  error: unknown,
  attempt: number,
): number | null {
  const message = extractErrorMessage(error).toLowerCase();
  const slowRetry =
    message.includes("rate limit") ||
    message.includes("usage limit") ||
    message.includes("timeout") ||
    message.includes("timed out") ||
    message.includes("temporarily unavailable") ||
    message.includes("invalid json response") ||
    message.includes("connection reset") ||
    message.includes("econnreset") ||
    message.includes("certificate verification") ||
    message.includes("err_tls_cert_altname_invalid") ||
    message.includes("socket connection was closed unexpectedly") ||
    message.includes("socket hang up") ||
    message.includes("model_cooldown") ||
    message.includes("502") ||
    message.includes("503") ||
    message.includes("504");
  if (slowRetry) {
    return SLOW_AISDK_RETRY_DELAYS_MS[
      Math.min(attempt - 1, SLOW_AISDK_RETRY_DELAYS_MS.length - 1)
    ]!;
  }

  const fastRetry =
    message.includes("malformed openai-compatible gateway response") ||
    message.includes("empty model response") ||
    message.includes("choices") && message.includes("received null") ||
    message.includes("type validation failed") ||
    message.includes("invalid input: expected array") ||
    message.includes("structured model response did not contain a json object") ||
    message.includes("structured model response was not valid json") ||
    message.includes("structured model response schema validation failed");
  if (!fastRetry) {
    return null;
  }

  return FAST_AISDK_RETRY_DELAYS_MS[
    Math.min(attempt - 1, FAST_AISDK_RETRY_DELAYS_MS.length - 1)
  ]!;
}

export async function withAISDKRetries<T>(
  operation: () => Promise<T>,
  options: number | AISDKRetryOptions = DEFAULT_AISDK_RETRY_LIMIT,
): Promise<T> {
  const retryLimit =
    typeof options === "number"
      ? options
      : options.retryLimit ?? DEFAULT_AISDK_RETRY_LIMIT;
  const sleepFn = typeof options === "number" ? sleep : options.sleep ?? sleep;
  let lastError: unknown;

  for (let attempt = 1; attempt <= retryLimit; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      const retryDelayMs = resolveAISDKRetryDelayMs(error, attempt);
      if (attempt >= retryLimit || retryDelayMs === null) {
        throw error;
      }

      await sleepFn(retryDelayMs);
    }
  }

  throw lastError;
}

export function stripThinkingBlocks(value: string): string {
  return value
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<think>[\s\S]*$/i, "")
    .trim();
}

function buildOpenAICompatibleUrl(baseURL: string): string {
  return `${baseURL.replace(/\/+$/, "")}/chat/completions`;
}

function buildOpenAICompatibleHeaders(config: AISDKModelConfig): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json",
  };

  if (config.apiKey) {
    headers.authorization = `Bearer ${config.apiKey}`;
  }

  return headers;
}

function extractOpenAICompatibleErrorMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }

  const error = (payload as Record<string, unknown>).error;
  if (!error || typeof error !== "object" || Array.isArray(error)) {
    return null;
  }

  const message = (error as Record<string, unknown>).message;
  return typeof message === "string" && message.trim().length > 0 ? message.trim() : null;
}

function extractMessageText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((part) => {
      if (typeof part === "string") {
        return part;
      }

      if (!part || typeof part !== "object" || Array.isArray(part)) {
        return "";
      }

      const text = (part as Record<string, unknown>).text;
      return typeof text === "string" ? text : "";
    })
    .join("");
}

function extractOpenAICompatibleCompletionText(payload: unknown): string {
  const gatewayError = extractOpenAICompatibleErrorMessage(payload);
  if (gatewayError) {
    throw new Error(`OpenAI-compatible gateway error: ${gatewayError}`);
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Malformed openai-compatible gateway response: expected a JSON object.");
  }

  const choices = (payload as Record<string, unknown>).choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new Error("Malformed openai-compatible gateway response: missing choices array.");
  }

  const firstChoice = choices[0];
  if (!firstChoice || typeof firstChoice !== "object" || Array.isArray(firstChoice)) {
    throw new Error("Malformed openai-compatible gateway response: invalid first choice.");
  }

  const choice = firstChoice as Record<string, unknown>;
  const message = choice.message;
  if (message && typeof message === "object" && !Array.isArray(message)) {
    const content = extractMessageText((message as Record<string, unknown>).content);
    if (content.trim().length > 0) {
      return content;
    }
  }

  const text = choice.text;
  if (typeof text === "string" && text.trim().length > 0) {
    return text;
  }

  throw new Error("Empty model response");
}

function extractOpenAICompatibleStreamText(payload: unknown): string {
  const gatewayError = extractOpenAICompatibleErrorMessage(payload);
  if (gatewayError) {
    throw new Error(`OpenAI-compatible gateway error: ${gatewayError}`);
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Malformed openai-compatible gateway response: expected a JSON object.");
  }

  const choices = (payload as Record<string, unknown>).choices;
  if (choices === null) {
    throw new Error(
      "Malformed openai-compatible gateway response: expected choices array or error object.",
    );
  }

  if (!Array.isArray(choices) || choices.length === 0) {
    return "";
  }

  let content = "";
  for (const item of choices) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }

    const choice = item as Record<string, unknown>;
    const delta = choice.delta;
    if (delta && typeof delta === "object" && !Array.isArray(delta)) {
      content += extractMessageText((delta as Record<string, unknown>).content);
    }

    const message = choice.message;
    if (message && typeof message === "object" && !Array.isArray(message)) {
      content += extractMessageText((message as Record<string, unknown>).content);
    }

    const text = choice.text;
    if (typeof text === "string") {
      content += text;
    }
  }

  return content;
}

function extractStructuredJsonObject(raw: string): string {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");

  if (start === -1 || end === -1 || end < start) {
    throw new Error("Structured model response did not contain a JSON object.");
  }

  return raw.slice(start, end + 1);
}

function summarizeZodIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, 3)
    .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
    .join("; ");
}

function parseStructuredModelObject<T>(
  content: string,
  schema: z.ZodType<T>,
  normalizePayload?: (payload: unknown) => unknown,
): T {
  const normalized = stripThinkingBlocks(content);
  if (!normalized) {
    throw new Error("Empty model response");
  }

  let payload: unknown;

  try {
    payload = JSON.parse(extractStructuredJsonObject(normalized));
  } catch (error) {
    throw new Error(
      `Structured model response was not valid JSON: ${extractErrorMessage(error)}`,
    );
  }

  const parsed = schema.safeParse(normalizePayload ? normalizePayload(payload) : payload);
  if (!parsed.success) {
    throw new Error(
      `Structured model response schema validation failed: ${summarizeZodIssues(parsed.error)}`,
    );
  }

  return parsed.data;
}

async function withOpenAICompatibleTimeout<T>(input: {
  timeoutMs: number;
  message: string;
  onTimeout?: () => void;
  operation: () => Promise<T>;
}): Promise<T> {
  return await new Promise<T>((resolve, reject) => {
    let settled = false;
    const timeoutId = setTimeout(() => {
      if (settled) {
        return;
      }

      settled = true;

      try {
        input.onTimeout?.();
      } catch {
        // Best effort cleanup only.
      }

      reject(new Error(input.message));
    }, input.timeoutMs);

    input.operation().then(
      (value) => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timeoutId);
        resolve(value);
      },
      (error) => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timeoutId);
        reject(error);
      },
    );
  });
}

export interface OpenAICompatibleTextResult {
  text: string;
  usage: ModelTokenUsage | null;
}

interface OpenAICompatibleTextInput {
  maxOutputTokens?: number;
  model: AISDKModelConfig;
  responseFormat?: OpenAICompatibleResponseFormat;
  reasoningEffort?: OpenAICompatibleReasoningEffort;
  system?: string;
  prompt: string;
  temperature?: number;
  fetch?: FetchLike;
  signal?: AbortSignal;
  timeoutMs?: number;
}

function usageFromOpenAICompatiblePayload(
  payload: unknown,
): ModelTokenUsage | null {
  if (
    payload === null ||
    typeof payload !== "object" ||
    Array.isArray(payload) ||
    !("usage" in payload) ||
    payload.usage === null ||
    typeof payload.usage !== "object" ||
    Array.isArray(payload.usage)
  ) {
    return null;
  }
  return normalizeOpenAICompatibleUsage(payload);
}

async function requestOpenAICompatibleTextInternal(
  input: OpenAICompatibleTextInput & { includeUsage: boolean },
): Promise<OpenAICompatibleTextResult> {
  if (!input.model.baseURL) {
    throw new Error("OpenAI-compatible requests require a baseURL.");
  }

  const baseURL = input.model.baseURL;
  const controller = new AbortController();
  const timeoutMs = input.timeoutMs ?? DEFAULT_OPENAI_COMPATIBLE_REQUEST_TIMEOUT_MS;
  const timeoutMessage = `OpenAI-compatible gateway timeout after ${timeoutMs}ms.`;
  const deadlineAt = Date.now() + timeoutMs;
  const abortRequest = (reason: unknown = new Error(timeoutMessage)) => {
    if (controller.signal.aborted) {
      return;
    }

    controller.abort(
      reason instanceof Error ? reason : new Error(String(reason || timeoutMessage)),
    );
  };
  const abortFromInputSignal = () => {
    abortRequest(input.signal?.reason ?? new Error("OpenAI-compatible request aborted."));
  };
  if (input.signal?.aborted) {
    abortFromInputSignal();
  } else {
    input.signal?.addEventListener("abort", abortFromInputSignal, { once: true });
  }
  const runWithinRequestDeadline = async <T>(
    operation: () => Promise<T>,
    onTimeout?: () => void,
  ) => {
    const remainingMs = deadlineAt - Date.now();
    if (remainingMs <= 0) {
      abortRequest();
      onTimeout?.();
      throw new Error(timeoutMessage);
    }

    return withOpenAICompatibleTimeout({
      timeoutMs: remainingMs,
      message: timeoutMessage,
      onTimeout: () => {
        abortRequest();
        onTimeout?.();
      },
      operation,
    });
  };
  let response: Response;

  try {
    response = await runWithinRequestDeadline(
      () =>
        createOpenAICompatibleFetch(input.fetch)(
          buildOpenAICompatibleUrl(baseURL),
          {
            method: "POST",
            headers: {
              ...buildOpenAICompatibleHeaders(input.model),
              accept: "text/event-stream",
            },
            body: JSON.stringify({
              model: input.model.model,
              messages: [
                input.system
                  ? {
                      role: "system",
                      content: input.system,
                    }
                  : null,
                {
                  role: "user",
                  content: input.prompt,
                },
              ].filter(Boolean),
              stream: true,
              reasoning_effort: input.reasoningEffort ?? "medium",
              ...(input.maxOutputTokens === undefined
                ? {}
                : { max_tokens: input.maxOutputTokens }),
              ...(input.includeUsage
                ? { stream_options: { include_usage: true } }
                : {}),
              ...(input.responseFormat === undefined
                ? {}
                : { response_format: input.responseFormat }),
              ...(input.temperature === undefined
                ? {}
                : { temperature: input.temperature }),
            }),
            signal: controller.signal,
          },
        ),
    );
  } catch (error) {
    if (controller.signal.aborted) {
      throw controller.signal.reason instanceof Error
        ? controller.signal.reason
        : new Error(timeoutMessage);
    }

    throw error;
  }

  const contentType = response.headers.get("content-type");
  if (isJsonContentType(contentType)) {
    const body = await runWithinRequestDeadline(() => response.text());
    let payload: unknown = null;

    if (body.trim().length > 0) {
      try {
        payload = JSON.parse(body);
      } catch {
        if (!response.ok) {
          throw new Error(
            `OpenAI-compatible gateway error ${response.status}: ${response.statusText || "Invalid JSON response"}`,
          );
        }

        throw new Error("Malformed openai-compatible gateway response: expected a JSON body.");
      }
    }

    const gatewayError = extractOpenAICompatibleErrorMessage(payload);
    if (!response.ok) {
      throw new Error(
        `OpenAI-compatible gateway error ${response.status}: ${gatewayError ?? (response.statusText || "Request failed")}`,
      );
    }

    return {
      text: extractOpenAICompatibleCompletionText(payload),
      usage: usageFromOpenAICompatiblePayload(payload),
    };
  }

  if (!response.ok) {
    const body = await runWithinRequestDeadline(() => response.text());
    throw new Error(
      `OpenAI-compatible gateway error ${response.status}: ${body.trim() || response.statusText || "Request failed"}`,
    );
  }

  if (!response.body) {
    throw new Error("Malformed openai-compatible gateway response: missing response body.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let usage: ModelTokenUsage | null = null;
  let sawDone = false;

  while (true) {
    const { value, done } = await runWithinRequestDeadline(
      () => reader.read(),
      () => {
        void reader.cancel(controller.signal.reason).catch(() => undefined);
      },
    );
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";

    for (const rawEvent of events) {
      const data = rawEvent
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n")
        .trim();

      if (!data) {
        continue;
      }

      if (data === "[DONE]") {
        sawDone = true;
        return { text: content, usage };
      }

      let payload: unknown;

      try {
        payload = JSON.parse(data);
      } catch {
        throw new Error(
          "Malformed openai-compatible gateway response: invalid JSON stream event.",
        );
      }

      content += extractOpenAICompatibleStreamText(payload);
      usage = usageFromOpenAICompatiblePayload(payload) ?? usage;
    }
  }

  if (buffer.trim().length > 0) {
    throw new Error(
      "Malformed openai-compatible gateway response: truncated stream event.",
    );
  }

  if (!sawDone) {
    throw new Error("Malformed openai-compatible gateway response: stream ended before [DONE].");
  }

  return { text: content, usage };
}

export async function requestOpenAICompatibleText(
  input: OpenAICompatibleTextInput,
): Promise<string> {
  return (await requestOpenAICompatibleTextInternal({
    ...input,
    includeUsage: false,
  })).text;
}

export async function requestOpenAICompatibleTextResult(
  input: OpenAICompatibleTextInput,
): Promise<OpenAICompatibleTextResult> {
  return requestOpenAICompatibleTextInternal({
    ...input,
    includeUsage: true,
  });
}

function normalizeOpenAICompatibleJsonSchema(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeOpenAICompatibleJsonSchema);
  }
  if (value === null || typeof value !== "object") {
    return value;
  }

  const normalized: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (key !== "$schema" && key !== "propertyNames") {
      normalized[key] = normalizeOpenAICompatibleJsonSchema(child);
    }
  }
  return normalized;
}

function buildOpenAICompatibleObjectResponseFormat(
  mode: OpenAICompatibleObjectResponseFormat,
  schema: z.ZodType<unknown>,
): OpenAICompatibleResponseFormat {
  if (mode === "json_object") {
    return { type: "json_object" };
  }
  return {
    type: "json_schema",
    json_schema: {
      name: "structured_response",
      strict: false,
      schema: normalizeOpenAICompatibleJsonSchema(z.toJSONSchema(schema)),
    },
  };
}

export async function requestOpenAICompatibleObject<T>(input: {
  maxOutputTokens?: number;
  model: AISDKModelConfig;
  schema: z.ZodType<T>;
  system?: string;
  prompt: string;
  reasoningEffort?: OpenAICompatibleReasoningEffort;
  temperature?: number;
  fetch?: FetchLike;
  signal?: AbortSignal;
  timeoutMs?: number;
  normalizePayload?: (payload: unknown) => unknown;
  responseFormat?: OpenAICompatibleObjectResponseFormat;
}): Promise<T> {
  return parseStructuredModelObject(
    await requestOpenAICompatibleText({
      model: input.model,
      maxOutputTokens: input.maxOutputTokens,
      system: input.system,
      prompt: input.prompt,
      responseFormat: buildOpenAICompatibleObjectResponseFormat(
        input.responseFormat ?? "json_object",
        input.schema,
      ),
      reasoningEffort: input.reasoningEffort,
      temperature: input.temperature,
      fetch: input.fetch,
      signal: input.signal,
      timeoutMs: input.timeoutMs,
    }),
    input.schema,
    input.normalizePayload,
  );
}

export async function requestOpenAICompatibleObjectResult<T>(input: {
  fetch?: FetchLike;
  maxOutputTokens?: number;
  model: AISDKModelConfig;
  normalizePayload?: (payload: unknown) => unknown;
  onUsage?: (usage: ModelTokenUsage | null) => void;
  prompt: string;
  reasoningEffort?: OpenAICompatibleReasoningEffort;
  responseFormat?: OpenAICompatibleObjectResponseFormat;
  schema: z.ZodType<T>;
  signal?: AbortSignal;
  system?: string;
  temperature?: number;
  timeoutMs?: number;
}): Promise<{ object: T; usage: ModelTokenUsage | null }> {
  const result = await requestOpenAICompatibleTextResult({
    fetch: input.fetch,
    maxOutputTokens: input.maxOutputTokens,
    model: input.model,
    prompt: input.prompt,
    responseFormat: buildOpenAICompatibleObjectResponseFormat(
      input.responseFormat ?? "json_object",
      input.schema,
    ),
    reasoningEffort: input.reasoningEffort,
    signal: input.signal,
    system: input.system,
    temperature: input.temperature,
    timeoutMs: input.timeoutMs,
  });
  input.onUsage?.(result.usage);
  return {
    object: parseStructuredModelObject(
      result.text,
      input.schema,
      input.normalizePayload,
    ),
    usage: result.usage,
  };
}

export function parseAISDKModelConfigFromEnv(
  prefix: string,
): AISDKModelConfig | null {
  const provider = process.env[`${prefix}_PROVIDER`];
  const model = process.env[`${prefix}_MODEL`];

  if (!provider || !model) {
    return null;
  }

  if (!isModelProviderId(provider)) {
    throw new Error(`Unsupported Vercel AI SDK provider: ${provider}`);
  }

  return {
    provider,
    model,
    apiKey: process.env[`${prefix}_API_KEY`],
    baseURL: process.env[`${prefix}_BASE_URL`],
  };
}

export function resolveAISDKModel(config: AISDKModelConfig): LanguageModel {
  if (config.provider === "openai") {
    if (config.baseURL) {
      const provider = createOpenAICompatible({
        name: "openai-compatible",
        apiKey: config.apiKey,
        baseURL: config.baseURL,
        fetch: createOpenAICompatibleFetch(),
      });

      return provider.chatModel(config.model);
    }

    if (config.apiKey) {
      const provider = createOpenAI({
        apiKey: config.apiKey,
      });
      return provider(config.model);
    }

    return openai(config.model);
  }

  if (config.provider === "anthropic") {
    if (config.baseURL || config.apiKey) {
      const provider = createAnthropic({
        apiKey: config.apiKey,
        baseURL: config.baseURL,
      });
      return provider(config.model);
    }

    return anthropic(config.model);
  }

  throw new Error(`Unsupported Vercel AI SDK provider: ${config.provider}`);
}

export function resolveAISDKEmbeddingModel(
  config: AISDKModelConfig,
): EmbeddingModel {
  if (config.provider === "openai") {
    if (config.baseURL) {
      const provider = createOpenAICompatible({
        name: "openai-compatible",
        apiKey: config.apiKey,
        baseURL: config.baseURL,
        fetch: createOpenAICompatibleFetch(),
      });

      return provider.embeddingModel(config.model);
    }

    if (config.apiKey) {
      const provider = createOpenAI({
        apiKey: config.apiKey,
      });
      return provider.embeddingModel(config.model);
    }

    return openai.embeddingModel(config.model);
  }

  if (config.provider === "anthropic") {
    throw new Error(
      "Anthropic via Vercel AI SDK does not currently support text embeddings.",
    );
  }

  throw new Error(`Unsupported Vercel AI SDK provider: ${config.provider}`);
}

export function createAISDKEmbeddingAdapter(input: {
  batchMaxConcurrency?: number;
  batchMaxInputs?: number;
  batchMaxUtf8Bytes?: number;
  model: AISDKModelConfig;
  dependencies?: EmbeddingAdapterDependencies;
}): EmbeddingAdapter {
  const batchMaxConcurrency =
    input.batchMaxConcurrency ?? DEFAULT_AISDK_EMBEDDING_BATCH_MAX_CONCURRENCY;
  const batchMaxInputs =
    input.batchMaxInputs ?? DEFAULT_AISDK_EMBEDDING_BATCH_MAX_INPUTS;
  const batchMaxUtf8Bytes =
    input.batchMaxUtf8Bytes ?? DEFAULT_AISDK_EMBEDDING_BATCH_MAX_UTF8_BYTES;
  for (const [name, value] of [
    ["batchMaxConcurrency", batchMaxConcurrency],
    ["batchMaxInputs", batchMaxInputs],
    ["batchMaxUtf8Bytes", batchMaxUtf8Bytes],
  ] as const) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error(`AI SDK embedding ${name} must be a positive integer.`);
    }
  }
  return {
    async embed(texts: string[]): Promise<number[][]> {
      if (texts.length === 0) {
        return [];
      }

      const batchEmbeddings = await mapEmbeddingBatches(
        batchEmbeddingTexts(texts, batchMaxInputs, batchMaxUtf8Bytes),
        async (values) => {
          let attempt = 0;
          const embeddings = await withAISDKRetries(async () => {
            attempt += 1;
            return runWithModelUsageAttempt({
              attempt,
              modelId: input.model.model,
              operation: "embedding",
              providerId: input.model.provider,
              sink: input.dependencies?.modelUsageSink,
              run: async (report) => {
                const controller = new AbortController();
                const timeoutMs =
                  input.dependencies?.requestTimeoutMs ??
                  DEFAULT_OPENAI_COMPATIBLE_REQUEST_TIMEOUT_MS;
                const timeoutMessage = `AI SDK embedding timeout after ${timeoutMs}ms.`;
                const result = await withOpenAICompatibleTimeout({
                  timeoutMs,
                  message: timeoutMessage,
                  onTimeout: () => controller.abort(new Error(timeoutMessage)),
                  operation: () =>
                    (input.dependencies?.embedMany ?? embedMany)({
                      abortSignal: controller.signal,
                      maxRetries: 0,
                      model: (
                        input.dependencies?.resolveEmbeddingModel ??
                        resolveAISDKEmbeddingModel
                      )(input.model),
                      values,
                    }),
                });
                report(normalizeAISDKEmbeddingUsage(result.usage));
                return result.embeddings;
              },
            });
          }, input.dependencies?.retryOptions);
          if (embeddings.length !== values.length) {
            throw new Error(
              `Embedding response count mismatch: expected ${values.length}, received ${embeddings.length}.`,
            );
          }
          return embeddings;
        },
        batchMaxConcurrency,
      );
      const embeddings = batchEmbeddings.flat();

      if (embeddings.some((embedding) => embedding.length === 0)) {
        throw new Error("Empty embedding response");
      }

      return embeddings.map((embedding) => embedding.map((value) => Number(value)));
    },
  };
}

function batchEmbeddingTexts(
  texts: readonly string[],
  maxInputs: number,
  maxUtf8Bytes: number,
): string[][] {
  const batches: string[][] = [];
  let batch: string[] = [];
  let batchBytes = 0;

  for (const text of texts) {
    const textBytes = Buffer.byteLength(text, "utf8");
    if (
      batch.length > 0 &&
      (batch.length >= maxInputs || batchBytes + textBytes > maxUtf8Bytes)
    ) {
      batches.push(batch);
      batch = [];
      batchBytes = 0;
    }
    batch.push(text);
    batchBytes += textBytes;
  }
  if (batch.length > 0) {
    batches.push(batch);
  }

  return batches;
}

async function mapEmbeddingBatches(
  batches: readonly string[][],
  worker: (values: string[]) => Promise<number[][]>,
  maxConcurrency: number,
): Promise<number[][][]> {
  const results: number[][][] = new Array(batches.length);
  let cursor = 0;
  const run = async (): Promise<void> => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= batches.length) {
        return;
      }
      results[index] = await worker(batches[index]);
    }
  };
  await Promise.all(
    Array.from(
      {
        length: Math.min(
          maxConcurrency,
          batches.length,
        ),
      },
      () => run(),
    ),
  );
  return results;
}
