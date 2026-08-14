import {
  EVIDENCE_COLLECTION,
  HOST_BOOTSTRAP_SCRIPT_TEST_TIMEOUT_MS,
  TEXT_DECODER,
  access,
  aggregateJudgedCases,
  basename,
  buildCase,
  buildWritebackScopeDigest,
  chmod,
  createEvidenceRecord,
  createFactMemory,
  createGoodMemory,
  createMemoryRepositories,
  createMemorySource,
  createSQLiteDocumentStore,
  createSQLiteSessionStore,
  createTempWorkspace,
  describe,
  dirname,
  dropSQLiteTable,
  expect,
  hasSQLiteTable,
  it,
  join,
  mkdir,
  packCurrentPackage,
  persistEvalArtifacts,
  readFile,
  realpath,
  resolveStorageConfig,
  rm,
  runBunScript,
  runCLI,
  seedCodexActionPolicyMemory,
  seedSQLiteMemory,
  withCwd,
  withEnv,
  writeFile,
} from "./cli.test-support";
import type { JudgedEvalCase } from "./cli.test-support";

describe("goodmemory cli host bootstrap", () => {
  it("bootstraps Codex wiring idempotently without creating canonical memory state", async () => {
    const workspace = await createTempWorkspace("goodmemory-codex-bootstrap");

    try {
      await writeFile(join(workspace.root, "AGENTS.md"), "# Existing Workspace Notes\n", "utf8");

      const first = await withCwd(workspace.root, async () =>
        runCLI([
          "codex",
          "bootstrap",
          "--user-id",
          "codex-user",
          "--workspace-id",
          "codex-workspace",
          "--json",
        ]),
      );

      expect(first.exitCode).toBe(0);
      const payload = JSON.parse(first.stdout) as {
        changes: Array<{
          action: "created" | "unchanged" | "updated";
          relativePath: string;
        }>;
        host: string;
        workspaceId: string;
      };
      expect(payload.host).toBe("codex");
      expect(payload.workspaceId).toBe("codex-workspace");
      expect(
        payload.changes.map(({ action, relativePath }) => ({
          action,
          relativePath,
        })),
      ).toEqual([
        { action: "updated", relativePath: "AGENTS.md" },
        {
          action: "created",
          relativePath: ".goodmemory/bootstrap/codex-export.mjs",
        },
        {
          action: "created",
          relativePath: ".goodmemory/bootstrap/codex-action.mjs",
        },
        {
          action: "created",
          relativePath: ".codex/hooks.json",
        },
        {
          action: "created",
          relativePath: ".codex/config.toml",
        },
        {
          action: "created",
          relativePath: "codex/rules/goodmemory.rules",
        },
      ]);

      const agents = await readFile(join(workspace.root, "AGENTS.md"), "utf8");
      expect(agents).toContain("# Existing Workspace Notes");
      expect(agents).toContain("## GoodMemory Codex Bootstrap");
      expect(agents).toContain(
        "bun ./.goodmemory/bootstrap/codex-export.mjs --session-id <session-id>",
      );
      expect(agents).toContain(
        'bun ./.goodmemory/bootstrap/codex-action.mjs --session-id <session-id> --command "<command>"',
      );
      expect(agents).toContain(".goodmemory/hosts/codex/session-memory/current.md");
      expect(agents).toContain(".codex/hooks.json");
      expect(agents).toContain("./codex/rules/goodmemory.rules");
      expect(agents).toContain("canonical enforced path");
      expect(agents).toContain("parity scaffolds");
      expect(
        agents.match(/GOODMEMORY-BOOTSTRAP:CODEX START/g)?.length ?? 0,
      ).toBe(1);

      const script = await readFile(
        join(workspace.root, ".goodmemory/bootstrap/codex-export.mjs"),
        "utf8",
      );
      expect(script).toContain('import("goodmemory")');
      expect(script).toContain('import("goodmemory/host")');
      expect(script).toContain("session-memory/current.md");
      expect(script).not.toContain('"codex-active"');
      expect(script).not.toContain("../src");
      expect(script).not.toContain("../../src");
      const actionScript = await readFile(
        join(workspace.root, ".goodmemory/bootstrap/codex-action.mjs"),
        "utf8",
      );
      expect(actionScript).toContain('from "goodmemory"');
      expect(actionScript).toContain('from "goodmemory/host"');
      expect(actionScript).toContain("resolveHostActionExecutionPlan");
      expect(actionScript).not.toContain("../src");
      expect(actionScript).not.toContain("../../src");
      const hooksConfig = await readFile(join(workspace.root, ".codex/hooks.json"), "utf8");
      expect(hooksConfig).toContain("PreToolUse");
      expect(hooksConfig).toContain("codex-action.mjs");
      const hooksToml = await readFile(join(workspace.root, ".codex/config.toml"), "utf8");
      expect(hooksToml).toContain("[features]");
      expect(hooksToml).toContain("hooks = true");
      const rulesFile = await readFile(
        join(workspace.root, "codex/rules/goodmemory.rules"),
        "utf8",
      );
      expect(rulesFile).toContain('pattern = ["deploy"]');
      expect(rulesFile).toContain('pattern = ["DeepAnalyzer"]');
      expect(rulesFile).toContain('pattern = ["rm", "-rf"]');

      let storageExists = true;
      try {
        await access(join(workspace.root, ".goodmemory", "memory.sqlite"));
      } catch {
        storageExists = false;
      }
      expect(storageExists).toBe(false);

      const second = await withCwd(workspace.root, async () =>
        runCLI([
          "codex",
          "bootstrap",
          "--user-id",
          "codex-user",
          "--workspace-id",
          "codex-workspace",
          "--json",
        ]),
      );
      const secondPayload = JSON.parse(second.stdout) as typeof payload;
      expect(
        secondPayload.changes.map(({ action, relativePath }) => ({
          action,
          relativePath,
        })),
      ).toEqual([
        { action: "unchanged", relativePath: "AGENTS.md" },
        {
          action: "unchanged",
          relativePath: ".goodmemory/bootstrap/codex-export.mjs",
        },
        {
          action: "unchanged",
          relativePath: ".goodmemory/bootstrap/codex-action.mjs",
        },
        {
          action: "unchanged",
          relativePath: ".codex/hooks.json",
        },
        {
          action: "unchanged",
          relativePath: ".codex/config.toml",
        },
        {
          action: "unchanged",
          relativePath: "codex/rules/goodmemory.rules",
        },
      ]);

      const updatedAgents = await readFile(join(workspace.root, "AGENTS.md"), "utf8");
      expect(
        updatedAgents.match(/GOODMEMORY-BOOTSTRAP:CODEX START/g)?.length ?? 0,
      ).toBe(1);
    } finally {
      await workspace.cleanup();
    }
  });

  it("merges existing repo-local Codex hook and feature config instead of replacing them", async () => {
    const workspace = await createTempWorkspace("goodmemory-codex-bootstrap-merge");

    try {
      await writeFile(
        join(workspace.root, "AGENTS.md"),
        "# Existing Workspace Notes\n",
        "utf8",
      );
      await mkdir(join(workspace.root, ".codex"), { recursive: true });
      await writeFile(
        join(workspace.root, ".codex/hooks.json"),
        JSON.stringify(
          {
            hooks: {
              PostToolUse: [
                {
                  matcher: "Write",
                  hooks: [
                    {
                      type: "command",
                      command: "echo after-write",
                      statusMessage: "after write",
                    },
                  ],
                },
              ],
              PreToolUse: [
                {
                  matcher: "Bash",
                  hooks: [
                    {
                      type: "command",
                      command: "echo existing-bash-hook",
                      statusMessage: "keep existing bash hook",
                    },
                  ],
                },
              ],
            },
            repo: {
              preserve: true,
            },
          },
          null,
          2,
        ) + "\n",
        "utf8",
      );
      await writeFile(
        join(workspace.root, ".codex/config.toml"),
        [
          "[features]",
          "experimental_feature = true",
          "",
          "[profiles.default]",
          'sandbox = "workspace-write"',
          "",
        ].join("\n"),
        "utf8",
      );

      const first = await withCwd(workspace.root, async () =>
        runCLI([
          "codex",
          "bootstrap",
          "--user-id",
          "codex-user",
          "--workspace-id",
          "codex-workspace",
          "--json",
        ]),
      );
      expect(first.exitCode).toBe(0);

      const hooksConfig = JSON.parse(
        await readFile(join(workspace.root, ".codex/hooks.json"), "utf8"),
      ) as {
        hooks: Record<string, Array<{ hooks?: Array<{ command?: string }>; matcher?: string }>>;
        repo?: { preserve?: boolean };
      };
      expect(hooksConfig.repo?.preserve).toBe(true);
      expect(hooksConfig.hooks.PostToolUse).toHaveLength(1);
      const bashHooks = hooksConfig.hooks.PreToolUse.find(
        (entry) => entry.matcher === "Bash",
      )?.hooks;
      expect(bashHooks?.some((hook) => hook.command === "echo existing-bash-hook")).toBe(true);
      expect(
        bashHooks?.some((hook) => hook.command?.includes("codex-action.mjs")),
      ).toBe(true);

      const hooksToml = await readFile(join(workspace.root, ".codex/config.toml"), "utf8");
      expect(hooksToml).toContain("[features]");
      expect(hooksToml).toContain("experimental_feature = true");
      expect(hooksToml).toContain("hooks = true");
      expect(hooksToml).toContain("[profiles.default]");
      expect(hooksToml).toContain('sandbox = "workspace-write"');

      const second = await withCwd(workspace.root, async () =>
        runCLI([
          "codex",
          "bootstrap",
          "--user-id",
          "codex-user",
          "--workspace-id",
          "codex-workspace",
          "--json",
        ]),
      );
      expect(second.exitCode).toBe(0);
      const payload = JSON.parse(second.stdout) as {
        changes: Array<{
          action: "created" | "unchanged" | "updated";
          path: string;
          relativePath: string;
        }>;
      };
      expect(
        payload.changes.find((change) => change.relativePath === ".codex/hooks.json"),
      ).toMatchObject({
        action: "unchanged",
        relativePath: ".codex/hooks.json",
      });
      expect(
        payload.changes.find((change) => change.relativePath === ".codex/config.toml"),
      ).toMatchObject({
        action: "unchanged",
        relativePath: ".codex/config.toml",
      });
    } finally {
      await workspace.cleanup();
    }
  });

  it("requires an explicit session id for generated Codex exports", async () => {
    const workspace = await createTempWorkspace("goodmemory-codex-bootstrap-session-required");

    try {
      await withCwd(workspace.root, async () =>
        runCLI([
          "codex",
          "bootstrap",
          "--user-id",
          "codex-user",
          "--workspace-id",
          "codex-workspace",
          "--json",
        ]),
      );

      const result = await runBunScript({
        cwd: workspace.root,
        scriptPath: join(workspace.root, ".goodmemory/bootstrap/codex-export.mjs"),
      });

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain(
        "Codex export requires --session-id <session-id> to target a real session handoff.",
      );
      await expect(
        access(join(workspace.root, ".goodmemory/hosts/codex/export-manifest.json")),
      ).rejects.toThrow();
    } finally {
      await workspace.cleanup();
    }
  });

  it(
    "anchors generated Codex exports to the bootstrapped workspace root",
    async () => {
    const workspace = await createTempWorkspace("goodmemory-codex-bootstrap-anchor");
    const caller = await createTempWorkspace("goodmemory-codex-bootstrap-caller");

    try {
      await withCwd(workspace.root, async () =>
        runCLI([
          "codex",
          "bootstrap",
          "--user-id",
          "codex-user",
          "--workspace-id",
          "workspace-a",
          "--json",
        ]),
      );
      const { scope } = await seedSQLiteMemory(
        join(workspace.root, ".goodmemory", "memory.sqlite"),
      );

      const result = await runBunScript({
        args: ["--session-id", scope.sessionId],
        cwd: caller.root,
        scriptPath: join(workspace.root, ".goodmemory/bootstrap/codex-export.mjs"),
      });

      expect(result.exitCode).toBe(0);

      const manifest = JSON.parse(
        await readFile(
          join(workspace.root, ".goodmemory/hosts/codex/export-manifest.json"),
          "utf8",
        ),
      ) as {
        artifacts: Array<{
          relativePath?: string;
        }>;
        outputRoot: string;
        scope: {
          sessionId?: string;
          workspaceId?: string;
        };
      };
      expect(manifest.outputRoot).toEndWith("/.goodmemory/hosts/codex");
      expect(manifest.outputRoot).toContain(
        (workspace.root.split("/").at(-1) ?? "goodmemory-codex-bootstrap-anchor"),
      );
      expect(manifest.scope.workspaceId).toBe("workspace-a");
      expect(manifest.scope.sessionId).toBe(scope.sessionId);

      await expect(
        access(join(caller.root, ".goodmemory/hosts/codex/export-manifest.json")),
      ).rejects.toThrow();
    } finally {
      await caller.cleanup();
      await workspace.cleanup();
    }
    },
    HOST_BOOTSTRAP_SCRIPT_TEST_TIMEOUT_MS,
  );

  it(
    "generated Codex pre-tool-use hook blocks risky Bash commands and routes them to the action gate",
    async () => {
    const workspace = await createTempWorkspace("goodmemory-codex-hook-policy");
    const sessionId = "consumer-session";
    const packageRoot = join(import.meta.dir, "../..");
    const tarballPath = await packCurrentPackage({
      outputDir: join(workspace.root, ".pack"),
      packageRoot,
    });

    try {
      await withCwd(workspace.root, async () =>
        runCLI([
          "codex",
          "bootstrap",
          "--user-id",
          "codex-user",
          "--workspace-id",
          "codex-workspace",
          "--json",
        ]),
      );
      await writeFile(
        join(workspace.root, "package.json"),
        JSON.stringify(
          {
            name: "goodmemory-codex-hook-policy",
            private: true,
            dependencies: {
              goodmemory: `file:${tarballPath}`,
            },
          },
          null,
          2,
        ) + "\n",
        "utf8",
      );
      const install = Bun.spawnSync({
        cmd: ["bun", "install"],
        cwd: workspace.root,
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(install.exitCode).toBe(0);
      await seedCodexActionPolicyMemory({
        sqlitePath: join(workspace.root, ".goodmemory", "memory.sqlite"),
        sessionId,
        userId: "codex-user",
        workspaceId: "codex-workspace",
        rule: "Before deploy production, run QuickCheck first.",
        evidenceExcerpt:
          "Production deploy was blocked until QuickCheck ran first.",
      });

      const result = await runBunScript({
        args: ["--hook-pre-tool-use"],
        cwd: workspace.root,
        scriptPath: join(workspace.root, ".goodmemory/bootstrap/codex-action.mjs"),
        stdin: JSON.stringify({
          hook_event_name: "PreToolUse",
          session_id: sessionId,
          turn_id: "turn-hook-1",
          tool_name: "Bash",
          tool_input: {
            command: "deploy production",
          },
        }),
      });

      expect(result.exitCode).toBe(0);
      expect(result.stderr.trim()).toBe("");
      const payload = JSON.parse(result.stdout) as {
        hookSpecificOutput: {
          hookEventName: string;
          permissionDecision: string;
          permissionDecisionReason: string;
        };
      };
      expect(payload.hookSpecificOutput.hookEventName).toBe("PreToolUse");
      expect(payload.hookSpecificOutput.permissionDecision).toBe("deny");
      expect(payload.hookSpecificOutput.permissionDecisionReason).toContain(
        'bun ./.goodmemory/bootstrap/codex-action.mjs --session-id',
      );
      expect(payload.hookSpecificOutput.permissionDecisionReason).toContain(
        "--command 'deploy production'",
      );
    } finally {
      await workspace.cleanup();
    }
    },
    HOST_BOOTSTRAP_SCRIPT_TEST_TIMEOUT_MS,
  );

  it(
    "generated Codex action gate rewrites risky commands to the recommended first step and records lineage",
    async () => {
    const workspace = await createTempWorkspace("goodmemory-codex-action-gate");
    const sessionId = "consumer-session";
    const sqlitePath = join(workspace.root, ".goodmemory", "memory.sqlite");
    const toolsDir = join(workspace.root, "tools");
    const packageRoot = join(import.meta.dir, "../..");
    const tarballPath = await packCurrentPackage({
      outputDir: join(workspace.root, ".pack"),
      packageRoot,
    });

    try {
      await withCwd(workspace.root, async () =>
        runCLI([
          "codex",
          "bootstrap",
          "--user-id",
          "codex-user",
          "--workspace-id",
          "codex-workspace",
          "--json",
        ]),
      );
      await writeFile(
        join(workspace.root, "package.json"),
        JSON.stringify(
          {
            name: "goodmemory-codex-action-gate",
            private: true,
            dependencies: {
              goodmemory: `file:${tarballPath}`,
            },
          },
          null,
          2,
        ) + "\n",
        "utf8",
      );
      const install = Bun.spawnSync({
        cmd: ["bun", "install"],
        cwd: workspace.root,
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(install.exitCode).toBe(0);
      const { memory, scope } = await seedCodexActionPolicyMemory({
        sqlitePath,
        sessionId,
        userId: "codex-user",
        workspaceId: "codex-workspace",
        rule: "Before deploy production, run QuickCheck first.",
        evidenceExcerpt:
          "Production deploy was blocked until QuickCheck ran first.",
      });

      await mkdir(toolsDir, { recursive: true });
      await writeFile(
        join(toolsDir, "QuickCheck"),
        [
          "#!/usr/bin/env sh",
          `echo quickcheck >> ${JSON.stringify(join(workspace.root, "quickcheck.log"))}`,
        ].join("\n"),
        "utf8",
      );
      await chmod(join(toolsDir, "QuickCheck"), 0o755);
      await writeFile(
        join(toolsDir, "deploy"),
        [
          "#!/usr/bin/env sh",
          `echo deploy >> ${JSON.stringify(join(workspace.root, "deploy.log"))}`,
        ].join("\n"),
        "utf8",
      );
      await chmod(join(toolsDir, "deploy"), 0o755);

      const result = await runBunScript({
        args: [
          "--session-id",
          sessionId,
          "--turn-id",
          "turn-action-1",
          "--command",
          "./tools/deploy production",
          "--json",
        ],
        cwd: workspace.root,
        scriptPath: join(workspace.root, ".goodmemory/bootstrap/codex-action.mjs"),
      });

      expect(result.exitCode).toBe(0);
      const payload = JSON.parse(result.stdout) as {
        actionId: string;
        decision: string;
        executed: boolean;
        executedStep: string;
        originalActionDeferred: boolean;
        realizedEventParentId: string;
        rewritten: boolean;
      };
      expect(payload.decision).toBe("review_required");
      expect(payload.executed).toBe(true);
      expect(payload.executedStep).toBe("./tools/QuickCheck");
      expect(payload.rewritten).toBe(true);
      expect(payload.originalActionDeferred).toBe(true);
      expect(payload.realizedEventParentId).toBe(payload.actionId);
      const quickCheckExecuted = await access(join(workspace.root, "quickcheck.log"))
        .then(() => true)
        .catch(() => false);
      const deployExecuted = await access(join(workspace.root, "deploy.log"))
        .then(() => true)
        .catch(() => false);
      expect(quickCheckExecuted).toBe(true);
      expect(deployExecuted).toBe(false);

      const exported = await memory.exportMemory({
        scope,
        includeRuntime: true,
      });
      expect(
        exported.durable.experiences.some(
          (record) => record.traceId === payload.actionId,
        ),
      ).toBe(true);
      expect(
        exported.durable.experiences.some(
          (record) =>
            Array.isArray(record.sourceTraceIds) &&
            record.sourceTraceIds.includes(payload.actionId) &&
            record.traceId !== payload.actionId,
        ),
      ).toBe(true);
      expect(
        exported.durable.evidence.some(
          (record) => record.kind === "tool_result_excerpt",
        ),
      ).toBe(true);
    } finally {
      await workspace.cleanup();
    }
    },
    HOST_BOOTSTRAP_SCRIPT_TEST_TIMEOUT_MS,
  );

  it(
    "generated Codex action gate ignores arbitrary SHELL executables and still runs bridged commands on a supported shell",
    async () => {
    const workspace = await createTempWorkspace("goodmemory-codex-action-gate-shell");
    const packageRoot = join(import.meta.dir, "../..");
    const stubShellPath = join(workspace.root, "fake-shell");
    const tarballPath = await packCurrentPackage({
      outputDir: join(workspace.root, ".pack"),
      packageRoot,
    });

    try {
      await withCwd(workspace.root, async () =>
        runCLI([
          "codex",
          "bootstrap",
          "--user-id",
          "codex-user",
          "--workspace-id",
          "codex-workspace",
          "--json",
        ]),
      );
      await writeFile(
        join(workspace.root, "package.json"),
        JSON.stringify(
          {
            name: "goodmemory-codex-action-gate-shell",
            private: true,
            dependencies: {
              goodmemory: `file:${tarballPath}`,
            },
          },
          null,
          2,
        ) + "\n",
        "utf8",
      );
      const install = Bun.spawnSync({
        cmd: ["bun", "install"],
        cwd: workspace.root,
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(install.exitCode).toBe(0);

      await writeFile(
        stubShellPath,
        [
          "#!/usr/bin/env sh",
          "exit 0",
        ].join("\n"),
        "utf8",
      );
      await chmod(stubShellPath, 0o755);

      const result = await runBunScript({
        args: [
          "--session-id",
          "consumer-session",
          "--command",
          "echo hi > proof.txt",
          "--json",
        ],
        cwd: workspace.root,
        env: {
          SHELL: stubShellPath,
        },
        scriptPath: join(workspace.root, ".goodmemory/bootstrap/codex-action.mjs"),
      });

      expect(result.exitCode).toBe(0);
      const payload = JSON.parse(result.stdout) as {
        executed: boolean;
        exitCode: number;
        rewritten: boolean;
      };
      expect(payload.executed).toBe(true);
      expect(payload.exitCode).toBe(0);
      expect(payload.rewritten).toBe(false);
      expect(await readFile(join(workspace.root, "proof.txt"), "utf8")).toBe("hi\n");
    } finally {
      await workspace.cleanup();
    }
    },
    HOST_BOOTSTRAP_SCRIPT_TEST_TIMEOUT_MS,
  );

  it(
    "generated Codex action gate fails closed when the rewritten first step is not executable on the shell bridge",
    async () => {
    const workspace = await createTempWorkspace("goodmemory-codex-action-gate-fail-closed");
    const sessionId = "consumer-session";
    const sqlitePath = join(workspace.root, ".goodmemory", "memory.sqlite");
    const packageRoot = join(import.meta.dir, "../..");
    const tarballPath = await packCurrentPackage({
      outputDir: join(workspace.root, ".pack"),
      packageRoot,
    });

    try {
      await withCwd(workspace.root, async () =>
        runCLI([
          "codex",
          "bootstrap",
          "--user-id",
          "codex-user",
          "--workspace-id",
          "codex-workspace",
          "--json",
        ]),
      );
      await writeFile(
        join(workspace.root, "package.json"),
        JSON.stringify(
          {
            name: "goodmemory-codex-action-gate-fail-closed",
            private: true,
            dependencies: {
              goodmemory: `file:${tarballPath}`,
            },
          },
          null,
          2,
        ) + "\n",
        "utf8",
      );
      const install = Bun.spawnSync({
        cmd: ["bun", "install"],
        cwd: workspace.root,
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(install.exitCode).toBe(0);
      await seedCodexActionPolicyMemory({
        sqlitePath,
        sessionId,
        userId: "codex-user",
        workspaceId: "codex-workspace",
        rule: "Rather than DeepAnalyzer, use QuickCheck first.",
        evidenceExcerpt:
          "DeepAnalyzer detailed scan failed because QuickCheck had not run first.",
      });

      const result = await runBunScript({
        args: [
          "--session-id",
          sessionId,
          "--turn-id",
          "turn-action-fail-closed",
          "--command",
          "DeepAnalyzer --detailed",
          "--json",
        ],
        cwd: workspace.root,
        scriptPath: join(workspace.root, ".goodmemory/bootstrap/codex-action.mjs"),
      });

      expect(result.exitCode).toBe(2);
      const payload = JSON.parse(result.stdout) as {
        decision: string;
        executed: boolean;
        recommendedFirstStep?: string;
        rewritten: boolean;
      };
      expect(payload.decision).toBe("review_required");
      expect(payload.executed).toBe(false);
      expect(payload.recommendedFirstStep).toBe(
        "Rather than DeepAnalyzer, use QuickCheck first.",
      );
      expect(payload.rewritten).toBe(true);
      const quickCheckExecuted = await access(join(workspace.root, "quickcheck.log"))
        .then(() => true)
        .catch(() => false);
      expect(quickCheckExecuted).toBe(false);
    } finally {
      await workspace.cleanup();
    }
    },
    HOST_BOOTSTRAP_SCRIPT_TEST_TIMEOUT_MS,
  );

  it("bootstraps Claude wiring with a derived workspace id", async () => {
    const workspace = await createTempWorkspace("goodmemory-claude-bootstrap");

    try {
      const result = await withCwd(workspace.root, async () =>
        runCLI(["claude", "bootstrap", "--user-id", "claude-user", "--json"]),
      );

      expect(result.exitCode).toBe(0);
      const payload = JSON.parse(result.stdout) as {
        changes: Array<{
          action: "created" | "unchanged" | "updated";
          relativePath: string;
        }>;
        host: string;
        workspaceId: string;
      };
      const expectedWorkspaceId =
        workspace.root.split("/").at(-1) ?? "goodmemory-claude-bootstrap";
      expect(payload.host).toBe("claude");
      expect(payload.workspaceId).toBe(expectedWorkspaceId);
      expect(
        payload.changes.map(({ action, relativePath }) => ({
          action,
          relativePath,
        })),
      ).toEqual([
        { action: "created", relativePath: "CLAUDE.md" },
        {
          action: "created",
          relativePath: ".goodmemory/bootstrap/claude-export.mjs",
        },
      ]);

      const instructions = await readFile(join(workspace.root, "CLAUDE.md"), "utf8");
      expect(instructions).toContain("## GoodMemory Claude Code Bootstrap");
      expect(instructions).toContain("bun ./.goodmemory/bootstrap/claude-export.mjs");
      expect(instructions).toContain(".goodmemory/hosts/claude/user.md");
      expect(
        instructions.match(/GOODMEMORY-BOOTSTRAP:CLAUDE START/g)?.length ?? 0,
      ).toBe(1);

      const script = await readFile(
        join(workspace.root, ".goodmemory/bootstrap/claude-export.mjs"),
        "utf8",
      );
      expect(script).toContain('import("goodmemory")');
      expect(script).toContain('import("goodmemory/host")');
      expect(script).not.toContain('"claude-active"');
      expect(script).toContain('readTextFlag(flags, "session-id")');
      expect(script).not.toContain("../src");
    } finally {
      await workspace.cleanup();
    }
  });
});
