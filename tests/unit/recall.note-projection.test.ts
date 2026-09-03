import { describe, expect, it } from "bun:test";

import { createNoteMemory } from "../../src/domain/records";
import {
  RECALL_DOCUMENTS_COLLECTION,
  RECALL_PROJECTION_PIPELINE_VERSION,
  RECALL_PROJECTION_SOURCE_COLLECTIONS,
  type RecallIndexDocument,
} from "../../src/recall/projections/contracts";
import { createRecallProjectionRuntime } from "../../src/recall/projections/runtime";
import { createInMemoryDocumentStore } from "../../src/storage/memory";

const NOW = "2026-09-01T12:00:00.000Z";
const scope = { userId: "user-note", workspaceId: "workspace-1" };
const BODY = [
  "# Reading MediaWiki",
  "",
  "Most MediaWiki sites expose api.php. Use action=query with prop=extracts.",
  "Search with list=search and srsearch=<terms>. Always set a User-Agent header.",
].join("\n");

function buildNote(input: { id: string; lifecycle?: "active" | "superseded" }) {
  return createNoteMemory({
    ...scope,
    id: input.id,
    title: "Reading MediaWiki sites as an agent",
    body: BODY,
    subject: "MediaWiki",
    tags: ["wiki", "api"],
    lifecycle: input.lifecycle ?? "active",
    source: { method: "explicit", extractedAt: NOW },
    createdAt: NOW,
    updatedAt: NOW,
  });
}

describe("note projection", () => {
  it("registers notes as a projection source under a bumped pipeline version", () => {
    expect(RECALL_PROJECTION_SOURCE_COLLECTIONS).toContain("notes");
    expect(RECALL_PROJECTION_PIPELINE_VERSION).toBe("gm-projection-v6");
  });

  it("projects a note as memory and field documents but never sentence documents", async () => {
    const rawStore = createInMemoryDocumentStore();
    const runtime = createRecallProjectionRuntime({
      documentStore: rawStore,
      now: () => NOW,
    });
    const note = buildNote({ id: "note-1" });
    await runtime.documentStore.set("notes", note.id, note);
    await runtime.ensureScopeIndexed(scope);

    const documents = await rawStore.query<RecallIndexDocument>(
      RECALL_DOCUMENTS_COLLECTION,
      { sourceMemoryId: note.id },
    );
    const granularities = new Set(documents.map((document) => document.granularity));

    expect(documents.length).toBeGreaterThan(1);
    expect(granularities).toEqual(new Set(["memory", "field"]));
    expect(documents.every((document) => document.sourceMemoryType === "note")).toBe(true);
    expect(documents.every((document) => document.sourceCollection === "notes")).toBe(true);
    const fields = [...new Set(
      documents
        .filter((document) => document.granularity === "field")
        .map((document) => document.field),
    )].sort();
    expect(fields).toEqual(["body", "subject", "tags", "title"]);
    const bodyDocument = documents.find((document) => document.field === "body");
    expect(bodyDocument?.text).toBe(BODY);
  });

  it("projects nothing for a superseded note", async () => {
    const rawStore = createInMemoryDocumentStore();
    const runtime = createRecallProjectionRuntime({
      documentStore: rawStore,
      now: () => NOW,
    });
    const note = buildNote({ id: "note-old", lifecycle: "superseded" });
    await runtime.documentStore.set("notes", note.id, note);
    await runtime.ensureScopeIndexed(scope);

    expect(
      await rawStore.query<RecallIndexDocument>(RECALL_DOCUMENTS_COLLECTION, {
        sourceMemoryId: note.id,
      }),
    ).toHaveLength(0);
  });
});
