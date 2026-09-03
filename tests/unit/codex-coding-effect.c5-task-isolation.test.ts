import { describe, expect, it } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { C3NoMemoryArmRuntime } from "../../scripts/codex-coding-effect/c3-runtime";
import {
  auditC5TaskAliasIsolation,
  buildC5TaskDeniedPaths,
  persistC5SanitizedPermissionIsolation,
} from "../../scripts/codex-coding-effect/c5-task-isolation";
import type {
  BoundaryProcessRequest,
  BoundaryProcessResult,
} from "../../scripts/codex-coding-effect/process";

describe("Codex coding-effect C5 task isolation", () => {
  it("explicitly denies the current arm, Codex home, and installed prefix", () => {
    const current = armPlan("/runs/current", "goodmemory-installed");
    const other = armPlan("/runs/other", "no-memory");

    expect(buildC5TaskDeniedPaths({
      authFile: "/auth/source.json",
      datasetRoot: "/frozen/dataset",
      currentPlan: current,
      otherPlan: other,
      outputDirectory: "/evidence/raw",
      packageTarball: "/packages/goodmemory.tgz",
      repositoryRoot: "/frozen/source-repository",
      runnerSourceRoot: "/runner/source",
    })).toEqual(expect.arrayContaining([
      current.paths.armRoot,
      current.paths.codexHome,
      current.paths.packagePrefix,
      other.paths.armRoot,
      other.paths.workspace,
    ]));
  });

  it("orders denied paths by category so cluster digests cannot reorder them", () => {
    const current = armPlan("/runs/current", "goodmemory-installed");
    const build = (otherRoot: string) => buildC5TaskDeniedPaths({
      authFile: "/auth/source.json",
      datasetRoot: "/frozen/dataset",
      currentPlan: current,
      otherPlan: armPlan(otherRoot, "no-memory"),
      outputDirectory: "/evidence/raw",
      packageTarball: "/packages/goodmemory.tgz",
      repositoryRoot: "/frozen/source-repository",
      runnerSourceRoot: "/runner/source",
    });
    const early = build("/runs/aaaa");
    const late = build("/runs/zzzz");
    const position = (paths: string[], root: string) =>
      paths.findIndex((path) => path === armPlan(root, "no-memory").paths.armRoot);
    expect(position(early, "/runs/aaaa")).toBe(position(late, "/runs/zzzz"));
    expect(early.map((path) => path.replace("/runs/aaaa", "<other>")))
      .toEqual(late.map((path) => path.replace("/runs/zzzz", "<other>")));
  });

  it("proves protected files remain denied through writable-workspace symlinks", async () => {
    const root = await mkdtemp(join(tmpdir(), "goodmemory-c5-task-alias-"));
    try {
      const workspace = join(root, "workspace");
      const result = join(root, "result");
      const targetA = join(root, "auth.json");
      const targetB = join(root, "package.json");
      await Promise.all([
        mkdir(join(workspace, ".git"), { recursive: true }),
        mkdir(result, { recursive: true }),
        writeFile(targetA, "auth-sentinel\n", "utf8"),
        writeFile(targetB, "package-sentinel\n", "utf8"),
      ]);
      const probedAliases: string[] = [];
      const evidence = await auditC5TaskAliasIsolation({
        runProcess: async (request) => {
          const alias = commandPath(request);
          probedAliases.push(alias);
          expect(await readFile(alias, "utf8")).toMatch(/sentinel/u);
          return processResult({ exitCode: 77, stderr: "Operation not permitted" });
        },
        runtime: noMemoryRuntime({ result, root, workspace }),
        targets: [
          { label: "source-auth", path: targetA },
          { label: "installed-package", path: targetB },
        ],
      });

      expect(evidence.audit).toMatchObject({
        aliases: [
          { denied: true, label: "installed-package" },
          { denied: true, label: "source-auth" },
        ],
        passed: true,
        profileName: "c3-task",
        schemaVersion: 1,
      });
      expect(evidence.evidenceSha256).toMatch(/^[a-f0-9]{64}$/u);
      expect(probedAliases).toHaveLength(2);
      await expect(stat(join(workspace, ".git", "c5-task-alias-probes")))
        .rejects.toThrow();
      expect(JSON.parse(await readFile(
        join(result, "task-alias-isolation.json"),
        "utf8",
      )) as unknown).toEqual(evidence.audit);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("fails closed and removes aliases when one target is readable", async () => {
    const root = await mkdtemp(join(tmpdir(), "goodmemory-c5-task-alias-open-"));
    try {
      const workspace = join(root, "workspace");
      const result = join(root, "result");
      const target = join(root, "secret.txt");
      await Promise.all([
        mkdir(join(workspace, ".git"), { recursive: true }),
        mkdir(result, { recursive: true }),
        writeFile(target, "secret\n", "utf8"),
      ]);

      await expect(auditC5TaskAliasIsolation({
        runProcess: async () => processResult({ exitCode: 0, stdout: "secret\n" }),
        runtime: noMemoryRuntime({ result, root, workspace }),
        targets: [{ label: "secret", path: target }],
      })).rejects.toThrow("exposed protected path alias secret");
      await expect(stat(join(workspace, ".git", "c5-task-alias-probes")))
        .rejects.toThrow();
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("persists permission evidence without absolute protected paths", async () => {
    const root = await mkdtemp(join(tmpdir(), "goodmemory-c5-permission-sanitized-"));
    try {
      const protectedPath = join(root, "hidden", "gold.patch");
      const evidence = await persistC5SanitizedPermissionIsolation({
        directory: root,
        evidence: {
          audit: {
            configSha256: "a".repeat(64),
            deniedReads: [{
              denied: true,
              exitCode: 1,
              label: "gold-patch",
              path: protectedPath,
              pathSha256: "b".repeat(64),
            }],
            networkAccess: false,
            networkDenied: true,
            networkPositiveControl: true,
            passed: true,
            phase: "preflight",
            profileName: "c3-task",
            reasons: [],
            schemaVersion: 1,
            workspaceRead: true,
            workspaceWrite: true,
          },
          evidenceSha256: "c".repeat(64),
        },
      });

      const bytes = await readFile(
        join(root, "permission-isolation-preflight.sanitized.json"),
        "utf8",
      );
      expect(bytes).not.toContain(root);
      expect(bytes).not.toContain(protectedPath);
      expect(JSON.parse(bytes) as unknown).toEqual(evidence.audit);
      expect(evidence.evidenceSha256).toMatch(/^[a-f0-9]{64}$/u);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});

function armPlan<const Arm extends "goodmemory-installed" | "no-memory">(
  root: string,
  arm: Arm,
) {
  return {
    arm,
    paths: {
      armRoot: root,
      cache: join(root, "cache"),
      codexHome: join(root, "home", ".codex"),
      home: join(root, "home"),
      ...(arm === "goodmemory-installed"
        ? { packagePrefix: join(root, "prefix") }
        : {}),
      result: join(root, "result"),
      temp: join(root, "tmp"),
      workspace: join(root, "workspace"),
    },
    scopes: {
      sessionId: `${arm}-session`,
      userId: `${arm}-user`,
      workspaceId: `${arm}-workspace`,
    },
  } as const;
}

function noMemoryRuntime(input: {
  result: string;
  root: string;
  workspace: string;
}): C3NoMemoryArmRuntime {
  const plan = armPlan(input.root, "no-memory");
  return {
    codex: {
      executable: "/fake/codex",
      executableSha256: "a".repeat(64),
      version: "codex-cli test",
    },
    env: { HOME: join(input.root, "home") },
    instructionSha256: "b".repeat(64),
    isolation: {
      codexHomeEntryNames: ["auth.json", "config.toml"],
      goodMemoryFileCount: 0,
      hookConfigPresent: false,
      mcpConfigPresent: false,
      passed: true,
      preexistingSessionCount: 0,
      reasons: [],
    },
    permissionProfile: {
      configSha256: "c".repeat(64),
      filesystemDefault: "deny",
      minimalRead: true,
      name: "c3-task",
      networkAccess: false,
      workspaceWrite: true,
    },
    plan: {
      ...plan,
      paths: {
        ...plan.paths,
        result: input.result,
        workspace: input.workspace,
      },
    },
  };
}

function commandPath(request: BoundaryProcessRequest): string {
  const separator = request.args.indexOf("--");
  expect(request.args.slice(separator + 1, separator + 2)).toEqual(["/bin/cat"]);
  return request.args[separator + 2]!;
}

function processResult(
  overrides: Partial<BoundaryProcessResult> = {},
): BoundaryProcessResult {
  return {
    durationMs: 1,
    exitCode: 0,
    stderr: "",
    stdout: "",
    timedOut: false,
    ...overrides,
  };
}
