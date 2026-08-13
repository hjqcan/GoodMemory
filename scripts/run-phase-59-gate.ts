#!/usr/bin/env bun
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import type { ImplicitMemBenchResearchReport } from "../src/eval/implicitmembench-research";
import type { RawInternalizationDiagnosisSummary } from "../src/eval/implicitmembench-diagnostics";
import { buildRawInternalizationDiagnosisSummary } from "../src/eval/implicitmembench-diagnostics";
import { resolveCliFlagValue } from "./cli-options";
import { PHASE59_CANONICAL_RUN_ID } from "./run-phase-59-eval";
import {
  resolvePhase59FallbackOutputDir,
  resolvePhase59RepoRoot,
} from "./run-phase-59-shared";

export interface Phase59GateOptions {
  outputDir?: string;
  runId?: string;
}

export interface Phase59GateCommand {
  args: string[];
  cwd: string;
  label: string;
}

export interface Phase59GateCommandResult {
  durationMs: number;
  exitCode: number;
  stderr: string;
  stdout: string;
}

export interface Phase59GateExecutionResult {
  command: string;
  durationMs: number;
  exitCode: number;
  label: string;
  status: "failed" | "passed";
  stderrTail: string[];
  stdoutTail: string[];
}

export interface Phase59GateReport {
  acceptance: {
    decision: "accepted" | "blocked";
    reason: string;
  };
  commands: Phase59GateExecutionResult[];
  evidence: {
    deterministicReport: {
      artifactKind: "ignored_generated";
      ignoredReportPath: string;
      regenerateCommand: string;
      status: "accepted" | "blocked";
    };
    rawDiagnosticsArtifact: {
      artifactKind: "ignored_generated";
      ignoredArtifactPath: string;
      regenerateCommand: string;
      status: "accepted" | "blocked";
    };
    rawInternalizationDiagnostics: RawInternalizationDiagnosisSummary;
  };
  generatedAt: string;
  generatedBy: "scripts/run-phase-59-gate.ts";
  phase: "phase-59";
  runDirectory: string;
  runId: string;
}

export interface Phase59GateDependencies {
  ensureDir?: (path: string, options?: { recursive?: boolean }) => Promise<void>;
  now?: () => string;
  readTextFile?: (path: string) => Promise<string>;
  runCommand?: (command: Phase59GateCommand) => Promise<Phase59GateCommandResult>;
  writeTextFile?: (path: string, content: string) => Promise<void>;
}

const GENERATED_BY = "scripts/run-phase-59-gate.ts";
export const PHASE59_CANONICAL_GATE_RUN_ID = "run-20260813090000";
const PHASE59_TARGETED_BLOCKING_CASES = 60;
const PHASE59_TARGETED_DISTILLED_MIN_BLOCKING_PASSES = 56;
const PHASE59_TRANSCRIPT_ONLY_RAW_PASSES = 0;
const PHASE59_TARGETED_MAX_RAW_LEAKS = 0;

function tailLines(value: string, count = 20): string[] {
  if (value.trim().length === 0) {
    return [];
  }

  return value.trimEnd().split(/\r?\n/).slice(-count);
}

function formatCommand(args: readonly string[]): string {
  return args.join(" ");
}

function toRepoRelativePath(root: string, path: string): string {
  const relativePath = relative(root, path);
  return relativePath.length > 0 ? relativePath : ".";
}

async function defaultRunCommand(
  command: Phase59GateCommand,
): Promise<Phase59GateCommandResult> {
  const startedAt = Date.now();
  const process = Bun.spawn(command.args, {
    cwd: command.cwd,
    stderr: "pipe",
    stdout: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);

  return {
    durationMs: Date.now() - startedAt,
    exitCode,
    stderr,
    stdout,
  };
}

async function defaultReadTextFile(path: string): Promise<string> {
  const buffer = await readFile(path);
  return new TextDecoder().decode(buffer);
}

export function resolvePhase59GateOutputDir(root: string): string {
  return join(root, "reports/quality-gates/phase-59");
}

export function resolvePhase59CanonicalFallbackReportPath(root: string): string {
  return join(
    resolvePhase59FallbackOutputDir(root),
    PHASE59_CANONICAL_RUN_ID,
    "report.json",
  );
}

export function parsePhase59GateCliOptions(
  argv: readonly string[],
): Phase59GateOptions {
  return {
    outputDir: resolveCliFlagValue(argv, "--output-dir"),
    runId: resolveCliFlagValue(argv, "--run-id"),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseSmokeReport(
  parsed: unknown,
): ImplicitMemBenchResearchReport | string {
  if (!isRecord(parsed)) {
    return "Phase 59 deterministic report must be a JSON object.";
  }
  if (parsed.kind !== "goodmemory") {
    return "Phase 59 deterministic report must be a GoodMemory research report.";
  }
  if (parsed.mode !== "smoke") {
    return "Phase 59 deterministic report must be a smoke-mode report.";
  }
  if (!isRecord(parsed.profiles)) {
    return "Phase 59 deterministic report must include profiles.";
  }

  return parsed as unknown as ImplicitMemBenchResearchReport;
}

function buildPhase59GateCommands(root: string): Phase59GateCommand[] {
  return [
    {
      args: ["bun", "run", "typecheck"],
      cwd: root,
      label: "typecheck",
    },
    {
      args: [
        "bun",
        "test",
        "tests/unit/eval.phase59.test.ts",
        "tests/unit/evolution.behavioral-policy.test.ts",
        "tests/unit/evolution.raw-behavioral-exemplars.test.ts",
        "tests/unit/implicitmembench-diagnostics.test.ts",
        "tests/unit/implicitmembench-research.test.ts",
        "tests/unit/run-phase-59.script.test.ts",
        "tests/unit/runtime-kit.test.ts",
      ],
      cwd: root,
      label: "phase-59-targeted-regressions",
    },
    {
      args: [
        "bun",
        "run",
        "eval:phase-59",
        "--",
        "--run-id",
        PHASE59_CANONICAL_RUN_ID,
      ],
      cwd: root,
      label: "eval:phase-59",
    },
  ];
}

function emptyDiagnostics(): RawInternalizationDiagnosisSummary {
  return buildRawInternalizationDiagnosisSummary([]);
}

function validatePhase59Evidence(input: {
  report: ImplicitMemBenchResearchReport;
}): {
  accepted: boolean;
  reason: string;
  summary: RawInternalizationDiagnosisSummary;
} {
  const raw = input.report.profiles["goodmemory-raw-experience"];
  const distilled = input.report.profiles["goodmemory-distilled-feedback"];
  const summary = buildRawInternalizationDiagnosisSummary([input.report]);
  const rawCasesFailClosed =
    raw?.cases.length === PHASE59_TARGETED_BLOCKING_CASES &&
    raw.cases.every(
      (caseResult) =>
        caseResult.rawCarryover?.abstainReason === "no_candidates" &&
        caseResult.rawCarryover.candidatePrototypeIds.length === 0 &&
        caseResult.rawCarryover.selectedPrototypeIds.length === 0,
    );
  const accepted =
    input.report.summary.executionFailures === 0 &&
    (raw?.totalBlockingCases ?? 0) === PHASE59_TARGETED_BLOCKING_CASES &&
    (raw?.executionFailures ?? 0) === 0 &&
    (raw?.explicitRecallLeakCount ?? 0) <= PHASE59_TARGETED_MAX_RAW_LEAKS &&
    (raw?.passedBlockingCases ?? 0) === PHASE59_TRANSCRIPT_ONLY_RAW_PASSES &&
    rawCasesFailClosed &&
    (distilled?.totalBlockingCases ?? 0) === PHASE59_TARGETED_BLOCKING_CASES &&
    (distilled?.executionFailures ?? 0) === 0 &&
    (distilled?.passedBlockingCases ?? 0) >= PHASE59_TARGETED_DISTILLED_MIN_BLOCKING_PASSES;

  return {
    accepted,
    reason: accepted
      ? "Phase 59 transcript-only raw fixtures failed closed and the distilled profile passed the deterministic gate."
      : "Phase 59 deterministic evidence violated the transcript-only raw fail-closed boundary or the distilled coverage floor.",
    summary,
  };
}

async function writeGateReport(input: {
  commands: Phase59GateExecutionResult[];
  decision: "accepted" | "blocked";
  deterministicReportPath: string;
  diagnostics: RawInternalizationDiagnosisSummary;
  now: () => string;
  reason: string;
  root: string;
  runDirectory: string;
  runId: string;
  writeTextFile: (path: string, content: string) => Promise<void>;
}): Promise<Phase59GateReport> {
  const report: Phase59GateReport = {
    acceptance: {
      decision: input.decision,
      reason: input.reason,
    },
    commands: input.commands,
    evidence: {
      deterministicReport: {
        artifactKind: "ignored_generated",
        ignoredReportPath: toRepoRelativePath(input.root, input.deterministicReportPath),
        regenerateCommand: `bun run eval:phase-59 -- --run-id ${PHASE59_CANONICAL_RUN_ID}`,
        status: input.decision,
      },
      rawDiagnosticsArtifact: {
        artifactKind: "ignored_generated",
        ignoredArtifactPath: toRepoRelativePath(
          input.root,
          join(input.deterministicReportPath, "..", "raw-diagnostics.json"),
        ),
        regenerateCommand:
          `bun run eval:phase-59-diagnostics -- --run-id ${PHASE59_CANONICAL_RUN_ID} --report ${toRepoRelativePath(input.root, input.deterministicReportPath)} --output ${toRepoRelativePath(input.root, join(input.deterministicReportPath, "..", "raw-diagnostics.json"))}`,
        status: input.decision,
      },
      rawInternalizationDiagnostics: input.diagnostics,
    },
    generatedAt: input.now(),
    generatedBy: GENERATED_BY,
    phase: "phase-59",
    runDirectory: input.runDirectory,
    runId: input.runId,
  };
  await input.writeTextFile(
    join(input.runDirectory, "phase-59-quality-gate.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );

  return report;
}

export async function runPhase59Gate(
  options?: Phase59GateOptions,
  dependencies?: Phase59GateDependencies,
): Promise<Phase59GateReport> {
  const root = resolvePhase59RepoRoot();
  const runId = options?.runId ?? PHASE59_CANONICAL_GATE_RUN_ID;
  const outputDir = resolve(options?.outputDir ?? resolvePhase59GateOutputDir(root));
  const runDirectory = join(outputDir, runId);
  const ensureDir = dependencies?.ensureDir ?? mkdir;
  const readTextFile = dependencies?.readTextFile ?? defaultReadTextFile;
  const runCommand = dependencies?.runCommand ?? defaultRunCommand;
  const writeTextFile = dependencies?.writeTextFile ?? writeFile;
  const now = dependencies?.now ?? (() => new Date().toISOString());
  const canonicalFallbackReportPath = resolvePhase59CanonicalFallbackReportPath(root);

  await ensureDir(runDirectory, { recursive: true });
  const commands: Phase59GateExecutionResult[] = [];

  for (const command of buildPhase59GateCommands(root)) {
    const result = await runCommand(command);
    commands.push({
      command: formatCommand(command.args),
      durationMs: result.durationMs,
      exitCode: result.exitCode,
      label: command.label,
      status: result.exitCode === 0 ? "passed" : "failed",
      stderrTail: tailLines(result.stderr),
      stdoutTail: tailLines(result.stdout),
    });
    if (result.exitCode !== 0) {
      return writeGateReport({
        commands,
        decision: "blocked",
        deterministicReportPath: canonicalFallbackReportPath,
        diagnostics: emptyDiagnostics(),
        now,
        reason: `Phase 59 gate command failed: ${command.label}`,
        root,
        runDirectory,
        runId,
        writeTextFile,
      });
    }
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(await readTextFile(canonicalFallbackReportPath));
  } catch (error) {
    return writeGateReport({
      commands,
      decision: "blocked",
      deterministicReportPath: canonicalFallbackReportPath,
      diagnostics: emptyDiagnostics(),
      now,
      reason: `Phase 59 deterministic report is missing or unreadable: ${error instanceof Error ? error.message : String(error)}`,
      root,
      runDirectory,
      runId,
      writeTextFile,
    });
  }

  const report = parseSmokeReport(parsed);
  if (typeof report === "string") {
    return writeGateReport({
      commands,
      decision: "blocked",
      deterministicReportPath: canonicalFallbackReportPath,
      diagnostics: emptyDiagnostics(),
      now,
      reason: report,
      root,
      runDirectory,
      runId,
      writeTextFile,
    });
  }

  const evidence = validatePhase59Evidence({ report });
  return writeGateReport({
    commands,
    decision: evidence.accepted ? "accepted" : "blocked",
    deterministicReportPath: canonicalFallbackReportPath,
    diagnostics: evidence.summary,
    now,
    reason: evidence.reason,
    root,
    runDirectory,
    runId,
    writeTextFile,
  });
}

async function main(): Promise<void> {
  const report = await runPhase59Gate(parsePhase59GateCliOptions(process.argv));
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.acceptance.decision === "accepted" ? 0 : 1);
}

if (import.meta.main) {
  await main();
}
