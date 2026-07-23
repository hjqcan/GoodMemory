import { describe, expect, it } from "bun:test";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  assertPhase74IngestionRememberResult,
  assertPhase74RecallProviderIntegrity,
  assertPhase74RetrievedProvenance,
  buildPhase74IngestionUsageAllocation,
  buildPhase74IngestionDescriptor,
  buildPhase74IngestionKey,
  buildPhase74IngestionUsagePaths,
  buildPhase74IngestionUsageFingerprint,
  buildPhase74IngestionAnnotations,
  buildPhase74LabelFreeScope,
  buildPhase74RetrievalSnapshotId,
  createPhase74FullRetrievalRuntime,
  phase74ExecutionBranch,
  restorePhase74RetiredIngestionSnapshot,
  verifyPhase74IngestionUsageManifest,
} from "../../src/eval/phase74FullRuntime";
import { buildPhase74EmbeddingIdentity } from "../../src/eval/phase74Live";
import {
  archivePhase74IngestionSnapshot,
} from "../../src/eval/phase74IngestionRetirement";
import {
  createAttributedModelUsageSink,
  validatePhase74ModelUsageLedger,
  type AttributedModelUsageAttempt,
  type AttributedModelUsageIntent,
} from "../../src/eval/modelUsage";

const base = {
  datasetSha256: "dataset-sha",
  embedding: {
    adapterVersion: "openai-compatible-embedding-v1",
    batchMaxConcurrency: 8,
    batchMaxInputs: 256,
    batchMaxUtf8Bytes: 200_000,
    gateway: "https://openrouter.ai/api/v1",
    model: "text-embedding-3-small",
    provider: "openai",
    requestTimeoutMs: 45_000,
    retryLimit: 8,
  },
  evaluatorSourceSha256:
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  extraction: {
    contextualDescriptors: true,
    extractorVersion: "provider-memory-extractor-v1",
    gateway: "https://ai.gurkiai.com/v1",
    maxOutputTokens: 4_096,
    model: "gpt-5.6-terra",
    outputProtocol: "compact-conversational-v1",
    promptSha256:
      "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
    provider: "openai",
    reasoningEffort: "low",
    responseFormat: "json_schema",
    temperature: 0,
  },
  memoryGroupId: "conversation-1",
  rawEvidence: [{
    content: "Caroline adopted Pepper.",
    id: "conversation-1/D1:1",
    observedAt: "2023-05-08",
    role: "user",
    sourceIds: ["D1:1"],
  }],
  referenceTime: "2024-01-01T00:00:00.000Z",
  representation: "atomic-contextual-raw-pointer",
} as const;

describe("Phase 74 full ingestion identity", () => {
  it("restores a retired snapshot before attempting paid re-ingestion", async () => {
    const root = await mkdtemp(join(tmpdir(), "phase74-ingestion-restore-"));
    const ingestionKey = "a".repeat(64);
    const directory = join(root, "ingestion", ingestionKey);
    const sqlitePath = join(directory, "memory.sqlite");
    const manifestPath = join(directory, "manifest.json");
    const receiptPath = join(
      root,
      "ingestion-retirement",
      `${ingestionKey}.json`,
    );
    const sqliteBytes = Buffer.from("SQLite format 3\0phase-74-runtime\n");
    try {
      await mkdir(directory, { recursive: true });
      await writeFile(manifestPath, JSON.stringify({
        key: ingestionKey,
        schemaVersion: 8,
      }));
      await writeFile(sqlitePath, sqliteBytes);
      await archivePhase74IngestionSnapshot({
        archiveRoot: join(root, "ingestion-archive"),
        ingestionKey,
        receiptPath,
        representation: "fact-only",
        runId: "run-1",
        sourceManifestPath: manifestPath,
        sourceSqlitePath: sqlitePath,
        stage: "E1",
        stageSealSha256: "b".repeat(64),
      });
      await expect(access(sqlitePath)).rejects.toMatchObject({ code: "ENOENT" });

      await expect(restorePhase74RetiredIngestionSnapshot({
        ingestionKey,
        representation: "fact-only",
        runDirectory: root,
        sqlitePath,
      })).resolves.toBe(true);
      expect(await readFile(sqlitePath)).toEqual(sqliteBytes);

      await expect(restorePhase74RetiredIngestionSnapshot({
        ingestionKey: "c".repeat(64),
        representation: "fact-only",
        runDirectory: root,
        sqlitePath: join(root, "missing", "memory.sqlite"),
      })).resolves.toBe(false);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("forces raw evidence only for the raw representation", () => {
    const messages = [
      { content: "User fact", role: "user" as const },
      { content: "Assistant fact", role: "assistant" as const },
    ];

    expect(buildPhase74IngestionAnnotations({
      messages,
      representation: "raw-only",
    })).toEqual([
      {
        confirmed: true,
        kindHint: "fact",
        messageIndex: 0,
        reason: "Preserve immutable external benchmark evidence.",
        remember: "always",
        verified: true,
      },
      {
        confirmed: true,
        kindHint: "fact",
        messageIndex: 1,
        reason: "Preserve immutable external benchmark evidence.",
        remember: "always",
        verified: true,
      },
    ]);
    for (const representation of [
      "fact-only",
      "atomic-contextual-raw-pointer",
    ]) {
      expect(buildPhase74IngestionAnnotations({
        messages,
        representation,
      })).toEqual([{
        confirmed: true,
        messageIndex: 1,
        remember: "auto",
        verified: true,
      }]);
    }
  });

  it("fails closed when a retrieved memory loses its immutable source pointer", () => {
    expect(() => assertPhase74RetrievedProvenance([{
      id: "fact-1",
      sourceIds: ["D1:1"],
    }])).not.toThrow();

    expect(() => assertPhase74RetrievedProvenance([{
      id: "fact-1",
      sourceIds: [],
    }])).toThrow("missing immutable source ids");
  });

  it("fails closed when a paid retrieval arm falls back from its provider", () => {
    expect(() => assertPhase74RecallProviderIntegrity({
      plannerMode: "deterministic",
      policyApplied: [],
      reranker: {
        fallbackReason: "provider_error",
        status: "fallback",
      },
    })).toThrow("provider reranker fell back");

    expect(() => assertPhase74RecallProviderIntegrity({
      plannerMode: "assisted",
      policyApplied: ["recall_plan_assistant_fallback"],
      reranker: { status: "applied" },
    })).toThrow("assisted recall plan fell back");

    expect(() => assertPhase74RecallProviderIntegrity({
      plannerMode: "deterministic",
      policyApplied: [],
      reranker: { status: "skipped" },
    })).not.toThrow();

    expect(() => assertPhase74RecallProviderIntegrity({
      plannerMode: "deterministic",
      policyApplied: ["generalized_fusion_unavailable"],
      reranker: { status: "skipped" },
    })).toThrow("generalized fusion unavailable");

    expect(() => assertPhase74RecallProviderIntegrity({
      plannerMode: "deterministic",
      policyApplied: ["generalized_fusion_partial_projection"],
      reranker: { status: "skipped" },
    })).toThrow("generalized fusion projection incomplete");
  });

  it("fails closed when assisted extraction silently degrades to rules-only", () => {
    expect(() => assertPhase74IngestionRememberResult({
      extractionStrategy: "llm-assisted",
      result: {
        accepted: 1,
        events: [],
        rejected: 0,
        warnings: ["assisted_extraction_failed"],
      },
    })).toThrow("assisted extraction failed");

    expect(() => assertPhase74IngestionRememberResult({
      extractionStrategy: "rules-only",
      result: {
        accepted: 1,
        events: [],
        rejected: 0,
        warnings: ["assisted_extraction_failed"],
      },
    })).not.toThrow();
  });

  it("uses an opaque stable scope that cannot reveal family, run, or case labels", () => {
    const scope = buildPhase74LabelFreeScope({
      caseId: "locomo/conversation-1/q1",
      memoryGroupId: "conversation-1",
      question: "What happened?",
      rawEvidence: [],
    });

    expect(scope.workspaceId).toMatch(/^workspace-[0-9a-f]{32}$/u);
    expect(scope.userId).toMatch(/^user-[0-9a-f]{32}$/u);
    expect(JSON.stringify(scope)).not.toContain("locomo");
    expect(JSON.stringify(scope)).not.toContain("conversation-1");
    expect(JSON.stringify(scope).toLowerCase()).not.toContain("phase74");
  });

  it("attributes only frozen baseline and candidate arms to promotion cost branches", () => {
    expect(phase74ExecutionBranch("E1", "fact-only")).toBe("baseline");
    expect(phase74ExecutionBranch("E1", "atomic-contextual-raw-pointer")).toBe(
      "candidate",
    );
    expect(phase74ExecutionBranch("E1", "raw-only")).toBe("shadow");
    expect(phase74ExecutionBranch("E2", "claim-temporal-off")).toBe("baseline");
    expect(phase74ExecutionBranch("E2", "claim-temporal-on")).toBe("candidate");
    expect(phase74ExecutionBranch("E3", "recall-plan-off")).toBe("baseline");
    expect(phase74ExecutionBranch("E3", "recall-plan-deterministic")).toBe(
      "candidate",
    );
    expect(phase74ExecutionBranch("E3", "recall-plan-assisted")).toBe("shadow");
  });

  it("reuses one group/representation snapshot across queries and retrieval arms", () => {
    const first = buildPhase74IngestionKey(base);
    const second = buildPhase74IngestionKey({ ...base });
    expect(second).toBe(first);
  });

  it("pins the projection-proof ingestion key schema", () => {
    expect(buildPhase74IngestionKey(base)).toBe(
      "e6cda0b236b366502f748bf93ed2056920679e9d49867a7c1bc52aedefc0effe",
    );
  });

  it("changes the ingestion identity when extraction reasoning effort changes", () => {
    expect(buildPhase74IngestionKey({
      ...base,
      extraction: { ...base.extraction, reasoningEffort: "medium" },
    })).not.toBe(buildPhase74IngestionKey(base));
  });

  it("binds the complete BGE profile into the runtime ingestion identity", () => {
    const languageModel = {
      baseURL: base.extraction.gateway,
      model: base.extraction.model,
      provider: "openai" as const,
    };
    const embeddingModel = {
      baseURL: "https://openrouter.ai/api/v1",
      model: "baai/bge-m3",
      provider: "openai" as const,
    };
    const descriptor = buildPhase74IngestionDescriptor({
      configuration: {
        representation: "atomic-contextual-raw-pointer",
      },
      datasetSha256: base.datasetSha256,
      evaluatorSourceSha256: base.evaluatorSourceSha256,
      models: {
        answer: languageModel,
        assistedExtraction: languageModel,
        embedding: embeddingModel,
        planner: languageModel,
        reranker: languageModel,
      },
      promptSha256s: {
        conversationalExtraction: base.extraction.promptSha256,
      },
      testCase: {
        caseId: "case-1",
        memoryGroupId: base.memoryGroupId,
        question: "What happened?",
        rawEvidence: base.rawEvidence,
        referenceTime: base.referenceTime,
      },
    });

    expect(descriptor.key).toBe(buildPhase74IngestionKey({
      ...base,
      embedding: buildPhase74EmbeddingIdentity(embeddingModel),
      extraction: {
        ...base.extraction,
        extractorVersion: "provider-conversational-memory-extractor-v3",
        responseFormat: "json_object",
      },
    }));
  });

  it("allocates unique ingestion keys as baseline-exclusive, candidate-exclusive, or shared", () => {
    const baselineKey = "a".repeat(64);
    const candidateKey = "b".repeat(64);
    const sharedKey = "c".repeat(64);
    const shadowKey = "d".repeat(64);
    const snapshot = (
      comparisonBranch: "baseline" | "candidate" | "shadow",
      ingestionKey: string,
      representation: string,
    ) => ({
      costTrace: { comparisonBranch, ingestionKey, representation },
      retrievedMemories: [],
      snapshotId: ingestionKey,
      storedMemories: [],
    });

    expect(buildPhase74IngestionUsageAllocation([
      snapshot("baseline", baselineKey, "fact-only"),
      snapshot("baseline", sharedKey, "atomic-contextual-raw-pointer"),
      snapshot("candidate", candidateKey, "atomic-contextual-raw-pointer"),
      snapshot("candidate", sharedKey, "atomic-contextual-raw-pointer"),
      snapshot("candidate", sharedKey, "atomic-contextual-raw-pointer"),
      snapshot("shadow", shadowKey, "raw-only"),
    ])).toEqual({
      baselineExclusive: [baselineKey],
      candidateExclusive: [candidateKey],
      shared: [sharedKey],
    });

    expect(buildPhase74IngestionUsagePaths("/run", sharedKey)).toEqual({
      eventsPath: `/run/ingestion-usage/${sharedKey}/events.jsonl`,
      intentsPath: `/run/ingestion-usage/${sharedKey}/intents.jsonl`,
    });
  });

  it("binds the deterministic E3 evidence ledger and records later query failure", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (request, init) => {
      const url = typeof request === "string"
        ? request
        : request instanceof URL
          ? request.toString()
          : request.url;
      if (url.endsWith("/embeddings")) {
        const body = JSON.parse(String(init?.body)) as { input: string[] | string };
        const values = Array.isArray(body.input) ? body.input : [body.input];
        return new Response(JSON.stringify({
          data: values.map((_, index) => ({ embedding: [1, 0, 0], index })),
          model: "embedding-test",
          object: "list",
          usage: { prompt_tokens: values.length, total_tokens: values.length },
        }), { headers: { "content-type": "application/json" } });
      }
      const body = JSON.parse(String(init?.body)) as {
        messages?: Array<{ content?: string }>;
      };
      const system = body.messages?.[0]?.content ?? "";
      return new Response(JSON.stringify({
        choices: [{
          finish_reason: "stop",
          index: 0,
          message: {
            content: system.includes("Convert substantive dialogue")
              ? JSON.stringify({
                  c: [{
                    c: "Caroline adopted a dog named Pepper.",
                    m: { ca: "personal" },
                    s: 0,
                  }],
                  i: 0,
                })
              : JSON.stringify({ candidates: [], ignoredMessageCount: 0 }),
            role: "assistant",
          },
        }],
        model: "gpt-5.6-terra",
        object: "chat.completion",
        usage: { completion_tokens: 2, prompt_tokens: 10 },
      }), { headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    const root = await mkdtemp(join(tmpdir(), "phase74-ingestion-use-"));
    const uses: Array<{
      comparisonBranch: "baseline" | "candidate" | "shadow";
      ingestionKey: string;
      representation: string;
    }> = [];
    const languageModel = {
      apiKey: "test-key",
      baseURL: "https://provider.test/v1",
      model: "gpt-5.6-terra",
      provider: "openai" as const,
    };
    try {
      const runtime = createPhase74FullRetrievalRuntime({
        datasetSha256: "dataset-sha",
        evaluatorSourceSha256:
          "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        evidenceLedgerFormats: ["compact_json"],
        events: [],
        intents: [],
        models: {
          answer: languageModel,
          assistedExtraction: languageModel,
          embedding: {
            ...languageModel,
            baseURL: "https://openrouter.ai/api/v1",
            model: "text-embedding-3-small",
          },
          planner: languageModel,
          reranker: languageModel,
        },
        onIngestionUse(use) {
          uses.push(use);
          if (use.comparisonBranch === "baseline") {
            throw new Error("query path unavailable");
          }
        },
        promptSha256s: {
          assistedExtraction:
            "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
          conversationalExtraction:
            "123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0",
        },
        rerankerMode: "deterministic",
        runDirectory: root,
      });

      const testCase = {
        caseId: "case-1",
        memoryGroupId: "conversation-1",
        question: "What is Caroline's dog's name?",
        rawEvidence: [{
          content: "Caroline adopted a dog named Pepper.",
          id: "message-1",
          observedAt: "2023-05-08T00:00:00.000Z",
          role: "user",
          sourceIds: ["D1:1"],
        }],
        referenceTime: "2024-01-01T00:00:00.000Z",
      };
      const deterministic = await runtime.execute({
        arm: "recall-plan-deterministic",
        configuration: {
          planner: { mode: "deterministic" },
          representation: "atomic-contextual-raw-pointer",
          retrieval: { recallPlanExecution: true },
        },
        stage: "E3",
        testCase,
      });
      expect(deterministic.evidenceLedger?.length).toBeGreaterThan(0);
      expect(Object.keys(deterministic.evidenceLedgers ?? {})).toEqual([
        "compact_json",
      ]);
      expect(
        deterministic.evidenceLedgerRenderLatencyMs?.compact_json,
      ).toBeGreaterThanOrEqual(0);
      expect(deterministic.snapshotId).toBe(buildPhase74RetrievalSnapshotId({
        arm: "recall-plan-deterministic",
        costTrace: deterministic.costTrace,
        evidenceLedger: deterministic.evidenceLedger,
        evidenceLedgers: deterministic.evidenceLedgers,
        retrievedMemories: deterministic.retrievedMemories,
        stage: "E3",
        storedMemories: deterministic.storedMemories,
      }));
      const [firstEntry, ...remainingEntries] = deterministic.evidenceLedger!;
      expect(buildPhase74RetrievalSnapshotId({
        arm: "recall-plan-deterministic",
        costTrace: deterministic.costTrace,
        evidenceLedger: [{
          ...firstEntry!,
          excerpt: `${firstEntry!.excerpt} changed`,
        }, ...remainingEntries],
        evidenceLedgers: deterministic.evidenceLedgers,
        retrievedMemories: deterministic.retrievedMemories,
        stage: "E3",
        storedMemories: deterministic.storedMemories,
      })).not.toBe(deterministic.snapshotId);

      await expect(runtime.execute({
        arm: "recall-plan-off",
        configuration: {
          planner: { mode: "off" },
          representation: "atomic-contextual-raw-pointer",
          retrieval: { recallPlanExecution: false },
        },
        stage: "E3",
        testCase,
      })).rejects.toThrow("query path unavailable");
      expect(uses).toHaveLength(2);
      const allocation = buildPhase74IngestionUsageAllocation(
        uses.map((costTrace) => ({ costTrace })),
      );
      expect(allocation.baselineExclusive).toEqual([]);
      expect(allocation.candidateExclusive).toEqual([]);
      expect(allocation.shared).toHaveLength(1);
    } finally {
      globalThis.fetch = originalFetch;
      await rm(root, { force: true, recursive: true });
    }
  });

  it("revalidates the committed ingestion manifest against its physical WAL", async () => {
    const root = await mkdtemp(join(tmpdir(), "phase74-ingestion-manifest-"));
    const key = "a".repeat(64);
    const events: AttributedModelUsageAttempt[] = [];
    const intents: AttributedModelUsageIntent[] = [];
    createAttributedModelUsageSink({
      branch: "shadow",
      caseId: "group-1",
      events,
      intents,
    }).emit({
      attempt: 1,
      completeness: "complete",
      modelId: "gpt-5.6-terra",
      operation: "assisted_extraction",
      outcome: "succeeded",
      providerId: "openai",
      schemaVersion: 1,
      usage: {
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        inputTokens: 10,
        outputTokens: 2,
        uncachedInputTokens: 10,
      },
    });
    const ledger = validatePhase74ModelUsageLedger({ events, intents });
    const directory = join(root, "ingestion", key);
    const manifestPath = join(directory, "manifest.json");
    await mkdir(directory, { recursive: true });
    try {
      await writeFile(manifestPath, JSON.stringify({
        key,
        schemaVersion: 8,
        usage: buildPhase74IngestionUsageFingerprint(ledger),
      }));
      await expect(verifyPhase74IngestionUsageManifest({
        ingestionKey: key,
        ledger,
        runDirectory: root,
      })).resolves.toBeUndefined();

      await writeFile(manifestPath, JSON.stringify({
        key,
        schemaVersion: 8,
        usage: {
          ...buildPhase74IngestionUsageFingerprint(ledger),
          eventCount: 0,
        },
      }));
      await expect(verifyPhase74IngestionUsageManifest({
        ingestionKey: key,
        ledger,
        runDirectory: root,
      })).rejects.toThrow("manifest drift");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("misses when evidence, time, representation, model, prompt, evaluator source, or descriptors change", () => {
    const key = buildPhase74IngestionKey(base);
    expect(buildPhase74IngestionKey({
      ...base,
      rawEvidence: [{ ...base.rawEvidence[0], content: "changed" }],
    })).not.toBe(key);
    expect(buildPhase74IngestionKey({
      ...base,
      referenceTime: "2025-01-01T00:00:00.000Z",
    })).not.toBe(key);
    expect(buildPhase74IngestionKey({
      ...base,
      representation: "fact-only",
    })).not.toBe(key);
    expect(buildPhase74IngestionKey({
      ...base,
      extraction: { ...base.extraction, model: "other-model" },
    })).not.toBe(key);
    expect(buildPhase74IngestionKey({
      ...base,
      embedding: { ...base.embedding, gateway: "https://other.example/v1" },
    })).not.toBe(key);
    expect(buildPhase74IngestionKey({
      ...base,
      extraction: { ...base.extraction, contextualDescriptors: false },
    })).not.toBe(key);
    expect(buildPhase74IngestionKey({
      ...base,
      extraction: { ...base.extraction, outputProtocol: "canonical-v1" },
    })).not.toBe(key);
    expect(buildPhase74IngestionKey({
      ...base,
      extraction: { ...base.extraction, promptSha256: "changed-prompt" },
    })).not.toBe(key);
    expect(buildPhase74IngestionKey({
      ...base,
      extraction: { ...base.extraction, maxOutputTokens: 2_048 },
    })).not.toBe(key);
    expect(buildPhase74IngestionKey({
      ...base,
      extraction: { ...base.extraction, temperature: 0.2 },
    })).not.toBe(key);
    expect(buildPhase74IngestionKey({
      ...base,
      evaluatorSourceSha256: "changed-source",
    })).not.toBe(key);
  });
});
