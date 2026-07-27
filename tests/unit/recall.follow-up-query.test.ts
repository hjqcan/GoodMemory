import { describe, expect, it } from "bun:test";
import {
  createGoodMemory,
  createInMemoryDocumentStore,
  createInMemorySessionStore,
} from "../../src";
import { createFactMemory } from "../../src/domain/records";

// R8: when adapters.followUpQueryGenerator is configured, multi-hop recall
// generates one focused sub-query from hop-1 evidence (replacing lexical
// bridge expansion) and merges the second hop's evidence. The generator
// returning null (or throwing) keeps the single-pass result.
describe("follow-up query generation (R8)", () => {
  const scope = { userId: "u-1", workspaceId: "workspace-a" };

  async function seed(documentStore: ReturnType<typeof createInMemoryDocumentStore>) {
    const mk = (id: string, content: string) =>
      createFactMemory({
        id,
        userId: scope.userId,
        workspaceId: scope.workspaceId,
        category: "personal",
        content,
        confidence: 0.9,
        importance: 0.6,
        source: { method: "explicit", extractedAt: "2026-07-01T00:00:00.000Z" },
      });
    // Bridge shape: the question matches fact-1 (names the goaltender);
    // fact-2 (the sport) shares no tokens with the question.
    await documentStore.set("facts", "fact-1", mk(
      "fact-1",
      "The team goaltender is Priya Raman.",
    ));
    await documentStore.set("facts", "fact-2", mk(
      "fact-2",
      "Priya Raman practices water polo on Tuesdays.",
    ));
  }

  function build(generate?: (input: {
    evidence: readonly string[];
    hop: number;
    query: string;
  }) => Promise<string | null>) {
    const documentStore = createInMemoryDocumentStore();
    const calls: Array<{ evidence: readonly string[]; hop: number; query: string }> = [];
    const memory = createGoodMemory({
      adapters: {
        documentStore,
        sessionStore: createInMemorySessionStore(),
        ...(generate
          ? {
              followUpQueryGenerator: {
                async generate(input: {
                  evidence: readonly string[];
                  hop: number;
                  query: string;
                }) {
                  calls.push(input);
                  return generate(input);
                },
              },
            }
          : {}),
      },
      retrieval: { preset: "recommended" },
      storage: { provider: "memory" },
    });
    return { calls, documentStore, memory };
  }

  it("merges evidence reached only through the generated follow-up", async () => {
    const { calls, documentStore, memory } = build(async () =>
      "What sport does Priya Raman practice?",
    );
    await seed(documentStore);

    const result = await memory.recall({
      multiHop: 2,
      query: "What sport does the team goaltender play?",
      scope,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.query).toBe("What sport does the team goaltender play?");
    expect(calls[0]?.evidence.join(" ")).toContain("Priya Raman");
    const contents = result.facts.map((fact) => fact.content);
    expect(contents.join(" ")).toContain("water polo");
  });

  it("keeps the single pass when the generator stops or fails", async () => {
    const stopped = build(async () => null);
    await seed(stopped.documentStore);
    const stoppedResult = await stopped.memory.recall({
      multiHop: 2,
      query: "What sport does the team goaltender play?",
      scope,
    });
    expect(stopped.calls).toHaveLength(1);
    expect(
      stoppedResult.facts.map((fact) => fact.content).join(" "),
    ).not.toContain("water polo");

    const failing = build(async () => {
      throw new Error("provider outage");
    });
    await seed(failing.documentStore);
    const failingResult = await failing.memory.recall({
      multiHop: 2,
      query: "What sport does the team goaltender play?",
      scope,
    });
    expect(failingResult.facts.length).toBeGreaterThan(0);
  });
});
