import { describe, expect, it } from "bun:test";
import type { GoodMemoryTraceSpan, MemoryCandidate } from "../../src";
import { createGoodMemory, createLanguageService } from "../../src";
import {
  createInMemoryDocumentStore,
  createInMemorySessionStore,
  createInMemoryVectorStore,
} from "../../src/storage/memory";
import type {
  DocumentStore,
  StorageFilter,
  VectorStore,
} from "../../src/storage/contracts";
import { createMemoryRepositories } from "../../src/storage/repositories";
import { createFakeEmbeddingAdapter } from "../../src/testing/fakes";
import {
  createFactMemory,
  createFeedbackMemory,
  type FactMemory,
  type FeedbackMemory,
} from "../../src/domain/records";

function builtinAnalyzerVersion(packId: string): string {
  const pack = createLanguageService()
    .getAnalyzerManifest()
    .packs.find(({ id }) => id === packId);
  if (!pack) {
    throw new Error(`Missing built-in language pack ${packId}.`);
  }
  return pack.analyzerVersion;
}

function createRevisionRaceDocumentStore(
  base: DocumentStore,
): DocumentStore & { enableRaceOn(collection: string, id: string): void } {
  let delayedCollection: string | undefined;
  let delayedId: string | undefined;

  return {
    enableRaceOn(collection, id) {
      delayedCollection = collection;
      delayedId = id;
    },
    async set(collection, id, document) {
      await base.set(collection, id, document);
    },
    async get(collection, id) {
      if (collection === delayedCollection && id === delayedId) {
        await Promise.resolve();
        await Promise.resolve();
      }

      return base.get(collection, id);
    },
    async update(collection, id, patch) {
      await base.update(collection, id, patch);
    },
    async query(collection, filter) {
      return base.query(collection, filter);
    },
    async writeBatchIfUnchanged(input) {
      return base.writeBatchIfUnchanged!(input);
    },
    async delete(collection, id) {
      await base.delete(collection, id);
    },
  };
}

function createSharedRevisionRaceController(base: DocumentStore): {
  createStore(): DocumentStore;
  enableRaceOn(collection: string, id: string): void;
} {
  let delayedCollection: string | undefined;
  let delayedId: string | undefined;
  let waitingReads: Array<() => void> = [];
  let readCount = 0;

  function releaseWaitingReads(): void {
    for (const release of waitingReads) {
      release();
    }
    waitingReads = [];
  }

  async function synchronizedGet<TDocument extends object>(
    collection: string,
    id: string,
  ): Promise<TDocument | null> {
    if (collection !== delayedCollection || id !== delayedId) {
      return base.get<TDocument>(collection, id);
    }

    const snapshot = await base.get<TDocument>(collection, id);
    readCount += 1;
    if (readCount >= 2) {
      releaseWaitingReads();
      return snapshot;
    }

    await new Promise<void>((resolve) => {
      waitingReads.push(resolve);
    });

    return snapshot;
  }

  return {
    createStore() {
      return {
        async set(collection, id, document) {
          await base.set(collection, id, document);
        },
        get: synchronizedGet,
        async update(collection, id, patch) {
          await base.update(collection, id, patch);
        },
        async query(collection, filter) {
          return base.query(collection, filter);
        },
        async writeBatchIfUnchanged(input) {
          return base.writeBatchIfUnchanged!(input);
        },
        async delete(collection, id) {
          await base.delete(collection, id);
        },
      };
    },
    enableRaceOn(collection, id) {
      delayedCollection = collection;
      delayedId = id;
      readCount = 0;
      releaseWaitingReads();
    },
  };
}

function createSharedRevisionCommitRaceController(base: DocumentStore): {
  createStore(): DocumentStore;
  enableRaceOn(collection: string, id: string): void;
} {
  let delayedCollection: string | undefined;
  let delayedId: string | undefined;
  let waitingWrites: Array<() => void> = [];
  let writeCount = 0;

  function releaseWaitingWrites(): void {
    for (const release of waitingWrites) {
      release();
    }
    waitingWrites = [];
  }

  async function synchronizedWriteBatch(
    input: Parameters<NonNullable<DocumentStore["writeBatchIfUnchanged"]>>[0],
  ): Promise<boolean> {
    if (
      input.expected.collection !== delayedCollection ||
      input.expected.id !== delayedId
    ) {
      return base.writeBatchIfUnchanged!(input);
    }

    writeCount += 1;
    if (writeCount >= 2) {
      releaseWaitingWrites();
    } else {
      await new Promise<void>((resolve) => {
        waitingWrites.push(resolve);
      });
    }

    return base.writeBatchIfUnchanged!(input);
  }

  return {
    createStore() {
      return {
        async set(collection, id, document) {
          await base.set(collection, id, document);
        },
        async get(collection, id) {
          return base.get(collection, id);
        },
        async update(collection, id, patch) {
          await base.update(collection, id, patch);
        },
        async query(collection, filter) {
          return base.query(collection, filter);
        },
        writeBatchIfUnchanged: synchronizedWriteBatch,
        async delete(collection, id) {
          await base.delete(collection, id);
        },
      };
    },
    enableRaceOn(collection, id) {
      delayedCollection = collection;
      delayedId = id;
      writeCount = 0;
      releaseWaitingWrites();
    },
  };
}

function createLegacyDocumentStore(base: DocumentStore): DocumentStore {
  const legacy: Omit<DocumentStore, "writeBatchIfUnchanged"> = {
    async set(collection, id, document) {
      await base.set(collection, id, document);
    },
    async get(collection, id) {
      return base.get(collection, id);
    },
    async update(collection, id, patch) {
      await base.update(collection, id, patch);
    },
    async query(collection, filter) {
      return base.query(collection, filter);
    },
    async delete(collection, id) {
      await base.delete(collection, id);
    },
  };
  return legacy as DocumentStore;
}

function createDeleteFailingVectorStore(base: VectorStore): VectorStore {
  return {
    async upsert(collection, records) {
      await base.upsert(collection, records);
    },
    async get(collection, id) {
      return base.get(collection, id);
    },
    async search(collection, queryEmbedding, input) {
      return base.search(collection, queryEmbedding, input);
    },
    async delete() {
      throw new Error("vector delete unavailable");
    },
  };
}

describe("public reviseMemory API", () => {
  it("anchors changed fact content to the revision observation time", async () => {
    const documentStore = createInMemoryDocumentStore();
    const revisedAt = "2026-08-13T00:00:00.000Z";
    const memory = createGoodMemory({
      adapters: {
        documentStore,
        sessionStore: createInMemorySessionStore(),
      },
      storage: { provider: "memory" },
      testing: { now: () => new Date(revisedAt) },
    });
    const scope = { userId: "revision-observation-user" };
    const original = createFactMemory({
      id: "fact-old-owner",
      ...scope,
      category: "project",
      content: "The Atlas owner is Mira.",
      observedAt: "2025-12-01T00:00:00.000Z",
      source: {
        extractedAt: "2025-12-01T00:00:00.000Z",
        method: "explicit",
      },
      createdAt: "2025-12-01T00:00:00.000Z",
      updatedAt: "2025-12-01T00:00:00.000Z",
    });
    await documentStore.set("facts", original.id, original);

    const result = await memory.reviseMemory({
      idempotencyKey: "revision-observation-time",
      reason: "user_correction",
      revision: { content: "The Atlas owner is Jules." },
      scope,
      target: { memoryId: original.id },
    });
    const revised = await documentStore.get<FactMemory>(
      "facts",
      result.newMemoryId!,
    );

    expect(revised?.observedAt).toBe(revisedAt);
  });

  it("clears an event occurrence when revision content changes without trusted temporal context", async () => {
    const memory = createGoodMemory({ storage: { provider: "memory" } });
    const scope = { userId: "revision-event-occurrence-user" };
    await memory.remember({
      extractionStrategy: "rules-only",
      locale: "en-US",
      messages: [{
        content: "I ate soup yesterday.",
        observedAt: "2026-08-12T02:00:00.000Z",
        role: "user",
        timezone: "Asia/Shanghai",
      }],
      scope,
    });
    const before = await memory.exportMemory({ scope });
    const target = before.durable.facts[0];
    expect(target?.occurrence).toBeDefined();

    const revised = await memory.reviseMemory({
      idempotencyKey: "revision-event-occurrence",
      locale: "en-US",
      reason: "user_correction",
      revision: { content: "I ate salad today." },
      scope,
      target: { memoryId: target!.id },
    });
    const after = await memory.exportMemory({ scope });
    const active = after.durable.facts.find(({ id }) => id === revised.newMemoryId);
    const yesterday = await memory.recall({
      locale: "en-US",
      query: "What did I eat yesterday?",
      referenceTime: "2026-08-12T03:00:00.000Z",
      scope,
      strategy: "rules-only",
      timezone: "Asia/Shanghai",
    });
    const today = await memory.recall({
      locale: "en-US",
      query: "What did I eat today?",
      referenceTime: "2026-08-12T03:00:00.000Z",
      scope,
      strategy: "rules-only",
      timezone: "Asia/Shanghai",
    });

    expect(revised).toMatchObject({ accepted: true, outcome: "superseded" });
    expect(active).toMatchObject({
      content: "I ate salad today.",
      lifecycle: "active",
    });
    expect(active?.occurrence).toBeUndefined();
    expect(yesterday.facts).toEqual([]);
    expect(today.facts).toEqual([]);
  });

  it("preserves an event occurrence when revision content is unchanged", async () => {
    const memory = createGoodMemory({ storage: { provider: "memory" } });
    const scope = { userId: "revision-event-occurrence-unchanged-user" };
    await memory.remember({
      extractionStrategy: "rules-only",
      locale: "en-US",
      messages: [{
        content: "I ate soup yesterday.",
        observedAt: "2026-08-12T02:00:00.000Z",
        role: "user",
        timezone: "Asia/Shanghai",
      }],
      scope,
    });
    const before = await memory.exportMemory({ scope });
    const target = before.durable.facts[0]!;

    const revised = await memory.reviseMemory({
      idempotencyKey: "revision-event-occurrence-unchanged",
      locale: "en-US",
      reason: "manual_review",
      revision: { content: target.content },
      scope,
      target: { memoryId: target.id },
    });
    const after = await memory.exportMemory({ scope });
    const active = after.durable.facts.find(({ id }) => id === revised.newMemoryId);

    expect(active?.occurrence).toEqual(target.occurrence);
    expect(active?.observedAt).toBe(target.observedAt);
  });

  it("treats redacted metadata removal as authoritative for revised facts", async () => {
    const documentStore = createInMemoryDocumentStore();
    const memory = createGoodMemory({
      adapters: {
        documentStore,
        sessionStore: createInMemorySessionStore(),
      },
      policy: {
        redact(candidate) {
          return {
            ...candidate,
            metadata: undefined,
          };
        },
      },
      storage: { provider: "memory" },
      testing: { now: () => new Date("2026-08-13T00:00:00.000Z") },
    });
    const scope = {
      userId: "revision-redacted-metadata-removal-user",
      workspaceId: "workspace-a",
    } as const;
    const fact = createFactMemory({
      id: "fact-redacted-metadata-removal",
      ...scope,
      attributes: { credential: "SECRET-ATTRIBUTE" },
      category: "technical",
      confidence: 0.8,
      content: "The incident owner is Mira.",
      importance: 0.7,
      source: {
        extractedAt: "2026-08-12T00:00:00.000Z",
        method: "explicit",
      },
      subject: "incident",
      tags: ["SECRET-TAG"],
      createdAt: "2026-08-12T00:00:00.000Z",
      updatedAt: "2026-08-12T00:00:00.000Z",
    });
    await documentStore.set("facts", fact.id, fact);

    const result = await memory.reviseMemory({
      idempotencyKey: "revision-redacted-metadata-removal",
      reason: "user_correction",
      revision: { content: "The incident owner is Jules." },
      scope,
      target: { memoryId: fact.id },
    });
    const revised = await documentStore.get<FactMemory>(
      "facts",
      result.newMemoryId!,
    );

    expect(result).toMatchObject({ accepted: true, outcome: "superseded" });
    expect(revised).toMatchObject({
      confidence: 0.8,
      content: "The incident owner is Jules.",
      importance: 0.7,
      lifecycle: "active",
      source: {
        extractedAt: "2026-08-13T00:00:00.000Z",
        method: "confirmed",
      },
      userId: scope.userId,
      workspaceId: scope.workspaceId,
    });
    expect(revised?.attributes).toBeUndefined();
    expect(revised?.tags).toBeUndefined();
  });

  it("ignores runtime redaction fields outside the public redaction contract", async () => {
    let observedCandidate: MemoryCandidate | undefined;
    const memory = createGoodMemory({
      policy: {
        redact(candidate) {
          return {
            ...candidate,
            content: candidate.content.replace("Mira", "Jules"),
            durableTarget: { slot: "forged", value: "forged" },
            disposition: {
              kind: "durable_opt_out" as const,
              target: { identities: [], match: "exact" as const, text: "forged" },
            },
            id: "forged-policy-candidate",
            sourceMessageIndex: 999,
            sourceRole: "assistant",
          };
        },
        shouldRemember(candidate) {
          observedCandidate = candidate;
          return true;
        },
      },
      storage: { provider: "memory" },
    });
    const scope = { userId: "revision-redaction-authority-user" };
    const remembered = await memory.remember({
      messages: [{
        role: "user",
        content: "Remember that the deployment owner is Mira.",
      }],
      scope,
    });
    const targetMemoryId = remembered.events.find(
      ({ memoryType }) => memoryType === "fact",
    )?.memoryId;

    const result = await memory.reviseMemory({
      idempotencyKey: "revision-redaction-authority",
      reason: "user_correction",
      revision: { content: "The deployment owner is Mira." },
      scope,
      target: { memoryId: targetMemoryId! },
    });

    expect(result).toMatchObject({ accepted: true, outcome: "superseded" });
    expect(observedCandidate).toMatchObject({
      content: "The deployment owner is Jules.",
      sourceMessageIndex: 0,
      sourceRole: "user",
    });
    expect(observedCandidate?.id).not.toBe("forged-policy-candidate");
    expect(observedCandidate?.disposition).toBeUndefined();
    expect(observedCandidate?.durableTarget).toBeUndefined();
  });

  it("adopts explicit redacted fact metadata without authorizing occurrence", async () => {
    const documentStore = createInMemoryDocumentStore();
    const memory = createGoodMemory({
      adapters: {
        documentStore,
        sessionStore: createInMemorySessionStore(),
      },
      policy: {
        redact(candidate) {
          return {
            ...candidate,
            metadata: {
              attributes: { visibility: "public" },
              category: "personal",
              factKind: "focus_update",
              occurrenceExpression: {
                iso: "2026-08-13T00:00:00.000Z",
                kind: "absolute",
                raw: "today",
              },
              scopeKind: "identity",
              subject: "meal",
              tags: ["sanitized"],
            },
          };
        },
      },
      storage: { provider: "memory" },
    });
    const scope = { userId: "revision-redacted-metadata-replacement-user" };
    const fact = createFactMemory({
      id: "fact-redacted-metadata-replacement",
      ...scope,
      attributes: { credential: "SECRET-ATTRIBUTE" },
      category: "event",
      content: "I ate soup yesterday.",
      occurrence: {
        endExclusive: "2026-08-12T16:00:00.000Z",
        precision: "day",
        start: "2026-08-11T16:00:00.000Z",
        timezone: "Asia/Shanghai",
      },
      source: {
        extractedAt: "2026-08-12T02:00:00.000Z",
        method: "explicit",
      },
      subject: "old-meal",
      tags: ["SECRET-TAG"],
      createdAt: "2026-08-12T02:00:00.000Z",
      updatedAt: "2026-08-12T02:00:00.000Z",
    });
    await documentStore.set("facts", fact.id, fact);

    const result = await memory.reviseMemory({
      idempotencyKey: "revision-redacted-metadata-replacement",
      reason: "user_correction",
      revision: { content: "I ate salad today." },
      scope,
      target: { memoryId: fact.id },
    });
    const revised = await documentStore.get<FactMemory>(
      "facts",
      result.newMemoryId!,
    );

    expect(result).toMatchObject({ accepted: true, outcome: "superseded" });
    expect(revised).toMatchObject({
      attributes: { visibility: "public" },
      category: "personal",
      factKind: "focus_update",
      scopeKind: "identity",
      subject: "meal",
      tags: ["sanitized"],
    });
    expect(revised?.occurrence).toBeUndefined();
  });

  it("revises a targeted preference through governed supersede lineage", async () => {
    const spans: GoodMemoryTraceSpan[] = [];
    const memory = createGoodMemory({
      storage: { provider: "memory" },
      observability: {
        traceSink: {
          emit(span) {
            spans.push(span);
          },
        },
      },
      testing: {
        now: () => new Date("2026-04-25T00:00:00.000Z"),
      },
    });
    const scope = {
      userId: "revision-user",
      workspaceId: "phase-38",
      sessionId: "session-1",
    };

    const remembered = await memory.remember({
      scope,
      messages: [
        {
          role: "user",
          content: "I prefer VS Code as my editor.",
        },
      ],
    });
    const targetMemoryId = remembered.events.find(
      (event) => event.memoryType === "preference",
    )?.memoryId;

    expect(targetMemoryId).toBeString();
    const previousMemoryId = targetMemoryId!;

    const result = await memory.reviseMemory({
      scope,
      target: {
        memoryId: previousMemoryId,
      },
      revision: {
        content: "My preferred editor is Cursor, not VS Code.",
      },
      reason: "user_correction",
      evidence: {
        source: "user_message",
        message: "Actually I use Cursor now.",
      },
      idempotencyKey: "revision-user:session-1:editor-correction",
    });

    expect(result).toMatchObject({
      accepted: true,
      memoryType: "preference",
      outcome: "superseded",
      previousMemoryId,
      supersedeLineage: {
        supersedes: previousMemoryId,
        supersededBy: result.newMemoryId,
      },
    });
    expect(result.newMemoryId).toBeString();
    expect(result.newMemoryId).not.toBe(previousMemoryId);
    const newMemoryId = result.newMemoryId!;
    expect(result.evidenceIds).toHaveLength(1);
    expect(result.policyApplied).toContain("revision.target.memory_id");
    expect(result.traceId).toBeString();

    const recalled = await memory.recall({
      scope,
      query: "Which editor do I prefer?",
    });
    expect(recalled.preferences.map((preference) => String(preference.value))).toEqual([
      "My preferred editor is Cursor, not VS Code.",
    ]);

    const exported = await memory.exportMemory({
      scope,
    });
    const oldPreference = exported.durable.preferences.find(
      (preference) => preference.id === previousMemoryId,
    );
    const newPreference = exported.durable.preferences.find(
      (preference) => preference.id === newMemoryId,
    );
    const evidence = exported.durable.evidence.find(
      (record) => record.id === result.evidenceIds?.[0],
    );
    const englishAnalyzerVersion = builtinAnalyzerVersion("en");

    expect(oldPreference?.lifecycle).toBe("superseded");
    expect(oldPreference?.supersededBy).toBe(newMemoryId);
    expect(newPreference?.lifecycle).toBe("active");
    expect(newPreference?.source).toMatchObject({
      languagePackId: "en",
      languagePackVersion: englishAnalyzerVersion,
      locale: "en-US",
      localeSource: "default",
    });
    expect(evidence?.kind).toBe("correction_context");
    expect(evidence).toMatchObject({
      attributes: {
        revisionEvidenceSource: "user_message",
        revisionReason: "user_correction",
      },
      source: {
        languagePackId: "en",
        languagePackVersion: englishAnalyzerVersion,
        locale: "en-US",
        localeSource: "default",
      },
    });
    expect(evidence?.linkedMemoryIds).toEqual([
      previousMemoryId,
      newMemoryId,
    ]);

    expect(spans.map((span) => `${span.name}:${span.status}`)).toContain(
      "memory.revise:succeeded",
    );
    expect(JSON.stringify(spans)).not.toContain("Actually I use Cursor now.");
    expect(JSON.stringify(spans)).not.toContain("revision-user");
  });

  it("atomically supersedes every active category sibling with monotonic timestamps", async () => {
    const documentStore = createInMemoryDocumentStore();
    const memory = createGoodMemory({
      adapters: {
        documentStore,
        sessionStore: createInMemorySessionStore(),
      },
      storage: { provider: "memory" },
      testing: {
        now: () => new Date("2026-01-01T00:00:00.000Z"),
      },
    });
    const scope = {
      userId: "revision-preference-siblings-user",
      workspaceId: "workspace-a",
    };
    const first = {
      ...scope,
      category: "response_style",
      confidence: 1,
      evidenceCount: 1,
      id: "preference-revision-sibling-a",
      lifecycle: "active" as const,
      source: {
        extractedAt: "2026-01-02T00:00:00.000Z",
        method: "explicit" as const,
      },
      supersededBy: null,
      updatedAt: "2026-01-03T00:00:00.000Z",
      value: "bullet points",
    };
    const second = {
      ...scope,
      category: "response_style",
      confidence: 1,
      evidenceCount: 1,
      id: "preference-revision-sibling-b",
      lifecycle: "active" as const,
      source: {
        extractedAt: "2026-01-04T00:00:00.000Z",
        method: "explicit" as const,
      },
      supersededBy: null,
      updatedAt: "2026-01-02T00:00:00.000Z",
      value: "numbered lists",
    };
    await documentStore.set("preferences", first.id, first);
    await documentStore.set("preferences", second.id, second);

    const result = await memory.reviseMemory({
      idempotencyKey: "revision-all-preference-siblings",
      reason: "user_correction",
      revision: { content: "short paragraphs" },
      scope,
      target: { memoryId: first.id },
    });
    const preferences = await documentStore.query<{
      id: string;
      lifecycle: string;
      source: { extractedAt: string };
      supersededBy: string | null;
      updatedAt: string;
    }>("preferences", scope);
    const active = preferences.filter(({ lifecycle }) => lifecycle === "active");
    const superseded = preferences.filter(
      ({ lifecycle }) => lifecycle === "superseded",
    );

    expect(result.accepted).toBe(true);
    expect(active).toEqual([expect.objectContaining({
      id: result.newMemoryId,
      supersededBy: null,
    })]);
    expect(superseded).toHaveLength(2);
    expect(
      superseded.every(({ supersededBy }) => supersededBy === result.newMemoryId),
    ).toBe(true);
    expect(
      preferences.every(
        (preference) => preference.updatedAt >= preference.source.extractedAt,
      ),
    ).toBe(true);
    expect(active[0]?.updatedAt).toBe("2026-01-04T00:00:00.000Z");
  });

  it("persists revision reason and evidence source in the durable audit record", async () => {
    const memory = createGoodMemory({
      storage: { provider: "memory" },
      testing: {
        now: () => new Date("2026-04-25T00:00:00.000Z"),
      },
    });
    const scope = {
      userId: "revision-audit-user",
      workspaceId: "phase-38",
      sessionId: "session-1",
    };
    const remembered = await memory.remember({
      scope,
      messages: [
        {
          role: "user",
          content: "Remember that the migration owner is Mira.",
        },
      ],
    });
    const targetMemoryId = remembered.events.find(
      (event) => event.memoryType === "fact",
    )?.memoryId;

    expect(targetMemoryId).toBeString();

    const result = await memory.reviseMemory({
      scope,
      target: {
        memoryId: targetMemoryId!,
      },
      revision: {
        content: "The migration owner is Nora.",
      },
      reason: "manual_review",
      evidence: {
        source: "manual_review",
        excerpt: "Manual audit found that v2 is the current runbook.",
        sourceUri: "docs/reviews/migration-audit.md",
        sourceMessageIds: ["review-42"],
      },
      idempotencyKey: "revision-audit-manual-review",
    });
    const exported = await memory.exportMemory({
      scope,
    });
    const evidence = exported.durable.evidence.find(
      (record) => record.id === result.evidenceIds?.[0],
    );

    expect(result.accepted).toBe(true);
    expect(evidence).toMatchObject({
      kind: "correction_context",
      sourceUri: "docs/reviews/migration-audit.md",
      sourceMessageIds: ["review-42"],
      attributes: {
        revisionEvidenceSource: "manual_review",
        revisionReason: "manual_review",
      },
    });
  });

  it("makes targeted revisions idempotent", async () => {
    const memory = createGoodMemory({
      storage: { provider: "memory" },
    });
    const scope = {
      userId: "revision-idempotent-user",
      workspaceId: "phase-38",
      sessionId: "session-1",
    };
    const remembered = await memory.remember({
      scope,
      messages: [
        {
          role: "user",
          content: "Remember that the rollout owner is Mira.",
        },
      ],
    });
    const targetMemoryId = remembered.events.find(
      (event) => event.memoryType === "fact",
    )?.memoryId;

    expect(targetMemoryId).toBeString();

    const input = {
      scope,
      target: {
        memoryId: targetMemoryId!,
      },
      revision: {
        content: "The rollout owner is Jules.",
      },
      reason: "user_correction" as const,
      evidence: {
        source: "user_message" as const,
        message: "Correction: Jules owns the rollout.",
      },
      idempotencyKey: "revision-idempotent-owner",
    };

	    const first = await memory.reviseMemory(input);
	    const second = await memory.reviseMemory(input);
    const exported = await memory.exportMemory({
      scope,
    });

    expect(second).toEqual(first);
    expect(
      exported.durable.facts.filter((fact) => fact.id === first.newMemoryId),
    ).toHaveLength(1);
    expect(
      exported.durable.evidence.filter((record) => record.id === first.evidenceIds?.[0]),
    ).toHaveLength(1);
  });

  it("blocks conflicting reuse of a targeted revision idempotency key", async () => {
    const memory = createGoodMemory({
      storage: { provider: "memory" },
    });
    const scope = {
      userId: "revision-idempotent-conflict-user",
      workspaceId: "phase-38",
      sessionId: "session-1",
    };
    const remembered = await memory.remember({
      scope,
      messages: [
        {
          role: "user",
          content: "Remember that the incident reviewer is Mira.",
        },
      ],
    });
    const targetMemoryId = remembered.events.find(
      (event) => event.memoryType === "fact",
    )?.memoryId;

    expect(targetMemoryId).toBeString();

    const first = await memory.reviseMemory({
      scope,
      target: {
        memoryId: targetMemoryId!,
      },
      revision: {
        content: "The incident reviewer is Nora.",
      },
      reason: "user_correction",
      evidence: {
        source: "user_message",
        message: "Correction: Nora is reviewing the incident.",
      },
      idempotencyKey: "revision-idempotent-conflict",
    });
    const second = await memory.reviseMemory({
      scope,
      target: {
        memoryId: targetMemoryId!,
      },
      revision: {
        content: "The incident reviewer is Jules.",
      },
      reason: "user_correction",
      evidence: {
        source: "user_message",
        message: "Correction: Jules is reviewing the incident.",
      },
      idempotencyKey: "revision-idempotent-conflict",
    });
    const exported = await memory.exportMemory({
      scope,
    });

    expect(first.accepted).toBe(true);
    expect(second).toMatchObject({
      accepted: false,
      outcome: "blocked",
      memoryType: "fact",
      previousMemoryId: targetMemoryId,
      reason: "idempotency_conflict",
    });
    expect(exported.durable.facts).toContainEqual(
      expect.objectContaining({
        id: first.newMemoryId,
        content: "The incident reviewer is Nora.",
        lifecycle: "active",
      }),
    );
    expect(
      exported.durable.facts.some((fact) => fact.content.includes("Jules")),
    ).toBe(false);
  });

  it("blocks concurrent conflicting reuse of a targeted revision idempotency key", async () => {
    const sharedStore = createInMemoryDocumentStore();
    const race = createSharedRevisionCommitRaceController(sharedStore);
    const firstMemory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: {
        documentStore: race.createStore(),
        sessionStore: createInMemorySessionStore(),
      },
    });
    const secondMemory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: {
        documentStore: race.createStore(),
        sessionStore: createInMemorySessionStore(),
      },
    });
    const scope = {
      userId: "revision-concurrent-idempotent-conflict-user",
      workspaceId: "phase-38",
      sessionId: "session-1",
    };
    const remembered = await firstMemory.remember({
      scope,
      messages: [
        {
          role: "user",
          content: "Remember that the incident approver is Mira.",
        },
      ],
    });
    const targetMemoryId = remembered.events.find(
      (event) => event.memoryType === "fact",
    )?.memoryId;

    expect(targetMemoryId).toBeString();
    race.enableRaceOn("facts", targetMemoryId!);

    const [first, second] = await Promise.all([
      firstMemory.reviseMemory({
        scope,
        target: { memoryId: targetMemoryId! },
        revision: { content: "The incident approver is Nora." },
        reason: "user_correction",
        evidence: {
          source: "user_message",
          message: "Correction: Nora approves the incident.",
        },
        idempotencyKey: "revision-concurrent-idempotent-conflict",
      }),
      secondMemory.reviseMemory({
        scope,
        target: { memoryId: targetMemoryId! },
        revision: { content: "The incident approver is Jules." },
        reason: "user_correction",
        evidence: {
          source: "user_message",
          message: "Correction: Jules approves the incident.",
        },
        idempotencyKey: "revision-concurrent-idempotent-conflict",
      }),
    ]);
    const exported = await firstMemory.exportMemory({ scope });
    const accepted = [first, second].filter((result) => result.accepted);
    const blocked = [first, second].filter((result) => !result.accepted);

    expect(accepted).toHaveLength(1);
    expect(blocked).toHaveLength(1);
    expect(blocked[0]).toMatchObject({
      accepted: false,
      outcome: "blocked",
      reason: "idempotency_conflict",
    });
    expect(
      exported.durable.facts.filter(
        (fact) => fact.id !== targetMemoryId && fact.lifecycle === "active",
      ),
    ).toHaveLength(1);
    expect(
      exported.durable.facts.some((fact) => fact.content.includes("Nora")),
    ).not.toBe(
      exported.durable.facts.some((fact) => fact.content.includes("Jules")),
    );
  });

  it("keeps redaction policy applied to corrected memory, evidence, idempotent receipt, and trace attributes", async () => {
    const spans: GoodMemoryTraceSpan[] = [];
    const memory = createGoodMemory({
      storage: { provider: "memory" },
      observability: {
        traceSink: {
          emit(span) {
            spans.push(span);
          },
        },
      },
      policy: {
        redact(candidate) {
          return {
            ...candidate,
            content: candidate.content.replace(/SECRET-[A-Z0-9]+/g, "[redacted]"),
          };
        },
        shouldRemember() {
          return true;
        },
      },
    });
    const scope = {
      userId: "revision-redaction-user",
      workspaceId: "phase-38",
      sessionId: "session-1",
    };
    const remembered = await memory.remember({
      scope,
      messages: [
        {
          role: "user",
          content: "Remember that the incident credential owner is Mira.",
        },
      ],
    });
    const targetMemoryId = remembered.events.find(
      (event) => event.memoryType === "fact",
    )?.memoryId;

    expect(targetMemoryId).toBeString();

    const input = {
      scope,
      target: {
        memoryId: targetMemoryId!,
      },
      revision: {
        content: "The incident credential is SECRET-ABC123.",
      },
      reason: "raw custom reason SECRET-TRACE" as const,
      evidence: {
        source: "user_message" as const,
        message: "Correction evidence includes SECRET-ABC123.",
      },
      idempotencyKey: "revision-redaction-policy",
    };

	    const first = await memory.reviseMemory(input);
	    const second = await memory.reviseMemory({
	      ...input,
	      revision: {
	        content: "The incident credential is SECRET-XYZ999.",
	      },
	      reason: "another raw custom reason SECRET-OTHER" as const,
	      evidence: {
	        source: "user_message" as const,
	        message: "Correction evidence includes SECRET-XYZ999.",
	      },
	    });
    const exported = await memory.exportMemory({
      scope,
    });
    const newFact = exported.durable.facts.find(
      (fact) => fact.id === first.newMemoryId,
    );
    const evidence = exported.durable.evidence.find(
      (record) => record.id === first.evidenceIds?.[0],
    );
    const spansJson = JSON.stringify(spans);
    const { traceId: firstTraceId, ...firstWithoutTrace } = first;
    const { traceId: secondTraceId, ...secondWithoutTrace } = second;

    expect(firstTraceId).toBeString();
    expect(secondTraceId).toBeString();
    expect(secondWithoutTrace).toEqual(firstWithoutTrace);
    expect(first.policyApplied).toEqual([
      "revision.target.memory_id",
      "policy.redact",
      "policy.shouldRemember.allowed",
    ]);
    expect(newFact?.content).toBe("The incident credential is [redacted].");
    expect(evidence?.excerpt).toBe("Correction evidence includes [redacted].");
    expect(JSON.stringify(exported)).not.toContain("SECRET-TRACE");
    expect(JSON.stringify(exported)).not.toContain("SECRET-OTHER");
    expect(JSON.stringify(exported)).not.toContain("SECRET-XYZ999");
    expect(spansJson).not.toContain("SECRET-ABC123");
    expect(spansJson).not.toContain("SECRET-XYZ999");
    expect(spansJson).not.toContain("SECRET-TRACE");
    expect(spansJson).not.toContain("SECRET-OTHER");
    expect(spans.some((span) => span.attributes?.reason === "custom")).toBe(true);
  });

  it("redacts localized credential evidence with the resolved LanguagePack", async () => {
    const cases = [
      { credential: "비밀번호: bridge-secret", locale: "ko-KR" },
      { credential: "mot de passe : bridge-secret", locale: "fr-FR" },
      { credential: "contraseña: bridge-secret", locale: "es-ES" },
      { credential: "密码：bridge-secret", locale: "zh-CN" },
      { credential: "密碼：bridge-secret", locale: "zh-TW" },
      { credential: "パスワード：bridge-secret", locale: "ja-JP" },
    ];

    for (const [index, entry] of cases.entries()) {
      const memory = createGoodMemory({ storage: { provider: "memory" } });
      const scope = {
        sessionId: `localized-revision-${index}`,
        userId: `localized-revision-user-${index}`,
      };
      const remembered = await memory.remember({
        annotations: [
          { kindHint: "fact", messageIndex: 0, remember: "always" },
        ],
        messages: [{ content: "The incident owner is Mira.", role: "user" }],
        scope,
      });
      const targetMemoryId = remembered.events.find(
        (event) => event.memoryType === "fact",
      )?.memoryId;
      expect(targetMemoryId).toBeString();

      const result = await memory.reviseMemory({
        evidence: { message: entry.credential, source: "user_message" },
        idempotencyKey: `localized-revision-${index}`,
        locale: entry.locale,
        reason: "user_correction",
        revision: { content: "The incident owner is Jules." },
        scope,
        target: { memoryId: targetMemoryId! },
      });
      const exported = await memory.exportMemory({ scope });
      const evidence = exported.durable.evidence.find(
        (record) => record.id === result.evidenceIds?.[0],
      );

      expect(evidence?.excerpt).toBe("[redacted-secret]");
      expect(JSON.stringify(evidence)).not.toContain("bridge-secret");
    }
  });

  it("blocks targeted revisions that become empty after redaction", async () => {
    const memory = createGoodMemory({
      storage: { provider: "memory" },
      policy: {
        redact(candidate) {
          return {
            ...candidate,
            content: candidate.content.replace("erase me", "").trim(),
          };
        },
      },
    });
    const scope = {
      userId: "revision-empty-redaction-user",
      workspaceId: "phase-38",
    };
    const remembered = await memory.remember({
      scope,
      messages: [
        {
          role: "user",
          content: "Remember that the deployment owner is Mira.",
        },
      ],
    });
    const targetMemoryId = remembered.events.find(
      (event) => event.memoryType === "fact",
    )?.memoryId;

    expect(targetMemoryId).toBeString();
    const previousMemoryId = targetMemoryId!;

    const result = await memory.reviseMemory({
      scope,
      target: {
        memoryId: previousMemoryId,
      },
      revision: {
        content: "erase me",
      },
      reason: "user_correction",
      idempotencyKey: "revision-empty-after-redaction",
    });
    const exported = await memory.exportMemory({
      scope,
    });

    expect(result).toMatchObject({
      accepted: false,
      outcome: "blocked",
      memoryType: "fact",
      previousMemoryId,
      reason: "invalid_after_redaction",
      policyApplied: ["revision.target.memory_id", "policy.redact"],
    });
    expect(exported.durable.facts).toHaveLength(1);
    expect(exported.durable.facts[0]?.id).toBe(previousMemoryId);
    expect(exported.durable.facts[0]?.content).toBe("the deployment owner is Mira.");
    expect(exported.durable.facts[0]?.lifecycle).toBe("active");
    expect(exported.durable.evidence).toHaveLength(1);
  });

  it("does not let a narrower targeted scope revise broader-scope memory", async () => {
    const memory = createGoodMemory({
      storage: { provider: "memory" },
    });
    const userScope = {
      userId: "revision-scope-user",
    };
    const narrowerScope = {
      userId: "revision-scope-user",
      workspaceId: "phase-38",
    };
    const remembered = await memory.remember({
      scope: userScope,
      messages: [
        {
          role: "user",
          content: "Remember that the default reviewer is Mira.",
        },
      ],
    });
    const targetMemoryId = remembered.events.find(
      (event) => event.memoryType === "fact",
    )?.memoryId;

    expect(targetMemoryId).toBeString();

    const result = await memory.reviseMemory({
      scope: narrowerScope,
      target: {
        memoryId: targetMemoryId!,
      },
      revision: {
        content: "The default reviewer is Jules.",
      },
      reason: "user_correction",
      idempotencyKey: "revision-scope-mismatch",
    });
    const exported = await memory.exportMemory({
      scope: userScope,
    });

    expect(result).toMatchObject({
      accepted: false,
      outcome: "not_found",
      policyApplied: ["revision.target.memory_id"],
    });
    expect(exported.durable.facts).toHaveLength(1);
    expect(exported.durable.facts[0]?.content).toBe("the default reviewer is Mira.");
    expect(exported.durable.facts[0]?.lifecycle).toBe("active");
    expect(exported.durable.evidence).toHaveLength(1);
  });

  it("does not let a broad targeted scope revise tenant workspace or agent memory", async () => {
    const memory = createGoodMemory({
      storage: { provider: "memory" },
    });
    const broadScope = {
      userId: "revision-broad-scope-user",
    };
    const governedScope = {
      userId: "revision-broad-scope-user",
      tenantId: "tenant-a",
      workspaceId: "workspace-a",
      agentId: "agent-a",
    };
    const remembered = await memory.remember({
      scope: governedScope,
      messages: [
        {
          role: "user",
          content: "Remember that the rollout owner is Priya.",
        },
      ],
    });
    const targetMemoryId = remembered.events.find(
      (event) => event.memoryType === "fact",
    )?.memoryId;

    expect(targetMemoryId).toBeString();

    const result = await memory.reviseMemory({
      scope: broadScope,
      target: {
        memoryId: targetMemoryId!,
      },
      revision: {
        content: "The rollout owner is Sam.",
      },
      reason: "user_correction",
      idempotencyKey: "revision-broad-scope-mismatch",
    });
    const exported = await memory.exportMemory({
      scope: governedScope,
    });

    expect(result).toMatchObject({
      accepted: false,
      outcome: "not_found",
      policyApplied: ["revision.target.memory_id"],
    });
    expect(exported.durable.facts).toHaveLength(1);
    expect(exported.durable.facts[0]?.content).toBe("the rollout owner is Priya.");
    expect(exported.durable.facts[0]?.lifecycle).toBe("active");
    expect(exported.durable.evidence).toHaveLength(1);
  });

  it("serializes remember and preference revision through one category fence", async () => {
    const backingStore = createInMemoryDocumentStore();
    let preferenceSnapshotRead = (): void => {};
    const preferenceSnapshotReady = new Promise<void>((resolve) => {
      preferenceSnapshotRead = resolve;
    });
    let releasePreferenceSnapshot = (): void => {};
    const preferenceSnapshotBlocked = new Promise<void>((resolve) => {
      releasePreferenceSnapshot = resolve;
    });
    let blocked = false;
    const delayedDocumentStore: DocumentStore = {
      ...backingStore,
      async query<TDocument extends object>(
        collection: string,
        filter?: StorageFilter,
      ): Promise<TDocument[]> {
        const records = await backingStore.query<TDocument>(collection, filter);
        if (collection === "preferences" && !blocked) {
          blocked = true;
          preferenceSnapshotRead();
          await preferenceSnapshotBlocked;
        }
        return records;
      },
    };
    const scope = {
      userId: "revision-remember-fence-user",
      workspaceId: "workspace-a",
    };
    const baseline = createGoodMemory({
      adapters: {
        documentStore: backingStore,
        sessionStore: createInMemorySessionStore(),
      },
      storage: { provider: "memory" },
    });
    const remembering = createGoodMemory({
      adapters: {
        documentStore: delayedDocumentStore,
        sessionStore: createInMemorySessionStore(),
      },
      storage: { provider: "memory" },
    });
    const revising = createGoodMemory({
      adapters: {
        documentStore: backingStore,
        sessionStore: createInMemorySessionStore(),
      },
      storage: { provider: "memory" },
    });
    const remembered = await baseline.remember({
      messages: [{
        role: "user",
        content: "I prefer bullet points in project summaries.",
      }],
      scope: { ...scope, sessionId: "baseline" },
    });
    const originalId = remembered.events[0]?.memoryId;
    if (!originalId) {
      throw new Error("Expected the baseline preference to be stored.");
    }

    const pendingRemember = remembering.remember({
      messages: [{
        role: "user",
        content: "I prefer short paragraphs in project summaries.",
      }],
      scope: { ...scope, sessionId: "remember" },
    });
    await preferenceSnapshotReady;
    const revision = await revising.reviseMemory({
      idempotencyKey: "revision-during-remember",
      reason: "user_correction",
      revision: { content: "I prefer numbered lists in project summaries." },
      scope,
      target: { memoryId: originalId },
    });
    releasePreferenceSnapshot();
    const replacement = await pendingRemember;
    const preferences = await backingStore.query<{
      id: string;
      lifecycle: string;
      supersededBy: string | null;
    }>("preferences", scope);
    const active = preferences.filter(({ lifecycle }) => lifecycle === "active");
    const revisionId = revision.newMemoryId;
    const replacementId = replacement.events[0]?.memoryId;

    expect(blocked).toBe(true);
    expect(revision.accepted).toBe(true);
    expect(replacement.events[0]?.outcome).toBe("superseded");
    expect(active).toEqual([expect.objectContaining({ id: replacementId })]);
    expect(preferences.find(({ id }) => id === originalId)).toMatchObject({
      lifecycle: "superseded",
      supersededBy: revisionId,
    });
    expect(preferences.find(({ id }) => id === revisionId)).toMatchObject({
      lifecycle: "superseded",
      supersededBy: replacementId,
    });
  });

  it("serializes concurrent targeted revisions so one active memory has one successor", async () => {
    const documentStore = createRevisionRaceDocumentStore(createInMemoryDocumentStore());
    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: {
        documentStore,
        sessionStore: createInMemorySessionStore(),
      },
    });
    const scope = {
      userId: "revision-concurrent-user",
      workspaceId: "phase-38",
    };
    const remembered = await memory.remember({
      scope,
      messages: [
        {
          role: "user",
          content: "Remember that the incident owner is Mira.",
        },
      ],
    });
    const targetMemoryId = remembered.events.find(
      (event) => event.memoryType === "fact",
    )?.memoryId;

    expect(targetMemoryId).toBeString();
    const previousMemoryId = targetMemoryId!;
    documentStore.enableRaceOn("facts", previousMemoryId);

    const [first, second] = await Promise.all([
      memory.reviseMemory({
        scope,
        target: { memoryId: previousMemoryId },
        revision: { content: "The incident owner is Nora." },
        reason: "user_correction",
        idempotencyKey: "revision-concurrent-first",
      }),
      memory.reviseMemory({
        scope,
        target: { memoryId: previousMemoryId },
        revision: { content: "The incident owner is Jules." },
        reason: "user_correction",
        idempotencyKey: "revision-concurrent-second",
      }),
    ]);
    const exported = await memory.exportMemory({ scope });
    const accepted = [first, second].filter((result) => result.accepted);
    const blocked = [first, second].filter((result) => !result.accepted);
    const previous = exported.durable.facts.find((fact) => fact.id === previousMemoryId);
    const activeSuccessors = exported.durable.facts.filter(
      (fact) => fact.id !== previousMemoryId && fact.lifecycle === "active",
    );

    expect(accepted).toHaveLength(1);
    expect(blocked).toHaveLength(1);
    expect(accepted[0]?.newMemoryId).toBeString();
    const successorId = accepted[0]!.newMemoryId!;
    expect(blocked[0]).toMatchObject({
      accepted: false,
      outcome: "blocked",
      reason: "target_not_active",
    });
    expect(previous?.lifecycle).toBe("superseded");
    expect(previous?.supersededBy).toBe(successorId);
    expect(activeSuccessors).toHaveLength(1);
    expect(activeSuccessors[0]?.id).toBe(successorId);
  });

  it("serializes concurrent targeted revisions across memory instances sharing one store", async () => {
    const sharedStore = createInMemoryDocumentStore();
    const race = createSharedRevisionRaceController(sharedStore);
    const firstMemory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: {
        documentStore: race.createStore(),
        sessionStore: createInMemorySessionStore(),
      },
    });
    const secondMemory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: {
        documentStore: race.createStore(),
        sessionStore: createInMemorySessionStore(),
      },
    });
    const scope = {
      userId: "revision-multi-instance-user",
      workspaceId: "phase-38",
    };
    const remembered = await firstMemory.remember({
      scope,
      messages: [
        {
          role: "user",
          content: "Remember that the release owner is Mira.",
        },
      ],
    });
    const targetMemoryId = remembered.events.find(
      (event) => event.memoryType === "fact",
    )?.memoryId;

    expect(targetMemoryId).toBeString();
    const previousMemoryId = targetMemoryId!;
    race.enableRaceOn("facts", previousMemoryId);

    const [first, second] = await Promise.all([
      firstMemory.reviseMemory({
        scope,
        target: { memoryId: previousMemoryId },
        revision: { content: "The release owner is Nora." },
        reason: "user_correction",
        idempotencyKey: "revision-multi-instance-first",
      }),
      secondMemory.reviseMemory({
        scope,
        target: { memoryId: previousMemoryId },
        revision: { content: "The release owner is Jules." },
        reason: "user_correction",
        idempotencyKey: "revision-multi-instance-second",
      }),
    ]);
    const exported = await firstMemory.exportMemory({ scope });
    const accepted = [first, second].filter((result) => result.accepted);
    const blocked = [first, second].filter((result) => !result.accepted);
    const previous = exported.durable.facts.find((fact) => fact.id === previousMemoryId);
    const activeSuccessors = exported.durable.facts.filter(
      (fact) => fact.id !== previousMemoryId && fact.lifecycle === "active",
    );

    expect(accepted).toHaveLength(1);
    expect(blocked).toHaveLength(1);
    expect(accepted[0]?.newMemoryId).toBeString();
    const acceptedNewMemoryId = accepted[0]!.newMemoryId!;
    expect(blocked[0]).toMatchObject({
      accepted: false,
      outcome: "blocked",
      reason: "target_not_active",
    });
    expect(previous?.lifecycle).toBe("superseded");
    expect(activeSuccessors).toHaveLength(1);
    expect(activeSuccessors[0]?.id).toBe(acceptedNewMemoryId);
  });

  it("keeps legacy custom document stores usable without projection features", () => {
    const baseDocumentStore = createInMemoryDocumentStore();
    const documentStore = createLegacyDocumentStore(baseDocumentStore);
    expect(createGoodMemory({
      storage: { provider: "memory" },
      adapters: {
        documentStore,
        sessionStore: createInMemorySessionStore(),
      },
    })).toBeDefined();
  });

  it("keeps targeted revision unsupported on legacy custom document stores", async () => {
    const documentStore = createLegacyDocumentStore(createInMemoryDocumentStore());
    const memory = createGoodMemory({
      adapters: {
        documentStore,
        sessionStore: createInMemorySessionStore(),
      },
      storage: { provider: "memory" },
    });
    const scope = {
      userId: "revision-legacy-store-user",
      workspaceId: "workspace-a",
    };
    const remembered = await memory.remember({
      messages: [{
        role: "user",
        content: "I prefer bullet points in project summaries.",
      }],
      scope,
    });
    const targetMemoryId = remembered.events.find(
      ({ memoryType }) => memoryType === "preference",
    )?.memoryId;
    if (!targetMemoryId) {
      throw new Error("Expected a preference from the legacy store remember path.");
    }

    const result = await memory.reviseMemory({
      idempotencyKey: "legacy-store-preference-revision",
      reason: "user_correction",
      revision: { content: "I prefer short paragraphs." },
      scope,
      target: { memoryId: targetMemoryId },
    });

    expect(result).toMatchObject({
      accepted: false,
      memoryType: "preference",
      outcome: "unsupported",
      previousMemoryId: targetMemoryId,
      reason: "document_store_batch_unsupported",
    });
  });

  it("requires the explicit projection capability only when generalized fusion is enabled", () => {
    const documentStore = createLegacyDocumentStore(createInMemoryDocumentStore());

    expect(() => createGoodMemory({
      storage: { provider: "memory" },
      retrieval: { preset: "recommended" },
      adapters: {
        documentStore,
        sessionStore: createInMemorySessionStore(),
      },
    })).toThrow("projection-capable document store");
  });

  it("keeps committed revision lineage when the secondary vector update fails", async () => {
    const documentStore = createInMemoryDocumentStore();
    const vectorStore = createDeleteFailingVectorStore(createInMemoryVectorStore());
    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: {
        documentStore,
        sessionStore: createInMemorySessionStore(),
        vectorStore,
      },
    });
    const scope = {
      userId: "revision-vector-failure-user",
      workspaceId: "phase-38",
    };
    const remembered = await memory.remember({
      scope,
      messages: [
        {
          role: "user",
          content: "Remember that the vector failure owner is Mira.",
        },
      ],
    });
    const targetMemoryId = remembered.events.find(
      (event) => event.memoryType === "fact",
    )?.memoryId;

    expect(targetMemoryId).toBeString();

    const result = await memory.reviseMemory({
      scope,
      target: { memoryId: targetMemoryId! },
      revision: { content: "The vector failure owner is Nora." },
      reason: "user_correction",
      idempotencyKey: "revision-vector-failure",
    });
    const exported = await memory.exportMemory({ scope });
    const original = exported.durable.facts.find(
      (fact) => fact.id === targetMemoryId,
    );
    const revised = exported.durable.facts.find(
      (fact) => fact.id === result.newMemoryId,
    );

    expect(result).toMatchObject({
      accepted: true,
      outcome: "superseded",
      warnings: ["vector_write_failed"],
    });
    expect(original?.lifecycle).toBe("superseded");
    expect(original?.supersededBy).toBe(result.newMemoryId);
    expect(revised?.lifecycle).toBe("active");
    expect(revised?.content).toBe("The vector failure owner is Nora.");
  });

  it("replaces fact and reference vectors during targeted revision", async () => {
    const documentStore = createInMemoryDocumentStore();
    const sessionStore = createInMemorySessionStore();
    const vectorStore = createInMemoryVectorStore();
    const embeddingAdapter = createFakeEmbeddingAdapter();
    const repositories = createMemoryRepositories({
      documentStore,
      sessionStore,
      vectorStore,
    });
    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: {
        documentStore,
        embeddingAdapter,
        sessionStore,
        vectorStore,
      },
    });
    const scope = {
      userId: "revision-vector-user",
      workspaceId: "phase-38",
      sessionId: "session-1",
    };
    const remembered = await memory.remember({
      scope,
      messages: [
        {
          role: "user",
          content: "Remember that the vector rollout is blocked on old approval.",
        },
        {
          role: "user",
          content: "Use docs/old-vector-runbook.md as the source of truth for vector work.",
        },
      ],
    });
    const factId = remembered.events.find((event) => event.memoryType === "fact")
      ?.memoryId;
    const referenceId = remembered.events.find(
      (event) => event.memoryType === "reference",
    )?.memoryId;

    expect(factId).toBeString();
    expect(referenceId).toBeString();
    expect(await repositories.vectorIndex?.getFactEmbedding(factId!)).not.toBeNull();
    expect(await repositories.vectorIndex?.getReferenceEmbedding(referenceId!)).not.toBeNull();

    const factRevision = await memory.reviseMemory({
      scope,
      target: {
        memoryId: factId!,
      },
      revision: {
        content: "The vector rollout is blocked on new approval.",
      },
      reason: "user_correction",
      idempotencyKey: "revision-vector-fact",
    });
    const referenceRevision = await memory.reviseMemory({
      scope,
      target: {
        memoryId: referenceId!,
      },
      revision: {
        content: "docs/new-vector-runbook.md",
      },
      reason: "user_correction",
      idempotencyKey: "revision-vector-reference",
    });

    expect(await repositories.vectorIndex?.getFactEmbedding(factId!)).toBeNull();
    expect(
      await repositories.vectorIndex?.getFactEmbedding(factRevision.newMemoryId!),
    ).not.toBeNull();
    expect(await repositories.vectorIndex?.getReferenceEmbedding(referenceId!)).toBeNull();
    expect(
      await repositories.vectorIndex?.getReferenceEmbedding(
        referenceRevision.newMemoryId!,
      ),
    ).not.toBeNull();
  });

  it("does not copy legacy retrieval-exposure telemetry into revised records", async () => {
    const documentStore = createInMemoryDocumentStore();
    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: {
        documentStore,
        sessionStore: createInMemorySessionStore(),
      },
      testing: { now: () => new Date("2026-04-20T00:00:00.000Z") },
    });
    const scope = {
      userId: "revision-frozen-telemetry-user",
      workspaceId: "workspace-a",
    } as const;
    const fact = createFactMemory({
      id: "fact-frozen-telemetry",
      ...scope,
      category: "project",
      content: "The rollout owner is Nora.",
      source: { method: "explicit", extractedAt: "2026-04-01T00:00:00.000Z" },
      createdAt: "2026-04-01T00:00:00.000Z",
      updatedAt: "2026-04-01T00:00:00.000Z",
    });
    const feedback = createFeedbackMemory({
      id: "feedback-frozen-telemetry",
      ...scope,
      rule: "Use bullet points for rollout summaries.",
      kind: "validated_pattern",
      source: { method: "explicit", extractedAt: "2026-04-01T00:00:00.000Z" },
      updatedAt: "2026-04-01T00:00:00.000Z",
    });
    // Stored JSON written by pre-v0.8 releases may still carry the removed
    // telemetry properties; v0.8 neither reads nor rewrites them.
    await documentStore.set("facts", fact.id, {
      ...fact,
      accessCount: 12,
      lastAccessedAt: "2026-04-10T00:00:00.000Z",
    });
    await documentStore.set("feedback", feedback.id, {
      ...feedback,
      lastUsedAt: "2026-04-11T00:00:00.000Z",
    });

    const factRevision = await memory.reviseMemory({
      scope,
      target: { memoryId: fact.id },
      revision: { content: "The rollout owner is Mina." },
      reason: "user_correction",
      idempotencyKey: "revision-frozen-fact-telemetry",
    });
    const feedbackRevision = await memory.reviseMemory({
      scope,
      target: { memoryId: feedback.id },
      revision: { content: "Use short paragraphs for rollout summaries." },
      reason: "user_correction",
      idempotencyKey: "revision-frozen-feedback-telemetry",
    });
    const newFact = await documentStore.get<Record<string, unknown>>(
      "facts",
      factRevision.newMemoryId!,
    );
    const newFeedback = await documentStore.get<Record<string, unknown>>(
      "feedback",
      feedbackRevision.newMemoryId!,
    );

    expect(newFact).toMatchObject({ content: "The rollout owner is Mina.", lifecycle: "active" });
    expect("accessCount" in (newFact ?? {})).toBe(false);
    expect("lastAccessedAt" in (newFact ?? {})).toBe(false);
    expect("lastUsedAt" in (newFeedback ?? {})).toBe(false);
  });

  it("deletes stale fact and reference vectors during revision when embeddings are not configured", async () => {
    const documentStore = createInMemoryDocumentStore();
    const sessionStore = createInMemorySessionStore();
    const vectorStore = createInMemoryVectorStore();
    const repositories = createMemoryRepositories({
      documentStore,
      sessionStore,
      vectorStore,
    });
    const memory = createGoodMemory({
      storage: { provider: "memory" },
      adapters: {
        documentStore,
        sessionStore,
        vectorStore,
      },
    });
    const scope = {
      userId: "revision-stale-vector-user",
      workspaceId: "phase-38",
      sessionId: "session-1",
    };
    const remembered = await memory.remember({
      scope,
      messages: [
        {
          role: "user",
          content: "Remember that stale vector cleanup is blocked on old approval.",
        },
        {
          role: "user",
          content: "Use docs/stale-vector-runbook.md as the source of truth for vector cleanup.",
        },
      ],
    });
    const factId = remembered.events.find((event) => event.memoryType === "fact")
      ?.memoryId;
    const referenceId = remembered.events.find(
      (event) => event.memoryType === "reference",
    )?.memoryId;

    expect(factId).toBeString();
    expect(referenceId).toBeString();

    await repositories.vectorIndex?.upsertFactEmbedding([
      {
        content: "old fact vector",
        embedding: [1, 0, 0],
        id: factId!,
        metadata: {
          userId: scope.userId,
          workspaceId: scope.workspaceId,
        },
      },
    ]);
    await repositories.vectorIndex?.upsertReferenceEmbedding([
      {
        content: "old reference vector",
        embedding: [0, 1, 0],
        id: referenceId!,
        metadata: {
          userId: scope.userId,
          workspaceId: scope.workspaceId,
        },
      },
    ]);

    await memory.reviseMemory({
      scope,
      target: {
        memoryId: factId!,
      },
      revision: {
        content: "Stale vector cleanup is blocked on new approval.",
      },
      reason: "user_correction",
      idempotencyKey: "revision-stale-vector-fact",
    });
    await memory.reviseMemory({
      scope,
      target: {
        memoryId: referenceId!,
      },
      revision: {
        content: "docs/new-stale-vector-runbook.md",
      },
      reason: "user_correction",
      idempotencyKey: "revision-stale-vector-reference",
    });

    expect(await repositories.vectorIndex?.getFactEmbedding(factId!)).toBeNull();
    expect(await repositories.vectorIndex?.getReferenceEmbedding(referenceId!)).toBeNull();
  });

  it("blocks targeted revisions through shouldRemember policy before mutations", async () => {
    const spans: GoodMemoryTraceSpan[] = [];
    const memory = createGoodMemory({
      storage: { provider: "memory" },
      observability: {
        traceSink: {
          emit(span) {
            spans.push(span);
          },
        },
      },
      policy: {
        shouldRemember(candidate) {
          return !candidate.content.includes("blocked revision");
        },
      },
    });
    const scope = {
      userId: "revision-policy-user",
      workspaceId: "phase-38",
      sessionId: "session-1",
    };
    const remembered = await memory.remember({
      scope,
      messages: [
        {
          role: "user",
          content: "Remember that the smoke test owner is Ren.",
        },
      ],
    });
    const targetMemoryId = remembered.events.find(
      (event) => event.memoryType === "fact",
    )?.memoryId;

    expect(targetMemoryId).toBeString();

    const result = await memory.reviseMemory({
      scope,
      target: {
        memoryId: targetMemoryId!,
      },
      revision: {
        content: "blocked revision",
      },
      reason: "user_correction",
      idempotencyKey: "revision-policy-block",
    });
    const exported = await memory.exportMemory({
      scope,
    });

    expect(result).toMatchObject({
      accepted: false,
      memoryType: "fact",
      outcome: "blocked",
      previousMemoryId: targetMemoryId,
      policyApplied: ["revision.target.memory_id", "policy.shouldRemember.blocked"],
    });
    expect(exported.durable.facts.find((fact) => fact.id === targetMemoryId)?.lifecycle).toBe(
      "active",
    );
    expect(exported.durable.facts).toHaveLength(1);
    expect(spans.map((span) => `${span.name}:${span.status}`)).toContain(
      "memory.revise:blocked",
    );
  });
});
