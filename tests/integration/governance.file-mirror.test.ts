import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { createGoodMemory } from "../../src";
import { createInternalGoodMemory } from "../../src/api/createGoodMemory";
import type { FileMirror } from "../../src/governance/fileMirror";
import type { GoodMemoryTraceSpan } from "../../src/observability/contracts";

const SCRATCH =
  "/private/tmp/claude-501/-Users-hjqcan-workspace-GoodMemory/cd707382-ae3b-4889-98c1-ba694a90813c/scratchpad";
const scope = { userId: "mirror-user", workspaceId: "workspace-a" };
const cleanups: string[] = [];

afterEach(async () => {
  for (const path of cleanups.splice(0)) {
    await rm(path, { force: true, recursive: true });
  }
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(SCRATCH, "file-mirror-"));
  cleanups.push(dir);
  return dir;
}

async function listFiles(root: string, base = root): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(path, base)));
    } else {
      files.push(relative(base, path));
    }
  }
  return files.sort();
}

function mirrored(root: string, traces?: GoodMemoryTraceSpan[]) {
  const handle: { mirror?: FileMirror } = {};
  const memory = createInternalGoodMemory(
    {
      governance: { fileMirror: { debounceMs: 5, root, scope } },
      ...(traces
        ? { observability: { traceSink: { emit: (event: GoodMemoryTraceSpan) => { traces.push(event); } } } }
        : {}),
      storage: { provider: "memory" },
    },
    { fileMirrorHandle: (mirror) => { handle.mirror = mirror; } },
  );
  return { flush: () => handle.mirror!.flush(), memory };
}

describe("governance file mirror", () => {
  it("mirrors the export bundle byte-for-byte after each durable mutation", async () => {
    const dir = await tempDir();
    const root = join(dir, ".goodmemory", "memory");
    const { flush, memory } = mirrored(root);

    const remembered = await memory.remember({
      messages: [{ content: "Remember that my editor is Neovim.", role: "user" }],
      scope: { ...scope, sessionId: "session-1" },
    });
    expect(remembered.events.length).toBeGreaterThan(0);
    await flush();

    const exported = await memory.exportMemory({ scope });
    const expected = [...exported.artifacts.files, ...exported.pages.files];
    expect(await listFiles(root)).toEqual(expected.map((file) => file.relativePath).sort());
    for (const file of expected) {
      expect(await readFile(join(root, file.relativePath), "utf8")).toBe(file.content);
    }
    expect(await readFile(join(root, "MEMORY.md"), "utf8")).toContain("Neovim");
    expect(await stat(`${root}.tmp-`).catch(() => null)).toBeNull();
    expect((await readdir(join(dir, ".goodmemory"))).sort()).toEqual(["memory"]);

    const factId = remembered.events.find((event) => event.memoryType === "fact")?.memoryId;
    expect(factId).toBeString();
    await memory.forget({ memoryId: factId!, scope });
    await flush();
    expect(await readFile(join(root, "MEMORY.md"), "utf8")).not.toContain("Neovim");
    expect((await readdir(join(dir, ".goodmemory"))).sort()).toEqual(["memory"]);
  });

  it("serves one durable scope: foreign scopes never touch the root, any agent inside it does", async () => {
    const dir = await tempDir();
    const root = join(dir, ".goodmemory", "memory");
    const { flush, memory } = mirrored(root);

    await memory.remember({
      messages: [{ content: "Remember that my editor is Emacs.", role: "user" }],
      scope: { userId: "someone-else", workspaceId: "workspace-a" },
    });
    await memory.remember({
      messages: [{ content: "Remember that my editor is Emacs.", role: "user" }],
      scope: { ...scope, workspaceId: "workspace-b" },
    });
    await flush();
    expect(await readdir(dir)).toEqual([]);

    await memory.remember({
      messages: [{ content: "Remember that my editor is Neovim.", role: "user" }],
      scope: { ...scope, agentId: "codex", sessionId: "session-7" },
    });
    await flush();
    const mirroredIndex = await readFile(join(root, "MEMORY.md"), "utf8");
    expect(mirroredIndex).toContain("Neovim");
    expect(mirroredIndex).not.toContain("Emacs");
    expect(mirroredIndex).toBe(
      (await memory.exportMemory({ scope })).artifacts.files.find((file) => file.relativePath === "MEMORY.md")!.content,
    );
  });

  it("is off by default and never fails the mutation when the mirror cannot write", async () => {
    const dir = await tempDir();
    const plain = createGoodMemory({ storage: { provider: "memory" } });
    await plain.remember({
      messages: [{ content: "Remember that my editor is Neovim.", role: "user" }],
      scope,
    });
    expect(await readdir(dir)).toEqual([]);

    const blocker = join(dir, "blocker");
    await writeFile(blocker, "not a directory", "utf8");
    const traces: GoodMemoryTraceSpan[] = [];
    const { flush, memory } = mirrored(join(blocker, "memory"), traces);
    const remembered = await memory.remember({
      messages: [{ content: "Remember that my editor is Neovim.", role: "user" }],
      scope,
    });
    expect(remembered.events.length).toBeGreaterThan(0);
    await expect(flush()).resolves.toBeUndefined();
    const failed = traces.filter(
      (event) => event.name === "governance.file_mirror" && event.status === "failed",
    );
    expect(failed.length).toBeGreaterThan(0);
    expect(await readFile(blocker, "utf8")).toBe("not a directory");
  });
});
