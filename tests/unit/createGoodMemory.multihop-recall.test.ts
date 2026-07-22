import { describe, expect, it } from "bun:test";
import {
  createGoodMemory,
  createInMemoryDocumentStore,
  createInMemorySessionStore,
  createInMemoryVectorStore,
} from "../../src";
import { createFactMemory } from "../../src/domain/records";

// Planned multi-hop remains an experimental opt-in until its promotion gate is
// accepted. The public default stays on the unplanned single pass.
describe("GoodMemory.recall multiHop option", () => {
  const scope = { userId: "u-1", workspaceId: "workspace-a" };

  function buildMemory() {
    const documentStore = createInMemoryDocumentStore();
    const sessionStore = createInMemorySessionStore();
    const vectorStore = createInMemoryVectorStore();
    const memory = createGoodMemory({
      adapters: { documentStore, sessionStore, vectorStore },
      retrieval: { recallPlanExecution: true },
      storage: { provider: "memory" },
    });
    const makeFact = (id: string, content: string) =>
      createFactMemory({
        id,
        userId: scope.userId,
        workspaceId: scope.workspaceId,
        category: "project",
        content,
        source: { method: "explicit", extractedAt: "2026-01-01T00:00:00.000Z" },
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      });
    return { documentStore, makeFact, memory };
  }

  it("uses the planned hop count only when experimental execution is enabled", async () => {
    const { documentStore, makeFact, memory } = buildMemory();
    const identity = makeFact("identity", "Mika Linna is our goaltender.");
    const attribute = makeFact("attribute", "Mika Linna competes in pesapallo.");
    const noise = makeFact("noise", "The quarterly budget review is on Friday.");
    for (const fact of [identity, attribute, noise]) {
      await documentStore.set("facts", fact.id, fact);
    }
    const query = "What is the goaltender known for?";

    const single = await memory.recall({
      scope,
      query,
      strategy: "rules-only",
      multiHop: false,
    });
    const singleIds = single.facts.map((entry) => entry.id);
    expect(singleIds).toContain("identity");
    expect(singleIds).not.toContain("attribute");

    const multi = await memory.recall({ scope, query, strategy: "rules-only" });
    const multiIds = multi.facts.map((entry) => entry.id);
    expect(multiIds).toContain("attribute");
    const retrievalTrace = multi.metadata.retrievalTrace;
    const hopCount = retrievalTrace?.schemaVersion === 2
      ? retrievalTrace.queryExecutions[0]?.hops.length
      : undefined;
    expect(hopCount).toBe(2);
    expect(multi.metadata.retrievalTrace).toMatchObject({
      schemaVersion: 2,
      plan: { maxHops: 2 },
      stopReason: "multi_hop_complete",
      subQueries: [],
      queryExecutions: [
        expect.objectContaining({
          query,
          role: "primary",
          stopReason: "max_hops_reached",
        }),
      ],
    });
    expect(single.metadata.retrievalTrace).toMatchObject({
      schemaVersion: 2,
      stopReason: "single_pass_complete",
    });
    expect(multi.packet.renderBudget).toEqual({ maxTokens: 6_000 });
  });
});
