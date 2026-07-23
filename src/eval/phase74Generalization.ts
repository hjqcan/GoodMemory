import { createHash } from "node:crypto";

import { selectEvidenceLedgerFormat } from "./evidenceLedgerFormats";
import type { EvidenceLedgerFormat } from "./evidenceLedgerFormats";
import type { RecallResult } from "../api/contracts";
import type { EvidenceLedgerEntry } from "../recall/evidenceLedger";
import {
  measureOracleMatrixCoverage,
  PHASE74_CONTEXT_TOKEN_BUDGET,
  renderOracleMatrixContext,
  runOracleMatrixCase,
  truncateRenderedContext,
} from "./oracleMatrix";
import type {
  OracleMatrixCaseResult,
  OracleMatrixContextItem,
  OracleMatrixJudge,
  OracleMatrixProtocolReader,
  OracleMatrixReader,
  RenderedTokenCounter,
} from "./oracleMatrix";
import {
  PHASE74_EXPERIMENT_ARMS,
  assertPhase74StageIsolation,
} from "./phase74ExperimentDesign";
import type { Phase74ExperimentStage } from "./phase74ExperimentDesign";
import {
  hashEvalExperimentIdentity,
  hashEvalRunIdentity,
} from "./runIdentity";
import type {
  EvalRunIdentity,
  EvalRunJsonObject,
  EvalRunJsonValue,
} from "./runIdentity";

type RetrievalStage = Exclude<Phase74ExperimentStage, "E4">;
type RetrievalArm = (typeof PHASE74_EXPERIMENT_ARMS)[RetrievalStage][number];

export interface Phase74GeneralizationCase {
  caseId: string;
  expectedAnswer: string;
  family?: "locomo" | "longmemeval";
  goldEvidenceIds: readonly string[];
  labelFreeCaseKey?: string;
  locale?: string;
  memoryGroupId?: string;
  protocolMetadata?: Readonly<Record<string, unknown>>;
  question: string;
  rawEvidence: readonly Phase74RawEvidenceItem[];
  referenceTime?: string;
  unresolvedGoldEvidenceIds?: readonly string[];
}

export interface Phase74RawEvidenceItem extends OracleMatrixContextItem {
  observedAt?: string;
  role?: string;
}

export interface Phase74RecallCase {
  caseId: string;
  locale?: string;
  memoryGroupId?: string;
  question: string;
  rawEvidence: readonly Phase74RawEvidenceItem[];
  referenceTime?: string;
}

interface Phase74LabelFreeCaseBoundary {
  caseKey: string;
  goldEvidenceIds: readonly string[];
  recallCase: Phase74RecallCase;
  unresolvedGoldEvidenceIds: readonly string[];
}

export interface Phase74RetrievalSnapshot {
  costTrace?: {
    comparisonBranch: "baseline" | "candidate" | "shadow";
    ingestionKey: string;
    representation: string;
  };
  evaluation?: Phase74RetrievalEvaluation;
  evidenceLedger?: readonly EvidenceLedgerEntry[];
  evidenceLedgers?: Partial<Record<EvidenceLedgerFormat, string>>;
  recallMetadata?: Pick<
    RecallResult["metadata"],
    "candidateTraces" | "latencyMs" | "retrievalTrace" | "routingDecision"
  > & {
    queryPathLatencyMs?: number;
  };
  retrievedMemories: readonly OracleMatrixContextItem[];
  snapshotId: string;
  storedMemories: readonly OracleMatrixContextItem[];
}

export interface Phase74RetrievalEvaluation {
  answer: string;
  answerLatencyMs: number;
  attribution: Phase74EvaluationAttribution;
  contextTokens: number;
  contextTokensBeforeTruncation: number;
  contextTruncated: boolean;
  correct: boolean;
  productLatencyMs: number;
  recallLatencyMs: number;
  score: number;
}

export interface Phase74EvaluationAttribution {
  inputSha256: string;
  observedAnswer: string;
  observedCorrect: boolean;
  observedScore: number;
  reused: boolean;
  sourceArm: string;
  sourceSnapshotId: string;
}

export interface Phase74AnswerAssessment {
  correct: boolean;
  score: number;
}

export interface Phase74RetrievalExecutionInput {
  arm: RetrievalArm;
  configuration: EvalRunJsonObject;
  stage: RetrievalStage;
  testCase: Phase74RecallCase;
}

export interface Phase74GeneralizationExecutionResult {
  answer?: string;
  answerLatencyMs?: number;
  arm: RetrievalArm;
  caseId: string;
  clusterId: string;
  configuration: EvalRunJsonObject;
  contextTokens?: number;
  contextTokensBeforeTruncation?: number;
  contextTruncated?: boolean;
  correct?: boolean;
  evaluationAttribution?: Phase74EvaluationAttribution;
  executionError?: string;
  metrics?: ReturnType<typeof measureOracleMatrixCoverage>;
  productLatencyMs?: number;
  recallLatencyMs?: number;
  score?: number;
  snapshotId?: string;
  stage: RetrievalStage;
}

export function phase74ComparisonBranch(
  stage: RetrievalStage,
  arm: RetrievalArm,
): "baseline" | "candidate" | "shadow" {
  if (
    (stage === "E1" && arm === "fact-only") ||
    (stage === "E2" && arm === "claim-temporal-off") ||
    (stage === "E3" && arm === "recall-plan-off")
  ) {
    return "baseline";
  }
  if (
    (stage === "E1" && arm === "atomic-contextual-raw-pointer") ||
    (stage === "E2" && arm === "claim-temporal-on") ||
    (stage === "E3" && arm === "recall-plan-deterministic")
  ) {
    return "candidate";
  }
  return "shadow";
}

export interface Phase74E4CaseResult {
  answer: string | null;
  caseId: string;
  clusterId: string;
  contextTokens: number;
  contextTokensBeforeTruncation: number;
  contextTruncated: boolean;
  correct: boolean;
  executionError?: string;
  format: EvidenceLedgerFormat;
  renderedLedgerSha256: string;
  score: number;
  sourceSnapshotId: string;
}

export interface Phase74E4FormatResult {
  averageTokens: number | null;
  format: EvidenceLedgerFormat;
  macroScore: number;
  protectionDelta: number | null;
}

export interface Phase74GeneralizationReport {
  e4: {
    cases: Phase74E4CaseResult[];
    formatResults: Phase74E4FormatResult[];
    selectedFormat: EvidenceLedgerFormat | "not_evaluable";
  };
  executions: Phase74GeneralizationExecutionResult[];
  experimentIdentityHash: string;
  identity: EvalRunIdentity;
  identityHash: string;
  oracle: OracleMatrixCaseResult[];
  reason: string;
  schemaVersion: 1;
  status: "not_evaluable";
  summary: {
    caseCount: number;
    executionFailures: number;
    renderedContextMaxTokens: number;
  };
}

export interface RunPhase74GeneralizationInput {
  assessAnswer?(input: {
    answer: string;
    purpose: string;
    testCase: Phase74GeneralizationCase;
  }): Promise<Phase74AnswerAssessment>;
  caseConcurrency?: number;
  cases: readonly Phase74GeneralizationCase[];
  checkpoint?: Phase74GeneralizationCheckpoint;
  contextTokenBudget?: number;
  countRenderedTokens: RenderedTokenCounter;
  e4ProtectionDeltas?: Partial<Record<EvidenceLedgerFormat, number>>;
  executeRetrieval(
    input: Phase74RetrievalExecutionInput,
  ): Promise<Phase74RetrievalSnapshot>;
  genericReader: OracleMatrixReader;
  identity: EvalRunIdentity;
  includeOracle?: boolean;
  judge: OracleMatrixJudge;
  onRetrievalSnapshot?(snapshot: Phase74RetrievalSnapshot): void;
  persistIdentity(
    identity: EvalRunIdentity,
  ): Promise<EvalRunIdentity | void>;
  protocolReader: OracleMatrixProtocolReader;
  renderEvidenceLedger(input: {
    format: EvidenceLedgerFormat;
    locale?: string;
    snapshot: Phase74RetrievalSnapshot;
  }): Promise<string>;
  serializeMemoryGroups?: boolean;
  scoreAnswer?(input: {
    answer: string;
    correct: boolean;
    testCase: Phase74GeneralizationCase;
  }): number;
  stages?: readonly Phase74ExperimentStage[];
  now?(): number;
}

export interface Phase74GeneralizationCheckpoint {
  loadE4(key: string): Promise<Phase74E4CaseResult | null>;
  loadOracle(key: string): Promise<readonly OracleMatrixCaseResult[] | null>;
  loadRetrieval(key: string): Promise<Phase74RetrievalSnapshot | null>;
  saveE4(key: string, value: Phase74E4CaseResult): Promise<void>;
  saveOracle(
    key: string,
    value: readonly OracleMatrixCaseResult[],
  ): Promise<void>;
  saveRetrieval(key: string, value: Phase74RetrievalSnapshot): Promise<void>;
}

function jsonObject(value: EvalRunJsonValue | undefined): EvalRunJsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as EvalRunJsonObject
    : {};
}

function retrievalConfiguration(
  base: EvalRunJsonObject,
  input: {
    channels?: readonly string[];
    evidenceLedgerFormat?: EvidenceLedgerFormat;
    planner?: "off" | "deterministic" | "assisted";
    recallPlanExecution?: boolean;
    representation?: string;
  },
): EvalRunJsonObject {
  const retrieval = jsonObject(base.retrieval);
  return {
    ...base,
    ...(input.representation === undefined
      ? {}
      : { representation: input.representation }),
    ...(input.planner === undefined
      ? {}
      : { planner: { mode: input.planner } }),
    ...(input.evidenceLedgerFormat === undefined
      ? {}
      : { evidenceLedger: { format: input.evidenceLedgerFormat } }),
    retrieval: {
      ...retrieval,
      ...(input.channels === undefined
        ? {}
        : { generalizedFusionChannels: [...input.channels] }),
      ...(input.recallPlanExecution === undefined
        ? {}
        : { recallPlanExecution: input.recallPlanExecution }),
    },
  };
}

function buildConfigurations(base: EvalRunJsonObject): {
  E1: Record<(typeof PHASE74_EXPERIMENT_ARMS.E1)[number], EvalRunJsonObject>;
  E2: Record<(typeof PHASE74_EXPERIMENT_ARMS.E2)[number], EvalRunJsonObject>;
  E3: Record<(typeof PHASE74_EXPERIMENT_ARMS.E3)[number], EvalRunJsonObject>;
  E4: Record<(typeof PHASE74_EXPERIMENT_ARMS.E4)[number], EvalRunJsonObject>;
} {
  const e1 = Object.fromEntries(
    PHASE74_EXPERIMENT_ARMS.E1.map((representation) => [
      representation,
      retrievalConfiguration(base, { representation }),
    ]),
  ) as Record<(typeof PHASE74_EXPERIMENT_ARMS.E1)[number], EvalRunJsonObject>;
  const claimBase = retrievalConfiguration(base, {
    recallPlanExecution: true,
    representation: "atomic-contextual-raw-pointer",
  });
  const e2 = {
    "claim-temporal-off": retrievalConfiguration(claimBase, {
      channels: ["lexical", "dense", "entity"],
    }),
    "claim-temporal-on": retrievalConfiguration(claimBase, {
      channels: ["lexical", "dense", "entity", "temporal", "relation"],
    }),
  };
  const planBase = e2["claim-temporal-on"];
  const e3 = {
    "recall-plan-off": retrievalConfiguration(planBase, {
      planner: "off",
      recallPlanExecution: false,
    }),
    "recall-plan-deterministic": retrievalConfiguration(planBase, {
      planner: "deterministic",
      recallPlanExecution: true,
    }),
    "recall-plan-assisted": retrievalConfiguration(planBase, {
      planner: "assisted",
      recallPlanExecution: true,
    }),
  };
  const ledgerBase = e3["recall-plan-deterministic"];
  const e4 = Object.fromEntries(
    PHASE74_EXPERIMENT_ARMS.E4.map((format) => [
      format,
      retrievalConfiguration(ledgerBase, { evidenceLedgerFormat: format }),
    ]),
  ) as Record<(typeof PHASE74_EXPERIMENT_ARMS.E4)[number], EvalRunJsonObject>;
  return { E1: e1, E2: e2, E3: e3, E4: e4 };
}

function assertIsolatedConfigurations(
  configurations: ReturnType<typeof buildConfigurations>,
): void {
  for (const arm of PHASE74_EXPERIMENT_ARMS.E1.slice(1)) {
    assertPhase74StageIsolation({
      baselineConfiguration: configurations.E1["fact-only"],
      candidateConfiguration: configurations.E1[arm],
      stage: "E1",
    });
  }
  assertPhase74StageIsolation({
    baselineConfiguration: configurations.E2["claim-temporal-off"],
    candidateConfiguration: configurations.E2["claim-temporal-on"],
    stage: "E2",
  });
  for (const arm of PHASE74_EXPERIMENT_ARMS.E3.slice(1)) {
    assertPhase74StageIsolation({
      baselineConfiguration: configurations.E3["recall-plan-off"],
      candidateConfiguration: configurations.E3[arm],
      stage: "E3",
    });
  }
  for (const format of PHASE74_EXPERIMENT_ARMS.E4.slice(1)) {
    assertPhase74StageIsolation({
      baselineConfiguration: configurations.E4.prose,
      candidateConfiguration: configurations.E4[format],
      stage: "E4",
    });
  }
}

export function buildPhase74StageConfigurations(
  base: EvalRunJsonObject,
  stage: Phase74ExperimentStage,
): Readonly<Record<string, EvalRunJsonObject>> {
  const configurations = buildConfigurations(base);
  assertIsolatedConfigurations(configurations);
  return configurations[stage] as Readonly<Record<string, EvalRunJsonObject>>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function buildPhase74LabelFreeCaseBoundary(
  testCase: Phase74GeneralizationCase,
): Phase74LabelFreeCaseBoundary {
  const sessionAliases = new Map<string, string>();
  const sourceAliases = new Map<string, string>();
  const sourceAlias = (sourceId: string) => {
    const existing = sourceAliases.get(sourceId);
    if (existing !== undefined) {
      return existing;
    }
    const sessionId = sourceId.match(/^([^:]+):/u)?.[1] ?? sourceId;
    let sessionAlias = sessionAliases.get(sessionId);
    if (sessionAlias === undefined) {
      sessionAlias = `session-${sessionAliases.size + 1}`;
      sessionAliases.set(sessionId, sessionAlias);
    }
    const alias = `${sessionAlias}:source-${sourceAliases.size + 1}`;
    sourceAliases.set(sourceId, alias);
    return alias;
  };
  const rawEvidence = testCase.rawEvidence.map((item, index) => ({
    content: item.content,
    id: `evidence-${index + 1}`,
    ...(item.observedAt === undefined ? {} : { observedAt: item.observedAt }),
    ...(item.role === undefined ? {} : { role: item.role }),
    sourceIds: item.sourceIds.map(sourceAlias),
  }));
  const memoryGroupId = `group-${sha256(JSON.stringify({
    locale: testCase.locale ?? null,
    rawEvidence,
    referenceTime: testCase.referenceTime ?? null,
  }))}`;
  const derivedCaseKey = `case-${sha256(JSON.stringify({
    locale: testCase.locale ?? null,
    memoryGroupId,
    question: testCase.question,
    referenceTime: testCase.referenceTime ?? null,
  }))}`;
  const caseKey = testCase.labelFreeCaseKey ?? derivedCaseKey;
  const aliasGoldSource = (sourceId: string) =>
    sourceAliases.get(sourceId) ?? `unresolved-source-${sha256(sourceId)}`;
  return {
    caseKey,
    goldEvidenceIds: testCase.goldEvidenceIds.map(aliasGoldSource),
    recallCase: {
      caseId: caseKey,
      ...(testCase.locale === undefined ? {} : { locale: testCase.locale }),
      memoryGroupId,
      question: testCase.question,
      rawEvidence,
      ...(testCase.referenceTime === undefined
        ? {}
        : { referenceTime: testCase.referenceTime }),
    },
    unresolvedGoldEvidenceIds: (testCase.unresolvedGoldEvidenceIds ?? []).map(
      aliasGoldSource,
    ),
  };
}

function oracleCase(
  testCase: Phase74GeneralizationCase,
  snapshot: Phase74RetrievalSnapshot,
  boundary = buildPhase74LabelFreeCaseBoundary(testCase),
) {
  return {
    caseId: boundary.caseKey,
    expectedAnswer: testCase.expectedAnswer,
    goldEvidenceIds: boundary.goldEvidenceIds,
    protocolMetadata: testCase.protocolMetadata,
    question: testCase.question,
    rawEvidence: boundary.recallCase.rawEvidence,
    retrievedMemories: snapshot.retrievedMemories,
    storedMemories: snapshot.storedMemories,
    unresolvedGoldEvidenceIds: boundary.unresolvedGoldEvidenceIds,
  };
}

function checkpointKey(
  identityHash: string,
  ...parts: readonly string[]
): string {
  return JSON.stringify([identityHash, ...parts]);
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  map: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, values.length) },
    async () => {
      while (nextIndex < values.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await map(values[index]!);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

interface IndexedPhase74Case {
  index: number;
  testCase: Phase74GeneralizationCase;
}

function scheduleCaseGroups(
  cases: readonly Phase74GeneralizationCase[],
  serializeMemoryGroups: boolean,
): IndexedPhase74Case[][] {
  const groupedCases = new Map<string, IndexedPhase74Case[]>();
  for (const [index, testCase] of cases.entries()) {
    const groupId = testCase.memoryGroupId ?? testCase.caseId;
    const group = groupedCases.get(groupId);
    if (group === undefined) {
      groupedCases.set(groupId, [{ index, testCase }]);
    } else {
      group.push({ index, testCase });
    }
  }
  const groups = [...groupedCases.values()];
  if (serializeMemoryGroups) {
    return groups;
  }
  const scheduled: IndexedPhase74Case[][] = [];
  const maximumGroupSize = Math.max(0, ...groups.map((group) => group.length));
  for (let groupIndex = 0; groupIndex < maximumGroupSize; groupIndex += 1) {
    for (const group of groups) {
      const scheduledCase = group[groupIndex];
      if (scheduledCase !== undefined) {
        scheduled.push([scheduledCase]);
      }
    }
  }
  return scheduled;
}

async function mapScheduledCases<R>(
  groups: readonly (readonly IndexedPhase74Case[])[],
  concurrency: number,
  map: (testCase: Phase74GeneralizationCase) => Promise<R>,
): Promise<R[]> {
  const groupedResults = await mapWithConcurrency(
    groups,
    concurrency,
    async (group) => {
      const results: Array<{ index: number; result: R }> = [];
      for (const { index, testCase } of group) {
        results.push({ index, result: await map(testCase) });
      }
      return results;
    },
  );
  return groupedResults
    .flat()
    .sort((left, right) => left.index - right.index)
    .map(({ result }) => result);
}

async function assessAnswer(input: {
  answer: string;
  purpose: string;
  run: RunPhase74GeneralizationInput;
  testCase: Phase74GeneralizationCase;
}): Promise<Phase74AnswerAssessment> {
  const assessment = input.run.assessAnswer === undefined
    ? await (async () => {
        const judgment = await input.run.judge({
          answer: input.answer,
          caseId: input.testCase.caseId,
          expectedAnswer: input.testCase.expectedAnswer,
          purpose: input.purpose,
          question: input.testCase.question,
        });
        return {
          correct: judgment.correct,
          score: input.run.scoreAnswer?.({
            answer: input.answer,
            correct: judgment.correct,
            testCase: input.testCase,
          }) ?? Number(judgment.correct),
        };
      })()
    : await input.run.assessAnswer({
        answer: input.answer,
        purpose: input.purpose,
        testCase: input.testCase,
      });
  if (!Number.isFinite(assessment.score) || assessment.score < 0 || assessment.score > 1) {
    throw new Error(
      `Phase 74 answer score must be between 0 and 1 for ${input.testCase.caseId}/${input.purpose}.`,
    );
  }
  return assessment;
}

export async function runPhase74Generalization(
  input: RunPhase74GeneralizationInput,
): Promise<Phase74GeneralizationReport> {
  const identity = await input.persistIdentity(input.identity) ?? input.identity;
  const identityHash = hashEvalRunIdentity(identity);
  const configurations = buildConfigurations(identity.configuration);
  assertIsolatedConfigurations(configurations);
  const executions: Phase74GeneralizationExecutionResult[] = [];
  const deterministicSnapshots = new Map<string, Phase74RetrievalSnapshot>();
  const stages = new Set(
    input.stages ?? (["E1", "E2", "E3", "E4"] as const),
  );
  const now = input.now ?? (() => performance.now());
  const caseConcurrency = input.caseConcurrency ?? 1;
  if (!Number.isSafeInteger(caseConcurrency) || caseConcurrency <= 0) {
    throw new Error("Phase 74 caseConcurrency must be a positive integer.");
  }
  const scheduledCaseGroups = scheduleCaseGroups(
    input.cases,
    input.serializeMemoryGroups ?? true,
  );
  const groupedResults = await mapWithConcurrency(
    scheduledCaseGroups,
    caseConcurrency,
    async (group) => {
      const results: Array<{
        executions: Phase74GeneralizationExecutionResult[];
        index: number;
        snapshots: Phase74RetrievalSnapshot[];
      }> = [];
      for (const { index, testCase } of group) {
        const assessmentsByInput = new Map<string, {
          answer: string;
          assessment: Phase74AnswerAssessment;
          sourceArm: RetrievalArm;
          sourceSnapshotId: string;
        }>();
        const caseExecutions: Phase74GeneralizationExecutionResult[] = [];
        const caseSnapshots: Phase74RetrievalSnapshot[] = [];
        const labelFreeBoundary = buildPhase74LabelFreeCaseBoundary(testCase);
        for (const stage of ["E1", "E2", "E3"] as const) {
          if (!stages.has(stage)) {
            continue;
          }
          const arms = PHASE74_EXPERIMENT_ARMS[stage] as readonly RetrievalArm[];
          const stageConfigurations = configurations[stage] as Record<
            RetrievalArm,
            EvalRunJsonObject
          >;
          for (const arm of arms) {
            const configuration = stageConfigurations[arm];
            const clusterId = testCase.memoryGroupId ?? testCase.caseId;
            const productStartedAt = now();
            try {
              const key = checkpointKey(
                identityHash,
                "retrieval",
                testCase.caseId,
                stage,
                arm,
              );
              const cached = await input.checkpoint?.loadRetrieval(key) ?? null;
              const retrievedSnapshot = cached ?? await input.executeRetrieval({
                arm,
                configuration,
                stage,
                testCase: labelFreeBoundary.recallCase,
              });
              const recallCompletedAt = now();
              let snapshot = retrievedSnapshot;
              const budgetedContext = truncateRenderedContext({
                content: renderOracleMatrixContext(snapshot.retrievedMemories),
                contextTokenBudget:
                  input.contextTokenBudget ?? PHASE74_CONTEXT_TOKEN_BUDGET,
                countRenderedTokens: input.countRenderedTokens,
              });
              const evaluationInputSha256 = sha256(JSON.stringify({
                context: budgetedContext.content,
                question: testCase.question,
                stage,
              }));
              if (snapshot.evaluation === undefined) {
                if (cached !== null) {
                  throw new Error(
                    `Phase 74 retrieval checkpoint lacks end-to-end evaluation for ${testCase.caseId}/${stage}/${arm}.`,
                  );
                }
                const branch = phase74ComparisonBranch(stage, arm);
                const answerStartedAt = now();
                const observedAnswer = await input.genericReader({
                  caseId: labelFreeBoundary.caseKey,
                  context: budgetedContext.content,
                  purpose: `final:${branch}:${stage}:${arm}`,
                  question: testCase.question,
                });
                const answerCompletedAt = now();
                const observedAssessment = await assessAnswer({
                  answer: observedAnswer,
                  purpose: `final:${branch}:${stage}:${arm}`,
                  run: input,
                  testCase,
                });
                const shared = assessmentsByInput.get(evaluationInputSha256);
                const answer = shared?.answer ?? observedAnswer;
                const assessment = shared?.assessment ?? observedAssessment;
                const sourceArm = shared?.sourceArm ?? arm;
                const sourceSnapshotId = shared?.sourceSnapshotId ?? snapshot.snapshotId;
                if (!shared) {
                  assessmentsByInput.set(evaluationInputSha256, {
                    answer,
                    assessment,
                    sourceArm,
                    sourceSnapshotId,
                  });
                }
                snapshot = {
                  ...snapshot,
                  evaluation: {
                    answer,
                    answerLatencyMs: Math.max(
                      0,
                      answerCompletedAt - answerStartedAt,
                    ),
                    attribution: {
                      inputSha256: evaluationInputSha256,
                      observedAnswer,
                      observedCorrect: observedAssessment.correct,
                      observedScore: observedAssessment.score,
                      reused: shared !== undefined,
                      sourceArm,
                      sourceSnapshotId,
                    },
                    contextTokens: budgetedContext.renderedContextTokens,
                    contextTokensBeforeTruncation:
                      budgetedContext.renderedContextTokensBeforeTruncation,
                    contextTruncated: budgetedContext.contextTruncated,
                    correct: assessment.correct,
                    productLatencyMs:
                      snapshot.recallMetadata?.queryPathLatencyMs === undefined
                        ? Math.max(0, answerCompletedAt - productStartedAt)
                        : Math.max(
                            0,
                            snapshot.recallMetadata.queryPathLatencyMs +
                              answerCompletedAt - recallCompletedAt,
                          ),
                    recallLatencyMs: snapshot.recallMetadata?.latencyMs ??
                      Math.max(0, recallCompletedAt - productStartedAt),
                    score: assessment.score,
                  },
                };
              } else if (snapshot.evaluation.attribution === undefined) {
                throw new Error(
                  `Phase 74 retrieval checkpoint lacks evaluation attribution for ${testCase.caseId}/${stage}/${arm}.`,
                );
              } else {
                const attribution = snapshot.evaluation.attribution;
                if (attribution.inputSha256 !== evaluationInputSha256) {
                  throw new Error(
                    `Phase 74 retrieval checkpoint evaluation input drifted for ${testCase.caseId}/${stage}/${arm}.`,
                  );
                }
                const shared = assessmentsByInput.get(evaluationInputSha256);
                if (shared) {
                  if (
                    snapshot.evaluation.answer !== shared.answer ||
                    snapshot.evaluation.correct !== shared.assessment.correct ||
                    snapshot.evaluation.score !== shared.assessment.score
                  ) {
                    throw new Error(
                      `Phase 74 retrieval checkpoint disagrees for identical reader input ${testCase.caseId}/${stage}/${arm}.`,
                    );
                  }
                } else {
                  assessmentsByInput.set(evaluationInputSha256, {
                    answer: snapshot.evaluation.answer,
                    assessment: {
                      correct: snapshot.evaluation.correct,
                      score: snapshot.evaluation.score,
                    },
                    sourceArm: arm,
                    sourceSnapshotId: snapshot.snapshotId,
                  });
                }
              }
              if (cached === null) {
                await input.checkpoint?.saveRetrieval(key, snapshot);
              }
              caseSnapshots.push(snapshot);
              const metrics = measureOracleMatrixCoverage(
                oracleCase(testCase, snapshot, labelFreeBoundary),
              );
              const evaluation = snapshot.evaluation;
              if (evaluation === undefined) {
                throw new Error(
                  `Phase 74 retrieval evaluation was not committed for ${testCase.caseId}/${stage}/${arm}.`,
                );
              }
              caseExecutions.push({
                answer: evaluation.answer,
                answerLatencyMs: evaluation.answerLatencyMs,
                arm,
                caseId: testCase.caseId,
                clusterId,
                configuration,
                contextTokens: evaluation.contextTokens,
                contextTokensBeforeTruncation:
                  evaluation.contextTokensBeforeTruncation,
                contextTruncated: evaluation.contextTruncated,
                correct: evaluation.correct,
                evaluationAttribution: evaluation.attribution,
                metrics,
                productLatencyMs: evaluation.productLatencyMs,
                recallLatencyMs: evaluation.recallLatencyMs,
                score: evaluation.score,
                snapshotId: snapshot.snapshotId,
                stage,
              });
              if (stage === "E3" && arm === "recall-plan-deterministic") {
                deterministicSnapshots.set(testCase.caseId, snapshot);
              }
            } catch (error) {
              caseExecutions.push({
                arm,
                caseId: testCase.caseId,
                clusterId,
                configuration,
                executionError: errorMessage(error),
                productLatencyMs: Math.max(0, now() - productStartedAt),
                stage,
              });
            }
          }
        }
        results.push({
          executions: caseExecutions,
          index,
          snapshots: caseSnapshots,
        });
      }
      return results;
    },
  );
  const orderedResults = groupedResults.flat().sort(
    (left, right) => left.index - right.index,
  );
  for (const result of orderedResults) {
    executions.push(...result.executions);
    result.snapshots.forEach((snapshot) => input.onRetrievalSnapshot?.(snapshot));
  }

  const e4Cases: Phase74E4CaseResult[] = [];
  if (stages.has("E4")) {
    const results = await mapScheduledCases(
      scheduledCaseGroups,
      caseConcurrency,
      async (testCase) => {
        const caseResults: Phase74E4CaseResult[] = [];
        const labelFreeBoundary = buildPhase74LabelFreeCaseBoundary(testCase);
        if (!deterministicSnapshots.has(testCase.caseId) && input.checkpoint) {
          const key = checkpointKey(
            identityHash,
            "retrieval",
            testCase.caseId,
            "E3",
            "recall-plan-deterministic",
          );
          const snapshot = await input.checkpoint.loadRetrieval(key);
          if (snapshot !== null) {
            deterministicSnapshots.set(testCase.caseId, snapshot);
            input.onRetrievalSnapshot?.(snapshot);
          }
        }
        const snapshot = deterministicSnapshots.get(testCase.caseId);
        if (!snapshot) {
          throw new Error(
            `Phase 74 E4 requires a committed deterministic E3 snapshot for ${testCase.caseId}.`,
          );
        }
        for (const format of PHASE74_EXPERIMENT_ARMS.E4) {
          const key = checkpointKey(
            identityHash,
            "e4",
            testCase.caseId,
            snapshot.snapshotId,
            "source-ledger-v1",
            format,
          );
          const cached = await input.checkpoint?.loadE4(key) ?? null;
          if (cached !== null) {
            caseResults.push(cached);
            continue;
          }
          let context = "";
          let contextTokensBeforeTruncation = 0;
          let contextTruncated = false;
          try {
            const renderedContext = await input.renderEvidenceLedger({
              format,
              locale: testCase.locale,
              snapshot,
            });
            const budgetedContext = truncateRenderedContext({
              content: renderedContext,
              contextTokenBudget:
                input.contextTokenBudget ?? PHASE74_CONTEXT_TOKEN_BUDGET,
              countRenderedTokens: input.countRenderedTokens,
            });
            context = budgetedContext.content;
            contextTokensBeforeTruncation =
              budgetedContext.renderedContextTokensBeforeTruncation;
            contextTruncated = budgetedContext.contextTruncated;
            const answer = await input.genericReader({
              caseId: labelFreeBoundary.caseKey,
              context,
              purpose: `e4:${format}`,
              question: testCase.question,
            });
            const assessment = await assessAnswer({
              answer,
              purpose: `e4:${format}`,
              run: input,
              testCase,
            });
            const result: Phase74E4CaseResult = {
              answer,
              caseId: testCase.caseId,
              clusterId: testCase.memoryGroupId ?? testCase.caseId,
              contextTokens: input.countRenderedTokens(context),
              contextTokensBeforeTruncation,
              contextTruncated,
              correct: assessment.correct,
              format,
              renderedLedgerSha256: sha256(context),
              score: assessment.score,
              sourceSnapshotId: snapshot.snapshotId,
            };
            caseResults.push(result);
            await input.checkpoint?.saveE4(key, result);
          } catch (error) {
            caseResults.push({
              answer: null,
              caseId: testCase.caseId,
              clusterId: testCase.memoryGroupId ?? testCase.caseId,
              contextTokens: input.countRenderedTokens(context),
              contextTokensBeforeTruncation,
              contextTruncated,
              correct: false,
              executionError: errorMessage(error),
              format,
              renderedLedgerSha256: sha256(context),
              score: 0,
              sourceSnapshotId: snapshot.snapshotId,
            });
          }
        }
        return caseResults;
      },
    );
    e4Cases.push(...results.flat());
  }

  const formatResults: Phase74E4FormatResult[] =
    PHASE74_EXPERIMENT_ARMS.E4.map((format) => {
      const cases = e4Cases.filter((result) => result.format === format);
      return {
        averageTokens: cases.length === 0
          ? null
          : cases.reduce((total, result) => total + result.contextTokens, 0) /
            cases.length,
        format,
        macroScore: cases.length === 0
          ? 0
          : cases.reduce((total, { score }) => total + score, 0) / cases.length,
        protectionDelta: input.e4ProtectionDeltas?.[format] ?? null,
      };
    });
  const hasCompleteProtectionEvidence =
    input.cases.length > 0 &&
    formatResults.every(({ averageTokens, protectionDelta }) =>
      averageTokens !== null &&
      protectionDelta !== null &&
      Number.isFinite(protectionDelta)
    );
  const hasEligibleFormat = formatResults.some(({ protectionDelta }) =>
    protectionDelta !== null && protectionDelta >= -0.01
  );
  const selectedFormat = hasCompleteProtectionEvidence && hasEligibleFormat
    ? selectEvidenceLedgerFormat(
        formatResults.map((result) => ({
          ...result,
          averageTokens: result.averageTokens!,
          protectionDelta: result.protectionDelta!,
        })),
      )
    : "not_evaluable";

  const oracle: OracleMatrixCaseResult[] = [];
  if (input.includeOracle !== false) {
    const results = await mapScheduledCases(
      scheduledCaseGroups,
      caseConcurrency,
      async (testCase) => {
        const labelFreeBoundary = buildPhase74LabelFreeCaseBoundary(testCase);
        const snapshot = deterministicSnapshots.get(testCase.caseId);
        if (!snapshot) {
          return [];
        }
        const key = checkpointKey(
          identityHash,
          "oracle",
          testCase.caseId,
          snapshot.snapshotId,
        );
        const cached = await input.checkpoint?.loadOracle(key) ?? null;
        if (cached !== null) {
          return [...cached];
        }
        const caseResults = await runOracleMatrixCase({
          contextTokenBudget:
            input.contextTokenBudget ?? PHASE74_CONTEXT_TOKEN_BUDGET,
          countRenderedTokens: input.countRenderedTokens,
          genericReader: input.genericReader,
          judge: input.judge,
          protocolReader: input.protocolReader,
          testCase: oracleCase(testCase, snapshot, labelFreeBoundary),
        });
        if (
          caseResults.every(({ executionError }) =>
            executionError === undefined
          )
        ) {
          await input.checkpoint?.saveOracle(key, caseResults);
        }
        return caseResults;
      },
    );
    oracle.push(...results.flat());
  }

  const renderedContextMaxTokens = Math.max(
    0,
    ...executions.map(({ contextTokens }) => contextTokens ?? 0),
    ...e4Cases.map(({ contextTokens }) => contextTokens),
    ...oracle.map(({ renderedContextTokens }) => renderedContextTokens),
  );
  const executionFailures =
    executions.filter(({ executionError }) => executionError).length +
    e4Cases.filter(({ executionError }) => executionError).length +
    oracle.filter(({ executionError }) => executionError).length;

  return {
    e4: { cases: e4Cases, formatResults, selectedFormat },
    executions,
    experimentIdentityHash: hashEvalExperimentIdentity(identity),
    identity,
    identityHash,
    oracle,
    reason:
      "Smoke and single-run diagnostics cannot authorize Phase 74 product promotion.",
    schemaVersion: 1,
    status: "not_evaluable",
    summary: {
      caseCount: input.cases.length,
      executionFailures,
      renderedContextMaxTokens,
    },
  };
}
