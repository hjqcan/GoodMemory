import {
  DEFAULT_AISDK_EMBEDDING_BATCH_MAX_CONCURRENCY,
  DEFAULT_AISDK_EMBEDDING_BATCH_MAX_INPUTS,
  DEFAULT_AISDK_EMBEDDING_BATCH_MAX_UTF8_BYTES,
  DEFAULT_AISDK_REQUEST_TIMEOUT_MS,
  DEFAULT_AISDK_RETRY_LIMIT,
} from "../provider/ai-sdk-runtime";

export const PHASE74_EMBEDDING_CALL_CONFIGURATION = {
  batchMaxConcurrency: DEFAULT_AISDK_EMBEDDING_BATCH_MAX_CONCURRENCY,
  batchMaxInputs: DEFAULT_AISDK_EMBEDDING_BATCH_MAX_INPUTS,
  batchMaxUtf8Bytes: DEFAULT_AISDK_EMBEDDING_BATCH_MAX_UTF8_BYTES,
  requestTimeoutMs: DEFAULT_AISDK_REQUEST_TIMEOUT_MS,
  retryLimit: DEFAULT_AISDK_RETRY_LIMIT,
} as const;

export const PHASE74_PROVIDER_OBJECT_CALL_CONFIGURATION = {
  assistedExtraction: {
    maxOutputTokens: 4_096,
    reasoningEffort: "low",
    requestTimeoutMs: 60_000,
    retryLimit: 4,
    temperature: 0,
  },
  assistedRecallPlan: {
    maxOutputTokens: 1_024,
    requestTimeoutMs: 60_000,
    retryLimit: 4,
    temperature: 0,
  },
  judge: {
    oracle: {
      maxOutputTokens: 512,
      reasoningEffort: "medium",
      requestTimeoutMs: DEFAULT_AISDK_REQUEST_TIMEOUT_MS,
      retryLimit: 3,
      temperature: 0,
    },
    protocol: {
      maxOutputTokens: 10,
      reasoningEffort: "medium",
      requestTimeoutMs: DEFAULT_AISDK_REQUEST_TIMEOUT_MS,
      retryLimit: 3,
      temperature: 0,
    },
  },
  listwiseReranker: {
    maxConcurrency: 1,
    maxOutputTokens: 2_048,
    reasoningEffort: "medium",
    requestTimeoutMs: 60_000,
    retryLimit: 4,
    temperature: 0,
  },
  reader: {
    maxOutputTokens: 512,
    reasoningEffort: "medium",
    requestTimeoutMs: DEFAULT_AISDK_REQUEST_TIMEOUT_MS,
    retryLimit: 3,
    temperature: 0,
  },
} as const;
