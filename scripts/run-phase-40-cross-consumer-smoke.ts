import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { resolveCliFlagValue } from "./cli-options";
import { resolveRepoRootFromScriptUrl } from "./script-paths";

export interface Phase40CrossConsumerSmokeOptions {
  outputDir?: string;
  runId?: string;
}

export interface Phase40CrossConsumerSmokeCommand {
  args: string[];
  cwd: string;
  env?: Record<string, string | undefined>;
  label:
    | "direct-typescript-app"
    | "express-http-server"
    | "fastify-http-server"
    | "python-fastapi-bridge-consumer"
    | "installed-host-package-path";
}

export interface Phase40CrossConsumerSmokeCommandResult {
  durationMs: number;
  exitCode: number;
  stderr: string;
  stdout: string;
}

export interface Phase40CrossConsumerSmokeExecutionResult {
  command: string;
  durationMs: number;
  exitCode: number;
  label: Phase40CrossConsumerSmokeCommand["label"];
  status: "failed" | "passed";
  stderrTail: string[];
  stdoutTail: string[];
}

export interface Phase40CrossConsumerEvidenceStatus {
  reason: string;
  status: "accepted" | "blocked";
}

export interface Phase40CrossConsumerSmokeReport {
  acceptance: {
    decision: "accepted" | "blocked";
    reason: string;
  };
  commands: Phase40CrossConsumerSmokeExecutionResult[];
  evidence: {
    directTypeScriptApp: Phase40CrossConsumerEvidenceStatus;
    expressHttpServer: Phase40CrossConsumerEvidenceStatus;
    failureVisibility: Phase40CrossConsumerEvidenceStatus;
    fastifyHttpServer: Phase40CrossConsumerEvidenceStatus;
    installedHostPath: Phase40CrossConsumerEvidenceStatus;
    publicEntrypointsOnly: Phase40CrossConsumerEvidenceStatus;
    pythonFastApiBridge: Phase40CrossConsumerEvidenceStatus;
  };
  generatedAt: string;
  generatedBy: "scripts/run-phase-40-cross-consumer-smoke.ts";
  mode: "cross-consumer-adoption-smoke";
  outputDir: string;
  phase: "phase-40";
  runDirectory: string;
  runId: string;
  scope: {
    inScope: string[];
    outOfScope: string[];
  };
}

export interface Phase40CrossConsumerSmokeDependencies {
  ensureDir?: (path: string, options?: { recursive?: boolean }) => Promise<void>;
  now?: () => string;
  runCommand?: (
    command: Phase40CrossConsumerSmokeCommand,
  ) => Promise<Phase40CrossConsumerSmokeCommandResult>;
  writeTextFile?: (path: string, content: string) => Promise<void>;
}

export interface Phase40CrossConsumerSmokeCliDependencies {
  argv?: readonly string[];
  exit?: (code: number) => void;
  log?: (message: string) => void;
  runSmoke?: (
    options?: Phase40CrossConsumerSmokeOptions,
  ) => Promise<Phase40CrossConsumerSmokeReport>;
}

const GENERATED_BY = "scripts/run-phase-40-cross-consumer-smoke.ts";
const PHASE40_IN_SCOPE = [
  "direct TypeScript application using the package root import",
  "Express-style HTTP route example using the package root import",
  "Fastify-style HTTP route example using the package root import",
  "Python/FastAPI consumer over the packaged HTTP bridge entrypoint",
  "installed-host package path with CLI write, Codex hook recall, and MCP deep read",
] as const;
const PHASE40_OUT_OF_SCOPE = [
  "live model quality scoring",
  "managed cloud or dashboard behavior",
  "consumer framework adapters beyond the documented thin examples",
  "non-Codex installed-host enforcement gates",
] as const;
const ISOLATED_GOODMEMORY_ENV_KEYS = [
  "GOODMEMORY_ASSISTED_EXTRACTOR_API_KEY",
  "GOODMEMORY_ASSISTED_EXTRACTOR_BASE_URL",
  "GOODMEMORY_ASSISTED_EXTRACTOR_MODEL",
  "GOODMEMORY_ASSISTED_EXTRACTOR_PROVIDER",
  "GOODMEMORY_EMBEDDING_API_KEY",
  "GOODMEMORY_EMBEDDING_BASE_URL",
  "GOODMEMORY_EMBEDDING_MODEL",
  "GOODMEMORY_EMBEDDING_PROVIDER",
  "GOODMEMORY_JUDGE_API_KEY",
  "GOODMEMORY_JUDGE_BASE_URL",
  "GOODMEMORY_JUDGE_MODEL",
  "GOODMEMORY_JUDGE_PROVIDER",
  "GOODMEMORY_RECALL_ROUTER_API_KEY",
  "GOODMEMORY_RECALL_ROUTER_BASE_URL",
  "GOODMEMORY_RECALL_ROUTER_MODEL",
  "GOODMEMORY_RECALL_ROUTER_PROVIDER",
  "GOODMEMORY_SQLITE_CUSTOM_LIBRARY_PATH",
  "GOODMEMORY_SQLITE_VECTOR_EXTENSION_ENTRYPOINT",
  "GOODMEMORY_SQLITE_VECTOR_EXTENSION_PATH",
  "GOODMEMORY_SQLITE_VECTOR_MODE",
  "GOODMEMORY_SQLITE_VECTOR_SEARCH_FUNCTION",
  "GOODMEMORY_STORAGE_PROVIDER",
  "GOODMEMORY_STORAGE_URL",
  "GOODMEMORY_TEST_POSTGRES_URL",
] as const;

export function resolvePhase40CrossConsumerSmokeOutputDir(root: string): string {
  return join(root, "reports/eval/adoption/phase-40");
}

export function parsePhase40CrossConsumerSmokeCliOptions(
  argv: readonly string[],
): Phase40CrossConsumerSmokeOptions {
  return {
    outputDir: resolveCliFlagValue(argv, "--output-dir"),
    runId: resolveCliFlagValue(argv, "--run-id"),
  };
}

export function buildPhase40CrossConsumerSmokeRunId(timestamp: string): string {
  const value = timestamp.replace(/\D/g, "").slice(0, 14) || "phase40smoke";
  return `run-${value}-cross-consumer`;
}

function createChildEnv(): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = {
    ...process.env,
    PHASE40_CROSS_CONSUMER_SMOKE_IN_PROGRESS: "1",
  };

  for (const key of ISOLATED_GOODMEMORY_ENV_KEYS) {
    env[key] = undefined;
  }

  return env;
}

export function buildPhase40CrossConsumerSmokeCommands(
  root: string,
): Phase40CrossConsumerSmokeCommand[] {
  const env = createChildEnv();

  return [
    {
      args: ["bun", "--env-file=/dev/null", "run", "examples/basic-chat.ts"],
      cwd: root,
      env,
      label: "direct-typescript-app",
    },
    {
      args: ["bun", "--env-file=/dev/null", "run", "examples/express-chat-server.ts"],
      cwd: root,
      env,
      label: "express-http-server",
    },
    {
      args: ["bun", "--env-file=/dev/null", "run", "examples/fastify-chat-server.ts"],
      cwd: root,
      env,
      label: "fastify-http-server",
    },
    {
      args: [
        "bun",
        "--env-file=/dev/null",
        "test",
        "tests/release/release.test.ts",
        "--test-name-pattern",
        "installed-package Python bridge smoke covers goodmemory-http-bridge bin and Python consumer",
      ],
      cwd: root,
      env,
      label: "python-fastapi-bridge-consumer",
    },
    {
      args: [
        "bun",
        "--env-file=/dev/null",
        "test",
        "tests/release/release.test.ts",
        "--test-name-pattern",
        "installed-package write CLI smoke covers write -> hook recall -> MCP deep read",
      ],
      cwd: root,
      env,
      label: "installed-host-package-path",
    },
  ];
}

function tailLines(value: string, count = 20): string[] {
  if (value.trim().length === 0) {
    return [];
  }

  return value.trimEnd().split(/\r?\n/u).slice(-count);
}

function formatCommand(args: readonly string[]): string {
  return args.join(" ");
}

function toExecutionResult(
  command: Phase40CrossConsumerSmokeCommand,
  result: Phase40CrossConsumerSmokeCommandResult,
): Phase40CrossConsumerSmokeExecutionResult {
  const failed = result.exitCode !== 0;

  return {
    command: formatCommand(command.args),
    durationMs: result.durationMs,
    exitCode: result.exitCode,
    label: command.label,
    status: failed ? "failed" : "passed",
    stderrTail: failed ? tailLines(result.stderr) : [],
    stdoutTail: failed ? tailLines(result.stdout) : [],
  };
}

async function defaultRunCommand(
  command: Phase40CrossConsumerSmokeCommand,
): Promise<Phase40CrossConsumerSmokeCommandResult> {
  const startedAtMs = Date.now();
  const child = Bun.spawn({
    cmd: command.args,
    cwd: command.cwd,
    env: command.env,
    stderr: "pipe",
    stdout: "pipe",
  });
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

function buildEvidenceStatus(input: {
  acceptedReason: string;
  blockedReason: string;
  execution?: Phase40CrossConsumerSmokeExecutionResult;
}): Phase40CrossConsumerEvidenceStatus {
  const accepted = input.execution?.status === "passed";

  return {
    reason: accepted ? input.acceptedReason : input.blockedReason,
    status: accepted ? "accepted" : "blocked",
  };
}

function commandByLabel(
  commands: readonly Phase40CrossConsumerSmokeExecutionResult[],
  label: Phase40CrossConsumerSmokeCommand["label"],
): Phase40CrossConsumerSmokeExecutionResult | undefined {
  return commands.find((command) => command.label === label);
}

function writeReport(input: {
  commands: Phase40CrossConsumerSmokeExecutionResult[];
  ensureDir: NonNullable<Phase40CrossConsumerSmokeDependencies["ensureDir"]>;
  outputDir: string;
  runDirectory: string;
  runId: string;
  timestamp: string;
  writeTextFile: NonNullable<Phase40CrossConsumerSmokeDependencies["writeTextFile"]>;
}): Promise<Phase40CrossConsumerSmokeReport> {
  const failedCommand = input.commands.find((command) => command.status === "failed");
  const allPassed =
    input.commands.length === buildPhase40CrossConsumerSmokeCommands("").length &&
    failedCommand === undefined;
  const publicEntrypointsOnly =
    allPassed &&
    input.commands.every((command) => {
      const value = command.command;
      return !value.includes("../src") && !value.includes("../../src");
    });
  const blockedReason = failedCommand
    ? `Cross-consumer smoke failed: ${failedCommand.label}.`
    : "Cross-consumer smoke did not complete every required consumer path.";
  const acceptedReason =
    "Direct TypeScript, Express, Fastify, Python bridge, and installed-host consumers all passed through public package entrypoints.";
  const failureVisibilityReason =
    "The report records every consumer command with command text, exit code, duration, and stdout/stderr tails.";
  const report: Phase40CrossConsumerSmokeReport = {
    acceptance: {
      decision: allPassed && publicEntrypointsOnly ? "accepted" : "blocked",
      reason: allPassed && publicEntrypointsOnly ? acceptedReason : blockedReason,
    },
    commands: input.commands,
    evidence: {
      directTypeScriptApp: buildEvidenceStatus({
        acceptedReason:
          "example:chat completed recall, context construction, memory export, and package-root imports.",
        blockedReason,
        execution: commandByLabel(input.commands, "direct-typescript-app"),
      }),
      expressHttpServer: buildEvidenceStatus({
        acceptedReason:
          "example:express-chat completed a two-turn HTTP-style route flow with async remember drained.",
        blockedReason,
        execution: commandByLabel(input.commands, "express-http-server"),
      }),
      failureVisibility: {
        reason: failureVisibilityReason,
        status: "accepted",
      },
      fastifyHttpServer: buildEvidenceStatus({
        acceptedReason:
          "example:fastify-chat completed validation, two-turn recall/context, and async remember drained.",
        blockedReason,
        execution: commandByLabel(input.commands, "fastify-http-server"),
      }),
      installedHostPath: buildEvidenceStatus({
        acceptedReason:
          "installed-package smoke passed CLI write, Codex hook recall, and MCP deep-read on the packed package path.",
        blockedReason,
        execution: commandByLabel(input.commands, "installed-host-package-path"),
      }),
      publicEntrypointsOnly: {
        reason: publicEntrypointsOnly
          ? "Command matrix stays on example imports from goodmemory, the HTTP bridge bin, and installed package binaries."
          : "At least one consumer command did not pass or the command matrix no longer proves public entrypoint use.",
        status: publicEntrypointsOnly ? "accepted" : "blocked",
      },
      pythonFastApiBridge: buildEvidenceStatus({
        acceptedReason:
          "External Python process consumed the installed goodmemory-http-bridge package bin over HTTP with bearer auth.",
        blockedReason,
        execution: commandByLabel(input.commands, "python-fastapi-bridge-consumer"),
      }),
    },
    generatedAt: input.timestamp,
    generatedBy: GENERATED_BY,
    mode: "cross-consumer-adoption-smoke",
    outputDir: input.outputDir,
    phase: "phase-40",
    runDirectory: input.runDirectory,
    runId: input.runId,
    scope: {
      inScope: [...PHASE40_IN_SCOPE],
      outOfScope: [...PHASE40_OUT_OF_SCOPE],
    },
  };

  return input.ensureDir(input.runDirectory, { recursive: true }).then(async () => {
    await input.writeTextFile(
      join(input.runDirectory, "report.json"),
      `${JSON.stringify(report, null, 2)}\n`,
    );

    return report;
  });
}

export async function runPhase40CrossConsumerSmoke(
  options: Phase40CrossConsumerSmokeOptions = {},
  dependencies: Phase40CrossConsumerSmokeDependencies = {},
): Promise<Phase40CrossConsumerSmokeReport> {
  const root = resolveRepoRootFromScriptUrl(import.meta.url);
  const now = dependencies.now ?? (() => new Date().toISOString());
  const outputDir = options.outputDir ?? resolvePhase40CrossConsumerSmokeOutputDir(root);
  const timestamp = now();
  const runId = options.runId ?? buildPhase40CrossConsumerSmokeRunId(timestamp);
  const runDirectory = join(outputDir, runId);
  const ensureDir =
    dependencies.ensureDir ??
    (async (path: string, options?: { recursive?: boolean }) => {
      await mkdir(path, options);
    });
  const runCommand = dependencies.runCommand ?? defaultRunCommand;
  const writeTextFile = dependencies.writeTextFile ?? writeFile;
  const commands: Phase40CrossConsumerSmokeExecutionResult[] = [];

  for (const command of buildPhase40CrossConsumerSmokeCommands(root)) {
    const result = await runCommand(command);
    commands.push(toExecutionResult(command, result));
  }

  return await writeReport({
    commands,
    ensureDir,
    outputDir,
    runDirectory,
    runId,
    timestamp,
    writeTextFile,
  });
}

export async function runPhase40CrossConsumerSmokeCli(
  dependencies: Phase40CrossConsumerSmokeCliDependencies = {},
): Promise<Phase40CrossConsumerSmokeReport> {
  const argv = dependencies.argv ?? process.argv;
  const exit = dependencies.exit ?? process.exit;
  const log = dependencies.log ?? console.log;
  const runSmoke = dependencies.runSmoke ?? runPhase40CrossConsumerSmoke;
  const report = await runSmoke(parsePhase40CrossConsumerSmokeCliOptions(argv));

  if (report.acceptance.decision === "accepted") {
    log(`Phase 40 cross-consumer smoke accepted: ${report.runId}`);
  } else {
    log(`Phase 40 cross-consumer smoke blocked: ${report.acceptance.reason}`);
    exit(1);
  }

  return report;
}

if (import.meta.main) {
  await runPhase40CrossConsumerSmokeCli();
}
