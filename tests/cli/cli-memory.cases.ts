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
import { readdir } from "node:fs/promises";

describe("goodmemory cli root commands", () => {
  it("uses a non-mutating postgres probe for read-only auto storage", async () => {
    const calls: string[] = [];

    const storage = await resolveStorageConfig(
      {
        "storage-url": "postgres://localhost:5432/goodmemory",
      },
      {
        readOnlyStorage: true,
      },
      {
        canBootstrapPostgresStorageBackend: async () => {
          calls.push("bootstrap");
          return true;
        },
        probeReadOnlyPostgresStorageBackend: async () => {
          calls.push("read");
          return "readable";
        },
        pathExists: async () => false,
      },
    );

    expect(storage).toEqual({
      provider: "postgres",
      url: "postgres://localhost:5432/goodmemory",
      displayValue: "configured",
    });
    expect(calls).toEqual(["read"]);
  });

  it("uses the bootstrap probe for writable auto postgres resolution", async () => {
    const calls: string[] = [];

    const storage = await resolveStorageConfig(
      {
        "storage-url": "postgres://localhost:5432/goodmemory",
      },
      undefined,
      {
        canBootstrapPostgresStorageBackend: async () => {
          calls.push("bootstrap");
          return true;
        },
        probeReadOnlyPostgresStorageBackend: async () => {
          calls.push("read");
          return "readable";
        },
        mkdir: async () => undefined,
        pathExists: async () => false,
      },
    );

    expect(storage).toEqual({
      provider: "postgres",
      url: "postgres://localhost:5432/goodmemory",
      displayValue: "configured",
    });
    expect(calls).toEqual(["bootstrap"]);
  });

  it("reports read-only postgres probe failures without bootstrapping durable state", async () => {
    await expect(
      resolveStorageConfig(
        {
          "storage-url": "postgres://localhost:5432/goodmemory",
        },
        {
          readOnlyStorage: true,
        },
        {
          canBootstrapPostgresStorageBackend: async () => true,
          probeReadOnlyPostgresStorageBackend: async () => {
            throw new Error("permission denied");
          },
          pathExists: async () => false,
        },
      ),
    ).rejects.toThrow("without mutating durable authority");
  });

  it("fails closed when the read-only postgres probe is inconclusive", async () => {
    const calls: string[] = [];

    await expect(
      resolveStorageConfig(
        {
          "storage-url": "postgres://localhost:5432/goodmemory",
        },
        {
          readOnlyStorage: true,
        },
        {
          canBootstrapPostgresStorageBackend: async () => {
            calls.push("bootstrap");
            return true;
          },
          probeReadOnlyPostgresStorageBackend: async () => {
            calls.push("read");
            return "inconclusive";
          },
          pathExists: async () => {
            calls.push("sqlite");
            return true;
          },
        },
      ),
    ).rejects.toThrow("without mutating durable authority");

    expect(calls).toEqual(["read"]);
  });

  it("allows sqlite fallback when the read-only postgres probe proves postgres is unusable", async () => {
    const calls: string[] = [];

    const storage = await resolveStorageConfig(
      {
        "storage-url": "postgres://localhost:5432/goodmemory",
      },
      {
        readOnlyStorage: true,
      },
      {
        canBootstrapPostgresStorageBackend: async () => {
          calls.push("bootstrap");
          return true;
        },
        probeReadOnlyPostgresStorageBackend: async () => {
          calls.push("read");
          return "unusable";
        },
        pathExists: async () => {
          calls.push("sqlite");
          return true;
        },
      },
    );

    expect(storage.provider).toBe("sqlite");
    expect(calls).toEqual(["read", "sqlite"]);
  });

  it("inspect summarizes scoped memory from sqlite storage", async () => {
    const workspace = await createTempWorkspace("goodmemory-cli-root-inspect");

    try {
      const sqlitePath = join(workspace.root, "memory.sqlite");
      await seedSQLiteMemory(sqlitePath);

      const result = await runCLI([
        "inspect",
        "--user-id",
        "cli-user",
        "--storage-provider",
        "sqlite",
        "--storage-url",
        sqlitePath,
      ]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Scope: user=cli-user");
      expect(result.stdout).toContain(`Storage: sqlite (${sqlitePath})`);
      expect(result.stdout).toContain("Profile: present");
      expect(result.stdout).toContain("Top Facts");
      expect(result.stdout).toContain("vendor approval for release quality program");
      expect(result.stdout).toContain("Top References");
      expect(result.stdout).toContain("docs/release-quality-runbook.md");
      expect(result.stdout).toContain("Top Feedback");
      expect(result.stdout).toContain("Use concise bullet points in summaries.");
    } finally {
      await workspace.cleanup();
    }
  });

  it("inspect preserves event occurrence in JSON and text output", async () => {
    const workspace = await createTempWorkspace("goodmemory-cli-root-inspect-occurrence");

    try {
      const sqlitePath = join(workspace.root, "memory.sqlite");
      const { scope } = await seedSQLiteMemory(sqlitePath);
      const documentStore = createSQLiteDocumentStore(sqlitePath);
      await documentStore.set(
        "facts",
        "fact-dated-lunch",
        createFactMemory({
          category: "event",
          content: "I ate tomato and eggs.",
          createdAt: "2026-08-12T02:00:00.000Z",
          id: "fact-dated-lunch",
          occurrence: {
            endExclusive: "2026-08-11T16:00:00.000Z",
            precision: "day",
            start: "2026-08-10T16:00:00.000Z",
            timezone: "Asia/Shanghai",
          },
          sessionId: scope.sessionId,
          source: createMemorySource({
            extractedAt: "2026-08-12T02:00:00.000Z",
            method: "explicit",
            sessionId: scope.sessionId,
          }),
          updatedAt: "2026-08-12T02:00:00.000Z",
          userId: scope.userId,
          workspaceId: scope.workspaceId,
        }),
      );

      const json = await runCLI([
        "inspect",
        "--user-id",
        scope.userId,
        "--workspace-id",
        scope.workspaceId!,
        "--storage-provider",
        "sqlite",
        "--storage-url",
        sqlitePath,
        "--json",
      ]);
      const payload = JSON.parse(json.stdout) as {
        topRecords: {
          facts: Array<{
            content: string;
            occurrence?: {
              endExclusive: string;
              precision: string;
              start: string;
              timezone: string;
            };
          }>;
        };
      };
      const event = payload.topRecords.facts.find(({ content }) =>
        content.includes("tomato and eggs")
      );

      expect(json.exitCode).toBe(0);
      expect(event?.occurrence).toEqual({
        endExclusive: "2026-08-11T16:00:00.000Z",
        precision: "day",
        start: "2026-08-10T16:00:00.000Z",
        timezone: "Asia/Shanghai",
      });

      const text = await runCLI([
        "inspect",
        "--user-id",
        scope.userId,
        "--workspace-id",
        scope.workspaceId!,
        "--storage-provider",
        "sqlite",
        "--storage-url",
        sqlitePath,
      ]);
      expect(text.exitCode).toBe(0);
      expect(text.stdout).toContain(
        "occurrence=2026-08-10T16:00:00.000Z..2026-08-11T16:00:00.000Z, Asia/Shanghai",
      );
    } finally {
      await workspace.cleanup();
    }
  });

  it("inspect does not create a vectors table in read-only sqlite mode", async () => {
    const workspace = await createTempWorkspace("goodmemory-cli-root-inspect-read-only");

    try {
      const sqlitePath = join(workspace.root, "memory.sqlite");
      await seedSQLiteMemory(sqlitePath);
      dropSQLiteTable(sqlitePath, "vectors");

      expect(hasSQLiteTable(sqlitePath, "vectors")).toBe(false);

      const result = await runCLI([
        "inspect",
        "--user-id",
        "cli-user",
        "--storage-provider",
        "sqlite",
        "--storage-url",
        sqlitePath,
      ]);

      expect(result.exitCode).toBe(0);
      expect(hasSQLiteTable(sqlitePath, "vectors")).toBe(false);
    } finally {
      await workspace.cleanup();
    }
  });

  it("inspect hides superseded references from the top summary", async () => {
    const workspace = await createTempWorkspace("goodmemory-cli-root-inspect-superseded");

    try {
      const sqlitePath = join(workspace.root, "memory.sqlite");
      const { memory, scope } = await seedSQLiteMemory(sqlitePath);

      await memory.remember({
        scope,
        messages: [
          {
            role: "user",
            content:
              "Correction: docs/release-quality-runbook-v2.md is now the source of truth, not docs/release-quality-runbook.md. Please update that.",
          },
        ],
      });

      const result = await runCLI([
        "inspect",
        "--user-id",
        scope.userId,
        "--workspace-id",
        scope.workspaceId!,
        "--session-id",
        scope.sessionId!,
        "--storage-provider",
        "sqlite",
        "--storage-url",
        sqlitePath,
      ]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Top References");
      expect(result.stdout).toContain("docs/release-quality-runbook-v2.md");
      expect(result.stdout).not.toContain(
        "- release-quality-runbook.md -> docs/release-quality-runbook.md",
      );
    } finally {
      await workspace.cleanup();
    }
  });

  it("trace uses a non-mutating recall diagnostic path", async () => {
    const workspace = await createTempWorkspace("goodmemory-cli-root-trace");

    try {
      const sqlitePath = join(workspace.root, "memory.sqlite");
      const { memory, scope } = await seedSQLiteMemory(sqlitePath);
      const before = await memory.exportMemory({
        scope,
      });
      const blockerFact = before.durable.facts.find((record) =>
        record.content.includes("vendor approval"),
      );
      const feedback = before.durable.feedback.find((record) =>
        record.rule.includes("concise bullet points"),
      );

      const result = await runCLI([
        "trace",
        "--user-id",
        scope.userId,
        "--workspace-id",
        scope.workspaceId!,
        "--session-id",
        scope.sessionId!,
        "--query",
        "Which runbook is the source of truth and what is the blocker?",
        "--reference-time",
        "2026-11-01T05:30:00.000Z",
        "--strategy",
        "rules-only",
        "--timezone",
        "America/New_York",
        "--storage-provider",
        "sqlite",
        "--storage-url",
        sqlitePath,
      ]);

      const after = await memory.exportMemory({
        scope,
      });
      const blockerFactAfter = after.durable.facts.find((record) =>
        record.content.includes("vendor approval"),
      );
      const feedbackAfter = after.durable.feedback.find((record) =>
        record.rule.includes("concise bullet points"),
      );

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Routing Decision");
      expect(result.stdout).toContain("requested strategy: rules-only");
      expect(result.stdout).toContain("resolved strategy: rules-only");
      expect(result.stdout).toContain("Hits");
      expect(result.stdout).toContain("Returned Candidate Traces");
      expect(result.stdout).toContain("Suppressed Candidate Traces");
      expect(blockerFactAfter).toEqual(blockerFact);
      expect(feedbackAfter).toEqual(feedback);
      expect(after.durable.experiences).toHaveLength(before.durable.experiences.length);
      expect(after.durable.proposals).toHaveLength(before.durable.proposals.length);
      expect(after.durable.promotions).toHaveLength(before.durable.promotions.length);
    } finally {
      await workspace.cleanup();
    }
  });

  it("trace supports ignore-memory for read-only policy diagnostics", async () => {
    const workspace = await createTempWorkspace("goodmemory-cli-root-trace-ignore-memory");

    try {
      const sqlitePath = join(workspace.root, "memory.sqlite");
      const { scope } = await seedSQLiteMemory(sqlitePath);

      const result = await runCLI([
        "trace",
        "--user-id",
        scope.userId,
        "--workspace-id",
        scope.workspaceId!,
        "--session-id",
        scope.sessionId!,
        "--query",
        "Which runbook is the source of truth and what is the blocker?",
        "--ignore-memory",
        "--storage-provider",
        "sqlite",
        "--storage-url",
        sqlitePath,
      ]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Storage: memory (ignored (--ignore-memory))");
      expect(result.stdout).toContain("Hits");
      expect(result.stdout).toContain("Returned Candidate Traces");
      expect(result.stdout).toContain("Suppressed Candidate Traces");
      expect(result.stdout).toContain("Policy Applied");
      expect(result.stdout).toContain("- ignore_memory");
      expect(result.stdout).toContain("- none");
    } finally {
      await workspace.cleanup();
    }
  });

  it("trace exposes structured diagnostics with --json", async () => {
    const workspace = await createTempWorkspace("goodmemory-cli-root-trace-json");

    try {
      const sqlitePath = join(workspace.root, "memory.sqlite");
      const { scope } = await seedSQLiteMemory(sqlitePath);

      const result = await runCLI([
        "trace",
        "--user-id",
        scope.userId,
        "--workspace-id",
        scope.workspaceId!,
        "--session-id",
        scope.sessionId!,
        "--query",
        "Which runbook is the source of truth and what is the blocker?",
        "--strategy",
        "rules-only",
        "--json",
        "--storage-provider",
        "sqlite",
        "--storage-url",
        sqlitePath,
      ]);

      const payload = JSON.parse(result.stdout) as {
        candidateTraceCount: number;
        candidateTraces: unknown[];
        hits: unknown[];
        policyApplied: string[];
        routingDecision: {
          strategy: string;
        };
        verificationHints: unknown[];
      };

      expect(result.exitCode).toBe(0);
      expect(payload.routingDecision.strategy).toBe("rules-only");
      expect(payload.hits.length).toBeGreaterThan(0);
      expect(payload.candidateTraces.length).toBeGreaterThan(0);
      expect(payload.candidateTraceCount).toBe(payload.candidateTraces.length);
      expect(payload.verificationHints.length).toBeGreaterThan(0);
      expect(Array.isArray(payload.policyApplied)).toBe(true);
    } finally {
      await workspace.cleanup();
    }
  });

  it("trace rejects invalid explicit temporal context", async () => {
    const fixtures = [
      ["--reference-time", "not-a-time", "Invalid referenceTime"],
      ["--timezone", "Mars/Olympus", "Invalid timezone"],
    ] as const;

    for (const [flag, value, message] of fixtures) {
      const result = await runCLI([
        "trace",
        "--user-id",
        "cli-invalid-temporal",
        "--query",
        "What happened yesterday?",
        flag,
        value,
        "--storage-provider",
        "memory",
        "--json",
      ]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain(message);
      expect(result.stdout).toBe("");
    }
  });

  it("trace uses the profile timezone and preserves the resolved during plan", async () => {
    const workspace = await createTempWorkspace("goodmemory-cli-root-trace-temporal");

    try {
      const sqlitePath = join(workspace.root, "memory.sqlite");
      const { scope } = await seedSQLiteMemory(sqlitePath);
      const documentStore = createSQLiteDocumentStore(sqlitePath);
      const profile = await documentStore.get<Record<string, unknown>>(
        "profiles",
        scope.userId,
      );
      expect(profile).not.toBeNull();
      await documentStore.set("profiles", scope.userId, {
        ...profile,
        identity: {
          ...(profile?.identity as Record<string, unknown>),
          timezone: "Asia/Shanghai",
        },
      });
      await documentStore.set(
        "facts",
        "fact-yesterday-lunch",
        createFactMemory({
          category: "event",
          content: "I ate tomato and eggs.",
          createdAt: "2026-08-12T02:00:00.000Z",
          id: "fact-yesterday-lunch",
          occurrence: {
            endExclusive: "2026-08-11T16:00:00.000Z",
            precision: "day",
            start: "2026-08-10T16:00:00.000Z",
            timezone: "Asia/Shanghai",
          },
          sessionId: scope.sessionId,
          source: createMemorySource({
            extractedAt: "2026-08-12T02:00:00.000Z",
            method: "explicit",
            sessionId: scope.sessionId,
          }),
          updatedAt: "2026-08-12T02:00:00.000Z",
          userId: scope.userId,
          workspaceId: scope.workspaceId,
        }),
      );

      const result = await runCLI([
        "trace",
        "--user-id",
        scope.userId,
        "--workspace-id",
        scope.workspaceId!,
        "--session-id",
        scope.sessionId!,
        "--query",
        "What did I eat yesterday?",
        "--reference-time",
        "2026-08-12T03:00:00.000Z",
        "--strategy",
        "rules-only",
        "--storage-provider",
        "sqlite",
        "--storage-url",
        sqlitePath,
        "--json",
      ]);
      const payload = JSON.parse(result.stdout) as {
        retrievalTrace?: {
          plan: {
            temporalConstraints: Array<{
              interval: {
                endExclusive: string;
                precision: string;
                start: string;
                timezone: string;
              };
              kind: string;
            }>;
          };
        };
      };

      expect(result.exitCode).toBe(0);
      expect(payload.retrievalTrace?.plan.temporalConstraints).toEqual([
        {
          interval: {
            endExclusive: "2026-08-11T16:00:00.000Z",
            precision: "day",
            start: "2026-08-10T16:00:00.000Z",
            timezone: "Asia/Shanghai",
          },
          kind: "during",
        },
      ]);
    } finally {
      await workspace.cleanup();
    }
  });

  it("stats reports scope-bounded counts and backend metadata", async () => {
    const workspace = await createTempWorkspace("goodmemory-cli-root-stats");

    try {
      const sqlitePath = join(workspace.root, "memory.sqlite");
      await seedSQLiteMemory(sqlitePath);

      const result = await runCLI([
        "stats",
        "--user-id",
        "cli-user",
        "--storage-provider",
        "sqlite",
        "--storage-url",
        sqlitePath,
      ]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Storage Provider: sqlite");
      expect(result.stdout).toContain(`Storage Location: ${sqlitePath}`);
      expect(result.stdout).toContain("Profile Records: 1");
      expect(result.stdout).toContain("References: 1");
      expect(result.stdout).toContain("Facts: 1");
      expect(result.stdout).toContain("Feedback: 1");
    } finally {
      await workspace.cleanup();
    }
  });

  it("export-memory writes json and markdown artifacts", async () => {
    const workspace = await createTempWorkspace("goodmemory-cli-root-export");

    try {
      const sqlitePath = join(workspace.root, "memory.sqlite");
      const { scope } = await seedSQLiteMemory(sqlitePath);
      const outputPath = join(workspace.root, "memory-export");

      const result = await runCLI([
        "export-memory",
        "--user-id",
        scope.userId,
        "--workspace-id",
        scope.workspaceId!,
        "--session-id",
        scope.sessionId!,
        "--storage-provider",
        "sqlite",
        "--storage-url",
        sqlitePath,
        "--output",
        outputPath,
      ]);

      const exported = JSON.parse(
        await readFile(join(outputPath, "memory-export.json"), "utf8"),
      ) as { scope: { userId: string } };
      const memoryArtifact = await readFile(
        join(
          outputPath,
          ".goodmemory",
          "users",
          scope.userId,
          "workspaces",
          scope.workspaceId!,
          "sessions",
          scope.sessionId!,
          "MEMORY.md",
        ),
        "utf8",
      );
      const userArtifact = await readFile(
        join(
          outputPath,
          ".goodmemory",
          "users",
          scope.userId,
          "workspaces",
          scope.workspaceId!,
          "sessions",
          scope.sessionId!,
          "user.md",
        ),
        "utf8",
      );

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Exported memory snapshot");
      expect(exported.scope.userId).toBe(scope.userId);
      expect(memoryArtifact).toContain("# MEMORY");
      expect(memoryArtifact).toContain("release quality program");
      expect(userArtifact).toContain("User Memory");
    } finally {
      await workspace.cleanup();
    }
  });

  it("defaults sqlite storage to the cwd .goodmemory path", async () => {
    const workspace = await createTempWorkspace("goodmemory-cli-default-sqlite");
    const previousCwd = process.cwd();

    try {
      process.chdir(workspace.root);
      await seedSQLiteMemory(join(workspace.root, ".goodmemory", "memory.sqlite"));

      const result = await runCLI([
        "stats",
        "--user-id",
        "cli-user",
        "--workspace-id",
        "workspace-a",
        "--session-id",
        "session-1",
      ]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Storage Location: ");
      expect(result.stdout).toContain(
        join(".goodmemory", "memory.sqlite"),
      );
    } finally {
      process.chdir(previousCwd);
      await workspace.cleanup();
    }
  });

  it("remember --kind note stores an authored page verbatim from the assistant role", async () => {
    const workspace = await createTempWorkspace("goodmemory-cli-remember-note");
    const previousCwd = process.cwd();

    try {
      process.chdir(workspace.root);

      const result = await runCLI([
        "remember",
        "--user-id",
        "note-user",
        "--kind",
        "note",
        "--title",
        "Reading MediaWiki sites as an agent",
        "--role",
        "assistant",
        "--message",
        "# Reading MediaWiki\n\nMost MediaWiki sites expose api.php.",
        "--json",
      ]);
      const payload = JSON.parse(result.stdout) as {
        accepted: number;
        events: Array<{ memoryType: string; outcome: string }>;
      };

      expect(result.exitCode).toBe(0);
      expect(payload.accepted).toBe(1);
      expect(payload.events[0]).toMatchObject({ memoryType: "note", outcome: "written" });
    } finally {
      process.chdir(previousCwd);
      await workspace.cleanup();
    }
  });

  it("remember writes durable memory through explicit scope flags and default sqlite storage", async () => {
    const workspace = await createTempWorkspace("goodmemory-cli-remember-default-sqlite");
    const previousCwd = process.cwd();

    try {
      process.chdir(workspace.root);

      const result = await runCLI([
        "remember",
        "--user-id",
        "write-user",
        "--workspace-id",
        "workspace-a",
        "--session-id",
        "write-session",
        "--message",
        "Remember that the deploy is blocked on smoke verification.",
        "--observed-at",
        "2026-11-01T05:29:00.000Z",
        "--timezone",
        "America/New_York",
        "--json",
      ]);
      const payload = JSON.parse(result.stdout) as {
        accepted: number;
        scope: {
          sessionId?: string;
          userId: string;
          workspaceId?: string;
        };
        storage: {
          provider: string;
        };
      };

      expect(result.exitCode).toBe(0);
      expect(payload.accepted).toBeGreaterThan(0);
      expect(payload.scope).toEqual({
        sessionId: "write-session",
        userId: "write-user",
        workspaceId: "workspace-a",
      });
      expect(payload.storage.provider).toBe("sqlite");

      const stored = createGoodMemory({
        storage: {
          provider: "sqlite",
          url: join(workspace.root, ".goodmemory", "memory.sqlite"),
        },
      });
      const exported = await stored.exportMemory({
        scope: {
          sessionId: "write-session",
          userId: "write-user",
          workspaceId: "workspace-a",
        },
      });
      expect(exported.durable.sourceMessages?.[0]).toMatchObject({
        observedAt: "2026-11-01T05:29:00.000Z",
        timezone: "America/New_York",
      });

      const stats = await runCLI([
        "stats",
        "--user-id",
        "write-user",
        "--workspace-id",
        "workspace-a",
        "--session-id",
        "write-session",
        "--json",
      ]);
      const statsPayload = JSON.parse(stats.stdout) as {
        counts: {
          facts: number;
        };
      };

      expect(stats.exitCode).toBe(0);
      expect(statsPayload.counts.facts).toBeGreaterThan(0);
    } finally {
      process.chdir(previousCwd);
      await workspace.cleanup();
    }
  });

  it("feedback derives installed-host defaults and is recalled through the host hook path", async () => {
    const home = await createTempWorkspace("goodmemory-feedback-host-home");
    const workspace = await createTempWorkspace("goodmemory-feedback-host-workspace");
    const cliScript = join(import.meta.dir, "../../scripts/goodmemory-cli.ts");

    try {
      await withEnv(
        {
          GOODMEMORY_HOME: home.root,
        },
        async () => {
          expect(
            (await runCLI([
              "install",
              "codex",
              "--user-id",
              "codex-user",
            ])).exitCode,
          ).toBe(0);
          expect(
            (await runCLI([
              "enable",
              "codex",
              "--workspace-id",
              "workspace-a",
              "--workspace-root",
              workspace.root,
            ])).exitCode,
          ).toBe(0);

          const feedback = await runCLI([
            "feedback",
            "--host",
            "codex",
            "--workspace-root",
            workspace.root,
            "--session-id",
            "write-session",
            "--signal",
            "Use short next-step bullets in coding summaries.",
            "--json",
          ]);
          const payload = JSON.parse(feedback.stdout) as {
            accepted: boolean;
            kind?: string;
            memoryId?: string;
            scope: {
              agentId?: string;
              sessionId?: string;
              userId: string;
              workspaceId?: string;
            };
            storage: {
              provider: string;
            };
          };

          expect(feedback.exitCode).toBe(0);
          expect(payload.accepted).toBe(true);
          expect(payload.kind).toBeDefined();
          expect(payload.memoryId).toBeDefined();
          expect(payload.scope).toEqual({
            agentId: "codex",
            sessionId: "write-session",
            userId: "codex-user",
            workspaceId: "workspace-a",
          });
          expect(payload.storage.provider).toBe("sqlite");

          const hook = await runBunScript({
            args: ["codex", "hook", "user-prompt-submit"],
            cwd: workspace.root,
            env: {
              GOODMEMORY_HOME: home.root,
            },
            scriptPath: cliScript,
            stdin: JSON.stringify({
              cwd: workspace.root,
              prompt: "Summarize what style I prefer before you answer.",
              session_id: "write-session",
            }),
          });

          expect(hook.exitCode).toBe(0);
          expect(hook.stderr.trim()).toBe("");
          expect(hook.stdout).toContain("Use short next-step bullets in coding summaries.");
        },
      );
    } finally {
      await workspace.cleanup();
      await home.cleanup();
    }
  });

  it("host-derived write commands require repo opt-in before using installed-host defaults", async () => {
    const home = await createTempWorkspace("goodmemory-write-host-missing-enable-home");
    const workspace = await createTempWorkspace("goodmemory-write-host-missing-enable-workspace");

    try {
      await withEnv(
        {
          GOODMEMORY_HOME: home.root,
        },
        async () => {
          expect(
            (await runCLI([
              "install",
              "codex",
              "--user-id",
              "codex-user",
            ])).exitCode,
          ).toBe(0);

          const result = await runCLI([
            "feedback",
            "--host",
            "codex",
            "--workspace-root",
            workspace.root,
            "--session-id",
            "write-session",
            "--signal",
            "Use short next-step bullets in coding summaries.",
          ]);

          expect(result.exitCode).toBe(1);
          expect(result.stderr).toContain("Run 'goodmemory enable codex --workspace-root");
        },
      );
    } finally {
      await workspace.cleanup();
      await home.cleanup();
    }
  });

  it("forget removes a host-derived memory id from the installed-host storage path", async () => {
    const home = await createTempWorkspace("goodmemory-forget-host-home");
    const workspace = await createTempWorkspace("goodmemory-forget-host-workspace");

    try {
      await withEnv(
        {
          GOODMEMORY_HOME: home.root,
        },
        async () => {
          expect(
            (await runCLI([
              "install",
              "codex",
              "--user-id",
              "codex-user",
            ])).exitCode,
          ).toBe(0);
          expect(
            (await runCLI([
              "enable",
              "codex",
              "--workspace-id",
              "workspace-a",
              "--workspace-root",
              workspace.root,
            ])).exitCode,
          ).toBe(0);

          const feedback = await runCLI([
            "feedback",
            "--host",
            "codex",
            "--workspace-root",
            workspace.root,
            "--workspace-id",
            "workspace-a",
            "--session-id",
            "write-session",
            "--signal",
            "Use numbered checklists for deploy updates.",
            "--json",
          ]);
          const feedbackPayload = JSON.parse(feedback.stdout) as {
            memoryId?: string;
          };

          expect(feedback.exitCode).toBe(0);
          expect(feedbackPayload.memoryId).toBeDefined();

          const forgotten = await runCLI([
            "forget",
            "--host",
            "codex",
            "--workspace-root",
            workspace.root,
            "--workspace-id",
            "workspace-a",
            "--session-id",
            "write-session",
            "--memory-id",
            String(feedbackPayload.memoryId),
            "--json",
          ]);
          const forgottenPayload = JSON.parse(forgotten.stdout) as {
            forgotten: boolean;
            scope: {
              agentId?: string;
              sessionId?: string;
              userId: string;
              workspaceId?: string;
            };
          };

          expect(forgotten.exitCode).toBe(0);
          expect(forgottenPayload.forgotten).toBe(true);
          expect(forgottenPayload.scope).toEqual({
            agentId: "codex",
            sessionId: "write-session",
            userId: "codex-user",
            workspaceId: "workspace-a",
          });

          const stats = await runCLI([
            "stats",
            "--user-id",
            "codex-user",
            "--workspace-id",
            "workspace-a",
            "--agent-id",
            "codex",
            "--session-id",
            "write-session",
            "--storage-provider",
            "sqlite",
            "--storage-url",
            join(home.root, ".goodmemory", "memory.sqlite"),
            "--json",
          ]);
          const statsPayload = JSON.parse(stats.stdout) as {
            counts: {
              feedback: number;
            };
          };

          expect(stats.exitCode).toBe(0);
          expect(statsPayload.counts.feedback).toBe(0);
        },
      );
    } finally {
      await workspace.cleanup();
      await home.cleanup();
    }
  });

  it("forget supports deleting a full scoped target with --all", async () => {
    const workspace = await createTempWorkspace("goodmemory-forget-all");
    const previousCwd = process.cwd();

    try {
      process.chdir(workspace.root);

      expect(
        (
          await runCLI([
            "remember",
            "--user-id",
            "forget-user",
            "--workspace-id",
            "workspace-a",
            "--session-id",
            "forget-session",
            "--message",
            "Remember that the deploy is blocked on smoke verification.",
          ])
        ).exitCode,
      ).toBe(0);
      expect(
        (
          await runCLI([
            "feedback",
            "--user-id",
            "forget-user",
            "--workspace-id",
            "workspace-a",
            "--session-id",
            "forget-session",
            "--signal",
            "Keep coding summaries short and list explicit next steps.",
          ])
        ).exitCode,
      ).toBe(0);

      const forgotten = await runCLI([
        "forget",
        "--all",
        "--user-id",
        "forget-user",
        "--workspace-id",
        "workspace-a",
        "--session-id",
        "forget-session",
        "--json",
      ]);
      const forgottenPayload = JSON.parse(forgotten.stdout) as {
        deleted: {
          facts: number;
          feedback: number;
        };
      };

      expect(forgotten.exitCode).toBe(0);
      expect(forgottenPayload.deleted.facts).toBeGreaterThan(0);
      expect(forgottenPayload.deleted.feedback).toBeGreaterThan(0);

      const stats = await runCLI([
        "stats",
        "--user-id",
        "forget-user",
        "--workspace-id",
        "workspace-a",
        "--session-id",
        "forget-session",
        "--json",
      ]);
      const statsPayload = JSON.parse(stats.stdout) as {
        counts: {
          facts: number;
          feedback: number;
        };
      };

      expect(stats.exitCode).toBe(0);
      expect(statsPayload.counts.facts).toBe(0);
      expect(statsPayload.counts.feedback).toBe(0);
    } finally {
      process.chdir(previousCwd);
      await workspace.cleanup();
    }
  });

  for (const command of ["inspect", "stats"] as const) {
    it(`${command} does not create default sqlite storage when the cwd store is missing`, async () => {
      const workspace = await createTempWorkspace(`goodmemory-cli-${command}-missing-store`);
      const previousCwd = process.cwd();

      try {
        process.chdir(workspace.root);

        const result = await runCLI([
          command,
          "--user-id",
          "review-user",
        ]);

        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain(
          "Read-only CLI commands require an existing sqlite database",
        );
        await expect(
          access(join(workspace.root, ".goodmemory", "memory.sqlite")),
        ).rejects.toThrow();
      } finally {
        process.chdir(previousCwd);
        await workspace.cleanup();
      }
    });
  }

  it("trace does not create default sqlite storage when the cwd store is missing", async () => {
    const workspace = await createTempWorkspace("goodmemory-cli-trace-missing-store");
    const previousCwd = process.cwd();

    try {
      process.chdir(workspace.root);

      const result = await runCLI([
        "trace",
        "--user-id",
        "review-user",
        "--query",
        "What should I do next?",
      ]);

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain(
        "Read-only CLI commands require an existing sqlite database",
      );
      await expect(
        access(join(workspace.root, ".goodmemory", "memory.sqlite")),
      ).rejects.toThrow();
    } finally {
      process.chdir(previousCwd);
      await workspace.cleanup();
    }
  });

  it("trace --ignore-memory bypasses default sqlite resolution in an empty workspace", async () => {
    const workspace = await createTempWorkspace("goodmemory-cli-trace-ignore-memory-missing-store");
    const previousCwd = process.cwd();

    try {
      process.chdir(workspace.root);

      const result = await runCLI([
        "trace",
        "--user-id",
        "review-user",
        "--query",
        "What should I do next?",
        "--ignore-memory",
      ]);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("Storage: memory (ignored (--ignore-memory))");
      expect(result.stdout).toContain("Policy Applied");
      expect(result.stdout).toContain("- ignore_memory");
      await expect(
        access(join(workspace.root, ".goodmemory", "memory.sqlite")),
      ).rejects.toThrow();
    } finally {
      process.chdir(previousCwd);
      await workspace.cleanup();
    }
  });
  it("import-memory imports a pages directory only after confirmation and re-imports unchanged", async () => {
    const workspace = await createTempWorkspace("goodmemory-cli-import-pages");

    try {
      const sqlitePath = join(workspace.root, "memory.sqlite");
      const pagesDir = join(workspace.root, "field", "pages");
      await mkdir(pagesDir, { recursive: true });
      await writeFile(
        join(pagesDir, "carbon-fibre-woks.md"),
        [
          "---",
          "title: Carbon Fibre Woks",
          "updated: '2026-08-22T14:30:00Z'",
          "tags: [cookware]",
          "---",
          "",
          "Carbon fibre woks conduct heat evenly, but scorch at the centre.",
          "",
        ].join("\n"),
        "utf8",
      );
      await writeFile(join(pagesDir, "listing.md"), "# Pages\n\n- [Carbon Fibre Woks](carbon-fibre-woks.md)\n", "utf8");
      await writeFile(join(pagesDir, "manifest.json"), JSON.stringify({ pagesSha256: "0".repeat(64) }), "utf8");
      const baseArgs = [
        "import-memory",
        "--user-id",
        "cli-user",
        "--workspace-id",
        "workspace-a",
        "--storage-provider",
        "sqlite",
        "--storage-url",
        sqlitePath,
        "--input",
        join(workspace.root, "field"),
      ];

      const refused = await runCLI(baseArgs);
      expect(refused.exitCode).toBe(1);
      expect(refused.stderr).toContain("--yes");
      expect(refused.stderr).toMatch(/--expect-sha256 [0-9a-f]{64}/);
      const refusedSha = /--expect-sha256 ([0-9a-f]{64})/.exec(refused.stderr)![1]!;

      const dryRun = await runCLI([...baseArgs, "--dry-run", "--json"]);
      expect(dryRun.exitCode).toBe(0);
      const dryPayload = JSON.parse(dryRun.stdout) as {
        counts: Record<string, number>;
        dryRun: boolean;
        inputSha256: string;
        manifestSha256: string;
        outcome: string;
        sourceKind: string;
      };
      expect(dryPayload).toMatchObject({
        counts: { imported: 1, rejected: 0, unchanged: 0 },
        dryRun: true,
        inputSha256: refusedSha,
        manifestSha256: "0".repeat(64),
        outcome: "dry_run",
        sourceKind: "pages",
      });
      const statsAfterDryRun = await runCLI([
        "stats", "--user-id", "cli-user", "--workspace-id", "workspace-a",
        "--storage-provider", "sqlite", "--storage-url", sqlitePath, "--json",
      ]);
      expect(statsAfterDryRun.exitCode).toBe(0);
      expect(statsAfterDryRun.stdout).toContain('"notes": 0');

      const mismatch = await runCLI([...baseArgs, "--expect-sha256", "f".repeat(64)]);
      expect(mismatch.exitCode).toBe(1);
      expect(mismatch.stderr).toContain("import_hash_mismatch");

      const imported = await runCLI([...baseArgs, "--expect-sha256", refusedSha]);
      expect(imported.exitCode).toBe(0);
      expect(imported.stdout).toContain("Imported memory from");
      expect(imported.stdout).toContain("imported=1");
      expect(imported.stdout).toContain("manifest sha256: differs");

      const again = await runCLI([...baseArgs, "--yes", "--json"]);
      expect(again.exitCode).toBe(0);
      expect(JSON.parse(again.stdout)).toMatchObject({
        counts: { imported: 0, superseded: 0, unchanged: 1 },
        outcome: "imported",
      });

      const exported = await runCLI([
        "export-memory", "--user-id", "cli-user", "--workspace-id", "workspace-a",
        "--storage-provider", "sqlite", "--storage-url", sqlitePath,
        "--output", join(workspace.root, "export"),
      ]);
      expect(exported.exitCode).toBe(0);
      const exportedPages = (await readdir(join(workspace.root, "export", "pages"))).sort();
      expect(exportedPages).toEqual([
        expect.stringMatching(/^carbon-fibre-woks-[0-9a-f]{8}\.md$/),
        "listing.md",
        "manifest.json",
      ]);
      const roundTrip = await runCLI([...baseArgs.slice(0, -1), join(workspace.root, "export"), "--yes", "--json"]);
      expect(roundTrip.exitCode).toBe(0);
      const roundTripPayload = JSON.parse(roundTrip.stdout) as { inputSha256: string; manifestSha256: string };
      expect(roundTripPayload).toMatchObject({
        counts: { imported: 0, superseded: 0, unchanged: 1 },
      });
      expect(roundTripPayload.manifestSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(roundTripPayload.inputSha256).toBe(roundTripPayload.manifestSha256);
    } finally {
      await workspace.cleanup();
    }
  });

  it("import-memory restores a memory-export.json snapshot by id", async () => {
    const workspace = await createTempWorkspace("goodmemory-cli-import-snapshot");

    try {
      const sourcePath = join(workspace.root, "source.sqlite");
      const { scope } = await seedSQLiteMemory(sourcePath);
      const exportDir = join(workspace.root, "export");
      const exported = await runCLI([
        "export-memory", "--user-id", scope.userId, "--workspace-id", scope.workspaceId!,
        "--storage-provider", "sqlite", "--storage-url", sourcePath, "--output", exportDir,
      ]);
      expect(exported.exitCode).toBe(0);

      const targetPath = join(workspace.root, "target.sqlite");
      const imported = await runCLI([
        "import-memory", "--user-id", scope.userId, "--workspace-id", scope.workspaceId!,
        "--storage-provider", "sqlite", "--storage-url", targetPath,
        "--input", join(exportDir, "memory-export.json"), "--yes", "--json",
      ]);
      expect(imported.exitCode).toBe(0);
      const payload = JSON.parse(imported.stdout) as { counts: { imported: number }; outcome: string; sourceKind: string };
      expect(payload.sourceKind).toBe("durable");
      expect(payload.outcome).toBe("imported");
      expect(payload.counts.imported).toBeGreaterThan(0);

      const inspected = await runCLI([
        "inspect", "--user-id", scope.userId, "--workspace-id", scope.workspaceId!,
        "--storage-provider", "sqlite", "--storage-url", targetPath,
      ]);
      expect(inspected.exitCode).toBe(0);
      expect(inspected.stdout).toContain("release quality program");

      const unsupported = await runCLI([
        "import-memory", "--user-id", scope.userId, "--storage-provider", "sqlite",
        "--storage-url", targetPath, "--input", join(exportDir, "pages", "manifest.json"), "--yes",
      ]);
      expect(unsupported.exitCode).toBe(1);
      expect(unsupported.stderr).toContain("Unsupported import file");
    } finally {
      await workspace.cleanup();
    }
  });
});
