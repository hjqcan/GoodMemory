import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, delimiter, join } from "node:path";
import { resolveCliFlagValue } from "./cli-options";
import {
  buildPackageTarballName,
  resolveCurrentPackageMetadataSync,
} from "./package-metadata";
import { resolveRepoRootFromScriptUrl } from "./script-paths";

const CURRENT_TARBALL_NAME = buildPackageTarballName(
  resolveCurrentPackageMetadataSync(import.meta.url),
);

export interface Phase35LiveMemoryCommand {
  args: string[];
  cwd: string;
  env?: Record<string, string>;
  label: string;
  stdin?: string;
}

export interface Phase35LiveMemoryCommandResult {
  durationMs: number;
  exitCode: number;
  stderr: string;
  stdout: string;
}

export interface Phase35LiveMemoryExecutionResult {
  command: string;
  durationMs: number;
  exitCode: number;
  label: string;
  status: "failed" | "passed";
  stderrTail: string[];
  stdoutTail: string[];
}

export interface Phase35LiveMemoryOptions {
  outputDir?: string;
  runId?: string;
}

export interface Phase35McpProbeResult {
  context: Record<string, unknown>;
  stats: Record<string, unknown>;
}

export interface Phase35RegisteredMcpServer {
  args: string[];
  command: string;
  env: Record<string, string>;
}

export interface Phase35LiveMemoryDependencies {
  ensureDir?: (
    path: string,
    options?: {
      recursive?: boolean;
    },
  ) => Promise<void>;
  makeTempDir?: (prefix: string) => Promise<string>;
  now?: () => string;
  probeMcp?: (input: {
    homeRoot: string;
    mcpServer: Phase35RegisteredMcpServer;
    query: string;
    sessionId: string;
    workspaceRoot: string;
  }) => Promise<Phase35McpProbeResult>;
  readTextFile?: (path: string) => Promise<string>;
  removeDir?: (
    path: string,
    options?: {
      force?: boolean;
      recursive?: boolean;
    },
  ) => Promise<void>;
  runCommand?: (
    command: Phase35LiveMemoryCommand,
  ) => Promise<Phase35LiveMemoryCommandResult>;
  writeTextFile?: (path: string, content: string) => Promise<void>;
}

export interface Phase35LiveMemoryCliDependencies {
  argv?: readonly string[];
  exit?: (code: number) => void;
  log?: (message: string) => void;
  runEval?: (
    options?: Phase35LiveMemoryOptions,
  ) => Promise<Phase35LiveReport>;
}

export interface Phase35LiveReport {
  acceptance: {
    decision: "accepted" | "blocked";
    reason: string;
  };
  commands: Phase35LiveMemoryExecutionResult[];
  evidence: {
    hooks: {
      installRegistersHooks: boolean;
      sessionStart: {
        context: string;
        matchedExpectedFieldCount: number;
        registeredCommandMatchesManagedConfig: boolean;
      };
      userPromptSubmit: {
        context: string;
        matchedExpectedFieldCount: number;
        registeredCommandMatchesManagedConfig: boolean;
      };
    };
    mcp: {
      contextIncludesBlocker: boolean;
      contextIncludesSummaryRule: boolean;
      installRegistersMcp: boolean;
      registeredCommandMatchesManagedConfig: boolean;
      stats: Record<string, unknown>;
    };
    repoOptIn: {
      enabled: boolean;
      workspaceId?: string;
    };
    releaseContract: {
      distribution: "tarball-first";
      runtime: "bun-only";
      tarballName: string;
    };
  };
  evidenceContract: {
    phase35: {
      packageBoundary: "installed_package_public_imports";
      runner: string;
      runtimePath: "installed_package_user_level_hooks_and_mcp";
    };
  };
  generatedAt: string;
  generatedBy: string;
  mode: "live-memory";
  outputDir: string;
  phase: "phase-35";
  runDirectory: string;
  runId: string;
}

const GENERATED_BY = "scripts/run-phase-35-live-memory.ts";
const PHASE35_CURRENT_GOAL = "Finish the phase 35 middleware closeout.";
const PHASE35_OPEN_LOOP = "Archive the canonical phase 35 quality gate.";
const PHASE35_SUMMARY_RULE = "Use short next-step bullets in coding summaries.";
const PHASE35_DEPLOY_BLOCKER = "The deploy is blocked on smoke verification.";
const PHASE35_QUERY =
  "Summarize my standing summary style and current deployment blocker before you answer.";
const PHASE35_CLI_ENV = {
  GOODMEMORY_ASSISTED_EXTRACTOR_API_KEY: "",
  GOODMEMORY_ASSISTED_EXTRACTOR_BASE_URL: "",
  GOODMEMORY_ASSISTED_EXTRACTOR_MODEL: "",
  GOODMEMORY_ASSISTED_EXTRACTOR_PROVIDER: "",
  GOODMEMORY_EMBEDDING_API_KEY: "",
  GOODMEMORY_EMBEDDING_BASE_URL: "",
  GOODMEMORY_EMBEDDING_MODEL: "",
  GOODMEMORY_EMBEDDING_PROVIDER: "",
  GOODMEMORY_RECALL_ROUTER_API_KEY: "",
  GOODMEMORY_RECALL_ROUTER_BASE_URL: "",
  GOODMEMORY_RECALL_ROUTER_MODEL: "",
  GOODMEMORY_RECALL_ROUTER_PROVIDER: "",
  GOODMEMORY_STORAGE_PROVIDER: "",
  GOODMEMORY_STORAGE_URL: "",
  GOODMEMORY_TEST_POSTGRES_URL: "",
} as const;
const PHASE35_SESSION_ID = "consumer-session";
const PHASE35_USER_ID = "consumer-user";
const PHASE35_WORKSPACE_ID = "consumer-workspace";
const PHASE35_RUNTIME_SEED_SCRIPT_PATH = "phase35-seed-runtime.mjs";

function tailLines(value: string, count = 20): string[] {
  if (value.trim().length === 0) {
    return [];
  }

  return value.trimEnd().split(/\r?\n/u).slice(-count);
}

function formatCommand(args: readonly string[]): string {
  return args.join(" ");
}

function createChildEnv(
  overrides: Record<string, string> = {},
): Record<string, string> {
  const env: Record<string, string> = {};

  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      env[key] = value;
    }
  }

  for (const [key, value] of Object.entries(overrides)) {
    env[key] = value;
  }

  return env;
}

function createInstalledPackageEnv(
  workspaceRoot: string,
  overrides: Record<string, string> = {},
): Record<string, string> {
  const binPath = join(workspaceRoot, "node_modules", ".bin");
  const existingPath = overrides.PATH ?? process.env.PATH ?? "";
  return {
    ...overrides,
    PATH:
      existingPath.length > 0
        ? `${binPath}${delimiter}${existingPath}`
        : binPath,
  };
}

function toExecutionResult(
  command: Phase35LiveMemoryCommand,
  result: Phase35LiveMemoryCommandResult,
): Phase35LiveMemoryExecutionResult {
  return {
    command: formatCommand(command.args),
    durationMs: result.durationMs,
    exitCode: result.exitCode,
    label: command.label,
    status: result.exitCode === 0 ? "passed" : "failed",
    stderrTail: tailLines(result.stderr),
    stdoutTail: tailLines(result.stdout),
  };
}

function extractJsonObject<T>(value: string): T {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error("Expected JSON output but received an empty string.");
  }

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end < start) {
    throw new Error(`Expected JSON output but received: ${trimmed}`);
  }

  return JSON.parse(trimmed.slice(start, end + 1)) as T;
}

function extractHookAdditionalContext(
  result: Phase35LiveMemoryCommandResult,
): string {
  if (result.exitCode !== 0) {
    return "";
  }

  const payload = extractJsonObject<{
    hookSpecificOutput?: {
      additionalContext?: string;
    };
  }>(result.stdout);
  return payload.hookSpecificOutput?.additionalContext ?? "";
}

function buildManagedHookCommand(
  hookCommand: "session-start" | "user-prompt-submit",
  homeRoot: string,
): string {
  return [
    `GOODMEMORY_HOME=${shellQuote(homeRoot)}`,
    "GOODMEMORY_MANAGED_BY='goodmemory'",
    "goodmemory",
    "codex",
    "hook",
    hookCommand,
  ].join(" ");
}

function resolveRegisteredHookCommands(input: {
  commandName: "session-start" | "user-prompt-submit";
  config: string;
  eventName: "SessionStart" | "UserPromptSubmit";
}): string[] {
  const parsed = JSON.parse(input.config) as unknown;
  if (!isRecord(parsed) || !isRecord(parsed.hooks)) {
    return [];
  }

  const eventValue = parsed.hooks[input.eventName];
  if (!Array.isArray(eventValue)) {
    return [];
  }

  const commands: string[] = [];
  const commandNeedle = `goodmemory codex hook ${input.commandName}`;
  for (const group of eventValue) {
    if (!isRecord(group) || !Array.isArray(group.hooks)) {
      continue;
    }
    for (const hook of group.hooks) {
      if (
        isRecord(hook) &&
        hook.type === "command" &&
        typeof hook.command === "string" &&
        hook.command.includes(commandNeedle)
      ) {
        commands.push(hook.command);
      }
    }
  }

  return commands;
}

async function runRegisteredHookCommand(input: {
  commandName: "session-start" | "user-prompt-submit";
  env: Record<string, string>;
  eventName: "SessionStart" | "UserPromptSubmit";
  homeRoot: string;
  hooksConfig: string;
  label: string;
  runCommand: (
    command: Phase35LiveMemoryCommand,
  ) => Promise<Phase35LiveMemoryCommandResult>;
  stdin: string;
  workspaceRoot: string;
}): Promise<{
  command: Phase35LiveMemoryCommand;
  registeredCommandMatchesManagedConfig: boolean;
  result: Phase35LiveMemoryCommandResult;
}> {
  const registeredCommands = resolveRegisteredHookCommands({
    commandName: input.commandName,
    config: input.hooksConfig,
    eventName: input.eventName,
  });
  const expectedCommand = buildManagedHookCommand(input.commandName, input.homeRoot);
  const registeredCommand = registeredCommands.includes(expectedCommand)
    ? expectedCommand
    : registeredCommands[0] ?? null;
  const command: Phase35LiveMemoryCommand = {
    args: ["sh", "-c", registeredCommand ?? ""],
    cwd: input.workspaceRoot,
    env: createInstalledPackageEnv(input.workspaceRoot, input.env),
    label: input.label,
    stdin: input.stdin,
  };
  const registeredCommandMatchesManagedConfig = registeredCommand === expectedCommand;

  if (!registeredCommandMatchesManagedConfig) {
    return {
      command,
      registeredCommandMatchesManagedConfig,
      result: {
        durationMs: 0,
        exitCode: 1,
        stderr:
          registeredCommand === null
            ? `No managed ${input.eventName} hook command was registered.`
            : `Registered ${input.eventName} hook command does not match the GoodMemory-managed install command.`,
        stdout: "",
      },
    };
  }

  return {
    command,
    registeredCommandMatchesManagedConfig,
    result: await input.runCommand(command),
  };
}

function resolveRegisteredCodexMcpServer(
  config: string,
): Phase35RegisteredMcpServer | null {
  const lines = config.replace(/\r\n/gu, "\n").split("\n");
  const blockRange = findCodexGoodmemoryMcpBlock(lines);
  if (blockRange === null) {
    return null;
  }

  let command: string | null = null;
  let args: string[] | null = null;
  const env: Record<string, string> = {};
  let inEnv = false;

  for (const line of lines.slice(blockRange.start, blockRange.end)) {
    if (/^\s*\[\s*mcp_servers\.goodmemory\.env\s*\]\s*(?:#.*)?$/u.test(line)) {
      inEnv = true;
      continue;
    }
    if (/^\s*\[\s*mcp_servers\.goodmemory\s*\]\s*(?:#.*)?$/u.test(line)) {
      inEnv = false;
      continue;
    }

    if (inEnv) {
      const envEntry = parseTomlStringAssignment(line);
      if (envEntry) {
        env[envEntry.key] = envEntry.value;
      }
      continue;
    }

    const stringEntry = parseTomlStringAssignment(line);
    if (stringEntry?.key === "command") {
      command = stringEntry.value;
      continue;
    }

    const argsEntry = parseTomlStringArrayAssignment(line);
    if (argsEntry?.key === "args") {
      args = argsEntry.values;
    }
  }

  return command && args
    ? {
        args,
        command,
        env,
      }
    : null;
}

function registeredMcpServerMatchesManagedConfig(
  server: Phase35RegisteredMcpServer | null,
  homeRoot: string,
): boolean {
  return (
    server !== null &&
    server.command === "goodmemory-mcp" &&
    server.args.length === 2 &&
    server.args[0] === "--host" &&
    server.args[1] === "codex" &&
    server.env.GOODMEMORY_HOME === homeRoot &&
    server.env.GOODMEMORY_MANAGED_BY === "goodmemory"
  );
}

function findCodexGoodmemoryMcpBlock(
  lines: string[],
): { end: number; start: number } | null {
  const managedHeaderPattern =
    /^\s*\[\s*mcp_servers\.goodmemory(?:\.[^\]]+)?\s*\]\s*(?:#.*)?$/u;
  const rootHeaderPattern =
    /^\s*\[\s*mcp_servers\.goodmemory\s*\]\s*(?:#.*)?$/u;
  const anyHeaderPattern = /^\s*\[[^\]]+\]\s*(?:#.*)?$/u;
  let start = -1;

  for (const [index, line] of lines.entries()) {
    if (rootHeaderPattern.test(line)) {
      start = index;
      break;
    }
  }
  if (start < 0) {
    return null;
  }

  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (!anyHeaderPattern.test(line)) {
      continue;
    }
    if (managedHeaderPattern.test(line)) {
      continue;
    }
    end = index;
    break;
  }

  return { end, start };
}

function parseTomlStringAssignment(
  line: string,
): { key: string; value: string } | null {
  const match =
    /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*("(?:\\.|[^"\\])*")\s*(?:#.*)?$/u.exec(
      line,
    );
  if (!match) {
    return null;
  }

  return {
    key: match[1]!,
    value: JSON.parse(match[2]!) as string,
  };
}

function parseTomlStringArrayAssignment(
  line: string,
): { key: string; values: string[] } | null {
  const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*\[(.*)\]\s*(?:#.*)?$/u.exec(
    line,
  );
  if (!match) {
    return null;
  }

  const stringMatches = match[2]!.matchAll(/"(?:\\.|[^"\\])*"/gu);
  return {
    key: match[1]!,
    values: [...stringMatches].map((stringMatch) =>
      JSON.parse(stringMatch[0]) as string,
    ),
  };
}

function resolveTarballPath(
  outputDir: string,
  stdout: string,
): { tarballName: string; tarballPath: string } {
  const tarballOutput = stdout.trim();
  const tarballName =
    tarballOutput.length === 0
      ? CURRENT_TARBALL_NAME
      : tarballOutput.includes("/")
        ? basename(tarballOutput)
        : tarballOutput;
  const tarballPath =
    tarballOutput.length === 0
      ? join(outputDir, tarballName)
      : tarballOutput.includes("/")
        ? tarballOutput
        : join(outputDir, tarballOutput);

  return {
    tarballName,
    tarballPath,
  };
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/gu, `'\"'\"'`)}'`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function resolvePhase35LiveMemoryOutputDir(root: string): string {
  return join(root, "reports/eval/live-memory/phase-35");
}

export function buildPhase35LiveMemoryRunId(timestamp: string): string {
  return `run-${timestamp.replace(/\D/g, "").slice(0, 14) || "phase35live"}`;
}

export function parsePhase35LiveMemoryCliOptions(
  argv: readonly string[],
): Phase35LiveMemoryOptions {
  return {
    outputDir: resolveCliFlagValue(argv, "--output-dir"),
    runId: resolveCliFlagValue(argv, "--run-id"),
  };
}

function buildPhase35RuntimeSeedScript(sqlitePath: string): string {
  return [
    'import {',
    "  createRuntimeArchiveStore,",
    "  createRuntimeContextService,",
    "  createSQLiteDocumentStore,",
    "  createSQLiteSessionStore,",
    '} from "goodmemory";',
    "",
    `const sqlitePath = ${JSON.stringify(sqlitePath)};`,
    `const scope = ${JSON.stringify({
      agentId: "codex",
      sessionId: PHASE35_SESSION_ID,
      userId: PHASE35_USER_ID,
      workspaceId: PHASE35_WORKSPACE_ID,
    })};`,
    'const documentStore = createSQLiteDocumentStore(sqlitePath);',
    'const sessionStore = createSQLiteSessionStore(sqlitePath);',
    "const runtime = createRuntimeContextService({",
    "  archiveStore: createRuntimeArchiveStore({ documentStore }),",
    "  now: () => \"2026-04-23T19:00:00.000Z\",",
    "  sessionStore,",
    "});",
    "",
    "await runtime.startSession(scope);",
    "await runtime.updateWorkingMemory(scope, {",
    `  currentGoal: ${JSON.stringify(PHASE35_CURRENT_GOAL)},`,
    `  openLoops: [${JSON.stringify(PHASE35_OPEN_LOOP)}],`,
    "});",
    "await runtime.updateSessionJournal(scope, {",
    '  currentState: "Global install and automatic hook wiring are done.",',
    '  appendWorklog: ["Next step is archive the canonical phase 35 quality gate."],',
    "});",
    "",
    'console.log(JSON.stringify({ ok: true }));',
    "",
  ].join("\n");
}

async function defaultRunPhase35LiveMemoryCommand(
  command: Phase35LiveMemoryCommand,
): Promise<Phase35LiveMemoryCommandResult> {
  const startedAtMs = Date.now();
  const child = Bun.spawn({
    cmd: command.args,
    cwd: command.cwd,
    env: command.env ? createChildEnv(command.env) : createChildEnv(),
    stderr: "pipe",
    stdin: command.stdin === undefined ? "ignore" : "pipe",
    stdout: "pipe",
  });

  if (command.stdin !== undefined) {
    if (!child.stdin) {
      throw new Error(`Command ${command.label} did not expose a writable stdin.`);
    }
    child.stdin.write(command.stdin);
    child.stdin.end();
  }

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);

  return {
    durationMs: Date.now() - startedAtMs,
    exitCode,
    stderr,
    stdout,
  };
}

async function defaultProbePhase35Mcp(input: {
  homeRoot: string;
  mcpServer: Phase35RegisteredMcpServer;
  query: string;
  sessionId: string;
  workspaceRoot: string;
}): Promise<Phase35McpProbeResult> {
  const transport = new StdioClientTransport({
    args: input.mcpServer.args,
    command: input.mcpServer.command,
    cwd: input.workspaceRoot,
    env: createChildEnv(
      createInstalledPackageEnv(input.workspaceRoot, {
        ...PHASE35_CLI_ENV,
        ...input.mcpServer.env,
      }),
    ),
    stderr: "pipe",
  });

  const client = new Client(
    {
      name: "goodmemory-phase35-live-probe",
      version: "0.0.0",
    },
    {
      capabilities: {},
    },
  );

  try {
    await client.connect(transport);
    const stats = await client.callTool({
      arguments: {
        cwd: input.workspaceRoot,
        sessionId: input.sessionId,
      },
      name: "goodmemory_stats",
    });
    const context = await client.callTool({
      arguments: {
        cwd: input.workspaceRoot,
        query: input.query,
        sessionId: input.sessionId,
      },
      name: "goodmemory_get_context",
    });

    return {
      context: context.structuredContent as Record<string, unknown>,
      stats: stats.structuredContent as Record<string, unknown>,
    };
  } finally {
    await transport.close();
  }
}

export async function runPhase35LiveMemoryEvaluation(
  options: Phase35LiveMemoryOptions = {},
  dependencies: Phase35LiveMemoryDependencies = {},
): Promise<Phase35LiveReport> {
  const root = resolveRepoRootFromScriptUrl(import.meta.url);
  const outputDir =
    options.outputDir ?? resolvePhase35LiveMemoryOutputDir(root);
  const ensureDir = dependencies.ensureDir ?? mkdir;
  const makeTempDir =
    dependencies.makeTempDir ??
    ((prefix: string) => mkdtemp(join(tmpdir(), prefix)));
  const readTextFile =
    dependencies.readTextFile ??
    ((path: string) => readFile(path, "utf8"));
  const removeDir = dependencies.removeDir ?? rm;
  const runCommand =
    dependencies.runCommand ?? defaultRunPhase35LiveMemoryCommand;
  const writeTextFile = dependencies.writeTextFile ?? writeFile;
  const probeMcp = dependencies.probeMcp ?? defaultProbePhase35Mcp;
  const now = dependencies.now ?? (() => new Date().toISOString());
  const timestamp = now();
  const runId = options.runId ?? buildPhase35LiveMemoryRunId(timestamp);
  const runDirectory = join(outputDir, runId);
  const commands: Phase35LiveMemoryExecutionResult[] = [];
  const packDir = await makeTempDir("goodmemory-phase35-pack-");
  const workspaceRoot = await makeTempDir("goodmemory-phase35-workspace-");
  const homeRoot = await makeTempDir("goodmemory-phase35-home-");
  const packageJsonPath = join(workspaceRoot, "package.json");

  try {
    await ensureDir(runDirectory, { recursive: true });
    await writeTextFile(
      packageJsonPath,
      JSON.stringify(
        {
          dependencies: {},
          name: "goodmemory-phase35-consumer",
          private: true,
          version: "0.0.0",
        },
        null,
        2,
      ) + "\n",
    );

    const packCommand: Phase35LiveMemoryCommand = {
      args: ["bun", "pm", "pack", "--destination", packDir, "--quiet"],
      cwd: root,
      env: PHASE35_CLI_ENV,
      label: "pack-tarball",
    };
    const packResult = await runCommand(packCommand);
    commands.push(toExecutionResult(packCommand, packResult));
    if (packResult.exitCode !== 0) {
      throw new Error("Failed to pack the Phase 35 tarball.");
    }
    const { tarballName, tarballPath } = resolveTarballPath(packDir, packResult.stdout);

    await writeTextFile(
      packageJsonPath,
      JSON.stringify(
        {
          dependencies: {
            goodmemory: `file:${tarballPath}`,
          },
          name: "goodmemory-phase35-consumer",
          private: true,
          version: "0.0.0",
        },
        null,
        2,
      ) + "\n",
    );

    const installTarballCommand: Phase35LiveMemoryCommand = {
      args: ["bun", "install"],
      cwd: workspaceRoot,
      env: PHASE35_CLI_ENV,
      label: "install-tarball",
    };
    const installTarballResult = await runCommand(installTarballCommand);
    commands.push(toExecutionResult(installTarballCommand, installTarballResult));
    if (installTarballResult.exitCode !== 0) {
      throw new Error("Failed to install the packed Phase 35 tarball.");
    }

    const managedEnv = {
      ...PHASE35_CLI_ENV,
      GOODMEMORY_HOME: homeRoot,
    };
    const codexInstallCommand: Phase35LiveMemoryCommand = {
      args: [
        "./node_modules/.bin/goodmemory",
        "install",
        "codex",
        "--user-id",
        PHASE35_USER_ID,
        "--json",
      ],
      cwd: workspaceRoot,
      env: managedEnv,
      label: "codex-install",
    };
    const codexInstallResult = await runCommand(codexInstallCommand);
    commands.push(toExecutionResult(codexInstallCommand, codexInstallResult));
    if (codexInstallResult.exitCode !== 0) {
      throw new Error("Failed to install Codex middleware config for Phase 35.");
    }

    const codexEnableCommand: Phase35LiveMemoryCommand = {
      args: [
        "./node_modules/.bin/goodmemory",
        "enable",
        "codex",
        "--workspace-id",
        PHASE35_WORKSPACE_ID,
        "--workspace-root",
        workspaceRoot,
        "--json",
      ],
      cwd: workspaceRoot,
      env: managedEnv,
      label: "codex-enable",
    };
    const codexEnableResult = await runCommand(codexEnableCommand);
    commands.push(toExecutionResult(codexEnableCommand, codexEnableResult));
    if (codexEnableResult.exitCode !== 0) {
      throw new Error("Failed to enable the Codex repo opt-in for Phase 35.");
    }

    const runtimeSeedScriptPath = join(workspaceRoot, PHASE35_RUNTIME_SEED_SCRIPT_PATH);
    await writeTextFile(
      runtimeSeedScriptPath,
      buildPhase35RuntimeSeedScript(
        join(homeRoot, ".goodmemory", "memory.sqlite"),
      ),
    );
    const runtimeSeedCommand: Phase35LiveMemoryCommand = {
      args: ["bun", `./${PHASE35_RUNTIME_SEED_SCRIPT_PATH}`],
      cwd: workspaceRoot,
      env: managedEnv,
      label: "seed-runtime-continuity",
    };
    const runtimeSeedResult = await runCommand(runtimeSeedCommand);
    commands.push(toExecutionResult(runtimeSeedCommand, runtimeSeedResult));
    if (runtimeSeedResult.exitCode !== 0) {
      throw new Error("Failed to seed runtime continuity for Phase 35.");
    }

    const seedCommands: Phase35LiveMemoryCommand[] = [
      {
        args: [
          "./node_modules/.bin/goodmemory",
          "remember",
          "--host",
          "codex",
          "--workspace-root",
          workspaceRoot,
          "--session-id",
          PHASE35_SESSION_ID,
          "--message",
          `Remember that the current goal is ${PHASE35_CURRENT_GOAL} The open loop is ${PHASE35_OPEN_LOOP}`,
          "--json",
        ],
        cwd: workspaceRoot,
        env: managedEnv,
        label: "seed-continuity",
      },
      {
        args: [
          "./node_modules/.bin/goodmemory",
          "feedback",
          "--host",
          "codex",
          "--workspace-root",
          workspaceRoot,
          "--session-id",
          PHASE35_SESSION_ID,
          "--signal",
          PHASE35_SUMMARY_RULE,
          "--json",
        ],
        cwd: workspaceRoot,
        env: managedEnv,
        label: "seed-summary-rule",
      },
      {
        args: [
          "./node_modules/.bin/goodmemory",
          "remember",
          "--host",
          "codex",
          "--workspace-root",
          workspaceRoot,
          "--session-id",
          PHASE35_SESSION_ID,
          "--message",
          `Remember that ${PHASE35_DEPLOY_BLOCKER}`,
          "--json",
        ],
        cwd: workspaceRoot,
        env: managedEnv,
        label: "seed-deploy-blocker",
      },
    ];
    for (const seedCommand of seedCommands) {
      const seedResult = await runCommand(seedCommand);
      commands.push(toExecutionResult(seedCommand, seedResult));
      if (seedResult.exitCode !== 0) {
        throw new Error(`Failed to run ${seedCommand.label}.`);
      }
    }

    const repoOptIn = JSON.parse(
      await readTextFile(join(workspaceRoot, ".goodmemory/codex.json")),
    ) as {
      enabled?: boolean;
      workspaceId?: string;
    };
    const codexToml = await readTextFile(join(homeRoot, ".codex/config.toml"));
    const codexHooksJson = await readTextFile(join(homeRoot, ".codex/hooks.json"));
    const sessionStart = await runRegisteredHookCommand({
      commandName: "session-start",
      env: managedEnv,
      eventName: "SessionStart",
      homeRoot,
      hooksConfig: codexHooksJson,
      label: "codex-hook-session-start",
      runCommand,
      stdin: JSON.stringify({
        cwd: workspaceRoot,
        hook_event_name: "SessionStart",
        session_id: PHASE35_SESSION_ID,
        source: "startup",
      }),
      workspaceRoot,
    });
    commands.push(toExecutionResult(sessionStart.command, sessionStart.result));
    const sessionStartContext = extractHookAdditionalContext(sessionStart.result);

    const userPrompt = await runRegisteredHookCommand({
      commandName: "user-prompt-submit",
      env: managedEnv,
      eventName: "UserPromptSubmit",
      homeRoot,
      hooksConfig: codexHooksJson,
      label: "codex-hook-user-prompt-submit",
      runCommand,
      stdin: JSON.stringify({
        cwd: workspaceRoot,
        hook_event_name: "UserPromptSubmit",
        prompt: PHASE35_QUERY,
        session_id: PHASE35_SESSION_ID,
      }),
      workspaceRoot,
    });
    commands.push(toExecutionResult(userPrompt.command, userPrompt.result));
    const userPromptContext = extractHookAdditionalContext(userPrompt.result);
    const registeredMcpServer = resolveRegisteredCodexMcpServer(codexToml);
    const registeredMcpMatchesManagedConfig =
      registeredMcpServerMatchesManagedConfig(registeredMcpServer, homeRoot);
    let mcpProbe: Phase35McpProbeResult = {
      context: {},
      stats: {
        error:
          "Registered Codex MCP command does not match the GoodMemory-managed install command.",
      },
    };
    if (registeredMcpServer !== null && registeredMcpMatchesManagedConfig) {
      mcpProbe = await probeMcp({
        homeRoot,
        mcpServer: registeredMcpServer,
        query: PHASE35_QUERY,
        sessionId: PHASE35_SESSION_ID,
        workspaceRoot,
      });
    }

    const sessionStartMatchedExpectedFieldCount = [
      PHASE35_CURRENT_GOAL,
      PHASE35_OPEN_LOOP,
    ].reduce(
      (count, needle) => count + (sessionStartContext.includes(needle) ? 1 : 0),
      0,
    );
    const userPromptMatchedExpectedFieldCount = [
      PHASE35_SUMMARY_RULE,
      PHASE35_DEPLOY_BLOCKER,
    ].reduce(
      (count, needle) => count + (userPromptContext.includes(needle) ? 1 : 0),
      0,
    );
    const serializedMcpContext = JSON.stringify(mcpProbe.context);
    const accepted =
      repoOptIn.enabled === true &&
      repoOptIn.workspaceId === PHASE35_WORKSPACE_ID &&
      /^\s*(?:hooks|codex_hooks)\s*=\s*true\s*(?:#.*)?$/mu.test(codexToml) &&
      sessionStart.registeredCommandMatchesManagedConfig &&
      userPrompt.registeredCommandMatchesManagedConfig &&
      registeredMcpMatchesManagedConfig &&
      sessionStart.result.exitCode === 0 &&
      userPrompt.result.exitCode === 0 &&
      sessionStartMatchedExpectedFieldCount === 2 &&
      userPromptMatchedExpectedFieldCount === 2 &&
      serializedMcpContext.includes(PHASE35_SUMMARY_RULE) &&
      serializedMcpContext.includes(PHASE35_DEPLOY_BLOCKER);

    const report: Phase35LiveReport = {
      acceptance: {
        decision: accepted ? "accepted" : "blocked",
        reason: accepted
          ? "Installed-package Codex middleware config, repo opt-in, hook injection, and read-only MCP all worked on the tarball-installed path."
          : "Installed-package Codex middleware config, repo opt-in, hook injection, or MCP probing regressed on the tarball-installed path.",
      },
      commands,
      evidence: {
        hooks: {
          installRegistersHooks:
            sessionStart.registeredCommandMatchesManagedConfig &&
            userPrompt.registeredCommandMatchesManagedConfig,
          sessionStart: {
            context: sessionStartContext,
            matchedExpectedFieldCount: sessionStartMatchedExpectedFieldCount,
            registeredCommandMatchesManagedConfig:
              sessionStart.registeredCommandMatchesManagedConfig,
          },
          userPromptSubmit: {
            context: userPromptContext,
            matchedExpectedFieldCount: userPromptMatchedExpectedFieldCount,
            registeredCommandMatchesManagedConfig:
              userPrompt.registeredCommandMatchesManagedConfig,
          },
        },
        mcp: {
          contextIncludesBlocker: serializedMcpContext.includes(PHASE35_DEPLOY_BLOCKER),
          contextIncludesSummaryRule: serializedMcpContext.includes(PHASE35_SUMMARY_RULE),
          installRegistersMcp: registeredMcpMatchesManagedConfig,
          registeredCommandMatchesManagedConfig: registeredMcpMatchesManagedConfig,
          stats: mcpProbe.stats,
        },
        repoOptIn: {
          enabled: repoOptIn.enabled === true,
          workspaceId: repoOptIn.workspaceId,
        },
        releaseContract: {
          distribution: "tarball-first",
          runtime: "bun-only",
          tarballName,
        },
      },
      evidenceContract: {
        phase35: {
          packageBoundary: "installed_package_public_imports",
          runner: GENERATED_BY,
          runtimePath: "installed_package_user_level_hooks_and_mcp",
        },
      },
      generatedAt: timestamp,
      generatedBy: GENERATED_BY,
      mode: "live-memory",
      outputDir,
      phase: "phase-35",
      runDirectory,
      runId,
    };

    await writeTextFile(
      join(runDirectory, "report.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
    return report;
  } finally {
    await removeDir(packDir, { force: true, recursive: true });
    await removeDir(homeRoot, { force: true, recursive: true });
    await removeDir(workspaceRoot, { force: true, recursive: true });
  }
}

if (import.meta.main) {
  const report = await runPhase35LiveMemoryEvaluation(
    parsePhase35LiveMemoryCliOptions(process.argv),
  );
  console.log(JSON.stringify(report, null, 2));
}
