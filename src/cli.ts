import { readFile } from "node:fs/promises";
import { runEvalCommand } from "./cli/eval";
import * as help from "./cli/help";
import {
  readOptionalHostSelection,
  requireInstalledHostHookCommand,
  requireInstalledHostKind,
  runHostCommand,
} from "./cli/host";
import { runMemoryCommand } from "./cli/memory";
import { runServicesCommand } from "./cli/services";
import { renderCliSchema } from "./cli/schema";
import type {
  CLIRunDependencies,
  CLIResult,
  ParsedArgs,
  ParsedFlags,
} from "./cli/contracts";

export type {
  CLIInstallPrompt,
  CLIRunDependencies,
  CLIStorageResolutionDependencies,
} from "./cli/contracts";
export { resolveStorageConfig } from "./cli/shared";

const PACKAGE_JSON_URL = new URL("../package.json", import.meta.url);
let packageVersionCache: string | undefined;

function parseArgs(argv: string[]): ParsedArgs {
  const commands: string[] = [];
  const flags: ParsedFlags = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token) continue;
    if (token === "-V") {
      flags.version = "true";
      continue;
    }
    if (token === "--") {
      commands.push(...argv.slice(index + 1));
      break;
    }
    if (!token.startsWith("--")) {
      commands.push(token);
      continue;
    }

    const separator = token.indexOf("=");
    if (separator >= 0) {
      flags[token.slice(2, separator)] = token.slice(separator + 1);
      continue;
    }
    const key = token.slice(2);
    const value = argv[index + 1];
    if (value && !value.startsWith("--")) {
      flags[key] = value;
      index += 1;
    } else {
      flags[key] = "true";
    }
  }
  return { commands, flags };
}

function flagEnabled(flags: ParsedFlags, name: string): boolean {
  return flags[name] === "true";
}

async function readPackageVersion(): Promise<string> {
  if (!packageVersionCache) {
    const metadata = JSON.parse(await readFile(PACKAGE_JSON_URL, "utf8")) as { version: string };
    packageVersionCache = metadata.version;
  }
  return packageVersionCache;
}

async function versionResult(): Promise<CLIResult> {
  if (!packageVersionCache) {
    const metadata = JSON.parse(await readFile(PACKAGE_JSON_URL, "utf8")) as {
      version?: unknown;
    };
    if (typeof metadata.version !== "string" || metadata.version.length === 0) {
      throw new Error("Unable to read GoodMemory package version.");
    }
    packageVersionCache = metadata.version;
  }
  return { exitCode: 0, stderr: "", stdout: `goodmemory ${packageVersionCache}\n` };
}

function helpResult(text: string): CLIResult {
  return { exitCode: 0, stderr: "", stdout: `${text}\n` };
}

function errorResult(message: string): CLIResult {
  return { exitCode: 1, stderr: message, stdout: "" };
}

function nestedHelp(
  family: "eval" | "mcp" | "runtime" | "storage",
  secondary: string | undefined,
): CLIResult {
  if (!secondary) {
    return helpResult({
      eval: help.EVAL_HELP_TEXT,
      mcp: help.MCP_HELP_TEXT,
      runtime: help.RUNTIME_HELP_TEXT,
      storage: help.STORAGE_HELP_TEXT,
    }[family]);
  }
  const key = `${family}:${secondary}`;
  switch (key) {
    case "eval:inspect": return helpResult(help.EVAL_INSPECT_HELP_TEXT);
    case "eval:trace": return helpResult(help.EVAL_TRACE_HELP_TEXT);
    case "eval:export-case": return helpResult(help.EVAL_EXPORT_CASE_HELP_TEXT);
    case "mcp:serve": return helpResult(help.MCP_SERVE_HELP_TEXT);
    case "runtime:worker": return helpResult(help.RUNTIME_WORKER_HELP_TEXT);
    case "runtime:viewer": return helpResult(help.RUNTIME_VIEWER_HELP_TEXT);
    case "storage:migrate": return helpResult(help.STORAGE_MIGRATE_HELP_TEXT);
    default:
      return errorResult(
        `Unknown ${family === "mcp" ? "MCP" : family} command: ${secondary}. ` +
          `Run 'goodmemory ${family} --help'.`,
      );
  }
}

function hostToolHelp(
  primary: "claude" | "codex",
  commands: string[],
): CLIResult {
  const secondary = commands[1];
  if (!secondary) {
    return helpResult(primary === "codex" ? help.CODEX_HELP_TEXT : help.CLAUDE_HELP_TEXT);
  }
  if (secondary === "bootstrap") {
    return helpResult(
      primary === "codex" ? help.CODEX_BOOTSTRAP_HELP_TEXT : help.CLAUDE_BOOTSTRAP_HELP_TEXT,
    );
  }
  if (secondary === "hook") {
    if (commands[2]) requireInstalledHostHookCommand(commands[2]);
    return helpResult(
      primary === "codex" ? help.CODEX_HOOK_HELP_TEXT : help.CLAUDE_HOOK_HELP_TEXT,
    );
  }
  if (secondary === "writeback") {
    return helpResult(
      primary === "codex" ? help.CODEX_WRITEBACK_HELP_TEXT : help.CLAUDE_WRITEBACK_HELP_TEXT,
    );
  }
  if (primary === "codex" && secondary === "action") {
    return helpResult(help.CODEX_ACTION_HELP_TEXT);
  }
  return errorResult(
    `Unknown ${primary === "codex" ? "Codex" : "Claude"} command: ${secondary}. ` +
      `Run 'goodmemory ${primary} --help'.`,
  );
}

function routeHelp(commands: string[]): CLIResult {
  const primary = commands[0]!;
  switch (primary) {
    case "adopt": return helpResult(help.ADOPT_HELP_TEXT);
    case "setup": return helpResult(help.SETUP_HELP_TEXT);
    case "status": return helpResult(help.STATUS_HELP_TEXT);
    case "doctor": return helpResult(help.DOCTOR_HELP_TEXT);
    case "inspect": return helpResult(help.INSPECT_HELP_TEXT);
    case "remember": return helpResult(help.REMEMBER_HELP_TEXT);
    case "feedback": return helpResult(help.FEEDBACK_HELP_TEXT);
    case "forget": return helpResult(help.FORGET_HELP_TEXT);
    case "trace": return helpResult(help.TRACE_HELP_TEXT);
    case "stats": return helpResult(help.STATS_HELP_TEXT);
    case "export-memory": return helpResult(help.EXPORT_MEMORY_HELP_TEXT);
    case "import-memory": return helpResult(help.IMPORT_MEMORY_HELP_TEXT);
    case "eval": case "mcp": case "runtime": case "storage":
      return nestedHelp(primary, commands[1]);
    case "codex": case "claude": return hostToolHelp(primary, commands);
    case "install": case "uninstall": case "enable": case "disable":
      if (commands[1]) requireInstalledHostKind(commands[1]);
      return helpResult({
        disable: help.DISABLE_HELP_TEXT,
        enable: help.ENABLE_HELP_TEXT,
        install: help.INSTALL_HELP_TEXT,
        uninstall: help.UNINSTALL_HELP_TEXT,
      }[primary]);
    case "repair":
      if (commands[1]) readOptionalHostSelection(commands[1]);
      return helpResult(help.REPAIR_HELP_TEXT);
    case "inspector": return helpResult(help.INSPECTOR_HELP_TEXT);
    default: return errorResult(`Unknown command: ${primary}. Run 'goodmemory --help'.`);
  }
}

function bareFamilyHelp(primary: string, commands: string[]): CLIResult | null {
  if (commands[1]) return null;
  switch (primary) {
    case "eval": return helpResult(help.EVAL_HELP_TEXT);
    case "mcp": return helpResult(help.MCP_HELP_TEXT);
    case "storage": return helpResult(help.STORAGE_HELP_TEXT);
    case "runtime": return helpResult(help.RUNTIME_HELP_TEXT);
    case "codex": return helpResult(help.CODEX_HELP_TEXT);
    case "claude": return helpResult(help.CLAUDE_HELP_TEXT);
    default: return null;
  }
}

export async function runCLI(
  argv: string[],
  dependencies: CLIRunDependencies = {},
): Promise<CLIResult> {
  try {
    const { commands, flags } = parseArgs(argv);
    if (flagEnabled(flags, "version")) return await versionResult();
    if (flagEnabled(flags, "schema")) {
      return { exitCode: 0, stderr: "", stdout: renderCliSchema(await readPackageVersion()) };
    }
    if (commands.length === 0) return helpResult(help.ROOT_HELP_TEXT);
    if (flagEnabled(flags, "help")) return routeHelp(commands);

    const primary = commands[0]!;
    const bareHelp = bareFamilyHelp(primary, commands);
    if (bareHelp) return bareHelp;
    switch (primary) {
      case "remember": case "feedback": case "forget": case "inspect":
      case "trace": case "stats": case "export-memory": case "import-memory":
        return await runMemoryCommand(primary, flags);
      case "eval": return await runEvalCommand(commands, flags);
      case "adopt": case "setup": case "status": case "doctor":
      case "codex": case "claude": case "install": case "uninstall":
      case "enable": case "disable": case "repair":
        return await runHostCommand(primary, commands, flags, dependencies);
      case "mcp": case "storage": case "runtime": case "inspector":
        return await runServicesCommand(primary, commands, flags, dependencies);
      default: throw new Error(`Unknown command: ${primary}. Run 'goodmemory --help'.`);
    }
  } catch (error) {
    return {
      exitCode: 1,
      stderr: error instanceof Error ? error.message : String(error),
      stdout: "",
    };
  }
}
