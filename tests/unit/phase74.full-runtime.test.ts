import { describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  assertPhase74IngestionRememberResult,
  assertPhase74RecallProviderIntegrity,
  assertPhase74RetrievedProvenance,
  buildPhase74IngestionUsageAllocation,
  buildPhase74IngestionKey,
  buildPhase74IngestionUsagePaths,
  buildPhase74IngestionUsageFingerprint,
  buildPhase74LabelFreeScope,
  createPhase74FullRetrievalRuntime,
  phase74ExecutionBranch,
  verifyPhase74IngestionUsageManifest,
} from "../../src/eval/phase74FullRuntime";
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
    gateway: "https://ai.gurkiai.com/v1",
    model: "embedding-v1",
    provider: "openai",
  },
  evaluatorSourceSha256:
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  extraction: {
    contextualDescriptors: true,
    extractorVersion: "provider-memory-extractor-v1",
    gateway: "https://ai.gurkiai.com/v1",
    maxOutputTokens: 4_096,
    model: "gpt-5.6-terra",
    promptSha256:
      "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
    provider: "openai",
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

  it("records ingestion use before a later query-path failure", async () => {
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
      return new Response(JSON.stringify({
        choices: [{
          finish_reason: "stop",
          index: 0,
          message: {
            content: JSON.stringify({
              candidates: [{
                content: "Caroline adopted a dog named Pepper.",
                explicitness: "explicit",
                id: "fact-1",
                kindHint: "fact",
                metadata: { category: "personal" },
                sourceMessageIndex: 0,
                sourceRole: "user",
              }],
              ignoredMessageCount: 0,
              score: 0.9,
            }),
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
        events: [],
        intents: [],
        models: {
          answer: languageModel,
          assistedExtraction: languageModel,
          embedding: { ...languageModel, model: "embedding-test" },
          judge: { ...languageModel, model: "gpt-5.5" },
          planner: languageModel,
          reranker: languageModel,
        },
        onIngestionUse(use) {
          uses.push(use);
          throw new Error("query path unavailable");
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

      await expect(runtime.execute({
        arm: "recall-plan-off",
        configuration: {
          planner: { mode: "off" },
          representation: "atomic-contextual-raw-pointer",
          retrieval: { recallPlanExecution: false },
        },
        stage: "E3",
        testCase: {
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
        },
      })).rejects.toThrow("query path unavailable");
      expect(uses).toHaveLength(1);
      const allocation = buildPhase74IngestionUsageAllocation(
        uses.map((costTrace) => ({ costTrace })),
      );
      expect(allocation.baselineExclusive).toHaveLength(1);
      expect(allocation.candidateExclusive).toEqual([]);
      expect(allocation.shared).toEqual([]);
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
        schemaVersion: 6,
        usage: buildPhase74IngestionUsageFingerprint(ledger),
      }));
      await expect(verifyPhase74IngestionUsageManifest({
        ingestionKey: key,
        ledger,
        runDirectory: root,
      })).resolves.toBeUndefined();

      await writeFile(manifestPath, JSON.stringify({
        key,
        schemaVersion: 6,
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
