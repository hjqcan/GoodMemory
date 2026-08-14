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

describe("goodmemory cli help and routing", () => {
  it("returns package version for -V and --version", async () => {
    const packageJson = JSON.parse(
      await readFile(join(import.meta.dir, "../../package.json"), "utf8"),
    ) as { version: string };

    for (const args of [["-V"], ["--version"]]) {
      const result = await runCLI(args);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe(`goodmemory ${packageJson.version}\n`);
      expect(result.stderr).toBe("");
    }
  });

  it("returns version from the installed Node wrapper without requiring Bun", async () => {
    const packageJson = JSON.parse(
      await readFile(join(import.meta.dir, "../../package.json"), "utf8"),
    ) as { version: string };
    const result = Bun.spawnSync({
      cmd: ["node", join(import.meta.dir, "../../scripts/goodmemory-cli.js"), "-V"],
      env: {
        ...process.env,
        GOODMEMORY_BUN_BINARY: "missing-goodmemory-bun",
      },
      stderr: "pipe",
      stdout: "pipe",
    });

    expect(result.exitCode).toBe(0);
    expect(TEXT_DECODER.decode(result.stdout)).toBe(`goodmemory ${packageJson.version}\n`);
    expect(TEXT_DECODER.decode(result.stderr)).toBe("");
  });

  it("returns root help for no args and --help", async () => {
    const noArgs = await runCLI([]);
    const help = await runCLI(["--help"]);

    for (const result of [noArgs, help]) {
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("GoodMemory CLI");
      expect(result.stdout).toContain("remember        Write durable memory through the public API");
      expect(result.stdout).toContain("feedback        Write explicit feedback or correction through the public API");
      expect(result.stdout).toContain(
        "forget          Delete one durable memory record or clear a scoped target",
      );
      expect(result.stdout).toContain("inspect         Inspect scope-bounded memory");
      expect(result.stdout).toContain(
        "install         Install managed global GoodMemory host config for Codex or Claude Code",
      );
      expect(result.stdout).toContain(
        "enable          Enable repo-local GoodMemory host opt-in for Codex or Claude Code",
      );
      expect(result.stdout).toContain(
        "mcp             Run the installed GoodMemory MCP server",
      );
      expect(result.stdout).toContain(
        "inspector       Run the local GoodMemory Inspector admin surface",
      );
      expect(result.stdout).toContain(
        "storage         Run explicit storage maintenance commands",
      );
      expect(result.stdout).toContain("codex           Codex bootstrap and installed hook commands");
      expect(result.stdout).toContain("claude          Claude Code bootstrap and installed hook commands");
      expect(result.stdout).toContain("goodmemory eval --help");
      expect(result.stdout).toContain("goodmemory install --help");
      expect(result.stdout).toContain("goodmemory mcp --help");
      expect(result.stdout).toContain("goodmemory storage --help");
      expect(result.stdout).toContain("goodmemory inspector --help");
      expect(result.stderr).toBe("");
    }
  });

  it("returns storage migration help without validating connection flags", async () => {
    const bareStorage = await runCLI(["storage"]);
    const storageHelp = await runCLI(["storage", "--help"]);
    const migrationHelp = await runCLI(["storage", "migrate", "--help"]);

    for (const result of [bareStorage, storageHelp]) {
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("GoodMemory Storage CLI");
      expect(result.stdout).toContain("migrate");
      expect(result.stderr).toBe("");
    }
    expect(migrationHelp.exitCode).toBe(0);
    expect(migrationHelp.stdout).toContain(
      "GoodMemory Postgres Document Index Migration",
    );
    expect(migrationHelp.stdout).toContain("--storage-provider postgres");
    expect(migrationHelp.stdout).toContain("--storage-url <url>");
    expect(migrationHelp.stdout).toContain("--storage-schema <schema>");
    expect(migrationHelp.stderr).toBe("");
  });

  it("runs an explicit Postgres storage migration with secret-free text and JSON output", async () => {
    const storageUrl = "postgres://migration-user:migration-secret@db.example/goodmemory";
    const calls: Array<{ schema?: string; url: string }> = [];
    const dependencies = {
      async migratePostgresStorageBackend(config: { schema?: string; url: string }) {
        calls.push(config);
      },
    };

    const textResult = await runCLI([
      "storage",
      "migrate",
      "--storage-provider",
      "postgres",
      "--storage-url",
      storageUrl,
      "--storage-schema",
      "tenant_memory",
    ], dependencies);
    const jsonResult = await runCLI([
      "storage",
      "migrate",
      "--storage-provider",
      "postgres",
      "--storage-url",
      storageUrl,
      "--json",
    ], dependencies);

    expect(calls).toEqual([
      { schema: "tenant_memory", url: storageUrl },
      { url: storageUrl },
    ]);
    expect(textResult).toEqual({
      exitCode: 0,
      stderr: "",
      stdout: "Postgres document-index migration completed for schema tenant_memory.\n",
    });
    expect(JSON.parse(jsonResult.stdout)).toEqual({
      component: "document_indexes",
      provider: "postgres",
      schema: "public",
      status: "migrated",
    });
    for (const output of [
      textResult.stdout,
      textResult.stderr,
      jsonResult.stdout,
      jsonResult.stderr,
    ]) {
      expect(output).not.toContain(storageUrl);
      expect(output).not.toContain("migration-user");
      expect(output).not.toContain("migration-secret");
    }
  });

  it("requires explicit Postgres storage migration flags without invoking the backend", async () => {
    let calls = 0;
    const dependencies = {
      async migratePostgresStorageBackend() {
        calls += 1;
      },
    };

    const missingProvider = await runCLI([
      "storage",
      "migrate",
      "--storage-url",
      "postgres://localhost/goodmemory",
    ], dependencies);
    const missingUrl = await runCLI([
      "storage",
      "migrate",
      "--storage-provider",
      "postgres",
    ], dependencies);
    const sqlite = await runCLI([
      "storage",
      "migrate",
      "--storage-provider",
      "sqlite",
      "--storage-url",
      "/tmp/goodmemory.sqlite",
    ], dependencies);

    expect(missingProvider.exitCode).toBe(1);
    expect(missingProvider.stderr).toContain(
      "Storage migration requires explicit --storage-provider postgres.",
    );
    expect(missingUrl.exitCode).toBe(1);
    expect(missingUrl.stderr).toContain(
      "Postgres storage migration requires --storage-url <url>.",
    );
    expect(sqlite.exitCode).toBe(1);
    expect(sqlite.stderr).toContain(
      "Storage migration only supports --storage-provider postgres.",
    );
    expect(calls).toBe(0);
  });

  it("redacts every failing Postgres document-index migration input", async () => {
    const storageUrl = "postgres://migration-user:migration-secret@db.example/goodmemory";
    const dependency = {
      async migratePostgresStorageBackend() {
        throw new Error(`connection refused for ${storageUrl}`);
      },
    };
    const result = await runCLI([
      "storage",
      "migrate",
      "--storage-provider",
      "postgres",
      "--storage-url",
      storageUrl,
      "--storage-schema",
      "tenant_memory",
    ], dependency);
    const maliciousSchema = "postgres://schema-user:schema-secret@db.example/goodmemory";
    const maliciousResult = await runCLI([
      "storage",
      "migrate",
      "--storage-provider",
      "postgres",
      "--storage-url",
      storageUrl,
      "--storage-schema",
      maliciousSchema,
    ], dependency);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("Postgres document-index migration failed.");
    expect(maliciousResult.exitCode).toBe(1);
    expect(maliciousResult.stdout).toBe("");
    expect(maliciousResult.stderr).toBe(
      "Postgres document-index migration failed.",
    );
    for (const output of [result.stderr, maliciousResult.stderr]) {
      expect(output).not.toContain(storageUrl);
      expect(output).not.toContain("migration-user");
      expect(output).not.toContain("migration-secret");
      expect(output).not.toContain("schema-user");
      expect(output).not.toContain("schema-secret");
    }
  });

  it("returns eval namespace help for bare eval and eval --help", async () => {
    const bareEval = await runCLI(["eval"]);
    const evalHelp = await runCLI(["eval", "--help"]);

    for (const result of [bareEval, evalHelp]) {
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("GoodMemory Eval CLI");
      expect(result.stdout).toContain("inspect       Summarize one eval case");
      expect(result.stdout).toContain("export-case   Copy one eval case artifact");
      expect(result.stderr).toBe("");
    }
  });

  it("returns subcommand help before validating required flags", async () => {
    const inspect = await runCLI(["inspect", "--help"]);
    const remember = await runCLI(["remember", "--help"]);
    const feedback = await runCLI(["feedback", "--help"]);
    const forget = await runCLI(["forget", "--help"]);
    const trace = await runCLI(["trace", "--help"]);
    const stats = await runCLI(["stats", "--help"]);
    const exportMemory = await runCLI(["export-memory", "--help"]);
    const evalInspect = await runCLI(["eval", "inspect", "--help"]);
    const install = await runCLI(["install", "--help"]);
    const installCodex = await runCLI(["install", "codex", "--help"]);
    const setup = await runCLI(["setup", "--help"]);
    const doctor = await runCLI(["doctor", "--help"]);
    const uninstall = await runCLI(["uninstall", "--help"]);
    const repair = await runCLI(["repair", "--help"]);
    const enable = await runCLI(["enable", "--help"]);
    const disable = await runCLI(["disable", "--help"]);
    const status = await runCLI(["status", "--help"]);
    const mcp = await runCLI(["mcp", "--help"]);
    const mcpServe = await runCLI(["mcp", "serve", "--help"]);
    const codex = await runCLI(["codex", "--help"]);
    const codexAction = await runCLI(["codex", "action", "--help"]);
    const codexBootstrap = await runCLI(["codex", "bootstrap", "--help"]);
    const codexHook = await runCLI(["codex", "hook", "--help"]);
    const codexWriteback = await runCLI(["codex", "writeback", "--help"]);
    const claude = await runCLI(["claude", "--help"]);
    const claudeBootstrap = await runCLI(["claude", "bootstrap", "--help"]);
    const claudeHook = await runCLI(["claude", "hook", "--help"]);
    const claudeWriteback = await runCLI(["claude", "writeback", "--help"]);

    expect(remember.exitCode).toBe(0);
    expect(remember.stdout).toContain("GoodMemory Remember");
    expect(remember.stdout).toContain("--message <text>");
    expect(remember.stdout).toContain("--observed-at <rfc3339>");
    expect(remember.stdout).toContain("--timezone <iana-zone>");
    expect(remember.stdout).toContain("--host <codex|claude>");
    expect(feedback.exitCode).toBe(0);
    expect(feedback.stdout).toContain("GoodMemory Feedback");
    expect(feedback.stdout).toContain("--signal <text>");
    expect(forget.exitCode).toBe(0);
    expect(forget.stdout).toContain("GoodMemory Forget");
    expect(forget.stdout).toContain("--memory-id <id>");
    expect(forget.stdout).toContain("--all");
    expect(forget.stdout).toContain(
      "--memory-id <id>        Delete one durable memory record. Use either this or --all",
    );
    expect(forget.stdout).toContain(
      "--all                  Delete the full durable scope. Use either this or --memory-id",
    );
    expect(inspect.exitCode).toBe(0);
    expect(inspect.stdout).toContain("GoodMemory Inspect");
    expect(inspect.stdout).toContain("--user-id <id>");
    expect(trace.exitCode).toBe(0);
    expect(trace.stdout).toContain("GoodMemory Trace");
    expect(trace.stdout).toContain("--ignore-memory");
    expect(trace.stdout).toContain("--reference-time <rfc3339>");
    expect(trace.stdout).toContain("--timezone <iana-zone>");
    expect(trace.stdout).toContain("--strategy <auto|rules-only|hybrid|llm-assisted>");
    expect(stats.exitCode).toBe(0);
    expect(stats.stdout).toContain("GoodMemory Stats");
    expect(exportMemory.exitCode).toBe(0);
    expect(exportMemory.stdout).toContain("GoodMemory Export Memory");
    expect(exportMemory.stdout).toContain("--output <path>");
    expect(evalInspect.exitCode).toBe(0);
    expect(evalInspect.stdout).toContain("GoodMemory Eval Inspect");
    expect(evalInspect.stdout).toContain("--run-dir <path>");
    expect(install.exitCode).toBe(0);
    expect(install.stdout).toContain("GoodMemory Install CLI");
    expect(install.stdout).toContain("goodmemory install <codex|claude>");
    expect(setup.exitCode).toBe(0);
    expect(setup.stdout).toContain("GoodMemory Setup CLI");
    expect(setup.stdout).toContain("--host <codex|claude|both>");
    expect(setup.stdout).toContain("--dry-run");
    expect(doctor.exitCode).toBe(0);
    expect(doctor.stdout).toContain("GoodMemory Doctor CLI");
    expect(doctor.stdout).toContain("goodmemory doctor [codex|claude|both]");
    expect(installCodex.exitCode).toBe(0);
    expect(installCodex.stdout).toContain("--memory-path <path>");
    expect(installCodex.stdout).toContain("--storage-provider <sqlite|postgres>");
    expect(installCodex.stdout).toContain("--activation-mode <global|workspace_opt_in>");
    expect(installCodex.stdout).toContain("--writeback <off|observe|review|selective>");
    expect(installCodex.stdout).toContain("--dry-run");
    expect(installCodex.stdout).toContain("--embedding-provider <openai>");
    expect(installCodex.stdout).toContain("--llm-provider <openai|anthropic>");
    expect(installCodex.stdout).toContain("rules-only mode");
    expect(uninstall.exitCode).toBe(0);
    expect(uninstall.stdout).toContain("GoodMemory Uninstall CLI");
    expect(repair.exitCode).toBe(0);
    expect(repair.stdout).toContain("GoodMemory Repair CLI");
    expect(repair.stdout).toContain("goodmemory repair [codex|claude|both]");
    expect(repair.stdout).toContain("--dry-run");
    expect(enable.exitCode).toBe(0);
    expect(enable.stdout).toContain("GoodMemory Enable CLI");
    expect(enable.stdout).toContain("--workspace-root <path>");
    expect(enable.stdout).toContain("--dry-run");
    expect(disable.exitCode).toBe(0);
    expect(disable.stdout).toContain("GoodMemory Disable CLI");
    expect(status.exitCode).toBe(0);
    expect(status.stdout).toContain("GoodMemory Status CLI");
    expect(mcp.exitCode).toBe(0);
    expect(mcp.stdout).toContain("GoodMemory MCP CLI");
    expect(mcp.stdout).toContain("goodmemory mcp serve --help");
    expect(mcpServe.exitCode).toBe(0);
    expect(mcpServe.stdout).toContain("GoodMemory MCP Serve");
    expect(mcpServe.stdout).toContain("--host <codex|claude>");
    expect(codex.exitCode).toBe(0);
    expect(codex.stdout).toContain("GoodMemory Codex CLI");
    expect(codex.stdout).toContain("goodmemory codex action --help");
    expect(codex.stdout).toContain("goodmemory codex hook --help");
    expect(codexAction.exitCode).toBe(0);
    expect(codexAction.stdout).toContain("GoodMemory Codex Action");
    expect(codexAction.stdout).toContain("--session-id <id>");
    expect(codexAction.stdout).toContain("--command <command>");
    expect(codexBootstrap.exitCode).toBe(0);
    expect(codexBootstrap.stdout).toContain("GoodMemory Codex Bootstrap");
    expect(codexBootstrap.stdout).toContain("--workspace-root <path>");
    expect(codexHook.exitCode).toBe(0);
    expect(codexHook.stdout).toContain("GoodMemory Codex Hook");
    expect(codexHook.stdout).toContain("pre-tool-use");
    expect(codexHook.stdout).toContain("session-start");
    expect(codexHook.stdout).toContain("session-stop");
    expect(codexWriteback.exitCode).toBe(0);
    expect(codexWriteback.stdout).toContain("GoodMemory Codex Writeback");
    expect(codexWriteback.stdout).toContain("observe    stores local bounded/redacted candidate previews");
    expect(codexWriteback.stdout).toContain("dismisses observe-only events");
    expect(codexWriteback.stdout).toContain("--from-rollout");
    expect(codexWriteback.stdout).toContain("--rollout-path <path>");
    expect(codexWriteback.stdout).toContain("--sessions-root <path>");
    expect(codexWriteback.stdout).toContain("--workspace-root <path>");
    expect(codexWriteback.stdout).toContain("goodmemory codex writeback inspect");
    expect(codexWriteback.stdout).toContain("goodmemory codex writeback forget --event-id <id>");
    expect(claude.exitCode).toBe(0);
    expect(claude.stdout).toContain("GoodMemory Claude CLI");
    expect(claude.stdout).toContain("goodmemory claude hook --help");
    expect(claudeBootstrap.exitCode).toBe(0);
    expect(claudeBootstrap.stdout).toContain("GoodMemory Claude Bootstrap");
    expect(claudeBootstrap.stdout).toContain("--workspace-root <path>");
    expect(claudeHook.exitCode).toBe(0);
    expect(claudeHook.stdout).toContain("GoodMemory Claude Hook");
    expect(claudeHook.stdout).toContain("user-prompt-submit");
    expect(claudeHook.stdout).toContain("session-stop");
    expect(claudeWriteback.exitCode).toBe(0);
    expect(claudeWriteback.stdout).toContain("GoodMemory Claude Writeback");
    expect(claudeWriteback.stdout).toContain("observe    stores local bounded/redacted candidate previews");
    expect(claudeWriteback.stdout).toContain("dismisses observe-only events");
    expect(claudeWriteback.stdout).toContain("goodmemory claude writeback inspect");
    expect(claudeWriteback.stdout).toContain("goodmemory claude writeback forget --event-id <id>");
  });

  it("documents and validates mcp serve standalone mode", async () => {
    const help = await runCLI(["mcp", "serve", "--help"]);
    expect(help.exitCode).toBe(0);
    // Installed-mode pins stay intact alongside the standalone additions.
    expect(help.stdout).toContain("GoodMemory MCP Serve");
    expect(help.stdout).toContain("--host <codex|claude>");
    expect(help.stdout).toContain("--standalone");
    expect(help.stdout).toContain("--allow-write");
    expect(help.stdout).toContain("GOODMEMORY_USER_ID");
    expect(help.stdout).toContain("GOODMEMORY_MCP_ALLOW_WRITE");

    const missingUser = await runCLI(["mcp", "serve", "--standalone"]);
    expect(missingUser.exitCode).toBe(1);
    expect(missingUser.stderr).toContain("--user-id");
    expect(missingUser.stderr).toContain("GOODMEMORY_USER_ID");

    const conflictingModes = await runCLI([
      "mcp",
      "serve",
      "--host",
      "codex",
      "--standalone",
    ]);
    expect(conflictingModes.exitCode).toBe(1);
    expect(conflictingModes.stderr).toContain("mutually exclusive");
  });

  it("returns help hints for unknown root and eval commands", async () => {
    const unknownRoot = await runCLI(["unknown"]);
    const unknownEval = await runCLI(["eval", "unknown"]);
    const unknownInstall = await runCLI(["install", "unknown"]);
    const unknownMcp = await runCLI(["mcp", "unknown"]);
    const unknownCodex = await runCLI(["codex", "unknown"]);
    const unknownClaude = await runCLI(["claude", "unknown"]);

    expect(unknownRoot.exitCode).toBe(1);
    expect(unknownRoot.stderr).toContain("Unknown command: unknown.");
    expect(unknownRoot.stderr).toContain("goodmemory --help");
    expect(unknownEval.exitCode).toBe(1);
    expect(unknownEval.stderr).toContain("Unknown eval command: unknown.");
    expect(unknownEval.stderr).toContain("goodmemory eval --help");
    expect(unknownInstall.exitCode).toBe(1);
    expect(unknownInstall.stderr).toContain("Unknown host target: unknown.");
    expect(unknownMcp.exitCode).toBe(1);
    expect(unknownMcp.stderr).toContain("Unknown MCP command: unknown.");
    expect(unknownMcp.stderr).toContain("goodmemory mcp --help");
    expect(unknownCodex.exitCode).toBe(1);
    expect(unknownCodex.stderr).toContain("Unknown Codex command: unknown.");
    expect(unknownCodex.stderr).toContain("goodmemory codex --help");
    expect(unknownClaude.exitCode).toBe(1);
    expect(unknownClaude.stderr).toContain("Unknown Claude command: unknown.");
    expect(unknownClaude.stderr).toContain("goodmemory claude --help");
  });
});
