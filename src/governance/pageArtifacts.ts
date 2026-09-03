import { createHash } from "node:crypto";

import type { NoteMemory } from "../domain/records";
import { computePagesSha256, renderYamlScalar } from "../interchange/pages";

// Memoryfield-compatible page export (ADR-010 §9): one Markdown page per
// active note, a human listing, and a manifest whose `pagesSha256` is exactly
// the `inputSha256` an importer computes over the same files. The bundle is
// a sibling of the host artifact bundle, not part of it, so host artifact
// negotiation and the exact host file-list pins are untouched.

export interface PageArtifactFile {
  bytes: number;
  content: string;
  kind: "listing" | "manifest" | "page";
  noteId?: string;
  relativePath: string;
  sha256: string;
}

export interface PageArtifactManifestEntry {
  bytes: number;
  noteId: string;
  path: string;
  sha256: string;
  title: string;
}

export interface PageArtifactManifest {
  files: PageArtifactManifestEntry[];
  format: "goodmemory.pages/v1";
  pageCount: number;
  pagesSha256: string;
}

export interface PageArtifactBundle {
  files: PageArtifactFile[];
  manifest: PageArtifactManifest;
  rootPath: "pages";
}

export const PAGE_ARTIFACTS_ROOT = "pages";
const SLUG_MAX_CHARS = 48;
const ID_STEM_CHARS = 8;
const BARE_INLINE_TOKEN = /^[A-Za-z0-9_.:/-]+$/;

const sha256 = (value: string): string =>
  createHash("sha256").update(value).digest("hex");
const byteLength = (value: string): number => Buffer.byteLength(value, "utf8");

function slugify(title: string): string {
  const slug = title
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX_CHARS)
    .replace(/-+$/, "");
  return slug.length > 0 ? slug : "note";
}

function idStem(id: string): string {
  const raw = id.startsWith("note_") ? id.slice("note_".length) : id;
  const cleaned = raw.replace(/[^A-Za-z0-9-]/g, "").slice(0, ID_STEM_CHARS);
  return cleaned.length > 0 ? cleaned : "page";
}

function renderInlineList(values: readonly string[]): string {
  return `[${values
    .map((value) => value.replace(/\s+/g, " ").trim())
    .filter((value) => value.length > 0)
    .map((value) => (BARE_INLINE_TOKEN.test(value) ? value : renderYamlScalar(value)))
    .join(", ")}]`;
}

function summaryOf(note: NoteMemory): string | undefined {
  const summary = note.attributes?.summary;
  return typeof summary === "string" && summary.trim().length > 0 ? summary : undefined;
}

function pageUpdatedAt(note: NoteMemory): string {
  return note.observedAt ?? note.updatedAt;
}

function renderPage(note: NoteMemory): string {
  const summary = summaryOf(note);
  const tags = (note.tags ?? []).filter((tag) => tag.trim().length > 0);
  const lines = [
    "---",
    `title: ${renderYamlScalar(note.title)}`,
    `uuid: ${note.id}`,
    `created: ${renderYamlScalar(note.createdAt)}`,
    `updated: ${renderYamlScalar(pageUpdatedAt(note))}`,
    ...(summary ? [`summary: ${renderYamlScalar(summary)}`] : []),
    ...(tags.length > 0 ? [`tags: ${renderInlineList(tags)}`] : []),
    "goodmemory:",
    "  kind: note",
    `  format: ${note.format}`,
    `  source: ${note.source.method}`,
    ...(note.subject ? [`  subject: ${renderYamlScalar(note.subject)}`] : []),
    ...(note.observedAt ? [`  observedAt: ${renderYamlScalar(note.observedAt)}`] : []),
    `  createdAt: ${renderYamlScalar(note.createdAt)}`,
    `  updatedAt: ${renderYamlScalar(note.updatedAt)}`,
    "---",
    "",
  ];
  const body = note.body.endsWith("\n") ? note.body : `${note.body}\n`;
  return `${lines.join("\n")}\n${body}`;
}

function listingLabel(title: string): string {
  return title.replace(/\s+/g, " ").replace(/[[\]]/g, "").trim();
}

function renderListing(entries: ReadonlyArray<{ note: NoteMemory; path: string }>): string {
  if (entries.length === 0) {
    return "# Pages\n\n(no pages)\n";
  }
  const lines = entries.map(({ note, path }) => {
    const summary = summaryOf(note);
    const updated = pageUpdatedAt(note).slice(0, 10);
    return `- [${listingLabel(note.title)}](${path}) (updated ${updated})${
      summary ? `: ${summary.replace(/\s+/g, " ").trim()}` : ""
    }`;
  });
  return `# Pages\n\n${lines.join("\n")}\n`;
}

function compareNotes(left: NoteMemory, right: NoteMemory): number {
  if (left.title !== right.title) {
    return left.title < right.title ? -1 : 1;
  }
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

function toFile(
  relativePath: string,
  content: string,
  kind: PageArtifactFile["kind"],
  noteId?: string,
): PageArtifactFile {
  return {
    bytes: byteLength(content),
    content,
    kind,
    ...(noteId ? { noteId } : {}),
    relativePath,
    sha256: sha256(content),
  };
}

export function buildPageArtifacts(input: {
  notes: readonly NoteMemory[];
}): PageArtifactBundle {
  const active = input.notes
    .filter((note) => note.lifecycle === "active")
    .sort(compareNotes);
  const usedNames = new Set<string>();
  const entries = active.map((note) => {
    const base = `${slugify(note.title)}-${idStem(note.id)}`;
    let name = `${base}.md`;
    for (let ordinal = 2; usedNames.has(name); ordinal += 1) {
      name = `${base}-${ordinal}.md`;
    }
    usedNames.add(name);
    return { content: renderPage(note), note, path: name };
  });

  const pageFiles = entries.map(({ content, note, path }) =>
    toFile(`${PAGE_ARTIFACTS_ROOT}/${path}`, content, "page", note.id)
  );
  const manifest: PageArtifactManifest = {
    format: "goodmemory.pages/v1",
    pageCount: entries.length,
    pagesSha256: computePagesSha256(entries.map(({ content, path }) => ({ content, path }))),
    files: entries.map(({ content, note, path }) => ({
      bytes: byteLength(content),
      noteId: note.id,
      path,
      sha256: sha256(content),
      title: note.title,
    })),
  };
  const listing = toFile(
    `${PAGE_ARTIFACTS_ROOT}/listing.md`,
    renderListing(entries.map(({ note, path }) => ({ note, path }))),
    "listing",
  );
  const manifestFile = toFile(
    `${PAGE_ARTIFACTS_ROOT}/manifest.json`,
    `${JSON.stringify(manifest, null, 2)}\n`,
    "manifest",
  );

  return {
    files: [...pageFiles, listing, manifestFile],
    manifest,
    rootPath: PAGE_ARTIFACTS_ROOT,
  };
}
