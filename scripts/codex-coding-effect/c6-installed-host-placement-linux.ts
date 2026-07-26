import {
  createHash,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { readFileSync } from "node:fs";
import {
  link,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import {
  loadC6AssetLock,
  readC6StableRegularFile,
  assertC6NoSymlinkPathComponents,
  verifyC6AssetClosure,
} from "./c6-asset-lock";
import {
  validateC6CodexRuntimeStaticClosure,
} from "./c6-codex-runtime";
import {
  validateC6PackageClosure,
} from "./c6-package-closure";
import {
  C6_INSTALLED_HOST_PLACEMENT_ASSISTANT_MESSAGE,
  C6_INSTALLED_HOST_PLACEMENT_FLAT_SUMMARY_OUTPUT,
  C6_INSTALLED_HOST_PLACEMENT_FLAT_SUMMARY_RUNNER_SOURCE,
  C6_INSTALLED_HOST_PLACEMENT_GOODMEMORY_WRAPPER_SOURCE,
  C6_INSTALLED_HOST_PLACEMENT_LOOPBACK_PORT,
  C6_INSTALLED_HOST_PLACEMENT_MAX_TOKENS,
  C6_INSTALLED_HOST_PLACEMENT_MIRROR_RUNNER_SOURCE,
  C6_INSTALLED_HOST_PLACEMENT_SEED_MESSAGE,
  C6_INSTALLED_HOST_PLACEMENT_SENTINEL,
  C6_INSTALLED_HOST_PLACEMENT_SESSION_START_MAX_TOKENS,
  buildC6InstalledHostPlacementCodexArguments,
  buildC6InstalledHostPlacementCodexConfig,
  buildC6InstalledHostPlacementFlatSummaryControl,
  buildC6InstalledHostPlacementFlatSummaryHookConfig,
  buildC6InstalledHostPlacementMirrorHookConfig,
  buildC6InstalledHostPlacementRecommendedCodexConfig,
  verifyC6InstalledHostPlacementCanary,
} from "./c6-installed-host-placement-canary";
import type {
  C6InstalledHostPlacementCanary,
  C6InstalledHostPlacementCanaryVerification,
} from "./c6-installed-host-placement-canary";
import {
  C6_INJECTION_TOKEN_COUNTER_ID,
  C6_INJECTION_TOKEN_COUNTER_SHA256,
} from "./c6-flat-summary";

export const C6_INSTALLED_HOST_PLACEMENT_IMAGE_SHA256 =
  "420f9c50e115184234e0e355d8a9ffed8b49c1b8512972ec9a8a402bb259834f";
export const C6_INSTALLED_HOST_PLACEMENT_GOODMEMORY_PACKAGE_SHA256 =
  "5f9b98600ff024a80a7a337fa8953e162b7498bf909a67e8b217a9bba5dd2757";
export const C6_INSTALLED_HOST_PLACEMENT_CODEX_MAIN_SHA256 =
  "416399796cac371d1a033b17f34b08ba9b25c8f298a5b9d00e10f72c3b128c8d";
export const C6_INSTALLED_HOST_PLACEMENT_CODEX_LINUX_X64_SHA256 =
  "11239480f8e3efd1430f23bbe91c1a397856b8bbe6185ccbaee2382d25e03df2";

const CODEX_CAPTURE_SHA256 =
  "6c4a975bfacd686c7e3ce7b2a1a20c0ceefe05c074df0587bf1dab7db603aeab";
const CODEX_PACKAGE_JSON_SHA256 =
  "170bcc26fc9f0fbf8d34f2eb9a43c0100f3088bbb4e41704505e43ef121b923b";
const CODEX_PACKAGE_LOCK_SHA256 =
  "fdf4dcd7dc1b7a6d578beebf95527d49ae3ffa74ed39528245984712113d8844";
const CODEX_VERSION = "0.145.0";
const CURRENT_PROFILE_NORMALIZED_SHA256 =
  "37b25293ed04ed6d2bb736df07ab23614c9b534a354c6a4a96f7b8c23069ddf2";
const CURRENT_PROFILE_SOURCE_SHA256 =
  "181d844e467bfcc22d2696bf24b80ccd2a1588af4f2e0b0b84c8fe9b9dc68d4c";
const GOODMEMORY_CLOSURE_EXPECTED = {
  image: {
    architecture: "x64",
    operatingSystem: "linux",
    runtime: {
      bun: {
        executableSha256:
          "45598a2814020c231575487a560e47d397d6902355d7e08171a2e56221a6d675",
        version: "1.3.11",
      },
      node: {
        executableSha256:
          "1abce2374a485bddae3c27b17a3e3143e2780232026e627c4fe74ddde3f380a1",
        version: "v22.14.0",
      },
      npm: {
        cliSha256:
          "8e5f6f3429f8cdbe693cdc29904e9d5a7b127a494bd15c804bd54c7403bfcbe7",
        launcherSha256:
          "8e5f6f3429f8cdbe693cdc29904e9d5a7b127a494bd15c804bd54c7403bfcbe7",
        version: "10.9.2",
      },
    },
    sha256: C6_INSTALLED_HOST_PLACEMENT_IMAGE_SHA256,
  },
  package: {
    dependencyClosure: {
      assetLockSha256:
        "f41fd2288334bf8296d8296ef720f00f459be3cd2187ec269f4f37a54880ede9",
      assetRootSha256:
        "0f9a86a3ba0514ee0aad51cfbc2260f12f6079022e51301948af38108787f6d5",
      installedTreeManifestSha256:
        "c73a5db06353bd0dc8c0a31e2a3837e8636eca6e4d59f221df338b1acf0dc3eb",
      manifestSha256:
        "ff8b9add78b93136c9f32e7302ab7bd8766b1ee35919a72a1518f4f212abb5b8",
    },
    name: "goodmemory",
    sha256: C6_INSTALLED_HOST_PLACEMENT_GOODMEMORY_PACKAGE_SHA256,
    version: "0.7.0",
  },
} as const;
const GOODMEMORY_HOME = "/work/home";
const MODEL = "c6-placement-loopback";
const ORIGINAL_PROMPT =
  "What blocks the c6 workspace deployment? "
  + "Reply using the remembered blocker.";
const WORKSPACE_PATH = "/work/workspace";
const COMMAND_TIMEOUT_MS = 30_000;
const CONTAINER_TIMEOUT_MS = 600_000;
const CREATE_DISCOVERY_QUERIES = 8;
const CREATE_DISCOVERY_INTERVAL_MS = 250;
const OWNER_LABEL = "org.goodmemory.c6.placement.owner";
const RUN_LABEL = "org.goodmemory.c6.placement.run";
const NAME_LABEL = "org.goodmemory.c6.placement.name-sha256";
const WORK_ROOT_LABEL =
  "org.goodmemory.c6.placement.work-root-sha256";

const CONTAINER_RUN_SCRIPT = readFileSync(
  new URL(
    "./c6-installed-host-placement-container.sh",
    import.meta.url,
  ),
  "utf8",
);
const CONTAINER_CANARY_MODULE = readFileSync(
  new URL(
    "./c6-installed-host-placement-container.mjs",
    import.meta.url,
  ),
  "utf8",
);
const VERIFIER_SOURCE = readFileSync(
  new URL(
    "./c6-installed-host-placement-canary.ts",
    import.meta.url,
  ),
  "utf8",
);
const LINUX_MATERIALIZER_SOURCE = readFileSync(
  new URL(
    "./c6-installed-host-placement-linux.ts",
    import.meta.url,
  ),
  "utf8",
);

const TRANSPORT = buildTransport();

export const C6_INSTALLED_HOST_PLACEMENT_RUNNER_SOURCE_SHA256 =
  runnerSourceSha256(TRANSPORT);

export function verifyC6InstalledHostPlacementCanaryAgainstCurrentRunner(
  value: unknown,
): C6InstalledHostPlacementCanaryVerification {
  const verification = verifyC6InstalledHostPlacementCanary(value);
  const canary = value as C6InstalledHostPlacementCanary;
  const currentProjection = {
    flatSummaryControl: canary.flatSummaryControl,
    frozen: canary.frozen,
    profile: {
      contextMode: canary.profile.contextMode,
      goodmemoryHome: canary.profile.goodmemoryHome,
      maxTokens: canary.profile.maxTokens,
      normalizedSha256: canary.profile.normalizedSha256,
      promptInjection: canary.profile.promptInjection,
      sessionStartMaxTokens:
        canary.profile.sessionStartMaxTokens,
      sourceSha256: canary.profile.sourceSha256,
      tokenCounterId: canary.profile.tokenCounterId,
      tokenCounterSha256: canary.profile.tokenCounterSha256,
    },
    transport: canary.transport,
  };
  const expectedProjection = {
    flatSummaryControl: TRANSPORT.flatSummaryControl,
    frozen: {
      codex: {
        linuxTarballSha256:
          C6_INSTALLED_HOST_PLACEMENT_CODEX_LINUX_X64_SHA256,
        mainTarballSha256:
          C6_INSTALLED_HOST_PLACEMENT_CODEX_MAIN_SHA256,
        version: "codex-cli 0.145.0",
      },
      goodmemory: {
        packageSha256:
          C6_INSTALLED_HOST_PLACEMENT_GOODMEMORY_PACKAGE_SHA256,
        version: "0.7.0",
      },
      imageSha256: C6_INSTALLED_HOST_PLACEMENT_IMAGE_SHA256,
      model: MODEL,
      runnerSourceSha256:
        C6_INSTALLED_HOST_PLACEMENT_RUNNER_SOURCE_SHA256,
      workspacePath: WORKSPACE_PATH,
    },
    profile: {
      contextMode: "fragment",
      goodmemoryHome: GOODMEMORY_HOME,
      maxTokens: C6_INSTALLED_HOST_PLACEMENT_MAX_TOKENS,
      normalizedSha256: CURRENT_PROFILE_NORMALIZED_SHA256,
      promptInjection: "always",
      sessionStartMaxTokens:
        C6_INSTALLED_HOST_PLACEMENT_SESSION_START_MAX_TOKENS,
      sourceSha256: CURRENT_PROFILE_SOURCE_SHA256,
      tokenCounterId: C6_INJECTION_TOKEN_COUNTER_ID,
      tokenCounterSha256: C6_INJECTION_TOKEN_COUNTER_SHA256,
    },
    transport: buildArtifactTransport(),
  };
  if (
    canonicalJson(currentProjection) !==
      canonicalJson(expectedProjection) ||
    canary.captures.some((capture) =>
      capture.observed.runnerSourceSha256 !==
        C6_INSTALLED_HOST_PLACEMENT_RUNNER_SOURCE_SHA256
    )
  ) {
    throw new Error(
      "C6 placement artifact does not bind the current runner",
    );
  }
  return verification;
}

export interface C6InstalledHostPlacementLinuxInput {
  closureRoot: string;
  codexFixtureRoot: string;
  codexTarballRoot: string;
  outputPath?: string;
}

export interface C6InstalledHostPlacementLinuxResult {
  artifact: C6InstalledHostPlacementCanary;
  localExecution: {
    containerCount: 2;
    dockerCaptureExecuted: true;
    freshWorkRootCount: 2;
    networkMode: "none";
  };
  verification: C6InstalledHostPlacementCanaryVerification;
}

export interface C6InstalledHostPlacementCommandResult {
  exitCode: number;
  stderr: string;
  stdout: string;
}

export type C6InstalledHostPlacementCommandRunner = (
  command: string[],
  timeoutMs: number,
  allowFailure?: boolean,
) => Promise<C6InstalledHostPlacementCommandResult>;

type CommandResult = C6InstalledHostPlacementCommandResult;

interface ContainerCapture {
  profile: {
    goodmemoryHookConfig: string;
    recommendedCodexConfigSource: string;
    source: string;
  };
  [key: string]: unknown;
}

export interface C6InstalledHostPlacementContainerOwnership {
  closureRoot: string;
  codexFixtureRoot: string;
  codexTarballRoot: string;
  containerName: string;
  ownershipNonce: string;
  runId: string;
  runnerRoot: string;
  workRoot: string;
}

export interface C6InstalledHostPlacementContainerExpectation
  extends C6InstalledHostPlacementContainerOwnership {
  containerId: string;
}

type ContainerOwnershipExpectation =
  C6InstalledHostPlacementContainerOwnership;
type ContainerExpectation =
  C6InstalledHostPlacementContainerExpectation;

export function buildC6InstalledHostPlacementDockerCreateCommand(input: {
  closureRoot: string;
  codexFixtureRoot: string;
  codexTarballRoot: string;
  containerName: string;
  imageReference: string;
  ownershipNonce: string;
  runId: string;
  runnerRoot: string;
  workRoot: string;
}): string[] {
  if (
    input.imageReference !==
      `sha256:${C6_INSTALLED_HOST_PLACEMENT_IMAGE_SHA256}`
  ) {
    throw new Error("C6 placement runner requires the pinned image");
  }
  for (const [label, path] of [
    ["GoodMemory closure", input.closureRoot],
    ["Codex fixture", input.codexFixtureRoot],
    ["Codex tarballs", input.codexTarballRoot],
    ["runner root", input.runnerRoot],
    ["work root", input.workRoot],
  ] as const) {
    if (!isAbsolute(path) || path.includes(",")) {
      throw new Error(`C6 placement ${label} must be absolute`);
    }
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]+$/u.test(input.containerName)) {
    throw new Error("C6 placement container name is invalid");
  }
  if (
    !/^[a-f0-9]{32}$/u.test(input.ownershipNonce) ||
    !/^capture-[12]$/u.test(input.runId)
  ) {
    throw new Error("C6 placement container ownership is invalid");
  }
  return [
    "docker",
    "create",
    "--pull=never",
    `--name=${input.containerName}`,
    "--platform=linux/amd64",
    "--network=none",
    "--read-only",
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges",
    "--tmpfs=/tmp:rw,nosuid,nodev,size=512m",
    "--env=HOME=/work/home",
    "--env=LANG=C.UTF-8",
    "--env=NO_COLOR=1",
    `--label=${OWNER_LABEL}=${input.ownershipNonce}`,
    `--label=${RUN_LABEL}=${input.runId}`,
    `--label=${NAME_LABEL}=${sha256(input.containerName)}`,
    `--label=${WORK_ROOT_LABEL}=${sha256(input.workRoot)}`,
    `--mount=type=bind,src=${input.closureRoot},dst=/closure,readonly`,
    `--mount=type=bind,src=${input.codexFixtureRoot},dst=/codex-fixture,readonly`,
    `--mount=type=bind,src=${input.codexTarballRoot},dst=/codex-tarballs,readonly`,
    `--mount=type=bind,src=${input.runnerRoot},dst=/runner,readonly`,
    `--mount=type=bind,src=${input.workRoot},dst=/work`,
    input.imageReference,
    "/bin/sh",
    "/runner/run.sh",
  ];
}

export async function runC6InstalledHostPlacementWithCleanup<T>(
  execute: () => Promise<T>,
  cleanup: () => Promise<void>,
  finalize?: (value: T) => Promise<void>,
): Promise<T> {
  let outcome:
    | { ok: true; value: T }
    | { error: unknown; ok: false };
  try {
    outcome = { ok: true, value: await execute() };
  } catch (error) {
    outcome = { error, ok: false };
  }
  try {
    await cleanup();
  } catch (cleanupError) {
    if (!outcome.ok) {
      throw new AggregateError(
        [outcome.error, cleanupError],
        "C6 placement execution and cleanup failed",
      );
    }
    throw cleanupError;
  }
  if (!outcome.ok) {
    throw outcome.error;
  }
  await finalize?.(outcome.value);
  return outcome.value;
}

export async function materializeC6InstalledHostPlacementLinux(
  input: C6InstalledHostPlacementLinuxInput,
): Promise<C6InstalledHostPlacementLinuxResult> {
  const closureRoot = requireAbsolute(input.closureRoot, "closure root");
  const codexFixtureRoot = requireAbsolute(
    input.codexFixtureRoot,
    "Codex fixture root",
  );
  const codexTarballRoot = requireAbsolute(
    input.codexTarballRoot,
    "Codex tarball root",
  );
  const outputPath = input.outputPath === undefined
    ? undefined
    : requireAbsolute(input.outputPath, "output path");
  if (outputPath !== undefined) {
    assertOutputOutsideInputs(outputPath, [
      closureRoot,
      codexFixtureRoot,
      codexTarballRoot,
      dirname(fileURLToPath(import.meta.url)),
    ]);
  }
  const closureLock = await loadC6AssetLock(closureRoot);
  await validateInputs({
    closureRoot,
    codexFixtureRoot,
    codexTarballRoot,
  });
  await inspectImage();

  const temporaryRoot = await realpath(tmpdir());
  const runnerRoot = await mkdtemp(
    join(temporaryRoot, "goodmemory-c6-placement-runner-"),
  );
  const workRoots: string[] = [];
  const ownedContainers = new Map<string, ContainerExpectation>();
  const attemptedOwnerships: ContainerOwnershipExpectation[] = [];
  return runC6InstalledHostPlacementWithCleanup(async () => {
    await materializeRunnerRoot(runnerRoot);
    const captures: unknown[] = [];
    let expectedProfile: ContainerCapture["profile"] | undefined;
    for (const run of [1, 2] as const) {
      const workRoot = await mkdtemp(
        join(
          temporaryRoot,
          `goodmemory-c6-placement-work-${run}-`,
        ),
      );
      workRoots.push(workRoot);
      const runId = `capture-${run}`;
      const ownershipNonce = randomBytes(16).toString("hex");
      await writeFile(
        join(workRoot, "run-input.json"),
        `${JSON.stringify({
          codexConfigSource: TRANSPORT.codexConfigSource,
          declaredFreshRootIdentitySha256: sha256(workRoot),
          imageSha256: C6_INSTALLED_HOST_PLACEMENT_IMAGE_SHA256,
          loopbackPort: C6_INSTALLED_HOST_PLACEMENT_LOOPBACK_PORT,
          originalPrompt: ORIGINAL_PROMPT,
          runId,
          runnerSourceSha256:
            C6_INSTALLED_HOST_PLACEMENT_RUNNER_SOURCE_SHA256,
          workspacePath: WORKSPACE_PATH,
        }, null, 2)}\n`,
        { flag: "wx", mode: 0o600 },
      );
      const containerName =
        `goodmemory-c6-placement-${run}-${randomUUID()}`;
      const ownership: ContainerOwnershipExpectation = {
        closureRoot,
        codexFixtureRoot,
        codexTarballRoot,
        containerName,
        ownershipNonce,
        runId,
        runnerRoot,
        workRoot,
      };
      attemptedOwnerships.push(ownership);
      const expectation =
        await claimC6InstalledHostPlacementContainer(ownership);
      const { containerId } = expectation;
      ownedContainers.set(containerId, expectation);
      const parsed = await runC6InstalledHostPlacementWithCleanup(
        async () => {
          const started = await runCommand(
            ["docker", "start", "--attach", containerId],
            CONTAINER_TIMEOUT_MS,
            true,
          );
          const terminal = await inspectContainer(expectation, true);
          if (
            started.exitCode !== 0 ||
            terminal.stateExitCode !== 0
          ) {
            throw new Error(
              "C6 placement container failed: "
              + `${started.stderr.trim()} ${started.stdout.trim()}`,
            );
          }
          return parseContainerCapture(
            await readC6StableRegularFile(
              join(workRoot, "capture.json"),
              `placement capture ${run}`,
            ),
          );
        },
        async () => {
          await removeC6InstalledHostPlacementContainer(expectation);
          ownedContainers.delete(containerId);
        },
      );
      if (
        expectedProfile !== undefined &&
        JSON.stringify(parsed.profile) !==
          JSON.stringify(expectedProfile)
      ) {
        throw new Error("C6 placement profile changed across captures");
      }
      expectedProfile = parsed.profile;
      const { profile: _profile, ...capture } = parsed;
      captures.push({
        ...capture,
        environment: {
          architecture: "x86_64",
          capabilitiesDropped: "ALL",
          credentialsMounted: false,
          networkMode: "none",
          noNewPrivileges: true,
          operatingSystem: "linux",
          readOnlyRootFilesystem: true,
          sourceCheckoutMounted: false,
        },
      });
    }
    if (expectedProfile === undefined) {
      throw new Error("C6 placement produced no profile");
    }
    const artifact = buildArtifact(captures, expectedProfile);
    const verification =
      verifyC6InstalledHostPlacementCanaryAgainstCurrentRunner(
        artifact,
      );
    return {
      artifact,
      localExecution: {
        containerCount: 2,
        dockerCaptureExecuted: true,
        freshWorkRootCount: 2,
        networkMode: "none",
      },
      verification,
    };
  }, async () => {
    for (const expectation of ownedContainers.values()) {
      await removeC6InstalledHostPlacementContainer(expectation);
    }
    await assertNoC6InstalledHostPlacementContainerCandidates(
      attemptedOwnerships,
    );
    await rm(runnerRoot, { force: true, recursive: true });
    for (const workRoot of workRoots) {
      await rm(workRoot, { force: true, recursive: true });
    }
  }, async (result) => {
    await inspectImage();
    await validateInputs({
      closureRoot,
      codexFixtureRoot,
      codexTarballRoot,
    });
    await verifyC6AssetClosure(closureRoot, closureLock);
    await assertRunnerSourcesUnchanged();
    if (outputPath !== undefined) {
      await publishExclusive(
        outputPath,
        `${JSON.stringify(result.artifact, null, 2)}\n`,
      );
    }
  });
}

function assertOutputOutsideInputs(
  outputPath: string,
  forbiddenRoots: string[],
): void {
  for (const root of forbiddenRoots) {
    const child = relative(resolve(root), outputPath);
    if (
      child === "" ||
      (!child.startsWith("../") && !isAbsolute(child))
    ) {
      throw new Error(
        "C6 placement output path overlaps an input or runner root",
      );
    }
  }
}

async function publishExclusive(
  outputPath: string,
  source: string,
): Promise<void> {
  const parent = dirname(outputPath);
  await mkdir(parent, { recursive: true });
  await assertC6NoSymlinkPathComponents(
    parent,
    "C6 placement output parent",
  );
  const temporary = join(
    parent,
    `.${basename(outputPath)}.${randomUUID()}.tmp`,
  );
  let temporaryCreated = false;
  try {
    await writeFile(temporary, source, {
      flag: "wx",
      mode: 0o600,
    });
    temporaryCreated = true;
    await link(temporary, outputPath);
  } finally {
    if (temporaryCreated) {
      await unlink(temporary);
    }
  }
}

function buildTransport() {
  const codexConfigSource =
    buildC6InstalledHostPlacementCodexConfig({
      goodmemoryHome: GOODMEMORY_HOME,
      model: MODEL,
    });
  const recommendedCodexConfigSource =
    buildC6InstalledHostPlacementRecommendedCodexConfig({
      goodmemoryHome: GOODMEMORY_HOME,
    });
  const common = {
    model: MODEL,
    originalPrompt: ORIGINAL_PROMPT,
    workspacePath: WORKSPACE_PATH,
  };
  return {
    assistantMessage:
      C6_INSTALLED_HOST_PLACEMENT_ASSISTANT_MESSAGE,
    canaryVerifierSource: VERIFIER_SOURCE,
    codexConfigSource,
    flatSummaryArguments:
      buildC6InstalledHostPlacementCodexArguments({
        ...common,
        hookMode: "enabled",
      }),
    flatSummaryControl:
      buildC6InstalledHostPlacementFlatSummaryControl(),
    flatSummaryHookConfigSource:
      buildC6InstalledHostPlacementFlatSummaryHookConfig(),
    goodmemoryArguments:
      buildC6InstalledHostPlacementCodexArguments({
        ...common,
        hookMode: "enabled",
      }),
    goodmemoryWrapperSource:
      C6_INSTALLED_HOST_PLACEMENT_GOODMEMORY_WRAPPER_SOURCE,
    hooksDisabledArguments:
      buildC6InstalledHostPlacementCodexArguments({
        ...common,
        hookMode: "disabled",
      }),
    linuxMaterializerSource: LINUX_MATERIALIZER_SOURCE,
    mirroredArguments:
      buildC6InstalledHostPlacementCodexArguments({
        ...common,
        hookMode: "enabled",
      }),
    mirroredHookConfigSource:
      buildC6InstalledHostPlacementMirrorHookConfig(),
    recommendedCodexConfigSource,
    seedMessage: C6_INSTALLED_HOST_PLACEMENT_SEED_MESSAGE,
    sentinel: C6_INSTALLED_HOST_PLACEMENT_SENTINEL,
  };
}

function buildArtifactTransport():
  C6InstalledHostPlacementCanary["transport"] {
  const codexConfigSource = TRANSPORT.codexConfigSource;
  const flatSummaryHookConfigSource =
    TRANSPORT.flatSummaryHookConfigSource;
  const mirroredHookConfigSource =
    TRANSPORT.mirroredHookConfigSource;
  return {
    codexConfigSource,
    codexConfigSourceSha256: sha256(codexConfigSource),
    flatSummaryArguments: TRANSPORT.flatSummaryArguments,
    flatSummaryHookConfigSource,
    flatSummaryHookConfigSourceSha256:
      sha256(flatSummaryHookConfigSource),
    flatSummaryHookRunnerSource:
      C6_INSTALLED_HOST_PLACEMENT_FLAT_SUMMARY_RUNNER_SOURCE,
    flatSummaryHookRunnerSourceSha256: sha256(
      C6_INSTALLED_HOST_PLACEMENT_FLAT_SUMMARY_RUNNER_SOURCE,
    ),
    goodmemoryArguments: TRANSPORT.goodmemoryArguments,
    goodmemoryWrapperSource:
      C6_INSTALLED_HOST_PLACEMENT_GOODMEMORY_WRAPPER_SOURCE,
    goodmemoryWrapperSourceSha256: sha256(
      C6_INSTALLED_HOST_PLACEMENT_GOODMEMORY_WRAPPER_SOURCE,
    ),
    hooksDisabledArguments: TRANSPORT.hooksDisabledArguments,
    mirroredArguments: TRANSPORT.mirroredArguments,
    mirroredHookConfigSource,
    mirroredHookConfigSourceSha256:
      sha256(mirroredHookConfigSource),
    mirroredHookRunnerSource:
      C6_INSTALLED_HOST_PLACEMENT_MIRROR_RUNNER_SOURCE,
    mirroredHookRunnerSourceSha256: sha256(
      C6_INSTALLED_HOST_PLACEMENT_MIRROR_RUNNER_SOURCE,
    ),
  };
}

function buildArtifact(
  captures: unknown[],
  profile: ContainerCapture["profile"],
): C6InstalledHostPlacementCanary {
  return {
    boundary: {
      c6T003Complete: false,
      candidateManifestFrozen: false,
      codexRunReady: false,
      executionAuthenticated: false,
      experimentalNoMemoryArmIncluded: false,
      externalIndependentAttestation: false,
      finalInstalledHostProfileProven: false,
      flatSummaryPlacementParityProven: false,
      liveProviderExecution: false,
    },
    captures: captures as C6InstalledHostPlacementCanary["captures"],
    flatSummaryControl: TRANSPORT.flatSummaryControl,
    frozen: {
      codex: {
        linuxTarballSha256:
          C6_INSTALLED_HOST_PLACEMENT_CODEX_LINUX_X64_SHA256,
        mainTarballSha256:
          C6_INSTALLED_HOST_PLACEMENT_CODEX_MAIN_SHA256,
        version: "codex-cli 0.145.0",
      },
      goodmemory: {
        packageSha256:
          C6_INSTALLED_HOST_PLACEMENT_GOODMEMORY_PACKAGE_SHA256,
        version: "0.7.0",
      },
      imageSha256: C6_INSTALLED_HOST_PLACEMENT_IMAGE_SHA256,
      model: MODEL,
      runnerSourceSha256:
        C6_INSTALLED_HOST_PLACEMENT_RUNNER_SOURCE_SHA256,
      workspacePath: WORKSPACE_PATH,
    },
    kind: "c6-installed-host-placement-canary",
    profile: {
      contextMode: "fragment",
      goodmemoryHome: GOODMEMORY_HOME,
      goodmemoryHookConfig: profile.goodmemoryHookConfig,
      goodmemoryHookConfigSha256:
        sha256(profile.goodmemoryHookConfig),
      maxTokens: C6_INSTALLED_HOST_PLACEMENT_MAX_TOKENS,
      normalizedSha256: sha256(canonicalJson(
        JSON.parse(profile.source) as unknown,
      )),
      promptInjection: "always",
      recommendedCodexConfigSource:
        profile.recommendedCodexConfigSource,
      recommendedCodexConfigSourceSha256:
        sha256(profile.recommendedCodexConfigSource),
      sessionStartMaxTokens:
        C6_INSTALLED_HOST_PLACEMENT_SESSION_START_MAX_TOKENS,
      source: profile.source,
      sourceSha256: sha256(profile.source),
      tokenCounterId: C6_INJECTION_TOKEN_COUNTER_ID,
      tokenCounterSha256: C6_INJECTION_TOKEN_COUNTER_SHA256,
    },
    schemaVersion: 2,
    transport: buildArtifactTransport(),
  };
}

async function materializeRunnerRoot(root: string): Promise<void> {
  await Promise.all([
    writeFile(join(root, "run.sh"), CONTAINER_RUN_SCRIPT, {
      flag: "wx",
      mode: 0o755,
    }),
    writeFile(
      join(root, "canary.mjs"),
      CONTAINER_CANARY_MODULE,
      { flag: "wx", mode: 0o644 },
    ),
    writeFile(
      join(root, "flat-summary-hook.mjs"),
      C6_INSTALLED_HOST_PLACEMENT_FLAT_SUMMARY_RUNNER_SOURCE,
      { flag: "wx", mode: 0o644 },
    ),
    writeFile(
      join(root, "flat-summary-output.txt"),
      C6_INSTALLED_HOST_PLACEMENT_FLAT_SUMMARY_OUTPUT,
      { flag: "wx", mode: 0o444 },
    ),
    writeFile(
      join(root, "mirror-hook.mjs"),
      C6_INSTALLED_HOST_PLACEMENT_MIRROR_RUNNER_SOURCE,
      { flag: "wx", mode: 0o644 },
    ),
    writeFile(
      join(root, "transport.json"),
      `${JSON.stringify(TRANSPORT, null, 2)}\n`,
      { flag: "wx", mode: 0o600 },
    ),
  ]);
}

function runnerSourceSha256(transport: typeof TRANSPORT): string {
  return sha256(JSON.stringify({
    canaryModule: CONTAINER_CANARY_MODULE,
    flatSummaryHook:
      C6_INSTALLED_HOST_PLACEMENT_FLAT_SUMMARY_RUNNER_SOURCE,
    flatSummaryOutput:
      C6_INSTALLED_HOST_PLACEMENT_FLAT_SUMMARY_OUTPUT,
    mirrorHook:
      C6_INSTALLED_HOST_PLACEMENT_MIRROR_RUNNER_SOURCE,
    runScript: CONTAINER_RUN_SCRIPT,
    schemaVersion: 2,
    transport,
  }));
}

async function validateInputs(input: {
  closureRoot: string;
  codexFixtureRoot: string;
  codexTarballRoot: string;
}): Promise<void> {
  await validateC6PackageClosure({
    closureRoot: input.closureRoot,
    expected: GOODMEMORY_CLOSURE_EXPECTED,
  });
  const packageBytes = await readC6StableRegularFile(
    join(
      input.closureRoot,
      "package",
      "goodmemory-0.7.0.tgz",
    ),
    "placement GoodMemory package",
  );
  if (
    sha256(packageBytes) !==
      C6_INSTALLED_HOST_PLACEMENT_GOODMEMORY_PACKAGE_SHA256
  ) {
    throw new Error("C6 placement GoodMemory package drifted");
  }
  await validateC6CodexRuntimeStaticClosure({
    expected: {
      captureSha256: CODEX_CAPTURE_SHA256,
      linuxTarballSha256:
        C6_INSTALLED_HOST_PLACEMENT_CODEX_LINUX_X64_SHA256,
      mainTarballSha256:
        C6_INSTALLED_HOST_PLACEMENT_CODEX_MAIN_SHA256,
      packageJsonSha256: CODEX_PACKAGE_JSON_SHA256,
      packageLockSha256: CODEX_PACKAGE_LOCK_SHA256,
      version: CODEX_VERSION,
    },
    fixtureRoot: input.codexFixtureRoot,
    tarballRoot: input.codexTarballRoot,
  });
}

async function inspectImage(): Promise<void> {
  const result = await runCommand([
    "docker",
    "image",
    "inspect",
    `sha256:${C6_INSTALLED_HOST_PLACEMENT_IMAGE_SHA256}`,
  ], COMMAND_TIMEOUT_MS);
  const images = parseJson(result.stdout, "Docker image inspect");
  const image = Array.isArray(images) ? images[0] : undefined;
  if (
    !isRecord(image) ||
    image.Id !==
      `sha256:${C6_INSTALLED_HOST_PLACEMENT_IMAGE_SHA256}` ||
    image.Architecture !== "amd64" ||
    image.Os !== "linux"
  ) {
    throw new Error("C6 placement pinned Linux image drifted");
  }
}

export async function claimC6InstalledHostPlacementContainer(
  ownership: ContainerOwnershipExpectation,
  commandRunner: C6InstalledHostPlacementCommandRunner = runCommand,
): Promise<ContainerExpectation> {
  if (
    (await listOwnedContainerIds(ownership, commandRunner)).length !== 0
  ) {
    throw new Error(
      "C6 placement ownership labels were not unique before create",
    );
  }
  const command = buildC6InstalledHostPlacementDockerCreateCommand({
    ...ownership,
    imageReference:
      `sha256:${C6_INSTALLED_HOST_PLACEMENT_IMAGE_SHA256}`,
  });
  let createResult: CommandResult | undefined;
  let createError: unknown;
  let firstAuthorityError: unknown;
  let lastAuthorityError: unknown;
  const rememberAuthorityError = (error: unknown): void => {
    firstAuthorityError ??= error;
    lastAuthorityError = error;
  };
  try {
    createResult = await commandRunner(
      command,
      COMMAND_TIMEOUT_MS,
      true,
    );
  } catch (error) {
    createError = error;
  }
  const candidateId = createResult?.stdout.trim();
  if (
    createResult?.exitCode === 0 &&
    candidateId !== undefined &&
    /^[a-f0-9]{64}$/u.test(candidateId)
  ) {
    const candidate = {
      ...ownership,
      containerId: candidateId,
    };
    const authority = await checkDeletionAuthority(
      candidate,
      commandRunner,
    );
    if (authority.authorized) {
      return validateOwnedContainerOrCleanup(
        candidate,
        commandRunner,
      );
    }
    rememberAuthorityError(authority.error);
  }

  let emptyConfirmations = 0;
  for (let query = 0; query < CREATE_DISCOVERY_QUERIES; query += 1) {
    const ids = await listOwnedContainerIds(ownership, commandRunner);
    const exactOwned: ContainerExpectation[] = [];
    for (const containerId of ids) {
      const discovered = {
        ...ownership,
        containerId,
      };
      const authority = await checkDeletionAuthority(
        discovered,
        commandRunner,
      );
      if (authority.authorized) {
        exactOwned.push(discovered);
      } else {
        rememberAuthorityError(authority.error);
      }
    }
    if (exactOwned.length > 1) {
      throw new Error(
        "C6 placement create discovered multiple owned containers",
      );
    }
    if (exactOwned.length === 1) {
      return validateOwnedContainerOrCleanup(
        exactOwned[0]!,
        commandRunner,
      );
    }
    emptyConfirmations += 1;
    if (query + 1 < CREATE_DISCOVERY_QUERIES) {
      await new Promise((resolvePromise) =>
        setTimeout(resolvePromise, CREATE_DISCOVERY_INTERVAL_MS)
      );
    }
  }
  if (emptyConfirmations !== CREATE_DISCOVERY_QUERIES) {
    throw new Error(
      "C6 placement uncertain create did not reach quiescence",
    );
  }
  const detail = createResult === undefined
    ? String(createError)
    : `${createResult.stderr.trim()} ${createResult.stdout.trim()}`;
  const errors = [
    createError,
    firstAuthorityError,
    lastAuthorityError,
  ].filter((error, index, values) =>
    error !== undefined && values.indexOf(error) === index
  );
  const authorityDetail = [...new Set(
    [firstAuthorityError, lastAuthorityError]
      .filter((error) => error !== undefined)
      .map(formatUnknownError),
  )].join(" | ");
  const message = "C6 placement Docker create or ownership proof failed: "
    + detail
    + (
      authorityDetail.length === 0
        ? ""
        : `; ownership inspection: ${authorityDetail}`
    );
  if (errors.length > 0) {
    throw new AggregateError(errors, message);
  }
  throw new Error(message);
}

async function listOwnedContainerIds(
  ownership: ContainerOwnershipExpectation,
  commandRunner: C6InstalledHostPlacementCommandRunner,
): Promise<string[]> {
  const result = await commandRunner([
    "docker",
    "ps",
    "--all",
    "--no-trunc",
    `--filter=label=${OWNER_LABEL}=${ownership.ownershipNonce}`,
    `--filter=label=${RUN_LABEL}=${ownership.runId}`,
    `--filter=label=${NAME_LABEL}=${sha256(ownership.containerName)}`,
    `--filter=label=${WORK_ROOT_LABEL}=${sha256(ownership.workRoot)}`,
    "--format={{.ID}}",
  ], COMMAND_TIMEOUT_MS);
  const ids = result.stdout.split(/\r?\n/u).filter((line) =>
    line.length > 0
  );
  if (ids.some((id) => !/^[a-f0-9]{64}$/u.test(id))) {
    throw new Error("C6 placement ownership discovery returned invalid ids");
  }
  return [...new Set(ids)];
}

export async function assertNoC6InstalledHostPlacementContainerCandidates(
  ownerships: readonly C6InstalledHostPlacementContainerOwnership[],
  commandRunner: C6InstalledHostPlacementCommandRunner = runCommand,
): Promise<void> {
  for (const ownership of ownerships) {
    const ids = await listOwnedContainerIds(ownership, commandRunner);
    if (ids.length !== 0) {
      throw new Error(
        "C6 placement attempted ownership candidate remains; "
        + `run=${ownership.runId}; count=${ids.length}`,
      );
    }
  }
}

async function inspectContainer(
  expected: ContainerExpectation,
  terminal: boolean,
  commandRunner: C6InstalledHostPlacementCommandRunner = runCommand,
): Promise<{ stateExitCode: number }> {
  const container = await inspectDeletionAuthority(
    expected,
    commandRunner,
  );
  const config = requireRecord(container.Config, "Docker config");
  const host = requireRecord(container.HostConfig, "Docker host config");
  const state = requireRecord(container.State, "Docker state");
  const mounts = Array.isArray(container.Mounts)
    ? container.Mounts
    : [];
  const expectedMounts = [
    [expected.closureRoot, "/closure", false],
    [expected.codexFixtureRoot, "/codex-fixture", false],
    [expected.codexTarballRoot, "/codex-tarballs", false],
    [expected.runnerRoot, "/runner", false],
    [expected.workRoot, "/work", true],
  ] as const;
  const mountProjection = mounts.map((mount) =>
    isRecord(mount)
      ? {
          destination: mount.Destination,
          rw: mount.RW,
          source: mount.Source,
          type: mount.Type,
        }
      : {}
  ).sort((left, right) =>
    String(left.destination).localeCompare(String(right.destination))
  );
  const expectedMountProjection = expectedMounts.map(
    ([source, destination, rw]) => ({
      destination,
      rw,
      source,
      type: "bind",
    }),
  ).sort((left, right) =>
    left.destination.localeCompare(right.destination)
  );
  const capDrop = Array.isArray(host.CapDrop) ? host.CapDrop : [];
  const securityOpt = Array.isArray(host.SecurityOpt)
    ? host.SecurityOpt
    : [];
  const env = Array.isArray(config.Env) ? config.Env : [];
  if (
    config.Image !==
      `sha256:${C6_INSTALLED_HOST_PLACEMENT_IMAGE_SHA256}` ||
    JSON.stringify(config.Cmd) !==
      JSON.stringify(["/bin/sh", "/runner/run.sh"]) ||
    host.NetworkMode !== "none" ||
    host.ReadonlyRootfs !== true ||
    !capDrop.includes("ALL") ||
    !securityOpt.some((value) =>
      value === "no-new-privileges" ||
      value === "no-new-privileges:true"
    ) ||
    JSON.stringify(mountProjection) !==
      JSON.stringify(expectedMountProjection) ||
    env.some((value) =>
      typeof value === "string" &&
      /(?:TOKEN|PASSWORD|SECRET|AUTHORIZATION)=/iu.test(value)
    )
  ) {
    throw new Error("C6 placement Docker isolation drifted");
  }
  const stateExitCode = typeof state.ExitCode === "number"
    ? state.ExitCode
    : -1;
  if (terminal && state.Status !== "exited") {
    throw new Error("C6 placement Docker container did not exit");
  }
  return { stateExitCode };
}

async function inspectDeletionAuthority(
  expected: ContainerExpectation,
  commandRunner: C6InstalledHostPlacementCommandRunner,
): Promise<Record<string, unknown>> {
  const result = await commandRunner(
    ["docker", "inspect", expected.containerId],
    COMMAND_TIMEOUT_MS,
  );
  const containers = parseJson(result.stdout, "Docker container inspect");
  const container = Array.isArray(containers)
    ? containers[0]
    : undefined;
  if (!isRecord(container)) {
    throw new Error("C6 placement Docker inspect is invalid");
  }
  const config = requireRecord(container.Config, "Docker config");
  const labels = isRecord(config.Labels) ? config.Labels : {};
  if (
    container.Id !== expected.containerId ||
    container.Name !== `/${expected.containerName}` ||
    labels[OWNER_LABEL] !== expected.ownershipNonce ||
    labels[RUN_LABEL] !== expected.runId ||
    labels[NAME_LABEL] !== sha256(expected.containerName) ||
    labels[WORK_ROOT_LABEL] !== sha256(expected.workRoot)
  ) {
    throw new Error("C6 placement Docker deletion authority drifted");
  }
  return container;
}

async function checkDeletionAuthority(
  expected: ContainerExpectation,
  commandRunner: C6InstalledHostPlacementCommandRunner,
): Promise<
  | { authorized: true }
  | { authorized: false; error: unknown }
> {
  try {
    await inspectDeletionAuthority(expected, commandRunner);
    return { authorized: true };
  } catch (error) {
    return { authorized: false, error };
  }
}

async function validateOwnedContainerOrCleanup(
  expected: ContainerExpectation,
  commandRunner: C6InstalledHostPlacementCommandRunner,
): Promise<ContainerExpectation> {
  try {
    await inspectContainer(expected, false, commandRunner);
    return expected;
  } catch (validationError) {
    try {
      await removeC6InstalledHostPlacementContainer(
        expected,
        commandRunner,
      );
    } catch (cleanupError) {
      throw new AggregateError(
        [validationError, cleanupError],
        "C6 placement invalid owned container cleanup failed",
      );
    }
    throw validationError;
  }
}

export async function removeC6InstalledHostPlacementContainer(
  expected: ContainerExpectation,
  commandRunner: C6InstalledHostPlacementCommandRunner = runCommand,
): Promise<void> {
  await inspectDeletionAuthority(expected, commandRunner);
  const result = await commandRunner(
    ["docker", "rm", "--force", expected.containerId],
    COMMAND_TIMEOUT_MS,
    true,
  );
  if (result.exitCode !== 0) {
    throw new Error(
      `C6 placement Docker cleanup failed: ${result.stderr.trim()}`,
    );
  }
  const terminal = await commandRunner(
    ["docker", "inspect", expected.containerId],
    COMMAND_TIMEOUT_MS,
    true,
  );
  if (
    terminal.exitCode === 0 ||
    !/No such (?:object|container)/iu.test(terminal.stderr)
  ) {
    throw new Error(
      "C6 placement Docker cleanup did not prove removal",
    );
  }
}

async function assertRunnerSourcesUnchanged(): Promise<void> {
  const [runScript, canaryModule, verifierSource, linuxSource] =
    await Promise.all([
      readFile(
        new URL(
          "./c6-installed-host-placement-container.sh",
          import.meta.url,
        ),
        "utf8",
      ),
      readFile(
        new URL(
          "./c6-installed-host-placement-container.mjs",
          import.meta.url,
        ),
        "utf8",
      ),
      readFile(
        new URL(
          "./c6-installed-host-placement-canary.ts",
          import.meta.url,
        ),
        "utf8",
      ),
      readFile(
        new URL(
          "./c6-installed-host-placement-linux.ts",
          import.meta.url,
        ),
        "utf8",
      ),
    ]);
  if (
    runScript !== CONTAINER_RUN_SCRIPT ||
    canaryModule !== CONTAINER_CANARY_MODULE ||
    verifierSource !== VERIFIER_SOURCE ||
    linuxSource !== LINUX_MATERIALIZER_SOURCE
  ) {
    throw new Error("C6 placement runner sources changed during capture");
  }
}

async function runCommand(
  command: string[],
  timeoutMs: number,
  allowFailure = false,
): Promise<CommandResult> {
  const child = Bun.spawn({
    cmd: command,
    stderr: "pipe",
    stdout: "pipe",
  });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill();
  }, timeoutMs);
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  clearTimeout(timer);
  if (timedOut) {
    throw new Error(`C6 placement command timed out: ${command[1] ?? ""}`);
  }
  const result = { exitCode, stderr, stdout };
  if (!allowFailure && exitCode !== 0) {
    throw new Error(
      `C6 placement command failed (${exitCode}): `
      + `${stderr.trim()} ${stdout.trim()}`,
    );
  }
  return result;
}

function formatUnknownError(error: unknown): string {
  return error instanceof Error
    ? `${error.name}: ${error.message}`
    : String(error);
}

function parseContainerCapture(bytes: Buffer): ContainerCapture {
  const parsed = parseJson(
    bytes.toString("utf8"),
    "container capture",
  );
  if (
    !isRecord(parsed) ||
    !isRecord(parsed.profile) ||
    typeof parsed.profile.goodmemoryHookConfig !== "string" ||
    typeof parsed.profile.recommendedCodexConfigSource !== "string" ||
    typeof parsed.profile.source !== "string"
  ) {
    throw new Error("C6 placement container capture is invalid");
  }
  return parsed as ContainerCapture;
}

function requireAbsolute(path: string, label: string): string {
  if (!isAbsolute(path)) {
    throw new Error(`C6 placement ${label} must be absolute`);
  }
  return resolve(path);
}

function requireRecord(value: unknown, label: string) {
  if (!isRecord(value)) {
    throw new Error(`C6 placement ${label} is invalid`);
  }
  return value;
}

function parseJson(raw: string, label: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new Error(`C6 placement ${label} is not valid JSON`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (isRecord(value)) {
    const entries = Object.entries(value).sort(([left], [right]) =>
      left < right ? -1 : left > right ? 1 : 0
    );
    return `{${entries.map(([key, entry]) =>
      `${JSON.stringify(key)}:${canonicalJson(entry)}`
    ).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
