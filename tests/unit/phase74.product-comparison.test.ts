import { describe, expect, it } from "bun:test";

import {
  createAttributedModelUsageSink,
  validatePhase74ModelUsageLedger,
  type AttributedModelUsageAttempt,
  type AttributedModelUsageIntent,
  type Phase74IngestionUsageLedger,
} from "../../src/eval/modelUsage";
import {
  buildPhase74ProductCandidateConfiguration,
  buildPhase74ProductModelUsageEvidence,
} from "../../src/eval/phase74ProductComparison";
import type { ModelUsageAttempt } from "../../src/provider/model-usage";

function attempt(input: {
  completeness?: ModelUsageAttempt["completeness"];
  inputTokens?: number | null;
  operation?: ModelUsageAttempt["operation"];
  outputTokens?: number | null;
} = {}): ModelUsageAttempt {
  const inputTokens = input.inputTokens === undefined ? 10 : input.inputTokens;
  return {
    attempt: 1,
    completeness: input.completeness ?? "complete",
    modelId: "model-v1",
    operation: input.operation ?? "answer_generation",
    outcome: "succeeded",
    providerId: "openai",
    schemaVersion: 1,
    usage: {
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      inputTokens,
      outputTokens: input.outputTokens === undefined ? 2 : input.outputTokens,
      uncachedInputTokens: inputTokens,
    },
  };
}

function directUsage() {
  const events: AttributedModelUsageAttempt[] = [];
  const intents: AttributedModelUsageIntent[] = [];
  for (const branch of ["baseline", "candidate"] as const) {
    for (const caseId of ["case-a", "case-b"]) {
      createAttributedModelUsageSink({
        branch,
        caseId,
        events,
        intents,
      }).emit(attempt());
    }
  }
  return validatePhase74ModelUsageLedger({ events, intents });
}

function ingestionUsage(input: {
  inputTokens: number;
  key: string;
}): Phase74IngestionUsageLedger {
  const events: AttributedModelUsageAttempt[] = [];
  const intents: AttributedModelUsageIntent[] = [];
  createAttributedModelUsageSink({
    branch: "shadow",
    caseId: input.key,
    events,
    intents,
  }).emit(attempt({
    inputTokens: input.inputTokens,
    operation: "assisted_extraction",
    outputTokens: 0,
  }));
  return {
    key: input.key,
    ledger: validatePhase74ModelUsageLedger({ events, intents }),
  };
}

describe("Phase 74 cumulative product comparison", () => {
  it("assigns release and candidate ingestion to exclusive pools with no shared cost", () => {
    const evidence = buildPhase74ProductModelUsageEvidence({
      baselineIngestion: [ingestionUsage({
        inputTokens: 40,
        key: "release/group-a",
      })],
      candidateIngestion: [ingestionUsage({
        inputTokens: 70,
        key: "candidate/group-a",
      })],
      caseIds: ["case-a", "case-b"],
      direct: directUsage(),
      memoryGroupIds: ["group-a"],
    });

    expect(evidence).toMatchObject({
      baseline: {
        answerGenerationCaseCount: 2,
        logicalCaseCount: 2,
        totalTokens: 64,
      },
      candidate: {
        answerGenerationCaseCount: 2,
        logicalCaseCount: 2,
        totalTokens: 94,
      },
      costBoundary: "full-product",
      ingestion: {
        baselineExclusive: { keyCount: 1, totalTokens: 40 },
        candidateExclusive: { keyCount: 1, totalTokens: 70 },
        shared: { keyCount: 0, totalTokens: 0 },
      },
    });
  });

  it("rejects missing or incomplete candidate ingestion instead of cancelling its cost", () => {
    expect(() => buildPhase74ProductModelUsageEvidence({
      baselineIngestion: [ingestionUsage({
        inputTokens: 40,
        key: "release/group-a",
      })],
      candidateIngestion: [],
      caseIds: ["case-a", "case-b"],
      direct: directUsage(),
      memoryGroupIds: ["group-a"],
    })).toThrow("candidate ingestion");

    expect(() => buildPhase74ProductModelUsageEvidence({
      baselineIngestion: [ingestionUsage({
        inputTokens: 40,
        key: "release/group-a",
      })],
      candidateIngestion: [ingestionUsage({
        inputTokens: 70,
        key: "candidate/group-a",
      })],
      caseIds: ["case-a", "case-b"],
      direct: directUsage(),
      memoryGroupIds: ["group-a", "group-b"],
    })).toThrow("memory-group");
  });

  it("binds the final candidate to atomic claims, five channels, deterministic planning, and the selected E4 format", () => {
    const configuration = buildPhase74ProductCandidateConfiguration({
      base: {
        reader: "generic-label-free-v1",
        selectedLimit: 12,
      },
      selectedEvidenceLedgerFormat: "compact_json",
    });

    expect(configuration).toEqual({
      evidenceLedger: { format: "compact_json" },
      planner: { mode: "deterministic" },
      reader: "generic-label-free-v1",
      representation: "atomic-contextual-raw-pointer",
      retrieval: {
        generalizedFusionChannels: [
          "lexical",
          "dense",
          "entity",
          "temporal",
          "relation",
        ],
        recallPlanExecution: true,
      },
      selectedLimit: 12,
    });
  });
});
