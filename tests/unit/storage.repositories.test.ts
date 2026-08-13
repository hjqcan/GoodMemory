import { describe, expect, it } from "bun:test";
import {
  createMemoryRepositories,
} from "../../src/storage/repositories";
import {
  createFactMemory,
  createEpisodeMemory,
  createFeedbackMemory,
  createPreferenceMemory,
  createReferenceMemory,
  createSessionBuffer,
  createSessionJournal,
  createUserProfile,
  createWorkingMemorySnapshot,
} from "../../src/domain/records";
import {
  createEvidenceRecord,
  EVIDENCE_COLLECTION,
} from "../../src/evidence/contracts";
import {
  createExperienceRecord,
  createLearningProposal,
  createPromotionRecord,
  createSessionArchive,
} from "../../src/evolution/contracts";
import type {
  DocumentStore,
  ProjectionCapableDocumentStore,
} from "../../src/storage/contracts";
import {
  createInMemoryDocumentStore,
  createInMemorySessionStore,
  createInMemoryVectorStore,
} from "../../src/storage/memory";
import type {
  EvolutionRepositoryPort,
  GovernanceRepositoryPort,
  GovernanceVectorPort,
  MaintenanceRepositoryPort,
  MaintenanceVectorPort,
  RecallRepositoryPort,
  RecallVectorSearchPort,
  RememberRepositoryPort,
  RememberVectorPort,
} from "../../src/storage/ports";

describe("memory repositories", () => {
  it("provides typed accessors over storage contracts", async () => {
    const repositories = createMemoryRepositories({
      documentStore: createInMemoryDocumentStore(),
      sessionStore: createInMemorySessionStore(),
    });

    const profile = createUserProfile({
      userId: "u-1",
      identity: { name: "Lin" },
    });
    await repositories.profiles.upsert(profile);
    expect(await repositories.profiles.get("u-1")).toEqual(profile);

    const fact = createFactMemory({
      id: "f-1",
      userId: "u-1",
      category: "project",
      content: "Robot workflow remains open.",
      source: { method: "explicit", extractedAt: "2026-01-01T00:00:00.000Z" },
    });
    await repositories.facts.add(fact);

    expect(await repositories.facts.listByUser("u-1")).toHaveLength(1);
  });

  it("overwrites the existing record when add reuses an id (upsert semantics)", async () => {
    const repositories = createMemoryRepositories({
      documentStore: createInMemoryDocumentStore(),
      sessionStore: createInMemorySessionStore(),
    });

    // Maintenance depends on this: ttlExpiry/dedupe demote a fact by re-adding
    // its superseded copy under the same id, so add must overwrite, not append.
    const original = createFactMemory({
      id: "f-1",
      userId: "u-1",
      category: "project",
      content: "Robot workflow remains open.",
      source: { method: "explicit", extractedAt: "2026-01-01T00:00:00.000Z" },
    });
    await repositories.facts.add(original);
    await repositories.facts.add(
      createFactMemory({
        ...original,
        lifecycle: "inactive",
        isActive: false,
        demotionReason: "ttl_expired",
      }),
    );

    const facts = await repositories.facts.listByUser("u-1");
    expect(facts).toHaveLength(1);
    expect(facts[0]?.lifecycle).toBe("inactive");
    expect(facts[0]?.demotionReason).toBe("ttl_expired");
  });

  it("satisfies narrow internal ports for subsystem assembly", async () => {
    const repositories = createMemoryRepositories({
      documentStore: createInMemoryDocumentStore(),
      sessionStore: createInMemorySessionStore(),
      vectorStore: createInMemoryVectorStore(),
    });
    const rememberRepositories: RememberRepositoryPort = repositories;
    const recallRepositories: RecallRepositoryPort = repositories;
    const evolutionRepositories: EvolutionRepositoryPort = repositories;
    const governanceRepositories: GovernanceRepositoryPort = repositories;
    const maintenanceRepositories: MaintenanceRepositoryPort = repositories;
    const rememberVector = repositories.vectorIndex as RememberVectorPort;
    const recallVector = repositories.vectorIndex as RecallVectorSearchPort;
    const governanceVector = repositories.vectorIndex as GovernanceVectorPort;
    const maintenanceVector = repositories.vectorIndex as MaintenanceVectorPort;
    const scope = { userId: "u-port", workspaceId: "workspace-a" };

    const fact = createFactMemory({
      id: "fact-port",
      userId: "u-port",
      workspaceId: "workspace-a",
      category: "project",
      content: "Ports keep subsystem wiring narrow.",
      source: { method: "explicit", extractedAt: "2026-01-01T00:00:00.000Z" },
    });
    await rememberRepositories.facts.add(fact);

    const archive = createSessionArchive({
      id: "archive-port",
      userId: "u-port",
      workspaceId: "workspace-a",
      sessionId: "session-a",
      summary: "Archive created through maintenance port.",
      createdAt: "2026-01-01T00:00:00.000Z",
      archivedAt: "2026-01-01T00:00:00.000Z",
    });
    await maintenanceRepositories.archives.add(archive);

    const proposal = createLearningProposal({
      id: "proposal-port",
      userId: "u-port",
      workspaceId: "workspace-a",
      proposalType: "procedural_pattern",
      traceId: "trace-port",
      summary: "Promote a stable preference after review.",
      rationale: "Ports keep proposal persistence narrow and explicit.",
    });
    await evolutionRepositories.proposals.add(proposal);

    await rememberVector.upsertFactEmbedding([
      {
        id: fact.id,
        embedding: [1, 0, 0],
        metadata: { userId: "u-port", workspaceId: "workspace-a", memoryType: "fact" },
        content: fact.content,
      },
    ]);

    expect(await recallRepositories.facts.listByScope(scope)).toEqual([fact]);
    expect(await recallRepositories.archives.listByScope(scope)).toEqual([archive]);
    expect(await evolutionRepositories.proposals.get(proposal.id)).toEqual(proposal);
    expect(await governanceRepositories.profiles.get("u-port")).toBeNull();
    expect(
      await recallVector.searchFactEmbedding([1, 0, 0], {
        topK: 1,
        filter: { userId: "u-port", workspaceId: "workspace-a" },
      }),
    ).toContainEqual(expect.objectContaining({ id: fact.id }));

    await governanceVector.deleteFactEmbedding(fact.id);
    await rememberVector.upsertFactEmbedding([
      {
        id: fact.id,
        embedding: [1, 0, 0],
        metadata: { userId: "u-port", workspaceId: "workspace-a", memoryType: "fact" },
        content: fact.content,
      },
    ]);
    await maintenanceVector.deleteFactEmbedding(fact.id);
    expect(
      await recallVector.searchFactEmbedding([1, 0, 0], {
        topK: 1,
        filter: { userId: "u-port", workspaceId: "workspace-a" },
      }),
    ).toHaveLength(0);
  });

  it("supports scope-aware retrieval for facts and feedback", async () => {
    const repositories = createMemoryRepositories({
      documentStore: createInMemoryDocumentStore(),
      sessionStore: createInMemorySessionStore(),
    });

    await repositories.facts.add(
      createFactMemory({
        id: "f-1",
        userId: "u-1",
        workspaceId: "workspace-a",
        category: "project",
        content: "Workspace A fact.",
        source: { method: "explicit", extractedAt: "2026-01-01T00:00:00.000Z" },
      }),
    );
    await repositories.facts.add(
      createFactMemory({
        id: "f-2",
        userId: "u-1",
        workspaceId: "workspace-b",
        category: "project",
        content: "Workspace B fact.",
        source: { method: "explicit", extractedAt: "2026-01-01T00:00:00.000Z" },
      }),
    );
    await repositories.feedback.upsert(
      createFeedbackMemory({
        id: "fb-1",
        userId: "u-1",
        workspaceId: "workspace-a",
        rule: "Keep answers concise.",
        kind: "do",
        source: { method: "explicit", extractedAt: "2026-01-01T00:00:00.000Z" },
      }),
    );

    expect(
      await repositories.facts.listByScope({
        userId: "u-1",
        workspaceId: "workspace-a",
      }),
    ).toHaveLength(1);
    expect(
      await repositories.feedback.listByScope({
        userId: "u-1",
        workspaceId: "workspace-a",
      }),
    ).toHaveLength(1);
    expect(
      await repositories.feedback.listByScope({
        userId: "u-1",
        workspaceId: "workspace-b",
      }),
    ).toHaveLength(0);
  });

  it("persists preferences, references, episodes, and runtime state through typed accessors", async () => {
    const scope = {
      userId: "u-1",
      workspaceId: "workspace-a",
      sessionId: "s-1",
    };
    const repositories = createMemoryRepositories({
      documentStore: createInMemoryDocumentStore(),
      sessionStore: createInMemorySessionStore(),
      vectorStore: createInMemoryVectorStore(),
    });

    await repositories.preferences.upsert(
      createPreferenceMemory({
        id: "pref-1",
        userId: "u-1",
        workspaceId: "workspace-a",
        category: "response_style",
        value: "concise bullet points",
        source: { method: "explicit", extractedAt: "2026-01-01T00:00:00.000Z" },
      }),
    );
    await repositories.references.add(
      createReferenceMemory({
        id: "ref-1",
        userId: "u-1",
        workspaceId: "workspace-a",
        title: "Runbook",
        pointer: "docs/runtime-runbook.md",
        source: { method: "explicit", extractedAt: "2026-01-01T00:00:00.000Z" },
      }),
    );
    await repositories.episodes.add(
      createEpisodeMemory({
        id: "ep-1",
        userId: "u-1",
        workspaceId: "workspace-a",
        summary: "Conversation covered runtime migration.",
        keyDecisions: [],
        unresolvedItems: ["confirm rollout"],
        topics: ["runtime migration"],
      }),
    );
    await repositories.sessionBuffers.save(
      scope,
      createSessionBuffer({
        sessionId: "s-1",
        userId: "u-1",
      }),
    );
    await repositories.workingMemory.save(
      scope,
      createWorkingMemorySnapshot({
        sessionId: "s-1",
        userId: "u-1",
        currentGoal: "finish runtime migration",
      }),
    );
    await repositories.sessionJournals.save(
      scope,
      createSessionJournal({
        sessionId: "s-1",
        userId: "u-1",
        worklog: ["runtime migration started"],
      }),
    );
    await repositories.vectorIndex?.upsertEpisodeEmbedding([
      {
        id: "ep-1",
        embedding: [1, 0, 0],
        metadata: { userId: "u-1", workspaceId: "workspace-a" },
        content: "runtime migration",
      },
    ]);

    expect(await repositories.preferences.listByUser("u-1")).toHaveLength(1);
    expect(await repositories.references.listByUser("u-1")).toHaveLength(1);
    expect(await repositories.episodes.listByUser("u-1")).toHaveLength(1);
    expect(await repositories.preferences.listByScope(scope)).toHaveLength(1);
    expect(await repositories.references.listByScope(scope)).toHaveLength(1);
    expect(await repositories.episodes.listByScope(scope)).toHaveLength(1);
    expect((await repositories.sessionBuffers.get(scope))?.sessionId).toBe("s-1");
    expect((await repositories.workingMemory.get(scope))?.currentGoal).toBe(
      "finish runtime migration",
    );
    expect((await repositories.sessionJournals.get(scope))?.worklog).toEqual([
      "runtime migration started",
    ]);
    expect(
      await repositories.vectorIndex?.searchEpisodeEmbedding([1, 0, 0], {
        topK: 1,
        filter: { userId: "u-1" },
      }),
    ).toHaveLength(1);
  });

  it("stores and searches fact, reference, and episode embeddings through typed vector hooks", async () => {
    const repositories = createMemoryRepositories({
      documentStore: createInMemoryDocumentStore(),
      sessionStore: createInMemorySessionStore(),
      vectorStore: createInMemoryVectorStore(),
    });

    await repositories.vectorIndex?.upsertFactEmbedding([
      {
        id: "fact-1",
        embedding: [1, 0, 0],
        metadata: {
          userId: "u-1",
          workspaceId: "workspace-a",
          memoryType: "fact",
        },
        content: "runtime rollout blocked on vendor approval",
      },
    ]);
    await repositories.vectorIndex?.upsertReferenceEmbedding([
      {
        id: "ref-1",
        embedding: [0, 1, 0],
        metadata: {
          userId: "u-1",
          workspaceId: "workspace-a",
          memoryType: "reference",
        },
        content: "Runbook\ndocs/runtime-runbook.md",
      },
    ]);
    await repositories.vectorIndex?.upsertEpisodeEmbedding([
      {
        id: "ep-1",
        embedding: [0, 0, 1],
        metadata: {
          userId: "u-1",
          workspaceId: "workspace-a",
          memoryType: "episode",
        },
        content: "Runtime migration continuity",
      },
    ]);

    expect(
      await repositories.vectorIndex?.searchFactEmbedding([1, 0, 0], {
        topK: 1,
        filter: { userId: "u-1", workspaceId: "workspace-a" },
      }),
    ).toHaveLength(1);
    expect(
      await repositories.vectorIndex?.searchReferenceEmbedding([0, 1, 0], {
        topK: 1,
        filter: { userId: "u-1", workspaceId: "workspace-a" },
      }),
    ).toHaveLength(1);
    expect(
      await repositories.vectorIndex?.searchEpisodeEmbedding([0, 0, 1], {
        topK: 1,
        filter: { userId: "u-1", workspaceId: "workspace-a" },
      }),
    ).toHaveLength(1);
    expect(
      await repositories.vectorIndex?.searchFactEmbedding([1, 0, 0], {
        topK: 1,
        filter: { userId: "u-1", workspaceId: "workspace-b" },
      }),
    ).toHaveLength(0);
    expect(await repositories.vectorIndex?.getFactEmbedding("fact-1")).toEqual({
      id: "fact-1",
      embedding: [1, 0, 0],
      metadata: {
        userId: "u-1",
        workspaceId: "workspace-a",
        memoryType: "fact",
      },
      content: "runtime rollout blocked on vendor approval",
    });
  });

  it("deletes fact, reference, and episode embeddings through typed vector hooks", async () => {
    const repositories = createMemoryRepositories({
      documentStore: createInMemoryDocumentStore(),
      sessionStore: createInMemorySessionStore(),
      vectorStore: createInMemoryVectorStore(),
    });

    await repositories.vectorIndex?.upsertFactEmbedding([
      {
        id: "fact-1",
        embedding: [1, 0, 0],
        metadata: { userId: "u-1", workspaceId: "workspace-a", memoryType: "fact" },
        content: "runtime rollout blocked",
      },
    ]);
    await repositories.vectorIndex?.upsertReferenceEmbedding([
      {
        id: "ref-1",
        embedding: [0, 1, 0],
        metadata: { userId: "u-1", workspaceId: "workspace-a", memoryType: "reference" },
        content: "Runbook\ndocs/runtime-runbook.md",
      },
    ]);
    await repositories.vectorIndex?.upsertEpisodeEmbedding([
      {
        id: "ep-1",
        embedding: [0, 0, 1],
        metadata: { userId: "u-1", workspaceId: "workspace-a", memoryType: "episode" },
        content: "Runtime migration continuity",
      },
    ]);

    await repositories.vectorIndex?.deleteFactEmbedding("fact-1");
    await repositories.vectorIndex?.deleteReferenceEmbedding("ref-1");
    await repositories.vectorIndex?.deleteEpisodeEmbedding("ep-1");

    expect(
      await repositories.vectorIndex?.searchFactEmbedding([1, 0, 0], {
        topK: 1,
        filter: { userId: "u-1", workspaceId: "workspace-a" },
      }),
    ).toHaveLength(0);
    expect(
      await repositories.vectorIndex?.searchReferenceEmbedding([0, 1, 0], {
        topK: 1,
        filter: { userId: "u-1", workspaceId: "workspace-a" },
      }),
    ).toHaveLength(0);
    expect(
      await repositories.vectorIndex?.searchEpisodeEmbedding([0, 0, 1], {
        topK: 1,
        filter: { userId: "u-1", workspaceId: "workspace-a" },
      }),
    ).toHaveLength(0);
  });

  it("persists archives and evidence through typed accessors", async () => {
    const repositories = createMemoryRepositories({
      documentStore: createInMemoryDocumentStore(),
      sessionStore: createInMemorySessionStore(),
    });

    const archive = createSessionArchive({
      id: "archive-1",
      userId: "u-1",
      workspaceId: "workspace-a",
      sessionId: "s-1",
      summary: "The session closed with one unresolved rollout blocker.",
      unresolvedItems: ["confirm rollback owner"],
    });
    const evidence = createEvidenceRecord({
      id: "evidence-1",
      userId: "u-1",
      workspaceId: "workspace-a",
      sessionId: "s-1",
      kind: "conversation_excerpt",
      excerpt: "The user said the rollback owner is still pending.",
      source: { method: "explicit", extractedAt: "2026-04-10T00:00:00.000Z" },
      linkedArchiveIds: ["archive-1"],
    });

    await repositories.archives.add(archive);
    await repositories.evidence.add(evidence);

    expect(await repositories.archives.get("archive-1")).toEqual(archive);
    expect(await repositories.evidence.get("evidence-1")).toEqual(evidence);
    expect(await repositories.archives.listByUser("u-1")).toHaveLength(1);
    expect(
      await repositories.archives.listByScope({
        userId: "u-1",
        workspaceId: "workspace-a",
      }),
    ).toHaveLength(1);
    expect(
      await repositories.evidence.listByScope({
        userId: "u-1",
        workspaceId: "workspace-a",
      }),
    ).toHaveLength(1);
  });

  it("persists experience telemetry through typed accessors", async () => {
    const repositories = createMemoryRepositories({
      documentStore: createInMemoryDocumentStore(),
      sessionStore: createInMemorySessionStore(),
    });

    const experience = createExperienceRecord({
      id: "xp-1",
      userId: "u-1",
      workspaceId: "workspace-a",
      sessionId: "s-1",
      kind: "maintenance",
      traceId: "trace-maint-1",
      summary: "Maintenance ran one low-risk dedupe job.",
      linkedMemoryIds: ["fact-1"],
    });

    await repositories.experiences.add(experience);

    expect(await repositories.experiences.get("xp-1")).toEqual(experience);
    expect(await repositories.experiences.listByUser("u-1")).toHaveLength(1);
    expect(
      await repositories.experiences.listByScope({
        userId: "u-1",
        workspaceId: "workspace-a",
      }),
    ).toHaveLength(1);
  });

  it("does not trust an unversioned same-named conditional writer for behavioral outcomes", async () => {
    const inner = createInMemoryDocumentStore();
    let conditionalWriteCount = 0;
    const legacyStore: DocumentStore = {
      delete: (collection, id) => inner.delete(collection, id),
      get: (collection, id) => inner.get(collection, id),
      query: (collection, filter) => inner.query(collection, filter),
      set: (collection, id, document) => inner.set(collection, id, document),
      update: (collection, id, patch) => inner.update(collection, id, patch),
      async writeBatchIfUnchanged() {
        conditionalWriteCount += 1;
        return true;
      },
    };
    const repositories = createMemoryRepositories({
      documentStore: legacyStore,
      sessionStore: createInMemorySessionStore(),
    });
    const experience = createExperienceRecord({
      id: "xp-unversioned-conditional-writer",
      kind: "tool_outcome",
      summary: "This record must not receive a false insertion receipt.",
      traceId: "trace-unversioned-conditional-writer",
      userId: "u-1",
    });

    await expect(repositories.behavioralOutcomes.add({ experience }))
      .rejects.toThrow("projection-capable document store");
    expect(conditionalWriteCount).toBe(0);
    expect(await repositories.experiences.get(experience.id)).toBeNull();
  });

  it("keeps ordinary evidence and experience writes compatible with legacy stores", async () => {
    const inner = createInMemoryDocumentStore();
    const legacyStore: DocumentStore = {
      delete: (collection, id) => inner.delete(collection, id),
      get: (collection, id) => inner.get(collection, id),
      query: (collection, filter) => inner.query(collection, filter),
      set: (collection, id, document) => inner.set(collection, id, document),
      update: (collection, id, patch) => inner.update(collection, id, patch),
    };
    const repositories = createMemoryRepositories({
      documentStore: legacyStore,
      sessionStore: createInMemorySessionStore(),
    });
    const evidence = createEvidenceRecord({
      excerpt: "Legacy adapters retain ordinary evidence writes.",
      id: "evidence-legacy-store",
      kind: "conversation_excerpt",
      source: { extractedAt: "2026-04-21T00:00:00.000Z", method: "confirmed" },
      userId: "u-1",
    });
    const experience = createExperienceRecord({
      id: "xp-legacy-store",
      kind: "maintenance",
      summary: "Legacy adapters retain ordinary experience writes.",
      traceId: "trace-legacy-store",
      userId: "u-1",
    });

    await repositories.evidence.add(evidence);
    await repositories.experiences.add(experience);
    const updatedExperience = createExperienceRecord({
      ...experience,
      summary: "Legacy adapters retain ordinary experience upserts.",
    });
    await repositories.experiences.add(updatedExperience);

    expect(await repositories.evidence.get(evidence.id)).toEqual(evidence);
    expect(await repositories.experiences.get(experience.id)).toEqual(
      updatedExperience,
    );
  });

  it("does not leave an experience behind when evidence changes during aggregate CAS", async () => {
    const inner = createInMemoryDocumentStore();
    const incomingEvidence = createEvidenceRecord({
      excerpt: "The first observed tool result.",
      id: "evidence-raced-outcome",
      kind: "tool_result_excerpt",
      source: { extractedAt: "2026-04-21T00:00:00.000Z", method: "confirmed" },
      userId: "u-1",
    });
    const competingEvidence = createEvidenceRecord({
      ...incomingEvidence,
      excerpt: "A conflicting tool result won the race.",
    });
    let injectCompetingEvidence = true;
    const racedStore: ProjectionCapableDocumentStore = {
      ...inner,
      async writeBatchIfUnchanged(input) {
        if (injectCompetingEvidence) {
          injectCompetingEvidence = false;
          await inner.set(
            EVIDENCE_COLLECTION,
            competingEvidence.id,
            competingEvidence,
          );
        }
        return inner.writeBatchIfUnchanged(input);
      },
    };
    const repositories = createMemoryRepositories({
      documentStore: racedStore,
      sessionStore: createInMemorySessionStore(),
    });
    const experience = createExperienceRecord({
      id: "xp-raced-outcome",
      kind: "tool_outcome",
      linkedEvidenceIds: [incomingEvidence.id],
      summary: "The aggregate must follow the evidence CAS result.",
      traceId: "trace-raced-outcome",
      userId: "u-1",
    });

    await expect(repositories.behavioralOutcomes.add({
      evidence: incomingEvidence,
      experience,
    })).rejects.toThrow("identity conflict");
    expect(await repositories.evidence.get(incomingEvidence.id)).toEqual(
      competingEvidence,
    );
    expect(await repositories.experiences.get(experience.id)).toBeNull();
  });

  it("persists learning proposals and promotion records through typed accessors", async () => {
    const repositories = createMemoryRepositories({
      documentStore: createInMemoryDocumentStore(),
      sessionStore: createInMemorySessionStore(),
    });

    const proposal = createLearningProposal({
      id: "proposal-1",
      userId: "u-1",
      workspaceId: "workspace-a",
      sessionId: "s-1",
      proposalType: "procedural_pattern",
      traceId: "trace-review-1",
      summary: "Promote a stable rollback checklist into a validated pattern.",
      rationale: "Three sessions reused the same corrective sequence successfully.",
      sourceExperienceIds: ["xp-1"],
      linkedMemoryIds: ["feedback-1"],
    });
    const promotion = createPromotionRecord({
      id: "promotion-1",
      proposalId: "proposal-1",
      userId: "u-1",
      workspaceId: "workspace-a",
      sessionId: "s-1",
      traceId: "trace-gate-1",
      decision: "accepted",
      summary: "Accepted a governed procedural promotion.",
      rationale: "Rules-only evidence and eval both passed.",
      sourceExperienceIds: ["xp-1"],
      linkedMemoryIds: ["feedback-1"],
      policyOutcome: "passed",
      verificationOutcome: "passed",
      evalOutcome: "passed",
    });

    await repositories.proposals.add(proposal);
    await repositories.promotions.add(promotion);

    expect(await repositories.proposals.get("proposal-1")).toEqual(proposal);
    expect(await repositories.promotions.get("promotion-1")).toEqual(promotion);
    expect(await repositories.proposals.listByUser("u-1")).toHaveLength(1);
    expect(await repositories.promotions.listByUser("u-1")).toHaveLength(1);
    expect(
      await repositories.proposals.listByScope({
        userId: "u-1",
        workspaceId: "workspace-a",
      }),
    ).toHaveLength(1);
    expect(
      await repositories.promotions.listByScope({
        userId: "u-1",
        workspaceId: "workspace-a",
      }),
    ).toHaveLength(1);
  });

  it("returns a null vector index when no vector store is configured", () => {
    const repositories = createMemoryRepositories({
      documentStore: createInMemoryDocumentStore(),
      sessionStore: createInMemorySessionStore(),
    });

    expect(repositories.vectorIndex).toBeNull();
  });

  it("reads stored source messages by id within scope (episode span hydration)", async () => {
    const documentStore = createInMemoryDocumentStore();
    const repositories = createMemoryRepositories({
      documentStore,
      sessionStore: createInMemorySessionStore(),
    });
    const base = {
      contentSha256: "sha",
      ingestedAt: "2026-01-05T10:00:00.000Z",
      schemaVersion: 1 as const,
    };
    await documentStore.set("source_messages_v1", "m-1", {
      ...base,
      content: "We hit the rollout blocker in staging.",
      id: "m-1",
      observedAt: "2026-01-05T09:30:00.000Z",
      role: "user",
      userId: "u-1",
    });
    await documentStore.set("source_messages_v1", "m-2", {
      ...base,
      content: "The missing feature flag blocks the rollout.",
      id: "m-2",
      role: "assistant",
      userId: "u-1",
    });
    await documentStore.set("source_messages_v1", "m-other-user", {
      ...base,
      content: "Unrelated user's message.",
      id: "m-other-user",
      role: "user",
      userId: "u-2",
    });

    const records = await repositories.sourceMessages.getByIds({
      ids: ["m-1", "m-2", "m-other-user", "m-missing"],
      scope: { userId: "u-1" },
    });
    expect(records.map((record) => record.id)).toEqual(["m-1", "m-2"]);
    expect(records[0]?.content).toContain("rollout blocker");

    // Satisfies the recall port's optional span-hydration surface.
    const recallPort: RecallRepositoryPort = repositories;
    expect(recallPort.sourceMessages).toBeDefined();
  });
});
