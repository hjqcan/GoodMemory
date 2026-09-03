import { createHash } from "node:crypto";
import { describe, expect, it } from "bun:test";
import { createMemorySource } from "../../src/domain/provenance";
import { createNoteMemory, type NoteMemory } from "../../src/domain/records";
import { buildPageArtifacts } from "../../src/governance/pageArtifacts";
import { computePagesSha256, parsePageFile } from "../../src/interchange/pages";

const WOK_ID = "note_abcdef1234567890abcdef12_11223344";

function note(overrides: Partial<NoteMemory> = {}): NoteMemory {
  return createNoteMemory({
    id: WOK_ID,
    userId: "u",
    workspaceId: "w",
    title: "Carbon Fibre Woks",
    body: "Carbon fibre woks conduct heat evenly.\n",
    source: createMemorySource({ method: "import", extractedAt: "2026-08-22T14:30:00.000Z" }),
    tags: ["cookware"],
    attributes: { summary: "Thermal properties", uuid: "6aa615f0-486f-48a7-a210-ba4f5ff18c8b" },
    observedAt: "2026-08-22T14:30:00Z",
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  });
}

describe("buildPageArtifacts", () => {
  it("renders one page per active note with memoryfield frontmatter and a verbatim body", () => {
    const bundle = buildPageArtifacts({
      notes: [
        note(),
        note({
          id: "note_ffffffffffffffffffffffff_00000000",
          title: "Reading MediaWiki",
          body: "Most sites expose api.php.\n",
          lifecycle: "superseded",
          supersededBy: WOK_ID,
        }),
      ],
    });

    expect(bundle.rootPath).toBe("pages");
    expect(bundle.files.map((file) => file.relativePath)).toEqual([
      "pages/carbon-fibre-woks-abcdef12.md",
      "pages/listing.md",
      "pages/manifest.json",
    ]);
    const page = bundle.files[0]!;
    expect(page).toMatchObject({ kind: "page", noteId: WOK_ID });
    expect(page.content).toBe(
      [
        "---",
        "title: 'Carbon Fibre Woks'",
        `uuid: ${WOK_ID}`,
        "created: '2026-09-01T00:00:00.000Z'",
        "updated: '2026-08-22T14:30:00Z'",
        "summary: 'Thermal properties'",
        "tags: [cookware]",
        "goodmemory:",
        "  kind: note",
        "  format: markdown",
        "  source: import",
        "  observedAt: '2026-08-22T14:30:00Z'",
        "  createdAt: '2026-09-01T00:00:00.000Z'",
        "  updatedAt: '2026-09-01T00:00:00.000Z'",
        "---",
        "",
        "Carbon fibre woks conduct heat evenly.",
        "",
      ].join("\n"),
    );
    const parsed = parsePageFile({ content: page.content, path: "carbon-fibre-woks-abcdef12.md" });
    expect(parsed.ok).toBe(true);
    expect(parsed.ok && parsed.page).toMatchObject({
      body: "Carbon fibre woks conduct heat evenly.\n",
      frontmatter: {
        goodmemory: { format: "markdown", kind: "note", source: "import" },
        summary: "Thermal properties",
        tags: ["cookware"],
        updated: "2026-08-22T14:30:00Z",
        uuid: WOK_ID,
      },
      title: "Carbon Fibre Woks",
    });
  });

  it("quotes scalars so awkward titles, summaries, and tags round-trip through the parser", () => {
    const bundle = buildPageArtifacts({
      notes: [
        note({
          attributes: { summary: 'Says "hot": really' },
          body: "no trailing newline",
          tags: ["wok, pan", "c#"],
          title: "Bob's \"wok\": tips #1",
        }),
      ],
    });
    const page = bundle.files[0]!;
    expect(page.relativePath).toBe("pages/bob-s-wok-tips-1-abcdef12.md");
    expect(page.content).toContain("title: 'Bob''s \"wok\": tips #1'\n");
    expect(page.content.endsWith("\nno trailing newline\n")).toBe(true);
    const parsed = parsePageFile({ content: page.content, path: "x.md" });
    expect(parsed.ok && parsed.page).toMatchObject({
      body: "no trailing newline\n",
      frontmatter: { summary: 'Says "hot": really', tags: ["wok, pan", "c#"] },
      title: "Bob's \"wok\": tips #1",
    });
  });

  it("writes a listing and a manifest whose hash matches the importer's input hash", () => {
    const bundle = buildPageArtifacts({ notes: [note()] });
    const page = bundle.files[0]!;
    const listing = bundle.files.find((file) => file.relativePath === "pages/listing.md")!;
    const manifestFile = bundle.files.find((file) => file.relativePath === "pages/manifest.json")!;

    expect(listing.kind).toBe("listing");
    expect(listing.content).toBe(
      [
        "# Pages",
        "",
        "- [Carbon Fibre Woks](carbon-fibre-woks-abcdef12.md) (updated 2026-08-22): Thermal properties",
        "",
      ].join("\n"),
    );
    expect(manifestFile.kind).toBe("manifest");
    const contentSha256 = createHash("sha256").update(page.content).digest("hex");
    expect(JSON.parse(manifestFile.content)).toEqual({
      files: [
        {
          bytes: Buffer.byteLength(page.content, "utf8"),
          noteId: WOK_ID,
          path: "carbon-fibre-woks-abcdef12.md",
          sha256: contentSha256,
          title: "Carbon Fibre Woks",
        },
      ],
      format: "goodmemory.pages/v1",
      pageCount: 1,
      pagesSha256: computePagesSha256([
        { content: page.content, path: "carbon-fibre-woks-abcdef12.md" },
      ]),
    });
    expect(bundle.manifest).toEqual(JSON.parse(manifestFile.content));
    expect(page).toMatchObject({ bytes: Buffer.byteLength(page.content, "utf8"), sha256: contentSha256 });
    expect(manifestFile.content.endsWith("\n")).toBe(true);
  });

  it("is deterministic, orders pages by title, and disambiguates colliding file names", () => {
    const notes = [
      note({ id: "note_abcdef12aaaaaaaaaaaaaaaa_1", title: "Zeta" }),
      note({ id: "note_abcdef12bbbbbbbbbbbbbbbb_2", title: "Zeta" }),
      note({ id: "note_00000000cccccccccccccccc_3", title: "!!!" }),
      note({ id: "plain-id", title: "Alpha" }),
    ];
    const first = buildPageArtifacts({ notes });
    const second = buildPageArtifacts({ notes: [...notes].reverse() });

    expect(first).toEqual(second);
    expect(first.files.map((file) => file.relativePath)).toEqual([
      "pages/note-00000000.md",
      "pages/alpha-plain-id.md",
      "pages/zeta-abcdef12.md",
      "pages/zeta-abcdef12-2.md",
      "pages/listing.md",
      "pages/manifest.json",
    ]);
  });

  it("emits only the listing and manifest when a scope has no active notes", () => {
    const bundle = buildPageArtifacts({ notes: [note({ lifecycle: "inactive" })] });

    expect(bundle.files.map((file) => file.relativePath)).toEqual([
      "pages/listing.md",
      "pages/manifest.json",
    ]);
    expect(bundle.manifest).toMatchObject({ files: [], pageCount: 0 });
    expect(bundle.files[0]!.content).toBe("# Pages\n\n(no pages)\n");
  });
});
