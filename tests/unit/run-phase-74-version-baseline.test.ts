import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "bun:test";

import {
  buildPhase74ReleaseWorkerInput,
  buildPhase74VersionComparison,
  buildPhase74VersionRunIdentity,
  createPhase74FreshVersionRunDirectory,
  parsePhase74VersionBaselineCliOptions,
  parsePhase74VersionCandidateOutcomes,
  preparePhase74VersionDataset,
} from "../../scripts/run-phase-74-version-baseline";
import type { Phase74DatasetBundle } from "../../src/eval/phase74Datasets";
import {
  assertPhase74ExperimentIdentityContract,
  buildPhase74FullRunIdentityConfiguration,
} from "../../src/eval/phase74ExperimentIdentity";
import { buildPhase74ProtocolScoringIdentity } from "../../src/eval/phase74ProtocolScoring";
import { parsePhase74VersionCandidateReranker } from "../../src/eval/phase74VersionBaseline";

const JUDGE_MODEL = {
  gateway: "https://judge.example/v1",
  model: "gpt-5.5",
  provider: "openai",
};

function fullRunConfiguration() {
  const scoring = buildPhase74ProtocolScoringIdentity(
    "longmemeval",
    JUDGE_MODEL,
  );
  const configuration = buildPhase74FullRunIdentityConfiguration({
    callBudget: {
      embeddingSpendLimitUsd: 0.1,
      maxLanguageCalls: 80,
    },
    dataset: { datasetSha256: "dataset-sha" },
    embedding: {
      gateway: "https://openrouter.ai/api/v1",
      model: "text-embedding-3-small",
      provider: "openai",
    },
    evaluatorSource: {
      commit: "a".repeat(40),
      sha256: "b".repeat(64),
    },
    replicate: 1,
    reranker: {
      implementation: "lexical-coverage-v1",
      mode: "deterministic",
    },
    scoring,
    selection: { mode: "all" },
    selectedCaseIdsSha256: "c".repeat(64),
  });
  return { configuration, scoring };
}

function assertFullRunConfiguration(configuration: ReturnType<
  typeof buildPhase74FullRunIdentityConfiguration
>) {
  assertPhase74ExperimentIdentityContract({
    benchmark: "longmemeval",
    configuration,
    dataset: { datasetSha256: "dataset-sha" },
    expectedReranker: {
      implementation: "lexical-coverage-v1",
      mode: "deterministic",
    },
    judgeModel: JUDGE_MODEL,
  });
}

describe("Phase 74 release baseline runner", () => {
  it("fails closed on every frozen full-run identity field and malformed budgets", () => {
    const { configuration } = fullRunConfiguration();

    expect({
      answer: configuration.answer,
      context: configuration.context,
      costBoundary: configuration.costBoundary,
      modelUsageAccounting: configuration.modelUsageAccounting,
      preRankLimit: configuration.preRankLimit,
      reader: configuration.reader,
      selectedLimit: configuration.selectedLimit,
      seenCasesOnly: configuration.seenCasesOnly,
    }).toEqual({
      answer: {
        maxTokens: 512,
        reasoningEffort: "medium",
        temperature: 0,
      },
      context: {
        maxTokens: 6_000,
        tokenizer: "utf8-byte-upper-bound-v1",
      },
      costBoundary: "full-product-standalone-shared-v1",
      modelUsageAccounting: "phase74-model-usage-v2",
      preRankLimit: 32,
      reader: "generic-label-free-v1",
      selectedLimit: 12,
      seenCasesOnly: true,
    });
    expect(() => assertFullRunConfiguration(configuration)).not.toThrow();

    for (const [field, value] of [
      ["answer", { maxTokens: 511, reasoningEffort: "medium", temperature: 0 }],
      ["context", { maxTokens: 5_999, tokenizer: "utf8-byte-upper-bound-v1" }],
      ["costBoundary", "query-only-comparison-with-shadow-ingestion"],
      ["modelUsageAccounting", "phase74-model-usage-v1"],
      ["preRankLimit", 31],
      ["reader", "benchmark-aware-reader"],
      ["selectedLimit", 11],
      ["seenCasesOnly", false],
    ] as const) {
      expect(() => assertFullRunConfiguration({
        ...configuration,
        [field]: value,
      })).toThrow(field);
    }

    const invalidCallBudgets: readonly Record<string, number | boolean>[] = [
      { embeddingSpendLimitUsd: 0, maxLanguageCalls: 80 },
      { embeddingSpendLimitUsd: 0.1, maxLanguageCalls: 0 },
      { embeddingSpendLimitUsd: 0.1, maxLanguageCalls: 1.5 },
      { embeddingSpendLimitUsd: Number.POSITIVE_INFINITY, maxLanguageCalls: 80 },
      { embeddingSpendLimitUsd: 0.1, extra: true, maxLanguageCalls: 80 },
      { maxLanguageCalls: 80 },
    ];
    for (const callBudget of invalidCallBudgets) {
      expect(() => assertFullRunConfiguration({
        ...configuration,
        callBudget,
      })).toThrow("callBudget");
    }
  });

  it("records both hard budgets in the pre-call version run identity", () => {
    expect(buildPhase74VersionRunIdentity({
      embeddingSpendLimitUsd: 0.1,
      identity: {
        benchmark: "longmemeval",
        runId: "release-vs-candidate-r1",
      },
      maxLanguageCalls: 80,
    })).toEqual({
      benchmark: "longmemeval",
      callBudget: {
        embeddingSpendLimitUsd: 0.1,
        maxLanguageCalls: 80,
      },
      runId: "release-vs-candidate-r1",
    });
  });

  it("binds the version identity contract and output to the candidate provider reranker", () => {
    const reranker = parsePhase74VersionCandidateReranker({
      gateway: "https://ai.gurkiai.com/v1",
      implementation: "provider-listwise-v1",
      mode: "provider",
      model: "gpt-5.6-terra",
      provider: "openai",
    });
    const { configuration: deterministicConfiguration, scoring } =
      fullRunConfiguration();
    const configuration = {
      ...deterministicConfiguration,
      reranker,
    };

    expect(() => assertPhase74ExperimentIdentityContract({
      benchmark: "longmemeval",
      configuration,
      dataset: { datasetSha256: "dataset-sha" },
      expectedReranker: reranker,
      judgeModel: JUDGE_MODEL,
    })).not.toThrow();
    expect(buildPhase74VersionRunIdentity({
      embeddingSpendLimitUsd: 0.1,
      identity: {
        benchmark: "longmemeval",
        reranker,
        runId: "release-vs-candidate-r1",
        scoring,
      },
      maxLanguageCalls: 80,
    }).reranker).toEqual(reranker);
  });

  it("refuses candidate progress containing a provider fallback execution", () => {
    expect(() => parsePhase74VersionCandidateOutcomes({
      arm: "recall-plan-deterministic",
      cases: [{ caseId: "case-1" }],
      progress: [{
        answer: "Pepper",
        arm: "recall-plan-deterministic",
        caseId: "case-1",
        correct: true,
        executionError: "Phase 74 provider reranker fell back (provider_error).",
        score: 1,
        stage: "E3",
      }],
      stage: "E3",
    })).toThrow("candidate outcome missing");
  });

  it("refuses to reuse a partial version-comparison run directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "phase74-version-run-"));
    try {
      const runDirectory = await createPhase74FreshVersionRunDirectory(
        root,
        "comparison-r1",
      );
      await writeFile(join(runDirectory, "partial.json"), "{}\n", "utf8");
      await expect(createPhase74FreshVersionRunDirectory(
        root,
        "comparison-r1",
      )).rejects.toThrow("already exists");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("feeds release ingestion the same opaque recall payload as the candidate", () => {
    const workerInput = buildPhase74ReleaseWorkerInput({
      caseId: "locomo-original-id",
      expectedAnswer: "Pepper",
      goldEvidenceIds: ["D1:1"],
      memoryGroupId: "locomo-original-group",
      question: "What is the dog's name?",
      rawEvidence: [{
        content: "I adopted Pepper.",
        id: "conversation/D1:1",
        sourceIds: ["D1:1"],
      }, {
        content: "Pepper likes walks.",
        id: "conversation/D1:2",
        sourceIds: ["D1:2"],
      }],
      unresolvedGoldEvidenceIds: [],
    });

    expect(workerInput.caseId).toMatch(/^case-[a-f0-9]{64}$/u);
    expect(workerInput.memoryGroupId).toMatch(/^group-[a-f0-9]{64}$/u);
    expect(workerInput.rawEvidence.map(({ id }) => id)).toEqual([
      "evidence-1",
      "evidence-2",
    ]);
    expect(workerInput.rawEvidence[0]?.sourceIds[0]?.split(":")[0]).toBe(
      workerInput.rawEvidence[1]?.sourceIds[0]?.split(":")[0],
    );
    expect(JSON.stringify(workerInput)).not.toContain("locomo-original");
    expect(JSON.stringify(workerInput)).not.toContain("D1:");
  });

  it("binds a subset comparison to the selected candidate manifest", () => {
    const cases = Array.from({ length: 3 }, (_, index) => ({
      caseId: `case-${index + 1}`,
      expectedAnswer: `answer-${index + 1}`,
      goldEvidenceIds: [],
      question: `Question ${index + 1}?`,
      rawEvidence: [{
        content: `Evidence ${index + 1}`,
        id: `evidence-${index + 1}`,
        sourceIds: [`source-${index + 1}`],
      }],
      unresolvedGoldEvidenceIds: [],
    }));
    const bundle: Phase74DatasetBundle = {
      cases,
      manifest: {
        adaptedCasesSha256: "f".repeat(64),
        benchmark: "longmemeval",
        caseCount: cases.length,
        datasetSha256: "a".repeat(64),
        normalizedFingerprint: "b".repeat(64),
        schemaVersion: 2,
        selectedCaseIdsSha256: "c".repeat(64),
        source: {
          commit: "d".repeat(40),
          license: "MIT",
          repository: "https://example.test/dataset",
          sourceSha256: "e".repeat(64),
          sourceUrl: "https://example.test/dataset.json",
        },
        unresolvedGoldEvidence: [],
        unresolvedGoldEvidenceCount: 0,
      },
    };

    const prepared = preparePhase74VersionDataset({
      dataset: bundle,
      seed: 7401,
      size: 1,
    });

    expect(prepared.selection.cases).toHaveLength(1);
    expect(prepared.dataset.cases).toEqual(prepared.selection.cases);
    expect(prepared.dataset.manifest).toMatchObject({
      caseCount: 1,
      datasetSha256: bundle.manifest.datasetSha256,
      source: bundle.manifest.source,
    });
    expect(prepared.dataset.manifest).not.toEqual(bundle.manifest);
  });

  it("builds paired score and binary inference from the same aligned cases", () => {
    const comparison = buildPhase74VersionComparison({
      baseline: [
        { answer: "wrong", caseId: "case-1", correct: false, score: 0 },
        { answer: "right", caseId: "case-2", correct: true, score: 1 },
      ],
      candidate: [
        { answer: "right", caseId: "case-1", correct: true, score: 1 },
        { answer: "right", caseId: "case-2", correct: true, score: 1 },
      ],
    });

    expect(comparison).toMatchObject({
      baselineMean: 0.5,
      candidateMean: 1,
      caseCount: 2,
      meanDelta: 0.5,
      mcnemar: { baselineOnly: 0, candidateOnly: 1 },
      pairedBootstrap: { delta: 0.5 },
    });
  });

  it("parses an explicit release-vs-candidate run with hard limits", () => {
    expect(parsePhase74VersionBaselineCliOptions([
      "bun",
      "run-phase-74-version-baseline.ts",
      "--benchmark",
      "longmemeval",
      "--benchmark-root",
      "/private/tmp/phase74/longmemeval",
      "--candidate-run-dir",
      "/private/tmp/phase74/candidate",
      "--candidate-stage",
      "E2",
      "--candidate-arm",
      "claim-temporal-on",
      "--release-source-root",
      "/private/tmp/phase74/release",
      "--release-archive",
      "/private/tmp/phase74/release.tar",
      "--output-dir",
      "/private/tmp/phase74/version-runs",
      "--run-id",
      "release-vs-candidate-r1",
      "--case-selection-seed",
      "7401",
      "--case-selection-size",
      "2",
      "--max-language-calls",
      "200",
      "--embedding-spend-limit-usd",
      "1",
    ])).toEqual({
      benchmark: "longmemeval",
      benchmarkRoot: "/private/tmp/phase74/longmemeval",
      candidateArm: "claim-temporal-on",
      candidateRunDirectory: "/private/tmp/phase74/candidate",
      candidateStage: "E2",
      caseSelectionSeed: 7401,
      caseSelectionSize: 2,
      embeddingSpendLimitUsd: 1,
      maxLanguageCalls: 200,
      outputDir: "/private/tmp/phase74/version-runs",
      releaseArchive: "/private/tmp/phase74/release.tar",
      releaseSourceRoot: "/private/tmp/phase74/release",
      runId: "release-vs-candidate-r1",
    });
  });

  it("rejects missing source paths and invalid budgets", () => {
    expect(() => parsePhase74VersionBaselineCliOptions([
      "bun",
      "run-phase-74-version-baseline.ts",
      "--benchmark",
      "longmemeval",
    ])).toThrow("requires");
  });
});
