import { createHash } from "node:crypto";
import { describe, expect, it } from "bun:test";
import { createGoodMemory } from "../../src";
import { createNoteMemory } from "../../src/domain/records";
import type { NoteMemory } from "../../src/domain/records";
import {
  createInMemoryDocumentStore,
  createInMemorySessionStore,
  createInMemoryVectorStore,
} from "../../src/storage/memory";
import { buildNoteRememberInput } from "../../src/remember/noteInput";
import { createFakeEmbeddingAdapter } from "../../src/testing/fakes";
import {
  createExperienceRecord,
  createLearningProposal,
  createPromotionRecord,
} from "../../src/domain/evolutionRecords";
import type { DocumentStore } from "../../src/storage/contracts";

const NOW = "2026-09-02T00:00:00.000Z";
const scope = { userId: "u-import", workspaceId: "workspace-a" };

const WOK_PAGE = [
  "---",
  "title: Carbon Fibre Woks",
  "created: '2026-03-01T09:00:00Z'",
  "updated: '2026-08-22T14:30:00Z'",
  "uuid: 6aa615f0-486f-48a7-a210-ba4f5ff18c8b",
  "summary: Thermal properties of carbon fibre cookware",
  "tags: [cookware]",
  "---",
  "",
  "Carbon fibre woks conduct heat evenly, but scorch at the centre.",
  "",
].join("\n");

const WIKI_PAGE = "# Reading MediaWiki\n\nMost MediaWiki sites expose api.php.\n";

function harness(options: { documentStore?: DocumentStore } = {}) {
  const documentStore = createInMemoryDocumentStore();
  const vectorStore = createInMemoryVectorStore();
  const memory = createGoodMemory({
    storage: { provider: "memory" },
    adapters: {
      documentStore: options.documentStore ?? documentStore,
      sessionStore: createInMemorySessionStore(),
      vectorStore,
      embeddingAdapter: createFakeEmbeddingAdapter(),
      terminalDeletionSemantics: "shared-coordinated-backends-v1",
    },
    testing: { now: () => new Date(NOW) },
  });
  return { documentStore, memory, vectorStore };
}

function pagesSha256(pages: Array<{ path: string; content: string }>): string {
  const lines = pages
    .map(({ content, path }) => `${path} ${createHash("sha256").update(content).digest("hex")}`)
    .sort()
    .map((line) => `${line}\n`)
    .join("");
  return createHash("sha256").update(lines).digest("hex");
}

describe("importMemory", () => {
  it("imports memoryfield pages as notes with lineage, idempotently", async () => {
    const { documentStore, memory, vectorStore } = harness();
    const pages = [
      { path: "carbon-fibre-woks.md", content: WOK_PAGE },
      { path: "reading-mediawiki.md", content: WIKI_PAGE },
    ];

    const first = await memory.importMemory({ scope, source: { kind: "pages", pages } });

    expect(first.outcome).toBe("imported");
    expect(first.counts).toMatchObject({ imported: 2, unchanged: 0, rejected: 0 });
    expect(first.inputSha256).toBe(pagesSha256(pages));
    const notes = await documentStore.query<NoteMemory>("notes");
    expect(notes).toHaveLength(2);
    const wok = notes.find((note) => note.title === "Carbon Fibre Woks");
    expect(wok).toMatchObject({
      body: "Carbon fibre woks conduct heat evenly, but scorch at the centre.\n",
      observedAt: "2026-08-22T14:30:00Z",
      source: { method: "import" },
      tags: ["cookware"],
      attributes: { summary: "Thermal properties of carbon fibre cookware", uuid: "6aa615f0-486f-48a7-a210-ba4f5ff18c8b" },
    });
    expect(await vectorStore.get("notes", wok!.id)).not.toBeNull();
    const entry = first.pages.find((page) => page.path === "reading-mediawiki.md");
    expect(entry).toMatchObject({ outcome: "imported", title: "Reading MediaWiki" });

    const second = await memory.importMemory({ scope, source: { kind: "pages", pages } });
    expect(second.counts).toMatchObject({ imported: 0, unchanged: 2, rejected: 0 });
    expect(await documentStore.query<NoteMemory>("notes")).toHaveLength(2);

    const rewritten = await memory.importMemory({
      scope,
      source: { kind: "pages", pages: [{ path: "carbon-fibre-woks.md", content: WOK_PAGE.replace("scorch at the centre", "cool at the rim") }] },
    });
    expect(rewritten.counts).toMatchObject({ superseded: 1 });
    const afterRewrite = await documentStore.query<NoteMemory>("notes");
    expect(afterRewrite.filter((note) => note.title === "Carbon Fibre Woks")).toHaveLength(2);
    expect(afterRewrite.find((note) => note.id === wok!.id)).toMatchObject({ lifecycle: "superseded" });
    expect(await vectorStore.get("notes", wok!.id)).toBeNull();
  });

  it("dry-runs without writing, rejects oversize pages, and splits them on request", async () => {
    const { documentStore, memory } = harness();
    const big = { path: "big.md", content: `# Big\n\n${"Carbon fibre woks conduct heat evenly. ".repeat(400)}` };

    const dry = await memory.importMemory({ scope, source: { kind: "pages", pages: [{ path: "reading-mediawiki.md", content: WIKI_PAGE }] }, dryRun: true });
    expect(dry.counts).toMatchObject({ imported: 1 });
    expect(await documentStore.query("notes")).toHaveLength(0);

    const rejected = await memory.importMemory({ scope, source: { kind: "pages", pages: [big] } });
    expect(rejected.pages[0]).toMatchObject({ outcome: "rejected", reason: "note_too_large" });
    expect(await documentStore.query("notes")).toHaveLength(0);

    const split = await memory.importMemory({ scope, source: { kind: "pages", pages: [big] }, oversize: "split" });
    expect(split.pages[0]?.outcome).toBe("split");
    const notes = await documentStore.query<NoteMemory>("notes");
    expect(notes.length).toBeGreaterThan(1);
    expect(notes.every((note) => Buffer.byteLength(note.body, "utf8") <= 8192)).toBe(true);
    expect(notes.map((note) => note.title).sort()[0]).toMatch(/^Big \(1\/\d+\)$/);
  });

  it("rejects malformed pages per file and honors the expected input hash", async () => {
    const { memory } = harness();
    const pages = [
      { path: "notes.json", content: "{}" },
      { path: "nested.md", content: "---\nmeta:\n  nested: true\n---\nbody\n" },
      { path: "ok.md", content: WIKI_PAGE },
    ];

    const result = await memory.importMemory({ scope, source: { kind: "pages", pages } });
    expect(result.pages.map(({ outcome }) => outcome)).toEqual(["rejected", "rejected", "imported"]);
    expect(result.pages[0]?.reason).toBe("not_a_page");
    expect(result.pages[1]?.reason).toBe("unsupported_frontmatter");

    await expect(
      memory.importMemory({ scope, source: { kind: "pages", pages }, expectedSha256: "0".repeat(64) }),
    ).rejects.toThrow("import_hash_mismatch");
  });

  it("round-trips the durable export envelope by id", async () => {
    const source = harness();
    await source.memory.remember({
      scope,
      messages: [{ role: "user", content: "Remember that my editor is Neovim." }],
    });
    await source.memory.importMemory({ scope, source: { kind: "pages", pages: [{ path: "reading-mediawiki.md", content: WIKI_PAGE }] } });
    const exported = await source.memory.exportMemory({ scope });
    expect(exported.durable.facts.length + (exported.durable.notes?.length ?? 0)).toBeGreaterThan(1);

    const target = harness();
    const imported = await target.memory.importMemory({ scope, source: { kind: "durable", durable: exported.durable } });
    expect(imported.outcome).toBe("imported");
    expect(imported.counts.imported).toBeGreaterThan(1);
    const again = await target.memory.exportMemory({ scope });
    expect(again.durable.facts.map(({ id }) => id).sort()).toEqual(exported.durable.facts.map(({ id }) => id).sort());
    expect(again.durable.notes?.map(({ id }) => id)).toEqual(exported.durable.notes?.map(({ id }) => id));
    expect(again.durable.evidence.map(({ id }) => id).sort()).toEqual(exported.durable.evidence.map(({ id }) => id).sort());

    const repeat = await target.memory.importMemory({ scope, source: { kind: "durable", durable: exported.durable } });
    expect(repeat.counts.imported).toBe(0);
    expect(repeat.counts.unchanged).toBe(imported.counts.imported);

    const mismatch = await target.memory.importMemory({
      scope: { userId: "someone-else" },
      source: { kind: "durable", durable: exported.durable },
    });
    expect(mismatch.outcome).toBe("rejected");
    expect(mismatch.reason).toBe("scope_mismatch");
  });

  it("exports active notes as pages that re-import unchanged and restore elsewhere", async () => {
    const { documentStore, memory } = harness();
    await memory.remember(
      buildNoteRememberInput({ body: WIKI_PAGE, scope, tags: ["wiki"], title: "Reading MediaWiki" }),
    );
    await memory.importMemory({
      scope,
      source: { kind: "pages", pages: [{ content: WOK_PAGE, path: "carbon-fibre-woks.md" }] },
    });
    const before = await documentStore.query<NoteMemory>("notes");
    expect(before).toHaveLength(2);

    const exported = await memory.exportMemory({ scope });
    expect(exported.pages.rootPath).toBe("pages");
    const pageFiles = exported.pages.files.filter((file) => file.kind === "page");
    expect(pageFiles.map((file) => file.relativePath)).toEqual([
      expect.stringMatching(/^pages\/carbon-fibre-woks-[0-9a-f]{8}\.md$/),
      expect.stringMatching(/^pages\/reading-mediawiki-[A-Za-z0-9-]{1,8}\.md$/),
    ]);
    expect(exported.pages.files.map((file) => file.kind)).toEqual(["page", "page", "listing", "manifest"]);
    const pages = pageFiles.map((file) => ({
      content: file.content,
      path: file.relativePath.slice("pages/".length),
    }));

    const reimported = await memory.importMemory({
      expectedSha256: exported.pages.manifest.pagesSha256,
      scope,
      source: { kind: "pages", pages },
    });
    expect(reimported.counts).toMatchObject({ imported: 0, superseded: 0, unchanged: 2 });
    expect(await documentStore.query<NoteMemory>("notes")).toEqual(before);

    const target = harness();
    const restored = await target.memory.importMemory({ scope, source: { kind: "pages", pages } });
    expect(restored.counts).toMatchObject({ imported: 2 });
    const notes = await target.documentStore.query<NoteMemory>("notes");
    expect(notes.find((note) => note.title === "Reading MediaWiki")).toMatchObject({
      body: expect.stringContaining("Most MediaWiki sites expose api.php."),
      tags: ["wiki"],
    });
    expect(notes.find((note) => note.title === "Carbon Fibre Woks")).toMatchObject({
      attributes: expect.objectContaining({ summary: "Thermal properties of carbon fibre cookware" }),
      observedAt: "2026-08-22T14:30:00Z",
    });
  });

  it("guarantees the note cap after splitting and fails closed when a chunk cannot fit", async () => {
    const { documentStore, memory } = harness();
    const blob = { path: "blob.md", content: `# Blob\n\n${"a".repeat(9000)}\n` };
    const split = await memory.importMemory({ scope, source: { kind: "pages", pages: [blob] }, oversize: "split" });
    expect(split.pages[0]?.outcome).toBe("split");
    const notes = await documentStore.query<NoteMemory>("notes");
    expect(notes.length).toBeGreaterThan(1);
    expect(notes.every((note) => Buffer.byteLength(note.body, "utf8") <= 8192)).toBe(true);

    const oversizedCitation = {
      path: "cited.md",
      content: `# Cited\n\nThe claim [src] holds.\n\n${"More text. ".repeat(800)}\n\n[src]: https://example.test/${"x".repeat(9000)}\n`,
    };
    const rejected = await memory.importMemory({ scope, source: { kind: "pages", pages: [oversizedCitation] }, oversize: "split" });
    expect(rejected.pages[0]).toMatchObject({ outcome: "rejected", reason: "note_too_large" });
    expect(rejected.counts).toMatchObject({ rejected: 1, split: 0 });
    expect((await documentStore.query<NoteMemory>("notes")).filter((note) => note.title.startsWith("Cited"))).toHaveLength(0);
  });

  it("restores every durable collection and validates the envelope before writing", async () => {
    const source = harness();
    const exported = await source.memory.exportMemory({ scope });
    const durable = {
      ...exported.durable,
      experiences: [
        createExperienceRecord({ id: "exp-1", kind: "recall", summary: "Recalled the wok note.", traceId: "trace-1", userId: scope.userId, workspaceId: scope.workspaceId }),
      ],
      proposals: [
        createLearningProposal({ id: "prop-1", proposalType: "memory_write", rationale: "Seen twice.", summary: "Promote the wok note.", traceId: "trace-1", userId: scope.userId, workspaceId: scope.workspaceId }),
      ],
      promotions: [
        createPromotionRecord({ decision: "accepted", id: "promo-1", proposalId: "prop-1", rationale: "Confirmed.", summary: "Promoted.", traceId: "trace-1", userId: scope.userId, workspaceId: scope.workspaceId }),
      ],
    };

    const target = harness();
    const imported = await target.memory.importMemory({ scope, source: { kind: "durable", durable } });
    expect(imported.counts.imported).toBe(3);
    const again = await target.memory.exportMemory({ scope });
    expect(again.durable.experiences.map(({ id }) => id)).toEqual(["exp-1"]);
    expect(again.durable.proposals.map(({ id }) => id)).toEqual(["prop-1"]);
    expect(again.durable.promotions.map(({ id }) => id)).toEqual(["promo-1"]);
    const repeat = await target.memory.importMemory({ scope, source: { kind: "durable", durable } });
    expect(repeat.counts).toMatchObject({ imported: 0, unchanged: 3 });

    await expect(
      target.memory.importMemory({ scope, source: { kind: "durable", durable: {} as never } }),
    ).rejects.toThrow("invalid_durable");
    await expect(
      target.memory.importMemory({
        scope,
        source: { kind: "durable", durable: { ...durable, facts: [{ userId: scope.userId } as never] } },
      }),
    ).rejects.toThrow("invalid_durable: facts[0]");
    const nulNote = createNoteMemory({
      body: "bad\u0000byte",
      id: "note-nul",
      source: { extractedAt: NOW, method: "import" },
      title: "NUL",
      userId: scope.userId,
      workspaceId: scope.workspaceId,
    });
    await expect(
      target.memory.importMemory({ scope, source: { kind: "durable", durable: { ...durable, notes: [nulNote] } } }),
    ).rejects.toThrow();
    await expect(
      target.memory.importMemory({
        scope,
        source: { kind: "durable", durable: { ...durable, notes: [{ ...nulNote, body: "fine", lifecycle: "zombie" } as never] } },
      }),
    ).rejects.toThrow("invalid_durable: notes[0].lifecycle");
    expect((await target.memory.exportMemory({ scope })).durable.notes ?? []).toHaveLength(0);
  });

  it("rolls back every write of a failed import, including superseded notes", async () => {
    // Canonical writes reach the store through plain set() and through the
    // projection decorator's conditional batch; the fault covers both.
    const backing = createInMemoryDocumentStore();
    let failOn: ((collection: string, id: string) => boolean) | null = null;
    const flaky = new Proxy(backing, {
      get(target, property, receiver) {
        if (property === "set") {
          return async (collection: string, id: string, document: object) => {
            if (failOn?.(collection, id)) {
              throw new Error("disk full");
            }
            return target.set(collection, id, document as never);
          };
        }
        if (property === "writeBatchIfUnchanged") {
          return async (batch: { set: Array<{ collection: string; id: string }> }) => {
            if (batch.set.some((operation) => failOn?.(operation.collection, operation.id))) {
              throw new Error("disk full");
            }
            return target.writeBatchIfUnchanged(batch as never);
          };
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const { memory, vectorStore } = harness({ documentStore: flaky });

    const first = await memory.importMemory({ scope, source: { kind: "pages", pages: [{ path: "carbon-fibre-woks.md", content: WOK_PAGE }] } });
    const wokId = first.pages[0]!.memoryId!;
    let newNoteWrites = 0;
    failOn = (collection, id) => collection === "notes" && id !== wokId && ++newNoteWrites === 2;
    await expect(
      memory.importMemory({
        scope,
        source: {
          kind: "pages",
          pages: [
            { path: "carbon-fibre-woks.md", content: WOK_PAGE.replace("scorch at the centre", "cool at the rim") },
            { path: "reading-mediawiki.md", content: WIKI_PAGE },
          ],
        },
      }),
    ).rejects.toThrow("disk full");
    const notes = await backing.query<NoteMemory>("notes");
    expect(notes.map(({ id, lifecycle, supersededBy }) => ({ id, lifecycle, supersededBy }))).toEqual([
      { id: wokId, lifecycle: "active", supersededBy: null },
    ]);
    expect(await vectorStore.get("notes", wokId)).not.toBeNull();

    failOn = null;
    const exported = await memory.exportMemory({ scope });
    const other = harness();
    await other.memory.remember({ scope, messages: [{ role: "user", content: "Remember that my editor is Neovim." }] });
    const facts = (await other.memory.exportMemory({ scope })).durable.facts;
    expect(facts.length).toBeGreaterThan(0);
    let factWrites = 0;
    failOn = (collection) => collection === "facts" && ++factWrites === facts.length + 1;
    await expect(
      memory.importMemory({
        scope,
        source: { kind: "durable", durable: { ...exported.durable, facts: [...facts, { ...facts[0]!, id: "fact-extra" }] } },
      }),
    ).rejects.toThrow("disk full");
    expect(await backing.query("facts")).toHaveLength(0);
    expect((await backing.query<NoteMemory>("notes")).map(({ id }) => id)).toEqual([wokId]);
  });
});
