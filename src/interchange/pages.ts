import { createHash } from "node:crypto";

import type { MemoryScope } from "../domain/scope";
import { scopeToKey } from "../domain/scope";

// Memoryfield-compatible page interchange (ADR-010 §9). A page is a UTF-8
// Markdown file with an optional YAML frontmatter *subset*: scalar `title`,
// `uuid`, `summary`, `created`, `updated`, an inline `tags` list, and one
// nested `goodmemory:` block of scalars written by our own export. Anything
// else nested is rejected rather than guessed; unknown scalar keys are ignored
// per the spec's "MUST NOT raise errors on unknown fields".

export interface PageFrontmatter {
  created?: string;
  goodmemory?: Record<string, string>;
  summary?: string;
  tags?: string[];
  title?: string;
  updated?: string;
  uuid?: string;
}

export interface ParsedPage {
  body: string;
  frontmatter: PageFrontmatter;
  path: string;
  title: string;
}

export type ParsePageFailure =
  | "empty_body"
  | "not_a_page"
  | "unsupported_frontmatter";

export type ParsePageResult =
  | { ok: true; page: ParsedPage }
  | { ok: false; path: string; reason: ParsePageFailure };

const SCALAR_KEYS = new Set(["title", "uuid", "summary", "created", "updated"]);
const FRONTMATTER_OPEN = "---\n";
const FRONTMATTER_CLOSE = "\n---\n";

// YAML scalar quoting subset: single quotes double an inner quote, double
// quotes backslash-escape `"` and `\\`. Everything else is taken literally.
function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replace(/''/g, "'");
  }
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/\\(["\\])/g, "$1");
  }
  return trimmed;
}

export function renderYamlScalar(value: string): string {
  return `'${value.replace(/\s+/g, " ").replace(/'/g, "''")}'`;
}

function splitInlineList(inner: string): string[] {
  const entries: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  for (let index = 0; index < inner.length; index += 1) {
    const char = inner[index]!;
    if (quote !== null) {
      current += char;
      if (char === quote) {
        if (quote === "'" && inner[index + 1] === "'") {
          current += "'";
          index += 1;
        } else if (quote === '"' && inner[index - 1] === "\\") {
          // escaped double quote stays inside the scalar
        } else {
          quote = null;
        }
      }
      continue;
    }
    if ((char === "'" || char === '"') && current.trim().length === 0) {
      quote = char;
      current += char;
      continue;
    }
    if (char === ",") {
      entries.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  entries.push(current);
  return entries.map((entry) => unquote(entry)).filter((entry) => entry.length > 0);
}

function parseInlineList(value: string): string[] | undefined {
  const trimmed = value.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) {
    return undefined;
  }
  return splitInlineList(trimmed.slice(1, -1));
}

// The pages hash is order-independent and matches `pages/manifest.json`:
// sha256 over sorted `<path> <sha256(content)>\n` lines.
export function computePagesSha256(
  pages: ReadonlyArray<{ content: string; path: string }>,
): string {
  const lines = pages
    .map(({ content, path }) =>
      `${path} ${createHash("sha256").update(content).digest("hex")}`
    )
    .sort()
    .map((line) => `${line}\n`)
    .join("");
  return createHash("sha256").update(lines).digest("hex");
}

function isIndented(line: string): boolean {
  return line.length > 0 && (line.startsWith(" ") || line.startsWith("\t"));
}

function parseFrontmatter(
  lines: readonly string[],
): { ok: true; frontmatter: PageFrontmatter } | { ok: false } {
  const frontmatter: PageFrontmatter = {};
  let index = 0;
  while (index < lines.length) {
    const line = lines[index]!;
    index += 1;
    if (line.trim().length === 0) {
      continue;
    }
    if (isIndented(line)) {
      return { ok: false };
    }
    const match = /^([A-Za-z_][A-Za-z0-9_-]*):(.*)$/.exec(line);
    if (!match) {
      return { ok: false };
    }
    const key = match[1]!;
    const rawValue = match[2] ?? "";
    if (key === "goodmemory" && rawValue.trim().length === 0) {
      const block: Record<string, string> = {};
      while (index < lines.length && isIndented(lines[index]!) && lines[index]!.trim().length > 0) {
        const nested = /^\s+([A-Za-z_][A-Za-z0-9_-]*):(.*)$/.exec(lines[index]!);
        if (!nested) {
          return { ok: false };
        }
        block[nested[1]!] = unquote(nested[2] ?? "");
        index += 1;
      }
      frontmatter.goodmemory = block;
      continue;
    }
    if (rawValue.trim().length === 0) {
      // A key without a scalar value introduces nesting we do not support.
      if (index < lines.length && isIndented(lines[index]!)) {
        return { ok: false };
      }
      continue;
    }
    if (key === "tags") {
      const tags = parseInlineList(rawValue);
      if (tags === undefined) {
        return { ok: false };
      }
      frontmatter.tags = tags;
      continue;
    }
    if (SCALAR_KEYS.has(key)) {
      (frontmatter as Record<string, unknown>)[key] = unquote(rawValue);
    }
  }
  return { ok: true, frontmatter };
}

function titleFromBody(body: string): string | undefined {
  for (const line of body.split("\n")) {
    const heading = /^#{1,6}\s+(\S.*)$/.exec(line.trim());
    if (heading) {
      return heading[1]!.trim();
    }
  }
  return undefined;
}

function titleFromPath(path: string): string {
  const stem = path.split("/").at(-1)!.replace(/\.md$/u, "");
  return stem.replace(/[-_]+/g, " ").trim();
}

export function parsePageFile(input: { content: string; path: string }): ParsePageResult {
  if (!input.path.endsWith(".md")) {
    return { ok: false, path: input.path, reason: "not_a_page" };
  }
  const normalized = input.content.split("\r\n").join("\n");
  let frontmatter: PageFrontmatter = {};
  let body = normalized;
  if (normalized.startsWith(FRONTMATTER_OPEN)) {
    const closing = normalized.indexOf(FRONTMATTER_CLOSE, FRONTMATTER_OPEN.length);
    const closingAtEnd = closing === -1 && normalized.endsWith("\n---");
    const end = closing !== -1
      ? closing
      : closingAtEnd
        ? normalized.length - "\n---".length
        : -1;
    if (end === -1) {
      return { ok: false, path: input.path, reason: "unsupported_frontmatter" };
    }
    const parsed = parseFrontmatter(
      normalized.slice(FRONTMATTER_OPEN.length, end).split("\n"),
    );
    if (!parsed.ok) {
      return { ok: false, path: input.path, reason: "unsupported_frontmatter" };
    }
    frontmatter = parsed.frontmatter;
    body = closing !== -1 ? normalized.slice(closing + FRONTMATTER_CLOSE.length) : "";
    body = body.replace(/^\n+/, "");
  }
  if (body.trim().length === 0) {
    return { ok: false, path: input.path, reason: "empty_body" };
  }
  const title =
    frontmatter.title?.trim() || titleFromBody(body) || titleFromPath(input.path);
  return { ok: true, page: { body, frontmatter, path: input.path, title } };
}

export function normalizePageTitle(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, " ");
}

// Stable, scope-salted note identity for an imported page: the uuid when the
// page carries one, otherwise its normalized title. Mirrors the projection id
// scheme (sha256 prefix) so re-importing the same field is idempotent without
// leaking the scope key into the id.
export function derivePageNoteId(
  scope: MemoryScope,
  identity: { title?: string; uuid?: string },
): string {
  const key = identity.uuid?.trim()
    ? `uuid:${identity.uuid.trim()}`
    : `title:${normalizePageTitle(identity.title ?? "")}`;
  return `note_${createHash("sha256")
    .update(scopeToKey(scope))
    .update(" ")
    .update(key)
    .digest("hex")
    .slice(0, 24)}`;
}

export interface PageChunk {
  body: string;
  title: string;
}

const CITATION_DEFINITION = /^\[([^\]]+)\]:\s+\S/;
const utf8 = new TextEncoder();
const byteLength = (value: string): number => utf8.encode(value).byteLength;

// Cuts a single whitespace-free run at code point boundaries so no piece
// exceeds the cap and no character is split across pieces.
function sliceByBytes(text: string, maxBytes: number): string[] {
  const pieces: string[] = [];
  let current = "";
  let currentBytes = 0;
  for (const char of text) {
    const charBytes = byteLength(char);
    if (currentBytes + charBytes > maxBytes && current.length > 0) {
      pieces.push(current);
      current = char;
      currentBytes = charBytes;
    } else {
      current += char;
      currentBytes += charBytes;
    }
  }
  if (current.length > 0) {
    pieces.push(current);
  }
  return pieces;
}

function hardSplit(text: string, maxBytes: number): string[] {
  const pieces: string[] = [];
  let current = "";
  const flush = (): void => {
    if (current.trim().length > 0) {
      pieces.push(current);
    }
    current = "";
  };
  for (const word of text.split(/(\s+)/)) {
    if (byteLength(word) > maxBytes) {
      flush();
      const slices = sliceByBytes(word, maxBytes);
      current = slices.pop() ?? "";
      pieces.push(...slices);
      continue;
    }
    if (byteLength(current + word) > maxBytes && current.length > 0) {
      pieces.push(current);
      current = word.trimStart();
    } else {
      current += word;
    }
  }
  flush();
  return pieces;
}

function splitIntoBlocks(body: string, maxBytes: number): string[] {
  const sections: string[] = [];
  let current: string[] = [];
  for (const line of body.split("\n")) {
    if (/^#{1,6}\s/.test(line) && current.length > 0) {
      sections.push(current.join("\n"));
      current = [];
    }
    current.push(line);
  }
  if (current.length > 0) {
    sections.push(current.join("\n"));
  }
  return sections.flatMap((section) => {
    if (byteLength(section) <= maxBytes) {
      return [section];
    }
    return section.split(/\n\n+/).flatMap((paragraph) =>
      byteLength(paragraph) <= maxBytes ? [paragraph] : hardSplit(paragraph, maxBytes)
    );
  });
}

function citationsFor(text: string, definitions: Map<string, string>): string[] {
  const lines: string[] = [];
  for (const [label, definition] of definitions) {
    if (text.includes(`[${label}]`)) {
      lines.push(definition);
    }
  }
  return lines;
}

// Splits a page whose body exceeds the note cap into ordered chunks: first at
// heading boundaries, then paragraphs, then whitespace. Every chunk gets a
// numbered title and the citation definitions it references, so no chunk
// loses its sources (spec: producers SHOULD preserve sources when splitting).
export function splitPage(page: PageChunk, maxBytes: number): PageChunk[] {
  if (byteLength(page.body) <= maxBytes) {
    return [{ body: page.body, title: page.title }];
  }
  const definitions = new Map<string, string>();
  const contentLines = page.body.split("\n").filter((line) => {
    const match = CITATION_DEFINITION.exec(line);
    if (match) {
      definitions.set(match[1]!, line);
      return false;
    }
    return true;
  });
  // Chunks re-append the citation definitions they reference, so that room
  // is kept out of the block budget: a single block plus its citations still
  // fits. A citation list wider than half the cap falls back to the full
  // budget; the importer's per-chunk check then rejects what cannot fit.
  const citationBytes = [...definitions.values()].reduce(
    (total, line) => total + byteLength(line) + 1,
    0,
  );
  const reserve = citationBytes > 0 && citationBytes + 2 < maxBytes / 2 ? citationBytes + 2 : 0;
  const blocks = splitIntoBlocks(contentLines.join("\n").trim(), maxBytes - reserve);
  const chunks: string[] = [];
  let current: string[] = [];
  const render = (parts: string[]): string => {
    const text = parts.join("\n\n").trim();
    const citations = citationsFor(text, definitions);
    return citations.length > 0 ? `${text}\n\n${citations.join("\n")}` : text;
  };
  for (const block of blocks) {
    const candidate = [...current, block];
    if (current.length > 0 && byteLength(render(candidate)) > maxBytes) {
      chunks.push(render(current));
      current = [block];
    } else {
      current = candidate;
    }
  }
  if (current.length > 0) {
    chunks.push(render(current));
  }
  return chunks.map((body, index) => ({
    body,
    title: `${page.title} (${index + 1}/${chunks.length})`,
  }));
}
