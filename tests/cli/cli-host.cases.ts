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

describe("goodmemory cli installed host config", () => {
  it("installs and uninstalls Codex global middleware config idempotently", async () => {
    const home = await createTempWorkspace("goodmemory-codex-install-home");

    try {
      await withEnv(
        {
          GOODMEMORY_HOME: home.root,
        },
        async () => {
          const first = await runCLI([
            "install",
            "codex",
            "--user-id",
            "codex-user",
            "--default-locale",
            "zh-tw",
            "--writeback",
            "selective",
            "--json",
          ]);
          expect(first.exitCode).toBe(0);
          const firstPayload = JSON.parse(first.stdout) as {
            changes: Array<{
              action: "created" | "unchanged" | "updated";
              relativePath: string;
            }>;
            configPath: string;
            host: string;
            memoryPath: string;
            userId: string;
          };
          expect(firstPayload.host).toBe("codex");
          expect(firstPayload.userId).toBe("codex-user");
          expect(firstPayload.memoryPath).toBe(join(home.root, ".goodmemory/memory.sqlite"));
          expect(
            firstPayload.changes.map(({ action, relativePath }) => ({
              action,
              relativePath,
            })),
          ).toEqual([
            {
              action: "created",
              relativePath: "codex.json",
            },
            {
              action: "created",
              relativePath: ".codex/config.toml",
            },
            {
              action: "created",
              relativePath: ".codex/hooks.json",
            },
          ]);

          const config = JSON.parse(
            await readFile(join(home.root, ".goodmemory/codex.json"), "utf8"),
          ) as {
            host: string;
            language?: { defaultLocale?: string };
            storage: { path: string; provider: string };
            userId: string;
          };
          expect(config.host).toBe("codex");
          expect(config.language).toEqual({ defaultLocale: "zh-TW" });
          expect(config.userId).toBe("codex-user");
          expect(config.storage.path).toBe(join(home.root, ".goodmemory/memory.sqlite"));
          const codexConfig = await readFile(join(home.root, ".codex/config.toml"), "utf8");
          expect(codexConfig).toContain('command = "goodmemory-mcp"');
          expect(codexConfig).toContain("hooks = true");
          expect(
            await readFile(join(home.root, ".codex/hooks.json"), "utf8"),
          ).toContain("UserPromptSubmit");

          const second = await runCLI([
            "install",
            "codex",
            "--user-id",
            "codex-user",
            "--json",
          ]);
          expect(second.exitCode).toBe(0);
          const secondPayload = JSON.parse(second.stdout) as {
            changes: Array<{
              action: "created" | "unchanged" | "updated";
              relativePath: string;
            }>;
          };
          expect(
            secondPayload.changes.map(({ action, relativePath }) => ({
              action,
              relativePath,
            })),
          ).toEqual([
            {
              action: "unchanged",
              relativePath: "codex.json",
            },
            {
              action: "unchanged",
              relativePath: ".codex/config.toml",
            },
            {
              action: "unchanged",
              relativePath: ".codex/hooks.json",
            },
          ]);

          const uninstall = await runCLI(["uninstall", "codex", "--json"]);
          expect(uninstall.exitCode).toBe(0);
          const uninstallPayload = JSON.parse(uninstall.stdout) as {
            changes: Array<{
              action: "deleted" | "unchanged";
              relativePath: string;
            }>;
          };
          expect(
            uninstallPayload.changes.map(({ action, relativePath }) => ({
              action,
              relativePath,
            })),
          ).toEqual([
            {
              action: "deleted",
              relativePath: "codex.json",
            },
            {
              action: "deleted",
              relativePath: ".codex/hooks.json",
            },
            {
              action: "deleted",
              relativePath: ".codex/config.toml",
            },
          ]);
          await expect(access(join(home.root, ".goodmemory/codex.json"))).rejects.toThrow();
          await expect(access(join(home.root, ".codex/hooks.json"))).rejects.toThrow();
          await expect(access(join(home.root, ".codex/config.toml"))).rejects.toThrow();
        },
      );
    } finally {
      await home.cleanup();
    }
  });

  it("installs Codex provider-backed storage and provider config without leaking secrets", async () => {
    const home = await createTempWorkspace("goodmemory-codex-install-provider-home");

    try {
      await withEnv(
        {
          GOODMEMORY_HOME: home.root,
        },
        async () => {
          const result = await runCLI([
            "install",
            "codex",
            "--user-id",
            "codex-user",
            "--storage-provider",
            "postgres",
            "--storage-url",
            "postgres://postgres:secret@localhost:5432/goodmemory",
            "--embedding-provider",
            "openai",
            "--embedding-model",
            "text-embedding-3-small",
            "--embedding-api-key",
            "embedding-secret",
            "--llm-provider",
            "anthropic",
            "--llm-model",
            "claude-3-5-haiku-latest",
            "--llm-api-key",
            "llm-secret",
            "--json",
          ]);

          expect(result.exitCode).toBe(0);
          expect(result.stdout).not.toContain("embedding-secret");
          expect(result.stdout).not.toContain("llm-secret");
          const payload = JSON.parse(result.stdout) as {
            providers: {
              assistedExtractor: {
                configured: boolean;
                model?: string;
                provider?: string;
              };
              embedding: {
                configured: boolean;
                model?: string;
                provider?: string;
              };
            };
            storage: {
              location: string;
              provider: string;
            };
          };
          expect(payload.storage).toEqual({
            location: "configured",
            provider: "postgres",
          });
          expect(payload.providers.embedding).toMatchObject({
            configured: true,
            model: "text-embedding-3-small",
            provider: "openai",
          });
          expect(payload.providers.assistedExtractor).toMatchObject({
            configured: true,
            model: "claude-3-5-haiku-latest",
            provider: "anthropic",
          });

          const config = JSON.parse(
            await readFile(join(home.root, ".goodmemory/codex.json"), "utf8"),
          ) as {
            providers: {
              assistedExtractor: {
                apiKey: string;
                model: string;
                provider: string;
              };
              embedding: {
                apiKey: string;
                model: string;
                provider: string;
              };
            };
            storage: {
              provider: string;
              url: string;
            };
          };
          expect(config.storage).toEqual({
            provider: "postgres",
            url: "postgres://postgres:secret@localhost:5432/goodmemory",
          });
          expect(config.providers.embedding).toEqual({
            apiKey: "embedding-secret",
            model: "text-embedding-3-small",
            provider: "openai",
          });
          expect(config.providers.assistedExtractor).toEqual({
            apiKey: "llm-secret",
            model: "claude-3-5-haiku-latest",
            provider: "anthropic",
          });
        },
      );
    } finally {
      await home.cleanup();
    }
  });

  it("tells installed-host users how to add optional providers later", async () => {
    const home = await createTempWorkspace("goodmemory-codex-install-guidance-home");

    try {
      await withEnv(
        {
          GOODMEMORY_HOME: home.root,
        },
        async () => {
          const result = await runCLI([
            "install",
            "codex",
            "--user-id",
            "codex-user",
          ]);

          expect(result.exitCode).toBe(0);
          expect(result.stdout).toContain("embedding provider: not configured");
          expect(result.stdout).toContain("LLM extraction provider: not configured");
          expect(result.stdout).toContain("--embedding-* / --llm-* flags");
          expect(result.stdout).toContain("writeback mode: recall-only");
          expect(result.stdout).toContain("goodmemory enable codex --writeback observe");
          expect(result.stdout).toContain(join(home.root, ".goodmemory/codex.json"));
        },
      );
    } finally {
      await home.cleanup();
    }
  });

  it("lets users add provider config later by rerunning install", async () => {
    const home = await createTempWorkspace("goodmemory-codex-install-later-home");

    try {
      await withEnv(
        {
          GOODMEMORY_HOME: home.root,
        },
        async () => {
          const initial = await runCLI([
            "install",
            "codex",
            "--user-id",
            "codex-user",
            "--writeback",
            "selective",
            "--json",
          ]);
          expect(initial.exitCode).toBe(0);

          const configured = await runCLI([
            "install",
            "codex",
            "--embedding-provider",
            "openai",
            "--embedding-model",
            "text-embedding-3-small",
            "--embedding-api-key",
            "embedding-secret",
            "--llm-provider",
            "openai",
            "--llm-model",
            "gpt-4o-mini",
            "--llm-api-key",
            "llm-secret",
            "--json",
          ]);
          expect(configured.exitCode).toBe(0);

          const config = JSON.parse(
            await readFile(join(home.root, ".goodmemory/codex.json"), "utf8"),
          ) as {
            providers: {
              assistedExtractor: { model: string; provider: string };
              embedding: { model: string; provider: string };
            };
            storage: { path: string; provider: string };
            userId: string;
            writeback: { mode: string };
          };
          expect(config.userId).toBe("codex-user");
          expect(config.writeback.mode).toBe("selective");
          expect(config.storage).toEqual({
            path: join(home.root, ".goodmemory/memory.sqlite"),
            provider: "sqlite",
          });
          expect(config.providers.embedding).toMatchObject({
            model: "text-embedding-3-small",
            provider: "openai",
          });
          expect(config.providers.assistedExtractor).toMatchObject({
            model: "gpt-4o-mini",
            provider: "openai",
          });
        },
      );
    } finally {
      await home.cleanup();
    }
  });

  it("prompts for installed-host storage and provider config during interactive install", async () => {
    const home = await createTempWorkspace("goodmemory-codex-install-interactive-home");
    const prompts: string[] = [];
    const answers = [
      "",
      "codex-user",
      "postgres",
      "postgres://postgres:secret@localhost:5432/goodmemory",
      "yes",
      "text-embedding-3-small",
      "embedding-secret",
      "",
      "yes",
      "openai",
      "gpt-4o-mini",
      "llm-secret",
      "",
      "",
    ];

    try {
      await withEnv(
        {
          GOODMEMORY_HOME: home.root,
        },
        async () => {
          const result = await runCLI(
            [
              "install",
              "codex",
              "--interactive",
              "--json",
            ],
            {
              interactive: true,
              prompt: {
                ask: async (message) => {
                  prompts.push(message);
                  return answers.shift() ?? "";
                },
                askSecret: async (message) => {
                  prompts.push(message);
                  return answers.shift() ?? "";
                },
              },
            },
          );

          expect(result.exitCode).toBe(0);
          expect(result.stdout).not.toContain("embedding-secret");
          expect(result.stdout).not.toContain("llm-secret");
          expect(prompts.join("\n")).toContain("Postgres connection string");
          expect(prompts.join("\n")).toContain("Embedding");
          expect(prompts.join("\n")).toContain("LLM extraction");

          const config = JSON.parse(
            await readFile(join(home.root, ".goodmemory/codex.json"), "utf8"),
          ) as {
            providers: {
              assistedExtractor: {
                apiKey: string;
                model: string;
                provider: string;
              };
              embedding: {
                apiKey: string;
                model: string;
                provider: string;
              };
            };
            storage: {
              provider: string;
              url: string;
            };
            userId: string;
            writeback: { mode: string };
          };
          expect(config.userId).toBe("codex-user");
          // Fresh interactive installs now recommend selective (capture on,
          // auditable/reversible) instead of observe.
          expect(config.writeback.mode).toBe("selective");
          expect(config.storage).toEqual({
            provider: "postgres",
            url: "postgres://postgres:secret@localhost:5432/goodmemory",
          });
          expect(config.providers.embedding).toEqual({
            apiKey: "embedding-secret",
            model: "text-embedding-3-small",
            provider: "openai",
          });
          expect(config.providers.assistedExtractor).toEqual({
            apiKey: "llm-secret",
            model: "gpt-4o-mini",
            provider: "openai",
          });
        },
      );
    } finally {
      await home.cleanup();
    }
  });

  it("lets interactive installed-host users skip providers and defer to the managed config path", async () => {
    const home = await createTempWorkspace("goodmemory-codex-install-interactive-skip-home");
    const answers = [
      "",
      "",
      "skip",
      "no",
      "no",
      "off",
    ];

    try {
      await withEnv(
        {
          GOODMEMORY_HOME: home.root,
        },
        async () => {
          const result = await runCLI(
            [
              "install",
              "codex",
              "--interactive",
            ],
            {
              interactive: true,
              prompt: {
                ask: async () => answers.shift() ?? "",
                askSecret: async () => answers.shift() ?? "",
              },
            },
          );

          expect(result.exitCode).toBe(0);
          expect(result.stdout).toContain("embedding provider: not configured");
          expect(result.stdout).toContain("LLM extraction provider: not configured");
          expect(result.stdout).toContain(join(home.root, ".goodmemory/codex.json"));

          const config = JSON.parse(
            await readFile(join(home.root, ".goodmemory/codex.json"), "utf8"),
          ) as {
            providers?: unknown;
            storage: {
              path: string;
              provider: string;
            };
          };
          expect(config.providers).toBeUndefined();
          expect(config.storage).toEqual({
            path: join(home.root, ".goodmemory/memory.sqlite"),
            provider: "sqlite",
          });
        },
      );
    } finally {
      await home.cleanup();
    }
  });

  it("uses interactive global activation as the default installed-host path", async () => {
    const home = await createTempWorkspace("goodmemory-codex-install-interactive-global-home");
    const workspace = await createTempWorkspace(
      "goodmemory-codex-install-interactive-global-workspace",
    );
    const answers = [
      "global",
      "",
      "sqlite",
      "no",
      "no",
      "selective",
    ];

    try {
      await withEnv(
        {
          GOODMEMORY_HOME: home.root,
        },
        async () => {
          const result = await withCwd(workspace.root, async () =>
            runCLI(
              [
                "install",
                "codex",
                "--interactive",
                "--json",
              ],
              {
                interactive: true,
                prompt: {
                  ask: async () => answers.shift() ?? "",
                  askSecret: async () => answers.shift() ?? "",
                },
              },
            ),
          );

          expect(result.exitCode).toBe(0);
          const payload = JSON.parse(result.stdout) as {
            activationMode: string;
            writeback: { mode: string };
          };
          expect(payload.activationMode).toBe("global");
          expect(payload.writeback.mode).toBe("selective");
          await expect(access(join(workspace.root, ".goodmemory/codex.json"))).rejects.toThrow();
        },
      );
    } finally {
      await home.cleanup();
      await workspace.cleanup();
    }
  });

  it("can install and enable the current workspace from the interactive flow", async () => {
    const home = await createTempWorkspace("goodmemory-codex-install-current-workspace-home");
    const workspace = await createTempWorkspace(
      "goodmemory-codex-install-current-workspace-workspace",
    );
    const answers = [
      "current-workspace",
      "",
      "sqlite",
      "no",
      "no",
      "off",
    ];

    try {
      await withEnv(
        {
          GOODMEMORY_HOME: home.root,
        },
        async () => {
          const result = await withCwd(workspace.root, async () =>
            runCLI(
              [
                "install",
                "codex",
                "--interactive",
                "--json",
              ],
              {
                interactive: true,
                prompt: {
                  ask: async () => answers.shift() ?? "",
                  askSecret: async () => answers.shift() ?? "",
                },
              },
            ),
          );

          expect(result.exitCode).toBe(0);
          const config = JSON.parse(
            await readFile(join(workspace.root, ".goodmemory/codex.json"), "utf8"),
          ) as {
            enabled: boolean;
          };
          expect(config.enabled).toBe(true);
          expect(await readFile(join(workspace.root, "AGENTS.md"), "utf8")).toContain(
            "GOODMEMORY-INSTALL:CODEX START",
          );
        },
      );
    } finally {
      await home.cleanup();
      await workspace.cleanup();
    }
  });

  it("rolls back the global install when current-workspace enable fails", async () => {
    const home = await createTempWorkspace("goodmemory-codex-install-rollback-home");
    const workspace = await createTempWorkspace("goodmemory-codex-install-rollback-workspace");
    const answers = [
      "current-workspace",
      "",
      "sqlite",
      "no",
      "no",
      "off",
    ];

    try {
      await writeFile(
        join(workspace.root, "AGENTS.md"),
        [
          "# Existing Notes",
          "<!-- GOODMEMORY-INSTALL:CODEX START -->",
          "broken block",
        ].join("\n"),
        "utf8",
      );

      await withEnv(
        {
          GOODMEMORY_HOME: home.root,
        },
        async () => {
          const result = await withCwd(workspace.root, async () =>
            runCLI(
              [
                "install",
                "codex",
                "--interactive",
              ],
              {
                interactive: true,
                prompt: {
                  ask: async () => answers.shift() ?? "",
                  askSecret: async () => answers.shift() ?? "",
                },
              },
            ),
          );

          expect(result.exitCode).toBe(1);
          expect(result.stderr).toContain("managed install block is malformed");
          await expect(access(join(home.root, ".goodmemory/codex.json"))).rejects.toThrow();
          await expect(access(join(home.root, ".codex/hooks.json"))).rejects.toThrow();
          await expect(access(join(home.root, ".codex/config.toml"))).rejects.toThrow();
          await expect(access(join(workspace.root, ".goodmemory/codex.json"))).rejects.toThrow();
          expect(await readFile(join(workspace.root, "AGENTS.md"), "utf8")).toContain(
            "broken block",
          );
        },
      );
    } finally {
      await home.cleanup();
      await workspace.cleanup();
    }
  });

  it("keeps manual activation script-safe in non-interactive install mode", async () => {
    const home = await createTempWorkspace("goodmemory-codex-install-manual-home");
    const workspace = await createTempWorkspace("goodmemory-codex-install-manual-workspace");

    try {
      await withEnv(
        {
          GOODMEMORY_HOME: home.root,
        },
        async () => {
          const result = await withCwd(workspace.root, async () =>
            runCLI([
              "install",
              "codex",
              "--user-id",
              "codex-user",
              "--json",
            ]),
          );

          expect(result.exitCode).toBe(0);
          const payload = JSON.parse(result.stdout) as {
            activationMode: string;
          };
          expect(payload.activationMode).toBe("workspace_opt_in");
          await expect(access(join(workspace.root, ".goodmemory/codex.json"))).rejects.toThrow();
        },
      );
    } finally {
      await home.cleanup();
      await workspace.cleanup();
    }
  });

  it("plans install without writing managed files in dry-run mode", async () => {
    const home = await createTempWorkspace("goodmemory-install-dry-run-home");
    const workspace = await createTempWorkspace("goodmemory-install-dry-run-workspace");

    try {
      await withEnv(
        {
          GOODMEMORY_HOME: home.root,
        },
        async () => {
          const result = await withCwd(workspace.root, async () =>
            runCLI([
              "install",
              "codex",
              "--activation-mode",
              "global",
              "--context-mode",
              "progressive",
              "--storage-provider",
              "postgres",
              "--storage-url",
              "postgres://example/db",
              "--embedding-provider",
              "openai",
              "--embedding-model",
              "text-embedding-3-small",
              "--embedding-api-key",
              "sk-test",
              "--llm-provider",
              "anthropic",
              "--llm-model",
              "claude-haiku",
              "--llm-api-key",
              "sk-llm",
              "--writeback",
              "selective",
              "--user-id",
              "codex-user",
              "--dry-run",
              "--json",
            ]),
          );

          expect(result.exitCode).toBe(0);
          const payload = JSON.parse(result.stdout) as {
            dryRun: boolean;
            hosts: Array<{
              activationMode: string;
              contextMode: string;
              host: string;
              plannedChanges: Array<{ path: string }>;
              providers: {
                assistedExtractor: { configured: boolean; provider: string };
                embedding: { configured: boolean; provider: string };
              };
              storage: { location: string; provider: string };
              userId: string;
              writeback: { mode: string };
            }>;
          };
          expect(payload.dryRun).toBe(true);
          expect(payload.hosts[0]?.host).toBe("codex");
          expect(payload.hosts[0]?.activationMode).toBe("global");
          expect(payload.hosts[0]?.contextMode).toBe("progressive");
          expect(payload.hosts[0]?.writeback.mode).toBe("selective");
          expect(payload.hosts[0]?.storage).toEqual({
            location: "configured",
            provider: "postgres",
          });
          expect(payload.hosts[0]?.userId).toBe("codex-user");
          expect(payload.hosts[0]?.providers.embedding.configured).toBe(true);
          expect(payload.hosts[0]?.providers.embedding.provider).toBe("openai");
          expect(payload.hosts[0]?.providers.assistedExtractor.configured).toBe(true);
          expect(payload.hosts[0]?.providers.assistedExtractor.provider).toBe("anthropic");
          expect(payload.hosts[0]?.plannedChanges.length).toBeGreaterThan(0);
          await expect(access(join(home.root, ".goodmemory/codex.json"))).rejects.toThrow();
          await expect(access(join(home.root, ".codex/hooks.json"))).rejects.toThrow();
          await expect(access(join(home.root, ".codex/config.toml"))).rejects.toThrow();
        },
      );
    } finally {
      await home.cleanup();
      await workspace.cleanup();
    }
  });

  it(
    "plans install dry-run from existing config when options are omitted",
    async () => {
      const home = await createTempWorkspace("goodmemory-install-dry-run-existing-home");
      const workspace = await createTempWorkspace(
        "goodmemory-install-dry-run-existing-workspace",
      );

      try {
        await withEnv(
          {
            GOODMEMORY_HOME: home.root,
          },
          async () => {
            const install = await withCwd(workspace.root, async () =>
              runCLI([
                "install",
                "codex",
                "--activation-mode",
                "global",
                "--context-mode",
                "progressive",
                "--storage-provider",
                "postgres",
                "--storage-url",
                "postgres://example/db",
                "--embedding-provider",
                "openai",
                "--embedding-model",
                "text-embedding-3-small",
                "--embedding-api-key",
                "sk-test",
                "--llm-provider",
                "anthropic",
                "--llm-model",
                "claude-haiku",
                "--llm-api-key",
                "sk-llm",
                "--writeback",
                "selective",
                "--user-id",
                "existing-user",
                "--json",
              ]),
            );
            expect(install.exitCode).toBe(0);

            const plan = await withCwd(workspace.root, async () =>
              runCLI(["install", "codex", "--dry-run", "--json"]),
            );

            expect(plan.exitCode).toBe(0);
            const payload = JSON.parse(plan.stdout) as {
              hosts: Array<{
                contextMode: string;
                providers: {
                  assistedExtractor: { configured: boolean; provider: string };
                  embedding: { configured: boolean; provider: string };
                };
                storage: { location: string; provider: string };
                userId: string;
                writeback: { mode: string };
              }>;
            };
            expect(payload.hosts[0]?.contextMode).toBe("progressive");
            expect(payload.hosts[0]?.storage).toEqual({
              location: "configured",
              provider: "postgres",
            });
            expect(payload.hosts[0]?.userId).toBe("existing-user");
            expect(payload.hosts[0]?.writeback.mode).toBe("selective");
            expect(payload.hosts[0]?.providers.embedding.configured).toBe(true);
            expect(payload.hosts[0]?.providers.embedding.provider).toBe("openai");
            expect(payload.hosts[0]?.providers.assistedExtractor.configured).toBe(true);
            expect(payload.hosts[0]?.providers.assistedExtractor.provider).toBe("anthropic");
          },
        );
      } finally {
        await home.cleanup();
        await workspace.cleanup();
      }
    },
    HOST_BOOTSTRAP_SCRIPT_TEST_TIMEOUT_MS,
  );

  it("validates dry-run install storage options like the real installer path", async () => {
    const home = await createTempWorkspace("goodmemory-install-dry-run-validation-home");
    const workspace = await createTempWorkspace(
      "goodmemory-install-dry-run-validation-workspace",
    );

    try {
      await withEnv(
        {
          GOODMEMORY_HOME: home.root,
        },
        async () => {
          const result = await withCwd(workspace.root, async () =>
            runCLI([
              "install",
              "codex",
              "--storage-provider",
              "postgres",
              "--dry-run",
              "--json",
            ]),
          );

          expect(result.exitCode).toBe(1);
          expect(result.stderr).toContain(
            "Postgres installed-host storage requires --storage-url.",
          );
          const blankUrl = await withCwd(workspace.root, async () =>
            runCLI([
              "install",
              "codex",
              "--storage-provider",
              "sqlite",
              "--storage-url",
              "   ",
              "--dry-run",
              "--json",
            ]),
          );
          expect(blankUrl.exitCode).toBe(1);
          expect(blankUrl.stderr).toContain(
            "Installed-host --storage-url must be a non-empty string.",
          );
          await expect(access(join(home.root, ".goodmemory/codex.json"))).rejects.toThrow();
        },
      );
    } finally {
      await home.cleanup();
      await workspace.cleanup();
    }
  });

  it("plans setup and enable without writing workspace files in dry-run mode", async () => {
    const home = await createTempWorkspace("goodmemory-setup-enable-dry-run-home");
    const workspace = await createTempWorkspace("goodmemory-setup-enable-dry-run-workspace");

    try {
      await withEnv(
        {
          GOODMEMORY_HOME: home.root,
        },
        async () => {
          const setup = await withCwd(workspace.root, async () =>
            runCLI([
              "setup",
              "--host",
              "codex",
              "--activation-mode",
              "workspace_opt_in",
              "--dry-run",
              "--json",
            ]),
          );
          expect(setup.exitCode).toBe(0);
          const setupPayload = JSON.parse(setup.stdout) as {
            dryRun: boolean;
            hosts: Array<{ plannedChanges: Array<{ path: string }> }>;
          };
          expect(setupPayload.dryRun).toBe(true);
          expect(setupPayload.hosts[0]?.plannedChanges.some((change) =>
            change.path.endsWith(".goodmemory/codex.json"),
          )).toBe(true);
          await expect(access(join(home.root, ".goodmemory/codex.json"))).rejects.toThrow();
          await expect(access(join(workspace.root, ".goodmemory/codex.json"))).rejects.toThrow();

          const install = await runCLI([
            "install",
            "codex",
            "--user-id",
            "codex-user",
            "--json",
          ]);
          expect(install.exitCode).toBe(0);
          const enable = await withCwd(workspace.root, async () =>
            runCLI([
              "enable",
              "codex",
              "--workspace-root",
              workspace.root,
              "--writeback",
              "observe",
              "--dry-run",
              "--json",
            ]),
          );
          expect(enable.exitCode).toBe(0);
          const enablePayload = JSON.parse(enable.stdout) as {
            dryRun: boolean;
            hosts: Array<{ plannedChanges: Array<{ path: string }> }>;
          };
          expect(enablePayload.dryRun).toBe(true);
          const enablePlannedPaths =
            enablePayload.hosts[0]?.plannedChanges.map((change) => change.path) ?? [];
          expect(enablePlannedPaths).toContain(join(home.root, ".goodmemory/codex.json"));
          expect(enablePayload.hosts[0]?.plannedChanges.some((change) =>
            change.path.endsWith("AGENTS.md"),
          )).toBe(true);
          expect(enablePlannedPaths.some((path) => path.endsWith(".codex/hooks.json"))).toBe(false);
          expect(enablePlannedPaths.some((path) => path.endsWith(".codex/config.toml"))).toBe(false);
          await expect(access(join(workspace.root, ".goodmemory/codex.json"))).rejects.toThrow();
          await expect(access(join(workspace.root, "AGENTS.md"))).rejects.toThrow();
        },
      );
    } finally {
      await home.cleanup();
      await workspace.cleanup();
    }
  });

  it("plans current-workspace install and setup dry-runs with workspace opt-in files", async () => {
    const installHome = await createTempWorkspace(
      "goodmemory-install-current-workspace-dry-run-home",
    );
    const setupHome = await createTempWorkspace(
      "goodmemory-setup-current-workspace-dry-run-home",
    );
    const installWorkspace = await createTempWorkspace(
      "goodmemory-install-current-workspace-dry-run-workspace",
    );
    const setupWorkspace = await createTempWorkspace(
      "goodmemory-setup-current-workspace-dry-run-workspace",
    );

    try {
      await withEnv(
        {
          GOODMEMORY_HOME: installHome.root,
        },
        async () => {
          const installAnswers = [
            "current-workspace",
            "",
            "sqlite",
            "no",
            "no",
            "off",
          ];
          const install = await withCwd(installWorkspace.root, async () =>
            runCLI(
              [
                "install",
                "codex",
                "--interactive",
                "--dry-run",
                "--json",
              ],
              {
                interactive: true,
                prompt: {
                  ask: async () => installAnswers.shift() ?? "",
                  askSecret: async () => installAnswers.shift() ?? "",
                },
              },
            ),
          );

          expect(install.exitCode).toBe(0);
          const payload = JSON.parse(install.stdout) as {
            hosts: Array<{ plannedChanges: Array<{ path: string }> }>;
          };
          const paths =
            payload.hosts[0]?.plannedChanges.map((change) =>
              change.path.replace(/^\/private\//u, "/"),
            ) ?? [];
          expect(paths).toContain(
            join(installWorkspace.root, ".goodmemory/codex.json").replace(
              /^\/private\//u,
              "/",
            ),
          );
          expect(paths).toContain(
            join(installWorkspace.root, "AGENTS.md").replace(/^\/private\//u, "/"),
          );
          await expect(access(join(installHome.root, ".goodmemory/codex.json"))).rejects.toThrow();
          await expect(
            access(join(installWorkspace.root, ".goodmemory/codex.json")),
          ).rejects.toThrow();
        },
      );

      await withEnv(
        {
          GOODMEMORY_HOME: setupHome.root,
        },
        async () => {
          const setupAnswers = [
            "codex",
            "current-workspace",
            "",
            "sqlite",
            "no",
            "no",
            "off",
          ];
          const setup = await withCwd(setupWorkspace.root, async () =>
            runCLI(
              [
                "setup",
                "--interactive",
                "--dry-run",
                "--json",
              ],
              {
                interactive: true,
                prompt: {
                  ask: async () => setupAnswers.shift() ?? "",
                  askSecret: async () => setupAnswers.shift() ?? "",
                },
              },
            ),
          );

          expect(setup.exitCode).toBe(0);
          const payload = JSON.parse(setup.stdout) as {
            hosts: Array<{ plannedChanges: Array<{ path: string }> }>;
          };
          const paths =
            payload.hosts[0]?.plannedChanges.map((change) =>
              change.path.replace(/^\/private\//u, "/"),
            ) ?? [];
          expect(paths).toContain(
            join(setupWorkspace.root, ".goodmemory/codex.json").replace(
              /^\/private\//u,
              "/",
            ),
          );
          expect(paths).toContain(
            join(setupWorkspace.root, "AGENTS.md").replace(/^\/private\//u, "/"),
          );
          await expect(access(join(setupHome.root, ".goodmemory/codex.json"))).rejects.toThrow();
          await expect(
            access(join(setupWorkspace.root, ".goodmemory/codex.json")),
          ).rejects.toThrow();
        },
      );
    } finally {
      await installHome.cleanup();
      await setupHome.cleanup();
      await installWorkspace.cleanup();
      await setupWorkspace.cleanup();
    }
  });

  it("reports installer doctor diagnostics without mutating host state", async () => {
    const home = await createTempWorkspace("goodmemory-doctor-home");
    const workspace = await createTempWorkspace("goodmemory-doctor-workspace");

    try {
      await withEnv(
        {
          GOODMEMORY_HOME: home.root,
        },
        async () => {
          const missing = await withCwd(workspace.root, async () =>
            runCLI([
              "doctor",
              "codex",
              "--workspace-root",
              workspace.root,
              "--json",
            ]),
          );
          expect(missing.exitCode).toBe(0);
          const missingPayload = JSON.parse(missing.stdout) as {
            hosts: Array<{
              config: string;
              repairable: boolean;
              nextCommands: string[];
            }>;
          };
          expect(missingPayload.hosts[0]?.config).toBe("missing");
          expect(missingPayload.hosts[0]?.repairable).toBe(false);
          expect(missingPayload.hosts[0]?.nextCommands).toContain("goodmemory setup --host codex");
          await expect(access(join(home.root, ".goodmemory/codex.json"))).rejects.toThrow();

          const install = await runCLI([
            "install",
            "codex",
            "--activation-mode",
            "global",
            "--context-mode",
            "progressive",
            "--writeback",
            "off",
            "--user-id",
            "codex-user",
            "--json",
          ]);
          expect(install.exitCode).toBe(0);
          await rm(join(home.root, ".codex/hooks.json"), { force: true });

          const doctor = await withCwd(workspace.root, async () =>
            runCLI([
              "doctor",
              "codex",
              "--workspace-root",
              workspace.root,
              "--json",
            ]),
          );
          expect(doctor.exitCode).toBe(0);
          const payload = JSON.parse(doctor.stdout) as {
            hosts: Array<{
              contextMode: string;
              hookRegistered: boolean;
              repairable: boolean;
              writeback: { mode: string };
            }>;
          };
          expect(payload.hosts[0]?.contextMode).toBe("progressive");
          expect(payload.hosts[0]?.writeback.mode).toBe("off");
          expect(payload.hosts[0]?.hookRegistered).toBe(false);
          expect(payload.hosts[0]?.repairable).toBe(true);
          await expect(access(join(home.root, ".codex/hooks.json"))).rejects.toThrow();
        },
      );
    } finally {
      await home.cleanup();
      await workspace.cleanup();
    }
  });

  it("reports unmanaged MCP conflicts as manual-fix diagnostics instead of repairable", async () => {
    const home = await createTempWorkspace("goodmemory-doctor-conflict-home");
    const workspace = await createTempWorkspace("goodmemory-doctor-conflict-workspace");

    try {
      await withEnv(
        {
          GOODMEMORY_HOME: home.root,
        },
        async () => {
          const install = await runCLI([
            "install",
            "codex",
            "--activation-mode",
            "global",
            "--user-id",
            "codex-user",
            "--json",
          ]);
          expect(install.exitCode).toBe(0);
          await writeFile(
            join(home.root, ".codex/config.toml"),
            [
              "[mcp_servers.goodmemory]",
              "command = \"custom-goodmemory-mcp\"",
              "args = [\"--host\", \"codex\"]",
              "",
            ].join("\n"),
            "utf8",
          );

          const doctor = await withCwd(workspace.root, async () =>
            runCLI([
              "doctor",
              "codex",
              "--workspace-root",
              workspace.root,
              "--json",
            ]),
          );
          expect(doctor.exitCode).toBe(0);
          const payload = JSON.parse(doctor.stdout) as {
            hosts: Array<{
              nextCommands: string[];
              repairable: boolean;
              warnings: string[];
            }>;
          };
          expect(payload.hosts[0]?.repairable).toBe(false);
          expect(payload.hosts[0]?.nextCommands).not.toContain("goodmemory repair codex");
          expect(payload.hosts[0]?.warnings.join("\n")).toContain("MCP");

          const persisted = await readFile(join(home.root, ".codex/config.toml"), "utf8");
          expect(persisted).toContain("custom-goodmemory-mcp");
        },
      );
    } finally {
      await home.cleanup();
      await workspace.cleanup();
    }
  });

  it("labels the preAction hook in doctor output only for hosts that register one", async () => {
    const home = await createTempWorkspace("goodmemory-doctor-preaction-home");
    const workspace = await createTempWorkspace("goodmemory-doctor-preaction-workspace");

    try {
      await withEnv(
        {
          GOODMEMORY_HOME: home.root,
        },
        async () => {
          for (const host of ["claude", "codex"] as const) {
            const install = await runCLI([
              "install",
              host,
              "--activation-mode",
              "global",
              "--writeback",
              "off",
              "--user-id",
              `${host}-user`,
              "--json",
            ]);
            expect(install.exitCode).toBe(0);
          }

          const claudeDoctor = await withCwd(workspace.root, async () =>
            runCLI(["doctor", "claude", "--workspace-root", workspace.root]),
          );
          expect(claudeDoctor.exitCode).toBe(0);
          const claudeHooksLine = claudeDoctor.stdout
            .split("\n")
            .find((line) => line.includes("- hooks:"));
          expect(claudeHooksLine).toContain("recall=registered");
          expect(claudeHooksLine).toContain("mcp=registered");
          // Claude never registers a preAction hook, so the label would only
          // read as a false "missing" defect.
          expect(claudeHooksLine).not.toContain("preAction");

          const codexDoctor = await withCwd(workspace.root, async () =>
            runCLI(["doctor", "codex", "--workspace-root", workspace.root]),
          );
          expect(codexDoctor.exitCode).toBe(0);
          const codexHooksLine = codexDoctor.stdout
            .split("\n")
            .find((line) => line.includes("- hooks:"));
          expect(codexHooksLine).toContain("preAction=registered");
        },
      );
    } finally {
      await home.cleanup();
      await workspace.cleanup();
    }
  });

  it("returns nonzero when repair cannot fix an explicit missing host install", async () => {
    const home = await createTempWorkspace("goodmemory-repair-missing-home");
    const workspace = await createTempWorkspace("goodmemory-repair-missing-workspace");

    try {
      await withEnv(
        {
          GOODMEMORY_HOME: home.root,
        },
        async () => {
          const repair = await withCwd(workspace.root, async () =>
            runCLI([
              "repair",
              "codex",
              "--workspace-root",
              workspace.root,
              "--json",
            ]),
          );
          expect(repair.exitCode).toBe(1);
          const payload = JSON.parse(repair.stdout) as {
            hosts: Array<{
              config: string;
              skipped: boolean;
            }>;
          };
          expect(payload.hosts[0]?.config).toBe("missing");
          expect(payload.hosts[0]?.skipped).toBe(true);
          await expect(access(join(home.root, ".goodmemory/codex.json"))).rejects.toThrow();
        },
      );
    } finally {
      await home.cleanup();
      await workspace.cleanup();
    }
  });

  it("repairs missing managed hook and MCP files while preserving review writeback mode", async () => {
    const home = await createTempWorkspace("goodmemory-repair-home");
    const workspace = await createTempWorkspace("goodmemory-repair-workspace");

    try {
      await withEnv(
        {
          GOODMEMORY_HOME: home.root,
        },
        async () => {
          const install = await runCLI([
            "install",
            "codex",
            "--activation-mode",
            "global",
            "--writeback",
            "review",
            "--user-id",
            "codex-user",
            "--json",
          ]);
          expect(install.exitCode).toBe(0);
          const globalConfigPath = join(home.root, ".goodmemory/codex.json");
          const globalConfigBeforeRepair = await readFile(globalConfigPath, "utf8");
          await rm(join(home.root, ".codex/hooks.json"), { force: true });
          await rm(join(home.root, ".codex/config.toml"), { force: true });

          const dryRun = await withCwd(workspace.root, async () =>
            runCLI([
              "repair",
              "codex",
              "--workspace-root",
              workspace.root,
              "--dry-run",
              "--json",
            ]),
          );
          expect(dryRun.exitCode).toBe(0);
          await expect(access(join(home.root, ".codex/hooks.json"))).rejects.toThrow();

          const repair = await withCwd(workspace.root, async () =>
            runCLI([
              "repair",
              "codex",
              "--workspace-root",
              workspace.root,
              "--json",
            ]),
          );
          expect(repair.exitCode).toBe(0);
          const payload = JSON.parse(repair.stdout) as {
            hosts: Array<{
              changes: Array<{ path: string }>;
              writeback: { mode: string };
            }>;
          };
          expect(payload.hosts[0]?.writeback.mode).toBe("review");
          expect(payload.hosts[0]?.changes.some((change) =>
            change.path.endsWith(".codex/hooks.json"),
          )).toBe(true);
          await expect(readFile(globalConfigPath, "utf8")).resolves.toBe(
            globalConfigBeforeRepair,
          );

          const status = await withCwd(workspace.root, async () =>
            runCLI([
              "status",
              "codex",
              "--workspace-root",
              workspace.root,
              "--json",
            ]),
          );
          const statusPayload = JSON.parse(status.stdout) as {
            hosts: Array<{
              hookRegistered: boolean;
              mcpRegistered: boolean;
              preActionRegistered: boolean;
              writeback: { mode: string };
            }>;
          };
          expect(statusPayload.hosts[0]?.hookRegistered).toBe(true);
          expect(statusPayload.hosts[0]?.mcpRegistered).toBe(true);
          expect(statusPayload.hosts[0]?.preActionRegistered).toBe(true);
          expect(statusPayload.hosts[0]?.writeback.mode).toBe("review");
        },
      );
    } finally {
      await home.cleanup();
      await workspace.cleanup();
    }
  });

  it("surfaces writeback capture activity in status output", async () => {
    const home = await createTempWorkspace("goodmemory-status-activity-home");
    const workspace = await createTempWorkspace("goodmemory-status-activity-workspace");

    try {
      await mkdir(join(home.root, ".goodmemory"), { recursive: true });
      const writeConfig = async (mode: "off" | "selective") =>
        writeFile(
          join(home.root, ".goodmemory/claude.json"),
          JSON.stringify(
            {
              activationMode: "global",
              host: "claude",
              maxTokens: 256,
              retrievalProfile: "coding_agent",
              storage: {
                path: join(home.root, ".goodmemory/memory.sqlite"),
                provider: "sqlite",
              },
              userId: "activity-user",
              version: 1,
              writeback: { mode },
            },
            null,
            2,
          ) + "\n",
          "utf8",
        );
      await writeConfig("selective");

      const scopeDigest = buildWritebackScopeDigest({
        agentId: "claude",
        userId: "activity-user",
        workspaceId: basename(workspace.root),
      });
      const buildEvent = (input: {
        eventId: string;
        occurredAt: string;
        recallHitCount?: number;
        scopeDigest?: string;
        sessionDigest: string;
        status?: string;
      }) => ({
        candidateKey: `sha256:${input.eventId}`,
        command: "turn-end",
        contentPreview: "bounded preview",
        eventId: input.eventId,
        forgottenLinkedRecordIds: [],
        forgottenMemoryIds: [],
        host: "claude",
        kind: "fact",
        linkedRecordIds: [],
        memoryIds: [`memory-${input.eventId}`],
        mode: "selective",
        occurredAt: input.occurredAt,
        reason: "decision",
        recallHitCount: input.recallHitCount ?? 0,
        recalledBy: [],
        scopeDigest: input.scopeDigest ?? scopeDigest,
        sessionDigest: input.sessionDigest,
        source: "user",
        status: input.status ?? "committed",
        updatedAt: input.occurredAt,
      });
      await writeFile(
        join(home.root, ".goodmemory/claude-writeback-events.json"),
        JSON.stringify(
          {
            auditEvents: [
              buildEvent({
                eventId: "evt-early",
                occurredAt: "2026-07-04T10:00:00.000Z",
                sessionDigest: "session:aaa",
              }),
              buildEvent({
                eventId: "evt-latest",
                occurredAt: "2026-07-05T09:00:00.000Z",
                recallHitCount: 2,
                sessionDigest: "session:bbb",
              }),
              buildEvent({
                eventId: "evt-foreign-scope",
                occurredAt: "2026-07-05T09:30:00.000Z",
                scopeDigest: "scope:other",
                sessionDigest: "session:ccc",
              }),
              buildEvent({
                eventId: "evt-observed",
                occurredAt: "2026-07-05T09:45:00.000Z",
                sessionDigest: "session:bbb",
                status: "observed",
              }),
            ],
            events: [],
            pending: [],
            version: 1,
          },
          null,
          2,
        ) + "\n",
        "utf8",
      );

      await withEnv(
        {
          GOODMEMORY_HOME: home.root,
        },
        async () => {
          const status = await withCwd(workspace.root, async () =>
            runCLI([
              "status",
              "claude",
              "--workspace-root",
              workspace.root,
              "--json",
            ]),
          );
          expect(status.exitCode).toBe(0);
          const payload = JSON.parse(status.stdout) as {
            hosts: Array<{
              writebackActivity?: {
                committedTotal: number;
                lastCapturedAt: string | null;
                lastSessionCaptured: number;
                recallHitEvents: number;
              };
            }>;
          };
          // Only committed events in the current scope count; the foreign
          // scope and the observed (non-durable) event stay out.
          expect(payload.hosts[0]?.writebackActivity).toEqual({
            committedTotal: 2,
            lastCapturedAt: "2026-07-05T09:00:00.000Z",
            lastSessionCaptured: 1,
            recallHitEvents: 1,
          });

          const text = await withCwd(workspace.root, async () =>
            runCLI(["status", "claude", "--workspace-root", workspace.root]),
          );
          expect(text.stdout).toContain(
            "captured: 1 memory last session (1 recalled in later sessions)",
          );
          expect(text.stdout).toContain("goodmemory claude writeback inspect");

          // Capture off: status points at the enable command instead.
          await writeConfig("off");
          const offText = await withCwd(workspace.root, async () =>
            runCLI(["status", "claude", "--workspace-root", workspace.root]),
          );
          expect(offText.stdout).toContain(
            "capture: off — enable: goodmemory enable claude --writeback selective",
          );
        },
      );
    } finally {
      await home.cleanup();
      await workspace.cleanup();
    }
  });

  it("reports the retrieval tier in status and flags preset misconfiguration in doctor", async () => {
    const home = await createTempWorkspace("goodmemory-retrieval-tier-home");
    const workspace = await createTempWorkspace("goodmemory-retrieval-tier-workspace");

    try {
      await mkdir(join(home.root, ".goodmemory"), { recursive: true });
      const writeConfig = async (extra: Record<string, unknown>) =>
        writeFile(
          join(home.root, ".goodmemory/claude.json"),
          JSON.stringify(
            {
              activationMode: "global",
              host: "claude",
              maxTokens: 256,
              retrievalProfile: "coding_agent",
              storage: {
                path: join(home.root, ".goodmemory/memory.sqlite"),
                provider: "sqlite",
              },
              userId: "tier-user",
              version: 1,
              writeback: { mode: "off" },
              ...extra,
            },
            null,
            2,
          ) + "\n",
          "utf8",
        );

      await withEnv(
        {
          GOODMEMORY_EMBEDDING_API_KEY: undefined,
          GOODMEMORY_EMBEDDING_MODEL: undefined,
          GOODMEMORY_HOME: home.root,
        },
        async () => {
          await writeConfig({ retrieval: { bm25Ranking: true } });
          const bm25Status = await withCwd(workspace.root, async () =>
            runCLI(["status", "claude", "--workspace-root", workspace.root]),
          );
          expect(bm25Status.stdout).toContain("- retrieval: bm25-hybrid");

          // Shared reads + injection telemetry surface alongside the tier.
          await writeFile(
            join(home.root, ".goodmemory/claude-injection-state.json"),
            JSON.stringify(
              {
                events: [
                  {
                    at: "2026-07-05T10:00:00.000Z",
                    command: "user-prompt-submit",
                    decision: "injected",
                    estimatedTokens: 120,
                    recallLatencyMs: 40,
                    recordIds: ["fact-1"],
                  },
                  {
                    at: "2026-07-05T10:01:00.000Z",
                    command: "user-prompt-submit",
                    decision: "low_relevance",
                    estimatedTokens: 0,
                    recallLatencyMs: 20,
                    recordIds: [],
                  },
                ],
                sessions: {},
                version: 1,
              },
              null,
              2,
            ) + "\n",
            "utf8",
          );
          await writeConfig({
            retrieval: { bm25Ranking: true },
            sharedAgents: ["codex"],
          });
          const sharedStatus = await withCwd(workspace.root, async () =>
            runCLI(["status", "claude", "--workspace-root", workspace.root]),
          );
          expect(sharedStatus.stdout).toContain("- shared reads: codex");
          expect(sharedStatus.stdout).toContain(
            "- injection (last 2): injected 1, gated 1, avg recall 30ms",
          );

          await writeConfig({});
          const floorStatus = await withCwd(workspace.root, async () =>
            runCLI([
              "status",
              "claude",
              "--workspace-root",
              workspace.root,
              "--json",
            ]),
          );
          const floorPayload = JSON.parse(floorStatus.stdout) as {
            hosts: Array<{ retrievalTier?: string }>;
          };
          expect(floorPayload.hosts[0]?.retrievalTier).toBe("rules-only");

          // Provider-free recommended retrieval is a valid deterministic tier;
          // doctor must not report it as a fail-open configuration.
          await writeConfig({ retrieval: { preset: "recommended" } });
          const doctor = await withCwd(workspace.root, async () =>
            runCLI([
              "doctor",
              "claude",
              "--workspace-root",
              workspace.root,
              "--json",
            ]),
          );
          const doctorPayload = JSON.parse(doctor.stdout) as {
            hosts: Array<{ warnings: string[] }>;
          };
          expect(
            doctorPayload.hosts[0]?.warnings.some((warning) =>
              warning.includes("retrieval.preset"),
            ),
          ).toBe(false);
        },
      );
    } finally {
      await home.cleanup();
      await workspace.cleanup();
    }
  });

  it("composes recommended setup behind an explicit consent gate", async () => {
    const home = await createTempWorkspace("goodmemory-recommended-home");
    const workspace = await createTempWorkspace("goodmemory-recommended-workspace");

    try {
      await withEnv(
        {
          GOODMEMORY_HOME: home.root,
        },
        async () => {
          // Without consent (no --yes, non-interactive): refuse with guidance,
          // write nothing.
          const refused = await withCwd(workspace.root, async () =>
            runCLI(["setup", "--recommended", "--host", "claude"]),
          );
          expect(refused.exitCode).toBe(1);
          expect(refused.stderr).toContain("--yes");
          await expect(
            readFile(join(home.root, ".goodmemory/claude.json"), "utf8"),
          ).rejects.toThrow();

          // Explicit --yes: applies global activation + selective writeback
          // and prints the capture commitments.
          const applied = await withCwd(workspace.root, async () =>
            runCLI([
              "setup",
              "--recommended",
              "--host",
              "claude",
              "--user-id",
              "recommended-user",
              "--yes",
            ]),
          );
          expect(applied.exitCode).toBe(0);
          expect(applied.stdout).toContain("never persist raw transcripts");
          expect(applied.stdout).toContain("writeback inspect");

          const config = JSON.parse(
            await readFile(join(home.root, ".goodmemory/claude.json"), "utf8"),
          ) as {
            activationMode?: string;
            writeback?: { mode?: string };
          };
          expect(config.activationMode).toBe("global");
          expect(config.writeback?.mode).toBe("selective");
        },
      );
    } finally {
      await home.cleanup();
      await workspace.cleanup();
    }
  });

  it("recommends selective writeback in the interactive fresh-install prompt", async () => {
    const home = await createTempWorkspace("goodmemory-interactive-selective-home");
    const workspace = await createTempWorkspace(
      "goodmemory-interactive-selective-workspace",
    );

    try {
      await withEnv(
        {
          GOODMEMORY_HOME: home.root,
        },
        async () => {
          // All-default interactive answers: the fresh-install writeback
          // question now recommends selective.
          const answers: string[] = [];
          const result = await withCwd(workspace.root, async () =>
            runCLI(
              ["install", "claude", "--user-id", "interactive-user"],
              {
                interactive: true,
                prompt: {
                  ask: async () => answers.shift() ?? "",
                  askSecret: async () => answers.shift() ?? "",
                },
              },
            ),
          );
          expect(result.exitCode).toBe(0);

          const config = JSON.parse(
            await readFile(join(home.root, ".goodmemory/claude.json"), "utf8"),
          ) as { writeback?: { mode?: string } };
          expect(config.writeback?.mode).toBe("selective");
        },
      );
    } finally {
      await home.cleanup();
      await workspace.cleanup();
    }
  });

  it("captures a codex rollout via writeback --from-rollout", async () => {
    const home = await createTempWorkspace("goodmemory-rollout-home");
    const workspace = await createTempWorkspace("goodmemory-rollout-workspace");

    try {
      await withEnv(
        {
          GOODMEMORY_HOME: home.root,
        },
        async () => {
          await mkdir(join(home.root, ".goodmemory"), { recursive: true });
          await writeFile(
            join(home.root, ".goodmemory/codex.json"),
            JSON.stringify(
              {
                activationMode: "global",
                host: "codex",
                maxTokens: 256,
                retrievalProfile: "coding_agent",
                storage: {
                  path: join(home.root, ".goodmemory/memory.sqlite"),
                  provider: "sqlite",
                },
                userId: "rollout-user",
                version: 1,
                writeback: { mode: "selective" },
              },
              null,
              2,
            ) + "\n",
            "utf8",
          );

          // Nested sessions layout with two rollouts; --from-rollout picks
          // the newest by mtime.
          const sessionsRoot = join(home.root, ".codex/sessions/2026/07/05");
          await mkdir(sessionsRoot, { recursive: true });
          const oldRollout = join(
            sessionsRoot,
            "rollout-2026-07-05T09-00-00-11111111-1111-1111-1111-111111111111.jsonl",
          );
          const newRollout = join(
            sessionsRoot,
            "rollout-2026-07-05T10-00-00-22222222-2222-2222-2222-222222222222.jsonl",
          );
          const rolloutLine = (text: string) =>
            JSON.stringify({
              payload: {
                content: [{ text, type: "input_text" }],
                role: "user",
                type: "message",
              },
              timestamp: "2026-07-05T10:00:00.000Z",
              type: "response_item",
            }) + "\n";
          await writeFile(oldRollout, rolloutLine("Old rollout decision noted."), "utf8");
          await writeFile(
            newRollout,
            rolloutLine("Next step is to publish the codex rollout capture."),
            "utf8",
          );
          const future = new Date(Date.now() + 5_000);
          const { utimes } = await import("node:fs/promises");
          await utimes(newRollout, future, future);

          const result = await withCwd(workspace.root, async () =>
            runCLI([
              "codex",
              "writeback",
              "--from-rollout",
              "--sessions-root",
              join(home.root, ".codex/sessions"),
              "--workspace-root",
              workspace.root,
              "--json",
            ]),
          );
          expect(result.exitCode).toBe(0);
          const payload = JSON.parse(result.stdout) as {
            reason: string;
            trace: Record<string, unknown>;
            wrote: boolean;
          };
          expect(payload.reason).toBe("written");
          expect(payload.wrote).toBe(true);
          expect(payload.trace.transcriptPathUsed).toBe(true);
          expect(payload.trace.transcriptSessionDigest).toMatch(
            /^session:[a-f0-9]{24}$/u,
          );

          // Second run: the cursor makes it a no-op instead of a duplicate.
          const second = await withCwd(workspace.root, async () =>
            runCLI([
              "codex",
              "writeback",
              "--from-rollout",
              "--sessions-root",
              join(home.root, ".codex/sessions"),
              "--workspace-root",
              workspace.root,
              "--json",
            ]),
          );
          const secondPayload = JSON.parse(second.stdout) as { reason: string };
          expect(secondPayload.reason).toBe("empty_transcript");

          const missing = await withCwd(workspace.root, async () =>
            runCLI([
              "codex",
              "writeback",
              "--from-rollout",
              "--rollout-path",
              join(sessionsRoot, "missing.jsonl"),
              "--workspace-root",
              workspace.root,
              "--json",
            ]),
          );
          expect(missing.exitCode).toBe(1);
          const missingPayload = JSON.parse(missing.stdout) as { reason: string };
          expect(missingPayload.reason).toBe("transcript_read_failed");
        },
      );
    } finally {
      await home.cleanup();
      await workspace.cleanup();
    }
  });

  it("enables the MCP write tool via enable --mcp-allow-write", async () => {
    const home = await createTempWorkspace("goodmemory-mcp-allowwrite-home");
    const workspace = await createTempWorkspace("goodmemory-mcp-allowwrite-workspace");

    try {
      await withEnv(
        {
          GOODMEMORY_HOME: home.root,
        },
        async () => {
          const setup = await withCwd(workspace.root, async () =>
            runCLI([
              "setup",
              "--host",
              "claude",
              "--user-id",
              "allowwrite-user",
              "--json",
            ]),
          );
          expect(setup.exitCode).toBe(0);

          const enable = await withCwd(workspace.root, async () =>
            runCLI([
              "enable",
              "claude",
              "--mcp-allow-write",
              "--workspace-root",
              workspace.root,
              "--json",
            ]),
          );
          expect(enable.exitCode).toBe(0);

          const config = JSON.parse(
            await readFile(join(home.root, ".goodmemory/claude.json"), "utf8"),
          ) as { mcp?: { allowWrite?: boolean } };
          expect(config.mcp).toEqual({ allowWrite: true });
        },
      );
    } finally {
      await home.cleanup();
      await workspace.cleanup();
    }
  });

  it("recognizes Codex MCP registration with TOML-spaced managed args", async () => {
    const home = await createTempWorkspace("goodmemory-codex-spaced-mcp-home");
    const workspace = await createTempWorkspace("goodmemory-codex-spaced-mcp-workspace");

    try {
      await withEnv(
        {
          GOODMEMORY_HOME: home.root,
        },
        async () => {
          await mkdir(join(home.root, ".codex"), { recursive: true });
          await writeFile(
            join(home.root, ".codex/config.toml"),
            [
              "[mcp_servers.goodmemory]",
              'command = "goodmemory-mcp"',
              'args = [ "--host", "codex" ]',
              "",
              "[mcp_servers.goodmemory.env]",
              `GOODMEMORY_HOME = "${home.root}"`,
              'GOODMEMORY_MANAGED_BY = "goodmemory"',
              "",
            ].join("\n"),
            "utf8",
          );

          const install = await runCLI([
            "install",
            "codex",
            "--activation-mode",
            "global",
            "--writeback",
            "off",
            "--user-id",
            "codex-user",
            "--json",
          ]);
          expect(install.exitCode).toBe(0);

          const status = await withCwd(workspace.root, async () =>
            runCLI([
              "status",
              "codex",
              "--workspace-root",
              workspace.root,
              "--json",
            ]),
          );
          const payload = JSON.parse(status.stdout) as {
            hosts: Array<{
              mcpRegistered: boolean;
            }>;
          };
          expect(payload.hosts[0]?.mcpRegistered).toBe(true);
        },
      );
    } finally {
      await home.cleanup();
      await workspace.cleanup();
    }
  });

  it("recognizes the current Codex hooks feature flag as registered", async () => {
    const home = await createTempWorkspace("goodmemory-codex-current-hooks-home");
    const workspace = await createTempWorkspace("goodmemory-codex-current-hooks-workspace");

    try {
      await withEnv(
        {
          GOODMEMORY_HOME: home.root,
        },
        async () => {
          const install = await runCLI([
            "install",
            "codex",
            "--activation-mode",
            "global",
            "--writeback",
            "off",
            "--user-id",
            "codex-user",
            "--json",
          ]);
          expect(install.exitCode).toBe(0);

          const codexConfigPath = join(home.root, ".codex/config.toml");
          const codexConfig = await readFile(codexConfigPath, "utf8");
          await writeFile(
            codexConfigPath,
            codexConfig.replace(/hooks = true[^\n]*/u, "hooks = true"),
            "utf8",
          );

          const status = await withCwd(workspace.root, async () =>
            runCLI([
              "status",
              "codex",
              "--workspace-root",
              workspace.root,
              "--json",
            ]),
          );
          const payload = JSON.parse(status.stdout) as {
            hosts: Array<{
              hookRegistered: boolean;
              preActionRegistered: boolean;
            }>;
          };
          expect(payload.hosts[0]?.hookRegistered).toBe(true);
          expect(payload.hosts[0]?.preActionRegistered).toBe(true);
        },
      );
    } finally {
      await home.cleanup();
      await workspace.cleanup();
    }
  });

  it("repairs a missing Codex hook feature without rewriting installed config", async () => {
    const home = await createTempWorkspace("goodmemory-repair-feature-home");
    const workspace = await createTempWorkspace("goodmemory-repair-feature-workspace");

    try {
      await withEnv(
        {
          GOODMEMORY_HOME: home.root,
        },
        async () => {
          const install = await runCLI([
            "install",
            "codex",
            "--activation-mode",
            "global",
            "--writeback",
            "off",
            "--user-id",
            "codex-user",
            "--json",
          ]);
          expect(install.exitCode).toBe(0);

          const globalConfigPath = join(home.root, ".goodmemory/codex.json");
          const codexConfigPath = join(home.root, ".codex/config.toml");
          const globalConfigBeforeRepair = await readFile(globalConfigPath, "utf8");
          const codexConfig = await readFile(codexConfigPath, "utf8");
          await writeFile(
            codexConfigPath,
            codexConfig
              .split("\n")
              .filter((line) => !line.includes("hooks"))
              .join("\n"),
            "utf8",
          );

          const doctor = await withCwd(workspace.root, async () =>
            runCLI([
              "doctor",
              "codex",
              "--workspace-root",
              workspace.root,
              "--json",
            ]),
          );
          expect(doctor.exitCode).toBe(0);
          const doctorPayload = JSON.parse(doctor.stdout) as {
            hosts: Array<{
              hookRegistered: boolean;
              mcpRegistered: boolean;
              nextCommands: string[];
              preActionRegistered: boolean;
              repairable: boolean;
            }>;
          };
          expect(doctorPayload.hosts[0]?.hookRegistered).toBe(false);
          expect(doctorPayload.hosts[0]?.mcpRegistered).toBe(true);
          expect(doctorPayload.hosts[0]?.preActionRegistered).toBe(true);
          expect(doctorPayload.hosts[0]?.repairable).toBe(true);
          expect(doctorPayload.hosts[0]?.nextCommands).toContain(
            "goodmemory repair codex",
          );

          const repair = await withCwd(workspace.root, async () =>
            runCLI([
              "repair",
              "codex",
              "--workspace-root",
              workspace.root,
              "--json",
            ]),
          );
          expect(repair.exitCode).toBe(0);
          const repairedConfig = await readFile(codexConfigPath, "utf8");
          expect(repairedConfig).toContain("hooks = true");
          await expect(readFile(globalConfigPath, "utf8")).resolves.toBe(
            globalConfigBeforeRepair,
          );

          const status = await withCwd(workspace.root, async () =>
            runCLI([
              "status",
              "codex",
              "--workspace-root",
              workspace.root,
              "--json",
            ]),
          );
          const statusPayload = JSON.parse(status.stdout) as {
            hosts: Array<{
              hookRegistered: boolean;
              mcpRegistered: boolean;
              preActionRegistered: boolean;
            }>;
          };
          expect(statusPayload.hosts[0]?.hookRegistered).toBe(true);
          expect(statusPayload.hosts[0]?.mcpRegistered).toBe(true);
          expect(statusPayload.hosts[0]?.preActionRegistered).toBe(true);
        },
      );
    } finally {
      await home.cleanup();
      await workspace.cleanup();
    }
  });

  it("requires manual repair when Codex hook feature is explicitly disabled", async () => {
    const home = await createTempWorkspace("goodmemory-repair-disabled-feature-home");
    const workspace = await createTempWorkspace(
      "goodmemory-repair-disabled-feature-workspace",
    );

    try {
      await withEnv(
        {
          GOODMEMORY_HOME: home.root,
        },
        async () => {
          const install = await runCLI([
            "install",
            "codex",
            "--activation-mode",
            "global",
            "--writeback",
            "off",
            "--user-id",
            "codex-user",
            "--json",
          ]);
          expect(install.exitCode).toBe(0);

          const codexConfigPath = join(home.root, ".codex/config.toml");
          const codexConfig = await readFile(codexConfigPath, "utf8");
          await writeFile(
            codexConfigPath,
            codexConfig.replace(/hooks = true[^\n]*/u, "hooks = false"),
            "utf8",
          );

          const doctor = await withCwd(workspace.root, async () =>
            runCLI([
              "doctor",
              "codex",
              "--workspace-root",
              workspace.root,
              "--json",
            ]),
          );
          expect(doctor.exitCode).toBe(0);
          const doctorPayload = JSON.parse(doctor.stdout) as {
            hosts: Array<{
              nextCommands: string[];
              repairable: boolean;
              warnings: string[];
            }>;
          };
          expect(doctorPayload.hosts[0]?.repairable).toBe(false);
          expect(doctorPayload.hosts[0]?.nextCommands).not.toContain(
            "goodmemory repair codex",
          );
          expect(doctorPayload.hosts[0]?.warnings.join("\n")).toContain(
            "hooks",
          );

          const repair = await withCwd(workspace.root, async () =>
            runCLI([
              "repair",
              "codex",
              "--workspace-root",
              workspace.root,
              "--json",
            ]),
          );
          expect(repair.exitCode).toBe(1);
          const repairPayload = JSON.parse(repair.stdout) as {
            hosts: Array<{
              skipped: boolean;
              skippedReason: string;
            }>;
          };
          expect(repairPayload.hosts[0]?.skipped).toBe(true);
          expect(repairPayload.hosts[0]?.skippedReason).toBe("manual_fix_required");
        },
      );
    } finally {
      await home.cleanup();
      await workspace.cleanup();
    }
  });

  it("setup installs both hosts with global activation and selective writeback", async () => {
    const home = await createTempWorkspace("goodmemory-setup-home");
    const workspace = await createTempWorkspace("goodmemory-setup-workspace");
    const answers = [
      "both",
      "global",
      "",
      "sqlite",
      "no",
      "no",
      "selective",
      "selective",
    ];

    try {
      await withEnv(
        {
          GOODMEMORY_HOME: home.root,
        },
        async () => {
          const result = await withCwd(workspace.root, async () =>
            runCLI(
              [
                "setup",
                "--interactive",
                "--json",
              ],
              {
                interactive: true,
                prompt: {
                  ask: async () => answers.shift() ?? "",
                  askSecret: async () => answers.shift() ?? "",
                },
              },
            ),
          );

          expect(result.exitCode).toBe(0);
          const payload = JSON.parse(result.stdout) as {
            hosts: Array<{
              activationMode: string;
              host: string;
              writeback: { mode: string };
            }>;
          };
          expect(payload.hosts.map((host) => host.host).sort()).toEqual(["claude", "codex"]);
          expect(payload.hosts.every((host) => host.activationMode === "global")).toBe(true);
          expect(payload.hosts.every((host) => host.writeback.mode === "selective")).toBe(true);
        },
      );
    } finally {
      await home.cleanup();
      await workspace.cleanup();
    }
  });

  it("shows provider configuration in setup human output", async () => {
    const home = await createTempWorkspace("goodmemory-setup-provider-output-home");
    const workspace = await createTempWorkspace("goodmemory-setup-provider-output-workspace");

    try {
      await withEnv(
        {
          GOODMEMORY_HOME: home.root,
        },
        async () => {
          const result = await withCwd(workspace.root, async () =>
            runCLI([
              "setup",
              "--host",
              "codex",
              "--writeback",
              "observe",
              "--no-interactive",
              "--embedding-provider",
              "openai",
              "--embedding-model",
              "openai/text-embedding-3-small",
              "--embedding-api-key",
              "embedding-secret",
              "--embedding-base-url",
              "https://embeddings.example/v1",
              "--llm-provider",
              "openai",
              "--llm-model",
              "openai/gpt-4o-mini",
              "--llm-api-key",
              "llm-secret",
              "--llm-base-url",
              "https://llm.example/v1",
            ]),
          );

          expect(result.exitCode).toBe(0);
          expect(result.stdout).not.toContain("embedding-secret");
          expect(result.stdout).not.toContain("llm-secret");
          expect(result.stdout).toContain(
            "embedding provider: openai/text-embedding-3-small / custom base URL",
          );
          expect(result.stdout).toContain(
            "LLM extraction provider: openai/gpt-4o-mini / custom base URL",
          );
          expect(result.stdout).not.toContain("openai / openai/");
        },
      );
    } finally {
      await home.cleanup();
      await workspace.cleanup();
    }
  });

  it("uses selective for new interactive setup when the prompt default is accepted", async () => {
    const home = await createTempWorkspace("goodmemory-setup-default-writeback-home");
    const workspace = await createTempWorkspace(
      "goodmemory-setup-default-writeback-workspace",
    );
    const answers = [
      "codex",
      "global",
      "",
      "",
      "",
      "",
    ];

    try {
      await withEnv(
        {
          GOODMEMORY_HOME: home.root,
        },
        async () => {
          const result = await withCwd(workspace.root, async () =>
            runCLI(
              [
                "setup",
                "--interactive",
                "--json",
              ],
              {
                interactive: true,
                prompt: {
                  ask: async () => answers.shift() ?? "",
                  askSecret: async () => answers.shift() ?? "",
                },
              },
            ),
          );

          expect(result.exitCode).toBe(0);
          const payload = JSON.parse(result.stdout) as {
            hosts: Array<{
              host: string;
              writeback: { mode: string };
            }>;
          };
          expect(payload.hosts).toHaveLength(1);
          expect(payload.hosts[0]?.host).toBe("codex");
          expect(payload.hosts[0]?.writeback.mode).toBe("selective");

          const config = JSON.parse(
            await readFile(join(home.root, ".goodmemory/codex.json"), "utf8"),
          ) as {
            writeback: { mode: string };
          };
          expect(config.writeback.mode).toBe("selective");
        },
      );
    } finally {
      await home.cleanup();
      await workspace.cleanup();
    }
  });

  it("keeps existing interactive install writeback mode when the prompt default is accepted", async () => {
    const home = await createTempWorkspace("goodmemory-install-keep-writeback-home");
    const prompts: string[] = [];
    const answers = [
      "global",
      "",
      "sqlite",
      "no",
      "no",
      "",
    ];

    try {
      await withEnv(
        {
          GOODMEMORY_HOME: home.root,
        },
        async () => {
          const initial = await runCLI([
            "install",
            "codex",
            "--user-id",
            "codex-user",
            "--writeback",
            "off",
            "--json",
          ]);
          expect(initial.exitCode).toBe(0);

          const rerun = await runCLI(
            [
              "install",
              "codex",
              "--interactive",
              "--json",
            ],
            {
              interactive: true,
              prompt: {
                ask: async (message) => {
                  prompts.push(message);
                  return answers.shift() ?? "";
                },
                askSecret: async (message) => {
                  prompts.push(message);
                  return answers.shift() ?? "";
                },
              },
            },
          );

          expect(rerun.exitCode).toBe(0);
          expect(prompts.join("\n")).toContain("current=off");
          expect(prompts.join("\n")).toContain("keep-current");
          expect(prompts.join("\n")).toContain("review");
          const payload = JSON.parse(rerun.stdout) as {
            writeback: { mode: string };
          };
          expect(payload.writeback.mode).toBe("off");
          const config = JSON.parse(
            await readFile(join(home.root, ".goodmemory/codex.json"), "utf8"),
          ) as {
            writeback: { mode: string };
          };
          expect(config.writeback.mode).toBe("off");
        },
      );
    } finally {
      await home.cleanup();
    }
  });

  it("setup current-workspace uses workspace opt-in activation while enabling the repo", async () => {
    const home = await createTempWorkspace("goodmemory-setup-current-workspace-home");
    const workspace = await createTempWorkspace("goodmemory-setup-current-workspace");
    const answers = [
      "codex",
      "current-workspace",
      "",
      "sqlite",
      "no",
      "no",
      "off",
    ];

    try {
      await withEnv(
        {
          GOODMEMORY_HOME: home.root,
        },
        async () => {
          const result = await withCwd(workspace.root, async () =>
            runCLI(
              [
                "setup",
                "--interactive",
                "--json",
              ],
              {
                interactive: true,
                prompt: {
                  ask: async () => answers.shift() ?? "",
                  askSecret: async () => answers.shift() ?? "",
                },
              },
            ),
          );

          expect(result.exitCode).toBe(0);
          const payload = JSON.parse(result.stdout) as {
            hosts: Array<{
              activationMode: string;
              host: string;
              workspaceRoot?: string;
            }>;
          };
          expect(payload.hosts).toHaveLength(1);
          expect(payload.hosts[0]?.host).toBe("codex");
          expect(payload.hosts[0]?.activationMode).toBe("workspace_opt_in");
          expect(await realpath(payload.hosts[0]?.workspaceRoot ?? "")).toBe(
            await realpath(workspace.root),
          );

          const globalConfig = JSON.parse(
            await readFile(join(home.root, ".goodmemory/codex.json"), "utf8"),
          ) as {
            activationMode: string;
          };
          const workspaceConfig = JSON.parse(
            await readFile(join(workspace.root, ".goodmemory/codex.json"), "utf8"),
          ) as {
            enabled: boolean;
          };
          expect(globalConfig.activationMode).toBe("workspace_opt_in");
          expect(workspaceConfig.enabled).toBe(true);
          expect(await readFile(join(workspace.root, "AGENTS.md"), "utf8")).toContain(
            "GOODMEMORY-INSTALL:CODEX START",
          );
        },
      );
    } finally {
      await home.cleanup();
      await workspace.cleanup();
    }
  });

  it("rolls back earlier host installs when setup fails on a later workspace enable", async () => {
    const home = await createTempWorkspace("goodmemory-setup-rollback-home");
    const workspace = await createTempWorkspace("goodmemory-setup-rollback-workspace");
    const answers = [
      "both",
      "current-workspace",
      "",
      "sqlite",
      "no",
      "no",
      "off",
    ];

    try {
      await writeFile(
        join(workspace.root, "CLAUDE.md"),
        [
          "# Existing Claude Notes",
          "<!-- GOODMEMORY-INSTALL:CLAUDE START -->",
          "broken block",
        ].join("\n"),
        "utf8",
      );

      await withEnv(
        {
          GOODMEMORY_HOME: home.root,
        },
        async () => {
          const result = await withCwd(workspace.root, async () =>
            runCLI(
              [
                "setup",
                "--interactive",
              ],
              {
                interactive: true,
                prompt: {
                  ask: async () => answers.shift() ?? "",
                  askSecret: async () => answers.shift() ?? "",
                },
              },
            ),
          );

          expect(result.exitCode).toBe(1);
          expect(result.stderr).toContain("managed install block is malformed");
          await expect(access(join(home.root, ".goodmemory/codex.json"))).rejects.toThrow();
          await expect(access(join(home.root, ".goodmemory/claude.json"))).rejects.toThrow();
          await expect(access(join(home.root, ".codex/hooks.json"))).rejects.toThrow();
          await expect(access(join(home.root, ".codex/config.toml"))).rejects.toThrow();
          await expect(access(join(home.root, ".claude/settings.json"))).rejects.toThrow();
          await expect(access(join(home.root, ".claude.json"))).rejects.toThrow();
          await expect(access(join(workspace.root, ".goodmemory/codex.json"))).rejects.toThrow();
          await expect(access(join(workspace.root, ".goodmemory/claude.json"))).rejects.toThrow();
          await expect(access(join(workspace.root, "AGENTS.md"))).rejects.toThrow();
          expect(await readFile(join(workspace.root, "CLAUDE.md"), "utf8")).toContain(
            "broken block",
          );
        },
      );
    } finally {
      await home.cleanup();
      await workspace.cleanup();
    }
  });

  it("status does not report user-owned host config files as managed registrations", async () => {
    const home = await createTempWorkspace("goodmemory-status-user-owned-home");
    const workspace = await createTempWorkspace("goodmemory-status-user-owned-workspace");
    const memoryPath = join(home.root, ".goodmemory/memory.sqlite");

    try {
      await mkdir(join(home.root, ".goodmemory"), { recursive: true });
      await mkdir(join(home.root, ".codex"), { recursive: true });
      await writeFile(
        join(home.root, ".goodmemory/codex.json"),
        JSON.stringify(
          {
            activationMode: "global",
            host: "codex",
            storage: {
              path: memoryPath,
              provider: "sqlite",
            },
            userId: "codex-user",
            version: 1,
          },
          null,
          2,
        ) + "\n",
        "utf8",
      );
      await writeFile(
        join(home.root, ".codex/hooks.json"),
        JSON.stringify(
          {
            hooks: {
              SessionStart: [],
            },
          },
          null,
          2,
        ) + "\n",
        "utf8",
      );
      await writeFile(
        join(home.root, ".codex/config.toml"),
        ["[features]", "hooks = true", ""].join("\n"),
        "utf8",
      );

      await withEnv(
        {
          GOODMEMORY_HOME: home.root,
        },
        async () => {
          const status = await withCwd(workspace.root, async () =>
            runCLI([
              "status",
              "codex",
              "--workspace-root",
              workspace.root,
              "--json",
            ]),
          );
          expect(status.exitCode).toBe(0);
          const payload = JSON.parse(status.stdout) as {
            hosts: Array<{
              hookRegistered: boolean;
              mcpRegistered: boolean;
              preActionRegistered: boolean;
            }>;
          };
          expect(payload.hosts[0]?.hookRegistered).toBe(false);
          expect(payload.hosts[0]?.mcpRegistered).toBe(false);
          expect(payload.hosts[0]?.preActionRegistered).toBe(false);
        },
      );
    } finally {
      await home.cleanup();
      await workspace.cleanup();
    }
  });

  it("status text does not report invalid contextMode as fragment", async () => {
    const home = await createTempWorkspace("goodmemory-status-invalid-context-home");
    const workspace = await createTempWorkspace("goodmemory-status-invalid-context-workspace");

    try {
      await mkdir(join(home.root, ".goodmemory"), { recursive: true });
      await writeFile(
        join(home.root, ".goodmemory/codex.json"),
        JSON.stringify(
          {
            contextMode: "bad",
            host: "codex",
            storage: {
              path: join(home.root, ".goodmemory/memory.sqlite"),
              provider: "sqlite",
            },
            userId: "codex-user",
            version: 1,
          },
          null,
          2,
        ) + "\n",
        "utf8",
      );

      await withEnv(
        {
          GOODMEMORY_HOME: home.root,
        },
        async () => {
          const status = await withCwd(workspace.root, async () =>
            runCLI([
              "status",
              "codex",
              "--workspace-root",
              workspace.root,
            ]),
          );

          expect(status.exitCode).toBe(0);
          expect(status.stdout).toContain("  - context: unknown");
          expect(status.stdout).not.toContain("  - context: fragment");
        },
      );
    } finally {
      await home.cleanup();
      await workspace.cleanup();
    }
  });

  it("status does not create a fresh sqlite database for an installed host", async () => {
    const home = await createTempWorkspace("goodmemory-status-fresh-sqlite-home");
    const workspace = await createTempWorkspace("goodmemory-status-fresh-sqlite-workspace");
    const memoryPath = join(home.root, ".goodmemory/memory.sqlite");

    try {
      await withEnv(
        {
          GOODMEMORY_HOME: home.root,
        },
        async () => {
          const install = await runCLI([
            "install",
            "codex",
            "--activation-mode",
            "global",
            "--user-id",
            "codex-user",
            "--json",
          ]);
          expect(install.exitCode).toBe(0);
          await expect(access(memoryPath)).rejects.toThrow();

          const status = await withCwd(workspace.root, async () =>
            runCLI([
              "status",
              "codex",
              "--workspace-root",
              workspace.root,
              "--json",
            ]),
          );
          expect(status.exitCode).toBe(0);
          const payload = JSON.parse(status.stdout) as {
            hosts: Array<{
              counts: Record<string, number>;
              memoryStatus: string;
            }>;
          };
          expect(payload.hosts[0]?.memoryStatus).toBe("uninitialized");
          expect(payload.hosts[0]?.counts).toEqual({
            archives: 0,
            episodes: 0,
            facts: 0,
            feedback: 0,
            preferences: 0,
            profile: 0,
            references: 0,
          });
          await expect(access(memoryPath)).rejects.toThrow();
        },
      );
    } finally {
      await home.cleanup();
      await workspace.cleanup();
    }
  });

  it("status reports installed host activation and current workspace counts", async () => {
    const home = await createTempWorkspace("goodmemory-status-home");
    const workspace = await createTempWorkspace("goodmemory-status-workspace");

    try {
      await withEnv(
        {
          GOODMEMORY_HOME: home.root,
        },
        async () => {
          const install = await runCLI([
            "install",
            "codex",
            "--activation-mode",
            "global",
            "--context-mode",
            "progressive",
            "--writeback",
            "selective",
            "--user-id",
            "codex-user",
            "--json",
          ]);
          expect(install.exitCode).toBe(0);

          const remember = await withCwd(workspace.root, async () =>
            runCLI([
              "remember",
              "--host",
              "codex",
              "--workspace-root",
              workspace.root,
              "--message",
              "Remember that release status updates should be short.",
              "--json",
            ]),
          );
          expect(remember.exitCode).toBe(0);

          const status = await withCwd(workspace.root, async () =>
            runCLI([
              "status",
              "codex",
              "--workspace-root",
              workspace.root,
              "--json",
            ]),
          );
          expect(status.exitCode).toBe(0);
          const payload = JSON.parse(status.stdout) as {
            hosts: Array<{
              activationMode: string;
              contextMode: string;
              counts: { facts: number; feedback: number; preferences: number };
              hookRegistered: boolean;
              mcpRegistered: boolean;
              preActionRegistered: boolean;
              workspaceStatus: string;
              writeback: { mode: string };
            }>;
          };
          expect(payload.hosts[0]?.activationMode).toBe("global");
          expect(payload.hosts[0]?.contextMode).toBe("progressive");
          expect(payload.hosts[0]?.writeback.mode).toBe("selective");
          expect(payload.hosts[0]?.hookRegistered).toBe(true);
          expect(payload.hosts[0]?.mcpRegistered).toBe(true);
          expect(payload.hosts[0]?.preActionRegistered).toBe(true);
          expect(payload.hosts[0]?.workspaceStatus).toBe("ok");
          expect(
            (payload.hosts[0]?.counts.facts ?? 0) +
              (payload.hosts[0]?.counts.feedback ?? 0) +
              (payload.hosts[0]?.counts.preferences ?? 0),
          ).toBeGreaterThan(0);
        },
      );
    } finally {
      await home.cleanup();
      await workspace.cleanup();
    }
  });

  it("status reports missing repo opt-in when workspace activation is still manual", async () => {
    const home = await createTempWorkspace("goodmemory-status-manual-home");
    const workspace = await createTempWorkspace("goodmemory-status-manual-workspace");

    try {
      await withEnv(
        {
          GOODMEMORY_HOME: home.root,
        },
        async () => {
          const install = await runCLI([
            "install",
            "codex",
            "--user-id",
            "codex-user",
            "--json",
          ]);
          expect(install.exitCode).toBe(0);

          const status = await withCwd(workspace.root, async () =>
            runCLI([
              "status",
              "codex",
              "--workspace-root",
              workspace.root,
              "--json",
            ]),
          );
          expect(status.exitCode).toBe(0);
          const payload = JSON.parse(status.stdout) as {
            hosts: Array<{
              activationMode: string;
              counts?: unknown;
              workspaceStatus: string;
            }>;
          };
          expect(payload.hosts[0]?.activationMode).toBe("workspace_opt_in");
          expect(payload.hosts[0]?.workspaceStatus).toBe("missing_repo_config");
          expect(payload.hosts[0]?.counts).toBeUndefined();
        },
      );
    } finally {
      await home.cleanup();
      await workspace.cleanup();
    }
  });

  it("lets interactive sqlite storage override an existing Postgres install", async () => {
    const home = await createTempWorkspace(
      "goodmemory-codex-install-interactive-sqlite-reinstall-home",
    );
    const answers = [
      "",
      "",
      "sqlite",
      "no",
      "no",
      "off",
    ];

    try {
      await withEnv(
        {
          GOODMEMORY_HOME: home.root,
        },
        async () => {
          const initial = await runCLI([
            "install",
            "codex",
            "--storage-provider",
            "postgres",
            "--storage-url",
            "postgres://example/db",
            "--json",
          ]);
          expect(initial.exitCode).toBe(0);

          const result = await runCLI(
            [
              "install",
              "codex",
              "--interactive",
            ],
            {
              interactive: true,
              prompt: {
                ask: async () => answers.shift() ?? "",
                askSecret: async () => answers.shift() ?? "",
              },
            },
          );

          expect(result.exitCode).toBe(0);
          const config = JSON.parse(
            await readFile(join(home.root, ".goodmemory/codex.json"), "utf8"),
          ) as {
            storage: {
              path: string;
              provider: string;
            };
          };
          expect(config.storage).toEqual({
            path: join(home.root, ".goodmemory/memory.sqlite"),
            provider: "sqlite",
          });
        },
      );
    } finally {
      await home.cleanup();
    }
  });

  it("lets interactive users leave a prompted Postgres URL blank to skip Postgres", async () => {
    const home = await createTempWorkspace(
      "goodmemory-codex-install-interactive-blank-postgres-url-home",
    );
    const answers = [
      "",
      "",
      "",
      "no",
      "no",
      "off",
    ];

    try {
      await withEnv(
        {
          GOODMEMORY_HOME: home.root,
        },
        async () => {
          const result = await runCLI(
            [
              "install",
              "codex",
              "--storage-provider",
              "postgres",
              "--interactive",
            ],
            {
              interactive: true,
              prompt: {
                ask: async () => answers.shift() ?? "",
                askSecret: async () => answers.shift() ?? "",
              },
            },
          );

          expect(result.exitCode).toBe(0);
          expect(result.stderr).toBe("");
          const config = JSON.parse(
            await readFile(join(home.root, ".goodmemory/codex.json"), "utf8"),
          ) as {
            storage: {
              path: string;
              provider: string;
            };
          };
          expect(config.storage).toEqual({
            path: join(home.root, ".goodmemory/memory.sqlite"),
            provider: "sqlite",
          });
        },
      );
    } finally {
      await home.cleanup();
    }
  });

  it("rejects blank normalized installed provider flags before writing config", async () => {
    const cases = [
      {
        args: [
          "--embedding-provider",
          "openai",
          "--embedding-model",
          " ",
          "--embedding-api-key",
          "embedding-secret",
        ],
        message: "Incomplete embedding provider config. Missing --embedding-model.",
        prefix: "goodmemory-codex-install-blank-embedding-model",
      },
      {
        args: [
          "--llm-provider",
          "openai",
          "--llm-model",
          "gpt-4o-mini",
          "--llm-api-key",
          " ",
        ],
        message: "Incomplete LLM provider config. Missing --llm-api-key.",
        prefix: "goodmemory-codex-install-blank-llm-key",
      },
    ];

    for (const testCase of cases) {
      const home = await createTempWorkspace(testCase.prefix);

      try {
        await withEnv(
          {
            GOODMEMORY_HOME: home.root,
          },
          async () => {
            const result = await runCLI([
              "install",
              "codex",
              ...testCase.args,
              "--json",
            ]);

            expect(result.exitCode).toBe(1);
            expect(result.stderr).toContain(testCase.message);
            await expect(
              access(join(home.root, ".goodmemory/codex.json")),
            ).rejects.toThrow();
          },
        );
      } finally {
        await home.cleanup();
      }
    }
  });

  it("requires a matching global install before enabling repo-local opt-in", async () => {
    const home = await createTempWorkspace("goodmemory-codex-enable-home");
    const workspace = await createTempWorkspace("goodmemory-codex-enable-missing-install");

    try {
      await withEnv(
        {
          GOODMEMORY_HOME: home.root,
        },
        async () => {
          const result = await runCLI([
            "enable",
            "codex",
            "--workspace-root",
            workspace.root,
            "--json",
          ]);

          expect(result.exitCode).toBe(1);
          expect(result.stderr).toContain("Run 'goodmemory install codex' first");
        },
      );
    } finally {
      await home.cleanup();
      await workspace.cleanup();
    }
  });

  it("enables and disables Codex repo opt-in without losing existing repo notes", async () => {
    const home = await createTempWorkspace("goodmemory-codex-enable-home");
    const workspace = await createTempWorkspace("goodmemory-codex-enable");
    const originalInstructions = "\n# Existing Notes\n\n";

    try {
      await writeFile(join(workspace.root, "AGENTS.md"), originalInstructions, "utf8");

      await withEnv(
        {
          GOODMEMORY_HOME: home.root,
        },
        async () => {
          const install = await runCLI([
            "install",
            "codex",
            "--user-id",
            "codex-user",
            "--json",
          ]);
          expect(install.exitCode).toBe(0);

          const first = await runCLI([
            "enable",
            "codex",
            "--workspace-id",
            "codex-workspace",
            "--workspace-root",
            workspace.root,
            "--json",
          ]);
          expect(first.exitCode).toBe(0);
          const firstPayload = JSON.parse(first.stdout) as {
            changes: Array<{
              action: "created" | "unchanged" | "updated";
              relativePath: string;
            }>;
            host: string;
            workspaceId: string;
          };
          expect(firstPayload.host).toBe("codex");
          expect(firstPayload.workspaceId).toBe("codex-workspace");
          expect(
            firstPayload.changes.map(({ action, relativePath }) => ({
              action,
              relativePath,
            })),
          ).toEqual([
            { action: "created", relativePath: ".goodmemory/codex.json" },
            { action: "updated", relativePath: "AGENTS.md" },
          ]);

          const firstConfig = JSON.parse(
            await readFile(join(workspace.root, ".goodmemory/codex.json"), "utf8"),
          ) as {
            enabled: boolean;
            workspaceId: string;
          };
          expect(firstConfig.enabled).toBe(true);
          expect(firstConfig.workspaceId).toBe("codex-workspace");
          expect(await readFile(join(workspace.root, "AGENTS.md"), "utf8")).toContain(
            "GOODMEMORY-INSTALL:CODEX START",
          );

          const second = await runCLI([
            "enable",
            "codex",
            "--workspace-id",
            "codex-workspace",
            "--workspace-root",
            workspace.root,
            "--json",
          ]);
          expect(second.exitCode).toBe(0);
          const secondPayload = JSON.parse(second.stdout) as {
            changes: Array<{
              action: "created" | "unchanged" | "updated";
              relativePath: string;
            }>;
          };
          expect(
            secondPayload.changes.map(({ action, relativePath }) => ({
              action,
              relativePath,
            })),
          ).toEqual([
            { action: "unchanged", relativePath: ".goodmemory/codex.json" },
            { action: "unchanged", relativePath: "AGENTS.md" },
          ]);

          const disable = await runCLI([
            "disable",
            "codex",
            "--workspace-root",
            workspace.root,
            "--json",
          ]);
          expect(disable.exitCode).toBe(0);
          const disablePayload = JSON.parse(disable.stdout) as {
            changes: Array<{
              action: "deleted" | "unchanged" | "updated";
              relativePath: string;
            }>;
          };
          expect(
            disablePayload.changes.map(({ action, relativePath }) => ({
              action,
              relativePath,
            })),
          ).toEqual([
            { action: "updated", relativePath: ".goodmemory/codex.json" },
            { action: "updated", relativePath: "AGENTS.md" },
          ]);
          const disabledConfig = JSON.parse(
            await readFile(join(workspace.root, ".goodmemory/codex.json"), "utf8"),
          ) as {
            enabled: boolean;
            workspaceId: string;
          };
          expect(disabledConfig.enabled).toBe(false);
          expect(disabledConfig.workspaceId).toBe("codex-workspace");
          expect(await readFile(join(workspace.root, "AGENTS.md"), "utf8")).toBe(
            originalInstructions,
          );
        },
      );
    } finally {
      await home.cleanup();
      await workspace.cleanup();
    }
  });

  it("can opt a Codex workspace into observe writeback during enable", async () => {
    const home = await createTempWorkspace("goodmemory-codex-enable-writeback-home");
    const workspace = await createTempWorkspace("goodmemory-codex-enable-writeback");

    try {
      await withEnv(
        {
          GOODMEMORY_HOME: home.root,
        },
        async () => {
          const install = await runCLI([
            "install",
            "codex",
            "--user-id",
            "codex-user",
            "--json",
          ]);
          expect(install.exitCode).toBe(0);

          const enabled = await runCLI([
            "enable",
            "codex",
            "--workspace-root",
            workspace.root,
            "--writeback",
            "observe",
            "--json",
          ]);
          expect(enabled.exitCode).toBe(0);
          const payload = JSON.parse(enabled.stdout) as {
            writeback: { mode: string };
          };
          expect(payload.writeback.mode).toBe("observe");

          const config = JSON.parse(
            await readFile(join(home.root, ".goodmemory/codex.json"), "utf8"),
          ) as {
            writeback: { mode: string };
          };
          expect(config.writeback.mode).toBe("observe");
        },
      );
    } finally {
      await home.cleanup();
      await workspace.cleanup();
    }
  });

  it("surfaces review writeback mode as an inspector approval queue", async () => {
    const home = await createTempWorkspace("goodmemory-codex-enable-review-home");
    const workspace = await createTempWorkspace("goodmemory-codex-enable-review");

    try {
      await withEnv(
        {
          GOODMEMORY_HOME: home.root,
        },
        async () => {
          const install = await runCLI([
            "install",
            "codex",
            "--user-id",
            "codex-user",
            "--json",
          ]);
          expect(install.exitCode).toBe(0);

          const enabled = await runCLI([
            "enable",
            "codex",
            "--workspace-root",
            workspace.root,
            "--writeback",
            "review",
          ]);
          expect(enabled.exitCode).toBe(0);
          expect(enabled.stdout).toContain("writeback: review");
          expect(enabled.stdout).toContain("Inspector approval queue");
          expect(enabled.stdout).not.toContain("durable remember writeback");
        },
      );
    } finally {
      await home.cleanup();
      await workspace.cleanup();
    }
  });

  it("installs Claude global config and keeps disable/uninstall parity", async () => {
    const home = await createTempWorkspace("goodmemory-claude-install-home");
    const workspace = await createTempWorkspace("goodmemory-claude-enable");

    try {
      await withEnv(
        {
          GOODMEMORY_HOME: home.root,
        },
        async () => {
          const install = await runCLI([
            "install",
            "claude",
            "--user-id",
            "claude-user",
            "--json",
          ]);
          expect(install.exitCode).toBe(0);
          const installPayload = JSON.parse(install.stdout) as {
            changes: Array<{
              action: "created" | "unchanged" | "updated";
              relativePath: string;
            }>;
            host: string;
          };
          expect(installPayload.host).toBe("claude");
          expect(
            installPayload.changes.map(({ action, relativePath }) => ({
              action,
              relativePath,
            })),
          ).toEqual([
            {
              action: "created",
              relativePath: "claude.json",
            },
            {
              action: "created",
              relativePath: ".claude.json",
            },
            {
              action: "created",
              relativePath: ".claude/settings.json",
            },
          ]);
          expect(
            await readFile(join(home.root, ".claude/settings.json"), "utf8"),
          ).toContain("UserPromptSubmit");
        },
      );
      await withEnv(
        {
          GOODMEMORY_HOME: home.root,
        },
        async () => {
          const enable = await runCLI([
            "enable",
            "claude",
            "--workspace-root",
            workspace.root,
            "--json",
          ]);
          expect(enable.exitCode).toBe(0);
          const enablePayload = JSON.parse(enable.stdout) as {
            changes: Array<{
              action: "created" | "unchanged" | "updated";
              relativePath: string;
            }>;
            host: string;
          };
          expect(enablePayload.host).toBe("claude");
          expect(
            enablePayload.changes.map(({ action, relativePath }) => ({
              action,
              relativePath,
            })),
          ).toEqual([
            { action: "created", relativePath: ".goodmemory/claude.json" },
            { action: "created", relativePath: "CLAUDE.md" },
          ]);
          expect(await readFile(join(workspace.root, "CLAUDE.md"), "utf8")).toContain(
            "GOODMEMORY-INSTALL:CLAUDE START",
          );

          const disable = await runCLI([
            "disable",
            "claude",
            "--workspace-root",
            workspace.root,
            "--json",
          ]);
          expect(disable.exitCode).toBe(0);
          const disablePayload = JSON.parse(disable.stdout) as {
            changes: Array<{
              action: "deleted" | "unchanged" | "updated";
              relativePath: string;
            }>;
          };
          expect(
            disablePayload.changes.map(({ action, relativePath }) => ({
              action,
              relativePath,
            })),
          ).toEqual([
            { action: "updated", relativePath: ".goodmemory/claude.json" },
            { action: "deleted", relativePath: "CLAUDE.md" },
          ]);

          const uninstall = await runCLI(["uninstall", "claude", "--json"]);
          expect(uninstall.exitCode).toBe(0);
          const uninstallPayload = JSON.parse(uninstall.stdout) as {
            changes: Array<{
              action: "deleted" | "unchanged" | "updated";
              relativePath: string;
            }>;
          };
          expect(
            uninstallPayload.changes.map(({ action, relativePath }) => ({
              action,
              relativePath,
            })),
          ).toEqual([
            { action: "deleted", relativePath: "claude.json" },
            { action: "deleted", relativePath: ".claude/settings.json" },
            { action: "deleted", relativePath: ".claude.json" },
          ]);
        },
      );
    } finally {
      await home.cleanup();
      await workspace.cleanup();
    }
  });

  it("runs the Codex user-prompt-submit hook and emits additionalContext JSON", async () => {
    const home = await createTempWorkspace("goodmemory-codex-hook-home");
    const workspace = await createTempWorkspace("goodmemory-codex-hook-runtime");
    const cliScript = join(import.meta.dir, "../../scripts/goodmemory-cli.ts");

    try {
      await mkdir(join(home.root, ".goodmemory"), { recursive: true });
      await mkdir(join(workspace.root, ".goodmemory"), { recursive: true });
      await writeFile(
        join(home.root, ".goodmemory/codex.json"),
        JSON.stringify(
          {
            debug: false,
            host: "codex",
            maxTokens: 512,
            retrievalProfile: "coding_agent",
            storage: {
              path: join(home.root, ".goodmemory/memory.sqlite"),
              provider: "sqlite",
            },
            userId: "cli-user",
            version: 1,
          },
          null,
          2,
        ) + "\n",
        "utf8",
      );
      await writeFile(
        join(workspace.root, ".goodmemory/codex.json"),
        JSON.stringify(
          {
            enabled: true,
            host: "codex",
            version: 1,
            workspaceId: "workspace-a",
          },
          null,
          2,
        ) + "\n",
        "utf8",
      );
      await seedSQLiteMemory(join(home.root, ".goodmemory/memory.sqlite"));

      const result = await runBunScript({
        args: ["codex", "hook", "user-prompt-submit"],
        cwd: workspace.root,
        env: {
          GOODMEMORY_HOME: home.root,
        },
        scriptPath: cliScript,
        stdin: JSON.stringify({
          cwd: workspace.root,
          hook_event_name: "UserPromptSubmit",
          prompt: "Check the release runbook before editing files.",
          session_id: "hook-session-1",
          turn_id: "turn-hook-1",
        }),
      });

      expect(result.exitCode).toBe(0);
      expect(result.stderr.trim()).toBe("");
      const payload = JSON.parse(result.stdout) as {
        hookSpecificOutput: {
          additionalContext: string;
          hookEventName: string;
        };
      };
      expect(payload.hookSpecificOutput.hookEventName).toBe("UserPromptSubmit");
      expect(payload.hookSpecificOutput.additionalContext).toContain(
        "Developer memory notes",
      );
      expect(payload.hookSpecificOutput.additionalContext).toContain(
        "release quality program",
      );
    } finally {
      await home.cleanup();
      await workspace.cleanup();
    }
  });

  it("runs the Codex pre-tool-use hook and routes risky Bash commands to the installed action bridge", async () => {
    const home = await createTempWorkspace("goodmemory-codex-pretool-hook-home");
    const workspace = await createTempWorkspace("goodmemory-codex-pretool-hook-runtime");
    const cliScript = join(import.meta.dir, "../../scripts/goodmemory-cli.ts");

    try {
      await withEnv(
        {
          GOODMEMORY_HOME: home.root,
        },
        async () => {
          const install = await runCLI([
            "install",
            "codex",
            "--user-id",
            "cli-user",
            "--json",
          ]);
          expect(install.exitCode).toBe(0);

          const enable = await withCwd(workspace.root, async () =>
            runCLI([
              "enable",
              "codex",
              "--workspace-root",
              workspace.root,
              "--workspace-id",
              "workspace-a",
              "--json",
            ]),
          );
          expect(enable.exitCode).toBe(0);
        },
      );

      await seedCodexActionPolicyMemory({
        sqlitePath: join(home.root, ".goodmemory/memory.sqlite"),
        sessionId: "hook-session-1",
        userId: "cli-user",
        workspaceId: "workspace-a",
        rule: "Rather than DeepAnalyzer, use QuickCheck first.",
        evidenceExcerpt:
          "DeepAnalyzer detailed scan failed because QuickCheck had not run first.",
      });

      const result = await runBunScript({
        args: ["codex", "hook", "pre-tool-use"],
        cwd: workspace.root,
        env: {
          GOODMEMORY_HOME: home.root,
        },
        scriptPath: cliScript,
        stdin: JSON.stringify({
          cwd: workspace.root,
          hook_event_name: "PreToolUse",
          sequence: 3,
          session_id: "hook-session-1",
          tool_input: {
            command: "./tools/DeepAnalyzer --detailed",
          },
          tool_name: "Bash",
          turn_id: "turn-hook-1",
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
        "goodmemory codex action",
      );
      expect(payload.hookSpecificOutput.permissionDecisionReason).toContain(
        "--action-id",
      );
      expect(payload.hookSpecificOutput.permissionDecisionReason).toContain(
        "DeepAnalyzer --detailed",
      );
    } finally {
      await home.cleanup();
      await workspace.cleanup();
    }
  });

  it("runs the installed Codex action bridge, rewrites DeepAnalyzer, and records lineage in installed storage", async () => {
    const home = await createTempWorkspace("goodmemory-codex-installed-action-home");
    const workspace = await createTempWorkspace("goodmemory-codex-installed-action-runtime");
    const sqlitePath = join(home.root, ".goodmemory/memory.sqlite");
    const toolsDir = join(workspace.root, "tools");

    try {
      await withEnv(
        {
          GOODMEMORY_HOME: home.root,
        },
        async () => {
          const install = await runCLI([
            "install",
            "codex",
            "--user-id",
            "cli-user",
            "--json",
          ]);
          expect(install.exitCode).toBe(0);

          const enable = await withCwd(workspace.root, async () =>
            runCLI([
              "enable",
              "codex",
              "--workspace-root",
              workspace.root,
              "--workspace-id",
              "workspace-a",
              "--json",
            ]),
          );
          expect(enable.exitCode).toBe(0);
        },
      );

      const { memory, scope } = await seedCodexActionPolicyMemory({
        sqlitePath,
        sessionId: "action-session-1",
        userId: "cli-user",
        workspaceId: "workspace-a",
        rule: "Rather than DeepAnalyzer, use QuickCheck first.",
        evidenceExcerpt:
          "DeepAnalyzer detailed scan failed because QuickCheck had not run first.",
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
        join(toolsDir, "DeepAnalyzer"),
        [
          "#!/usr/bin/env sh",
          `echo deepanalyzer >> ${JSON.stringify(join(workspace.root, "deepanalyzer.log"))}`,
        ].join("\n"),
        "utf8",
      );
      await chmod(join(toolsDir, "DeepAnalyzer"), 0o755);

      const result = await withEnv(
        {
          GOODMEMORY_HOME: home.root,
        },
        async () =>
          withCwd(workspace.root, async () =>
            runCLI([
              "codex",
              "action",
              "--session-id",
              "action-session-1",
              "--turn-id",
              "turn-action-1",
              "--command",
              "./tools/DeepAnalyzer --detailed",
              "--json",
            ]),
          ),
      );

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
      const deepAnalyzerExecuted = await access(join(workspace.root, "deepanalyzer.log"))
        .then(() => true)
        .catch(() => false);
      expect(quickCheckExecuted).toBe(true);
      expect(deepAnalyzerExecuted).toBe(false);

      const exported = await memory.exportMemory({
        includeRuntime: true,
        scope: {
          ...scope,
          agentId: "codex",
        },
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
      await home.cleanup();
      await workspace.cleanup();
    }
  });

  it("preserves literal argv tokens passed after -- for installed Codex actions", async () => {
    const home = await createTempWorkspace("goodmemory-codex-installed-argv-home");
    const workspace = await createTempWorkspace("goodmemory-codex-installed-argv-runtime");
    const capturePath = join(workspace.root, "capture-argv.sh");
    const captureOutputPath = join(workspace.root, "captured-argv.txt");

    try {
      await withEnv(
        {
          GOODMEMORY_HOME: home.root,
        },
        async () => {
          const install = await runCLI([
            "install",
            "codex",
            "--user-id",
            "cli-user",
            "--json",
          ]);
          expect(install.exitCode).toBe(0);

          const enable = await withCwd(workspace.root, async () =>
            runCLI([
              "enable",
              "codex",
              "--workspace-root",
              workspace.root,
              "--workspace-id",
              "workspace-a",
              "--json",
            ]),
          );
          expect(enable.exitCode).toBe(0);
        },
      );

      await writeFile(
        capturePath,
        [
          "#!/usr/bin/env sh",
          `printf '%s\\n' \"$@\" > ${JSON.stringify(captureOutputPath)}`,
        ].join("\n"),
        "utf8",
      );
      await chmod(capturePath, 0o755);

      const result = await withEnv(
        {
          GOODMEMORY_HOME: home.root,
        },
        async () =>
          withCwd(workspace.root, async () =>
            runCLI([
              "codex",
              "action",
              "--session-id",
              "action-session-argv",
              "--",
              "./capture-argv.sh",
              "--flag",
              "two words",
              "semi;colon",
              "quote'and",
            ]),
          ),
      );

      expect(result.exitCode).toBe(0);
      const payload = JSON.parse(result.stdout) as {
        decision: string;
        executed: boolean;
        executedStep: string;
      };
      expect(payload.decision).toBe("allow");
      expect(payload.executed).toBe(true);
      expect(payload.executedStep).toContain("./capture-argv.sh");
      const captured = await readFile(captureOutputPath, "utf8");
      expect(captured.trim().split("\n")).toEqual([
        "--flag",
        "two words",
        "semi;colon",
        "quote'and",
      ]);
    } finally {
      await home.cleanup();
      await workspace.cleanup();
    }
  });

  it("blocks destructive installed Codex actions without executing the original command", async () => {
    const home = await createTempWorkspace("goodmemory-codex-installed-block-home");
    const workspace = await createTempWorkspace("goodmemory-codex-installed-block-runtime");

    try {
      await withEnv(
        {
          GOODMEMORY_HOME: home.root,
        },
        async () => {
          const install = await runCLI([
            "install",
            "codex",
            "--user-id",
            "cli-user",
            "--json",
          ]);
          expect(install.exitCode).toBe(0);

          const enable = await withCwd(workspace.root, async () =>
            runCLI([
              "enable",
              "codex",
              "--workspace-root",
              workspace.root,
              "--workspace-id",
              "workspace-a",
              "--json",
            ]),
          );
          expect(enable.exitCode).toBe(0);
        },
      );

      await seedCodexActionPolicyMemory({
        sqlitePath: join(home.root, ".goodmemory/memory.sqlite"),
        sessionId: "action-session-2",
        userId: "cli-user",
        workspaceId: "workspace-a",
        rule: "Never delete AGENTS.md from the host bootstrap surface.",
        why: "It breaks repo-local host wiring and package bootstrap continuity.",
        evidenceExcerpt:
          "Deleting AGENTS.md broke the repo-local host bootstrap surface.",
      });
      await writeFile(join(workspace.root, "AGENTS.md"), "# Keep me\n", "utf8");

      const result = await withEnv(
        {
          GOODMEMORY_HOME: home.root,
        },
        async () =>
          withCwd(workspace.root, async () =>
            runCLI([
              "codex",
              "action",
              "--session-id",
              "action-session-2",
              "--turn-id",
              "turn-action-2",
              "--command",
              "rm -rf AGENTS.md",
              "--json",
            ]),
          ),
      );

      expect(result.exitCode).toBe(2);
      const payload = JSON.parse(result.stdout) as {
        decision: string;
        executed: boolean;
        reason: string;
        rewritten: boolean;
      };
      expect(payload.decision).toBe("blocked");
      expect(payload.executed).toBe(false);
      expect(payload.rewritten).toBe(false);
      expect(payload.reason).toContain("Never delete AGENTS.md");
      expect(await readFile(join(workspace.root, "AGENTS.md"), "utf8")).toBe("# Keep me\n");
    } finally {
      await home.cleanup();
      await workspace.cleanup();
    }
  });

  it("runs the Codex writeback command in observe mode without writing memory", async () => {
    const home = await createTempWorkspace("goodmemory-codex-writeback-home");
    const workspace = await createTempWorkspace("goodmemory-codex-writeback-runtime");
    const cliScript = join(import.meta.dir, "../../scripts/goodmemory-cli.ts");

    try {
      await withEnv(
        {
          GOODMEMORY_HOME: home.root,
        },
        async () => {
          const install = await runCLI([
            "install",
            "codex",
            "--activation-mode",
            "global",
            "--user-id",
            "cli-user",
            "--json",
          ]);
          expect(install.exitCode).toBe(0);

          const result = await runBunScript({
            args: ["codex", "writeback", "--mode", "observe", "--json"],
            cwd: workspace.root,
            env: {
              GOODMEMORY_HOME: home.root,
            },
            scriptPath: cliScript,
            stdin: JSON.stringify({
              cwd: workspace.root,
              messages: [
                {
                  content: "Always run typecheck before closing Phase 37.",
                  role: "user",
                },
              ],
              session_id: "writeback-session-1",
            }),
          });

          expect(result.exitCode).toBe(0);
          const payload = JSON.parse(result.stdout) as {
            candidates: Array<{ content: string; durable: boolean; kind: string }>;
            reason: string;
            trace: { rawTranscriptPersisted: boolean };
            wrote: boolean;
          };
          expect(payload.reason).toBe("observed");
          expect(payload.wrote).toBe(false);
          expect(payload.trace.rawTranscriptPersisted).toBe(false);
          expect(payload.candidates).toEqual([
            expect.objectContaining({
              content: "Always run typecheck before closing Phase 37.",
              durable: true,
              kind: "preference",
            }),
          ]);
        },
      );
    } finally {
      await home.cleanup();
      await workspace.cleanup();
    }
  });

  it("exits nonzero for direct Codex writeback operational failures", async () => {
    const missingConfigHome = await createTempWorkspace(
      "goodmemory-codex-writeback-missing-config-home",
    );
    const missingRepoHome = await createTempWorkspace(
      "goodmemory-codex-writeback-missing-repo-home",
    );
    const writeFailureHome = await createTempWorkspace(
      "goodmemory-codex-writeback-failed-home",
    );
    const auditFailureHome = await createTempWorkspace(
      "goodmemory-codex-writeback-audit-failed-home",
    );
    const workspace = await createTempWorkspace(
      "goodmemory-codex-writeback-failures-workspace",
    );
    const cliScript = join(import.meta.dir, "../../scripts/goodmemory-cli.ts");
    const stdin = JSON.stringify({
      cwd: workspace.root,
      messages: [
        {
          content: "Always run typecheck before closing Phase 37.",
          role: "user",
        },
      ],
      session_id: "writeback-session-1",
    });

    try {
      const missingConfig = await runBunScript({
        args: ["codex", "writeback", "--json"],
        cwd: workspace.root,
        env: {
          GOODMEMORY_HOME: missingConfigHome.root,
        },
        scriptPath: cliScript,
        stdin,
      });
      expect(missingConfig.exitCode).toBe(1);
      expect((JSON.parse(missingConfig.stdout) as { reason: string }).reason).toBe(
        "missing_config",
      );

      await withEnv(
        {
          GOODMEMORY_HOME: missingRepoHome.root,
        },
        async () => {
          const install = await runCLI([
            "install",
            "codex",
            "--activation-mode",
            "workspace_opt_in",
            "--user-id",
            "cli-user",
            "--writeback",
            "selective",
            "--json",
          ]);
          expect(install.exitCode).toBe(0);
        },
      );
      const missingRepoOptIn = await runBunScript({
        args: ["codex", "writeback", "--json"],
        cwd: workspace.root,
        env: {
          GOODMEMORY_HOME: missingRepoHome.root,
        },
        scriptPath: cliScript,
        stdin,
      });
      expect(missingRepoOptIn.exitCode).toBe(1);
      expect(
        (JSON.parse(missingRepoOptIn.stdout) as { reason: string }).reason,
      ).toBe("missing_repo_opt_in");

      await withEnv(
        {
          GOODMEMORY_HOME: writeFailureHome.root,
        },
        async () => {
          const install = await runCLI([
            "install",
            "codex",
            "--activation-mode",
            "global",
            "--user-id",
            "cli-user",
            "--writeback",
            "selective",
            "--json",
          ]);
          expect(install.exitCode).toBe(0);
        },
      );
      await writeFile(
        join(writeFailureHome.root, ".goodmemory/codex-writeback-events.json"),
        JSON.stringify({ events: "bad-ledger" }, null, 2) + "\n",
        "utf8",
      );
      const writeFailed = await runBunScript({
        args: ["codex", "writeback", "--json"],
        cwd: workspace.root,
        env: {
          GOODMEMORY_HOME: writeFailureHome.root,
        },
        scriptPath: cliScript,
        stdin,
      });
      expect(writeFailed.exitCode).toBe(1);
      expect((JSON.parse(writeFailed.stdout) as { reason: string }).reason).toBe(
        "write_failed",
      );

      await withEnv(
        {
          GOODMEMORY_HOME: auditFailureHome.root,
        },
        async () => {
          const install = await runCLI([
            "install",
            "codex",
            "--activation-mode",
            "global",
            "--user-id",
            "cli-user",
            "--writeback",
            "observe",
            "--json",
          ]);
          expect(install.exitCode).toBe(0);
        },
      );
      await writeFile(
        join(auditFailureHome.root, ".goodmemory/codex-writeback-events.json"),
        JSON.stringify({ events: "bad-ledger" }, null, 2) + "\n",
        "utf8",
      );
      const auditFailed = await runBunScript({
        args: ["codex", "writeback", "--json"],
        cwd: workspace.root,
        env: {
          GOODMEMORY_HOME: auditFailureHome.root,
        },
        scriptPath: cliScript,
        stdin,
      });
      expect(auditFailed.exitCode).toBe(1);
      expect((JSON.parse(auditFailed.stdout) as { reason: string }).reason).toBe(
        "audit_failed",
      );
    } finally {
      await missingConfigHome.cleanup();
      await missingRepoHome.cleanup();
      await writeFailureHome.cleanup();
      await auditFailureHome.cleanup();
      await workspace.cleanup();
    }
  }, 15_000);

  it("inspects and forgets installed-host writeback audit events for Codex and Claude", async () => {
    const cliScript = join(import.meta.dir, "../../scripts/goodmemory-cli.ts");

    for (const host of ["codex", "claude"] as const) {
      const home = await createTempWorkspace(`goodmemory-${host}-writeback-audit-home`);
      const workspace = await createTempWorkspace(
        `goodmemory-${host}-writeback-audit-workspace`,
      );

      try {
        await withEnv(
          {
            GOODMEMORY_HOME: home.root,
          },
          async () => {
            const install = await runCLI([
              "install",
              host,
              "--activation-mode",
              "global",
              "--user-id",
              "cli-user",
              "--writeback",
              "selective",
              "--json",
            ]);
            expect(install.exitCode).toBe(0);
          },
        );

        const writeback = await runBunScript({
          args: [host, "writeback", "--json"],
          cwd: workspace.root,
          env: {
            GOODMEMORY_HOME: home.root,
          },
          scriptPath: cliScript,
          stdin: JSON.stringify({
            cwd: workspace.root,
            messages: [
              {
                content: `Next step is to add Phase 37.1 ${host} CLI audit undo.`,
                role: "user",
              },
            ],
            session_id: `${host}-cli-audit-session-1`,
          }),
        });
        expect(writeback.exitCode).toBe(0);

        const inspect = await runBunScript({
          args: [host, "writeback", "inspect", "--json"],
          cwd: workspace.root,
          env: {
            GOODMEMORY_HOME: home.root,
          },
          scriptPath: cliScript,
        });
        expect(inspect.exitCode).toBe(0);
        const inspectPayload = JSON.parse(inspect.stdout) as {
          events: Array<{
            contentPreview: string;
            eventId: string;
            linkedRecordIds: Array<{ id: string; type: string }>;
            memoryExistsCount: number;
            memoryIds: string[];
            status: string;
          }>;
        };
        expect(inspectPayload.events[0]).toEqual(
          expect.objectContaining({
            contentPreview: expect.stringContaining(
              `Phase 37.1 ${host} CLI audit undo`,
            ),
            linkedRecordIds: expect.arrayContaining([
              expect.objectContaining({ type: "memory" }),
              expect.objectContaining({ type: "evidence" }),
            ]),
            memoryExistsCount: 1,
            status: "committed",
          }),
        );

        const forget = await runBunScript({
          args: [
            host,
            "writeback",
            "forget",
            "--event-id",
            inspectPayload.events[0]!.eventId,
            "--review-outcome",
            "false_write",
            "--review-reason",
            "api_key=sk-cli-review-secret-value",
            "--json",
          ],
          cwd: workspace.root,
          env: {
            GOODMEMORY_HOME: home.root,
          },
          scriptPath: cliScript,
        });
        expect(forget.exitCode).toBe(0);
        const forgetPayload = JSON.parse(forget.stdout) as {
          forgottenLinkedRecordIds: Array<{ id: string; type: string }>;
          forgottenMemoryIds: string[];
          review?: { outcome: string; reason?: string };
          status: string;
        };
        expect(forgetPayload.forgottenLinkedRecordIds).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ type: "memory" }),
            expect.objectContaining({ type: "evidence" }),
          ]),
        );
        expect(forgetPayload.forgottenMemoryIds.length).toBeGreaterThan(0);
        expect(forgetPayload.review).toEqual({
          outcome: "false_write",
          reason: "[redacted secret-like content]",
        });
        expect(forget.stdout).not.toContain("sk-cli-review-secret-value");
        expect(forgetPayload.status).toBe("forgotten");
      } finally {
        await home.cleanup();
        await workspace.cleanup();
      }
    }
  }, 15_000);

  it("runs the Claude session-start hook fail-open with a debug systemMessage when the repo is disabled", async () => {
    const home = await createTempWorkspace("goodmemory-claude-hook-home");
    const workspace = await createTempWorkspace("goodmemory-claude-hook-runtime");
    const cliScript = join(import.meta.dir, "../../scripts/goodmemory-cli.ts");

    try {
      await mkdir(join(home.root, ".goodmemory"), { recursive: true });
      await mkdir(join(workspace.root, ".goodmemory"), { recursive: true });
      await writeFile(
        join(home.root, ".goodmemory/claude.json"),
        JSON.stringify(
          {
            debug: true,
            host: "claude",
            maxTokens: 128,
            retrievalProfile: "coding_agent",
            storage: {
              path: join(home.root, ".goodmemory/memory.sqlite"),
              provider: "sqlite",
            },
            userId: "cli-user",
            version: 1,
          },
          null,
          2,
        ) + "\n",
        "utf8",
      );
      await writeFile(
        join(workspace.root, ".goodmemory/claude.json"),
        JSON.stringify(
          {
            debug: true,
            enabled: false,
            host: "claude",
            version: 1,
            workspaceId: "workspace-a",
          },
          null,
          2,
        ) + "\n",
        "utf8",
      );

      const result = await runBunScript({
        args: ["claude", "hook", "session-start"],
        cwd: workspace.root,
        env: {
          GOODMEMORY_HOME: home.root,
        },
        scriptPath: cliScript,
        stdin: JSON.stringify({
          cwd: workspace.root,
          hook_event_name: "SessionStart",
          session_id: "hook-session-2",
          source: "startup",
        }),
      });

      expect(result.exitCode).toBe(0);
      expect(result.stderr.trim()).toBe("");
      const payload = JSON.parse(result.stdout) as { systemMessage: string };
      expect(payload.systemMessage).toBe(
        "GoodMemory claude session-start hook skipped: disabled.",
      );
    } finally {
      await home.cleanup();
      await workspace.cleanup();
    }
  });

  it("fails open when hook stdin is malformed JSON", async () => {
    const workspace = await createTempWorkspace("goodmemory-hook-invalid-stdin");
    const cliScript = join(import.meta.dir, "../../scripts/goodmemory-cli.ts");

    try {
      const result = await runBunScript({
        args: ["codex", "hook", "session-start"],
        cwd: workspace.root,
        scriptPath: cliScript,
        stdin: "{invalid",
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe("{}");
      expect(result.stderr.trim()).toBe("");
    } finally {
      await workspace.cleanup();
    }
  });

  it("fails open when hook stdin is empty", async () => {
    const workspace = await createTempWorkspace("goodmemory-hook-empty-stdin");
    const cliScript = join(import.meta.dir, "../../scripts/goodmemory-cli.ts");

    try {
      const result = await runBunScript({
        args: ["codex", "hook", "session-start"],
        cwd: workspace.root,
        scriptPath: cliScript,
        stdin: "",
      });

      expect(result.exitCode).toBe(0);
      expect(result.stdout.trim()).toBe("{}");
      expect(result.stderr.trim()).toBe("");
    } finally {
      await workspace.cleanup();
    }
  });
});
