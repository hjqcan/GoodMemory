import { describe, expect, it } from "bun:test";
import { createGoodMemory } from "../../src";
import type { NoteMemory } from "../../src/domain/records";
import { listAdminMemories } from "../../src/inspector/adminMemory";
import {
  createInMemoryDocumentStore,
  createInMemorySessionStore,
  createInMemoryVectorStore,
} from "../../src/storage/memory";
import { createFakeEmbeddingAdapter } from "../../src/testing/fakes";

const NOW = "2026-09-01T00:00:00.000Z";
const PAGE = "# Reading MediaWiki\n\nMost MediaWiki sites expose api.php.\n";
const TITLE = "Reading MediaWiki sites as an agent";

function harness() {
  const documentStore = createInMemoryDocumentStore();
  const vectorStore = createInMemoryVectorStore();
  const memory = createGoodMemory({
    storage: { provider: "memory" },
    adapters: {
      documentStore,
      sessionStore: createInMemorySessionStore(),
      vectorStore,
      embeddingAdapter: createFakeEmbeddingAdapter(),
      terminalDeletionSemantics: "shared-coordinated-backends-v1",
    },
    testing: { now: () => new Date(NOW) },
  });
  return { documentStore, memory, vectorStore };
}

async function writeNote(memory: ReturnType<typeof harness>["memory"], scope: { userId: string }) {
  const result = await memory.remember({
    scope,
    messages: [{ role: "assistant", content: PAGE, observedAt: NOW }],
    annotations: [{
      messageIndex: 0,
      remember: "always",
      confirmed: true,
      kindHint: "note",
      metadataPatch: { noteTitle: TITLE },
    }],
  });
  expect(result.accepted).toBe(1);
  return result.events[0]!.memoryId!;
}

describe("note governance surfaces", () => {
  it("exports notes and indexes them in MEMORY.md only when present", async () => {
    const { memory } = harness();
    const scope = { userId: "u-export" };
    const emptyExport = await memory.exportMemory({ scope });
    const emptyIndex = emptyExport.artifacts.files.find((file) => file.relativePath === "MEMORY.md");
    expect(emptyIndex?.content).not.toContain("## Notes");

    const noteId = await writeNote(memory, scope);
    const exported = await memory.exportMemory({ scope });

    expect(exported.durable.notes?.map((note) => note.id)).toEqual([noteId]);
    expect(exported.durable.notes?.[0]?.body).toBe(PAGE);
    const index = exported.artifacts.files.find((file) => file.relativePath === "MEMORY.md");
    expect(index?.content).toContain("## Notes");
    expect(index?.content).toMatch(new RegExp(`- \\[note\\] \\S+ 2026-09-01 \\[active\\] ${TITLE} \\[evidence: 1\\]`));
    expect(index?.content).toContain("- topics/notes.md");
  });

  it("forgets a note by id together with its vector", async () => {
    const { documentStore, memory, vectorStore } = harness();
    const scope = { userId: "u-forget" };
    const noteId = await writeNote(memory, scope);
    expect(await vectorStore.get("notes", noteId)).not.toBeNull();

    const result = await memory.forget({ scope, memoryId: noteId });

    expect(result.forgotten).toBe(true);
    expect(await documentStore.get("notes", noteId)).toBeNull();
    expect(await vectorStore.get("notes", noteId)).toBeNull();
  });

  it("counts notes in deleteAllMemory", async () => {
    const { documentStore, memory } = harness();
    const scope = { userId: "u-delete-all" };
    await writeNote(memory, scope);

    const result = await memory.deleteAllMemory({ scope });

    expect(result.deleted.notes).toBe(1);
    expect(await documentStore.query("notes")).toHaveLength(0);
  });

  it("revises a note body with lineage and rejects an oversize revision", async () => {
    const { documentStore, memory, vectorStore } = harness();
    const scope = { userId: "u-revise" };
    const noteId = await writeNote(memory, scope);

    const revision = await memory.reviseMemory({
      scope,
      target: { memoryId: noteId },
      revision: { content: "# Reading MediaWiki\n\nPrefer the REST summary endpoint.\n" },
      reason: "user_correction",
      idempotencyKey: "note-revision-1",
    });

    expect(revision).toMatchObject({
      accepted: true,
      outcome: "superseded",
      memoryType: "note",
      previousMemoryId: noteId,
    });
    const previous = await documentStore.get<NoteMemory>("notes", noteId);
    const next = await documentStore.get<NoteMemory>("notes", revision.newMemoryId!);
    expect(previous).toMatchObject({ lifecycle: "superseded", supersededBy: revision.newMemoryId });
    // Revision content is whitespace-trimmed like every other revised kind.
    expect(next).toMatchObject({
      title: TITLE,
      body: "# Reading MediaWiki\n\nPrefer the REST summary endpoint.",
      lifecycle: "active",
    });
    expect(await vectorStore.get("notes", noteId)).toBeNull();
    expect(await vectorStore.get("notes", revision.newMemoryId!)).not.toBeNull();

    const oversize = await memory.reviseMemory({
      scope,
      target: { memoryId: revision.newMemoryId! },
      revision: { content: "x".repeat(8193) },
      reason: "user_correction",
      idempotencyKey: "note-revision-2",
    });
    expect(oversize.outcome).toBe("blocked");
    expect(oversize.reason).toBe("note_too_large");
  });

  it("lists notes through the admin memory listing as revisable records", async () => {
    const { documentStore, memory } = harness();
    const scope = { userId: "u-admin" };
    const noteId = await writeNote(memory, scope);

    const listing = await listAdminMemories({ documentStore, limit: 50, scope });
    const item = listing.items.find((entry) => entry.id === noteId);

    expect(item).toMatchObject({ memoryType: "note", revisable: true, summary: TITLE });
  });
});
