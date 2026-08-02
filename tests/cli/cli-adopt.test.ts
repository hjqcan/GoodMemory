import { describe, expect, it } from "bun:test";

import { runCLI } from "../../src/cli";
import { createTempWorkspace } from "../../src/testing/utils";

async function withEnv<T>(
  overrides: Record<string, string | undefined>,
  callback: () => Promise<T>,
): Promise<T> {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  try {
    return await callback();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

interface AdoptPlan {
  environment: {
    codexCliAvailable: boolean;
    claudeCliAvailable: boolean;
    installedHosts: Array<{
      host: string;
      hookRegistered: boolean;
      mcpRegistered: boolean;
      wired: boolean;
    }>;
  };
  recommended: {
    path: string;
    alreadyWired: boolean;
    command: string;
    next: string[];
  };
  paths: Array<{ method: string; audience: string }>;
  resources: { llmsTxt: string; capabilityDescriptor: string };
}

describe("goodmemory adopt", () => {
  it("recommends the standalone MCP path when no host CLI is present", async () => {
    const home = await createTempWorkspace("goodmemory-adopt-none");
    try {
      await withEnv({ GOODMEMORY_HOME: home.root }, async () => {
        const result = await runCLI(["adopt", "--json"], {
          commandAvailable: async () => false,
        });
        expect(result.exitCode).toBe(0);
        const plan = JSON.parse(result.stdout) as AdoptPlan;
        expect(plan.environment.codexCliAvailable).toBe(false);
        expect(plan.environment.claudeCliAvailable).toBe(false);
        expect(plan.recommended.path).toBe("standalone-mcp");
        expect(plan.recommended.alreadyWired).toBe(false);
        expect(plan.recommended.command).toContain("goodmemory-mcp");
        expect(plan.paths.map((path) => path.method)).toEqual([
          "cli",
          "plugin",
          "mcp",
          "http",
        ]);
        expect(plan.resources.llmsTxt).toContain("llms.txt");
        expect(plan.resources.capabilityDescriptor).toContain(
          ".well-known/goodmemory.json",
        );
      });
    } finally {
      await home.cleanup();
    }
  });

  it("recommends installed-host setup when a host CLI is detected but not wired", async () => {
    const home = await createTempWorkspace("goodmemory-adopt-codex");
    try {
      await withEnv({ GOODMEMORY_HOME: home.root }, async () => {
        const result = await runCLI(["adopt", "--json"], {
          commandAvailable: async (command) => command === "codex",
        });
        const plan = JSON.parse(result.stdout) as AdoptPlan;
        expect(plan.environment.codexCliAvailable).toBe(true);
        expect(plan.environment.claudeCliAvailable).toBe(false);
        expect(plan.recommended.path).toBe("installed-host");
        expect(plan.recommended.alreadyWired).toBe(false);
        expect(plan.recommended.command).toContain("goodmemory setup");
        expect(plan.recommended.command).toContain("--host codex");
      });
    } finally {
      await home.cleanup();
    }
  });

  it("detects an already-wired host and points at status instead of setup", async () => {
    const home = await createTempWorkspace("goodmemory-adopt-wired");
    try {
      await withEnv({ GOODMEMORY_HOME: home.root }, async () => {
        const install = await runCLI([
          "install",
          "codex",
          "--user-id",
          "adopt-user",
          "--writeback",
          "off",
          "--json",
        ]);
        expect(install.exitCode).toBe(0);

        const result = await runCLI(["adopt", "--json"], {
          commandAvailable: async () => true,
        });
        const plan = JSON.parse(result.stdout) as AdoptPlan;
        const codex = plan.environment.installedHosts.find(
          (host) => host.host === "codex",
        );
        expect(codex?.wired).toBe(true);
        expect(plan.recommended.alreadyWired).toBe(true);
        expect(plan.recommended.command).toContain("goodmemory status");
      });
    } finally {
      await home.cleanup();
    }
  });

  it("respects an explicit --host override even without CLI detection", async () => {
    const home = await createTempWorkspace("goodmemory-adopt-forced");
    try {
      await withEnv({ GOODMEMORY_HOME: home.root }, async () => {
        const result = await runCLI(["adopt", "--host", "claude", "--json"], {
          commandAvailable: async () => false,
        });
        const plan = JSON.parse(result.stdout) as AdoptPlan;
        expect(plan.recommended.path).toBe("installed-host");
        expect(plan.recommended.command).toContain("--host claude");
      });
    } finally {
      await home.cleanup();
    }
  });

  it("does not let another wired host override an explicit --host target", async () => {
    const home = await createTempWorkspace("goodmemory-adopt-forced-unwired");
    try {
      await withEnv({ GOODMEMORY_HOME: home.root }, async () => {
        const install = await runCLI([
          "install",
          "codex",
          "--user-id",
          "adopt-user",
          "--writeback",
          "off",
          "--json",
        ]);
        expect(install.exitCode).toBe(0);

        const result = await runCLI(["adopt", "--host", "claude", "--json"], {
          commandAvailable: async () => false,
        });
        const plan = JSON.parse(result.stdout) as AdoptPlan;
        expect(plan.recommended.alreadyWired).toBe(false);
        expect(plan.recommended.command).toBe("goodmemory setup --host claude");
        expect(plan.recommended.next).toContain("goodmemory setup --host claude");
      });
    } finally {
      await home.cleanup();
    }
  });

  it("prints human-readable guidance without --json", async () => {
    const home = await createTempWorkspace("goodmemory-adopt-text");
    try {
      await withEnv({ GOODMEMORY_HOME: home.root }, async () => {
        const result = await runCLI(["adopt"], {
          commandAvailable: async () => false,
        });
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain("goodmemory-mcp");
        expect(result.stdout.toLowerCase()).toContain("recommended");
      });
    } finally {
      await home.cleanup();
    }
  });

  it("documents adopt in help output", async () => {
    const adoptHelp = await runCLI(["adopt", "--help"]);
    expect(adoptHelp.exitCode).toBe(0);
    expect(adoptHelp.stdout).toContain("adopt");
    expect(adoptHelp.stdout.toLowerCase()).toContain("detect");

    const rootHelp = await runCLI(["--help"]);
    expect(rootHelp.stdout).toContain("adopt");
  });
});
