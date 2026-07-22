import { describe, expect, it } from "bun:test";
import { createFactMemory } from "../../src/domain/records";
import { createRecallEngine } from "../../src/recall/engine";
import { iterativeRecall } from "../../src/recall/iterativeRecall";
import { createLanguageService } from "../../src/language";
import {
  createInMemoryDocumentStore,
  createInMemorySessionStore,
  createInMemoryVectorStore,
} from "../../src/storage/memory";
import { createMemoryRepositories } from "../../src/storage/repositories";

// Confirms multi-hop is a real gap in the production recall engine (not just the
// test double): a question that names an entity indirectly cannot reach the fact
// holding that entity's attribute in one pass, and the iterative wrapper closes
// it.
describe("iterative recall over the real recall engine", () => {
  const language = createLanguageService();
  const analyzeBridgeText = (text: string) => {
    const context = language.resolveFromText({ text });
    return {
      entities: language.extractEntityMentions(text, context).map(
        (mention) => mention.surface,
      ),
      tokens: language.tokenize(text, context, { excludeStopwords: true }),
    };
  };

  async function buildEngine() {
    const documentStore = createInMemoryDocumentStore();
    const sessionStore = createInMemorySessionStore();
    const vectorStore = createInMemoryVectorStore();
    const repositories = createMemoryRepositories({
      documentStore,
      sessionStore,
      vectorStore,
    });
    const makeFact = (id: string, content: string) =>
      createFactMemory({
        id,
        userId: "u-1",
        workspaceId: "workspace-a",
        category: "project",
        content,
        source: { method: "explicit", extractedAt: "2026-01-01T00:00:00.000Z" },
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      });
    await repositories.facts.add(
      makeFact("hop1-identity", "Mika Linna is our goaltender."),
    );
    await repositories.facts.add(
      makeFact("hop2-attribute", "Mika Linna competes in pesapallo."),
    );
    await repositories.facts.add(
      makeFact("noise", "The quarterly budget review is on Friday."),
    );
    const engine = createRecallEngine({
      repositories,
      runtime: sessionStore,
    });
    return (query: string) =>
      engine.recall({
        scope: { userId: "u-1", workspaceId: "workspace-a" },
        query,
        retrievalProfile: "general_chat",
        strategy: "rules-only",
      });
  }

  it("recovers the bridged attribute fact that single-pass recall leaves behind", async () => {
    const recall = await buildEngine();
    const query = "What is the goaltender known for?";

    const single = await recall(query);
    const singleIds = single.facts.map((entry) => entry.id);
    // Single-pass reaches the identity fact (shares "goaltender") but not the
    // attribute fact (which never mentions "goaltender").
    expect(singleIds).toContain("hop1-identity");
    expect(singleIds).not.toContain("hop2-attribute");

    const outcome = await iterativeRecall({
      query,
      recall,
      options: { analyzeBridgeText },
    });
    const ids = outcome.result.facts.map((entry) => entry.id);
    expect(outcome.hops).toBe(2);
    expect(outcome.bridgeEntities).toContain("Mika Linna");
    expect(ids).toContain("hop2-attribute");
  });
});
