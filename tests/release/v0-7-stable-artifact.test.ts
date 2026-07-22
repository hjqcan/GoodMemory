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

const README_RC = `# GoodMemory

> **Release status:** this branch is the \`0.7.0\` release candidate. npm
> \`latest\` remains \`0.6.0\` until the tagged stable workflow publishes 0.7.0.
> The version-pinned registry commands below are the post-publish contract; use
> the locally packed \`goodmemory-0.7.0.tgz\` for pre-publish verification.
`;

const README_ZH_RC = `# GoodMemory

> **发布状态：**当前分支是 \`0.7.0\` release candidate；在带 tag 的稳定发布
> workflow 真正发布 0.7.0 之前，npm \`latest\` 仍是 \`0.6.0\`。下文锁定
> 0.7.0 的 registry 命令是发布后的契约；发布前请使用本地打包的
> \`goodmemory-0.7.0.tgz\` 验证。
`;

const LLMS_RC = `# GoodMemory

Release status: this source tree targets the 0.7.0 release candidate. npm
latest remains 0.6.0 until the tagged stable workflow publishes 0.7.0. The
version-pinned registry commands below apply after publication; pre-publish
verification uses goodmemory-0.7.0.tgz.
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

describe("v0.7 stable release artifact", () => {
  it("projects RC metadata only inside a verified stable tarball", async () => {
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
            npmLatest: "0.6.0",
            status: "release-candidate",
          },
          name: "goodmemory",
          version: "0.7.0",
        }, null, 2)}\n`,
      );
      await writeFile(join(root, "README.md"), README_RC);
      await writeFile(join(root, "README.zh-CN.md"), README_ZH_RC);
      await writeFile(join(root, "llms.txt"), LLMS_RC);
      await writeFile(
        join(root, ".well-known/goodmemory.json"),
        `${JSON.stringify({
          name: "goodmemory",
          releaseStatus: {
            installCommandsApplyAfterPublish: true,
            npmLatest: "0.6.0",
            status: "release-candidate",
            tarball: "goodmemory-0.7.0.tgz",
          },
          version: "0.7.0",
        }, null, 2)}\n`,
      );

      const sourceBefore = await Promise.all(
        ["README.md", "README.zh-CN.md", "llms.txt", ".well-known/goodmemory.json"]
          .map((path) => readFile(join(root, path), "utf8")),
      );
      const artifact = await prepareV07StableArtifact({
        outputDir,
        repoRoot: root,
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

      expect(readme).toContain("`0.7.0` is the current stable release");
      expect(readme).toContain("npm `latest` points to `0.7.0`");
      expect(readmeZh).toContain("`0.7.0` 是当前稳定版本");
      expect(readmeZh).toContain("npm `latest` 指向 `0.7.0`");
      expect(llms).toContain("GoodMemory 0.7.0 is the current stable release");
      expect(llms).toContain("npm latest points to 0.7.0");
      for (const content of [readme, readmeZh, llms]) {
        expect(content).not.toContain("release candidate");
        expect(content).not.toContain("0.6.0");
      }
      expect(descriptor.releaseStatus).toEqual({
        installCommandsApplyAfterPublish: false,
        npmLatest: "0.7.0",
        status: "stable",
        tarball: "goodmemory-0.7.0.tgz",
      });
      expect(packageJson.goodmemoryRelease).toEqual({
        installCommandsApplyAfterPublish: false,
        npmLatest: "0.7.0",
        status: "stable",
      });
      expect(artifact.artifactName).toBe("goodmemory-0.7.0.tgz");
      expect(artifact.integrity).toBe(
        `sha512-${createHash("sha512")
          .update(await readFile(artifact.artifactPath))
          .digest("base64")}`,
      );

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
