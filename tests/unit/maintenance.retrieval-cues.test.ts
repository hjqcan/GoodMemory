import { describe, expect, it } from "bun:test";
import {
  createGoodMemory,
  createInMemoryDocumentStore,
  createInMemorySessionStore,
  createInMemoryVectorStore,
} from "../../src";
import { createFactMemory, type FactMemory } from "../../src/domain/records";

// The opt-in retrievalCues maintenance job backfills write-time question
// expansions ("retrieval cues") for active facts that lack them, via an
// injected generator adapter. Cues live under the reserved
// attributes.retrievalCues key: the projector already indexes fact attributes
// as field-granularity documents, so cues become lexically searchable, and
// the context builder never renders attributes, so cues cannot leak into
// answer context. Facts that already carry cues are never re-generated.
describe("retrievalCues maintenance job", () => {
  const scope = { userId: "u-1", workspaceId: "workspace-a" };

  function buildMemory(
    generate?: (input: {
      category: string;
      content: string;
      subject?: string;
    }) => Promise<string[]>,
  ) {
    const documentStore = createInMemoryDocumentStore();
    const calls: string[] = [];
    const memory = createGoodMemory({
      adapters: {
        documentStore,
        sessionStore: createInMemorySessionStore(),
        vectorStore: createInMemoryVectorStore(),
        ...(generate
          ? {
              retrievalCueGenerator: {
                async generate(input: {
                  category: string;
                  content: string;
                  subject?: string;
                }) {
                  calls.push(input.content);
                  return generate(input);
                },
              },
            }
          : {}),
      },
      retrieval: { preset: "recommended" },
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
    return { calls, documentStore, makeFact, memory };
  }

  it("backfills cues once, skips covered facts, and makes them retrievable", async () => {
    const { calls, documentStore, makeFact, memory } = buildMemory(
      async (input) =>
        input.content.includes("ops vault")
          ? [
              "  Where is the deploy runbook kept?  ",
              "Which document explains deployments?",
              "",
              "Where is the deploy runbook kept?",
            ]
          : [],
    );
    await documentStore.set(
      "facts",
      "fact-handbook",
      makeFact("fact-handbook", "The infra handbook lives in the ops vault."),
    );
    await documentStore.set(
      "facts",
      "fact-covered",
      makeFact("fact-covered", "Standups happen on Mondays.", {
        attributes: { retrievalCues: "When are standups?" },
      }),
    );
    await documentStore.set(
      "facts",
      "fact-no-cues",
      makeFact("fact-no-cues", "Misc note."),
    );

    const first = await memory.runMaintenance({
      scope,
      jobs: ["retrievalCues"],
    });
    expect(
      first.maintenance?.jobs.find((job) => job.name === "retrievalCues")
        ?.applied,
    ).toBe(1);
    // Covered facts never reach the generator.
    expect(calls).not.toContain("Standups happen on Mondays.");

    const handbook = await documentStore.get<FactMemory>(
      "facts",
      "fact-handbook",
    );
    // Sanitized: trimmed, empties dropped, duplicates removed, newline-joined.
    expect(handbook?.attributes?.retrievalCues).toBe(
      "Where is the deploy runbook kept?\nWhich document explains deployments?",
    );
    const noCues = await documentStore.get<FactMemory>("facts", "fact-no-cues");
    expect(noCues?.attributes?.retrievalCues).toBeUndefined();

    // Idempotent: a second run generates nothing new for cue-carrying facts.
    const callCountAfterFirst = calls.length;
    const second = await memory.runMaintenance({
      scope,
      jobs: ["retrievalCues"],
    });
    expect(
      second.maintenance?.jobs.find((job) => job.name === "retrievalCues")
        ?.applied,
    ).toBe(0);
    expect(calls.filter((c) => c.includes("ops vault"))).toHaveLength(
      callCountAfterFirst > 0 ? 1 : 0,
    );

    // The backfilled cue bridges the phrasing gap end to end.
    const recall = await memory.recall({
      scope,
      query: "Where is the deploy runbook kept?",
    });
    expect(recall.facts.map((fact) => fact.id)).toContain("fact-handbook");
  });

  it("applies nothing without a configured generator", async () => {
    const { documentStore, makeFact, memory } = buildMemory();
    await documentStore.set(
      "facts",
      "fact-plain",
      makeFact("fact-plain", "The infra handbook lives in the ops vault."),
    );

    const report = await memory.runMaintenance({
      scope,
      jobs: ["retrievalCues"],
    });
    expect(
      report.maintenance?.jobs.find((job) => job.name === "retrievalCues")
        ?.applied,
    ).toBe(0);
    const fact = await documentStore.get<FactMemory>("facts", "fact-plain");
    expect(fact?.attributes?.retrievalCues).toBeUndefined();
  });
});
