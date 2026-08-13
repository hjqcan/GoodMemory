// Public benchmark claim governance. Promotion stays unavailable until a real
// end-to-end benchmark runner and its verifier are implemented together.
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  hasCliFlagStrict,
  resolveCliFlagValueStrict,
} from "./cli-options";
import { resolveRepoRootFromScriptUrl } from "./script-paths";

export const CLAIM_STATUSES = [
  "candidate_public_claim",
  "internal_evidence",
  "paused_boundary",
  "not_started",
] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

export const CLAIM_PROFILE_AVAILABILITIES = [
  "production-default",
  "public-opt-in",
  "historical",
  "repo-eval-only",
] as const;
export type ClaimProfileAvailability =
  (typeof CLAIM_PROFILE_AVAILABILITIES)[number];

export const METRIC_DIRECTIONS = [
  "higher-is-better",
  "lower-is-better",
] as const;
export type MetricDirection = (typeof METRIC_DIRECTIONS)[number];

export const CLAIM_PROMOTION_UNAVAILABLE_ERROR =
  "claim promotion is unavailable until an end-to-end benchmark runner and verifier are implemented together";
const FULL_COMMIT_PATTERN = /^[0-9a-f]{40}$/u;

export interface BenchmarkClaimComparison {
  asOf: string;
  availability: ClaimProfileAvailability;
  notes: string[];
  runtimeProfile: string;
  source: string;
}

export interface BenchmarkClaimReport {
  benchmark: string;
  claimBoundary: { publicClaimAllowed: boolean; reason: string };
  comparison: BenchmarkClaimComparison;
  coverage?: { complete: boolean; note?: string };
  dataset: { license: string | null; source: string | null; vendored: boolean };
  evidence: { artifacts: ClaimEvidenceArtifact[] };
  metrics: {
    baseline: number | null;
    metricDirection: MetricDirection;
    primary: string;
    score: number;
  };
  model: {
    answerGateway?: string;
    answerModel: string | null;
    answerProvider?: string;
    judgeGateway?: string;
    judgeModel: string | null;
    judgeProvider?: string;
    sameModelJudge: boolean;
  };
  run: {
    command: string | null;
    commit: string | null;
    executionFailures: number;
    packageVersion: string | null;
    runId?: string;
    tree?: string;
  };
  status: ClaimStatus;
}

export interface ClaimEvidenceArtifact {
  assertions?: ClaimEvidenceAssertion[];
  description: string;
  path: string;
}

export interface ClaimEvidenceAssertion {
  equals: boolean | null | number | string;
  path: Array<number | string>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isStrictText(value: unknown): value is string {
  return isNonEmpty(value) && value === value.trim();
}

function canonicalModelName(
  model: string,
  providers: Array<string | undefined>,
): string {
  const normalizedModel = model.trim().toLowerCase();
  for (const provider of providers) {
    if (!isNonEmpty(provider)) {
      continue;
    }
    const normalizedProvider = provider.trim().toLowerCase();
    for (const separator of ["/", ":"] as const) {
      const prefix = `${normalizedProvider}${separator}`;
      if (normalizedModel.startsWith(prefix)) {
        return normalizedModel.slice(prefix.length);
      }
    }
  }
  return normalizedModel;
}

function usesSameEvaluator(model: BenchmarkClaimReport["model"]): boolean {
  if (!isNonEmpty(model.answerModel) || !isNonEmpty(model.judgeModel)) {
    return false;
  }
  const providers = [model.answerProvider, model.judgeProvider];
  return canonicalModelName(model.answerModel, providers) ===
    canonicalModelName(model.judgeModel, providers);
}

function benchmarkDeclarationFileName(benchmark: string): string {
  return `${benchmark.toLowerCase().replace(/[^a-z0-9]+/gu, "")}.json`;
}

export interface ClaimBoundaryContext {
  currentPackageVersion?: string;
}

function evaluateMeasurementIntegrity(report: BenchmarkClaimReport): string[] {
  const blockers: string[] = [];
  if (report.run.executionFailures !== 0) {
    blockers.push(`executionFailures must be 0 (got ${report.run.executionFailures})`);
  }
  if (report.metrics.baseline === null) {
    blockers.push("no baseline/reference score for comparison");
  } else if (
    report.metrics.metricDirection === "higher-is-better" &&
    !(report.metrics.score > report.metrics.baseline)
  ) {
    blockers.push("score must be greater than baseline");
  } else if (
    report.metrics.metricDirection === "lower-is-better" &&
    !(report.metrics.score < report.metrics.baseline)
  ) {
    blockers.push("score must be less than baseline");
  }
  if (!isNonEmpty(report.run.commit) || !FULL_COMMIT_PATTERN.test(report.run.commit)) {
    blockers.push("run.commit must be a full lowercase commit");
  }
  if (!isNonEmpty(report.run.tree) || !FULL_COMMIT_PATTERN.test(report.run.tree)) {
    blockers.push("run.tree must be a full lowercase tree");
  }
  if (
    !isNonEmpty(report.run.command) ||
    !isNonEmpty(report.run.packageVersion) ||
    !isNonEmpty(report.run.runId)
  ) {
    blockers.push("run command, packageVersion, and runId are required");
  }
  if (!isNonEmpty(report.dataset.source) || !isNonEmpty(report.dataset.license)) {
    blockers.push("dataset source and license are required");
  }
  if (report.dataset.vendored !== false) {
    blockers.push("dataset.vendored must be false");
  }
  if (usesSameEvaluator(report.model) || report.model.sameModelJudge) {
    blockers.push("same-model judge requires an independent evaluator");
  }
  if (report.coverage?.complete !== true) {
    blockers.push("benchmark coverage must be complete");
  }
  return blockers;
}

export function evaluateClaimBoundary(
  report: BenchmarkClaimReport,
  context: ClaimBoundaryContext = {},
): { blockers: string[]; publicClaimAllowed: boolean } {
  const blockers = evaluateMeasurementIntegrity(report);
  if (report.status !== "candidate_public_claim") {
    blockers.push(
      `claim status is ${report.status}; current public claims require candidate_public_claim`,
    );
  }
  if (
    context.currentPackageVersion !== undefined &&
    report.run.packageVersion !== context.currentPackageVersion
  ) {
    blockers.push(
      `measured package version ${report.run.packageVersion ?? "(missing)"} does not match ` +
        `current package version ${context.currentPackageVersion}`,
    );
  }
  if (
    report.comparison.availability === "historical" ||
    report.comparison.availability === "repo-eval-only"
  ) {
    blockers.push(
      `runtime profile availability is ${report.comparison.availability}; ` +
        "current claims require a public profile",
    );
  }
  if (report.status === "candidate_public_claim") {
    blockers.push(CLAIM_PROMOTION_UNAVAILABLE_ERROR);
  }
  return { blockers, publicClaimAllowed: blockers.length === 0 };
}

export function evaluateHistoricalEvidenceBoundary(
  report: BenchmarkClaimReport,
): { blockers: string[]; historicalEvidenceAllowed: boolean } {
  const blockers = evaluateMeasurementIntegrity(report);
  if (report.status !== "internal_evidence") {
    blockers.push(
      `claim status is ${report.status}; historical evidence requires internal_evidence`,
    );
  }
  if (report.comparison.availability !== "historical") {
    blockers.push(
      `runtime profile availability is ${report.comparison.availability}; ` +
        "historical evidence requires historical",
    );
  }
  if (
    report.status === "internal_evidence" &&
    report.comparison.availability === "historical"
  ) {
    blockers.push(CLAIM_PROMOTION_UNAVAILABLE_ERROR);
  }
  return {
    blockers,
    historicalEvidenceAllowed: blockers.length === 0,
  };
}

export function validateClaimReport(
  value: unknown,
): { errors: string[]; valid: boolean } {
  if (!isRecord(value)) {
    return { errors: ["claim report must be an object"], valid: false };
  }
  const errors: string[] = [];
  if (!isStrictText(value.benchmark)) {
    errors.push("benchmark must be non-empty unpadded text");
  }
  if (!CLAIM_STATUSES.includes(value.status as ClaimStatus)) {
    errors.push("status is invalid");
  }
  if (
    !isRecord(value.claimBoundary) ||
    typeof value.claimBoundary.publicClaimAllowed !== "boolean" ||
    !isStrictText(value.claimBoundary.reason)
  ) {
    errors.push("claimBoundary must define publicClaimAllowed and reason");
  }
  if (
    !isRecord(value.comparison) ||
    !isStrictText(value.comparison.asOf) ||
    !CLAIM_PROFILE_AVAILABILITIES.includes(
      value.comparison.availability as ClaimProfileAvailability,
    ) ||
    !Array.isArray(value.comparison.notes) ||
    !value.comparison.notes.every(isStrictText) ||
    !isStrictText(value.comparison.runtimeProfile) ||
    !isStrictText(value.comparison.source)
  ) {
    errors.push("comparison is malformed");
  }
  if (
    !isRecord(value.coverage) ||
    typeof value.coverage.complete !== "boolean" ||
    !(value.coverage.note === undefined || isStrictText(value.coverage.note))
  ) {
    errors.push("coverage must explicitly define complete");
  }
  if (
    !isRecord(value.dataset) ||
    !(value.dataset.source === null || isStrictText(value.dataset.source)) ||
    !(value.dataset.license === null || isStrictText(value.dataset.license)) ||
    typeof value.dataset.vendored !== "boolean"
  ) {
    errors.push("dataset is malformed");
  }
  if (
    !isRecord(value.metrics) ||
    !(value.metrics.baseline === null ||
      (typeof value.metrics.baseline === "number" &&
        Number.isFinite(value.metrics.baseline))) ||
    typeof value.metrics.score !== "number" ||
    !Number.isFinite(value.metrics.score) ||
    !METRIC_DIRECTIONS.includes(value.metrics.metricDirection as MetricDirection) ||
    !isStrictText(value.metrics.primary)
  ) {
    errors.push("metrics is malformed");
  }
  if (
    !isRecord(value.model) ||
    !(value.model.answerModel === null || isStrictText(value.model.answerModel)) ||
    !(value.model.judgeModel === null || isStrictText(value.model.judgeModel)) ||
    typeof value.model.sameModelJudge !== "boolean"
  ) {
    errors.push("model is malformed");
  }
  if (
    !isRecord(value.run) ||
    !(value.run.command === null || isStrictText(value.run.command)) ||
    !(value.run.commit === null || isStrictText(value.run.commit)) ||
    !(value.run.packageVersion === null || isStrictText(value.run.packageVersion)) ||
    typeof value.run.executionFailures !== "number" ||
    !Number.isSafeInteger(value.run.executionFailures) ||
    value.run.executionFailures < 0 ||
    !(value.run.runId === undefined || isStrictText(value.run.runId)) ||
    !(value.run.tree === undefined || isStrictText(value.run.tree))
  ) {
    errors.push("run is malformed");
  }
  if (
    !isRecord(value.evidence) ||
    !Array.isArray(value.evidence.artifacts) ||
    !value.evidence.artifacts.every(
      (artifact) =>
        isRecord(artifact) &&
        isStrictText(artifact.description) &&
        isStrictText(artifact.path) &&
        (artifact.assertions === undefined ||
          (Array.isArray(artifact.assertions) &&
            artifact.assertions.every(
              (assertion) =>
                isRecord(assertion) &&
                Array.isArray(assertion.path) &&
                assertion.path.length > 0 &&
                assertion.path.every(
                  (part) =>
                    isStrictText(part) ||
                    (typeof part === "number" &&
                      Number.isSafeInteger(part) &&
                      part >= 0),
                ) &&
                (
                  ["boolean", "number", "string"].includes(
                    typeof assertion.equals,
                  ) || assertion.equals === null
                ),
            )))
    )
  ) {
    errors.push("evidence.artifacts is malformed");
  }
  if (
    "publicClaim" in value ||
    "historicalPresentation" in value
  ) {
    errors.push("claim declarations cannot provide README presentation fragments");
  }
  if (
    value.status === "candidate_public_claim" &&
    (!isRecord(value.claimBoundary) ||
      value.claimBoundary.publicClaimAllowed !== true)
  ) {
    errors.push("candidate_public_claim requires declared allowance");
  }
  return { errors, valid: errors.length === 0 };
}

export function collectClaimNotes(report: BenchmarkClaimReport): string[] {
  const license = report.dataset.license;
  return isNonEmpty(license) && /\bNC\b|non-?commercial/iu.test(license)
    ? [
        `non-commercial dataset license (${license.trim()}): any public claim must disclose the non-commercial scope`,
      ]
    : [];
}

export const README_CLAIMS_TABLE_START = "<!-- current-claims-table:start -->";
export const README_CLAIMS_TABLE_END = "<!-- current-claims-table:end -->";
export const README_HISTORICAL_EVIDENCE_TABLE_START =
  "<!-- historical-evidence-table:start -->";
export const README_HISTORICAL_EVIDENCE_TABLE_END =
  "<!-- historical-evidence-table:end -->";

export interface ReadmeClaimTableCheck {
  consistent: boolean;
  declarationLinkErrors: string[];
  file: string;
  forbiddenRows: string[];
  markersFound: boolean;
  missingClaimableBenchmarks: string[];
  rows: string[];
  unmatchedRows: string[];
}

interface PublicClaimTableRow {
  label: string;
  line: string;
}

function extractBenchmarkTableRows(
  markdown: string,
  startMarker: string,
  endMarker: string,
): {
  markersFound: boolean;
  rowDetails: PublicClaimTableRow[];
  rows: string[];
} {
  const start = markdown.indexOf(startMarker);
  const end = markdown.indexOf(endMarker);
  if (start === -1 || end === -1 || end < start) {
    return { markersFound: false, rowDetails: [], rows: [] };
  }
  const rowDetails: PublicClaimTableRow[] = [];
  for (const line of markdown.slice(start, end).split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|")) {
      continue;
    }
    const cells = trimmed.split("|").map((cell) => cell.trim()).filter(Boolean);
    const rawLabel = cells[0];
    const linkedLabel = rawLabel?.match(/^\[([^\]]+)\]\([^)]+\)$/u)?.[1];
    const label = linkedLabel ?? rawLabel;
    if (
      !label ||
      /^:?-+:?$/u.test(label) ||
      /^(?:benchmark|基准|基準)$/iu.test(label)
    ) {
      continue;
    }
    rowDetails.push({ label, line: trimmed });
  }
  return {
    markersFound: true,
    rowDetails,
    rows: rowDetails.map(({ label }) => label),
  };
}

export function extractPublicClaimsTableRows(markdown: string) {
  return extractBenchmarkTableRows(
    markdown,
    README_CLAIMS_TABLE_START,
    README_CLAIMS_TABLE_END,
  );
}

export function extractHistoricalEvidenceTableRows(markdown: string) {
  return extractBenchmarkTableRows(
    markdown,
    README_HISTORICAL_EVIDENCE_TABLE_START,
    README_HISTORICAL_EVIDENCE_TABLE_END,
  );
}

function checkReadmeBenchmarkTables(
  readmes: Array<{ content: string; file: string }>,
  entries: ClaimGateEntry[],
  expectedBenchmarks: string[],
  extractRows: typeof extractPublicClaimsTableRows,
): ReadmeClaimTableCheck[] {
  const declared = entries.map(({ benchmark }) => benchmark);
  const matches = (row: string, benchmark: string) =>
    row.toLowerCase().includes(benchmark.toLowerCase());
  return readmes.map(({ content, file }) => {
    const { markersFound, rowDetails, rows } = extractRows(content);
    const forbiddenRows = rows.filter((row) =>
      declared.some(
        (benchmark) =>
          !expectedBenchmarks.includes(benchmark) && matches(row, benchmark),
      )
    );
    const unmatchedRows = rows.filter(
      (row) => !declared.some((benchmark) => matches(row, benchmark)),
    );
    const missingClaimableBenchmarks = expectedBenchmarks.filter(
      (benchmark) => !rows.some((row) => matches(row, benchmark)),
    );
    const declarationLinkErrors = rowDetails.flatMap((row) => {
      const entry = entries.find(({ benchmark }) => matches(row.label, benchmark));
      if (!entry) {
        return [];
      }
      return [
        `./benchmark-claims/${entry.file}`,
        `benchmark-claims/${entry.file}`,
      ].some((target) => row.line.includes(`](${target})`))
        ? []
        : [`${row.label} must link to benchmark-claims/${entry.file}`];
    });
    return {
      consistent:
        markersFound &&
        forbiddenRows.length === 0 &&
        unmatchedRows.length === 0 &&
        missingClaimableBenchmarks.length === 0 &&
        declarationLinkErrors.length === 0,
      declarationLinkErrors,
      file,
      forbiddenRows,
      markersFound,
      missingClaimableBenchmarks,
      rows,
      unmatchedRows,
    };
  });
}

export function checkReadmeClaimTables(
  readmes: Array<{ content: string; file: string }>,
  entries: ClaimGateEntry[],
): ReadmeClaimTableCheck[] {
  return checkReadmeBenchmarkTables(
    readmes,
    entries,
    entries.filter((entry) => entry.computedPublicClaimAllowed && entry.consistent)
      .map(({ benchmark }) => benchmark),
    extractPublicClaimsTableRows,
  );
}

export function checkReadmeHistoricalEvidenceTables(
  readmes: Array<{ content: string; file: string }>,
  entries: ClaimGateEntry[],
): ReadmeClaimTableCheck[] {
  return checkReadmeBenchmarkTables(
    readmes,
    entries,
    entries.filter((entry) => entry.historicalEvidenceEligible && entry.consistent)
      .map(({ benchmark }) => benchmark),
    extractHistoricalEvidenceTableRows,
  );
}

export interface ClaimGateEntry {
  benchmark: string;
  blockers: string[];
  computedPublicClaimAllowed: boolean;
  consistent: boolean;
  declaredPublicClaimAllowed: boolean;
  file: string;
  historicalEvidenceEligible: boolean;
  notes: string[];
  schemaErrors: string[];
  status: ClaimStatus;
}

export interface ClaimGateReport {
  allConsistent: boolean;
  currentPackageVersion: string | null;
  entries: ClaimGateEntry[];
  generatedAt: string;
  generatedBy: string;
  historicalEvidence: string[];
  historicalReadmeChecks: ReadmeClaimTableCheck[];
  historicalReadmeConsistent: boolean;
  phase: "phase-67";
  publicClaimable: string[];
  readmeChecks: ReadmeClaimTableCheck[];
  readmeConsistent: boolean;
  summary: {
    consistent: number;
    historicalEvidence: number;
    overClaiming: number;
    publicClaimable: number;
    total: number;
  };
}

export function buildClaimGateReport(
  declarations: Array<{ file: string; value: unknown }>,
  now: string,
  readmes: Array<{ content: string; file: string }> = [],
  currentPackageVersion?: string,
): ClaimGateReport {
  const entries: ClaimGateEntry[] = declarations.map(({ file, value }) => {
    const schema = validateClaimReport(value);
    if (!schema.valid) {
      return {
        benchmark: isRecord(value) && isNonEmpty(value.benchmark)
          ? value.benchmark
          : file,
        blockers: [],
        computedPublicClaimAllowed: false,
        consistent: false,
        declaredPublicClaimAllowed: false,
        file,
        historicalEvidenceEligible: false,
        notes: [],
        schemaErrors: schema.errors,
        status: "not_started" as const,
      };
    }
    const report = value as BenchmarkClaimReport;
    const expectedFile = benchmarkDeclarationFileName(report.benchmark);
    if (file !== expectedFile) {
      return {
        benchmark: report.benchmark,
        blockers: [],
        computedPublicClaimAllowed: false,
        consistent: false,
        declaredPublicClaimAllowed: report.claimBoundary.publicClaimAllowed,
        file,
        historicalEvidenceEligible: false,
        notes: collectClaimNotes(report),
        schemaErrors: [`claim declaration filename must be ${expectedFile}`],
        status: report.status,
      };
    }
    const currentVerdict = evaluateClaimBoundary(report, { currentPackageVersion });
    const historicalVerdict = evaluateHistoricalEvidenceBoundary(report);
    const historicalRequested =
      report.status === "internal_evidence" &&
      report.comparison.availability === "historical";
    const promotionRequested = report.status === "candidate_public_claim" ||
      historicalRequested;
    const computedPublicClaimAllowed = currentVerdict.publicClaimAllowed;
    const historicalEvidenceEligible = historicalRequested &&
      historicalVerdict.historicalEvidenceAllowed;
    const boundaryBlockers = historicalRequested
      ? historicalVerdict.blockers
      : currentVerdict.blockers;
    return {
      benchmark: report.benchmark,
      blockers: boundaryBlockers,
      computedPublicClaimAllowed,
      consistent:
        report.claimBoundary.publicClaimAllowed === computedPublicClaimAllowed &&
        !promotionRequested,
      declaredPublicClaimAllowed: report.claimBoundary.publicClaimAllowed,
      file,
      historicalEvidenceEligible,
      notes: collectClaimNotes(report),
      schemaErrors: [],
      status: report.status,
    };
  });
  const publicClaimable = entries
    .filter((entry) => entry.computedPublicClaimAllowed && entry.consistent)
    .map(({ benchmark }) => benchmark);
  const historicalEvidence = entries
    .filter((entry) => entry.historicalEvidenceEligible && entry.consistent)
    .map(({ benchmark }) => benchmark);
  const readmeChecks = checkReadmeClaimTables(readmes, entries);
  const historicalReadmeChecks = checkReadmeHistoricalEvidenceTables(
    readmes,
    entries,
  );
  const overClaiming = entries.filter(
    (entry) =>
      entry.declaredPublicClaimAllowed &&
      !entry.computedPublicClaimAllowed &&
      !entry.consistent,
  ).length;
  return {
    allConsistent: entries.every(
      (entry) => entry.consistent && entry.schemaErrors.length === 0,
    ),
    currentPackageVersion: currentPackageVersion ?? null,
    entries,
    generatedAt: now,
    generatedBy: "scripts/run-public-benchmark-claim-gate.ts",
    historicalEvidence,
    historicalReadmeChecks,
    historicalReadmeConsistent: historicalReadmeChecks.every(
      ({ consistent }) => consistent,
    ),
    phase: "phase-67",
    publicClaimable,
    readmeChecks,
    readmeConsistent: readmeChecks.every(({ consistent }) => consistent),
    summary: {
      consistent: entries.filter(({ consistent }) => consistent).length,
      historicalEvidence: historicalEvidence.length,
      overClaiming,
      publicClaimable: publicClaimable.length,
      total: entries.length,
    },
  };
}

export interface PublicBenchmarkClaimGateCliOptions {
  claimsDir?: string;
  strict: boolean;
}

export function parsePublicBenchmarkClaimGateCliOptions(
  argv: readonly string[],
): PublicBenchmarkClaimGateCliOptions {
  return {
    claimsDir: resolveCliFlagValueStrict(argv, "--claims-dir"),
    strict: hasCliFlagStrict(argv, "--strict"),
  };
}

export async function runPublicBenchmarkClaimGate(input: {
  claimsDir?: string;
  currentPackageVersion?: string;
  now?: () => string;
  outputDir?: string;
  readDir?: (path: string) => Promise<string[]>;
  readFile?: (path: string) => Promise<string>;
}): Promise<ClaimGateReport> {
  const repoRoot = resolveRepoRootFromScriptUrl(import.meta.url);
  const claimsDir = input.claimsDir ?? join(repoRoot, "benchmark-claims");
  const readDirImpl = input.readDir ?? readdir;
  const readFileImpl = input.readFile ?? ((path: string) => readFile(path, "utf8"));
  const packageJson = JSON.parse(
    await readFileImpl(join(repoRoot, "package.json")),
  ) as unknown;
  if (!isRecord(packageJson) || !isStrictText(packageJson.version)) {
    throw new Error("package.json must define version");
  }
  const currentPackageVersion = input.currentPackageVersion ?? packageJson.version;
  const files = (await readDirImpl(claimsDir))
    .filter((file) => file.endsWith(".json"))
    .sort();
  const declarations: Array<{ file: string; value: unknown }> = [];
  for (const file of files) {
    const raw = await readFileImpl(join(claimsDir, file));
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch (error) {
      value = { parseError: String(error) };
    }
    declarations.push({ file, value });
  }
  const readmes = await Promise.all(
    ["README.md", "README.zh-CN.md"].map(async (file) => {
      try {
        return { content: await readFileImpl(join(repoRoot, file)), file };
      } catch {
        return { content: "", file };
      }
    }),
  );
  const report = buildClaimGateReport(
    declarations,
    (input.now ?? (() => new Date().toISOString()))(),
    readmes,
    currentPackageVersion,
  );
  const outputDir = input.outputDir ?? join(repoRoot, "reports/release/claims");
  await mkdir(outputDir, { recursive: true });
  await writeFile(
    join(outputDir, "claim-gate-report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  await writeFile(join(outputDir, "summary.md"), renderClaimGateSummary(report));
  return report;
}

export function renderClaimGateSummary(report: ClaimGateReport): string {
  const lines = [
    "# Public Benchmark Claim Gate",
    "",
    `- generated: ${report.generatedAt}`,
    `- current package version: ${report.currentPackageVersion ?? "unknown"}`,
    `- declarations: ${report.summary.total} | consistent: ${report.summary.consistent} | ` +
      `over-claiming: ${report.summary.overClaiming} | current claims: ` +
      `${report.summary.publicClaimable} | historical evidence: ` +
      report.summary.historicalEvidence,
    `- publicly claimable now: ${report.publicClaimable.join(", ") || "none"}`,
    `- versioned historical evidence: ${report.historicalEvidence.join(", ") || "none"}`,
  ];
  for (const check of [...report.readmeChecks, ...report.historicalReadmeChecks]) {
    lines.push(`- README check ${check.file}: ${check.consistent ? "OK" : "FAIL"}`);
  }
  for (const entry of report.entries) {
    for (const note of entry.notes) {
      lines.push(`- note [${entry.benchmark}]: ${note}`);
    }
  }
  lines.push(
    "",
    "| Benchmark | Status | Declared | Computed | Consistent | Blockers |",
    "|---|---|---|---|---|---|",
  );
  for (const entry of report.entries) {
    const blockers = entry.schemaErrors.length > 0
      ? `SCHEMA: ${entry.schemaErrors.join("; ")}`
      : entry.blockers.join("; ") || "(none)";
    lines.push(
      `| ${entry.benchmark} | ${entry.status} | ` +
        `${entry.declaredPublicClaimAllowed} | ${entry.computedPublicClaimAllowed} | ` +
        `${entry.consistent ? "yes" : "NO"} | ` +
        `${blockers.replace(/\|/gu, "\\|").slice(0, 200)} |`,
    );
  }
  lines.push(
    "",
    "Promotion is unavailable until an end-to-end runner and verifier are implemented together.",
    "",
  );
  return `${lines.join("\n")}\n`;
}

if (import.meta.main) {
  const options = parsePublicBenchmarkClaimGateCliOptions(Bun.argv);
  const report = await runPublicBenchmarkClaimGate({ claimsDir: options.claimsDir });
  process.stdout.write(renderClaimGateSummary(report));
  if (
    options.strict &&
    (!report.allConsistent ||
      report.summary.overClaiming > 0 ||
      !report.readmeConsistent ||
      !report.historicalReadmeConsistent)
  ) {
    process.exitCode = 1;
  }
}
