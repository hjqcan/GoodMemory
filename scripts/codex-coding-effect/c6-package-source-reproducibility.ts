import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import {
  basename,
  join,
} from "node:path";

import { z } from "zod";

import { readC6StableRegularFile } from "./c6-asset-lock";
import {
  buildSourceEntryManifest,
  createC6PackageSourceArchive,
  readStableSourceFile,
} from "./c6-package-source-archive";
import type {
  C6PackageSourceArchiveResult,
} from "./c6-package-source-archive";
import {
  assertOutputReservation,
  publishStagingRoot,
  quarantineAndRemoveOutputReservation,
  releaseOutputReservation,
  reserveOutputRoot,
  writeAtomicExclusive,
} from "./c6-package-source-artifact-publication";
import type {
  OutputReservation,
} from "./c6-package-source-artifact-publication";
import {
  C6PackageSourceCacheScanTimeoutError,
  loadC6PackageSourceDependencyClosure,
  materializeC6PackageSourceDependencyCache,
  verifyC6PackageSourceDependencyCachePair,
  verifyC6PackageSourceDependencyClosure,
} from "./c6-package-source-dependency-closure";
import type {
  C6PackageSourceCacheScanProgress,
} from "./c6-package-source-dependency-closure";
import {
  C6_DOCKER_BUILD_TIMEOUT_MS,
  C6_DOCKER_COMMAND_TIMEOUT_MS,
  C6_PACKAGE_SOURCE_FIXED_PATH,
  assertDockerContainerIsolation,
  buildC6PackageSourceBuildDockerCreateCommand,
  cleanupDockerCommandAuthority,
  cleanupUncertainDockerCreate,
  containerName,
  createDockerCommandAuthority,
  inspectDockerContainer,
  inspectDockerImage,
  removeDockerContainer,
  requireDockerServer,
  runDockerCommand,
  uncertainDockerCreateError,
  validateTerminalDockerAuthority,
  waitFor,
} from "./c6-package-source-docker-authority";
import type {
  C6PackageSourceCommandResult,
  C6PackageSourceDockerCommandInput,
  DockerCommandAuthority,
  DockerContainerOwnership,
  DockerContainerOwnershipExpectation,
} from "./c6-package-source-docker-authority";
import { inspectC6PackageTarball } from "./c6-package";
import {
  C6_PACKAGE_SOURCE_BUILD_COMMAND,
  C6_PACKAGE_SOURCE_BUILD_SCRIPT,
  C6_PACKAGE_SOURCE_BUNX_SHIM,
  C6_PACKAGE_SOURCE_INSTALL_COMMAND,
  C6_PACKAGE_SOURCE_PACK_COMMAND,
  C6_PACKAGE_SOURCE_PROTOCOL_SHA256,
  assertC6PackageSourceBuildOutputs,
  assertC6PackageSourceReceiptSemantics,
  inputSchema,
  parseC6PackageSourceRuntimeIdentity,
  readC6PackageSourceRunnerClosure,
  receiptSchema,
  runSchema,
  runtimeSchema,
  serializeC6PackageSourceReproducibilityReceipt,
  verifyC6PackageSourceReproducibilityReceipt,
} from "./c6-package-source-receipt-verifier";
import type {
  C6PackageSourceReceiptVerification,
  C6PackageSourceReproducibilityReceipt,
  C6PackageSourceRunnerClosure,
  C6PackageSourceRuntimeIdentity,
} from "./c6-package-source-receipt-verifier";

export {
  C6_PACKAGE_SOURCE_BUILD_COMMAND,
  C6_PACKAGE_SOURCE_INSTALL_COMMAND,
  C6_PACKAGE_SOURCE_PACK_COMMAND,
  C6_PACKAGE_SOURCE_PROTOCOL_SHA256,
  C6PackageSourceCacheScanTimeoutError,
  assertC6PackageSourceBuildOutputs,
  buildC6PackageSourceBuildDockerCreateCommand,
  createC6PackageSourceArchive,
  parseC6PackageSourceRuntimeIdentity,
  readC6PackageSourceRunnerClosure,
  serializeC6PackageSourceReproducibilityReceipt,
  verifyC6PackageSourceReproducibilityReceipt,
};
export type {
  C6PackageSourceArchiveResult,
  C6PackageSourceCommandResult,
  C6PackageSourceDockerCommandInput,
  C6PackageSourceReceiptVerification,
  C6PackageSourceReproducibilityReceipt,
  C6PackageSourceRunnerClosure,
  C6PackageSourceRuntimeIdentity,
};

const packageSchema = z.object({
  name: z.literal("goodmemory"),
  version: z.string().min(1),
}).passthrough();

export type C6PackageSourceRebuildInput = z.infer<typeof inputSchema>;

export interface C6PackageSourceRebuildResult {
  c6PackageOfflineClosureProven: false;
  evidenceScope: "local-offline-source-build-observation";
  executorAuthority: "native-docker-cli" | "injected-test-seam";
  executionAuthenticated: false;
  executionMode: "offline-dependency-closure-source-build";
  externalIndependentAttestation: false;
  liveOfflineBuildCount: 0 | 2;
  locallyExecutedLinuxBuild: boolean;
  networkDisabled: true;
  offlineDependencyClosureUsed: true;
  outputRoot: string;
  rawExecutionWitnessIncluded: false;
  receiptPath: string;
  receiptSha256: string;
  runnerObservedSameHostOfflineRebuild: boolean;
  sourceBuildReproducible: false;
}

export interface C6PackageSourceRebuildDependencies {
  cacheScanTimeoutMs?: number;
  dockerCommand?: (
    input: C6PackageSourceDockerCommandInput,
  ) => Promise<C6PackageSourceCommandResult>;
  quiescenceWait?: (milliseconds: number) => Promise<void>;
  onCacheScanProgress?: (
    stage: "materialize" | "post-build" | "pre-build",
    progress: C6PackageSourceCacheScanProgress,
  ) => void;
  onPhase?: (
    phase:
      | "after-cache-materialization"
      | "before-publish"
      | "before-first-publish-write"
      | "before-receipt"
      | "after-receipt"
      | "before-failure-cleanup"
      | "before-failure-cleanup-move",
    context: {
      cacheRoots?: readonly [string, string];
      outputRoot: string;
    },
  ) => Promise<void> | void;
}

export async function rebuildC6PackageFromSource(
  rawInput: C6PackageSourceRebuildInput,
  dependencies: C6PackageSourceRebuildDependencies = {},
): Promise<C6PackageSourceRebuildResult> {
  const input = inputSchema.parse(rawInput);
  const imageReference = `sha256:${input.expectedImageSha256}`;
  const executorAuthority = dependencies.dockerCommand === undefined
    ? "native-docker-cli"
    : "injected-test-seam";
  const liveExecution = executorAuthority === "native-docker-cli";
  const onCacheScanProgress = dependencies.onCacheScanProgress ??
    (liveExecution
      ? (
        stage: "materialize" | "post-build" | "pre-build",
        progress: C6PackageSourceCacheScanProgress,
      ) => {
        console.error([
          "[c6-package-source] cache",
          `stage=${stage}`,
          `phase=${progress.phase}`,
          `root=${progress.rootIndex}`,
          `status=${progress.status}`,
          `entries=${progress.entriesScanned}`,
        ].join(" "));
      }
      : undefined);
  const dependencyClosure =
    await loadC6PackageSourceDependencyClosure({
      closureRoot: input.dependencyClosureRoot,
      expected: input.dependencyClosureExpected,
    });
  const docker = await createDockerCommandAuthority({
    input: input.dockerAuthority,
    live: liveExecution,
    outputRoot: input.outputRoot,
    quiescenceWait: dependencies.quiescenceWait ?? waitFor,
    runner: dependencies.dockerCommand ?? runDockerCommand,
  });
  let reservation: OutputReservation;
  try {
    reservation = await reserveOutputRoot(input.outputRoot);
  } catch (error) {
    await cleanupDockerCommandAuthority(docker);
    throw error;
  }

  try {
    let completed = false;
    let retainWorkRoots = false;
    let stagingRoot: string | undefined;
    const workRoots: string[] = [];
    try {
      stagingRoot = await mkdtemp(join(
        reservation.parent,
        `.${basename(reservation.outputRoot)}.staging-`,
      ));
      const sourceOutputRoot = join(stagingRoot, "source");
      const runsOutputRoot = join(stagingRoot, "runs");
      await Promise.all([
        mkdir(sourceOutputRoot, { mode: 0o700 }),
        mkdir(runsOutputRoot, { mode: 0o700 }),
      ]);
      const archivePath = join(sourceOutputRoot, "source.tar");
      const manifestPath = join(sourceOutputRoot, "source-tree.jsonl");
      const source = await createC6PackageSourceArchive({
        archivePath,
        expectedCommitSha: input.expectedCommitSha,
        expectedTreeSha: input.expectedTreeSha,
        manifestPath,
        repositoryRoot: input.repositoryRoot,
      });
      const packageMetadata = packageSchema.parse(parseJsonText(
        await extractArchiveText(archivePath, "package.json"),
        "archived source package.json",
      ));
      const runnerSource = await readC6PackageSourceRunnerClosure();
      const dockerServerVersion = await requireDockerServer(docker);
      const image = await inspectDockerImage(
        imageReference,
        input.expectedImageSha256,
        docker,
      );

      const preparedRuns = [] as PreparedSourceBuild[];
      for (const run of [1, 2] as const) {
        const workRoot = await mkdtemp(join(
          reservation.parent,
          `.goodmemory-c6-source-build-${run}-`,
        ));
        workRoots.push(workRoot);
        await prepareSourceBuildWorkRoot({
          archivePath,
          source,
          workRoot,
        });
        const cacheRoot = join(workRoot, "cache");
        await mkdir(cacheRoot, { mode: 0o755 });
        const cache =
          await materializeC6PackageSourceDependencyCache({
            closureRoot: dependencyClosure.closureRoot,
            expected: input.dependencyClosureExpected,
            outputRoot: cacheRoot,
          }, {
            onProgress: onCacheScanProgress === undefined
              ? undefined
              : (progress) => {
                onCacheScanProgress("materialize", progress);
              },
            rootIndex: run,
            scanTimeoutMs: dependencies.cacheScanTimeoutMs,
          });
        preparedRuns.push({ cache, cacheRoot, run, workRoot });
      }
      const cacheRoots = [
        preparedRuns[0]!.cacheRoot,
        preparedRuns[1]!.cacheRoot,
      ] as const;
      await dependencies.onPhase?.("after-cache-materialization", {
        cacheRoots,
        outputRoot: reservation.outputRoot,
      });
      const ownershipNonces = [randomUUID(), randomUUID()] as const;
      const runResults = [] as BuildRunResult[];
      await verifyC6PackageSourceDependencyCachePair({
        expectedContentRootSha256:
          input.dependencyClosureExpected.cacheContentRootSha256,
        roots: cacheRoots,
      }, {
        betweenScans: async () => {
          await validateTerminalDockerAuthority(docker);
          const preBuildDockerServerVersion =
            await requireDockerServer(docker);
          const preBuildImage = await inspectDockerImage(
            imageReference,
            input.expectedImageSha256,
            docker,
          );
          if (preBuildDockerServerVersion !== dockerServerVersion) {
            throw new Error(
              "C6 source build Docker server version drifted before build",
            );
          }
          for (const prepared of preparedRuns) {
            try {
              runResults.push(await executeSourceBuild({
                containerUser: input.containerUser,
                docker,
                expectedImageSha256: input.expectedImageSha256,
                expectedPackageSha256: input.expectedPackageSha256,
                expectedRuntime: input.runtime,
                imageId: preBuildImage.Id,
                imageReference,
                onCleanupFailure: () => {
                  retainWorkRoots = true;
                },
                outputRoot: runsOutputRoot,
                ownershipNonce: ownershipNonces[prepared.run - 1],
                packageVersion: packageMetadata.version,
                prepared,
                source,
              }));
            } catch (error) {
              retainWorkRoots = true;
              throw error;
            }
          }
        },
        onProgress: onCacheScanProgress === undefined
          ? undefined
          : (progress) => {
            onCacheScanProgress(
              progress.phase === "initial"
                ? "pre-build"
                : "post-build",
              progress,
            );
          },
        scanTimeoutMs: dependencies.cacheScanTimeoutMs,
      });
      const firstRun = runResults[0]!;
      const secondRun = runResults[1]!;
      assertC6PackageSourceBuildOutputs({
        expectedPackageSha256: input.expectedPackageSha256,
        first: firstRun.packageBytes,
        second: secondRun.packageBytes,
      });
      if (
        firstRun.receipt.installedDependencyCount !==
          secondRun.receipt.installedDependencyCount
      ) {
        throw new Error(
          "C6 source build installed dependency counts differ",
        );
      }
      await verifyC6PackageSourceDependencyClosure({
        closureRoot: dependencyClosure.closureRoot,
        expected: input.dependencyClosureExpected,
      });
      await validateTerminalDockerAuthority(docker);
      const runnerSourceAfter =
        await readC6PackageSourceRunnerClosure();
      if (!sameJson(runnerSourceAfter, runnerSource)) {
        throw new Error(
          "C6 package source runner closure drifted during execution",
        );
      }

      const receipt = receiptSchema.parse({
        commands: {
          build: [...C6_PACKAGE_SOURCE_BUILD_COMMAND],
          install: [...C6_PACKAGE_SOURCE_INSTALL_COMMAND],
          pack: [...C6_PACKAGE_SOURCE_PACK_COMMAND],
        },
        executor: {
          allCapabilitiesDropped: true,
          authority: executorAuthority,
          cleanHostEnvironment: true,
          cliMode: docker.cli.mode,
          cliPath: docker.cli.path,
          cliSha256: docker.cli.sha256,
          containerUser: input.containerUser,
          daemonIdentityCryptographicallyAttested: false,
          daemonTrustBoundary:
            "explicit-unix-socket-daemon-not-cryptographically-attested",
          dockerServerVersion,
          dockerSocketMountedIntoContainer: false,
          fixedPath: C6_PACKAGE_SOURCE_FIXED_PATH,
          hostCredentialMountsAbsent: true,
          imageArchitecture: image.Architecture,
          imageId: image.Id,
          imageOperatingSystem: image.Os,
          imageReference,
          imageSha256: input.expectedImageSha256,
          kind: "docker",
          networkMode: "none",
          noNewPrivileges: true,
          npmConfigFilesForcedEmpty: true,
          numericUser: true,
          platform: "linux/amd64",
          rootFilesystemReadOnly: true,
          socketPath: docker.socket.path,
        },
        c6PackageOfflineClosureProven: false,
        dependencyClosure: {
          ...input.dependencyClosureExpected,
          cacheDirectoryCount: dependencyClosure.cacheDirectoryCount,
          cacheEntryCount: dependencyClosure.cacheEntryCount,
          cacheFileCount: dependencyClosure.cacheFileCount,
          cacheMountReadOnly: true,
          freshMaterializationCount: 2,
          materializedCachesInodeDistinct: true,
        },
        evidenceScope: "local-offline-source-build-observation",
        executionAuthenticated: false,
        executionMode: "offline-dependency-closure-source-build",
        externalIndependentAttestation: false,
        kind: "c6-package-source-reproducibility",
        liveOfflineBuildCount: liveExecution ? 2 : 0,
        locallyExecutedLinuxBuild: liveExecution,
        networkDisabled: true,
        offlineDependencyClosureUsed: true,
        outcome: "passed",
        rawExecutionWitnessIncluded: false,
        runnerProtocolSha256: C6_PACKAGE_SOURCE_PROTOCOL_SHA256,
        runnerSource,
        runnerObservedSameHostOfflineRebuild: liveExecution,
        runs: [firstRun.receipt, secondRun.receipt],
        schemaVersion: 3,
        source: {
          archivePath: "source/source.tar",
          archiveSha256: source.archiveSha256,
          bunLockSha256: source.bunLockSha256,
          commitSha: source.commitSha,
          entryCount: source.entryCount,
          entryManifestPath: "source/source-tree.jsonl",
          entryManifestSha256: source.entryManifestSha256,
          packageJsonSha256: source.packageJsonSha256,
          runtimeIdentitySha256: input.runtimeIdentitySha256,
          treeSha: source.treeSha,
        },
        sourceBuildReproducible: false,
      });
      assertC6PackageSourceReceiptSemantics(receipt, {
        commitSha: input.expectedCommitSha,
        containerUser: input.containerUser,
        dependencyClosure: input.dependencyClosureExpected,
        dockerAuthority: input.dockerAuthority,
        imageSha256: input.expectedImageSha256,
        packageSha256: input.expectedPackageSha256,
        runnerSource,
        runtime: input.runtime,
        runtimeIdentitySha256: input.runtimeIdentitySha256,
        treeSha: input.expectedTreeSha,
      });

      await dependencies.onPhase?.("before-publish", {
        outputRoot: reservation.outputRoot,
      });
      await assertOutputReservation(
        reservation,
        "before artifact publication",
      );
      await publishStagingRoot(
        stagingRoot,
        reservation,
        async () => dependencies.onPhase?.(
          "before-first-publish-write",
          { outputRoot: reservation.outputRoot },
        ),
      );
      stagingRoot = undefined;
      await dependencies.onPhase?.("before-receipt", {
        outputRoot: reservation.outputRoot,
      });
      await assertOutputReservation(
        reservation,
        "before receipt publication",
      );
      const receiptPath = join(reservation.outputRoot, "receipt.json");
      const receiptBytes =
        serializeC6PackageSourceReproducibilityReceipt(receipt);
      await writeAtomicExclusive(receiptPath, receiptBytes, 0o600);
      await dependencies.onPhase?.("after-receipt", {
        outputRoot: reservation.outputRoot,
      });
      await assertOutputReservation(
        reservation,
        "after receipt publication",
      );
      const receiptSha256 = sha256(receiptBytes);
      await verifyC6PackageSourceReproducibilityReceipt({
        expected: {
          commitSha: input.expectedCommitSha,
          containerUser: input.containerUser,
          dependencyClosure: input.dependencyClosureExpected,
          dockerAuthority: input.dockerAuthority,
          imageSha256: input.expectedImageSha256,
          packageSha256: input.expectedPackageSha256,
          runtime: input.runtime,
          runtimeIdentitySha256: input.runtimeIdentitySha256,
          treeSha: input.expectedTreeSha,
        },
        expectedReceiptSha256: receiptSha256,
        path: receiptPath,
      });
      await assertOutputReservation(
        reservation,
        "after persisted artifact verification",
      );
      completed = true;
      return {
        c6PackageOfflineClosureProven: false,
        evidenceScope: "local-offline-source-build-observation",
        executorAuthority,
        executionAuthenticated: false,
        executionMode: "offline-dependency-closure-source-build",
        externalIndependentAttestation: false,
        liveOfflineBuildCount: liveExecution ? 2 : 0,
        locallyExecutedLinuxBuild: liveExecution,
        networkDisabled: true,
        offlineDependencyClosureUsed: true,
        outputRoot: reservation.outputRoot,
        rawExecutionWitnessIncluded: false,
        receiptPath,
        receiptSha256,
        runnerObservedSameHostOfflineRebuild: liveExecution,
        sourceBuildReproducible: false,
      };
    } catch (error) {
      if (error instanceof C6PackageSourceCacheScanTimeoutError) {
        retainWorkRoots = true;
        throw new C6PackageSourceCacheScanTimeoutError({
          phase: error.phase,
          retainedWorkRoots: workRoots,
          root: error.root,
          timeoutMs: error.timeoutMs,
        });
      }
      if (retainWorkRoots) {
        throw retainedSourceBuildFailure(error, workRoots);
      }
      throw error;
    } finally {
      try {
        if (!retainWorkRoots) {
          for (const workRoot of workRoots.splice(0)) {
            await rm(workRoot, { force: true, recursive: true });
          }
        }
        if (!completed) {
          if (stagingRoot !== undefined) {
            await rm(stagingRoot, { force: true, recursive: true });
            stagingRoot = undefined;
          }
          await dependencies.onPhase?.("before-failure-cleanup", {
            outputRoot: reservation.outputRoot,
          });
          await assertOutputReservation(
            reservation,
            "before failed materialization cleanup",
          );
          await dependencies.onPhase?.(
            "before-failure-cleanup-move",
            { outputRoot: reservation.outputRoot },
          );
          await quarantineAndRemoveOutputReservation(reservation);
        }
      } finally {
        await releaseOutputReservation(reservation);
      }
    }
  } finally {
    await cleanupDockerCommandAuthority(docker);
  }
}


interface BuildRunResult {
  packageBytes: Buffer;
  receipt: z.infer<typeof runSchema>;
}

interface PreparedSourceBuild {
  cache: Awaited<
    ReturnType<typeof materializeC6PackageSourceDependencyCache>
  >;
  cacheRoot: string;
  run: 1 | 2;
  workRoot: string;
}

async function executeSourceBuild(input: {
  containerUser: string;
  docker: DockerCommandAuthority;
  expectedImageSha256: string;
  expectedPackageSha256: string;
  expectedRuntime: C6PackageSourceRuntimeIdentity;
  imageId: string;
  imageReference: string;
  ownershipNonce: string;
  outputRoot: string;
  onCleanupFailure: () => void;
  packageVersion: string;
  prepared: PreparedSourceBuild;
  source: C6PackageSourceArchiveResult;
}): Promise<BuildRunResult> {
  const { run, workRoot } = input.prepared;
  const createCommand =
    buildC6PackageSourceBuildDockerCreateCommand({
      containerUser: input.containerUser,
      dockerCliPath: input.docker.cli.path,
      expectedImageSha256: input.expectedImageSha256,
      imageReference: input.imageReference,
      ownershipNonce: input.ownershipNonce,
      run,
      workRoot,
    });
  const ownershipExpectation: DockerContainerOwnershipExpectation = {
    imageId: input.imageId,
    name: containerName(workRoot, run, input.ownershipNonce),
    ownershipNonce: input.ownershipNonce,
    run,
    user: input.containerUser,
    workRoot,
  };
  let created: C6PackageSourceCommandResult;
  try {
    created = await input.docker.runner({
      allowFailure: false,
      command: createCommand,
      environment: input.docker.environment,
      label: `source build ${run} Docker create`,
      timeoutMs: C6_DOCKER_COMMAND_TIMEOUT_MS,
    });
  } catch (error) {
    input.onCleanupFailure();
    try {
      await cleanupUncertainDockerCreate(
        ownershipExpectation,
        input.docker,
      );
    } catch (cleanupError) {
      throw uncertainDockerCreateError(
        cleanupError,
        ownershipExpectation,
      );
    }
    throw uncertainDockerCreateError(error, ownershipExpectation);
  }
  if (
    created.exitCode !== 0 ||
    !/^[a-f0-9]{64}$/u.test(created.stdout.trim())
  ) {
    input.onCleanupFailure();
    try {
      await cleanupUncertainDockerCreate(
        ownershipExpectation,
        input.docker,
      );
    } catch (cleanupError) {
      throw uncertainDockerCreateError(
        cleanupError,
        ownershipExpectation,
      );
    }
    throw uncertainDockerCreateError(
      new Error(
        `C6 source build ${run} Docker create returned an invalid full id`,
      ),
      ownershipExpectation,
    );
  }
  const container: DockerContainerOwnership = {
    containerId: created.stdout.trim(),
    ...ownershipExpectation,
  };
  let execution: C6PackageSourceCommandResult;
  try {
    assertDockerContainerIsolation({
      container: await inspectDockerContainer(
        container.containerId,
        input.docker,
      ),
      containerUser: input.containerUser,
      imageId: input.imageId,
      ownership: container,
      requireCompleted: false,
    });

    execution = await input.docker.runner({
      allowFailure: true,
      command: [
        input.docker.cli.path,
        "start",
        "--attach",
        container.containerId,
      ],
      environment: input.docker.environment,
      label: `source build ${run}`,
      timeoutMs: C6_DOCKER_BUILD_TIMEOUT_MS,
    });
    const after = await inspectDockerContainer(
      container.containerId,
      input.docker,
    );
    assertDockerContainerIsolation({
      container: after,
      containerUser: input.containerUser,
      imageId: input.imageId,
      ownership: container,
      requireCompleted: true,
    });
    const exitCode = after.State?.ExitCode ?? execution.exitCode;
    await writeSourceBuildAttemptDiagnostics({
      containerExitCode: exitCode,
      dockerCommandExitCode: execution.exitCode,
      run,
      stderr: execution.stderr,
      stdout: execution.stdout,
      workRoot,
    });
    if (execution.exitCode !== 0 || exitCode !== 0) {
      throw new Error([
        `C6 source build ${run} exited ${exitCode}`,
        outputTail(execution.stdout),
        outputTail(execution.stderr),
      ].filter((value) => value.length > 0).join("\n"));
    }
  } finally {
    try {
      await removeDockerContainer(container, input.docker);
    } catch (error) {
      input.onCleanupFailure();
      throw error;
    }
  }

  const observed = await readObservedExecution(workRoot);
  assertObservedExecution({
    expectedRuntime: input.expectedRuntime,
    observed,
    source: input.source,
  });
  const packageArtifact = await readOnlyPackageTarball(
    join(workRoot, "output"),
  );
  if (packageArtifact.filename !== observed.packageFilename) {
    throw new Error(
      `C6 source build ${run} observed package filename drifted`,
    );
  }
  await inspectC6PackageTarball({
    expectedSha256: input.expectedPackageSha256,
    expectedVersion: input.packageVersion,
    path: packageArtifact.path,
  });
  if (
    sha256(await readC6StableRegularFile(
      packageArtifact.path,
      `source build ${run} package after inspection`,
    )) !== input.expectedPackageSha256
  ) {
    throw new Error(
      `C6 source build ${run} package drifted after inspection`,
    );
  }

  const runOutputRoot = join(input.outputRoot, String(run));
  await mkdir(runOutputRoot, { mode: 0o700 });
  const packageOutputPath = join(
    runOutputRoot,
    packageArtifact.filename,
  );
  const stdoutPath = join(runOutputRoot, "build.stdout.log");
  const stderrPath = join(runOutputRoot, "build.stderr.log");
  await Promise.all([
    writeAtomicExclusive(
      packageOutputPath,
      packageArtifact.bytes,
      0o600,
    ),
    writeAtomicExclusive(stdoutPath, execution.stdout, 0o600),
    writeAtomicExclusive(stderrPath, execution.stderr, 0o600),
  ]);
  const relativePackagePath =
    `runs/${run}/${packageArtifact.filename}`;
  return {
    packageBytes: packageArtifact.bytes,
    receipt: {
      exitCode: 0,
      installedDependencyCount: observed.installedDependencyCount,
      input: {
        bunLockSha256: input.source.bunLockSha256,
        dependencyCache: {
          contentRootSha256:
            input.prepared.cache.cacheContentRootSha256,
          directoryCount:
            input.prepared.cache.cacheDirectoryCount,
          entryCount: input.prepared.cache.cacheEntryCount,
          fileCount: input.prepared.cache.cacheFileCount,
          freshMaterialization: true,
          mountReadOnly: true,
        },
        packageJsonSha256: input.source.packageJsonSha256,
        sourceArchiveSha256: input.source.archiveSha256,
        sourceEntryManifestSha256:
          input.source.entryManifestSha256,
      },
      logs: {
        stderr: {
          path: `runs/${run}/build.stderr.log`,
          sha256: sha256(execution.stderr),
        },
        stdout: {
          path: `runs/${run}/build.stdout.log`,
          sha256: sha256(execution.stdout),
        },
      },
      output: {
        bytes: packageArtifact.bytes.byteLength,
        packageVersion: input.packageVersion,
        path: relativePackagePath,
        sha256: input.expectedPackageSha256,
      },
      run,
      runtime: observed.runtime,
    },
  };
}

async function writeSourceBuildAttemptDiagnostics(input: {
  containerExitCode: number;
  dockerCommandExitCode: number;
  run: 1 | 2;
  stderr: string;
  stdout: string;
  workRoot: string;
}): Promise<void> {
  const diagnosticsRoot = join(input.workRoot, "diagnostics");
  await mkdir(diagnosticsRoot, { mode: 0o700 });
  await Promise.all([
    writeAtomicExclusive(
      join(diagnosticsRoot, "build.stderr.log"),
      input.stderr,
      0o600,
    ),
    writeAtomicExclusive(
      join(diagnosticsRoot, "build.stdout.log"),
      input.stdout,
      0o600,
    ),
    writeAtomicExclusive(
      join(diagnosticsRoot, "status.json"),
      `${JSON.stringify({
        containerExitCode: input.containerExitCode,
        dockerCommandExitCode: input.dockerCommandExitCode,
        kind: "c6-package-source-build-attempt",
        run: input.run,
      }, null, 2)}\n`,
      0o600,
    ),
  ]);
}

function retainedSourceBuildFailure(
  error: unknown,
  workRoots: readonly string[],
): Error {
  const message = error instanceof Error
    ? error.message
    : String(error);
  return new Error([
    message,
    ...workRoots.map((root) => `retainedWorkRoot=${root}`),
    "Action: inspect and remove the retained work roots after preserving the failed build evidence",
  ].join("\n"), { cause: error });
}

async function prepareSourceBuildWorkRoot(input: {
  archivePath: string;
  source: C6PackageSourceArchiveResult;
  workRoot: string;
}): Promise<void> {
  const sourceRoot = join(input.workRoot, "source");
  const toolRoot = join(input.workRoot, "tool-bin");
  await Promise.all([
    mkdir(sourceRoot, { mode: 0o700 }),
    mkdir(toolRoot, { mode: 0o700 }),
    mkdir(join(input.workRoot, "observed"), { mode: 0o700 }),
    mkdir(join(input.workRoot, "output"), { mode: 0o700 }),
  ]);
  await runCommand(
    ["tar", "-xf", input.archivePath, "-C", sourceRoot],
    "independent source archive extraction",
  );
  const rebuiltManifest = await buildSourceEntryManifest(sourceRoot);
  if (
    rebuiltManifest.manifest !== input.source.entryManifest ||
    rebuiltManifest.entryCount !== input.source.entryCount ||
    sha256(rebuiltManifest.manifest) !==
      input.source.entryManifestSha256
  ) {
    throw new Error(
      "C6 independently extracted source tree does not match manifest",
    );
  }
  const [bunLock, packageJson] = await Promise.all([
    readStableSourceFile(
      join(sourceRoot, "bun.lock"),
      "independent source bun.lock",
    ),
    readStableSourceFile(
      join(sourceRoot, "package.json"),
      "independent source package.json",
    ),
  ]);
  if (
    sha256(bunLock.bytes) !== input.source.bunLockSha256 ||
    sha256(packageJson.bytes) !== input.source.packageJsonSha256
  ) {
    throw new Error("C6 independent source input hashes drifted");
  }
  const shimPath = join(toolRoot, "bunx");
  const scriptPath = join(input.workRoot, "run-build.sh");
  await Promise.all([
    writeFile(shimPath, C6_PACKAGE_SOURCE_BUNX_SHIM, { flag: "wx", mode: 0o700 }),
    writeFile(scriptPath, C6_PACKAGE_SOURCE_BUILD_SCRIPT, { flag: "wx", mode: 0o700 }),
  ]);
  await Promise.all([
    chmod(shimPath, 0o700),
    chmod(scriptPath, 0o700),
  ]);
}

interface ObservedExecution {
  bunLockSha256After: string;
  bunLockSha256Before: string;
  bunxShimSha256: string;
  bunxVersion: string;
  installedDependencyCount: number;
  packageFilename: string;
  packageJsonSha256After: string;
  packageJsonSha256Before: string;
  runtime: C6PackageSourceRuntimeIdentity;
}

const OBSERVED_FILES = [
  "bun-lock-after",
  "bun-lock-before",
  "bun-sha256",
  "bun-version",
  "bunx-shim-sha256",
  "bunx-version",
  "installed-dependency-count",
  "node-sha256",
  "node-version",
  "npm-cli-sha256",
  "npm-launcher-sha256",
  "npm-version",
  "package-filename",
  "package-json-after",
  "package-json-before",
] as const;

async function readObservedExecution(
  workRoot: string,
): Promise<ObservedExecution> {
  const observedRoot = join(workRoot, "observed");
  const entries = await readdir(observedRoot, { withFileTypes: true });
  const names = entries.map((entry) => entry.name).sort(compareUtf8);
  if (
    entries.some((entry) => !entry.isFile()) ||
    !sameJson(names, [...OBSERVED_FILES].sort(compareUtf8))
  ) {
    throw new Error("C6 source build observed file closure drifted");
  }
  const values = Object.fromEntries(await Promise.all(
    OBSERVED_FILES.map(async (name) => [
      name,
      await readObservedFile(observedRoot, name),
    ]),
  )) as Record<(typeof OBSERVED_FILES)[number], string>;
  return {
    bunLockSha256After: values["bun-lock-after"],
    bunLockSha256Before: values["bun-lock-before"],
    bunxShimSha256: values["bunx-shim-sha256"],
    bunxVersion: values["bunx-version"],
    installedDependencyCount: z.coerce.number().int().positive().parse(
      values["installed-dependency-count"],
    ),
    packageFilename: values["package-filename"],
    packageJsonSha256After: values["package-json-after"],
    packageJsonSha256Before: values["package-json-before"],
    runtime: runtimeSchema.parse({
      bun: {
        executableSha256: values["bun-sha256"],
        version: values["bun-version"],
      },
      node: {
        executableSha256: values["node-sha256"],
        version: values["node-version"],
      },
      npm: {
        cliSha256: values["npm-cli-sha256"],
        launcherSha256: values["npm-launcher-sha256"],
        version: values["npm-version"],
      },
    }),
  };
}

function assertObservedExecution(input: {
  expectedRuntime: C6PackageSourceRuntimeIdentity;
  observed: ObservedExecution;
  source: C6PackageSourceArchiveResult;
}): void {
  if (
    !sameJson(input.observed.runtime, input.expectedRuntime) ||
    input.observed.bunxVersion !== input.expectedRuntime.bun.version ||
    input.observed.bunxShimSha256 !== sha256(C6_PACKAGE_SOURCE_BUNX_SHIM) ||
    input.observed.bunLockSha256Before !==
      input.source.bunLockSha256 ||
    input.observed.bunLockSha256After !==
      input.source.bunLockSha256 ||
    input.observed.packageJsonSha256Before !==
      input.source.packageJsonSha256 ||
    input.observed.packageJsonSha256After !==
      input.source.packageJsonSha256
  ) {
    throw new Error(
      "C6 source build observed runtime or frozen input identity drifted",
    );
  }
}

async function readObservedFile(
  root: string,
  name: string,
): Promise<string> {
  return (
    await readC6StableRegularFile(
      join(root, name),
      `source build observed ${name}`,
    )
  ).toString("utf8").trim();
}

async function readOnlyPackageTarball(root: string): Promise<{
  bytes: Buffer;
  filename: string;
  path: string;
}> {
  const entries = await readdir(root, { withFileTypes: true });
  if (
    entries.length !== 1 ||
    !entries[0].isFile() ||
    !/^goodmemory-\d[^/]*\.tgz$/u.test(entries[0].name)
  ) {
    throw new Error(
      "C6 source build must produce exactly one regular goodmemory tarball",
    );
  }
  const path = join(root, entries[0].name);
  const bytes = await readC6StableRegularFile(
    path,
    "source build package tarball",
  );
  return { bytes, filename: entries[0].name, path };
}


async function extractArchiveText(
  archivePath: string,
  entry: string,
): Promise<string> {
  const result = await runCommand(
    ["tar", "-xOf", archivePath, entry],
    `source archive ${entry} extraction`,
  );
  if (result.stdout.length === 0) {
    throw new Error(`C6 archived source ${entry} is empty`);
  }
  return result.stdout;
}



function compareUtf8(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left), Buffer.from(right));
}

function parseJsonText(text: string, label: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`C6 ${label} is not valid JSON`);
  }
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function runCommand(
  command: string[],
  label: string,
  allowFailure = false,
  timeoutMs = C6_DOCKER_COMMAND_TIMEOUT_MS,
): Promise<C6PackageSourceCommandResult> {
  const child = Bun.spawn({
    cmd: command,
    stderr: "pipe",
    stdout: "pipe",
  });
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    try {
      child.kill("SIGKILL");
    } catch {
      // The process may already have exited.
    }
  }, timeoutMs);
  let exitCode: number;
  let stderr: string;
  let stdout: string;
  try {
    [exitCode, stderr, stdout] = await Promise.all([
      child.exited,
      new Response(child.stderr).text(),
      new Response(child.stdout).text(),
    ]);
  } finally {
    clearTimeout(timeout);
  }
  if (timedOut) {
    throw new Error(`C6 ${label} exceeded ${timeoutMs}ms deadline`);
  }
  if (!allowFailure && exitCode !== 0) {
    throw new Error([
      `C6 ${label} failed with exit code ${exitCode}`,
      outputTail(stdout),
      outputTail(stderr),
    ].filter((value) => value.length > 0).join("\n"));
  }
  return { exitCode, stderr, stdout };
}

function outputTail(value: string): string {
  const limit = 4_000;
  return value.length <= limit ? value.trim() : value.slice(-limit).trim();
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
