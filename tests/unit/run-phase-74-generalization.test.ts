import { describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildPhase74FullRunIdentityConfiguration,
  buildPhase74SealedProcessEnvironments,
  acquirePhase74RunLock,
  createPhase74DurableCallBudget,
  PHASE74_RUN_LOCK_FILENAME,
  parsePhase74GeneralizationCliOptions,
  persistPhase74RunIdentity,
  retirePhase74CompletedStageIngestion,
  runPhase74GeneralizationSmoke,
  selectPhase74GeneralizationCases,
} from "../../scripts/run-phase-74-generalization";
import { loadPhase74ModelUsageLedger } from "../../src/eval/modelUsage";
import {
  buildEvalRunIdentity,
  hashEvalExperimentIdentity,
} from "../../src/eval/runIdentity";
import { buildPhase74LabelFreeCaseBoundary } from "../../src/eval/phase74Generalization";

describe("phase 74 generalization smoke runner", () => {
  it("retires completed stage ingestion only after receiving the sealed artifact digest", async () => {
    const root = await mkdtemp(join(tmpdir(), "phase74-run-retirement-"));
    const ingestionKey = "a".repeat(64);
    const directory = join(root, "ingestion", ingestionKey);
    try {
      await mkdir(directory, { recursive: true });
      await writeFile(join(directory, "manifest.json"), JSON.stringify({
        key: ingestionKey,
        schemaVersion: 8,
      }));
      await writeFile(
        join(directory, "memory.sqlite"),
        Buffer.from("SQLite format 3\0phase-74-runner\n"),
      );

      const receipts = await retirePhase74CompletedStageIngestion({
        runDirectory: root,
        runId: "run-1",
        snapshots: [{
          costTrace: {
            ingestionKey,
            representation: "fact-only",
          },
        }],
        stage: "E1",
        stageSealSha256: "b".repeat(64),
      });

      expect(receipts).toHaveLength(1);
      expect(receipts[0]).toMatchObject({
        ingestionKey,
        stage: "E1",
        stageSealSha256: "b".repeat(64),
      });
      await expect(readFile(join(directory, "memory.sqlite")))
        .rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("passes disjoint credentials to the sealed executor and scorer", () => {
    const environments = buildPhase74SealedProcessEnvironments({
      env: {
        GOODMEMORY_EMBEDDING_API_KEY: "embedding-secret",
        GOODMEMORY_EMBEDDING_BASE_URL: "embedding-gateway",
        GOODMEMORY_EMBEDDING_MODEL: "embedding-model",
        GOODMEMORY_EMBEDDING_PROVIDER: "openai",
        GOODMEMORY_EVAL_API_KEY: "executor-secret",
        GOODMEMORY_EVAL_BASE_URL: "executor-gateway",
        GOODMEMORY_EVAL_MODEL: "executor-model",
        GOODMEMORY_EVAL_PROVIDER: "openai",
        GOODMEMORY_JUDGE_API_KEY: "judge-secret",
        GOODMEMORY_JUDGE_BASE_URL: "judge-gateway",
        GOODMEMORY_JUDGE_MODEL: "judge-model",
        GOODMEMORY_JUDGE_PROVIDER: "openai",
        GOLD_SENTINEL: "must-not-cross",
        HOME: "/tmp/home",
        PATH: "/usr/bin",
      },
      executorConfig: { role: "executor" },
      scorerConfig: { role: "scorer" },
    });

    expect(environments.executor).toMatchObject({
      GOODMEMORY_EMBEDDING_API_KEY: "embedding-secret",
      GOODMEMORY_EVAL_API_KEY: "executor-secret",
    });
    expect(environments.scorer).toMatchObject({
      GOODMEMORY_JUDGE_API_KEY: "judge-secret",
    });
    expect(JSON.stringify(environments.executor)).not.toContain("judge-secret");
    expect(JSON.stringify(environments.executor)).not.toContain("must-not-cross");
    expect(JSON.stringify(environments.scorer)).not.toContain("executor-secret");
    expect(JSON.stringify(environments.scorer)).not.toContain("embedding-secret");
    expect(JSON.parse(
      environments.executor.GOODMEMORY_PHASE74_EXECUTOR_CONFIG!,
    )).toEqual({ role: "executor" });
    expect(JSON.parse(
      environments.scorer.GOODMEMORY_PHASE74_SCORER_CONFIG!,
    )).toEqual({ role: "scorer" });

    const e4Environments = buildPhase74SealedProcessEnvironments({
      env: {
        GOODMEMORY_EMBEDDING_API_KEY: "embedding-secret",
        GOODMEMORY_EVAL_API_KEY: "reader-secret",
        GOODMEMORY_EVAL_BASE_URL: "reader-gateway",
        GOODMEMORY_EVAL_MODEL: "reader-model",
        GOODMEMORY_EVAL_PROVIDER: "openai",
        GOODMEMORY_JUDGE_API_KEY: "judge-secret",
      },
      executorConfig: {},
      scorerConfig: {},
      scorerNeedsReader: true,
    });
    expect(e4Environments.scorer).toMatchObject({
      GOODMEMORY_EVAL_API_KEY: "reader-secret",
      GOODMEMORY_JUDGE_API_KEY: "judge-secret",
    });
    expect(JSON.stringify(e4Environments.scorer)).not.toContain(
      "embedding-secret",
    );
  });

  it("serializes one live run id and recovers a stale process lock", async () => {
    const root = await mkdtemp(join(tmpdir(), "phase74-run-lock-"));
    try {
      const release = await acquirePhase74RunLock(root);
      await expect(acquirePhase74RunLock(root)).rejects.toThrow(
        "already active",
      );
      await release();

      await writeFile(
        join(root, PHASE74_RUN_LOCK_FILENAME),
        JSON.stringify({ pid: 99_999_999, token: "stale-owner" }),
      );
      const releaseRecovered = await acquirePhase74RunLock(root);
      await releaseRecovered();
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("reuses the first frozen run identity across stage timestamps", async () => {
    const root = await mkdtemp(join(tmpdir(), "phase74-run-identity-"));
    try {
      const first = buildEvalRunIdentity({
        answerModel: { gateway: "g", model: "m", provider: "openai" },
        benchmark: "longmemeval-full",
        configuration: {},
        datasetSha256: "d".repeat(64),
        generatedAt: "2026-07-22T00:00:00.000Z",
        generatedBy: "test",
        judgeModel: { gateway: "g", model: "j", provider: "openai" },
        promptSha256s: { reader: "e".repeat(64) },
        runId: "frozen-run",
      });
      const later = {
        ...first,
        generatedAt: "2026-07-22T01:00:00.000Z",
      };

      expect(await persistPhase74RunIdentity({
        identity: first,
        runDirectory: root,
      })).toEqual(first);
      expect(await persistPhase74RunIdentity({
        identity: later,
        runDirectory: root,
      })).toEqual(first);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("reserves language calls and OpenRouter spend durably before requests", async () => {
    const root = await mkdtemp(join(tmpdir(), "phase74-call-budget-"));
    const path = join(root, "budget.json");
    const requests: string[] = [];
    const fetch = (async (request) => {
      requests.push(String(request));
      return new Response("{}", { status: 200 });
    }) as typeof globalThis.fetch;
    try {
      const budget = createPhase74DurableCallBudget({
        embeddingSpendLimitUsd: 0.0000001,
        fetch,
        maxLanguageCalls: 1,
        path,
      });
      await budget.fetch("https://provider.test/v1/chat/completions");
      await budget.fetch("https://openrouter.ai/api/v1/embeddings", {
        body: JSON.stringify({ input: "abcd" }),
        method: "POST",
      });
      await expect(
        budget.fetch("https://provider.test/v1/chat/completions"),
      ).rejects.toThrow("language-call limit");
      await expect(
        budget.fetch("https://openrouter.ai/api/v1/embeddings", {
          body: JSON.stringify({ input: "xx" }),
          method: "POST",
        }),
      ).rejects.toThrow("embedding spend limit");

      const resumed = createPhase74DurableCallBudget({
        embeddingSpendLimitUsd: 0.0000001,
        fetch,
        maxLanguageCalls: 1,
        path,
      });
      await expect(
        resumed.fetch("https://provider.test/v1/chat/completions"),
      ).rejects.toThrow("language-call limit");
      expect(resumed.snapshot()).toMatchObject({
        embeddingCalls: 1,
        languageCalls: 1,
      });
      expect(requests).toHaveLength(2);
      expect(JSON.parse(await readFile(path, "utf8"))).toEqual(
        resumed.snapshot(),
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("atomically syncs each budget reservation before the provider request", async () => {
    const root = await mkdtemp(join(tmpdir(), "phase74-call-budget-order-"));
    const path = join(root, "budget.json");
    const calls: string[] = [];
    try {
      const budget = createPhase74DurableCallBudget({
        embeddingSpendLimitUsd: 1,
        fetch: (async (_request) => {
          calls.push("provider");
          return new Response("{}", { status: 200 });
        }) as typeof globalThis.fetch,
        fileOperations: {
          close(fd) {
            calls.push(`close:${fd}`);
          },
          fsync(fd) {
            calls.push(`fsync:${fd}`);
          },
          open(target, flags) {
            const directory = target === root;
            calls.push(`open:${directory ? "directory" : "temp"}:${flags}`);
            return directory ? 2 : 1;
          },
          randomId: () => "temporary",
          remove(target) {
            calls.push(`remove:${target.endsWith(".tmp")}`);
          },
          rename(source, destination) {
            calls.push(`rename:${source.endsWith(".tmp")}:${destination === path}`);
          },
          write(fd, value) {
            calls.push(`write:${fd}:${value.endsWith("\n")}`);
          },
        },
        maxLanguageCalls: 2,
        path,
      });
      calls.length = 0;

      await budget.fetch("https://provider.test/v1/chat/completions");

      expect(calls).toEqual([
        "open:temp:wx",
        "write:1:true",
        "fsync:1",
        "close:1",
        "rename:true:true",
        "open:directory:r",
        "fsync:2",
        "close:2",
        "remove:true",
        "provider",
      ]);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("records every frozen provider object-call setting in full run identity", () => {
    const buildConfiguration = buildPhase74FullRunIdentityConfiguration as (
      input: Parameters<typeof buildPhase74FullRunIdentityConfiguration>[0] & {
        protectionBlueprint: { id: string; sha256: string };
      },
    ) => ReturnType<typeof buildPhase74FullRunIdentityConfiguration>;
    const configuration = buildConfiguration({
      callBudget: {
        embeddingSpendLimitUsd: 0.1,
        maxLanguageCalls: 80,
      },
      dataset: { datasetSha256: "dataset-sha" },
      embedding: {
        adapterVersion: "openai-compatible-embedding-v2",
        allowFallbacks: false,
        batchMaxConcurrency: 8,
        batchMaxInputs: 256,
        batchMaxUtf8Bytes: 200_000,
        dimensions: 1_024,
        gateway: "https://openrouter.ai/api/v1",
        inputCostUsdPerMillionTokens: 0.01,
        model: "baai/bge-m3",
        normalization: "l2-v1",
        provider: "openai",
        providerOrder: "parasail",
        requestTimeoutMs: 45_000,
        retryLimit: 8,
      },
      evaluatorSource: { commit: "head", sha256: "source-sha" },
      protectionBlueprint: {
        id: "phase74-protection-suite-manifest-v2",
        sha256: "a".repeat(64),
      },
      replicate: 2,
      reranker: {
        implementation: "lexical-coverage-v1",
        mode: "deterministic",
      },
      scoring: {
        binaryCorrectRule: "yes-substring",
        comparability: "official-prompt-compatible-only",
        primaryMetric: "paired-accuracy",
        scorer: "longmemeval-official-prompt-compatible-qa-accuracy-v1",
      },
      selection: {
        mode: "all",
        populationContentSha256: "population-content-sha",
        populationSize: 500,
        selectedCaseIdsSha256: "case-ids-sha",
        selectedSize: 500,
      },
      selectedCaseIdsSha256: "case-ids-sha",
    });
    expect(configuration).toMatchObject({
      caseScheduling: "interleaved-memory-groups-v1",
      caseConcurrency: 1,
      callBudget: {
        embeddingSpendLimitUsd: 0.1,
        maxLanguageCalls: 80,
      },
      costBoundary: "full-product-standalone-shared-v1",
      embedding: {
        adapterVersion: "openai-compatible-embedding-v2",
        allowFallbacks: false,
        batchMaxConcurrency: 8,
        batchMaxInputs: 256,
        batchMaxUtf8Bytes: 200_000,
        dimensions: 1_024,
        gateway: "https://openrouter.ai/api/v1",
        inputCostUsdPerMillionTokens: 0.01,
        model: "baai/bge-m3",
        normalization: "l2-v1",
        provider: "openai",
        providerOrder: "parasail",
        requestTimeoutMs: 45_000,
        retryLimit: 8,
      },
      providerObjectCalls: {
        assistedExtraction: {
          maxOutputTokens: 4_096,
          reasoningEffort: "low",
          responseFormat: "json_schema",
          requestTimeoutMs: 60_000,
          retryLimit: 4,
          temperature: 0,
        },
        assistedRecallPlan: {
          maxOutputTokens: 1_024,
          requestTimeoutMs: 60_000,
          retryLimit: 4,
          temperature: 0,
        },
        judge: {
          oracle: {
            maxOutputTokens: 512,
            reasoningEffort: "medium",
            requestTimeoutMs: 45_000,
            retryLimit: 3,
            temperature: 0,
          },
          protocol: {
            maxOutputTokens: 10,
            reasoningEffort: "medium",
            requestTimeoutMs: 45_000,
            retryLimit: 3,
            temperature: 0,
          },
        },
        listwiseReranker: {
          maxConcurrency: 1,
          maxOutputTokens: 2_048,
          reasoningEffort: "medium",
          requestTimeoutMs: 60_000,
          retryLimit: 4,
          temperature: 0,
        },
        reader: {
          maxOutputTokens: 512,
          reasoningEffort: "medium",
          requestTimeoutMs: 45_000,
          retryLimit: 3,
          temperature: 0,
        },
      },
      protectionBlueprint: {
        id: "phase74-protection-suite-manifest-v2",
        sha256: "a".repeat(64),
      },
      reranker: {
        implementation: "lexical-coverage-v1",
        mode: "deterministic",
      },
      scoring: {
        binaryCorrectRule: "yes-substring",
        comparability: "official-prompt-compatible-only",
        primaryMetric: "paired-accuracy",
        scorer: "longmemeval-official-prompt-compatible-qa-accuracy-v1",
      },
      selection: {
        mode: "all",
        populationContentSha256: "population-content-sha",
        selectedCaseIdsSha256: "case-ids-sha",
      },
    });

    const identity = (nextConfiguration: typeof configuration) =>
      buildEvalRunIdentity({
        answerModel: {
          gateway: "https://ai.gurkiai.com/v1",
          model: "gpt-5.6-terra",
          provider: "openai",
        },
        benchmark: "longmemeval-full",
        configuration: nextConfiguration,
        datasetSha256: "dataset-sha",
        generatedAt: "2026-07-19T00:00:00.000Z",
        generatedBy: "test",
        judgeModel: {
          gateway: "https://ai.gurkiai.com/v1",
          model: "gpt-5.5",
          provider: "openai",
        },
        promptSha256s: { reader: "reader-sha" },
        runId: "run-1",
      });
    expect(hashEvalExperimentIdentity(identity(configuration))).toBe(
      hashEvalExperimentIdentity(identity(configuration)),
    );
  });

  it("parses an explicit full-family stage and replicate without benchmark fallbacks", () => {
    expect(parsePhase74GeneralizationCliOptions([
      "bun",
      "run-phase-74-generalization.ts",
      "--mode",
      "full",
      "--benchmark",
      "locomo",
      "--benchmark-root",
      "/private/tmp/phase74/locomo",
      "--output-dir",
      "/tmp/reports",
      "--protection-blueprint",
      "/tmp/phase74-protection-blueprint.json",
      "--run-id",
      "locomo-r2",
      "--stage",
      "E3",
      "--reranker-mode",
      "deterministic",
      "--replicate",
      "2",
      "--case-selection-seed",
      "74",
      "--case-selection-size",
      "25",
      "--case-concurrency",
      "10",
      "--max-language-calls",
      "80",
      "--embedding-spend-limit-usd",
      "0.1",
    ])).toEqual({
      benchmark: "locomo",
      benchmarkRoot: "/private/tmp/phase74/locomo",
      caseConcurrency: 10,
      caseSelectionSeed: 74,
      caseSelectionSize: 25,
      embeddingSpendLimitUsd: 0.1,
      maxLanguageCalls: 80,
      mode: "full",
      outputDir: "/tmp/reports",
      protectionBlueprintPath: "/tmp/phase74-protection-blueprint.json",
      replicate: 2,
      rerankerMode: "deterministic",
      runId: "locomo-r2",
      stage: "E3",
    });
    expect(() => parsePhase74GeneralizationCliOptions([
      "bun",
      "run-phase-74-generalization.ts",
      "--mode",
      "full",
      "--benchmark",
      "longmemeval",
      "--benchmark-root",
      "/private/tmp/phase74/longmemeval",
      "--output-dir",
      "/tmp/reports",
      "--protection-blueprint",
      "/tmp/phase74-protection-blueprint.json",
      "--run-id",
      "longmemeval-r1",
      "--stage",
      "E1",
      "--replicate",
      "1",
      "--case-concurrency",
      "0",
    ])).toThrow("--case-concurrency must be a positive integer");
    expect(() => parsePhase74GeneralizationCliOptions([
      "bun",
      "run-phase-74-generalization.ts",
      "--mode",
      "full",
      "--benchmark",
      "longmemeval",
      "--stage",
      "E1",
      "--replicate",
      "4",
    ])).toThrow("--replicate must be 1, 2, or 3");
    expect(() => parsePhase74GeneralizationCliOptions([
      "bun",
      "run-phase-74-generalization.ts",
      "--mode",
      "full",
      "--benchmark",
      "longmemeval",
      "--benchmark-root",
      "/private/tmp/phase74/longmemeval",
      "--output-dir",
      "/tmp/reports",
      "--protection-blueprint",
      "/tmp/phase74-protection-blueprint.json",
      "--run-id",
      "longmemeval-r1",
      "--stage",
      "E1",
      "--replicate",
      "1",
      "--case-selection-size",
      "25",
    ])).toThrow("--case-selection-seed and --case-selection-size must be provided together");
  });

  it("keeps the complete frozen population as the full-run default", () => {
    expect(parsePhase74GeneralizationCliOptions([
      "bun",
      "run-phase-74-generalization.ts",
      "--mode",
      "full",
      "--benchmark",
      "longmemeval",
      "--benchmark-root",
      "/private/tmp/phase74/longmemeval",
      "--output-dir",
      "/tmp/reports",
      "--protection-blueprint",
      "/tmp/phase74-protection-blueprint.json",
      "--run-id",
      "longmemeval-r1",
      "--stage",
      "E1",
      "--replicate",
      "1",
    ])).toEqual({
      benchmark: "longmemeval",
      benchmarkRoot: "/private/tmp/phase74/longmemeval",
      embeddingSpendLimitUsd: 1,
      maxLanguageCalls: 50_000,
      mode: "full",
      outputDir: "/tmp/reports",
      protectionBlueprintPath: "/tmp/phase74-protection-blueprint.json",
      replicate: 1,
      runId: "longmemeval-r1",
      stage: "E1",
    });
  });

  it("selects a deterministic content-bound subset without reading labels", () => {
    const cases = Array.from({ length: 6 }, (_, index) => ({
      caseId: `case-${index + 1}`,
      expectedAnswer: `gold-${index + 1}`,
      goldEvidenceIds: [`gold-evidence-${index + 1}`],
      locale: "en",
      memoryGroupId: `group-${Math.floor(index / 2)}`,
      protocolMetadata: { questionType: `type-${index + 1}` },
      question: `Question ${index + 1}?`,
      rawEvidence: [{
        content: `Evidence ${index + 1}`,
        id: `message-${index + 1}`,
        role: "user" as const,
        sourceIds: [`source-${index + 1}`],
      }],
      referenceTime: "2026-07-19T00:00:00.000Z",
      unresolvedGoldEvidenceIds: [],
    }));

    const selected = selectPhase74GeneralizationCases({
      cases,
      seed: 74,
      size: 3,
    });
    const relabeled = selectPhase74GeneralizationCases({
      cases: cases.map((testCase) => ({
        ...testCase,
        caseId: testCase.caseId === "case-2" ? "q_abs" : testCase.caseId,
        expectedAnswer: `changed-${testCase.caseId}`,
        goldEvidenceIds: ["changed-gold"],
        protocolMetadata: { benchmarkLabel: "changed" },
      })),
      seed: 74,
      size: 3,
    });

    expect(selected.cases.map(({ question }) => question)).toEqual(
      relabeled.cases.map(({ question }) => question),
    );
    expect(selected.identity.populationContentSha256).toBe(
      relabeled.identity.populationContentSha256,
    );
    expect(selected.identity.selectedCaseKeysSha256).toBe(
      relabeled.identity.selectedCaseKeysSha256,
    );
    const changedContent = selectPhase74GeneralizationCases({
      cases: cases.map((testCase, index) =>
        index === 0
          ? {
              ...testCase,
              rawEvidence: [{
                ...testCase.rawEvidence[0]!,
                content: "Changed label-free evidence",
              }],
            }
          : testCase
      ),
      seed: 74,
      size: 3,
    });
    expect(changedContent.identity.populationContentSha256).not.toBe(
      selected.identity.populationContentSha256,
    );
    expect(selected.identity).toMatchObject({
      mode: "deterministic-content-hash-v2",
      populationSize: 6,
      seed: 74,
      selectedSize: 3,
    });
    expect(selected.identity.populationContentSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(selected.identity.selectedCaseIdsSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(selectPhase74GeneralizationCases({ cases }).cases.map(
      ({ labelFreeCaseKey: _labelFreeCaseKey, ...testCase }) => testCase,
    )).toEqual(cases);
  });

  it("assigns unique opaque keys to repeated label-free inputs without case IDs", () => {
    const repeated = Array.from({ length: 2 }, (_, index) => ({
      caseId: `benchmark-case-${index + 1}`,
      expectedAnswer: `gold-${index + 1}`,
      goldEvidenceIds: [],
      memoryGroupId: "conversation-1",
      protocolMetadata: { category: index + 1 },
      question: "What happened?",
      rawEvidence: [{
        content: "The same conversation evidence.",
        id: "message-1",
        sourceIds: ["D1:1"],
      }],
      unresolvedGoldEvidenceIds: [],
    }));

    const selected = selectPhase74GeneralizationCases({ cases: repeated });
    const baseKey = buildPhase74LabelFreeCaseBoundary(repeated[0]!).caseKey;
    const opaqueKeys = selected.cases.map(
      (testCase) => buildPhase74LabelFreeCaseBoundary(testCase).caseKey,
    );
    const relabeled = selectPhase74GeneralizationCases({
      cases: repeated.map((testCase) => ({
        ...testCase,
        caseId: `changed-${testCase.caseId}`,
        expectedAnswer: "changed",
        goldEvidenceIds: ["changed"],
        protocolMetadata: { category: "changed" },
      })),
    });

    expect(new Set(opaqueKeys).size).toBe(2);
    expect(selected.cases[0]).not.toHaveProperty("labelFreeCaseKey");
    expect(opaqueKeys[0]).toBe(baseKey);
    expect(relabeled.cases.map(
      (testCase) => buildPhase74LabelFreeCaseBoundary(testCase).caseKey,
    )).toEqual(opaqueKeys);
  });

  it("fails closed on missing flag values and run ids outside one path segment", () => {
    expect(() => parsePhase74GeneralizationCliOptions([
      "bun",
      "run-phase-74-generalization.ts",
      "--mode",
      "full",
      "--benchmark-root",
      "--output-dir",
      "/tmp/reports",
    ])).toThrow("--benchmark-root requires a value");
    expect(() => parsePhase74GeneralizationCliOptions([
      "bun",
      "run-phase-74-generalization.ts",
      "--mode",
      "full",
      "--benchmark-root",
      "/tmp/benchmark",
      "--output-dir",
      "/tmp/reports",
      "--protection-blueprint",
      "/tmp/phase74-protection-blueprint.json",
      "--run-id",
      "../outside",
      "--stage",
      "E1",
      "--replicate",
      "1",
    ])).toThrow("--run-id must be a single path segment");
  });

  it("replays committed usage when a stage resumes", async () => {
    const root = await mkdtemp(join(tmpdir(), "goodmemory-phase74-usage-"));
    const eventsPath = join(root, "e3-model-usage.jsonl");
    const intentsPath = join(root, "e3-model-usage-intents.jsonl");
    try {
      const intent = {
        attempt: 1,
        branch: "candidate",
        caseId: "case-1",
        modelId: "gpt-5.6-terra",
        operation: "answer_generation",
        providerId: "openai",
        requestId: "request-1",
        schemaVersion: 1,
      } as const;
      const event = {
        attempt: 1,
        branch: "candidate",
        caseId: "case-1",
        completeness: "complete",
        modelId: "gpt-5.6-terra",
        operation: "answer_generation",
        outcome: "succeeded",
        providerId: "openai",
        requestId: "request-1",
        schemaVersion: 1,
        usage: {
          cacheCreationInputTokens: 0,
          cacheReadInputTokens: 0,
          inputTokens: 10,
          outputTokens: 2,
          uncachedInputTokens: 10,
        },
      } as const;
      await writeFile(eventsPath, `${JSON.stringify(event)}\n`, "utf8");
      await writeFile(intentsPath, `${JSON.stringify(intent)}\n`, "utf8");
      expect(await loadPhase74ModelUsageLedger({ eventsPath, intentsPath }))
        .toEqual({ events: [event], intents: [intent], pendingIntents: [] });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("fails closed on a truncated usage event during resume", async () => {
    const root = await mkdtemp(join(tmpdir(), "goodmemory-phase74-usage-"));
    const eventsPath = join(root, "e3-model-usage.jsonl");
    const intentsPath = join(root, "e3-model-usage-intents.jsonl");
    try {
      await writeFile(eventsPath, JSON.stringify({
        branch: "candidate",
        caseId: "case-1",
        schemaVersion: 1,
      }), "utf8");
      await writeFile(intentsPath, "", "utf8");
      await expect(loadPhase74ModelUsageLedger({ eventsPath, intentsPath }))
        .rejects.toThrow(
        "Invalid Phase 74 model usage event",
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("runs the frozen three-case fixture and writes resumable non-promotion artifacts", async () => {
    const root = await mkdtemp(join(tmpdir(), "goodmemory-phase74-generalization-"));
    try {
      const result = await runPhase74GeneralizationSmoke({
        datasetPath: join(
          process.cwd(),
          "fixtures/external-benchmarks/longmemeval/longmemeval_s_smoke.json",
        ),
        generatedAt: "2026-07-18T00:00:00.000Z",
        outputDir: root,
        runId: "smoke-run",
      });

      expect(result.report.status).toBe("not_evaluable");
      expect(result.report.summary.caseCount).toBe(3);
      expect(result.report.executions).toHaveLength(24);
      expect(result.report.e4.cases).toHaveLength(12);
      expect(result.report.oracle).toHaveLength(18);
      expect(result.report.summary.renderedContextMaxTokens).toBeLessThanOrEqual(
        6_000,
      );
      expect(JSON.parse(await readFile(
        join(result.runDirectory, "promotion-gate.json"),
        "utf8",
      ))).toMatchObject({ status: "not_evaluable" });
      expect(JSON.parse(await readFile(
        join(result.runDirectory, "run-identity.json"),
        "utf8",
      ))).toMatchObject({
        benchmark: "longmemeval-smoke",
        configuration: {
          modelUsageAccounting: "not-applicable-deterministic-smoke-v1",
        },
        runId: "smoke-run",
      });
      expect((await readFile(
        join(result.runDirectory, "retrieval-packets.jsonl"),
        "utf8",
      )).trim().split("\n")).toHaveLength(24);

      const resumed = await runPhase74GeneralizationSmoke({
        datasetPath: join(
          process.cwd(),
          "fixtures/external-benchmarks/longmemeval/longmemeval_s_smoke.json",
        ),
        generatedAt: "2026-07-19T00:00:00.000Z",
        outputDir: root,
        runId: "smoke-run",
      });
      expect(resumed.report.identityHash).toBe(result.report.identityHash);
      expect((await readFile(
        join(result.runDirectory, "retrieval-packets.jsonl"),
        "utf8",
      )).trim().split("\n")).toHaveLength(24);
      expect(resumed.report).toEqual(result.report);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});
