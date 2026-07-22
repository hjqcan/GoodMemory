import { readFile } from "node:fs/promises";

import {
  scoreMemoryAgentBenchRetrieval,
} from "./memoryAgentBench";
import type {
  MemoryAgentBenchCase,
  MemoryAgentBenchQuestion,
} from "./memoryAgentBench";
import type {
  Phase74ProtectionIdentityDescriptor,
} from "./phase74ProtectionEvidence";
import { hashPhase74ProtectionCaseIds } from "./phase74ProtectionEvidence";
import {
  hashPhase74ProtectionValue,
  loadPhase74FrozenProtectionSuiteRunArtifact,
} from "./phase74ProtectionRun";
import type {
  LoadedPhase74FrozenProtectionSuiteRunArtifact,
  Phase74ProtectionSuiteBranchScores,
} from "./phase74ProtectionRun";
import type {
  Phase74ProtectionSuiteVerifier,
} from "./phase74ProtectionVerifier";

export const PHASE74_MAB_PROTECTION_METRICS = [
  "memoryagentbench_evidence_recall",
  "memoryagentbench_gold_evidence_complete",
  "memoryagentbench_stale_selection_avoidance",
] as const;

export const PHASE74_MAB_PROTECTION_SUITE = {
  id: "memoryagentbench-legacy-vs-recommended-hybrid-retrieval-diagnostic-v1",
  kind: "benchmark-protection",
} as const;

export const PHASE74_MAB_PROTECTION_VERIFIER_ID =
  "memoryagentbench-retrieval-replay-v1";

interface MemoryAgentBenchProtectionInput {
  questionId: string;
  testCaseId: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function descriptor(id: string, material: unknown) {
  return { id, sha256: hashPhase74ProtectionValue(material) };
}

export function parsePhase74MemoryAgentBenchDataset(
  raw: string,
  path: string,
): MemoryAgentBenchCase[] {
  const parsed = JSON.parse(raw) as unknown;
  const rawCases = isRecord(parsed) ? parsed.cases : parsed;
  if (!Array.isArray(rawCases)) {
    throw new Error(
      `MemoryAgentBench external root ${path} must contain a cases array (or {cases: [...]}).`,
    );
  }
  return rawCases.map((value, index) => {
    if (
      !isRecord(value) ||
      typeof value.caseId !== "string" ||
      !Array.isArray(value.chunks) ||
      !Array.isArray(value.questions)
    ) {
      throw new Error(
        `MemoryAgentBench external case at index ${index} is not a normalized case (need caseId, chunks[], questions[]).`,
      );
    }
    return value as unknown as MemoryAgentBenchCase;
  });
}

export function buildPhase74MemoryAgentBenchQuestionPopulation(
  cases: readonly MemoryAgentBenchCase[],
): {
  cases: Array<{ caseId: string; input: MemoryAgentBenchProtectionInput }>;
  questions: Map<string, {
    question: MemoryAgentBenchQuestion;
    testCase: MemoryAgentBenchCase;
  }>;
} {
  const questions = new Map<string, {
    question: MemoryAgentBenchQuestion;
    testCase: MemoryAgentBenchCase;
  }>();
  for (const testCase of cases) {
    for (const question of testCase.questions) {
      if (questions.has(question.questionId)) {
        throw new Error(
          `Phase 74 MemoryAgentBench protection has duplicate question ID ${question.questionId}.`,
        );
      }
      questions.set(question.questionId, { question, testCase });
    }
  }
  if (questions.size === 0) {
    throw new Error(
      "Phase 74 MemoryAgentBench protection requires at least one question.",
    );
  }
  return {
    cases: [...questions.values()].map(({ question, testCase }) => ({
      caseId: question.questionId,
      input: {
        questionId: question.questionId,
        testCaseId: testCase.caseId,
      },
    })),
    questions,
  };
}

export function buildPhase74MemoryAgentBenchProtectionScores(
  retrieval: ReturnType<typeof scoreMemoryAgentBenchRetrieval>,
): Phase74ProtectionSuiteBranchScores {
  return {
    protections: {
      memoryagentbench_evidence_recall: retrieval.evidenceRecall,
      memoryagentbench_gold_evidence_complete:
        retrieval.goldEvidenceFullyRetrieved ? 1 : 0,
      memoryagentbench_stale_selection_avoidance:
        retrieval.staleChunkSelected ? 0 : 1,
    },
  };
}

function retrievedChunkIds(value: unknown, label: string): number[] {
  if (!isRecord(value)) {
    throw new Error(`Phase 74 MAB ${label} must be an object.`);
  }
  const ids = value.retrievedChunkIds;
  if (
    !Array.isArray(ids) ||
    ids.some((id) => typeof id !== "number" || !Number.isInteger(id))
  ) {
    throw new Error(`Phase 74 MAB ${label}.retrievedChunkIds is invalid.`);
  }
  return ids as number[];
}

function sameValue(left: unknown, right: unknown): boolean {
  return hashPhase74ProtectionValue(left) === hashPhase74ProtectionValue(right);
}

export async function verifyPhase74MemoryAgentBenchProtectionArtifact(input: {
  artifactPath: string;
  cases: readonly MemoryAgentBenchCase[];
  dataset: Phase74ProtectionIdentityDescriptor;
  source: Phase74ProtectionIdentityDescriptor;
}): Promise<LoadedPhase74FrozenProtectionSuiteRunArtifact> {
  const loaded = await loadPhase74FrozenProtectionSuiteRunArtifact(
    input.artifactPath,
  );
  if (!sameValue(loaded.suite, PHASE74_MAB_PROTECTION_SUITE)) {
    throw new Error("Phase 74 MAB protection suite identity drifted.");
  }
  if (!sameValue(loaded.identity.dataset, input.dataset)) {
    throw new Error("Phase 74 MAB protection dataset identity drifted.");
  }
  const expectedEvaluatorIdentity = {
    judge: descriptor(
      "memoryagentbench-deterministic-retrieval-diagnostics-v1",
      PHASE74_MAB_PROTECTION_METRICS,
    ),
    model: descriptor("no-answer-model-retrieval-only", "none"),
    pipeline: descriptor(PHASE74_MAB_PROTECTION_SUITE.id, {
      baseline: "rules-only",
      candidate: "recommended-hybrid",
      source: input.source,
    }),
    prompt: descriptor(
      "memoryagentbench-verbatim-question-query-v1",
      "query=question.question",
    ),
    source: input.source,
  };
  if (
    !sameValue(loaded.identity.judge, expectedEvaluatorIdentity.judge) ||
    !sameValue(loaded.identity.model, expectedEvaluatorIdentity.model) ||
    !sameValue(loaded.identity.pipeline, expectedEvaluatorIdentity.pipeline) ||
    !sameValue(loaded.identity.prompt, expectedEvaluatorIdentity.prompt) ||
    !sameValue(loaded.identity.source, expectedEvaluatorIdentity.source)
  ) {
    throw new Error("Phase 74 MAB protection evaluator identity drifted.");
  }
  const population = buildPhase74MemoryAgentBenchQuestionPopulation(input.cases);
  const caseIds = population.cases.map(({ caseId }) => caseId);
  if (
    !sameValue(loaded.rows.map(({ caseId }) => caseId), caseIds) ||
    loaded.identity.population.caseCount !== caseIds.length ||
    loaded.identity.population.caseIdsSha256 !==
      hashPhase74ProtectionCaseIds(caseIds) ||
    loaded.identity.population.id !==
      `${input.dataset.id}:question-population-v1`
  ) {
    throw new Error("Phase 74 MAB protection question population drifted.");
  }

  const raw = JSON.parse(
    await readFile(loaded.rawArtifactPath, "utf8"),
  ) as {
    rows: Array<{
      baseline: {
        rawOutput: unknown;
        scores: Phase74ProtectionSuiteBranchScores;
      };
      candidate: {
        rawOutput: unknown;
        scores: Phase74ProtectionSuiteBranchScores;
      };
      caseId: string;
      inputSha256: string;
    }>;
  };
  for (const [index, expectedCase] of population.cases.entries()) {
    const rawRow = raw.rows[index]!;
    if (
      rawRow.caseId !== expectedCase.caseId ||
      rawRow.inputSha256 !== hashPhase74ProtectionValue(expectedCase.input)
    ) {
      throw new Error(
        `Phase 74 MAB protection input SHA-256 drifted at ${expectedCase.caseId}.`,
      );
    }
    const selected = population.questions.get(expectedCase.caseId)!;
    for (const branch of ["baseline", "candidate"] as const) {
      const rawBranch = rawRow[branch];
      const replayed = scoreMemoryAgentBenchRetrieval({
        question: selected.question,
        retrievedChunkIds: retrievedChunkIds(
          rawBranch.rawOutput,
          `${expectedCase.caseId}.${branch}.rawOutput`,
        ),
        testCase: selected.testCase,
      });
      const replayedScores = buildPhase74MemoryAgentBenchProtectionScores(
        replayed,
      );
      if (
        !sameValue(rawBranch.scores, replayedScores) ||
        !sameValue(loaded.rows[index]![branch], replayedScores)
      ) {
        throw new Error(
          `Phase 74 MAB protection retrieval score drifted at ${expectedCase.caseId}.${branch}.`,
        );
      }
      if (!sameValue(rawBranch.rawOutput, replayed)) {
        throw new Error(
          `Phase 74 MAB protection raw retrieval output drifted at ${expectedCase.caseId}.${branch}.`,
        );
      }
    }
  }
  return loaded;
}

export const PHASE74_MEMORY_AGENT_BENCH_PROTECTION_VERIFIER = {
  id: PHASE74_MAB_PROTECTION_VERIFIER_ID,
  kind: PHASE74_MAB_PROTECTION_SUITE.kind,
  requiredMetrics: PHASE74_MAB_PROTECTION_METRICS,
  suiteId: PHASE74_MAB_PROTECTION_SUITE.id,
  verify: async ({ dataset, datasetBytes, run }) => {
    const cases = parsePhase74MemoryAgentBenchDataset(
      Buffer.from(datasetBytes).toString("utf8"),
      dataset.path,
    );
    await verifyPhase74MemoryAgentBenchProtectionArtifact({
      artifactPath: run.artifactPath,
      cases,
      dataset: { id: dataset.id, sha256: dataset.sha256 },
      source: run.identity.source,
    });
  },
} satisfies Phase74ProtectionSuiteVerifier;
