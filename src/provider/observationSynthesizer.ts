import { z } from "zod";

import type { AISDKModelConfig, FetchLike } from "./ai-sdk-runtime";
import {
  requestOpenAICompatibleObject,
  withAISDKRetries,
} from "./ai-sdk-runtime";

const DEFAULT_OBSERVATION_REQUEST_TIMEOUT_MS = 20_000;
const DEFAULT_OBSERVATION_RETRY_LIMIT = 2;
const DEFAULT_OBSERVATION_MAX_OUTPUT_TOKENS = 512;
const OBSERVATION_MAX_MEMBER_CONTENT_CHARS = 400;
const OBSERVATION_MAX_MEMBERS = 32;

const observationResultSchema = z.object({
  observation: z.string(),
});

// R9 generic synthesis prompt: summarize what a subject's stored facts
// establish, strictly grounded in those facts. No domain or benchmark
// vocabulary belongs here — observations must generalize to any corpus.
const OBSERVATION_SYSTEM_PROMPT = [
  "You maintain a personal memory system.",
  "Given the stored facts about one subject, write a single compact",
  "observation paragraph (2-4 sentences) summarizing what these facts",
  "establish about the subject. State only what the facts support — never",
  "invent, speculate, or generalize beyond them. If the facts establish",
  "nothing coherent, respond with an empty observation. Respond with JSON:",
  '{"observation": "..."}.',
].join(" ");

function buildObservationPrompt(input: {
  contents: readonly string[];
  subject: string;
}): string {
  const members = input.contents
    .slice(0, OBSERVATION_MAX_MEMBERS)
    .map(
      (content, index) =>
        `${index + 1}. ${content.slice(0, OBSERVATION_MAX_MEMBER_CONTENT_CHARS)}`,
    );
  return [`Subject: ${input.subject}`, "Stored facts:", ...members].join("\n");
}

export interface ProviderObservationSynthesizer {
  synthesize(input: {
    contents: readonly string[];
    subject: string;
  }): Promise<string | null>;
}

// Any OpenAI-compatible chat model becomes the observationSynthesis
// maintenance-job adapter: structured output, low temperature, bounded
// timeout/retries. Mirrors createProviderRetrievalCueGenerator.
export function createProviderObservationSynthesizer(input: {
  fetch?: FetchLike;
  maxOutputTokens?: number;
  model: AISDKModelConfig;
  requestTimeoutMs?: number;
  retryLimit?: number;
  temperature?: number;
}): ProviderObservationSynthesizer {
  const requestTimeoutMs =
    input.requestTimeoutMs ?? DEFAULT_OBSERVATION_REQUEST_TIMEOUT_MS;
  const retryLimit = input.retryLimit ?? DEFAULT_OBSERVATION_RETRY_LIMIT;
  if (!Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs <= 0) {
    throw new Error(
      "Provider observation-synthesis requestTimeoutMs must be a positive integer.",
    );
  }
  if (!Number.isSafeInteger(retryLimit) || retryLimit <= 0) {
    throw new Error(
      "Provider observation-synthesis retryLimit must be a positive integer.",
    );
  }

  return {
    async synthesize(request) {
      const result = await withAISDKRetries(
        () =>
          requestOpenAICompatibleObject({
            maxOutputTokens:
              input.maxOutputTokens ?? DEFAULT_OBSERVATION_MAX_OUTPUT_TOKENS,
            model: input.model,
            prompt: buildObservationPrompt(request),
            schema: observationResultSchema,
            system: OBSERVATION_SYSTEM_PROMPT,
            temperature: input.temperature ?? 0,
            ...(input.fetch ? { fetch: input.fetch } : {}),
            timeoutMs: requestTimeoutMs,
          }),
        { retryLimit },
      );
      const trimmed = result.observation.trim();
      return trimmed.length > 0 ? trimmed : null;
    },
  };
}
