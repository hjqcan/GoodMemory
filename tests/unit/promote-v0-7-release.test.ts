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

import {
  assertV07StableReleaseSource,
  promoteV07ReleaseSource,
} from "../../scripts/promote-v0-7-release";

const README_RC = `# GoodMemory

> **Release status:** this branch is the \`0.7.1\` release candidate. npm
> \`latest\` remains \`0.7.0\` until the tagged stable workflow publishes 0.7.1.
> The version-pinned registry commands below are the post-publish contract; use
> the locally packed \`goodmemory-0.7.1.tgz\` for pre-publish verification.
`;

const README_ZH_RC = `# GoodMemory

> **发布状态：**当前分支是 \`0.7.1\` release candidate；在带 tag 的稳定发布
> workflow 真正发布 0.7.1 之前，npm \`latest\` 仍是 \`0.7.0\`。下文锁定
> 0.7.1 的 registry 命令是发布后的契约；发布前请使用本地打包的
> \`goodmemory-0.7.1.tgz\` 验证。
`;

const LLMS_RC = `# GoodMemory

Release status: this source tree targets the 0.7.1 release candidate. npm
latest remains 0.7.0 until the tagged stable workflow publishes 0.7.1. The
version-pinned registry commands below apply after publication; pre-publish
verification uses goodmemory-0.7.1.tgz.
`;

async function writeReleaseCandidateFixture(
  root: string,
  llms = LLMS_RC,
): Promise<void> {
  await mkdir(join(root, ".well-known"), { recursive: true });
  await writeFile(join(root, "README.md"), README_RC);
  await writeFile(join(root, "README.zh-CN.md"), README_ZH_RC);
  await writeFile(join(root, "llms.txt"), llms);
  await writeFile(
    join(root, "package.json"),
    `${JSON.stringify({
      goodmemoryRelease: {
        installCommandsApplyAfterPublish: true,
        npmDistTag: "latest",
        status: "release-candidate",
      },
      name: "goodmemory",
      version: "0.7.1",
    }, null, 2)}\n`,
  );
  await writeFile(
    join(root, ".well-known/goodmemory.json"),
    `${JSON.stringify({
      name: "goodmemory",
      releaseStatus: {
        installCommandsApplyAfterPublish: true,
        npmDistTag: "latest",
        status: "release-candidate",
        tarball: "goodmemory-0.7.1.tgz",
      },
      version: "0.7.1",
    }, null, 2)}\n`,
  );
}

describe("v0.7 release-source promotion", () => {
  it("promotes the committed source metadata without encoding mutable npm state", async () => {
    const root = await mkdtemp(join(tmpdir(), "goodmemory-v07-promote-"));
    try {
      await writeReleaseCandidateFixture(root);

      await promoteV07ReleaseSource({ repoRoot: root });

      const packageJson = JSON.parse(
        await readFile(join(root, "package.json"), "utf8"),
      ) as Record<string, unknown>;
      const descriptor = JSON.parse(
        await readFile(join(root, ".well-known/goodmemory.json"), "utf8"),
      ) as { releaseStatus?: Record<string, unknown> };
      const readme = await readFile(join(root, "README.md"), "utf8");
      const readmeZh = await readFile(join(root, "README.zh-CN.md"), "utf8");
      const llms = await readFile(join(root, "llms.txt"), "utf8");

      expect(packageJson.goodmemoryRelease).toEqual({
        installCommandsApplyAfterPublish: true,
        npmDistTag: "latest",
        status: "stable",
      });
      expect(descriptor.releaseStatus).toEqual({
        installCommandsApplyAfterPublish: true,
        npmDistTag: "latest",
        status: "stable",
        tarball: "goodmemory-0.7.1.tgz",
      });
      expect(readme).toContain("immutable `0.7.1` stable release source");
      expect(readmeZh).toContain("不可变的 `0.7.1` 稳定发布源码");
      expect(llms).toContain("immutable GoodMemory 0.7.1 stable release source");
      for (const content of [readme, readmeZh, llms]) {
        expect(content).not.toContain("latest remains 0.7.0");
        expect(content).not.toContain("release candidate");
      }
      expect(JSON.stringify(packageJson)).not.toContain("npmLatest");
      expect(JSON.stringify(descriptor)).not.toContain("npmLatest");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("rejects stable source when the descriptor names a different tarball", async () => {
    const root = await mkdtemp(join(tmpdir(), "goodmemory-v07-tarball-"));
    try {
      await writeReleaseCandidateFixture(root);
      await promoteV07ReleaseSource({ repoRoot: root });
      const descriptorPath = join(root, ".well-known/goodmemory.json");
      const descriptor = JSON.parse(
        await readFile(descriptorPath, "utf8"),
      ) as { releaseStatus: { tarball: string } };
      descriptor.releaseStatus.tarball = "different.tgz";
      await writeFile(descriptorPath, `${JSON.stringify(descriptor, null, 2)}\n`);

      await expect(
        assertV07StableReleaseSource({ repoRoot: root }),
      ).rejects.toThrow("goodmemory-0.7.1.tgz");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("does not partially promote source files when prose preflight fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "goodmemory-v07-preflight-"));
    try {
      await writeReleaseCandidateFixture(root, "# GoodMemory\n\nDrifted status.\n");
      const paths = [
        "package.json",
        ".well-known/goodmemory.json",
        "README.md",
        "README.zh-CN.md",
        "llms.txt",
      ];
      const before = await Promise.all(
        paths.map((path) => readFile(join(root, path), "utf8")),
      );

      await expect(promoteV07ReleaseSource({ repoRoot: root })).rejects.toThrow(
        "Expected exactly one v0.7 RC status block in llms.txt",
      );
      const after = await Promise.all(
        paths.map((path) => readFile(join(root, path), "utf8")),
      );
      expect(after).toEqual(before);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});
