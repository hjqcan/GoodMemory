import type {
  Phase74ProtectionIdentityDescriptor,
  Phase74ProtectionReplicate,
} from "../src/eval/phase74ProtectionEvidence";
import {
  hashPhase74ProtectionValue,
  runPhase74ProtectionSuiteCases,
} from "../src/eval/phase74ProtectionRun";
import type {
  Phase74ProtectionBranch,
  Phase74ProtectionSuiteRunResult,
} from "../src/eval/phase74ProtectionRun";
import {
  assertPhase74HaluMemConfiguration,
  buildPhase74HaluMemE4RunIdentity,
  buildPhase74HaluMemPrivacyPopulation,
  buildPhase74HaluMemPrivacyRunIdentity,
  buildPhase74HaluMemQaJudgePrompt,
  buildPhase74HaluMemQuestionPopulation,
  buildPhase74HaluMemReaderPrompt,
  buildPhase74HaluMemUpdatePopulation,
  buildPhase74HaluMemUpdateRunIdentity,
  countPhase74HaluMemContextTokens,
  PHASE74_HALUMEM_CONTEXT_TOKEN_BUDGET,
  PHASE74_HALUMEM_E4_METRIC,
  PHASE74_HALUMEM_E4_SUITE,
  PHASE74_HALUMEM_EVIDENCE_LEDGER_FORMATS,
  PHASE74_HALUMEM_PRIVACY_SUITE,
  PHASE74_HALUMEM_QA_JUDGE_SYSTEM_PROMPT,
  PHASE74_HALUMEM_READER_SYSTEM_PROMPT,
  PHASE74_HALUMEM_UPDATE_SUITE,
  phase74HaluMemPrivacyPopulationId,
  phase74HaluMemQuestionPopulationId,
  phase74HaluMemUpdatePopulationId,
  renderPhase74HaluMemLegacyContext,
  scorePhase74HaluMemQaDecision,
  scorePhase74HaluMemUpdateDecision,
  verifyPhase74HaluMemE4ProtectionArtifact,
  verifyPhase74HaluMemPrivacyProtectionArtifact,
  verifyPhase74HaluMemUpdateProtectionArtifact,
} from "../src/eval/phase74HaluMemProtectionVerifier";
import type {
  Phase74HaluMemMemoryPoint,
  Phase74HaluMemProtectionConfiguration,
  Phase74HaluMemQuestion,
  Phase74HaluMemUser,
} from "../src/eval/phase74HaluMemProtectionVerifier";
import { renderEvidenceLedger } from "../src/eval/evidenceLedgerFormats";
import type { EvidenceLedgerFormat } from "../src/eval/evidenceLedgerFormats";
import type { EvidenceLedgerEntry } from "../src/recall/evidenceLedger";

export {
  PHASE74_HALUMEM_E4_METRIC,
  PHASE74_HALUMEM_E4_SUITE,
  PHASE74_HALUMEM_PRIVACY_SUITE,
  PHASE74_HALUMEM_UPDATE_SUITE,
  verifyPhase74HaluMemE4ProtectionArtifact,
  verifyPhase74HaluMemPrivacyProtectionArtifact,
  verifyPhase74HaluMemUpdateProtectionArtifact,
};
export type {
  Phase74HaluMemProtectionConfiguration,
  Phase74HaluMemUser,
};

export interface Phase74HaluMemE4EvidenceSnapshot {
  evidenceLedger: EvidenceLedgerEntry[];
  snapshotId: string;
}

export interface Phase74HaluMemUpdateEvidenceSnapshot {
  memories: string[];
  snapshotId: string;
  sourceMessageIds: string[];
}

export interface Phase74HaluMemPrivacySnapshot {
  foreignScopeSourceMessageIds: string[];
  ownerScopeSourceMessageIds: string[];
  snapshotId: string;
}

export interface Phase74HaluMemE4Dependencies {
  answer(input: {
    branch: Phase74ProtectionBranch;
    context: string;
    format: EvidenceLedgerFormat | "legacy";
    prompt: string;
    question: string;
    system: string;
  }): Promise<string>;
  judgeQa(input: {
    answer: string;
    branch: Phase74ProtectionBranch;
    expectedAnswer: string;
    format: EvidenceLedgerFormat | "legacy";
    prompt: string;
    question: string;
    system: string;
  }): Promise<string>;
  retrieveEvidence(input: {
    question: Phase74HaluMemQuestion;
    questionCaseId: string;
    sessionIndex: number;
    user: Phase74HaluMemUser;
  }): Promise<Phase74HaluMemE4EvidenceSnapshot>;
}

export interface Phase74HaluMemUpdateDependencies {
  evaluateUpdate?(input: {
    branch: Phase74ProtectionBranch;
    evaluator: Phase74ProtectionIdentityDescriptor;
    expectedUpdate: string;
    memoryPoint: Phase74HaluMemMemoryPoint;
    originalMemories: readonly string[];
    retrievedMemories: readonly string[];
    updateCaseId: string;
    user: Phase74HaluMemUser;
  }): Promise<string>;
  retrieveUpdateEvidence(input: {
    branch: Phase74ProtectionBranch;
    memoryPoint: Phase74HaluMemMemoryPoint;
    sessionIndex: number;
    updateCaseId: string;
    user: Phase74HaluMemUser;
  }): Promise<Phase74HaluMemUpdateEvidenceSnapshot>;
}

export interface Phase74HaluMemPrivacyDependencies {
  recallScopes(input: {
    branch: Phase74ProtectionBranch;
    expectedOwnerSourceMessageIds: readonly string[];
    ownerUserUuid: string;
    privacyCaseId: string;
    question: string;
    targetUserUuid: string;
  }): Promise<Phase74HaluMemPrivacySnapshot>;
}

interface CommonRunInput {
  artifactPath: string;
  configuration: Phase74HaluMemProtectionConfiguration;
  dataset: Phase74ProtectionIdentityDescriptor;
  rawArtifactPath: string;
  replicate: Phase74ProtectionReplicate;
  runId: string;
  source: Phase74ProtectionIdentityDescriptor;
  users: readonly Phase74HaluMemUser[];
}

function assertFormatOnlyConfiguration(
  configuration: Phase74HaluMemProtectionConfiguration,
): void {
  assertPhase74HaluMemConfiguration(configuration);
  if (
    hashPhase74ProtectionValue(configuration.baselinePipeline) !==
      hashPhase74ProtectionValue(configuration.candidatePipeline)
  ) {
    throw new Error(
      "Phase 74 HaluMem E4 requires format-only isolation over one frozen retrieval pipeline.",
    );
  }
}

function assertSnapshotId(value: string, label: string): void {
  if (value === "" || value.trim() !== value) {
    throw new Error(`Phase 74 HaluMem ${label} snapshot ID is invalid.`);
  }
}

function assertStrings(values: readonly string[], label: string): void {
  if (values.some((value) => typeof value !== "string")) {
    throw new Error(`Phase 74 HaluMem ${label} must contain only strings.`);
  }
}

function contextTokens(content: string, label: string): number {
  const tokens = countPhase74HaluMemContextTokens(content);
  if (tokens > PHASE74_HALUMEM_CONTEXT_TOKEN_BUDGET) {
    throw new Error(`Phase 74 HaluMem ${label} exceeds the context budget.`);
  }
  return tokens;
}

function qaScores(
  values: Record<EvidenceLedgerFormat, number>,
) {
  const e4 = {} as Record<
    EvidenceLedgerFormat,
    Record<string, number>
  >;
  for (const format of PHASE74_HALUMEM_EVIDENCE_LEDGER_FORMATS) {
    e4[format] = { [PHASE74_HALUMEM_E4_METRIC]: values[format] };
  }
  return {
    e4,
  };
}

function repeatedQaScores(value: number) {
  return qaScores(Object.fromEntries(
    PHASE74_HALUMEM_EVIDENCE_LEDGER_FORMATS.map((format) => [format, value]),
  ) as Record<EvidenceLedgerFormat, number>);
}

async function answerAndJudge(input: {
  branch: Phase74ProtectionBranch;
  context: string;
  dependencies: Phase74HaluMemE4Dependencies;
  format: EvidenceLedgerFormat | "legacy";
  question: Phase74HaluMemQuestion;
}): Promise<{ answer: string; judgeDecision: string; score: number }> {
  const answer = await input.dependencies.answer({
    branch: input.branch,
    context: input.context,
    format: input.format,
    prompt: buildPhase74HaluMemReaderPrompt({
      context: input.context,
      question: input.question.question,
    }),
    question: input.question.question,
    system: PHASE74_HALUMEM_READER_SYSTEM_PROMPT,
  });
  if (answer.trim() === "") {
    throw new Error("Phase 74 HaluMem answer provider returned an empty answer.");
  }
  const judgeDecision = await input.dependencies.judgeQa({
    answer,
    branch: input.branch,
    expectedAnswer: input.question.answer,
    format: input.format,
    prompt: buildPhase74HaluMemQaJudgePrompt({
      answer,
      expectedAnswer: input.question.answer,
      question: input.question.question,
    }),
    question: input.question.question,
    system: PHASE74_HALUMEM_QA_JUDGE_SYSTEM_PROMPT,
  });
  return {
    answer,
    judgeDecision,
    score: scorePhase74HaluMemQaDecision(judgeDecision),
  };
}

export async function runPhase74HaluMemE4Protection(
  input: CommonRunInput,
  dependencies: Phase74HaluMemE4Dependencies,
): Promise<Phase74ProtectionSuiteRunResult> {
  assertFormatOnlyConfiguration(input.configuration);
  const population = buildPhase74HaluMemQuestionPopulation(input.users);
  const snapshots = new Map<string, Phase74HaluMemE4EvidenceSnapshot>();
  for (const [caseId, item] of population.items) {
    const snapshot = await dependencies.retrieveEvidence({
      question: item.question,
      questionCaseId: item.questionCaseId,
      sessionIndex: item.input.sessionIndex,
      user: item.user,
    });
    assertSnapshotId(snapshot.snapshotId, caseId);
    const contexts = [
      renderPhase74HaluMemLegacyContext(snapshot.evidenceLedger),
      ...PHASE74_HALUMEM_EVIDENCE_LEDGER_FORMATS.map((format) =>
        renderEvidenceLedger(snapshot.evidenceLedger, format)
      ),
    ];
    for (const [index, context] of contexts.entries()) {
      contextTokens(context, `${caseId} context ${index}`);
    }
    snapshots.set(caseId, structuredClone(snapshot));
  }

  return runPhase74ProtectionSuiteCases({
    artifactPath: input.artifactPath,
    cases: population.cases,
    evaluate: async ({ branch, caseId }) => {
      const item = population.items.get(caseId)!;
      const snapshot = snapshots.get(caseId)!;
      if (branch === "baseline") {
        const context = renderPhase74HaluMemLegacyContext(
          snapshot.evidenceLedger,
        );
        const result = await answerAndJudge({
          branch,
          context,
          dependencies,
          format: "legacy",
          question: item.question,
        });
        return {
          rawOutput: {
            answer: result.answer,
            configuration: input.configuration,
            context,
            contextTokens: contextTokens(context, `${caseId}.baseline`),
            evidenceLedger: snapshot.evidenceLedger,
            judgeDecision: result.judgeDecision,
            mode: "legacy-shared",
            snapshotId: snapshot.snapshotId,
          },
          scores: repeatedQaScores(result.score),
        };
      }
      const formatEntries = await Promise.all(
        PHASE74_HALUMEM_EVIDENCE_LEDGER_FORMATS.map(async (format) => {
          const context = renderEvidenceLedger(snapshot.evidenceLedger, format);
          const result = await answerAndJudge({
            branch,
            context,
            dependencies,
            format,
            question: item.question,
          });
          return [format, {
            answer: result.answer,
            context,
            contextTokens: contextTokens(context, `${caseId}.${format}`),
            judgeDecision: result.judgeDecision,
            score: result.score,
          }] as const;
        }),
      );
      const formats = Object.fromEntries(formatEntries.map(([format, result]) => [
        format,
        {
          answer: result.answer,
          context: result.context,
          contextTokens: result.contextTokens,
          judgeDecision: result.judgeDecision,
        },
      ]));
      const values = Object.fromEntries(formatEntries.map(([format, result]) =>
        [format, result.score]
      )) as Record<EvidenceLedgerFormat, number>;
      return {
        rawOutput: {
          configuration: input.configuration,
          evidenceLedger: snapshot.evidenceLedger,
          formats,
          mode: "ledger-formats",
          snapshotId: snapshot.snapshotId,
        },
        scores: qaScores(values),
      };
    },
    identity: buildPhase74HaluMemE4RunIdentity({
      configuration: input.configuration,
      dataset: input.dataset,
      populationId: phase74HaluMemQuestionPopulationId(
        input.dataset.id,
        input.users,
      ),
      source: input.source,
    }),
    rawArtifactPath: input.rawArtifactPath,
    replicate: input.replicate,
    runId: input.runId,
    suite: PHASE74_HALUMEM_E4_SUITE,
  });
}

export async function runPhase74HaluMemUpdateProtection(
  input: CommonRunInput,
  dependencies: Phase74HaluMemUpdateDependencies,
): Promise<Phase74ProtectionSuiteRunResult> {
  assertPhase74HaluMemConfiguration(input.configuration);
  if (!input.configuration.updateEvaluator || !dependencies.evaluateUpdate) {
    throw new Error(
      "Phase 74 HaluMem update protection requires a raw per-item upstream update decision.",
    );
  }
  const updateEvaluator = input.configuration.updateEvaluator;
  const population = buildPhase74HaluMemUpdatePopulation(input.users);
  return runPhase74ProtectionSuiteCases({
    artifactPath: input.artifactPath,
    cases: population.cases,
    evaluate: async ({ branch, caseId }) => {
      const item = population.items.get(caseId)!;
      const snapshot = await dependencies.retrieveUpdateEvidence({
        branch,
        memoryPoint: item.memoryPoint,
        sessionIndex: item.input.sessionIndex,
        updateCaseId: item.updateCaseId,
        user: item.user,
      });
      assertSnapshotId(snapshot.snapshotId, caseId);
      assertStrings(snapshot.memories, `${caseId}.memories`);
      assertStrings(snapshot.sourceMessageIds, `${caseId}.sourceMessageIds`);
      const context = snapshot.memories.join("\n");
      const decision = await dependencies.evaluateUpdate!({
        branch,
        evaluator: updateEvaluator,
        expectedUpdate: item.memoryPoint.memory_content,
        memoryPoint: item.memoryPoint,
        originalMemories: item.memoryPoint.original_memories,
        retrievedMemories: snapshot.memories,
        updateCaseId: item.updateCaseId,
        user: item.user,
      });
      const score = scorePhase74HaluMemUpdateDecision(decision);
      return {
        rawOutput: {
          configuration: input.configuration,
          context,
          contextTokens: contextTokens(context, `${caseId}.${branch}`),
          decision,
          memories: snapshot.memories,
          snapshotId: snapshot.snapshotId,
          sourceMessageIds: snapshot.sourceMessageIds,
        },
        scores: { safety: { updateCorrectness: score } },
      };
    },
    identity: buildPhase74HaluMemUpdateRunIdentity({
      configuration: input.configuration,
      dataset: input.dataset,
      populationId: phase74HaluMemUpdatePopulationId(
        input.dataset.id,
        input.users,
      ),
      source: input.source,
    }),
    rawArtifactPath: input.rawArtifactPath,
    replicate: input.replicate,
    runId: input.runId,
    suite: PHASE74_HALUMEM_UPDATE_SUITE,
  });
}

function privacyScore(input: {
  expectedOwnerSourceMessageIds: readonly string[];
  snapshot: Phase74HaluMemPrivacySnapshot;
}): number {
  const expected = new Set(input.expectedOwnerSourceMessageIds);
  const positiveControl = input.snapshot.ownerScopeSourceMessageIds.some((id) =>
    expected.has(id)
  );
  const leaked = input.snapshot.foreignScopeSourceMessageIds.some((id) =>
    expected.has(id)
  );
  return positiveControl && !leaked ? 1 : 0;
}

export async function runPhase74HaluMemPrivacyProtection(
  input: CommonRunInput,
  dependencies: Phase74HaluMemPrivacyDependencies,
): Promise<Phase74ProtectionSuiteRunResult> {
  assertPhase74HaluMemConfiguration(input.configuration);
  const population = buildPhase74HaluMemPrivacyPopulation(input.users);
  return runPhase74ProtectionSuiteCases({
    artifactPath: input.artifactPath,
    cases: population.cases,
    evaluate: async ({ branch, caseId }) => {
      const item = population.items.get(caseId)!;
      const snapshot = await dependencies.recallScopes({
        branch,
        expectedOwnerSourceMessageIds: item.expectedOwnerSourceMessageIds,
        ownerUserUuid: item.user.uuid,
        privacyCaseId: item.privacyCaseId,
        question: item.question.question,
        targetUserUuid: item.targetUser.uuid,
      });
      assertSnapshotId(snapshot.snapshotId, caseId);
      assertStrings(
        snapshot.foreignScopeSourceMessageIds,
        `${caseId}.foreignScopeSourceMessageIds`,
      );
      assertStrings(
        snapshot.ownerScopeSourceMessageIds,
        `${caseId}.ownerScopeSourceMessageIds`,
      );
      return {
        rawOutput: {
          configuration: input.configuration,
          ...snapshot,
        },
        scores: {
          safety: {
            privacyPassRate: privacyScore({
              expectedOwnerSourceMessageIds: item.expectedOwnerSourceMessageIds,
              snapshot,
            }),
          },
        },
      };
    },
    identity: buildPhase74HaluMemPrivacyRunIdentity({
      configuration: input.configuration,
      dataset: input.dataset,
      populationId: phase74HaluMemPrivacyPopulationId(
        input.dataset.id,
        input.users,
      ),
      source: input.source,
    }),
    rawArtifactPath: input.rawArtifactPath,
    replicate: input.replicate,
    runId: input.runId,
    suite: PHASE74_HALUMEM_PRIVACY_SUITE,
  });
}
