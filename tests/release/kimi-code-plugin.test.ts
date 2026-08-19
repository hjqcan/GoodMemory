import { describe, expect, it } from "bun:test";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "../..");
const RELEASE_VERSION = "0.7.5";
const KIMI_TOOLS = [
  "goodmemory_get_context",
  "goodmemory_inspect_memory",
  "goodmemory_trace_recall",
  "goodmemory_search_index",
  "goodmemory_timeline",
  "goodmemory_get_records",
  "goodmemory_read_artifacts",
  "goodmemory_stats",
  "goodmemory_remember",
] as const;

interface KimiMcpServer {
  args?: string[];
  command?: string;
  cwd?: string;
  enabledTools?: string[];
  env?: Record<string, string>;
  startupTimeoutMs?: number;
  toolTimeoutMs?: number;
}

interface KimiPluginManifest {
  commands?: string;
  hooks?: unknown;
  mcpServers?: Record<string, KimiMcpServer>;
  name?: string;
  permissions?: unknown;
  sessionStart?: { skill?: string };
  skills?: string;
  version?: string;
}

interface PackageManifest {
  version?: string;
}

interface CapabilityDescriptor {
  onboarding?: Array<Record<string, unknown>>;
  version?: string;
}

async function readText(path: string): Promise<string> {
  return readFile(join(REPO_ROOT, path), "utf8");
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readText(path)) as T;
}

describe("Kimi Code plugin release contract", () => {
  it("pins the plugin and MCP runtime to the 0.7.5 stable release identity", async () => {
    const [manifest, pkg] = await Promise.all([
      readJson<KimiPluginManifest>("kimi.plugin.json"),
      readJson<PackageManifest>("package.json"),
    ]);
    const server = manifest.mcpServers?.goodmemory;

    expect(pkg.version).toBe(RELEASE_VERSION);
    expect(manifest.name).toBe("goodmemory");
    expect(manifest.version).toBe(RELEASE_VERSION);
    expect(manifest.skills).toBe("./integrations/kimi-code/skills/");
    expect(manifest.sessionStart).toEqual({ skill: "using-goodmemory" });
    expect(manifest.commands).toBe("./integrations/kimi-code/commands/");
    expect(server).toEqual({
      args: [
        "-y",
        `goodmemory@${RELEASE_VERSION}`,
        "mcp",
        "serve",
        "--standalone",
        "--retrieval-profile",
        "coding_agent",
        "--allow-write",
      ],
      command: "npx",
      enabledTools: [...KIMI_TOOLS],
      env: { GOODMEMORY_USER_ID: "kimi-code" },
      startupTimeoutMs: 120_000,
      toolTimeoutMs: 60_000,
    });
    expect(server?.cwd).toBeUndefined();
    expect(server?.env?.GOODMEMORY_WORKSPACE_ID).toBeUndefined();
    expect(manifest.hooks).toBeUndefined();
    expect(manifest.permissions).toBeUndefined();
    expect(JSON.stringify(manifest)).not.toContain("mcp__*");
  });

  it("ships every declared plugin path and four scoped commands", async () => {
    const declaredPaths = [
      "integrations/kimi-code/skills",
      "integrations/kimi-code/commands",
    ];
    for (const path of declaredPaths) {
      expect((await stat(join(REPO_ROOT, path))).isDirectory()).toBe(true);
    }

    const [skill, status, recall, trace, remember] = await Promise.all([
      readText("integrations/kimi-code/skills/using-goodmemory/SKILL.md"),
      readText("integrations/kimi-code/commands/status.md"),
      readText("integrations/kimi-code/commands/recall.md"),
      readText("integrations/kimi-code/commands/trace.md"),
      readText("integrations/kimi-code/commands/remember.md"),
    ]);

    expect(skill).toContain("name: using-goodmemory");
    expect(skill).toContain("current project absolute path");
    expect(skill).toContain("goodmemory_get_context");
    expect(skill).toContain("goodmemory_trace_recall");
    expect(skill).toContain("goodmemory_remember");
    expect(skill).toContain('role: "user"');
    expect(skill).toContain('role: "assistant"');
    expect(skill).toContain("Never persist secrets");

    expect(status).toContain("goodmemory_stats");
    expect(recall).toContain("goodmemory_get_context");
    expect(recall).toContain("$ARGUMENTS");
    expect(trace).toContain("goodmemory_trace_recall");
    expect(trace).toContain("$ARGUMENTS");
    expect(remember).toContain("goodmemory_remember");
    expect(remember).toContain("$ARGUMENTS");
    expect(remember).toContain('role: "user"');

    for (const command of [status, recall, trace, remember]) {
      expect(command).toMatch(/current project\s+absolute path/u);
      expect(command).not.toContain("GOODMEMORY_WORKSPACE_ID");
    }
  });

  it("documents the trust, runtime, permission, activation, and deletion boundaries", async () => {
    const [guide, docsIndex, descriptor] = await Promise.all([
      readText("docs/GoodMemory-Kimi-Code-Setup-Guide.md"),
      readText("docs/README.md"),
      readJson<CapabilityDescriptor>(".well-known/goodmemory.json"),
    ]);

    expect(guide).toContain("Node.js 20");
    expect(guide).toContain("Bun 1.3.14");
    expect(guide).toContain(
      "repository descriptors target the stable `0.7.5` release",
    );
    expect(guide).not.toContain("release candidate");
    expect(guide).toContain("npx");
    expect(guide).toContain("third-party");
    expect(guide).toContain("defaults to cancel");
    expect(guide).toContain("/reload");
    expect(guide).toContain("/new");
    expect(guide).toContain("/plugins info goodmemory");
    expect(guide).toContain("/mcp");
    expect(guide).toContain("approval");
    expect(guide).toContain("Inspector");
    expect(guide).toContain("user-level");
    expect(guide).toMatch(/all\s+projects/u);
    expect(docsIndex).toContain("GoodMemory-Kimi-Code-Setup-Guide.md");

    expect(descriptor.version).toBe(RELEASE_VERSION);
    expect(descriptor.onboarding).toContainEqual(
      expect.objectContaining({
        audience: "kimi-code-plugin",
        install: "/plugins install https://github.com/hjqcan/GoodMemory",
        method: "plugin",
        writeBoundary: "goodmemory_remember is exposed at install; Kimi Code approval still governs each unapproved MCP call",
      }),
    );
  });
});
