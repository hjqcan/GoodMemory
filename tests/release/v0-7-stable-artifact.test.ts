import { createHash, randomBytes } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { describe, expect, it } from "bun:test";

import { prepareV07StableArtifact } from "../../scripts/prepare-v0-7-stable-artifact";

const README_STABLE = `# GoodMemory

> **Release source:** this is the immutable \`0.7.0\` stable release source.
> Registry commands require \`goodmemory@0.7.0\` to be published. The release
> workflow verifies npm \`latest\` and artifact integrity before creating the
> GitHub Release.
`;

const README_ZH_STABLE = `# GoodMemory

> **发布源码：**这是不可变的 \`0.7.0\` 稳定发布源码。Registry 命令要求
> \`goodmemory@0.7.0\` 已发布；release workflow 会先校验 npm \`latest\`
> 与制品完整性，再创建 GitHub Release。
`;

const LLMS_STABLE = `# GoodMemory

Release source: this is the immutable GoodMemory 0.7.0 stable release source.
Registry commands require goodmemory@0.7.0 to be published. The release workflow
verifies npm latest and artifact integrity before creating the GitHub Release.
`;

const REQUIRED_ARTIFACT_FIXTURE_FILES = [
  "dist/index.js",
  "dist/index.d.ts",
  "dist/ai-sdk/index.js",
  "dist/ai-sdk/index.d.ts",
  "dist/host/index.js",
  "dist/host/index.d.ts",
  "dist/http/index.js",
  "dist/http/index.d.ts",
  "dist/runtime-kit/index.js",
  "dist/runtime-kit/index.d.ts",
  "docs/GoodMemory-0.6-to-0.7-Migration-Guide.md",
] as const;

async function extractTarball(tarballPath: string, outputDir: string): Promise<void> {
  await mkdir(outputDir, { recursive: true });
  const process = Bun.spawn({
    cmd: ["tar", "-xzf", tarballPath, "-C", outputDir],
    stderr: "pipe",
    stdout: "pipe",
  });
  const stderr = await new Response(process.stderr).text();
  if ((await process.exited) !== 0) {
    throw new Error(stderr);
  }
}

async function runCommand(cmd: string[], cwd: string): Promise<string> {
  const process = Bun.spawn({
    cmd,
    cwd,
    stderr: "pipe",
    stdout: "pipe",
  });
  const [exitCode, stderr, stdout] = await Promise.all([
    process.exited,
    new Response(process.stderr).text(),
    new Response(process.stdout).text(),
  ]);
  if (exitCode !== 0) {
    throw new Error(stderr);
  }
  return stdout.trim();
}

async function initializeStableSource(input: {
  omitFile?: string;
  oversized?: boolean;
  root: string;
}): Promise<{
  sourceCommit: string;
  sourceTree: string;
}> {
  await mkdir(join(input.root, ".well-known"), { recursive: true });
  await writeFile(
    join(input.root, "package.json"),
    `${JSON.stringify({
      files: [
        ".well-known/goodmemory.json",
        "README.md",
        "README.zh-CN.md",
        "dist",
        "docs",
        "llms.txt",
        ...(input.oversized ? ["oversized.bin"] : []),
      ],
      goodmemoryRelease: {
        installCommandsApplyAfterPublish: true,
        npmDistTag: "latest",
        status: "stable",
      },
      name: "goodmemory",
      version: "0.7.0",
    }, null, 2)}\n`,
  );
  await writeFile(join(input.root, "README.md"), README_STABLE);
  await writeFile(join(input.root, "README.zh-CN.md"), README_ZH_STABLE);
  await writeFile(join(input.root, "llms.txt"), LLMS_STABLE);
  await writeFile(join(input.root, ".gitignore"), "extracted/\noutput/\n");
  await writeFile(
    join(input.root, ".well-known/goodmemory.json"),
    `${JSON.stringify({
      name: "goodmemory",
      releaseStatus: {
        installCommandsApplyAfterPublish: true,
        npmDistTag: "latest",
        status: "stable",
        tarball: "goodmemory-0.7.0.tgz",
      },
      version: "0.7.0",
    }, null, 2)}\n`,
  );
  for (const relativePath of REQUIRED_ARTIFACT_FIXTURE_FILES) {
    if (relativePath === input.omitFile) {
      continue;
    }
    const absolutePath = join(input.root, relativePath);
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, `fixture for ${relativePath}\n`);
  }
  if (input.oversized) {
    await writeFile(
      join(input.root, "oversized.bin"),
      randomBytes(4 * 1024 * 1024 + 64 * 1024),
    );
  }
  await runCommand(["git", "init", "--quiet"], input.root);
  await runCommand(
    ["git", "config", "user.email", "release-test@example.com"],
    input.root,
  );
  await runCommand(["git", "config", "user.name", "Release Test"], input.root);
  await runCommand(["git", "add", "."], input.root);
  await runCommand(
    ["git", "commit", "--quiet", "-m", "stable release source"],
    input.root,
  );
  return {
    sourceCommit: await runCommand(["git", "rev-parse", "HEAD"], input.root),
    sourceTree: await runCommand(["git", "rev-parse", "HEAD^{tree}"], input.root),
  };
}

describe("v0.7 stable release artifact", () => {
  it("packs the verified stable source without projecting different metadata", async () => {
    const root = await mkdtemp(join(tmpdir(), "goodmemory-stable-artifact-test-"));
    const outputDir = join(root, "output");
    try {
      const { sourceCommit, sourceTree } = await initializeStableSource({ root });

      const sourceBefore = await Promise.all(
        ["README.md", "README.zh-CN.md", "llms.txt", ".well-known/goodmemory.json"]
          .map((path) => readFile(join(root, path), "utf8")),
      );
      const artifact = await prepareV07StableArtifact({
        outputDir,
        repoRoot: root,
        sourceCommit,
        verifyInstalledConsumers: false,
        verifyRuntimeDescriptor: false,
      });
      const extracted = join(root, "extracted");
      await extractTarball(artifact.artifactPath, extracted);
      const packageRoot = join(extracted, "package");

      const readme = await readFile(join(packageRoot, "README.md"), "utf8");
      const readmeZh = await readFile(join(packageRoot, "README.zh-CN.md"), "utf8");
      const llms = await readFile(join(packageRoot, "llms.txt"), "utf8");
      const descriptor = JSON.parse(
        await readFile(join(packageRoot, ".well-known/goodmemory.json"), "utf8"),
      ) as { releaseStatus?: Record<string, unknown> };
      const packageJson = JSON.parse(
        await readFile(join(packageRoot, "package.json"), "utf8"),
      ) as { goodmemoryRelease?: Record<string, unknown> };

      expect(readme).toContain("immutable `0.7.0` stable release source");
      expect(readmeZh).toContain("不可变的 `0.7.0` 稳定发布源码");
      expect(llms).toContain("immutable GoodMemory 0.7.0 stable release source");
      expect(descriptor.releaseStatus).toEqual({
        installCommandsApplyAfterPublish: true,
        npmDistTag: "latest",
        status: "stable",
        tarball: "goodmemory-0.7.0.tgz",
      });
      expect(packageJson.goodmemoryRelease).toEqual({
        installCommandsApplyAfterPublish: true,
        npmDistTag: "latest",
        status: "stable",
      });
      expect(artifact.artifactName).toBe("goodmemory-0.7.0.tgz");
      expect(artifact.packedFileCount).toBeGreaterThan(0);
      expect(artifact.sourceCommit).toBe(sourceCommit);
      expect(artifact.sourceTree).toBe(sourceTree);
      expect(artifact.tarballBytes).toBeLessThan(4 * 1024 * 1024);
      expect(artifact.integrity).toBe(
        `sha512-${createHash("sha512")
          .update(await readFile(artifact.artifactPath))
          .digest("base64")}`,
      );

      await expect(prepareV07StableArtifact({
        outputDir,
        repoRoot: root,
        sourceCommit: "a".repeat(40),
        verifyInstalledConsumers: false,
        verifyRuntimeDescriptor: false,
      })).rejects.toThrow("does not match clean HEAD");

      const sourceAfter = await Promise.all(
        ["README.md", "README.zh-CN.md", "llms.txt", ".well-known/goodmemory.json"]
          .map((path) => readFile(join(root, path), "utf8")),
      );
      expect(sourceAfter).toEqual(sourceBefore);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("rejects the exact final tarball when a required file is missing", async () => {
    const root = await mkdtemp(join(tmpdir(), "goodmemory-stable-artifact-missing-"));
    try {
      const { sourceCommit } = await initializeStableSource({
        omitFile: "dist/host/index.js",
        root,
      });

      await expect(prepareV07StableArtifact({
        outputDir: join(root, "output"),
        repoRoot: root,
        sourceCommit,
        verifyInstalledConsumers: false,
        verifyRuntimeDescriptor: false,
      })).rejects.toThrow("tarball missing: dist/host/index.js");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("rejects the exact final tarball when it reaches 4 MiB", async () => {
    const root = await mkdtemp(join(tmpdir(), "goodmemory-stable-artifact-size-"));
    try {
      const { sourceCommit } = await initializeStableSource({
        oversized: true,
        root,
      });

      await expect(prepareV07StableArtifact({
        outputDir: join(root, "output"),
        repoRoot: root,
        sourceCommit,
        verifyInstalledConsumers: false,
        verifyRuntimeDescriptor: false,
      })).rejects.toThrow("must be below 4194304 bytes");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});
