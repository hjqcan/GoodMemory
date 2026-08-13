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
  assertV07ReleaseSourceIdentity,
  assertV07StableReleaseSource,
  promoteV07ReleaseSource,
} from "../../scripts/promote-v0-7-release";
import { BENCHMARK_EVIDENCE_BOUNDARY_NOTE } from "../../src/api/capabilityDescriptor";

const README_RC = `# GoodMemory

> **Release status:** this branch is the \`0.7.4\` release candidate. npm
> \`latest\` remains \`0.7.3\`; \`0.7.4\` has not been published. The version-pinned
> registry commands below are the post-publish contract; use the locally packed
> \`goodmemory-0.7.4.tgz\` for pre-publish verification.
`;

const README_ZH_RC = `# GoodMemory

> **发布状态：**当前分支是 \`0.7.4\` release candidate。npm \`latest\` 仍为
> \`0.7.3\`，\`0.7.4\` 尚未发布。下文锁定版本的 registry 命令是发布后的契约；
> 发布前请使用本地打包的 \`goodmemory-0.7.4.tgz\` 验证。
`;

const LLMS_RC = `# GoodMemory

Release status: this source tree targets the GoodMemory 0.7.4 release candidate.
npm latest remains 0.7.3 and 0.7.4 has not been published. Version-pinned
registry commands apply after publication; pre-publish verification uses
goodmemory-0.7.4.tgz.
`;

async function runGit(root: string, args: readonly string[]): Promise<string> {
  const process = Bun.spawn({
    cmd: ["git", ...args],
    cwd: root,
    stderr: "pipe",
    stdout: "pipe",
  });
  const [exitCode, stderr, stdout] = await Promise.all([
    process.exited,
    new Response(process.stderr).text(),
    new Response(process.stdout).text(),
  ]);
  if (exitCode !== 0) {
    throw new Error(stderr.trim());
  }
  return stdout.trim();
}

async function initializeGit(root: string): Promise<void> {
  await runGit(root, ["init", "--quiet"]);
  await runGit(root, ["config", "user.email", "release-test@example.com"]);
  await runGit(root, ["config", "user.name", "Release Test"]);
}

async function commitAll(root: string, message: string): Promise<void> {
  await runGit(root, ["add", "."]);
  await runGit(root, ["commit", "--quiet", "-m", message]);
}

async function writeReleaseCandidateFixture(
  root: string,
  llms = LLMS_RC,
): Promise<void> {
  await mkdir(join(root, ".well-known"), { recursive: true });
  await mkdir(join(root, "benchmark-claims/evidence"), { recursive: true });
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
      version: "0.7.4",
    }, null, 2)}\n`,
  );
  await writeFile(
    join(root, "benchmark-claims/evidence/locomo-v0.7.3-current.json"),
    `${JSON.stringify({
      descriptorClaim: {
        claimDeclaration: "benchmark-claims/locomo.json",
        config: "full 10 conversations / 1540 questions",
        measuredPackageVersion: "0.7.3",
        metric: "independent official judge accuracy",
        name: "LoCoMo",
        reference: "benchmark-claims/evidence/locomo-v0.7.3-current.json",
        result: "official 0.8000; strict 0.6000",
        runtimeProfile: "recommended-current",
      },
    }, null, 2)}\n`,
  );
  await writeFile(
    join(root, ".well-known/goodmemory.json"),
    `${JSON.stringify({
      benchmarks: {
        currentClaims: [],
        historicalEvidence: { note: "RC historical note", url: "benchmark-claims" },
      },
      name: "goodmemory",
      releaseStatus: {
        installCommandsApplyAfterPublish: true,
        npmDistTag: "latest",
        status: "release-candidate",
        tarball: "goodmemory-0.7.4.tgz",
      },
      version: "0.7.4",
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
      ) as {
        benchmarks?: {
          currentClaims?: Array<Record<string, unknown>>;
          historicalEvidence?: { note?: string };
        };
        releaseStatus?: Record<string, unknown>;
      };
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
        tarball: "goodmemory-0.7.4.tgz",
      });
      expect(descriptor.benchmarks?.currentClaims).toEqual([]);
      expect(descriptor.benchmarks?.historicalEvidence?.note).toBe(
        BENCHMARK_EVIDENCE_BOUNDARY_NOTE,
      );
      expect(readme).toContain("immutable `0.7.4` stable release source");
      expect(readmeZh).toContain("不可变的 `0.7.4` 稳定发布源码");
      expect(llms).toContain("immutable GoodMemory 0.7.4 stable release source");
      for (const content of [readme, readmeZh, llms]) {
        expect(content).not.toContain("latest remains 0.7.3");
        expect(content).not.toContain("release candidate");
      }
      expect(JSON.stringify(packageJson)).not.toContain("npmLatest");
      expect(JSON.stringify(descriptor)).not.toContain("npmLatest");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("promotes the repository release-candidate prose without fixture-only drift", async () => {
    const root = await mkdtemp(join(tmpdir(), "goodmemory-v07-real-prose-"));
    try {
      await mkdir(join(root, ".well-known"), { recursive: true });
      for (const path of ["README.md", "README.zh-CN.md", "llms.txt"]) {
        await writeFile(
          join(root, path),
          await readFile(new URL(`../../${path}`, import.meta.url), "utf8"),
        );
      }
      await writeFile(
        join(root, "package.json"),
        await readFile(new URL("../../package.json", import.meta.url), "utf8"),
      );
      await writeFile(
        join(root, ".well-known/goodmemory.json"),
        await readFile(
          new URL("../../.well-known/goodmemory.json", import.meta.url),
          "utf8",
        ),
      );

      await expect(promoteV07ReleaseSource({ repoRoot: root })).resolves.toBeUndefined();
      expect(await readFile(join(root, "README.md"), "utf8")).toContain(
        "immutable `0.7.4` stable release source",
      );
      for (const path of ["README.md", "README.zh-CN.md", "llms.txt"]) {
        const promoted = await readFile(join(root, path), "utf8");
        expect(promoted).not.toMatch(/release[- ]candidate|unpublished|尚未发布/iu);
      }
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("rejects stable source when the descriptor names a different tarball", async () => {
    const root = await mkdtemp(join(tmpdir(), "goodmemory-v07-tarball-"));
    try {
      await writeReleaseCandidateFixture(root);
      await promoteV07ReleaseSource({ repoRoot: root });
      await initializeGit(root);
      await commitAll(root, "stable release source");
      await runGit(root, ["tag", "v0.7.4"]);
      const descriptorPath = join(root, ".well-known/goodmemory.json");
      const descriptor = JSON.parse(
        await readFile(descriptorPath, "utf8"),
      ) as { releaseStatus: { tarball: string } };
      descriptor.releaseStatus.tarball = "different.tgz";
      await writeFile(descriptorPath, `${JSON.stringify(descriptor, null, 2)}\n`);

      await expect(
        assertV07StableReleaseSource({ repoRoot: root }),
      ).rejects.toThrow("goodmemory-0.7.4.tgz");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("rejects stable source when benchmark evidence metadata drifts", async () => {
    const root = await mkdtemp(join(tmpdir(), "goodmemory-v07-benchmark-drift-"));
    try {
      await writeReleaseCandidateFixture(root);
      await promoteV07ReleaseSource({ repoRoot: root });
      const descriptorPath = join(root, ".well-known/goodmemory.json");
      const descriptor = JSON.parse(
        await readFile(descriptorPath, "utf8"),
      ) as { benchmarks: { historicalEvidence: { note: string } } };
      descriptor.benchmarks.historicalEvidence.note = "stale public claim";
      await writeFile(descriptorPath, `${JSON.stringify(descriptor, null, 2)}\n`);

      await expect(
        assertV07StableReleaseSource({ repoRoot: root }),
      ).rejects.toThrow("stale benchmark evidence metadata");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("allows an untagged release candidate but requires stable HEAD to match its clean peeled tag", async () => {
    const root = await mkdtemp(join(tmpdir(), "goodmemory-v07-identity-"));
    try {
      await writeReleaseCandidateFixture(root);
      await expect(assertV07ReleaseSourceIdentity({
        releaseStatus: "release-candidate",
        repoRoot: root,
        version: "0.7.4",
      })).resolves.toBeUndefined();

      await promoteV07ReleaseSource({ repoRoot: root });
      await initializeGit(root);
      await commitAll(root, "stable release source");

      await expect(assertV07StableReleaseSource({ repoRoot: root })).rejects.toThrow(
        "peeled v0.7.4 tag",
      );

      await runGit(root, ["tag", "v0.7.4"]);
      await expect(assertV07StableReleaseSource({ repoRoot: root })).resolves.toBeUndefined();

      const stableReadme = await readFile(join(root, "README.md"), "utf8");
      await writeFile(join(root, "README.md"), `${stableReadme}\ntracked drift\n`);
      await expect(assertV07StableReleaseSource({ repoRoot: root })).rejects.toThrow(
        "clean working tree",
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("rejects stable source when the peeled version tag does not point at HEAD", async () => {
    const root = await mkdtemp(join(tmpdir(), "goodmemory-v07-tag-drift-"));
    try {
      await writeReleaseCandidateFixture(root);
      await initializeGit(root);
      await commitAll(root, "release candidate");
      await runGit(root, ["tag", "v0.7.4"]);
      await promoteV07ReleaseSource({ repoRoot: root });
      await commitAll(root, "stable release source");

      await expect(assertV07StableReleaseSource({ repoRoot: root })).rejects.toThrow(
        "does not match HEAD",
      );
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("rejects untracked source that could enter the stable artifact outside the tag", async () => {
    const root = await mkdtemp(join(tmpdir(), "goodmemory-v07-untracked-"));
    try {
      await writeReleaseCandidateFixture(root);
      await promoteV07ReleaseSource({ repoRoot: root });
      await initializeGit(root);
      await commitAll(root, "stable release source");
      await runGit(root, ["tag", "v0.7.4"]);
      await writeFile(join(root, "untracked-source.ts"), "export const drift = true;\n");

      await expect(assertV07StableReleaseSource({ repoRoot: root })).rejects.toThrow(
        "clean working tree",
      );
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
