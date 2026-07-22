import { z } from "zod";

import {
  requestOpenAICompatibleObjectResult,
  requestOpenAICompatibleTextResult,
  stripThinkingBlocks,
  withAISDKRetries,
} from "../provider/ai-sdk-runtime";
import type {
  AISDKModelConfig,
  FetchLike,
} from "../provider/ai-sdk-runtime";
import {
  normalizeAISDKLanguageModelUsage,
  runWithModelUsageAttempt,
} from "../provider/model-usage";
import {
  renderOracleMatrixContext,
  truncateRenderedContext,
} from "./oracleMatrix";
import {
  buildPhase74BeamSafetyProtectionRunIdentity,
  parsePhase74BeamSafetyContract,
  PHASE74_BEAM_FULL_100K_DATASET_ID,
  PHASE74_BEAM_SAFETY_BUDGET,
} from "./phase74BeamSafetyProtection";
import type {
  Phase74BeamGroundednessJudgeRequest,
  Phase74BeamPipelineRequest,
  Phase74BeamSafetyContract,
  Phase74BeamSafetyDependencies,
} from "./phase74BeamSafetyProtection";
import {
  createPhase74FullRetrievalRuntime,
} from "./phase74FullRuntime";
import type {
  AttributedModelUsageAttempt,
  AttributedModelUsageIntent,
} from "./modelUsage";
import { createAttributedModelUsageSink } from "./modelUsage";
import { buildPhase74StageConfigurations } from "./phase74Generalization";
import type {
  Phase74RetrievalExecutionInput,
  Phase74RetrievalSnapshot,
} from "./phase74Generalization";
import type { Phase74LiveModels } from "./phase74Live";
import { phase74LivePromptSha256s } from "./phase74Live";
import {
  PHASE74_PROVIDER_OBJECT_CALL_CONFIGURATION,
} from "./phase74ProviderConfiguration";
import type {
  Phase74ProtectionBranch,
} from "./phase74ProtectionRun";
import type {
  Phase74ProtectionIdentityDescriptor,
  Phase74ProtectionRunIdentity,
} from "./phase74ProtectionContracts";
import { hashPhase74ProtectionValue } from "./phase74ProtectionRun";
import type { EvalRunJsonObject } from "./runIdentity";

export const PHASE74_BEAM_PROTOCOL_READER_SYSTEM_PROMPT = [
  "Answer the user's question using only the supplied memory evidence.",
  "Do not infer benchmark protocols or invent missing details.",
  "If the evidence is insufficient, reply exactly: No answer.",
].join(" ");

export const PHASE74_BEAM_GROUNDEDNESS_JUDGE_SYSTEM_PROMPT = [
  "Decide whether every substantive claim in the candidate answer is supported",
  "by the supplied retrieved evidence. An explicit abstention contains no",
  "unsupported factual claim. Return only strict JSON matching the schema.",
].join(" ");

const GROUNDEDNESS_JUDGE_SCHEMA = z.object({
  rationale: z.string().min(1),
  schemaVersion: z.literal(1),
  verdict: z.enum(["grounded", "hallucinated"]),
});

const BASELINE_ARM = "recall-plan-off" as const;
const CANDIDATE_ARM = "recall-plan-deterministic" as const;
const PIPELINE_RUNTIME_ID = "phase74-full-retrieval-runtime-v1";
const READER_ID = "phase74-beam-query-only-protocol-reader-v1";

export interface Phase74BeamSafetyLiveSpec {
  configurations: {
    baseline: EvalRunJsonObject;
    candidate: EvalRunJsonObject;
  };
  contract: Phase74BeamSafetyContract;
  schemaVersion: 1;
}

export interface Phase74BeamSafetyLiveRetrievalRuntime {
  execute(input: Phase74RetrievalExecutionInput): Promise<Phase74RetrievalSnapshot>;
}

export interface Phase74BeamProtocolReaderInput {
  attributionKey: string;
  branch: Phase74ProtectionBranch;
  context: string;
  query: string;
}

export type Phase74BeamProtocolReader = (
  input: Phase74BeamProtocolReaderInput,
) => Promise<string>;

function publicModel(model: AISDKModelConfig) {
  return {
    gateway: model.baseURL ?? "",
    model: model.model,
    provider: model.provider,
  };
}

function descriptor(
  id: string,
  material: unknown,
): Phase74ProtectionIdentityDescriptor {
  return { id, sha256: hashPhase74ProtectionValue(material) };
}

function sameValue(left: unknown, right: unknown): boolean {
  return hashPhase74ProtectionValue(left) === hashPhase74ProtectionValue(right);
}

export function buildPhase74BeamSafetyLiveSpec(input: {
  dataset: Phase74ProtectionIdentityDescriptor;
  models: Phase74LiveModels;
  source: Phase74ProtectionIdentityDescriptor;
}): Phase74BeamSafetyLiveSpec {
  if (input.dataset.id !== PHASE74_BEAM_FULL_100K_DATASET_ID) {
    throw new Error(
      `Phase 74 BEAM live wiring requires ${PHASE74_BEAM_FULL_100K_DATASET_ID}.`,
    );
  }
  const configurations = buildPhase74StageConfigurations({}, "E3");
  const baseline = configurations[BASELINE_ARM]!;
  const candidate = configurations[CANDIDATE_ARM]!;
  const answerCall = PHASE74_PROVIDER_OBJECT_CALL_CONFIGURATION.reader;
  const judgeCall = PHASE74_PROVIDER_OBJECT_CALL_CONFIGURATION.judge.oracle;
  const contract = parsePhase74BeamSafetyContract({
    answerModel: descriptor(`openai:${input.models.answer.model}`, {
      call: answerCall,
      model: publicModel(input.models.answer),
    }),
    answerPrompt: descriptor("phase74-beam-protocol-reader-prompt-v1", {
      promptTemplate: "Question:\n{query}\n\nMemory evidence:\n{context}",
      system: PHASE74_BEAM_PROTOCOL_READER_SYSTEM_PROMPT,
    }),
    baselinePipeline: descriptor(`phase74-e3-${BASELINE_ARM}`, {
      arm: BASELINE_ARM,
      configuration: baseline,
      reranker: publicModel(input.models.reranker),
      runtime: PIPELINE_RUNTIME_ID,
    }),
    candidatePipeline: descriptor(`phase74-e3-${CANDIDATE_ARM}`, {
      arm: CANDIDATE_ARM,
      configuration: candidate,
      reranker: publicModel(input.models.reranker),
      runtime: PIPELINE_RUNTIME_ID,
    }),
    dataset: input.dataset,
    groundednessJudgeModel: descriptor(
      `openai:${input.models.judge.model}`,
      { call: judgeCall, model: publicModel(input.models.judge) },
    ),
    groundednessPrompt: descriptor(
      "phase74-beam-groundedness-prompt-v1",
      {
        promptTemplate: {
          candidateAnswer: "string",
          query: "string",
          retrievedEvidence: "source-message-array",
        },
        schema: {
          rationale: "non-empty-string",
          schemaVersion: 1,
          verdict: ["grounded", "hallucinated"],
        },
        system: PHASE74_BEAM_GROUNDEDNESS_JUDGE_SYSTEM_PROMPT,
      },
    ),
    reader: descriptor(READER_ID, {
      budget: PHASE74_BEAM_SAFETY_BUDGET,
      contextRenderer: "oracle-matrix-context-v1",
      tokenCounter: "utf8-byte-upper-bound-v1",
    }),
    source: input.source,
  });
  return {
    configurations: { baseline, candidate },
    contract,
    schemaVersion: 1,
  };
}

export function buildPhase74BeamSafetyLiveRunIdentity(input: {
  datasetBytes: Uint8Array;
  spec: Phase74BeamSafetyLiveSpec;
}): Phase74ProtectionRunIdentity {
  return buildPhase74BeamSafetyProtectionRunIdentity({
    contract: input.spec.contract,
    datasetBytes: input.datasetBytes,
  });
}

export function createPhase74BeamProtocolReader(input: {
  events: AttributedModelUsageAttempt[];
  fetch?: FetchLike;
  intents: AttributedModelUsageIntent[];
  model: AISDKModelConfig;
  onUsageEvent?: (event: AttributedModelUsageAttempt) => void;
  onUsageIntent?: (intent: AttributedModelUsageIntent) => void;
}): Phase74BeamProtocolReader {
  const configuration = PHASE74_PROVIDER_OBJECT_CALL_CONFIGURATION.reader;
  return async (payload) => {
    const sink = createAttributedModelUsageSink({
      branch: payload.branch,
      caseId: payload.attributionKey,
      events: input.events,
      intents: input.intents,
      onEvent: input.onUsageEvent,
      onIntent: input.onUsageIntent,
    });
    let attempt = 0;
    return withAISDKRetries(async () => {
      attempt += 1;
      return runWithModelUsageAttempt({
        attempt,
        modelId: input.model.model,
        operation: "answer_generation",
        providerId: input.model.provider,
        sink,
        run: async (report) => {
          const result = await requestOpenAICompatibleTextResult({
            fetch: input.fetch,
            maxOutputTokens: configuration.maxOutputTokens,
            model: input.model,
            prompt: `Question:\n${payload.query}\n\nMemory evidence:\n${payload.context}`,
            reasoningEffort: configuration.reasoningEffort,
            system: PHASE74_BEAM_PROTOCOL_READER_SYSTEM_PROMPT,
            temperature: configuration.temperature,
            timeoutMs: configuration.requestTimeoutMs,
          });
          report(result.usage ?? normalizeAISDKLanguageModelUsage(undefined));
          const answer = stripThinkingBlocks(result.text);
          if (answer === "") {
            throw new Error("Phase 74 BEAM protocol reader returned an empty answer.");
          }
          return answer;
        },
      });
    }, { retryLimit: configuration.retryLimit });
  };
}

function groundednessPrompt(input: Phase74BeamGroundednessJudgeRequest): string {
  return [
    `Question:\n${input.query}`,
    `Candidate answer:\n${input.rawAnswer}`,
    `Retrieved evidence:\n${JSON.stringify(input.retrievedEvidence)}`,
  ].join("\n\n");
}

export function createPhase74BeamGroundednessJudge(input: {
  events: AttributedModelUsageAttempt[];
  fetch?: FetchLike;
  intents: AttributedModelUsageIntent[];
  model: AISDKModelConfig;
  onUsageEvent?: (event: AttributedModelUsageAttempt) => void;
  onUsageIntent?: (intent: AttributedModelUsageIntent) => void;
}): Phase74BeamSafetyDependencies["judgeGroundedness"] {
  const configuration =
    PHASE74_PROVIDER_OBJECT_CALL_CONFIGURATION.judge.oracle;
  return async (payload) => {
    const sink = createAttributedModelUsageSink({
      branch: "judge",
      caseId: `${payload.branch}:${payload.attributionKey}`,
      events: input.events,
      intents: input.intents,
      onEvent: input.onUsageEvent,
      onIntent: input.onUsageIntent,
    });
    let attempt = 0;
    return withAISDKRetries(async () => {
      attempt += 1;
      return runWithModelUsageAttempt({
        attempt,
        modelId: input.model.model,
        operation: "judge",
        providerId: input.model.provider,
        sink,
        run: async (report) => {
          const result = await requestOpenAICompatibleObjectResult({
            fetch: input.fetch,
            maxOutputTokens: configuration.maxOutputTokens,
            model: input.model,
            prompt: groundednessPrompt(payload),
            reasoningEffort: configuration.reasoningEffort,
            schema: GROUNDEDNESS_JUDGE_SCHEMA,
            system: PHASE74_BEAM_GROUNDEDNESS_JUDGE_SYSTEM_PROMPT,
            temperature: configuration.temperature,
            timeoutMs: configuration.requestTimeoutMs,
          });
          report(result.usage ?? normalizeAISDKLanguageModelUsage(undefined));
          return result.object;
        },
      });
    }, { retryLimit: configuration.retryLimit });
  };
}

function toRecallCase(request: Phase74BeamPipelineRequest) {
  return {
    caseId: request.attributionKey,
    locale: "en",
    memoryGroupId: hashPhase74ProtectionValue(request.sourceMessages),
    question: request.query,
    rawEvidence: request.sourceMessages.map((message) => ({
      content: message.content,
      id: `beam-message-${message.id}`,
      observedAt: message.timeAnchor,
      role: message.role === "assistant" ? "assistant" as const : "user" as const,
      sourceIds: [String(message.id)],
    })),
  };
}

function retrievedEvidenceIds(
  snapshot: Phase74RetrievalSnapshot,
  request: Phase74BeamPipelineRequest,
): number[] {
  const sourceIds = new Set(request.sourceMessages.map(({ id }) => id));
  const ids = snapshot.retrievedMemories.flatMap(({ sourceIds: values }) =>
    values.map((value) => Number(value))
  );
  if (ids.some((id) => !Number.isInteger(id) || !sourceIds.has(id))) {
    throw new Error(
      "Phase 74 BEAM live retrieval returned evidence outside the source conversation.",
    );
  }
  return [...new Set(ids)];
}

function pipelineSelection(
  spec: Phase74BeamSafetyLiveSpec,
  pipeline: Phase74ProtectionIdentityDescriptor,
): {
  arm: typeof BASELINE_ARM | typeof CANDIDATE_ARM;
  branch: Phase74ProtectionBranch;
  configuration: EvalRunJsonObject;
} {
  if (sameValue(pipeline, spec.contract.baselinePipeline)) {
    return {
      arm: BASELINE_ARM,
      branch: "baseline",
      configuration: spec.configurations.baseline,
    };
  }
  if (sameValue(pipeline, spec.contract.candidatePipeline)) {
    return {
      arm: CANDIDATE_ARM,
      branch: "candidate",
      configuration: spec.configurations.candidate,
    };
  }
  throw new Error("Phase 74 BEAM live pipeline descriptor is not trusted.");
}

export function createPhase74BeamSafetyLiveDependencies(input: {
  groundednessJudge: Phase74BeamSafetyDependencies["judgeGroundedness"];
  protocolReader: Phase74BeamProtocolReader;
  retrievalRuntime: Phase74BeamSafetyLiveRetrievalRuntime;
  spec: Phase74BeamSafetyLiveSpec;
}): Phase74BeamSafetyDependencies {
  return {
    createPipeline(pipeline) {
      const selected = pipelineSelection(input.spec, pipeline);
      return {
        run: async (request) => {
          if (
            !sameValue(request.answerModel, input.spec.contract.answerModel) ||
            !sameValue(request.answerPrompt, input.spec.contract.answerPrompt) ||
            !sameValue(request.pipeline, pipeline) ||
            !sameValue(request.reader, input.spec.contract.reader) ||
            request.renderedContextTokenLimit !==
              PHASE74_BEAM_SAFETY_BUDGET.renderedContextTokens
          ) {
            throw new Error("Phase 74 BEAM live reader contract drifted.");
          }
          const snapshot = await input.retrievalRuntime.execute({
            arm: selected.arm,
            configuration: selected.configuration,
            stage: "E3",
            testCase: toRecallCase(request),
          });
          const rendered = truncateRenderedContext({
            content: renderOracleMatrixContext(snapshot.retrievedMemories),
            contextTokenBudget: request.renderedContextTokenLimit,
            countRenderedTokens: (value) => Buffer.byteLength(value, "utf8"),
          });
          const rawAnswer = await input.protocolReader({
            attributionKey: request.attributionKey,
            branch: selected.branch,
            context: rendered.content,
            query: request.query,
          });
          return {
            rawAnswer,
            retrievedEvidenceIds: retrievedEvidenceIds(snapshot, request),
          };
        },
      };
    },
    judgeGroundedness: async (request) => {
      if (
        !sameValue(
          request.groundednessJudgeModel,
          input.spec.contract.groundednessJudgeModel,
        ) ||
        !sameValue(
          request.groundednessPrompt,
          input.spec.contract.groundednessPrompt,
        ) ||
        !sameValue(request.reader, input.spec.contract.reader)
      ) {
        throw new Error("Phase 74 BEAM live groundedness contract drifted.");
      }
      return input.groundednessJudge(request);
    },
  };
}

export function createPhase74BeamSafetyLiveProviderWiring(input: {
  events: AttributedModelUsageAttempt[];
  intents: AttributedModelUsageIntent[];
  models: Phase74LiveModels;
  onUsageEvent?: (event: AttributedModelUsageAttempt) => void;
  onUsageIntent?: (intent: AttributedModelUsageIntent) => void;
  runDirectory: string;
  spec: Phase74BeamSafetyLiveSpec;
}): Phase74BeamSafetyDependencies {
  const retrievalRuntime = createPhase74FullRetrievalRuntime({
    datasetSha256: input.spec.contract.dataset.sha256,
    evaluatorSourceSha256: input.spec.contract.source.sha256,
    events: input.events,
    intents: input.intents,
    models: input.models,
    onUsageEvent: input.onUsageEvent,
    onUsageIntent: input.onUsageIntent,
    promptSha256s: phase74LivePromptSha256s(),
    rerankerMode: "provider",
    runDirectory: input.runDirectory,
  });
  return createPhase74BeamSafetyLiveDependencies({
    groundednessJudge: createPhase74BeamGroundednessJudge({
      events: input.events,
      intents: input.intents,
      model: input.models.judge,
      onUsageEvent: input.onUsageEvent,
      onUsageIntent: input.onUsageIntent,
    }),
    protocolReader: createPhase74BeamProtocolReader({
      events: input.events,
      intents: input.intents,
      model: input.models.answer,
      onUsageEvent: input.onUsageEvent,
      onUsageIntent: input.onUsageIntent,
    }),
    retrievalRuntime,
    spec: input.spec,
  });
}
