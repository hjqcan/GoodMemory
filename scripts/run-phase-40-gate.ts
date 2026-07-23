import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { resolveCliFlagValue } from "./cli-options";
import { resolveRepoRootFromScriptUrl } from "./script-paths";

export interface Phase40GateCommand {
  args: string[];
  cwd: string;
  label:
    | "phase-40-release-regressions"
    | "ci-regression-gate"
    | "node-package-boundary-smoke"
    | "cross-consumer-adoption-smoke"
    | "product-eval-rollup"
    | "pack-dry-run"
    | "release-rc-dry-run";
}

export interface Phase40GateCommandResult {
  durationMs: number;
  exitCode: number;
  stderr: string;
  stdout: string;
}

export interface Phase40GateExecutionResult {
  command: string;
  durationMs: number;
  exitCode: number;
  label: Phase40GateCommand["label"];
  status: "failed" | "passed";
  stderrTail: string[];
  stdoutTail: string[];
}

export interface Phase40EvidenceStatus {
  path?: string;
  reason: string;
  status: "accepted" | "blocked";
}

export interface Phase40GateReport {
  acceptance: {
    decision: "accepted" | "blocked";
    reason: string;
  };
  commands: Phase40GateExecutionResult[];
  evidence: {
    ciRegression: Phase40EvidenceStatus;
    crossConsumerAdoption: Phase40EvidenceStatus;
    externalTarballConsumer: Phase40EvidenceStatus;
    nodePackageBoundary: Phase40EvidenceStatus;
    outOfScopeBoundaries: Phase40EvidenceStatus;
    packDryRun: Phase40EvidenceStatus;
    phase39Gate: Phase40EvidenceStatus;
    productEval: Phase40EvidenceStatus;
    releaseChecklistAndStatus: Phase40EvidenceStatus;
    releaseDryRun: Phase40EvidenceStatus;
  };
  generatedAt: string;
  generatedBy: "scripts/run-phase-40-gate.ts";
  phase: "phase-40";
  releaseCandidate: {
    evidencePaths: string[];
    version: string;
  };
  runDirectory: string;
  runId: string;
  scope: {
    inScope: string[];
    outOfScope: string[];
  };
}

export interface Phase40GateOptions {
  outputDir?: string;
  runId?: string;
}

export interface Phase40GateDependencies {
  ensureDir?: (path: string, options?: { recursive?: boolean }) => Promise<void>;
  now?: () => string;
  readTextFile?: (path: string) => Promise<string>;
  runCommand?: (command: Phase40GateCommand) => Promise<Phase40GateCommandResult>;
  writeTextFile?: (path: string, content: string) => Promise<void>;
}

export interface Phase40GateCliDependencies {
  argv?: readonly string[];
  exit?: (code: number) => void;
  log?: (message: string) => void;
  runGate?: (options?: Phase40GateOptions) => Promise<Phase40GateReport>;
}

interface Phase40EvidenceInputs {
  crossConsumerAccepted: boolean;
  crossConsumerPath: string;
  phase39Accepted: boolean;
  phase39Path: string;
  productAccepted: boolean;
  productPath: string;
  version: string;
}

const GENERATED_BY = "scripts/run-phase-40-gate.ts";
const DEFAULT_PHASE39_GATE_PATH =
  "reports/quality-gates/phase-39/run-20260425041112/phase-39-quality-gate.json";
const DEFAULT_CROSS_CONSUMER_REPORT_PATH =
  "reports/eval/adoption/phase-40/run-20260425163012-cross-consumer/report.json";
const DEFAULT_PRODUCT_REPORT_PATH =
  "reports/eval/product/phase-40/run-20260425165544-product-eval/report.json";
const EXPECTED_CROSS_CONSUMER_EVIDENCE = [
  "directTypeScriptApp",
  "expressHttpServer",
  "failureVisibility",
  "fastifyHttpServer",
  "installedHostPath",
  "publicEntrypointsOnly",
  "pythonFastApiBridge",
] as const;
const EXPECTED_CROSS_CONSUMER_COMMANDS = [
  {
    command: "bun --env-file=/dev/null run examples/basic-chat.ts",
    label: "direct-typescript-app",
  },
  {
    command: "bun --env-file=/dev/null run examples/express-chat-server.ts",
    label: "express-http-server",
  },
  {
    command: "bun --env-file=/dev/null run examples/fastify-chat-server.ts",
    label: "fastify-http-server",
  },
  {
    command:
      "bun --env-file=/dev/null test tests/release/release.test.ts --test-name-pattern installed-package Python bridge smoke covers goodmemory-http-bridge bin and Python consumer",
    label: "python-fastapi-bridge-consumer",
  },
  {
    command:
      "bun --env-file=/dev/null test tests/release/release.test.ts --test-name-pattern installed-package write CLI smoke covers write -> hook recall -> MCP deep read",
    label: "installed-host-package-path",
  },
] as const;
const EXPECTED_PRODUCT_TRACE_EVIDENCE = [
  "whyBlocked",
  "whyRecalled",
  "whyRemembered",
  "whyRevised",
] as const;
const EXPECTED_PRODUCT_CASES = [
  {
    expectedSignals: ["profile.name", "background.role"],
    focus: "identity_background",
    wrongSignalLabels: ["wrong.role"],
  },
  {
    expectedSignals: ["phase40.next_step", "phase40.release_gate"],
    focus: "historical_task_continuation",
    wrongSignalLabels: ["wrong.next_step"],
  },
  {
    expectedSignals: ["runtime.open_loop", "runtime.journal_state"],
    focus: "open_loop_recall",
    wrongSignalLabels: ["wrong.open_loop"],
  },
  {
    expectedSignals: ["editor.current"],
    focus: "user_correction",
    wrongSignalLabels: ["editor.stale"],
  },
  {
    expectedSignals: ["feedback.summary_style"],
    focus: "feedback_procedural_learning",
    wrongSignalLabels: ["wrong.summary_style"],
  },
  {
    expectedSignals: ["background.fact"],
    focus: "background_remember",
    wrongSignalLabels: ["wrong.background"],
  },
] as const;
const PHASE40_RELEASE_REGRESSION_PATTERN =
  "phase-40|package metadata exposes bin, exports, and key scripts|release checklist exists and covers the final gate|release workflow uses manual plus stable tag triggers, gate:phase-40, and tarball artifact upload|ci workflow runs the node package boundary matrix on Node 20, 22, and 24";
const STABLE_RELEASE_VERSION_PATTERN = /^\d+\.\d+\.\d+$/u;
const PHASE40_IN_SCOPE = [
  "Phase 39 accepted gate as release input",
  "stable package metadata and release workflow evidence",
  "cross-consumer adoption smoke",
  "product eval rollup versus no-memory baseline",
  "test:ci, Node package-boundary smoke, pack dry run, and release dry run",
  "release checklist, current status, and task-board closure evidence",
] as const;
const PHASE40_OUT_OF_SCOPE = [
  "query-resolved revise targets",
  "raw CRUD memory APIs",
  "remember background mode overloads",
  "public router provider config",
  "dashboard, managed cloud, or analytics product",
  "default-on writeback",
  "raw transcript archive",
  "built-in OneLife preset",
] as const;

export function parsePhase40GateCliOptions(
  argv: readonly string[],
): Phase40GateOptions {
  return {
    outputDir: resolveCliFlagValue(argv, "--output-dir"),
    runId: resolveCliFlagValue(argv, "--run-id"),
  };
}

export function resolvePhase40GateOutputDir(root: string): string {
  return join(root, "reports/quality-gates/phase-40");
}

export function buildPhase40GateRunId(now: string): string {
  const date = new Date(now);
  const pad = (part: number): string => String(part).padStart(2, "0");

  return `run-${[
    date.getUTCFullYear(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate()),
    pad(date.getUTCHours()),
    pad(date.getUTCMinutes()),
    pad(date.getUTCSeconds()),
  ].join("")}`;
}

export function buildPhase40GateCommands(root: string): Phase40GateCommand[] {
  return [
    {
      args: [
        "bun",
        "test",
        "tests/unit/run-phase-40.gate.test.ts",
        "tests/unit/run-phase-40.cross-consumer-smoke.test.ts",
        "tests/unit/run-phase-40.product-eval.test.ts",
        "tests/release/release.test.ts",
        "--test-name-pattern",
        PHASE40_RELEASE_REGRESSION_PATTERN,
      ],
      cwd: root,
      label: "phase-40-release-regressions",
    },
    {
      args: ["bun", "run", "test:ci"],
      cwd: root,
      label: "ci-regression-gate",
    },
    {
      args: ["bun", "test", "tests/release/node-package-boundary.test.ts"],
      cwd: root,
      label: "node-package-boundary-smoke",
    },
    {
      args: [
        "bun",
        "run",
        "eval:phase-40-cross-consumer",
        "--",
        "--run-id",
        "run-20260425163012-cross-consumer",
      ],
      cwd: root,
      label: "cross-consumer-adoption-smoke",
    },
    {
      args: [
        "bun",
        "run",
        "eval:phase-40-product",
        "--",
        "--run-id",
        "run-20260425165544-product-eval",
      ],
      cwd: root,
      label: "product-eval-rollup",
    },
    {
      args: ["bun", "pm", "pack", "--dry-run"],
      cwd: root,
      label: "pack-dry-run",
    },
    {
      args: [
        "bun",
        "run",
        "release:rc-dry-run",
        "--",
        "--output-dir",
        join(root, ".tmp-goodmemory-phase40/quality-gates/phase-29"),
        "--run-id",
        "run-phase40-release-dry-run",
      ],
      cwd: root,
      label: "release-rc-dry-run",
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

function createChildEnv(): Record<string, string> {
  const env = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] =>
      entry[1] !== undefined
    ),
  );
  env.PHASE40_GATE_IN_PROGRESS = "1";

  return env;
}

function toExecutionResult(
  command: Phase40GateCommand,
  result: Phase40GateCommandResult,
): Phase40GateExecutionResult {
  const tailCount = result.exitCode === 0 ? 20 : 600;

  return {
    command: formatCommand(command.args),
    durationMs: result.durationMs,
    exitCode: result.exitCode,
    label: command.label,
    status: result.exitCode === 0 ? "passed" : "failed",
    stderrTail: tailLines(result.stderr, tailCount),
    stdoutTail: tailLines(result.stdout, tailCount),
  };
}

async function defaultRunCommand(
  command: Phase40GateCommand,
): Promise<Phase40GateCommandResult> {
  const startedAtMs = Date.now();
  const child = Bun.spawn({
    cmd: command.args,
    cwd: command.cwd,
    env: createChildEnv(),
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJsonObject(content: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(content);
  if (!isRecord(parsed)) {
    throw new Error("Expected JSON object evidence.");
  }

  return parsed;
}

function acceptedDecision(report: Record<string, unknown>): boolean {
  const acceptance = report.acceptance;
  return isRecord(acceptance) && acceptance.decision === "accepted";
}

function requiredEvidenceStatusesAccepted(
  report: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const evidence = report.evidence;
  if (!isRecord(evidence)) {
    return false;
  }

  return keys.every(
    (key) => isRecord(evidence[key]) && evidence[key]?.status === "accepted",
  );
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function sameStrings(value: unknown, expected: readonly string[]): boolean {
  return (
    stringArray(value) &&
    value.length === expected.length &&
    expected.every((item, index) => value[index] === item)
  );
}

function crossConsumerCommandsAccepted(report: Record<string, unknown>): boolean {
  const commands = report.commands;
  if (
    !Array.isArray(commands) ||
    commands.length !== EXPECTED_CROSS_CONSUMER_COMMANDS.length
  ) {
    return false;
  }

  return EXPECTED_CROSS_CONSUMER_COMMANDS.every((expected, index) => {
    const command = commands[index];
    return (
      isRecord(command) &&
      command.label === expected.label &&
      command.command === expected.command &&
      command.status === "passed" &&
      command.exitCode === 0 &&
      typeof command.durationMs === "number" &&
      command.durationMs >= 0 &&
      Array.isArray(command.stdoutTail) &&
      Array.isArray(command.stderrTail)
    );
  });
}

function crossConsumerReportAccepted(report: Record<string, unknown>): boolean {
  return (
    report.phase === "phase-40" &&
    report.mode === "cross-consumer-adoption-smoke" &&
    report.runId === "run-20260425163012-cross-consumer" &&
    report.generatedBy === "scripts/run-phase-40-cross-consumer-smoke.ts" &&
    acceptedDecision(report) &&
    requiredEvidenceStatusesAccepted(report, EXPECTED_CROSS_CONSUMER_EVIDENCE) &&
    crossConsumerCommandsAccepted(report)
  );
}

function requiredTraceEvidenceAccepted(report: Record<string, unknown>): boolean {
  const evidence = report.traceEvidence;
  if (!isRecord(evidence)) {
    return false;
  }

  return EXPECTED_PRODUCT_TRACE_EVIDENCE.every(
    (key) => isRecord(evidence[key]) && evidence[key]?.status === "accepted",
  );
}

function productCasesAccepted(report: Record<string, unknown>): boolean {
  const cases = report.cases;
  if (!Array.isArray(cases) || cases.length !== EXPECTED_PRODUCT_CASES.length) {
    return false;
  }

  return EXPECTED_PRODUCT_CASES.every((expected, index) => {
    const caseResult = cases[index];
    if (
      !isRecord(caseResult) ||
      caseResult.focus !== expected.focus ||
      caseResult.passed !== true
    ) {
      return false;
    }
    const goodMemory = caseResult.goodMemory;
    const noMemory = caseResult.noMemory;

    return (
      isRecord(goodMemory) &&
      isRecord(noMemory) &&
      sameStrings(goodMemory.matchedSignals, expected.expectedSignals) &&
      stringArray(goodMemory.missedSignals) &&
      goodMemory.missedSignals.length === 0 &&
      stringArray(goodMemory.wrongSignals) &&
      goodMemory.wrongSignals.length === 0 &&
      typeof goodMemory.traceId === "string" &&
      goodMemory.traceId.length > 0 &&
      stringArray(noMemory.matchedSignals) &&
      noMemory.matchedSignals.length === 0 &&
      sameStrings(noMemory.missedSignals, expected.expectedSignals) &&
      stringArray(noMemory.wrongSignals) &&
      noMemory.wrongSignals.length === 0 &&
      sameStrings(caseResult.expectedSignals, expected.expectedSignals) &&
      sameStrings(caseResult.wrongSignalLabels, expected.wrongSignalLabels)
    );
  });
}

function productMetricsAccepted(report: Record<string, unknown>): boolean {
  const metrics = report.metrics;
  if (!isRecord(metrics)) {
    return false;
  }
  const correctness = metrics.correctness;
  const quality = metrics.productQuality;
  const raw = report.rawTranscriptPersistence;
  const variants = report.variants;
  if (
    !isRecord(correctness) ||
    !isRecord(quality) ||
    !isRecord(raw) ||
    !isRecord(variants)
  ) {
    return false;
  }
  const noMemory = variants.noMemory;
  const withGoodMemory = variants.withGoodMemory;

  return (
    Number(correctness.continuityUplift) > 0 &&
    correctness.missedRecallRate === 0 &&
    correctness.wrongRecallRate === 0 &&
    correctness.correctionSuccessRate === 1 &&
    correctness.goodMemoryPassCount === EXPECTED_PRODUCT_CASES.length &&
    correctness.noMemoryPassCount === 0 &&
    correctness.totalCases === EXPECTED_PRODUCT_CASES.length &&
    quality.backgroundJobFailureVisibility === 1 &&
    quality.duplicateMemoryRate === 0 &&
    quality.policyBlockExplainability === 1 &&
    quality.traceCompletenessRate === 1 &&
    raw.defaultRuntimeArchive === "off" &&
    raw.persistedRawTranscripts === false &&
    isRecord(noMemory) &&
    noMemory.mode === "no-memory" &&
    isRecord(withGoodMemory) &&
    withGoodMemory.mode === "with-goodmemory" &&
    requiredTraceEvidenceAccepted(report) &&
    productCasesAccepted(report)
  );
}

function productReportAccepted(report: Record<string, unknown>): boolean {
  return (
    report.phase === "phase-40" &&
    report.mode === "product-eval-rollup" &&
    report.runId === "run-20260425165544-product-eval" &&
    report.generatedBy === "scripts/run-phase-40-product-eval.ts" &&
    acceptedDecision(report) &&
    productMetricsAccepted(report)
  );
}

async function readRequiredEvidence(input: {
  readTextFile: NonNullable<Phase40GateDependencies["readTextFile"]>;
  root: string;
}): Promise<Phase40EvidenceInputs> {
  const phase39Path = join(input.root, DEFAULT_PHASE39_GATE_PATH);
  const crossConsumerPath = join(input.root, DEFAULT_CROSS_CONSUMER_REPORT_PATH);
  const productPath = join(input.root, DEFAULT_PRODUCT_REPORT_PATH);
  const packageJson = parseJsonObject(
    await input.readTextFile(join(input.root, "package.json")),
  );
  const phase39 = parseJsonObject(await input.readTextFile(phase39Path));
  const crossConsumer = parseJsonObject(await input.readTextFile(crossConsumerPath));
  const product = parseJsonObject(await input.readTextFile(productPath));

  return {
    crossConsumerAccepted: crossConsumerReportAccepted(crossConsumer),
    crossConsumerPath: DEFAULT_CROSS_CONSUMER_REPORT_PATH,
    phase39Accepted:
      phase39.runId === "run-20260425041112" && acceptedDecision(phase39),
    phase39Path: DEFAULT_PHASE39_GATE_PATH,
    productAccepted: productReportAccepted(product),
    productPath: DEFAULT_PRODUCT_REPORT_PATH,
    version: typeof packageJson.version === "string" ? packageJson.version : "unknown",
  };
}

function commandPassed(
  commands: readonly Phase40GateExecutionResult[],
  label: Phase40GateCommand["label"],
): boolean {
  return commands.some((command) => command.label === label && command.status === "passed");
}

function isPhase40StableReleaseVersion(version: string | undefined): boolean {
  return version !== undefined && STABLE_RELEASE_VERSION_PATTERN.test(version);
}

function evidenceStatus(input: {
  accepted: boolean;
  acceptedReason: string;
  blockedReason: string;
  path?: string;
}): Phase40EvidenceStatus {
  return {
    ...(input.path ? { path: input.path } : {}),
    reason: input.accepted ? input.acceptedReason : input.blockedReason,
    status: input.accepted ? "accepted" : "blocked",
  };
}

async function writeReport(input: {
  commands: Phase40GateExecutionResult[];
  ensureDir: NonNullable<Phase40GateDependencies["ensureDir"]>;
  evidenceInput: Phase40EvidenceInputs | null;
  evidenceReadError: string | null;
  now: NonNullable<Phase40GateDependencies["now"]>;
  outputPath: string;
  runDirectory: string;
  runId: string;
  writeTextFile: NonNullable<Phase40GateDependencies["writeTextFile"]>;
}): Promise<Phase40GateReport> {
  const failedCommand = input.commands.find((command) => command.status === "failed");
  const blockedReason = failedCommand
    ? `Required Phase 40 command failed: ${failedCommand.label}.`
    : input.evidenceReadError
      ? `Required Phase 40 evidence could not be read: ${input.evidenceReadError}`
      : "Phase 40 release-candidate evidence did not complete.";
  const evidenceInput = input.evidenceInput;
  const commandEvidenceBlockedReason = failedCommand
    ? blockedReason
    : "Required Phase 40 command did not run or did not pass.";
  const phase39Accepted = evidenceInput?.phase39Accepted === true;
  const crossConsumerAccepted = evidenceInput?.crossConsumerAccepted === true;
  const productAccepted = evidenceInput?.productAccepted === true;
  const versionAccepted = isPhase40StableReleaseVersion(evidenceInput?.version);
  const ciAccepted = commandPassed(input.commands, "ci-regression-gate");
  const nodeBoundaryAccepted = commandPassed(input.commands, "node-package-boundary-smoke");
  const regressionsAccepted = commandPassed(input.commands, "phase-40-release-regressions");
  const packAccepted = commandPassed(input.commands, "pack-dry-run");
  const releaseDryRunAccepted = commandPassed(input.commands, "release-rc-dry-run");
  const evidence = {
    ciRegression: evidenceStatus({
      accepted: ciAccepted,
      acceptedReason: "bun run test:ci passed inside the Phase 40 gate.",
      blockedReason: commandEvidenceBlockedReason,
    }),
    crossConsumerAdoption: evidenceStatus({
      accepted:
        crossConsumerAccepted && commandPassed(input.commands, "cross-consumer-adoption-smoke"),
      acceptedReason:
        "Cross-consumer adoption smoke report is accepted and was refreshed by the gate.",
      blockedReason,
      path: evidenceInput?.crossConsumerPath ?? DEFAULT_CROSS_CONSUMER_REPORT_PATH,
    }),
    externalTarballConsumer: evidenceStatus({
      accepted: nodeBoundaryAccepted,
      acceptedReason:
        "Node package-boundary smoke installs the packed tarball and exercises public package entrypoints.",
      blockedReason: commandEvidenceBlockedReason,
    }),
    nodePackageBoundary: evidenceStatus({
      accepted: nodeBoundaryAccepted && regressionsAccepted,
      acceptedReason:
        "Node package-boundary smoke passed, and release regressions verify the Node 20 / 22 / 24 CI matrix.",
      blockedReason: commandEvidenceBlockedReason,
    }),
    outOfScopeBoundaries: evidenceStatus({
      accepted: productAccepted && regressionsAccepted,
      acceptedReason:
        "Phase 40 product evidence keeps raw transcript archive off and release regressions keep out-of-scope public surfaces absent.",
      blockedReason,
    }),
    packDryRun: evidenceStatus({
      accepted: packAccepted,
      acceptedReason: "bun pm pack --dry-run passed.",
      blockedReason: commandEvidenceBlockedReason,
    }),
    phase39Gate: evidenceStatus({
      accepted: phase39Accepted,
      acceptedReason: "Accepted Phase 39 Python HTTP bridge quality gate is the release input.",
      blockedReason,
      path: evidenceInput?.phase39Path ?? DEFAULT_PHASE39_GATE_PATH,
    }),
    productEval: evidenceStatus({
      accepted: productAccepted && commandPassed(input.commands, "product-eval-rollup"),
      acceptedReason:
        "Product eval rollup is accepted against the no-memory baseline with correction, block, job, and trace evidence.",
      blockedReason,
      path: evidenceInput?.productPath ?? DEFAULT_PRODUCT_REPORT_PATH,
    }),
    releaseChecklistAndStatus: evidenceStatus({
      accepted: regressionsAccepted && versionAccepted,
      acceptedReason:
        "Release checklist, current status, task-board, package metadata, and release workflow regressions passed for a stable release version.",
      blockedReason: commandEvidenceBlockedReason,
    }),
    releaseDryRun: evidenceStatus({
      accepted: releaseDryRunAccepted,
      acceptedReason: "release:rc-dry-run passed as tarball-first release dry-run evidence.",
      blockedReason: commandEvidenceBlockedReason,
    }),
  } satisfies Phase40GateReport["evidence"];
  const accepted =
    Object.values(evidence).every((item) => item.status === "accepted") &&
    failedCommand === undefined;
  const report: Phase40GateReport = {
    acceptance: {
      decision: accepted ? "accepted" : "blocked",
      reason: accepted
        ? "Phase 40 release-candidate evidence is accepted for the stable release line."
        : blockedReason,
    },
    commands: input.commands,
    evidence,
    generatedAt: input.now(),
    generatedBy: GENERATED_BY,
    phase: "phase-40",
    releaseCandidate: {
      evidencePaths: [
        DEFAULT_PHASE39_GATE_PATH,
        DEFAULT_CROSS_CONSUMER_REPORT_PATH,
        DEFAULT_PRODUCT_REPORT_PATH,
      ],
      version: evidenceInput?.version ?? "unknown",
    },
    runDirectory: input.runDirectory,
    runId: input.runId,
    scope: {
      inScope: [...PHASE40_IN_SCOPE],
      outOfScope: [...PHASE40_OUT_OF_SCOPE],
    },
  };

  await input.ensureDir(input.runDirectory, { recursive: true });
  await input.writeTextFile(input.outputPath, `${JSON.stringify(report, null, 2)}\n`);

  return report;
}

export async function runPhase40QualityGate(
  options: Phase40GateOptions = {},
  dependencies: Phase40GateDependencies = {},
): Promise<Phase40GateReport> {
  const root = resolveRepoRootFromScriptUrl(import.meta.url);
  const now = dependencies.now ?? (() => new Date().toISOString());
  const outputDir = options.outputDir ?? resolvePhase40GateOutputDir(root);
  const runId = options.runId ?? buildPhase40GateRunId(now());
  const runDirectory = join(outputDir, runId);
  const ensureDir =
    dependencies.ensureDir ??
    (async (path: string, options?: { recursive?: boolean }) => {
      await mkdir(path, options);
    });
  const readTextFile = dependencies.readTextFile ?? ((path: string) => readFile(path, "utf8"));
  const runCommand = dependencies.runCommand ?? defaultRunCommand;
  const writeTextFile = dependencies.writeTextFile ?? writeFile;
  const commands: Phase40GateExecutionResult[] = [];

  for (const command of buildPhase40GateCommands(root)) {
    const commandResult = await runCommand(command);
    const execution = toExecutionResult(command, commandResult);
    commands.push(execution);

    if (execution.status === "failed") {
      let evidenceInput: Phase40EvidenceInputs | null = null;
      let evidenceReadError: string | null = null;
      try {
        evidenceInput = await readRequiredEvidence({ readTextFile, root });
      } catch (error) {
        evidenceReadError = error instanceof Error ? error.message : String(error);
      }

      return await writeReport({
        commands,
        ensureDir,
        evidenceInput,
        evidenceReadError,
        now,
        outputPath: join(runDirectory, "phase-40-quality-gate.json"),
        runDirectory,
        runId,
        writeTextFile,
      });
    }
  }

  let evidenceInput: Phase40EvidenceInputs | null = null;
  let evidenceReadError: string | null = null;
  try {
    evidenceInput = await readRequiredEvidence({ readTextFile, root });
  } catch (error) {
    evidenceReadError = error instanceof Error ? error.message : String(error);
  }

  return await writeReport({
    commands,
    ensureDir,
    evidenceInput,
    evidenceReadError,
    now,
    outputPath: join(runDirectory, "phase-40-quality-gate.json"),
    runDirectory,
    runId,
    writeTextFile,
  });
}

export async function runPhase40GateCli(
  dependencies: Phase40GateCliDependencies = {},
): Promise<Phase40GateReport> {
  const argv = dependencies.argv ?? process.argv;
  const exit = dependencies.exit ?? process.exit;
  const log = dependencies.log ?? console.log;
  const runGate = dependencies.runGate ?? runPhase40QualityGate;
  const report = await runGate(parsePhase40GateCliOptions(argv));

  if (report.acceptance.decision === "accepted") {
    log(`Phase 40 quality gate accepted: ${report.runId}`);
  } else {
    log(`Phase 40 quality gate blocked: ${report.acceptance.reason}`);
    const failed = report.commands.find((command) => command.status === "failed");
    if (failed) {
      log(`Failed command: ${failed.label}`);
      log(`Command: ${failed.command}`);
      if (failed.stdoutTail.length > 0) {
        log("stdout tail:");
        for (const line of failed.stdoutTail) {
          log(line);
        }
      }
      if (failed.stderrTail.length > 0) {
        log("stderr tail:");
        for (const line of failed.stderrTail) {
          log(line);
        }
      }
    }
    exit(1);
  }

  return report;
}

if (import.meta.main) {
  await runPhase40GateCli();
}
