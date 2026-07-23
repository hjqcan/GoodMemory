import { buildPhase74ProtocolScoringIdentity } from "./phase74ProtocolScoring";
import type { Phase74BenchmarkFamily } from "./phase74Datasets";
import {
  PHASE74_PROVIDER_OBJECT_CALL_CONFIGURATION,
} from "./phase74ProviderConfiguration";
import type {
  EvalRunJsonObject,
  EvalRunModelIdentity,
} from "./runIdentity";
import {
  PHASE74_PROTECTION_BLUEPRINT_ID,
} from "./phase74ProtectionVerifier";

export const PHASE74_CONTEXT_TOKEN_BUDGET = 6_000;
export const PHASE74_PRE_RANK_LIMIT = 32;
export const PHASE74_SELECTED_LIMIT = 12;

const PHASE74_FULL_RUN_FIXED_CONFIGURATION = {
  answer: {
    maxTokens: 512,
    reasoningEffort: "medium",
    temperature: 0,
  },
  caseScheduling: "interleaved-memory-groups-v1",
  context: {
    maxTokens: PHASE74_CONTEXT_TOKEN_BUDGET,
    tokenizer: "utf8-byte-upper-bound-v1",
  },
  costBoundary: "full-product-standalone-shared-v1",
  modelUsageAccounting: "phase74-model-usage-v2",
  preRankLimit: PHASE74_PRE_RANK_LIMIT,
  reader: "generic-label-free-v1",
  selectedLimit: PHASE74_SELECTED_LIMIT,
  seenCasesOnly: true,
} as const satisfies EvalRunJsonObject;

export function buildPhase74FullRunIdentityConfiguration(input: {
  caseConcurrency?: number;
  callBudget: {
    embeddingSpendLimitUsd: number;
    maxLanguageCalls: number;
  };
  dataset: EvalRunJsonObject;
  embedding: EvalRunJsonObject;
  evaluatorSource: EvalRunJsonObject;
  confirmatoryAdmission?: {
    confirmatoryPlan: EvalRunJsonObject;
    parentDataset: EvalRunJsonObject;
  };
  protectionBlueprint: EvalRunJsonObject;
  replicate: 1 | 2 | 3;
  reranker: EvalRunJsonObject;
  scoring: EvalRunJsonObject;
  selection: EvalRunJsonObject;
  selectedCaseIdsSha256: string;
}): EvalRunJsonObject {
  assertCallBudget(input.callBudget);
  const caseConcurrency = input.caseConcurrency ?? 1;
  if (!Number.isSafeInteger(caseConcurrency) || caseConcurrency <= 0) {
    throw new Error("Phase 74 experiment identity caseConcurrency is invalid.");
  }
  return {
    answer: PHASE74_FULL_RUN_FIXED_CONFIGURATION.answer,
    callBudget: input.callBudget,
    caseConcurrency,
    caseScheduling: PHASE74_FULL_RUN_FIXED_CONFIGURATION.caseScheduling,
    context: PHASE74_FULL_RUN_FIXED_CONFIGURATION.context,
    costBoundary: PHASE74_FULL_RUN_FIXED_CONFIGURATION.costBoundary,
    dataset: input.dataset,
    embedding: input.embedding,
    evaluatorSource: input.evaluatorSource,
    ...(input.confirmatoryAdmission === undefined
      ? {}
      : {
          confirmatoryPlan:
            input.confirmatoryAdmission.confirmatoryPlan,
          parentDataset: input.confirmatoryAdmission.parentDataset,
        }),
    modelUsageAccounting: PHASE74_FULL_RUN_FIXED_CONFIGURATION.modelUsageAccounting,
    preRankLimit: PHASE74_FULL_RUN_FIXED_CONFIGURATION.preRankLimit,
    providerObjectCalls: PHASE74_PROVIDER_OBJECT_CALL_CONFIGURATION,
    protectionBlueprint: input.protectionBlueprint,
    reader: PHASE74_FULL_RUN_FIXED_CONFIGURATION.reader,
    replicate: input.replicate,
    reranker: input.reranker,
    scoring: input.scoring,
    selection: input.selection,
    selectedCaseIdsSha256: input.selectedCaseIdsSha256,
    selectedLimit: PHASE74_FULL_RUN_FIXED_CONFIGURATION.selectedLimit,
    seenCasesOnly: PHASE74_FULL_RUN_FIXED_CONFIGURATION.seenCasesOnly,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${stableJson(value[key])}`
    ).join(",")}}`;
  }
  return JSON.stringify(value);
}

function assertEqual(actual: unknown, expected: unknown, label: string): void {
  if (stableJson(actual) !== stableJson(expected)) {
    throw new Error(`Phase 74 experiment identity ${label} drifted.`);
  }
}

function assertModelIdentity(value: unknown, label: string): void {
  if (
    !isRecord(value) ||
    typeof value.gateway !== "string" || value.gateway.length === 0 ||
    typeof value.model !== "string" || value.model.length === 0 ||
    typeof value.provider !== "string" || value.provider.length === 0
  ) {
    throw new Error(`Phase 74 experiment identity ${label} is missing.`);
  }
}

function assertEvaluatorSource(value: unknown): void {
  if (
    !isRecord(value) ||
    typeof value.commit !== "string" || !/^[0-9a-f]{40}$/u.test(value.commit) ||
    typeof value.sha256 !== "string" || !/^[0-9a-f]{64}$/u.test(value.sha256)
  ) {
    throw new Error("Phase 74 experiment identity evaluatorSource is missing or invalid.");
  }
}

function assertProtectionBlueprint(value: unknown): void {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== 2 ||
    value.id !== PHASE74_PROTECTION_BLUEPRINT_ID ||
    typeof value.sha256 !== "string" ||
    !/^[0-9a-f]{64}$/u.test(value.sha256)
  ) {
    throw new Error(
      "Phase 74 experiment identity protectionBlueprint is missing or invalid.",
    );
  }
}

function assertConfirmatoryAdmission(
  configuration: EvalRunJsonObject,
): void {
  const descriptor = configuration.confirmatoryPlan;
  const parentDataset = configuration.parentDataset;
  const gitAnchor = isRecord(descriptor)
    ? descriptor.gitAnchor
    : undefined;
  if (
    !isRecord(descriptor) ||
    Object.keys(descriptor).length !== 3 ||
    descriptor.artifactKind !== "phase74-full-family-confirmatory-plan" ||
    typeof descriptor.sha256 !== "string" ||
    !/^[0-9a-f]{64}$/u.test(descriptor.sha256) ||
    !isRecord(gitAnchor) ||
    Object.keys(gitAnchor).length !== 6 ||
    typeof gitAnchor.commit !== "string" ||
    !/^[0-9a-f]{40}$/u.test(gitAnchor.commit) ||
    typeof gitAnchor.executionCommit !== "string" ||
    !/^[0-9a-f]{40}$/u.test(gitAnchor.executionCommit) ||
    typeof gitAnchor.path !== "string" ||
    gitAnchor.path.length === 0 ||
    gitAnchor.path.startsWith("/") ||
    gitAnchor.path.split("/").includes("..") ||
    gitAnchor.remote !== "origin" ||
    gitAnchor.remoteRef !== "refs/heads/main" ||
    gitAnchor.remoteUrl !==
      "https://github.com/hjqcan/GoodMemory.git" ||
    !isRecord(parentDataset)
  ) {
    throw new Error(
      "Phase 74 confirmatory identity requires a valid presealed full-family plan.",
    );
  }
}

function assertCallBudget(value: unknown): void {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== 2 ||
    typeof value.embeddingSpendLimitUsd !== "number" ||
    !Number.isFinite(value.embeddingSpendLimitUsd) ||
    value.embeddingSpendLimitUsd <= 0 ||
    typeof value.maxLanguageCalls !== "number" ||
    !Number.isSafeInteger(value.maxLanguageCalls) ||
    value.maxLanguageCalls <= 0
  ) {
    throw new Error("Phase 74 experiment identity callBudget is missing or invalid.");
  }
}

export function assertPhase74ExperimentIdentityContract(input: {
  benchmark: Phase74BenchmarkFamily;
  configuration: EvalRunJsonObject;
  dataset: unknown;
  expectedEmbedding?: EvalRunJsonObject;
  expectedEvaluatorSource?: EvalRunJsonObject;
  expectedReranker: EvalRunJsonObject;
  judgeModel: EvalRunModelIdentity;
}): void {
  if (
    Object.prototype.hasOwnProperty.call(
      input.configuration,
      "mainEvaluationPlan",
    ) ||
    Object.prototype.hasOwnProperty.call(
      input.configuration,
      "mainEvaluationAdmission",
    )
  ) {
    throw new Error(
      "Phase 74 identity field mainEvaluationPlan was removed; use confirmatoryPlan.",
    );
  }
  for (const [field, expected] of Object.entries(
    PHASE74_FULL_RUN_FIXED_CONFIGURATION,
  )) {
    assertEqual(input.configuration[field], expected, field);
  }
  assertCallBudget(input.configuration.callBudget);
  if (
    !Number.isSafeInteger(input.configuration.caseConcurrency) ||
    Number(input.configuration.caseConcurrency) <= 0
  ) {
    throw new Error("Phase 74 experiment identity caseConcurrency is invalid.");
  }
  assertEqual(input.configuration.dataset, input.dataset, "dataset manifest");
  assertModelIdentity(input.configuration.embedding, "embedding");
  assertEvaluatorSource(input.configuration.evaluatorSource);
  assertProtectionBlueprint(input.configuration.protectionBlueprint);
  if (input.configuration.seenCasesOnly === true) {
    const hasConfirmatoryPlan =
      input.configuration.confirmatoryPlan !== undefined;
    const hasParentDataset =
      input.configuration.parentDataset !== undefined;
    if (hasConfirmatoryPlan !== hasParentDataset) {
      throw new Error(
        "Phase 74 confirmatory identity requires both confirmatory plan and parent dataset.",
      );
    }
    if (hasConfirmatoryPlan) {
      assertConfirmatoryAdmission(input.configuration);
    }
  } else if (input.configuration.seenCasesOnly === false) {
    throw new Error(
      "Phase 74 confirmatory datasets cannot be marked unseen.",
    );
  } else {
    throw new Error("Phase 74 experiment identity seenCasesOnly drifted.");
  }
  assertEqual(
    input.configuration.providerObjectCalls,
    PHASE74_PROVIDER_OBJECT_CALL_CONFIGURATION,
    "providerObjectCalls",
  );
  assertEqual(
    input.configuration.reranker,
    input.expectedReranker,
    "reranker",
  );
  assertEqual(
    input.configuration.scoring,
    buildPhase74ProtocolScoringIdentity(input.benchmark, input.judgeModel),
    "scoring",
  );
  if (input.expectedEmbedding !== undefined) {
    assertEqual(
      input.configuration.embedding,
      input.expectedEmbedding,
      "embedding",
    );
  }
  if (input.expectedEvaluatorSource !== undefined) {
    assertEqual(
      input.configuration.evaluatorSource,
      input.expectedEvaluatorSource,
      "evaluatorSource",
    );
  }
}
