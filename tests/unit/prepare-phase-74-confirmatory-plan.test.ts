import { createHash } from "node:crypto";
import {
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "bun:test";

import type {
  Phase74DatasetBundle,
  Phase74DatasetCase,
} from "../../src/eval/phase74Datasets";
import {
  parsePhase74ConfirmatoryPlanBuilderCliOptions,
  preparePhase74ConfirmatoryPlan,
} from "../../scripts/prepare-phase-74-confirmatory-plan";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, {
    force: true,
    recursive: true,
  })));
});

async function createRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "phase74-confirmatory-plan-"));
  roots.push(root);
  return root;
}

function sha256Token(value: string): string {
  return value.repeat(64).slice(0, 64);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function syntheticCases(
  benchmark: "locomo" | "longmemeval",
  count: number,
  labelVariant = "original",
): Phase74DatasetCase[] {
  return Array.from({ length: count }, (_, index) => ({
    caseId: `${benchmark}-case-${index + 1}`,
    expectedAnswer: `${labelVariant}-answer-${index + 1}`,
    family: benchmark,
    goldEvidenceIds: [`${labelVariant}-evidence-${index + 1}`],
    locale: "en",
    memoryGroupId: `${benchmark}-group-${index + 1}`,
    protocolMetadata: { labelVariant },
    question: `What happened in ${benchmark} event ${index + 1}?`,
    rawEvidence: [{
      content: `Evidence for ${benchmark} event ${index + 1}.`,
      id: `${benchmark}-raw-${index + 1}`,
      role: "user",
      sourceIds: [`${benchmark}-source-${index + 1}`],
    }],
    referenceTime: "2026-07-23T00:00:00.000Z",
    unresolvedGoldEvidenceIds: [],
  }));
}

function syntheticBundle(
  benchmark: "locomo" | "longmemeval",
  count: number,
  labelVariant?: string,
): Phase74DatasetBundle {
  const cases = syntheticCases(benchmark, count, labelVariant);
  return {
    cases,
    manifest: {
      adaptedCasesSha256: sha256Token(benchmark === "locomo" ? "a" : "b"),
      benchmark,
      caseCount: count,
      datasetSha256: sha256Token(benchmark === "locomo" ? "c" : "d"),
      normalizedFingerprint: sha256Token(benchmark === "locomo" ? "e" : "f"),
      schemaVersion: 2,
      selectedCaseIdsSha256: sha256(
        JSON.stringify(cases.map(({ caseId }) => caseId)),
      ),
      source: {
        commit: `${benchmark}-test-source`,
        license: "test-only",
        repository: `https://example.test/${benchmark}`,
        sourceSha256: sha256Token(benchmark === "locomo" ? "3" : "4"),
        sourceUrl: `https://example.test/${benchmark}/data.json`,
      },
      unresolvedGoldEvidence: [],
      unresolvedGoldEvidenceCount: 0,
    },
  };
}

function options(root: string) {
  return {
    caseConcurrency: 40,
    embeddingSpendLimitUsd: 8,
    locomoBenchmarkRoot: join(root, "locomo"),
    locomoCaseCount: 5,
    longMemEvalBenchmarkRoot: join(root, "longmemeval"),
    longMemEvalCaseCount: 4,
    maxLanguageCalls: 100_000,
    outputPath: join(root, "confirmatory-plan.json"),
    protectionBlueprintPath: join(root, "protection-blueprint.json"),
  };
}

function models() {
  const answer = {
    apiKey: "must-not-persist",
    baseURL: "https://ai.gurkiai.com/v1",
    model: "gpt-5.6-terra",
    provider: "openai" as const,
  };
  return {
    answer,
    embedding: {
      apiKey: "must-not-persist",
      baseURL: "https://openrouter.ai/api/v1",
      model: "baai/bge-m3",
      provider: "openai" as const,
    },
    judge: {
      ...answer,
      model: "gpt-5.5",
    },
    reranker: answer,
  };
}

describe("Phase 74 confirmatory plan preparation", () => {
  it("parses the complete strict CLI contract", () => {
    const parsed = parsePhase74ConfirmatoryPlanBuilderCliOptions([
      "--output", "./confirmatory-plan.json",
      "--protection-blueprint", "./protection-blueprint.json",
      "--locomo-benchmark-root", "./locomo",
      "--longmemeval-benchmark-root", "./longmemeval",
      "--locomo-case-count", "300",
      "--longmemeval-case-count", "200",
      "--case-concurrency", "40",
      "--embedding-spend-limit-usd", "8",
      "--max-language-calls", "100000",
    ]);

    expect(parsed).toMatchObject({
      caseConcurrency: 40,
      embeddingSpendLimitUsd: 8,
      locomoCaseCount: 300,
      longMemEvalCaseCount: 200,
      maxLanguageCalls: 100_000,
    });
    for (const argv of [
      ["--unknown", "value"],
      ["--locomo-holdout-size", "1"],
      ["--longmemeval-holdout-seed", "74102"],
      ["--output", "a.json", "--output", "b.json"],
      ["--output", "a.json", "--locomo-case-count", "0"],
      ["--output", "a.json", "--longmemeval-case-count", "0"],
      ["--output", "a.json", "--embedding-spend-limit-usd", "0"],
      ["--output", "a.json", "--case-concurrency", "1.5"],
      ["--output", "a.json", "--max-language-calls", "-1"],
      ["--output", "a.json", "--locomo-benchmark-root", "--bad"],
    ]) {
      expect(() => parsePhase74ConfirmatoryPlanBuilderCliOptions(argv))
        .toThrow();
    }
  });

  it("uses actual CLI argv instead of treating the Bun executable as an option", async () => {
    const child = Bun.spawn({
      cmd: [
        process.execPath,
        join(import.meta.dir, "../../scripts/prepare-phase-74-confirmatory-plan.ts"),
      ],
      stderr: "pipe",
      stdout: "pipe",
    });
    const [exitCode, stderr] = await Promise.all([
      child.exited,
      new Response(child.stderr).text(),
    ]);

    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("requires --case-concurrency");
    expect(stderr).not.toContain("unknown option");
  });

  it("derives and seals the complete 24-run full-family matrix without leaking labels", async () => {
    const root = await createRoot();
    const input = options(root);
    const bundles = {
      locomo: syntheticBundle("locomo", 5),
      longmemeval: syntheticBundle("longmemeval", 4),
    };
    const result = await preparePhase74ConfirmatoryPlan(input, {
      captureEvaluatorSource: async () => ({
        commit: "7".repeat(40),
        sha256: "8".repeat(64),
      }),
      loadDataset: async ({ benchmark }) => bundles[benchmark],
      protectionBlueprint: {
        id: "phase74-protection-suite-manifest-v2",
        sha256: "9".repeat(64),
      },
      resolveModels: models,
    });

    expect(result.plan.runs).toHaveLength(24);
    expect(result.plan.families).toEqual(expect.arrayContaining([
      expect.objectContaining({
        benchmark: "locomo",
        population: expect.objectContaining({
          authority: "presealed-full-population",
          caseCount: 5,
          selectedCaseIdsSha256: expect.any(String),
          selectedCaseKeysSha256: expect.any(String),
        }),
        seenCasesOnly: true,
      }),
      expect.objectContaining({
        benchmark: "longmemeval",
        population: expect.objectContaining({
          authority: "presealed-full-population",
          caseCount: 4,
          selectedCaseIdsSha256: expect.any(String),
          selectedCaseKeysSha256: expect.any(String),
        }),
        seenCasesOnly: true,
      }),
    ]));
    expect(result.plan).toMatchObject({
      admission: {
        class: "confirmatory-only",
      },
      answerModel: {
        gateway: "https://ai.gurkiai.com/v1",
        model: "gpt-5.6-terra",
      },
      embedding: {
        gateway: "https://openrouter.ai/api/v1",
        model: "baai/bge-m3",
      },
      evaluatorSource: { commit: "7".repeat(40) },
      judgeModel: { model: "gpt-5.5" },
      reranker: {
        implementation: "provider-listwise-v1",
        mode: "provider",
      },
      renderedContextTokens: 6_000,
    });

    const serialized = await readFile(input.outputPath, "utf8");
    for (const forbidden of [
      "question",
      "expectedAnswer",
      "goldEvidenceIds",
      "protocolMetadata",
      "rawEvidence",
      "must-not-persist",
      "original-answer",
      "original-evidence",
      "holdout",
      "promotion-admissible",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("uses the label-free full population: changing answers, gold, and protocol leaves the sealed plan unchanged", async () => {
    const root = await createRoot();
    const input = options(root);
    const source = {
      commit: "7".repeat(40),
      sha256: "8".repeat(64),
    };
    const dependencies = (labelVariant: string) => ({
      captureEvaluatorSource: async () => source,
      loadDataset: async ({ benchmark }: { benchmark: "locomo" | "longmemeval" }) =>
        syntheticBundle(benchmark, benchmark === "locomo" ? 5 : 4, labelVariant),
      protectionBlueprint: {
        id: "phase74-protection-suite-manifest-v2" as const,
        sha256: "9".repeat(64),
      },
      resolveModels: models,
    });

    const first = await preparePhase74ConfirmatoryPlan(input, dependencies("original"));
    const secondPath = join(root, "same-selection-different-labels.json");
    const second = await preparePhase74ConfirmatoryPlan({
      ...input,
      outputPath: secondPath,
    }, dependencies("changed"));

    expect(second.plan).toEqual(first.plan);
  });

  it("refuses a declared case count that is not the complete family population", async () => {
    const root = await createRoot();
    const input = {
      ...options(root),
      locomoCaseCount: 4,
    };

    await expect(preparePhase74ConfirmatoryPlan(input, {
      captureEvaluatorSource: async () => ({
        commit: "7".repeat(40),
        sha256: "8".repeat(64),
      }),
      loadDataset: async ({ benchmark }) => syntheticBundle(
        benchmark,
        benchmark === "locomo" ? 5 : 4,
      ),
      protectionBlueprint: {
        id: "phase74-protection-suite-manifest-v2",
        sha256: "9".repeat(64),
      },
      resolveModels: models,
    })).rejects.toThrow(/complete|population|case count/i);
  });

  it("is create-only and accepts a byte-identical rerun without reading the benchmark", async () => {
    const root = await createRoot();
    const input = options(root);
    const prepared = await preparePhase74ConfirmatoryPlan(input, {
      captureEvaluatorSource: async () => ({
        commit: "7".repeat(40),
        sha256: "8".repeat(64),
      }),
      loadDataset: async ({ benchmark }) => syntheticBundle(
        benchmark,
        benchmark === "locomo" ? 5 : 4,
      ),
      protectionBlueprint: {
        id: "phase74-protection-suite-manifest-v2",
        sha256: "9".repeat(64),
      },
      resolveModels: models,
    });
    let loaded = false;
    const repeated = await preparePhase74ConfirmatoryPlan(input, {
      loadDataset: async () => {
        loaded = true;
        throw new Error("must not load a matching existing plan");
      },
    });
    expect(loaded).toBe(false);
    expect(repeated.plan).toEqual(prepared.plan);

    await writeFile(input.outputPath, "drifted plan bytes\n", "utf8");
    await expect(preparePhase74ConfirmatoryPlan(input, {
      loadDataset: async () => {
        loaded = true;
        throw new Error("must not load a non-matching existing plan");
      },
    })).rejects.toThrow(/already exists|exact match/i);
    expect(loaded).toBe(false);
  });
});
