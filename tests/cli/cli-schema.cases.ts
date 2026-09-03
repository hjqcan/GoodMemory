import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import * as help from "../../src/cli/help";
import { CLI_SCHEMA, CLI_SCHEMA_VERSION, type CliSchemaFlag } from "../../src/cli/schema";
import { runCLI } from "./cli.test-support";

// `goodmemory --schema` prints a frozen literal (ADR-010 §11). These cases keep
// that literal honest: it must match what the help texts say, every path in it
// must route to help, and every help constant must appear in it.

const HELP_PATHS: Record<string, string[]> = {
  ADOPT_HELP_TEXT: ["adopt"],
  CLAUDE_BOOTSTRAP_HELP_TEXT: ["claude", "bootstrap"],
  CLAUDE_HELP_TEXT: ["claude"],
  CLAUDE_HOOK_HELP_TEXT: ["claude", "hook"],
  CLAUDE_WRITEBACK_HELP_TEXT: ["claude", "writeback"],
  CODEX_ACTION_HELP_TEXT: ["codex", "action"],
  CODEX_BOOTSTRAP_HELP_TEXT: ["codex", "bootstrap"],
  CODEX_HELP_TEXT: ["codex"],
  CODEX_HOOK_HELP_TEXT: ["codex", "hook"],
  CODEX_WRITEBACK_HELP_TEXT: ["codex", "writeback"],
  DISABLE_HELP_TEXT: ["disable"],
  DOCTOR_HELP_TEXT: ["doctor"],
  ENABLE_HELP_TEXT: ["enable"],
  EVAL_EXPORT_CASE_HELP_TEXT: ["eval", "export-case"],
  EVAL_HELP_TEXT: ["eval"],
  EVAL_INSPECT_HELP_TEXT: ["eval", "inspect"],
  EVAL_TRACE_HELP_TEXT: ["eval", "trace"],
  EXPORT_MEMORY_HELP_TEXT: ["export-memory"],
  FEEDBACK_HELP_TEXT: ["feedback"],
  FORGET_HELP_TEXT: ["forget"],
  IMPORT_MEMORY_HELP_TEXT: ["import-memory"],
  INSPECTOR_HELP_TEXT: ["inspector"],
  INSPECT_HELP_TEXT: ["inspect"],
  INSTALL_HELP_TEXT: ["install"],
  MCP_HELP_TEXT: ["mcp"],
  MCP_SERVE_HELP_TEXT: ["mcp", "serve"],
  REMEMBER_HELP_TEXT: ["remember"],
  REPAIR_HELP_TEXT: ["repair"],
  ROOT_HELP_TEXT: [],
  RUNTIME_HELP_TEXT: ["runtime"],
  RUNTIME_VIEWER_HELP_TEXT: ["runtime", "viewer"],
  RUNTIME_WORKER_HELP_TEXT: ["runtime", "worker"],
  SETUP_HELP_TEXT: ["setup"],
  STATS_HELP_TEXT: ["stats"],
  STATUS_HELP_TEXT: ["status"],
  STORAGE_HELP_TEXT: ["storage"],
  STORAGE_MIGRATE_HELP_TEXT: ["storage", "migrate"],
  TRACE_HELP_TEXT: ["trace"],
  UNINSTALL_HELP_TEXT: ["uninstall"],
};

function flagsFromHelp(text: string): CliSchemaFlag[] {
  const seen = new Map<string, CliSchemaFlag>();
  for (const line of text.split("\n")) {
    const match = /^\s{2,}(--[a-z0-9-]+)(?:\s+<([^>]+)>)?/.exec(line);
    if (!match || seen.has(match[1]!)) {
      continue;
    }
    const spec = match[2];
    const choices = spec && spec.includes("|") && !spec.includes(" ") ? spec.split("|") : undefined;
    seen.set(match[1]!, {
      name: match[1]!,
      type: spec ? "string" : "boolean",
      ...(choices ? { choices } : {}),
    });
  }
  return [...seen.values()];
}

describe("goodmemory cli --schema", () => {
  it("prints a versioned JSON document that matches the frozen literal", async () => {
    const packageJson = JSON.parse(
      await readFile(join(import.meta.dir, "../../package.json"), "utf8"),
    ) as { version: string };

    const result = await runCLI(["--schema"]);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    const parsed = JSON.parse(result.stdout) as {
      commands: unknown;
      globalFlags: unknown;
      schemaVersion: string;
      version: string;
    };
    expect(parsed.version).toBe(packageJson.version);
    expect(parsed.schemaVersion).toBe(CLI_SCHEMA_VERSION);
    expect(parsed.commands).toEqual(CLI_SCHEMA.commands);
    expect(parsed.globalFlags).toEqual(CLI_SCHEMA.globalFlags);

    const withJson = await runCLI(["--schema", "--json"]);
    expect(withJson.stdout).toBe(result.stdout);
    const withCommand = await runCLI(["remember", "--schema"]);
    expect(withCommand.stdout).toBe(result.stdout);
  });

  it("matches every help text flag for flag and summary for summary", () => {
    const helpNames = Object.keys(help).filter((name) => name.endsWith("_HELP_TEXT")).sort();
    expect(helpNames).toEqual(Object.keys(HELP_PATHS).sort());

    const expected = helpNames
      .map((name) => {
        const text = (help as Record<string, string>)[name]!;
        return { flags: flagsFromHelp(text), path: HELP_PATHS[name]!, summary: text.split("\n")[0]! };
      })
      .sort((left, right) => left.path.join(" ").localeCompare(right.path.join(" ")));

    expect(CLI_SCHEMA.commands).toEqual(expected);
    expect(CLI_SCHEMA.globalFlags.map((flag) => flag.name)).toEqual(["--help", "--schema", "--version"]);
  });

  it("routes every schema path to its help text and lists every routed command", async () => {
    for (const command of CLI_SCHEMA.commands) {
      const result = await runCLI([...command.path, "--help"]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout.split("\n")[0]).toBe(command.summary);
    }

    const source = await readFile(join(import.meta.dir, "../../src/cli.ts"), "utf8");
    const routeHelp = source.slice(source.indexOf("function routeHelp("), source.indexOf("function bareFamilyHelp("));
    const routed = [...routeHelp.matchAll(/case "([a-z-]+)"/g)].map((match) => match[1]!);
    expect(routed.length).toBeGreaterThan(10);
    const topLevel = new Set(CLI_SCHEMA.commands.map((command) => command.path[0]).filter(Boolean));
    for (const name of routed) {
      expect(topLevel.has(name)).toBe(true);
    }
    const nested = source.slice(source.indexOf("function nestedHelp("), source.indexOf("function hostToolHelp("));
    for (const match of nested.matchAll(/case "([a-z]+):([a-z-]+)"/g)) {
      expect(
        CLI_SCHEMA.commands.some(
          (command) => command.path[0] === match[1] && command.path[1] === match[2],
        ),
      ).toBe(true);
    }
  });
});
