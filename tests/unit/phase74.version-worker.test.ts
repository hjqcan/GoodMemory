import { describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  preparePhase74VersionMemoryGroup,
  queryPhase74VersionMemoryGroup,
  runPhase74VersionWorker,
  type Phase74VersionGoodMemory,
} from "../../scripts/phase74-version-worker";
import { PHASE74_RELEASE_COMMIT } from "../../src/eval/phase74VersionBaseline";

describe("Phase 74 version worker", () => {
  it("ingests one release memory group once and clones it for multiple queries", async () => {
    const root = await mkdtemp(join(tmpdir(), "phase74-version-group-"));
    const sqlitePath = join(root, "memory.sqlite");
    await writeFile(sqlitePath, "prepared", "utf8");
    const configurations: Array<Record<string, unknown>> = [];
    let rememberCount = 0;
    let recallCount = 0;
    const createGoodMemory = (configuration: unknown): Phase74VersionGoodMemory => {
      configurations.push(configuration as Record<string, unknown>);
      return {
        async exportMemory() {
          return { durable: { evidence: [], facts: [] } };
        },
        async recall() {
          recallCount += 1;
          return { evidence: [], facts: [], metadata: { latencyMs: 0 } };
        },
        async remember(input) {
          rememberCount += 1;
          return { accepted: input.messages.length, rejected: 0, warnings: [] };
        },
      };
    };
    const first = {
      arm: "release" as const,
      caseId: "conversation-1/q1",
      memoryGroupId: "conversation-1",
      question: "What did Caroline adopt?",
      rawEvidence: [{
        content: "Caroline adopted Pepper.",
        id: "conversation-1/D1:1",
        sourceIds: ["D1:1"],
      }],
      schemaVersion: 1 as const,
      sourceCommit: PHASE74_RELEASE_COMMIT,
    };
    try {
      const prepared = await preparePhase74VersionMemoryGroup({
        createGoodMemory,
        input: first,
        models: {
          embedding: { apiKey: "e", model: "embed", provider: "openai" },
          extraction: { apiKey: "x", model: "extract", provider: "openai" },
        },
        sqlitePath,
      });
      await queryPhase74VersionMemoryGroup({ prepared, input: first });
      await queryPhase74VersionMemoryGroup({
        prepared,
        input: {
          ...first,
          caseId: "conversation-1/q2",
          question: "What is Pepper's name?",
        },
      });

      expect(rememberCount).toBe(1);
      expect(recallCount).toBe(2);
      expect(configurations).toHaveLength(3);
      expect(configurations[0]).not.toHaveProperty("adapters");
      const queryStoragePaths = configurations.slice(1).map((configuration) =>
        (configuration.storage as { url: string }).url
      );
      expect(new Set(queryStoragePaths).size).toBe(2);
      expect(queryStoragePaths.every((path) => path !== sqlitePath)).toBeTrue();
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("keeps opaque turns from one source session in one remember call", async () => {
    const remembered: Array<{ messageCount: number; sessionId: string }> = [];
    const memory: Phase74VersionGoodMemory = {
      async exportMemory() {
        return { durable: { evidence: [], facts: [] } };
      },
      async recall() {
        return { evidence: [], facts: [], metadata: { latencyMs: 0 } };
      },
      async remember(input) {
        remembered.push({
          messageCount: input.messages.length,
          sessionId: input.scope.sessionId ?? "",
        });
        return { accepted: input.messages.length, rejected: 0, warnings: [] };
      },
    };

    await runPhase74VersionWorker({
      createGoodMemory: () => memory,
      input: {
        arm: "release",
        caseId: `case-${"a".repeat(64)}`,
        memoryGroupId: `group-${"b".repeat(64)}`,
        question: "question",
        rawEvidence: [{
          content: "first",
          id: "evidence-1",
          sourceIds: ["session-1:source-1"],
        }, {
          content: "second",
          id: "evidence-2",
          sourceIds: ["session-1:source-2"],
        }, {
          content: "third",
          id: "evidence-3",
          sourceIds: ["session-2:source-3"],
        }],
        schemaVersion: 1,
        sourceCommit: PHASE74_RELEASE_COMMIT,
      },
      models: {
        embedding: { apiKey: "e", model: "embed", provider: "openai" },
        extraction: { apiKey: "x", model: "extract", provider: "openai" },
      },
      sqlitePath: "/tmp/release-memory.sqlite",
    });

    expect(remembered).toEqual([
      { messageCount: 2, sessionId: "session-1" },
      { messageCount: 1, sessionId: "session-2" },
    ]);
  });

  it("runs one source-isolated label-free remember/recall/export flow", async () => {
    const rememberedSessions: string[] = [];
    let receivedConfig: unknown;
    const memory: Phase74VersionGoodMemory = {
      async exportMemory() {
        return {
          durable: {
            evidence: [{
              id: "evidence-1",
              linkedMemoryIds: ["fact-1"],
              sourceMessageIds: ["conversation-1/D1:1"],
            }],
            facts: [{ content: "Caroline adopted Pepper.", id: "fact-1" }],
          },
        };
      },
      async recall() {
        return {
          evidence: [{
            id: "evidence-1",
            linkedMemoryIds: ["fact-1"],
            sourceMessageIds: ["conversation-1/D1:1"],
          }],
          facts: [{ content: "Caroline adopted Pepper.", id: "fact-1" }],
          metadata: { latencyMs: 7 },
        };
      },
      async remember(input) {
        rememberedSessions.push(input.scope.sessionId ?? "");
        return { accepted: input.messages.length, rejected: 0, warnings: [] };
      },
    };

    const result = await runPhase74VersionWorker({
      createGoodMemory(config) {
        receivedConfig = config;
        return memory;
      },
      input: {
        arm: "release",
        caseId: "conversation-1/q1",
        locale: "en",
        memoryGroupId: "conversation-1",
        question: "What did Caroline adopt?",
        rawEvidence: [
          {
            content: "Caroline: I adopted Pepper.",
            id: "conversation-1/D1:1",
            observedAt: "2023-05-08T00:00:00.000Z",
            role: "assistant",
            sourceIds: ["D1:1"],
          },
          {
            content: "Caroline: Pepper is settling in.",
            id: "conversation-1/D2:1",
            observedAt: "2023-05-09T00:00:00.000Z",
            role: "assistant",
            sourceIds: ["D2:1"],
          },
        ],
        referenceTime: "2023-05-10T00:00:00.000Z",
        schemaVersion: 1,
        sourceCommit: PHASE74_RELEASE_COMMIT,
      },
      models: {
        embedding: {
          apiKey: "embedding-key",
          baseURL: "https://openrouter.ai/api/v1",
          model: "text-embedding-3-small",
          provider: "openai",
        },
        extraction: {
          apiKey: "extraction-key",
          baseURL: "https://ai.gurkiai.com/v1",
          model: "gpt-5.6-terra",
          provider: "openai",
        },
      },
      now: () => 100,
      sqlitePath: "/tmp/release-memory.sqlite",
    });

    expect(rememberedSessions).toEqual(["D1", "D2"]);
    expect(receivedConfig).toMatchObject({
      providers: {
        embedding: { model: "text-embedding-3-small" },
        extraction: {
          contextualDescriptors: true,
          mode: "conversational",
          model: "gpt-5.6-terra",
        },
      },
      retrieval: { preset: "recommended" },
      storage: { provider: "sqlite", url: "/tmp/release-memory.sqlite" },
    });
    expect(receivedConfig).not.toHaveProperty("adapters");
    expect(JSON.stringify(receivedConfig)).not.toContain("expectedAnswer");
    expect(result).toMatchObject({
      arm: "release",
      caseId: "conversation-1/q1",
      recallLatencyMs: 7,
      retrievedMemories: [{
        content: "Caroline adopted Pepper.",
        id: "fact-1",
        sourceIds: ["D1:1"],
      }],
      sourceCommit: PHASE74_RELEASE_COMMIT,
      storedMemories: [{
        content: "Caroline adopted Pepper.",
        id: "fact-1",
        sourceIds: ["D1:1"],
      }],
    });
    expect(result.ingestionLatencyMs).toBeGreaterThanOrEqual(0);
  });

  it("fails closed when release assisted extraction degrades", async () => {
    const memory: Phase74VersionGoodMemory = {
      async exportMemory() {
        return { durable: { evidence: [], facts: [] } };
      },
      async recall() {
        return { evidence: [], facts: [], metadata: { latencyMs: 0 } };
      },
      async remember() {
        return {
          accepted: 0,
          rejected: 0,
          warnings: ["assisted_extraction_failed"],
        };
      },
    };
    await expect(runPhase74VersionWorker({
      createGoodMemory: () => memory,
      input: {
        arm: "release",
        caseId: "case-1",
        memoryGroupId: "group-1",
        question: "question",
        rawEvidence: [{ content: "evidence", id: "message-1", sourceIds: ["S1"] }],
        schemaVersion: 1,
        sourceCommit: PHASE74_RELEASE_COMMIT,
      },
      models: {
        embedding: { apiKey: "e", model: "embed", provider: "openai" },
        extraction: { apiKey: "x", model: "extract", provider: "openai" },
      },
      sqlitePath: "/tmp/release-memory.sqlite",
    })).rejects.toThrow("assisted extraction failed");
  });
});
