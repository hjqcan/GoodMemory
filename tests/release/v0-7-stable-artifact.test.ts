import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

describe("v0.7 stable release artifact", () => {
  it("packs the verified stable source without projecting different metadata", async () => {
    const root = await mkdtemp(join(tmpdir(), "goodmemory-stable-artifact-test-"));
    const outputDir = join(root, "output");
    try {
      await mkdir(join(root, ".well-known"), { recursive: true });
      await writeFile(
        join(root, "package.json"),
        `${JSON.stringify({
          files: [
            ".well-known/goodmemory.json",
            "README.md",
            "README.zh-CN.md",
            "llms.txt",
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
      await writeFile(join(root, "README.md"), README_STABLE);
      await writeFile(join(root, "README.zh-CN.md"), README_ZH_STABLE);
      await writeFile(join(root, "llms.txt"), LLMS_STABLE);
      await writeFile(join(root, ".gitignore"), "extracted/\noutput/\n");
      await writeFile(
        join(root, ".well-known/goodmemory.json"),
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
      await runCommand(["git", "init", "--quiet"], root);
      await runCommand(["git", "config", "user.email", "release-test@example.com"], root);
      await runCommand(["git", "config", "user.name", "Release Test"], root);
      await runCommand(["git", "add", "."], root);
      await runCommand(["git", "commit", "--quiet", "-m", "stable release source"], root);
      const sourceCommit = await runCommand(["git", "rev-parse", "HEAD"], root);
      const sourceTree = await runCommand(["git", "rev-parse", "HEAD^{tree}"], root);

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
      expect(artifact.sourceCommit).toBe(sourceCommit);
      expect(artifact.sourceTree).toBe(sourceTree);
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
});
