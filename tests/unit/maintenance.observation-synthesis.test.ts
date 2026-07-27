import { describe, expect, it } from "bun:test";
import {
  createGoodMemory,
  createInMemoryDocumentStore,
  createInMemorySessionStore,
} from "../../src";
import { createFactMemory, type FactMemory } from "../../src/domain/records";

// R9 observation synthesis: an opt-in maintenance job that, for each subject
// with at least OBSERVATION_SYNTHESIS_MIN_FACTS active facts, writes one
// compact observation memory via an injected synthesizer adapter. The
// observation is a regular fact with inferred provenance and attribute
// pointers to its member fact ids (auditable, forgettable through existing
// paths); covered subjects never re-synthesize while their member set is
// unchanged, and subjects below the threshold are skipped. Without the
// adapter the job applies nothing.
describe("observationSynthesis maintenance job", () => {
  const scope = { userId: "u-1", workspaceId: "workspace-a" };

  function buildMemory(
    synthesize?: (input: {
      contents: readonly string[];
      subject: string;
    }) => Promise<string | null>,
  ) {
    const documentStore = createInMemoryDocumentStore();
    const calls: string[] = [];
    const memory = createGoodMemory({
      adapters: {
        documentStore,
        sessionStore: createInMemorySessionStore(),
        ...(synthesize
          ? {
              observationSynthesizer: {
                async synthesize(input: {
                  contents: readonly string[];
                  subject: string;
                }) {
                  calls.push(input.subject);
                  return synthesize(input);
                },
              },
            }
          : {}),
      },
      retrieval: { preset: "recommended" },
      storage: { provider: "memory" },
    });
    const makeFact = (id: string, content: string, subject?: string) =>
      createFactMemory({
        id,
        userId: scope.userId,
        workspaceId: scope.workspaceId,
        category: "personal",
        content,
        confidence: 0.9,
        importance: 0.6,
        source: { method: "explicit", extractedAt: "2026-07-01T00:00:00.000Z" },
        ...(subject ? { subject } : {}),
      });
    return { calls, documentStore, makeFact, memory };
  }

  async function seedMarcoFacts(
    documentStore: ReturnType<typeof createInMemoryDocumentStore>,
    makeFact: (id: string, content: string, subject?: string) => FactMemory,
  ) {
    const facts = [
      makeFact("fact-1", "Marco lives in Lisbon.", "Marco"),
      makeFact("fact-2", "Marco teaches ceramics on weekends.", "Marco"),
      makeFact("fact-3", "Marco adopted a rescue greyhound.", "Marco"),
      makeFact("fact-4", "Marco is training for a marathon.", "Marco"),
      // Below threshold: only two facts about Ana.
      makeFact("fact-5", "Ana repairs violins.", "Ana"),
      makeFact("fact-6", "Ana grew up in Porto.", "Ana"),
      // No subject: never grouped.
      makeFact("fact-7", "The office plant needs weekly watering."),
    ];
    for (const fact of facts) {
      await documentStore.set("facts", fact.id, fact);
    }
  }

  it("synthesizes one observation per qualifying subject with member pointers", async () => {
    const { calls, documentStore, makeFact, memory } = buildMemory(
      async (input) =>
        `${input.subject} overview: ${input.contents.length} known facts.`,
    );
    await seedMarcoFacts(documentStore, makeFact);

    const report = await memory.runMaintenance({
      scope,
      jobs: ["observationSynthesis"],
    });
    expect(
      report.maintenance?.jobs.find(
        (job) => job.name === "observationSynthesis",
      )?.applied,
    ).toBe(1);
    expect(calls).toEqual(["Marco"]);

    const facts = await documentStore.query<FactMemory>("facts", {});
    const observation = facts.find(
      (fact) => fact.attributes?.observationOf === "Marco",
    );
    expect(observation?.content).toBe("Marco overview: 4 known facts.");
    expect(observation?.source.method).toBe("inferred");
    expect(observation?.attributes?.observationMemberIds).toBe(
      "fact-1\nfact-2\nfact-3\nfact-4",
    );
  });

  it("is idempotent while the member set is unchanged and resynthesizes when it grows", async () => {
    const { calls, documentStore, makeFact, memory } = buildMemory(
      async (input) => `${input.subject}: ${input.contents.length} facts.`,
    );
    await seedMarcoFacts(documentStore, makeFact);

    await memory.runMaintenance({ scope, jobs: ["observationSynthesis"] });
    const second = await memory.runMaintenance({
      scope,
      jobs: ["observationSynthesis"],
    });
    expect(
      second.maintenance?.jobs.find(
        (job) => job.name === "observationSynthesis",
      )?.applied,
    ).toBe(0);
    expect(calls).toEqual(["Marco"]);

    // A new member fact invalidates the stored observation.
    await documentStore.set(
      "facts",
      "fact-8",
      makeFact("fact-8", "Marco started a pottery co-op.", "Marco"),
    );
    const third = await memory.runMaintenance({
      scope,
      jobs: ["observationSynthesis"],
    });
    expect(
      third.maintenance?.jobs.find(
        (job) => job.name === "observationSynthesis",
      )?.applied,
    ).toBe(1);
    const facts = await documentStore.query<FactMemory>("facts", {});
    const observations = facts.filter(
      (fact) => fact.attributes?.observationOf === "Marco",
    );
    // The stale observation is replaced, not accumulated.
    expect(observations).toHaveLength(1);
    expect(observations[0]?.content).toBe("Marco: 5 facts.");
  });

  it("applies nothing without the adapter and tolerates per-subject failures", async () => {
    const bare = buildMemory();
    await seedMarcoFacts(bare.documentStore, bare.makeFact);
    const report = await bare.memory.runMaintenance({
      scope,
      jobs: ["observationSynthesis"],
    });
    expect(
      report.maintenance?.jobs.find(
        (job) => job.name === "observationSynthesis",
      )?.applied,
    ).toBe(0);

    const failing = buildMemory(async () => {
      throw new Error("synth outage");
    });
    await seedMarcoFacts(failing.documentStore, failing.makeFact);
    const tolerant = await failing.memory.runMaintenance({
      scope,
      jobs: ["observationSynthesis"],
    });
    expect(
      tolerant.maintenance?.jobs.find(
        (job) => job.name === "observationSynthesis",
      )?.applied,
    ).toBe(0);
  });
});
