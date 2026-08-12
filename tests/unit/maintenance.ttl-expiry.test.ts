import { describe, expect, it } from "bun:test";
import {
  createGoodMemory,
  createInMemoryDocumentStore,
  createInMemorySessionStore,
  createInMemoryVectorStore,
} from "../../src";
import { createFactMemory, type FactMemory } from "../../src/domain/records";

// Recall hides facts as soon as their validity window closes or TTL elapses.
// The ttlExpiry maintenance job persists that state as "inactive". It runs in
// the default maintenance job set and is a no-op without validUntil/expiresAt.
describe("ttlExpiry maintenance job", () => {
  const scope = { userId: "u-1", workspaceId: "workspace-a" };

  function buildMemory() {
    const documentStore = createInMemoryDocumentStore();
    const vectorStore = createInMemoryVectorStore();
    const memory = createGoodMemory({
      adapters: {
        documentStore,
        sessionStore: createInMemorySessionStore(),
        vectorStore,
      },
      storage: { provider: "memory" },
    });
    const makeFact = (
      id: string,
      content: string,
      extra?: Partial<FactMemory>,
    ) =>
      createFactMemory({
        id,
        userId: scope.userId,
        workspaceId: scope.workspaceId,
        category: "project",
        content,
        source: { method: "explicit", extractedAt: "2026-01-01T00:00:00.000Z" },
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        ...extra,
      });
    return { documentStore, makeFact, memory, vectorStore };
  }

  it("hides expired facts immediately and persists their demotion", async () => {
    const { documentStore, makeFact, memory, vectorStore } = buildMemory();
    // A far-past expiresAt is expired under any plausible maintenance clock.
    await documentStore.set(
      "facts",
      "expired",
      makeFact("expired", "alpha topic old deadline", {
        expiresAt: "2020-01-01T00:00:00.000Z",
      }),
    );
    await documentStore.set(
      "facts",
      "fresh",
      makeFact("fresh", "alpha topic current plan"),
    );
    await vectorStore.upsert("facts", [{
      content: "alpha topic old deadline",
      embedding: [1, 0],
      id: "expired",
      metadata: { userId: scope.userId, workspaceId: scope.workspaceId },
    }]);

    const before = await memory.recall({
      scope,
      query: "alpha topic",
      strategy: "rules-only",
    });
    const beforeIds = before.facts.map((fact) => fact.id);
    expect(beforeIds).not.toContain("expired");
    expect(beforeIds).toContain("fresh");
    expect(await vectorStore.get("facts", "expired")).not.toBeNull();

    await memory.runMaintenance({ scope, jobs: ["ttlExpiry"] });

    const after = await memory.recall({
      scope,
      query: "alpha topic",
      strategy: "rules-only",
    });
    const ids = after.facts.map((fact) => fact.id);
    expect(ids).not.toContain("expired");
    expect(ids).toContain("fresh");

    const persisted = (await documentStore.get("facts", "expired")) as
      | FactMemory
      | undefined;
    expect(persisted?.lifecycle).toBe("inactive");
    expect(persisted?.demotionReason).toBe("ttl_expired");
    expect(await vectorStore.get("facts", "expired")).toBeNull();
  });

  it("demotes expired facts in the default maintenance job set", async () => {
    const { documentStore, makeFact, memory } = buildMemory();
    await documentStore.set(
      "facts",
      "expired-default",
      makeFact("expired-default", "alpha topic old deadline", {
        expiresAt: "2020-01-01T00:00:00.000Z",
      }),
    );

    // No explicit jobs: the default set must honor the fact's own TTL.
    await memory.runMaintenance({ scope });

    const persisted = (await documentStore.get("facts", "expired-default")) as
      | FactMemory
      | undefined;
    expect(persisted?.lifecycle).toBe("inactive");
    expect(persisted?.demotionReason).toBe("ttl_expired");
  });

  it("leaves facts without a TTL untouched", async () => {
    const { documentStore, makeFact, memory } = buildMemory();
    await documentStore.set(
      "facts",
      "no-ttl",
      makeFact("no-ttl", "alpha topic durable note"),
    );

    await memory.runMaintenance({ scope, jobs: ["ttlExpiry"] });

    const persisted = (await documentStore.get("facts", "no-ttl")) as
      | FactMemory
      | undefined;
    expect(persisted?.lifecycle).toBe("active");
    const after = await memory.recall({
      scope,
      query: "alpha topic",
      strategy: "rules-only",
    });
    expect(after.facts.map((fact) => fact.id)).toContain("no-ttl");
  });

  it("does not treat a completed event occurrence as a lifecycle expiry", async () => {
    const { documentStore, makeFact, memory } = buildMemory();
    await documentStore.set(
      "facts",
      "historical-event",
      makeFact("historical-event", "I ate tomato and eggs.", {
        category: "event",
        occurrence: {
          start: "2020-01-01T05:00:00.000Z",
          endExclusive: "2020-01-02T05:00:00.000Z",
          precision: "day",
          timezone: "America/New_York",
        },
      }),
    );

    await memory.runMaintenance({ scope, jobs: ["ttlExpiry"] });

    expect(await documentStore.get<FactMemory>("facts", "historical-event"))
      .toMatchObject({ lifecycle: "active", validUntil: undefined });
  });
});
