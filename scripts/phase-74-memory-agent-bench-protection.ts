import type { GoodMemory } from "../src/api/contracts";
import { createInternalGoodMemory } from "../src/api/createGoodMemory";
import type { MemoryAgentBenchCase } from "../src/eval/memoryAgentBench";
import type {
  Phase74ProtectionIdentityDescriptor,
  Phase74ProtectionReplicate,
  Phase74ProtectionRunIdentity,
} from "../src/eval/phase74ProtectionContracts";
import {
  hashPhase74ProtectionCaseIds,
} from "../src/eval/phase74ProtectionContracts";
import {
  describePhase74ProtectionCallBudget,
} from "../src/eval/phase74ProtectionPlan";
import type {
  LoadedPhase74ProtectionPlan,
} from "../src/eval/phase74ProtectionPlan";
import {
  hashPhase74ProtectionValue,
  runPhase74ProtectionSuiteCases,
} from "../src/eval/phase74ProtectionRun";
import type {
  Phase74ProtectionBranch,
  Phase74ProtectionRunPlanInput,
  Phase74ProtectionSuiteRunResult,
} from "../src/eval/phase74ProtectionRun";
import {
  buildPhase74MemoryAgentBenchProtectionScores,
  buildPhase74MemoryAgentBenchQuestionPopulation,
  PHASE74_MAB_PROTECTION_METRICS,
  PHASE74_MAB_PROTECTION_SUITE,
  PHASE74_MAB_PROTECTION_VERIFIER_ID,
} from "../src/eval/phase74MemoryAgentBenchProtectionVerifier";
import {
  PHASE74_PROTECTION_BLUEPRINT_ID,
} from "../src/eval/phase74ProtectionVerifier";
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

const DEFAULT_CASE_CONCURRENCY = 1;
const RENDERED_CONTEXT_TOKENS = 6_000;

export interface Phase74MemoryAgentBenchProtectionDependencies {
  createMemory?: (branch: Phase74ProtectionBranch) => GoodMemory;
}

function descriptor(id: string, material: unknown) {
  return { id, sha256: hashPhase74ProtectionValue(material) };
}

export function buildPhase74MemoryAgentBenchProtectionPlanIdentity(input: {
  cases: readonly MemoryAgentBenchCase[];
  dataset: Phase74ProtectionIdentityDescriptor;
  source: Phase74ProtectionIdentityDescriptor;
}): {
  caseIds: string[];
  identity: Phase74ProtectionRunIdentity;
} {
  const population = buildPhase74MemoryAgentBenchQuestionPopulation(
    input.cases,
  );
  const caseIds = population.cases.map(({ caseId }) => caseId);
  return {
    caseIds,
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
      population: {
        caseCount: caseIds.length,
        caseIdsSha256: hashPhase74ProtectionCaseIds(caseIds),
        id: `${input.dataset.id}:question-population-v1`,
      },
      prompt: descriptor(
        "memoryagentbench-verbatim-question-query-v1",
        "query=question.question",
      ),
      source: input.source,
    },
  };
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
  caseConcurrency?: number;
  cases: readonly MemoryAgentBenchCase[];
  dataset: Phase74ProtectionIdentityDescriptor;
  protectionPlan?: LoadedPhase74ProtectionPlan;
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
  const caseConcurrency = input.caseConcurrency ?? DEFAULT_CASE_CONCURRENCY;
  const plannedIdentity =
    buildPhase74MemoryAgentBenchProtectionPlanIdentity(input).identity;
  const { population: identityPopulation, ...identity } = plannedIdentity;
  let plan: Phase74ProtectionRunPlanInput | undefined;
  if (input.protectionPlan !== undefined) {
    const protectionBlueprint = input.protectionPlan.plan.protectionBlueprint;
    if (protectionBlueprint.id !== PHASE74_PROTECTION_BLUEPRINT_ID) {
      throw new Error(
        "Phase 74 MemoryAgentBench requires the canonical protection blueprint.",
      );
    }
    plan = {
      controls: {
        callBudget: describePhase74ProtectionCallBudget(
          "no-live-model-calls-v1",
        ),
        caseConcurrency,
        renderedContextTokens: RENDERED_CONTEXT_TOKENS,
      },
      loadedPlan: input.protectionPlan,
      protectionBlueprint,
      verifier: descriptor(PHASE74_MAB_PROTECTION_VERIFIER_ID, {
        id: PHASE74_MAB_PROTECTION_VERIFIER_ID,
      }),
    };
  }

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
    caseConcurrency,
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
      ...identity,
      populationId: identityPopulation.id,
    },
    plan,
    rawArtifactPath: input.rawArtifactPath,
    replicate: input.replicate,
    runId: input.runId,
    suite: PHASE74_MAB_PROTECTION_SUITE,
  });
}
