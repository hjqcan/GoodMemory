import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildPhase74ContextItems,
  createPhase74FullRetrievalRuntime,
} from "../../src/eval/phase74FullRuntime";
import { buildPhase74LabelFreeCaseBoundary } from "../../src/eval/phase74Generalization";
import {
  loadPhase74ModelUsageLedger,
  type AttributedModelUsageAttempt,
  type AttributedModelUsageIntent,
} from "../../src/eval/modelUsage";
import { createSQLiteDocumentStore } from "../../src/storage/sqlite";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("Phase 74 full retrieval runtime", () => {
  it("joins materialized claim provenance through the canonical source memory", () => {
    expect(buildPhase74ContextItems({
      evidence: [{
        linkedArchiveIds: [],
        linkedMemoryIds: ["fact-1"],
        sourceMessageIds: ["message-1"],
      }],
      records: [{
        content: "The user fixed the mountain bike.",
        id: "claim-1",
        sourceMemoryId: "fact-1",
      }],
      sourceIdsByMessageId: new Map([["message-1", ["D1:1"]]]),
    })).toEqual([{
      content: "The user fixed the mountain bike.",
      id: "claim-1",
      sourceIds: ["D1:1"],
    }]);
  });

  it("seeds one content-addressed SQLite snapshot per memory group and representation", async () => {
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
      const prompt = body.messages?.[1]?.content ?? "";
      const content = system.includes("rank a bounded set")
        ? JSON.stringify({
            orderedCandidateIds: [...prompt.matchAll(/"id":"([^"]+)"/gu)]
              .map((match) => match[1]),
          })
        : system.includes("Convert substantive dialogue")
          ? JSON.stringify({
              c: [{
                c: "Caroline adopted a dog named Pepper.",
                m: { ca: "personal" },
                s: 0,
              }],
              i: 0,
            })
          : JSON.stringify({
              candidates: [{
                content: "Caroline adopted a dog named Pepper.",
                explicitness: "explicit",
                id: "fact-1",
                kindHint: "fact",
                metadata: { category: "personal" },
                sourceMessageIndex: 0,
                sourceRole: "assistant",
              }],
              ignoredMessageCount: 0,
            });
      return new Response(JSON.stringify({
        choices: [{
          finish_reason: "stop",
          index: 0,
          message: {
            content,
            role: "assistant",
          },
        }],
        model: "gpt-5.6-terra",
        object: "chat.completion",
        usage: { completion_tokens: 2, prompt_tokens: 10 },
      }), { headers: { "content-type": "application/json" } });
    }) as typeof fetch;

    const root = await mkdtemp(join(tmpdir(), "phase74-full-runtime-"));
    try {
      const events: AttributedModelUsageAttempt[] = [];
      const intents: AttributedModelUsageIntent[] = [];
      const languageModel = {
        apiKey: "test-key",
        baseURL: "https://provider.test/v1",
        model: "gpt-5.6-terra",
        provider: "openai" as const,
      };
      const runtime = createPhase74FullRetrievalRuntime({
        datasetSha256: "dataset-sha",
        evaluatorSourceSha256:
          "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        events,
        intents,
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
        runDirectory: root,
        promptSha256s: {
          assistedExtraction:
            "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
          conversationalExtraction:
            "123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0",
        },
      });
      const configuration = {
        planner: { mode: "off" },
        representation: "atomic-contextual-raw-pointer",
        retrieval: {
          generalizedFusionChannels: [
            "lexical",
            "dense",
            "entity",
            "temporal",
            "relation",
          ],
          recallPlanExecution: false,
        },
      } as const;
      const testCase = {
        caseId: "conversation-1/q1",
        locale: "en",
        memoryGroupId: "conversation-1",
        question: "What is Caroline's dog's name?",
        rawEvidence: [{
          content: "Caroline: I adopted a dog named Pepper.",
          id: "conversation-1/D1:1",
          observedAt: "2023-05-08T00:00:00.000Z",
          role: "assistant",
          sourceIds: ["D1:1"],
        }, {
          content: "Caroline: Pepper likes long walks.",
          id: "conversation-1/D1:2",
          observedAt: "2023-05-08T00:01:00.000Z",
          role: "user",
          sourceIds: ["D1:2"],
        }],
      };
      const labelFreeCase = buildPhase74LabelFreeCaseBoundary({
        ...testCase,
        expectedAnswer: "Pepper",
        goldEvidenceIds: ["D1:1"],
      }).recallCase;

      const first = await runtime.execute({
        arm: "atomic-contextual-raw-pointer",
        configuration,
        stage: "E1",
        testCase: labelFreeCase,
      });
      const second = await runtime.execute({
        arm: "atomic-contextual-raw-pointer",
        configuration,
        stage: "E1",
        testCase: {
          ...labelFreeCase,
          caseId: "conversation-1/q2",
          question: "What kind of pet did Caroline adopt?",
        },
      });
      const factOnly = await runtime.execute({
        arm: "fact-only",
        configuration: {
          ...configuration,
          representation: "fact-only",
        },
        stage: "E1",
        testCase: labelFreeCase,
      });
      const rawOnly = await runtime.execute({
        arm: "raw-only",
        configuration: {
          ...configuration,
          representation: "raw-only",
        },
        stage: "E1",
        testCase: labelFreeCase,
      });
      const e2Baseline = await runtime.execute({
        arm: "claim-temporal-off",
        configuration,
        stage: "E2",
        testCase: labelFreeCase,
      });
      const e2Candidate = await runtime.execute({
        arm: "claim-temporal-on",
        configuration,
        stage: "E2",
        testCase: labelFreeCase,
      });

      expect(first.storedMemories.map(({ content }) => content)).toContain(
        "Caroline adopted a dog named Pepper.",
      );
      expect(first.recallMetadata?.latencyMs).toBeGreaterThanOrEqual(0);
      expect(first.recallMetadata?.queryPathLatencyMs).toBeGreaterThanOrEqual(
        first.recallMetadata?.latencyMs ?? 0,
      );
      expect(first.recallMetadata?.candidateTraces.length).toBeGreaterThan(0);
      expect(first.recallMetadata?.retrievalTrace).toBeDefined();
      expect(second.storedMemories.map(({ content }) => content)).toContain(
        "Caroline adopted a dog named Pepper.",
      );
      expect(factOnly.storedMemories.map(({ content }) => content)).toContain(
        "Caroline adopted a dog named Pepper.",
      );
      expect(rawOnly.storedMemories.map(({ content }) => content)).toEqual([
        "Caroline: I adopted a dog named Pepper.",
        "Caroline: Pepper likes long walks.",
      ]);
      expect(events.filter(
        ({ operation }) => operation === "assisted_extraction",
      )).toHaveLength(0);
      expect(first.costTrace).toMatchObject({
        comparisonBranch: "candidate",
        representation: "atomic-contextual-raw-pointer",
      });
      expect(second.costTrace?.ingestionKey).toBe(
        first.costTrace?.ingestionKey,
      );
      expect(e2Baseline.costTrace).toMatchObject({
        comparisonBranch: "baseline",
        ingestionKey: first.costTrace?.ingestionKey,
      });
      expect(e2Candidate.costTrace).toMatchObject({
        comparisonBranch: "candidate",
        ingestionKey: first.costTrace?.ingestionKey,
      });
      expect(factOnly.costTrace?.ingestionKey).not.toBe(
        first.costTrace?.ingestionKey,
      );
      expect(rawOnly.costTrace?.ingestionKey).not.toBe(
        first.costTrace?.ingestionKey,
      );

      const ingestionUsageDirectories = await readdir(
        join(root, "ingestion-usage"),
      );
      expect(ingestionUsageDirectories).toHaveLength(3);
      const ingestionLedgers = await Promise.all(
        ingestionUsageDirectories.map((directory) =>
          loadPhase74ModelUsageLedger({
            eventsPath: join(root, "ingestion-usage", directory, "events.jsonl"),
            intentsPath: join(root, "ingestion-usage", directory, "intents.jsonl"),
          })
        ),
      );
      expect(ingestionLedgers.flatMap(({ events }) => events).filter(
        ({ operation }) => operation === "assisted_extraction",
      )).toHaveLength(2);
      const ingestionDirectories = await readdir(join(root, "ingestion"));
      for (const directory of ingestionDirectories) {
        const store = createSQLiteDocumentStore(
          join(root, "ingestion", directory, "memory.sqlite"),
        );
        const facts = await store.query<{ accessCount: number }>("facts");
        expect(facts.every(({ accessCount }) => accessCount === 0)).toBe(true);
      }
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});
