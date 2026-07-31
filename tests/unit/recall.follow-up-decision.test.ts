import { describe, expect, it } from "bun:test";
import {
  createGoodMemory,
  createInMemoryDocumentStore,
  createInMemorySessionStore,
} from "../../src";
import { createFactMemory } from "../../src/domain/records";
import type { FollowUpDecision } from "../../src/recall/iterativeRecall";

// R8: the opt-in adapter decides whether evidence is sufficient and names the
// missing slot before it may generate another retrieval query.
describe("follow-up sufficiency decisions (R8)", () => {
  const scope = { userId: "u-1", workspaceId: "workspace-a" };

  async function seed(
    documentStore: ReturnType<typeof createInMemoryDocumentStore>,
  ) {
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
  }) => Promise<FollowUpDecision>) {
    const documentStore = createInMemoryDocumentStore();
    const calls: Array<{
      evidence: readonly string[];
      hop: number;
      query: string;
    }> = [];
    const memory = createGoodMemory({
      adapters: {
        documentStore,
        sessionStore: createInMemorySessionStore(),
        ...(generate
          ? {
              followUpDecisionGenerator: {
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
    const { calls, documentStore, memory } = build(async () => ({
      missingSlots: ["What sport does Priya Raman practice?"],
      sufficient: false,
    }));
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
    const trace = result.metadata.retrievalTrace;
    expect(trace?.schemaVersion).toBe(2);
    expect(trace?.schemaVersion === 2
      ? trace.queryExecutions[0]?.hops[0]?.sufficiencyDecision
      : undefined).toEqual({
      missingSlots: ["What sport does Priya Raman practice?"],
      sufficient: false,
    });
  });

  it("keeps the single pass when evidence is sufficient or the generator fails", async () => {
    const stopped = build(async () => ({
      missingSlots: [],
      sufficient: true,
    }));
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
    expect(stoppedResult.metadata.retrievalTrace).toMatchObject({
      queryExecutions: [{ stopReason: "evidence_sufficient" }],
      schemaVersion: 2,
    });

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
    expect(failingResult.metadata.retrievalTrace).toMatchObject({
      queryExecutions: [{ stopReason: "decision_unavailable" }],
      schemaVersion: 2,
    });
  });
});
