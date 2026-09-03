import { describe, expect, it } from "bun:test";
import {
  computePagesSha256,
  derivePageNoteId,
  parsePageFile,
  renderYamlScalar,
  splitPage,
} from "../../src/interchange/pages";

const scope = { userId: "u-1", workspaceId: "workspace-a" };

describe("memoryfield page parsing", () => {
  it("parses the memoryfield frontmatter subset and keeps the body verbatim", () => {
    const parsed = parsePageFile({
      path: "carbon-fibre-woks.md",
      content: [
        "---",
        "title: Carbon Fibre Woks",
        "created: '2026-03-01T09:00:00Z'",
        "updated: \"2026-08-22T14:30:00Z\"",
        "uuid: 6aa615f0-486f-48a7-a210-ba4f5ff18c8b",
        "summary: Thermal properties of carbon fibre cookware",
        "tags: [cookware, materials]",
        "---",
        "",
        "Carbon fibre woks conduct heat evenly, but...",
        "",
      ].join("\n"),
    });

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.page.frontmatter).toEqual({
      title: "Carbon Fibre Woks",
      created: "2026-03-01T09:00:00Z",
      updated: "2026-08-22T14:30:00Z",
      uuid: "6aa615f0-486f-48a7-a210-ba4f5ff18c8b",
      summary: "Thermal properties of carbon fibre cookware",
      tags: ["cookware", "materials"],
    });
    expect(parsed.page.body).toBe("Carbon fibre woks conduct heat evenly, but...\n");
    expect(parsed.page.title).toBe("Carbon Fibre Woks");
  });

  it("accepts pages without frontmatter and derives the title from the first heading or the filename", () => {
    const heading = parsePageFile({ path: "finnish-bureaucracy-tips.md", content: "# Finnish bureaucracy tips\n\nBook DVV early.\n" });
    const bare = parsePageFile({ path: "wec-2026-season-notes.md", content: "Hypercar entries doubled this year.\n" });

    expect(heading.ok && heading.page.title).toBe("Finnish bureaucracy tips");
    expect(heading.ok && heading.page.frontmatter).toEqual({});
    expect(bare.ok && bare.page.title).toBe("wec 2026 season notes");
  });

  it("rejects nested frontmatter, unknown files, and empty bodies", () => {
    const nested = parsePageFile({ path: "x.md", content: "---\nmeta:\n  nested: true\n---\nbody\n" });
    const notMarkdown = parsePageFile({ path: "index.json", content: "{}" });
    const empty = parsePageFile({ path: "empty.md", content: "---\ntitle: Empty\n---\n\n" });

    expect(nested.ok).toBe(false);
    expect(!nested.ok && nested.reason).toBe("unsupported_frontmatter");
    expect(!notMarkdown.ok && notMarkdown.reason).toBe("not_a_page");
    expect(!empty.ok && empty.reason).toBe("empty_body");
  });

  it("derives stable, scope-salted note ids from the uuid or the normalized title", () => {
    const byUuid = derivePageNoteId(scope, { uuid: "6aa615f0-486f-48a7-a210-ba4f5ff18c8b" });
    const again = derivePageNoteId(scope, { uuid: "6aa615f0-486f-48a7-a210-ba4f5ff18c8b" });
    const otherScope = derivePageNoteId({ userId: "u-2" }, { uuid: "6aa615f0-486f-48a7-a210-ba4f5ff18c8b" });
    const byTitle = derivePageNoteId(scope, { title: "  Carbon Fibre   Woks " });

    expect(byUuid).toBe(again);
    expect(byUuid).toMatch(/^note_[0-9a-f]{24}$/);
    expect(byUuid).not.toBe(otherScope);
    expect(byTitle).toBe(derivePageNoteId(scope, { title: "carbon fibre woks" }));
  });

  it("splits an oversize page at heading then paragraph boundaries and preserves citations", () => {
    const paragraph = "Carbon fibre woks conduct heat evenly across the surface and hold it well. ".repeat(40);
    const body = [
      "# Woks",
      "",
      `${paragraph}See [1].`,
      "",
      "## Seasoning",
      "",
      `${paragraph}See [2].`,
      "",
      "## Care",
      "",
      paragraph,
      "",
      "[1]: https://example.com/woks",
      "[2]: https://example.com/seasoning",
      "",
    ].join("\n");

    const chunks = splitPage({ title: "Carbon Fibre Woks", body }, 8192);

    expect(chunks.length).toBeGreaterThan(1);
    for (const [index, chunk] of chunks.entries()) {
      expect(Buffer.byteLength(chunk.body, "utf8")).toBeLessThanOrEqual(8192);
      expect(chunk.title).toBe(`Carbon Fibre Woks (${index + 1}/${chunks.length})`);
    }
    const citing = chunks.filter((chunk) => chunk.body.includes("See [1]."));
    expect(citing.length).toBeGreaterThan(0);
    expect(citing.every((chunk) => chunk.body.includes("[1]: https://example.com/woks"))).toBe(true);
    expect(chunks.map((chunk) => chunk.body).join("\n")).toContain("## Care");
    expect(splitPage({ title: "Short", body: "tiny" }, 8192)).toEqual([{ title: "Short", body: "tiny" }]);
  });

  it("unescapes quoted scalars and quote-aware inline lists", () => {
    const parsed = parsePageFile({
      path: "q.md",
      content: [
        "---",
        "title: 'Bob''s \"wok\": tips'",
        'summary: "a \\"b\\" \\\\ c"',
        "tags: ['wok, pan', \"c#\", plain]",
        "---",
        "body",
        "",
      ].join("\n"),
    });
    expect(parsed.ok && parsed.page.title).toBe("Bob's \"wok\": tips");
    expect(parsed.ok && parsed.page.frontmatter.summary).toBe('a "b" \\ c');
    expect(parsed.ok && parsed.page.frontmatter.tags).toEqual(["wok, pan", "c#", "plain"]);
    expect(renderYamlScalar("Bob's \"wok\": tips")).toBe("'Bob''s \"wok\": tips'");
    expect(renderYamlScalar("multi\nline")).toBe("'multi line'");
  });

  it("hashes a page set independent of order as sorted `path sha256` lines", () => {
    const a = { content: "# A\n", path: "a.md" };
    const b = { content: "# B\n", path: "b.md" };
    expect(computePagesSha256([a, b])).toBe(computePagesSha256([b, a]));
    expect(computePagesSha256([a])).not.toBe(computePagesSha256([b]));
    expect(computePagesSha256([a])).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("splitPage cap guarantee", () => {
  const byteLength = (value: string) => Buffer.byteLength(value, "utf8");
  const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

  it("keeps every chunk within the cap for whitespace-free and multibyte bodies", () => {
    const ascii = splitPage({ title: "Blob", body: "a".repeat(9000) }, 8192);
    expect(ascii.length).toBeGreaterThan(1);
    expect(ascii.every((chunk) => byteLength(chunk.body) <= 8192)).toBe(true);
    expect(ascii.map((chunk) => chunk.body).join("")).toBe("a".repeat(9000));

    const han = splitPage({ title: "汉字", body: "字".repeat(3000) }, 8192);
    expect(han.every((chunk) => byteLength(chunk.body) <= 8192)).toBe(true);
    expect(han.map((chunk) => chunk.body).join("")).toBe("字".repeat(3000));

    const emoji = splitPage({ title: "Emoji", body: "😀".repeat(2500) }, 8192);
    expect(emoji.every((chunk) => byteLength(chunk.body) <= 8192 && !LONE_SURROGATE.test(chunk.body))).toBe(true);
    expect(emoji.map((chunk) => chunk.body).join("")).toBe("😀".repeat(2500));
  });

  it("reserves room for re-appended citations so a cited chunk never exceeds the cap", () => {
    const definition = `[src]: https://example.test/${"x".repeat(1500)}`;
    const paragraph = "the claim [src] holds. ".repeat(330);
    const chunks = splitPage({ title: "Cited", body: `${paragraph}\n\n${definition}\n` }, 8192);

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(byteLength(chunk.body)).toBeLessThanOrEqual(8192);
      expect(chunk.body.endsWith(definition)).toBe(true);
    }
  });
});
