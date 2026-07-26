import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import {
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  freezeC6PackageSourceDependencyClosure,
} from "../../scripts/codex-coding-effect/c6-package-source-dependency-closure";
import {
  C6_PACKAGE_SOURCE_PROTOCOL_SHA256,
  C6PackageSourceCacheScanTimeoutError,
  assertC6PackageSourceBuildOutputs,
  buildC6PackageSourceBuildDockerCreateCommand,
  createC6PackageSourceArchive,
  readC6PackageSourceRunnerClosure,
  rebuildC6PackageFromSource,
  serializeC6PackageSourceReproducibilityReceipt,
  verifyC6PackageSourceReproducibilityReceipt,
} from "../../scripts/codex-coding-effect/c6-package-source-reproducibility";
import type {
  C6PackageSourceCommandResult,
  C6PackageSourceDockerCommandInput,
  C6PackageSourceRebuildInput,
  C6PackageSourceReproducibilityReceipt,
} from "../../scripts/codex-coding-effect/c6-package-source-reproducibility";

const IMAGE_SHA256 = "1".repeat(64);
const PACKAGE_SHA256 = "2".repeat(64);
const COMMIT_SHA = "3".repeat(40);
const TREE_SHA = "4".repeat(40);
const IMAGE_REFERENCE = `sha256:${IMAGE_SHA256}`;
const DOCKER_CLI_PATH = "/opt/c6/bin/docker";
const DOCKER_CLI_SHA256 = "9".repeat(64);
const DOCKER_SOCKET_PATH = "/opt/c6/run/docker.sock";
const DEPENDENCY_CLOSURE = {
  assetLockSha256: "a".repeat(64),
  assetRootSha256: "b".repeat(64),
  cacheArchiveSha256: "c".repeat(64),
  cacheContentRootSha256: "d".repeat(64),
  cacheManifestSha256: "e".repeat(64),
} as const;
const RUNTIME_IDENTITY_SHA256 = "f".repeat(64);
const RUNTIME = {
  bun: {
    executableSha256: "5".repeat(64),
    version: "1.3.11",
  },
  node: {
    executableSha256: "6".repeat(64),
    version: "v22.14.0",
  },
  npm: {
    cliSha256: "7".repeat(64),
    launcherSha256: "8".repeat(64),
    version: "10.9.2",
  },
} as const;
const RUNNER_SOURCE_PATHS = [
  "scripts/codex-coding-effect/c6-asset-lock.ts",
  "scripts/codex-coding-effect/c6-package-source-archive.ts",
  "scripts/codex-coding-effect/c6-package-source-artifact-publication.ts",
  "scripts/codex-coding-effect/c6-package-source-dependency-closure.ts",
  "scripts/codex-coding-effect/c6-package-source-docker-authority.ts",
  "scripts/codex-coding-effect/c6-package-source-receipt-verifier.ts",
  "scripts/codex-coding-effect/c6-package-source-reproducibility.ts",
  "scripts/codex-coding-effect/c6-package.ts",
  "scripts/rebuild-codex-coding-effect-c6-package-source.ts",
] as const;
const NEW_RUNNER_MODULE_PATHS = [
  "scripts/codex-coding-effect/c6-package-source-archive.ts",
  "scripts/codex-coding-effect/c6-package-source-artifact-publication.ts",
  "scripts/codex-coding-effect/c6-package-source-docker-authority.ts",
  "scripts/codex-coding-effect/c6-package-source-receipt-verifier.ts",
] as const;

describe("Codex coding-effect C6 package source reproducibility", () => {
  it("builds an exact-authority offline container with minimal mounts", () => {
    const command = buildC6PackageSourceBuildDockerCreateCommand({
      containerUser: "501:20",
      dockerCliPath: DOCKER_CLI_PATH,
      expectedImageSha256: IMAGE_SHA256,
      imageReference: IMAGE_REFERENCE,
      ownershipNonce: "fixture-ownership",
      run: 1,
      workRoot: "/tmp/c6-source-build",
    });

    expect(command[0]).toBe(DOCKER_CLI_PATH);
    expect(command).toContain("--pull=never");
    expect(command).toContain("--platform=linux/amd64");
    expect(command).toContain("--network=none");
    expect(command).toContain("--cgroupns=private");
    expect(command).toContain("--ipc=private");
    expect(command).toContain(
      "--label=com.goodmemory.c6.package-source.owner=fixture-ownership",
    );
    expect(command).toContain(
      "--label=com.goodmemory.c6.package-source.run=1",
    );
    expect(command).toContain("--read-only");
    expect(command).toContain("--cap-drop=ALL");
    expect(command).toContain("--security-opt=no-new-privileges");
    expect(command).toContain(
      "--env=PATH=/work/tool-bin:/usr/local/bin:/usr/bin:/bin",
    );
    expect(command).toContain(
      "--env=NPM_CONFIG_GLOBALCONFIG=/tmp/empty-global-npmrc",
    );
    expect(command).toContain(
      "--env=NPM_CONFIG_USERCONFIG=/tmp/empty-user-npmrc",
    );
    expect(command).toContain(
      "--mount=type=bind,src=/tmp/c6-source-build/source,dst=/work/source",
    );
    expect(command).toContain(
      "--mount=type=bind,src=/tmp/c6-source-build/cache,dst=/work/cache,readonly",
    );
    expect(command).toContain(
      "--mount=type=bind,src=/tmp/c6-source-build/output,dst=/work/output",
    );
    expect(command).toContain(
      "--mount=type=bind,src=/tmp/c6-source-build/observed,dst=/work/observed",
    );
    expect(command).toContain(
      "--mount=type=bind,src=/tmp/c6-source-build/tool-bin,dst=/work/tool-bin,readonly",
    );
    expect(command).toContain(
      "--mount=type=bind,src=/tmp/c6-source-build/run-build.sh,dst=/work/run-build.sh,readonly",
    );
    expect(command.filter((part) => part.startsWith("--mount="))).toHaveLength(6);
    expect(() => buildC6PackageSourceBuildDockerCreateCommand({
      containerUser: "501:20",
      dockerCliPath: DOCKER_CLI_PATH,
      expectedImageSha256: IMAGE_SHA256,
      imageReference: `sha256:${"9".repeat(64)}`,
      ownershipNonce: "fixture-ownership",
      run: 1,
      workRoot: "/tmp/c6-source-build",
    })).toThrow("image digest");
  });

  it("binds the CLI, runner, and directly executed helper source closure", async () => {
    const closure = await readC6PackageSourceRunnerClosure();

    expect(closure.files.map((file) => file.path)).toEqual(
      [...RUNNER_SOURCE_PATHS],
    );
    expect(closure.rootSha256).toBe(sha256(
      closure.files.map((file) => `${JSON.stringify(file)}\n`).join(""),
    ));
  });

  it("archives the exact commit and ignores dirty or untracked worktree state", async () => {
    const root = await createTempDirectory("goodmemory-c6-source-git-");
    const output = await createTempDirectory("goodmemory-c6-source-output-");
    try {
      await run(["git", "init", "--quiet"], root);
      await run(["git", "config", "user.email", "c6@example.invalid"], root);
      await run(["git", "config", "user.name", "C6 Test"], root);
      await writeFile(join(root, "tracked.txt"), "committed\n");
      await writeFile(join(root, "package.json"), `${JSON.stringify({
        name: "goodmemory",
        version: "0.7.0",
      })}\n`);
      await writeFile(join(root, "bun.lock"), "lockfileVersion = 1\n");
      await run(["git", "add", "."], root);
      await run(["git", "commit", "--quiet", "-m", "fixture"], root);
      const commitSha = await gitOutput(root, ["rev-parse", "HEAD"]);
      const treeSha = await gitOutput(root, ["rev-parse", "HEAD^{tree}"]);

      await writeFile(join(root, "tracked.txt"), "dirty\n");
      await writeFile(join(root, "untracked.txt"), "not archived\n");
      const result = await createC6PackageSourceArchive({
        archivePath: join(output, "source.tar"),
        expectedCommitSha: commitSha,
        expectedTreeSha: treeSha,
        manifestPath: join(output, "source-tree.jsonl"),
        repositoryRoot: root,
      });

      const committed = await tarOutput(
        join(output, "source.tar"),
        "tracked.txt",
      );
      const listing = await commandOutput([
        "tar",
        "-tf",
        join(output, "source.tar"),
      ]);
      expect(committed).toBe("committed\n");
      expect(listing).not.toContain("untracked.txt");
      expect(result.commitSha).toBe(commitSha);
      expect(result.treeSha).toBe(treeSha);
      expect(result.entryManifest).not.toContain(sha256("dirty\n"));
    } finally {
      await rm(root, { force: true, recursive: true });
      await rm(output, { force: true, recursive: true });
    }
  });

  it("rejects a mutated second package output", () => {
    const packageBytes = Buffer.from("same package");
    expect(assertC6PackageSourceBuildOutputs({
      expectedPackageSha256: sha256(packageBytes),
      first: packageBytes,
      second: packageBytes,
    })).toBe(sha256(packageBytes));
    expect(() => assertC6PackageSourceBuildOutputs({
      expectedPackageSha256: sha256(packageBytes),
      first: packageBytes,
      second: Buffer.from("mutated second package"),
    })).toThrow("two package outputs differ");
  });

  it("rejects symlinked source roots and existing outputs before Docker", async () => {
    const root = await createTempDirectory("goodmemory-c6-source-path-");
    const alias = `${root}-alias`;
    try {
      await symlink(root, alias);
      await expect(createC6PackageSourceArchive({
        archivePath: join(root, "archive.tar"),
        expectedCommitSha: COMMIT_SHA,
        expectedTreeSha: TREE_SHA,
        manifestPath: join(root, "manifest.jsonl"),
        repositoryRoot: alias,
      })).rejects.toThrow("symlink");
    } finally {
      await rm(alias, { force: true });
      await rm(root, { force: true, recursive: true });
    }

    const fixture = await createRebuildFixture();
    try {
      await mkdir(fixture.outputRoot);
      await expect(rebuildC6PackageFromSource(
        fixture.input,
        { dockerCommand: fixture.docker.command },
      )).rejects.toThrow("already exists");
    } finally {
      await fixture.cleanup();
    }
  });

  it("rejects a receipt whose referenced artifact closure is absent", async () => {
    const root = await createTempDirectory("goodmemory-c6-source-receipt-");
    try {
      const receipt = await validReceipt();
      const bytes =
        serializeC6PackageSourceReproducibilityReceipt(receipt);
      const path = join(root, "receipt.json");
      await writeFile(path, bytes);
      await expect(verifyC6PackageSourceReproducibilityReceipt({
        expected: {
          commitSha: COMMIT_SHA,
          containerUser: "501:20",
          dependencyClosure: DEPENDENCY_CLOSURE,
          dockerAuthority: {
            cliMode: 0o755,
            cliPath: DOCKER_CLI_PATH,
            cliSha256: DOCKER_CLI_SHA256,
            socketPath: DOCKER_SOCKET_PATH,
          },
          imageSha256: IMAGE_SHA256,
          packageSha256: PACKAGE_SHA256,
          runtime: RUNTIME,
          runtimeIdentitySha256: RUNTIME_IDENTITY_SHA256,
          treeSha: TREE_SHA,
        },
        expectedReceiptSha256: sha256(bytes),
        path,
      })).rejects.toThrow("artifact closure");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("orchestrates two owned source builds, publishes receipt last, and verifies every persisted artifact", async () => {
    const fixture = await createRebuildFixture();
    const phases: string[] = [];
    const cacheScanStarts: string[] = [];
    try {
      const result = await rebuildC6PackageFromSource(
        fixture.input,
        {
          dockerCommand: fixture.docker.command,
          onCacheScanProgress: (stage, progress) => {
            if (progress.status === "start") {
              cacheScanStarts.push(
                `${stage}:${progress.phase}:${progress.rootIndex}`,
              );
            }
          },
          onPhase: async (phase, context) => {
            phases.push(phase);
            const receiptExists = await exists(
              join(context.outputRoot, "receipt.json"),
            );
            if (phase === "before-publish" || phase === "before-receipt") {
              expect(receiptExists).toBe(false);
            }
            if (phase === "after-receipt") {
              expect(receiptExists).toBe(true);
            }
          },
        },
      );

      expect(result).toMatchObject({
        c6PackageOfflineClosureProven: false,
        evidenceScope: "local-offline-source-build-observation",
        executorAuthority: "injected-test-seam",
        executionAuthenticated: false,
        executionMode: "offline-dependency-closure-source-build",
        externalIndependentAttestation: false,
        liveOfflineBuildCount: 0,
        locallyExecutedLinuxBuild: false,
        networkDisabled: true,
        offlineDependencyClosureUsed: true,
        rawExecutionWitnessIncluded: false,
        runnerObservedSameHostOfflineRebuild: false,
        sourceBuildReproducible: false,
      });
      expect(phases).toEqual([
        "after-cache-materialization",
        "before-publish",
        "before-first-publish-write",
        "before-receipt",
        "after-receipt",
      ]);
      expect(cacheScanStarts).toEqual([
        "materialize:materialize:1",
        "materialize:materialize:2",
        "pre-build:initial:1",
        "pre-build:initial:2",
        "post-build:terminal:1",
        "post-build:terminal:2",
        "post-build:terminal-stats:1",
        "post-build:terminal-stats:2",
      ]);
      expect(fixture.docker.count("create")).toBe(2);
      expect(fixture.docker.count("inspect")).toBe(8);
      expect(fixture.docker.count("start")).toBe(2);
      expect(fixture.docker.count("rm")).toBe(2);
      expect(fixture.docker.createdIds).toEqual([
        "1".repeat(64),
        "2".repeat(64),
      ]);
      expect(fixture.docker.createdLabels.every((labels) =>
        labels["com.goodmemory.c6.package-source.owner"] !== undefined &&
        labels["com.goodmemory.c6.package-source.run"] !== undefined &&
        labels[
          "com.goodmemory.c6.package-source.work-root-sha256"
        ] !== undefined
      )).toBe(true);

      const verification =
        await verifyC6PackageSourceReproducibilityReceipt({
          expected: {
            commitSha: fixture.input.expectedCommitSha,
            containerUser: fixture.input.containerUser,
            dependencyClosure:
              fixture.input.dependencyClosureExpected,
            dockerAuthority: fixture.input.dockerAuthority,
            imageSha256: IMAGE_SHA256,
            packageSha256: fixture.input.expectedPackageSha256,
            runtime: RUNTIME,
            runtimeIdentitySha256:
              fixture.input.runtimeIdentitySha256,
            treeSha: fixture.input.expectedTreeSha,
          },
          expectedReceiptSha256: result.receiptSha256,
          path: result.receiptPath,
        });
      expect(verification).toEqual({
        artifactClosureVerified: true,
        c6PackageOfflineClosureProven: false,
        executionAuthenticated: false,
        externalIndependentAttestation: false,
        locallyExecutedLinuxBuild: false,
        receiptSha256: result.receiptSha256,
        receiptValidation: "persisted-artifact-closure",
        recordedEvidenceScope:
          "local-offline-source-build-observation",
        recordedExecutorAuthority: "injected-test-seam",
        recordedLiveOfflineBuildCount: 0,
        recordedLocallyExecutedLinuxBuild: false,
        recordedNetworkDisabled: true,
        recordedOfflineDependencyClosureUsed: true,
        recordedRunnerObservedSameHostOfflineRebuild: false,
        recordedSourceBuildReproducible: false,
        rawExecutionWitnessIncluded: false,
        runnerObservedSameHostOfflineRebuild: false,
        sourceBuildReproducible: false,
      });

      const receipt = JSON.parse(
        await readFile(result.receiptPath, "utf8"),
      ) as C6PackageSourceReproducibilityReceipt;
      expect(receipt).toMatchObject({
        c6PackageOfflineClosureProven: false,
        evidenceScope: "local-offline-source-build-observation",
        executionAuthenticated: false,
        executionMode: "offline-dependency-closure-source-build",
        executor: {
          authority: "injected-test-seam",
          networkMode: "none",
        },
        liveOfflineBuildCount: 0,
        locallyExecutedLinuxBuild: false,
        networkDisabled: true,
        offlineDependencyClosureUsed: true,
        rawExecutionWitnessIncluded: false,
        runnerObservedSameHostOfflineRebuild: false,
        sourceBuildReproducible: false,
      });
      expect(receipt.runnerSource.files.map((file) => file.path)).toEqual(
        [...RUNNER_SOURCE_PATHS],
      );
      for (const modulePath of NEW_RUNNER_MODULE_PATHS) {
        expect(() =>
          serializeC6PackageSourceReproducibilityReceipt({
            ...receipt,
            runnerSource: {
              ...receipt.runnerSource,
              files: receipt.runnerSource.files.filter(
                (file) => file.path !== modulePath,
              ),
            },
          } as C6PackageSourceReproducibilityReceipt)
        ).toThrow();
        const replacementReceipt = structuredClone(receipt);
        const replaced = replacementReceipt.runnerSource.files.find(
          (file) => file.path === modulePath,
        )!;
        replaced.path = `${modulePath}.replaced`;
        replacementReceipt.runnerSource.rootSha256 = sha256(
          replacementReceipt.runnerSource.files.map((file) =>
            `${JSON.stringify(file)}\n`
          ).join(""),
        );
        const replacementBytes =
          serializeC6PackageSourceReproducibilityReceipt(
            replacementReceipt,
          );
        await writeFile(result.receiptPath, replacementBytes);
        await expect(verifyFixtureReceipt(
          fixture,
          result.receiptPath,
          sha256(replacementBytes),
        )).rejects.toThrow();
      }
      await writeFile(
        result.receiptPath,
        serializeC6PackageSourceReproducibilityReceipt(receipt),
      );

      const referencedPaths = [
        "receipt.json",
        receipt.source.archivePath,
        receipt.source.entryManifestPath,
        ...receipt.runs.flatMap((run) => [
          run.logs.stderr.path,
          run.logs.stdout.path,
          run.output.path,
        ]),
      ];
      expect(referencedPaths).toHaveLength(9);
      for (const relativePath of referencedPaths) {
        const path = join(fixture.outputRoot, relativePath);
        const original = await readFile(path);
        await writeFile(path, Buffer.concat([original, Buffer.from("x")]));
        await expect(verifyFixtureReceipt(
          fixture,
          result.receiptPath,
          result.receiptSha256,
        )).rejects.toThrow();
        await writeFile(path, original);
      }

      const receiptBytes = await readFile(result.receiptPath);
      const manifestPath = join(
        fixture.outputRoot,
        receipt.source.entryManifestPath,
      );
      const manifestBytes = await readFile(manifestPath);
      const mutatedManifest = Buffer.concat([
        manifestBytes,
        Buffer.from(`${JSON.stringify({
          mode: "100644",
          path: "not-in-source.txt",
          sha256: "0".repeat(64),
          size: 0,
          type: "file",
        })}\n`),
      ]);
      receipt.source.entryManifestSha256 = sha256(mutatedManifest);
      for (const run of receipt.runs) {
        run.input.sourceEntryManifestSha256 =
          receipt.source.entryManifestSha256;
      }
      const semanticallyFalseReceipt =
        serializeC6PackageSourceReproducibilityReceipt(receipt);
      await Promise.all([
        writeFile(manifestPath, mutatedManifest),
        writeFile(result.receiptPath, semanticallyFalseReceipt),
      ]);
      await expect(verifyFixtureReceipt(
        fixture,
        result.receiptPath,
        sha256(semanticallyFalseReceipt),
      )).rejects.toThrow("manifest semantics");
      await Promise.all([
        writeFile(manifestPath, manifestBytes),
        writeFile(result.receiptPath, receiptBytes),
      ]);

      receipt.locallyExecutedLinuxBuild = true;
      receipt.liveOfflineBuildCount = 2;
      const falseLiveClaim =
        serializeC6PackageSourceReproducibilityReceipt(receipt);
      await writeFile(result.receiptPath, falseLiveClaim);
      await expect(verifyFixtureReceipt(
        fixture,
        result.receiptPath,
        sha256(falseLiveClaim),
      )).rejects.toThrow("identity is inconsistent");
      await writeFile(result.receiptPath, receiptBytes);

      const missingPath = join(
        fixture.outputRoot,
        receipt.runs[1].logs.stderr.path,
      );
      const movedPath = join(fixture.root, "missing-artifact");
      await rename(missingPath, movedPath);
      await expect(verifyFixtureReceipt(
        fixture,
        result.receiptPath,
        result.receiptSha256,
      )).rejects.toThrow("missing or extra");
      await rename(movedPath, missingPath);

      const extraPath = join(fixture.outputRoot, "unexpected.txt");
      await writeFile(extraPath, "unexpected\n");
      await expect(verifyFixtureReceipt(
        fixture,
        result.receiptPath,
        result.receiptSha256,
      )).rejects.toThrow("missing or extra");
      await rm(extraPath);
    } finally {
      await fixture.cleanup();
    }
  });

  it("cleans both owned containers on a second-run failure and rejects short container ids", async () => {
    const failure = await createRebuildFixture({ failRun: 2 });
    try {
      await expect(rebuildC6PackageFromSource(
        failure.input,
        { dockerCommand: failure.docker.command },
      )).rejects.toThrow("source build 2 exited");
      expect(failure.docker.count("create")).toBe(2);
      expect(failure.docker.count("inspect")).toBe(8);
      expect(failure.docker.count("start")).toBe(2);
      expect(failure.docker.count("rm")).toBe(2);
      expect(await exists(failure.outputRoot)).toBe(false);
    } finally {
      await failure.cleanup();
    }

    const shortId = await createRebuildFixture({ shortIdRun: 1 });
    try {
      await expect(rebuildC6PackageFromSource(
        shortId.input,
        { dockerCommand: shortId.docker.command },
      )).rejects.toThrow("invalid full id");
      expect(shortId.docker.count("rm")).toBe(1);
      expect(await exists(shortId.outputRoot)).toBe(false);
    } finally {
      await shortId.cleanup();
    }
  });

  it("retains exact work roots and full attempt logs after an ordinary build failure", async () => {
    const fixture = await createRebuildFixture({ failRun: 2 });
    try {
      let caught: unknown;
      try {
        await rebuildC6PackageFromSource(
          fixture.input,
          { dockerCommand: fixture.docker.command },
        );
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(Error);
      const rootEntries = await readdir(fixture.root);
      const retainedWorkRoots = rootEntries
        .filter((entry) =>
          entry.startsWith(".goodmemory-c6-source-build-")
        )
        .sort()
        .map((entry) => join(fixture.root, entry));

      expect(retainedWorkRoots).toHaveLength(2);
      expect((caught as Error).message).toContain(
        "C6 source build 2 exited 1",
      );
      for (const retainedWorkRoot of retainedWorkRoots) {
        expect((caught as Error).message).toContain(
          `retainedWorkRoot=${retainedWorkRoot}`,
        );
      }
      expect(await readFile(
        join(retainedWorkRoots[0]!, "diagnostics", "build.stdout.log"),
        "utf8",
      )).toBe("fixture run 1\n");
      expect(await readFile(
        join(retainedWorkRoots[0]!, "diagnostics", "build.stderr.log"),
        "utf8",
      )).toBe("");
      expect(await readFile(
        join(retainedWorkRoots[0]!, "diagnostics", "status.json"),
        "utf8",
      )).toBe(`${JSON.stringify({
        containerExitCode: 0,
        dockerCommandExitCode: 0,
        kind: "c6-package-source-build-attempt",
        run: 1,
      }, null, 2)}\n`);
      expect(await readFile(
        join(retainedWorkRoots[1]!, "diagnostics", "build.stdout.log"),
        "utf8",
      )).toBe("");
      expect(await readFile(
        join(retainedWorkRoots[1]!, "diagnostics", "build.stderr.log"),
        "utf8",
      )).toBe("fixture run 2 failed\n");
      expect(await readFile(
        join(retainedWorkRoots[1]!, "diagnostics", "status.json"),
        "utf8",
      )).toBe(`${JSON.stringify({
        containerExitCode: 1,
        dockerCommandExitCode: 1,
        kind: "c6-package-source-build-attempt",
        run: 2,
      }, null, 2)}\n`);
      expect(await exists(fixture.outputRoot)).toBe(false);
      expect(
        await exists(`${fixture.outputRoot}.materialize.lock`),
      ).toBe(false);
      expect(rootEntries.some((entry) =>
        entry.startsWith(".output.staging-") ||
        entry.startsWith(".output.cleanup-")
      )).toBe(false);
      expect(fixture.docker.count("create")).toBe(2);
      expect(fixture.docker.count("rm")).toBe(2);
    } finally {
      await fixture.cleanup();
    }
  });

  it("revalidates Docker server and pinned image immediately before the first build", async () => {
    const serverDrift = await createRebuildFixture({
      preBuildDockerServerVersion: "28.4.1",
    });
    try {
      await expect(rebuildC6PackageFromSource(
        serverDrift.input,
        { dockerCommand: serverDrift.docker.command },
      )).rejects.toThrow(
        "Docker server version drifted before build",
      );
      expect(serverDrift.docker.count("version")).toBe(2);
      expect(serverDrift.docker.count("image")).toBe(2);
      expect(serverDrift.docker.count("create")).toBe(0);
    } finally {
      await serverDrift.cleanup();
    }

    const imageDrift = await createRebuildFixture({
      preBuildImageSha256: "0".repeat(64),
    });
    try {
      await expect(rebuildC6PackageFromSource(
        imageDrift.input,
        { dockerCommand: imageDrift.docker.command },
      )).rejects.toThrow(
        "image inspect does not match pinned Linux amd64 identity",
      );
      expect(imageDrift.docker.count("version")).toBe(2);
      expect(imageDrift.docker.count("image")).toBe(2);
      expect(imageDrift.docker.count("create")).toBe(0);
    } finally {
      await imageDrift.cleanup();
    }
  });

  it("rejects isolation, environment, cache, and run-count drift", async () => {
    const cases = [
      {
        error: "isolation inspect failed",
        options: { networkDriftRun: 1 as const },
      },
      {
        error: "isolation inspect failed",
        options: { privilegedRun: 1 as const },
      },
      {
        error: "isolation inspect failed",
        options: { extraTmpfsRun: 1 as const },
      },
      ...([
        "cap-add",
        "cap-drop",
        "cgroupns",
        "ipc",
        "pid",
        "security-extra",
        "security-missing",
        "userns",
        "uts",
      ] as const).map((kind) => ({
        error: "isolation inspect failed",
        options: {
          isolationMutation: { kind, run: 1 as const },
        },
      })),
      {
        error: "environment contains duplicates",
        options: { duplicateEnvironmentRun: 1 as const },
      },
      {
        error: "changed during verification",
        options: { cacheMutationRun: 1 as const },
      },
      {
        error: "installed dependency counts differ",
        options: { installedDependencyCountRun2: 18 },
      },
    ];
    for (const testCase of cases) {
      const fixture = await createRebuildFixture(testCase.options);
      try {
        await expect(rebuildC6PackageFromSource(
          fixture.input,
          {
            dockerCommand: fixture.docker.command,
            quiescenceWait: async () => {},
          },
        )).rejects.toThrow(testCase.error);
        expect(await exists(fixture.outputRoot)).toBe(false);
      } finally {
        await fixture.cleanup();
      }
    }
  }, 30_000);

  it("rejects shared cache inodes and dependency-closure substitution", async () => {
    const shared = await createRebuildFixture();
    try {
      await expect(rebuildC6PackageFromSource(
        shared.input,
        {
          dockerCommand: shared.docker.command,
          onPhase: async (phase, context) => {
            if (
              phase !== "after-cache-materialization" ||
              context.cacheRoots === undefined
            ) {
              return;
            }
            const relativePath = join(
              "registry",
              "fixture-package.bin",
            );
            const first = join(context.cacheRoots[0], relativePath);
            const second = join(context.cacheRoots[1], relativePath);
            await unlink(second);
            await link(first, second);
          },
        },
      )).rejects.toThrow();
      expect(shared.docker.count("create")).toBe(0);
    } finally {
      await shared.cleanup();
    }

    const substituted = await createRebuildFixture();
    try {
      substituted.input.dependencyClosureExpected.assetLockSha256 =
        "0".repeat(64);
      await expect(rebuildC6PackageFromSource(
        substituted.input,
        { dockerCommand: substituted.docker.command },
      )).rejects.toThrow();
      expect(substituted.docker.calls).toHaveLength(0);
    } finally {
      await substituted.cleanup();
    }
  });

  it("discovers and removes a full-id container after uncertain create", async () => {
    const fixture = await createRebuildFixture({ throwCreateRun: 1 });
    try {
      await expect(rebuildC6PackageFromSource(
        fixture.input,
        {
          dockerCommand: fixture.docker.command,
          quiescenceWait: async () => {},
        },
      )).rejects.toThrow("fixture create transport failure");
      expect(fixture.docker.count("rm")).toBe(1);
      expect(await exists(fixture.outputRoot)).toBe(false);
    } finally {
      await fixture.cleanup();
    }
  });

  it("retains the work root when an uncertain create remains invisible", async () => {
    const fixture = await createRebuildFixture({
      hideCreatedContainerFromPsQueries: 8,
      throwCreateRun: 1,
    });
    try {
      let caught: unknown;
      try {
        await rebuildC6PackageFromSource(
          fixture.input,
          {
            dockerCommand: fixture.docker.command,
            quiescenceWait: async () => {},
          },
        );
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(Error);
      const retained = (await readdir(fixture.root))
        .filter((entry) =>
          entry.startsWith(".goodmemory-c6-source-build-1-")
        );
      expect(retained).toHaveLength(1);
      const retainedPath = join(fixture.root, retained[0]!);
      expect(await exists(retainedPath)).toBe(true);
      expect((caught as Error).message).toContain(
        "Docker create outcome is uncertain; work root retained",
      );
      expect((caught as Error).message).toContain("containerName=");
      expect((caught as Error).message).toContain("ownershipNonce=");
      expect((caught as Error).message).toContain(
        `workRoot=${retainedPath}`,
      );
      expect(fixture.docker.count("ps")).toBe(8);
      expect(fixture.docker.count("rm")).toBe(0);
      expect(await exists(fixture.outputRoot)).toBe(false);
    } finally {
      await fixture.cleanup();
    }
  });

  it("retains exact work roots and closes output cleanup after a cache scan timeout", async () => {
    const fixture = await createRebuildFixture();
    try {
      let caught: unknown;
      try {
        await rebuildC6PackageFromSource(
          fixture.input,
          {
            cacheScanTimeoutMs: 0,
            dockerCommand: fixture.docker.command,
          },
        );
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(
        C6PackageSourceCacheScanTimeoutError,
      );
      const timeout =
        caught as C6PackageSourceCacheScanTimeoutError;
      const rootEntries = await readdir(fixture.root);
      const retainedWorkRoots = rootEntries
        .filter((entry) =>
          entry.startsWith(".goodmemory-c6-source-build-")
        )
        .sort()
        .map((entry) => join(fixture.root, entry));

      expect(retainedWorkRoots).toHaveLength(1);
      expect(timeout.phase).toBe("materialize");
      expect(timeout.timeoutMs).toBe(0);
      expect(timeout.root).toBe(join(retainedWorkRoots[0]!, "cache"));
      expect(timeout.retainedWorkRoots).toEqual(retainedWorkRoots);
      expect(timeout.message).toContain(
        `phase=materialize root=${timeout.root} timeoutMs=0`,
      );
      expect(timeout.message).toContain(
        `retainedWorkRoot=${retainedWorkRoots[0]}`,
      );
      expect(timeout.message).toContain("Action:");
      expect(await exists(retainedWorkRoots[0]!)).toBe(true);
      expect(await exists(fixture.outputRoot)).toBe(false);
      expect(
        await exists(`${fixture.outputRoot}.materialize.lock`),
      ).toBe(false);
      expect(rootEntries.some((entry) =>
        entry.startsWith(".output.staging-") ||
        entry.startsWith(".output.cleanup-")
      )).toBe(false);
      expect(fixture.docker.count("create")).toBe(0);
    } finally {
      await fixture.cleanup();
    }
  });

  it("refuses to clean an unowned container or an output directory replaced before publication", async () => {
    const foreignContainer = await createRebuildFixture({
      foreignOwnerRun: 1,
    });
    try {
      await expect(rebuildC6PackageFromSource(
        foreignContainer.input,
        { dockerCommand: foreignContainer.docker.command },
      )).rejects.toThrow("ownership inspect failed");
      expect(foreignContainer.docker.count("rm")).toBe(0);
      expect(await exists(foreignContainer.outputRoot)).toBe(false);
    } finally {
      await foreignContainer.cleanup();
    }

    const foreignWorkRoot = await createRebuildFixture({
      foreignWorkRootRun: 1,
    });
    try {
      await expect(rebuildC6PackageFromSource(
        foreignWorkRoot.input,
        { dockerCommand: foreignWorkRoot.docker.command },
      )).rejects.toThrow("ownership inspect failed");
      expect(foreignWorkRoot.docker.count("rm")).toBe(0);
      expect(await exists(foreignWorkRoot.outputRoot)).toBe(false);
    } finally {
      await foreignWorkRoot.cleanup();
    }

    const outputRace = await createRebuildFixture();
    const movedOwnedRoot = `${outputRace.outputRoot}-owned`;
    try {
      await expect(rebuildC6PackageFromSource(
        outputRace.input,
        {
          dockerCommand: outputRace.docker.command,
          onPhase: async (phase, context) => {
            if (phase !== "before-first-publish-write") {
              return;
            }
            await rename(context.outputRoot, movedOwnedRoot);
            await mkdir(context.outputRoot);
            await mkdir(join(context.outputRoot, "runs"));
            await writeFile(
              join(context.outputRoot, "runs", "foreign-marker"),
              "foreign\n",
            );
          },
        },
      )).rejects.toThrow("output root");
      expect(
        await readFile(
          join(outputRace.outputRoot, "runs", "foreign-marker"),
          "utf8",
        ),
      ).toBe("foreign\n");
      expect(await exists(movedOwnedRoot)).toBe(true);
    } finally {
      await rm(movedOwnedRoot, { force: true, recursive: true });
      await outputRace.cleanup();
    }
  });

  it("quarantines and rejects an output root replaced in the failed-cleanup check/use window", async () => {
    const fixture = await createRebuildFixture({ failRun: 2 });
    const movedOwnedRoot = `${fixture.outputRoot}-owned`;
    try {
      await expect(rebuildC6PackageFromSource(
        fixture.input,
        {
          dockerCommand: fixture.docker.command,
          onPhase: async (phase, context) => {
            if (phase !== "before-failure-cleanup-move") {
              return;
            }
            await rename(context.outputRoot, movedOwnedRoot);
            await mkdir(context.outputRoot);
            await writeFile(
              join(context.outputRoot, "foreign-marker"),
              "foreign\n",
            );
          },
        },
      )).rejects.toThrow("after atomic quarantine");

      const cleanupRoots = (await readdir(fixture.root))
        .filter((entry) => entry.startsWith(".output.cleanup-"));
      expect(cleanupRoots).toHaveLength(1);
      expect(
        await readFile(
          join(
            fixture.root,
            cleanupRoots[0]!,
            "owned-output",
            "foreign-marker",
          ),
          "utf8",
        ),
      ).toBe("foreign\n");
      expect(await exists(movedOwnedRoot)).toBe(true);
    } finally {
      await rm(movedOwnedRoot, { force: true, recursive: true });
      await fixture.cleanup();
    }
  });
});

async function validReceipt(): Promise<
  C6PackageSourceReproducibilityReceipt
> {
  const run = (id: 1 | 2) => ({
    exitCode: 0 as const,
    installedDependencyCount: 17,
    input: {
      bunLockSha256: "a".repeat(64),
      dependencyCache: {
        contentRootSha256:
          DEPENDENCY_CLOSURE.cacheContentRootSha256,
        directoryCount: 1,
        entryCount: 2,
        fileCount: 1,
        freshMaterialization: true as const,
        mountReadOnly: true as const,
      },
      packageJsonSha256: "b".repeat(64),
      sourceArchiveSha256: "c".repeat(64),
      sourceEntryManifestSha256: "d".repeat(64),
    },
    logs: {
      stderr: {
        path: `runs/${id}/build.stderr.log`,
        sha256: "e".repeat(64),
      },
      stdout: {
        path: `runs/${id}/build.stdout.log`,
        sha256: "f".repeat(64),
      },
    },
    output: {
      bytes: 42,
      packageVersion: "0.7.0",
      path: `runs/${id}/goodmemory-0.7.0.tgz`,
      sha256: PACKAGE_SHA256,
    },
    run: id,
    runtime: RUNTIME,
  });
  return {
    commands: {
      build: ["bun", "run", "build"],
      install: [
        "bun",
        "install",
        "--frozen-lockfile",
        "--ignore-scripts",
        "--cache-dir=/work/cache",
      ],
      pack: [
        "npm",
        "pack",
        "--ignore-scripts",
        "--pack-destination",
        "/work/output",
      ],
    },
    executor: {
      allCapabilitiesDropped: true,
      authority: "native-docker-cli",
      cleanHostEnvironment: true,
      cliMode: 0o755,
      cliPath: DOCKER_CLI_PATH,
      cliSha256: DOCKER_CLI_SHA256,
      containerUser: "501:20",
      daemonIdentityCryptographicallyAttested: false,
      daemonTrustBoundary:
        "explicit-unix-socket-daemon-not-cryptographically-attested",
      dockerServerVersion: "28.4.0",
      dockerSocketMountedIntoContainer: false,
      fixedPath: "/work/tool-bin:/usr/local/bin:/usr/bin:/bin",
      hostCredentialMountsAbsent: true,
      imageArchitecture: "amd64",
      imageId: `sha256:${IMAGE_SHA256}`,
      imageOperatingSystem: "linux",
      imageReference: IMAGE_REFERENCE,
      imageSha256: IMAGE_SHA256,
      kind: "docker",
      networkMode: "none",
      noNewPrivileges: true,
      npmConfigFilesForcedEmpty: true,
      numericUser: true,
      platform: "linux/amd64",
      rootFilesystemReadOnly: true,
      socketPath: DOCKER_SOCKET_PATH,
    },
    c6PackageOfflineClosureProven: false,
    dependencyClosure: {
      ...DEPENDENCY_CLOSURE,
      cacheDirectoryCount: 1,
      cacheEntryCount: 2,
      cacheFileCount: 1,
      cacheMountReadOnly: true,
      freshMaterializationCount: 2,
      materializedCachesInodeDistinct: true,
    },
    evidenceScope: "local-offline-source-build-observation",
    executionAuthenticated: false,
    executionMode: "offline-dependency-closure-source-build",
    externalIndependentAttestation: false,
    kind: "c6-package-source-reproducibility",
    liveOfflineBuildCount: 2,
    locallyExecutedLinuxBuild: true,
    networkDisabled: true,
    offlineDependencyClosureUsed: true,
    outcome: "passed",
    rawExecutionWitnessIncluded: false,
    runnerProtocolSha256: C6_PACKAGE_SOURCE_PROTOCOL_SHA256,
    runnerSource: await readC6PackageSourceRunnerClosure(),
    runnerObservedSameHostOfflineRebuild: true,
    runs: [run(1), run(2)],
    schemaVersion: 3,
    source: {
      archivePath: "source/source.tar",
      archiveSha256: "c".repeat(64),
      bunLockSha256: "a".repeat(64),
      commitSha: COMMIT_SHA,
      entryCount: 3,
      entryManifestPath: "source/source-tree.jsonl",
      entryManifestSha256: "d".repeat(64),
      packageJsonSha256: "b".repeat(64),
      runtimeIdentitySha256: RUNTIME_IDENTITY_SHA256,
      treeSha: TREE_SHA,
    },
    sourceBuildReproducible: false,
  };
}

interface RebuildFixture {
  cleanup: () => Promise<void>;
  docker: ReturnType<typeof createFakeDocker>;
  input: C6PackageSourceRebuildInput;
  outputRoot: string;
  root: string;
}

async function createRebuildFixture(options: {
  cacheMutationRun?: 1 | 2;
  duplicateEnvironmentRun?: 1 | 2;
  extraTmpfsRun?: 1 | 2;
  failRun?: 1 | 2;
  foreignOwnerRun?: 1 | 2;
  foreignWorkRootRun?: 1 | 2;
  hideCreatedContainerFromPsQueries?: number;
  isolationMutation?: {
    kind:
      | "cap-add"
      | "cap-drop"
      | "cgroupns"
      | "ipc"
      | "pid"
      | "security-extra"
      | "security-missing"
      | "userns"
      | "uts";
    run: 1 | 2;
  };
  installedDependencyCountRun2?: number;
  networkDriftRun?: 1 | 2;
  preBuildDockerServerVersion?: string;
  preBuildImageSha256?: string;
  privilegedRun?: 1 | 2;
  shortIdRun?: 1 | 2;
  throwCreateRun?: 1 | 2;
} = {}): Promise<RebuildFixture> {
  const root = await createTempDirectory("goodmemory-c6-source-rebuild-");
  const acquisitionCacheRoot = join(root, "acquisition-cache");
  const dependencyClosureRoot = join(root, "dependency-closure");
  const repositoryRoot = join(root, "repository");
  const packageFixtureRoot = join(root, "package-fixture");
  const packageRoot = join(packageFixtureRoot, "package");
  const outputRoot = join(root, "output");
  await Promise.all([
    mkdir(join(acquisitionCacheRoot, "registry"), { recursive: true }),
    mkdir(join(repositoryRoot, "src"), { recursive: true }),
    mkdir(join(packageRoot, "scripts"), { recursive: true }),
    mkdir(join(packageRoot, "dist", "bin"), { recursive: true }),
    mkdir(join(packageRoot, "dist", "host"), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(
      join(acquisitionCacheRoot, "registry", "fixture-package.bin"),
      "offline dependency bytes\n",
    ),
    writeFile(
      join(repositoryRoot, "package.json"),
      `${JSON.stringify({
        name: "goodmemory",
        scripts: { build: "true" },
        version: "0.7.0",
      })}\n`,
    ),
    writeFile(join(repositoryRoot, "bun.lock"), "lockfileVersion = 1\n"),
    writeFile(
      join(repositoryRoot, "src", "index.ts"),
      "export const fixture = true;\n",
    ),
    writeFile(
      join(packageRoot, "package.json"),
      `${JSON.stringify({
        name: "goodmemory",
        version: "0.7.0",
      })}\n`,
    ),
    ...[
      "scripts/goodmemory-cli.js",
      "scripts/goodmemory-mcp.js",
      "dist/bin/goodmemory-cli.js",
      "dist/bin/goodmemory-mcp.js",
      "dist/host/index.js",
    ].map((path) => writeFile(join(packageRoot, path), "export {};\n")),
  ]);
  await symlink("index.ts", join(repositoryRoot, "src", "link.ts"));
  await run(["git", "init", "--quiet"], repositoryRoot);
  await run(
    ["git", "config", "user.email", "c6@example.invalid"],
    repositoryRoot,
  );
  await run(
    ["git", "config", "user.name", "C6 Test"],
    repositoryRoot,
  );
  await run(["git", "add", "."], repositoryRoot);
  await run(
    ["git", "commit", "--quiet", "-m", "source fixture"],
    repositoryRoot,
  );
  const expectedCommitSha = await gitOutput(
    repositoryRoot,
    ["rev-parse", "HEAD"],
  );
  const expectedTreeSha = await gitOutput(
    repositoryRoot,
    ["rev-parse", "HEAD^{tree}"],
  );
  const packagePath = join(root, "goodmemory-0.7.0.tgz");
  await run([
    "tar",
    "-czf",
    packagePath,
    "-C",
    packageFixtureRoot,
    "package",
  ], root);
  const packageBytes = await readFile(packagePath);
  const dependencyClosure =
    await freezeC6PackageSourceDependencyClosure({
      acquisitionCacheRoot,
      outputRoot: dependencyClosureRoot,
    });
  const docker = createFakeDocker(packageBytes, options);
  return {
    cleanup: async () => {
      await rm(root, { force: true, recursive: true });
    },
    docker,
    input: {
      containerUser: "501:20",
      dependencyClosureExpected: {
        assetLockSha256: dependencyClosure.assetLockSha256,
        assetRootSha256: dependencyClosure.assetRootSha256,
        cacheArchiveSha256: dependencyClosure.cacheArchiveSha256,
        cacheContentRootSha256:
          dependencyClosure.cacheContentRootSha256,
        cacheManifestSha256:
          dependencyClosure.cacheManifestSha256,
      },
      dependencyClosureRoot,
      dockerAuthority: {
        cliMode: 0o755,
        cliPath: DOCKER_CLI_PATH,
        cliSha256: DOCKER_CLI_SHA256,
        socketPath: DOCKER_SOCKET_PATH,
      },
      expectedCommitSha,
      expectedImageSha256: IMAGE_SHA256,
      expectedPackageSha256: sha256(packageBytes),
      expectedTreeSha,
      outputRoot,
      repositoryRoot,
      runtime: RUNTIME,
      runtimeIdentitySha256: RUNTIME_IDENTITY_SHA256,
    },
    outputRoot,
    root,
  };
}

function createFakeDocker(
  packageBytes: Buffer,
  options: {
    cacheMutationRun?: 1 | 2;
    duplicateEnvironmentRun?: 1 | 2;
    extraTmpfsRun?: 1 | 2;
    failRun?: 1 | 2;
    foreignOwnerRun?: 1 | 2;
    foreignWorkRootRun?: 1 | 2;
    hideCreatedContainerFromPsQueries?: number;
    isolationMutation?: {
      kind:
        | "cap-add"
        | "cap-drop"
        | "cgroupns"
        | "ipc"
        | "pid"
        | "security-extra"
        | "security-missing"
        | "userns"
        | "uts";
      run: 1 | 2;
    };
    installedDependencyCountRun2?: number;
    networkDriftRun?: 1 | 2;
    preBuildDockerServerVersion?: string;
    preBuildImageSha256?: string;
    privilegedRun?: 1 | 2;
    shortIdRun?: 1 | 2;
    throwCreateRun?: 1 | 2;
  },
) {
  interface Container {
    exitCode: number;
    id: string;
    labels: Record<string, string>;
    name: string;
    removed: boolean;
    run: 1 | 2;
    user: string;
    workRoot: string;
  }
  const calls: C6PackageSourceDockerCommandInput[] = [];
  const containers = new Map<string, Container>();
  const createdIds: string[] = [];
  const createdLabels: Array<Record<string, string>> = [];
  let imageInspectCount = 0;
  let psQueryCount = 0;
  let versionProbeCount = 0;
  const command = async (
    input: C6PackageSourceDockerCommandInput,
  ): Promise<C6PackageSourceCommandResult> => {
    if (
      input.command[0] !== DOCKER_CLI_PATH ||
      JSON.stringify(Object.keys(input.environment).sort()) !==
        JSON.stringify([
          "DOCKER_CONFIG",
          "DOCKER_HOST",
          "HOME",
          "LANG",
          "LC_ALL",
          "PATH",
        ]) ||
      input.environment.DOCKER_HOST !==
        `unix://${DOCKER_SOCKET_PATH}`
    ) {
      throw new Error("fake Docker authority drifted");
    }
    calls.push(input);
    const parts = input.command;
    let result: C6PackageSourceCommandResult;
    if (parts[1] === "version") {
      versionProbeCount += 1;
      result = {
        exitCode: 0,
        stderr: "",
        stdout: `${
          versionProbeCount > 1
            ? options.preBuildDockerServerVersion ?? "28.4.0"
            : "28.4.0"
        }\n`,
      };
    } else if (parts[1] === "image" && parts[2] === "inspect") {
      imageInspectCount += 1;
      result = {
        exitCode: 0,
        stderr: "",
        stdout: JSON.stringify([{
          Architecture: "amd64",
          Id: `sha256:${
            imageInspectCount > 1
              ? options.preBuildImageSha256 ?? IMAGE_SHA256
              : IMAGE_SHA256
          }`,
          Os: "linux",
        }]),
      };
    } else if (parts[1] === "create") {
      const labels = Object.fromEntries(
        optionValues(parts, "--label=").map((value) => {
          const separator = value.indexOf("=");
          return [value.slice(0, separator), value.slice(separator + 1)];
        }),
      );
      const run = Number(
        labels["com.goodmemory.c6.package-source.run"],
      ) as 1 | 2;
      const sourceMount = parseMounts(parts).find((mount) =>
        mount.dst === "/work/source"
      );
      if (sourceMount === undefined) {
        throw new Error("fake Docker source mount is missing");
      }
      const id = String(run).repeat(64);
      const container: Container = {
        exitCode: 0,
        id,
        labels,
        name: requiredOption(parts, "--name="),
        removed: false,
        run,
        user: requiredOption(parts, "--user="),
        workRoot: join(sourceMount.src, ".."),
      };
      containers.set(id, container);
      createdIds.push(id);
      createdLabels.push(labels);
      if (options.throwCreateRun === run) {
        throw new Error("fixture create transport failure");
      }
      result = {
        exitCode: 0,
        stderr: "",
        stdout: options.shortIdRun === run
          ? `${String(run).repeat(12)}\n`
          : `${id}\n`,
      };
    } else if (parts[1] === "ps") {
      psQueryCount += 1;
      const visible = psQueryCount >
        (options.hideCreatedContainerFromPsQueries ?? 0);
      const discovered = visible
        ? [...containers.values()].filter((container) =>
          !container.removed
        )
        : [];
      result = {
        exitCode: 0,
        stderr: "",
        stdout: `${discovered.map((container) =>
          container.id
        ).join("\n")}${discovered.length > 0 ? "\n" : ""}`,
      };
    } else if (parts[1] === "inspect") {
      const container = containers.get(parts[2]!);
      result = container === undefined || container.removed
        ? {
          exitCode: 1,
          stderr: `Error: No such object: ${parts[2]}\n`,
          stdout: "",
        }
        : {
          exitCode: 0,
          stderr: "",
          stdout: JSON.stringify([fakeContainerInspect(
            container,
            options.foreignOwnerRun === container.run,
            options.foreignWorkRootRun === container.run,
            options.networkDriftRun === container.run,
            options.privilegedRun === container.run,
            options.duplicateEnvironmentRun === container.run,
            options.extraTmpfsRun === container.run,
            options.isolationMutation?.run === container.run
              ? options.isolationMutation.kind
              : undefined,
          )]),
        };
    } else if (parts[1] === "start") {
      const container = containers.get(parts.at(-1)!);
      if (container === undefined || container.removed) {
        result = {
          exitCode: 1,
          stderr: "No such container\n",
          stdout: "",
        };
      } else if (options.failRun === container.run) {
        container.exitCode = 1;
        result = {
          exitCode: 1,
          stderr: `fixture run ${container.run} failed\n`,
          stdout: "",
        };
      } else {
        await writeFakeObservedExecution(
          container.workRoot,
          packageBytes,
          container.run === 2
            ? options.installedDependencyCountRun2 ?? 17
            : 17,
        );
        if (options.cacheMutationRun === container.run) {
          await writeFile(
            join(container.workRoot, "cache", "mutated-after-run"),
            "network drift simulation\n",
          );
        }
        result = {
          exitCode: 0,
          stderr: "",
          stdout: `fixture run ${container.run}\n`,
        };
      }
    } else if (parts[1] === "rm") {
      const container = containers.get(parts.at(-1)!);
      if (container === undefined || container.removed) {
        result = {
          exitCode: 1,
          stderr: "No such container\n",
          stdout: "",
        };
      } else {
        container.removed = true;
        result = {
          exitCode: 0,
          stderr: "",
          stdout: `${container.id}\n`,
        };
      }
    } else {
      throw new Error(`unexpected fake Docker command ${parts.join(" ")}`);
    }
    if (!input.allowFailure && result.exitCode !== 0) {
      throw new Error(`fake Docker command failed: ${input.label}`);
    }
    return result;
  };
  return {
    calls,
    command,
    count(
      operation:
        | "create"
        | "image"
        | "inspect"
        | "ps"
        | "rm"
        | "start"
        | "version",
    ): number {
      return calls.filter((call) => call.command[1] === operation).length;
    },
    createdIds,
    createdLabels,
  };
}

function fakeContainerInspect(
  container: {
    exitCode: number;
    id: string;
    labels: Record<string, string>;
    name: string;
    run: 1 | 2;
    user: string;
    workRoot: string;
  },
  foreignOwner: boolean,
  foreignWorkRoot: boolean,
  networkDrift: boolean,
  privileged: boolean,
  duplicateEnvironment: boolean,
  extraTmpfs: boolean,
  isolationMutation:
    | "cap-add"
    | "cap-drop"
    | "cgroupns"
    | "ipc"
    | "pid"
    | "security-extra"
    | "security-missing"
    | "userns"
    | "uts"
    | undefined,
) {
  const labels = {
    ...container.labels,
    ...(foreignOwner
      ? {
        "com.goodmemory.c6.package-source.owner": "foreign-owner",
      }
      : {}),
  };
  return {
    Config: {
      Cmd: ["/work/run-build.sh"],
      Entrypoint: ["/bin/sh"],
      Env: [
        "HOME=/tmp/home",
        "NPM_CONFIG_GLOBALCONFIG=/tmp/empty-global-npmrc",
        "NPM_CONFIG_USERCONFIG=/tmp/empty-user-npmrc",
        "npm_config_update_notifier=false",
        "PATH=/work/tool-bin:/usr/local/bin:/usr/bin:/bin",
        ...(duplicateEnvironment ? ["HOME=/foreign"] : []),
      ],
      Labels: labels,
      User: container.user,
      WorkingDir: "/work/source",
    },
    HostConfig: {
      CapAdd: isolationMutation === "cap-add" ? ["SYS_ADMIN"] : [],
      CapDrop: isolationMutation === "cap-drop"
        ? ["NET_RAW"]
        : ["ALL"],
      CgroupnsMode: isolationMutation === "cgroupns"
        ? "host"
        : "private",
      DeviceRequests: [],
      Devices: [],
      IpcMode: isolationMutation === "ipc" ? "host" : "private",
      NetworkMode: networkDrift ? "bridge" : "none",
      PidMode: isolationMutation === "pid" ? "host" : "",
      Privileged: privileged,
      ReadonlyRootfs: true,
      SecurityOpt: isolationMutation === "security-missing"
        ? []
        : isolationMutation === "security-extra"
        ? ["no-new-privileges", "label=disable"]
        : ["no-new-privileges"],
      Tmpfs: {
        "/tmp": "rw,nosuid,nodev,size=536870912",
        ...(extraTmpfs
          ? { "/unexpected": "rw,nosuid,nodev,size=4096" }
          : {}),
      },
      UTSMode: isolationMutation === "uts" ? "host" : "",
      UsernsMode: isolationMutation === "userns" ? "host" : "",
    },
    Id: container.id,
    Image: `sha256:${IMAGE_SHA256}`,
    Mounts: ([
      ["cache", "/work/cache", false],
      ["observed", "/work/observed", true],
      ["output", "/work/output", true],
      ["run-build.sh", "/work/run-build.sh", false],
      ["source", "/work/source", true],
      ["tool-bin", "/work/tool-bin", false],
    ] as const).map(([source, destination, writable]) => ({
      Destination: destination,
      RW: writable,
      Source: foreignWorkRoot && destination === "/work/source"
        ? `${join(container.workRoot, source)}-foreign`
        : join(container.workRoot, source),
      Type: "bind",
    })),
    Name: `/${container.name}`,
    State: {
      ExitCode: container.exitCode,
      Running: false,
    },
  };
}

async function writeFakeObservedExecution(
  workRoot: string,
  packageBytes: Buffer,
  installedDependencyCount: number,
): Promise<void> {
  const [bunLock, packageJson, bunxShim] = await Promise.all([
    readFile(join(workRoot, "source", "bun.lock")),
    readFile(join(workRoot, "source", "package.json")),
    readFile(join(workRoot, "tool-bin", "bunx")),
  ]);
  const values: Record<string, string> = {
    "bun-lock-after": sha256(bunLock),
    "bun-lock-before": sha256(bunLock),
    "bun-sha256": RUNTIME.bun.executableSha256,
    "bun-version": RUNTIME.bun.version,
    "bunx-shim-sha256": sha256(bunxShim),
    "bunx-version": RUNTIME.bun.version,
    "installed-dependency-count": String(installedDependencyCount),
    "node-sha256": RUNTIME.node.executableSha256,
    "node-version": RUNTIME.node.version,
    "npm-cli-sha256": RUNTIME.npm.cliSha256,
    "npm-launcher-sha256": RUNTIME.npm.launcherSha256,
    "npm-version": RUNTIME.npm.version,
    "package-filename": "goodmemory-0.7.0.tgz",
    "package-json-after": sha256(packageJson),
    "package-json-before": sha256(packageJson),
  };
  await Promise.all([
    ...Object.entries(values).map(([name, value]) =>
      writeFile(join(workRoot, "observed", name), `${value}\n`)
    ),
    writeFile(
      join(workRoot, "output", "goodmemory-0.7.0.tgz"),
      packageBytes,
    ),
  ]);
}

function parseMounts(
  command: readonly string[],
): Array<Record<string, string>> {
  return optionValues(command, "--mount=").map((mount) =>
    Object.fromEntries(mount.split(",").map((part) => {
      const separator = part.indexOf("=");
      return separator < 0
        ? [part, "true"]
        : [part.slice(0, separator), part.slice(separator + 1)];
    }))
  );
}

function optionValues(command: readonly string[], prefix: string): string[] {
  return command
    .filter((part) => part.startsWith(prefix))
    .map((part) => part.slice(prefix.length));
}

function requiredOption(
  command: readonly string[],
  prefix: string,
): string {
  const values = optionValues(command, prefix);
  if (values.length !== 1) {
    throw new Error(`missing fake Docker option ${prefix}`);
  }
  return values[0]!;
}

async function verifyFixtureReceipt(
  fixture: RebuildFixture,
  path: string,
  receiptSha256: string,
) {
  return verifyC6PackageSourceReproducibilityReceipt({
    expected: {
      commitSha: fixture.input.expectedCommitSha,
      containerUser: fixture.input.containerUser,
      dependencyClosure: fixture.input.dependencyClosureExpected,
      dockerAuthority: fixture.input.dockerAuthority,
      imageSha256: fixture.input.expectedImageSha256,
      packageSha256: fixture.input.expectedPackageSha256,
      runtime: fixture.input.runtime,
      runtimeIdentitySha256: fixture.input.runtimeIdentitySha256,
      treeSha: fixture.input.expectedTreeSha,
    },
    expectedReceiptSha256: receiptSha256,
    path,
  });
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return false;
    }
    throw error;
  }
}

async function createTempDirectory(prefix: string): Promise<string> {
  return mkdtemp(join(await realpath(tmpdir()), prefix));
}

async function gitOutput(
  cwd: string,
  args: string[],
): Promise<string> {
  return (await commandOutput(["git", ...args], cwd)).trim();
}

async function tarOutput(path: string, entry: string): Promise<string> {
  return commandOutput(["tar", "-xOf", path, entry]);
}

async function run(command: string[], cwd: string): Promise<void> {
  await commandOutput(command, cwd);
}

async function commandOutput(
  command: string[],
  cwd?: string,
): Promise<string> {
  const child = Bun.spawn({
    cmd: command,
    cwd,
    stderr: "pipe",
    stdout: "pipe",
  });
  const [exitCode, stderr, stdout] = await Promise.all([
    child.exited,
    new Response(child.stderr).text(),
    new Response(child.stdout).text(),
  ]);
  if (exitCode !== 0) {
    throw new Error(stderr);
  }
  return stdout;
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
