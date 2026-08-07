import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { resolveCliFlagValue } from "./cli-options";
import { resolveRepoRootFromScriptUrl } from "./script-paths";

export interface Phase19MaintenanceGateCommand {
  args: string[];
  cwd: string;
  label: string;
}

export interface Phase19MaintenanceGateCommandResult {
  durationMs: number;
  exitCode: number;
  stderr: string;
  stdout: string;
}

export interface Phase19MaintenanceGateExecutionResult {
  command: string;
  durationMs: number;
  exitCode: number;
  label: string;
  status: "failed" | "passed";
  stderrTail: string[];
  stdoutTail: string[];
}

export interface Phase19MaintenanceGateReport {
  acceptance: {
    decision: "accepted" | "blocked";
    reason: string;
  };
  commands: Phase19MaintenanceGateExecutionResult[];
  generatedAt: string;
  generatedBy: string;
  phase: "phase-19-maintenance";
  runDirectory: string;
  runId: string;
  scope: {
    inScope: string[];
    outOfScope: string[];
  };
}

export interface Phase19MaintenanceGateOptions {
  outputDir?: string;
  runId?: string;
}

export interface Phase19MaintenanceGateDependencies {
  ensureDir?: (
    path: string,
    options?: {
      recursive?: boolean;
    },
  ) => Promise<void>;
  now?: () => string;
  runCommand?: (
    command: Phase19MaintenanceGateCommand,
  ) => Promise<Phase19MaintenanceGateCommandResult>;
  writeTextFile?: (path: string, content: string) => Promise<void>;
}

const GENERATED_BY = "scripts/run-phase-19-maintenance-gate.ts";

function tailLines(value: string, count = 20): string[] {
  if (value.trim().length === 0) {
    return [];
  }

  return value.trimEnd().split(/\r?\n/).slice(-count);
}

function formatCommand(args: readonly string[]): string {
  return args.join(" ");
}

export function resolvePhase19MaintenanceGateOutputDir(root: string): string {
  return join(root, "reports/quality-gates/phase-19-maintenance");
}

export function buildPhase19MaintenanceGateCommands(
  root: string,
): Phase19MaintenanceGateCommand[] {
  return [
    {
      label: "typecheck",
      cwd: root,
      args: ["bun", "run", "typecheck"],
    },
    {
      label: "maintenance-rollout-regressions",
      cwd: root,
      args: [
        "bun",
        "test",
        "tests/eval/runners.test.ts",
        "tests/eval/suite.test.ts",
        "tests/eval/reporting.test.ts",
        "tests/unit/maintenance.dream.test.ts",
        "tests/integration/maintenance.api.test.ts",
      ],
    },
    {
      label: "retrieval-rollout-regressions",
      cwd: root,
      args: [
        "bun",
        "test",
        "tests/unit/eval.strategy-rollout.test.ts",
        "tests/unit/eval.strategy-promotion-gate.test.ts",
      ],
    },
    {
      label: "host-adapter-regressions",
      cwd: root,
      args: [
        "bun",
        "test",
        "tests/unit/markdown-artifacts.test.ts",
        "tests/unit/host.adapter.test.ts",
        "tests/unit/host.writeback.test.ts",
        "tests/examples/examples.test.ts",
        "tests/release/release.test.ts",
      ],
    },
    {
      label: "host-example-claude",
      cwd: root,
      args: ["bun", "run", "example:host-claude"],
    },
    {
      label: "host-example-codex",
      cwd: root,
      args: ["bun", "run", "example:host-codex"],
    },
  ];
}

async function defaultRunCommand(
  command: Phase19MaintenanceGateCommand,
): Promise<Phase19MaintenanceGateCommandResult> {
  const startedAtMs = Date.now();
  const process = Bun.spawn({
    cmd: command.args,
    cwd: command.cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdoutPromise = new Response(process.stdout).text();
  const stderrPromise = new Response(process.stderr).text();
  const [exitCode, stdout, stderr] = await Promise.all([
    process.exited,
    stdoutPromise,
    stderrPromise,
  ]);
  const finishedAtMs = Date.now();

  return {
    durationMs: finishedAtMs - startedAtMs,
    exitCode,
    stderr,
    stdout,
  };
}

function buildRunId(generatedAt: string): string {
  const compact = generatedAt.replace(/\D/g, "").slice(0, 14);
  return `run-${compact || "phase19maintenance"}`;
}

export async function runPhase19MaintenanceQualityGate(
  input?: Phase19MaintenanceGateOptions,
  dependencies?: Phase19MaintenanceGateDependencies,
): Promise<Phase19MaintenanceGateReport> {
  const root = resolveRepoRootFromScriptUrl(import.meta.url);
  const ensureDir = dependencies?.ensureDir ?? mkdir;
  const now = dependencies?.now ?? (() => new Date().toISOString());
  const runCommand = dependencies?.runCommand ?? defaultRunCommand;
  const writeTextFile = dependencies?.writeTextFile ?? writeFile;
  const generatedAt = now();
  const runId = input?.runId ?? buildRunId(generatedAt);
  const outputDir = input?.outputDir ?? resolvePhase19MaintenanceGateOutputDir(root);
  const runDirectory = join(outputDir, runId);
  const commandResults: Phase19MaintenanceGateExecutionResult[] = [];
  const commands = buildPhase19MaintenanceGateCommands(root);

  for (const command of commands) {
    const result = await runCommand(command);
    commandResults.push({
      label: command.label,
      command: formatCommand(command.args),
      durationMs: result.durationMs,
      exitCode: result.exitCode,
      status: result.exitCode === 0 ? "passed" : "failed",
      stdoutTail: tailLines(result.stdout),
      stderrTail: tailLines(result.stderr),
    });

    if (result.exitCode !== 0) {
      break;
    }
  }

  const failedCommand = commandResults.find((result) => result.status === "failed");
  const report: Phase19MaintenanceGateReport = {
    phase: "phase-19-maintenance",
    generatedAt,
    generatedBy: GENERATED_BY,
    runId,
    runDirectory,
    commands: commandResults,
    scope: {
      inScope: [
        "maintenance rollout family observe/assist/promote lifecycle",
        "public runMaintenance eval-only candidate execution path",
        "retrieval rollout regression coverage required by the maintenance family",
        "phase-18 host-adapter public-path regressions",
      ],
      outOfScope: [
        "reviewer rollout family closure",
        "public config widening for maintenance controls",
        "non-deterministic live-model acceptance",
      ],
    },
    acceptance: failedCommand
      ? {
          decision: "blocked",
          reason: `Required regression command failed: ${failedCommand.label}`,
        }
      : {
          decision: "accepted",
          reason:
            "Phase 19 maintenance rollout is regression-covered on top of the closed retrieval and host surfaces.",
        },
  };

  await ensureDir(runDirectory, { recursive: true });
  await writeTextFile(
    join(runDirectory, "phase-19-maintenance-quality-gate.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );

  return report;
}

function parsePhase19MaintenanceGateCliOptions(
  argv: readonly string[],
): Phase19MaintenanceGateOptions {
  return {
    outputDir: resolveCliFlagValue(argv, "--output-dir"),
    runId: resolveCliFlagValue(argv, "--run-id"),
  };
}

async function main(): Promise<void> {
  const report = await runPhase19MaintenanceQualityGate(
    parsePhase19MaintenanceGateCliOptions(process.argv),
  );
  console.log(JSON.stringify(report, null, 2));

  if (report.acceptance.decision !== "accepted") {
    process.exit(1);
  }
}

if (import.meta.main) {
  await main();
}
