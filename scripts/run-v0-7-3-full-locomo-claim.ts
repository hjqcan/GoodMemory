import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import {
  link,
  mkdir,
  mkdtemp,
  open,
  readFile,
  realpath,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

import { resolveCliFlagValueStrict } from "./cli-options";
import {
  assertOfficialRescoreSummaryValid,
  parseOfficialRescoreProgressLine,
} from "./rescore-official-protocols";
import {
  buildV073FullClaimCommandChain,
  deriveV073ClaimCommandTemplateSha256,
  deriveV073PromptSha256,
  type V073FullClaimPlanInput,
  type V073PairedCommandChain,
} from "./run-v0-7-3-lifecycle-protection-gate";

const REQUIRED_BUN_VERSION = "1.3.14";
const RELEASE_VERSION = "0.7.3";
const CLAIM_RECIPE_PATH = "benchmark-claims/locomo.json";
const OFFICIAL_RUNNER_SOURCE_PATH = "scripts/rescore-official-protocols.ts";
const PROJECTION_PATH =
  "benchmark-claims/evidence/locomo-v0.7.3-current.json";
const EVIDENCE_ROOT =
  "reports/release/v0.7/v0.7.3-locomo-claim-evidence";
const EXPECTED_BENCHMARK_ROOT_BYTES = 2_490_457;
const EXPECTED_BENCHMARK_ROOT_SHA256 =
  "e442118810a1c57ee0b5454d12583c27be244936350dcfff1d6102d29cc39c28";
const EXPECTED_BENCHMARK_FINGERPRINT =
  "240ba2526911a5f965a285b88794c4d3b938b59be5aecd846cc472ee733357fd";
const EXPECTED_CASE_IDS = [
  "locomo-conv-26",
  "locomo-conv-30",
  "locomo-conv-41",
  "locomo-conv-42",
  "locomo-conv-43",
  "locomo-conv-44",
  "locomo-conv-47",
  "locomo-conv-48",
  "locomo-conv-49",
  "locomo-conv-50",
] as const;
const EXPECTED_CATEGORY_COUNTS = {
  multi_hop: 282,
  open_domain: 96,
  single_hop: 841,
  temporal: 321,
} as const;
export const V073_FULL_LOCOMO_CASE_QUESTION_COUNTS = {
  "locomo-conv-26": 152,
  "locomo-conv-30": 81,
  "locomo-conv-41": 152,
  "locomo-conv-42": 199,
  "locomo-conv-43": 178,
  "locomo-conv-44": 123,
  "locomo-conv-47": 150,
  "locomo-conv-48": 191,
  "locomo-conv-49": 156,
  "locomo-conv-50": 158,
} as const;
export const V073_FULL_LOCOMO_QUESTION_SELECTION_SHA256 =
  "81dbd4ea08eb6ffffc854500522983977984788662ed17e71e7caee9ec726b7b";

interface ArtifactIdentity {
  bytes: number;
  path: string;
  sha256: string;
}

interface WorktreeProvenance {
  headCommit: string;
  statusPorcelain: string;
}

export interface StagedV073FullClaimPublication {
  evidenceRootPath: string;
  fileNames: string[];
  partialEvidenceRootPath: string;
  partialProjectionPath: string;
  projectionPath: string;
}

interface CapturedProcess {
  exitCode: number | null;
  stderr: string;
  stdout: string;
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function artifactIdentity(path: string, raw: string): ArtifactIdentity {
  return {
    bytes: Buffer.byteLength(raw, "utf8"),
    path,
    sha256: sha256(raw),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required for the full LoCoMo claim launch`);
  }
  return value;
}

function provider(prefix: string): {
  gateway: string;
  model: string;
  provider: string;
} {
  return {
    gateway: requiredEnvironment(`${prefix}_BASE_URL`),
    model: requiredEnvironment(`${prefix}_MODEL`),
    provider: requiredEnvironment(`${prefix}_PROVIDER`),
  };
}

function runCapturedProcess(input: {
  args: readonly string[];
  command: string;
  cwd: string;
  environment?: Record<string, string>;
  streamOutput?: boolean;
}): Promise<CapturedProcess> {
  return new Promise((resolveProcess, reject) => {
    const child = spawn(input.command, input.args, {
      cwd: input.cwd,
      env: { ...process.env, ...input.environment },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => {
      stdout.push(chunk);
      if (input.streamOutput !== false) {
        process.stdout.write(chunk);
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr.push(chunk);
      if (input.streamOutput !== false) {
        process.stderr.write(chunk);
      }
    });
    child.on("error", reject);
    child.on("close", (exitCode) => {
      resolveProcess({
        exitCode,
        stderr: Buffer.concat(stderr).toString("utf8"),
        stdout: Buffer.concat(stdout).toString("utf8"),
      });
    });
  });
}

async function worktreeProvenance(path: string): Promise<WorktreeProvenance> {
  const [head, status] = await Promise.all([
    runCapturedProcess({
      args: ["rev-parse", "HEAD"],
      command: "git",
      cwd: path,
      streamOutput: false,
    }),
    runCapturedProcess({
      args: ["status", "--porcelain=v1", "--untracked-files=all"],
      command: "git",
      cwd: path,
      streamOutput: false,
    }),
  ]);
  if (head.exitCode !== 0 || status.exitCode !== 0) {
    throw new Error(`cannot inspect worktree provenance at ${path}`);
  }
  return {
    headCommit: head.stdout.trim(),
    statusPorcelain: status.stdout,
  };
}

function assertClean(provenance: WorktreeProvenance, label: string): void {
  if (!/^[0-9a-f]{40}$/u.test(provenance.headCommit)) {
    throw new Error(`${label} does not have a full commit identity`);
  }
  if (provenance.statusPorcelain !== "") {
    throw new Error(`${label} worktree must be clean`);
  }
}

export function assertV073CandidateProvenanceUnchanged(input: {
  current: WorktreeProvenance;
  expected: WorktreeProvenance;
  label: string;
}): void {
  assertClean(input.current, input.label);
  if (
    input.current.headCommit !== input.expected.headCommit ||
    input.current.statusPorcelain !== input.expected.statusPorcelain
  ) {
    throw new Error(`${input.label} provenance changed during full claim launch`);
  }
}

export function assertV073EvidencePublicationStatus(input: {
  current: WorktreeProvenance;
  expectedHeadCommit: string;
  fileNames: readonly string[];
}): void {
  const expectedStatus = [
    PROJECTION_PATH,
    ...input.fileNames.map((name) => `${EVIDENCE_ROOT}/${name}`),
  ]
    .sort()
    .map((path) => `?? ${path}`);
  const actualStatus = input.current.statusPorcelain
    .split("\n")
    .filter(Boolean)
    .sort();
  if (
    input.current.headCommit !== input.expectedHeadCommit ||
    !sameJson(actualStatus, expectedStatus)
  ) {
    throw new Error(
      "evidence repository changed outside the expected tracked bundle and projection",
    );
  }
}

async function assertAbsent(path: string, label: string): Promise<void> {
  try {
    await stat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return;
    }
    throw error;
  }
  throw new Error(`${label} must not exist before launch: ${path}`);
}

function pathContains(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

export async function resolveDistinctV073FullClaimRepositories(input: {
  candidateWorktree: string;
  evidenceRepo: string;
}): Promise<{ candidateWorktree: string; evidenceRepo: string }> {
  const [candidateWorktree, evidenceRepo] = await Promise.all([
    realpath(resolve(input.candidateWorktree)),
    realpath(resolve(input.evidenceRepo)),
  ]);
  if (
    pathContains(candidateWorktree, evidenceRepo) ||
    pathContains(evidenceRepo, candidateWorktree)
  ) {
    throw new Error(
      "--evidence-repo must be a separate worktree outside the measured candidate worktree",
    );
  }
  return { candidateWorktree, evidenceRepo };
}

export async function assertV073EvidenceRepositoryLineage(input: {
  evidenceHeadCommit: string;
  evidenceRepo: string;
  expectedCandidateCommit: string;
}): Promise<void> {
  if (input.evidenceHeadCommit !== input.expectedCandidateCommit) {
    throw new Error(
      "full claim evidence repository HEAD must equal the expected candidate commit",
    );
  }
  const result = await runCapturedProcess({
    args: ["cat-file", "-e", `${input.expectedCandidateCommit}^{commit}`],
    command: "git",
    cwd: input.evidenceRepo,
    streamOutput: false,
  });
  if (result.exitCode !== 0) {
    throw new Error(
      "full claim evidence repository cannot resolve the expected candidate commit",
    );
  }
}

export async function stageV073FullClaimPublication(input: {
  evidenceRepo: string;
  projectionRaw: string;
  trackedRaws: Readonly<Record<string, string>>;
}): Promise<StagedV073FullClaimPublication> {
  const evidenceRootPath = join(input.evidenceRepo, EVIDENCE_ROOT);
  const projectionPath = join(input.evidenceRepo, PROJECTION_PATH);
  await Promise.all([
    assertAbsent(evidenceRootPath, "tracked claim evidence"),
    assertAbsent(projectionPath, "current claim projection"),
  ]);
  const fileNames = Object.keys(input.trackedRaws).sort();
  if (
    fileNames.length === 0 ||
    fileNames.some((name) => basename(name) !== name || name.length === 0)
  ) {
    throw new Error("tracked claim evidence names must be non-empty file names");
  }
  await Promise.all([
    mkdir(dirname(evidenceRootPath), { recursive: true }),
    mkdir(dirname(projectionPath), { recursive: true }),
  ]);
  const partialEvidenceRootPath = await mkdtemp(
    join(dirname(evidenceRootPath), ".v0.7.3-locomo-claim-evidence.partial-"),
  );
  const partialProjectionPath = join(
    dirname(projectionPath),
    `.locomo-v0.7.3-current.json.partial-${basename(partialEvidenceRootPath)}`,
  );
  for (const name of fileNames) {
    await writeFile(
      join(partialEvidenceRootPath, name),
      input.trackedRaws[name]!,
      { encoding: "utf8", flag: "wx" },
    );
  }
  await writeFile(partialProjectionPath, input.projectionRaw, {
    encoding: "utf8",
    flag: "wx",
  });
  return {
    evidenceRootPath,
    fileNames,
    partialEvidenceRootPath,
    partialProjectionPath,
    projectionPath,
  };
}

export async function publishV073FullClaimPublication(
  staged: StagedV073FullClaimPublication,
): Promise<void> {
  const lockPath = join(
    dirname(staged.evidenceRootPath),
    ".v0.7.3-locomo-claim-publication.lock",
  );
  const lock = await open(lockPath, "wx");
  await lock.close();
  try {
    await Promise.all([
      assertAbsent(staged.evidenceRootPath, "tracked claim evidence"),
      assertAbsent(staged.projectionPath, "current claim projection"),
    ]);
    await rename(staged.partialEvidenceRootPath, staged.evidenceRootPath);
    await link(staged.partialProjectionPath, staged.projectionPath);
    await unlink(staged.partialProjectionPath);
  } finally {
    await unlink(lockPath).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") {
        throw error;
      }
    });
  }
}

function portableArgument(value: string, worktreePath: string): string {
  const absolute = resolve(value);
  if (value.startsWith(worktreePath + "/")) {
    return relative(worktreePath, value);
  }
  if (absolute.startsWith(homedir() + "/")) {
    return `~/${relative(homedir(), absolute)}`;
  }
  return value;
}

function shellWord(value: string): string {
  if (/^[A-Za-z0-9_./:@=+~-]+$/u.test(value)) {
    return value;
  }
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

export function renderV073FullClaimCommand(
  chain: V073PairedCommandChain,
  worktreePath: string,
): string {
  return [chain.seedSmoke, chain.reanswer, chain.officialRescore]
    .map((invocation) => {
      const environment = Object.entries(invocation.environment)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([name, value]) => `${name}=${shellWord(value)}`);
      const command = [
        invocation.command,
        ...invocation.args.map((value) =>
          shellWord(portableArgument(value, worktreePath))),
      ];
      return [...environment, ...command].join(" ");
    })
    .join("; ");
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function questionSelectionSha256(rows: readonly Record<string, unknown>[]): string {
  return sha256(JSON.stringify(rows.map((row) => ({
    caseId: row.caseId,
    category: row.category,
    questionId: row.questionId,
  }))));
}

function retrievalIdentity(row: Record<string, unknown>): unknown {
  return {
    caseId: row.caseId,
    category: row.category,
    evidenceRecall: row.evidenceRecall,
    evidenceTurnIds: row.evidenceTurnIds,
    goldEvidenceFullyRetrieved: row.goldEvidenceFullyRetrieved,
    missingEvidenceTurnIds: row.missingEvidenceTurnIds,
    noiseTurnCount: row.noiseTurnCount,
    noiseTurnIds: row.noiseTurnIds,
    questionId: row.questionId,
    retrievedTurnChannels: row.retrievedTurnChannels,
    retrievedTurnIds: row.retrievedTurnIds,
  };
}

function fullReportRows(
  report: Record<string, unknown>,
  label: string,
): Record<string, unknown>[] {
  if (!Array.isArray(report.cases) || report.cases.length !== 1540) {
    throw new Error(`${label} output does not contain 1540 question rows`);
  }
  const rows = report.cases;
  const seen = new Set<string>();
  const categoryCounts = new Map<string, number>();
  const caseCounts = new Map<string, number>();
  for (const [index, value] of rows.entries()) {
    if (!isRecord(value)) {
      throw new Error(`${label} row ${index} is not an object`);
    }
    const row = value;
    const questionId = row.questionId;
    const category = row.category;
    if (
      typeof questionId !== "string" ||
      questionId.length === 0 ||
      questionId.trim() !== questionId ||
      seen.has(questionId) ||
      !EXPECTED_CASE_IDS.includes(row.caseId as typeof EXPECTED_CASE_IDS[number]) ||
      typeof category !== "string" ||
      !Object.hasOwn(EXPECTED_CATEGORY_COUNTS, category) ||
      typeof row.answerCorrect !== "boolean" ||
      typeof row.answerTokenF1 !== "number" ||
      !Number.isFinite(row.answerTokenF1) ||
      row.answerTokenF1 < 0 ||
      row.answerTokenF1 > 1 ||
      typeof row.generatedAnswer !== "string" ||
      row.generatedAnswer.length === 0 ||
      row.executionFailureMessage != null
    ) {
      throw new Error(`${label} row ${index} has invalid identity or execution state`);
    }
    seen.add(questionId);
    categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + 1);
    const caseId = String(row.caseId);
    caseCounts.set(caseId, (caseCounts.get(caseId) ?? 0) + 1);
  }
  for (const [category, expected] of Object.entries(EXPECTED_CATEGORY_COUNTS)) {
    if (categoryCounts.get(category) !== expected) {
      throw new Error(`${label} category ${category} does not contain ${expected} questions`);
    }
  }
  for (const [caseId, expected] of Object.entries(
    V073_FULL_LOCOMO_CASE_QUESTION_COUNTS,
  )) {
    if (caseCounts.get(caseId) !== expected) {
      throw new Error(`${label} case ${caseId} does not contain ${expected} questions`);
    }
  }
  if (questionSelectionSha256(rows) !== V073_FULL_LOCOMO_QUESTION_SELECTION_SHA256) {
    throw new Error(`${label} question selection does not match the frozen full-10 set`);
  }
  return rows as Record<string, unknown>[];
}

export function assertV073FullClaimOutputs(input: {
  final: Record<string, unknown>;
  finalPath: string;
  finalRaw: string;
  finalRunId: string;
  official: Record<string, unknown>;
  officialPath: string;
  officialProgressRaw: string;
  officialRunId: string;
  rootPath: string;
  rootRaw: Uint8Array;
  seed: Record<string, unknown>;
  seedPath: string;
  seedRunId: string;
}): void {
  const reportRows: Record<string, unknown>[][] = [];
  for (const [label, report, runId] of [
    ["seed", input.seed, input.seedRunId],
    ["final", input.final, input.finalRunId],
  ] as const) {
    if (
      report.benchmark !== "locomo" ||
      report.benchmarkFingerprint !== EXPECTED_BENCHMARK_FINGERPRINT ||
      report.runId !== runId ||
      report.questionCount !== 1540 ||
      report.caseCount !== 10 ||
      report.executionFailures !== 0 ||
      !sameJson(report.caseIds, EXPECTED_CASE_IDS)
    ) {
      throw new Error(`${label} output is not a complete failure-free full-1540 report`);
    }
    reportRows.push(fullReportRows(report, label));
  }
  const [seedRows, finalRows] = reportRows as [
    Record<string, unknown>[],
    Record<string, unknown>[],
  ];
  if (
    input.seed.generatedBy !== "scripts/run-phase-65-locomo-smoke.ts" ||
    input.seed.resume !== true
  ) {
    throw new Error("seed output does not preserve the current claim smoke protocol");
  }
  if (
    input.final.generatedBy !== "scripts/reanswer-phase-65-locomo-report.ts" ||
    input.final.answerSystem !== "locomo-live-category-aware-v1" ||
    input.final.resume !== false ||
    !isRecord(input.final.sourceReport) ||
    input.final.sourceReport.runId !== input.seedRunId ||
    resolve(String(input.final.sourceReport.path)) !== resolve(input.seedPath) ||
    !Number.isFinite(Date.parse(String(input.seed.generatedAt))) ||
    !Number.isFinite(Date.parse(String(input.final.generatedAt))) ||
    Date.parse(String(input.final.generatedAt)) <=
      Date.parse(String(input.seed.generatedAt))
  ) {
    throw new Error("final output does not preserve the default reanswer lineage");
  }
  for (const [index, seedRow] of seedRows.entries()) {
    if (!sameJson(retrievalIdentity(seedRow), retrievalIdentity(finalRows[index]!))) {
      throw new Error(`final output changed seed retrieval evidence at row ${index}`);
    }
  }
  const strictCorrect = finalRows.filter((row) => row.answerCorrect === true).length;
  if (input.final.answerAccuracyOverall !== strictCorrect / 1540) {
    throw new Error("final output answerAccuracyOverall does not match its 1540 rows");
  }
  assertOfficialRescoreSummaryValid(input.official);
  const sourceInputs = input.official.sourceInputs;
  const sourceFingerprints = input.official.sourceInputFingerprints;
  const reportFingerprint = isRecord(sourceFingerprints)
    ? sourceFingerprints.reportPath
    : undefined;
  const rootFingerprint = isRecord(sourceFingerprints)
    ? sourceFingerprints.rootPath
    : undefined;
  if (
    input.official.generatedBy !== "scripts/rescore-official-protocols.ts" ||
    input.official.benchmark !== "locomo" ||
    input.official.runId !== input.officialRunId ||
    input.official.judgeFailures !== 0 ||
    input.official.judgedCases !== 1540 ||
    input.official.sourceCases !== 1540 ||
    input.official.selectedCases !== 1540 ||
    input.official.totalCases !== 1540 ||
    input.official.sourceAnswersUnchanged !== true ||
    resolve(String(input.official.outputPath)) !== resolve(input.officialPath) ||
    input.official.judgeGateway !== "https://ai.gurkiai.com/v1" ||
    input.official.judgeModel !== "gpt-5.5" ||
    input.official.judgeProvider !== "openai" ||
    !isRecord(sourceInputs) ||
    resolve(String(sourceInputs.reportPath)) !== resolve(input.finalPath) ||
    resolve(String(sourceInputs.rootPath)) !== resolve(input.rootPath) ||
    !isRecord(reportFingerprint) ||
    reportFingerprint.bytes !== Buffer.byteLength(input.finalRaw, "utf8") ||
    reportFingerprint.sha256 !== sha256(input.finalRaw) ||
    !isRecord(rootFingerprint) ||
    rootFingerprint.bytes !== input.rootRaw.byteLength ||
    rootFingerprint.sha256 !== sha256(input.rootRaw)
  ) {
    throw new Error("official output is not bound to the complete final report and root bytes");
  }
  const progressRows = input.officialProgressRaw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) =>
      parseOfficialRescoreProgressLine(line, `progress line ${index + 1}`));
  const progress = new Map<string, boolean>();
  for (const row of progressRows) {
    if (progress.has(row.questionId)) {
      throw new Error(`official progress duplicates question ${row.questionId}`);
    }
    progress.set(row.questionId, row.correct);
  }
  if (
    progress.size !== 1540 ||
    finalRows.some((row) => !progress.has(String(row.questionId)))
  ) {
    throw new Error("official progress does not cover the 1540 final questions");
  }
  if (!isRecord(input.official.categories)) {
    throw new Error("official output does not contain category summaries");
  }
  let overallCorrect = 0;
  for (const [category, total] of Object.entries(EXPECTED_CATEGORY_COUNTS)) {
    const correct = finalRows.filter(
      (row) =>
        row.category === category &&
        progress.get(String(row.questionId)) === true,
    ).length;
    const summary = input.official.categories[category];
    if (
      !isRecord(summary) ||
      summary.total !== total ||
      summary.correct !== correct ||
      summary.accuracy !== correct / total
    ) {
      throw new Error(`official progress disagrees with category ${category}`);
    }
    overallCorrect += correct;
  }
  if (
    input.official.overallCorrect !== overallCorrect ||
    input.official.overallAccuracy !== overallCorrect / 1540
  ) {
    throw new Error("official progress disagrees with the overall summary");
  }
}

function parseJsonObject(raw: string, label: string): Record<string, unknown> {
  const value = JSON.parse(raw) as unknown;
  if (!isRecord(value)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return value;
}

async function runCli(): Promise<void> {
  const worktreeFlag = resolveCliFlagValueStrict(Bun.argv, "--worktree") ??
    process.cwd();
  const evidenceRepoFlag = resolveCliFlagValueStrict(
    Bun.argv,
    "--evidence-repo",
  );
  const benchmarkRootFlag = resolveCliFlagValueStrict(
    Bun.argv,
    "--benchmark-root",
  );
  const outputRootFlag = resolveCliFlagValueStrict(Bun.argv, "--output-root");
  const seedRunId = resolveCliFlagValueStrict(Bun.argv, "--seed-run-id");
  const finalRunId = resolveCliFlagValueStrict(Bun.argv, "--final-run-id");
  const officialRunId = resolveCliFlagValueStrict(Bun.argv, "--official-run-id");
  const expectedCandidateCommit = resolveCliFlagValueStrict(
    Bun.argv,
    "--expected-candidate-commit",
  );
  if (
    !benchmarkRootFlag ||
    !evidenceRepoFlag ||
    !outputRootFlag ||
    !seedRunId ||
    !finalRunId ||
    !officialRunId ||
    !expectedCandidateCommit ||
    !/^[0-9a-f]{40}$/u.test(expectedCandidateCommit) ||
    new Set([seedRunId, finalRunId, officialRunId]).size !== 3
  ) {
    throw new Error(
      "usage: --worktree <path> --benchmark-root <path> --output-root <path> " +
        "--evidence-repo <path> " +
        "--seed-run-id <id> --final-run-id <id> --official-run-id <id> " +
        "--expected-candidate-commit <sha>",
    );
  }
  const repositories = await resolveDistinctV073FullClaimRepositories({
    candidateWorktree: worktreeFlag,
    evidenceRepo: evidenceRepoFlag,
  });
  const worktreePath = repositories.candidateWorktree;
  const evidenceRepoPath = repositories.evidenceRepo;
  const benchmarkRoot = resolve(benchmarkRootFlag);
  const outputRoot = resolve(worktreePath, outputRootFlag);
  if (Bun.version !== REQUIRED_BUN_VERSION) {
    throw new Error(`full claim launch requires Bun ${REQUIRED_BUN_VERSION}`);
  }
  const packageJson = parseJsonObject(
    await readFile(join(worktreePath, "package.json"), "utf8"),
    "package.json",
  );
  if (packageJson.version !== RELEASE_VERSION) {
    throw new Error(`full claim launch requires package ${RELEASE_VERSION}`);
  }
  const initialProvenance = await worktreeProvenance(worktreePath);
  assertClean(initialProvenance, "full claim launch");
  if (initialProvenance.headCommit !== expectedCandidateCommit) {
    throw new Error(
      `full claim HEAD ${initialProvenance.headCommit} does not match expected candidate ${expectedCandidateCommit}`,
    );
  }
  const evidenceRepositoryBefore = await worktreeProvenance(evidenceRepoPath);
  assertClean(evidenceRepositoryBefore, "full claim evidence repository");
  await assertV073EvidenceRepositoryLineage({
    evidenceHeadCommit: evidenceRepositoryBefore.headCommit,
    evidenceRepo: evidenceRepoPath,
    expectedCandidateCommit,
  });
  const seedOutputPath = join(outputRoot, seedRunId);
  const finalOutputPath = join(outputRoot, finalRunId);
  const officialOutputPath = join(
    worktreePath,
    "reports/eval/research/official-rescore",
    officialRunId,
  );
  await Promise.all([
    assertAbsent(seedOutputPath, "seed output"),
    assertAbsent(finalOutputPath, "final output"),
    assertAbsent(officialOutputPath, "official output"),
    assertAbsent(join(evidenceRepoPath, EVIDENCE_ROOT), "tracked claim evidence"),
    assertAbsent(join(evidenceRepoPath, PROJECTION_PATH), "current claim projection"),
  ]);
  const rootRaw = await readFile(join(benchmarkRoot, "cases.json"));
  if (
    rootRaw.byteLength !== EXPECTED_BENCHMARK_ROOT_BYTES ||
    sha256(rootRaw) !== EXPECTED_BENCHMARK_ROOT_SHA256
  ) {
    throw new Error("benchmark root does not match the frozen full-10 LoCoMo bytes");
  }
  const answer = provider("GOODMEMORY_EVAL");
  const assistedExtractor = provider("GOODMEMORY_ASSISTED_EXTRACTOR");
  const embedding = provider("GOODMEMORY_EMBEDDING");
  const reranking = provider("GOODMEMORY_RERANKING");
  const judge = provider("GOODMEMORY_JUDGE");
  if (
    answer.gateway !== "https://ai.gurkiai.com/v1" ||
    answer.model !== "gpt-5.6-terra" ||
    answer.provider !== "openai" ||
    assistedExtractor.gateway !== "https://ai.gurkiai.com/v1" ||
    assistedExtractor.model !== "gpt-5.6-terra" ||
    assistedExtractor.provider !== "openai" ||
    embedding.gateway !== "https://openrouter.ai/api/v1" ||
    embedding.model !== "text-embedding-3-small" ||
    embedding.provider !== "openai" ||
    reranking.gateway !== "https://ai.gurkiai.com/v1" ||
    reranking.model !== "gpt-5.6-terra" ||
    reranking.provider !== "openai" ||
    judge.gateway !== "https://ai.gurkiai.com/v1" ||
    judge.model !== "gpt-5.5" ||
    judge.provider !== "openai"
  ) {
    throw new Error("provider identities do not match the frozen claim protocol");
  }
  const plan: V073FullClaimPlanInput = {
    answerGateway: answer.gateway,
    answerModel: answer.model,
    answerProvider: answer.provider,
    assistedExtractorGateway: assistedExtractor.gateway,
    assistedExtractorModel: assistedExtractor.model,
    assistedExtractorProvider: assistedExtractor.provider,
    benchmarkRoot,
    embeddingGateway: embedding.gateway,
    embeddingModel: embedding.model,
    embeddingProvider: embedding.provider,
    finalOutputPath,
    finalRunId,
    judgeGateway: judge.gateway,
    judgeModel: judge.model,
    judgeProvider: judge.provider,
    officialRunId,
    rerankingGateway: reranking.gateway,
    rerankingModel: reranking.model,
    rerankingProvider: reranking.provider,
    seedOutputPath,
    seedRunId,
    worktreePath,
  };
  const claimRecipeRaw = await readFile(
    join(worktreePath, CLAIM_RECIPE_PATH),
    "utf8",
  );
  const officialRunnerRaw = await readFile(
    join(worktreePath, OFFICIAL_RUNNER_SOURCE_PATH),
    "utf8",
  );
  const commandChain = buildV073FullClaimCommandChain(plan, claimRecipeRaw);
  const command = renderV073FullClaimCommand(commandChain, worktreePath);
  for (const [step, invocation] of Object.entries(commandChain)) {
    const result = await runCapturedProcess({
      args: invocation.args,
      command: invocation.command,
      cwd: invocation.cwd,
      environment: invocation.environment,
    });
    if (result.exitCode !== 0) {
      throw new Error(`full claim ${step} exited with ${String(result.exitCode)}`);
    }
  }
  const seedPath = join(seedOutputPath, "smoke-report.json");
  const finalPath = join(finalOutputPath, "smoke-report.json");
  const officialPath = join(officialOutputPath, "rescore-summary.json");
  const officialProgressPath = join(officialOutputPath, "progress.jsonl");
  const [seedRaw, finalRaw, officialRaw, officialProgressRaw] = await Promise.all([
    readFile(seedPath, "utf8"),
    readFile(finalPath, "utf8"),
    readFile(officialPath, "utf8"),
    readFile(officialProgressPath, "utf8"),
  ]);
  const seed = parseJsonObject(seedRaw, "seed report");
  const final = parseJsonObject(finalRaw, "final report");
  const official = parseJsonObject(officialRaw, "official summary");
  assertV073FullClaimOutputs({
    final,
    finalPath,
    finalRaw,
    finalRunId,
    official,
    officialPath,
    officialProgressRaw,
    officialRunId,
    rootPath: join(benchmarkRoot, "cases.json"),
    rootRaw,
    seed,
    seedPath,
    seedRunId,
  });
  const finalProvenance = await worktreeProvenance(worktreePath);
  assertV073CandidateProvenanceUnchanged({
    current: finalProvenance,
    expected: initialProvenance,
    label: "full claim launch",
  });
  const evidenceRepositoryPrePublication = await worktreeProvenance(
    evidenceRepoPath,
  );
  if (
    evidenceRepositoryPrePublication.headCommit !==
      evidenceRepositoryBefore.headCommit ||
    evidenceRepositoryPrePublication.statusPorcelain !==
      evidenceRepositoryBefore.statusPorcelain
  ) {
    throw new Error("evidence repository changed during full claim execution");
  }
  const execution = {
    answerGateway: answer.gateway,
    answerModel: answer.model,
    answerProvider: answer.provider,
    assistedExtractorGateway: assistedExtractor.gateway,
    assistedExtractorModel: assistedExtractor.model,
    assistedExtractorProvider: assistedExtractor.provider,
    benchmarkFingerprint: EXPECTED_BENCHMARK_FINGERPRINT,
    benchmarkRootBytes: rootRaw.byteLength,
    benchmarkRootSha256: sha256(rootRaw),
    bunVersion: Bun.version,
    claimCommandSha256: sha256(command),
    claimCommandTemplateSha256:
      deriveV073ClaimCommandTemplateSha256(claimRecipeRaw),
    concurrency: 40,
    embeddingGateway: embedding.gateway,
    embeddingModel: embedding.model,
    embeddingProvider: embedding.provider,
    judgeGateway: judge.gateway,
    judgeModel: judge.model,
    judgeProvider: judge.provider,
    officialSourceSha256: sha256(officialRunnerRaw),
    promptSha256: deriveV073PromptSha256(),
    questionSelectionSha256: V073_FULL_LOCOMO_QUESTION_SELECTION_SHA256,
    caseQuestionCounts: V073_FULL_LOCOMO_CASE_QUESTION_COUNTS,
    rerankingGateway: reranking.gateway,
    rerankingModel: reranking.model,
    rerankingProvider: reranking.provider,
  };
  const receipt = {
    command,
    commandChain,
    commit: finalProvenance.headCommit,
    evidenceRepositoryBefore: {
      headCommit: evidenceRepositoryBefore.headCommit,
      statusPorcelain: evidenceRepositoryBefore.statusPorcelain,
    },
    execution,
    freshOutputEvidence: {
      finalOutputPathAbsentBeforeRun: true,
      officialOutputPathAbsentBeforeRun: true,
      seedOutputPathAbsentBeforeRun: true,
    },
    generatedBy: "v0.7.3-full-locomo-claim-launch",
    outputs: {
      finalReport: artifactIdentity(finalPath, finalRaw),
      officialSummary: artifactIdentity(officialPath, officialRaw),
      officialProgress: artifactIdentity(
        officialProgressPath,
        officialProgressRaw,
      ),
      seedReport: artifactIdentity(seedPath, seedRaw),
    },
    sources: {
      claimRecipe: artifactIdentity(
        join(worktreePath, CLAIM_RECIPE_PATH),
        claimRecipeRaw,
      ),
      officialRunner: artifactIdentity(
        join(worktreePath, OFFICIAL_RUNNER_SOURCE_PATH),
        officialRunnerRaw,
      ),
    },
    schemaVersion: 1,
    worktreeProvenance: finalProvenance,
  };
  const trackedRaws = {
    "claim-recipe-source.json": claimRecipeRaw,
    "final-smoke-report.json": finalRaw,
    "official-rescore-summary.json": officialRaw,
    "official-progress.jsonl": officialProgressRaw,
    "official-runner-source.ts": officialRunnerRaw,
    "seed-smoke-report.json": seedRaw,
  };
  const receiptRaw = `${JSON.stringify(receipt, null, 2)}\n`;
  const trackedPublicationRaws = {
    ...trackedRaws,
    "execution-receipt.json": receiptRaw,
  };
  const sourceArtifacts = [
    ["claim-recipe-source", "claim-recipe-source.json", claimRecipeRaw],
    ["seed-report", "seed-smoke-report.json", seedRaw],
    ["final-report", "final-smoke-report.json", finalRaw],
    ["official-summary", "official-rescore-summary.json", officialRaw],
    ["official-progress", "official-progress.jsonl", officialProgressRaw],
    ["official-runner-source", "official-runner-source.ts", officialRunnerRaw],
    ["execution-receipt", "execution-receipt.json", receiptRaw],
  ].map(([kind, name, raw]) => ({
    ...artifactIdentity(`${EVIDENCE_ROOT}/${name}`, raw),
    kind,
  }));
  const officialScore = Number(official.overallAccuracy);
  const strictScore = Number(final.answerAccuracyOverall);
  const openDomain = isRecord(official.categories) &&
    isRecord(official.categories.open_domain)
      ? official.categories.open_domain
      : undefined;
  const openDomainCorrect = Number(openDomain?.correct);
  const openDomainTotal = Number(openDomain?.total);
  const openDomainScore = Number(openDomain?.accuracy);
  if (
    ![officialScore, strictScore, openDomainScore].every(
      (value) => Number.isFinite(value) && value >= 0 && value <= 1,
    ) ||
    !Number.isSafeInteger(openDomainCorrect) ||
    openDomainCorrect < 0 ||
    openDomainTotal !== 96 ||
    openDomainCorrect > openDomainTotal ||
    openDomainScore !== openDomainCorrect / openDomainTotal
  ) {
    throw new Error("claim scores are missing from the completed reports");
  }
  const runtimeProfile =
    "recommended+provider-embedding+provider-reranking@0.7.3";
  const projection = {
    artifactKind: "tracked-current-claim-projection",
    benchmark: "LoCoMo",
    claim: {
      answerSystem: "locomo-live-category-aware-v1",
      conversationCount: 10,
      executionFailures: 0,
      judgeFailures: 0,
      officialScore,
      openDomainCorrect,
      openDomainScore,
      openDomainTotal,
      packageVersion: RELEASE_VERSION,
      questionCount: 1540,
      strictScore,
    },
    descriptorClaim: {
      claimDeclaration: CLAIM_RECIPE_PATH,
      config: "full 10 conversations / 1540 non-adversarial questions",
      measuredPackageVersion: RELEASE_VERSION,
      metric: "independent LoCoMo judge-protocol accuracy",
      name: "LoCoMo",
      reference: PROJECTION_PATH,
      result: `official ${officialScore.toFixed(4)}; strict ${strictScore.toFixed(4)}; open-domain ${openDomainCorrect}/${openDomainTotal} (${openDomainScore.toFixed(4)})`,
      runtimeProfile,
    },
    evidenceRepositoryBefore: {
      headCommit: evidenceRepositoryBefore.headCommit,
      statusPorcelain: evidenceRepositoryBefore.statusPorcelain,
    },
    execution,
    generatedBy: "scripts/run-v0-7-3-full-locomo-claim.ts",
    runIdentity: {
      commit: finalProvenance.headCommit,
      finalRunId,
      officialRunId,
      seedRunId,
    },
    schemaVersion: 1,
    sourceArtifacts,
  };
  const staged = await stageV073FullClaimPublication({
    evidenceRepo: evidenceRepoPath,
    projectionRaw: `${JSON.stringify(projection, null, 2)}\n`,
    trackedRaws: trackedPublicationRaws,
  });
  assertV073CandidateProvenanceUnchanged({
    current: await worktreeProvenance(worktreePath),
    expected: initialProvenance,
    label: "full claim launch after evidence materialization",
  });
  await publishV073FullClaimPublication(staged);
  assertV073CandidateProvenanceUnchanged({
    current: await worktreeProvenance(worktreePath),
    expected: initialProvenance,
    label: "full claim launch after evidence publication",
  });
  const evidenceRepositoryAfter = await worktreeProvenance(evidenceRepoPath);
  assertV073EvidencePublicationStatus({
    current: evidenceRepositoryAfter,
    expectedHeadCommit: evidenceRepositoryBefore.headCommit,
    fileNames: Object.keys(trackedPublicationRaws),
  });
  process.stdout.write(
    `Tracked full LoCoMo evidence and projection written. Update ${CLAIM_RECIPE_PATH}, ` +
      "README claim rows, and the static capability descriptor from this projection before stable readiness.\n",
  );
}

if (import.meta.main) {
  await runCli();
}
