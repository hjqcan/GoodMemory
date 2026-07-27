import { z } from "zod";

import type { AISDKModelConfig, FetchLike } from "./ai-sdk-runtime";
import {
  requestOpenAICompatibleObject,
  withAISDKRetries,
} from "./ai-sdk-runtime";

const DEFAULT_FOLLOW_UP_REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_FOLLOW_UP_RETRY_LIMIT = 2;
const DEFAULT_FOLLOW_UP_MAX_OUTPUT_TOKENS = 256;

const followUpResultSchema = z.object({
  followUpQuery: z.string(),
});

// R8 generic sub-query prompt: read the question plus what hop-1 retrieved,
// and either name the one missing link as a focused follow-up query, or stop.
// No domain or benchmark vocabulary — this must generalize to any corpus.
const FOLLOW_UP_SYSTEM_PROMPT = [
  "You assist a memory retrieval system with multi-hop questions.",
  "Given a question and the memory snippets retrieved so far, decide whether",
  "one more retrieval step would help. If a specific missing link is needed",
  "(an entity, value, or relation mentioned in the snippets but not yet",
  "resolved), write ONE short focused retrieval query for exactly that link.",
  "If the snippets already contain what the question needs, or no useful",
  "follow-up exists, respond with an empty string. Respond with JSON:",
  '{"followUpQuery": "..."}.',
].join(" ");

function buildFollowUpPrompt(input: {
  evidence: readonly string[];
  hop: number;
  query: string;
}): string {
  return [
    `Question: ${input.query}`,
    `Retrieval hop: ${input.hop}`,
    "Retrieved snippets:",
    ...input.evidence.map((snippet, index) => `${index + 1}. ${snippet}`),
  ].join("\n");
}

export interface ProviderFollowUpQueryGenerator {
  generate(input: {
    evidence: readonly string[];
    hop: number;
    query: string;
  }): Promise<string | null>;
}

// Any OpenAI-compatible chat model becomes the R8 follow-up adapter:
// structured output, temperature 0, bounded timeout/retries. Mirrors
// createProviderRetrievalCueGenerator.
export function createProviderFollowUpQueryGenerator(input: {
  fetch?: FetchLike;
  maxOutputTokens?: number;
  model: AISDKModelConfig;
  requestTimeoutMs?: number;
  retryLimit?: number;
  temperature?: number;
}): ProviderFollowUpQueryGenerator {
  const requestTimeoutMs =
    input.requestTimeoutMs ?? DEFAULT_FOLLOW_UP_REQUEST_TIMEOUT_MS;
  const retryLimit = input.retryLimit ?? DEFAULT_FOLLOW_UP_RETRY_LIMIT;
  if (!Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs <= 0) {
    throw new Error(
      "Provider follow-up requestTimeoutMs must be a positive integer.",
    );
  }
  if (!Number.isSafeInteger(retryLimit) || retryLimit <= 0) {
    throw new Error(
      "Provider follow-up retryLimit must be a positive integer.",
    );
  }

  return {
    async generate(request) {
      const result = await withAISDKRetries(
        () =>
          requestOpenAICompatibleObject({
            maxOutputTokens:
              input.maxOutputTokens ?? DEFAULT_FOLLOW_UP_MAX_OUTPUT_TOKENS,
            model: input.model,
            prompt: buildFollowUpPrompt(request),
            schema: followUpResultSchema,
            system: FOLLOW_UP_SYSTEM_PROMPT,
            temperature: input.temperature ?? 0,
            ...(input.fetch ? { fetch: input.fetch } : {}),
            timeoutMs: requestTimeoutMs,
          }),
        { retryLimit },
      );
      const trimmed = result.followUpQuery.trim();
      return trimmed.length > 0 ? trimmed : null;
    },
  };
}
