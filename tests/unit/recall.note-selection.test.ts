import { describe, expect, it } from "bun:test";
import { createGoodMemory } from "../../src";
import { createNoteMemory } from "../../src/domain/records";
import {
  createInMemoryDocumentStore,
  createInMemorySessionStore,
} from "../../src/storage/memory";

const NOW = "2026-09-01T00:00:00.000Z";
const scope = { userId: "u-notes", workspaceId: "workspace-a" };
const PAGE = [
  "# Reading MediaWiki sites as an agent",
  "",
  "Most MediaWiki sites (Wikipedia, Fandom, many corporate wikis) expose api.php.",
  "Search with list=search and srsearch=<terms>; it returns titles plus snippets.",
  "Always set a descriptive User-Agent header, otherwise Wikimedia rate-limits you.",
].join("\n");

function note(input: { id: string; title: string; body: string; lifecycle?: "active" | "superseded" }) {
  return createNoteMemory({
    ...scope,
    id: input.id,
    title: input.title,
    body: input.body,
    lifecycle: input.lifecycle ?? "active",
    source: { method: "explicit", extractedAt: NOW },
    createdAt: NOW,
    updatedAt: NOW,
  });
}

async function seed(documentStore: ReturnType<typeof createInMemoryDocumentStore>) {
  await documentStore.set("notes", "note-wiki", note({ id: "note-wiki", title: "Reading MediaWiki sites as an agent", body: PAGE }));
  await documentStore.set("notes", "note-wok", note({ id: "note-wok", title: "Carbon fibre woks", body: "Carbon fibre woks scorch at the centre and are worse than carbon steel for stir-frying." }));
  await documentStore.set("notes", "note-old", note({ id: "note-old", title: "Reading MediaWiki sites (old)", body: "Old MediaWiki api.php notes that were rewritten.", lifecycle: "superseded" }));
}

for (const preset of [undefined, "recommended"] as const) {
  describe(`note recall lane (${preset ?? "default"})`, () => {
    it("returns the matching note under the default configuration and traces it", async () => {
      const documentStore = createInMemoryDocumentStore();
      const memory = createGoodMemory({
        storage: { provider: "memory" },
        adapters: { documentStore, sessionStore: createInMemorySessionStore() },
        ...(preset ? { retrieval: { preset } } : {}),
        testing: { now: () => new Date(NOW) },
      });
      await seed(documentStore);

      const result = await memory.recall({ scope, query: "how do I search a MediaWiki api.php site with srsearch?" });

      expect(result.notes.map((record) => record.id)).toEqual(["note-wiki"]);
      expect(result.notes[0]?.body).toBe(PAGE);
      const trace = result.metadata.candidateTraces.find((entry) => entry.memoryId === "note-wiki");
      expect(trace).toMatchObject({ memoryType: "note", returned: true });
      const oldTrace = result.metadata.candidateTraces.find((entry) => entry.memoryId === "note-old");
      expect(oldTrace === undefined || (oldTrace.returned === false && oldTrace.whySuppressed === "inactive lifecycle")).toBe(true);
    });

    it("returns no note for an unrelated query", async () => {
      const documentStore = createInMemoryDocumentStore();
      const memory = createGoodMemory({
        storage: { provider: "memory" },
        adapters: { documentStore, sessionStore: createInMemorySessionStore() },
        ...(preset ? { retrieval: { preset } } : {}),
        testing: { now: () => new Date(NOW) },
      });
      await seed(documentStore);

      const result = await memory.recall({ scope, query: "what is the rollout blocker?" });

      expect(result.notes).toEqual([]);
    });

    it("caps the note lane at two records", async () => {
      const documentStore = createInMemoryDocumentStore();
      const memory = createGoodMemory({
        storage: { provider: "memory" },
        adapters: { documentStore, sessionStore: createInMemorySessionStore() },
        ...(preset ? { retrieval: { preset } } : {}),
        testing: { now: () => new Date(NOW) },
      });
      for (const index of [1, 2, 3]) {
        await documentStore.set("notes", `note-${index}`, note({
          id: `note-${index}`,
          title: `MediaWiki tip ${index}`,
          body: `MediaWiki api.php tip number ${index}: use srsearch for search.`,
        }));
      }

      const result = await memory.recall({ scope, query: "MediaWiki api.php srsearch" });

      expect(result.notes).toHaveLength(2);
    });
  });
}
