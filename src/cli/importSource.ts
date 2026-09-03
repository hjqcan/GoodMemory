import { readdir, readFile, stat } from "node:fs/promises";
import { basename, extname, join } from "node:path";

import type { ExportMemoryResult, ImportMemorySource } from "../api/contracts";

// Resolves `goodmemory import-memory --input <path>` into an import source:
// a pages directory (flat `*.md`, or a `pages/` child as written by
// export-memory), a single `.md` page, or a `memory-export.json` snapshot
// whose durable half is imported by id.

export interface LoadedImportSource {
  fileCount: number;
  manifestSha256?: string;
  source: ImportMemorySource;
}

const SKIPPED_PAGE_FILES = new Set(["listing.md", "manifest.json"]);

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function readManifestSha256(dir: string): Promise<string | undefined> {
  try {
    const manifest = JSON.parse(await readFile(join(dir, "manifest.json"), "utf8")) as {
      pagesSha256?: unknown;
    };
    return typeof manifest.pagesSha256 === "string" ? manifest.pagesSha256 : undefined;
  } catch {
    return undefined;
  }
}

async function loadPagesDirectory(root: string): Promise<LoadedImportSource> {
  const nested = join(root, "pages");
  const dir = (await isDirectory(nested)) ? nested : root;
  const names = (await readdir(dir))
    .filter((name) => name.endsWith(".md") && !SKIPPED_PAGE_FILES.has(name))
    .sort();
  if (names.length === 0) {
    throw new Error(`No pages found under ${dir} (expected *.md files).`);
  }
  const pages = await Promise.all(
    names.map(async (name) => ({
      content: await readFile(join(dir, name), "utf8"),
      path: name,
    })),
  );
  const manifestSha256 = await readManifestSha256(dir);
  return {
    fileCount: pages.length,
    ...(manifestSha256 ? { manifestSha256 } : {}),
    source: { kind: "pages", pages },
  };
}

export async function loadImportSource(inputPath: string): Promise<LoadedImportSource> {
  if (await isDirectory(inputPath)) {
    return loadPagesDirectory(inputPath);
  }
  const content = await readFile(inputPath, "utf8");
  const extension = extname(inputPath);
  if (extension === ".json") {
    const parsed = JSON.parse(content) as Partial<ExportMemoryResult>;
    if (!parsed.durable || typeof parsed.durable !== "object") {
      throw new Error(
        `Unsupported import file: ${inputPath} (expected a memory-export.json with a durable section).`,
      );
    }
    return { fileCount: 1, source: { durable: parsed.durable, kind: "durable" } };
  }
  if (extension === ".md") {
    return {
      fileCount: 1,
      source: { kind: "pages", pages: [{ content, path: basename(inputPath) }] },
    };
  }
  throw new Error(
    `Unsupported import input: ${inputPath} (expected a pages directory, a .md page, or memory-export.json).`,
  );
}
