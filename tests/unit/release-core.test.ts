import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { gunzipSync } from "node:zlib";

import { describe, expect, it } from "bun:test";

import {
  assertReleaseManifestReferences,
  createReleaseArtifactRef,
  readEvidenceMaterial,
  readEvidenceTreeMaterial,
  writeReleaseArtifacts,
} from "../../scripts/release/artifact";
import { parseReleaseCliArgs } from "../../scripts/release";
import type {
  ReleaseCheck,
  ReleaseManifestV1,
  ReleasePreparedArtifact,
  ReleaseProfile,
} from "../../scripts/release/contracts";
import {
  V07_ACTIVE_LEGACY_CHECK_IDS,
  V07_HISTORICAL_CAPSULE_CHECK_ID,
  V07_HISTORICAL_ONLY_CHECK_IDS,
  loadV07ReleaseProfile,
  projectV07LegacyReadinessParity,
} from "../../scripts/release/profile";
import {
  prepareReleaseArtifact,
  runReleaseProfile,
} from "../../scripts/release/runner";
import type {
  ReleaseCommandRunner,
  ReleaseRunnerServices,
} from "../../scripts/release/runner";

const COMMIT = "a".repeat(40);
const TREE = "b".repeat(40);

function passingCheck(id: string, title = id): ReleaseCheck {
  return {
    detail: `${id} passed`,
    durationMs: 1,
    evidenceArtifactIds: id === "pack" || id === "language-consumers"
      ? ["release-tarball"]
      : [],
    id,
    required: true,
    status: "pass",
    title,
  };
}

function testManifest(): ReleaseManifestV1 {
  const evidenceBytes = Buffer.from("frozen evidence\n");
  const evidence = createReleaseArtifactRef({
    bytes: evidenceBytes,
    id: "frozen-evidence",
    kind: "file",
    path: "reports/release/evidence.json",
    tracked: true,
  });
  const checks = [{
    ...passingCheck("evidence"),
    evidenceArtifactIds: [evidence.id],
  }];
  return {
    allRequiredPassed: true,
    artifacts: [evidence],
    checks,
    package: {
      distTag: "latest",
      installCommandsApplyAfterPublish: true,
      name: "goodmemory",
      status: "stable",
      tarballName: "goodmemory-0.7.4.tgz",
      version: "0.7.4",
    },
    profileId: "goodmemory-v0.7",
    runtime: { bunVersion: "1.3.14", nodeVersion: "v20.20.2" },
    schemaVersion: "goodmemory.release-manifest.v1",
    source: { clean: true, commit: COMMIT, tag: "v0.7.4", tree: TREE },
    summary: { failed: 0, passed: 1, skipped: 0, total: 1 },
  };
}

async function writeCapsule(root: string): Promise<void> {
  const path = join(root, "scripts/release/capsules/v0.7.4-readiness.json");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(
    path,
    await readFile(
      new URL(
        "../../scripts/release/capsules/v0.7.4-readiness.json",
        import.meta.url,
      ),
    ),
  );
}

function fakeRunner(profile: ReleaseProfile): ReleaseCommandRunner {
  return async ({ args, command }) => {
    if (command === "git" && args[0] === "status") {
      return { code: 0, durationMs: 1, stderr: "", stdout: "" };
    }
    if (command === "git" && args[0] === "rev-parse") {
      const value = args.includes("HEAD^{tree}")
        ? TREE
        : args.includes("--verify")
          ? COMMIT
          : COMMIT;
      return { code: 0, durationMs: 1, stderr: "", stdout: `${value}\n` };
    }
    if (command === "git" && args[0] === "ls-files") {
      return { code: 0, durationMs: 1, stderr: "", stdout: `${args.at(-1)}\n` };
    }
    if (command === "node" && args[0] === "--version") {
      return { code: 0, durationMs: 1, stderr: "", stdout: "v20.20.2\n" };
    }
    if (command === "bun" && args[0] === "--version") {
      return { code: 0, durationMs: 1, stderr: "", stdout: "1.3.14\n" };
    }
    if (command === "bun" && args[0] === "scripts/run-projection-storage-scale-gate.ts") {
      await writeFile(args[2], "{\"passed\":true}\n");
    }
    const known = profile.checks.some((check) => check.command === command);
    return {
      code: known ? 0 : 1,
      durationMs: 1,
      stderr: known ? "" : `unexpected command ${command} ${args.join(" ")}`,
      stdout: "",
    };
  };
}

describe("release profile and historical parity", () => {
  it("derives the release identity from package.json and freezes old proof as a capsule", async () => {
    const repoRoot = new URL("../..", import.meta.url).pathname;
    const profile = await loadV07ReleaseProfile(repoRoot);
    const capsulePath = profile.evidenceInputs[0]?.path;
    expect(capsulePath).toBe(
      "scripts/release/capsules/v0.7.4-readiness.json",
    );
    const distributable = Bun.spawnSync(
      [
        "git",
        "ls-files",
        "--cached",
        "--others",
        "--exclude-standard",
        "--",
        capsulePath!,
      ],
      { cwd: repoRoot },
    );
    expect(distributable.exitCode).toBe(0);
    expect(new TextDecoder().decode(distributable.stdout).trim()).toBe(
      capsulePath,
    );
    const legacy = JSON.parse(
      await readFile(
        join(repoRoot, capsulePath!),
        "utf8",
      ),
    ) as unknown;
    const parity = projectV07LegacyReadinessParity(legacy);

    expect(legacy).toMatchObject({
      packageVersion: "0.7.4",
      readinessReportSha256:
        "96811024efcfe8b1202347113ed937f700558656fcd440020d025ce5124e7dc3",
      schemaVersion: "goodmemory.release-readiness-capsule.v1",
      sourceIdentity: {
        commit: "05d39fcfb8bb6efe6b8065ec3ea8372c15b9c1b8",
        tree: "4f902b215c60f5bb6543e9b7c3ce501895b45725",
      },
      summary: { failed: 0, passed: 19, skipped: 0, total: 19 },
    });
    expect(profile.package).toEqual({
      distTag: "next",
      installCommandsApplyAfterPublish: true,
      name: "goodmemory",
      status: "release-candidate",
      tarballName: "goodmemory-0.7.5.tgz",
      version: "0.7.5",
    });
    expect(profile.checks.find(({ id }) => id === "scale")).toMatchObject({
      args: [
        "scripts/run-projection-storage-scale-gate.ts",
        "--output",
        { outputPath: "evidence/projection-storage-scale-gate.json" },
      ],
      command: "bun",
    });
    expect(parity.active.map(({ id }) => id)).toEqual([
      ...V07_ACTIVE_LEGACY_CHECK_IDS,
    ]);
    expect(parity.active.every(({ status }) => status === "pass")).toBe(true);
    expect(parity.historical.map(({ id }) => id)).toEqual([
      ...V07_HISTORICAL_ONLY_CHECK_IDS,
    ]);
    expect(parity.historical.every(({ status }) => status === "pass")).toBe(true);
    expect(parity.replacementCheckId).toBe(V07_HISTORICAL_CAPSULE_CHECK_ID);
  });

  it("compares only required id/status and rejects set drift", () => {
    const checks = [
      ...V07_ACTIVE_LEGACY_CHECK_IDS,
      ...V07_HISTORICAL_ONLY_CHECK_IDS,
    ].map((id) => ({
      detail: `/tmp/non-portable/${id}`,
      durationMs: Math.random() * 1_000,
      id,
      required: true,
      status: "pass",
    }));
    expect(projectV07LegacyReadinessParity({ checks }).active).toHaveLength(
      V07_ACTIVE_LEGACY_CHECK_IDS.length,
    );
    expect(() => projectV07LegacyReadinessParity({
      checks: [...checks.slice(1), { id: "unexpected", required: true, status: "pass" }],
    })).toThrow("required check set drifted");
  });

  it("accepts only the documented fail-closed prepare arguments", () => {
    expect(parseReleaseCliArgs([
      "prepare",
      "--output-dir",
      "out",
      "--repo-root",
      "repo",
    ], "/default")).toEqual({
      outputDir: "out",
      repoRoot: "repo",
    });
    expect(() => parseReleaseCliArgs([
      "prepare",
      "--output-dir",
      "out",
      "--strict",
    ], "/default")).toThrow("unknown release argument --strict");
    expect(() => parseReleaseCliArgs([
      "prepare",
      "--output-dir",
      "first",
      "--output-dir",
      "second",
    ], "/default")).toThrow("duplicate release argument --output-dir");
    expect(() => parseReleaseCliArgs([
      "prepare",
      "--output-dir",
      "out",
      "--repo-root",
      "first",
      "--repo-root",
      "second",
    ], "/default")).toThrow("duplicate release argument --repo-root");
  });
});

describe("release artifacts", () => {
  it("writes canonical manifest and byte-stable evidence archives without absolute paths", async () => {
    const root = await mkdtemp(join(tmpdir(), "goodmemory-release-artifacts-"));
    try {
      const manifest = testManifest();
      const evidenceBytes = Buffer.from("frozen evidence\n");
      const evidence = [{ bytes: evidenceBytes, ref: manifest.artifacts[0] }];
      const first = await writeReleaseArtifacts({
        evidence,
        manifest,
        outputDir: join(root, "first"),
      });
      const second = await writeReleaseArtifacts({
        evidence,
        manifest,
        outputDir: join(root, "second"),
      });
      const [firstArchive, secondArchive, manifestRaw, summary] = await Promise.all([
        readFile(first.archivePath),
        readFile(second.archivePath),
        readFile(first.manifestPath, "utf8"),
        readFile(first.summaryPath, "utf8"),
      ]);

      expect(firstArchive).toEqual(secondArchive);
      expect(JSON.parse(manifestRaw)).toEqual(manifest);
      expect(gunzipSync(firstArchive).toString("utf8")).toContain(
        "goodmemory.release-evidence-archive.v1",
      );
      expect(manifestRaw).not.toContain(root);
      expect(summary).not.toContain(root);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("rejects duplicate ids, unknown artifact references, and absolute paths", () => {
    const manifest = testManifest();
    expect(() => assertReleaseManifestReferences({
      ...manifest,
      checks: [{ ...manifest.checks[0], evidenceArtifactIds: ["missing"] }],
    })).toThrow("unknown artifacts");
    expect(() => assertReleaseManifestReferences({
      ...manifest,
      checks: [...manifest.checks, manifest.checks[0]],
    })).toThrow("duplicate check ids");
    expect(() => createReleaseArtifactRef({
      bytes: Buffer.from("x"),
      id: "absolute",
      kind: "file",
      path: "/tmp/evidence.json",
      tracked: true,
    })).toThrow("repository-relative");
  });

  it("binds a tree input to its exact canonical file closure", async () => {
    const root = await mkdtemp(join(tmpdir(), "goodmemory-release-tree-"));
    try {
      await mkdir(join(root, "nested"), { recursive: true });
      await writeFile(join(root, "b.txt"), "bravo\n");
      await writeFile(join(root, "nested/a.txt"), "alpha\n");

      const first = await readEvidenceTreeMaterial({
        absolutePath: root,
        id: "tree-evidence",
        path: "reports/tree-evidence",
      });
      const second = await readEvidenceTreeMaterial({
        absolutePath: root,
        id: "tree-evidence",
        path: "reports/tree-evidence",
      });

      expect(first).toEqual(second);
      expect(first.ref).toMatchObject({
        id: "tree-evidence",
        kind: "tree",
        path: "reports/tree-evidence",
        tracked: true,
      });
      expect(JSON.parse(Buffer.from(first.bytes).toString("utf8"))).toEqual([
        expect.objectContaining({ path: "b.txt" }),
        expect.objectContaining({ path: "nested/a.txt" }),
      ]);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("rejects symlinked files before labeling release evidence as tracked", async () => {
    const root = await mkdtemp(join(tmpdir(), "goodmemory-release-symlink-"));
    try {
      const outside = join(root, "outside.json");
      const linked = join(root, "tracked.json");
      await writeFile(outside, "{\"admin\":true}\n");
      await symlink(outside, linked);

      await expect(readEvidenceMaterial({
        absolutePath: linked,
        id: "tracked-evidence",
        path: "reports/tracked.json",
      })).rejects.toThrow("symlink");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});

describe("release runner", () => {
  it("runs the fixed stages, packs exactly once, and emits one authoritative manifest", async () => {
    const root = await mkdtemp(join(tmpdir(), "goodmemory-release-runner-"));
    const outputDir = join(root, "output");
    try {
      await writeCapsule(root);
      const sourceProfile = await loadV07ReleaseProfile(
        new URL("../..", import.meta.url).pathname,
      );
      let packCount = 0;
      const tarballBytes = Buffer.from("one exact tarball");
      const tarballPath = join(outputDir, sourceProfile.package.tarballName);
      const artifactRef = createReleaseArtifactRef({
        bytes: tarballBytes,
        id: "release-tarball",
        integrity: "sha512-fixture",
        kind: "tarball",
        path: sourceProfile.package.tarballName,
        tracked: false,
      });
      const prepareArtifact: ReleaseRunnerServices["prepareArtifact"] = async () => {
        packCount += 1;
        await mkdir(outputDir, { recursive: true });
        await writeFile(tarballPath, tarballBytes);
        return {
          artifactRef,
          consumerCheck: passingCheck("language-consumers"),
          packCheck: passingCheck("pack"),
          path: tarballPath,
        } satisfies ReleasePreparedArtifact;
      };
      const result = await runReleaseProfile({
        environment: { GOODMEMORY_TEST_POSTGRES_URL: "postgres://fixture" },
        outputDir,
        profile: sourceProfile,
        repoRoot: root,
        services: {
          prepareArtifact,
          runCommand: fakeRunner(sourceProfile),
        },
      });

      expect(packCount).toBe(1);
      expect(result.manifest.allRequiredPassed).toBe(true);
      expect(result.manifest.source).toEqual({
        clean: true,
        commit: COMMIT,
        tag: null,
        tree: TREE,
      });
      expect(result.manifest.checks.map(({ id }) => id)).toEqual([
        "source-identity",
        "runtime-identity",
        "release-source-identity",
        "version",
        "historical-release-capsule",
        ...sourceProfile.checks.map(({ id }) => id),
        "pack",
        "language-consumers",
        "source-stability",
      ]);
      expect(
        result.manifest.checks.find(({ id }) => id === "typecheck")?.durationMs,
      ).toBe(1);
      expect(result.tarballPath).toBe(tarballPath);
      expect(result.manifest.artifacts.find(({ id }) => id === "release-tarball")?.integrity)
        .toBe("sha512-fixture");
      expect(result.manifest.artifacts.find(({ id }) => id === "release-tarball")?.kind)
        .toBe("tarball");
      expect(result.manifest.artifacts.find(({ id }) => id === "release-tarball")?.tracked)
        .toBe(false);
      expect(result.manifest.artifacts.find(({ id }) => id.includes("capsule"))?.tracked)
        .toBe(true);
      expect(
        result.manifest.checks.every(({ durationMs }) => durationMs >= 0),
      ).toBe(true);
      expect(await readFile(result.manifestPath, "utf8")).not.toContain(root);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("makes a missing required environment a release failure", async () => {
    const root = await mkdtemp(join(tmpdir(), "goodmemory-release-required-"));
    try {
      await writeCapsule(root);
      const loadedProfile = await loadV07ReleaseProfile(
        new URL("../..", import.meta.url).pathname,
      );
      const profile = loadedProfile;
      const artifactRef = createReleaseArtifactRef({
        bytes: Buffer.from("artifact"),
        id: "release-tarball",
        integrity: "sha512-fixture",
        kind: "tarball",
        path: profile.package.tarballName,
        tracked: false,
      });
      const result = await runReleaseProfile({
        environment: {},
        outputDir: join(root, "output"),
        profile,
        repoRoot: root,
        services: {
          prepareArtifact: async () => ({
            artifactRef,
            consumerCheck: passingCheck("language-consumers"),
            packCheck: passingCheck("pack"),
            path: join(root, profile.package.tarballName),
          }),
          runCommand: fakeRunner(profile),
        },
      });

      expect(result.manifest.allRequiredPassed).toBe(false);
      expect(result.manifest.checks.find(({ id }) => id === "postgres")).toMatchObject({
        required: true,
        status: "fail",
      });
      expect(result.manifest.checks.find(
        ({ id }) => id === "historical-release-capsule",
      )?.status).toBe("pass");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("accepts only a fully tracked tree whose canonical closure hash matches", async () => {
    const root = await mkdtemp(join(tmpdir(), "goodmemory-release-tree-runner-"));
    const treePath = "reports/release/tree-capsule";
    try {
      await mkdir(join(root, treePath, "nested"), { recursive: true });
      await writeFile(join(root, treePath, "one.json"), "{\"one\":1}\n");
      await writeFile(join(root, treePath, "nested/two.json"), "{\"two\":2}\n");
      const tree = await readEvidenceTreeMaterial({
        absolutePath: join(root, treePath),
        id: "tree-capsule",
        path: treePath,
      });
      const loadedProfile = await loadV07ReleaseProfile(
        new URL("../..", import.meta.url).pathname,
      );
      const profile: ReleaseProfile = {
        ...loadedProfile,
        checks: [],
        evidenceInputs: [{
          checkId: "tree-capsule-check",
          id: tree.ref.id,
          kind: "tree",
          path: treePath,
          sha256: tree.ref.sha256,
          title: "Exact tree capsule",
        }],
      };
      const artifactRef = createReleaseArtifactRef({
        bytes: Buffer.from("artifact"),
        id: "release-tarball",
        integrity: "sha512-fixture",
        kind: "tarball",
        path: profile.package.tarballName,
        tracked: false,
      });
      const fallback = fakeRunner(profile);
      const result = await runReleaseProfile({
        outputDir: join(root, "output"),
        profile,
        repoRoot: root,
        services: {
          prepareArtifact: async () => ({
            artifactRef,
            consumerCheck: passingCheck("language-consumers"),
            packCheck: passingCheck("pack"),
            path: join(root, profile.package.tarballName),
          }),
          runCommand: async (input) =>
            input.command === "git" && input.args[0] === "ls-files"
              ? {
                  code: 0,
                  durationMs: 1,
                  stderr: "",
                  stdout: `${treePath}/nested/two.json\0${treePath}/one.json\0`,
                }
              : fallback(input),
        },
      });

      expect(result.manifest.checks.find(({ id }) => id === "tree-capsule-check"))
        .toMatchObject({ status: "pass" });
      expect(result.manifest.artifacts.find(({ id }) => id === "tree-capsule"))
        .toMatchObject({ kind: "tree", tracked: true });
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});

describe("same-tarball preparation", () => {
  it("packs once and passes the exact path through descriptor, audit, Node, and Bun checks", async () => {
    const root = await mkdtemp(join(tmpdir(), "goodmemory-release-pack-"));
    const outputDir = join(root, "output");
    try {
      const profile = await loadV07ReleaseProfile(
        new URL("../..", import.meta.url).pathname,
      );
      const artifactPath = join(outputDir, profile.package.tarballName);
      const calls: Array<{ args: readonly string[]; command: string }> = [];
      const runCommand: ReleaseCommandRunner = async ({ args, command }) => {
        calls.push({ args, command });
        if (command === "bun" && args[0] === "pm") {
          await mkdir(outputDir, { recursive: true });
          await writeFile(artifactPath, "fixed tarball bytes");
          return { code: 0, durationMs: 1, stderr: "", stdout: `${artifactPath}\n` };
        }
        if (command === "tar" && args[0] === "-tzf") {
          return {
            code: 0,
            durationMs: 1,
            stderr: "",
            stdout: profile.artifact.requiredFiles
              .map((path) => `package/${path}`)
              .join("\n"),
          };
        }
        if (command === "tar" && args.at(-1) === "package/package.json") {
          return {
            code: 0,
            durationMs: 1,
            stderr: "",
            stdout: JSON.stringify({
              goodmemoryRelease: {
                installCommandsApplyAfterPublish: true,
                npmDistTag: profile.package.distTag,
                status: profile.package.status,
              },
              name: profile.package.name,
              version: profile.package.version,
            }),
          };
        }
        if (command === "tar") {
          return {
            code: 0,
            durationMs: 1,
            stderr: "",
            stdout: JSON.stringify({
              releaseStatus: {
                npmDistTag: profile.package.distTag,
                status: profile.package.status,
                tarball: profile.package.tarballName,
              },
              version: profile.package.version,
            }),
          };
        }
        if (command === "npm" && args[0] === "audit") {
          return {
            code: 0,
            durationMs: 1,
            stderr: "",
            stdout: JSON.stringify({
              metadata: { vulnerabilities: { critical: 0, high: 0 } },
            }),
          };
        }
        if ((command === "node") || (command === "bun" && args[0] === "run")) {
          return {
            code: 0,
            durationMs: 1,
            stderr: "",
            stdout: "LANGUAGE_CONSUMER_OK\n",
          };
        }
        return { code: 0, durationMs: 1, stderr: "", stdout: "" };
      };

      const artifact = await prepareReleaseArtifact({
        outputDir,
        profile,
        repoRoot: root,
        runCommand,
      });

      expect(calls.filter(({ command, args }) =>
        command === "bun" && args[0] === "pm" && args[1] === "pack"
      )).toHaveLength(1);
      expect(calls.filter(({ command }) => command === "tar").every(
        ({ args }) => args.includes(artifactPath),
      )).toBe(true);
      expect(artifact.packCheck.status).toBe("pass");
      expect(artifact.consumerCheck.status).toBe("pass");
      expect(artifact.artifactRef.integrity).toMatch(/^sha512-/u);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});
