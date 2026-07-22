import { describe, expect, it } from "bun:test";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  disableHostWorkspace,
  enableHostWorkspace,
  installHost,
  uninstallHost,
} from "../../src/install/hostInstall";

async function createWorkspace(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

describe("host install", () => {
  it("persists and canonicalizes the installed host default locale", async () => {
    const homeRoot = await createWorkspace("goodmemory-host-install-locale-");

    try {
      const installed = await installHost({
        homeRoot,
        host: "codex",
        language: { defaultLocale: "zh-tw" },
      });
      const config = JSON.parse(
        await readFile(join(homeRoot, ".goodmemory/codex.json"), "utf8"),
      ) as { language?: { defaultLocale?: string } };

      expect(installed.language).toEqual({ defaultLocale: "zh-TW" });
      expect(config.language).toEqual({ defaultLocale: "zh-TW" });
    } finally {
      await rm(homeRoot, { force: true, recursive: true });
    }
  });

  it("rejects an invalid installed host default locale before writing config", async () => {
    const homeRoot = await createWorkspace("goodmemory-host-install-invalid-locale-");

    try {
      await expect(
        installHost({
          homeRoot,
          host: "codex",
          language: { defaultLocale: "not_a_locale" },
        }),
      ).rejects.toThrow("default locale");
      await expect(
        readFile(join(homeRoot, ".goodmemory/codex.json"), "utf8"),
      ).rejects.toThrow();
    } finally {
      await rm(homeRoot, { force: true, recursive: true });
    }
  });
  it("fails closed when the existing global managed config is not valid JSON", async () => {
    const homeRoot = await createWorkspace("goodmemory-host-install-invalid-");

    try {
      await mkdir(join(homeRoot, ".goodmemory"), { recursive: true });
      await writeFile(join(homeRoot, ".goodmemory/codex.json"), "{ invalid", "utf8");

      await expect(
        installHost({
          homeRoot,
          host: "codex",
        }),
      ).rejects.toThrow(
        "Refusing to overwrite existing codex.json: file is not valid JSON.",
      );
    } finally {
      await rm(homeRoot, { force: true, recursive: true });
    }
  });

  it("rejects enable when the global managed config is not runnable by the hook runtime", async () => {
    const homeRoot = await createWorkspace("goodmemory-host-enable-invalid-home-");
    const workspaceRoot = await createWorkspace("goodmemory-host-enable-invalid-workspace-");

    try {
      await mkdir(join(homeRoot, ".goodmemory"), { recursive: true });
      await writeFile(
        join(homeRoot, ".goodmemory/codex.json"),
        JSON.stringify(
          {
            host: "codex",
            version: 1,
          },
          null,
          2,
        ) + "\n",
        "utf8",
      );

      await expect(
        enableHostWorkspace({
          homeRoot,
          host: "codex",
          workspaceRoot,
        }),
      ).rejects.toThrow(
        "Refusing to overwrite existing codex.json: storage.provider must be memory, sqlite, or postgres.",
      );
    } finally {
      await rm(homeRoot, { force: true, recursive: true });
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("repairs invalid runtime fields when reinstalling the managed global config", async () => {
    const homeRoot = await createWorkspace("goodmemory-host-install-repair-");
    const existingMemoryPath = resolve(homeRoot, "custom-memory.sqlite");

    try {
      await mkdir(join(homeRoot, ".goodmemory"), { recursive: true });
      await writeFile(
        join(homeRoot, ".goodmemory/codex.json"),
        JSON.stringify(
          {
            debug: true,
            host: "codex",
            maxTokens: -1,
            retrievalProfile: "coding_agent",
            storage: {
              path: existingMemoryPath,
              provider: "sqlite",
            },
            userId: "preserved-user",
            version: 1,
          },
          null,
          2,
        ) + "\n",
        "utf8",
      );

      const reinstalled = await installHost({
        homeRoot,
        host: "codex",
      });
      const config = JSON.parse(
        await readFile(join(homeRoot, ".goodmemory/codex.json"), "utf8"),
      ) as {
        activationMode: string;
        debug: boolean;
        maxTokens: number;
        retrievalProfile: string;
        storage: { path: string; provider: string };
        userId: string;
        writeback: {
          mode: string;
          persistRawTranscript: boolean;
        };
      };

      expect(reinstalled.memoryPath).toBe(existingMemoryPath);
      expect(reinstalled.activationMode).toBe("workspace_opt_in");
      expect(reinstalled.writeback.mode).toBe("off");
      expect(reinstalled.userId).toBe("preserved-user");
      expect(config.activationMode).toBe("workspace_opt_in");
      expect(config.writeback).toMatchObject({
        mode: "off",
        persistRawTranscript: false,
      });
      expect(config.debug).toBe(true);
      expect(config.maxTokens).toBe(256);
      expect(config.retrievalProfile).toBe("coding_agent");
      expect(config.storage).toEqual({
        path: existingMemoryPath,
        provider: "sqlite",
      });
      expect(config.userId).toBe("preserved-user");
    } finally {
      await rm(homeRoot, { force: true, recursive: true });
    }
  });

  it("rejects invalid global contextMode instead of normalizing it during reinstall", async () => {
    const homeRoot = await createWorkspace("goodmemory-host-install-context-mode-");

    try {
      await mkdir(join(homeRoot, ".goodmemory"), { recursive: true });
      await writeFile(
        join(homeRoot, ".goodmemory/codex.json"),
        JSON.stringify(
          {
            contextMode: "always-progressive",
            host: "codex",
            storage: {
              path: join(homeRoot, ".goodmemory/memory.sqlite"),
              provider: "sqlite",
            },
            userId: "host-user",
            version: 1,
          },
          null,
          2,
        ) + "\n",
        "utf8",
      );

      await expect(
        installHost({
          homeRoot,
          host: "codex",
        }),
      ).rejects.toThrow(
        "Refusing to overwrite existing codex.json: contextMode must be fragment or progressive.",
      );
    } finally {
      await rm(homeRoot, { force: true, recursive: true });
    }
  });

  it("rejects invalid workspace contextMode instead of dropping it during enable", async () => {
    const homeRoot = await createWorkspace("goodmemory-host-enable-context-home-");
    const workspaceRoot = await createWorkspace("goodmemory-host-enable-context-workspace-");

    try {
      await mkdir(join(homeRoot, ".goodmemory"), { recursive: true });
      await mkdir(join(workspaceRoot, ".goodmemory"), { recursive: true });
      await writeFile(
        join(homeRoot, ".goodmemory/codex.json"),
        JSON.stringify(
          {
            host: "codex",
            storage: {
              path: join(homeRoot, ".goodmemory/memory.sqlite"),
              provider: "sqlite",
            },
            userId: "host-user",
            version: 1,
          },
          null,
          2,
        ) + "\n",
        "utf8",
      );
      await writeFile(
        join(workspaceRoot, ".goodmemory/codex.json"),
        JSON.stringify(
          {
            contextMode: "bad",
            enabled: true,
            host: "codex",
            version: 1,
            workspaceId: "workspace-context",
          },
          null,
          2,
        ) + "\n",
        "utf8",
      );

      await expect(
        enableHostWorkspace({
          homeRoot,
          host: "codex",
          workspaceRoot,
        }),
      ).rejects.toThrow(
        "Refusing to overwrite existing .goodmemory/codex.json: contextMode must be fragment or progressive.",
      );
    } finally {
      await rm(homeRoot, { force: true, recursive: true });
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("preserves existing global memory path and userId unless explicit install flags override them", async () => {
    const homeRoot = await createWorkspace("goodmemory-host-install-merge-");
    const existingMemoryPath = resolve(homeRoot, "custom-memory.sqlite");
    const overrideMemoryPath = resolve(homeRoot, "override-memory.sqlite");

    try {
      await mkdir(join(homeRoot, ".goodmemory"), { recursive: true });
      await writeFile(
        join(homeRoot, ".goodmemory/codex.json"),
        JSON.stringify(
          {
            debug: true,
            host: "codex",
            maxTokens: 512,
            retrievalProfile: "coding_agent",
            storage: {
              path: existingMemoryPath,
              provider: "sqlite",
            },
            userId: "preserved-user",
            version: 1,
          },
          null,
          2,
        ) + "\n",
        "utf8",
      );

      const initial = await installHost({
        homeRoot,
        host: "codex",
      });
      const initialConfig = JSON.parse(
        await readFile(join(homeRoot, ".goodmemory/codex.json"), "utf8"),
      ) as {
        debug: boolean;
        maxTokens: number;
        storage: { path: string; provider: string };
        userId: string;
      };

      expect(initial.userId).toBe("preserved-user");
      expect(initial.memoryPath).toBe(existingMemoryPath);
      expect(initialConfig.userId).toBe("preserved-user");
      expect(initialConfig.storage.path).toBe(existingMemoryPath);
      expect(initialConfig.maxTokens).toBe(512);
      expect(initialConfig.debug).toBe(true);

      const overridden = await installHost({
        homeRoot,
        host: "codex",
        memoryPath: overrideMemoryPath,
        userId: "override-user",
      });
      const overriddenConfig = JSON.parse(
        await readFile(join(homeRoot, ".goodmemory/codex.json"), "utf8"),
      ) as {
        storage: { path: string; provider: string };
        userId: string;
      };

      expect(overridden.userId).toBe("override-user");
      expect(overridden.memoryPath).toBe(overrideMemoryPath);
      expect(overriddenConfig.userId).toBe("override-user");
      expect(overriddenConfig.storage.path).toBe(overrideMemoryPath);
    } finally {
      await rm(homeRoot, { force: true, recursive: true });
    }
  });

  it("writes the secret-bearing global config and install directory with private permissions", async () => {
    const homeRoot = await createWorkspace("goodmemory-host-install-private-config-");
    const installRoot = join(homeRoot, ".goodmemory");
    const configPath = join(installRoot, "codex.json");

    try {
      await mkdir(installRoot, { recursive: true });
      await chmod(installRoot, 0o755);
      await writeFile(
        configPath,
        JSON.stringify(
          {
            debug: false,
            host: "codex",
            maxTokens: 256,
            retrievalProfile: "coding_agent",
            storage: {
              path: join(installRoot, "memory.sqlite"),
              provider: "sqlite",
            },
            userId: "existing-user",
            version: 1,
          },
          null,
          2,
        ) + "\n",
        "utf8",
      );
      await chmod(configPath, 0o644);

      await installHost({
        embedding: {
          apiKey: "embedding-secret",
          model: "text-embedding-3-small",
          provider: "openai",
        },
        homeRoot,
        host: "codex",
        storageProvider: "postgres",
        storageUrl: "postgres://postgres:secret@localhost:5432/goodmemory",
      });

      expect((await stat(installRoot)).mode & 0o777).toBe(0o700);
      expect((await stat(configPath)).mode & 0o777).toBe(0o600);
    } finally {
      await rm(homeRoot, { force: true, recursive: true });
    }
  });

  it("rejects blank Postgres storage URLs before writing global config", async () => {
    const homeRoot = await createWorkspace("goodmemory-host-install-blank-postgres-");

    try {
      await expect(
        installHost({
          homeRoot,
          host: "codex",
          storageProvider: "postgres",
          storageUrl: " ",
        }),
      ).rejects.toThrow("Postgres installed-host storage requires --storage-url.");
      await expect(
        readFile(join(homeRoot, ".goodmemory/codex.json"), "utf8"),
      ).rejects.toThrow();
    } finally {
      await rm(homeRoot, { force: true, recursive: true });
    }
  });

  it("registers the managed Codex MCP server without disturbing existing config.toml sections", async () => {
    const homeRoot = await createWorkspace("goodmemory-host-install-codex-mcp-");

    try {
      await mkdir(join(homeRoot, ".codex"), { recursive: true });
      await writeFile(
        join(homeRoot, ".codex/config.toml"),
        [
          "[features]",
          "hooks = true",
          "",
          "[mcp_servers.context7]",
          'command = "npx"',
          'args = ["-y", "@upstash/context7-mcp"]',
          "",
        ].join("\n"),
        "utf8",
      );

      const installed = await installHost({
        homeRoot,
        host: "codex",
        userId: "codex-user",
      });
      const codexConfig = await readFile(
        join(homeRoot, ".codex/config.toml"),
        "utf8",
      );
      const hooksConfig = JSON.parse(
        await readFile(join(homeRoot, ".codex/hooks.json"), "utf8"),
      ) as {
        hooks: Record<
          string,
          Array<{ hooks: Array<{ command: string; type: string }>; matcher?: string }>
        >;
      };

      expect(installed.changes.map(({ action, relativePath }) => ({
        action,
        relativePath,
      }))).toEqual([
        { action: "created", relativePath: "codex.json" },
        { action: "updated", relativePath: ".codex/config.toml" },
        { action: "created", relativePath: ".codex/hooks.json" },
      ]);
      expect(codexConfig).toContain("[features]");
      expect(codexConfig).toContain("[mcp_servers.context7]");
      expect(codexConfig).toContain("[mcp_servers.goodmemory]");
      expect(codexConfig).toContain('command = "goodmemory-mcp"');
      expect(codexConfig).toContain('args = ["--host", "codex"]');
      expect(codexConfig).toContain(`GOODMEMORY_HOME = ${JSON.stringify(homeRoot)}`);
      expect(codexConfig).toContain('GOODMEMORY_MANAGED_BY = "goodmemory"');
      expect(hooksConfig.hooks.SessionStart).toEqual([
        {
          matcher: "startup|resume|clear|compact",
          hooks: [
            {
              command:
                `GOODMEMORY_HOME='${homeRoot}' GOODMEMORY_MANAGED_BY='goodmemory' goodmemory codex hook session-start`,
              type: "command",
            },
          ],
        },
      ]);
      expect(hooksConfig.hooks.PreToolUse).toEqual([
        {
          matcher: "Bash",
          hooks: [
            {
              command:
                `GOODMEMORY_HOME='${homeRoot}' GOODMEMORY_MANAGED_BY='goodmemory' goodmemory codex hook pre-tool-use`,
              type: "command",
            },
          ],
        },
      ]);
      expect(hooksConfig.hooks.UserPromptSubmit).toEqual([
        {
          hooks: [
            {
              command:
                `GOODMEMORY_HOME='${homeRoot}' GOODMEMORY_MANAGED_BY='goodmemory' goodmemory codex hook user-prompt-submit`,
              type: "command",
            },
          ],
        },
      ]);

      const uninstalled = await uninstallHost({
        homeRoot,
        host: "codex",
      });
      const codexConfigAfterUninstall = await readFile(
        join(homeRoot, ".codex/config.toml"),
        "utf8",
      );

      expect(uninstalled.changes.map(({ action, relativePath }) => ({
        action,
        relativePath,
      }))).toEqual([
        { action: "deleted", relativePath: "codex.json" },
        { action: "deleted", relativePath: ".codex/hooks.json" },
        { action: "updated", relativePath: ".codex/config.toml" },
      ]);
      expect(codexConfigAfterUninstall).toContain("[mcp_servers.context7]");
      expect(codexConfigAfterUninstall).not.toContain("[mcp_servers.goodmemory]");
      await expect(readFile(join(homeRoot, ".codex/hooks.json"), "utf8")).rejects.toThrow();
    } finally {
      await rm(homeRoot, { force: true, recursive: true });
    }
  });

  it("fails closed when the existing Codex MCP config uses an array table", async () => {
    const homeRoot = await createWorkspace("goodmemory-host-install-codex-mcp-invalid-");

    try {
      await mkdir(join(homeRoot, ".codex"), { recursive: true });
      await writeFile(
        join(homeRoot, ".codex/config.toml"),
        [
          "[[mcp_servers.goodmemory]]",
          'command = "custom-mcp"',
          "",
        ].join("\n"),
        "utf8",
      );

      await expect(
        installHost({
          homeRoot,
          host: "codex",
        }),
      ).rejects.toThrow(
        "Refusing to overwrite existing .codex/config.toml: `[[mcp_servers.goodmemory]]` is unsupported for managed MCP registration.",
      );
    } finally {
      await rm(homeRoot, { force: true, recursive: true });
    }
  });

  it("fails closed when a user-managed Codex MCP server already uses the goodmemory name", async () => {
    const homeRoot = await createWorkspace("goodmemory-host-install-codex-mcp-owned-");

    try {
      await mkdir(join(homeRoot, ".codex"), { recursive: true });
      await writeFile(
        join(homeRoot, ".codex/config.toml"),
        [
          "[mcp_servers.goodmemory]",
          'command = "custom-mcp"',
          'args = ["serve"]',
          "[mcp_servers.goodmemory.env]",
          'CUSTOM = "1"',
          "",
        ].join("\n"),
        "utf8",
      );

      await expect(
        installHost({
          homeRoot,
          host: "codex",
        }),
      ).rejects.toThrow(
        "Refusing to overwrite existing .codex/config.toml: `[mcp_servers.goodmemory]` already exists and is not managed by GoodMemory.",
      );
    } finally {
      await rm(homeRoot, { force: true, recursive: true });
    }
  });

  it("rolls back the main install config when MCP registration fails", async () => {
    const homeRoot = await createWorkspace("goodmemory-host-install-rollback-");

    try {
      await mkdir(join(homeRoot, ".codex"), { recursive: true });
      await writeFile(
        join(homeRoot, ".codex/config.toml"),
        [
          "[[mcp_servers.goodmemory]]",
          'command = "custom-mcp"',
          "",
        ].join("\n"),
        "utf8",
      );

      await expect(
        installHost({
          homeRoot,
          host: "codex",
          userId: "codex-user",
        }),
      ).rejects.toThrow(
        "Refusing to overwrite existing .codex/config.toml: `[[mcp_servers.goodmemory]]` is unsupported for managed MCP registration.",
      );
      await expect(
        readFile(join(homeRoot, ".goodmemory/codex.json"), "utf8"),
      ).rejects.toThrow();
    } finally {
      await rm(homeRoot, { force: true, recursive: true });
    }
  });

  it("rolls back the main install config when hook registration fails", async () => {
    const homeRoot = await createWorkspace("goodmemory-host-install-hook-rollback-");

    try {
      await mkdir(join(homeRoot, ".codex"), { recursive: true });
      await writeFile(join(homeRoot, ".codex/hooks.json"), "{ invalid", "utf8");
      await writeFile(
        join(homeRoot, ".codex/config.toml"),
        [
          "[features]",
          "experimental_feature = true",
          "",
        ].join("\n"),
        "utf8",
      );

      await expect(
        installHost({
          homeRoot,
          host: "codex",
          userId: "codex-user",
        }),
      ).rejects.toThrow(
        "Refusing to overwrite existing .codex/hooks.json: file is not valid JSON.",
      );
      await expect(
        readFile(join(homeRoot, ".goodmemory/codex.json"), "utf8"),
      ).rejects.toThrow();
      expect(
        await readFile(join(homeRoot, ".codex/config.toml"), "utf8"),
      ).not.toContain("[mcp_servers.goodmemory]");
      expect(await readFile(join(homeRoot, ".codex/hooks.json"), "utf8")).toBe("{ invalid");
    } finally {
      await rm(homeRoot, { force: true, recursive: true });
    }
  });

  it("registers and removes the managed Claude MCP server while preserving sibling settings", async () => {
    const homeRoot = await createWorkspace("goodmemory-host-install-claude-mcp-");

    try {
      await writeFile(
        join(homeRoot, ".claude.json"),
        JSON.stringify(
          {
            mcpServers: {
              github: {
                command: "npx",
                args: ["-y", "@modelcontextprotocol/server-github"],
              },
            },
            theme: "light",
          },
          null,
          2,
        ) + "\n",
        "utf8",
      );

      const installed = await installHost({
        homeRoot,
        host: "claude",
        userId: "claude-user",
      });
      const claudeConfig = JSON.parse(
        await readFile(join(homeRoot, ".claude.json"), "utf8"),
      ) as {
        mcpServers: Record<string, { args?: string[]; command: string; env?: Record<string, string> }>;
        theme: string;
      };
      const claudeSettings = JSON.parse(
        await readFile(join(homeRoot, ".claude/settings.json"), "utf8"),
      ) as {
        hooks: Record<
          string,
          Array<{ hooks: Array<{ command: string; type: string }>; matcher?: string }>
        >;
      };

      expect(installed.changes.map(({ action, relativePath }) => ({
        action,
        relativePath,
      }))).toEqual([
        { action: "created", relativePath: "claude.json" },
        { action: "updated", relativePath: ".claude.json" },
        { action: "created", relativePath: ".claude/settings.json" },
      ]);
      expect(claudeConfig.theme).toBe("light");
      expect(claudeConfig.mcpServers.github.command).toBe("npx");
      expect(claudeConfig.mcpServers.goodmemory).toEqual({
        args: ["--host", "claude"],
        command: "goodmemory-mcp",
        env: {
          GOODMEMORY_HOME: homeRoot,
          GOODMEMORY_MANAGED_BY: "goodmemory",
        },
      });
      expect(claudeSettings.hooks.SessionStart).toEqual([
        {
          matcher: "startup|resume|clear|compact",
          hooks: [
            {
              command:
                `GOODMEMORY_HOME='${homeRoot}' GOODMEMORY_MANAGED_BY='goodmemory' goodmemory claude hook session-start`,
              type: "command",
            },
          ],
        },
      ]);
      expect(claudeSettings.hooks.UserPromptSubmit).toEqual([
        {
          hooks: [
            {
              command:
                `GOODMEMORY_HOME='${homeRoot}' GOODMEMORY_MANAGED_BY='goodmemory' goodmemory claude hook user-prompt-submit`,
              type: "command",
            },
          ],
        },
      ]);

      const uninstalled = await uninstallHost({
        homeRoot,
        host: "claude",
      });
      const claudeConfigAfterUninstall = JSON.parse(
        await readFile(join(homeRoot, ".claude.json"), "utf8"),
      ) as {
        mcpServers: Record<
          string,
          {
            args?: string[];
            command: string;
          }
        >;
        theme: string;
      };

      expect(uninstalled.changes.map(({ action, relativePath }) => ({
        action,
        relativePath,
      }))).toEqual([
        { action: "deleted", relativePath: "claude.json" },
        { action: "deleted", relativePath: ".claude/settings.json" },
        { action: "updated", relativePath: ".claude.json" },
      ]);
      expect(claudeConfigAfterUninstall.theme).toBe("light");
      expect(claudeConfigAfterUninstall.mcpServers).toEqual({
        github: {
          args: ["-y", "@modelcontextprotocol/server-github"],
          command: "npx",
        },
      });
      await expect(readFile(join(homeRoot, ".claude/settings.json"), "utf8")).rejects.toThrow();
    } finally {
      await rm(homeRoot, { force: true, recursive: true });
    }
  });

  it("fails closed when a user-managed Claude MCP server already uses the goodmemory name", async () => {
    const homeRoot = await createWorkspace("goodmemory-host-install-claude-mcp-owned-");

    try {
      await writeFile(
        join(homeRoot, ".claude.json"),
        JSON.stringify(
          {
            mcpServers: {
              goodmemory: {
                args: ["serve"],
                command: "custom-mcp",
                env: {
                  CUSTOM: "1",
                },
              },
            },
            theme: "light",
          },
          null,
          2,
        ) + "\n",
        "utf8",
      );

      await expect(
        installHost({
          homeRoot,
          host: "claude",
        }),
      ).rejects.toThrow(
        "Refusing to overwrite existing .claude.json: `mcpServers.goodmemory` already exists and is not managed by GoodMemory.",
      );
    } finally {
      await rm(homeRoot, { force: true, recursive: true });
    }
  });

  it("restores the main uninstall config when MCP cleanup fails", async () => {
    const homeRoot = await createWorkspace("goodmemory-host-uninstall-rollback-");
    const configPath = join(homeRoot, ".goodmemory/codex.json");

    try {
      await mkdir(join(homeRoot, ".goodmemory"), { recursive: true });
      await mkdir(join(homeRoot, ".codex"), { recursive: true });
      await writeFile(
        configPath,
        JSON.stringify(
          {
            debug: false,
            host: "codex",
            maxTokens: 256,
            retrievalProfile: "coding_agent",
            storage: {
              path: join(homeRoot, ".goodmemory/memory.sqlite"),
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
        join(homeRoot, ".codex/config.toml"),
        [
          "[[mcp_servers.goodmemory]]",
          'command = "custom-mcp"',
          "",
        ].join("\n"),
        "utf8",
      );

      await expect(
        uninstallHost({
          homeRoot,
          host: "codex",
        }),
      ).rejects.toThrow(
        "Refusing to overwrite existing .codex/config.toml: `[[mcp_servers.goodmemory]]` is unsupported for managed MCP registration.",
      );
      expect(
        JSON.parse(await readFile(configPath, "utf8")),
      ).toMatchObject({
        host: "codex",
        userId: "codex-user",
      });
    } finally {
      await rm(homeRoot, { force: true, recursive: true });
    }
  });

  it("restores the main uninstall config when hook cleanup fails", async () => {
    const homeRoot = await createWorkspace("goodmemory-host-uninstall-hook-rollback-");
    const configPath = join(homeRoot, ".goodmemory/codex.json");

    try {
      await mkdir(join(homeRoot, ".goodmemory"), { recursive: true });
      await mkdir(join(homeRoot, ".codex"), { recursive: true });
      await writeFile(
        configPath,
        JSON.stringify(
          {
            debug: false,
            host: "codex",
            maxTokens: 256,
            retrievalProfile: "coding_agent",
            storage: {
              path: join(homeRoot, ".goodmemory/memory.sqlite"),
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
        join(homeRoot, ".codex/config.toml"),
        [
          "[features]",
          "hooks = true # goodmemory-managed-hooks",
          "",
          "[mcp_servers.goodmemory]",
          'command = "goodmemory-mcp"',
          'args = ["--host", "codex"]',
          "[mcp_servers.goodmemory.env]",
          `GOODMEMORY_HOME = ${JSON.stringify(homeRoot)}`,
          'GOODMEMORY_MANAGED_BY = "goodmemory"',
          "",
        ].join("\n"),
        "utf8",
      );
      await writeFile(join(homeRoot, ".codex/hooks.json"), "{ invalid", "utf8");

      await expect(
        uninstallHost({
          homeRoot,
          host: "codex",
        }),
      ).rejects.toThrow(
        "Refusing to overwrite existing .codex/hooks.json: file is not valid JSON.",
      );
      expect(
        JSON.parse(await readFile(configPath, "utf8")),
      ).toMatchObject({
        host: "codex",
        userId: "codex-user",
      });
      expect(
        await readFile(join(homeRoot, ".codex/config.toml"), "utf8"),
      ).toContain("[mcp_servers.goodmemory]");
    } finally {
      await rm(homeRoot, { force: true, recursive: true });
    }
  });

  it("still removes the managed MCP registration when the main install config is already missing", async () => {
    const homeRoot = await createWorkspace("goodmemory-host-uninstall-mcp-only-");

    try {
      await mkdir(join(homeRoot, ".codex"), { recursive: true });
      await writeFile(
        join(homeRoot, ".codex/config.toml"),
        [
          "[mcp_servers.goodmemory]",
          'command = "goodmemory-mcp"',
          'args = ["--host", "codex"]',
          "[mcp_servers.goodmemory.env]",
          `GOODMEMORY_HOME = ${JSON.stringify(homeRoot)}`,
          'GOODMEMORY_MANAGED_BY = "goodmemory"',
          "",
        ].join("\n"),
        "utf8",
      );

      const uninstalled = await uninstallHost({
        homeRoot,
        host: "codex",
      });

      expect(uninstalled.changes.map(({ action, relativePath }) => ({
        action,
        relativePath,
      }))).toEqual([
        { action: "unchanged", relativePath: "codex.json" },
        { action: "unchanged", relativePath: ".codex/hooks.json" },
        { action: "deleted", relativePath: ".codex/config.toml" },
      ]);
    } finally {
      await rm(homeRoot, { force: true, recursive: true });
    }
  });

  it("preserves a user-managed Codex MCP server during uninstall", async () => {
    const homeRoot = await createWorkspace("goodmemory-host-uninstall-codex-user-managed-");
    const configPath = join(homeRoot, ".goodmemory/codex.json");

    try {
      await mkdir(join(homeRoot, ".goodmemory"), { recursive: true });
      await mkdir(join(homeRoot, ".codex"), { recursive: true });
      await writeFile(
        configPath,
        JSON.stringify(
          {
            debug: false,
            host: "codex",
            maxTokens: 256,
            retrievalProfile: "coding_agent",
            storage: {
              path: join(homeRoot, ".goodmemory/memory.sqlite"),
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
        join(homeRoot, ".codex/config.toml"),
        [
          "[mcp_servers.goodmemory]",
          'command = "custom-mcp"',
          'args = ["serve"]',
          "[mcp_servers.goodmemory.env]",
          'CUSTOM = "1"',
          "",
        ].join("\n"),
        "utf8",
      );

      const uninstalled = await uninstallHost({
        homeRoot,
        host: "codex",
      });
      const codexConfig = await readFile(
        join(homeRoot, ".codex/config.toml"),
        "utf8",
      );

      expect(uninstalled.changes.map(({ action, relativePath }) => ({
        action,
        relativePath,
      }))).toEqual([
        { action: "deleted", relativePath: "codex.json" },
        { action: "unchanged", relativePath: ".codex/hooks.json" },
        { action: "unchanged", relativePath: ".codex/config.toml" },
      ]);
      expect(codexConfig).toContain('command = "custom-mcp"');
      await expect(readFile(configPath, "utf8")).rejects.toThrow();
    } finally {
      await rm(homeRoot, { force: true, recursive: true });
    }
  });

  it("preserves a user-managed Claude MCP server during uninstall", async () => {
    const homeRoot = await createWorkspace("goodmemory-host-uninstall-claude-user-managed-");
    const configPath = join(homeRoot, ".goodmemory/claude.json");

    try {
      await mkdir(join(homeRoot, ".goodmemory"), { recursive: true });
      await writeFile(
        configPath,
        JSON.stringify(
          {
            debug: false,
            host: "claude",
            maxTokens: 256,
            retrievalProfile: "coding_agent",
            storage: {
              path: join(homeRoot, ".goodmemory/memory.sqlite"),
              provider: "sqlite",
            },
            userId: "claude-user",
            version: 1,
          },
          null,
          2,
        ) + "\n",
        "utf8",
      );
      await writeFile(
        join(homeRoot, ".claude.json"),
        JSON.stringify(
          {
            mcpServers: {
              goodmemory: {
                args: ["serve"],
                command: "custom-mcp",
                env: {
                  CUSTOM: "1",
                },
              },
            },
            theme: "light",
          },
          null,
          2,
        ) + "\n",
        "utf8",
      );

      const uninstalled = await uninstallHost({
        homeRoot,
        host: "claude",
      });
      const claudeConfig = JSON.parse(
        await readFile(join(homeRoot, ".claude.json"), "utf8"),
      ) as {
        mcpServers: Record<
          string,
          {
            args?: string[];
            command: string;
            env?: Record<string, string>;
          }
        >;
        theme: string;
      };

      expect(uninstalled.changes.map(({ action, relativePath }) => ({
        action,
        relativePath,
      }))).toEqual([
        { action: "deleted", relativePath: "claude.json" },
        { action: "unchanged", relativePath: ".claude/settings.json" },
        { action: "unchanged", relativePath: ".claude.json" },
      ]);
      expect(claudeConfig).toEqual({
        mcpServers: {
          goodmemory: {
            args: ["serve"],
            command: "custom-mcp",
            env: {
              CUSTOM: "1",
            },
          },
        },
        theme: "light",
      });
      await expect(readFile(configPath, "utf8")).rejects.toThrow();
    } finally {
      await rm(homeRoot, { force: true, recursive: true });
    }
  });

  it("preserves Codex hook enablement for remaining user hooks during uninstall", async () => {
    const homeRoot = await createWorkspace("goodmemory-host-uninstall-codex-hooks-preserve-");

    try {
      await installHost({
        homeRoot,
        host: "codex",
        userId: "codex-user",
      });
      await writeFile(
        join(homeRoot, ".codex/hooks.json"),
        JSON.stringify(
          {
            hooks: {
              SessionStart: [
                {
                  matcher: "startup|resume|clear|compact",
                  hooks: [
                    {
                      type: "command",
                      command:
                        `GOODMEMORY_HOME='${homeRoot}' GOODMEMORY_MANAGED_BY='goodmemory' goodmemory codex hook session-start`,
                    },
                  ],
                },
                {
                  matcher: "startup|resume",
                  hooks: [
                    {
                      type: "command",
                      command: "echo keep-user-session-start-hook",
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
                      command:
                        `GOODMEMORY_HOME='${homeRoot}' GOODMEMORY_MANAGED_BY='goodmemory' goodmemory codex hook pre-tool-use`,
                    },
                  ],
                },
                {
                  matcher: "Bash",
                  hooks: [
                    {
                      type: "command",
                      command: "echo keep-user-pre-tool-hook",
                    },
                  ],
                },
              ],
              UserPromptSubmit: [
                {
                  hooks: [
                    {
                      type: "command",
                      command:
                        `GOODMEMORY_HOME='${homeRoot}' GOODMEMORY_MANAGED_BY='goodmemory' goodmemory codex hook user-prompt-submit`,
                    },
                  ],
                },
              ],
            },
          },
          null,
          2,
        ) + "\n",
        "utf8",
      );

      const uninstalled = await uninstallHost({
        homeRoot,
        host: "codex",
      });
      const codexConfig = await readFile(join(homeRoot, ".codex/config.toml"), "utf8");
      const hooksConfig = JSON.parse(
        await readFile(join(homeRoot, ".codex/hooks.json"), "utf8"),
      ) as {
        hooks: Record<
          string,
          Array<{ hooks: Array<{ command: string; type: string }>; matcher?: string }>
        >;
      };

      expect(uninstalled.changes.map(({ action, relativePath }) => ({
        action,
        relativePath,
      }))).toEqual([
        { action: "deleted", relativePath: "codex.json" },
        { action: "updated", relativePath: ".codex/hooks.json" },
        { action: "updated", relativePath: ".codex/config.toml" },
      ]);
      expect(codexConfig).toContain("hooks = true");
      expect(codexConfig).not.toContain("# goodmemory-managed-hooks");
      expect(codexConfig).not.toContain("[mcp_servers.goodmemory]");
      expect(hooksConfig.hooks.SessionStart).toEqual([
        {
          matcher: "startup|resume",
          hooks: [
            {
              type: "command",
              command: "echo keep-user-session-start-hook",
            },
          ],
        },
      ]);
      expect(hooksConfig.hooks.PreToolUse).toEqual([
        {
          matcher: "Bash",
          hooks: [
            {
              type: "command",
              command: "echo keep-user-pre-tool-hook",
            },
          ],
        },
      ]);
      expect(hooksConfig.hooks).not.toHaveProperty("UserPromptSubmit");
    } finally {
      await rm(homeRoot, { force: true, recursive: true });
    }
  });

  it("removes managed Codex hooks while preserving user-managed GoodMemory hook wrappers", async () => {
    const homeRoot = await createWorkspace("goodmemory-host-uninstall-codex-wrapper-");

    try {
      await installHost({
        homeRoot,
        host: "codex",
        userId: "codex-user",
      });
      await writeFile(
        join(homeRoot, ".codex/hooks.json"),
        JSON.stringify(
          {
            hooks: {
              SessionStart: [
                {
                  matcher: "startup|resume|clear|compact",
                  hooks: [
                    {
                      command:
                        `GOODMEMORY_HOME='${homeRoot}' GOODMEMORY_MANAGED_BY='goodmemory' goodmemory codex hook session-start`,
                      type: "command",
                    },
                  ],
                },
                {
                  hooks: [
                    {
                      command:
                        "env FOO=1 goodmemory codex hook session-start",
                      type: "command",
                    },
                  ],
                },
              ],
              PreToolUse: [
                {
                  matcher: "Bash",
                  hooks: [
                    {
                      command:
                        `GOODMEMORY_HOME='${homeRoot}' GOODMEMORY_MANAGED_BY='goodmemory' goodmemory codex hook pre-tool-use`,
                      type: "command",
                    },
                  ],
                },
                {
                  matcher: "Bash",
                  hooks: [
                    {
                      command:
                        "env FOO=1 goodmemory codex hook pre-tool-use",
                      type: "command",
                    },
                  ],
                },
              ],
              UserPromptSubmit: [
                {
                  hooks: [
                    {
                      command:
                        `GOODMEMORY_HOME='${homeRoot}' GOODMEMORY_MANAGED_BY='goodmemory' goodmemory codex hook user-prompt-submit`,
                      type: "command",
                    },
                  ],
                },
              ],
            },
          },
          null,
          2,
        ) + "\n",
        "utf8",
      );

      const uninstalled = await uninstallHost({
        homeRoot,
        host: "codex",
      });
      const hooksConfig = JSON.parse(
        await readFile(join(homeRoot, ".codex/hooks.json"), "utf8"),
      ) as {
        hooks: Record<
          string,
          Array<{ hooks: Array<{ command: string; type: string }>; matcher?: string }>
        >;
      };
      const codexConfig = await readFile(join(homeRoot, ".codex/config.toml"), "utf8");

      expect(uninstalled.changes.map(({ action, relativePath }) => ({
        action,
        relativePath,
      }))).toEqual([
        { action: "deleted", relativePath: "codex.json" },
        { action: "updated", relativePath: ".codex/hooks.json" },
        { action: "updated", relativePath: ".codex/config.toml" },
      ]);
      expect(hooksConfig.hooks.SessionStart).toEqual([
        {
          hooks: [
            {
              command: "env FOO=1 goodmemory codex hook session-start",
              type: "command",
            },
          ],
        },
      ]);
      expect(hooksConfig.hooks.PreToolUse).toEqual([
        {
          matcher: "Bash",
          hooks: [
            {
              command: "env FOO=1 goodmemory codex hook pre-tool-use",
              type: "command",
            },
          ],
        },
      ]);
      expect(hooksConfig.hooks).not.toHaveProperty("UserPromptSubmit");
      expect(codexConfig).toContain("hooks = true");
      expect(codexConfig).not.toContain("# goodmemory-managed-hooks");
    } finally {
      await rm(homeRoot, { force: true, recursive: true });
    }
  });

  it("enables and disables repo opt-in without losing existing workspace config", async () => {
    const homeRoot = await createWorkspace("goodmemory-host-enable-home-");
    const workspaceRoot = await createWorkspace("goodmemory-host-enable-");
    const originalInstructions = "\n# Existing Notes\n\n";

    try {
      await installHost({
        homeRoot,
        host: "codex",
        userId: "codex-user",
      });
      await mkdir(join(workspaceRoot, ".goodmemory"), { recursive: true });
      await writeFile(join(workspaceRoot, "AGENTS.md"), originalInstructions, "utf8");
      await writeFile(
        join(workspaceRoot, ".goodmemory/codex.json"),
        JSON.stringify(
          {
            customSetting: "keep-me",
            debug: true,
            enabled: false,
            host: "codex",
            maxTokens: -1,
            retrievalProfile: "broken",
            version: 1,
            workspaceId: "preserved-workspace",
          },
          null,
          2,
        ) + "\n",
        "utf8",
      );

      const enabled = await enableHostWorkspace({
        homeRoot,
        host: "codex",
        workspaceRoot,
      });
      const enabledConfig = JSON.parse(
        await readFile(join(workspaceRoot, ".goodmemory/codex.json"), "utf8"),
      ) as {
        customSetting: string;
        debug: boolean;
        enabled: boolean;
        maxTokens?: number;
        retrievalProfile?: string;
        workspaceId: string;
      };
      const enabledInstructions = await readFile(join(workspaceRoot, "AGENTS.md"), "utf8");

      expect(enabled.workspaceId).toBe("preserved-workspace");
      expect(enabledConfig.debug).toBe(true);
      expect(enabledConfig.enabled).toBe(true);
      expect(enabledConfig.workspaceId).toBe("preserved-workspace");
      expect(enabledConfig.customSetting).toBe("keep-me");
      expect(enabledConfig).not.toHaveProperty("maxTokens");
      expect(enabledConfig).not.toHaveProperty("retrievalProfile");
      expect(enabledInstructions).toContain("# Existing Notes");
      expect(enabledInstructions).toContain("GOODMEMORY-INSTALL:CODEX START");

      const disabled = await disableHostWorkspace({
        host: "codex",
        workspaceRoot,
      });
      const disabledConfig = JSON.parse(
        await readFile(join(workspaceRoot, ".goodmemory/codex.json"), "utf8"),
      ) as {
        customSetting: string;
        debug: boolean;
        enabled: boolean;
        maxTokens?: number;
        retrievalProfile?: string;
        workspaceId: string;
      };
      const disabledInstructions = await readFile(join(workspaceRoot, "AGENTS.md"), "utf8");

      expect(disabled.changes[0]?.action).toBe("updated");
      expect(disabledConfig.debug).toBe(true);
      expect(disabledConfig.enabled).toBe(false);
      expect(disabledConfig.workspaceId).toBe("preserved-workspace");
      expect(disabledConfig.customSetting).toBe("keep-me");
      expect(disabledConfig).not.toHaveProperty("maxTokens");
      expect(disabledConfig).not.toHaveProperty("retrievalProfile");
      expect(disabledInstructions).toBe(originalInstructions);
    } finally {
      await rm(homeRoot, { force: true, recursive: true });
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("keeps repeated enable idempotent when repo debug is unset", async () => {
    const homeRoot = await createWorkspace("goodmemory-host-enable-idempotent-home-");
    const workspaceRoot = await createWorkspace("goodmemory-host-enable-idempotent-workspace-");

    try {
      await installHost({
        homeRoot,
        host: "codex",
        userId: "codex-user",
      });

      await enableHostWorkspace({
        homeRoot,
        host: "codex",
        workspaceRoot,
      });
      const afterFirstEnable = await readFile(
        join(workspaceRoot, ".goodmemory/codex.json"),
        "utf8",
      );

      const secondEnable = await enableHostWorkspace({
        homeRoot,
        host: "codex",
        workspaceRoot,
      });
      const afterSecondEnable = await readFile(
        join(workspaceRoot, ".goodmemory/codex.json"),
        "utf8",
      );

      expect(secondEnable.changes.map(({ action, relativePath }) => ({
        action,
        relativePath,
      }))).toEqual([
        { action: "unchanged", relativePath: ".goodmemory/codex.json" },
        { action: "unchanged", relativePath: "AGENTS.md" },
      ]);
      expect(JSON.parse(afterFirstEnable)).not.toHaveProperty("debug");
      expect(afterSecondEnable).toBe(afterFirstEnable);
    } finally {
      await rm(homeRoot, { force: true, recursive: true });
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("treats disable on a pristine workspace as a no-op", async () => {
    const homeRoot = await createWorkspace("goodmemory-host-disable-pristine-home-");
    const workspaceRoot = await createWorkspace("goodmemory-host-disable-pristine-");

    try {
      const disabled = await disableHostWorkspace({
        homeRoot,
        host: "codex",
        workspaceRoot,
      });

      expect(disabled.changes.map(({ action, relativePath }) => ({ action, relativePath }))).toEqual([
        { action: "unchanged", relativePath: ".goodmemory/codex.json" },
        { action: "unchanged", relativePath: "AGENTS.md" },
      ]);
    } finally {
      await rm(homeRoot, { force: true, recursive: true });
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("writes a disabled workspace override when global activation is enabled", async () => {
    const homeRoot = await createWorkspace("goodmemory-host-disable-global-home-");
    const workspaceRoot = await createWorkspace("goodmemory-host-disable-global-workspace-");

    try {
      await installHost({
        activationMode: "global",
        homeRoot,
        host: "codex",
        userId: "codex-user",
        writeback: {
          allowAssistantOutput: "confirmed_or_verified",
          dryRun: false,
          maxChars: 12000,
          maxMessages: 12,
          minConfidence: 0.7,
          mode: "selective",
          persistRawTranscript: false,
        },
      });

      const disabled = await disableHostWorkspace({
        homeRoot,
        host: "codex",
        workspaceRoot,
      });
      const config = JSON.parse(
        await readFile(join(workspaceRoot, ".goodmemory/codex.json"), "utf8"),
      ) as {
        enabled: boolean;
        host: string;
        workspaceId: string;
      };

      expect(disabled.changes.map(({ action, relativePath }) => ({ action, relativePath }))).toEqual([
        { action: "created", relativePath: ".goodmemory/codex.json" },
        { action: "unchanged", relativePath: "AGENTS.md" },
      ]);
      expect(config.host).toBe("codex");
      expect(config.enabled).toBe(false);
      expect(config.workspaceId.length).toBeGreaterThan(0);
    } finally {
      await rm(homeRoot, { force: true, recursive: true });
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("fails closed when disabling a workspace with malformed repo config", async () => {
    const homeRoot = await createWorkspace("goodmemory-host-disable-invalid-home-");
    const workspaceRoot = await createWorkspace("goodmemory-host-disable-invalid-workspace-");

    try {
      await installHost({
        homeRoot,
        host: "codex",
        userId: "codex-user",
      });
      await mkdir(join(workspaceRoot, ".goodmemory"), { recursive: true });
      await writeFile(
        join(workspaceRoot, ".goodmemory/codex.json"),
        JSON.stringify(
          {
            enabled: "false",
            host: "codex",
            version: 1,
            workspaceId: "workspace-hook",
          },
          null,
          2,
        ) + "\n",
        "utf8",
      );

      await expect(
        disableHostWorkspace({
          homeRoot,
          host: "codex",
          workspaceRoot,
        }),
      ).rejects.toThrow("enabled must be a boolean.");
    } finally {
      await rm(homeRoot, { force: true, recursive: true });
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("fails closed when the managed instruction block is malformed", async () => {
    const homeRoot = await createWorkspace("goodmemory-host-marker-home-");
    const workspaceRoot = await createWorkspace("goodmemory-host-marker-workspace-");

    try {
      await installHost({
        homeRoot,
        host: "codex",
        userId: "codex-user",
      });
      await writeFile(
        join(workspaceRoot, "AGENTS.md"),
        [
          "# Existing Notes",
          "<!-- GOODMEMORY-INSTALL:CODEX START -->",
          "broken block",
        ].join("\n"),
        "utf8",
      );

      await expect(
        enableHostWorkspace({
          homeRoot,
          host: "codex",
          writebackMode: "selective",
          workspaceRoot,
        }),
      ).rejects.toThrow(
        "Refusing to overwrite existing AGENTS.md: the managed install block is malformed.",
      );

      const globalConfig = JSON.parse(
        await readFile(join(homeRoot, ".goodmemory/codex.json"), "utf8"),
      ) as {
        writeback: {
          mode: string;
        };
      };
      expect(globalConfig.writeback.mode).toBe("off");
      await expect(
        readFile(join(workspaceRoot, ".goodmemory/codex.json"), "utf8"),
      ).rejects.toThrow();
    } finally {
      await rm(homeRoot, { force: true, recursive: true });
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("fails closed when the managed instruction block markers are reversed", async () => {
    const homeRoot = await createWorkspace("goodmemory-host-marker-order-home-");
    const workspaceRoot = await createWorkspace("goodmemory-host-marker-order-workspace-");

    try {
      await installHost({
        homeRoot,
        host: "codex",
        userId: "codex-user",
      });
      await writeFile(
        join(workspaceRoot, "AGENTS.md"),
        [
          "# Existing Notes",
          "<!-- GOODMEMORY-INSTALL:CODEX END -->",
          "broken block",
          "<!-- GOODMEMORY-INSTALL:CODEX START -->",
        ].join("\n"),
        "utf8",
      );

      await expect(
        enableHostWorkspace({
          homeRoot,
          host: "codex",
          workspaceRoot,
        }),
      ).rejects.toThrow(
        "Refusing to overwrite existing AGENTS.md: the managed install block is malformed.",
      );
    } finally {
      await rm(homeRoot, { force: true, recursive: true });
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });
  it("opts fresh installs into bm25 retrieval and preserves existing retrieval settings", async () => {
    const homeRoot = await createWorkspace("goodmemory-host-install-retrieval-");
    const configPath = join(homeRoot, ".goodmemory/codex.json");

    try {
      await installHost({ homeRoot, host: "codex", userId: "retrieval-user" });
      const fresh = JSON.parse(await readFile(configPath, "utf8")) as {
        retrieval?: Record<string, unknown>;
      };
      // Fresh stores start on the measured BM25 hybrid tier (deterministic,
      // zero egress, no embedding needed).
      expect(fresh.retrieval).toEqual({ bm25Ranking: true });
      // Injection right-sizing defaults for new installs: a 1024-token
      // session-start brief, 512 per prompt behind the relevance gate.
      const freshFull = JSON.parse(await readFile(configPath, "utf8")) as {
        maxTokens?: number;
        promptInjection?: string;
        sessionStartMaxTokens?: number;
      };
      expect(freshFull.maxTokens).toBe(512);
      expect(freshFull.sessionStartMaxTokens).toBe(1024);
      expect(freshFull.promptInjection).toBe("relevance_gated");
      // Opportunistic maintenance (dedupe/quality/TTL — never consolidation)
      // is on for fresh stores, gated by the dream orchestrator's guards.
      const freshMaintenance = JSON.parse(await readFile(configPath, "utf8")) as {
        maintenance?: Record<string, unknown>;
      };
      expect(freshMaintenance.maintenance).toEqual({ auto: true });

      // Pre-upgrade configs (no retrieval section) must stay on the lexical
      // floor across reinstalls: absence is preserved, not upgraded.
      const { retrieval: _retrieval, ...withoutRetrieval } = JSON.parse(
        await readFile(configPath, "utf8"),
      ) as Record<string, unknown>;
      await writeFile(
        configPath,
        JSON.stringify(withoutRetrieval, null, 2) + "\n",
        "utf8",
      );
      await installHost({ homeRoot, host: "codex", userId: "retrieval-user" });
      const reinstalled = JSON.parse(await readFile(configPath, "utf8")) as {
        retrieval?: Record<string, unknown>;
      };
      expect("retrieval" in reinstalled).toBe(false);

      // Custom retrieval settings survive reinstall verbatim.
      const custom = JSON.parse(await readFile(configPath, "utf8")) as Record<
        string,
        unknown
      >;
      custom.retrieval = { bm25Ranking: false, semanticCandidates: { topK: 8 } };
      await writeFile(configPath, JSON.stringify(custom, null, 2) + "\n", "utf8");
      await installHost({ homeRoot, host: "codex", userId: "retrieval-user" });
      const preserved = JSON.parse(await readFile(configPath, "utf8")) as {
        retrieval?: Record<string, unknown>;
      };
      expect(preserved.retrieval).toEqual({
        bm25Ranking: false,
        semanticCandidates: { topK: 8 },
      });
    } finally {
      await rm(homeRoot, { force: true, recursive: true });
    }
  });
  it("writes a directive memory-protocol instruction block per host", async () => {
    const homeRoot = await createWorkspace("goodmemory-host-install-protocol-");
    const claudeWorkspace = await createWorkspace("goodmemory-protocol-claude-ws-");
    const codexWorkspace = await createWorkspace("goodmemory-protocol-codex-ws-");

    try {
      await installHost({ homeRoot, host: "claude", userId: "protocol-user" });
      await installHost({ homeRoot, host: "codex", userId: "protocol-user" });
      await enableHostWorkspace({
        homeRoot,
        host: "claude",
        workspaceRoot: claudeWorkspace,
      });
      await enableHostWorkspace({
        homeRoot,
        host: "codex",
        workspaceRoot: codexWorkspace,
      });

      const claudeBlock = await readFile(join(claudeWorkspace, "CLAUDE.md"), "utf8");
      expect(claudeBlock).toContain("<!-- GOODMEMORY-INSTALL:CLAUDE START -->");
      expect(claudeBlock).toContain("Memory protocol:");
      expect(claudeBlock).toContain("goodmemory_get_context");
      expect(claudeBlock).toContain("goodmemory_trace_recall");
      expect(claudeBlock).toContain("goodmemory_remember");
      // Claude-only: division of labor vs Claude Code native auto-memory.
      expect(claudeBlock).toContain("MEMORY.md");
      expect(claudeBlock).toContain("<!-- GOODMEMORY-INSTALL:CLAUDE END -->");

      const codexBlock = await readFile(join(codexWorkspace, "AGENTS.md"), "utf8");
      expect(codexBlock).toContain("Memory protocol:");
      expect(codexBlock).not.toContain("MEMORY.md");
    } finally {
      await rm(homeRoot, { force: true, recursive: true });
      await rm(claudeWorkspace, { force: true, recursive: true });
      await rm(codexWorkspace, { force: true, recursive: true });
    }
  });

  it("renders managed Codex instructions with the installed Traditional Chinese pack", async () => {
    const homeRoot = await createWorkspace("goodmemory-host-install-hant-");
    const workspaceRoot = await createWorkspace("goodmemory-host-install-hant-ws-");

    try {
      await installHost({
        homeRoot,
        host: "codex",
        language: { defaultLocale: "zh-TW" },
        userId: "hant-user",
      });
      await enableHostWorkspace({
        homeRoot,
        host: "codex",
        workspaceRoot,
      });

      const instructions = await readFile(join(workspaceRoot, "AGENTS.md"), "utf8");
      expect(instructions).toContain("<!-- GOODMEMORY-INSTALL:CODEX START -->");
      expect(instructions).toContain("此儲存庫使用 GoodMemory");
      expect(instructions).toContain("記憶協定：");
      expect(instructions).toContain("goodmemory_get_context");
      expect(instructions).toContain("goodmemory_search_index");
      expect(instructions).toContain("goodmemory_get_records");
      expect(instructions).toContain("goodmemory_trace_recall");
      expect(instructions).toContain("goodmemory_remember");
      expect(instructions).not.toContain("Memory protocol:");
      expect(instructions).toContain("<!-- GOODMEMORY-INSTALL:CODEX END -->");
    } finally {
      await rm(homeRoot, { force: true, recursive: true });
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("refreshes managed Claude instructions with the effective installed Japanese pack", async () => {
    const homeRoot = await createWorkspace("goodmemory-host-install-ja-");
    const workspaceRoot = await createWorkspace("goodmemory-host-install-ja-ws-");

    try {
      await installHost({
        homeRoot,
        host: "claude",
        userId: "ja-user",
      });
      await enableHostWorkspace({
        homeRoot,
        host: "claude",
        workspaceRoot,
      });
      await installHost({
        homeRoot,
        host: "claude",
        language: { defaultLocale: "ja-JP" },
        userId: "ja-user",
      });
      const refreshed = await enableHostWorkspace({
        homeRoot,
        host: "claude",
        workspaceRoot,
      });

      const instructions = await readFile(join(workspaceRoot, "CLAUDE.md"), "utf8");
      expect(refreshed.changes[1]?.action).toBe("updated");
      expect(instructions).toContain("<!-- GOODMEMORY-INSTALL:CLAUDE START -->");
      expect(instructions).toContain("このリポジトリは");
      expect(instructions).toContain("メモリプロトコル:");
      expect(instructions).toContain("goodmemory_get_context");
      expect(instructions).toContain("goodmemory_trace_recall");
      expect(instructions).toContain("goodmemory_remember");
      expect(instructions).toContain("MEMORY.md");
      expect(instructions).not.toContain("Memory protocol:");
      expect(instructions).toContain("<!-- GOODMEMORY-INSTALL:CLAUDE END -->");
    } finally {
      await rm(homeRoot, { force: true, recursive: true });
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("renders managed instructions through the Korean, French, and Spanish packs", async () => {
    const cases = [
      {
        intro: "이 저장소는",
        locale: "ko-KR",
        protocol: "메모리 프로토콜:",
      },
      {
        intro: "Ce dépôt utilise",
        locale: "fr-FR",
        protocol: "Protocole de mémoire :",
      },
      {
        intro: "Este repositorio usa",
        locale: "es-ES",
        protocol: "Protocolo de memoria:",
      },
    ] as const;

    for (const entry of cases) {
      const homeRoot = await createWorkspace("goodmemory-host-install-language-");
      const workspaceRoot = await createWorkspace(
        "goodmemory-host-install-language-ws-",
      );
      try {
        await installHost({
          homeRoot,
          host: "codex",
          language: { defaultLocale: entry.locale },
          userId: `user-${entry.locale}`,
        });
        await enableHostWorkspace({ homeRoot, host: "codex", workspaceRoot });

        const instructions = await readFile(
          join(workspaceRoot, "AGENTS.md"),
          "utf8",
        );
        expect(instructions).toContain(entry.intro);
        expect(instructions).toContain(entry.protocol);
        expect(instructions).not.toContain("Memory protocol:");
      } finally {
        await rm(homeRoot, { force: true, recursive: true });
        await rm(workspaceRoot, { force: true, recursive: true });
      }
    }
  });
});
