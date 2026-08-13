import { describe, expect, it } from "bun:test";

import {
  createGoodMemory,
  createNeutralLanguagePack,
  type LanguagePack,
} from "../../src";
import {
  CLAIM_PROJECTIONS_COLLECTION,
  ENTITIES_COLLECTION,
  RECALL_DOCUMENTS_COLLECTION,
  type ClaimProjection,
  type EntityAdjacencyProjection,
  type RecallIndexDocument,
} from "../../src/recall/projections/contracts";
import {
  createInMemoryDocumentStore,
  createInMemorySessionStore,
} from "../../src/storage/memory";

describe("custom LanguagePack horizontal extension", () => {
  it("runs xx-Test through remember, every projection channel, recall, and context", async () => {
    const neutral = createNeutralLanguagePack();
    const pack: LanguagePack = {
      ...neutral,
      analyzerVersion: "xx-analyzer-1",
      compatibilityGroup: "xx-test",
      defaultLocale: "xx-Test",
      detect: ({ texts }) => texts.some((text) => text.includes("zor"))
        ? "distinctive"
        : "none",
      id: "xx-test",
      locales: ["xx-Test"],
      analyzeContent(text) {
        return {
          ...neutral.analyzeContent(text),
          blockerFact: text.includes("zor"),
          durableCue: text.includes("zor"),
          projectStateFact: text.includes("zor"),
        };
      },
      analyzeQuery(text) {
        return {
          ...neutral.analyzeQuery(text),
          blocker: text.includes("zor"),
          current: text.includes("zor"),
          projectState: text.includes("zor"),
        };
      },
      buildSearchTerms: (text) =>
        text.toLowerCase().includes("zor") ? ["xx-atlas"] : [],
      extractCandidates({ messages, nextId }) {
        return messages.flatMap((message, index) =>
          message.role === "user" && message.content.includes("zor")
            ? [{
                id: nextId(),
                kindHint: "fact" as const,
                explicitness: "explicit" as const,
                content: message.content,
                sourceMessageIndex: message.sourceMessageIndex ?? index,
                sourceRole: message.role,
                metadata: {
                  category: "project" as const,
                  factKind: "blocker" as const,
                  subject: "ZorEntity",
                  tags: ["ZorEntity", "ZorGate"],
                  claim: {
                    predicateKey: "project.blocker",
                    objectText: "ZorGate",
                    objectEntity: "ZorGate",
                  },
                },
              }]
            : []
        );
      },
      extractEntityMentions(text) {
        return text.includes("zor")
          ? [{ kind: "term", normalized: "zorentity", surface: "ZorEntity" }]
          : [];
      },
      normalizeForEquality: (text) => `xx:${text.toLowerCase()}`,
      render(input) {
        if (input.key === "fact") {
          return "XX-FACTS";
        }
        if (input.key === "fact_item") {
          return `XX-FACT ${input.values?.content ?? ""}`;
        }
        return neutral.render(input);
      },
      tokenizeForScoring: (text) =>
        text.toLowerCase().includes("zor") ? ["xx-atlas"] : [],
    };
    const documentStore = createInMemoryDocumentStore();
    const memory = createGoodMemory({
      adapters: {
        documentStore,
        sessionStore: createInMemorySessionStore(),
      },
      language: { defaultLocale: "xx-Test", packs: [pack] },
      retrieval: { preset: "recommended", recallPlanExecution: true },
    });
    const scope = { userId: "xx-user", workspaceId: "xx-workspace" };

    const remembered = await memory.remember({
      locale: "xx-Test",
      messages: [{ role: "user", content: "zor memory ZorGate" }],
      scope,
    });
    const recalled = await memory.recall({
      locale: "xx-Test",
      query: "zor query",
      scope,
    });
    const context = await memory.buildContext({ output: "markdown", recall: recalled });
    const [documents, entities, claims] = await Promise.all([
      documentStore.query<RecallIndexDocument>(RECALL_DOCUMENTS_COLLECTION),
      documentStore.query<EntityAdjacencyProjection>(ENTITIES_COLLECTION),
      documentStore.query<ClaimProjection>(CLAIM_PROJECTIONS_COLLECTION),
    ]);

    expect(remembered.metadata?.languagePackId).toBe("xx-test");
    expect(pack.analyzeContent("zor memory ZorGate").behavioralDirective)
      .toBeUndefined();
    expect(remembered.accepted).toBe(1);
    expect(recalled.metadata.languagePackId).toBe("xx-test");
    expect(recalled.facts.some(({ content }) => content.includes("zor memory")))
      .toBe(true);
    expect(documents.some(({ searchText }) => searchText === "xx-atlas")).toBe(true);
    expect(entities.some(({ searchText }) => searchText === "xx-atlas")).toBe(true);
    expect(claims.some(({ searchText }) => searchText === "xx-atlas")).toBe(true);
    expect(context.content).toContain("XX-FACTS");
    expect(context.content).toContain("zor memory ZorGate");
  });
});
