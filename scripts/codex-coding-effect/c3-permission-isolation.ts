import { createHash } from "node:crypto";
import {
  lstat,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import type {
  C3BoundaryRunner,
  C3InstalledArmRuntime,
  C3NoMemoryArmRuntime,
  C3BaselineArmRuntime,
} from "./c3-runtime";
import { withLoopbackNetworkProbe } from "./loopback-network-probe";
import { runBoundaryProcess } from "./process";
import type { BoundaryProcessResult } from "./process";

const C3_PERMISSION_PROFILE_NAME = "c3-task";

export const C3_BASE_DENIED_READ_LABELS = [
  "codex-auth-source",
  "controlled-evaluator-source",
  "current-runtime-auth",
  "current-runtime-config",
  "goodmemory-source-package",
  "other-arm-runtime-auth",
  "other-arm-runtime-config",
  "other-arm-workspace",
  "output-root",
  "package-tarball",
  "runner-source",
  "source-repository",
] as const;

export const C3_INSTALLED_DENIED_READ_LABELS = [
  ...C3_BASE_DENIED_READ_LABELS,
  "raw-prehistory",
  "sealed-prehistory",
] as const;

export type C3PermissionIsolationPhase =
  | "pre-launch"
  | "pre-seed"
  | "preflight";

export interface C3PermissionIsolationAudit {
  configSha256: string;
  deniedReads: Array<{
    denied: boolean;
    exitCode: number | null;
    label: string;
    path: string;
    pathSha256: string;
  }>;
  networkAccess: false;
  networkDenied: boolean;
  networkPositiveControl: boolean;
  passed: boolean;
  phase: C3PermissionIsolationPhase;
  profileName: "c3-task";
  reasons: string[];
  schemaVersion: 1;
  workspaceRead: boolean;
  workspaceWrite: boolean;
}

export interface C3PermissionIsolationEvidence {
  audit: C3PermissionIsolationAudit & {
    deniedReads: Array<C3PermissionIsolationAudit["deniedReads"][number] & {
      denied: true;
    }>;
    networkDenied: true;
    networkPositiveControl: true;
    passed: true;
    workspaceRead: true;
    workspaceWrite: true;
  };
  evidenceSha256: string;
}

export async function auditC3PermissionIsolation(input: {
  deniedReadPaths: ReadonlyArray<{ label: string; path: string }>;
  networkProbe?: (
    run: C3BoundaryRunner,
    runtime: C3InstalledArmRuntime | C3BaselineArmRuntime,
  ) => Promise<{
    networkDenied: boolean;
    networkPositiveControl: boolean;
  }>;
  phase: C3PermissionIsolationPhase;
  runProcess?: C3BoundaryRunner;
  runtime: C3InstalledArmRuntime | C3BaselineArmRuntime;
}): Promise<C3PermissionIsolationEvidence> {
  if (input.deniedReadPaths.length === 0) {
    throw new Error("C3 permission audit requires at least one denied read path");
  }
  const profile = input.runtime.permissionProfile;
  const configPath = join(input.runtime.plan.paths.codexHome, "config.toml");
  const initialConfigSha256 = await sha256File(configPath);
  const workspace = input.runtime.plan.paths.workspace;
  const readProbePath = join(workspace, ".c3-permission-read-probe");
  const writeProbePath = join(workspace, ".c3-permission-write-probe");
  await Promise.all([
    assertAbsentPath(readProbePath, "C3 permission read probe"),
    assertAbsentPath(writeProbePath, "C3 permission write probe"),
  ]);
  const readSentinel = "c3-workspace-read-allowed\n";
  await writeFile(readProbePath, readSentinel, { encoding: "utf8", flag: "wx" });
  const run = input.runProcess ?? runBoundaryProcess;
  let workspaceRead = false;
  let workspaceWrite = false;
  let networkDenied = false;
  let networkPositiveControl = false;
  const deniedReads: C3PermissionIsolationAudit["deniedReads"] = [];
  const reasons: string[] = [];
  try {
    const read = await runPermissionProbe(run, input.runtime, [
      "/bin/cat",
      readProbePath,
    ]);
    workspaceRead = probeSucceeded(read) && read.stdout === readSentinel;
    if (!workspaceRead) {
      reasons.push("permission profile did not allow the current workspace read");
    }

    const write = await runPermissionProbe(run, input.runtime, [
      "/usr/bin/touch",
      writeProbePath,
    ]);
    workspaceWrite = probeSucceeded(write) && await pathExists(writeProbePath);
    if (!workspaceWrite) {
      reasons.push("permission profile did not allow the current workspace write");
    }

    for (const deniedPath of [...input.deniedReadPaths].sort((first, second) =>
      first.label.localeCompare(second.label)
    )) {
      await assertRegularFile(deniedPath.path, `denied read probe ${deniedPath.label}`);
      const result = await runPermissionProbe(run, input.runtime, [
        "/bin/cat",
        resolve(deniedPath.path),
      ]);
      const denied = result.spawnError === undefined &&
        !result.timedOut &&
        result.exitCode !== null &&
        result.exitCode !== 0;
      deniedReads.push({
        denied,
        exitCode: result.exitCode,
        label: deniedPath.label,
        path: resolve(deniedPath.path),
        pathSha256: sha256(resolve(deniedPath.path)),
      });
      if (!denied) {
        reasons.push(`permission profile exposed denied path ${deniedPath.label}`);
      }
    }
    const network = await (input.networkProbe ?? probeNetworkIsolation)(
      run,
      input.runtime,
    );
    networkDenied = network.networkDenied;
    networkPositiveControl = network.networkPositiveControl;
    if (!networkPositiveControl) {
      reasons.push("permission profile network positive control failed");
    }
    if (!networkDenied) {
      reasons.push("permission profile allowed loopback network access");
    }
  } finally {
    await Promise.all([
      rm(readProbePath, { force: true }),
      rm(writeProbePath, { force: true }),
    ]);
  }
  const finalConfigSha256 = await sha256File(configPath);
  if (initialConfigSha256 !== profile.configSha256) {
    reasons.push("permission profile config changed after runtime preparation");
  }
  if (finalConfigSha256 !== initialConfigSha256) {
    reasons.push("permission profile config changed during isolation audit");
  }
  const audit: C3PermissionIsolationAudit = {
    configSha256: finalConfigSha256,
    deniedReads,
    networkAccess: false,
    networkDenied,
    networkPositiveControl,
    passed: reasons.length === 0,
    phase: input.phase,
    profileName: C3_PERMISSION_PROFILE_NAME,
    reasons,
    schemaVersion: 1,
    workspaceRead,
    workspaceWrite,
  };
  const bytes = `${JSON.stringify(audit, null, 2)}\n`;
  await writeFile(
    join(
      input.runtime.plan.paths.result,
      `permission-isolation-${input.phase}.json`,
    ),
    bytes,
    { encoding: "utf8", flag: "wx" },
  );
  if (!audit.passed) {
    throw new Error(`C3 permission isolation failed: ${reasons.join("; ")}`);
  }
  return {
    audit: requirePassedPermissionIsolationAudit(audit),
    evidenceSha256: sha256(bytes),
  };
}

function requirePassedPermissionIsolationAudit(
  audit: C3PermissionIsolationAudit,
): C3PermissionIsolationEvidence["audit"] {
  if (
    !audit.passed ||
    !audit.networkDenied ||
    !audit.networkPositiveControl ||
    !audit.workspaceRead ||
    !audit.workspaceWrite ||
    audit.deniedReads.some((probe) => !probe.denied)
  ) {
    throw new Error("C3 permission isolation evidence is not passing");
  }
  return {
    ...audit,
    deniedReads: audit.deniedReads.map((probe) => ({
      ...probe,
      denied: true,
    })),
    networkDenied: true,
    networkPositiveControl: true,
    passed: true,
    workspaceRead: true,
    workspaceWrite: true,
  };
}

async function runPermissionProbe(
  run: C3BoundaryRunner,
  runtime: C3InstalledArmRuntime | C3BaselineArmRuntime,
  command: readonly string[],
  options: {
    env?: Record<string, string>;
    timeoutMs?: number;
  } = {},
): Promise<BoundaryProcessResult> {
  return run({
    args: [
      "sandbox",
      "-P",
      runtime.permissionProfile.name,
      "-C",
      runtime.plan.paths.workspace,
      "--",
      ...command,
    ],
    cwd: runtime.plan.paths.workspace,
    env: options.env ?? runtime.env,
    executable: runtime.codex.executable,
    timeoutMs: options.timeoutMs ?? 30_000,
  });
}

async function probeNetworkIsolation(
  run: C3BoundaryRunner,
  runtime: C3InstalledArmRuntime | C3BaselineArmRuntime,
): Promise<{
  networkDenied: boolean;
  networkPositiveControl: boolean;
}> {
  const configuredBun = runtime.env.GOODMEMORY_BUN_BINARY;
  if (configuredBun === undefined) {
    throw new Error("C3 permission audit requires a configured Bun executable");
  }
  const bunExecutable = await realpath(configuredBun);
  await assertRegularFile(bunExecutable, "C3 permission audit Bun executable");
  const env = await buildNetworkProbeEnvironment(runtime, bunExecutable);
  return withLoopbackNetworkProbe(async (url) => {
    const source = [
      `const response = await fetch(${JSON.stringify(url)});`,
      "console.log(await response.text());",
    ].join("\n");
    const positive = await runBoundaryProcess({
      args: ["-e", source],
      cwd: runtime.plan.paths.workspace,
      env,
      executable: bunExecutable,
      timeoutMs: 10_000,
    });
    const networkPositiveControl = probeSucceeded(positive) &&
      positive.stdout.trim() === "reachable";
    const sandboxed = await runPermissionProbe(
      run,
      runtime,
      [bunExecutable, "-e", source],
      { env, timeoutMs: 10_000 },
    );
    return {
      networkDenied: probeDenied(sandboxed),
      networkPositiveControl,
    };
  });
}

async function buildNetworkProbeEnvironment(
  runtime: C3InstalledArmRuntime | C3BaselineArmRuntime,
  bunExecutable: string,
): Promise<Record<string, string>> {
  const nodeCandidate = Bun.which("node");
  const nodeDirectory = nodeCandidate === null
    ? undefined
    : dirname(await realpath(nodeCandidate));
  return {
    CI: "1",
    CODEX_HOME: runtime.plan.paths.codexHome,
    HOME: runtime.plan.paths.home,
    LANG: runtime.env.LANG ?? "en_US.UTF-8",
    NO_COLOR: "1",
    PATH: [...new Set([
      dirname(bunExecutable),
      ...(nodeDirectory === undefined ? [] : [nodeDirectory]),
      "/usr/bin",
      "/bin",
    ])].join(":"),
    TMPDIR: runtime.env.TMPDIR ?? runtime.plan.paths.temp,
  };
}

function probeSucceeded(result: BoundaryProcessResult): boolean {
  return result.spawnError === undefined &&
    !result.timedOut &&
    result.exitCode === 0;
}

function probeDenied(result: BoundaryProcessResult): boolean {
  return result.spawnError === undefined &&
    !result.timedOut &&
    result.exitCode !== null &&
    result.exitCode !== 0;
}

async function assertRegularFile(path: string, label: string): Promise<void> {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new Error(`${label} must be a regular file`);
  }
}

async function sha256File(path: string): Promise<string> {
  return sha256(await readFile(path));
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
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
