import { z } from "zod";

import type { AISDKModelConfig, FetchLike } from "./ai-sdk-runtime";
import {
  requestOpenAICompatibleObject,
  withAISDKRetries,
} from "./ai-sdk-runtime";

const DEFAULT_RETRIEVAL_CUE_REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_RETRIEVAL_CUE_RETRY_LIMIT = 2;
const DEFAULT_RETRIEVAL_CUE_MAX_OUTPUT_TOKENS = 256;

const retrievalCueResultSchema = z.object({
  cues: z.array(z.string()).max(8),
});

// Generic write-time question expansion: wording a person would later use,
// grounded strictly in the stored memory. No domain or benchmark vocabulary
// belongs here — the cues must generalize to any corpus.
const RETRIEVAL_CUE_SYSTEM_PROMPT = [
  "You generate retrieval cues for a personal memory system.",
  "Given one stored memory, write 2 to 4 short natural-language questions a",
  "user might later ask whose answer is this memory. Phrase them the way a",
  "person would actually ask — do not reuse the memory's own wording when a",
  "more natural phrasing exists. Never invent details that are not in the",
  "memory. Respond with JSON: {\"cues\": [\"...\"]}.",
].join(" ");

function buildRetrievalCuePrompt(input: {
  category: string;
  content: string;
  subject?: string;
}): string {
  return [
    `Memory category: ${input.category}`,
    ...(input.subject ? [`Memory subject: ${input.subject}`] : []),
    `Memory content: ${input.content}`,
  ].join("\n");
}

export interface ProviderRetrievalCueGenerator {
  generate(input: {
    category: string;
    content: string;
    subject?: string;
  }): Promise<string[]>;
}

export function createProviderRetrievalCueGenerator(input: {
  fetch?: FetchLike;
  maxOutputTokens?: number;
  model: AISDKModelConfig;
  requestTimeoutMs?: number;
  retryLimit?: number;
  temperature?: number;
}): ProviderRetrievalCueGenerator {
  const requestTimeoutMs =
    input.requestTimeoutMs ?? DEFAULT_RETRIEVAL_CUE_REQUEST_TIMEOUT_MS;
  const retryLimit = input.retryLimit ?? DEFAULT_RETRIEVAL_CUE_RETRY_LIMIT;
  if (!Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs <= 0) {
    throw new Error(
      "Provider retrieval-cue requestTimeoutMs must be a positive integer.",
    );
  }
  if (!Number.isSafeInteger(retryLimit) || retryLimit <= 0) {
    throw new Error(
      "Provider retrieval-cue retryLimit must be a positive integer.",
    );
  }

  return {
    async generate(fact) {
      const result = await withAISDKRetries(
        () =>
          requestOpenAICompatibleObject({
            maxOutputTokens:
              input.maxOutputTokens ?? DEFAULT_RETRIEVAL_CUE_MAX_OUTPUT_TOKENS,
            model: input.model,
            prompt: buildRetrievalCuePrompt(fact),
            schema: retrievalCueResultSchema,
            system: RETRIEVAL_CUE_SYSTEM_PROMPT,
            temperature: input.temperature ?? 0,
            ...(input.fetch ? { fetch: input.fetch } : {}),
            timeoutMs: requestTimeoutMs,
          }),
        { retryLimit },
      );
      return result.cues;
    },
  };
}
