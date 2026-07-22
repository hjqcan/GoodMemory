// Phase 67-A public benchmark claim gate. Before any benchmark score is promoted
// to a public claim (e.g. a non-blank README benchmark row), it must have a claim
// declaration under benchmark-claims/<benchmark>.json, and that declaration's
// self-asserted `claimBoundary.publicClaimAllowed` must MATCH the verdict the gate
// computes from hard methodology rules. This catches over-claiming (declaring a
// public claim the rules forbid) and keeps every claim honest, reproducible, and
// provenance-complete.
//
// The gate is pure governance tooling: it reads JSON declarations and applies
// deterministic rules. It runs no benchmarks and touches no benchmark code.
//
//   bun run scripts/run-public-benchmark-claim-gate.ts -- [--strict]
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join, normalize } from "node:path";
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

const FULL_COMMIT_PATTERN = /^[0-9a-f]{40}$/iu;
const SHA256_PATTERN = /^[0-9a-f]{64}$/iu;
const HISTORICAL_PROJECTION_KIND = "tracked-historical-evidence-projection";
const HISTORICAL_ASSERTION_CONTRACT_ERROR =
  "historical projection assertions must bind artifactKind, benchmark, generatedBy, " +
  "schemaVersion, sourceArtifacts path/bytes/sha256, and runIdentity or scorerIdentity";

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
  // Optional coverage gate: a benchmark whose competencies/questions are only
  // partially evaluated cannot be a public claim even if the measured slice scores
  // well (e.g. MAB with TTL/LRU unfinished).
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
  publicClaim?: {
    readmeDisclosureFragments: string[];
    readmeRequiredFragments: string[];
  };
  run: {
    command: string | null;
    commit: string | null;
    executionFailures: number;
    packageVersion: string | null;
  };
  status: ClaimStatus;
}

export interface ClaimEvidenceArtifact {
  assertions?: ClaimEvidenceAssertion[];
  description: string;
  path: string;
}

export interface ClaimEvidenceAssertion {
  equals: ClaimEvidenceAssertionValue;
  path: ClaimEvidenceAssertionPath;
}

type ClaimEvidenceAssertionPath = Array<string | number>;
type ClaimEvidenceAssertionValue = boolean | null | number | string;

function isNonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isStrictNonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value === value.trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonScalar(value: unknown): value is ClaimEvidenceAssertionValue {
  return value === null || ["boolean", "number", "string"].includes(typeof value);
}

function isNullableStrictString(value: unknown): value is null | string {
  return value === null || isStrictNonEmpty(value);
}

function canonicalModelName(model: string, providers: Array<string | undefined>): string {
  const normalizedModel = model.trim().toLowerCase();
  for (const provider of providers) {
    if (isNonEmpty(provider)) {
      const normalizedProvider = provider.trim().toLowerCase();
      for (const separator of ["/", ":"] as const) {
        const prefix = `${normalizedProvider}${separator}`;
        if (normalizedModel.startsWith(prefix)) {
          return normalizedModel.slice(prefix.length);
        }
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

function isValidAssertionPathSegment(value: unknown): value is number | string {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 0;
  }
  return isStrictNonEmpty(value);
}

function validateRepoRelativeArtifactPath(path: string): string | null {
  if (!isStrictNonEmpty(path)) {
    return "must be a non-empty string without leading/trailing whitespace";
  }
  if (isAbsolute(path)) {
    return "must be a repo-relative path, not an absolute path";
  }
  const normalized = normalize(path);
  if (
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith(`..${"/"}`) ||
    normalized.split(/[\\/]+/u).includes("..")
  ) {
    return "must be a repo-relative path that does not escape the repository";
  }
  return null;
}

function isValidRunIdentity(value: unknown): value is {
  commit: string;
  runId: string;
} {
  return isRecord(value) &&
    isStrictNonEmpty(value.runId) &&
    typeof value.commit === "string" &&
    FULL_COMMIT_PATTERN.test(value.commit);
}

function isValidScorerIdentity(value: unknown): value is {
  commit: string;
  fileSha256: string;
  path: string;
  repository: string;
} {
  return isRecord(value) &&
    isStrictNonEmpty(value.repository) &&
    typeof value.commit === "string" &&
    FULL_COMMIT_PATTERN.test(value.commit) &&
    isStrictNonEmpty(value.path) &&
    validateRepoRelativeArtifactPath(value.path) === null &&
    typeof value.fileSha256 === "string" &&
    SHA256_PATTERN.test(value.fileSha256);
}

function validateHistoricalProjection(input: {
  artifact: ClaimEvidenceArtifact;
  benchmark: string;
  parsed: unknown;
}): string[] {
  if (!isRecord(input.parsed)) {
    return ["historical projection must be a JSON object"];
  }
  const errors: string[] = [];
  const projection = input.parsed;
  const requireBound = (
    path: ClaimEvidenceAssertionPath,
    equals: ClaimEvidenceAssertionValue,
    label: string,
  ): void => {
    if (!hasExactAssertion(input.artifact.assertions, path, equals)) {
      errors.push(
        `historical projection field ${label} must be bound by an evidence assertion`,
      );
    }
  };
  if (projection.artifactKind !== HISTORICAL_PROJECTION_KIND) {
    errors.push(
      `historical projection artifactKind must be ${HISTORICAL_PROJECTION_KIND}`,
    );
  } else {
    requireBound(["artifactKind"], projection.artifactKind, "artifactKind");
  }
  if (projection.benchmark !== input.benchmark) {
    errors.push(`historical projection benchmark must equal ${input.benchmark}`);
  } else {
    requireBound(["benchmark"], projection.benchmark, "benchmark");
  }
  if (!isStrictNonEmpty(projection.generatedBy)) {
    errors.push("historical projection generatedBy must be a non-empty unpadded string");
  } else {
    requireBound(["generatedBy"], projection.generatedBy, "generatedBy");
  }
  if (projection.schemaVersion !== 1) {
    errors.push("historical projection schemaVersion must be 1");
  } else {
    requireBound(["schemaVersion"], projection.schemaVersion, "schemaVersion");
  }

  const sources = projection.sourceArtifacts;
  const sourcesValid = Array.isArray(sources) && sources.length > 0 && sources.every(
    (source) =>
      isRecord(source) &&
      isStrictNonEmpty(source.path) &&
      validateRepoRelativeArtifactPath(source.path) === null &&
      typeof source.bytes === "number" &&
      Number.isSafeInteger(source.bytes) &&
      source.bytes > 0 &&
      typeof source.sha256 === "string" &&
      SHA256_PATTERN.test(source.sha256),
  );
  if (!sourcesValid) {
    errors.push(
      "historical projection sourceArtifacts must be non-empty and each require " +
        "repo-relative path, positive bytes, and sha256",
    );
  } else {
    sources.forEach((source, index) => {
      requireBound(
        ["sourceArtifacts", index, "path"],
        source.path,
        `sourceArtifacts[${index}].path`,
      );
      requireBound(
        ["sourceArtifacts", index, "bytes"],
        source.bytes,
        `sourceArtifacts[${index}].bytes`,
      );
      requireBound(
        ["sourceArtifacts", index, "sha256"],
        source.sha256,
        `sourceArtifacts[${index}].sha256`,
      );
    });
  }

  const runIdentity = projection.runIdentity;
  const scorerIdentity = projection.scorerIdentity;
  const runIdentityValid = isValidRunIdentity(runIdentity);
  const scorerIdentityValid = isValidScorerIdentity(scorerIdentity);
  if (!runIdentityValid && !scorerIdentityValid) {
    errors.push("historical projection requires runIdentity or scorerIdentity");
    return errors;
  }
  const runIdentityBound = runIdentityValid &&
    hasExactAssertion(input.artifact.assertions, ["runIdentity", "runId"], runIdentity.runId) &&
    hasExactAssertion(input.artifact.assertions, ["runIdentity", "commit"], runIdentity.commit);
  const scorerIdentityBound = scorerIdentityValid &&
    hasExactAssertion(
      input.artifact.assertions,
      ["scorerIdentity", "repository"],
      scorerIdentity.repository,
    ) &&
    hasExactAssertion(
      input.artifact.assertions,
      ["scorerIdentity", "commit"],
      scorerIdentity.commit,
    ) &&
    hasExactAssertion(
      input.artifact.assertions,
      ["scorerIdentity", "path"],
      scorerIdentity.path,
    ) &&
    hasExactAssertion(
      input.artifact.assertions,
      ["scorerIdentity", "fileSha256"],
      scorerIdentity.fileSha256,
    );
  if (!runIdentityBound && !scorerIdentityBound) {
    errors.push(
      "historical projection runIdentity or scorerIdentity must be bound by evidence assertions",
    );
  }
  return errors;
}

function projectionRecord(
  value: unknown,
  label: string,
): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function projectionNumber(
  value: Record<string, unknown>,
  field: string,
): number {
  const resolved = value[field];
  if (typeof resolved !== "number" || !Number.isFinite(resolved)) {
    throw new Error(`${field} must be a finite number`);
  }
  return resolved;
}

function projectionString(
  value: Record<string, unknown>,
  field: string,
): string {
  const resolved = value[field];
  if (!isStrictNonEmpty(resolved)) {
    throw new Error(`${field} must be a non-empty string`);
  }
  return resolved;
}

function scoreCount(score: number, total: number): string {
  const numerator = score * total;
  const rounded = Math.round(numerator);
  const rendered = Math.abs(numerator - rounded) < 1e-9
    ? String(rounded)
    : numerator.toFixed(2).replace(/\.0+$/u, "").replace(/(\.\d*?)0+$/u, "$1");
  return `${rendered}/${total}`;
}

function sourceDerivedReadmeFragments(
  projection: Record<string, unknown>,
  benchmark: string,
): string[] {
  if (benchmark === "BEAM") {
    const claim = projectionRecord(projection.claim, "claim");
    return [
      projectionNumber(claim, "officialUnifiedScore").toFixed(4),
      projectionNumber(claim, "strictBinaryScore").toFixed(3),
    ];
  }
  if (benchmark === "LoCoMo") {
    const claim = projectionRecord(projection.claim, "claim");
    return [
      projectionNumber(claim, "strictScore").toFixed(4),
      projectionNumber(claim, "officialScore").toFixed(4),
      projectionNumber(claim, "openDomainScore").toFixed(4),
    ];
  }
  if (benchmark === "MemoryAgentBench") {
    const claim = projectionRecord(projection.claim, "claim");
    return [
      `CR ${projectionNumber(claim, "conflictResolutionScore").toFixed(3)}`,
      `TTL ${projectionNumber(claim, "testTimeLearningScore").toFixed(3)}`,
    ];
  }
  if (benchmark === "ImplicitMemBench") {
    const claim = projectionRecord(projection.claim, "claim");
    const totalCases = projectionNumber(claim, "totalCases");
    if (!Number.isSafeInteger(totalCases) || totalCases <= 0) {
      throw new Error("totalCases must be a positive safe integer");
    }
    const score = projectionNumber(claim, "score");
    const baselineScore = projectionNumber(claim, "baselineScore");
    return [
      score.toFixed(3),
      scoreCount(score, totalCases),
      baselineScore.toFixed(3),
      scoreCount(baselineScore, totalCases),
      projectionString(claim, "answerModel"),
      projectionString(claim, "judgeModel"),
    ];
  }
  if (benchmark === "LongMemEval") {
    const claim = projectionRecord(
      projection.deterministicClaim,
      "deterministicClaim",
    );
    const diagnostic = projectionRecord(
      projection.promptCompatibleDiagnostic,
      "promptCompatibleDiagnostic",
    );
    const totalCases = projectionNumber(claim, "sourceCases");
    if (!Number.isSafeInteger(totalCases) || totalCases <= 0) {
      throw new Error("sourceCases must be a positive safe integer");
    }
    const score = projectionNumber(claim, "score");
    const diagnosticScore = projectionNumber(diagnostic, "overallAccuracy");
    return [
      score.toFixed(3),
      scoreCount(score, totalCases),
      projectionNumber(claim, "baselineAccuracy").toFixed(3),
      projectionString(claim, "profile"),
      diagnosticScore.toFixed(3),
      scoreCount(diagnosticScore, totalCases),
    ];
  }
  throw new Error(`unsupported historical benchmark ${benchmark}`);
}

function renderAssertionPath(path: ClaimEvidenceAssertionPath): string {
  return path
    .map((segment) => (typeof segment === "number" ? `[${segment}]` : segment))
    .join(".");
}

function readAssertionValue(
  value: unknown,
  path: ClaimEvidenceAssertionPath,
): { found: boolean; value: unknown } {
  let cursor = value;
  for (const segment of path) {
    if (typeof segment === "number") {
      if (!Array.isArray(cursor) || segment >= cursor.length) {
        return { found: false, value: undefined };
      }
      cursor = cursor[segment];
      continue;
    }
    if (!isRecord(cursor) || !Object.prototype.hasOwnProperty.call(cursor, segment)) {
      return { found: false, value: undefined };
    }
    cursor = cursor[segment];
  }
  return { found: true, value: cursor };
}

function formatAssertionValue(value: unknown): string {
  return JSON.stringify(value);
}

function assertionPathEquals(
  actual: unknown,
  expected: ClaimEvidenceAssertionPath,
): boolean {
  return Array.isArray(actual) &&
    actual.length === expected.length &&
    actual.every((segment, index) => Object.is(segment, expected[index]));
}

function hasExactAssertion(
  assertions: unknown,
  path: ClaimEvidenceAssertionPath,
  equals: ClaimEvidenceAssertionValue,
): boolean {
  return Array.isArray(assertions) && assertions.some(
    (assertion) =>
      isRecord(assertion) &&
      assertionPathEquals(assertion.path, path) &&
      Object.is(assertion.equals, equals),
  );
}

function assertionEqualsAt(
  assertions: unknown,
  path: ClaimEvidenceAssertionPath,
): unknown {
  if (!Array.isArray(assertions)) {
    return undefined;
  }
  const assertion = assertions.find(
    (candidate) => isRecord(candidate) && assertionPathEquals(candidate.path, path),
  );
  return isRecord(assertion) ? assertion.equals : undefined;
}

function hasHistoricalAssertionContract(
  artifact: Record<string, unknown>,
  benchmark: string,
): boolean {
  const assertions = artifact.assertions;
  const sourcePath = assertionEqualsAt(assertions, ["sourceArtifacts", 0, "path"]);
  const sourceBytes = assertionEqualsAt(assertions, ["sourceArtifacts", 0, "bytes"]);
  const sourceSha256 = assertionEqualsAt(assertions, ["sourceArtifacts", 0, "sha256"]);
  const runCommit = assertionEqualsAt(assertions, ["runIdentity", "commit"]);
  const runBound =
    isStrictNonEmpty(assertionEqualsAt(assertions, ["runIdentity", "runId"])) &&
    typeof runCommit === "string" &&
    FULL_COMMIT_PATTERN.test(runCommit);
  const scorerCommit = assertionEqualsAt(assertions, ["scorerIdentity", "commit"]);
  const scorerSha256 = assertionEqualsAt(
    assertions,
    ["scorerIdentity", "fileSha256"],
  );
  const scorerBound =
    isStrictNonEmpty(
      assertionEqualsAt(assertions, ["scorerIdentity", "repository"]),
    ) &&
    typeof scorerCommit === "string" &&
    FULL_COMMIT_PATTERN.test(scorerCommit) &&
    isStrictNonEmpty(assertionEqualsAt(assertions, ["scorerIdentity", "path"])) &&
    typeof scorerSha256 === "string" &&
    SHA256_PATTERN.test(scorerSha256);
  return (
    hasExactAssertion(assertions, ["artifactKind"], HISTORICAL_PROJECTION_KIND) &&
    hasExactAssertion(assertions, ["benchmark"], benchmark) &&
    isStrictNonEmpty(assertionEqualsAt(assertions, ["generatedBy"])) &&
    hasExactAssertion(assertions, ["schemaVersion"], 1) &&
    isStrictNonEmpty(sourcePath) &&
    typeof sourceBytes === "number" &&
    Number.isSafeInteger(sourceBytes) &&
    sourceBytes > 0 &&
    typeof sourceSha256 === "string" &&
    SHA256_PATTERN.test(sourceSha256) &&
    (runBound || scorerBound)
  );
}

function benchmarkDeclarationFileName(benchmark: string): string {
  return `${benchmark.toLowerCase().replace(/[^a-z0-9]+/gu, "")}.json`;
}

function validatePublicClaimFragments(input: {
  errors: string[];
  field: "readmeDisclosureFragments" | "readmeRequiredFragments";
  value: unknown;
}): void {
  if (!Array.isArray(input.value) || input.value.length === 0) {
    input.errors.push(
      `publicClaim.${input.field} must be a non-empty array for public claim declarations`,
    );
    return;
  }
  const seenFragments = new Set<string>();
  input.value.forEach((fragment, index) => {
    if (!isStrictNonEmpty(fragment)) {
      input.errors.push(
        `publicClaim.${input.field}[${index}] must be a non-empty unpadded string`,
      );
      return;
    }
    if (seenFragments.has(fragment)) {
      input.errors.push(
        `publicClaim.${input.field}[${index}] duplicates fragment ${fragment}`,
      );
    }
    seenFragments.add(fragment);
  });
}

// Hard methodology rules. A public claim is allowed only when NONE fire. The rules
// encode the user's claim discipline: zero failures, a baseline to compare to, a
// reproducible run, complete dataset provenance, an independent judge for
// judge-scored metrics, and complete benchmark coverage.
export interface ClaimBoundaryContext {
  currentPackageVersion?: string;
}

export function evaluateClaimBoundary(
  report: BenchmarkClaimReport,
  context: ClaimBoundaryContext = {},
): {
  blockers: string[];
  publicClaimAllowed: boolean;
} {
  const blockers: string[] = [];
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
  if (report.run.executionFailures !== 0) {
    blockers.push(`executionFailures must be 0 (got ${report.run.executionFailures})`);
  }
  if (report.metrics.baseline === null || report.metrics.baseline === undefined) {
    blockers.push("no baseline/reference score for comparison");
  } else if (report.metrics.metricDirection === "higher-is-better") {
    if (!(report.metrics.score > report.metrics.baseline)) {
      blockers.push(
        `score ${report.metrics.score} must be greater than baseline ${report.metrics.baseline}`,
      );
    }
  } else if (report.metrics.metricDirection === "lower-is-better") {
    if (!(report.metrics.score < report.metrics.baseline)) {
      blockers.push(
        `score ${report.metrics.score} must be less than baseline ${report.metrics.baseline}`,
      );
    }
  } else {
    blockers.push("metrics.metricDirection missing or invalid");
  }
  if (
    !isNonEmpty(report.run.commit) ||
    !FULL_COMMIT_PATTERN.test(report.run.commit)
  ) {
    blockers.push(
      "run.commit must be a complete 40-character hexadecimal commit (not reproducible)",
    );
  }
  if (!isNonEmpty(report.run.command)) {
    blockers.push("run.command missing (not reproducible)");
  }
  if (!isNonEmpty(report.run.packageVersion)) {
    blockers.push("run.packageVersion missing (not reproducible)");
  }
  if (!isNonEmpty(report.dataset.source)) {
    blockers.push("dataset.source missing");
  }
  if (!isNonEmpty(report.dataset.license)) {
    blockers.push("dataset.license missing/unverified");
  }
  if (report.dataset.vendored !== false) {
    blockers.push("dataset must not be vendored into the repo (dataset.vendored must be false)");
  }
  if (usesSameEvaluator(report.model) || report.model.sameModelJudge) {
    blockers.push(
      "same-model judge bias derived from answerModel/judgeModel evaluator identity; " +
        "needs an independent judge or a deterministic scorer",
    );
  }
  if (report.coverage && report.coverage.complete === false) {
    blockers.push(
      `benchmark coverage incomplete${report.coverage.note ? `: ${report.coverage.note}` : ""}`,
    );
  }
  if (
    report.comparison?.availability === "historical" ||
    report.comparison?.availability === "repo-eval-only"
  ) {
    blockers.push(
      `runtime profile availability is ${report.comparison.availability}; current public claims require production-default or public-opt-in`,
    );
  }
  if (!report.evidence || report.evidence.artifacts.length === 0) {
    blockers.push("no local evidence artifacts listed");
  }
  return { blockers, publicClaimAllowed: blockers.length === 0 };
}

// Schema validation independent of the boundary rules: every consumer of a claim
// declaration can rely on these fields existing with the right types.
export function validateClaimReport(value: unknown): { errors: string[]; valid: boolean } {
  const errors: string[] = [];
  if (!isRecord(value)) {
    return { errors: ["claim report must be an object"], valid: false };
  }
  if (!isNonEmpty(value.benchmark)) {
    errors.push("benchmark must be a non-empty string");
  }
  if (!CLAIM_STATUSES.includes(value.status as ClaimStatus)) {
    errors.push(`status must be one of ${CLAIM_STATUSES.join(", ")}`);
  }
  if (!isRecord(value.comparison)) {
    errors.push("comparison must be an object");
  } else {
    if (
      !isStrictNonEmpty(value.comparison.asOf) ||
      !/^\d{4}-\d{2}-\d{2}$/u.test(value.comparison.asOf)
    ) {
      errors.push("comparison.asOf must be an ISO calendar date (YYYY-MM-DD)");
    }
    if (
      !CLAIM_PROFILE_AVAILABILITIES.includes(
        value.comparison.availability as ClaimProfileAvailability,
      )
    ) {
      errors.push(
        `comparison.availability must be one of ${CLAIM_PROFILE_AVAILABILITIES.join(", ")}`,
      );
    }
    if (!isStrictNonEmpty(value.comparison.runtimeProfile)) {
      errors.push("comparison.runtimeProfile must be a non-empty unpadded string");
    }
    if (!isStrictNonEmpty(value.comparison.source)) {
      errors.push("comparison.source must be a non-empty unpadded string");
    }
    if (!Array.isArray(value.comparison.notes) || value.comparison.notes.length === 0) {
      errors.push("comparison.notes must be a non-empty array");
    } else {
      const seenNotes = new Set<string>();
      value.comparison.notes.forEach((note, index) => {
        if (!isStrictNonEmpty(note)) {
          errors.push(
            `comparison.notes[${index}] must be a non-empty unpadded string`,
          );
          return;
        }
        if (seenNotes.has(note)) {
          errors.push(`comparison.notes[${index}] duplicates ${note}`);
        }
        seenNotes.add(note);
      });
    }
  }
  if (!isRecord(value.coverage)) {
    errors.push("coverage must be an object");
  } else {
    if (typeof value.coverage.complete !== "boolean") {
      errors.push("coverage.complete must be a boolean");
    }
    if (value.coverage.note !== undefined && !isStrictNonEmpty(value.coverage.note)) {
      errors.push("coverage.note must be a non-empty unpadded string when present");
    }
  }
  if (!isRecord(value.dataset)) {
    errors.push("dataset must be an object");
  } else {
    if (!isStrictNonEmpty(value.dataset.source)) {
      errors.push("dataset.source must be a non-empty unpadded string");
    }
    if (!isStrictNonEmpty(value.dataset.license)) {
      errors.push("dataset.license must be a non-empty unpadded string");
    }
    if (typeof value.dataset.vendored !== "boolean") {
      errors.push("dataset.vendored must be a boolean");
    }
  }
  if (!isRecord(value.evidence) || !Array.isArray(value.evidence.artifacts)) {
    errors.push("evidence.artifacts must be an array");
  } else {
    value.evidence.artifacts.forEach((artifact, index) => {
      if (!isRecord(artifact)) {
        errors.push(`evidence.artifacts[${index}] must be an object`);
        return;
      }
      if (!isStrictNonEmpty(artifact.description)) {
        errors.push(
          `evidence.artifacts[${index}].description must be a non-empty unpadded string`,
        );
      }
      if (!isStrictNonEmpty(artifact.path)) {
        errors.push(`evidence.artifacts[${index}].path must be a non-empty unpadded string`);
        return;
      }
      const pathError = validateRepoRelativeArtifactPath(artifact.path);
      if (pathError) {
        errors.push(`evidence.artifacts[${index}].path ${pathError}`);
      }
      if (
        isStrictNonEmpty(artifact.path) &&
        artifact.path.endsWith(".json") &&
        (!Array.isArray(artifact.assertions) || artifact.assertions.length === 0)
      ) {
        errors.push(
          `evidence.artifacts[${index}].assertions must be a non-empty array for JSON artifacts`,
        );
      }
      if (artifact.assertions !== undefined) {
        if (!Array.isArray(artifact.assertions)) {
          errors.push(`evidence.artifacts[${index}].assertions must be an array`);
          return;
        }
        artifact.assertions.forEach((assertion, assertionIndex) => {
          if (!isRecord(assertion)) {
            errors.push(
              `evidence.artifacts[${index}].assertions[${assertionIndex}] must be an object`,
            );
            return;
          }
          if (!Array.isArray(assertion.path) || assertion.path.length === 0) {
            errors.push(
              `evidence.artifacts[${index}].assertions[${assertionIndex}].path must be a non-empty array`,
            );
          } else {
            assertion.path.forEach((segment, segmentIndex) => {
              if (!isValidAssertionPathSegment(segment)) {
                errors.push(
                  `evidence.artifacts[${index}].assertions[${assertionIndex}].path[${segmentIndex}] must be a non-empty string or non-negative safe integer`,
                );
              }
            });
          }
          if (
            !Object.prototype.hasOwnProperty.call(assertion, "equals") ||
            !isJsonScalar(assertion.equals)
          ) {
            errors.push(
              `evidence.artifacts[${index}].assertions[${assertionIndex}].equals must be a JSON scalar`,
            );
          }
        });
      }
    });
    if (
      value.status === "internal_evidence" &&
      isRecord(value.comparison) &&
      value.comparison.availability === "historical"
    ) {
      if (value.evidence.artifacts.some((artifact) =>
        !isRecord(artifact) ||
        !isStrictNonEmpty(artifact.path) ||
        !artifact.path.startsWith("benchmark-claims/evidence/")
      )) {
        errors.push(
          "historical evidence artifacts must live under benchmark-claims/evidence",
        );
      }
      value.evidence.artifacts.forEach((artifact, index) => {
        if (
          isRecord(artifact) &&
          isNonEmpty(value.benchmark) &&
          !hasHistoricalAssertionContract(artifact, value.benchmark)
        ) {
          errors.push(`evidence.artifacts[${index}] ${HISTORICAL_ASSERTION_CONTRACT_ERROR}`);
        }
      });
    }
  }
  if (!isRecord(value.run)) {
    errors.push("run must be an object");
  } else {
    if (!isStrictNonEmpty(value.run.command)) {
      errors.push("run.command must be a non-empty unpadded string");
    }
    if (!isStrictNonEmpty(value.run.commit)) {
      errors.push("run.commit must be a non-empty unpadded string");
    } else if (!FULL_COMMIT_PATTERN.test(value.run.commit)) {
      errors.push("run.commit must be a complete 40-character hexadecimal commit");
    }
    if (
      typeof value.run.executionFailures !== "number" ||
      !Number.isSafeInteger(value.run.executionFailures) ||
      value.run.executionFailures < 0
    ) {
      errors.push("run.executionFailures must be a non-negative safe integer");
    }
    if (!isStrictNonEmpty(value.run.packageVersion)) {
      errors.push("run.packageVersion must be a non-empty unpadded string");
    }
  }
  if (!isRecord(value.model)) {
    errors.push("model must be an object");
  } else {
    if (!isStrictNonEmpty(value.model.answerModel)) {
      errors.push("model.answerModel must be a non-empty unpadded string");
    }
    if (!isNullableStrictString(value.model.judgeModel)) {
      errors.push("model.judgeModel must be null or a non-empty unpadded string");
    }
    if (typeof value.model.sameModelJudge !== "boolean") {
      errors.push("model.sameModelJudge must be a boolean");
    }
    for (const field of [
      "answerGateway",
      "answerProvider",
      "judgeGateway",
      "judgeProvider",
    ] as const) {
      if (value.model[field] !== undefined && !isStrictNonEmpty(value.model[field])) {
        errors.push(`model.${field} must be a non-empty unpadded string when present`);
      }
    }
  }
  if (
    !isRecord(value.metrics) ||
    !Number.isFinite(value.metrics.baseline) ||
    !METRIC_DIRECTIONS.includes(value.metrics.metricDirection as MetricDirection) ||
    !isStrictNonEmpty(value.metrics.primary) ||
    !Number.isFinite(value.metrics.score)
  ) {
    errors.push(
      "metrics.baseline and score must be finite numbers, primary must be a non-empty " +
        "unpadded string, and metricDirection must be higher-is-better or lower-is-better",
    );
  }
  if (
    !isRecord(value.claimBoundary) ||
    typeof value.claimBoundary.publicClaimAllowed !== "boolean" ||
    !isNonEmpty(value.claimBoundary.reason)
  ) {
    errors.push("claimBoundary.publicClaimAllowed (boolean) and reason (string) are required");
  }
  const requiresReadmeContract =
    isRecord(value.claimBoundary) && value.claimBoundary.publicClaimAllowed === true;
  if (requiresReadmeContract || value.publicClaim !== undefined) {
    if (!isRecord(value.publicClaim)) {
      errors.push("publicClaim must be an object for public claim declarations");
    } else {
      validatePublicClaimFragments({
        errors,
        field: "readmeRequiredFragments",
        value: value.publicClaim.readmeRequiredFragments,
      });
      validatePublicClaimFragments({
        errors,
        field: "readmeDisclosureFragments",
        value: value.publicClaim.readmeDisclosureFragments,
      });
    }
  }
  return { errors, valid: errors.length === 0 };
}

export interface ClaimGateEntry {
  benchmark: string;
  blockers: string[];
  computedPublicClaimAllowed: boolean;
  consistent: boolean;
  declaredPublicClaimAllowed: boolean;
  file: string;
  notes: string[];
  readmeDisclosureFragments: string[];
  readmeRequiredFragments: string[];
  schemaErrors: string[];
  status: ClaimStatus;
}

export async function checkClaimEvidenceArtifacts(input: {
  file: string;
  readFile: (path: string) => Promise<string>;
  repoRoot: string;
  report: BenchmarkClaimReport;
}): Promise<string[]> {
  const errors: string[] = [];
  for (const artifact of input.report.evidence.artifacts) {
    const pathError = validateRepoRelativeArtifactPath(artifact.path);
    if (pathError) {
      errors.push(`evidence artifact ${artifact.path} in ${input.file} ${pathError}`);
      continue;
    }
    const artifactPath = join(input.repoRoot, artifact.path);
    let content: string;
    try {
      content = await input.readFile(artifactPath);
    } catch (error) {
      errors.push(`evidence artifact ${artifact.path} cannot be read: ${String(error)}`);
      continue;
    }
    if (content.trim().length === 0) {
      errors.push(`evidence artifact ${artifact.path} is empty`);
      continue;
    }
    if (artifact.path.endsWith(".json")) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(content);
      } catch (error) {
        errors.push(`evidence artifact ${artifact.path} is not valid JSON: ${String(error)}`);
        continue;
      }
      if (
        input.report.status === "internal_evidence" &&
        input.report.comparison.availability === "historical"
      ) {
        const projectionErrors = validateHistoricalProjection({
          artifact,
          benchmark: input.report.benchmark,
          parsed,
        });
        errors.push(
          ...projectionErrors.map(
            (error) => `evidence artifact ${artifact.path}: ${error}`,
          ),
        );
        if (projectionErrors.length === 0 && isRecord(parsed)) {
          try {
            const declaredFragments = new Set(
              input.report.publicClaim?.readmeRequiredFragments ?? [],
            );
            for (const fragment of sourceDerivedReadmeFragments(
              parsed,
              input.report.benchmark,
            )) {
              if (!declaredFragments.has(fragment)) {
                errors.push(
                  `evidence artifact ${artifact.path}: source-derived README fragment ` +
                    `${fragment} is missing from publicClaim.readmeRequiredFragments`,
                );
              }
            }
          } catch (error) {
            errors.push(
              `evidence artifact ${artifact.path}: cannot derive README fragments: ` +
                String(error),
            );
          }
        }
      }
      for (const assertion of artifact.assertions ?? []) {
        const actual = readAssertionValue(parsed, assertion.path);
        const renderedPath = renderAssertionPath(assertion.path);
        if (!actual.found) {
          errors.push(`evidence artifact ${artifact.path} path ${renderedPath} was not found`);
          continue;
        }
        if (!Object.is(actual.value, assertion.equals)) {
          errors.push(
            `evidence artifact ${artifact.path} path ${renderedPath} expected ` +
              `${formatAssertionValue(assertion.equals)} but found ${formatAssertionValue(actual.value)}`,
          );
        }
      }
    }
  }
  return errors;
}

// Non-blocking observations that must stay visible on every gate run (e.g. a
// non-commercial dataset license is legal for research evidence but any public
// claim wording must disclose it).
export function collectClaimNotes(report: BenchmarkClaimReport): string[] {
  const notes: string[] = [];
  const license = report.dataset.license;
  if (isNonEmpty(license) && /\bNC\b|non-?commercial/iu.test(license)) {
    notes.push(
      `non-commercial dataset license (${license.trim()}): any public claim must disclose the non-commercial scope`,
    );
  }
  return notes;
}

// Current claims and historical evidence use separate machine-readable tables.
// This prevents a versioned result from becoming a current claim merely because
// both surfaces link to the same declaration.
export const README_CLAIMS_TABLE_START = "<!-- current-claims-table:start -->";
export const README_CLAIMS_TABLE_END = "<!-- current-claims-table:end -->";
export const README_HISTORICAL_EVIDENCE_TABLE_START =
  "<!-- historical-evidence-table:start -->";
export const README_HISTORICAL_EVIDENCE_TABLE_END =
  "<!-- historical-evidence-table:end -->";

export interface ReadmeClaimTableCheck {
  claimContentErrors: string[];
  consistent: boolean;
  declarationLinkErrors: string[];
  disclosureErrors: string[];
  file: string;
  forbiddenRows: string[];
  markersFound: boolean;
  missingClaimableBenchmarks: string[];
  rows: string[];
  unmatchedRows: string[];
}

interface PublicClaimTableRow {
  cells: string[];
  label: string;
  line: string;
}

function parseMarkdownTableCells(line: string): string[] {
  return line
    .split("|")
    .map((cell) => cell.trim())
    .filter((cell) => cell.length > 0);
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
  const rows: string[] = [];
  for (const line of markdown.slice(start, end).split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|")) {
      continue;
    }
    const cells = parseMarkdownTableCells(trimmed);
    const firstCell = cells[0];
    if (!isNonEmpty(firstCell)) {
      continue;
    }
    if (/^:?-+:?$/u.test(firstCell)) {
      continue;
    }
    if (rows.length === 0 && /benchmark|基准|基準/iu.test(firstCell)) {
      continue;
    }
    rowDetails.push({ cells, label: firstCell, line: trimmed });
    rows.push(firstCell);
  }
  return { markersFound: true, rowDetails, rows };
}

export function extractPublicClaimsTableRows(markdown: string): {
  markersFound: boolean;
  rowDetails: PublicClaimTableRow[];
  rows: string[];
} {
  return extractBenchmarkTableRows(
    markdown,
    README_CLAIMS_TABLE_START,
    README_CLAIMS_TABLE_END,
  );
}

export function extractHistoricalEvidenceTableRows(markdown: string): {
  markersFound: boolean;
  rowDetails: PublicClaimTableRow[];
  rows: string[];
} {
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
  extractRows: (markdown: string) => {
    markersFound: boolean;
    rowDetails: PublicClaimTableRow[];
    rows: string[];
  },
): ReadmeClaimTableCheck[] {
  const declared = entries.map((entry) => entry.benchmark);
  const matches = (row: string, benchmark: string): boolean =>
    row.toLowerCase().includes(benchmark.toLowerCase());
  return readmes.map(({ content, file }) => {
    const { markersFound, rowDetails, rows } = extractRows(content);
    const forbiddenRows = rows.filter((row) =>
      declared.some(
        (benchmark) => !expectedBenchmarks.includes(benchmark) && matches(row, benchmark),
      ),
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
      const expectedTargets = [
        `./benchmark-claims/${entry.file}`,
        `benchmark-claims/${entry.file}`,
      ];
      const hasExpectedLink = expectedTargets.some((target) =>
        row.line.includes(`](${target})`),
      );
      return hasExpectedLink
        ? []
        : [`${row.label} must link to benchmark-claims/${entry.file}`];
    });
    const claimContentErrors = rowDetails.flatMap((row) => {
      const entry = entries.find(({ benchmark }) => matches(row.label, benchmark));
      if (!entry) {
        return [];
      }
      return entry.readmeRequiredFragments
        .filter((fragment) => !row.line.includes(fragment))
        .map(
          (fragment) =>
            `${row.label} must include declaration fragment ${JSON.stringify(fragment)}`,
        );
    });
    const disclosureErrors = rowDetails.flatMap((row) => {
      const entry = entries.find(({ benchmark }) => matches(row.label, benchmark));
      if (!entry) {
        return [];
      }
      return entry.readmeDisclosureFragments
        .filter((fragment) => !content.includes(fragment))
        .map(
          (fragment) =>
            `${row.label} README disclosure must include declaration fragment ${JSON.stringify(fragment)}`,
        );
    });
    return {
      claimContentErrors,
      consistent:
        markersFound &&
        forbiddenRows.length === 0 &&
        unmatchedRows.length === 0 &&
        missingClaimableBenchmarks.length === 0 &&
        declarationLinkErrors.length === 0 &&
        claimContentErrors.length === 0 &&
        disclosureErrors.length === 0,
      declarationLinkErrors,
      disclosureErrors,
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
  const claimable = entries
    .filter((entry) => entry.computedPublicClaimAllowed && entry.consistent)
    .map((entry) => entry.benchmark);
  return checkReadmeBenchmarkTables(
    readmes,
    entries,
    claimable,
    extractPublicClaimsTableRows,
  );
}

export function checkReadmeHistoricalEvidenceTables(
  readmes: Array<{ content: string; file: string }>,
  entries: ClaimGateEntry[],
): ReadmeClaimTableCheck[] {
  const historical = entries
    .filter(
      (entry) =>
        entry.status === "internal_evidence" &&
        entry.consistent &&
        entry.schemaErrors.length === 0,
    )
    .map((entry) => entry.benchmark);
  return checkReadmeBenchmarkTables(
    readmes,
    entries,
    historical,
    extractHistoricalEvidenceTableRows,
  );
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

export function buildClaimGateReport(
  declarations: Array<{ file: string; value: unknown }>,
  now: string,
  readmes: Array<{ content: string; file: string }> = [],
  evidenceErrorsByFile: ReadonlyMap<string, string[]> = new Map(),
  currentPackageVersion?: string,
): ClaimGateReport {
  const entries: ClaimGateEntry[] = [];
  for (const { file, value } of declarations) {
    const schema = validateClaimReport(value);
    if (!schema.valid) {
      entries.push({
        benchmark: isRecord(value) && isNonEmpty(value.benchmark) ? value.benchmark : file,
        blockers: [],
        computedPublicClaimAllowed: false,
        consistent: false,
        declaredPublicClaimAllowed: false,
        file,
        notes: [],
        readmeDisclosureFragments: [],
        readmeRequiredFragments: [],
        schemaErrors: schema.errors,
        status: "not_started",
        // schema invalid -> not consistent
      });
      continue;
    }
    const report = value as BenchmarkClaimReport;
    const expectedFile = benchmarkDeclarationFileName(report.benchmark);
    if (file !== expectedFile) {
      entries.push({
        benchmark: report.benchmark,
        blockers: [],
        computedPublicClaimAllowed: false,
        consistent: false,
        declaredPublicClaimAllowed: report.claimBoundary.publicClaimAllowed,
        file,
        notes: collectClaimNotes(report),
        readmeDisclosureFragments: [],
        readmeRequiredFragments: [],
        schemaErrors: [
          `claim declaration filename must be ${expectedFile} for benchmark ${report.benchmark}`,
        ],
        status: report.status,
      });
      continue;
    }
    const verdict = evaluateClaimBoundary(report, { currentPackageVersion });
    const evidenceErrors = evidenceErrorsByFile.get(file) ?? [];
    const blockers = [...verdict.blockers, ...evidenceErrors];
    const computedPublicClaimAllowed = verdict.publicClaimAllowed && evidenceErrors.length === 0;
    entries.push({
      benchmark: report.benchmark,
      blockers,
      computedPublicClaimAllowed,
      consistent:
        report.claimBoundary.publicClaimAllowed === computedPublicClaimAllowed &&
        evidenceErrors.length === 0,
      declaredPublicClaimAllowed: report.claimBoundary.publicClaimAllowed,
      file,
      notes: collectClaimNotes(report),
      readmeDisclosureFragments: report.publicClaim?.readmeDisclosureFragments ?? [],
      readmeRequiredFragments: report.publicClaim?.readmeRequiredFragments ?? [],
      schemaErrors: [],
      status: report.status,
    });
  }

  // Over-claiming is the dangerous direction: declaring a public claim the rules
  // forbid. (Under-claiming — declaring false when rules allow — is also flagged
  // as inconsistent but is merely overly cautious.)
  const overClaiming = entries.filter(
    (entry) => entry.declaredPublicClaimAllowed && !entry.computedPublicClaimAllowed,
  ).length;
  const publicClaimable = entries
    .filter((entry) => entry.computedPublicClaimAllowed && entry.consistent)
    .map((entry) => entry.benchmark);
  const historicalEvidence = entries
    .filter(
      (entry) =>
        entry.status === "internal_evidence" &&
        entry.consistent &&
        entry.schemaErrors.length === 0,
    )
    .map((entry) => entry.benchmark);
  const readmeChecks = checkReadmeClaimTables(readmes, entries);
  const historicalReadmeChecks = checkReadmeHistoricalEvidenceTables(readmes, entries);

  return {
    allConsistent: entries.every((entry) => entry.consistent && entry.schemaErrors.length === 0),
    currentPackageVersion: currentPackageVersion ?? null,
    entries,
    generatedAt: now,
    generatedBy: "scripts/run-public-benchmark-claim-gate.ts",
    historicalEvidence,
    historicalReadmeChecks,
    historicalReadmeConsistent: historicalReadmeChecks.every((check) => check.consistent),
    phase: "phase-67",
    publicClaimable,
    readmeChecks,
    readmeConsistent: readmeChecks.every((check) => check.consistent),
    summary: {
      consistent: entries.filter((entry) => entry.consistent).length,
      historicalEvidence: historicalEvidence.length,
      overClaiming,
      publicClaimable: publicClaimable.length,
      total: entries.length,
    },
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
  const readDirImpl = input.readDir ?? ((path: string) => readdir(path));
  const readFileImpl = input.readFile ?? ((path: string) => readFile(path, "utf8"));
  const now = (input.now ?? (() => new Date().toISOString()))();
  const packageMetadata = JSON.parse(
    await readFile(join(repoRoot, "package.json"), "utf8"),
  ) as unknown;
  if (!isRecord(packageMetadata) || !isStrictNonEmpty(packageMetadata.version)) {
    throw new Error("package.json must define a non-empty unpadded version.");
  }
  const currentPackageVersion =
    input.currentPackageVersion ?? packageMetadata.version;

  const files = (await readDirImpl(claimsDir)).filter((file) => file.endsWith(".json")).sort();
  const declarations: Array<{ file: string; value: unknown }> = [];
  for (const file of files) {
    const raw = await readFileImpl(join(claimsDir, file));
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch (error) {
      value = { __parseError: String(error) };
    }
    declarations.push({ file, value });
  }

  // A missing README (or missing table markers) is a real signal, not an error:
  // the check reports markersFound=false and fails --strict.
  const readmes: Array<{ content: string; file: string }> = [];
  for (const file of ["README.md", "README.zh-CN.md"]) {
    try {
      readmes.push({ content: await readFileImpl(join(repoRoot, file)), file });
    } catch {
      readmes.push({ content: "", file });
    }
  }

  const evidenceErrorsByFile = new Map<string, string[]>();
  for (const { file, value } of declarations) {
    const schema = validateClaimReport(value);
    if (!schema.valid) {
      continue;
    }
    const artifactErrors = await checkClaimEvidenceArtifacts({
      file,
      readFile: readFileImpl,
      repoRoot,
      report: value as BenchmarkClaimReport,
    });
    if (artifactErrors.length > 0) {
      evidenceErrorsByFile.set(file, artifactErrors);
    }
  }

  const report = buildClaimGateReport(
    declarations,
    now,
    readmes,
    evidenceErrorsByFile,
    currentPackageVersion,
  );
  const outputDir = input.outputDir ?? join(repoRoot, "reports", "release", "claims");
  await mkdir(outputDir, { recursive: true });
  await writeFile(join(outputDir, "claim-gate-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(join(outputDir, "summary.md"), renderClaimGateSummary(report));
  return report;
}

export function renderClaimGateSummary(report: ClaimGateReport): string {
  const lines: string[] = [];
  lines.push("# Public Benchmark Claim Gate");
  lines.push("");
  lines.push(`- generated: ${report.generatedAt}`);
  lines.push(`- current package version: ${report.currentPackageVersion ?? "unknown"}`);
  lines.push(
    `- declarations: ${report.summary.total} | consistent: ${report.summary.consistent} | ` +
      `over-claiming: ${report.summary.overClaiming} | current claims: ` +
      `${report.summary.publicClaimable} | historical evidence: ${report.summary.historicalEvidence}`,
  );
  lines.push(
    `- publicly claimable now: ${report.publicClaimable.length > 0 ? report.publicClaimable.join(", ") : "none"}`,
  );
  lines.push(
    `- versioned historical evidence: ${report.historicalEvidence.length > 0 ? report.historicalEvidence.join(", ") : "none"}`,
  );
  for (const check of report.readmeChecks) {
    const detail = !check.markersFound
      ? "current-claims-table markers missing"
      : check.consistent
        ? `${check.rows.length} row(s), consistent`
        : [
            check.forbiddenRows.length > 0
              ? `FORBIDDEN rows (declaration not claimable): ${check.forbiddenRows.join("; ")}`
              : "",
            check.unmatchedRows.length > 0
              ? `UNMATCHED rows (no declaration): ${check.unmatchedRows.join("; ")}`
              : "",
            check.missingClaimableBenchmarks.length > 0
              ? `MISSING claimable rows: ${check.missingClaimableBenchmarks.join("; ")}`
              : "",
            check.declarationLinkErrors.length > 0
              ? `BAD declaration links: ${check.declarationLinkErrors.join("; ")}`
              : "",
            check.claimContentErrors.length > 0
              ? `BAD claim content: ${check.claimContentErrors.join("; ")}`
              : "",
            check.disclosureErrors.length > 0
              ? `BAD disclosures: ${check.disclosureErrors.join("; ")}`
              : "",
          ]
            .filter((part) => part.length > 0)
            .join(" | ");
    lines.push(`- README check ${check.file}: ${check.consistent ? "OK" : "FAIL"} — ${detail}`);
  }
  for (const check of report.historicalReadmeChecks) {
    const detail = !check.markersFound
      ? "historical-evidence-table markers missing"
      : check.consistent
        ? `${check.rows.length} row(s), consistent`
        : [
            check.forbiddenRows.length > 0
              ? `FORBIDDEN historical rows: ${check.forbiddenRows.join("; ")}`
              : "",
            check.unmatchedRows.length > 0
              ? `UNMATCHED historical rows: ${check.unmatchedRows.join("; ")}`
              : "",
            check.missingClaimableBenchmarks.length > 0
              ? `MISSING historical rows: ${check.missingClaimableBenchmarks.join("; ")}`
              : "",
            check.declarationLinkErrors.length > 0
              ? `BAD declaration links: ${check.declarationLinkErrors.join("; ")}`
              : "",
            check.claimContentErrors.length > 0
              ? `BAD evidence content: ${check.claimContentErrors.join("; ")}`
              : "",
            check.disclosureErrors.length > 0
              ? `BAD disclosures: ${check.disclosureErrors.join("; ")}`
              : "",
          ]
            .filter((part) => part.length > 0)
            .join(" | ");
    lines.push(
      `- historical README check ${check.file}: ${check.consistent ? "OK" : "FAIL"} — ${detail}`,
    );
  }
  for (const entry of report.entries) {
    for (const note of entry.notes) {
      lines.push(`- note [${entry.benchmark}]: ${note}`);
    }
  }
  lines.push("");
  lines.push("| Benchmark | Status | Declared | Computed | Consistent | Blockers |");
  lines.push("|---|---|---|---|---|---|");
  for (const entry of report.entries) {
    const blockers =
      entry.schemaErrors.length > 0
        ? `SCHEMA: ${entry.schemaErrors.join("; ")}`
        : entry.blockers.length > 0
          ? entry.blockers.join("; ")
          : "(none)";
    lines.push(
      `| ${entry.benchmark} | ${entry.status} | ${entry.declaredPublicClaimAllowed} | ` +
        `${entry.computedPublicClaimAllowed} | ${entry.consistent ? "yes" : "NO"} | ` +
        `${blockers.replace(/\n/gu, " ").replace(/\|/gu, "\\|").slice(0, 200)} |`,
    );
  }
  lines.push("");
  lines.push(
    "A benchmark may be promoted to a public README row only when it is publicly" +
      " claimable (no blockers) and its declaration is consistent.",
  );
  lines.push("");
  return `${lines.join("\n")}\n`;
}

if (import.meta.main) {
  const options = parsePublicBenchmarkClaimGateCliOptions(Bun.argv);
  const report = await runPublicBenchmarkClaimGate({
    claimsDir: options.claimsDir,
  });
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
