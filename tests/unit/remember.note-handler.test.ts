import { describe, expect, it } from "bun:test";
import { createMemoryRepositories } from "../../src/storage/repositories";
import {
  createInMemoryDocumentStore,
  createInMemorySessionStore,
  createInMemoryVectorStore,
} from "../../src/storage/memory";
import { createRememberEngine } from "../../src/remember/engine";
import type { RememberEngineConfig } from "../../src/remember/engine";
import type { NoteMemory } from "../../src/domain/records";
import { createFakeEmbeddingAdapter } from "../../src/testing/fakes";
import {
  DeterministicClock,
  createDeterministicIdGenerator,
} from "../../src/testing/utils";

const PAGE = "# Reading MediaWiki\n\nMost MediaWiki sites expose api.php. Use action=query with prop=extracts.\n";
const REWRITE = "# Reading MediaWiki\n\nPrefer the REST summary endpoint; fall back to action=query.\n";
const TITLE = "Reading MediaWiki sites as an agent";
const OBSERVED_AT = "2026-08-30T10:00:00.000Z";

function noteAnnotation(overrides: Record<string, unknown> = {}) {
  return {
    messageIndex: 0,
    remember: "always" as const,
    confirmed: true,
    kindHint: "note" as const,
    metadataPatch: { noteTitle: TITLE },
    ...overrides,
  };
}

function createEngine(overrides: Partial<RememberEngineConfig> = {}) {
  const clock = new DeterministicClock("2026-09-01T00:00:00.000Z");
  const documentStore = createInMemoryDocumentStore();
  const vectorStore = createInMemoryVectorStore();
  const repositories = createMemoryRepositories({
    documentStore,
    sessionStore: createInMemorySessionStore(),
    vectorStore,
  });
  const engine = createRememberEngine({
    repositories,
    documentStore,
    embedding: createFakeEmbeddingAdapter(),
    now: () => clock.now().toISOString(),
    createId: createDeterministicIdGenerator("mem"),
    ...overrides,
  });
  return { documentStore, engine, vectorStore };
}

async function writeNote(
  engine: ReturnType<typeof createEngine>["engine"],
  content: string,
  annotation = noteAnnotation(),
) {
  return engine.remember({
    scope: { userId: "u-note" },
    messages: [{ role: "assistant", content, observedAt: OBSERVED_AT }],
    annotations: [annotation],
  });
}

describe("note write handler", () => {
  it("writes the page verbatim as a note with evidence and a whole-note embedding", async () => {
    const { documentStore, engine, vectorStore } = createEngine();

    const result = await writeNote(engine, PAGE);

    expect(result.accepted).toBe(1);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      memoryType: "note",
      outcome: "written",
      reason: "explicit_note",
    });
    const notes = await documentStore.query<NoteMemory>("notes");
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({
      body: PAGE,
      title: TITLE,
      format: "markdown",
      lifecycle: "active",
      supersededBy: null,
      observedAt: OBSERVED_AT,
      source: { method: "explicit" },
    });
    expect(await documentStore.query("feedback")).toHaveLength(0);
    expect(await documentStore.query("facts")).toHaveLength(0);
    const evidence = await documentStore.query<{ linkedMemoryIds: string[] }>("evidence");
    expect(evidence).toHaveLength(1);
    expect(evidence[0]?.linkedMemoryIds).toEqual([notes[0]!.id]);
    const vector = await vectorStore.get("notes", notes[0]!.id);
    expect(vector?.content).toContain(TITLE);
    expect(vector?.content).toContain("prop=extracts");
    expect(vector?.metadata).toMatchObject({ memoryType: "note", userId: "u-note" });
  });

  it("merges an identical page into the existing note", async () => {
    const { documentStore, engine } = createEngine();
    await writeNote(engine, PAGE);

    const result = await writeNote(engine, PAGE);

    expect(result.events[0]).toMatchObject({
      memoryType: "note",
      outcome: "merged",
      reason: "duplicate_note",
    });
    expect(await documentStore.query("notes")).toHaveLength(1);
  });

  it("supersedes the note with lineage when the same title is rewritten", async () => {
    const { documentStore, engine, vectorStore } = createEngine();
    await writeNote(engine, PAGE);
    const [original] = await documentStore.query<NoteMemory>("notes");

    const result = await writeNote(engine, REWRITE);

    expect(result.events[0]).toMatchObject({
      memoryType: "note",
      outcome: "superseded",
      reason: "superseded_note",
    });
    const notes = await documentStore.query<NoteMemory>("notes");
    expect(notes).toHaveLength(2);
    const previous = notes.find((note) => note.id === original!.id);
    const next = notes.find((note) => note.id !== original!.id);
    expect(previous).toMatchObject({ lifecycle: "superseded", supersededBy: next!.id });
    expect(next).toMatchObject({ body: REWRITE, lifecycle: "active" });
    expect(await vectorStore.get("notes", original!.id)).toBeNull();
    expect(await vectorStore.get("notes", next!.id)).not.toBeNull();
  });

  it("honors a keep-existing conflict resolution", async () => {
    const { documentStore, engine } = createEngine({
      policy: {
        resolveConflict: async () => ({ action: "keep_existing", reason: "policy_keep_existing" }),
      },
    });
    await writeNote(engine, PAGE);

    const result = await writeNote(engine, REWRITE);

    expect(result.accepted).toBe(0);
    expect(result.events[0]).toMatchObject({
      memoryType: "note",
      outcome: "rejected",
      reason: "policy_keep_existing",
    });
    expect(await documentStore.query("notes")).toHaveLength(1);
  });

  it("derives the title from the first heading or first line when none is given", async () => {
    const { documentStore, engine } = createEngine();

    await writeNote(engine, "# Wok notes\n\nCarbon fibre woks scorch.", noteAnnotation({ metadataPatch: {} }));
    await writeNote(engine, "Finnish bureaucracy tip: book DVV early.\nMore text.", noteAnnotation({ metadataPatch: {} }));

    const titles = (await documentStore.query<NoteMemory>("notes")).map((note) => note.title).sort();
    expect(titles).toEqual([
      "Finnish bureaucracy tip: book DVV early.",
      "Wok notes",
    ]);
  });
});
