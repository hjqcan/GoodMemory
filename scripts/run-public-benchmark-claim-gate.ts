// Phase 67-A public benchmark claim gate. Before any benchmark score is promoted
// to a public claim (e.g. a non-blank README benchmark row), it must have a claim
// declaration under benchmark-claims/<benchmark>.json, and that declaration's
// self-asserted `claimBoundary.publicClaimAllowed` must MATCH the verdict the gate
// computes from hard methodology rules. This catches over-claiming and binds
// every accepted projection to its exact tracked source bytes. It does not prove
// that an external benchmark execution actually occurred.
//
// The gate is pure governance tooling: it reads JSON declarations and applies
// deterministic rules. It runs no benchmarks and touches no benchmark code.
//
//   bun run scripts/run-public-benchmark-claim-gate.ts -- [--strict]
import { createHash } from "node:crypto";
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
const CURRENT_CLAIM_PROJECTION_KIND = "tracked-current-claim-projection";
const HISTORICAL_PROJECTION_KIND = "tracked-historical-evidence-projection";
const VERIFIED_PROJECTION_KIND = "verified-benchmark-claim-projection";
const EXECUTION_RECEIPT_KIND = "benchmark-execution-receipt";
const EXECUTION_RESULT_KIND = "benchmark-execution-result";
const HISTORICAL_ASSERTION_CONTRACT_ERROR =
  "historical evidence requires a schema-3 verified projection assertion contract";
const VERSIONED_CANDIDATE_IDENTITY_ERROR =
  "versioned candidate history requires a schema-3 verified projection and independent " +
  "execution receipt that bind benchmark, commit, tree, package, run, and source closure";
const CURRENT_CLAIM_PROJECTION_REQUIRED_ERROR =
  "candidate public claim requires a schema-3 verified projection and independent execution receipt";
const HISTORICAL_PROJECTION_REQUIRED_ERROR =
  "historical evidence requires a schema-3 verified projection and independent execution receipt";

export interface BenchmarkClaimComparison {
  asOf: string;
  availability: ClaimProfileAvailability;
  notes: string[];
  runtimeProfile: string;
  source: string;
}

export interface BenchmarkClaimPresentation {
  readmeDisclosureFragments: string[];
  readmeRequiredFragments: string[];
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
  historicalPresentation?: BenchmarkClaimPresentation;
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
  publicClaim?: BenchmarkClaimPresentation;
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

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index]);
}

function jsonValuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => jsonValuesEqual(value, right[index]));
  }
  if (!isRecord(left) || !isRecord(right)) {
    return false;
  }
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key, index) =>
        key === rightKeys[index] && jsonValuesEqual(left[key], right[key]),
    );
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
  if (normalized !== path || path.includes("\\")) {
    return "must use canonical forward-slash repo-relative form";
  }
  if (
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith(`..${"/"}`) ||
    path.split(/[\\/]+/u).includes("..")
  ) {
    return "must be a repo-relative path that does not escape the repository";
  }
  return null;
}

interface ProjectionSourceArtifact {
  bytes: number;
  path: string;
  sha256: string;
}

interface ProjectionSourceClosure {
  errors: string[];
  jsonDocumentsByPath: Map<string, unknown>;
}

export interface ClaimEvidenceRepositoryVerifier {
  readCommittedFile(path: string): Promise<string>;
  readFileAtCommit(commit: string, path: string): Promise<string>;
  resolveCommitTree(commit: string): Promise<string>;
}

function projectionSourceArtifacts(projection: Record<string, unknown>): {
  errors: string[];
  sources: ProjectionSourceArtifact[];
} {
  if (!Array.isArray(projection.sourceArtifacts) || projection.sourceArtifacts.length === 0) {
    return {
      errors: [
        "projection sourceArtifacts must be non-empty and each require repo-relative " +
          "path, positive bytes, and sha256",
      ],
      sources: [],
    };
  }

  const errors: string[] = [];
  const sources: ProjectionSourceArtifact[] = [];
  const seenPaths = new Set<string>();
  projection.sourceArtifacts.forEach((source, index) => {
    if (
      !isRecord(source) ||
      !isStrictNonEmpty(source.path) ||
      validateRepoRelativeArtifactPath(source.path) !== null ||
      typeof source.bytes !== "number" ||
      !Number.isSafeInteger(source.bytes) ||
      source.bytes <= 0 ||
      typeof source.sha256 !== "string" ||
      !SHA256_PATTERN.test(source.sha256)
    ) {
      errors.push(
        `projection sourceArtifacts[${index}] must define a repo-relative path, ` +
          "positive bytes, and sha256",
      );
      return;
    }
    if (seenPaths.has(source.path)) {
      errors.push(`projection sourceArtifacts contains duplicate path ${source.path}`);
      return;
    }
    seenPaths.add(source.path);
    sources.push({
      bytes: source.bytes,
      path: source.path,
      sha256: source.sha256,
    });
  });
  return { errors, sources };
}

async function verifyProjectionSourceClosure(input: {
  projection: Record<string, unknown>;
  readFile: (path: string) => Promise<string>;
  repoRoot: string;
}): Promise<ProjectionSourceClosure> {
  const manifest = projectionSourceArtifacts(input.projection);
  const errors = [...manifest.errors];
  const jsonDocumentsByPath = new Map<string, unknown>();
  for (const source of manifest.sources) {
    let content: string;
    try {
      content = await input.readFile(join(input.repoRoot, source.path));
    } catch (error) {
      errors.push(
        `projection source artifact ${source.path} cannot be read: ${String(error)}`,
      );
      continue;
    }
    const actualBytes = new TextEncoder().encode(content).byteLength;
    if (actualBytes !== source.bytes) {
      errors.push(
        `projection source artifact ${source.path} byte count expected ${source.bytes} ` +
          `but found ${actualBytes}`,
      );
    }
    const actualSha256 = createHash("sha256").update(content).digest("hex");
    if (actualSha256 !== source.sha256.toLowerCase()) {
      errors.push(
        `projection source artifact ${source.path} sha256 expected ${source.sha256} ` +
          `but found ${actualSha256}`,
      );
    }
    if (source.path.endsWith(".json")) {
      try {
        const parsed = JSON.parse(content);
        jsonDocumentsByPath.set(source.path, parsed);
      } catch (error) {
        errors.push(
          `projection source artifact ${source.path} is not valid JSON: ${String(error)}`,
        );
      }
    }
  }
  return { errors, jsonDocumentsByPath };
}

interface VerifiedProjectionBinding {
  projectionPath: ClaimEvidenceAssertionPath;
  sourceArtifactPath: string;
  sourceJsonPath: ClaimEvidenceAssertionPath;
}

function sourceArtifactEquals(
  source: ProjectionSourceArtifact,
  value: unknown,
): boolean {
  return isRecord(value) &&
    value.path === source.path &&
    value.bytes === source.bytes &&
    typeof value.sha256 === "string" &&
    value.sha256.toLowerCase() === source.sha256.toLowerCase();
}

function isExecutionReceiptIdentity(input: {
  benchmark: string;
  document: unknown;
  projection: Record<string, unknown>;
}): boolean {
  if (
    !isRecord(input.document) ||
    input.document.artifactKind !== EXECUTION_RECEIPT_KIND ||
    input.document.schemaVersion !== 1 ||
    input.document.benchmark !== input.benchmark ||
    !isRecord(input.document.runIdentity) ||
    !hasExactKeys(input.document.runIdentity, ["commit", "packageVersion", "runId", "tree"]) ||
    typeof input.document.runIdentity.commit !== "string" ||
    !FULL_COMMIT_PATTERN.test(input.document.runIdentity.commit) ||
    typeof input.document.runIdentity.tree !== "string" ||
    !FULL_COMMIT_PATTERN.test(input.document.runIdentity.tree) ||
    !isStrictNonEmpty(input.document.runIdentity.packageVersion) ||
    !isStrictNonEmpty(input.document.runIdentity.runId) ||
    projectionSourceArtifacts(input.document).errors.length > 0
  ) {
    return false;
  }
  return Object.is(
    input.document.runIdentity.commit,
    readAssertionValue(input.projection, ["run", "commit"]).value,
  ) && Object.is(
    input.document.runIdentity.tree,
    readAssertionValue(input.projection, ["run", "tree"]).value,
  ) && Object.is(
    input.document.runIdentity.packageVersion,
    readAssertionValue(input.projection, ["run", "packageVersion"]).value,
  ) && Object.is(
    input.document.runIdentity.runId,
    readAssertionValue(input.projection, ["run", "runId"]).value,
  );
}

function validateExecutionResult(
  value: unknown,
  label: string,
): string[] {
  const errors: string[] = [];
  const result = isRecord(value) ? value : undefined;
  const failures = result && isRecord(result.failures) ? result.failures : undefined;
  const coverage = result && isRecord(result.coverage) ? result.coverage : undefined;
  const metrics = result && isRecord(result.metrics) ? result.metrics : undefined;
  const counts = failures?.counts;
  const segments = coverage?.segments;
  if (
    !result ||
    !hasExactKeys(result, ["coverage", "failures", "metrics"]) ||
    !failures ||
    !hasExactKeys(failures, ["counts", "total"]) ||
    typeof failures.total !== "number" ||
    !Number.isSafeInteger(failures.total) ||
    failures.total < 0 ||
    !Array.isArray(counts) ||
    counts.length === 0 ||
    !counts.every(
      (count) => typeof count === "number" && Number.isSafeInteger(count) && count >= 0,
    ) ||
    !coverage ||
    !hasExactKeys(coverage, ["complete", "segments"]) ||
    typeof coverage.complete !== "boolean" ||
    !Array.isArray(segments) ||
    segments.length === 0 ||
    !segments.every(
      (segment) =>
        isRecord(segment) &&
        hasExactKeys(segment, ["actual", "expected", "name"]) &&
        isStrictNonEmpty(segment.name) &&
        typeof segment.actual === "number" &&
        Number.isSafeInteger(segment.actual) &&
        segment.actual >= 0 &&
        typeof segment.expected === "number" &&
        Number.isSafeInteger(segment.expected) &&
        segment.expected > 0,
    ) ||
    !metrics ||
    typeof metrics.score !== "number" ||
    !Number.isFinite(metrics.score) ||
    typeof metrics.baseline !== "number" ||
    !Number.isFinite(metrics.baseline) ||
    !Object.values(metrics).every(
      (metric) => typeof metric === "number" && Number.isFinite(metric),
    )
  ) {
    return [
      `${label} must define failures, coverage, and metrics using only canonical fields`,
    ];
  }
  const total = counts.reduce<number>((sum, count) => sum + count, 0);
  if (failures.total !== total) {
    errors.push(
      `${label} failures.total ${failures.total} must equal count total ${total}`,
    );
  }
  const complete = segments.every(
    (segment) => isRecord(segment) && segment.actual === segment.expected,
  );
  if (coverage.complete !== complete) {
    errors.push(
      `${label} coverage.complete ${coverage.complete} must equal ${complete}`,
    );
  }
  return errors;
}

function validateExecutionReceiptResult(document: Record<string, unknown>): string[] {
  return validateExecutionResult(document.result, "execution receipt result");
}

function validateCanonicalExecutionResult(input: {
  benchmark: string;
  document: unknown;
  receipt: Record<string, unknown>;
}): string[] {
  if (!isRecord(input.document)) {
    return ["canonical execution result must be a JSON object"];
  }
  const errors: string[] = [];
  if (
    !hasExactKeys(input.document, [
      "artifactKind",
      "benchmark",
      "result",
      "runIdentity",
      "schemaVersion",
    ])
  ) {
    errors.push(
      "canonical execution result must contain only artifactKind, benchmark, result, " +
        "runIdentity, and schemaVersion",
    );
  }
  if (
    input.document.artifactKind !== EXECUTION_RESULT_KIND ||
    input.document.schemaVersion !== 1 ||
    input.document.benchmark !== input.benchmark
  ) {
    errors.push(
      `canonical execution result must use ${EXECUTION_RESULT_KIND} schema 1 and ` +
        `benchmark ${input.benchmark}`,
    );
  }
  if (
    !isRecord(input.document.runIdentity) ||
    !hasExactKeys(input.document.runIdentity, ["commit", "packageVersion", "runId", "tree"]) ||
    !jsonValuesEqual(input.document.runIdentity, input.receipt.runIdentity)
  ) {
    errors.push(
      "canonical execution result runIdentity must exactly equal the execution receipt",
    );
  }
  errors.push(...validateExecutionResult(
    input.document.result,
    "canonical execution result result",
  ));
  if (!jsonValuesEqual(input.document.result, input.receipt.result)) {
    errors.push(
      "canonical execution result result must exactly equal the execution receipt result",
    );
  }
  return errors;
}

function executionReceiptBindingPath(
  projectionPath: ClaimEvidenceAssertionPath,
): ClaimEvidenceAssertionPath | undefined {
  if (
    projectionPath.length === 2 &&
    projectionPath[0] === "run" &&
    ["commit", "packageVersion", "runId", "tree"].includes(String(projectionPath[1]))
  ) {
    return ["runIdentity", projectionPath[1]!];
  }
  if (assertionPathEquals(projectionPath, ["run", "executionFailures"])) {
    return ["result", "failures", "total"];
  }
  if (
    projectionPath.length === 3 &&
    projectionPath[0] === "run" &&
    projectionPath[1] === "executionFailureCounts" &&
    typeof projectionPath[2] === "number"
  ) {
    return ["result", "failures", "counts", projectionPath[2]];
  }
  if (assertionPathEquals(projectionPath, ["coverage", "complete"])) {
    return ["result", "coverage", "complete"];
  }
  if (
    projectionPath.length === 4 &&
    projectionPath[0] === "coverage" &&
    projectionPath[1] === "segments" &&
    typeof projectionPath[2] === "number" &&
    ["actual", "expected", "name"].includes(String(projectionPath[3]))
  ) {
    return [
      "result",
      "coverage",
      "segments",
      projectionPath[2],
      projectionPath[3]!,
    ];
  }
  if (
    projectionPath.length === 2 &&
    projectionPath[0] === "metrics" &&
    typeof projectionPath[1] === "string"
  ) {
    return ["result", "metrics", projectionPath[1]];
  }
  return undefined;
}

async function verifyCommittedArtifact(input: {
  readFile: (path: string) => Promise<string>;
  repoRoot: string;
  repository: ClaimEvidenceRepositoryVerifier;
  source: ProjectionSourceArtifact;
}): Promise<{ content?: string; errors: string[] }> {
  const errors: string[] = [];
  let content: string;
  try {
    content = await input.readFile(join(input.repoRoot, input.source.path));
  } catch (error) {
    return {
      errors: [
        `execution source artifact ${input.source.path} cannot be read: ${String(error)}`,
      ],
    };
  }
  const bytes = new TextEncoder().encode(content).byteLength;
  const sha256 = createHash("sha256").update(content).digest("hex");
  if (bytes !== input.source.bytes || sha256 !== input.source.sha256.toLowerCase()) {
    errors.push(
      `execution source artifact ${input.source.path} does not match its declared bytes/sha256`,
    );
  }
  try {
    const committed = await input.repository.readCommittedFile(input.source.path);
    if (committed !== content) {
      errors.push(
        `execution source artifact ${input.source.path} does not match committed Git bytes`,
      );
    }
  } catch (error) {
    errors.push(
      `execution source artifact ${input.source.path} is not tracked and committed: ` +
        String(error),
    );
  }
  return { content, errors };
}

async function verifyExecutionReceipt(input: {
  benchmark: string;
  document: Record<string, unknown>;
  path: string;
  projection: Record<string, unknown>;
  readFile: (path: string) => Promise<string>;
  repoRoot: string;
  repository?: ClaimEvidenceRepositoryVerifier;
}): Promise<string[]> {
  const errors: string[] = [];
  if (!isExecutionReceiptIdentity({
    benchmark: input.benchmark,
    document: input.document,
    projection: input.projection,
  })) {
    return [
      `execution receipt ${input.path} must use ${EXECUTION_RECEIPT_KIND} schema 1 ` +
      "and match projection commit, tree, packageVersion, and runId",
    ];
  }
  if (
    !hasExactKeys(input.document, [
      "artifactKind",
      "benchmark",
      "result",
      "resultEvidence",
      "runEvidence",
      "runIdentity",
      "schemaVersion",
      "sourceArtifacts",
    ])
  ) {
    errors.push(
      `execution receipt ${input.path} must contain only the canonical receipt fields`,
    );
  }
  errors.push(...validateExecutionReceiptResult(input.document));
  if (!input.repository) {
    errors.push(
      `execution receipt ${input.path} cannot be verified without Git repository access`,
    );
    return errors;
  }

  const projectionManifest = projectionSourceArtifacts(input.projection);
  const receiptManifest = projectionSourceArtifacts(input.document);
  const receiptSourceByPath = new Map(
    receiptManifest.sources.map((source) => [source.path, source]),
  );
  const projectionExecutionSources = projectionManifest.sources.filter(
    (source) => source.path !== input.path,
  );
  for (const source of projectionExecutionSources) {
    const declared = receiptSourceByPath.get(source.path);
    if (!declared || !sourceArtifactEquals(source, declared)) {
      errors.push(
        `execution receipt ${input.path} does not bind exact projection source ${source.path}`,
      );
    }
  }
  for (const source of receiptManifest.sources) {
    const projected = projectionExecutionSources.find(
      (candidate) => candidate.path === source.path,
    );
    if (!projected || !sourceArtifactEquals(source, projected)) {
      errors.push(
        `execution receipt ${input.path} declares source ${source.path} outside the exact ` +
          "projection source closure",
      );
    }
  }

  const receiptSourceDocuments = new Map<string, unknown>();
  for (const source of receiptManifest.sources) {
    const verified = await verifyCommittedArtifact({
      readFile: input.readFile,
      repoRoot: input.repoRoot,
      repository: input.repository,
      source,
    });
    errors.push(...verified.errors);
    if (verified.content !== undefined && source.path.endsWith(".json")) {
      try {
        receiptSourceDocuments.set(source.path, JSON.parse(verified.content));
      } catch (error) {
        errors.push(
          `execution source artifact ${source.path} is not valid JSON: ${String(error)}`,
        );
      }
    }
  }

  const canonicalResults = receiptManifest.sources.flatMap((source) => {
    const document = receiptSourceDocuments.get(source.path);
    return isRecord(document) && document.artifactKind === EXECUTION_RESULT_KIND
      ? [{ document, source }]
      : [];
  });
  const resultEvidence = input.document.resultEvidence;
  const resultEvidencePath = isRecord(resultEvidence) &&
      hasExactKeys(resultEvidence, ["sourceArtifactPath"]) &&
      isStrictNonEmpty(resultEvidence.sourceArtifactPath) &&
      validateRepoRelativeArtifactPath(resultEvidence.sourceArtifactPath) === null &&
      resultEvidence.sourceArtifactPath.startsWith("benchmark-claims/evidence/")
    ? resultEvidence.sourceArtifactPath
    : undefined;
  if (
    resultEvidencePath === undefined ||
    canonicalResults.length !== 1 ||
    canonicalResults[0]?.source.path !== resultEvidencePath
  ) {
    errors.push(
      `execution receipt ${input.path} resultEvidence must bind exactly one canonical ` +
        "execution result under benchmark-claims/evidence",
    );
  }
  const canonicalResult = canonicalResults[0];
  if (canonicalResult) {
    errors.push(...validateCanonicalExecutionResult({
      benchmark: input.benchmark,
      document: canonicalResult.document,
      receipt: input.document,
    }));
  }
  const receiptResult = isRecord(input.document.result) ? input.document.result : undefined;
  if (
    receiptResult &&
    isRecord(receiptResult.metrics) &&
    !jsonValuesEqual(receiptResult.metrics, input.projection.metrics)
  ) {
    errors.push(
      `execution receipt ${input.path} result.metrics must exactly equal projection metrics`,
    );
  }

  const runIdentity = input.document.runIdentity as Record<string, unknown>;
  const commit = runIdentity.commit as string;
  const tree = runIdentity.tree as string;
  const packageVersion = runIdentity.packageVersion as string;
  try {
    const actualTree = await input.repository.resolveCommitTree(commit);
    if (actualTree !== tree) {
      errors.push(
        `execution receipt ${input.path} tree ${tree} does not match commit ${commit} tree ` +
          actualTree,
      );
    }
  } catch (error) {
    errors.push(`execution receipt ${input.path} commit ${commit} cannot be resolved: ${String(error)}`);
  }
  try {
    const packageJson = JSON.parse(
      await input.repository.readFileAtCommit(commit, "package.json"),
    ) as unknown;
    if (!isRecord(packageJson) || packageJson.version !== packageVersion) {
      errors.push(
        `execution receipt ${input.path} packageVersion ${packageVersion} does not match ` +
          `package.json at commit ${commit}`,
      );
    }
  } catch (error) {
    errors.push(
      `execution receipt ${input.path} cannot read package.json at commit ${commit}: ` +
        String(error),
    );
  }

  const runEvidence = input.document.runEvidence;
  if (
    !isRecord(runEvidence) ||
    !hasExactKeys(runEvidence, ["runIdPath", "sourceArtifactPath"]) ||
    !isStrictNonEmpty(runEvidence.sourceArtifactPath) ||
    validateRepoRelativeArtifactPath(runEvidence.sourceArtifactPath) !== null ||
    !Array.isArray(runEvidence.runIdPath) ||
    runEvidence.runIdPath.length === 0 ||
    !runEvidence.runIdPath.every(isValidAssertionPathSegment)
  ) {
    errors.push(
      `execution receipt ${input.path} runEvidence must bind runIdentity.runId to a JSON source`,
    );
  } else {
    const runDocument = receiptSourceDocuments.get(runEvidence.sourceArtifactPath);
    const sourceRunId = readAssertionValue(runDocument, runEvidence.runIdPath);
    if (!sourceRunId.found || sourceRunId.value !== runIdentity.runId) {
      errors.push(
        `execution receipt ${input.path} runIdentity.runId is not bound by ` +
          `${runEvidence.sourceArtifactPath}:${renderAssertionPath(runEvidence.runIdPath)}`,
      );
    }
  }
  return errors;
}

function parseVerifiedProjectionBinding(
  value: unknown,
  index: number,
  errors: string[],
): VerifiedProjectionBinding | undefined {
  if (
    !isRecord(value) ||
    !Array.isArray(value.projectionPath) ||
    value.projectionPath.length === 0 ||
    !value.projectionPath.every(isValidAssertionPathSegment) ||
    !isStrictNonEmpty(value.sourceArtifactPath) ||
    validateRepoRelativeArtifactPath(value.sourceArtifactPath) !== null ||
    !Array.isArray(value.sourceJsonPath) ||
    value.sourceJsonPath.length === 0 ||
    !value.sourceJsonPath.every(isValidAssertionPathSegment)
  ) {
    errors.push(
      `verified projection bindings[${index}] must define projectionPath, ` +
        "sourceArtifactPath, and sourceJsonPath",
    );
    return undefined;
  }
  return {
    projectionPath: value.projectionPath,
    sourceArtifactPath: value.sourceArtifactPath,
    sourceJsonPath: value.sourceJsonPath,
  };
}

function sourceBindingNamesBenchmark(input: {
  benchmark: string;
  document: unknown;
  sourceJsonPath: ClaimEvidenceAssertionPath;
}): boolean {
  if (!isRecord(input.document)) {
    return false;
  }
  const expected = normalizedBenchmark(input.benchmark);
  if (
    typeof input.document.benchmark === "string" &&
    normalizedBenchmark(input.document.benchmark) === expected
  ) {
    return true;
  }
  return input.sourceJsonPath.some(
    (segment) => typeof segment === "string" && normalizedBenchmark(segment) === expected,
  );
}

function requireProjectionAssertion(input: {
  artifact: ClaimEvidenceArtifact;
  errors: string[];
  path: ClaimEvidenceAssertionPath;
  projection: Record<string, unknown>;
}): void {
  const actual = readAssertionValue(input.projection, input.path);
  if (!actual.found || !isJsonScalar(actual.value)) {
    input.errors.push(
      `verified projection field ${renderAssertionPath(input.path)} must be a JSON scalar`,
    );
    return;
  }
  if (!hasExactAssertion(input.artifact.assertions, input.path, actual.value)) {
    input.errors.push(
      `verified projection field ${renderAssertionPath(input.path)} must be bound by ` +
        "a declaration assertion",
    );
  }
}

async function validateVerifiedProjection(input: {
  artifact: ClaimEvidenceArtifact;
  bindToReport: boolean;
  parsed: Record<string, unknown>;
  presentation: "current" | "historical";
  readFile: (path: string) => Promise<string>;
  report: BenchmarkClaimReport;
  repoRoot: string;
  repository?: ClaimEvidenceRepositoryVerifier;
  sourceDocumentsByPath: ReadonlyMap<string, unknown>;
}): Promise<string[]> {
  const errors: string[] = [];
  const projection = input.parsed;
  if (projection.artifactKind !== VERIFIED_PROJECTION_KIND) {
    errors.push(`verified projection artifactKind must be ${VERIFIED_PROJECTION_KIND}`);
  }
  const expectedSchemaVersion = 3;
  if (projection.schemaVersion !== expectedSchemaVersion) {
    errors.push(`verified projection schemaVersion must be ${expectedSchemaVersion}`);
  }
  if (projection.presentation !== input.presentation) {
    errors.push(`verified projection presentation must be ${input.presentation}`);
  }
  if (projection.benchmark !== input.report.benchmark) {
    errors.push(`verified projection benchmark must equal ${input.report.benchmark}`);
  }
  if (!isStrictNonEmpty(projection.generatedBy)) {
    errors.push("verified projection generatedBy must be a non-empty unpadded string");
  }

  const run = isRecord(projection.run) ? projection.run : undefined;
  const coverage = isRecord(projection.coverage) ? projection.coverage : undefined;
  const metrics = isRecord(projection.metrics) ? projection.metrics : undefined;
  const executionFailureCounts = run?.executionFailureCounts;
  const coverageSegments = coverage?.segments;
  if (
    !run ||
    typeof run.commit !== "string" ||
    !FULL_COMMIT_PATTERN.test(run.commit) ||
    !isStrictNonEmpty(run.packageVersion) ||
    typeof run.tree !== "string" ||
    !FULL_COMMIT_PATTERN.test(run.tree) ||
    !isStrictNonEmpty(run.runId) ||
    typeof run.executionFailures !== "number" ||
    !Number.isSafeInteger(run.executionFailures) ||
    run.executionFailures < 0 ||
    !Array.isArray(executionFailureCounts) ||
    executionFailureCounts.length === 0 ||
    !executionFailureCounts.every(
      (count) => typeof count === "number" && Number.isSafeInteger(count) && count >= 0,
    )
  ) {
    errors.push(
      "verified projection run must define commit, tree, packageVersion, runId, " +
        "executionFailures, and non-empty executionFailureCounts",
    );
  } else {
    const total = executionFailureCounts.reduce<number>((sum, count) => sum + count, 0);
    if (run.executionFailures !== total) {
      errors.push(
        `verified projection run.executionFailures ${run.executionFailures} must equal ` +
          `the source-bound failure count total ${total}`,
      );
    }
    if (run.executionFailures !== 0) {
      errors.push("verified projection executionFailures must be 0");
    }
    if (input.bindToReport) {
      if (run.commit !== input.report.run.commit) {
        errors.push(`verified projection run commit must equal ${input.report.run.commit}`);
      }
      if (run.packageVersion !== input.report.run.packageVersion) {
        errors.push(
          `verified projection packageVersion must equal ${input.report.run.packageVersion}`,
        );
      }
      if (run.tree !== input.report.run.tree) {
        errors.push(`verified projection run tree must equal ${input.report.run.tree}`);
      }
      if (run.runId !== input.report.run.runId) {
        errors.push(`verified projection runId must equal ${input.report.run.runId}`);
      }
      if (run.executionFailures !== input.report.run.executionFailures) {
        errors.push(
          "verified projection executionFailures must equal declaration " +
            `run.executionFailures ${input.report.run.executionFailures}`,
        );
      }
    }
  }

  if (
    !coverage ||
    typeof coverage.complete !== "boolean" ||
    !Array.isArray(coverageSegments) ||
    coverageSegments.length === 0 ||
    !coverageSegments.every(
      (segment) =>
        isRecord(segment) &&
        isStrictNonEmpty(segment.name) &&
        typeof segment.actual === "number" &&
        Number.isSafeInteger(segment.actual) &&
        segment.actual >= 0 &&
        typeof segment.expected === "number" &&
        Number.isSafeInteger(segment.expected) &&
        segment.expected > 0,
    )
  ) {
    errors.push(
      "verified projection coverage must define complete and non-empty counted segments",
    );
  } else {
    const complete = coverageSegments.every(
      (segment) => isRecord(segment) && segment.actual === segment.expected,
    );
    if (coverage.complete !== complete) {
      errors.push(
        `verified projection coverage.complete ${coverage.complete} must equal source-bound ` +
          `coverage result ${complete}`,
      );
    }
    if (!coverage.complete) {
      errors.push("verified projection coverage must be complete");
    }
    if (input.bindToReport && coverage.complete !== input.report.coverage?.complete) {
      errors.push(
        "verified projection coverage.complete must equal declaration coverage.complete",
      );
    }
  }

  if (
    !metrics ||
    typeof metrics.score !== "number" ||
    !Number.isFinite(metrics.score) ||
    typeof metrics.baseline !== "number" ||
    !Number.isFinite(metrics.baseline) ||
    !Object.values(metrics).every(
      (metric) => typeof metric === "number" && Number.isFinite(metric),
    )
  ) {
    errors.push("verified projection metrics must contain only finite numbers, including score and baseline");
  } else if (input.bindToReport) {
    if (!Object.is(metrics.score, input.report.metrics.score)) {
      errors.push(
        `verified projection score must equal declaration metrics.score ${input.report.metrics.score}`,
      );
    }
    if (!Object.is(metrics.baseline, input.report.metrics.baseline)) {
      errors.push(
        "verified projection baseline must equal declaration metrics.baseline " +
          String(input.report.metrics.baseline),
      );
    }
  }

  const requiredAssertions: ClaimEvidenceAssertionPath[] = [
    ["artifactKind"],
    ["benchmark"],
    ["schemaVersion"],
    ["presentation"],
    ["run", "commit"],
    ["run", "packageVersion"],
    ["run", "executionFailures"],
    ["coverage", "complete"],
    ["metrics", "score"],
    ["metrics", "baseline"],
  ];
  requiredAssertions.push(["run", "tree"], ["run", "runId"]);
  for (const path of requiredAssertions) {
    requireProjectionAssertion({
      artifact: input.artifact,
      errors,
      path,
      projection,
    });
  }

  const requiredBindingPaths: ClaimEvidenceAssertionPath[] = [
    ["run", "commit"],
    ["run", "packageVersion"],
    ["run", "executionFailures"],
    ["coverage", "complete"],
  ];
  requiredBindingPaths.push(["run", "tree"], ["run", "runId"]);
  if (metrics) {
    for (const metric of Object.keys(metrics)) {
      requiredBindingPaths.push(["metrics", metric]);
    }
  }
  if (Array.isArray(executionFailureCounts)) {
    executionFailureCounts.forEach((_, index) => {
      requiredBindingPaths.push(["run", "executionFailureCounts", index]);
    });
  }
  if (Array.isArray(coverageSegments)) {
    coverageSegments.forEach((_, index) => {
      requiredBindingPaths.push(["coverage", "segments", index, "name"]);
      requiredBindingPaths.push(["coverage", "segments", index, "actual"]);
      requiredBindingPaths.push(["coverage", "segments", index, "expected"]);
    });
  }

  if (!Array.isArray(projection.bindings) || projection.bindings.length === 0) {
    errors.push("verified projection bindings must be a non-empty array");
    return errors;
  }
  const bindings = projection.bindings.flatMap((binding, index) => {
    const parsed = parseVerifiedProjectionBinding(binding, index, errors);
    return parsed ? [parsed] : [];
  });
  const seenProjectionPaths = new Set<string>();
  const sourceManifest = projectionSourceArtifacts(projection);
  const receiptDocuments = sourceManifest.sources.flatMap((source) => {
    const document = input.sourceDocumentsByPath.get(source.path);
    return source.path.startsWith("benchmark-claims/evidence/") &&
      isRecord(document) &&
      document.artifactKind === EXECUTION_RECEIPT_KIND
      ? [document]
      : [];
  });
  const receiptDocument = receiptDocuments[0];
  const receiptSource = receiptDocument
    ? sourceManifest.sources.find(
        (source) => input.sourceDocumentsByPath.get(source.path) === receiptDocument,
      )
    : undefined;
  {
    for (const source of sourceManifest.sources) {
      const document = input.sourceDocumentsByPath.get(source.path);
      if (isRecord(document) && document.artifactKind === CURRENT_CLAIM_PROJECTION_KIND) {
        const nestedClosure = await verifyProjectionSourceClosure({
          projection: document,
          readFile: input.readFile,
          repoRoot: input.repoRoot,
        });
        errors.push(...nestedClosure.errors.map(
          (error) => `legacy current projection ${source.path}: ${error}`,
        ));
      }
    }
    if (receiptDocuments.length !== 1) {
      errors.push("verified projection requires exactly one independent execution receipt");
    } else if (receiptDocument && receiptSource) {
      if (input.repository) {
        const committedReceipt = await verifyCommittedArtifact({
          readFile: input.readFile,
          repoRoot: input.repoRoot,
          repository: input.repository,
          source: receiptSource,
        });
        errors.push(...committedReceipt.errors);
      }
      errors.push(...await verifyExecutionReceipt({
        benchmark: input.report.benchmark,
        document: receiptDocument,
        path: receiptSource.path,
        projection,
        readFile: input.readFile,
        repoRoot: input.repoRoot,
        repository: input.repository,
      }));
    }
  }
  for (const binding of bindings) {
    const renderedProjectionPath = renderAssertionPath(binding.projectionPath);
    if (seenProjectionPaths.has(renderedProjectionPath)) {
      errors.push(`verified projection has duplicate binding for ${renderedProjectionPath}`);
      continue;
    }
    seenProjectionPaths.add(renderedProjectionPath);
    const projected = readAssertionValue(projection, binding.projectionPath);
    const sourceDocument = input.sourceDocumentsByPath.get(binding.sourceArtifactPath);
    const sourced = readAssertionValue(sourceDocument, binding.sourceJsonPath);
    if (!projected.found) {
      errors.push(`source binding ${renderedProjectionPath} projection path was not found`);
      continue;
    }
    const canonicalReceiptPath = executionReceiptBindingPath(binding.projectionPath);
    if (
      !receiptSource ||
      binding.sourceArtifactPath !== receiptSource.path ||
      !canonicalReceiptPath ||
      !assertionPathEquals(binding.sourceJsonPath, canonicalReceiptPath)
    ) {
      errors.push(
        `source binding ${renderedProjectionPath} must use the canonical execution ` +
          "receipt result path",
      );
    }
    if (!sourced.found) {
      errors.push(
        `source binding ${renderedProjectionPath} source path ` +
          `${renderAssertionPath(binding.sourceJsonPath)} was not found in ` +
          binding.sourceArtifactPath,
      );
      continue;
    }
    if (!Object.is(projected.value, sourced.value)) {
      errors.push(
        `source binding ${renderedProjectionPath} expected ` +
          `${formatAssertionValue(projected.value)} but source contained ` +
          formatAssertionValue(sourced.value),
      );
    }
    if (!sourceBindingNamesBenchmark({
      benchmark: input.report.benchmark,
      document: sourceDocument,
      sourceJsonPath: binding.sourceJsonPath,
    })) {
      errors.push(
        `source benchmark identity for ${renderedProjectionPath} does not name ` +
          input.report.benchmark,
      );
    }
  }
  for (const path of requiredBindingPaths) {
    const rendered = renderAssertionPath(path);
    if (!seenProjectionPaths.has(rendered)) {
      errors.push(`verified projection requires a source binding for ${rendered}`);
    }
  }
  return errors;
}

function normalizedBenchmark(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/gu, "");
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

function validateLegacyCurrentProjectionIdentity(input: {
  parsed: unknown;
  report: BenchmarkClaimReport;
}): string[] {
  if (!isRecord(input.parsed)) {
    return ["current-claim projection must be a JSON object"];
  }
  const errors: string[] = [];
  const projection = input.parsed;
  if (projection.artifactKind !== CURRENT_CLAIM_PROJECTION_KIND) {
    errors.push(
      `current-claim projection artifactKind must be ${CURRENT_CLAIM_PROJECTION_KIND}`,
    );
  }
  if (!isStrictNonEmpty(projection.generatedBy)) {
    errors.push("current-claim projection generatedBy must be a non-empty unpadded string");
  }
  if (projection.schemaVersion !== 1) {
    errors.push("current-claim projection schemaVersion must be 1");
  }
  if (projection.benchmark !== input.report.benchmark) {
    errors.push(
      `current-claim projection benchmark must equal ${input.report.benchmark}`,
    );
  }
  const claim = projection.claim;
  if (
    !isRecord(claim) ||
    claim.packageVersion !== input.report.run.packageVersion
  ) {
    errors.push(
      `current-claim projection packageVersion must equal ${input.report.run.packageVersion}`,
    );
  }
  const runIdentity = projection.runIdentity;
  if (
    !isRecord(runIdentity) ||
    typeof runIdentity.commit !== "string" ||
    !FULL_COMMIT_PATTERN.test(runIdentity.commit) ||
    runIdentity.commit !== input.report.run.commit
  ) {
    errors.push(
      `current-claim projection run commit must equal ${input.report.run.commit}`,
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
  if (projection.artifactKind === VERIFIED_PROJECTION_KIND) {
    const metrics = projectionRecord(projection.metrics, "metrics");
    if (benchmark !== "LoCoMo") {
      return [
        projectionNumber(metrics, "score").toFixed(4),
        projectionNumber(metrics, "baseline").toFixed(4),
      ];
    }
    const openDomainCorrect = projectionNumber(metrics, "openDomainCorrect");
    const openDomainTotal = projectionNumber(metrics, "openDomainTotal");
    const openDomainScore = projectionNumber(metrics, "openDomainScore");
    if (
      !Number.isSafeInteger(openDomainCorrect) ||
      !Number.isSafeInteger(openDomainTotal) ||
      openDomainCorrect < 0 ||
      openDomainTotal <= 0 ||
      openDomainCorrect > openDomainTotal ||
      openDomainScore !== openDomainCorrect / openDomainTotal
    ) {
      throw new Error(
        "openDomainScore must equal a valid openDomainCorrect/openDomainTotal count",
      );
    }
    return [
      projectionNumber(metrics, "strictScore").toFixed(4),
      projectionNumber(metrics, "score").toFixed(4),
      openDomainScore.toFixed(4),
      `${openDomainCorrect}/${openDomainTotal}`,
      projectionNumber(metrics, "baseline").toFixed(4),
    ];
  }
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

function hasVerifiedProjectionAssertionContract(
  artifact: Record<string, unknown>,
  benchmark: string,
  presentation: "current" | "historical",
): boolean {
  return hasExactAssertion(
    artifact.assertions,
    ["artifactKind"],
    VERIFIED_PROJECTION_KIND,
  ) &&
    hasExactAssertion(artifact.assertions, ["benchmark"], benchmark) &&
    hasExactAssertion(
      artifact.assertions,
      ["schemaVersion"],
      3,
    ) &&
    hasExactAssertion(artifact.assertions, ["presentation"], presentation);
}

function isDeclaredVerifiedProjection(
  artifact: unknown,
  benchmark: string,
  presentation: "current" | "historical",
): artifact is ClaimEvidenceArtifact {
  return isRecord(artifact) &&
    isStrictNonEmpty(artifact.path) &&
    validateRepoRelativeArtifactPath(artifact.path) === null &&
    artifact.path.endsWith(".json") &&
    artifact.path.startsWith("benchmark-claims/evidence/") &&
    hasVerifiedProjectionAssertionContract(artifact, benchmark, presentation);
}

function isDeclaredHistoricalProjection(
  artifact: unknown,
  benchmark: string,
): artifact is ClaimEvidenceArtifact {
  return isDeclaredVerifiedProjection(artifact, benchmark, "historical");
}

function benchmarkDeclarationFileName(benchmark: string): string {
  return `${benchmark.toLowerCase().replace(/[^a-z0-9]+/gu, "")}.json`;
}

function validatePresentationFragments(input: {
  errors: string[];
  field: "readmeDisclosureFragments" | "readmeRequiredFragments";
  presentation: "historicalPresentation" | "publicClaim";
  value: unknown;
}): void {
  if (!Array.isArray(input.value) || input.value.length === 0) {
    const suffix = input.presentation === "publicClaim"
      ? " for public claim declarations"
      : "";
    input.errors.push(
      `${input.presentation}.${input.field} must be a non-empty array${suffix}`,
    );
    return;
  }
  const seenFragments = new Set<string>();
  input.value.forEach((fragment, index) => {
    if (!isStrictNonEmpty(fragment)) {
      input.errors.push(
        `${input.presentation}.${input.field}[${index}] must be a non-empty unpadded string`,
      );
      return;
    }
    if (seenFragments.has(fragment)) {
      input.errors.push(
        `${input.presentation}.${input.field}[${index}] duplicates fragment ${fragment}`,
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
  if (!isNonEmpty(report.run.tree) || !FULL_COMMIT_PATTERN.test(report.run.tree)) {
    blockers.push(
      "run.tree must be a complete 40-character hexadecimal tree (not reproducible)",
    );
  }
  if (!isNonEmpty(report.run.runId)) {
    blockers.push("run.runId missing (not reproducible)");
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
          !hasVerifiedProjectionAssertionContract(
            artifact,
            value.benchmark,
            "historical",
          )
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
    const requiresExecutionIdentity =
      value.status === "candidate_public_claim" ||
      (
        value.status === "internal_evidence" &&
        isRecord(value.comparison) &&
        value.comparison.availability === "historical"
      );
    if (requiresExecutionIdentity) {
      if (!isStrictNonEmpty(value.run.tree) || !FULL_COMMIT_PATTERN.test(value.run.tree)) {
        errors.push(
          "verified-evidence run.tree must be a complete 40-character hexadecimal tree",
        );
      }
      if (!isStrictNonEmpty(value.run.runId)) {
        errors.push("verified-evidence run.runId must be a non-empty unpadded string");
      }
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
      validatePresentationFragments({
        errors,
        field: "readmeRequiredFragments",
        presentation: "publicClaim",
        value: value.publicClaim.readmeRequiredFragments,
      });
      validatePresentationFragments({
        errors,
        field: "readmeDisclosureFragments",
        presentation: "publicClaim",
        value: value.publicClaim.readmeDisclosureFragments,
      });
    }
  }
  if (value.historicalPresentation !== undefined) {
    const benchmark = isNonEmpty(value.benchmark) ? value.benchmark : undefined;
    if (!isRecord(value.historicalPresentation)) {
      errors.push("historicalPresentation must be an object when present");
    } else {
      validatePresentationFragments({
        errors,
        field: "readmeRequiredFragments",
        presentation: "historicalPresentation",
        value: value.historicalPresentation.readmeRequiredFragments,
      });
      validatePresentationFragments({
        errors,
        field: "readmeDisclosureFragments",
        presentation: "historicalPresentation",
        value: value.historicalPresentation.readmeDisclosureFragments,
      });
    }
    if (
      value.status === "candidate_public_claim" &&
      benchmark !== undefined &&
      isRecord(value.evidence) &&
      Array.isArray(value.evidence.artifacts) &&
      !value.evidence.artifacts.some((artifact) =>
        isDeclaredHistoricalProjection(artifact, benchmark)
      )
    ) {
      errors.push(
        "historicalPresentation requires a tracked historical projection with the complete assertion contract",
      );
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
  historicalEvidenceEligible: boolean;
  historicalReadmeDisclosureFragments: string[];
  historicalReadmeRequiredFragments: string[];
  notes: string[];
  readmeDisclosureFragments: string[];
  readmeRequiredFragments: string[];
  schemaErrors: string[];
  status: ClaimStatus;
}

export async function checkClaimEvidenceArtifacts(input: {
  currentPackageVersion?: string;
  file: string;
  readFile: (path: string) => Promise<string>;
  repoRoot: string;
  repository?: ClaimEvidenceRepositoryVerifier;
  report: BenchmarkClaimReport;
}): Promise<string[]> {
  const errors: string[] = [];
  const requiresCurrentProjection = input.report.status === "candidate_public_claim";
  const requiresInternalHistoricalProjection =
    input.report.status === "internal_evidence" &&
    input.report.comparison.availability === "historical";
  const requiresCandidateHistoricalProjection =
    input.report.status === "candidate_public_claim" &&
    input.report.historicalPresentation !== undefined;
  let verifiedCurrentProjection = false;
  let verifiedHistoricalProjection = false;
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
      const projectionKind = isRecord(parsed) ? parsed.artifactKind : undefined;
      const isCurrentProjection = projectionKind === CURRENT_CLAIM_PROJECTION_KIND;
      const isHistoricalProjection = projectionKind === HISTORICAL_PROJECTION_KIND;
      const isVerifiedProjection = projectionKind === VERIFIED_PROJECTION_KIND;
      const closure = isRecord(parsed) &&
        (isCurrentProjection || isHistoricalProjection || isVerifiedProjection)
        ? await verifyProjectionSourceClosure({
            projection: parsed,
            readFile: input.readFile,
            repoRoot: input.repoRoot,
          })
        : undefined;

      if (isVerifiedProjection && isRecord(parsed)) {
        const presentation = parsed.presentation;
        const projectionErrors = [...(closure?.errors ?? [])];
        if (!artifact.path.startsWith("benchmark-claims/evidence/")) {
          projectionErrors.push(
            "verified projection must live under benchmark-claims/evidence",
          );
        }
        if (presentation !== "current" && presentation !== "historical") {
          projectionErrors.push(
            "verified projection presentation must be current or historical",
          );
        } else if (presentation === "historical" || requiresCurrentProjection) {
          projectionErrors.push(...await validateVerifiedProjection({
            artifact,
            bindToReport: presentation === "current" || requiresInternalHistoricalProjection,
            parsed,
            presentation,
            readFile: input.readFile,
            report: input.report,
            repoRoot: input.repoRoot,
            repository: input.repository,
            sourceDocumentsByPath: closure?.jsonDocumentsByPath ?? new Map(),
          }));
        }
        if (
          projectionErrors.length === 0 &&
          presentation === "current" &&
          requiresCurrentProjection
        ) {
          try {
            const declaredFragments = new Set(
              input.report.publicClaim?.readmeRequiredFragments ?? [],
            );
            for (const fragment of sourceDerivedReadmeFragments(
              parsed,
              input.report.benchmark,
            )) {
              if (!declaredFragments.has(fragment)) {
                projectionErrors.push(
                  `source-derived README fragment ${fragment} is missing from ` +
                    "publicClaim.readmeRequiredFragments",
                );
              }
            }
          } catch (error) {
            projectionErrors.push(
              `cannot derive README fragments: ${String(error)}`,
            );
          }
        }
        if (projectionErrors.length === 0 && presentation === "current") {
          verifiedCurrentProjection = requiresCurrentProjection;
        }
        if (
          projectionErrors.length === 0 &&
          presentation === "historical" &&
          (requiresInternalHistoricalProjection || requiresCandidateHistoricalProjection)
        ) {
          verifiedHistoricalProjection = true;
          try {
            const declaredFragments = new Set(
              requiresCandidateHistoricalProjection
                ? input.report.historicalPresentation?.readmeRequiredFragments ?? []
                : input.report.publicClaim?.readmeRequiredFragments ?? [],
            );
            for (const fragment of sourceDerivedReadmeFragments(
              parsed,
              input.report.benchmark,
            )) {
              if (!declaredFragments.has(fragment)) {
                errors.push(
                  `evidence artifact ${artifact.path}: source-derived README fragment ` +
                    `${fragment} is missing from ` +
                    `${requiresCandidateHistoricalProjection ? "historicalPresentation" : "publicClaim"}` +
                    ".readmeRequiredFragments",
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
        errors.push(...projectionErrors.map(
          (error) => `evidence artifact ${artifact.path}: ${error}`,
        ));
      }

      if (isCurrentProjection && isRecord(parsed)) {
        const projectionErrors = [...(closure?.errors ?? [])];
        if (!artifact.path.startsWith("benchmark-claims/evidence/")) {
          projectionErrors.push(
            "current-claim projection must live under benchmark-claims/evidence",
          );
        }
        if (requiresCurrentProjection) {
          projectionErrors.push(...validateLegacyCurrentProjectionIdentity({
            parsed,
            report: input.report,
          }));
        }
        errors.push(...projectionErrors.map(
          (error) => `evidence artifact ${artifact.path}: ${error}`,
        ));
      }

      if (isHistoricalProjection && isRecord(parsed)) {
        const projectionErrors = validateHistoricalProjection({
          artifact,
          benchmark: input.report.benchmark,
          parsed,
        });
        projectionErrors.push(...(closure?.errors ?? []));
        if (!artifact.path.startsWith("benchmark-claims/evidence/")) {
          projectionErrors.push(
            "historical projection must live under benchmark-claims/evidence",
          );
        }
        errors.push(...projectionErrors.map(
          (error) => `evidence artifact ${artifact.path}: ${error}`,
        ));
      } else if (
        requiresInternalHistoricalProjection &&
        !isCurrentProjection &&
        !isVerifiedProjection
      ) {
        errors.push(...validateHistoricalProjection({
          artifact,
          benchmark: input.report.benchmark,
          parsed,
        }).map((error) => `evidence artifact ${artifact.path}: ${error}`));
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
  if (requiresCurrentProjection && !verifiedCurrentProjection) {
    errors.push(CURRENT_CLAIM_PROJECTION_REQUIRED_ERROR);
    if (
      input.currentPackageVersion !== undefined &&
      input.report.run.packageVersion !== input.currentPackageVersion
    ) {
      errors.push(VERSIONED_CANDIDATE_IDENTITY_ERROR);
    }
  }
  if (
    (requiresInternalHistoricalProjection || requiresCandidateHistoricalProjection) &&
    !verifiedHistoricalProjection
  ) {
    errors.push(HISTORICAL_PROJECTION_REQUIRED_ERROR);
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
        entry.historicalEvidenceEligible &&
        entry.consistent &&
        entry.schemaErrors.length === 0,
    )
    .map((entry) => entry.benchmark);
  const historicalEntries = entries.map((entry) => ({
    ...entry,
    readmeDisclosureFragments: entry.historicalReadmeDisclosureFragments,
    readmeRequiredFragments: entry.historicalReadmeRequiredFragments,
  }));
  return checkReadmeBenchmarkTables(
    readmes,
    historicalEntries,
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

async function readGitObject(
  repoRoot: string,
  args: readonly string[],
): Promise<string> {
  const child = Bun.spawn({
    cmd: ["git", ...args],
    cwd: repoRoot,
    stderr: "pipe",
    stdout: "pipe",
  });
  const [exitCode, stderr, stdout] = await Promise.all([
    child.exited,
    new Response(child.stderr).text(),
    new Response(child.stdout).text(),
  ]);
  if (exitCode !== 0) {
    throw new Error(stderr.trim() || `git ${args.join(" ")} failed`);
  }
  return stdout;
}

function createClaimEvidenceRepositoryVerifier(
  repoRoot: string,
): ClaimEvidenceRepositoryVerifier {
  return {
    readCommittedFile: (path) => readGitObject(repoRoot, ["show", `HEAD:${path}`]),
    readFileAtCommit: (commit, path) =>
      readGitObject(repoRoot, ["show", `${commit}:${path}`]),
    resolveCommitTree: async (commit) =>
      (await readGitObject(repoRoot, ["rev-parse", `${commit}^{tree}`])).trim(),
  };
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
        historicalEvidenceEligible: false,
        historicalReadmeDisclosureFragments: [],
        historicalReadmeRequiredFragments: [],
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
        historicalEvidenceEligible: false,
        historicalReadmeDisclosureFragments: [],
        historicalReadmeRequiredFragments: [],
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
    const versionMismatch = currentPackageVersion !== undefined &&
      report.run.packageVersion !== currentPackageVersion
      ? `measured package version ${report.run.packageVersion ?? "(missing)"} does not match ` +
        `current package version ${currentPackageVersion}`
      : undefined;
    const evidenceWasChecked = evidenceErrorsByFile.has(file);
    const fallbackIdentityErrors = !evidenceWasChecked
      ? report.status === "candidate_public_claim" && currentPackageVersion !== undefined
        ? [
            CURRENT_CLAIM_PROJECTION_REQUIRED_ERROR,
            ...(versionMismatch !== undefined ? [VERSIONED_CANDIDATE_IDENTITY_ERROR] : []),
          ]
        : report.status === "internal_evidence" &&
            report.comparison.availability === "historical"
          ? [HISTORICAL_PROJECTION_REQUIRED_ERROR]
          : []
      : [];
    const evidenceErrors = [
      ...(evidenceErrorsByFile.get(file) ?? []),
      ...fallbackIdentityErrors,
    ];
    const hasVerifiedCurrentProjection = report.evidence.artifacts.some((artifact) =>
      isDeclaredVerifiedProjection(artifact, report.benchmark, "current")
    );
    const hasVerifiedHistoricalProjection = report.evidence.artifacts.some((artifact) =>
      isDeclaredVerifiedProjection(artifact, report.benchmark, "historical")
    );
    const blockers = [...verdict.blockers, ...evidenceErrors];
    const computedPublicClaimAllowed = verdict.publicClaimAllowed && evidenceErrors.length === 0;
    const candidateProjectionHistory =
      report.status === "candidate_public_claim" &&
      report.historicalPresentation !== undefined &&
      hasVerifiedHistoricalProjection &&
      evidenceWasChecked &&
      evidenceErrors.length === 0;
    const historicalVerdict = versionMismatch && report.run.packageVersion
      ? evaluateClaimBoundary(report, {
          currentPackageVersion: report.run.packageVersion,
        })
      : undefined;
    const versionedCandidateHistory =
      report.status === "candidate_public_claim" &&
      versionMismatch !== undefined &&
      historicalVerdict?.publicClaimAllowed === true &&
      report.claimBoundary.publicClaimAllowed === true &&
      hasVerifiedCurrentProjection &&
      evidenceWasChecked &&
      verdict.blockers.length === 1 &&
      verdict.blockers[0] === versionMismatch &&
      evidenceErrors.length === 0;
    const historicalPresentation = versionedCandidateHistory
      ? report.publicClaim
      : candidateProjectionHistory
        ? report.historicalPresentation
      : report.status === "internal_evidence"
        ? report.publicClaim
        : undefined;
    entries.push({
      benchmark: report.benchmark,
      blockers,
      computedPublicClaimAllowed,
      consistent:
        (versionedCandidateHistory ||
          report.claimBoundary.publicClaimAllowed === computedPublicClaimAllowed) &&
        evidenceErrors.length === 0,
      declaredPublicClaimAllowed: report.claimBoundary.publicClaimAllowed,
      file,
      historicalEvidenceEligible:
        (
          report.status === "internal_evidence" &&
          report.comparison.availability === "historical" &&
          hasVerifiedHistoricalProjection &&
          evidenceWasChecked &&
          evidenceErrors.length === 0
        ) ||
        candidateProjectionHistory ||
        versionedCandidateHistory,
      historicalReadmeDisclosureFragments:
        historicalPresentation?.readmeDisclosureFragments ?? [],
      historicalReadmeRequiredFragments:
        historicalPresentation?.readmeRequiredFragments ?? [],
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
    (entry) =>
      entry.declaredPublicClaimAllowed &&
      !entry.computedPublicClaimAllowed &&
      !entry.consistent,
  ).length;
  const publicClaimable = entries
    .filter((entry) => entry.computedPublicClaimAllowed && entry.consistent)
    .map((entry) => entry.benchmark);
  const historicalEvidence = entries
    .filter(
      (entry) =>
        entry.historicalEvidenceEligible &&
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
  repository?: ClaimEvidenceRepositoryVerifier;
}): Promise<ClaimGateReport> {
  const repoRoot = resolveRepoRootFromScriptUrl(import.meta.url);
  const claimsDir = input.claimsDir ?? join(repoRoot, "benchmark-claims");
  const readDirImpl = input.readDir ?? ((path: string) => readdir(path));
  const readFileImpl = input.readFile ?? ((path: string) => readFile(path, "utf8"));
  const repository = input.repository ?? createClaimEvidenceRepositoryVerifier(repoRoot);
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
      currentPackageVersion,
      file,
      readFile: readFileImpl,
      repoRoot,
      repository,
      report: value as BenchmarkClaimReport,
    });
    evidenceErrorsByFile.set(file, artifactErrors);
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
