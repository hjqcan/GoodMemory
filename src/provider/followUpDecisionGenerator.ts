import { z } from "zod";

import type { FollowUpDecision } from "../recall/iterativeRecall";
import type { AISDKModelConfig, FetchLike } from "./ai-sdk-runtime";
import {
  requestOpenAICompatibleObject,
  withAISDKRetries,
} from "./ai-sdk-runtime";

const DEFAULT_FOLLOW_UP_REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_FOLLOW_UP_RETRY_LIMIT = 2;
const DEFAULT_FOLLOW_UP_MAX_OUTPUT_TOKENS = 256;

const queryOnlyResultSchema = z.object({
  followUpQuery: z.string(),
});

const structuredDecisionSchema = z.object({
  missingSlots: z.array(z.string()).length(1),
  sufficient: z.literal(false),
}).or(
  z.object({
    missingSlots: z.array(z.string()).length(0),
    sufficient: z.literal(true),
  }),
);

// Historical R8 control prompt, retained only as an explicit experiment arm.
const QUERY_ONLY_SYSTEM_PROMPT = [
  "You assist a memory retrieval system with multi-hop questions.",
  "Given a question and the memory snippets retrieved so far, decide whether",
  "one more retrieval step would help. If a specific missing link is needed",
  "(an entity, value, or relation mentioned in the snippets but not yet",
  "resolved), write ONE short focused retrieval query for exactly that link.",
  "If the snippets already contain what the question needs, or no useful",
  "follow-up exists, respond with an empty string. Respond with JSON:",
  '{"followUpQuery": "..."}.',
].join(" ");

// Treatment prompt: first make the stop decision explicit, then name concrete
// evidence gaps before proposing another query. It contains no benchmark or
// category labels and applies the same contract to every corpus.
const STRUCTURED_DECISION_SYSTEM_PROMPT = [
  "You assist a memory retrieval system with multi-hop questions.",
  "Set sufficient=true only when the snippets explicitly support every part",
  "needed to answer the question; do not fill omitted links from assumptions",
  "or outside knowledge. When uncertain, set sufficient=false. If sufficient,",
  "use missingSlots=[]. Otherwise put exactly ONE short, standalone retrieval",
  "question in missingSlots. It must be different from the original question",
  "and target exactly one concrete unresolved entity, value, or relation",
  "grounded in the snippets. Do not merely restate the original. Respond with",
  "JSON:",
  '{"sufficient":false,"missingSlots":["..."]}.',
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

export interface ProviderFollowUpDecisionGenerator {
  generate(input: {
    evidence: readonly string[];
    hop: number;
    query: string;
  }): Promise<FollowUpDecision>;
}

export type ProviderFollowUpDecisionMode =
  | "query_only"
  | "structured_sufficiency";

// Any OpenAI-compatible chat model becomes the R8 decision adapter. The default
// is the structured treatment; query_only reproduces the historical prompt for
// a controlled ablation while exposing the same runtime decision contract.
export function createProviderFollowUpDecisionGenerator(input: {
  fetch?: FetchLike;
  maxOutputTokens?: number;
  mode?: ProviderFollowUpDecisionMode;
  model: AISDKModelConfig;
  requestTimeoutMs?: number;
  retryLimit?: number;
  temperature?: number;
}): ProviderFollowUpDecisionGenerator {
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
      const requestBase = {
        maxOutputTokens:
          input.maxOutputTokens ?? DEFAULT_FOLLOW_UP_MAX_OUTPUT_TOKENS,
        model: input.model,
        prompt: buildFollowUpPrompt(request),
        temperature: input.temperature ?? 0,
        ...(input.fetch ? { fetch: input.fetch } : {}),
        timeoutMs: requestTimeoutMs,
      };
      if (input.mode === "query_only") {
        const result = await withAISDKRetries(
          () =>
            requestOpenAICompatibleObject({
              ...requestBase,
              schema: queryOnlyResultSchema,
              system: QUERY_ONLY_SYSTEM_PROMPT,
            }),
          { retryLimit },
        );
        const followUpQuery = result.followUpQuery.trim();
        return followUpQuery.length > 0
          ? {
              missingSlots: [followUpQuery],
              sufficient: false,
            }
          : {
              missingSlots: [],
              sufficient: true,
            };
      }

      const result = await withAISDKRetries(
        () =>
          requestOpenAICompatibleObject({
            ...requestBase,
            schema: structuredDecisionSchema,
            system: STRUCTURED_DECISION_SYSTEM_PROMPT,
          }),
        { retryLimit },
      );
      if (result.sufficient) {
        return {
          missingSlots: [],
          sufficient: true,
        };
      }
      const missingSlot = result.missingSlots[0]!.trim();
      if (!missingSlot) {
        throw new Error(
          "Provider follow-up decision returned an empty missing slot.",
        );
      }
      return {
        missingSlots: [missingSlot],
        sufficient: false,
      };
    },
  };
}
