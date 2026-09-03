import { createHash } from "node:crypto";
import {
  chmod,
  copyFile,
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

import { z } from "zod";

import {
  auditNoMemoryRuntime,
  buildInstalledGoodMemorySetupArgs,
  auditFlatSummaryRuntime,
} from "./c3-arms";
import {
  buildC5FlatSummaryHookConfig,
  buildC5FlatSummaryHookRunnerSource,
} from "./c5-flat-summary-arm";
import type {
  C3ArmPlan,
  NoMemoryRuntimeAudit,
  C3FlatSummaryArmPlan,
} from "./c3-arms";
import {
  auditFrozenPrehistoryLeakage,
  assertFrozenPrehistoryUnchanged,
  persistFrozenPrehistorySeedReceipt,
} from "./frozen-prehistory";
import type {
  FrozenPrehistoryArtifact,
  FrozenPrehistoryLeakageAudit,
  FrozenPrehistorySeedReceipt,
} from "./frozen-prehistory";
import {
  parseCodexFeatureList,
} from "./native-canary-contracts";
import { assertCanaryExecutableInsidePrefix } from "./native-canary-runtime";
import {
  assertTrustedManagedHooks,
} from "./native-canary";
import {
  parseNativeCanaryWritebackInspection,
} from "./native-canary-state";
import {
  buildCodexEvaluatorSandboxConfigSha256,
} from "./evaluator-sandbox";
import type {
  CodexEvaluatorSandboxEvidence,
} from "./evaluator-sandbox";
import { runBoundaryProcess } from "./process";
import type {
  BoundaryProcessRequest,
  BoundaryProcessResult,
} from "./process";

const RUNTIME_MARKER = ".goodmemory-c3-runner-owned";
const C3_PERMISSION_PROFILE_NAME = "c3-task";

export const C3_EVALUATOR_DENIED_PATH_LABELS = [
  "codex-auth-source",
  "goodmemory-installed-runtime",
  "goodmemory-source",
  "no-memory-runtime",
  "output-root",
  "package-tarball",
  "raw-prehistory",
  "runner-source",
  "source-repository",
] as const;

const statusSchema = z.object({
  hosts: z.array(z.object({
    activationMode: z.string(),
    hookRegistered: z.boolean(),
    host: z.literal("codex"),
    mcpRegistered: z.boolean(),
    workspaceStatus: z.string(),
    writeback: z.object({
      mode: z.string(),
      persistRawTranscript: z.boolean(),
    }).passthrough(),
  }).passthrough()).length(1),
}).passthrough();

const globalConfigSchema = z.object({
  activationMode: z.string(),
  retrievalProfile: z.string(),
  storage: z.object({
    path: z.string().min(1),
    provider: z.literal("sqlite"),
  }).passthrough(),
  userId: z.string().min(1),
  writeback: z.object({
    mode: z.string(),
    persistRawTranscript: z.boolean().optional(),
  }).passthrough(),
}).passthrough();

const writebackResultSchema = z.object({
  reason: z.string(),
  trace: z.object({
    rawTranscriptPersisted: z.boolean(),
    transcriptPathUsed: z.boolean(),
    transcriptSessionDigest: z.string().min(1),
  }).passthrough(),
  wrote: z.boolean(),
}).passthrough();

export type C3BoundaryRunner = (
  request: BoundaryProcessRequest,
) => Promise<BoundaryProcessResult>;

export interface C3PermissionProfile {
  configSha256: string;
  filesystemDefault: "deny";
  minimalRead: true;
  name: "c3-task";
  networkAccess: false;
  workspaceWrite: true;
}

export interface C3InstalledArmRuntime {
  codex: {
    executable: string;
    executableSha256: string;
    hooksEnabled: boolean;
    version: string;
  };
  env: Record<string, string>;
  goodmemoryExecutable: string;
  instructionSha256: string;
  package: {
    sha256: string;
    version: string;
  };
  permissionProfile: C3PermissionProfile;
  plan: C3ArmPlan & { arm: "goodmemory-installed" };
  preexistingSessionCount: number;
  profile: {
    activationMode: "global";
    hookRegistered: true;
    mcpRegistered: true;
    persistRawTranscript: false;
    retrievalProfile: "coding_agent";
    workspaceStatus: "ok";
    writebackMode: "selective";
  };
  storagePath: string;
}

export interface C3NoMemoryArmRuntime {
  codex: {
    executable: string;
    executableSha256: string;
    version: string;
  };
  env: Record<string, string>;
  instructionSha256: string;
  isolation: NoMemoryRuntimeAudit;
  permissionProfile: C3PermissionProfile;
  plan: C3ArmPlan & { arm: "no-memory" };
}

export interface C3FlatSummaryArmRuntime {
  codex: {
    executable: string;
    executableSha256: string;
    version: string;
  };
  env: Record<string, string>;
  hookConfig: {
    path: string;
    sha256: string;
  };
  hookRunnerSha256: string;
  instructionSha256: string;
  isolation: NoMemoryRuntimeAudit;
  permissionProfile: C3PermissionProfile;
  plan: C3FlatSummaryArmPlan;
}

export type C3BaselineArmRuntime =
  | C3FlatSummaryArmRuntime
  | C3NoMemoryArmRuntime;

export interface C3SeedResult {
  exportLeakageAudit: FrozenPrehistoryLeakageAudit;
  receipt: FrozenPrehistorySeedReceipt;
}

export interface C3EvaluatorSecurityPathCommitment {
  label: string;
  path: string;
  pathSha256: string;
}

export interface C3CredentialRevocationEvidence {
  arm: C3ArmPlan["arm"];
  auth: C3EvaluatorSecurityPathCommitment;
  copiedAuthRemovedBeforeEvaluator: true;
  phase: "after-both-codex-before-evaluator-materialization";
  schemaVersion: 1;
}

export interface C3EvaluatorSecurityContract {
  arms: {
    goodmemoryInstalled: {
      copiedAuth: C3EvaluatorSecurityPathCommitment;
      evaluationWorkspace: C3EvaluatorSecurityPathCommitment;
      evaluatorRoot: C3EvaluatorSecurityPathCommitment;
      expectedConfigSha256: string;
      sandboxRoot: C3EvaluatorSecurityPathCommitment;
    };
    noMemory: {
      copiedAuth: C3EvaluatorSecurityPathCommitment;
      evaluationWorkspace: C3EvaluatorSecurityPathCommitment;
      evaluatorRoot: C3EvaluatorSecurityPathCommitment;
      expectedConfigSha256: string;
      sandboxRoot: C3EvaluatorSecurityPathCommitment;
    };
  };
  credentialRemoval:
    "after-both-codex-before-evaluator-materialization";
  deniedPaths: C3EvaluatorSecurityPathCommitment[];
  evidencePath: "evaluator-security.sanitized.json";
  profileName: "c3-evaluator";
  requirements: {
    configWriteDenied: true;
    copiedAuthRemovedBeforeEvaluator: true;
    evaluatorRead: true;
    evaluatorWriteDenied: true;
    networkAccess: false;
    networkDenied: true;
    networkPositiveControl: true;
    originalAuthAliasDenied: true;
    originalAuthDenied: true;
    workspaceRead: true;
    workspaceWrite: true;
  };
  schemaVersion: 1;
  sourceEvaluatorRoot: C3EvaluatorSecurityPathCommitment;
}

export interface C3EvaluatorSecurityEvidence {
  contract: C3EvaluatorSecurityContract;
  credentialRevocations: {
    goodmemoryInstalled: C3CredentialRevocationEvidence & {
      arm: "goodmemory-installed";
    };
    noMemory: C3CredentialRevocationEvidence & {
      arm: "no-memory";
    };
  };
  sandboxes: {
    goodmemoryInstalled: CodexEvaluatorSandboxEvidence & {
      evaluatorRoot: C3EvaluatorSecurityPathCommitment;
      profileName: "c3-evaluator";
    };
    noMemory: CodexEvaluatorSandboxEvidence & {
      evaluatorRoot: C3EvaluatorSecurityPathCommitment;
      profileName: "c3-evaluator";
    };
  };
  schemaVersion: 1;
}

export { preflightC3InstalledRecall } from "./c3-recall-preflight";
export type { C3RecallPreflightEvidence } from "./c3-recall-preflight";

export { auditC3PermissionIsolation } from "./c3-permission-isolation";
export type {
  C3PermissionIsolationAudit,
  C3PermissionIsolationEvidence,
} from "./c3-permission-isolation";

export function buildC3EvaluatorSecurityContract(input: {
  authFile: string;
  deniedPaths: ReadonlyArray<{ label: string; path: string }>;
  evaluatorRoot: string;
  goodmemoryInstalled: {
    evaluationWorkspace: string;
    runtime: C3InstalledArmRuntime;
    sandboxRoot: string;
  };
  noMemory: {
    evaluationWorkspace: string;
    runtime: C3NoMemoryArmRuntime;
    sandboxRoot: string;
  };
}): C3EvaluatorSecurityContract {
  const deniedPaths = input.deniedPaths.map(({ label, path }) =>
    pathCommitment(label, path)
  ).sort((first, second) => first.label.localeCompare(second.label));
  assertC3EvaluatorDeniedPathLabels(deniedPaths);
  const sourceEvaluatorRoot = pathCommitment(
    "source-evaluator-root",
    input.evaluatorRoot,
  );
  const sandboxDeniedReadPaths = [
    input.authFile,
    input.evaluatorRoot,
    ...input.deniedPaths.map(({ path }) => path),
  ];
  const armContract = (
    arm: "goodmemory-installed" | "no-memory",
    runtime: C3InstalledArmRuntime | C3NoMemoryArmRuntime,
    evaluationWorkspace: string,
    sandboxRoot: string,
  ) => {
    const resolvedEvaluationWorkspace = resolve(evaluationWorkspace);
    const resolvedSandboxRoot = resolve(sandboxRoot);
    const expectedEvaluationWorkspace = resolve(
      resolvedSandboxRoot,
      "workspace",
    );
    if (resolvedEvaluationWorkspace !== expectedEvaluationWorkspace) {
      throw new Error(
        `C3 ${arm} evaluator workspace must stay at sandboxRoot/workspace`,
      );
    }
    const evaluatorRoot = resolve(resolvedSandboxRoot, "evaluator");
    return {
      copiedAuth: pathCommitment(
        `${arm}-copied-auth`,
        join(runtime.plan.paths.codexHome, "auth.json"),
      ),
      evaluationWorkspace: pathCommitment(
        `${arm}-evaluation-workspace`,
        resolvedEvaluationWorkspace,
      ),
      evaluatorRoot: pathCommitment(
        `${arm}-evaluator-root`,
        evaluatorRoot,
      ),
      expectedConfigSha256: buildCodexEvaluatorSandboxConfigSha256({
        deniedReadPaths: sandboxDeniedReadPaths,
        evaluationWorkspace: resolvedEvaluationWorkspace,
        evaluatorRoot,
        profileName: "c3-evaluator",
        sandboxRoot: resolvedSandboxRoot,
      }),
      sandboxRoot: pathCommitment(
        `${arm}-sandbox-root`,
        resolvedSandboxRoot,
      ),
    };
  };
  return {
    arms: {
      goodmemoryInstalled: armContract(
        "goodmemory-installed",
        input.goodmemoryInstalled.runtime,
        input.goodmemoryInstalled.evaluationWorkspace,
        input.goodmemoryInstalled.sandboxRoot,
      ),
      noMemory: armContract(
        "no-memory",
        input.noMemory.runtime,
        input.noMemory.evaluationWorkspace,
        input.noMemory.sandboxRoot,
      ),
    },
    credentialRemoval:
      "after-both-codex-before-evaluator-materialization",
    deniedPaths,
    evidencePath: "evaluator-security.sanitized.json",
    profileName: "c3-evaluator",
    requirements: {
      configWriteDenied: true,
      copiedAuthRemovedBeforeEvaluator: true,
      evaluatorRead: true,
      evaluatorWriteDenied: true,
      networkAccess: false,
      networkDenied: true,
      networkPositiveControl: true,
      originalAuthAliasDenied: true,
      originalAuthDenied: true,
      workspaceRead: true,
      workspaceWrite: true,
    },
    schemaVersion: 1,
    sourceEvaluatorRoot,
  };
}

export async function removeC3ArmModelCredential(
  runtime: C3InstalledArmRuntime | C3BaselineArmRuntime,
): Promise<C3CredentialRevocationEvidence> {
  const authPath = join(runtime.plan.paths.codexHome, "auth.json");
  await assertRegularFile(
    authPath,
    `${runtime.plan.arm} copied Codex auth`,
  );
  await rm(authPath);
  await assertC3ArmModelCredentialRemoved(runtime);
  return {
    arm: runtime.plan.arm,
    auth: pathCommitment(`${runtime.plan.arm}-copied-auth`, authPath),
    copiedAuthRemovedBeforeEvaluator: true,
    phase: "after-both-codex-before-evaluator-materialization",
    schemaVersion: 1,
  };
}

export async function assertC3ArmModelCredentialRemoved(
  runtime: C3InstalledArmRuntime | C3BaselineArmRuntime,
): Promise<void> {
  if (await pathExists(join(runtime.plan.paths.codexHome, "auth.json"))) {
    throw new Error(
      `C3 ${runtime.plan.arm} copied model credential remained before evaluator materialization`,
    );
  }
}

export function buildC3EvaluatorSecurityEvidence(input: {
  contract: C3EvaluatorSecurityContract;
  credentialRevocations: {
    goodmemoryInstalled: C3CredentialRevocationEvidence;
    noMemory: C3CredentialRevocationEvidence;
  };
  sandboxes: {
    goodmemoryInstalled: {
      evidence: CodexEvaluatorSandboxEvidence;
      evaluatorRoot: string;
    };
    noMemory: {
      evidence: CodexEvaluatorSandboxEvidence;
      evaluatorRoot: string;
    };
  };
}): C3EvaluatorSecurityEvidence {
  const validateArm = (
    arm: "goodmemory-installed" | "no-memory",
    contractArm:
      C3EvaluatorSecurityContract["arms"]["goodmemoryInstalled"],
    revocation: C3CredentialRevocationEvidence,
    sandbox: {
      evidence: CodexEvaluatorSandboxEvidence;
      evaluatorRoot: string;
    },
  ): void => {
    const evaluatorRoot = pathCommitment(
      `${arm}-evaluator-root`,
      sandbox.evaluatorRoot,
    );
    if (
      revocation.arm !== arm ||
      revocation.phase !== input.contract.credentialRemoval ||
      JSON.stringify(revocation.auth) !==
        JSON.stringify(contractArm.copiedAuth) ||
      JSON.stringify(evaluatorRoot) !==
        JSON.stringify(contractArm.evaluatorRoot) ||
      sandbox.evidence.profileName !== input.contract.profileName ||
      sandbox.evidence.configSha256 !== contractArm.expectedConfigSha256 ||
      !sandbox.evidence.configWriteDenied ||
      !sandbox.evidence.copiedAuthRemovedBeforeEvaluator ||
      !sandbox.evidence.evaluatorRead ||
      !sandbox.evidence.evaluatorWriteDenied ||
      sandbox.evidence.networkAccess !== false ||
      !sandbox.evidence.networkDenied ||
      !sandbox.evidence.networkPositiveControl ||
      !sandbox.evidence.originalAuthAliasDenied ||
      !sandbox.evidence.originalAuthDenied ||
      !sandbox.evidence.workspaceRead ||
      !sandbox.evidence.workspaceWrite
    ) {
      throw new Error(`C3 ${arm} evaluator security evidence drifted`);
    }
  };
  validateArm(
    "goodmemory-installed",
    input.contract.arms.goodmemoryInstalled,
    input.credentialRevocations.goodmemoryInstalled,
    input.sandboxes.goodmemoryInstalled,
  );
  validateArm(
    "no-memory",
    input.contract.arms.noMemory,
    input.credentialRevocations.noMemory,
    input.sandboxes.noMemory,
  );
  return {
    contract: input.contract,
    credentialRevocations: {
      goodmemoryInstalled: {
        ...input.credentialRevocations.goodmemoryInstalled,
        arm: "goodmemory-installed",
      },
      noMemory: {
        ...input.credentialRevocations.noMemory,
        arm: "no-memory",
      },
    },
    sandboxes: {
      goodmemoryInstalled: {
        ...input.sandboxes.goodmemoryInstalled.evidence,
        evaluatorRoot:
          input.contract.arms.goodmemoryInstalled.evaluatorRoot,
        profileName: "c3-evaluator",
      },
      noMemory: {
        ...input.sandboxes.noMemory.evidence,
        evaluatorRoot: input.contract.arms.noMemory.evaluatorRoot,
        profileName: "c3-evaluator",
      },
    },
    schemaVersion: 1,
  };
}

export async function prepareC3NoMemoryArm(input: {
  authFile: string;
  bunExecutable: string;
  codexExecutable: string;
  permissionDeniedReadPaths?: readonly string[];
  plan: C3ArmPlan & { arm: "no-memory" };
  runProcess?: C3BoundaryRunner;
}): Promise<C3NoMemoryArmRuntime> {
  const [bunExecutable, codexExecutable] = await Promise.all([
    resolveExecutablePath(input.bunExecutable, "Bun executable"),
    resolveExecutablePath(input.codexExecutable, "Codex executable"),
  ]);
  await initializeRuntime(input.plan);
  await installAuthFile(input.authFile, input.plan.paths.codexHome);
  const permissionProfile = await installC3PermissionProfile(
    input.plan.paths.codexHome,
    input.permissionDeniedReadPaths,
  );
  const env = buildIsolatedEnvironment({
    bunExecutable,
    plan: input.plan,
  });
  await assertGoodMemoryAbsentFromPath(env.PATH);
  const isolation = await auditNoMemoryRuntime({
    codexHome: input.plan.paths.codexHome,
    home: input.plan.paths.home,
  });
  if (!isolation.passed) {
    throw new Error(`no-memory isolation failed: ${isolation.reasons.join("; ")}`);
  }
  const run = input.runProcess ?? runBoundaryProcess;
  const version = (await runRequired(run, {
    args: ["--version"],
    cwd: input.plan.paths.workspace,
    env,
    executable: codexExecutable,
    label: "codex-version-no-memory",
  })).stdout.trim();

  return {
    codex: {
      executable: codexExecutable,
      executableSha256: await sha256File(codexExecutable),
      version,
    },
    env,
    instructionSha256: await captureInstructionSha256(
      input.plan.paths.workspace,
    ),
    isolation,
    permissionProfile,
    plan: input.plan,
  };
}

export async function prepareC3FlatSummaryArm(input: {
  authFile: string;
  bunExecutable: string;
  codexExecutable: string;
  permissionDeniedReadPaths?: readonly string[];
  plan: C3FlatSummaryArmPlan;
  runProcess?: C3BoundaryRunner;
}): Promise<C3FlatSummaryArmRuntime> {
  const [bunExecutable, codexExecutable] = await Promise.all([
    resolveExecutablePath(input.bunExecutable, "Bun executable"),
    resolveExecutablePath(input.codexExecutable, "Codex executable"),
  ]);
  await initializeRuntime(input.plan);
  await mkdir(input.plan.paths.injectionRoot, { recursive: true });
  await installAuthFile(input.authFile, input.plan.paths.codexHome);
  // Native hooks must be enabled in the Codex config exactly as the installed
  // GoodMemory profile enables them; the permission profile is layered on top.
  await writeFile(
    join(input.plan.paths.codexHome, "config.toml"),
    "[features]\nhooks = true\n",
    "utf8",
  );
  const permissionProfile = await installC3PermissionProfile(
    input.plan.paths.codexHome,
    input.permissionDeniedReadPaths,
  );
  const runnerPath = join(input.plan.paths.armRoot, "flat-summary-hook.mjs");
  const runnerSource = buildC5FlatSummaryHookRunnerSource({
    injectionRoot: input.plan.paths.injectionRoot,
  });
  await writeFile(runnerPath, runnerSource, "utf8");
  const hookConfigPath = join(input.plan.paths.codexHome, "hooks.json");
  const hookConfig = buildC5FlatSummaryHookConfig({ runnerPath });
  await writeFile(hookConfigPath, hookConfig, "utf8");
  const env = buildIsolatedEnvironment({
    bunExecutable,
    plan: input.plan,
  });
  await assertGoodMemoryAbsentFromPath(env.PATH);
  const isolation = await auditFlatSummaryRuntime({
    codexHome: input.plan.paths.codexHome,
    expectedHookConfigSha256: sha256(hookConfig),
    home: input.plan.paths.home,
  });
  if (!isolation.passed) {
    throw new Error(
      `flat-summary isolation failed: ${isolation.reasons.join("; ")}`,
    );
  }
  const run = input.runProcess ?? runBoundaryProcess;
  const version = (await runRequired(run, {
    args: ["--version"],
    cwd: input.plan.paths.workspace,
    env,
    executable: codexExecutable,
    label: "codex-version-flat-summary",
  })).stdout.trim();

  return {
    codex: {
      executable: codexExecutable,
      executableSha256: await sha256File(codexExecutable),
      version,
    },
    env,
    hookConfig: { path: hookConfigPath, sha256: sha256(hookConfig) },
    hookRunnerSha256: sha256(runnerSource),
    instructionSha256: await captureInstructionSha256(
      input.plan.paths.workspace,
    ),
    isolation,
    permissionProfile,
    plan: input.plan,
  };
}

export async function prepareC3InstalledArm(input: {
  authFile: string;
  bunExecutable: string;
  codexExecutable: string;
  npmCacheSeed?: string;
  npmExecutable: string;
  npmRegistry?: string;
  packageTarball: string;
  permissionDeniedReadPaths?: readonly string[];
  plan: C3ArmPlan & { arm: "goodmemory-installed" };
  runProcess?: C3BoundaryRunner;
}): Promise<C3InstalledArmRuntime> {
  await assertRegularFile(input.packageTarball, "GoodMemory package tarball");
  const [bunExecutable, codexExecutable, npmExecutable] = await Promise.all([
    resolveExecutablePath(input.bunExecutable, "Bun executable"),
    resolveExecutablePath(input.codexExecutable, "Codex executable"),
    resolveExecutablePath(input.npmExecutable, "npm executable"),
  ]);
  await initializeRuntime(input.plan);
  const instructionSha256 = await captureInstructionSha256(
    input.plan.paths.workspace,
  );
  const prefix = input.plan.paths.packagePrefix;
  if (prefix === undefined) {
    throw new Error("installed C3 arm requires an isolated package prefix");
  }
  // The arm's npm cache is its own directory either way. A runner-owned seed
  // cache, when given, is copied in and the install runs offline, so every
  // cluster resolves the tarball's dependencies identically and no registry
  // fetch can stall or drift the install; without a seed the cache is cold and
  // each fetch is bounded so one stalled connection cannot consume the budget.
  const seeded = input.npmCacheSeed !== undefined;
  if (input.npmCacheSeed !== undefined) {
    await assertRealDirectory(input.npmCacheSeed, "npm cache seed");
    await cp(input.npmCacheSeed, input.plan.paths.cache, {
      errorOnExist: false,
      force: true,
      recursive: true,
    });
  }
  const env = buildIsolatedEnvironment({
    bunExecutable,
    packagePrefix: prefix,
    plan: input.plan,
  });
  const run = input.runProcess ?? runBoundaryProcess;
  await runRequired(run, {
    args: [
      "install",
      "--global",
      "--prefix",
      prefix,
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      ...(seeded
        ? ["--offline"]
        : ["--fetch-retries", "5", "--fetch-timeout", "60000"]),
      ...(input.npmRegistry === undefined
        ? []
        : ["--registry", input.npmRegistry]),
      input.packageTarball,
    ],
    cwd: input.plan.paths.temp,
    env,
    executable: npmExecutable,
    label: "package-install",
    timeoutMs: 900_000,
  });
  await installAuthFile(input.authFile, input.plan.paths.codexHome);
  const goodmemoryExecutable = join(prefix, "bin", "goodmemory");
  await Promise.all([
    assertCanaryExecutableInsidePrefix(
      goodmemoryExecutable,
      "isolated goodmemory executable",
      prefix,
    ),
    assertCanaryExecutableInsidePrefix(
      join(prefix, "bin", "goodmemory-mcp"),
      "isolated goodmemory-mcp executable",
      prefix,
    ),
  ]);
  const packageVersion = (await runRequired(run, {
    args: ["--version"],
    cwd: input.plan.paths.workspace,
    env,
    executable: goodmemoryExecutable,
    label: "goodmemory-version",
  })).stdout.trim();
  await runRequired(run, {
    args: buildInstalledGoodMemorySetupArgs({
      userId: input.plan.scopes.userId,
    }),
    cwd: input.plan.paths.workspace,
    env,
    executable: goodmemoryExecutable,
    label: "goodmemory-setup",
  });
  if (
    await captureInstructionSha256(input.plan.paths.workspace) !==
      instructionSha256 ||
    await pathExists(join(input.plan.paths.workspace, ".goodmemory"))
  ) {
    throw new Error("recommended global setup mutated the task workspace");
  }

  const statusRaw = (await runRequired(run, {
    args: [
      "status",
      "codex",
      "--workspace-root",
      input.plan.paths.workspace,
      "--json",
    ],
    cwd: input.plan.paths.workspace,
    env,
    executable: goodmemoryExecutable,
    label: "goodmemory-status",
  })).stdout;
  await runRequired(run, {
    args: [
      "doctor",
      "codex",
      "--workspace-root",
      input.plan.paths.workspace,
      "--json",
    ],
    cwd: input.plan.paths.workspace,
    env,
    executable: goodmemoryExecutable,
    label: "goodmemory-doctor",
  });
  const host = parseExternalJson(statusRaw, statusSchema, "C3 host status").hosts[0]!;
  const globalConfig = parseExternalJson(
    await readFile(
      join(input.plan.paths.home, ".goodmemory", "codex.json"),
      "utf8",
    ),
    globalConfigSchema,
    "C3 installed profile",
  );
  const persistRawTranscript = host.writeback.persistRawTranscript ||
    globalConfig.writeback.persistRawTranscript === true;
  if (
    host.activationMode !== "global" ||
    !host.hookRegistered ||
    !host.mcpRegistered ||
    host.workspaceStatus !== "ok" ||
    host.writeback.mode !== "selective" ||
    globalConfig.activationMode !== "global" ||
    globalConfig.retrievalProfile !== "coding_agent" ||
    globalConfig.writeback.mode !== "selective" ||
    persistRawTranscript
  ) {
    throw new Error("installed C3 profile does not match recommended global selective mode");
  }
  if (globalConfig.userId !== input.plan.scopes.userId) {
    throw new Error("installed C3 profile user scope does not match the arm plan");
  }

  const hooksRaw = await readFile(
    join(input.plan.paths.codexHome, "hooks.json"),
    "utf8",
  );
  assertTrustedManagedHooks(hooksRaw, input.plan.paths.home);
  const codexConfig = await readFile(
    join(input.plan.paths.codexHome, "config.toml"),
    "utf8",
  );
  if (!/^hooks\s*=\s*true\b/mu.test(codexConfig)) {
    throw new Error("installed C3 Codex config does not enable hooks");
  }
  const permissionProfile = await installC3PermissionProfile(
    input.plan.paths.codexHome,
    input.permissionDeniedReadPaths,
  );
  const codexVersion = (await runRequired(run, {
    args: ["--version"],
    cwd: input.plan.paths.workspace,
    env,
    executable: codexExecutable,
    label: "codex-version-installed",
  })).stdout.trim();
  const featureRaw = (await runRequired(run, {
    args: ["--disable", "memories", "features", "list"],
    cwd: input.plan.paths.workspace,
    env,
    executable: codexExecutable,
    label: "codex-features-installed",
  })).stdout;
  const hooks = parseCodexFeatureList(featureRaw);
  if (
    !hooks.enabled ||
    hooks.maturity !== "stable" ||
    readFeatureEnabled(featureRaw, "memories") !== false
  ) {
    throw new Error(
      "installed Codex does not expose stable hooks with memories disabled",
    );
  }
  const preexistingSessionCount = await countSessionFiles(
    input.plan.paths.codexHome,
  );
  if (preexistingSessionCount !== 0) {
    throw new Error("installed C3 arm contains pre-existing Codex sessions");
  }

  return {
    codex: {
      executable: codexExecutable,
      executableSha256: await sha256File(codexExecutable),
      hooksEnabled: true,
      version: codexVersion,
    },
    env,
    goodmemoryExecutable,
    instructionSha256,
    package: {
      sha256: await sha256File(input.packageTarball),
      version: packageVersion,
    },
    permissionProfile,
    plan: input.plan,
    preexistingSessionCount,
    profile: {
      activationMode: "global",
      hookRegistered: true,
      mcpRegistered: true,
      persistRawTranscript: false,
      retrievalProfile: "coding_agent",
      workspaceStatus: "ok",
      writebackMode: "selective",
    },
    storagePath: globalConfig.storage.path,
  };
}

function readFeatureEnabled(
  rawOutput: string,
  name: string,
): boolean | null {
  for (const line of rawOutput.split(/\r?\n/u)) {
    const fields = line.trim().split(/\s+/u);
    if (
      fields[0] === name &&
      (fields[2] === "true" || fields[2] === "false")
    ) {
      return fields[2] === "true";
    }
  }
  return null;
}

export async function seedC3InstalledArm(input: {
  artifact: FrozenPrehistoryArtifact;
  declaredForbiddenSourceSha256: readonly string[];
  forbiddenSources: ReadonlyArray<{ content: string; label: string }>;
  forbiddenStrings: readonly string[];
  receiptPath: string;
  runProcess?: C3BoundaryRunner;
  runtime: C3InstalledArmRuntime;
}): Promise<C3SeedResult> {
  await assertFrozenPrehistoryUnchanged(input.artifact);
  const run = input.runProcess ?? runBoundaryProcess;
  const writebackRaw = (await runRequired(run, {
    args: [
      "codex",
      "writeback",
      "--from-rollout",
      "--rollout-path",
      input.artifact.path,
      "--workspace-root",
      input.runtime.plan.paths.workspace,
      "--json",
    ],
    cwd: input.runtime.plan.paths.workspace,
    env: input.runtime.env,
    executable: input.runtime.goodmemoryExecutable,
    label: "frozen-prehistory-writeback",
  })).stdout;
  const writeback = parseExternalJson(
    writebackRaw,
    writebackResultSchema,
    "C3 frozen-prehistory writeback",
  );
  if (
    !writeback.wrote ||
    writeback.reason !== "written" ||
    writeback.trace.rawTranscriptPersisted ||
    !writeback.trace.transcriptPathUsed
  ) {
    throw new Error("frozen-prehistory selective writeback did not commit safely");
  }

  const sourceSessionDigest = writeback.trace.transcriptSessionDigest;
  const inspectionRaw = (await runRequired(run, {
    args: [
      "codex",
      "writeback",
      "inspect",
      "--workspace-root",
      input.runtime.plan.paths.workspace,
      "--limit",
      "50",
      "--json",
    ],
    cwd: input.runtime.plan.paths.workspace,
    env: input.runtime.env,
    executable: input.runtime.goodmemoryExecutable,
    label: "frozen-prehistory-writeback-inspect",
  })).stdout;
  const writtenMemoryIds = [...new Set(
    parseNativeCanaryWritebackInspection(inspectionRaw)
      .filter((event) =>
        event.command === "session-end" &&
        event.sessionDigest === sourceSessionDigest &&
        event.status === "committed"
      )
      .flatMap((event) => event.linkedRecordIds)
      .filter((record) => record.type === "memory")
      .map((record) => record.id),
  )].sort();
  if (writtenMemoryIds.length === 0) {
    throw new Error("frozen-prehistory writeback has no committed memory receipt");
  }

  const exportRoot = join(input.runtime.plan.paths.result, "seed-export");
  await runRequired(run, {
    args: [
      "export-memory",
      "--user-id",
      input.runtime.plan.scopes.userId,
      "--workspace-id",
      input.runtime.plan.scopes.workspaceId,
      "--storage-provider",
      "sqlite",
      "--storage-url",
      input.runtime.storagePath,
      "--output",
      exportRoot,
    ],
    cwd: input.runtime.plan.paths.workspace,
    env: input.runtime.env,
    executable: input.runtime.goodmemoryExecutable,
    label: "frozen-prehistory-export",
  });
  const memoryExport = await readFile(
    join(exportRoot, "memory-export.json"),
    "utf8",
  );
  const exportLeakageAudit = auditFrozenPrehistoryLeakage({
    artifact: {
      path: join(exportRoot, "memory-export.json"),
      records: [{
        id: "memory-export",
        message: memoryExport,
        role: "assistant",
      }],
      sourceBytes: memoryExport,
      sourceSha256: sha256(memoryExport),
    },
    declaredForbiddenSourceSha256: input.declaredForbiddenSourceSha256,
    forbiddenSources: input.forbiddenSources,
    forbiddenStrings: input.forbiddenStrings,
  });
  await writeFile(
    join(input.runtime.plan.paths.result, "seed-export-leakage-audit.json"),
    `${JSON.stringify(exportLeakageAudit, null, 2)}\n`,
    "utf8",
  );
  if (!exportLeakageAudit.passed) {
    throw new Error("seeded GoodMemory export failed the leakage audit");
  }
  await assertFrozenPrehistoryUnchanged(input.artifact);

  const receipt: FrozenPrehistorySeedReceipt = {
    historySourceSha256: input.artifact.sourceSha256,
    memoryExportSha256: sha256(memoryExport),
    rawTranscriptPersisted: false,
    schemaVersion: 1,
    seedSurface: "codex-writeback-from-rollout",
    sourceSessionDigest,
    writebackOutcome: "written",
    writtenMemoryIds,
  };
  await persistFrozenPrehistorySeedReceipt(input.receiptPath, receipt);
  return { exportLeakageAudit, receipt };
}

export async function cleanupC3ArmRuntime(
  runtime: C3InstalledArmRuntime | C3BaselineArmRuntime,
): Promise<void> {
  const marker = await readFile(
    join(runtime.plan.paths.armRoot, RUNTIME_MARKER),
    "utf8",
  );
  if (marker !== `${runtime.plan.arm}\n`) {
    throw new Error("refusing to remove C3 runtime without its ownership marker");
  }
  await rm(runtime.plan.paths.armRoot, { force: true, recursive: true });
}

async function initializeRuntime(plan: C3ArmPlan): Promise<void> {
  if (await pathExists(plan.paths.armRoot)) {
    throw new Error(`C3 arm runtime already exists: ${plan.paths.armRoot}`);
  }
  await Promise.all([
    mkdir(plan.paths.cache, { recursive: true }),
    mkdir(plan.paths.codexHome, { recursive: true }),
    mkdir(plan.paths.result, { recursive: true }),
    mkdir(plan.paths.temp, { recursive: true }),
    mkdir(join(plan.paths.workspace, ".git", "c3-tmp"), { recursive: true }),
  ]);
  await writeFile(
    join(plan.paths.armRoot, RUNTIME_MARKER),
    `${plan.arm}\n`,
    "utf8",
  );
}

async function installAuthFile(
  authFile: string,
  codexHome: string,
): Promise<void> {
  await assertRegularFile(authFile, "Codex auth source");
  const destination = join(codexHome, "auth.json");
  await copyFile(authFile, destination);
  await chmod(destination, 0o600);
}

async function installC3PermissionProfile(
  codexHome: string,
  permissionDeniedReadPaths: readonly string[] = [],
): Promise<C3PermissionProfile> {
  const configPath = join(codexHome, "config.toml");
  const existing = await readOptionalText(configPath) ?? "";
  if (
    /^default_permissions\s*=/mu.test(existing) ||
    /^\[permissions\./mu.test(existing)
  ) {
    throw new Error("isolated Codex config already defines a permission profile");
  }
  if (
    /^\s*sandbox_mode\s*=/mu.test(existing) ||
    /^\s*\[sandbox_workspace_write(?:\.|\])/mu.test(existing)
  ) {
    throw new Error(
      "isolated Codex config contains legacy sandbox settings that disable permission profiles",
    );
  }
  // Caller order is preserved: the C5 denied-path builder orders paths by
  // category so the normalized permission section reads identically across
  // clusters; a lexicographic sort of the raw digest-bearing paths would not.
  const deniedPaths = [...new Set(
    permissionDeniedReadPaths.map((path) => resolve(path)),
  )];
  const config = [
    `default_permissions = "${C3_PERMISSION_PROFILE_NAME}"`,
    'web_search = "disabled"',
    "",
    existing.trim(),
    existing.trim().length > 0 ? "" : undefined,
    `[permissions.${C3_PERMISSION_PROFILE_NAME}.filesystem]`,
    '":root" = "deny"',
    '":minimal" = "read"',
    ...deniedPaths.map((path) => `${JSON.stringify(path)} = "deny"`),
    "",
    `[permissions.${C3_PERMISSION_PROFILE_NAME}.filesystem.":workspace_roots"]`,
    '"." = "write"',
    "",
    `[permissions.${C3_PERMISSION_PROFILE_NAME}.network]`,
    "enabled = false",
    "",
  ].filter((line): line is string => line !== undefined).join("\n");
  await writeFile(configPath, config, "utf8");
  return {
    configSha256: sha256(config),
    filesystemDefault: "deny",
    minimalRead: true,
    name: C3_PERMISSION_PROFILE_NAME,
    networkAccess: false,
    workspaceWrite: true,
  };
}

function buildIsolatedEnvironment(input: {
  bunExecutable: string;
  packagePrefix?: string;
  plan: C3ArmPlan;
}): Record<string, string> {
  const nodeExecutable = Bun.which("node");
  const pathParts = [
    ...(input.packagePrefix ? [join(input.packagePrefix, "bin")] : []),
    dirname(resolve(input.bunExecutable)),
    ...(nodeExecutable ? [dirname(nodeExecutable)] : []),
    "/usr/bin",
    "/bin",
  ];
  const env: Record<string, string> = {
    CI: "1",
    CODEX_HOME: input.plan.paths.codexHome,
    GOODMEMORY_BUN_BINARY: resolve(input.bunExecutable),
    HOME: input.plan.paths.home,
    LANG: process.env.LANG ?? "en_US.UTF-8",
    NO_COLOR: "1",
    PATH: [...new Set(pathParts)].join(":"),
    RUST_LOG: "error",
    TMPDIR: join(input.plan.paths.workspace, ".git", "c3-tmp"),
    npm_config_cache: input.plan.paths.cache,
    ...(input.packagePrefix
      ? { GOODMEMORY_HOME: input.plan.paths.home }
      : {}),
  };
  for (const name of [
    "ALL_PROXY",
    "CODEX_CA_CERTIFICATE",
    "HTTPS_PROXY",
    "HTTP_PROXY",
    "NO_PROXY",
    "SSL_CERT_FILE",
    "all_proxy",
    "https_proxy",
    "http_proxy",
    "no_proxy",
  ]) {
    const value = process.env[name];
    if (value) {
      env[name] = value;
    }
  }
  return env;
}

async function assertGoodMemoryAbsentFromPath(pathValue: string): Promise<void> {
  for (const directory of pathValue.split(":")) {
    if (await pathExists(join(directory, "goodmemory"))) {
      throw new Error(`no-memory PATH exposes a goodmemory executable: ${directory}`);
    }
  }
}

async function runRequired(
  run: C3BoundaryRunner,
  input: {
    args: readonly string[];
    cwd: string;
    env: Record<string, string>;
    executable: string;
    label: string;
    stdin?: string;
    timeoutMs?: number;
  },
): Promise<BoundaryProcessResult> {
  const result = await run({
    args: input.args,
    cwd: input.cwd,
    env: input.env,
    executable: input.executable,
    stdin: input.stdin,
    timeoutMs: input.timeoutMs ?? 120_000,
  });
  if (result.spawnError !== undefined) {
    throw new Error(`${input.label} failed to start: ${result.spawnError}`);
  }
  if (result.timedOut) {
    throw new Error(`${input.label} timed out`);
  }
  if (result.exitCode !== 0) {
    throw new Error(`${input.label} exited with code ${result.exitCode}`);
  }
  return result;
}

async function captureInstructionSha256(workspace: string): Promise<string> {
  const entries = await collectInstructionFiles(workspace, workspace);
  const hash = createHash("sha256");
  for (const path of entries.sort()) {
    hash.update(relative(workspace, path));
    hash.update("\0");
    hash.update(await readFile(path));
    hash.update("\0");
  }
  return hash.digest("hex");
}

async function collectInstructionFiles(
  root: string,
  directory: string,
): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === "node_modules") {
      continue;
    }
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === ".goodmemory") {
        continue;
      }
      files.push(...await collectInstructionFiles(root, path));
      continue;
    }
    const relativePath = relative(root, path);
    if (
      entry.name === "AGENTS.md" ||
      entry.name === "AGENTS.override.md" ||
      entry.name === "CLAUDE.md" ||
      entry.name === "CODEX.md" ||
      relativePath.startsWith(`.codex${process.platform === "win32" ? "\\" : "/"}`)
    ) {
      files.push(path);
    }
  }
  return files;
}

async function countSessionFiles(codexHome: string): Promise<number> {
  const sessionsRoot = join(codexHome, "sessions");
  if (!await pathExists(sessionsRoot)) {
    return 0;
  }
  let count = 0;
  const walk = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        await walk(join(directory, entry.name));
      } else {
        count += 1;
      }
    }
  };
  await walk(sessionsRoot);
  return count;
}

async function assertRealDirectory(path: string, label: string): Promise<void> {
  const stats = await lstat(path);
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error(`${label} must be a real directory: ${path}`);
  }
}

async function assertRegularFile(path: string, label: string): Promise<void> {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new Error(`${label} must be a regular non-symlink file: ${path}`);
  }
}

async function resolveExecutablePath(
  value: string,
  label: string,
): Promise<string> {
  const candidate = value.includes("/") || value.includes("\\")
    ? resolve(value)
    : Bun.which(value);
  if (candidate === null || candidate === undefined) {
    throw new Error(`${label} is not available on PATH: ${value}`);
  }
  const path = await realpath(candidate);
  await assertRegularFile(path, label);
  return path;
}

async function readOptionalText(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) {
      return null;
    }
    throw error;
  }
}

async function sha256File(path: string): Promise<string> {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function pathCommitment(
  label: string,
  path: string,
): C3EvaluatorSecurityPathCommitment {
  const resolvedPath = resolve(path);
  return {
    label,
    path: resolvedPath,
    pathSha256: sha256(resolvedPath),
  };
}

function assertC3EvaluatorDeniedPathLabels(
  paths: readonly C3EvaluatorSecurityPathCommitment[],
): void {
  const labels = paths.map((path) => path.label);
  const expected = [...C3_EVALUATOR_DENIED_PATH_LABELS].sort();
  if (
    new Set(labels).size !== labels.length ||
    JSON.stringify(labels) !== JSON.stringify(expected)
  ) {
    throw new Error(
      "C3 evaluator denied path labels do not match the frozen protocol",
    );
  }
}

function parseExternalJson<T>(
  raw: string,
  schema: z.ZodType<T>,
  label: string,
): T {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`${label} failed schema validation`);
  }
  return parsed.data;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) {
      return false;
    }
    throw error;
  }
}

async function assertAbsentPath(path: string, label: string): Promise<void> {
  if (await pathExists(path)) {
    throw new Error(`${label} already exists: ${path}`);
  }
}

function hasErrorCode(error: unknown, code: string): boolean {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code;
}
