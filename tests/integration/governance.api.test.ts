import { describe, expect, it } from "bun:test";
import { createGoodMemory } from "../../src";
import { createMemorySource } from "../../src/domain/provenance";
import {
  createEvidenceRecord,
  EVIDENCE_COLLECTION,
  SOURCE_MESSAGES_COLLECTION,
} from "../../src/evidence/contracts";
import {
  createExperienceRecord,
  createLearningProposal,
  createPromotionRecord,
  createSessionArchive,
  EXPERIENCES_COLLECTION,
  LEARNING_PROPOSALS_COLLECTION,
  PROMOTION_RECORDS_COLLECTION,
  SESSION_ARCHIVES_COLLECTION,
} from "../../src/evolution/contracts";
import {
  createInMemoryDocumentStore,
  createInMemorySessionStore,
  createInMemoryVectorStore,
} from "../../src/storage/memory";
import type {
  DocumentStore,
  ProjectionCapableDocumentStore,
  StorageDocument,
} from "../../src/storage/contracts";
import { createFakeEmbeddingAdapter } from "../../src/testing/fakes";
import { createArtifactSpilloverService } from "../../src/runtime/spillover";
import {
  CLAIM_PROJECTIONS_COLLECTION,
  CLAIM_PROJECTION_STATUS_COLLECTION,
  ENTITIES_COLLECTION,
  PROJECTION_MANIFESTS_COLLECTION,
  PROJECTION_REPAIRS_COLLECTION,
  RECALL_DOCUMENTS_COLLECTION,
  SCOPE_CATALOG_COLLECTION,
  type EntityAdjacencyProjection,
  type RecallIndexDocument,
} from "../../src/recall/projections/contracts";
import { SCOPE_DELETION_LOCKS_COLLECTION } from "../../src/storage/scopeDeletion";

describe("public governance API", () => {
  it("renders exported artifact labels with the explicitly requested locale", async () => {
    const memory = createGoodMemory({ storage: { provider: "memory" } });
    const exported = await memory.exportMemory({
      locale: "ja-JP",
      scope: { userId: "u-ja-export" },
    });
    const user = exported.artifacts.files.find(
      ({ relativePath }) => relativePath === "user.md",
    );
    const memoryIndex = exported.artifacts.files.find(
      ({ relativePath }) => relativePath === "MEMORY.md",
    );

    expect(user?.content).toContain("# ユーザーメモリ");
    expect(user?.content).toContain("## プロフィール");
    expect(memoryIndex?.content).toContain("# メモリ索引");
    expect(memoryIndex?.content).toContain("## 参照資料");
    expect(memoryIndex?.content).toContain("## 事実");
  });

  it("resolves export language exactly once through the configured detector", async () => {
    let detectorCalls = 0;
    const memory = createGoodMemory({
      language: {
        detector() {
          detectorCalls += 1;
          return "zh-Hant";
        },
      },
      storage: { provider: "memory" },
    });
    const exported = await memory.exportMemory({
      scope: { userId: "u-detected-export" },
    });
    const memoryIndex = exported.artifacts.files.find(
      ({ relativePath }) => relativePath === "MEMORY.md",
    );

    expect(detectorCalls).toBe(1);
    expect(memoryIndex?.content).toContain("# 記憶索引");
  });

  it("exports scoped durable memory and optional runtime memory", async () => {
    const documentStore = createInMemoryDocumentStore();
    const sessionStore = createInMemorySessionStore();
    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: { documentStore, sessionStore },
    });

    await memory.remember({
      scope: { userId: "u-1", workspaceId: "workspace-a", sessionId: "s-1" },
      messages: [
        {
          role: "user",
          content: "My name is Lin.",
        },
        {
          role: "user",
          content: "Remember that the migration rollout is blocked on prod verification.",
        },
        { role: "assistant", content: "Noted." },
        { role: "user", content: "I prefer bullet points in project summaries." },
      ],
    });
    await memory.remember({
      scope: { userId: "u-1", workspaceId: "workspace-a", sessionId: "s-2" },
      messages: [
        {
          role: "user",
          content: "Remember that a different rollout is healthy in session two.",
        },
      ],
    });
    await sessionStore.saveWorkingMemory(
      { userId: "u-1", workspaceId: "workspace-a", sessionId: "s-1" },
      {
        sessionId: "s-1",
        userId: "u-1",
        currentGoal: "Finish rollout",
        openLoops: ["verify prod"],
        updatedAt: "2026-04-02T00:00:00.000Z",
      },
    );
    const spillover = createArtifactSpilloverService({
      documentStore,
    });
    await spillover.spill(
      { userId: "u-1", workspaceId: "workspace-a", sessionId: "s-1" },
      {
        kind: "tool_result",
        sourceId: "tool-1",
        content: "Very large runtime-only payload for session one.",
      },
    );
    await spillover.spill(
      { userId: "u-1", workspaceId: "workspace-a", sessionId: "s-2" },
      {
        kind: "tool_result",
        sourceId: "tool-2",
        content: "Very large runtime-only payload for session two.",
      },
    );
    await documentStore.set(
      SESSION_ARCHIVES_COLLECTION,
      "archive-export-s1",
      createSessionArchive({
        id: "archive-export-s1",
        userId: "u-1",
        workspaceId: "workspace-a",
        sessionId: "s-1",
        summary: "Archive for export session one.",
        unresolvedItems: ["verify prod"],
      }),
    );
    await documentStore.set(
      SESSION_ARCHIVES_COLLECTION,
      "archive-export-s2",
      createSessionArchive({
        id: "archive-export-s2",
        userId: "u-1",
        workspaceId: "workspace-a",
        sessionId: "s-2",
        summary: "Archive for export session two.",
        unresolvedItems: ["keep session two"],
      }),
    );
    await documentStore.set(
      EVIDENCE_COLLECTION,
      "evidence-export-s1",
      createEvidenceRecord({
        id: "evidence-export-s1",
        userId: "u-1",
        workspaceId: "workspace-a",
        sessionId: "s-1",
        kind: "conversation_excerpt",
        excerpt: "session-one export evidence",
        source: createMemorySource({
          method: "explicit",
          extractedAt: "2026-04-02T00:00:00.000Z",
          sessionId: "s-1",
        }),
      }),
    );
    await documentStore.set(
      EVIDENCE_COLLECTION,
      "evidence-export-s2",
      createEvidenceRecord({
        id: "evidence-export-s2",
        userId: "u-1",
        workspaceId: "workspace-a",
        sessionId: "s-2",
        kind: "conversation_excerpt",
        excerpt: "session-two export evidence",
        source: createMemorySource({
          method: "explicit",
          extractedAt: "2026-04-02T00:00:00.000Z",
          sessionId: "s-2",
        }),
      }),
    );
    await documentStore.set(
      EXPERIENCES_COLLECTION,
      "experience-export-s1",
      createExperienceRecord({
        id: "experience-export-s1",
        userId: "u-1",
        workspaceId: "workspace-a",
        sessionId: "s-1",
        kind: "session_end",
        traceId: "trace-export-s1",
        summary: "session-one export experience",
      }),
    );
    await documentStore.set(
      EXPERIENCES_COLLECTION,
      "experience-export-s2",
      createExperienceRecord({
        id: "experience-export-s2",
        userId: "u-1",
        workspaceId: "workspace-a",
        sessionId: "s-2",
        kind: "session_end",
        traceId: "trace-export-s2",
        summary: "session-two export experience",
      }),
    );
    await documentStore.set(
      LEARNING_PROPOSALS_COLLECTION,
      "proposal-export-s1",
      createLearningProposal({
        id: "proposal-export-s1",
        userId: "u-1",
        workspaceId: "workspace-a",
        sessionId: "s-1",
        proposalType: "memory_revision",
        traceId: "trace-proposal-s1",
        summary: "Revise a rollout blocker after repeated corrections.",
        rationale: "Later evidence shows the original blocker statement is outdated.",
        sourceExperienceIds: ["experience-export-s1"],
      }),
    );
    await documentStore.set(
      PROMOTION_RECORDS_COLLECTION,
      "promotion-export-s1",
      createPromotionRecord({
        id: "promotion-export-s1",
        proposalId: "proposal-export-s1",
        userId: "u-1",
        workspaceId: "workspace-a",
        sessionId: "s-1",
        traceId: "trace-promotion-s1",
        decision: "delayed",
        summary: "Delay rollout revision until verification reruns.",
        rationale: "The proposal should not mutate durable memory before re-check.",
        sourceExperienceIds: ["experience-export-s1"],
      }),
    );

    const durableOnly = await memory.exportMemory({
      scope: { userId: "u-1", workspaceId: "workspace-a", sessionId: "s-1" },
    });
    const withRuntime = await memory.exportMemory({
      scope: { userId: "u-1", workspaceId: "workspace-a", sessionId: "s-1" },
      includeRuntime: true,
    });
    const globalExport = await memory.exportMemory({
      scope: { userId: "u-1" },
    });

    expect(durableOnly.durable.profile).toBeNull();
    expect(durableOnly.durable.facts).toHaveLength(1);
    expect(durableOnly.durable.preferences).toHaveLength(1);
    expect(durableOnly.durable.archives).toHaveLength(1);
    expect(durableOnly.durable.evidence).toHaveLength(2);
    expect(durableOnly.durable.sourceMessages?.some(({ content }) =>
      content === "Remember that the migration rollout is blocked on prod verification."
    )).toBe(true);
    expect(durableOnly.durable.experiences).toHaveLength(2);
    expect(
      durableOnly.durable.facts.every((fact) => fact.sessionId === "s-1"),
    ).toBe(true);
    expect(durableOnly.durable.archives[0]?.id).toBe("archive-export-s1");
    expect(
      durableOnly.durable.evidence.some((record) => record.id === "evidence-export-s1"),
    ).toBe(true);
    expect(
      durableOnly.durable.experiences.some((record) => record.id === "experience-export-s1"),
    ).toBe(true);
    expect(
      durableOnly.durable.experiences.some((record) => record.kind === "remember"),
    ).toBe(true);
    expect(durableOnly.durable.proposals[0]?.id).toBe("proposal-export-s1");
    expect(durableOnly.durable.promotions[0]?.id).toBe("promotion-export-s1");
    expect(durableOnly.runtime).toBeUndefined();
    expect(globalExport.durable.profile?.identity.name).toBe("Lin");
    expect(globalExport.durable.archives).toHaveLength(2);
    expect(globalExport.durable.evidence).toHaveLength(4);
    expect(globalExport.durable.experiences).toHaveLength(4);
    expect(globalExport.durable.proposals).toHaveLength(1);
    expect(globalExport.durable.promotions).toHaveLength(1);
    expect(durableOnly.artifacts.rootPath).toBe(
      ".goodmemory/users/u-1/workspaces/workspace-a/sessions/s-1",
    );
    expect(durableOnly.artifacts.files.map((file) => file.relativePath)).toEqual([
      "user.md",
      "MEMORY.md",
      "archive/1970/01/s-1.md",
    ]);
    expect(durableOnly.artifacts.files[1]?.content).toContain(
      "migration rollout is blocked on prod verification.",
    );
    expect(durableOnly.artifacts.files[1]?.content).toContain(
      "Revise a rollout blocker after repeated corrections.",
    );
    expect(durableOnly.artifacts.files[1]?.content).toContain(
      "Delay rollout revision until verification reruns.",
    );
    expect(withRuntime.artifacts.files[2]?.content).toContain("Current goal: Finish rollout");
    expect(withRuntime.artifacts.files[2]?.content).toContain(
      "Very large runtime-only payload for session one.",
    );
    expect(withRuntime.artifacts.files.map((file) => file.relativePath)).toContain("session.md");
    const withRuntimeAgain = await memory.exportMemory({
      scope: { userId: "u-1", workspaceId: "workspace-a", sessionId: "s-1" },
      includeRuntime: true,
    });
    expect(withRuntimeAgain.artifacts).toEqual(withRuntime.artifacts);
    expect(withRuntime.runtime?.workingMemory?.currentGoal).toBe("Finish rollout");
    expect(withRuntime.runtime?.spills).toHaveLength(1);
    expect(withRuntime.runtime?.spills[0]?.sourceId).toBe("tool-1");
  });

  it("deletes all scoped memory without touching other scopes", async () => {
    const documentStore = createInMemoryDocumentStore();
    const sessionStore = createInMemorySessionStore();
    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: { documentStore, sessionStore },
    });

    await memory.remember({
      scope: { userId: "u-1", workspaceId: "workspace-a", sessionId: "s-1" },
      messages: [{ role: "user", content: "Remember that workspace A rollout is blocked." }],
    });
    await memory.remember({
      scope: { userId: "u-1", workspaceId: "workspace-a", sessionId: "s-9" },
      messages: [{ role: "user", content: "Remember that workspace A session nine needs follow-up." }],
    });
    await memory.remember({
      scope: { userId: "u-1", workspaceId: "workspace-b", sessionId: "s-2" },
      messages: [{ role: "user", content: "Remember that workspace B rollout is healthy." }],
    });
    await sessionStore.saveWorkingMemory(
      { userId: "u-1", workspaceId: "workspace-a", sessionId: "s-9" },
      {
        sessionId: "s-9",
        userId: "u-1",
        currentGoal: "Keep session nine",
        openLoops: ["follow-up"],
        updatedAt: "2026-04-02T00:00:00.000Z",
      },
    );
    await sessionStore.saveJournal(
      { userId: "u-1", workspaceId: "workspace-a", sessionId: "s-1" },
      {
        sessionId: "s-1",
        userId: "u-1",
        worklog: ["A journal entry"],
        updatedAt: "2026-04-02T00:00:00.000Z",
      },
    );
    const spillover = createArtifactSpilloverService({
      documentStore,
    });
    const spillA = await spillover.spill(
      { userId: "u-1", workspaceId: "workspace-a", sessionId: "s-1" },
      {
        kind: "tool_result",
        sourceId: "tool-a",
        content: "Session one spill payload",
      },
    );
    const spillB = await spillover.spill(
      { userId: "u-1", workspaceId: "workspace-a", sessionId: "s-9" },
      {
        kind: "tool_result",
        sourceId: "tool-b",
        content: "Session nine spill payload",
      },
    );
    const source = createMemorySource({
      method: "explicit",
      extractedAt: "2026-04-02T00:00:00.000Z",
      sessionId: "s-1",
    });
    await documentStore.set(
      SESSION_ARCHIVES_COLLECTION,
      "archive-s1",
      createSessionArchive({
        id: "archive-s1",
        userId: "u-1",
        workspaceId: "workspace-a",
        sessionId: "s-1",
        summary: "Scoped archive for session one.",
        unresolvedItems: ["follow the session-one rollout"],
      }),
    );
    await documentStore.set(
      SESSION_ARCHIVES_COLLECTION,
      "archive-s9",
      createSessionArchive({
        id: "archive-s9",
        userId: "u-1",
        workspaceId: "workspace-a",
        sessionId: "s-9",
        summary: "Scoped archive for session nine.",
        unresolvedItems: ["keep session nine"],
      }),
    );
    await documentStore.set(
      EVIDENCE_COLLECTION,
      "evidence-s1",
      createEvidenceRecord({
        id: "evidence-s1",
        userId: "u-1",
        workspaceId: "workspace-a",
        sessionId: "s-1",
        kind: "conversation_excerpt",
        excerpt: "session-one evidence",
        source,
      }),
    );
    await documentStore.set(
      EVIDENCE_COLLECTION,
      "evidence-s9",
      createEvidenceRecord({
        id: "evidence-s9",
        userId: "u-1",
        workspaceId: "workspace-a",
        sessionId: "s-9",
        kind: "conversation_excerpt",
        excerpt: "session-nine evidence",
        source: createMemorySource({
          method: "explicit",
          extractedAt: "2026-04-02T00:00:00.000Z",
          sessionId: "s-9",
        }),
      }),
    );
    await documentStore.set(
      EXPERIENCES_COLLECTION,
      "experience-s1",
      createExperienceRecord({
        id: "experience-s1",
        userId: "u-1",
        workspaceId: "workspace-a",
        sessionId: "s-1",
        kind: "session_end",
        traceId: "trace-s1",
        summary: "session-one experience",
      }),
    );
    await documentStore.set(
      EXPERIENCES_COLLECTION,
      "experience-s9",
      createExperienceRecord({
        id: "experience-s9",
        userId: "u-1",
        workspaceId: "workspace-a",
        sessionId: "s-9",
        kind: "session_end",
        traceId: "trace-s9",
        summary: "session-nine experience",
      }),
    );
    await documentStore.set(
      LEARNING_PROPOSALS_COLLECTION,
      "proposal-s1",
      createLearningProposal({
        id: "proposal-s1",
        userId: "u-1",
        workspaceId: "workspace-a",
        sessionId: "s-1",
        proposalType: "maintenance_action",
        traceId: "trace-proposal-s1",
        summary: "Run a governed maintenance repair for session one.",
        rationale: "Session one emitted a stale rollout signal that needs repair.",
        sourceExperienceIds: ["experience-s1"],
      }),
    );
    await documentStore.set(
      PROMOTION_RECORDS_COLLECTION,
      "promotion-s1",
      createPromotionRecord({
        id: "promotion-s1",
        proposalId: "proposal-s1",
        userId: "u-1",
        workspaceId: "workspace-a",
        sessionId: "s-1",
        traceId: "trace-promotion-s1",
        decision: "rejected",
        summary: "Rejected the maintenance repair for session one.",
        rationale: "The evidence was incomplete for an automatic mutation.",
        sourceExperienceIds: ["experience-s1"],
      }),
    );

    const result = await memory.deleteAllMemory({
      scope: { userId: "u-1", workspaceId: "workspace-a", sessionId: "s-1" },
    });
    const recallA = await memory.recall({
      scope: { userId: "u-1", workspaceId: "workspace-a", sessionId: "s-1" },
      query: "How should I answer this user?",
    });
    const recallB = await memory.recall({
      scope: { userId: "u-1", workspaceId: "workspace-b", sessionId: "s-2" },
      query: "How should I answer this user?",
    });
    const recallAOtherSession = await memory.recall({
      scope: { userId: "u-1", workspaceId: "workspace-a", sessionId: "s-9" },
      query: "How should I answer this user?",
      retrievalProfile: "coding_agent",
    });
    const exportedA = await memory.exportMemory({
      scope: { userId: "u-1", workspaceId: "workspace-a", sessionId: "s-1" },
      includeRuntime: true,
    });
    const exportedOtherSession = await memory.exportMemory({
      scope: { userId: "u-1", workspaceId: "workspace-a", sessionId: "s-9" },
      includeRuntime: true,
    });

    expect(result.deleted.facts).toBe(1);
    expect(result.deleted.archives).toBe(1);
    expect(result.deleted.evidence).toBe(2);
    expect(result.deleted.experiences).toBe(2);
    expect(result.deleted.proposals).toBe(1);
    expect(result.deleted.promotions).toBe(1);
    expect(result.deleted.journal).toBe(1);
    expect(result.deleted.artifactSpills).toBe(1);
    expect(
      recallA.facts.some((fact) => fact.content.includes("workspace A rollout is blocked")),
    ).toBe(false);
    expect(recallB.facts).toHaveLength(1);
    expect(recallAOtherSession.facts).toHaveLength(1);
    expect(recallAOtherSession.workingMemory?.currentGoal).toBe("Keep session nine");
    expect(recallA.workingMemory).toBeNull();
    expect(recallA.journal).toBeNull();
    expect(exportedA.runtime?.spills).toHaveLength(0);
    expect(exportedOtherSession.runtime?.spills).toHaveLength(1);
    expect(
      await spillover.resolve(
        { userId: "u-1", workspaceId: "workspace-a", sessionId: "s-1" },
        spillA.storageUri,
      ),
    ).toBeNull();
    expect(
      await spillover.resolve(
        { userId: "u-1", workspaceId: "workspace-a", sessionId: "s-9" },
        spillB.storageUri,
      ),
    ).toBe("Session nine spill payload");
    expect(exportedA.artifacts.rootPath).toBe(
      ".goodmemory/users/u-1/workspaces/workspace-a/sessions/s-1",
    );
    expect(exportedOtherSession.artifacts.rootPath).toBe(
      ".goodmemory/users/u-1/workspaces/workspace-a/sessions/s-9",
    );
    expect(await documentStore.get(SESSION_ARCHIVES_COLLECTION, "archive-s1")).toBeNull();
    expect(await documentStore.get(SESSION_ARCHIVES_COLLECTION, "archive-s9")).not.toBeNull();
    expect(await documentStore.get(EVIDENCE_COLLECTION, "evidence-s1")).toBeNull();
    expect(await documentStore.get(EVIDENCE_COLLECTION, "evidence-s9")).not.toBeNull();
    expect(await documentStore.get(EXPERIENCES_COLLECTION, "experience-s1")).toBeNull();
    expect(await documentStore.get(EXPERIENCES_COLLECTION, "experience-s9")).not.toBeNull();
    expect(await documentStore.get(LEARNING_PROPOSALS_COLLECTION, "proposal-s1")).toBeNull();
    expect(await documentStore.get(PROMOTION_RECORDS_COLLECTION, "promotion-s1")).toBeNull();
  });

  it("deletes scoped raw messages and claim projections without touching another session", async () => {
    const documentStore = createInMemoryDocumentStore();
    const memory = createGoodMemory({
      adapters: {
        documentStore,
        sessionStore: createInMemorySessionStore(),
      },
      testing: {
        extractor: {
          async extract(input) {
            return {
              candidates: [{
                id: `candidate-${input.scope.sessionId}`,
                kindHint: "fact" as const,
                explicitness: "explicit" as const,
                content: input.messages[0]!.content,
                sourceMessageIndex: 0,
                sourceRole: "user",
                extractorIds: ["test-claim-v1"],
                metadata: {
                  subject: "Atlas",
                  claim: {
                    predicateKey: "project.status",
                    objectText: input.messages[0]!.content,
                  },
                },
              }],
              ignoredMessageCount: 0,
            };
          },
        },
      },
    });
    const firstScope = {
      userId: "u-claim-delete",
      workspaceId: "workspace-a",
      sessionId: "s-1",
    };
    const secondScope = { ...firstScope, sessionId: "s-2" };
    await memory.remember({
      scope: firstScope,
      messages: [{
        id: "message-s1",
        role: "user",
        content: "Atlas is blocked.",
      }],
    });
    await memory.remember({
      scope: secondScope,
      messages: [{
        id: "message-s2",
        role: "user",
        content: "Atlas is healthy.",
      }],
    });

    await memory.deleteAllMemory({ scope: firstScope });

    expect(await documentStore.query(SOURCE_MESSAGES_COLLECTION, firstScope)).toHaveLength(0);
    expect(await documentStore.query(CLAIM_PROJECTIONS_COLLECTION, firstScope)).toHaveLength(0);
    expect(await documentStore.query(CLAIM_PROJECTION_STATUS_COLLECTION, firstScope)).toHaveLength(0);
    expect(await documentStore.query(SOURCE_MESSAGES_COLLECTION, secondScope)).toHaveLength(1);
    expect(await documentStore.query(CLAIM_PROJECTIONS_COLLECTION, secondScope)).toHaveLength(1);
    expect(await documentStore.query(CLAIM_PROJECTION_STATUS_COLLECTION, secondScope)).toHaveLength(1);
  });

  it("deletes orphaned projection state even when its canonical fact is already absent", async () => {
    const documentStore = createInMemoryDocumentStore();
    const memory = createGoodMemory({
      adapters: {
        documentStore,
        sessionStore: createInMemorySessionStore(),
      },
    });
    const scope = {
      userId: "u-orphan-delete",
      workspaceId: "workspace-a",
      sessionId: "s-1",
    };
    const orphan = {
      ...scope,
      id: "orphan-sensitive",
      sourceMemoryId: "missing-fact",
      sensitive: "sensitive-object-text",
    };
    const projectionCollections = [
      RECALL_DOCUMENTS_COLLECTION,
      ENTITIES_COLLECTION,
      SCOPE_CATALOG_COLLECTION,
      PROJECTION_MANIFESTS_COLLECTION,
      PROJECTION_REPAIRS_COLLECTION,
      CLAIM_PROJECTIONS_COLLECTION,
      CLAIM_PROJECTION_STATUS_COLLECTION,
    ];
    for (const collection of projectionCollections) {
      await documentStore.set(collection, orphan.id, orphan);
    }

    await memory.deleteAllMemory({ scope });

    for (const collection of projectionCollections) {
      expect(await documentStore.query(collection, scope)).toEqual([]);
    }
    expect(JSON.stringify(await Promise.all(projectionCollections.map((collection) =>
      documentStore.query(collection, {})
    )))).not.toContain("sensitive-object-text");
  });

  it("deletes legacy session entity edges through their projected memory IDs", async () => {
    const documentStore = createInMemoryDocumentStore();
    const memory = createGoodMemory({
      adapters: {
        documentStore,
        sessionStore: createInMemorySessionStore(),
      },
      retrieval: { preset: "recommended" },
      testing: {
        extractor: {
          async extract(input) {
            return {
              candidates: [{
                id: "candidate-sensitive-northwind",
                kindHint: "fact" as const,
                explicitness: "explicit" as const,
                content: input.messages[0]?.content ?? "",
                sourceMessageIndex: 0,
                sourceRole: "user",
                extractorIds: ["test-entity-delete-v1"],
                metadata: {
                  subject: "Northwind API",
                  tags: ["Northwind", "Paris"],
                  claim: {
                    predicateKey: "project.status",
                    objectText: "blocked in Paris",
                  },
                },
              }],
              ignoredMessageCount: 0,
            };
          },
        },
      },
    });
    const scope = {
      userId: "u-legacy-entity-delete",
      workspaceId: "workspace-a",
      sessionId: "s-1",
    };
    await memory.remember({
      scope,
      messages: [{
        id: "message-sensitive-northwind",
        role: "user",
        content: "Sensitive Northwind API is blocked in Paris.",
      }],
    });
    const recallDocuments = await documentStore.query<RecallIndexDocument>(
      RECALL_DOCUMENTS_COLLECTION,
      scope,
    );
    const memoryIds = new Set(recallDocuments.map((document) =>
      `${document.sourceCollection}:${document.sourceMemoryId}`
    ));
    const entityEdges = (
      await documentStore.query<EntityAdjacencyProjection>(ENTITIES_COLLECTION, {
        userId: scope.userId,
        workspaceId: scope.workspaceId,
      })
    ).filter((edge) => memoryIds.has(edge.memoryId));
    expect(recallDocuments.length).toBeGreaterThan(0);
    expect(entityEdges.length).toBeGreaterThan(0);

    for (const edge of entityEdges) {
      const { sessionId: _sessionId, ...legacyEdge } = edge;
      await documentStore.set(ENTITIES_COLLECTION, edge.id, legacyEdge);
    }
    for (const fact of await documentStore.query<{ id: string }>("facts", scope)) {
      await documentStore.delete("facts", fact.id);
    }

    await memory.deleteAllMemory({ scope });

    const remainingEdges = await documentStore.query<EntityAdjacencyProjection>(
      ENTITIES_COLLECTION,
      { userId: scope.userId, workspaceId: scope.workspaceId },
    );
    expect(
      remainingEdges.filter((edge) => memoryIds.has(edge.memoryId)),
    ).toEqual([]);
    expect(JSON.stringify(remainingEdges)).not.toContain("Sensitive Northwind");
  });

  it("rejects a cross-runtime scoped write while deleteAllMemory is in progress", async () => {
    const inner = createInMemoryDocumentStore();
    let releaseProjectionScan: (() => void) | undefined;
    let markProjectionScanReached: (() => void) | undefined;
    const projectionScanReached = new Promise<void>((resolve) => {
      markProjectionScanReached = resolve;
    });
    const projectionScanReleased = new Promise<void>((resolve) => {
      releaseProjectionScan = resolve;
    });
    let pauseProjectionScan = false;
    const documentStore: ProjectionCapableDocumentStore = {
      ...inner,
      async query<TDocument extends StorageDocument>(
        collection: string,
        filter?: Record<string, unknown>,
      ) {
        const records = await inner.query<TDocument>(collection, filter);
        if (pauseProjectionScan && collection === PROJECTION_REPAIRS_COLLECTION) {
          pauseProjectionScan = false;
          markProjectionScanReached?.();
          await projectionScanReleased;
        }
        return records;
      },
    };
    const scope = {
      userId: "u-delete-race",
      workspaceId: "workspace-a",
      sessionId: "s-1",
    };
    const deletingMemory = createGoodMemory({
      adapters: {
        documentStore,
        sessionStore: createInMemorySessionStore(),
      },
    });
    const concurrentMemory = createGoodMemory({
      adapters: {
        documentStore,
        sessionStore: createInMemorySessionStore(),
      },
    });
    await deletingMemory.remember({
      scope,
      messages: [{ role: "user", content: "Remember that the first rollout is blocked." }],
    });

    pauseProjectionScan = true;
    const deletion = deletingMemory.deleteAllMemory({ scope });
    await projectionScanReached;
    const concurrentWrite = concurrentMemory.remember({
      scope,
      messages: [{ role: "user", content: "Remember that sensitive late write." }],
    });
    const writeOutcome = await concurrentWrite.then(
      () => "resolved" as const,
      () => "rejected" as const,
    );
    releaseProjectionScan?.();
    await deletion;

    expect(writeOutcome).toBe("rejected");
    expect(await inner.query("facts", scope)).toEqual([]);
    expect(JSON.stringify(await inner.query(SOURCE_MESSAGES_COLLECTION, scope)))
      .not.toContain("sensitive late write");

    const postDeleteWrite = await concurrentMemory.remember({
      scope,
      messages: [{ role: "user", content: "Remember that a new rollout starts now." }],
    });
    expect(postDeleteWrite.accepted).toBeGreaterThan(0);
  });

  it("waits for an active remember vector commit before terminal scoped deletion", async () => {
    const inner = createInMemoryDocumentStore();
    let deletionLockRead = false;
    const documentStore: ProjectionCapableDocumentStore = {
      ...inner,
      async get<TDocument extends StorageDocument>(
        collection: string,
        id: string,
      ) {
        if (collection === SCOPE_DELETION_LOCKS_COLLECTION) {
          deletionLockRead = true;
        }
        return inner.get<TDocument>(collection, id);
      },
    };
    const sessionStore = createInMemorySessionStore();
    const vectorStore = createInMemoryVectorStore();
    let releaseEmbedding = () => {};
    let signalEmbedding = () => {};
    const embeddingStarted = new Promise<void>((resolve) => {
      signalEmbedding = resolve;
    });
    const embeddingRelease = new Promise<void>((resolve) => {
      releaseEmbedding = resolve;
    });
    const memory = createGoodMemory({
      adapters: {
        documentStore,
        sessionStore,
        vectorStore,
        embeddingAdapter: {
          async embed(texts) {
            signalEmbedding();
            await embeddingRelease;
            return texts.map(() => [1, 1, 1]);
          },
        },
      },
    });
    const scope = {
      userId: "u-delete-active-vector-write",
      workspaceId: "workspace-a",
      sessionId: "session-a",
    };

    const remember = memory.remember({
      scope,
      messages: [{
        role: "user",
        content: "Remember that the private rollout token is active.",
      }],
    });
    await embeddingStarted;
    deletionLockRead = false;
    const deletion = memory.deleteAllMemory({ scope });
    await Promise.resolve();

    expect(deletionLockRead).toBe(false);

    releaseEmbedding();
    await remember;
    await deletion;

    expect(await inner.query("facts", scope)).toEqual([]);
    expect(
      await vectorStore.search("facts", [1, 1, 1], {
        filter: scope,
        topK: 10,
      }),
    ).toEqual([]);
  });

  it("rejects a runtime write that starts during terminal scoped deletion", async () => {
    const documentStore = createInMemoryDocumentStore();
    const innerSessionStore = createInMemorySessionStore();
    let releaseRuntimeDelete = () => {};
    let signalRuntimeDelete = () => {};
    const runtimeDeleteStarted = new Promise<void>((resolve) => {
      signalRuntimeDelete = resolve;
    });
    const runtimeDeleteRelease = new Promise<void>((resolve) => {
      releaseRuntimeDelete = resolve;
    });
    const sessionStore = {
      ...innerSessionStore,
      async deleteWorkingMemoryByScope(scope: Parameters<
        typeof innerSessionStore.deleteWorkingMemoryByScope
      >[0]) {
        const deleted = await innerSessionStore.deleteWorkingMemoryByScope(scope);
        signalRuntimeDelete();
        await runtimeDeleteRelease;
        return deleted;
      },
    };
    const memory = createGoodMemory({
      adapters: { documentStore, sessionStore },
    });
    const scope = {
      userId: "u-delete-runtime-write",
      workspaceId: "workspace-a",
      sessionId: "session-a",
    };
    await memory.runtime.startSession({ scope });
    await memory.runtime.updateWorkingMemory({
      scope,
      patch: { currentGoal: "private goal before deletion" },
    });

    const deletion = memory.deleteAllMemory({ scope });
    await runtimeDeleteStarted;
    const lateWrite = memory.runtime.updateWorkingMemory({
      scope,
      patch: { currentGoal: "private goal after deletion started" },
    });

    await expect(lateWrite).rejects.toThrow("Memory deletion is in progress");
    releaseRuntimeDelete();
    await deletion;

    expect(await innerSessionStore.getWorkingMemory(scope)).toBeNull();
  });

  it("fails closed when an adapter cannot provide terminal delete semantics", async () => {
    const inner = createInMemoryDocumentStore();
    const legacyStore: DocumentStore = {
      set: (collection, id, document) => inner.set(collection, id, document),
      get: (collection, id) => inner.get(collection, id),
      update: (collection, id, patch) => inner.update(collection, id, patch),
      query: (collection, filter) => inner.query(collection, filter),
      delete: (collection, id) => inner.delete(collection, id),
    };
    const memory = createGoodMemory({
      adapters: {
        documentStore: legacyStore,
        sessionStore: createInMemorySessionStore(),
      },
    });

    await expect(memory.deleteAllMemory({
      scope: { userId: "u-legacy-delete" },
    })).rejects.toThrow("projection-capable document store");
  });

  it("keeps workspace-scoped proposals when deleting one contributing session", async () => {
    const memory = createGoodMemory({
      storage: { provider: "memory" },
    });

    await memory.feedback({
      scope: { userId: "u-1", workspaceId: "workspace-a", sessionId: "s-1" },
      signal: "Use bullet points in summaries.",
    });
    await memory.feedback({
      scope: { userId: "u-1", workspaceId: "workspace-a", sessionId: "s-2" },
      signal: "Use bullet points in summaries.",
    });

    const beforeDelete = await memory.exportMemory({
      scope: { userId: "u-1", workspaceId: "workspace-a" },
    });

    expect(beforeDelete.durable.proposals).toHaveLength(1);
    expect(beforeDelete.durable.proposals[0]?.proposalType).toBe("procedural_pattern");
    expect(beforeDelete.durable.proposals[0]?.sessionId).toBeUndefined();

    const deleteResult = await memory.deleteAllMemory({
      scope: { userId: "u-1", workspaceId: "workspace-a", sessionId: "s-2" },
    });
    const afterWorkspaceDelete = await memory.exportMemory({
      scope: { userId: "u-1", workspaceId: "workspace-a" },
    });
    const deletedSessionView = await memory.exportMemory({
      scope: { userId: "u-1", workspaceId: "workspace-a", sessionId: "s-2" },
    });

    expect(deleteResult.deleted.proposals).toBe(0);
    expect(afterWorkspaceDelete.durable.proposals).toHaveLength(1);
    expect(deletedSessionView.durable.proposals).toHaveLength(0);
  });

  it("returns an empty recall when ignoreMemory is enabled even if data exists", async () => {
    const memory = createGoodMemory({
      storage: { provider: "memory" },
    });

    await memory.remember({
      scope: { userId: "u-1", workspaceId: "workspace-a", sessionId: "s-1" },
      messages: [{ role: "user", content: "Remember that the rollout is blocked." }],
    });

    const result = await memory.recall({
      scope: { userId: "u-1", workspaceId: "workspace-a", sessionId: "s-1" },
      query: "What do you remember?",
      ignoreMemory: true,
    });

    expect(result.facts).toHaveLength(0);
    expect(result.metadata.hits).toHaveLength(0);
    expect(result.metadata.policyApplied).toContain("ignore_memory");
  });

  it("supports shouldRecall and resolveConflict hooks", async () => {
    const memory = createGoodMemory({
      storage: { provider: "memory" },
      policy: {
        shouldRecall(record) {
          return record.memoryType !== "reference";
        },
        resolveConflict() {
          return {
            action: "keep_existing",
            reason: "policy_keep_existing",
          };
        },
      },
    });

    await memory.remember({
      scope: { userId: "u-1", workspaceId: "workspace-a", sessionId: "s-1" },
      messages: [
        {
          role: "user",
          content: "Use docs/runbook-v1.md as the source of truth for rollout work.",
        },
      ],
    });
    const correction = await memory.remember({
      scope: { userId: "u-1", workspaceId: "workspace-a", sessionId: "s-2" },
      messages: [
        {
          role: "user",
          content:
            "Correction: docs/runbook-v2.md is now the source of truth, not docs/runbook-v1.md. Please update that.",
        },
      ],
    });
    const recall = await memory.recall({
      scope: { userId: "u-1", workspaceId: "workspace-a", sessionId: "s-2" },
      query: "Use the remembered runbook to continue the rollout.",
    });

    expect(correction.events.some((event) => event.reason === "policy_keep_existing")).toBe(
      true,
    );
    expect(recall.references).toHaveLength(0);
    expect(recall.metadata.policyApplied).toContain("custom_shouldRecall");
  });

  it("blocks cross-workspace recall by default when workspace is omitted", async () => {
    const memory = createGoodMemory({
      storage: { provider: "memory" },
    });

    await memory.remember({
      scope: { userId: "u-1", workspaceId: "workspace-a", sessionId: "s-1" },
      messages: [{ role: "user", content: "Remember that workspace A rollout is blocked." }],
    });
    const privateMemory = await memory.exportMemory({
      scope: { userId: "u-1", workspaceId: "workspace-a", sessionId: "s-1" },
    });
    const privateFactId = privateMemory.durable.facts[0]?.id;
    expect(privateFactId).toBeDefined();

    const result = await memory.recall({
      scope: { userId: "u-1", sessionId: "s-1" },
      query: "How should I answer this user?",
    });

    expect(result.facts).toHaveLength(0);
    expect(result.metadata.policyApplied).toContain("default_scope_guard");
    expect(
      result.metadata.candidateTraces.some(
        ({ memoryId }) => memoryId === privateFactId,
      ),
    ).toBe(false);
  });

  it("blocks cross-tenant recall by default when tenant is omitted", async () => {
    const memory = createGoodMemory({
      storage: { provider: "memory" },
    });

    await memory.remember({
      scope: {
        userId: "u-1",
        tenantId: "tenant-a",
        workspaceId: "workspace-a",
        sessionId: "s-1",
      },
      messages: [{ role: "user", content: "Remember that tenant A rollout is blocked." }],
    });

    const result = await memory.recall({
      scope: { userId: "u-1", workspaceId: "workspace-a", sessionId: "s-1" },
      query: "How should I answer this user?",
    });

    expect(result.facts).toHaveLength(0);
    expect(result.metadata.policyApplied).toContain("default_scope_guard");
  });

  it("does not export or delete the global profile for tenant-scoped governance calls", async () => {
    const memory = createGoodMemory({
      storage: { provider: "memory" },
    });

    await memory.remember({
      scope: {
        userId: "u-1",
        tenantId: "tenant-a",
        sessionId: "s-1",
      },
      messages: [{ role: "user", content: "My name is Lin." }],
    });

    const tenantScopedExport = await memory.exportMemory({
      scope: { userId: "u-1", tenantId: "tenant-a" },
    });
    const deleteResult = await memory.deleteAllMemory({
      scope: { userId: "u-1", tenantId: "tenant-a" },
    });
    const globalExport = await memory.exportMemory({
      scope: { userId: "u-1" },
    });

    expect(tenantScopedExport.durable.profile).toBeNull();
    expect(deleteResult.deleted.profiles).toBe(0);
    expect(globalExport.durable.profile?.identity.name).toBe("Lin");
  });

  it("deletes scoped vector embeddings while preserving other scopes during deleteAllMemory", async () => {
    const documentStore = createInMemoryDocumentStore();
    const sessionStore = createInMemorySessionStore();
    const vectorStore = createInMemoryVectorStore();
    const embeddingAdapter = createFakeEmbeddingAdapter();
    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: {
        documentStore,
        sessionStore,
        vectorStore,
        embeddingAdapter,
      },
    });

    await memory.remember({
      scope: { userId: "u-delete-vectors", workspaceId: "workspace-a", sessionId: "s-1" },
      messages: [{ role: "user", content: "Remember that workspace A rollout is blocked." }],
    });
    await memory.remember({
      scope: { userId: "u-delete-vectors", workspaceId: "workspace-b", sessionId: "s-2" },
      messages: [{ role: "user", content: "Remember that workspace B rollout is healthy." }],
    });

    const factA = await documentStore.query<{ content: string }>("facts", {
      userId: "u-delete-vectors",
      workspaceId: "workspace-a",
    });
    const factB = await documentStore.query<{ content: string }>("facts", {
      userId: "u-delete-vectors",
      workspaceId: "workspace-b",
    });
    const [embeddingA] = await embeddingAdapter.embed([String(factA[0]?.content)]);
    const [embeddingB] = await embeddingAdapter.embed([String(factB[0]?.content)]);

    expect(
      await vectorStore.search("facts", embeddingA, {
        topK: 1,
        filter: { userId: "u-delete-vectors", workspaceId: "workspace-a" },
      }),
    ).toHaveLength(1);
    expect(
      await vectorStore.search("facts", embeddingB, {
        topK: 1,
        filter: { userId: "u-delete-vectors", workspaceId: "workspace-b" },
      }),
    ).toHaveLength(1);

    await memory.deleteAllMemory({
      scope: { userId: "u-delete-vectors", workspaceId: "workspace-a" },
    });

    expect(
      await vectorStore.search("facts", embeddingA, {
        topK: 1,
        filter: { userId: "u-delete-vectors", workspaceId: "workspace-a" },
      }),
    ).toHaveLength(0);
    expect(
      await vectorStore.search("facts", embeddingB, {
        topK: 1,
        filter: { userId: "u-delete-vectors", workspaceId: "workspace-b" },
      }),
    ).toHaveLength(1);
  });
});
