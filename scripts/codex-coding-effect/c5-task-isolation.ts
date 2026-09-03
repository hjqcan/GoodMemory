import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";

import type { C3ArmPlan } from "./c3-arms";
import type {
  C3BoundaryRunner,
  C3InstalledArmRuntime,
  C3NoMemoryArmRuntime,
  C3BaselineArmRuntime,
} from "./c3-runtime";
import type { C3PermissionIsolationEvidence } from "./c3-runtime";
import { runBoundaryProcess } from "./process";

export interface C5TaskAliasIsolationAudit {
  aliases: Array<{
    denied: boolean;
    exitCode: number | null;
    label: string;
    targetPathSha256: string;
  }>;
  passed: boolean;
  profileName: "c3-task";
  schemaVersion: 1;
}

export interface C5TaskAliasIsolationEvidence {
  audit: C5TaskAliasIsolationAudit & {
    aliases: Array<C5TaskAliasIsolationAudit["aliases"][number] & {
      denied: true;
    }>;
    passed: true;
  };
  evidenceSha256: string;
}

export interface C5SanitizedPermissionIsolationEvidence {
  audit: Omit<C3PermissionIsolationEvidence["audit"], "deniedReads"> & {
    deniedReads: Array<Omit<
      C3PermissionIsolationEvidence["audit"]["deniedReads"][number],
      "path"
    >>;
  };
  evidenceSha256: string;
}

export function buildC5TaskDeniedPaths(input: {
  authFile: string;
  currentPlan: C3ArmPlan;
  datasetRoot: string;
  npmCacheSeed?: string;
  otherPlan: C3ArmPlan;
  outputDirectory: string;
  packageTarball: string;
  repositoryRoot: string;
  runnerSourceRoot: string;
}): string[] {
  return [...new Set([
    input.authFile,
    input.currentPlan.paths.armRoot,
    input.currentPlan.paths.codexHome,
    join(input.currentPlan.paths.codexHome, "auth.json"),
    join(input.currentPlan.paths.codexHome, "config.toml"),
    input.datasetRoot,
    ...(input.npmCacheSeed === undefined ? [] : [input.npmCacheSeed]),
    input.otherPlan.paths.armRoot,
    input.otherPlan.paths.workspace,
    input.outputDirectory,
    input.packageTarball,
    input.repositoryRoot,
    input.runnerSourceRoot,
    ...(input.currentPlan.paths.packagePrefix === undefined
      ? []
      : [input.currentPlan.paths.packagePrefix]),
  ].map((path) => resolve(path)))];
  // Category order, not lexicographic order: the raw paths carry per-cluster
  // digests, so a lexicographic sort would reorder the normalized permission
  // lines from cluster to cluster and drift the comparable host identity.
}

export async function auditC5TaskAliasIsolation(input: {
  runProcess?: C3BoundaryRunner;
  runtime: C3InstalledArmRuntime | C3BaselineArmRuntime;
  targets: ReadonlyArray<{ label: string; path: string }>;
}): Promise<C5TaskAliasIsolationEvidence> {
  if (
    input.targets.length === 0 ||
    new Set(input.targets.map((target) => target.label)).size !==
      input.targets.length
  ) {
    throw new Error("C5 task alias isolation requires unique protected targets");
  }
  const targets = [...input.targets].sort((first, second) =>
    first.label.localeCompare(second.label)
  );
  for (const target of targets) {
    const info = await lstat(target.path);
    if (!info.isFile() || info.isSymbolicLink()) {
      throw new Error(`C5 alias target ${target.label} must be a regular file`);
    }
  }

  const aliasRoot = join(
    input.runtime.plan.paths.workspace,
    ".git",
    "c5-task-alias-probes",
  );
  await assertAbsent(aliasRoot);
  await mkdir(aliasRoot, { recursive: true });
  const run = input.runProcess ?? runBoundaryProcess;
  const aliases: C5TaskAliasIsolationAudit["aliases"] = [];
  try {
    for (const [index, target] of targets.entries()) {
      const alias = join(aliasRoot, `${String(index).padStart(2, "0")}.probe`);
      await symlink(resolve(target.path), alias);
      const result = await run({
        args: [
          "sandbox",
          "-P",
          input.runtime.permissionProfile.name,
          "-C",
          input.runtime.plan.paths.workspace,
          "--",
          "/bin/cat",
          alias,
        ],
        cwd: input.runtime.plan.paths.workspace,
        env: input.runtime.env,
        executable: input.runtime.codex.executable,
        timeoutMs: 30_000,
      });
      aliases.push({
        denied: result.spawnError === undefined &&
          !result.timedOut &&
          result.exitCode !== null &&
          result.exitCode !== 0,
        exitCode: result.exitCode,
        label: target.label,
        targetPathSha256: sha256(resolve(target.path)),
      });
    }
  } finally {
    await rm(aliasRoot, { force: true, recursive: true });
  }

  const audit: C5TaskAliasIsolationAudit = {
    aliases,
    passed: aliases.every((alias) => alias.denied),
    profileName: "c3-task",
    schemaVersion: 1,
  };
  const bytes = `${JSON.stringify(audit, null, 2)}\n`;
  await writeFile(
    join(input.runtime.plan.paths.result, "task-alias-isolation.json"),
    bytes,
    { encoding: "utf8", flag: "wx" },
  );
  const exposed = aliases.find((alias) => !alias.denied);
  if (exposed !== undefined) {
    throw new Error(`C5 task sandbox exposed protected path alias ${exposed.label}`);
  }
  return {
    audit: {
      ...audit,
      aliases: aliases.map((alias) => ({ ...alias, denied: true })),
      passed: true,
    },
    evidenceSha256: sha256(bytes),
  };
}

export async function persistC5SanitizedPermissionIsolation(input: {
  directory: string;
  evidence: C3PermissionIsolationEvidence;
}): Promise<C5SanitizedPermissionIsolationEvidence> {
  const audit: C5SanitizedPermissionIsolationEvidence["audit"] = {
    ...input.evidence.audit,
    deniedReads: input.evidence.audit.deniedReads.map(({
      path: _path,
      ...probe
    }) => ({ ...probe, denied: true })),
  };
  const bytes = `${JSON.stringify(audit, null, 2)}\n`;
  await writeFile(
    join(input.directory, "permission-isolation-preflight.sanitized.json"),
    bytes,
    { encoding: "utf8", flag: "wx" },
  );
  return { audit, evidenceSha256: sha256(bytes) };
}

async function assertAbsent(path: string): Promise<void> {
  try {
    await lstat(path);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return;
    }
    throw error;
  }
  throw new Error(`C5 task alias probe root already exists: ${path}`);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
