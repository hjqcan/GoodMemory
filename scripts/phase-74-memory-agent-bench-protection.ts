import type { GoodMemory } from "../src/api/contracts";
import { createInternalGoodMemory } from "../src/api/createGoodMemory";
import type { MemoryAgentBenchCase } from "../src/eval/memoryAgentBench";
import type {
  Phase74ProtectionIdentityDescriptor,
  Phase74ProtectionReplicate,
} from "../src/eval/phase74ProtectionContracts";
import {
  hashPhase74ProtectionValue,
  runPhase74ProtectionSuiteCases,
} from "../src/eval/phase74ProtectionRun";
import type {
  Phase74ProtectionBranch,
  Phase74ProtectionSuiteRunResult,
} from "../src/eval/phase74ProtectionRun";
import {
  buildPhase74MemoryAgentBenchProtectionScores,
  buildPhase74MemoryAgentBenchQuestionPopulation,
  PHASE74_MAB_PROTECTION_METRICS,
  PHASE74_MAB_PROTECTION_SUITE,
} from "../src/eval/phase74MemoryAgentBenchProtectionVerifier";
export {
  PHASE74_MAB_PROTECTION_METRICS,
  PHASE74_MAB_PROTECTION_SUITE,
  verifyPhase74MemoryAgentBenchProtectionArtifact,
} from "../src/eval/phase74MemoryAgentBenchProtectionVerifier";
import {
  buildMemoryAgentBenchScope,
  collectMemoryAgentBenchRetrievedChunkIds,
  seedMemoryAgentBenchCase,
} from "./run-phase-64-memory-agent-bench-smoke";
import { scoreMemoryAgentBenchRetrieval } from "../src/eval/memoryAgentBench";

interface MemoryAgentBenchProtectionInput {
  questionId: string;
  testCaseId: string;
}

interface MemoryAgentBenchRuntime {
  memory: GoodMemory;
  scope: ReturnType<typeof buildMemoryAgentBenchScope>;
}

export interface Phase74MemoryAgentBenchProtectionDependencies {
  createMemory?: (branch: Phase74ProtectionBranch) => GoodMemory;
}

function descriptor(id: string, material: unknown) {
  return { id, sha256: hashPhase74ProtectionValue(material) };
}

export function createPhase74MemoryAgentBenchOfflineMemory(
  branch: Phase74ProtectionBranch,
): GoodMemory {
  let clockTick = 0;
  let idCounter = 0;
  const config = {
    ...(branch === "candidate"
      ? { retrieval: { preset: "recommended" as const } }
      : {}),
    storage: { provider: "memory" as const },
    testing: {
      createId: () => {
        idCounter += 1;
        return `phase74-mab-${String(idCounter).padStart(6, "0")}`;
      },
      now: () => {
        clockTick += 1;
        return new Date(Date.UTC(2026, 0, 1, 0, 0, 0, clockTick));
      },
    },
  };
  return createInternalGoodMemory(config, {
    environment: {},
    ...(branch === "candidate"
      ? {
          projectionBulkBackfill: true,
          projectionWriteThrough: false,
        }
      : {}),
  });
}

export async function runPhase74MemoryAgentBenchProtection(input: {
  artifactPath: string;
  cases: readonly MemoryAgentBenchCase[];
  dataset: Phase74ProtectionIdentityDescriptor;
  rawArtifactPath: string;
  replicate: Phase74ProtectionReplicate;
  runId: string;
  source: Phase74ProtectionIdentityDescriptor;
}, dependencies: Phase74MemoryAgentBenchProtectionDependencies = {}): Promise<Phase74ProtectionSuiteRunResult> {
  const population = buildPhase74MemoryAgentBenchQuestionPopulation(
    input.cases,
  );
  const questions = population.questions;
  const runtimes = new Map<string, MemoryAgentBenchRuntime>();
  const createMemory = dependencies.createMemory ??
    createPhase74MemoryAgentBenchOfflineMemory;

  const runtime = async (
    branch: Phase74ProtectionBranch,
    testCase: MemoryAgentBenchCase,
  ): Promise<MemoryAgentBenchRuntime> => {
    const key = `${branch}\0${testCase.caseId}`;
    const existing = runtimes.get(key);
    if (existing !== undefined) {
      return existing;
    }
    const memory = createMemory(branch);
    const scope = buildMemoryAgentBenchScope({
      caseId: testCase.caseId,
      runId: input.runId,
    });
    await seedMemoryAgentBenchCase({
      memory,
      runId: input.runId,
      testCase,
    });
    const created = { memory, scope };
    runtimes.set(key, created);
    return created;
  };

  return runPhase74ProtectionSuiteCases<MemoryAgentBenchProtectionInput>({
    artifactPath: input.artifactPath,
    cases: population.cases,
    evaluate: async ({ branch, input: caseInput }) => {
      const selected = questions.get(caseInput.questionId);
      if (
        selected === undefined ||
        selected.testCase.caseId !== caseInput.testCaseId
      ) {
        throw new Error(
          `Phase 74 MemoryAgentBench question ${caseInput.questionId} is not in the frozen population.`,
        );
      }
      const active = await runtime(branch, selected.testCase);
      const recall = await active.memory.recall({
        query: selected.question.question,
        scope: active.scope,
        strategy: branch === "candidate" ? "hybrid" : "rules-only",
      });
      const retrieval = scoreMemoryAgentBenchRetrieval({
        question: selected.question,
        retrievedChunkIds: collectMemoryAgentBenchRetrievedChunkIds(recall),
        testCase: selected.testCase,
      });
      return {
        rawOutput: retrieval,
        scores: buildPhase74MemoryAgentBenchProtectionScores(retrieval),
      };
    },
    identity: {
      dataset: input.dataset,
      judge: descriptor(
        "memoryagentbench-deterministic-retrieval-diagnostics-v1",
        PHASE74_MAB_PROTECTION_METRICS,
      ),
      model: descriptor("no-answer-model-retrieval-only", "none"),
      pipeline: descriptor(
        "memoryagentbench-legacy-vs-recommended-hybrid-retrieval-diagnostic-v1",
        {
          baseline: "rules-only",
          candidate: "recommended-hybrid",
          source: input.source,
        },
      ),
      populationId: `${input.dataset.id}:question-population-v1`,
      prompt: descriptor(
        "memoryagentbench-verbatim-question-query-v1",
        "query=question.question",
      ),
      source: input.source,
    },
    rawArtifactPath: input.rawArtifactPath,
    replicate: input.replicate,
    runId: input.runId,
    suite: PHASE74_MAB_PROTECTION_SUITE,
  });
}
