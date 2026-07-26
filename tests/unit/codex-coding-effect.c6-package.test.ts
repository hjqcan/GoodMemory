import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  inspectC6PackageTarball,
} from "../../scripts/codex-coding-effect/c6-package";

describe("Codex coding-effect C6 package identity", () => {
  it("accepts a structurally valid gzip archive with the declared GoodMemory entry closure", async () => {
    const fixture = await packageFixture();
    try {
      const result = await inspectC6PackageTarball({
        expectedSha256: fixture.sha256,
        expectedVersion: "0.7.0",
        path: fixture.tarballPath,
      });

      expect(result).toMatchObject({
        name: "goodmemory",
        sha256: fixture.sha256,
        version: "0.7.0",
      });
      expect(result.filesManifestSha256).toMatch(/^[a-f0-9]{64}$/u);
    } finally {
      await rm(fixture.root, { force: true, recursive: true });
    }
  });

  it("rejects a hash-matching blob, wrong package identity, and missing runtime entry", async () => {
    const root = await mkdtemp(join(tmpdir(), "goodmemory-c6-package-bad-"));
    try {
      const blob = join(root, "goodmemory.tgz");
      await writeFile(blob, "not a tarball\n");
      await expect(inspectC6PackageTarball({
        expectedSha256: sha256("not a tarball\n"),
        expectedVersion: "0.7.0",
        path: blob,
      })).rejects.toThrow("valid gzip tarball");

      const wrongName = await packageFixture({ name: "not-goodmemory" });
      try {
        await expect(inspectC6PackageTarball({
          expectedSha256: wrongName.sha256,
          expectedVersion: "0.7.0",
          path: wrongName.tarballPath,
        })).rejects.toThrow("package name");
      } finally {
        await rm(wrongName.root, { force: true, recursive: true });
      }

      const incomplete = await packageFixture({
        omittedPath: "dist/bin/goodmemory-mcp.js",
      });
      try {
        await expect(inspectC6PackageTarball({
          expectedSha256: incomplete.sha256,
          expectedVersion: "0.7.0",
          path: incomplete.tarballPath,
        })).rejects.toThrow("missing required entry");
      } finally {
        await rm(incomplete.root, { force: true, recursive: true });
      }
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});

async function packageFixture(input: {
  name?: string;
  omittedPath?: string;
} = {}): Promise<{
  root: string;
  sha256: string;
  tarballPath: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "goodmemory-c6-package-"));
  const packageRoot = join(root, "package");
  const files = [
    "scripts/goodmemory-cli.js",
    "scripts/goodmemory-mcp.js",
    "dist/bin/goodmemory-cli.js",
    "dist/bin/goodmemory-mcp.js",
    "dist/host/index.js",
  ].filter((path) => path !== input.omittedPath);
  for (const path of files) {
    await mkdir(join(packageRoot, path, ".."), { recursive: true });
    await writeFile(join(packageRoot, path), `// ${path}\n`);
  }
  await writeFile(join(packageRoot, "package.json"), `${JSON.stringify({
    name: input.name ?? "goodmemory",
    version: "0.7.0",
  }, null, 2)}\n`);
  const tarballPath = join(root, "goodmemory-0.7.0.tgz");
  const child = Bun.spawn({
    cmd: ["tar", "-czf", tarballPath, "-C", root, "package"],
    stderr: "pipe",
    stdout: "pipe",
  });
  const [exitCode, stderr] = await Promise.all([
    child.exited,
    new Response(child.stderr).text(),
  ]);
  if (exitCode !== 0) {
    throw new Error(`test tar failed: ${stderr}`);
  }
  const bytes = await Bun.file(tarballPath).arrayBuffer();
  return {
    root,
    sha256: createHash("sha256").update(new Uint8Array(bytes)).digest("hex"),
    tarballPath,
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
