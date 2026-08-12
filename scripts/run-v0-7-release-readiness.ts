import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdir,
  lstat,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";

import { stripThinkingBlocks } from "../src/provider/ai-sdk-runtime";
import {
  hasCliFlagStrict,
  resolveCliFlagValueStrict,
} from "./cli-options";
import { assertV07ReleaseSourceIdentity } from "./promote-v0-7-release";
import {
  assertProviderResponseFailuresRecovered,
  assertProviderResponseTapeCoversSequences,
  fingerprintProviderRequestIdentity,
  fingerprintProviderRequestSequence,
  fingerprintProviderTransportAttemptLedger,
  parseProviderResponseTape,
} from "./provider-response-tape";
import type {
  ProviderTapeRequestIdentity,
  ProviderTapeTransportAttempt,
} from "./provider-response-tape";
import {
  decodeProviderResponseTapeBundle,
  parseProviderResponseTapeBundleManifest,
  PROVIDER_RESPONSE_TAPE_BUNDLE_POLICY,
} from "./provider-response-tape-bundle";
import {
  classifyV073SeedAttemptRecovery,
  deriveV073FullClaimProtocol2Identity,
  renderV073FullClaimProtocol2Command,
  V073_FULL_CLAIM_PROTOCOL2_PREREGISTRATION_PATH,
  V073_FULL_CLAIM_PROTOCOL2_SENTINEL_PATH,
  V073_FULL_LOCOMO_CASE_QUESTION_COUNTS,
  V073_FULL_LOCOMO_QUESTION_SELECTION_SHA256,
} from "./run-v0-7-3-full-locomo-claim";
import {
  buildV073FullClaimCommandChain,
  buildV073PairedCommandChain,
  deriveV073ClaimCommandTemplateSha256,
  deriveV073PromptSha256,
} from "./run-v0-7-3-lifecycle-protection-gate";
import {
  buildV073ProviderFreeArgs,
  buildV073StageArm,
  officialQuestionTransitions,
  parseV073FormalSmokeReport,
  parseV073OfficialProgress,
  parseV073OfficialSummary,
  parseV073ProviderFreeReport,
  routeV073CommandChainThroughTape,
  V073_ASSISTED_EXTRACTION_POLICY,
  V073_PROVIDER_STAGE_ORDER,
  V073_PROVIDER_TRANSPORT_POLICY,
  V073_SEMANTIC_SEED_RUN_ID,
  V073_SCHEMA9_STORAGE_PREFLIGHT_POLICY,
} from "./run-v0-7-3-replacement-protection-gate";
import { resolveRepoRootFromScriptUrl } from "./script-paths";
import {
  assertV073ProviderPreflightReceipt,
  evaluateV073ReplacementProtection,
  V073_PROVIDER_PREFLIGHT_POLICY,
} from "./v0-7-3-replacement-protection";
import type { V073ReplacementProtectionInput } from "./v0-7-3-replacement-protection";

const RELEASE_LINE = "0.7";
const RELEASE_VERSION = "0.7.4";
const HISTORICAL_LOCOMO_VERSION = "0.7.3";
const RELEASE_BUN_VERSION = "1.3.14";
const MAX_TARBALL_BYTES = 4 * 1024 * 1024;
const FAILURE_CONTEXT_LINES = 4;
const FAILURE_DETAIL_LINE_LIMIT = 80;
const V073_LIFECYCLE_PROTECTION_ARTIFACT =
  "reports/release/v0.7/v0.7.3-lifecycle-protection.json";
const V073_LIFECYCLE_EVIDENCE_PREFIX =
  "reports/release/v0.7/v0.7.3-lifecycle-schema9-evidence/";
const V073_LIFECYCLE_ATTEMPT_SENTINEL =
  "reports/release/v0.7/v0.7.3-lifecycle-schema9-attempt-consumed.json";
const V073_LOCOMO_CURRENT_PROJECTION =
  "benchmark-claims/evidence/locomo-v0.7.3-current.json";
const V073_LOCOMO_CLAIM_EVIDENCE_PREFIX =
  "reports/release/v0.7/v0.7.3-locomo-claim-evidence/";
const V073_PUBLIC_CLAIM_GOVERNANCE_PREREGISTRATION =
  "reports/release/v0.7/" +
  "v0.7.3-public-claim-governance-correction-preregistration.json";
const V073_PUBLIC_CLAIM_GOVERNANCE_ATTESTATION =
  "reports/release/v0.7/" +
  "v0.7.3-public-claim-governance-correction-attestation.json";
const V073_STABLE_SOURCE_TEST_CORRECTION_PREREGISTRATION =
  "reports/release/v0.7/" +
  "v0.7.3-stable-source-test-correction-preregistration.json";
const V073_STABLE_SOURCE_TEST_CORRECTION_ATTESTATION =
  "reports/release/v0.7/" +
  "v0.7.3-stable-source-test-correction-attestation.json";
const V073_CROSS_HOST_LIFECYCLE_VERIFIER_CORRECTION_PREREGISTRATION =
  "reports/release/v0.7/" +
  "v0.7.3-cross-host-lifecycle-verifier-correction-preregistration.json";
const V073_CROSS_HOST_LIFECYCLE_VERIFIER_CORRECTION_ATTESTATION =
  "reports/release/v0.7/" +
  "v0.7.3-cross-host-lifecycle-verifier-correction-attestation.json";
const V073_LOCOMO_SOURCE_ARTIFACT_PATHS = {
  "claim-recipe-source": `${V073_LOCOMO_CLAIM_EVIDENCE_PREFIX}claim-recipe-source.json`,
  "execution-receipt": `${V073_LOCOMO_CLAIM_EVIDENCE_PREFIX}execution-receipt.json`,
  "final-report": `${V073_LOCOMO_CLAIM_EVIDENCE_PREFIX}final-smoke-report.json`,
  "official-summary": `${V073_LOCOMO_CLAIM_EVIDENCE_PREFIX}official-rescore-summary.json`,
  "official-progress": `${V073_LOCOMO_CLAIM_EVIDENCE_PREFIX}official-progress.jsonl`,
  "official-runner-source": `${V073_LOCOMO_CLAIM_EVIDENCE_PREFIX}official-runner-source.ts`,
  "protocol-attempt-sentinel": V073_FULL_CLAIM_PROTOCOL2_SENTINEL_PATH,
  "protocol-preregistration": V073_FULL_CLAIM_PROTOCOL2_PREREGISTRATION_PATH,
  "seed-attempt-1-extraction-cache": `${V073_LOCOMO_CLAIM_EVIDENCE_PREFIX}seed-attempt-1-extraction-cache.jsonl`,
  "seed-attempt-1-progress": `${V073_LOCOMO_CLAIM_EVIDENCE_PREFIX}seed-attempt-1-live-progress.jsonl`,
  "seed-attempt-1-report": `${V073_LOCOMO_CLAIM_EVIDENCE_PREFIX}seed-attempt-1-smoke-report.json`,
  "seed-extraction-cache": `${V073_LOCOMO_CLAIM_EVIDENCE_PREFIX}seed-extraction-cache.jsonl`,
  "seed-progress": `${V073_LOCOMO_CLAIM_EVIDENCE_PREFIX}seed-live-progress.jsonl`,
  "seed-report": `${V073_LOCOMO_CLAIM_EVIDENCE_PREFIX}seed-smoke-report.json`,
} as const;
const V072_BASELINE_COMMIT = "456edd106f29118b3455bf21c43d7b3107b48213";
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/u;
const EMPTY_TRANSPORT_LEDGER_SHA256 =
  "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945";
const EXPECTED_EXTRACTION_CACHE_KEY_SET_SHA256 =
  "30fde28c5e2450365d8cc3d90a80f72aa900691151f4d1127e0a4f3c8a520f4f";
const EXPECTED_EXTRACTION_CACHE_KEY_CASE_MAP_SHA256 =
  "24732a6040c70d52999a18b9d95d72e663a883aa7c5524fc5ee8b4187611e03b";
const V073_PROTOCOL2_CANONICAL_BENCHMARK_ROOT = "/@locomo-full10-root";
const REQUIRED_PACKED_FILES = [
  "dist/index.js",
  "dist/index.d.ts",
  "dist/ai-sdk/index.js",
  "dist/ai-sdk/index.d.ts",
  "dist/host/index.js",
  "dist/host/index.d.ts",
  "dist/http/index.js",
  "dist/http/index.d.ts",
  "dist/runtime-kit/index.js",
  "dist/runtime-kit/index.d.ts",
  "docs/GoodMemory-0.6-to-0.7-Migration-Guide.md",
  "package.json",
] as const;

type CheckStatus = "pass" | "fail" | "skip";

export function assertV073MeasurementEvidenceRoot(
  value: unknown,
): asserts value is string {
  const suffix = V073_LIFECYCLE_EVIDENCE_PREFIX.slice(0, -1);
  if (
    typeof value !== "string" ||
    !isAbsolute(value) ||
    resolve(value) !== value ||
    !value.endsWith(`/${suffix}`)
  ) {
    throw new Error("measurement evidence root must be the canonical schema 9 evidence root");
  }
}

export interface V07ReleaseReadinessCheck {
  detail: string;
  durationMs: number;
  id: string;
  required: boolean;
  status: CheckStatus;
  title: string;
}

export interface V07ReleaseReadinessReport {
  allRequiredPassed: boolean;
  checks: V07ReleaseReadinessCheck[];
  generatedAt: string;
  generatedBy: "scripts/run-v0-7-release-readiness.ts";
  packageVersion: string;
  runtime: V07RuntimeIdentity;
  sourceIdentity: V07SourceIdentity;
  summary: {
    failed: number;
    passed: number;
    skipped: number;
    total: number;
  };
}

export interface V07RuntimeIdentity {
  bunVersion: string;
  nodeVersion: string;
}

export interface V07SourceIdentity {
  commitSha: string;
  treeSha: string;
}

export interface V07ReleaseReadinessOptions {
  lifecycleProtectionArtifact?: string;
  outputDir?: string;
  skipBuild?: boolean;
  skipCoverage?: boolean;
  skipTests?: boolean;
  strict?: boolean;
}

export const V07_RELEASE_REQUIRED_COMMANDS = [
  {
    args: ["run", "typecheck"],
    command: "bun",
    id: "typecheck",
  },
  {
    args: ["test", "--timeout=300000"],
    command: "bun",
    id: "tests",
  },
  {
    args: ["run", "test:coverage"],
    command: "bun",
    id: "coverage",
  },
  {
    args: ["run", "build"],
    command: "bun",
    id: "build",
  },
  {
    args: ["run", "gate:public-benchmark-claim", "--strict"],
    command: "bun",
    id: "public-claims",
  },
  {
    args: [
      "run",
      "gate:phase-74-storage-scale",
      "--output",
      "reports/release/v0.7/phase-74-storage-scale-gate.json",
    ],
    command: "bun",
    id: "scale",
  },
  {
    args: [
      "test",
      "tests/integration/storage.postgres.test.ts",
      "tests/integration/api.postgres.test.ts",
    ],
    command: "bun",
    id: "postgres",
    requiredEnvironment: "GOODMEMORY_TEST_POSTGRES_URL",
  },
] as const;

type RequiredCommandId = (typeof V07_RELEASE_REQUIRED_COMMANDS)[number]["id"];

const REQUIRED_COMMAND_DETAILS: Record<
  RequiredCommandId,
  { successDetail: string; title: string }
> = {
  build: {
    successDetail: "compiled JavaScript and declarations built",
    title: "Compiled package build",
  },
  coverage: {
    successDetail: "overall and src/language coverage gates passed",
    title: "Coverage gates",
  },
  postgres: {
    successDetail:
      "real Postgres functionality, migration, scale, and EXPLAIN gates passed",
    title: "Real Postgres functionality, migration, scale, and EXPLAIN gates",
  },
  "public-claims": {
    successDetail:
      "strict public-claim and historical-evidence consistency gate passed",
    title: "Public benchmark claim gate",
  },
  scale: {
    successDetail:
      "Phase 74 scale gate passed at 100k searchable and 150k stored projection rows",
    title: "Phase 74 projection storage scale gate (100k searchable / 150k stored)",
  },
  tests: {
    successDetail: "full canonical Bun test suite passed",
    title: "Full canonical Bun test suite",
  },
  typecheck: {
    successDetail: "tsc --noEmit clean",
    title: "TypeScript typecheck",
  },
};

interface CommandOutcome {
  code: number | null;
  durationMs: number;
  stderr: string;
  stdout: string;
}

export function evaluateV07SourceIdentity(input: {
  commitSha: string;
  status: string;
  treeSha: string;
}): {
  check: V07ReleaseReadinessCheck;
  sourceIdentity: V07SourceIdentity;
} {
  const commitSha = input.commitSha.trim();
  const treeSha = input.treeSha.trim();
  const status = input.status.trim();
  const issues = [
    ...(commitSha ? [] : ["git commit identity is unavailable"]),
    ...(treeSha ? [] : ["git tree identity is unavailable"]),
    ...(status ? [`worktree is not clean: ${status}`] : []),
  ];
  return {
    check: {
      detail: issues.length === 0
        ? `clean source ${commitSha} / tree ${treeSha}`
        : issues.join("; "),
      durationMs: 0,
      id: "source-identity",
      required: true,
      status: issues.length === 0 ? "pass" : "fail",
      title: "Exact source identity",
    },
    sourceIdentity: { commitSha, treeSha },
  };
}

export function evaluateV07SourceStability(input: {
  final: {
    check: V07ReleaseReadinessCheck;
    sourceIdentity: V07SourceIdentity;
  };
  initial: V07SourceIdentity;
}): V07ReleaseReadinessCheck {
  const stable = input.final.check.status === "pass" &&
    input.final.sourceIdentity.commitSha === input.initial.commitSha &&
    input.final.sourceIdentity.treeSha === input.initial.treeSha;
  return {
    detail: stable
      ? "commit, tree, and clean worktree remained stable throughout all release checks"
      : `source identity changed while release checks ran: ${input.final.check.detail}`,
    durationMs: 0,
    id: "source-stability",
    required: true,
    status: stable ? "pass" : "fail",
    title: "Source identity stability",
  };
}

export function evaluateV07RuntimeVersions(
  runtime: V07RuntimeIdentity,
): V07ReleaseReadinessCheck {
  const nodeVersion = runtime.nodeVersion.trim();
  const bunVersion = runtime.bunVersion.trim();
  const issues = [
    ...(/^v?20(?:\.|$)/u.test(nodeVersion)
      ? []
      : [`Node 20 is required, got ${nodeVersion || "<unavailable>"}`]),
    ...(bunVersion === RELEASE_BUN_VERSION
      ? []
      : [`Bun ${RELEASE_BUN_VERSION} is required, got ${bunVersion || "<unavailable>"}`]),
  ];
  return {
    detail: issues.length === 0
      ? `Node ${nodeVersion} / Bun ${bunVersion}`
      : issues.join("; "),
    durationMs: 0,
    id: "runtime-identity",
    required: true,
    status: issues.length === 0 ? "pass" : "fail",
    title: "Release runtime identity",
  };
}

interface PackageJson {
  files?: string[];
  goodmemoryRelease?: {
    installCommandsApplyAfterPublish?: boolean;
    npmDistTag?: string;
    status?: string;
  };
  version: string;
}

interface PackageLock {
  packages?: Record<string, { version?: string }>;
  version?: string;
}

interface CapabilityDescriptor {
  benchmarks?: {
    currentClaims?: Array<{
      claimDeclaration?: string;
      config?: string;
      measuredPackageVersion?: string;
      metric?: string;
      name?: string;
      reference?: string;
      result?: string;
      runtimeProfile?: string;
    }>;
  };
  install?: {
    bun?: string;
    npmGlobal?: string;
    npmPackage?: string;
  };
  releaseStatus?: {
    installCommandsApplyAfterPublish?: boolean;
    npmDistTag?: string;
    status?: string;
    tarball?: string;
  };
  version?: string;
}

interface ServerDescriptor {
  packages?: Array<{ version?: string }>;
  version?: string;
}

export function stableLocomoClaimIssues(input: {
  claims: Array<{ measuredPackageVersion?: string; name?: string }>;
  projection: unknown;
  releaseStatus: string | undefined;
}): string[] {
  if (input.releaseStatus !== "stable") {
    return [];
  }
  const issues: string[] = [];
  if (input.claims.length > 0) {
    issues.push(
      `stable ${RELEASE_VERSION} release must not relabel v${HISTORICAL_LOCOMO_VERSION} benchmark evidence as current`,
    );
  }
  if (
    !isRecord(input.projection) ||
    input.projection.artifactKind !== "tracked-current-claim-projection" ||
    input.projection.benchmark !== "LoCoMo" ||
    input.projection.schemaVersion !== 1 ||
    !isRecord(input.projection.claim) ||
    input.projection.claim.packageVersion !== HISTORICAL_LOCOMO_VERSION ||
    !isValidStableLocomoClaimProjection(input.projection)
  ) {
    issues.push(
      `stable release requires the historical v${HISTORICAL_LOCOMO_VERSION} LoCoMo projection at ${V073_LOCOMO_CURRENT_PROJECTION} to satisfy the full 1540-question evidence contract`,
    );
  }
  return issues;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isFiniteUnitInterval(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function isValidStableLocomoClaimProjection(
  projection: Record<string, unknown>,
): boolean {
  if (
    projection.generatedBy !== "scripts/run-v0-7-3-full-locomo-claim.ts" ||
    projection.protocolVersion !== 2 ||
    projection.maxSeedLaunches !== 2 ||
    !COMMIT_PATTERN.test(String(projection.sentinelCommit)) ||
    !Array.isArray(projection.seedAttempts) ||
    (projection.seedAttempts.length !== 1 &&
      projection.seedAttempts.length !== 2) ||
    !isRecord(projection.claim) ||
    !isRecord(projection.descriptorClaim) ||
    !isRecord(projection.evidenceRepositoryBefore) ||
    !isRecord(projection.execution) ||
    !isRecord(projection.runIdentity) ||
    !Array.isArray(projection.sourceArtifacts)
  ) {
    return false;
  }
  const claim = projection.claim;
  const descriptor = projection.descriptorClaim;
  const evidenceRepositoryBefore = projection.evidenceRepositoryBefore;
  const execution = projection.execution;
  const runIdentity = projection.runIdentity;
  if (
    claim.packageVersion !== HISTORICAL_LOCOMO_VERSION ||
    claim.questionCount !== 1540 ||
    claim.conversationCount !== 10 ||
    claim.executionFailures !== 0 ||
    claim.judgeFailures !== 0 ||
    claim.answerSystem !== "locomo-live-category-aware-v1" ||
    !isFiniteUnitInterval(claim.strictScore) ||
    !isFiniteUnitInterval(claim.officialScore) ||
    !isFiniteUnitInterval(claim.openDomainScore) ||
    !Number.isSafeInteger(claim.openDomainCorrect) ||
    (claim.openDomainCorrect as number) < 0 ||
    claim.openDomainTotal !== 96 ||
    (claim.openDomainCorrect as number) > 96 ||
    claim.openDomainScore !== (claim.openDomainCorrect as number) / 96
  ) {
    return false;
  }
  if (
    !COMMIT_PATTERN.test(String(evidenceRepositoryBefore.headCommit)) ||
    evidenceRepositoryBefore.statusPorcelain !== ""
  ) {
    return false;
  }
  const descriptorFields = [
    "claimDeclaration",
    "config",
    "measuredPackageVersion",
    "metric",
    "name",
    "reference",
    "result",
    "runtimeProfile",
  ] as const;
  if (
    descriptorFields.some((field) => !isNonEmptyString(descriptor[field])) ||
    descriptor.name !== "LoCoMo" ||
    descriptor.measuredPackageVersion !== HISTORICAL_LOCOMO_VERSION ||
    descriptor.claimDeclaration !== "benchmark-claims/locomo.json" ||
    descriptor.reference !== V073_LOCOMO_CURRENT_PROJECTION
  ) {
    return false;
  }
  const executionFields = [
    "answerGateway",
    "answerModel",
    "answerProvider",
    "assistedExtractorGateway",
    "assistedExtractorModel",
    "assistedExtractorProvider",
    "benchmarkFingerprint",
    "benchmarkRootSha256",
    "bunVersion",
    "claimCommandSha256",
    "claimCommandTemplateSha256",
    "embeddingGateway",
    "embeddingModel",
    "embeddingProvider",
    "expectedExtractionCacheKeyCaseMapSha256",
    "expectedExtractionCacheKeySetSha256",
    "judgeGateway",
    "judgeModel",
    "judgeProvider",
    "officialSourceSha256",
    "promptSha256",
    "questionSelectionSha256",
    "rerankingGateway",
    "rerankingModel",
    "rerankingProvider",
  ] as const;
  if (
    executionFields.some((field) => !isNonEmptyString(execution[field])) ||
    execution.answerGateway !== "https://ai.gurkiai.com/v1" ||
    execution.answerModel !== "gpt-5.6-terra" ||
    execution.answerProvider !== "openai" ||
    execution.assistedExtractorGateway !== "https://ai.gurkiai.com/v1" ||
    execution.assistedExtractorModel !== "gpt-5.6-terra" ||
    execution.assistedExtractorProvider !== "openai" ||
    execution.embeddingGateway !== "https://openrouter.ai/api/v1" ||
    execution.embeddingModel !== "text-embedding-3-small" ||
    execution.embeddingProvider !== "openai" ||
    execution.rerankingGateway !== "https://ai.gurkiai.com/v1" ||
    execution.rerankingModel !== "gpt-5.6-terra" ||
    execution.rerankingProvider !== "openai" ||
    execution.expectedExtractionCacheKeyCaseMapSha256 !==
      EXPECTED_EXTRACTION_CACHE_KEY_CASE_MAP_SHA256 ||
    execution.expectedExtractionCacheKeySetSha256 !==
      EXPECTED_EXTRACTION_CACHE_KEY_SET_SHA256 ||
    execution.providerEmbeddingTimeoutMs !== null ||
    execution.providerEmbeddingRunTimeoutMs !== null ||
    execution.providerRerankingTimeoutMs !== 120_000 ||
    execution.officialRescoreRequestTimeoutMs !== 180_000 ||
    execution.judgeGateway !== "https://ai.gurkiai.com/v1" ||
    execution.judgeModel !== "gpt-5.5" ||
    execution.judgeProvider !== "openai" ||
    execution.promptSha256 !== deriveV073PromptSha256() ||
    execution.questionSelectionSha256 !==
      V073_FULL_LOCOMO_QUESTION_SELECTION_SHA256 ||
    !sameJson(
      execution.caseQuestionCounts,
      V073_FULL_LOCOMO_CASE_QUESTION_COUNTS,
    ) ||
    execution.bunVersion !== RELEASE_BUN_VERSION ||
    execution.concurrency !== 40 ||
    execution.benchmarkRootBytes !== 2_490_457 ||
    !SHA256_PATTERN.test(String(execution.benchmarkFingerprint)) ||
    !SHA256_PATTERN.test(String(execution.benchmarkRootSha256)) ||
    !SHA256_PATTERN.test(String(execution.claimCommandSha256)) ||
    !SHA256_PATTERN.test(String(execution.claimCommandTemplateSha256)) ||
    !SHA256_PATTERN.test(String(execution.officialSourceSha256))
  ) {
    return false;
  }
  const runIds = [
    runIdentity.seedRunId,
    runIdentity.finalRunId,
    runIdentity.officialRunId,
  ];
  if (
    !isNonEmptyString(runIdentity.commit) ||
    !COMMIT_PATTERN.test(runIdentity.commit) ||
    projection.protocolCandidateCommit !== runIdentity.commit ||
    !COMMIT_PATTERN.test(String(projection.lifecycleCandidateCommit)) ||
    evidenceRepositoryBefore.headCommit !== runIdentity.commit ||
    runIds.some((value) => !isNonEmptyString(value)) ||
    new Set(runIds).size !== runIds.length
  ) {
    return false;
  }
  if (
    projection.sourceArtifacts.length !==
      Object.keys(V073_LOCOMO_SOURCE_ARTIFACT_PATHS).length
  ) {
    return false;
  }
  const sources = new Map<string, ArtifactIdentityShape>();
  for (const source of projection.sourceArtifacts) {
    if (
      !isRecord(source) ||
      !isNonEmptyString(source.kind) ||
      !isArtifactIdentity(source) ||
      sources.has(source.kind)
    ) {
      return false;
    }
    sources.set(source.kind, source);
  }
  return Object.entries(V073_LOCOMO_SOURCE_ARTIFACT_PATHS).every(
    ([kind, path]) => sources.get(kind)?.path === path,
  );
}

const V073_LOCOMO_CASE_IDS = [
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
const V073_LOCOMO_CATEGORY_COUNTS = {
  multi_hop: 282,
  open_domain: 96,
  single_hop: 841,
  temporal: 321,
} as const;
const V073_LOCOMO_BENCHMARK_FINGERPRINT =
  "240ba2526911a5f965a285b88794c4d3b938b59be5aecd846cc472ee733357fd";
const V073_LOCOMO_ROOT_SHA256 =
  "e442118810a1c57ee0b5454d12583c27be244936350dcfff1d6102d29cc39c28";

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sourceArtifactMap(
  projection: Record<string, unknown>,
): Map<string, ArtifactIdentityShape> {
  const result = new Map<string, ArtifactIdentityShape>();
  for (const source of projection.sourceArtifacts as Array<Record<string, unknown>>) {
    result.set(source.kind as string, source as unknown as ArtifactIdentityShape);
  }
  return result;
}

function parseEvidenceJson(raw: string, label: string, issues: string[]): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    issues.push(`${label} is not valid JSON`);
    return undefined;
  }
}

function validateFullLocomoReport(input: {
  expectedMode: "live-answer" | "retrieval-only";
  expectedGeneratedBy: string;
  expectedResume: boolean;
  label: string;
  report: unknown;
  issues: string[];
}): Record<string, unknown>[] | undefined {
  if (!isRecord(input.report)) {
    input.issues.push(`${input.label} must be an object`);
    return undefined;
  }
  const report = input.report;
  const rows = report.cases;
  const expectedAnswerEvaluation = input.expectedMode === "live-answer"
    ? "scored"
    : "deferred-to-live-mode";
  if (
    report.benchmark !== "locomo" ||
    report.benchmarkFingerprint !== V073_LOCOMO_BENCHMARK_FINGERPRINT ||
    report.mode !== input.expectedMode ||
    report.answerEvaluation !== expectedAnswerEvaluation ||
    report.generatedBy !== input.expectedGeneratedBy ||
    report.resume !== input.expectedResume ||
    report.executionFailures !== 0 ||
    report.questionCount !== 1540 ||
    report.caseCount !== 10 ||
    !sameJson(report.caseIds, V073_LOCOMO_CASE_IDS) ||
    !Array.isArray(rows) ||
    rows.length !== 1540
  ) {
    input.issues.push(
      `${input.label} is not a complete failure-free ${input.expectedMode} full-1540 LoCoMo report`,
    );
    return undefined;
  }
  if (
    input.expectedMode === "live-answer" &&
    report.answerSystem !== "locomo-live-category-aware-v1"
  ) {
    input.issues.push(`${input.label} answerSystem does not match the current claim protocol`);
  }
  const categoryCounts = new Map<string, number>();
  const caseCounts = new Map<string, number>();
  const questionKeys = new Set<string>();
  const typedRows: Record<string, unknown>[] = [];
  for (const [index, row] of rows.entries()) {
    if (!isRecord(row)) {
      input.issues.push(`${input.label} row ${index} is not an object`);
      continue;
    }
    typedRows.push(row);
    const key = `${String(row.caseId)}\u0000${String(row.questionId)}`;
    questionKeys.add(key);
    const answerFieldsValid = input.expectedMode === "retrieval-only"
      ? row.answerCorrect === null &&
        row.answerTokenF1 === null &&
        row.generatedAnswer === null
      : typeof row.answerCorrect === "boolean" &&
        typeof row.answerTokenF1 === "number" &&
        Number.isFinite(row.answerTokenF1) &&
        row.answerTokenF1 >= 0 &&
        row.answerTokenF1 <= 1 &&
        isNonEmptyString(row.generatedAnswer);
    if (
      !V073_LOCOMO_CASE_IDS.includes(row.caseId as typeof V073_LOCOMO_CASE_IDS[number]) ||
      typeof row.category !== "string" ||
      !Object.prototype.hasOwnProperty.call(V073_LOCOMO_CATEGORY_COUNTS, row.category) ||
      !isNonEmptyString(row.questionId) ||
      !answerFieldsValid ||
      row.executionFailureMessage != null
    ) {
      input.issues.push(`${input.label} row ${index} is incomplete or failed`);
    }
    categoryCounts.set(
      String(row.category),
      (categoryCounts.get(String(row.category)) ?? 0) + 1,
    );
    caseCounts.set(
      String(row.caseId),
      (caseCounts.get(String(row.caseId)) ?? 0) + 1,
    );
  }
  if (questionKeys.size !== 1540) {
    input.issues.push(`${input.label} question identities are not unique`);
  }
  for (const [category, count] of Object.entries(V073_LOCOMO_CATEGORY_COUNTS)) {
    if (categoryCounts.get(category) !== count) {
      input.issues.push(`${input.label} category ${category} does not contain ${count} questions`);
    }
  }
  for (const [caseId, count] of Object.entries(
    V073_FULL_LOCOMO_CASE_QUESTION_COUNTS,
  )) {
    if (caseCounts.get(caseId) !== count) {
      input.issues.push(`${input.label} case ${caseId} does not contain ${count} questions`);
    }
  }
  const selection = typedRows.map((row) => ({
    caseId: row.caseId,
    category: row.category,
    questionId: row.questionId,
  }));
  if (
    createHash("sha256").update(JSON.stringify(selection)).digest("hex") !==
    V073_FULL_LOCOMO_QUESTION_SELECTION_SHA256
  ) {
    input.issues.push(`${input.label} does not contain the frozen full-10 question selection`);
  }
  return typedRows;
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

function sameArtifactIdentity(
  value: unknown,
  expected: ArtifactIdentityShape,
): boolean {
  return isArtifactIdentity(value) &&
    value.bytes === expected.bytes &&
    value.path === expected.path &&
    value.sha256 === expected.sha256;
}

function sameArtifactContent(
  left: ArtifactIdentityShape,
  right: ArtifactIdentityShape,
): boolean {
  return left.bytes === right.bytes && left.sha256 === right.sha256;
}

function parseExtractionCacheKeys(raw: string): string[] | undefined {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const line of raw.split("\n")) {
    if (line.trim() === "") {
      continue;
    }
    let value: unknown;
    try {
      value = JSON.parse(line) as unknown;
    } catch {
      return undefined;
    }
    if (
      !isRecord(value) ||
      !isNonEmptyString(value.key) ||
      !Array.isArray(value.candidates) ||
      seen.has(value.key)
    ) {
      return undefined;
    }
    seen.add(value.key);
    keys.push(value.key);
  }
  return keys;
}

function canonicalProtocol2ClaimRecipe(raw: string): string {
  const recipe = JSON.parse(raw) as unknown;
  if (
    !isRecord(recipe) ||
    !isRecord(recipe.run) ||
    !isNonEmptyString(recipe.run.command)
  ) {
    throw new Error("claim recipe does not contain run.command");
  }
  const matches = [...recipe.run.command.matchAll(/--benchmark-root\s+\S+/gu)];
  if (matches.length !== 1) {
    throw new Error("claim recipe must contain one benchmark root");
  }
  recipe.run.command = recipe.run.command.replace(
    matches[0]![0],
    `--benchmark-root ${V073_PROTOCOL2_CANONICAL_BENCHMARK_ROOT}`,
  );
  return JSON.stringify(recipe);
}

function bindHomeRelativeClaimRecipeBenchmarkRoot(
  raw: string,
  benchmarkRoot: string,
): string {
  const recipe = JSON.parse(raw) as unknown;
  if (
    !isRecord(recipe) ||
    !isRecord(recipe.run) ||
    !isNonEmptyString(recipe.run.command)
  ) {
    throw new Error("claim recipe does not contain run.command");
  }
  const matches = [
    ...recipe.run.command.matchAll(/--benchmark-root\s+(\S+)/gu),
  ];
  if (matches.length !== 1) {
    throw new Error("claim recipe must contain one benchmark root");
  }
  const recipeRoot = matches[0]![1]!;
  if (!recipeRoot.startsWith("~/")) {
    return raw;
  }
  if (!isAbsolute(benchmarkRoot)) {
    throw new Error("recorded benchmark root must be absolute");
  }
  recipe.run.command = recipe.run.command.replace(
    matches[0]![0],
    `--benchmark-root ${benchmarkRoot}`,
  );
  return JSON.stringify(recipe);
}

function canonicalProtocol2CommandChain(
  commandChain: Record<string, unknown>,
  recordedBenchmarkRoot: string,
): Record<string, unknown> {
  const result = structuredClone(commandChain);
  const replaceFlag = (
    invocationName: "officialRescore" | "seedSmoke",
    flag: "--benchmark-root" | "--root",
    expected: string,
    replacement: string,
  ) => {
    const invocation = result[invocationName];
    if (!isRecord(invocation) || !Array.isArray(invocation.args)) {
      throw new Error("command chain invocation is invalid");
    }
    const indexes = invocation.args.flatMap((value, index) =>
      value === flag ? [index] : []);
    if (indexes.length !== 1 || invocation.args[indexes[0]! + 1] !== expected) {
      throw new Error("command chain benchmark root is inconsistent");
    }
    invocation.args[indexes[0]! + 1] = replacement;
  };
  replaceFlag(
    "seedSmoke",
    "--benchmark-root",
    recordedBenchmarkRoot,
    V073_PROTOCOL2_CANONICAL_BENCHMARK_ROOT,
  );
  replaceFlag(
    "officialRescore",
    "--root",
    resolve(recordedBenchmarkRoot, "cases.json"),
    resolve(V073_PROTOCOL2_CANONICAL_BENCHMARK_ROOT, "cases.json"),
  );
  return result;
}

function validateV073FullClaimProtocol2(input: {
  executionReceipt: unknown;
  lifecycleProtectionRaw: string;
  projection: Record<string, unknown>;
  seedRaw: string;
  sourceRaws: Map<string, string>;
  sources: Map<string, ArtifactIdentityShape>;
}): string[] {
  const issues: string[] = [];
  const receipt = input.executionReceipt;
  const runIdentity = input.projection.runIdentity;
  if (!isRecord(receipt) || !isRecord(runIdentity)) {
    return ["full-claim protocol-v2 execution receipt is inconsistent"];
  }
  const preregistration = parseEvidenceJson(
    input.sourceRaws.get("protocol-preregistration")!,
    "full-claim protocol-v2 preregistration",
    issues,
  );
  const sentinel = parseEvidenceJson(
    input.sourceRaws.get("protocol-attempt-sentinel")!,
    "full-claim protocol-v2 sentinel",
    issues,
  );
  if (!isRecord(preregistration)) {
    issues.push("full-claim protocol-v2 preregistration is inconsistent");
    return issues;
  }
  const protocolCandidateCommit = String(runIdentity.commit);
  const protocolIdentity = deriveV073FullClaimProtocol2Identity(
    protocolCandidateCommit,
  );
  const lifecycleProtection = preregistration.lifecycleProtection;
  const lifecycleArtifact = parseEvidenceJson(
    input.lifecycleProtectionRaw,
    "v0.7.3 lifecycle protection compact",
    issues,
  );
  const preregistrationValid =
    preregistration.protocolVersion === 2 &&
    preregistration.generatedBy ===
      "v0.7.3-full-locomo-claim-protocol2-preregistration" &&
    Number.isFinite(Date.parse(String(preregistration.generatedAt))) &&
    preregistration.maxSeedLaunches === 2 &&
    COMMIT_PATTERN.test(String(preregistration.lifecycleCandidateCommit)) &&
    isRecord(lifecycleArtifact) &&
    lifecycleArtifact.schemaVersion === 9 &&
    lifecycleArtifact.candidateCommit ===
      preregistration.lifecycleCandidateCommit &&
    lifecycleArtifact.fullClaimRerunRequired === true &&
    lifecycleArtifact.releaseAllowed === true &&
    Array.isArray(lifecycleArtifact.blockers) &&
    lifecycleArtifact.blockers.length === 0 &&
    preregistration.protocolCandidateCommit === protocolCandidateCommit &&
    preregistration.namespace === protocolIdentity.namespace &&
    preregistration.seedRunId === protocolIdentity.seedRunId &&
    preregistration.finalRunId === protocolIdentity.finalRunId &&
    preregistration.officialRunId === protocolIdentity.officialRunId &&
    preregistration.outputRoot === protocolIdentity.outputRoot &&
    preregistration.sentinelPath ===
      V073_FULL_CLAIM_PROTOCOL2_SENTINEL_PATH &&
    isRecord(preregistration.benchmark) &&
    preregistration.benchmark.bytes === 2_490_457 &&
    preregistration.benchmark.fingerprint ===
      V073_LOCOMO_BENCHMARK_FINGERPRINT &&
    preregistration.benchmark.sha256 === V073_LOCOMO_ROOT_SHA256 &&
    isArtifactIdentity(lifecycleProtection) &&
    lifecycleProtection.path === V073_LIFECYCLE_PROTECTION_ARTIFACT &&
    lifecycleProtection.bytes ===
      Buffer.byteLength(input.lifecycleProtectionRaw, "utf8") &&
    lifecycleProtection.sha256 ===
      createHash("sha256").update(input.lifecycleProtectionRaw).digest("hex");
  if (!preregistrationValid) {
    issues.push("full-claim protocol-v2 preregistration is inconsistent");
  }

  const receiptHeaderValid =
    receipt.protocolVersion === 2 &&
    receipt.maxSeedLaunches === 2 &&
    receipt.lifecycleCandidateCommit === preregistration.lifecycleCandidateCommit &&
    receipt.protocolCandidateCommit === protocolCandidateCommit &&
    COMMIT_PATTERN.test(String(receipt.sentinelCommit)) &&
    receipt.sentinelCommit === input.projection.sentinelCommit &&
    input.projection.lifecycleCandidateCommit ===
      preregistration.lifecycleCandidateCommit &&
    input.projection.protocolCandidateCommit === protocolCandidateCommit &&
    input.projection.maxSeedLaunches === 2 &&
    sameJson(input.projection.seedAttempts, receipt.seedAttempts) &&
    sameArtifactIdentity(
      receipt.preregistration,
      input.sources.get("protocol-preregistration")!,
    ) &&
    sameArtifactIdentity(
      receipt.sentinel,
      input.sources.get("protocol-attempt-sentinel")!,
    ) &&
    isRecord(receipt.sources) &&
    sameArtifactIdentity(
      receipt.sources.preregistration,
      input.sources.get("protocol-preregistration")!,
    ) &&
    sameArtifactIdentity(
      receipt.sources.sentinel,
      input.sources.get("protocol-attempt-sentinel")!,
    );
  if (!receiptHeaderValid) {
    issues.push("full-claim protocol-v2 execution receipt is inconsistent");
  }

  if (
    !isRecord(sentinel) ||
    sentinel.protocolVersion !== 2 ||
    sentinel.generatedBy !== "scripts/run-v0-7-3-full-locomo-claim.ts" ||
    !Number.isFinite(Date.parse(String(sentinel.generatedAt))) ||
    sentinel.state !== "consumed" ||
    sentinel.maxSeedLaunches !== 2 ||
    sentinel.lifecycleCandidateCommit !== preregistration.lifecycleCandidateCommit ||
    sentinel.protocolCandidateCommit !== protocolCandidateCommit ||
    sentinel.namespace !== protocolIdentity.namespace ||
    !COMMIT_PATTERN.test(String(sentinel.releaseCommit))
  ) {
    issues.push("full-claim protocol-v2 sentinel is inconsistent");
  }

  const seedAttempts = receipt.seedAttempts;
  const commandChain = receipt.commandChain;
  const typedSeedAttempts = Array.isArray(seedAttempts) ? seedAttempts : [];
  const finalCacheKeys = parseExtractionCacheKeys(
    input.sourceRaws.get("seed-extraction-cache")!,
  );
  const expectedCacheCaseByKey = new Map(
    (finalCacheKeys ?? []).map((key) => [key, "unknown"]),
  );
  if (typedSeedAttempts.length === 2 && isRecord(typedSeedAttempts[0])) {
    const passOneKeys = parseExtractionCacheKeys(
      input.sourceRaws.get("seed-attempt-1-extraction-cache")!,
    );
    const passOneKeySet = new Set(passOneKeys ?? []);
    const missingKeys = (finalCacheKeys ?? []).filter(
      (key) => !passOneKeySet.has(key),
    );
    if (missingKeys.length === 1) {
      expectedCacheCaseByKey.set(
        missingKeys[0]!,
        String(typedSeedAttempts[0].failedCaseId),
      );
    }
  }
  const extractionCacheContractValid =
    finalCacheKeys?.length === 272 &&
    createHash("sha256")
      .update(JSON.stringify([...finalCacheKeys].sort()))
      .digest("hex") === EXPECTED_EXTRACTION_CACHE_KEY_SET_SHA256;
  const seedInvocation = isRecord(commandChain) &&
      isRecord(commandChain.seedSmoke)
    ? commandChain.seedSmoke
    : undefined;
  let attemptHistoryValid = Array.isArray(seedAttempts) &&
    (seedAttempts.length === 1 || seedAttempts.length === 2) &&
    seedInvocation !== undefined &&
    extractionCacheContractValid;
  const passOneReport = input.sources.get("seed-attempt-1-report")!;
  const passOneProgress = input.sources.get("seed-attempt-1-progress")!;
  const passOneCache = input.sources.get("seed-attempt-1-extraction-cache")!;
  const finalReport = input.sources.get("seed-report")!;
  const finalProgress = input.sources.get("seed-progress")!;
  const finalCache = input.sources.get("seed-extraction-cache")!;
  const outputs = receipt.outputs;
  const finalOutput = isRecord(outputs) ? outputs.finalReport : undefined;
  const officialOutput = isRecord(outputs) ? outputs.officialSummary : undefined;
  const seedReportOutput = isRecord(outputs) ? outputs.seedReport : undefined;
  const seedProgressOutput = isRecord(outputs) ? outputs.seedProgress : undefined;
  const seedCacheOutput = isRecord(outputs)
    ? outputs.seedExtractionCache
    : undefined;
  const fixedOutputsValid =
    isRecord(seedInvocation) &&
    isNonEmptyString(seedInvocation.cwd) &&
    isArtifactIdentity(seedReportOutput) &&
    resolve(seedReportOutput.path) === resolve(
      seedInvocation.cwd,
      protocolIdentity.outputRoot,
      protocolIdentity.seedRunId,
      "smoke-report.json",
    ) &&
    isArtifactIdentity(finalOutput) &&
    resolve(finalOutput.path) === resolve(
      seedInvocation.cwd,
      protocolIdentity.outputRoot,
      protocolIdentity.finalRunId,
      "smoke-report.json",
    ) &&
    isArtifactIdentity(officialOutput) &&
    resolve(officialOutput.path) === resolve(
      seedInvocation.cwd,
      "reports/eval/research/official-rescore",
      protocolIdentity.officialRunId,
      "rescore-summary.json",
    ) &&
    isArtifactIdentity(seedProgressOutput) &&
    seedProgressOutput.bytes === finalProgress.bytes &&
    seedProgressOutput.sha256 === finalProgress.sha256 &&
    resolve(seedProgressOutput.path) === resolve(
      seedInvocation.cwd,
      protocolIdentity.outputRoot,
      protocolIdentity.seedRunId,
      "live-progress.jsonl",
    ) &&
    isArtifactIdentity(seedCacheOutput) &&
    seedCacheOutput.bytes === finalCache.bytes &&
    seedCacheOutput.sha256 === finalCache.sha256 &&
    resolve(seedCacheOutput.path) === resolve(
      seedInvocation.cwd,
      protocolIdentity.outputRoot,
      protocolIdentity.seedRunId,
      "extraction-cache.jsonl",
    );
  if (!fixedOutputsValid) {
    issues.push("full-claim protocol-v2 execution receipt is inconsistent");
  }
  if (attemptHistoryValid) {
    for (const [index, value] of typedSeedAttempts.entries()) {
      const attempt = isRecord(value) ? value : undefined;
      const first = index === 0;
      const expectedReport = first ? passOneReport : finalReport;
      const expectedProgress = first ? passOneProgress : finalProgress;
      const expectedCache = first ? passOneCache : finalCache;
      if (
        !attempt ||
        attempt.attempt !== index + 1 ||
        attempt.exitCode !== 0 ||
        !sameJson(attempt.command, seedInvocation) ||
        !sameArtifactIdentity(attempt.report, expectedReport) ||
        !sameArtifactIdentity(attempt.progress, expectedProgress) ||
        !sameArtifactIdentity(attempt.extractionCache, expectedCache)
      ) {
        attemptHistoryValid = false;
        break;
      }
    }
  }
  if (attemptHistoryValid) {
    try {
      const first = typedSeedAttempts[0] as Record<string, unknown>;
      const passOneReportValue = JSON.parse(
        input.sourceRaws.get("seed-attempt-1-report")!,
      ) as unknown;
      if (!isRecord(passOneReportValue)) {
        throw new Error("seed attempt-one report must be an object");
      }
      const firstClassification = classifyV073SeedAttemptRecovery({
        expectedCacheCaseByKey,
        extractionCacheRaw: input.sourceRaws.get(
          "seed-attempt-1-extraction-cache",
        )!,
        progressRaw: input.sourceRaws.get("seed-attempt-1-progress")!,
        report: passOneReportValue,
        runId: String(runIdentity.seedRunId),
      });
      if (typedSeedAttempts.length === 1) {
        attemptHistoryValid =
          first.failedCaseId === null &&
          first.recoveryClassification === "failure-free" &&
          sameJson(firstClassification, {
            failedCaseId: null,
            recoveryClassification: "failure-free",
          }) &&
          sameArtifactContent(passOneReport, finalReport) &&
          sameArtifactContent(passOneProgress, finalProgress) &&
          sameArtifactContent(passOneCache, finalCache) &&
          input.sourceRaws.get("seed-attempt-1-report") === input.seedRaw &&
          input.sourceRaws.get("seed-attempt-1-progress") ===
            input.sourceRaws.get("seed-progress") &&
          input.sourceRaws.get("seed-attempt-1-extraction-cache") ===
            input.sourceRaws.get("seed-extraction-cache");
      } else {
        const second = typedSeedAttempts[1] as Record<string, unknown>;
        const finalReportValue = JSON.parse(input.seedRaw) as unknown;
        if (!isRecord(finalReportValue)) {
          throw new Error("final seed report must be an object");
        }
        const finalClassification = classifyV073SeedAttemptRecovery({
          expectedCacheCaseByKey,
          extractionCacheRaw: input.sourceRaws.get("seed-extraction-cache")!,
          progressRaw: input.sourceRaws.get("seed-progress")!,
          report: finalReportValue,
          runId: String(runIdentity.seedRunId),
        });
        const passOneRows = Array.isArray(passOneReportValue.cases)
          ? passOneReportValue.cases.filter(isRecord)
          : [];
        const finalRows = Array.isArray(finalReportValue.cases)
          ? finalReportValue.cases.filter(isRecord)
          : [];
        const finalRowsByQuestion = new Map(
          finalRows.map((row) => [
            `${String(row.caseId)}\u0000${String(row.questionId)}`,
            row,
          ]),
        );
        const successfulPassOneRetrievalStable = passOneRows
          .filter((row) => row.executionFailureMessage == null)
          .every((row) => {
            const finalRow = finalRowsByQuestion.get(
              `${String(row.caseId)}\u0000${String(row.questionId)}`,
            );
            return finalRow !== undefined &&
              sameJson(retrievalIdentity(row), retrievalIdentity(finalRow));
          });
        attemptHistoryValid =
          first.recoveryClassification ===
            "eligible-single-case-seed-timeout" &&
          first.failedCaseId === firstClassification.failedCaseId &&
          firstClassification.recoveryClassification ===
            "eligible-single-case-seed-timeout" &&
          second.recoveryClassification ===
            "failure-free-after-single-resume" &&
          second.failedCaseId === null &&
          sameJson(finalClassification, {
            failedCaseId: null,
            recoveryClassification: "failure-free",
          }) &&
          successfulPassOneRetrievalStable &&
          input.sourceRaws.get("seed-progress")!.startsWith(
            input.sourceRaws.get("seed-attempt-1-progress")!,
          ) &&
          input.sourceRaws.get("seed-extraction-cache")!.startsWith(
            input.sourceRaws.get("seed-attempt-1-extraction-cache")!,
          );
      }
    } catch {
      attemptHistoryValid = false;
    }
  }
  if (!attemptHistoryValid) {
    issues.push("full-claim protocol-v2 seed attempt history is inconsistent");
  }
  return issues;
}

async function validateV073FullClaimProtocol2GitBoundary(input: {
  claimRecipeRaw: string;
  officialRunnerRaw: string;
  preregistrationRaw: string;
  protocolCandidateCommit: string;
  repoRoot: string;
  sentinel: unknown;
  sentinelCommit: unknown;
  sentinelRaw: string;
}): Promise<string[]> {
  if (
    !COMMIT_PATTERN.test(input.protocolCandidateCommit) ||
    !isRecord(input.sentinel) ||
    !COMMIT_PATTERN.test(String(input.sentinel.releaseCommit)) ||
    !COMMIT_PATTERN.test(String(input.sentinelCommit))
  ) {
    return ["full-claim protocol-v2 git boundary is inconsistent"];
  }
  const releaseCommit = String(input.sentinel.releaseCommit);
  const sentinelCommit = String(input.sentinelCommit);
  const [
    currentCommit,
    protocolToRelease,
    sentinelToCurrent,
    sentinelParent,
    sentinelDiff,
    preregistrationAtRelease,
    sentinelAtRelease,
    sentinelAtCommit,
    claimRecipeAtProtocolCandidate,
    officialRunnerAtProtocolCandidate,
  ] = await Promise.all([
    runCommand("git", ["rev-parse", "HEAD"], input.repoRoot),
    runCommand(
      "git",
      [
        "merge-base",
        "--is-ancestor",
        input.protocolCandidateCommit,
        releaseCommit,
      ],
      input.repoRoot,
    ),
    runCommand(
      "git",
      ["merge-base", "--is-ancestor", sentinelCommit, "HEAD"],
      input.repoRoot,
    ),
    runCommand("git", ["rev-parse", `${sentinelCommit}^`], input.repoRoot),
    runCommand(
      "git",
      ["diff", "--name-only", releaseCommit, sentinelCommit],
      input.repoRoot,
    ),
    runCommand(
      "git",
      ["show", `${releaseCommit}:${V073_FULL_CLAIM_PROTOCOL2_PREREGISTRATION_PATH}`],
      input.repoRoot,
    ),
    runCommand(
      "git",
      ["show", `${releaseCommit}:${V073_FULL_CLAIM_PROTOCOL2_SENTINEL_PATH}`],
      input.repoRoot,
    ),
    runCommand(
      "git",
      ["show", `${sentinelCommit}:${V073_FULL_CLAIM_PROTOCOL2_SENTINEL_PATH}`],
      input.repoRoot,
    ),
    runCommand(
      "git",
      ["show", `${input.protocolCandidateCommit}:benchmark-claims/locomo.json`],
      input.repoRoot,
    ),
    runCommand(
      "git",
      [
        "show",
        `${input.protocolCandidateCommit}:scripts/rescore-official-protocols.ts`,
      ],
      input.repoRoot,
    ),
  ]);
  const valid =
    currentCommit.code === 0 &&
    COMMIT_PATTERN.test(currentCommit.stdout.trim()) &&
    protocolToRelease.code === 0 &&
    sentinelToCurrent.code === 0 &&
    sentinelParent.code === 0 &&
    sentinelParent.stdout.trim() === releaseCommit &&
    sentinelDiff.code === 0 &&
    sentinelDiff.stdout === `${V073_FULL_CLAIM_PROTOCOL2_SENTINEL_PATH}\n` &&
    preregistrationAtRelease.code === 0 &&
    preregistrationAtRelease.stdout === input.preregistrationRaw &&
    sentinelAtRelease.code !== 0 &&
    sentinelAtCommit.code === 0 &&
    sentinelAtCommit.stdout === input.sentinelRaw &&
    claimRecipeAtProtocolCandidate.code === 0 &&
    claimRecipeAtProtocolCandidate.stdout === input.claimRecipeRaw &&
    officialRunnerAtProtocolCandidate.code === 0 &&
    officialRunnerAtProtocolCandidate.stdout === input.officialRunnerRaw;
  return valid
    ? []
    : ["full-claim protocol-v2 git boundary is inconsistent"];
}

function validateStableLocomoEvidenceValues(input: {
  claimRecipeRaw: string;
  claimDeclaration: unknown;
  executionReceipt: unknown;
  finalRaw: string;
  finalReport: unknown;
  officialSummary: unknown;
  officialProgressRaw: string;
  projection: Record<string, unknown>;
  lifecycleProtectionRaw: string;
  seedRaw: string;
  seedReport: unknown;
  sourceRaws: Map<string, string>;
  sources: Map<string, ArtifactIdentityShape>;
}): string[] {
  const issues: string[] = [];
  const claim = input.projection.claim as Record<string, unknown>;
  const descriptor = input.projection.descriptorClaim as Record<string, unknown>;
  const execution = input.projection.execution as Record<string, unknown>;
  const runIdentity = input.projection.runIdentity as Record<string, unknown>;
  issues.push(...validateV073FullClaimProtocol2({
    executionReceipt: input.executionReceipt,
    lifecycleProtectionRaw: input.lifecycleProtectionRaw,
    projection: input.projection,
    seedRaw: input.seedRaw,
    sourceRaws: input.sourceRaws,
    sources: input.sources,
  }));
  if (
    execution.benchmarkFingerprint !== V073_LOCOMO_BENCHMARK_FINGERPRINT ||
    execution.benchmarkRootSha256 !== V073_LOCOMO_ROOT_SHA256
  ) {
    issues.push("current LoCoMo execution does not use the frozen full-10 benchmark bytes");
  }
  const seedRows = validateFullLocomoReport({
    expectedMode: "retrieval-only",
    expectedGeneratedBy: "scripts/run-phase-65-locomo-smoke.ts",
    expectedResume: true,
    issues,
    label: "seed report",
    report: input.seedReport,
  });
  const finalRows = validateFullLocomoReport({
    expectedMode: "live-answer",
    expectedGeneratedBy: "scripts/reanswer-phase-65-locomo-report.ts",
    expectedResume: false,
    issues,
    label: "final report",
    report: input.finalReport,
  });
  if (isRecord(input.seedReport) && isRecord(input.finalReport)) {
    const sourceReport = input.finalReport.sourceReport;
    if (
      !isRecord(sourceReport) ||
      sourceReport.runId !== input.seedReport.runId ||
      resolve(String(sourceReport.path)) !==
        resolve(String(input.seedReport.runDirectory), "smoke-report.json") ||
      input.seedReport.runId !== runIdentity.seedRunId ||
      input.finalReport.runId !== runIdentity.finalRunId
    ) {
      issues.push("final report does not descend from the bound seed report");
    }
    if (
      Date.parse(String(input.finalReport.generatedAt)) <=
      Date.parse(String(input.seedReport.generatedAt))
    ) {
      issues.push("final report timestamp must follow the seed report timestamp");
    }
  }
  if (seedRows && finalRows) {
    for (const [index, seed] of seedRows.entries()) {
      if (!sameJson(retrievalIdentity(seed), retrievalIdentity(finalRows[index]!))) {
        issues.push(`final report changed seed retrieval evidence at row ${index}`);
        break;
      }
    }
    const strictCorrect = finalRows.filter((row) => row.answerCorrect === true).length;
    const strictScore = strictCorrect / 1540;
    if (
      !isRecord(input.finalReport) ||
      input.finalReport.answerAccuracyOverall !== strictScore ||
      claim.strictScore !== strictScore
    ) {
      issues.push("strict score does not match the 1540 final answer outcomes");
    }
  }
  if (!isRecord(input.officialSummary)) {
    issues.push("official summary must be an object");
  } else {
    const official = input.officialSummary;
    const categories = official.categories;
    const reportFingerprint = isRecord(official.sourceInputFingerprints)
      ? official.sourceInputFingerprints.reportPath
      : undefined;
    const rootFingerprint = isRecord(official.sourceInputFingerprints)
      ? official.sourceInputFingerprints.rootPath
      : undefined;
    const sourceInputs = official.sourceInputs;
    if (
      official.generatedBy !== "scripts/rescore-official-protocols.ts" ||
      official.benchmark !== "locomo" ||
      official.runId !== runIdentity.officialRunId ||
      official.judgeFailures !== 0 ||
      official.sourceCases !== 1540 ||
      official.selectedCases !== 1540 ||
      official.judgedCases !== 1540 ||
      official.totalCases !== 1540 ||
      official.sourceAnswersUnchanged !== true ||
      official.judgeGateway !== execution.judgeGateway ||
      official.judgeModel !== execution.judgeModel ||
      official.judgeProvider !== execution.judgeProvider ||
      !isNonEmptyString(official.protocol) ||
      !official.protocol.includes("mem0ai/memory-benchmarks LoCoMo judge") ||
      !isRecord(reportFingerprint) ||
      reportFingerprint.bytes !== Buffer.byteLength(input.finalRaw, "utf8") ||
      reportFingerprint.sha256 !== createHash("sha256").update(input.finalRaw).digest("hex") ||
      !isRecord(rootFingerprint) ||
      rootFingerprint.bytes !== 2_490_457 ||
      rootFingerprint.sha256 !== V073_LOCOMO_ROOT_SHA256 ||
      !isRecord(sourceInputs) ||
      !isRecord(input.finalReport) ||
      resolve(String(sourceInputs.reportPath)) !==
        resolve(String(input.finalReport.runDirectory), "smoke-report.json") ||
      !isFiniteUnitInterval(official.overallAccuracy) ||
      claim.officialScore !== official.overallAccuracy
    ) {
      issues.push("official summary is not bound to the complete final report and judge protocol");
    }
    if (!isRecord(categories)) {
      issues.push("official summary categories are missing");
    } else {
      let correctTotal = 0;
      for (const [category, total] of Object.entries(V073_LOCOMO_CATEGORY_COUNTS)) {
        const result = categories[category];
        if (
          !isRecord(result) ||
          result.total !== total ||
          !Number.isSafeInteger(result.correct) ||
          (result.correct as number) < 0 ||
          (result.correct as number) > total ||
          result.accuracy !== (result.correct as number) / total
        ) {
          issues.push(`official summary category ${category} is inconsistent`);
          continue;
        }
        correctTotal += result.correct as number;
      }
      if (
        official.overallCorrect !== correctTotal ||
        official.overallAccuracy !== correctTotal / 1540 ||
        !isRecord(categories.open_domain) ||
        claim.openDomainCorrect !== categories.open_domain.correct ||
        claim.openDomainTotal !== categories.open_domain.total ||
        claim.openDomainScore !== categories.open_domain.accuracy
      ) {
        issues.push("official overall or open-domain score is inconsistent");
      }
      if (finalRows) {
        let progressRows: unknown[] = [];
        try {
          progressRows = input.officialProgressRaw
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean)
            .map((line) => JSON.parse(line) as unknown);
        } catch {
          issues.push("official progress is not valid JSONL");
        }
        const progress = new Map<string, boolean>();
        for (const row of progressRows) {
          if (
            !isRecord(row) ||
            !isNonEmptyString(row.questionId) ||
            typeof row.correct !== "boolean" ||
            progress.has(row.questionId)
          ) {
            issues.push("official progress rows are invalid or duplicated");
            continue;
          }
          progress.set(row.questionId, row.correct);
        }
        if (
          progress.size !== 1540 ||
          finalRows.some((row) => !progress.has(String(row.questionId)))
        ) {
          issues.push("official progress does not cover all 1540 final questions");
        } else {
          for (const [category, total] of Object.entries(V073_LOCOMO_CATEGORY_COUNTS)) {
            const correct = finalRows.filter(
              (row) =>
                row.category === category &&
                progress.get(String(row.questionId)) === true,
            ).length;
            const summaryCategory = categories[category];
            if (
              !isRecord(summaryCategory) ||
              summaryCategory.correct !== correct ||
              summaryCategory.accuracy !== correct / total
            ) {
              issues.push(`official progress disagrees with category ${category}`);
            }
          }
        }
      }
    }
  }
  if (!isRecord(input.executionReceipt)) {
    issues.push("full-claim execution receipt must be an object");
  } else {
    const receipt = input.executionReceipt;
    const evidenceRepositoryBefore = receipt.evidenceRepositoryBefore;
    const provenance = receipt.worktreeProvenance;
    const outputs = receipt.outputs;
    const receiptSources = receipt.sources;
    const commandChain = receipt.commandChain;
    const freshOutputEvidence = receipt.freshOutputEvidence;
    if (
      receipt.schemaVersion !== 1 ||
      receipt.generatedBy !== "v0.7.3-full-locomo-claim-launch" ||
      receipt.commit !== runIdentity.commit ||
      !isNonEmptyString(receipt.command) ||
      !sameJson(receipt.execution, execution) ||
      !isRecord(evidenceRepositoryBefore) ||
      evidenceRepositoryBefore.headCommit !== runIdentity.commit ||
      evidenceRepositoryBefore.statusPorcelain !== "" ||
      !sameJson(
        evidenceRepositoryBefore,
        input.projection.evidenceRepositoryBefore,
      ) ||
      !isRecord(provenance) ||
      provenance.headCommit !== runIdentity.commit ||
      provenance.statusPorcelain !== "" ||
      !isRecord(outputs) ||
      !isRecord(receiptSources) ||
      !isRecord(commandChain) ||
      !isRecord(freshOutputEvidence) ||
      freshOutputEvidence.seedOutputPathAbsentBeforeRun !== true ||
      freshOutputEvidence.seedAttemptOneSnapshotPathAbsentBeforeRun !== true ||
      freshOutputEvidence.finalOutputPathAbsentBeforeRun !== true ||
      freshOutputEvidence.officialOutputPathAbsentBeforeRun !== true
    ) {
      issues.push("full-claim execution receipt does not bind a clean exact execution");
    } else {
      for (const [kind, outputName] of [
        ["seed-report", "seedReport"],
        ["final-report", "finalReport"],
        ["official-summary", "officialSummary"],
        ["official-progress", "officialProgress"],
      ] as const) {
        const output = outputs[outputName];
        const source = input.sources.get(kind)!;
        if (
          !isArtifactIdentity(output) ||
          output.bytes !== source.bytes ||
          output.sha256 !== source.sha256
        ) {
          issues.push(`execution receipt ${outputName} fingerprint is inconsistent`);
        }
      }
      const officialSource = input.sources.get("official-runner-source")!;
      if (
        !isArtifactIdentity(receiptSources.officialRunner) ||
        receiptSources.officialRunner.bytes !== officialSource.bytes ||
        receiptSources.officialRunner.sha256 !== officialSource.sha256 ||
        officialSource.sha256 !== execution.officialSourceSha256
      ) {
        issues.push("execution receipt official runner source is inconsistent");
      }
      const claimRecipeSource = input.sources.get("claim-recipe-source")!;
      let claimRecipeTemplateSha256: string | undefined;
      try {
        claimRecipeTemplateSha256 =
          deriveV073ClaimCommandTemplateSha256(input.claimRecipeRaw);
      } catch {
        claimRecipeTemplateSha256 = undefined;
      }
      if (
        !isArtifactIdentity(receiptSources.claimRecipe) ||
        receiptSources.claimRecipe.bytes !== claimRecipeSource.bytes ||
        receiptSources.claimRecipe.sha256 !== claimRecipeSource.sha256 ||
        claimRecipeSource.sha256 !==
          createHash("sha256").update(input.claimRecipeRaw).digest("hex") ||
        execution.claimCommandTemplateSha256 !==
          claimRecipeTemplateSha256
      ) {
        issues.push("execution receipt claim recipe source is inconsistent");
      }
      const seedOutput = outputs.seedReport;
      const finalOutput = outputs.finalReport;
      const sourceInputs = isRecord(input.officialSummary)
        ? input.officialSummary.sourceInputs
        : undefined;
      const seedInvocation = commandChain.seedSmoke;
      if (
        !isArtifactIdentity(seedOutput) ||
        !isArtifactIdentity(finalOutput) ||
        !isRecord(sourceInputs) ||
        !isNonEmptyString(sourceInputs.rootPath) ||
        !isRecord(seedInvocation) ||
        !isNonEmptyString(seedInvocation.cwd) ||
        !isRecord(input.claimDeclaration)
      ) {
        issues.push("execution receipt command chain cannot be reconstructed");
      } else {
        const claimRecipeRaw = input.claimRecipeRaw;
        try {
          const recordedBenchmarkRoot = dirname(sourceInputs.rootPath);
          const expectedChain = buildV073FullClaimCommandChain({
            answerGateway: String(execution.answerGateway),
            answerModel: String(execution.answerModel),
            answerProvider: String(execution.answerProvider),
            assistedExtractorGateway: String(execution.assistedExtractorGateway),
            assistedExtractorModel: String(execution.assistedExtractorModel),
            assistedExtractorProvider: String(execution.assistedExtractorProvider),
            benchmarkRoot: V073_PROTOCOL2_CANONICAL_BENCHMARK_ROOT,
            embeddingGateway: String(execution.embeddingGateway),
            embeddingModel: String(execution.embeddingModel),
            embeddingProvider: String(execution.embeddingProvider),
            finalOutputPath: dirname(finalOutput.path),
            finalRunId: String(runIdentity.finalRunId),
            judgeGateway: String(execution.judgeGateway),
            judgeModel: String(execution.judgeModel),
            judgeProvider: String(execution.judgeProvider),
            officialRunId: String(runIdentity.officialRunId),
            rerankingGateway: String(execution.rerankingGateway),
            rerankingModel: String(execution.rerankingModel),
            rerankingProvider: String(execution.rerankingProvider),
            seedOutputPath: dirname(seedOutput.path),
            seedRunId: String(runIdentity.seedRunId),
            worktreePath: seedInvocation.cwd,
          }, canonicalProtocol2ClaimRecipe(claimRecipeRaw));
          if (
            !Array.isArray(receipt.seedAttempts) ||
            (receipt.seedAttempts.length !== 1 &&
              receipt.seedAttempts.length !== 2)
          ) {
            throw new Error("full claim protocol-v2 seed attempt count is invalid");
          }
          const expectedCommand = renderV073FullClaimProtocol2Command(
            expectedChain,
            seedInvocation.cwd,
            receipt.seedAttempts.length,
          );
          if (
            !sameJson(
              canonicalProtocol2CommandChain(
                commandChain,
                recordedBenchmarkRoot,
              ),
              expectedChain,
            ) ||
            receipt.command !== expectedCommand ||
            execution.claimCommandSha256 !==
              createHash("sha256").update(expectedCommand).digest("hex") ||
            execution.claimCommandTemplateSha256 !==
              deriveV073ClaimCommandTemplateSha256(claimRecipeRaw)
          ) {
            issues.push("execution receipt command chain does not match the claim recipe");
          }
        } catch {
          issues.push("execution receipt command chain does not match the claim recipe");
        }
      }
    }
  }
  if (!isRecord(input.claimDeclaration)) {
    issues.push("benchmark-claims/locomo.json must be an object");
  } else {
    const declaration = input.claimDeclaration;
    const run = declaration.run;
    const model = declaration.model;
    const metrics = declaration.metrics;
    const boundary = declaration.claimBoundary;
    const coverage = declaration.coverage;
    const comparison = declaration.comparison;
    const evidence = declaration.evidence;
    const command = isRecord(run) ? run.command : undefined;
    const projectionListed = isRecord(evidence) && Array.isArray(evidence.artifacts) &&
      evidence.artifacts.some(
        (artifact) => isRecord(artifact) && artifact.path === V073_LOCOMO_CURRENT_PROJECTION,
      );
    if (
      declaration.benchmark !== "LoCoMo" ||
      declaration.status !== "candidate_public_claim" ||
      !isRecord(run) ||
      run.commit !== runIdentity.commit ||
      run.packageVersion !== HISTORICAL_LOCOMO_VERSION ||
      run.executionFailures !== 0 ||
      !isNonEmptyString(command) ||
      command !== (isRecord(input.executionReceipt)
        ? input.executionReceipt.command
        : undefined) ||
      createHash("sha256").update(String(command)).digest("hex") !==
        execution.claimCommandSha256 ||
      !isRecord(model) ||
      model.answerGateway !== execution.answerGateway ||
      model.answerModel !== execution.answerModel ||
      model.answerProvider !== execution.answerProvider ||
      model.judgeGateway !== execution.judgeGateway ||
      model.judgeModel !== execution.judgeModel ||
      model.judgeProvider !== execution.judgeProvider ||
      model.sameModelJudge !== false ||
      !isRecord(metrics) ||
      metrics.score !== claim.officialScore ||
      !isRecord(boundary) ||
      boundary.publicClaimAllowed !== true ||
      !isRecord(coverage) ||
      coverage.complete !== true ||
      !isRecord(comparison) ||
      comparison.runtimeProfile !== descriptor.runtimeProfile ||
      (comparison.availability !== "production-default" &&
        comparison.availability !== "public-opt-in") ||
      !projectionListed
    ) {
      issues.push("benchmark-claims/locomo.json is not a current public 0.7.3 declaration bound to the projection");
    }
  }
  if (
    !String(descriptor.result).includes(Number(claim.officialScore).toFixed(4)) ||
    !String(descriptor.result).includes(Number(claim.strictScore).toFixed(4)) ||
    !String(descriptor.result).includes(
      `${String(claim.openDomainCorrect)}/${String(claim.openDomainTotal)}`,
    ) ||
    !String(descriptor.result).includes(Number(claim.openDomainScore).toFixed(4))
  ) {
    issues.push("descriptor result does not disclose official, strict, and open-domain evidence");
  }
  return issues;
}

async function readTrackedRegularText(input: {
  label: string;
  path: string;
  repoRoot: string;
}): Promise<string> {
  const repoRoot = resolve(input.repoRoot);
  const absolutePath = resolve(repoRoot, input.path);
  if (!absolutePath.startsWith(`${repoRoot}/`)) {
    throw new Error(`${input.label} escapes the tracked repository`);
  }
  const fileInfo = await lstat(absolutePath);
  if (!fileInfo.isFile()) {
    throw new Error(`${input.label} must be a regular tracked file`);
  }
  const expectedRealPath = resolve(await realpath(repoRoot), input.path);
  if (await realpath(absolutePath) !== expectedRealPath) {
    throw new Error(`${input.label} must be a regular tracked file`);
  }
  return readFile(absolutePath, "utf8");
}

export async function validateStableLocomoClaimEvidence(input: {
  claimDeclaration: unknown;
  projection: unknown;
  repoRoot: string;
}): Promise<string[]> {
  if (
    !isRecord(input.projection) ||
    input.projection.artifactKind !== "tracked-current-claim-projection" ||
    input.projection.benchmark !== "LoCoMo" ||
    input.projection.schemaVersion !== 1 ||
    !isValidStableLocomoClaimProjection(input.projection)
  ) {
    return [
      "current LoCoMo projection does not satisfy the full 1540-question evidence contract",
    ];
  }
  const issues: string[] = [];
  const sources = sourceArtifactMap(input.projection);
  const rawByKind = new Map<string, string>();
  for (const [kind, expectedPath] of Object.entries(
    V073_LOCOMO_SOURCE_ARTIFACT_PATHS,
  )) {
    const source = sources.get(kind)!;
    if (source.path !== expectedPath) {
      issues.push(`${kind} must use tracked path ${expectedPath}`);
      continue;
    }
    try {
      const raw = await readTrackedRegularText({
        label: kind,
        path: source.path,
        repoRoot: input.repoRoot,
      });
      const digest = createHash("sha256").update(raw).digest("hex");
      if (
        Buffer.byteLength(raw, "utf8") !== source.bytes ||
        digest !== source.sha256
      ) {
        issues.push(`${kind} bytes do not match the tracked projection fingerprint`);
      } else {
        rawByKind.set(kind, raw);
      }
    } catch (error) {
      issues.push(
        error instanceof Error
          ? error.message
          : `${kind} cannot be read from ${source.path}: ${String(error)}`,
      );
    }
  }
  if (issues.length > 0) {
    return issues;
  }
  let lifecycleProtectionRaw: string;
  try {
    lifecycleProtectionRaw = await readFile(
      join(input.repoRoot, V073_LIFECYCLE_PROTECTION_ARTIFACT),
      "utf8",
    );
  } catch (error) {
    return [
      `lifecycle protection artifact cannot be read from ${V073_LIFECYCLE_PROTECTION_ARTIFACT}: ${String(error)}`,
    ];
  }
  const seedRaw = rawByKind.get("seed-report")!;
  const claimRecipeRaw = rawByKind.get("claim-recipe-source")!;
  const finalRaw = rawByKind.get("final-report")!;
  const officialRaw = rawByKind.get("official-summary")!;
  const officialProgressRaw = rawByKind.get("official-progress")!;
  const receiptRaw = rawByKind.get("execution-receipt")!;
  const seedReport = parseEvidenceJson(seedRaw, "seed report", issues);
  const finalReport = parseEvidenceJson(finalRaw, "final report", issues);
  const officialSummary = parseEvidenceJson(officialRaw, "official summary", issues);
  const executionReceipt = parseEvidenceJson(receiptRaw, "execution receipt", issues);
  const sentinel = parseEvidenceJson(
    rawByKind.get("protocol-attempt-sentinel")!,
    "full-claim protocol-v2 sentinel",
    issues,
  );
  if (issues.length > 0) {
    return issues;
  }
  const evidenceIssues = validateStableLocomoEvidenceValues({
    claimRecipeRaw,
    claimDeclaration: input.claimDeclaration,
    executionReceipt,
    finalRaw,
    finalReport,
    officialSummary,
    officialProgressRaw,
    projection: input.projection,
    lifecycleProtectionRaw,
    seedRaw,
    seedReport,
    sourceRaws: rawByKind,
    sources,
  });
  const gitBoundaryIssues = await validateV073FullClaimProtocol2GitBoundary({
    claimRecipeRaw,
    officialRunnerRaw: rawByKind.get("official-runner-source")!,
    preregistrationRaw: rawByKind.get("protocol-preregistration")!,
    protocolCandidateCommit: isRecord(input.projection.runIdentity)
      ? String(input.projection.runIdentity.commit)
      : "",
    repoRoot: input.repoRoot,
    sentinel,
    sentinelCommit: isRecord(executionReceipt)
      ? executionReceipt.sentinelCommit
      : undefined,
    sentinelRaw: rawByKind.get("protocol-attempt-sentinel")!,
  });
  return [...evidenceIssues, ...gitBoundaryIssues];
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

export async function evaluateV073CurrentLocomoClaimState(input: {
  claims: Array<{ measuredPackageVersion?: string; name?: string }>;
  releaseStatus: string | undefined;
  repoRoot: string;
}): Promise<string[]> {
  const projectionPath = join(input.repoRoot, V073_LOCOMO_CURRENT_PROJECTION);
  const evidenceRoot = join(
    input.repoRoot,
    V073_LOCOMO_CLAIM_EVIDENCE_PREFIX.slice(0, -1),
  );
  const artifactPaths = Object.values(V073_LOCOMO_SOURCE_ARTIFACT_PATHS).map(
    (path) => join(input.repoRoot, path),
  );
  const preregistrationArtifactIndex = Object.values(
    V073_LOCOMO_SOURCE_ARTIFACT_PATHS,
  ).indexOf(V073_FULL_CLAIM_PROTOCOL2_PREREGISTRATION_PATH);
  const listDirectory = async (path: string): Promise<string[]> => {
    try {
      return await readdir(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw error;
    }
  };
  const [
    projectionExists,
    evidenceRootExists,
    artifactPresence,
    releaseEntries,
    projectionEntries,
  ] = await Promise.all([
    pathExists(projectionPath),
    pathExists(evidenceRoot),
    Promise.all(artifactPaths.map(pathExists)),
    listDirectory(join(input.repoRoot, "reports/release/v0.7")),
    listDirectory(join(input.repoRoot, "benchmark-claims/evidence")),
  ]);
  const partialPublication =
    releaseEntries.some((name) =>
      name.startsWith(".v0.7.3-locomo-claim-evidence.partial-") ||
      name === ".v0.7.3-locomo-claim-publication.lock") ||
    projectionEntries.some((name) =>
      name.startsWith(".locomo-v0.7.3-current.json.partial-"));
  const anyEvidence =
    evidenceRootExists ||
    artifactPresence.some(
      (present, index) => present && index !== preregistrationArtifactIndex,
    ) ||
    partialPublication;
  const completeEvidence = artifactPresence.every(Boolean);
  if (!projectionExists && !anyEvidence) {
    return stableLocomoClaimIssues({
      claims: input.claims,
      projection: undefined,
      releaseStatus: input.releaseStatus,
    });
  }
  const issues: string[] = [];
  if (evidenceRootExists) {
    const expectedEntries = Object.values(V073_LOCOMO_SOURCE_ARTIFACT_PATHS)
      .filter((path) => path.startsWith(V073_LOCOMO_CLAIM_EVIDENCE_PREFIX))
      .map((path) => path.slice(V073_LOCOMO_CLAIM_EVIDENCE_PREFIX.length))
      .sort();
    try {
      const rootInfo = await lstat(evidenceRoot);
      const expectedRealRoot = resolve(
        await realpath(input.repoRoot),
        V073_LOCOMO_CLAIM_EVIDENCE_PREFIX.slice(0, -1),
      );
      if (
        !rootInfo.isDirectory() ||
        await realpath(evidenceRoot) !== expectedRealRoot
      ) {
        issues.push("current LoCoMo evidence root must be a real directory");
      } else {
        const entries = await readdir(evidenceRoot, { withFileTypes: true });
        if (
          entries.some((entry) => !entry.isFile()) ||
          !sameJson(entries.map((entry) => entry.name).sort(), expectedEntries)
        ) {
          issues.push(
            `current LoCoMo evidence directory must contain exactly the ${expectedEntries.length} tracked bundle files`,
          );
        }
      }
    } catch {
      issues.push("current LoCoMo evidence root must be a real directory");
    }
  }
  let projection: unknown = undefined;
  if (projectionExists) {
    try {
      projection = JSON.parse(await readTrackedRegularText({
        label: "current LoCoMo projection",
        path: V073_LOCOMO_CURRENT_PROJECTION,
        repoRoot: input.repoRoot,
      })) as unknown;
    } catch {
      issues.push(
        `${V073_LOCOMO_CURRENT_PROJECTION} is not a regular tracked JSON file`,
      );
    }
  }
  if (!projectionExists || !completeEvidence || partialPublication) {
    issues.push(
      `current LoCoMo evidence is partial: projection and all ${Object.keys(V073_LOCOMO_SOURCE_ARTIFACT_PATHS).length} tracked source artifacts must appear together`,
    );
  }
  issues.push(...stableLocomoClaimIssues({
    claims: input.claims,
    projection,
    releaseStatus: input.releaseStatus,
  }));
  if (projectionExists && completeEvidence && isRecord(projection)) {
    let declaration: unknown = undefined;
    try {
      declaration = JSON.parse(
        await readFile(join(input.repoRoot, "benchmark-claims/locomo.json"), "utf8"),
      ) as unknown;
    } catch {
      declaration = undefined;
    }
    issues.push(...await validateStableLocomoClaimEvidence({
      claimDeclaration: declaration,
      projection,
      repoRoot: input.repoRoot,
    }));
  }
  return issues;
}

export function evaluateStableLocomoCandidateLink(input: {
  protocolCandidateCommit: string;
  candidatePromptSha256: string;
  projection: unknown;
}): V07ReleaseReadinessCheck {
  const measuredCommit = isRecord(input.projection) &&
    isRecord(input.projection.runIdentity)
    ? input.projection.runIdentity.commit
    : undefined;
  const measuredPromptSha256 = isRecord(input.projection) &&
    isRecord(input.projection.execution)
    ? input.projection.execution.promptSha256
    : undefined;
  const matches = measuredCommit === input.protocolCandidateCommit &&
    measuredPromptSha256 === input.candidatePromptSha256;
  return {
    detail: matches
      ? `full-1540 LoCoMo claim was measured on protocol candidate ${input.protocolCandidateCommit} with prompt ${input.candidatePromptSha256}`
      : `full-1540 LoCoMo claim commit/prompt ${String(measuredCommit ?? "<missing>")}/${String(measuredPromptSha256 ?? "<missing>")} does not match protocol candidate ${input.protocolCandidateCommit}/${input.candidatePromptSha256}`,
    durationMs: 0,
    id: "v0.7.3-current-claim-candidate",
    required: true,
    status: matches ? "pass" : "fail",
    title: "Current LoCoMo claim candidate identity",
  };
}

export function parseV07ReleaseReadinessCliOptions(
  argv: readonly string[],
): V07ReleaseReadinessOptions {
  const options = {
    lifecycleProtectionArtifact: resolveCliFlagValueStrict(
      argv,
      "--lifecycle-protection-artifact",
    ),
    outputDir: resolveCliFlagValueStrict(argv, "--output-dir"),
    skipBuild: hasCliFlagStrict(argv, "--skip-build"),
    skipCoverage: hasCliFlagStrict(argv, "--skip-coverage"),
    skipTests: hasCliFlagStrict(argv, "--skip-tests"),
    strict: hasCliFlagStrict(argv, "--strict"),
  };
  assertValidV07ReleaseReadinessOptions(options);
  return options;
}

function assertValidV07ReleaseReadinessOptions(
  options: V07ReleaseReadinessOptions,
): void {
  if (
    options.strict &&
    (options.skipBuild || options.skipCoverage || options.skipTests)
  ) {
    throw new Error(
      "--strict cannot be combined with release-check skip flags.",
    );
  }
}

export function evaluateV07RequiredChecks(
  checks: readonly V07ReleaseReadinessCheck[],
): boolean {
  return checks.every(
    (check) => !check.required || check.status === "pass",
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

interface ArtifactIdentityShape {
  bytes: number;
  path: string;
  sha256: string;
}

export function resolveV073MeasuredClaimRecipeRaw(input: {
  candidateGitObjectRaw?: string;
  currentClaimRecipeRaw: string;
  identity: ArtifactIdentityShape;
}): string {
  const raw = input.candidateGitObjectRaw ?? input.currentClaimRecipeRaw;
  if (
    input.identity.path !== "benchmark-claims/locomo.json" ||
    Buffer.byteLength(raw, "utf8") !== input.identity.bytes ||
    sha256(raw) !== input.identity.sha256
  ) {
    throw new Error(
      "measured candidate claim recipe does not match its harness identity",
    );
  }
  return raw;
}

function isArtifactIdentity(value: unknown): value is ArtifactIdentityShape {
  return (
    isRecord(value) &&
    typeof value.bytes === "number" &&
    Number.isSafeInteger(value.bytes) &&
    value.bytes >= 0 &&
    typeof value.path === "string" &&
    value.path.trim().length > 0 &&
    typeof value.sha256 === "string" &&
    SHA256_PATTERN.test(value.sha256)
  );
}

function hasLifecycleArtifactIdentities(value: unknown): boolean {
  if (
    !isRecord(value) ||
    !isRecord(value.providerPreflight) ||
    !isRecord(value.providerFree) ||
    !isRecord(value.providerReplay)
  ) {
    return false;
  }
  return [
    value.attemptSentinel,
    value.manifest,
    value.protocolInput,
    value.providerPreflight.receipt,
    value.providerPreflight.tape,
    value.providerFree.c1Baseline,
    value.providerFree.c1BaselineReceipt,
    value.providerFree.c1Candidate,
    value.providerFree.c1CandidateReceipt,
    value.providerFree.c40Baseline,
    value.providerFree.c40BaselineReceipt,
    value.providerFree.c40Candidate,
    value.providerFree.c40CandidateReceipt,
    value.providerReplay.baselineDiscoveryReceipt,
    value.providerReplay.baselineFormalOfficial,
    value.providerReplay.baselineFormalProgress,
    value.providerReplay.baselineFormalReport,
    value.providerReplay.baselineFormalReceipt,
    value.providerReplay.candidateDiscoveryReceipt,
    value.providerReplay.candidateFormalOfficial,
    value.providerReplay.candidateFormalProgress,
    value.providerReplay.candidateFormalReport,
    value.providerReplay.candidateFormalReceipt,
    value.providerReplay.tape,
    value.scenarioReceipt,
  ].every(isArtifactIdentity);
}

function lifecycleArtifactIdentities(value: unknown): ArtifactIdentityShape[] {
  if (!hasLifecycleArtifactIdentities(value) || !isRecord(value)) {
    return [];
  }
  const providerPreflight = value.providerPreflight as Record<string, unknown>;
  const providerFree = value.providerFree as Record<string, unknown>;
  const providerReplay = value.providerReplay as Record<string, unknown>;
  return [
    value.attemptSentinel,
    value.manifest,
    value.protocolInput,
    providerPreflight.receipt,
    providerPreflight.tape,
    providerFree.c1Baseline,
    providerFree.c1BaselineReceipt,
    providerFree.c1Candidate,
    providerFree.c1CandidateReceipt,
    providerFree.c40Baseline,
    providerFree.c40BaselineReceipt,
    providerFree.c40Candidate,
    providerFree.c40CandidateReceipt,
    providerReplay.baselineDiscoveryReceipt,
    providerReplay.baselineFormalOfficial,
    providerReplay.baselineFormalProgress,
    providerReplay.baselineFormalReport,
    providerReplay.baselineFormalReceipt,
    providerReplay.candidateDiscoveryReceipt,
    providerReplay.candidateFormalOfficial,
    providerReplay.candidateFormalProgress,
    providerReplay.candidateFormalReport,
    providerReplay.candidateFormalReceipt,
    providerReplay.tape,
    value.scenarioReceipt,
  ].filter(isArtifactIdentity);
}

function providerRequestSequence(
  value: unknown,
): ProviderTapeRequestIdentity[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const sequence: ProviderTapeRequestIdentity[] = [];
  for (const item of value) {
    if (
      !isRecord(item) ||
      typeof item.canonicalBodySha256 !== "string" ||
      !SHA256_PATTERN.test(item.canonicalBodySha256) ||
      typeof item.fingerprint !== "string" ||
      !SHA256_PATTERN.test(item.fingerprint) ||
      typeof item.method !== "string" ||
      item.method !== item.method.toUpperCase() ||
      typeof item.path !== "string" ||
      item.path.length === 0 ||
      typeof item.semanticHeadersSha256 !== "string" ||
      !SHA256_PATTERN.test(item.semanticHeadersSha256) ||
      typeof item.targetId !== "string" ||
      item.targetId.length === 0
    ) {
      return null;
    }
    const identity = item as unknown as ProviderTapeRequestIdentity;
    if (fingerprintProviderRequestIdentity(identity) !== identity.fingerprint) {
      return null;
    }
    sequence.push({ ...identity });
  }
  return sequence;
}

function isProviderReplaySession(value: unknown, mode: "prefetch" | "replay"): boolean {
  if (
    !isRecord(value) ||
    value.mode !== mode ||
    typeof value.requests !== "number" ||
    !Number.isSafeInteger(value.requests) ||
    value.requests <= 0 ||
    typeof value.hits !== "number" ||
    !Number.isSafeInteger(value.hits) ||
    value.hits < 0 ||
    typeof value.misses !== "number" ||
    !Number.isSafeInteger(value.misses) ||
    value.misses < 0 ||
    typeof value.liveRequests !== "number" ||
    !Number.isSafeInteger(value.liveRequests) ||
    value.liveRequests < 0 ||
    typeof value.coalesced !== "number" ||
    !Number.isSafeInteger(value.coalesced) ||
    value.coalesced < 0 ||
    typeof value.non2xxResponses !== "number" ||
    !Number.isSafeInteger(value.non2xxResponses) ||
    value.non2xxResponses < 0 ||
    typeof value.requestFingerprintMultisetSha256 !== "string" ||
    !SHA256_PATTERN.test(value.requestFingerprintMultisetSha256) ||
    typeof value.requestSequenceSha256 !== "string" ||
    !SHA256_PATTERN.test(value.requestSequenceSha256) ||
    typeof value.sequenceMismatches !== "number" ||
    !Number.isSafeInteger(value.sequenceMismatches) ||
    value.sequenceMismatches < 0 ||
    typeof value.tapeSha256 !== "string" ||
    !SHA256_PATTERN.test(value.tapeSha256) ||
    typeof value.transportAttemptLedgerSha256 !== "string" ||
    !SHA256_PATTERN.test(value.transportAttemptLedgerSha256) ||
    typeof value.transportAttempts !== "number" ||
    !Number.isSafeInteger(value.transportAttempts) ||
    value.transportAttempts < 0 ||
    typeof value.transportErrors !== "number" ||
    !Number.isSafeInteger(value.transportErrors) ||
    value.transportErrors < 0 ||
    !isRecord(value.targetCounts)
  ) {
    return false;
  }
  const targetCounts = value.targetCounts;
  const validCensus =
    JSON.stringify(Object.keys(targetCounts).sort()) ===
      JSON.stringify(["embedding", "eval", "judge"]) &&
    Object.values(targetCounts).every(
      (count) => typeof count === "number" && Number.isSafeInteger(count) && count > 0,
    ) &&
    Object.values(targetCounts).reduce<number>(
      (sum, count) => sum + Number(count),
      0,
    ) ===
      value.requests &&
    value.hits + value.misses + value.coalesced + value.sequenceMismatches ===
      value.requests;
  return Boolean(
    validCensus &&
    (mode === "prefetch"
      ? value.coalesced === 0 &&
        value.liveRequests === value.misses &&
        value.sequenceMismatches === 0 &&
        value.transportAttempts === value.liveRequests &&
        value.transportErrors <= value.transportAttempts &&
        value.non2xxResponses <=
          value.transportAttempts - value.transportErrors
      : value.hits === value.requests &&
        value.misses === 0 &&
        value.liveRequests === 0 &&
        value.coalesced === 0 &&
        value.non2xxResponses === 0 &&
        value.sequenceMismatches === 0 &&
        value.transportAttempts === 0 &&
        value.transportErrors === 0 &&
        value.transportAttemptLedgerSha256 ===
          EMPTY_TRANSPORT_LEDGER_SHA256)
  );
}

export function evaluateV073LifecycleProtectionArtifact(input: {
  artifact: unknown;
  artifactPath: string;
}): V07ReleaseReadinessCheck {
  const issues: string[] = [];
  if (!isRecord(input.artifact)) {
    issues.push("artifact must be a JSON object");
  } else {
    const artifacts = input.artifact.artifacts;
    const hardGate = input.artifact.hardGate;
    const providerReplay = input.artifact.providerReplay;
    const liveDiagnostic = input.artifact.liveDiagnostic;
    if (input.artifact.schemaVersion !== 9) {
      issues.push("schemaVersion must be 9");
    }
    if (
      input.artifact.generatedBy !==
        "scripts/run-v0-7-3-replacement-protection-gate.ts"
    ) {
      issues.push("generatedBy must identify the lifecycle protection gate");
    }
    if (input.artifact.baselineCommit !== V072_BASELINE_COMMIT) {
      issues.push("baseline commit must match v0.7.2");
    }
    if (
      typeof input.artifact.candidateCommit !== "string" ||
      !COMMIT_PATTERN.test(input.artifact.candidateCommit)
    ) {
      issues.push("artifact candidate commit must be a full SHA");
    }
    if (input.artifact.candidatePromptSha256 !== deriveV073PromptSha256()) {
      issues.push("artifact candidate prompt must match the frozen default prompt");
    }
    if (
      input.artifact.releaseAllowed !== true ||
      !Array.isArray(input.artifact.blockers) ||
      input.artifact.blockers.length !== 0
    ) {
      issues.push("lifecycle protection gate did not pass without blockers");
    }
    if (input.artifact.fullClaimRerunRequired !== true) {
      issues.push("artifact must retain the full-claim rerun boundary");
    }
    try {
      assertV073ProviderPreflightReceipt(input.artifact.providerPreflight);
    } catch (error) {
      issues.push(
        error instanceof Error
          ? error.message
          : "provider availability preflight is invalid",
      );
    }
    if (
      typeof input.artifact.claimBoundary !== "string" ||
      !input.artifact.claimBoundary.includes("provider-variance")
    ) {
      issues.push("artifact must retain the provider-variance claim boundary");
    }
    if (!hasLifecycleArtifactIdentities(artifacts)) {
      issues.push("source artifact identities must contain paths and hashes");
    } else if (
      lifecycleArtifactIdentities(artifacts).some(
        ({ path }) =>
          !path.startsWith(V073_LIFECYCLE_EVIDENCE_PREFIX) &&
          path !== V073_LIFECYCLE_ATTEMPT_SENTINEL,
      )
    ) {
      issues.push("all source artifacts must live in the tracked lifecycle evidence bundle");
    }
    if (
      !isRecord(hardGate) ||
      !Array.isArray(hardGate.providerFree) ||
      JSON.stringify(
        hardGate.providerFree.map((arm) =>
          isRecord(arm) ? arm.concurrency : null
        ),
      ) !== JSON.stringify([1, 40]) ||
      !isRecord(hardGate.scenarioReplay) ||
      hardGate.scenarioReplay.failures !== 0 ||
      typeof hardGate.scenarioReplay.passed !== "number" ||
      !Number.isSafeInteger(hardGate.scenarioReplay.passed) ||
      hardGate.scenarioReplay.passed < 1
    ) {
      issues.push("deterministic hard gates must contain C1, C40, and a clean scenario replay");
    }
    if (
      !isRecord(providerReplay) ||
      providerReplay.concurrency !== 1 ||
      !isRecord(providerReplay.discovery) ||
      !isRecord(providerReplay.formal) ||
      !isProviderReplaySession(providerReplay.discovery.baseline, "prefetch") ||
      !isProviderReplaySession(providerReplay.discovery.candidate, "prefetch") ||
      !isProviderReplaySession(providerReplay.formal.baseline, "replay") ||
      !isProviderReplaySession(providerReplay.formal.candidate, "replay") ||
      !isRecord(providerReplay.formal.baseline) ||
      !isRecord(providerReplay.formal.candidate) ||
      providerReplay.formal.baseline.misses !== 0 ||
      providerReplay.formal.baseline.liveRequests !== 0 ||
      providerReplay.formal.candidate.misses !== 0 ||
      providerReplay.formal.candidate.liveRequests !== 0 ||
      providerReplay.formal.baseline.sequenceMismatches !== 0 ||
      providerReplay.formal.candidate.sequenceMismatches !== 0 ||
      providerReplay.formal.baseline.tapeSha256 !== providerReplay.tapeSha256 ||
      providerReplay.formal.candidate.tapeSha256 !== providerReplay.tapeSha256 ||
      !isRecord(providerReplay.discovery.baseline) ||
      !isRecord(providerReplay.discovery.candidate) ||
      providerReplay.formal.baseline.requestSequenceSha256 !==
        providerReplay.discovery.baseline.requestSequenceSha256 ||
      providerReplay.formal.candidate.requestSequenceSha256 !==
        providerReplay.discovery.candidate.requestSequenceSha256
    ) {
      issues.push(
        "formal provider replay must use deterministic concurrency, exactly replay frozen inputs, and remain fully tape-backed",
      );
    }
    if (
      !isRecord(liveDiagnostic) ||
      !isRecord(liveDiagnostic.signTest) ||
      liveDiagnostic.signTest.test !== "exact_two_sided_sign_test" ||
      liveDiagnostic.signTest.alpha !== 0.05 ||
      typeof liveDiagnostic.signTest.pValue !== "number" ||
      liveDiagnostic.signTest.pValue < 0 ||
      liveDiagnostic.signTest.pValue > 1 ||
      liveDiagnostic.signTest.significant !==
        (liveDiagnostic.signTest.pValue < 0.05)
    ) {
      issues.push("live diagnostic must contain the preregistered paired sign test");
    }
  }

  return {
    detail: issues.length === 0
      ? `completed paired protection evidence at ${input.artifactPath} is bound to candidate commit ${
        isRecord(input.artifact) ? String(input.artifact.candidateCommit) : "<invalid>"
      }`
      : issues.join("; "),
    durationMs: 0,
    id: "v0.7.3-lifecycle-protection",
    required: true,
    status: issues.length === 0 ? "pass" : "fail",
    title: "v0.7.3 paired lifecycle protection evidence",
  };
}

function lifecycleIdentity(
  artifacts: Record<string, unknown>,
  group: "providerFree" | "providerPreflight" | "providerReplay" | null,
  name: string,
): ArtifactIdentityShape {
  const parent = group === null ? artifacts : artifacts[group];
  if (!isRecord(parent) || !isArtifactIdentity(parent[name])) {
    throw new Error(`lifecycle evidence identity ${group ?? "root"}.${name} is missing`);
  }
  return parent[name];
}

async function readBoundLifecycleArtifactBytes(input: {
  identity: ArtifactIdentityShape;
  repoRoot: string;
}): Promise<Buffer> {
  const isAttemptSentinel =
    input.identity.path === V073_LIFECYCLE_ATTEMPT_SENTINEL;
  if (
    !isAttemptSentinel &&
    !input.identity.path.startsWith(V073_LIFECYCLE_EVIDENCE_PREFIX)
  ) {
    throw new Error(`lifecycle evidence path is outside the tracked bundle: ${input.identity.path}`);
  }
  const absolutePath = resolve(input.repoRoot, input.identity.path);
  const bundleRoot = resolve(input.repoRoot, V073_LIFECYCLE_EVIDENCE_PREFIX);
  if (!isAttemptSentinel && !absolutePath.startsWith(`${bundleRoot}/`)) {
    throw new Error(`lifecycle evidence path escapes its bundle: ${input.identity.path}`);
  }
  if (!(await lstat(absolutePath)).isFile()) {
    throw new Error(`lifecycle evidence path must be a regular file: ${input.identity.path}`);
  }
  const expectedRealPath = resolve(await realpath(input.repoRoot), input.identity.path);
  if (await realpath(absolutePath) !== expectedRealPath) {
    throw new Error(`lifecycle evidence real path is outside the tracked bundle: ${input.identity.path}`);
  }
  const raw = await readFile(absolutePath);
  const fingerprint = createHash("sha256").update(raw).digest("hex");
  if (
    raw.byteLength !== input.identity.bytes ||
    fingerprint !== input.identity.sha256
  ) {
    throw new Error(`lifecycle evidence bytes do not match ${input.identity.path}`);
  }
  return raw;
}

async function readBoundLifecycleArtifact(input: {
  identity: ArtifactIdentityShape;
  repoRoot: string;
}): Promise<string> {
  return (await readBoundLifecycleArtifactBytes(input)).toString("utf8");
}

async function readProviderResponseTapeBundleArtifact(input: {
  identity: ArtifactIdentityShape;
  manifestRaw: string;
  repoRoot: string;
}): Promise<ReturnType<typeof decodeProviderResponseTapeBundle>> {
  const expectedManifestPath =
    `${V073_LIFECYCLE_EVIDENCE_PREFIX}provider-response-tape/manifest.json`;
  if (input.identity.path !== expectedManifestPath) {
    throw new Error("provider response tape bundle manifest path is invalid");
  }
  const manifest = parseProviderResponseTapeBundleManifest(input.manifestRaw);
  const root = dirname(input.identity.path);
  const absoluteRoot = resolve(input.repoRoot, root);
  if (!(await lstat(absoluteRoot)).isDirectory()) {
    throw new Error("provider response tape bundle root must be a directory");
  }
  const expectedRealRoot = resolve(await realpath(input.repoRoot), root);
  if (await realpath(absoluteRoot) !== expectedRealRoot) {
    throw new Error("provider response tape bundle real path is outside the tracked bundle");
  }
  const entries = await readdir(absoluteRoot, { withFileTypes: true });
  const expectedNames = ["manifest.json", ...manifest.parts.map(({ path }) => path)]
    .sort();
  if (
    JSON.stringify(entries.map(({ name }) => name).sort()) !==
      JSON.stringify(expectedNames)
  ) {
    throw new Error("provider response tape bundle directory closure is invalid");
  }
  if (entries.some((entry) => !entry.isFile())) {
    throw new Error("provider response tape bundle entries must be regular files");
  }
  const parts = new Map<string, Uint8Array>();
  for (const part of manifest.parts) {
    parts.set(part.path, await readBoundLifecycleArtifactBytes({
      identity: {
        bytes: part.bytes,
        path: join(root, part.path),
        sha256: part.sha256,
      },
      repoRoot: input.repoRoot,
    }));
  }
  return decodeProviderResponseTapeBundle({
    manifestRaw: input.manifestRaw,
    parts,
  });
}

function fingerprintProviderRequestMultiset(
  sequence: readonly ProviderTapeRequestIdentity[],
): string {
  const counts = new Map<string, number>();
  for (const { fingerprint } of sequence) {
    counts.set(fingerprint, (counts.get(fingerprint) ?? 0) + 1);
  }
  return sha256(JSON.stringify([...counts.entries()].sort(([left], [right]) =>
    left.localeCompare(right)
  )));
}

function providerPreflightChoiceText(payload: unknown): string {
  if (!isRecord(payload) || !Array.isArray(payload.choices)) {
    return "";
  }
  return payload.choices.map((choice) => {
    if (!isRecord(choice)) {
      return "";
    }
    const source = isRecord(choice.delta)
      ? choice.delta
      : isRecord(choice.message)
        ? choice.message
        : choice;
    const content = source.content ?? source.text;
    if (typeof content === "string") {
      return content;
    }
    return Array.isArray(content)
      ? content.map((part) =>
        isRecord(part) && typeof part.text === "string" ? part.text : ""
      ).join("")
      : "";
  }).join("");
}

function providerPreflightMessageContent(
  bodyBase64: string,
  contentType: string | null,
): string {
  const body = Buffer.from(bodyBase64, "base64").toString("utf8");
  let content = "";
  if (contentType?.toLowerCase().includes("text/event-stream")) {
    let sawDone = false;
    for (const event of body.replace(/\r\n/gu, "\n").split("\n\n")) {
      const data = event
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n")
        .trim();
      if (!data) {
        continue;
      }
      if (data === "[DONE]") {
        sawDone = true;
        break;
      }
      content += providerPreflightChoiceText(JSON.parse(data) as unknown);
    }
    if (!sawDone) {
      throw new Error("provider preflight chat stream is incomplete");
    }
  } else {
    content = providerPreflightChoiceText(JSON.parse(body) as unknown);
  }
  if (content.trim().length === 0) {
    throw new Error("provider preflight chat response is invalid");
  }
  return content;
}

function assertProviderPreflightTapeResponses(
  tape: ReturnType<typeof parseProviderResponseTape>,
): void {
  assertProviderResponseTapeCoversSequences(tape, [
    V073_PROVIDER_PREFLIGHT_POLICY.expectedRequestSequence,
  ]);
  if (
    tape.entries.length !== 5 ||
    tape.entries.some((entry) => entry.response.status !== 200)
  ) {
    throw new Error("provider preflight tape does not match the frozen request plan");
  }
  for (const entry of tape.entries) {
    if (entry.request.targetId === "embedding") {
      const payload = JSON.parse(
        Buffer.from(entry.response.bodyBase64, "base64").toString("utf8"),
      ) as unknown;
      const data = isRecord(payload) ? payload.data : undefined;
      const first = Array.isArray(data) ? data[0] : undefined;
      const embedding = isRecord(first) ? first.embedding : undefined;
      if (
        !Array.isArray(embedding) ||
        embedding.length === 0 ||
        embedding.some((value) =>
          typeof value !== "number" || !Number.isFinite(value)
        )
      ) {
        throw new Error("provider preflight embedding response is invalid");
      }
      continue;
    }
    const content = providerPreflightMessageContent(
      entry.response.bodyBase64,
      entry.response.contentType,
    );
    if (entry.request.targetId === "eval") {
      const normalizedContent = stripThinkingBlocks(content);
      const start = normalizedContent.indexOf("{");
      const end = normalizedContent.lastIndexOf("}");
      const structured = start >= 0 && end >= start
        ? JSON.parse(normalizedContent.slice(start, end + 1)) as unknown
        : null;
      const orderedCandidateIds = isRecord(structured)
        ? structured.orderedCandidateIds
        : undefined;
      const normalizedCandidateIds = Array.isArray(orderedCandidateIds) &&
          orderedCandidateIds.every((value) => typeof value === "string")
        ? [...new Set(
            orderedCandidateIds
              .map((value) => value.trim())
              .filter(Boolean),
          )]
        : [];
      if (
        normalizedCandidateIds.length === 0 ||
        normalizedCandidateIds.some((candidateId) =>
          candidateId !== "candidate-1" && candidateId !== "candidate-2"
        )
      ) {
        throw new Error("provider preflight listwise response is invalid");
      }
    }
  }
}

function assertProviderPreflightEvidence(input: {
  artifacts: Record<string, unknown>;
  attemptSentinelRaw: string;
  manifest: Record<string, unknown>;
  protocolInput: V073ReplacementProtectionInput;
  receiptRaw: string;
  tapeRaw: string;
}): void {
  const receipt = JSON.parse(input.receiptRaw) as unknown;
  const attemptSentinel = JSON.parse(input.attemptSentinelRaw) as unknown;
  if (!isRecord(receipt) || !isRecord(receipt.session)) {
    throw new Error("provider preflight receipt is invalid");
  }
  assertV073ProviderPreflightReceipt(receipt.probePlan);
  if (
    !sameJson(receipt.probePlan, input.protocolInput.providerPreflight) ||
    receipt.generatedBy !==
      "scripts/run-v0-7-3-replacement-protection-gate.ts"
  ) {
    throw new Error("provider preflight receipt does not match protocol input");
  }
  const session = receipt.session;
  const sequence = providerRequestSequence(session.requestSequence);
  const ledger = Array.isArray(session.transportAttemptLedger)
    ? session.transportAttemptLedger as ProviderTapeTransportAttempt[]
    : null;
  const expectedLedger = V073_PROVIDER_PREFLIGHT_POLICY.expectedRequestSequence.map(
    ({ fingerprint, targetId }, requestIndex) => ({
      fingerprint,
      outcome: "response" as const,
      requestIndex,
      responseStatus: 200,
      targetId,
    }),
  );
  if (
    sequence === null ||
    ledger === null ||
    !isProviderReplaySession(session, "prefetch") ||
    session.requests !== 5 ||
    session.hits !== 0 ||
    session.misses !== 5 ||
    session.liveRequests !== 5 ||
    session.coalesced !== 0 ||
    session.non2xxResponses !== 0 ||
    session.sequenceMismatches !== 0 ||
    session.transportAttempts !== 5 ||
    session.transportErrors !== 0 ||
    !sameJson(session.targetCounts, { embedding: 1, eval: 3, judge: 1 }) ||
    !sameJson(sequence, V073_PROVIDER_PREFLIGHT_POLICY.expectedRequestSequence) ||
    fingerprintProviderRequestSequence(sequence) !==
      V073_PROVIDER_PREFLIGHT_POLICY.expectedRequestSequenceSha256 ||
    session.requestSequenceSha256 !==
      V073_PROVIDER_PREFLIGHT_POLICY.expectedRequestSequenceSha256 ||
    session.requestFingerprintMultisetSha256 !==
      fingerprintProviderRequestMultiset(sequence) ||
    !sameJson(ledger, expectedLedger) ||
    session.transportAttemptLedgerSha256 !==
      fingerprintProviderTransportAttemptLedger(ledger)
  ) {
    throw new Error("provider preflight request or transport evidence is invalid");
  }
  const tape = parseProviderResponseTape(input.tapeRaw);
  assertProviderPreflightTapeResponses(tape);
  const tapeSha256 = sha256(input.tapeRaw);
  const receiptIdentity = lifecycleIdentity(
    input.artifacts,
    "providerPreflight",
    "receipt",
  );
  const tapeIdentity = lifecycleIdentity(
    input.artifacts,
    "providerPreflight",
    "tape",
  );
  const manifestPreflight = input.manifest.providerPreflight;
  const manifestFormalAttempt = input.manifest.formalAttempt;
  const manifestStoragePreflight = input.manifest.storagePreflight;
  const attemptSentinelIdentity = lifecycleIdentity(
    input.artifacts,
    null,
    "attemptSentinel",
  );
  if (
    session.tapeSha256 !== tapeSha256 ||
    !isArtifactIdentity(receipt.tape) ||
    !sameJson(receipt.tape, tapeIdentity) ||
    !isRecord(manifestPreflight) ||
    !sameJson(manifestPreflight.receipt, receiptIdentity) ||
    !sameJson(manifestPreflight.tape, tapeIdentity) ||
    !sameJson(manifestPreflight.summary, input.protocolInput.providerPreflight) ||
    !isRecord(manifestFormalAttempt) ||
    !sameJson(manifestFormalAttempt.sentinel, attemptSentinelIdentity) ||
    !isRecord(manifestStoragePreflight) ||
    !isRecord(attemptSentinel) ||
    attemptSentinel.generatedBy !==
      "scripts/run-v0-7-3-replacement-protection-gate.ts" ||
    attemptSentinel.schemaVersion !== 9 ||
    attemptSentinel.state !== "consumed" ||
    attemptSentinel.baselineCommit !== input.protocolInput.baselineCommit ||
    attemptSentinel.candidateCommit !== input.protocolInput.candidateCommit ||
    attemptSentinel.requestSequenceSha256 !==
      V073_PROVIDER_PREFLIGHT_POLICY.expectedRequestSequenceSha256 ||
    !isRecord(attemptSentinel.storagePreflight) ||
    !sameJson(attemptSentinel.storagePreflight, manifestStoragePreflight) ||
    manifestStoragePreflight.minimumAvailableBytes !==
      V073_SCHEMA9_STORAGE_PREFLIGHT_POLICY.minimumAvailableBytes ||
    typeof manifestStoragePreflight.availableBytes !== "number" ||
    !Number.isSafeInteger(manifestStoragePreflight.availableBytes) ||
    manifestStoragePreflight.availableBytes <
      V073_SCHEMA9_STORAGE_PREFLIGHT_POLICY.minimumAvailableBytes ||
    manifestStoragePreflight.path !== "reports/release/v0.7" ||
    !sameJson(
      attemptSentinel.providerPreflight,
      input.protocolInput.providerPreflight,
    )
  ) {
    throw new Error("provider preflight artifacts are not independently bound");
  }
}

export async function evaluateV073LifecycleProtectionBundle(input: {
  artifact: Record<string, unknown>;
  artifactPath: string;
  repoRoot: string;
}): Promise<V07ReleaseReadinessCheck> {
  const startedAt = performance.now();
  try {
    if (!isRecord(input.artifact.artifacts)) {
      throw new Error("lifecycle artifact source map is missing");
    }
    const artifacts = input.artifact.artifacts;
    const read = (
      group: "providerFree" | "providerPreflight" | "providerReplay" | null,
      name: string,
    ) =>
      readBoundLifecycleArtifact({
        identity: lifecycleIdentity(artifacts, group, name),
        repoRoot: input.repoRoot,
      });
    const [
      attemptSentinelRaw,
      manifestRaw,
      protocolInputRaw,
      providerPreflightReceiptRaw,
      providerPreflightTapeRaw,
      c1BaselineRaw,
      c1BaselineReceiptRaw,
      c1CandidateRaw,
      c1CandidateReceiptRaw,
      c40BaselineRaw,
      c40BaselineReceiptRaw,
      c40CandidateRaw,
      c40CandidateReceiptRaw,
      baselineDiscoveryReceiptRaw,
      baselineFormalOfficialRaw,
      baselineFormalProgressRaw,
      baselineFormalReportRaw,
      baselineFormalReceiptRaw,
      candidateDiscoveryReceiptRaw,
      candidateFormalOfficialRaw,
      candidateFormalProgressRaw,
      candidateFormalReportRaw,
      candidateFormalReceiptRaw,
      tapeManifestRaw,
      scenarioReceiptRaw,
    ] = await Promise.all([
      read(null, "attemptSentinel"),
      read(null, "manifest"),
      read(null, "protocolInput"),
      read("providerPreflight", "receipt"),
      read("providerPreflight", "tape"),
      read("providerFree", "c1Baseline"),
      read("providerFree", "c1BaselineReceipt"),
      read("providerFree", "c1Candidate"),
      read("providerFree", "c1CandidateReceipt"),
      read("providerFree", "c40Baseline"),
      read("providerFree", "c40BaselineReceipt"),
      read("providerFree", "c40Candidate"),
      read("providerFree", "c40CandidateReceipt"),
      read("providerReplay", "baselineDiscoveryReceipt"),
      read("providerReplay", "baselineFormalOfficial"),
      read("providerReplay", "baselineFormalProgress"),
      read("providerReplay", "baselineFormalReport"),
      read("providerReplay", "baselineFormalReceipt"),
      read("providerReplay", "candidateDiscoveryReceipt"),
      read("providerReplay", "candidateFormalOfficial"),
      read("providerReplay", "candidateFormalProgress"),
      read("providerReplay", "candidateFormalReport"),
      read("providerReplay", "candidateFormalReceipt"),
      read("providerReplay", "tape"),
      read(null, "scenarioReceipt"),
    ]);
    const protocolInput = JSON.parse(
      protocolInputRaw,
    ) as V073ReplacementProtectionInput;
    const tapeBundle = await readProviderResponseTapeBundleArtifact({
      identity: lifecycleIdentity(artifacts, "providerReplay", "tape"),
      manifestRaw: tapeManifestRaw,
      repoRoot: input.repoRoot,
    });
    const tapeRaw = tapeBundle.raw;
    const tape = tapeBundle.tape;
    const manifest = JSON.parse(manifestRaw) as Record<string, unknown>;
    const measurementEvidenceRoot = manifest.measurementEvidenceRoot;
    assertV073MeasurementEvidenceRoot(measurementEvidenceRoot);
    const scenarioReceipt = JSON.parse(
      scenarioReceiptRaw,
    ) as Record<string, unknown>;
    assertProviderPreflightEvidence({
      artifacts,
      attemptSentinelRaw,
      manifest,
      protocolInput,
      receiptRaw: providerPreflightReceiptRaw,
      tapeRaw: providerPreflightTapeRaw,
    });
    const expectedProviders = {
      assisted: {
        gateway: "https://ai.gurkiai.com/v1",
        model: "gpt-5.6-terra",
        provider: "openai",
      },
      embedding: {
        gateway: "https://openrouter.ai/api/v1",
        model: "text-embedding-3-small",
        provider: "openai",
      },
      eval: {
        gateway: "https://ai.gurkiai.com/v1",
        model: "gpt-5.6-terra",
        provider: "openai",
      },
      judge: {
        gateway: "https://ai.gurkiai.com/v1",
        model: "gpt-5.5",
        provider: "openai",
      },
      reranking: {
        gateway: "https://ai.gurkiai.com/v1",
        model: "gpt-5.6-terra",
        provider: "openai",
      },
    };
    const harness = manifest.measurementHarness;
    const protocol = manifest.protocol;
    const currentClaimRecipeRaw = await readFile(
      resolve(input.repoRoot, "benchmark-claims/locomo.json"),
      "utf8",
    );
    const validHarness = isRecord(harness) &&
      isRecord(harness.claimRecipe) &&
      isRecord(harness.officialRunner) &&
      isRecord(harness.reanswerRunner) &&
      isRecord(harness.seedRunner) &&
      [
        [harness.claimRecipe, "benchmark-claims/locomo.json"],
        [harness.officialRunner, "scripts/rescore-official-protocols.ts"],
        [harness.reanswerRunner, "scripts/reanswer-phase-65-locomo-report.ts"],
        [harness.seedRunner, "scripts/run-phase-65-locomo-smoke.ts"],
      ].every(([identity, path]) =>
        isRecord(identity) &&
        identity.path === path &&
        typeof identity.bytes === "number" &&
        Number.isSafeInteger(identity.bytes) &&
        identity.bytes > 0 &&
        typeof identity.sha256 === "string" &&
        SHA256_PATTERN.test(identity.sha256)
      );
    if (
      !isRecord(manifest.baseline) ||
      !isRecord(manifest.candidate) ||
      !isRecord(manifest.benchmark) ||
      typeof manifest.benchmark.root !== "string" ||
      manifest.benchmark.bytes !== 2_490_457 ||
      manifest.benchmark.fingerprint !==
        "240ba2526911a5f965a285b88794c4d3b938b59be5aecd846cc472ee733357fd" ||
      manifest.benchmark.sha256 !==
        "e442118810a1c57ee0b5454d12583c27be244936350dcfff1d6102d29cc39c28" ||
      manifest.schemaVersion !== 9 ||
      manifest.generatedBy !==
        "scripts/run-v0-7-3-replacement-protection-gate.ts" ||
      !sameJson(manifest.providers, expectedProviders) ||
      !validHarness ||
      !isRecord(protocol) ||
      protocol.assistedExtractionMaxAttempts !==
        V073_ASSISTED_EXTRACTION_POLICY.maxAttempts ||
      protocol.assistedExtractionRequestTimeoutMs !==
        V073_ASSISTED_EXTRACTION_POLICY.requestTimeoutMs ||
      protocol.failureTapeCredentialMaterial !==
        "excluded-before-persistence" ||
      protocol.failedDiscoveryTape !== "atomic-before-stage-error" ||
      protocol.formalNetworkOnMiss !== false ||
      protocol.hardRegressionLimit !== 0.01 ||
      protocol.promptSha256 !== deriveV073PromptSha256() ||
      protocol.providerFailureRecovery !==
        "immediate-same-fingerprint-retry-to-2xx" ||
      protocol.providerPreflightFormalAttemptBoundary !==
        "schema9-consumed-sentinel-created-only-after-success" ||
      !sameJson(
        protocol.providerPreflightProbeOrder,
        V073_PROVIDER_PREFLIGHT_POLICY.probeOrder,
      ) ||
      protocol.providerPreflightRequestTimeoutMs !==
        V073_PROVIDER_PREFLIGHT_POLICY.requestTimeoutMs ||
      protocol.providerPreflightRequestSequenceSha256 !==
        V073_PROVIDER_PREFLIGHT_POLICY.expectedRequestSequenceSha256 ||
      protocol.providerPreflightRetries !== 0 ||
      !sameJson(protocol.providerFreeConcurrency, [1, 40]) ||
      protocol.providerLogCredentialMaterial !==
        "redacted-before-output-hash-and-persistence" ||
      protocol.providerReplayConcurrency !== 1 ||
      protocolInput.providerReplay.concurrency !== 1 ||
      protocol.semanticSeedRunId !== V073_SEMANTIC_SEED_RUN_ID ||
      protocol.signTestAlpha !== 0.05 ||
      protocol.storagePreflightMinimumAvailableBytes !==
        V073_SCHEMA9_STORAGE_PREFLIGHT_POLICY.minimumAvailableBytes ||
      protocol.tapeInputIdentity !==
        "ordered request fingerprint + logical target + method + path/query + canonical-body digest + semantic-header digest" ||
      protocol.tapeArtifactEncoding !== "canonical-json-sharded-gzip" ||
      protocol.tapeMaxPartBytes !==
        PROVIDER_RESPONSE_TAPE_BUNDLE_POLICY.maxPartBytes ||
      protocol.tapeMaxParts !==
        PROVIDER_RESPONSE_TAPE_BUNDLE_POLICY.maxParts ||
      protocol.tapeMaxRawBytes !==
        PROVIDER_RESPONSE_TAPE_BUNDLE_POLICY.maxRawBytes ||
      protocol.tapeMaxTotalBytes !==
        PROVIDER_RESPONSE_TAPE_BUNDLE_POLICY.maxTotalBytes ||
      protocol.tapePartUncompressedBytes !==
        PROVIDER_RESPONSE_TAPE_BUNDLE_POLICY.partUncompressedBytes ||
      protocol.tapeRequestIdentity !==
        "sha256(logical-target + method + path/query + canonical-json-body + semantic-headers)" ||
      protocol.tapeResponseVariants !== "ordered-per-fingerprint" ||
      protocol.tapeSequenceCoverage !==
        "exact-discovery-occurrence-union" ||
      protocol.transportAttemptLedger !== "hash-only-session-receipt" ||
      protocol.transportErrorResponseStatus !==
        V073_PROVIDER_TRANSPORT_POLICY.errorResponseStatus ||
      protocol.transportErrors !==
        V073_PROVIDER_TRANSPORT_POLICY.transportErrors ||
      protocol.transportProxyRetries !==
        V073_PROVIDER_TRANSPORT_POLICY.proxyRetries ||
      manifest.baseline.commit !== protocolInput.baselineCommit ||
      manifest.candidate.commit !== protocolInput.candidateCommit ||
      manifest.baseline.branch !== null ||
      manifest.candidate.branch !== null ||
      manifest.baseline.statusPorcelain !== "" ||
      manifest.candidate.statusPorcelain !== "" ||
      typeof manifest.baseline.worktreePath !== "string" ||
      typeof manifest.candidate.worktreePath !== "string" ||
      scenarioReceipt.candidateCommit !== protocolInput.candidateCommit ||
      scenarioReceipt.generatedBy !==
        "scripts/run-v0-7-3-replacement-protection-gate.ts" ||
      scenarioReceipt.command !== "bun" ||
      !sameJson(scenarioReceipt.args, ["test", "tests/scenarios"]) ||
      scenarioReceipt.cwd !== manifest.candidate.worktreePath ||
      scenarioReceipt.exitCode !== 0 ||
      scenarioReceipt.failures !== protocolInput.scenarioReplay.failures ||
      scenarioReceipt.passed !== protocolInput.scenarioReplay.passed
    ) {
      throw new Error("manifest or scenario receipt does not match protocol input");
    }
    const boundHarness = harness as Record<
      "claimRecipe" | "officialRunner" | "reanswerRunner" | "seedRunner",
      { bytes: number; path: string; sha256: string }
    >;
    const boundProtocol = protocol as {
      claimCommandTemplateSha256: string;
      promptSha256: string;
    };
    const gitProbe = await runCommand(
      "git",
      ["rev-parse", "--git-dir"],
      input.repoRoot,
    );
    let candidateGitObjectRaw: string | undefined;
    if (gitProbe.code === 0) {
      const candidateClaimRecipe = await runCommand(
        "git",
        [
          "show",
          `${protocolInput.candidateCommit}:${boundHarness.claimRecipe.path}`,
        ],
        input.repoRoot,
      );
      if (candidateClaimRecipe.code !== 0) {
        throw new Error(
          `cannot read measured candidate claim recipe from ${protocolInput.candidateCommit}`,
        );
      }
      candidateGitObjectRaw = candidateClaimRecipe.stdout;
    }
    const measuredClaimRecipeRaw = resolveV073MeasuredClaimRecipeRaw({
      candidateGitObjectRaw,
      currentClaimRecipeRaw,
      identity: boundHarness.claimRecipe,
    });
    if (
      boundProtocol.claimCommandTemplateSha256 !==
        deriveV073ClaimCommandTemplateSha256(measuredClaimRecipeRaw)
    ) {
      throw new Error("measured claim recipe command template drifted");
    }
    for (const [name, identity] of Object.entries(boundHarness)) {
      if (name === "claimRecipe" && candidateGitObjectRaw !== undefined) {
        continue;
      }
      const raw = await readFile(resolve(input.repoRoot, identity.path), "utf8");
      if (
        Buffer.byteLength(raw, "utf8") !== identity.bytes ||
        sha256(raw) !== identity.sha256
      ) {
        throw new Error(`measurement harness bytes drifted at ${identity.path}`);
      }
    }
    if (gitProbe.code === 0) {
      for (const commit of [
        protocolInput.baselineCommit,
        protocolInput.candidateCommit,
      ]) {
        for (const identity of Object.values(boundHarness)) {
          const source = await runCommand(
            "git",
            ["show", `${commit}:${identity.path}`],
            input.repoRoot,
          );
          if (
            source.code !== 0 ||
            Buffer.byteLength(source.stdout, "utf8") !== identity.bytes ||
            sha256(source.stdout) !== identity.sha256
          ) {
            throw new Error(
              `measurement harness does not match ${commit}:${identity.path}`,
            );
          }
        }
      }
    }
    const scenarioLogs: Record<"stderr" | "stdout", string> = {
      stderr: "",
      stdout: "",
    };
    for (const name of ["stdout", "stderr"] as const) {
      if (!isArtifactIdentity(scenarioReceipt[name])) {
        throw new Error(`scenario receipt ${name} identity is missing`);
      }
      scenarioLogs[name] = await readBoundLifecycleArtifact({
        identity: scenarioReceipt[name],
        repoRoot: input.repoRoot,
      });
    }
    const scenarioOutput = `${scenarioLogs.stdout}\n${scenarioLogs.stderr}`;
    const scenarioPassed = Number(
      scenarioOutput.match(/\b(\d+)\s+pass\b/u)?.[1] ?? -1,
    );
    const scenarioFailures = Number(
      scenarioOutput.match(/\b(\d+)\s+fail\b/u)?.[1] ?? -1,
    );
    if (
      scenarioPassed !== scenarioReceipt.passed ||
      scenarioFailures !== scenarioReceipt.failures
    ) {
      throw new Error("scenario receipt counts do not match its bound logs");
    }

    const providerFreeByConcurrency = new Map(
      protocolInput.deterministicArms.map((arm) => [arm.concurrency, arm]),
    );
    const providerFreeRaws = [
      [1, "baseline", c1BaselineRaw, c1BaselineReceiptRaw, "c1Baseline"],
      [1, "candidate", c1CandidateRaw, c1CandidateReceiptRaw, "c1Candidate"],
      [40, "baseline", c40BaselineRaw, c40BaselineReceiptRaw, "c40Baseline"],
      [40, "candidate", c40CandidateRaw, c40CandidateReceiptRaw, "c40Candidate"],
    ] as const;
    for (const [concurrency, side, raw, receiptRaw, artifactName] of providerFreeRaws) {
      const arm = providerFreeByConcurrency.get(concurrency);
      const parsedReport = parseV073ProviderFreeReport({
        benchmarkRoot: manifest.benchmark.root,
        concurrency,
        raw,
      });
      if (
        arm === undefined ||
        !sameJson(arm[side], parsedReport)
      ) {
        throw new Error(
          `provider-free concurrency ${concurrency} ${side} report is not bound`,
        );
      }
      const receipt = JSON.parse(receiptRaw) as Record<string, unknown>;
      const expectedCommit = side === "baseline"
        ? protocolInput.baselineCommit
        : protocolInput.candidateCommit;
      const expectedWorktree = side === "baseline"
        ? manifest.baseline.worktreePath
        : manifest.candidate.worktreePath;
      const runId = `v073-provider-free-c${concurrency}-${side}`;
      const reportIdentity = lifecycleIdentity(
        artifacts,
        "providerFree",
        artifactName,
      );
      if (
        receipt.generatedBy !==
          "scripts/run-v0-7-3-replacement-protection-gate.ts" ||
        receipt.command !== "bun" ||
        receipt.commit !== expectedCommit ||
        receipt.cwd !== expectedWorktree ||
        receipt.concurrency !== concurrency ||
        receipt.label !== side ||
        receipt.exitCode !== 0 ||
        !sameJson(receipt.args, buildV073ProviderFreeArgs({
          benchmarkRoot: manifest.benchmark.root,
          concurrency,
          outputDir: join(measurementEvidenceRoot, "provider-free"),
          runId,
        })) ||
        !isArtifactIdentity(receipt.report) ||
        !sameJson(receipt.report, reportIdentity)
      ) {
        throw new Error(
          `provider-free concurrency ${concurrency} ${side} receipt is invalid`,
        );
      }
      for (const name of ["stdout", "stderr"] as const) {
        if (!isArtifactIdentity(receipt[name])) {
          throw new Error(`provider-free receipt ${name} identity is missing`);
        }
        await readBoundLifecycleArtifact({
          identity: receipt[name],
          repoRoot: input.repoRoot,
        });
      }
    }

    const receiptSession = (raw: string): Record<string, unknown> => {
      const receipt = JSON.parse(raw) as Record<string, unknown>;
      if (!isRecord(receipt.session)) {
        throw new Error("provider replay receipt session is missing");
      }
      return receipt.session;
    };
    const comparableSession = (value: Record<string, unknown>) => ({
      coalesced: value.coalesced,
      hits: value.hits,
      liveRequests: value.liveRequests,
      misses: value.misses,
      mode: value.mode,
      non2xxResponses: value.non2xxResponses,
      requestFingerprintMultisetSha256:
        value.requestFingerprintMultisetSha256,
      requestSequenceSha256: value.requestSequenceSha256,
      requests: value.requests,
      sequenceMismatches: value.sequenceMismatches,
      targetCounts: value.targetCounts,
      tapeSha256: value.tapeSha256,
      transportAttemptLedgerSha256: value.transportAttemptLedgerSha256,
      transportAttempts: value.transportAttempts,
      transportErrors: value.transportErrors,
    });
    const observedSequences: ProviderTapeRequestIdentity[][] = [];
    for (const [raw, expected] of [
      [baselineDiscoveryReceiptRaw, protocolInput.providerReplay.discovery.baseline],
      [candidateDiscoveryReceiptRaw, protocolInput.providerReplay.discovery.candidate],
      [baselineFormalReceiptRaw, protocolInput.providerReplay.formal.baseline],
      [candidateFormalReceiptRaw, protocolInput.providerReplay.formal.candidate],
    ] as const) {
      const session = receiptSession(raw);
      const sequence = providerRequestSequence(session.requestSequence);
      const transportLedger = Array.isArray(session.transportAttemptLedger)
        ? session.transportAttemptLedger as ProviderTapeTransportAttempt[]
        : null;
      let transportLedgerSha256: string | null = null;
      if (transportLedger !== null) {
        try {
          transportLedgerSha256 = fingerprintProviderTransportAttemptLedger(
            transportLedger,
          );
        } catch {
          transportLedgerSha256 = null;
        }
      }
      if (
        sequence === null ||
        sequence.length !== session.requests ||
        !Array.isArray(session.sequenceMismatchDetails) ||
        session.sequenceMismatchDetails.length !== session.sequenceMismatches ||
        fingerprintProviderRequestSequence(sequence) !==
          session.requestSequenceSha256 ||
        transportLedger === null ||
        transportLedger.length !== session.transportAttempts ||
        transportLedger.filter((entry) => entry.outcome === "error").length !==
          session.transportErrors ||
        transportLedger.filter((entry) =>
          entry.outcome === "response" &&
          (entry.responseStatus < 200 || entry.responseStatus > 299)
        ).length !== session.non2xxResponses ||
        transportLedgerSha256 !== session.transportAttemptLedgerSha256 ||
        new Set(transportLedger.map((entry) => entry.requestIndex)).size !==
          transportLedger.length ||
        transportLedger.some((entry) =>
          entry.requestIndex >= sequence.length ||
          entry.fingerprint !== sequence[entry.requestIndex]!.fingerprint ||
          entry.targetId !== sequence[entry.requestIndex]!.targetId ||
          entry.outcome === "response" &&
            (entry.responseStatus < 200 || entry.responseStatus > 599)
        )
      ) {
        throw new Error("provider replay receipt input or transport ledger is invalid");
      }
      observedSequences.push(sequence);
      if (
        JSON.stringify(comparableSession(session)) !==
          JSON.stringify(expected)
      ) {
        throw new Error("provider replay receipt session does not match protocol input");
      }
    }
    if (
      !sameJson(observedSequences[0], observedSequences[2]) ||
      !sameJson(observedSequences[1], observedSequences[3])
    ) {
      throw new Error("formal provider input sequence does not match discovery");
    }
    assertProviderResponseTapeCoversSequences(tape, observedSequences.slice(0, 2));
    assertProviderResponseFailuresRecovered(tape, observedSequences[0]!);
    assertProviderResponseFailuresRecovered(tape, observedSequences[1]!);
    const receiptBindings = [
      [
        JSON.parse(baselineDiscoveryReceiptRaw) as Record<string, unknown>,
        protocolInput.baselineCommit,
        "baseline-discovery",
        manifest.baseline.worktreePath,
        null,
      ],
      [
        JSON.parse(candidateDiscoveryReceiptRaw) as Record<string, unknown>,
        protocolInput.candidateCommit,
        "candidate-discovery",
        manifest.candidate.worktreePath,
        null,
      ],
      [
        JSON.parse(baselineFormalReceiptRaw) as Record<string, unknown>,
        protocolInput.baselineCommit,
        "baseline-formal",
        manifest.baseline.worktreePath,
        {
          officialSummary: lifecycleIdentity(
            artifacts,
            "providerReplay",
            "baselineFormalOfficial",
          ),
          finalReport: lifecycleIdentity(
            artifacts,
            "providerReplay",
            "baselineFormalReport",
          ),
          officialProgress: lifecycleIdentity(
            artifacts,
            "providerReplay",
            "baselineFormalProgress",
          ),
        },
      ],
      [
        JSON.parse(candidateFormalReceiptRaw) as Record<string, unknown>,
        protocolInput.candidateCommit,
        "candidate-formal",
        manifest.candidate.worktreePath,
        {
          officialSummary: lifecycleIdentity(
            artifacts,
            "providerReplay",
            "candidateFormalOfficial",
          ),
          finalReport: lifecycleIdentity(
            artifacts,
            "providerReplay",
            "candidateFormalReport",
          ),
          officialProgress: lifecycleIdentity(
            artifacts,
            "providerReplay",
            "candidateFormalProgress",
          ),
        },
      ],
    ] as const;
    const providerLanes = {
      assisted: "GOODMEMORY_ASSISTED_EXTRACTOR",
      embedding: "GOODMEMORY_EMBEDDING",
      eval: "GOODMEMORY_EVAL",
      judge: "GOODMEMORY_JUDGE",
      reranking: "GOODMEMORY_RERANKING",
    } as const;
    for (const [receipt, commit, stage, worktreePath, outputs] of receiptBindings) {
      if (
        receipt.commit !== commit ||
        receipt.stage !== stage ||
        receipt.generatedBy !==
          "scripts/run-v0-7-3-replacement-protection-gate.ts" ||
        !sameJson(receipt.executionOrder, V073_PROVIDER_STAGE_ORDER) ||
        !sameJson(
          receipt.steps,
          V073_PROVIDER_STAGE_ORDER.map((step) => ({ exitCode: 0, step })),
        ) ||
        !sameJson(receipt.sourceIdentity, {
          claimCommandTemplateSha256: boundProtocol.claimCommandTemplateSha256,
          claimSourceSha256: boundHarness.claimRecipe.sha256,
          officialSourceSha256: boundHarness.officialRunner.sha256,
          promptSha256: boundProtocol.promptSha256,
          reanswerSourceSha256: boundHarness.reanswerRunner.sha256,
          seedSourceSha256: boundHarness.seedRunner.sha256,
        }) ||
        !isRecord(receipt.commandChain)
      ) {
        throw new Error("provider replay receipt execution identity is invalid");
      }
      const seedInvocation = receipt.commandChain.seedSmoke;
      if (!isRecord(seedInvocation) || !isRecord(seedInvocation.environment)) {
        throw new Error("provider replay seed command identity is invalid");
      }
      const baseUrls = {
        assisted: seedInvocation.environment.GOODMEMORY_ASSISTED_EXTRACTOR_BASE_URL,
        embedding: seedInvocation.environment.GOODMEMORY_EMBEDDING_BASE_URL,
        eval: seedInvocation.environment.GOODMEMORY_EVAL_BASE_URL,
        judge: seedInvocation.environment.GOODMEMORY_JUDGE_BASE_URL,
        reranking: seedInvocation.environment.GOODMEMORY_RERANKING_BASE_URL,
      };
      if (Object.values(baseUrls).some((value) => typeof value !== "string")) {
        throw new Error("provider replay base URL identity is missing");
      }
      const expectedArm = buildV073StageArm({
        benchmarkRoot: manifest.benchmark.root,
        claimRecipeRaw: measuredClaimRecipeRaw,
        commit,
        outputDir: measurementEvidenceRoot,
        providers: expectedProviders,
        sourceIdentity: {
          officialSourceSha256: boundHarness.officialRunner.sha256,
          reanswerSourceSha256: boundHarness.reanswerRunner.sha256,
          seedSourceSha256: boundHarness.seedRunner.sha256,
        },
        stage,
        worktreePath,
      });
      const expectedChain = routeV073CommandChainThroughTape(
        buildV073PairedCommandChain(
          expectedArm.arm,
          bindHomeRelativeClaimRecipeBenchmarkRoot(
            measuredClaimRecipeRaw,
            manifest.benchmark.root,
          ),
        ),
        baseUrls as {
          assisted: string;
          embedding: string;
          eval: string;
          judge: string;
          reranking: string;
        },
        { replayCredentials: stage.endsWith("-formal") },
      );
      if (!sameJson(receipt.commandChain, expectedChain)) {
        throw new Error("provider replay command chain drifted from the recipe");
      }
      let receiptLoopbackOrigin: string | undefined;
      for (const [step, expectedScript] of [
        ["seedSmoke", "scripts/run-phase-65-locomo-smoke.ts"],
        ["reanswer", "scripts/reanswer-phase-65-locomo-report.ts"],
        ["officialRescore", "eval:official-rescore"],
      ] as const) {
        const invocation = receipt.commandChain[step];
        if (
          !isRecord(invocation) ||
          invocation.command !== "bun" ||
          invocation.cwd !== worktreePath ||
          !Array.isArray(invocation.args) ||
          invocation.args[0] !== "run" ||
          invocation.args[1] !== expectedScript ||
          !isRecord(invocation.environment)
        ) {
          throw new Error("provider replay command chain is invalid");
        }
        const concurrencyIndexes = invocation.args.flatMap(
          (value, index) => value === "--concurrency" ? [index] : [],
        );
        if (
          concurrencyIndexes.length !== 1 ||
          invocation.args[concurrencyIndexes[0]! + 1] !== "1"
        ) {
          throw new Error(
            "provider replay command chain must use concurrency 1",
          );
        }
        const activeProviders = step === "seedSmoke"
          ? ["assisted", "embedding", "eval", "reranking"] as const
          : step === "reanswer"
            ? ["eval"] as const
            : ["judge"] as const;
        for (const name of activeProviders) {
          const prefix = providerLanes[name];
          const identity = expectedProviders[name];
          if (
            invocation.environment[`${prefix}_MODEL`] !== identity.model ||
            invocation.environment[`${prefix}_PROVIDER`] !== identity.provider
          ) {
            throw new Error("provider replay model identity is invalid");
          }
        }
        for (const [lane, prefix] of Object.entries(providerLanes)) {
          const baseUrl = invocation.environment[`${prefix}_BASE_URL`];
          if (typeof baseUrl !== "string") {
            throw new Error("provider replay command chain is not fully routed");
          }
          const parsed = new URL(baseUrl);
          if (
            parsed.protocol !== "http:" ||
            parsed.hostname !== "127.0.0.1" ||
            parsed.port.length === 0 ||
            parsed.pathname !== `/${lane}` ||
            parsed.search !== ""
          ) {
            throw new Error("provider replay command chain must use loopback tape lanes");
          }
          receiptLoopbackOrigin ??= parsed.origin;
          if (parsed.origin !== receiptLoopbackOrigin) {
            throw new Error("provider replay tape lanes must share one loopback proxy");
          }
          const apiKey = invocation.environment[`${prefix}_API_KEY`];
          if (
            stage.endsWith("-formal")
              ? apiKey !== "provider-response-tape-replay"
              : apiKey !== undefined
          ) {
            throw new Error("provider replay credential routing is invalid");
          }
        }
      }
      for (const name of ["stdout", "stderr"] as const) {
        if (!isArtifactIdentity(receipt[name])) {
          throw new Error(`provider replay receipt ${name} identity is missing`);
        }
        await readBoundLifecycleArtifact({
          identity: receipt[name],
          repoRoot: input.repoRoot,
        });
      }
      if (!isRecord(receipt.outputs)) {
        throw new Error("provider replay receipt outputs are missing");
      }
      for (const identity of Object.values(receipt.outputs)) {
        if (!isArtifactIdentity(identity)) {
          throw new Error("provider replay receipt output identity is invalid");
        }
        await readBoundLifecycleArtifact({ identity, repoRoot: input.repoRoot });
      }
      if (outputs !== null) {
        for (const [name, identity] of Object.entries(outputs)) {
          const receiptIdentity = receipt.outputs[name];
          if (
            !isArtifactIdentity(receiptIdentity) ||
            receiptIdentity.bytes !== identity.bytes ||
            receiptIdentity.sha256 !== identity.sha256
          ) {
            throw new Error("formal provider replay receipt output is not bound");
          }
        }
      }
    }

    const tapeTargetCounts = Object.fromEntries(
      [...new Set(tape.entries.map((entry) => entry.request.targetId))]
        .sort()
        .map((targetId) => [
          targetId,
          tape.entries.filter((entry) => entry.request.targetId === targetId).length,
        ]),
    );
    if (
      sha256(tapeRaw) !== protocolInput.providerReplay.tapeSha256 ||
      tape.entries.length !== protocolInput.providerReplay.tapeEntryCount ||
      JSON.stringify(tapeTargetCounts) !==
        JSON.stringify(protocolInput.providerReplay.tapeTargetCounts)
    ) {
      throw new Error("frozen provider tape does not match protocol input");
    }

    const baselineFormalReport = parseV073FormalSmokeReport(
      baselineFormalReportRaw,
    );
    const candidateFormalReport = parseV073FormalSmokeReport(
      candidateFormalReportRaw,
    );
    const baselineOfficial = parseV073OfficialSummary(
      baselineFormalOfficialRaw,
    );
    const candidateOfficial = parseV073OfficialSummary(
      candidateFormalOfficialRaw,
    );
    const baselineProgress = parseV073OfficialProgress(
      baselineFormalProgressRaw,
    );
    const candidateProgress = parseV073OfficialProgress(
      candidateFormalProgressRaw,
    );
    const questionIds = (rows: ReadonlyArray<{ questionId: string }>) =>
      rows.map((row) => row.questionId).sort();
    if (
      !sameJson(
        questionIds(baselineProgress),
        questionIds(baselineFormalReport.cases),
      ) ||
      !sameJson(
        questionIds(candidateProgress),
        questionIds(candidateFormalReport.cases),
      )
    ) {
      throw new Error("official progress population does not match formal reports");
    }
    const numericMean = <Row>(
      rows: readonly Row[],
      select: (row: Row) => number,
    ): number => {
      const values = rows.map(select);
      return values.reduce((sum, value) => sum + value, 0) / values.length;
    };
    const transitions = officialQuestionTransitions(
      baselineProgress,
      candidateProgress,
    );
    if (
      Math.abs(
        numericMean(baselineProgress, (row) => Number(row.correct)) -
          baselineOfficial.overallAccuracy,
      ) > 1e-12 ||
      Math.abs(
        numericMean(candidateProgress, (row) => Number(row.correct)) -
          candidateOfficial.overallAccuracy,
      ) > 1e-12
    ) {
      throw new Error("formal provider official progress and summary disagree");
    }
    const pointDeltas = {
      evidenceRecall:
        numericMean(candidateFormalReport.cases, (row) => row.evidenceRecall) -
        numericMean(baselineFormalReport.cases, (row) => row.evidenceRecall),
      officialScore:
        candidateOfficial.overallAccuracy - baselineOfficial.overallAccuracy,
      strictAnswerScore:
        numericMean(candidateFormalReport.cases, (row) => row.answerTokenF1) -
        numericMean(baselineFormalReport.cases, (row) => row.answerTokenF1),
    };
    if (
      JSON.stringify(protocolInput.providerReplay.pointDeltas) !==
        JSON.stringify(pointDeltas) ||
      protocolInput.providerReplay.baselineExecutionFailures !==
        baselineFormalReport.executionFailures ||
      protocolInput.providerReplay.candidateExecutionFailures !==
        candidateFormalReport.executionFailures ||
      protocolInput.providerReplay.baselineJudgeFailures !==
        baselineOfficial.judgeFailures ||
      protocolInput.providerReplay.candidateJudgeFailures !==
        candidateOfficial.judgeFailures ||
      JSON.stringify(protocolInput.questionTransitions) !==
        JSON.stringify(transitions)
    ) {
      throw new Error("formal provider metrics do not match bound report bytes");
    }

    const recomputed = evaluateV073ReplacementProtection(protocolInput);
    const comparable = (value: Record<string, unknown>) => ({
      baselineCommit: value.baselineCommit,
      blockers: value.blockers,
      candidateCommit: value.candidateCommit,
      candidatePromptSha256: value.candidatePromptSha256,
      claimBoundary: value.claimBoundary,
      fullClaimRerunRequired: value.fullClaimRerunRequired,
      hardGate: value.hardGate,
      liveDiagnostic: value.liveDiagnostic,
      providerReplay: value.providerReplay,
      providerPreflight: value.providerPreflight,
      releaseAllowed: value.releaseAllowed,
      researchRecordRequired: value.researchRecordRequired,
      schemaVersion: value.schemaVersion,
    });
    if (
      JSON.stringify(comparable(input.artifact)) !==
        JSON.stringify(comparable(recomputed as unknown as Record<string, unknown>))
    ) {
      throw new Error("compact lifecycle artifact does not match recomputed bundle evidence");
    }
    return {
      detail: `tracked lifecycle evidence bundle recomputed successfully for ${input.artifactPath}`,
      durationMs: Math.round(performance.now() - startedAt),
      id: "v0.7.3-lifecycle-protection",
      required: true,
      status: "pass",
      title: "v0.7.3 paired lifecycle protection evidence",
    };
  } catch (error) {
    return {
      detail: error instanceof Error ? error.message : String(error),
      durationMs: Math.round(performance.now() - startedAt),
      id: "v0.7.3-lifecycle-protection",
      required: true,
      status: "fail",
      title: "v0.7.3 paired lifecycle protection evidence",
    };
  }
}

const ALLOWED_POST_CANDIDATE_DESCRIPTOR_PATHS = new Set([
  ".well-known/goodmemory.json",
  "kimi.plugin.json",
  "llms.txt",
  "server.json",
]);

const V073_PUBLIC_CLAIM_GOVERNANCE_BASELINE_COMMITS = {
  fullClaimAttemptSentinel: "078ca74ac45fe4bd268e52921528e1e15a0ec52f",
  fullClaimProtocolPreregistration: "3f84011ba091f295e2d1f175a9e7ba5d2faebc76",
  protocolCandidate: "996c181e97e2d0a56bbd78957e79026af328b03b",
} as const;
const V073_PUBLIC_CLAIM_GOVERNANCE_PREREGISTRATION_BYTES = 4_438;
const V073_PUBLIC_CLAIM_GOVERNANCE_PREREGISTRATION_SHA256 =
  "fdf3535a32ed8ba5dccdfa444b18d9cd15c320d429ebbe4c987057935cdecd15";
const V073_PUBLIC_CLAIM_GOVERNANCE_PREREGISTRATION_PATHS = [
  V073_PUBLIC_CLAIM_GOVERNANCE_PREREGISTRATION,
  "tests/release/release.test.ts",
  "tests/unit/run-public-benchmark-claim-gate.test.ts",
  "tests/unit/run-v0-7-release-readiness.test.ts",
] as const;
const V073_PUBLIC_CLAIM_GOVERNANCE_IMPLEMENTATION_PATHS = [
  ".github/workflows/release.yml",
  "scripts/run-public-benchmark-claim-gate.ts",
  "scripts/run-v0-7-release-readiness.ts",
] as const;
const V073_PUBLIC_CLAIM_GOVERNANCE_SOURCE_PATHS = [
  ".github/workflows/release.yml",
  "scripts/run-public-benchmark-claim-gate.ts",
  "scripts/run-v0-7-release-readiness.ts",
  "tests/release/release.test.ts",
  "tests/unit/run-public-benchmark-claim-gate.test.ts",
  "tests/unit/run-v0-7-release-readiness.test.ts",
] as const;
const V073_PUBLIC_CLAIM_GOVERNANCE_CHANGE_PATHS = new Set([
  ...V073_PUBLIC_CLAIM_GOVERNANCE_IMPLEMENTATION_PATHS,
  ...V073_PUBLIC_CLAIM_GOVERNANCE_PREREGISTRATION_PATHS,
  V073_PUBLIC_CLAIM_GOVERNANCE_ATTESTATION,
]);
const V073_STABLE_SOURCE_BASELINE_COMMITS = {
  governanceAttestation: "b9c9b796803b9a7a39a491abe95d4c9f802a2520",
  stableSource: "6928ffdd7545a609495ed483bc8878894980301f",
} as const;
const V073_STABLE_SOURCE_PREREGISTRATION_COMMIT =
  "76556d010c4b132f1f6e5c7a60e4fa2534a54b70";
const V073_STABLE_SOURCE_PREREGISTRATION_BYTES = 5_103;
const V073_STABLE_SOURCE_PREREGISTRATION_SHA256 =
  "38946ad1bf31b1a1e6638cd4ab2cc2f8bbbb718b1eaee902c0a96dc23752cffd";
const V073_STABLE_SOURCE_RELEASE_PATHS = [
  ".well-known/goodmemory.json",
  "README.md",
  "README.zh-CN.md",
  V073_LOCOMO_CURRENT_PROJECTION,
  "benchmark-claims/locomo.json",
  "docs/GoodMemory-Current-Status-and-Evidence.md",
  "docs/README.md",
  "docs/plans/GoodMemory-v0.7.3-Replacement-Protection-Protocol.md",
  "llms.txt",
  "package.json",
  ...Object.entries(V073_LOCOMO_SOURCE_ARTIFACT_PATHS)
    .filter(([kind]) =>
      kind !== "protocol-attempt-sentinel" &&
      kind !== "protocol-preregistration"
    )
    .map(([, path]) => path),
] as const;
const V073_STABLE_SOURCE_TEST_PATHS = [
  "tests/release/release.test.ts",
  "tests/unit/capability-descriptor.test.ts",
  "tests/unit/run-v0-7-3-full-locomo-claim.test.ts",
  "tests/unit/run-v0-7-3-lifecycle-protection-gate.test.ts",
  "tests/unit/run-v0-7-3-replacement-protection-gate.test.ts",
  "tests/unit/run-v0-7-release-readiness.test.ts",
] as const;
const V073_STABLE_SOURCE_PREREGISTRATION_PATHS = [
  V073_STABLE_SOURCE_TEST_CORRECTION_PREREGISTRATION,
  ...V073_STABLE_SOURCE_TEST_PATHS,
] as const;
const V073_STABLE_SOURCE_IMPLEMENTATION_PATHS = [
  ".github/workflows/release.yml",
  "scripts/run-v0-7-release-readiness.ts",
] as const;
const V073_STABLE_SOURCE_SOURCE_PATHS = [
  ...V073_STABLE_SOURCE_IMPLEMENTATION_PATHS,
  ...V073_STABLE_SOURCE_TEST_PATHS,
] as const;
const V073_CROSS_HOST_LIFECYCLE_VERIFIER_BASELINE_COMMIT =
  "a7f78e2b3f324febb227f548c299f57ea487044e";
const V073_CROSS_HOST_LIFECYCLE_VERIFIER_PREREGISTRATION_COMMIT =
  "8e5b2773d2d88d5f8edd6123113dd9d69dabcbfc";
const V073_CROSS_HOST_LIFECYCLE_VERIFIER_PREREGISTRATION_BYTES = 4_930;
const V073_CROSS_HOST_LIFECYCLE_VERIFIER_PREREGISTRATION_SHA256 =
  "e35b009a381d4ed9178aefbdc9bba33e75c1d4266db6cac017c61cbf0c3439d4";
const V073_CROSS_HOST_LIFECYCLE_VERIFIER_TEST_PATHS = [
  "tests/release/release.test.ts",
  "tests/unit/run-v0-7-release-readiness.test.ts",
] as const;
const V073_CROSS_HOST_LIFECYCLE_VERIFIER_PREREGISTRATION_PATHS = [
  V073_CROSS_HOST_LIFECYCLE_VERIFIER_CORRECTION_PREREGISTRATION,
  ...V073_CROSS_HOST_LIFECYCLE_VERIFIER_TEST_PATHS,
] as const;
const V073_CROSS_HOST_LIFECYCLE_VERIFIER_IMPLEMENTATION_PATHS = [
  ".github/workflows/release.yml",
  "scripts/run-v0-7-release-readiness.ts",
] as const;
const V073_CROSS_HOST_LIFECYCLE_VERIFIER_SOURCE_PATHS = [
  ...V073_CROSS_HOST_LIFECYCLE_VERIFIER_IMPLEMENTATION_PATHS,
  ...V073_CROSS_HOST_LIFECYCLE_VERIFIER_TEST_PATHS,
] as const;
const V073_CROSS_HOST_LIFECYCLE_VERIFIER_CHANGE_PATHS = new Set([
  ...V073_CROSS_HOST_LIFECYCLE_VERIFIER_PREREGISTRATION_PATHS,
  ...V073_CROSS_HOST_LIFECYCLE_VERIFIER_IMPLEMENTATION_PATHS,
  V073_CROSS_HOST_LIFECYCLE_VERIFIER_CORRECTION_ATTESTATION,
]);
const V073_STABLE_SOURCE_CHANGE_PATHS = new Set([
  ...V073_STABLE_SOURCE_PREREGISTRATION_PATHS,
  ...V073_STABLE_SOURCE_IMPLEMENTATION_PATHS,
  V073_STABLE_SOURCE_TEST_CORRECTION_ATTESTATION,
]);
const V073_POST_ATTESTATION_RELEASE_PATHS = new Set([
  ...Object.entries(V073_LOCOMO_SOURCE_ARTIFACT_PATHS)
    .filter(([kind]) =>
      kind !== "protocol-attempt-sentinel" &&
      kind !== "protocol-preregistration"
    )
    .map(([, path]) => path),
  ...ALLOWED_POST_CANDIDATE_DESCRIPTOR_PATHS,
  V073_LOCOMO_CURRENT_PROJECTION,
  "benchmark-claims/locomo.json",
  "docs/GoodMemory-Current-Status-and-Evidence.md",
  "docs/plans/GoodMemory-v0.7.3-Replacement-Protection-Protocol.md",
  "docs/README.md",
  "package.json",
  "README.md",
  "README.zh-CN.md",
  "reports/release/v0.7/phase-74-storage-scale-gate.json",
  "reports/release/v0.7/readiness-report.json",
  "reports/release/v0.7/summary.md",
]);

const ALLOWED_POST_CANDIDATE_PATHS = new Set([
  ...Object.values(V073_LOCOMO_SOURCE_ARTIFACT_PATHS),
  ...ALLOWED_POST_CANDIDATE_DESCRIPTOR_PATHS,
  ...V073_PUBLIC_CLAIM_GOVERNANCE_IMPLEMENTATION_PATHS,
  ...V073_PUBLIC_CLAIM_GOVERNANCE_PREREGISTRATION_PATHS,
  V073_PUBLIC_CLAIM_GOVERNANCE_ATTESTATION,
  ...V073_STABLE_SOURCE_CHANGE_PATHS,
  V073_LOCOMO_CURRENT_PROJECTION,
  "benchmark-claims/locomo.json",
  "docs/GoodMemory-Current-Status-and-Evidence.md",
  "docs/plans/GoodMemory-v0.7.3-Replacement-Protection-Protocol.md",
  "docs/README.md",
  "package.json",
  "README.md",
  "README.zh-CN.md",
  "reports/release/v0.7/phase-74-storage-scale-gate.json",
  "reports/release/v0.7/readiness-report.json",
  "reports/release/v0.7/summary.md",
]);

const V073_LIFECYCLE_TO_PROTOCOL_EXACT_PATHS = new Set([
  ".github/workflows/release.yml",
  ".gitignore",
  "bun.lock",
  "docs/README.md",
  "docs/GoodMemory-Current-Status-and-Evidence.md",
  "docs/plans/GoodMemory-v0.7.3-Replacement-Protection-Protocol.md",
  "reports/release/v0.7/v0.7.3-lifecycle-protection.json",
  "reports/release/v0.7/v0.7.3-lifecycle-schema9-attempt-consumed.json",
  "package-lock.json",
  "package.json",
  "scripts/run-v0-7-3-full-locomo-claim.ts",
  "scripts/run-coverage.ts",
  "scripts/run-v0-7-release-readiness.ts",
  "tests/quality-gates/phase-73/codex-coding-effect.c6-protocol-readiness.gate.ts",
  "tests/release/release.test.ts",
  "tests/release/v0-7-stable-artifact.test.ts",
  "tests/integration/codex-coding-effect.c6-protocol-readiness.test.ts",
  "tests/unit/run-coverage.script.test.ts",
  "tests/unit/run-v0-7-3-lifecycle-protection-gate.test.ts",
  "tests/unit/run-v0-7-3-full-locomo-claim.test.ts",
  "tests/unit/run-v0-7-release-readiness.test.ts",
]);

const V073_LIFECYCLE_TO_PROTOCOL_PREFIXES = [
  "reports/release/v0.7/v0.7.3-lifecycle-schema9-evidence/",
  "reports/release/v0.7/v0.7.3-locomo-claim-attempt-1-failed/",
  "reports/release/v0.7/v0.7.3-locomo-claim-attempt-2-failed/",
] as const;

const V073_PROTOCOL_DEPENDENCY_PIN_PATHS = [
  "bun.lock",
  "package-lock.json",
  "package.json",
] as const;

const V073_PROTOCOL_DEPENDENCY_PINS = {
  "@ai-sdk/anthropic": ["^3.0.64", "3.0.64"],
  "@ai-sdk/openai": ["^3.0.49", "3.0.49"],
  "@ai-sdk/openai-compatible": ["^2.0.40", "2.0.40"],
  "@ai-sdk/provider-utils": ["^4.0.21", "4.0.23"],
  ai: ["^6.0.143", "6.0.143"],
} as const;

const V073_PROVIDER_UTILS_REGISTRY_IDENTITIES = {
  "4.0.21": {
    integrity:
      "sha512-MtFUYI1/8mgDvRmaBDjbLJPFFrMG777AvSgyIFQtZHIMzm88R/12vYBBpnk7pfiWLFE1DSZzY4WDYzGbKAcmiw==",
    resolved:
      "https://registry.npmjs.org/@ai-sdk/provider-utils/-/provider-utils-4.0.21.tgz",
  },
  "4.0.23": {
    integrity:
      "sha512-z8GlDaCmRSDlqkMF2f4/RFgWxdarvIbyuk+m6WXT1LYgsnGiXRJGTD2Z1+SDl3LqtFuRtGX1aghYvQLoHL/9pg==",
    resolved:
      "https://registry.npmjs.org/@ai-sdk/provider-utils/-/provider-utils-4.0.23.tgz",
  },
} as const;

export function isV073ProtocolDependencyPinningExact(input: {
  lifecycleRaws: Record<typeof V073_PROTOCOL_DEPENDENCY_PIN_PATHS[number], string>;
  protocolRaws: Record<typeof V073_PROTOCOL_DEPENDENCY_PIN_PATHS[number], string>;
}): boolean {
  try {
    const normalizeDependencies = (
      dependencies: Record<string, string> | undefined,
    ) => {
      if (!dependencies) {
        return false;
      }
      for (const [name, [before, after]] of Object.entries(
        V073_PROTOCOL_DEPENDENCY_PINS,
      )) {
        if (dependencies[name] !== after) {
          return false;
        }
        dependencies[name] = before;
      }
      return true;
    };

    const lifecyclePackage = JSON.parse(
      input.lifecycleRaws["package.json"],
    ) as Record<string, unknown>;
    const protocolPackage = JSON.parse(
      input.protocolRaws["package.json"],
    ) as Record<string, unknown>;
    if (
      !normalizeDependencies(
        protocolPackage.dependencies as Record<string, string> | undefined,
      ) ||
      !isDeepStrictEqual(protocolPackage, lifecyclePackage)
    ) {
      return false;
    }

    const lifecyclePackageLock = JSON.parse(
      input.lifecycleRaws["package-lock.json"],
    ) as Record<string, unknown>;
    const protocolPackageLock = JSON.parse(
      input.protocolRaws["package-lock.json"],
    ) as Record<string, unknown>;
    const packages = protocolPackageLock.packages as
      | Record<string, Record<string, unknown>>
      | undefined;
    if (
      !packages ||
      !normalizeDependencies(
        packages[""]?.dependencies as Record<string, string> | undefined,
      )
    ) {
      return false;
    }
    const rootProviderUtils = packages["node_modules/@ai-sdk/provider-utils"];
    const nestedProviderUtilsPaths = [
      "node_modules/@ai-sdk/anthropic/node_modules/@ai-sdk/provider-utils",
      "node_modules/@ai-sdk/gateway/node_modules/@ai-sdk/provider-utils",
      "node_modules/@ai-sdk/openai/node_modules/@ai-sdk/provider-utils",
      "node_modules/ai/node_modules/@ai-sdk/provider-utils",
    ] as const;
    const nestedProviderUtils = packages[nestedProviderUtilsPaths[0]];
    const providerUtilsPaths = Object.keys(packages).filter((path) =>
      path.endsWith("node_modules/@ai-sdk/provider-utils")
    );
    const hasRegistryIdentity = (
      value: Record<string, unknown> | undefined,
      version: keyof typeof V073_PROVIDER_UTILS_REGISTRY_IDENTITIES,
    ) => {
      const identity = V073_PROVIDER_UTILS_REGISTRY_IDENTITIES[version];
      return value?.resolved === identity.resolved &&
        value.integrity === identity.integrity;
    };
    if (
      !rootProviderUtils ||
      rootProviderUtils.version !== "4.0.23" ||
      !hasRegistryIdentity(rootProviderUtils, "4.0.23") ||
      !nestedProviderUtils ||
      nestedProviderUtils.version !== "4.0.21" ||
      !hasRegistryIdentity(nestedProviderUtils, "4.0.21") ||
      providerUtilsPaths.length !== nestedProviderUtilsPaths.length + 1 ||
      nestedProviderUtilsPaths.some((path) =>
        !hasRegistryIdentity(packages[path], "4.0.21") ||
        !isDeepStrictEqual(packages[path], nestedProviderUtils))
    ) {
      return false;
    }
    const withoutRegistryIdentity = (value: Record<string, unknown>) => {
      const normalized = { ...value };
      delete normalized.resolved;
      delete normalized.integrity;
      return normalized;
    };
    for (const path of nestedProviderUtilsPaths) {
      delete packages[path];
    }
    packages["node_modules/@ai-sdk/provider-utils"] =
      withoutRegistryIdentity(nestedProviderUtils);
    packages[
      "node_modules/@ai-sdk/openai-compatible/node_modules/@ai-sdk/provider-utils"
    ] = withoutRegistryIdentity(rootProviderUtils);
    if (
      !isDeepStrictEqual(protocolPackageLock, lifecyclePackageLock)
    ) {
      return false;
    }

    let normalizedBunLock = input.protocolRaws["bun.lock"];
    for (const [name, [before, after]] of Object.entries(
      V073_PROTOCOL_DEPENDENCY_PINS,
    )) {
      const current = `"${name}": "${after}"`;
      const prior = `"${name}": "${before}"`;
      if (!normalizedBunLock.includes(current)) {
        return false;
      }
      normalizedBunLock = normalizedBunLock.replace(current, prior);
    }
    return normalizedBunLock === input.lifecycleRaws["bun.lock"];
  } catch {
    return false;
  }
}

function isAllowedLifecycleToProtocolPath(path: string): boolean {
  return V073_LIFECYCLE_TO_PROTOCOL_EXACT_PATHS.has(path) ||
    V073_LIFECYCLE_TO_PROTOCOL_PREFIXES.some((prefix) => path.startsWith(prefix));
}

export function evaluateV073LifecycleToProtocolSourceDrift(input: {
  changedPaths: readonly string[];
  dependencyPinningValid?: boolean;
  isAncestor: boolean;
  lifecycleCandidateCommit: string;
  protocolCandidateCommit: string;
}): V07ReleaseReadinessCheck {
  const issues: string[] = [];
  if (!input.isAncestor) {
    issues.push(
      `lifecycle candidate ${input.lifecycleCandidateCommit} is not an ancestor of protocol candidate ${input.protocolCandidateCommit}`,
    );
  }
  const forbiddenPaths = input.changedPaths.filter(
    (path) => !isAllowedLifecycleToProtocolPath(path),
  );
  if (forbiddenPaths.length > 0) {
    issues.push(
      `non-protocol surface changed after lifecycle measurement: ${forbiddenPaths.join(", ")}`,
    );
  }
  const dependencyPinPathsChanged = V073_PROTOCOL_DEPENDENCY_PIN_PATHS.filter(
    (path) => input.changedPaths.includes(path),
  );
  if (
    dependencyPinPathsChanged.length > 0 &&
    (dependencyPinPathsChanged.length !==
        V073_PROTOCOL_DEPENDENCY_PIN_PATHS.length ||
      input.dependencyPinningValid !== true)
  ) {
    issues.push("AI SDK dependency pinning differs from the exact measured closure");
  }
  return {
    detail: issues.length === 0
      ? `protocol candidate ${input.protocolCandidateCommit} is a narrowly-scoped descendant of lifecycle candidate ${input.lifecycleCandidateCommit}`
      : issues.join("; "),
    durationMs: 0,
    id: "v0.7.3-protocol-source",
    required: true,
    status: issues.length === 0 ? "pass" : "fail",
    title: "v0.7.3 lifecycle-to-protocol source stability",
  };
}

interface V073PublicClaimGovernanceCorrectionInput {
  attestation: unknown;
  attestationChangedPaths: readonly string[];
  attestationCommit: string;
  attestationIsAncestor: boolean;
  attestationParentCommit: string;
  attestationRawAtCommit: string;
  attestationRawCurrent: string;
  currentCommit: string;
  currentSourceRaws: Readonly<Record<string, string>>;
  implementationChangedPaths: readonly string[];
  implementationCommit: string;
  implementationParentCommit: string;
  implementationSourceRaws: Readonly<Record<string, string>>;
  postAttestationChangedPaths: readonly string[];
  preregistration: unknown;
  preregistrationChangedPaths: readonly string[];
  preregistrationCommit: string;
  preregistrationParentCommit: string;
  preregistrationRawAtCommit: string;
  preregistrationRawCurrent: string;
  crossHostLifecycleVerifierCorrectionValid?: boolean;
  stableSourceCorrectionValid?: boolean;
}

function samePathSet(
  actual: readonly string[],
  expected: readonly string[],
): boolean {
  return actual.length === expected.length &&
    [...actual].sort().every((path, index) => path === [...expected].sort()[index]);
}

function isCorrectionVerification(
  value: unknown,
  command: string,
  exitCode: number,
  failed: number,
  passed: number,
): boolean {
  return isRecord(value) &&
    value.command === command &&
    value.exitCode === exitCode &&
    value.failed === failed &&
    value.passed === passed &&
    typeof value.outputSha256 === "string" &&
    SHA256_PATTERN.test(value.outputSha256);
}

export function evaluateV073PublicClaimGovernanceCorrection(
  input: V073PublicClaimGovernanceCorrectionInput,
): V07ReleaseReadinessCheck {
  const issues: string[] = [];
  const commitValues = [
    input.attestationCommit,
    input.attestationParentCommit,
    input.currentCommit,
    input.implementationCommit,
    input.implementationParentCommit,
    input.preregistrationCommit,
    input.preregistrationParentCommit,
  ];
  let parsedPreregistration: unknown;
  try {
    parsedPreregistration = JSON.parse(input.preregistrationRawAtCommit) as unknown;
  } catch {
    parsedPreregistration = undefined;
  }
  if (
    commitValues.some((commit) => !COMMIT_PATTERN.test(commit)) ||
    Buffer.byteLength(input.preregistrationRawAtCommit, "utf8") !==
      V073_PUBLIC_CLAIM_GOVERNANCE_PREREGISTRATION_BYTES ||
    sha256(input.preregistrationRawAtCommit) !==
      V073_PUBLIC_CLAIM_GOVERNANCE_PREREGISTRATION_SHA256 ||
    input.preregistrationRawCurrent !== input.preregistrationRawAtCommit ||
    !isDeepStrictEqual(input.preregistration, parsedPreregistration)
  ) {
    issues.push("governance correction preregistration artifact is inconsistent");
  }
  if (
    input.preregistrationParentCommit !==
      V073_PUBLIC_CLAIM_GOVERNANCE_BASELINE_COMMITS.fullClaimAttemptSentinel ||
    !samePathSet(
      input.preregistrationChangedPaths,
      V073_PUBLIC_CLAIM_GOVERNANCE_PREREGISTRATION_PATHS,
    )
  ) {
    issues.push("governance correction preregistration commit paths are inconsistent");
  }
  if (
    input.implementationParentCommit !== input.preregistrationCommit ||
    !samePathSet(
      input.implementationChangedPaths,
      V073_PUBLIC_CLAIM_GOVERNANCE_IMPLEMENTATION_PATHS,
    )
  ) {
    issues.push("governance correction implementation commit paths are inconsistent");
  }
  if (
    input.attestationParentCommit !== input.implementationCommit ||
    !samePathSet(
      input.attestationChangedPaths,
      [V073_PUBLIC_CLAIM_GOVERNANCE_ATTESTATION],
    ) ||
    !input.attestationIsAncestor ||
    input.attestationRawAtCommit !== input.attestationRawCurrent
  ) {
    issues.push("governance correction attestation commit paths are inconsistent");
  }
  const forbiddenReleasePaths = input.postAttestationChangedPaths.filter(
    (path) =>
      !V073_POST_ATTESTATION_RELEASE_PATHS.has(path) &&
      !(input.stableSourceCorrectionValid === true &&
        V073_STABLE_SOURCE_CHANGE_PATHS.has(path)) &&
      !(input.crossHostLifecycleVerifierCorrectionValid === true &&
        V073_CROSS_HOST_LIFECYCLE_VERIFIER_CHANGE_PATHS.has(path)),
  );
  if (forbiddenReleasePaths.length > 0) {
    issues.push(
      `governance correction post-attestation release paths are inconsistent: ${
        forbiddenReleasePaths.join(", ")
      }`,
    );
  }

  const attestation = input.attestation;
  let parsedAttestation: unknown;
  try {
    parsedAttestation = JSON.parse(input.attestationRawAtCommit) as unknown;
  } catch {
    parsedAttestation = undefined;
  }
  const sourceArtifacts = isRecord(attestation) &&
      Array.isArray(attestation.sourceArtifacts)
    ? attestation.sourceArtifacts
    : [];
  const sourceArtifactsByPath = new Map<string, ArtifactIdentityShape>();
  for (const artifact of sourceArtifacts) {
    if (
      !isArtifactIdentity(artifact) ||
      sourceArtifactsByPath.has(artifact.path)
    ) {
      continue;
    }
    sourceArtifactsByPath.set(artifact.path, artifact);
  }
  const frozenSourcesValid =
    sourceArtifacts.length === V073_PUBLIC_CLAIM_GOVERNANCE_SOURCE_PATHS.length &&
    sourceArtifactsByPath.size === V073_PUBLIC_CLAIM_GOVERNANCE_SOURCE_PATHS.length &&
    V073_PUBLIC_CLAIM_GOVERNANCE_SOURCE_PATHS.every((path) => {
      const implementationRaw = input.implementationSourceRaws[path];
      const currentRaw = input.currentSourceRaws[path];
      const identity = sourceArtifactsByPath.get(path);
      return implementationRaw !== undefined &&
        currentRaw !== undefined &&
        (currentRaw === implementationRaw ||
          (input.stableSourceCorrectionValid === true &&
            V073_STABLE_SOURCE_SOURCE_PATHS.includes(
              path as (typeof V073_STABLE_SOURCE_SOURCE_PATHS)[number],
            ))) &&
        identity?.bytes === Buffer.byteLength(implementationRaw, "utf8") &&
        identity.sha256 === sha256(implementationRaw);
    });
  if (!frozenSourcesValid) {
    issues.push("governance correction frozen governance sources are inconsistent");
  }

  const verification = isRecord(attestation) && isRecord(attestation.verification)
    ? attestation.verification
    : undefined;
  const redVerification = verification && isRecord(verification.red)
    ? verification.red
    : undefined;
  const greenVerification = verification && isRecord(verification.green)
    ? verification.green
    : undefined;
  const attestationValid =
    isRecord(attestation) &&
    isDeepStrictEqual(attestation, parsedAttestation) &&
    attestation.artifactKind ===
      "v0.7.3-public-claim-governance-correction-attestation" &&
    attestation.schemaVersion === 1 &&
    attestation.generatedBy ===
      "v0.7.3-public-claim-governance-correction-attestation" &&
    Number.isFinite(Date.parse(String(attestation.generatedAt))) &&
    isDeepStrictEqual(
      attestation.baselineCommits,
      V073_PUBLIC_CLAIM_GOVERNANCE_BASELINE_COMMITS,
    ) &&
    isRecord(attestation.correctionCommits) &&
    attestation.correctionCommits.preregistration ===
      input.preregistrationCommit &&
    attestation.correctionCommits.implementation === input.implementationCommit &&
    Array.isArray(attestation.implementationDiffPaths) &&
    attestation.implementationDiffPaths.every(
      (path): path is string => typeof path === "string",
    ) &&
    samePathSet(
      attestation.implementationDiffPaths,
      V073_PUBLIC_CLAIM_GOVERNANCE_IMPLEMENTATION_PATHS,
    ) &&
    attestation.providerCalls === 0 &&
    redVerification !== undefined &&
    greenVerification !== undefined &&
    isCorrectionVerification(
      redVerification.publicClaimGate,
      "bun test tests/unit/run-public-benchmark-claim-gate.test.ts",
      1,
      2,
      39,
    ) &&
    isCorrectionVerification(
      redVerification.releaseReadiness,
      "bun test tests/unit/run-v0-7-release-readiness.test.ts " +
        "-t governance-correction-lineage",
      1,
      1,
      0,
    ) &&
    isCorrectionVerification(
      redVerification.releaseWorkflowEvidence,
      "bun test tests/release/release.test.ts --test-name-pattern " +
        '"ships the public-claim governance correction evidence"',
      1,
      1,
      0,
    ) &&
    isCorrectionVerification(
      greenVerification.publicClaimGate,
      "bun test tests/unit/run-public-benchmark-claim-gate.test.ts",
      0,
      0,
      41,
    ) &&
    isCorrectionVerification(
      greenVerification.releaseReadiness,
      "bun test tests/unit/run-v0-7-release-readiness.test.ts " +
        "-t governance-correction-lineage",
      0,
      0,
      2,
    ) &&
    isCorrectionVerification(
      greenVerification.releaseWorkflowEvidence,
      "bun test tests/release/release.test.ts --test-name-pattern " +
        '"ships the public-claim governance correction evidence"',
      0,
      0,
      1,
    ) &&
    isCorrectionVerification(
      greenVerification.typecheck,
      "bun run typecheck",
      0,
      0,
      1,
    );
  if (!attestationValid) {
    issues.push("governance correction attestation verification results are inconsistent");
  }

  return {
    detail: issues.length === 0
      ? `preregistered S-D-G-A-release governance correction is frozen at ${input.implementationCommit}`
      : issues.join("; "),
    durationMs: 0,
    id: "v0.7.3-public-claim-governance-correction",
    required: true,
    status: issues.length === 0 ? "pass" : "fail",
    title: "v0.7.3 public-claim governance correction lineage",
  };
}

function changedPaths(raw: string): string[] {
  return raw
    .split(/\r?\n/u)
    .map((path) => path.trim())
    .filter(Boolean);
}

export async function evaluateV073PublicClaimGovernanceCorrectionFile(input: {
  crossHostLifecycleVerifierCorrectionValid?: boolean;
  currentCommit: string;
  historical?: boolean;
  repoRoot: string;
  stableSourceCorrectionValid?: boolean;
}): Promise<V07ReleaseReadinessCheck> {
  const startedAt = performance.now();
  try {
    const preregistrationRawCurrent = await readFile(
      join(input.repoRoot, V073_PUBLIC_CLAIM_GOVERNANCE_PREREGISTRATION),
      "utf8",
    );
    const attestationRawCurrent = await readFile(
      join(input.repoRoot, V073_PUBLIC_CLAIM_GOVERNANCE_ATTESTATION),
      "utf8",
    );
    const preregistration = JSON.parse(preregistrationRawCurrent) as unknown;
    const attestation = JSON.parse(attestationRawCurrent) as unknown;
    if (
      !COMMIT_PATTERN.test(input.currentCommit) ||
      !isRecord(attestation) ||
      !isRecord(attestation.correctionCommits) ||
      !COMMIT_PATTERN.test(String(attestation.correctionCommits.preregistration)) ||
      !COMMIT_PATTERN.test(String(attestation.correctionCommits.implementation))
    ) {
      throw new Error("correction commit identities are inconsistent");
    }
    const preregistrationCommit = String(
      attestation.correctionCommits.preregistration,
    );
    const implementationCommit = String(
      attestation.correctionCommits.implementation,
    );
    const attestationCommitOutcome = await runCommand(
      "git",
      [
        "log",
        "-1",
        "--format=%H",
        "--diff-filter=A",
        "--",
        V073_PUBLIC_CLAIM_GOVERNANCE_ATTESTATION,
      ],
      input.repoRoot,
    );
    const attestationCommit = attestationCommitOutcome.stdout.trim();
    if (
      attestationCommitOutcome.code !== 0 ||
      !COMMIT_PATTERN.test(attestationCommit)
    ) {
      throw new Error("cannot resolve the correction attestation commit");
    }

    const git = async (args: string[]): Promise<string> => {
      const outcome = await runCommand("git", args, input.repoRoot);
      if (outcome.code !== 0) {
        throw new Error(`git ${args.join(" ")} failed`);
      }
      return outcome.stdout;
    };
    const [
      preregistrationParentCommit,
      implementationParentCommit,
      attestationParentCommit,
      preregistrationChangedRaw,
      implementationChangedRaw,
      attestationChangedRaw,
      postAttestationChangedRaw,
      preregistrationRawAtCommit,
      attestationRawAtCommit,
      attestationAncestor,
    ] = await Promise.all([
      git(["rev-parse", `${preregistrationCommit}^`]),
      git(["rev-parse", `${implementationCommit}^`]),
      git(["rev-parse", `${attestationCommit}^`]),
      git([
        "diff",
        "--name-only",
        `${preregistrationCommit}^`,
        preregistrationCommit,
        "--",
      ]),
      git([
        "diff",
        "--name-only",
        `${implementationCommit}^`,
        implementationCommit,
        "--",
      ]),
      git([
        "diff",
        "--name-only",
        `${attestationCommit}^`,
        attestationCommit,
        "--",
      ]),
      git([
        "diff",
        "--name-only",
        `${attestationCommit}..${input.currentCommit}`,
        "--",
      ]),
      git([
        "show",
        `${preregistrationCommit}:${V073_PUBLIC_CLAIM_GOVERNANCE_PREREGISTRATION}`,
      ]),
      git([
        "show",
        `${attestationCommit}:${V073_PUBLIC_CLAIM_GOVERNANCE_ATTESTATION}`,
      ]),
      runCommand(
        "git",
        [
          "merge-base",
          "--is-ancestor",
          attestationCommit,
          input.currentCommit,
        ],
        input.repoRoot,
      ),
    ]);
    if (attestationAncestor.code !== 0 && attestationAncestor.code !== 1) {
      throw new Error("cannot compare the attestation and release commits");
    }
    const implementationSourceRaws: Record<string, string> = {};
    const currentSourceRaws: Record<string, string> = {};
    const sourceOutcomes = await Promise.all(
      V073_PUBLIC_CLAIM_GOVERNANCE_SOURCE_PATHS.flatMap((path) => [
        git(["show", `${implementationCommit}:${path}`]),
        git(["show", `${input.currentCommit}:${path}`]),
      ]),
    );
    V073_PUBLIC_CLAIM_GOVERNANCE_SOURCE_PATHS.forEach((path, index) => {
      implementationSourceRaws[path] = sourceOutcomes[index * 2]!;
      currentSourceRaws[path] = input.historical
        ? sourceOutcomes[index * 2]!
        : sourceOutcomes[index * 2 + 1]!;
    });
    const check = evaluateV073PublicClaimGovernanceCorrection({
      attestation,
      attestationChangedPaths: changedPaths(attestationChangedRaw),
      attestationCommit,
      attestationIsAncestor: attestationAncestor.code === 0,
      attestationParentCommit: attestationParentCommit.trim(),
      attestationRawAtCommit,
      attestationRawCurrent,
      currentCommit: input.historical ? attestationCommit : input.currentCommit,
      currentSourceRaws,
      crossHostLifecycleVerifierCorrectionValid:
        input.crossHostLifecycleVerifierCorrectionValid,
      implementationChangedPaths: changedPaths(implementationChangedRaw),
      implementationCommit,
      implementationParentCommit: implementationParentCommit.trim(),
      implementationSourceRaws,
      postAttestationChangedPaths: input.historical
        ? []
        : changedPaths(postAttestationChangedRaw),
      preregistration,
      preregistrationChangedPaths: changedPaths(preregistrationChangedRaw),
      preregistrationCommit,
      preregistrationParentCommit: preregistrationParentCommit.trim(),
      preregistrationRawAtCommit,
      preregistrationRawCurrent,
      stableSourceCorrectionValid: input.stableSourceCorrectionValid,
    });
    return {
      ...check,
      durationMs: Math.round(performance.now() - startedAt),
    };
  } catch (error) {
    return {
      detail: `cannot verify public-claim governance correction: ${
        error instanceof Error ? error.message : String(error)
      }`,
      durationMs: Math.round(performance.now() - startedAt),
      id: "v0.7.3-public-claim-governance-correction",
      required: true,
      status: "fail",
      title: "v0.7.3 public-claim governance correction lineage",
    };
  }
}

interface V073CrossHostLifecycleVerifierCorrectionInput {
  attestation: unknown;
  attestationChangedPaths: readonly string[];
  attestationCommit: string;
  attestationIsAncestor: boolean;
  attestationParentCommit: string;
  attestationRawAtCommit: string;
  attestationRawCurrent: string;
  currentCommit: string;
  currentSourceRaws: Readonly<Record<string, string>>;
  implementationChangedPaths: readonly string[];
  implementationCommit: string;
  implementationParentCommit: string;
  implementationSourceRaws: Readonly<Record<string, string>>;
  preregistration: unknown;
  preregistrationChangedPaths: readonly string[];
  preregistrationCommit: string;
  preregistrationParentCommit: string;
  preregistrationRawAtCommit: string;
  preregistrationRawCurrent: string;
  preregistrationSourceRaws: Readonly<Record<string, string>>;
}

function crossHostLifecycleVerifierCorrectionCheck(
  issues: readonly string[],
): V07ReleaseReadinessCheck {
  return {
    detail: issues.length === 0
      ? `exact A2-D3-G3-A3 cross-host lifecycle verifier correction is frozen at ${
        V073_CROSS_HOST_LIFECYCLE_VERIFIER_PREREGISTRATION_COMMIT
      }`
      : issues.join("; "),
    durationMs: 0,
    id: "v0.7.3-cross-host-lifecycle-verifier-correction",
    required: true,
    status: issues.length === 0 ? "pass" : "fail",
    title: "v0.7.3 cross-host lifecycle verifier correction lineage",
  };
}

export function evaluateV073CrossHostLifecycleVerifierCorrection(
  input: unknown,
): V07ReleaseReadinessCheck {
  if (!isRecord(input)) {
    return crossHostLifecycleVerifierCorrectionCheck([
      "cross-host lifecycle verifier correction input is malformed",
    ]);
  }
  const value = input as unknown as V073CrossHostLifecycleVerifierCorrectionInput;
  if (
    !Array.isArray(value.attestationChangedPaths) ||
    !Array.isArray(value.implementationChangedPaths) ||
    !Array.isArray(value.preregistrationChangedPaths) ||
    !isRecord(value.currentSourceRaws) ||
    !isRecord(value.implementationSourceRaws) ||
    !isRecord(value.preregistrationSourceRaws)
  ) {
    return crossHostLifecycleVerifierCorrectionCheck([
      "cross-host lifecycle verifier correction input is incomplete",
    ]);
  }

  const issues: string[] = [];
  const commits = [
    value.attestationCommit,
    value.attestationParentCommit,
    value.currentCommit,
    value.implementationCommit,
    value.implementationParentCommit,
    value.preregistrationCommit,
    value.preregistrationParentCommit,
  ];
  if (commits.some((commit) => !COMMIT_PATTERN.test(commit))) {
    issues.push("cross-host lifecycle verifier correction commit identities are malformed");
  }
  if (
    value.preregistrationCommit !==
      V073_CROSS_HOST_LIFECYCLE_VERIFIER_PREREGISTRATION_COMMIT ||
    value.preregistrationParentCommit !==
      V073_CROSS_HOST_LIFECYCLE_VERIFIER_BASELINE_COMMIT ||
    !samePathSet(
      value.preregistrationChangedPaths,
      V073_CROSS_HOST_LIFECYCLE_VERIFIER_PREREGISTRATION_PATHS,
    )
  ) {
    issues.push("cross-host lifecycle verifier preregistration commit is inconsistent");
  }
  if (
    value.implementationParentCommit !== value.preregistrationCommit ||
    !samePathSet(
      value.implementationChangedPaths,
      V073_CROSS_HOST_LIFECYCLE_VERIFIER_IMPLEMENTATION_PATHS,
    )
  ) {
    issues.push("cross-host lifecycle verifier implementation commit is inconsistent");
  }
  if (
    value.attestationParentCommit !== value.implementationCommit ||
    value.currentCommit !== value.attestationCommit ||
    !value.attestationIsAncestor ||
    !samePathSet(
      value.attestationChangedPaths,
      [V073_CROSS_HOST_LIFECYCLE_VERIFIER_CORRECTION_ATTESTATION],
    ) ||
    value.attestationRawAtCommit !== value.attestationRawCurrent
  ) {
    issues.push("cross-host lifecycle verifier attestation commit is inconsistent");
  }

  let preregistrationAtCommit: unknown;
  let attestationAtCommit: unknown;
  try {
    preregistrationAtCommit = JSON.parse(value.preregistrationRawAtCommit) as unknown;
    attestationAtCommit = JSON.parse(value.attestationRawAtCommit) as unknown;
  } catch {
    preregistrationAtCommit = undefined;
    attestationAtCommit = undefined;
  }
  if (
    Buffer.byteLength(value.preregistrationRawAtCommit, "utf8") !==
      V073_CROSS_HOST_LIFECYCLE_VERIFIER_PREREGISTRATION_BYTES ||
    sha256(value.preregistrationRawAtCommit) !==
      V073_CROSS_HOST_LIFECYCLE_VERIFIER_PREREGISTRATION_SHA256 ||
    value.preregistrationRawCurrent !== value.preregistrationRawAtCommit ||
    !isDeepStrictEqual(value.preregistration, preregistrationAtCommit)
  ) {
    issues.push("cross-host lifecycle verifier preregistration artifact is inconsistent");
  }

  const attestation = value.attestation;
  const sourceArtifacts = isRecord(attestation) &&
      Array.isArray(attestation.sourceArtifacts)
    ? attestation.sourceArtifacts
    : [];
  const sourceArtifactsByPath = new Map<string, ArtifactIdentityShape>();
  for (const artifact of sourceArtifacts) {
    if (isArtifactIdentity(artifact) && !sourceArtifactsByPath.has(artifact.path)) {
      sourceArtifactsByPath.set(artifact.path, artifact);
    }
  }
  const frozenSourcesValid =
    sourceArtifacts.length === V073_CROSS_HOST_LIFECYCLE_VERIFIER_SOURCE_PATHS.length &&
    sourceArtifactsByPath.size === V073_CROSS_HOST_LIFECYCLE_VERIFIER_SOURCE_PATHS.length &&
    V073_CROSS_HOST_LIFECYCLE_VERIFIER_SOURCE_PATHS.every((path) => {
      const frozenRaw = V073_CROSS_HOST_LIFECYCLE_VERIFIER_IMPLEMENTATION_PATHS.includes(
          path as (typeof V073_CROSS_HOST_LIFECYCLE_VERIFIER_IMPLEMENTATION_PATHS)[number],
        )
        ? value.implementationSourceRaws[path]
        : value.preregistrationSourceRaws[path];
      const identity = sourceArtifactsByPath.get(path);
      return frozenRaw !== undefined &&
        value.currentSourceRaws[path] === frozenRaw &&
        identity?.bytes === Buffer.byteLength(frozenRaw, "utf8") &&
        identity.sha256 === sha256(frozenRaw);
    });
  if (!frozenSourcesValid) {
    issues.push("cross-host lifecycle verifier frozen source identities are inconsistent");
  }

  const verification = isRecord(attestation) && isRecord(attestation.verification)
    ? attestation.verification
    : undefined;
  const red = verification && isRecord(verification.red)
    ? verification.red
    : undefined;
  const green = verification && isRecord(verification.green)
    ? verification.green
    : undefined;
  const affectedCommand =
    "bun test tests/unit/run-v0-7-release-readiness.test.ts tests/release/release.test.ts";
  const attestationValid =
    isRecord(attestation) &&
    isDeepStrictEqual(attestation, attestationAtCommit) &&
    attestation.artifactKind ===
      "v0.7.3-cross-host-lifecycle-verifier-correction-attestation" &&
    attestation.schemaVersion === 1 &&
    attestation.generatedBy ===
      "v0.7.3-cross-host-lifecycle-verifier-correction-attestation" &&
    Number.isFinite(Date.parse(String(attestation.generatedAt))) &&
    attestation.baselineCommit ===
      V073_CROSS_HOST_LIFECYCLE_VERIFIER_BASELINE_COMMIT &&
    isRecord(attestation.correctionCommits) &&
    attestation.correctionCommits.preregistration === value.preregistrationCommit &&
    attestation.correctionCommits.implementation === value.implementationCommit &&
    Array.isArray(attestation.implementationDiffPaths) &&
    attestation.implementationDiffPaths.every(
      (path): path is string => typeof path === "string",
    ) &&
    samePathSet(
      attestation.implementationDiffPaths,
      V073_CROSS_HOST_LIFECYCLE_VERIFIER_IMPLEMENTATION_PATHS,
    ) &&
    attestation.providerCalls === 0 &&
    red !== undefined &&
    green !== undefined &&
    isCorrectionVerification(
      red.crossHostLifecycleBundle,
      "bun test tests/unit/run-v0-7-release-readiness.test.ts -t \"recomputes the tracked lifecycle bundle under a different verifier home\"",
      1,
      1,
      0,
    ) &&
    isCorrectionVerification(
      red.lineage,
      "bun test tests/unit/run-v0-7-release-readiness.test.ts -t cross-host-lifecycle-verifier-correction-lineage",
      1,
      1,
      0,
    ) &&
    isCorrectionVerification(
      red.releaseWorkflowEvidence,
      "bun test tests/release/release.test.ts -t \"ships the cross-host lifecycle verifier correction evidence\"",
      1,
      1,
      0,
    ) &&
    isCorrectionVerification(green.affectedTests, affectedCommand, 0, 0, 141) &&
    isCorrectionVerification(green.typecheck, "bun run typecheck", 0, 0, 1);
  if (!attestationValid) {
    issues.push("cross-host lifecycle verifier attestation is inconsistent");
  }

  return crossHostLifecycleVerifierCorrectionCheck(issues);
}

export async function evaluateV073CrossHostLifecycleVerifierCorrectionFile(input: {
  currentCommit: string;
  historical?: boolean;
  repoRoot: string;
}): Promise<V07ReleaseReadinessCheck> {
  const startedAt = performance.now();
  try {
    const preregistrationRawCurrent = await readFile(
      join(
        input.repoRoot,
        V073_CROSS_HOST_LIFECYCLE_VERIFIER_CORRECTION_PREREGISTRATION,
      ),
      "utf8",
    );
    const attestationRawCurrent = await readFile(
      join(
        input.repoRoot,
        V073_CROSS_HOST_LIFECYCLE_VERIFIER_CORRECTION_ATTESTATION,
      ),
      "utf8",
    );
    const preregistration = JSON.parse(preregistrationRawCurrent) as unknown;
    const attestation = JSON.parse(attestationRawCurrent) as unknown;
    if (
      !COMMIT_PATTERN.test(input.currentCommit) ||
      !isRecord(attestation) ||
      !isRecord(attestation.correctionCommits) ||
      !COMMIT_PATTERN.test(String(attestation.correctionCommits.implementation)) ||
      attestation.correctionCommits.preregistration !==
        V073_CROSS_HOST_LIFECYCLE_VERIFIER_PREREGISTRATION_COMMIT
    ) {
      throw new Error("cross-host lifecycle verifier commit identities are inconsistent");
    }
    const implementationCommit = String(attestation.correctionCommits.implementation);
    const git = async (args: string[]): Promise<string> => {
      const outcome = await runCommand("git", args, input.repoRoot);
      if (outcome.code !== 0) {
        throw new Error(`git ${args.join(" ")} failed`);
      }
      return outcome.stdout;
    };
    const attestationCommit = (
      await git([
        "log",
        "-1",
        "--format=%H",
        "--diff-filter=A",
        "--",
        V073_CROSS_HOST_LIFECYCLE_VERIFIER_CORRECTION_ATTESTATION,
      ])
    ).trim();
    const [
      preregistrationParentCommit,
      implementationParentCommit,
      attestationParentCommit,
      preregistrationChangedRaw,
      implementationChangedRaw,
      attestationChangedRaw,
      preregistrationRawAtCommit,
      attestationRawAtCommit,
      attestationAncestor,
    ] = await Promise.all([
      git(["rev-parse", `${V073_CROSS_HOST_LIFECYCLE_VERIFIER_PREREGISTRATION_COMMIT}^`]),
      git(["rev-parse", `${implementationCommit}^`]),
      git(["rev-parse", `${attestationCommit}^`]),
      git([
        "diff",
        "--name-only",
        `${V073_CROSS_HOST_LIFECYCLE_VERIFIER_PREREGISTRATION_COMMIT}^`,
        V073_CROSS_HOST_LIFECYCLE_VERIFIER_PREREGISTRATION_COMMIT,
        "--",
      ]),
      git(["diff", "--name-only", `${implementationCommit}^`, implementationCommit, "--"]),
      git(["diff", "--name-only", `${attestationCommit}^`, attestationCommit, "--"]),
      git([
        "show",
        `${V073_CROSS_HOST_LIFECYCLE_VERIFIER_PREREGISTRATION_COMMIT}:${V073_CROSS_HOST_LIFECYCLE_VERIFIER_CORRECTION_PREREGISTRATION}`,
      ]),
      git([
        "show",
        `${attestationCommit}:${V073_CROSS_HOST_LIFECYCLE_VERIFIER_CORRECTION_ATTESTATION}`,
      ]),
      runCommand(
        "git",
        ["merge-base", "--is-ancestor", attestationCommit, input.currentCommit],
        input.repoRoot,
      ),
    ]);
    if (attestationAncestor.code !== 0 && attestationAncestor.code !== 1) {
      throw new Error("cannot compare cross-host attestation and current commits");
    }

    const preregistrationSourceRaws: Record<string, string> = {};
    const implementationSourceRaws: Record<string, string> = {};
    const currentSourceRaws: Record<string, string> = {};
    const sourceOutcomes = await Promise.all(
      V073_CROSS_HOST_LIFECYCLE_VERIFIER_SOURCE_PATHS.flatMap((path) => {
        const sourceCommit = V073_CROSS_HOST_LIFECYCLE_VERIFIER_IMPLEMENTATION_PATHS.includes(
            path as (typeof V073_CROSS_HOST_LIFECYCLE_VERIFIER_IMPLEMENTATION_PATHS)[number],
          )
          ? implementationCommit
          : V073_CROSS_HOST_LIFECYCLE_VERIFIER_PREREGISTRATION_COMMIT;
        return [
          git(["show", `${sourceCommit}:${path}`]),
          git(["show", `${input.currentCommit}:${path}`]),
        ];
      }),
    );
    V073_CROSS_HOST_LIFECYCLE_VERIFIER_SOURCE_PATHS.forEach((path, index) => {
      const sourceRaw = sourceOutcomes[index * 2]!;
      if (V073_CROSS_HOST_LIFECYCLE_VERIFIER_IMPLEMENTATION_PATHS.includes(
        path as (typeof V073_CROSS_HOST_LIFECYCLE_VERIFIER_IMPLEMENTATION_PATHS)[number]
      )) {
        implementationSourceRaws[path] = sourceRaw;
      } else {
        preregistrationSourceRaws[path] = sourceRaw;
      }
      currentSourceRaws[path] = input.historical
        ? sourceRaw
        : sourceOutcomes[index * 2 + 1]!;
    });

    const check = evaluateV073CrossHostLifecycleVerifierCorrection({
      attestation,
      attestationChangedPaths: changedPaths(attestationChangedRaw),
      attestationCommit,
      attestationIsAncestor: attestationAncestor.code === 0,
      attestationParentCommit: attestationParentCommit.trim(),
      attestationRawAtCommit,
      attestationRawCurrent,
      currentCommit: input.historical ? attestationCommit : input.currentCommit,
      currentSourceRaws,
      implementationChangedPaths: changedPaths(implementationChangedRaw),
      implementationCommit,
      implementationParentCommit: implementationParentCommit.trim(),
      implementationSourceRaws,
      preregistration,
      preregistrationChangedPaths: changedPaths(preregistrationChangedRaw),
      preregistrationCommit:
        V073_CROSS_HOST_LIFECYCLE_VERIFIER_PREREGISTRATION_COMMIT,
      preregistrationParentCommit: preregistrationParentCommit.trim(),
      preregistrationRawAtCommit,
      preregistrationRawCurrent,
      preregistrationSourceRaws,
    });
    return { ...check, durationMs: Math.round(performance.now() - startedAt) };
  } catch (error) {
    return {
      detail: `cannot verify cross-host lifecycle verifier correction: ${
        error instanceof Error ? error.message : String(error)
      }`,
      durationMs: Math.round(performance.now() - startedAt),
      id: "v0.7.3-cross-host-lifecycle-verifier-correction",
      required: true,
      status: "fail",
      title: "v0.7.3 cross-host lifecycle verifier correction lineage",
    };
  }
}

interface V073StableSourceTestCorrectionInput {
  attestation: unknown;
  attestationChangedPaths: readonly string[];
  attestationCommit: string;
  attestationIsAncestor: boolean;
  attestationParentCommit: string;
  attestationRawAtCommit: string;
  attestationRawCurrent: string;
  currentCommit: string;
  currentSourceRaws: Readonly<Record<string, string>>;
  implementationChangedPaths: readonly string[];
  implementationCommit: string;
  implementationParentCommit: string;
  implementationSourceRaws: Readonly<Record<string, string>>;
  preregistration: unknown;
  preregistrationChangedPaths: readonly string[];
  preregistrationCommit: string;
  preregistrationParentCommit: string;
  preregistrationRawAtCommit: string;
  preregistrationRawCurrent: string;
  preregistrationSourceRaws: Readonly<Record<string, string>>;
  releaseChangedPaths: readonly string[];
  releaseCommit: string;
  releaseParentCommit: string;
  crossHostLifecycleVerifierCorrectionValid?: boolean;
}

function stableSourceCorrectionCheck(
  issues: readonly string[],
): V07ReleaseReadinessCheck {
  return {
    detail: issues.length === 0
      ? `exact A-R0-D2-G2-A2 stable-source correction is frozen at ${
        V073_STABLE_SOURCE_PREREGISTRATION_COMMIT
      }`
      : issues.join("; "),
    durationMs: 0,
    id: "v0.7.3-stable-source-test-correction",
    required: true,
    status: issues.length === 0 ? "pass" : "fail",
    title: "v0.7.3 stable-source test correction lineage",
  };
}

export function evaluateV073StableSourceTestCorrection(
  input: unknown,
): V07ReleaseReadinessCheck {
  if (!isRecord(input)) {
    return stableSourceCorrectionCheck(["stable-source correction input is malformed"]);
  }
  const value = input as unknown as V073StableSourceTestCorrectionInput;
  if (
    !Array.isArray(value.attestationChangedPaths) ||
    !Array.isArray(value.implementationChangedPaths) ||
    !Array.isArray(value.preregistrationChangedPaths) ||
    !Array.isArray(value.releaseChangedPaths) ||
    !isRecord(value.currentSourceRaws) ||
    !isRecord(value.implementationSourceRaws) ||
    !isRecord(value.preregistrationSourceRaws)
  ) {
    return stableSourceCorrectionCheck(["stable-source correction input is incomplete"]);
  }

  const issues: string[] = [];
  const commits = [
    value.attestationCommit,
    value.attestationParentCommit,
    value.currentCommit,
    value.implementationCommit,
    value.implementationParentCommit,
    value.preregistrationCommit,
    value.preregistrationParentCommit,
    value.releaseCommit,
    value.releaseParentCommit,
  ];
  if (commits.some((commit) => !COMMIT_PATTERN.test(commit))) {
    issues.push("stable-source correction commit identities are malformed");
  }
  if (
    value.releaseCommit !== V073_STABLE_SOURCE_BASELINE_COMMITS.stableSource ||
    value.releaseParentCommit !==
      V073_STABLE_SOURCE_BASELINE_COMMITS.governanceAttestation ||
    !samePathSet(value.releaseChangedPaths, V073_STABLE_SOURCE_RELEASE_PATHS)
  ) {
    issues.push("stable-source release commit is inconsistent");
  }
  if (
    value.preregistrationCommit !== V073_STABLE_SOURCE_PREREGISTRATION_COMMIT ||
    value.preregistrationParentCommit !== value.releaseCommit ||
    !samePathSet(
      value.preregistrationChangedPaths,
      V073_STABLE_SOURCE_PREREGISTRATION_PATHS,
    )
  ) {
    issues.push("stable-source preregistration commit is inconsistent");
  }
  if (
    value.implementationParentCommit !== value.preregistrationCommit ||
    !samePathSet(
      value.implementationChangedPaths,
      V073_STABLE_SOURCE_IMPLEMENTATION_PATHS,
    )
  ) {
    issues.push("stable-source implementation commit is inconsistent");
  }
  if (
    value.attestationParentCommit !== value.implementationCommit ||
    (value.currentCommit !== value.attestationCommit &&
      value.crossHostLifecycleVerifierCorrectionValid !== true) ||
    !value.attestationIsAncestor ||
    !samePathSet(
      value.attestationChangedPaths,
      [V073_STABLE_SOURCE_TEST_CORRECTION_ATTESTATION],
    ) ||
    value.attestationRawAtCommit !== value.attestationRawCurrent
  ) {
    issues.push("stable-source attestation commit is inconsistent");
  }

  let preregistrationAtCommit: unknown;
  let attestationAtCommit: unknown;
  try {
    preregistrationAtCommit = JSON.parse(value.preregistrationRawAtCommit) as unknown;
    attestationAtCommit = JSON.parse(value.attestationRawAtCommit) as unknown;
  } catch {
    preregistrationAtCommit = undefined;
    attestationAtCommit = undefined;
  }
  if (
    Buffer.byteLength(value.preregistrationRawAtCommit, "utf8") !==
      V073_STABLE_SOURCE_PREREGISTRATION_BYTES ||
    sha256(value.preregistrationRawAtCommit) !==
      V073_STABLE_SOURCE_PREREGISTRATION_SHA256 ||
    value.preregistrationRawCurrent !== value.preregistrationRawAtCommit ||
    !isDeepStrictEqual(value.preregistration, preregistrationAtCommit)
  ) {
    issues.push("stable-source preregistration artifact is inconsistent");
  }

  const attestation = value.attestation;
  const sourceArtifacts = isRecord(attestation) &&
      Array.isArray(attestation.sourceArtifacts)
    ? attestation.sourceArtifacts
    : [];
  const sourceArtifactsByPath = new Map<string, ArtifactIdentityShape>();
  for (const artifact of sourceArtifacts) {
    if (isArtifactIdentity(artifact) && !sourceArtifactsByPath.has(artifact.path)) {
      sourceArtifactsByPath.set(artifact.path, artifact);
    }
  }
  const frozenSourcesValid =
    sourceArtifacts.length === V073_STABLE_SOURCE_SOURCE_PATHS.length &&
    sourceArtifactsByPath.size === V073_STABLE_SOURCE_SOURCE_PATHS.length &&
    V073_STABLE_SOURCE_SOURCE_PATHS.every((path) => {
      const frozenRaw = V073_STABLE_SOURCE_IMPLEMENTATION_PATHS.includes(
          path as (typeof V073_STABLE_SOURCE_IMPLEMENTATION_PATHS)[number],
        )
        ? value.implementationSourceRaws[path]
        : value.preregistrationSourceRaws[path];
      const currentRaw = value.currentSourceRaws[path];
      const identity = sourceArtifactsByPath.get(path);
      return frozenRaw !== undefined &&
        (currentRaw === frozenRaw ||
          (value.crossHostLifecycleVerifierCorrectionValid === true &&
            V073_CROSS_HOST_LIFECYCLE_VERIFIER_SOURCE_PATHS.includes(
              path as (typeof V073_CROSS_HOST_LIFECYCLE_VERIFIER_SOURCE_PATHS)[number],
            ))) &&
        identity?.bytes === Buffer.byteLength(frozenRaw, "utf8") &&
        identity.sha256 === sha256(frozenRaw);
    });
  if (!frozenSourcesValid) {
    issues.push("stable-source frozen source identities are inconsistent");
  }

  const verification = isRecord(attestation) && isRecord(attestation.verification)
    ? attestation.verification
    : undefined;
  const red = verification && isRecord(verification.red)
    ? verification.red
    : undefined;
  const green = verification && isRecord(verification.green)
    ? verification.green
    : undefined;
  const affectedCommand =
    "bun test tests/unit/run-v0-7-release-readiness.test.ts " +
    "tests/unit/run-v0-7-3-lifecycle-protection-gate.test.ts " +
    "tests/unit/run-v0-7-3-replacement-protection-gate.test.ts " +
    "tests/unit/run-v0-7-3-full-locomo-claim.test.ts " +
    "tests/unit/capability-descriptor.test.ts tests/release/release.test.ts";
  const attestationValid =
    isRecord(attestation) &&
    isDeepStrictEqual(attestation, attestationAtCommit) &&
    attestation.artifactKind ===
      "v0.7.3-stable-source-test-correction-attestation" &&
    attestation.schemaVersion === 1 &&
    attestation.generatedBy ===
      "v0.7.3-stable-source-test-correction-attestation" &&
    Number.isFinite(Date.parse(String(attestation.generatedAt))) &&
    isDeepStrictEqual(
      attestation.baselineCommits,
      V073_STABLE_SOURCE_BASELINE_COMMITS,
    ) &&
    isRecord(attestation.correctionCommits) &&
    attestation.correctionCommits.preregistration === value.preregistrationCommit &&
    attestation.correctionCommits.implementation === value.implementationCommit &&
    Array.isArray(attestation.implementationDiffPaths) &&
    attestation.implementationDiffPaths.every(
      (path): path is string => typeof path === "string",
    ) &&
    samePathSet(
      attestation.implementationDiffPaths,
      V073_STABLE_SOURCE_IMPLEMENTATION_PATHS,
    ) &&
    attestation.providerCalls === 0 &&
    red !== undefined &&
    green !== undefined &&
    isCorrectionVerification(
      red.affectedTests,
      affectedCommand,
      1,
      46,
      165,
    ) &&
    isCorrectionVerification(
      red.releaseReadiness,
      "bun test tests/unit/run-v0-7-release-readiness.test.ts -t stable-source-correction-lineage",
      1,
      1,
      0,
    ) &&
    isCorrectionVerification(
      red.releaseWorkflowEvidence,
      "bun test tests/release/release.test.ts -t \"ships the stable-source test correction evidence\"",
      1,
      1,
      0,
    ) &&
    isCorrectionVerification(
      green.affectedTests,
      affectedCommand,
      0,
      0,
      213,
    ) &&
    isCorrectionVerification(
      green.typecheck,
      "bun run typecheck",
      0,
      0,
      1,
    );
  if (!attestationValid) {
    issues.push("stable-source attestation is inconsistent");
  }

  return stableSourceCorrectionCheck(issues);
}

export async function evaluateV073StableSourceTestCorrectionFile(input: {
  crossHostLifecycleVerifierCorrectionValid?: boolean;
  currentCommit: string;
  historical?: boolean;
  repoRoot: string;
}): Promise<V07ReleaseReadinessCheck> {
  const startedAt = performance.now();
  try {
    const preregistrationRawCurrent = await readFile(
      join(input.repoRoot, V073_STABLE_SOURCE_TEST_CORRECTION_PREREGISTRATION),
      "utf8",
    );
    const attestationRawCurrent = await readFile(
      join(input.repoRoot, V073_STABLE_SOURCE_TEST_CORRECTION_ATTESTATION),
      "utf8",
    );
    const preregistration = JSON.parse(preregistrationRawCurrent) as unknown;
    const attestation = JSON.parse(attestationRawCurrent) as unknown;
    if (
      !COMMIT_PATTERN.test(input.currentCommit) ||
      !isRecord(attestation) ||
      !isRecord(attestation.correctionCommits) ||
      !COMMIT_PATTERN.test(String(attestation.correctionCommits.implementation)) ||
      attestation.correctionCommits.preregistration !==
        V073_STABLE_SOURCE_PREREGISTRATION_COMMIT
    ) {
      throw new Error("stable-source correction commit identities are inconsistent");
    }
    const implementationCommit = String(
      attestation.correctionCommits.implementation,
    );
    const git = async (args: string[]): Promise<string> => {
      const outcome = await runCommand("git", args, input.repoRoot);
      if (outcome.code !== 0) {
        throw new Error(`git ${args.join(" ")} failed`);
      }
      return outcome.stdout;
    };
    const attestationCommit = (
      await git([
        "log",
        "-1",
        "--format=%H",
        "--diff-filter=A",
        "--",
        V073_STABLE_SOURCE_TEST_CORRECTION_ATTESTATION,
      ])
    ).trim();
    const [
      releaseParentCommit,
      preregistrationParentCommit,
      implementationParentCommit,
      attestationParentCommit,
      releaseChangedRaw,
      preregistrationChangedRaw,
      implementationChangedRaw,
      attestationChangedRaw,
      preregistrationRawAtCommit,
      attestationRawAtCommit,
      attestationAncestor,
    ] = await Promise.all([
      git(["rev-parse", `${V073_STABLE_SOURCE_BASELINE_COMMITS.stableSource}^`]),
      git(["rev-parse", `${V073_STABLE_SOURCE_PREREGISTRATION_COMMIT}^`]),
      git(["rev-parse", `${implementationCommit}^`]),
      git(["rev-parse", `${attestationCommit}^`]),
      git([
        "diff",
        "--name-only",
        `${V073_STABLE_SOURCE_BASELINE_COMMITS.stableSource}^`,
        V073_STABLE_SOURCE_BASELINE_COMMITS.stableSource,
        "--",
      ]),
      git([
        "diff",
        "--name-only",
        `${V073_STABLE_SOURCE_PREREGISTRATION_COMMIT}^`,
        V073_STABLE_SOURCE_PREREGISTRATION_COMMIT,
        "--",
      ]),
      git([
        "diff",
        "--name-only",
        `${implementationCommit}^`,
        implementationCommit,
        "--",
      ]),
      git([
        "diff",
        "--name-only",
        `${attestationCommit}^`,
        attestationCommit,
        "--",
      ]),
      git([
        "show",
        `${V073_STABLE_SOURCE_PREREGISTRATION_COMMIT}:${V073_STABLE_SOURCE_TEST_CORRECTION_PREREGISTRATION}`,
      ]),
      git([
        "show",
        `${attestationCommit}:${V073_STABLE_SOURCE_TEST_CORRECTION_ATTESTATION}`,
      ]),
      runCommand(
        "git",
        ["merge-base", "--is-ancestor", attestationCommit, input.currentCommit],
        input.repoRoot,
      ),
    ]);
    if (attestationAncestor.code !== 0 && attestationAncestor.code !== 1) {
      throw new Error("cannot compare stable-source attestation and current commits");
    }

    const preregistrationSourceRaws: Record<string, string> = {};
    const implementationSourceRaws: Record<string, string> = {};
    const currentSourceRaws: Record<string, string> = {};
    const sourceOutcomes = await Promise.all(
      V073_STABLE_SOURCE_SOURCE_PATHS.flatMap((path) => {
        const sourceCommit = V073_STABLE_SOURCE_IMPLEMENTATION_PATHS.includes(
            path as (typeof V073_STABLE_SOURCE_IMPLEMENTATION_PATHS)[number],
          )
          ? implementationCommit
          : V073_STABLE_SOURCE_PREREGISTRATION_COMMIT;
        return [
          git(["show", `${sourceCommit}:${path}`]),
          git(["show", `${input.currentCommit}:${path}`]),
        ];
      }),
    );
    V073_STABLE_SOURCE_SOURCE_PATHS.forEach((path, index) => {
      const sourceRaw = sourceOutcomes[index * 2]!;
      if (V073_STABLE_SOURCE_IMPLEMENTATION_PATHS.includes(
        path as (typeof V073_STABLE_SOURCE_IMPLEMENTATION_PATHS)[number]
      )) {
        implementationSourceRaws[path] = sourceRaw;
      } else {
        preregistrationSourceRaws[path] = sourceRaw;
      }
      currentSourceRaws[path] = input.historical
        ? sourceRaw
        : sourceOutcomes[index * 2 + 1]!;
    });

    const check = evaluateV073StableSourceTestCorrection({
      attestation,
      attestationChangedPaths: changedPaths(attestationChangedRaw),
      attestationCommit,
      attestationIsAncestor: attestationAncestor.code === 0,
      attestationParentCommit: attestationParentCommit.trim(),
      attestationRawAtCommit,
      attestationRawCurrent,
      currentCommit: input.historical ? attestationCommit : input.currentCommit,
      currentSourceRaws,
      crossHostLifecycleVerifierCorrectionValid:
        input.crossHostLifecycleVerifierCorrectionValid,
      implementationChangedPaths: changedPaths(implementationChangedRaw),
      implementationCommit,
      implementationParentCommit: implementationParentCommit.trim(),
      implementationSourceRaws,
      preregistration,
      preregistrationChangedPaths: changedPaths(preregistrationChangedRaw),
      preregistrationCommit: V073_STABLE_SOURCE_PREREGISTRATION_COMMIT,
      preregistrationParentCommit: preregistrationParentCommit.trim(),
      preregistrationRawAtCommit,
      preregistrationRawCurrent,
      preregistrationSourceRaws,
      releaseChangedPaths: changedPaths(releaseChangedRaw),
      releaseCommit: V073_STABLE_SOURCE_BASELINE_COMMITS.stableSource,
      releaseParentCommit: releaseParentCommit.trim(),
    });
    return {
      ...check,
      durationMs: Math.round(performance.now() - startedAt),
    };
  } catch (error) {
    return {
      detail: `cannot verify stable-source test correction: ${
        error instanceof Error ? error.message : String(error)
      }`,
      durationMs: Math.round(performance.now() - startedAt),
      id: "v0.7.3-stable-source-test-correction",
      required: true,
      status: "fail",
      title: "v0.7.3 stable-source test correction lineage",
    };
  }
}

function isAllowedPostCandidatePath(path: string): boolean {
  return ALLOWED_POST_CANDIDATE_PATHS.has(path);
}

function releaseStatus(value: unknown): unknown {
  if (!isRecord(value) || !isRecord(value.goodmemoryRelease)) {
    return undefined;
  }
  return value.goodmemoryRelease.status;
}

function packageWithoutReleaseStatus(value: unknown): unknown {
  const copy = JSON.parse(JSON.stringify(value)) as unknown;
  if (isRecord(copy) && isRecord(copy.goodmemoryRelease)) {
    copy.goodmemoryRelease = {
      ...copy.goodmemoryRelease,
      status: "<release-status>",
    };
  }
  return copy;
}

function packageStatusOnlyChangeAllowed(
  candidatePackage: unknown,
  currentPackage: unknown,
): boolean {
  if (!isRecord(candidatePackage) || !isRecord(currentPackage)) {
    return false;
  }
  const candidateStatus = releaseStatus(candidatePackage);
  const currentStatus = releaseStatus(currentPackage);
  const statusAllowed =
    candidateStatus === currentStatus ||
    (candidateStatus === "release-candidate" && currentStatus === "stable");
  return statusAllowed &&
    JSON.stringify(packageWithoutReleaseStatus(candidatePackage)) ===
      JSON.stringify(packageWithoutReleaseStatus(currentPackage));
}

export function evaluateV073LifecycleProtectionSourceDrift(input: {
  crossHostLifecycleVerifierCorrectionValid?: boolean;
  candidateCommit: string;
  candidatePackage: unknown;
  changedPaths: readonly string[];
  currentCommit: string;
  currentPackage: unknown;
  isAncestor: boolean;
}): V07ReleaseReadinessCheck {
  const issues: string[] = [];
  if (!input.isAncestor) {
    issues.push(
      `measured candidate ${input.candidateCommit} is not an ancestor of ${input.currentCommit}`,
    );
  }
  const forbiddenPaths = input.changedPaths.filter(
    (path) =>
      !isAllowedPostCandidatePath(path) &&
      !(input.crossHostLifecycleVerifierCorrectionValid === true &&
        V073_CROSS_HOST_LIFECYCLE_VERIFIER_CHANGE_PATHS.has(path)),
  );
  if (forbiddenPaths.length > 0) {
    issues.push(`execution surface changed after measurement: ${forbiddenPaths.join(", ")}`);
  }
  if (
    input.changedPaths.includes("package.json") &&
    !packageStatusOnlyChangeAllowed(input.candidatePackage, input.currentPackage)
  ) {
    issues.push(
      "package.json changed beyond goodmemoryRelease.status release-candidate -> stable",
    );
  }

  return {
    detail: issues.length === 0
      ? input.candidateCommit === input.currentCommit
        ? `release source is the measured candidate ${input.candidateCommit}`
        : `release source is an evidence-only descendant of measured candidate ${input.candidateCommit}`
      : issues.join("; "),
    durationMs: 0,
    id: "v0.7.3-lifecycle-source",
    required: true,
    status: issues.length === 0 ? "pass" : "fail",
    title: "v0.7.3 measured-candidate source stability",
  };
}

export function evaluateV073HistoricalSourceLineage(input: {
  candidateCommit: string;
  currentCommit: string;
  isAncestor: boolean;
}): V07ReleaseReadinessCheck {
  const valid = COMMIT_PATTERN.test(input.candidateCommit) &&
    COMMIT_PATTERN.test(input.currentCommit) && input.isAncestor;
  return {
    detail: valid
      ? `historical v${HISTORICAL_LOCOMO_VERSION} measured candidate ${input.candidateCommit} is retained in the ${RELEASE_VERSION} source lineage`
      : `historical measured candidate ${input.candidateCommit} is not an ancestor of ${input.currentCommit}`,
    durationMs: 0,
    id: "v0.7.3-lifecycle-source",
    required: true,
    status: valid ? "pass" : "fail",
    title: "v0.7.3 measured-candidate historical lineage",
  };
}

export async function evaluateV073LifecycleProtectionArtifactFile(input: {
  artifactPath: string;
  currentCommit: string;
  repoRoot: string;
}): Promise<V07ReleaseReadinessCheck[]> {
  const startedAt = performance.now();
  try {
    const artifact = JSON.parse(await readFile(input.artifactPath, "utf8")) as unknown;
    const artifactCheck = evaluateV073LifecycleProtectionArtifact({
      artifact,
      artifactPath: input.artifactPath,
    });
    const measuredCheck = {
      ...artifactCheck,
      durationMs: Math.round(performance.now() - startedAt),
    };
    if (artifactCheck.status !== "pass" || !isRecord(artifact)) {
      return [measuredCheck];
    }
    const bundleCheck = await evaluateV073LifecycleProtectionBundle({
      artifact,
      artifactPath: input.artifactPath,
      repoRoot: input.repoRoot,
    });
    if (bundleCheck.status !== "pass") {
      return [bundleCheck];
    }
    const lifecycleCandidateCommit = String(artifact.candidateCommit);
    const packageJson = JSON.parse(
      await readFile(join(input.repoRoot, "package.json"), "utf8"),
    ) as PackageJson;
    const historical = packageJson.version === RELEASE_VERSION;
    const claimCandidateChecks: V07ReleaseReadinessCheck[] = [];
    const currentProjectionExists = await pathExists(
      join(input.repoRoot, V073_LOCOMO_CURRENT_PROJECTION),
    );
    let projection: unknown = undefined;
    if (
      packageJson.goodmemoryRelease?.status === "stable" ||
      currentProjectionExists
    ) {
      try {
        projection = JSON.parse(
          await readFile(join(input.repoRoot, V073_LOCOMO_CURRENT_PROJECTION), "utf8"),
        ) as unknown;
      } catch {
        projection = undefined;
      }
    }
    let preregistration: unknown = undefined;
    const preregistrationPath = join(
      input.repoRoot,
      V073_FULL_CLAIM_PROTOCOL2_PREREGISTRATION_PATH,
    );
    if (await pathExists(preregistrationPath)) {
      try {
        preregistration = JSON.parse(
          await readFile(preregistrationPath, "utf8"),
        ) as unknown;
      } catch {
        preregistration = undefined;
      }
    }
    const projectionCommit = isRecord(projection) &&
        isRecord(projection.runIdentity) &&
        COMMIT_PATTERN.test(String(projection.runIdentity.commit))
      ? String(projection.runIdentity.commit)
      : undefined;
    const preregisteredCommit = isRecord(preregistration) &&
        COMMIT_PATTERN.test(String(preregistration.protocolCandidateCommit))
      ? String(preregistration.protocolCandidateCommit)
      : undefined;
    const protocolCandidateCommit = projectionCommit ??
      preregisteredCommit ?? input.currentCommit;
    if (
      packageJson.goodmemoryRelease?.status === "stable" ||
      currentProjectionExists
    ) {
      claimCandidateChecks.push(evaluateStableLocomoCandidateLink({
        protocolCandidateCommit,
        candidatePromptSha256: String(artifact.candidatePromptSha256),
        projection,
      }));
    }
    const [
      lifecycleAncestor,
      lifecycleChanged,
      releaseAncestor,
      releaseChanged,
    ] = await Promise.all([
      runCommand(
        "git",
        [
          "merge-base",
          "--is-ancestor",
          lifecycleCandidateCommit,
          protocolCandidateCommit,
        ],
        input.repoRoot,
      ),
      runCommand(
        "git",
        [
          "diff",
          "--name-only",
          `${lifecycleCandidateCommit}..${protocolCandidateCommit}`,
          "--",
        ],
        input.repoRoot,
      ),
      runCommand(
        "git",
        ["merge-base", "--is-ancestor", protocolCandidateCommit, input.currentCommit],
        input.repoRoot,
      ),
      runCommand(
        "git",
        ["diff", "--name-only", `${protocolCandidateCommit}..${input.currentCommit}`, "--"],
        input.repoRoot,
      ),
    ]);
    if (
      (lifecycleAncestor.code !== 0 && lifecycleAncestor.code !== 1) ||
      lifecycleChanged.code !== 0 ||
      (releaseAncestor.code !== 0 && releaseAncestor.code !== 1) ||
      releaseChanged.code !== 0
    ) {
      return [
        bundleCheck,
        ...claimCandidateChecks,
        {
          detail: "cannot compare the measured candidate with the release source",
          durationMs: Math.round(performance.now() - startedAt),
          id: "v0.7.3-lifecycle-source",
          required: true,
          status: "fail",
          title: "v0.7.3 measured-candidate source stability",
        },
      ];
    }
    const lifecycleChangedPaths = lifecycleChanged.stdout
      .split(/\r?\n/u)
      .map((path) => path.trim())
      .filter(Boolean);
    const releaseChangedPaths = releaseChanged.stdout
      .split(/\r?\n/u)
      .map((path) => path.trim())
      .filter(Boolean);
    let dependencyPinningValid: boolean | undefined;
    if (
      V073_PROTOCOL_DEPENDENCY_PIN_PATHS.some((path) =>
        lifecycleChangedPaths.includes(path))
    ) {
      const outcomes = await Promise.all(
        V073_PROTOCOL_DEPENDENCY_PIN_PATHS.flatMap((path) => [
          runCommand(
            "git",
            ["show", `${lifecycleCandidateCommit}:${path}`],
            input.repoRoot,
          ),
          runCommand(
            "git",
            ["show", `${protocolCandidateCommit}:${path}`],
            input.repoRoot,
          ),
        ]),
      );
      if (outcomes.every((outcome) => outcome.code === 0)) {
        const lifecycleRaws = {} as Record<
          (typeof V073_PROTOCOL_DEPENDENCY_PIN_PATHS)[number],
          string
        >;
        const protocolRaws = {} as Record<
          (typeof V073_PROTOCOL_DEPENDENCY_PIN_PATHS)[number],
          string
        >;
        V073_PROTOCOL_DEPENDENCY_PIN_PATHS.forEach((path, index) => {
          lifecycleRaws[path] = outcomes[index * 2]!.stdout;
          protocolRaws[path] = outcomes[index * 2 + 1]!.stdout;
        });
        dependencyPinningValid = isV073ProtocolDependencyPinningExact({
          lifecycleRaws,
          protocolRaws,
        });
      } else {
        dependencyPinningValid = false;
      }
    }
    let candidatePackage: unknown = undefined;
    let currentPackage: unknown = undefined;
    if (releaseChangedPaths.includes("package.json")) {
      const candidatePackageOutcome = await runCommand(
        "git",
        ["show", `${protocolCandidateCommit}:package.json`],
        input.repoRoot,
      );
      if (candidatePackageOutcome.code !== 0) {
        throw new Error("cannot read candidate package.json");
      }
      candidatePackage = JSON.parse(candidatePackageOutcome.stdout) as unknown;
      currentPackage = JSON.parse(
        await readFile(join(input.repoRoot, "package.json"), "utf8"),
      ) as unknown;
    }
    const protocolSourceCheck = evaluateV073LifecycleToProtocolSourceDrift({
      changedPaths: lifecycleChangedPaths,
      dependencyPinningValid,
      isAncestor: lifecycleAncestor.code === 0,
      lifecycleCandidateCommit,
      protocolCandidateCommit,
    });
    const crossHostLifecycleVerifierCorrectionCheck =
      releaseChangedPaths.some((path) =>
          V073_CROSS_HOST_LIFECYCLE_VERIFIER_CHANGE_PATHS.has(path)
        )
        ? await evaluateV073CrossHostLifecycleVerifierCorrectionFile({
          currentCommit: input.currentCommit,
          historical,
          repoRoot: input.repoRoot,
        })
        : undefined;
    const crossHostLifecycleVerifierCorrectionValid =
      crossHostLifecycleVerifierCorrectionCheck?.status === "pass";
    const stableSourceCorrectionCheck = releaseChangedPaths.some((path) =>
        V073_STABLE_SOURCE_CHANGE_PATHS.has(path)
      )
      ? await evaluateV073StableSourceTestCorrectionFile({
        crossHostLifecycleVerifierCorrectionValid,
        currentCommit: input.currentCommit,
        historical,
        repoRoot: input.repoRoot,
      })
      : undefined;
    const sourceCheck = historical
      ? evaluateV073HistoricalSourceLineage({
        candidateCommit: protocolCandidateCommit,
        currentCommit: input.currentCommit,
        isAncestor: releaseAncestor.code === 0,
      })
      : evaluateV073LifecycleProtectionSourceDrift({
        candidateCommit: protocolCandidateCommit,
        candidatePackage,
        changedPaths: releaseChangedPaths,
        crossHostLifecycleVerifierCorrectionValid,
        currentCommit: input.currentCommit,
        currentPackage,
        isAncestor: releaseAncestor.code === 0,
      });
    const governanceCorrectionCheck = releaseChangedPaths.some((path) =>
        V073_PUBLIC_CLAIM_GOVERNANCE_CHANGE_PATHS.has(path)
      )
      ? await evaluateV073PublicClaimGovernanceCorrectionFile({
        crossHostLifecycleVerifierCorrectionValid,
        currentCommit: input.currentCommit,
        historical,
        repoRoot: input.repoRoot,
        stableSourceCorrectionValid:
          stableSourceCorrectionCheck?.status === "pass",
      })
      : undefined;
    return [
      bundleCheck,
      ...claimCandidateChecks,
      {
        ...protocolSourceCheck,
        durationMs: Math.round(performance.now() - startedAt),
      },
      {
        ...sourceCheck,
        durationMs: Math.round(performance.now() - startedAt),
      },
      ...(stableSourceCorrectionCheck ? [stableSourceCorrectionCheck] : []),
      ...(crossHostLifecycleVerifierCorrectionCheck
        ? [crossHostLifecycleVerifierCorrectionCheck]
        : []),
      ...(governanceCorrectionCheck ? [governanceCorrectionCheck] : []),
    ];
  } catch (error) {
    return [{
      detail: `cannot read lifecycle protection artifact ${input.artifactPath}: ${
        error instanceof Error ? error.message : String(error)
      }`,
      durationMs: Math.round(performance.now() - startedAt),
      id: "v0.7.3-lifecycle-protection",
      required: true,
      status: "fail",
      title: "v0.7.3 paired lifecycle protection evidence",
    }];
  }
}

export function evaluateV07PackManifest(
  files: readonly string[],
  tarballBytes: number,
): string[] {
  const present = new Set(files);
  const missing = REQUIRED_PACKED_FILES.filter((file) => !present.has(file));
  const issues: string[] = [];

  if (missing.length > 0) {
    issues.push(`tarball missing: ${missing.join(", ")}`);
  }
  if (tarballBytes >= MAX_TARBALL_BYTES) {
    issues.push(
      `compressed tarball ${tarballBytes} bytes must be below ${MAX_TARBALL_BYTES} bytes`,
    );
  }

  return issues;
}

function runCommand(
  command: string,
  args: readonly string[],
  cwd: string,
  options: { logGroupName?: string } = {},
): Promise<CommandOutcome> {
  return new Promise((resolve) => {
    const startedAt = performance.now();
    const child = spawn(command, args, {
      cwd,
      env: process.env,
    });
    let stdout = "";
    let stderr = "";
    let groupClosed = false;
    const closeGroup = () => {
      if (options.logGroupName === undefined || groupClosed) {
        return;
      }
      groupClosed = true;
      process.stdout.write("::endgroup::\n");
    };

    if (options.logGroupName !== undefined) {
      process.stdout.write(`::group::${options.logGroupName}\n`);
    }

    child.stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stdout += text;
      if (options.logGroupName !== undefined) {
        process.stdout.write(text);
      }
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stderr += text;
      if (options.logGroupName !== undefined) {
        process.stderr.write(text);
      }
    });
    child.on("error", (error: Error) => {
      closeGroup();
      resolve({
        code: null,
        durationMs: Math.round(performance.now() - startedAt),
        stderr: String(error),
        stdout,
      });
    });
    child.on("close", (code: number | null) => {
      closeGroup();
      resolve({
        code,
        durationMs: Math.round(performance.now() - startedAt),
        stderr,
        stdout,
      });
    });
  });
}

export async function collectV07SourceIdentity(repoRoot: string): Promise<{
  check: V07ReleaseReadinessCheck;
  sourceIdentity: V07SourceIdentity;
}> {
  const [commit, tree, status] = await Promise.all([
    runCommand("git", ["rev-parse", "HEAD"], repoRoot),
    runCommand("git", ["rev-parse", "HEAD^{tree}"], repoRoot),
    runCommand(
      "git",
      ["status", "--porcelain", "--untracked-files=all"],
      repoRoot,
    ),
  ]);
  return evaluateV07SourceIdentity({
    commitSha: commit.code === 0 ? commit.stdout : "",
    status: status.code === 0 ? status.stdout : status.stderr || "git status failed",
    treeSha: tree.code === 0 ? tree.stdout : "",
  });
}

export async function evaluateV07ReleaseSourceIdentity(input: {
  releaseStatus: string | undefined;
  repoRoot: string;
  version: string;
}): Promise<V07ReleaseReadinessCheck> {
  const startedAt = performance.now();
  if (
    input.releaseStatus !== "release-candidate" &&
    input.releaseStatus !== "stable"
  ) {
    return {
      detail: "release status must be release-candidate or stable",
      durationMs: Math.round(performance.now() - startedAt),
      id: "release-source-identity",
      required: true,
      status: "fail",
      title: "Release source tag identity",
    };
  }
  try {
    await assertV07ReleaseSourceIdentity({
      releaseStatus: input.releaseStatus,
      repoRoot: input.repoRoot,
      version: input.version,
    });
    return {
      detail: input.releaseStatus === "stable"
        ? `clean HEAD matches peeled v${input.version} tag`
        : "release-candidate tag identity is not applicable",
      durationMs: Math.round(performance.now() - startedAt),
      id: "release-source-identity",
      required: true,
      status: "pass",
      title: "Release source tag identity",
    };
  } catch (error) {
    return {
      detail: error instanceof Error ? error.message : String(error),
      durationMs: Math.round(performance.now() - startedAt),
      id: "release-source-identity",
      required: true,
      status: "fail",
      title: "Release source tag identity",
    };
  }
}

async function collectV07RuntimeIdentity(repoRoot: string): Promise<{
  check: V07ReleaseReadinessCheck;
  runtime: V07RuntimeIdentity;
}> {
  const [node, bun] = await Promise.all([
    runCommand("node", ["--version"], repoRoot),
    runCommand("bun", ["--version"], repoRoot),
  ]);
  const runtime = {
    bunVersion: bun.code === 0 ? bun.stdout.trim() : "",
    nodeVersion: node.code === 0 ? node.stdout.trim() : "",
  };
  return {
    check: evaluateV07RuntimeVersions(runtime),
    runtime,
  };
}

function tail(value: string, lineCount = 12): string {
  return value.trimEnd().split("\n").slice(-lineCount).join("\n");
}

export function summarizeCommandFailureOutput(output: string): string {
  const lines = output.trimEnd().split("\n");
  const selected = new Set<number>();
  const signalPatterns = [
    /^\(fail\)/u,
    /\^ this test timed out/u,
    /^FAIL\b/u,
    /^\s*[1-9]\d* fail\b/u,
  ];

  for (const [index, line] of lines.entries()) {
    if (!signalPatterns.some((pattern) => pattern.test(line.trim()))) {
      continue;
    }
    const start = Math.max(0, index - FAILURE_CONTEXT_LINES);
    const end = Math.min(lines.length, index + FAILURE_CONTEXT_LINES + 1);
    for (let selectedIndex = start; selectedIndex < end; selectedIndex += 1) {
      selected.add(selectedIndex);
    }
  }

  if (selected.size === 0) {
    return tail(output, FAILURE_DETAIL_LINE_LIMIT);
  }

  return [...selected]
    .sort((a, b) => a - b)
    .map((index) => lines[index])
    .slice(0, FAILURE_DETAIL_LINE_LIMIT)
    .join("\n");
}

function commandCheck(input: {
  id: string;
  outcome: CommandOutcome;
  successDetail: string;
  title: string;
}): V07ReleaseReadinessCheck {
  return {
    detail:
      input.outcome.code === 0
        ? input.successDetail
        : summarizeCommandFailureOutput(
            [input.outcome.stdout, input.outcome.stderr].filter(Boolean).join("\n"),
          ),
    durationMs: input.outcome.durationMs,
    id: input.id,
    required: true,
    status: input.outcome.code === 0 ? "pass" : "fail",
    title: input.title,
  };
}

export async function evaluateVersionConsistency(
  repoRoot: string,
): Promise<V07ReleaseReadinessCheck> {
  const startedAt = performance.now();
  const packageJson = JSON.parse(
    await readFile(join(repoRoot, "package.json"), "utf8"),
  ) as PackageJson;
  const packageLock = JSON.parse(
    await readFile(join(repoRoot, "package-lock.json"), "utf8"),
  ) as PackageLock;
  const capability = JSON.parse(
    await readFile(join(repoRoot, ".well-known/goodmemory.json"), "utf8"),
  ) as CapabilityDescriptor;
  const server = JSON.parse(
    await readFile(join(repoRoot, "server.json"), "utf8"),
  ) as ServerDescriptor;
  const installSurfaces = await Promise.all(
    [
      "README.md",
      "README.zh-CN.md",
      "docs/GoodMemory-15-Minute-App-Integration.md",
      "docs/GoodMemory-Standalone-MCP-Setup-Guide.md",
      "llms.txt",
    ].map((path) => readFile(join(repoRoot, path), "utf8")),
  );
  const issues: string[] = [];
  const packageRelease = packageJson.goodmemoryRelease;
  const capabilityRelease = capability.releaseStatus;

  if (packageJson.version !== RELEASE_VERSION) {
    issues.push(`package.json version is ${packageJson.version}, expected ${RELEASE_VERSION}`);
  }
  if (
    (packageRelease?.status !== "release-candidate" &&
      packageRelease?.status !== "stable") ||
    packageRelease?.npmDistTag !== "latest" ||
    packageRelease?.installCommandsApplyAfterPublish !== true
  ) {
    issues.push("package.json must describe the 0.7 release candidate or stable source");
  }
  if (
    packageLock.version !== RELEASE_VERSION ||
    packageLock.packages?.[""]?.version !== RELEASE_VERSION
  ) {
    issues.push(
      `package-lock.json root versions do not match ${RELEASE_VERSION}`,
    );
  }
  if (!packageJson.files?.includes(V073_LOCOMO_CURRENT_PROJECTION)) {
    issues.push(
      `package.json files must include ${V073_LOCOMO_CURRENT_PROJECTION}`,
    );
  }
  if (
    capability.version !== RELEASE_VERSION ||
    capability.install?.npmGlobal !== `npm install -g goodmemory@${RELEASE_VERSION}` ||
    capability.install.npmPackage !== `npm install goodmemory@${RELEASE_VERSION}` ||
    capability.install.bun !== `bun add goodmemory@${RELEASE_VERSION}`
  ) {
    issues.push(
      `capability descriptor version/install commands do not match ${RELEASE_VERSION}`,
    );
  }
  if (
    capabilityRelease?.status !== packageRelease?.status ||
    capabilityRelease?.npmDistTag !== packageRelease?.npmDistTag ||
    capabilityRelease?.tarball !== `goodmemory-${RELEASE_VERSION}.tgz` ||
    capabilityRelease?.installCommandsApplyAfterPublish !==
      packageRelease?.installCommandsApplyAfterPublish
  ) {
    issues.push("capability descriptor release contract does not match package.json");
  }
  if (
    server.version !== RELEASE_VERSION ||
    server.packages?.length !== 1 ||
    server.packages?.some((entry) => entry.version !== RELEASE_VERSION)
  ) {
    issues.push(`server.json versions do not match ${RELEASE_VERSION}`);
  }
  if (
    installSurfaces.some(
      (surface) => {
        const installedVersions = [
          ...surface.matchAll(/goodmemory@(\d+\.\d+\.\d+)/gu),
        ].map((match) => match[1]);
        return (
          !installedVersions.includes(RELEASE_VERSION) ||
          installedVersions.some((version) => version !== RELEASE_VERSION)
        );
      },
    )
  ) {
    issues.push(
      `install guides do not consistently target ${RELEASE_VERSION}`,
    );
  }

  const benchmarkVersions =
    capability.benchmarks?.currentClaims?.map(
      (claim) => claim.measuredPackageVersion,
    ) ?? [];
  if (benchmarkVersions.length > 0) {
    issues.push(
      `${RELEASE_VERSION} has no newly measured current benchmark claim; v${HISTORICAL_LOCOMO_VERSION} evidence must remain historical`,
    );
  }
  issues.push(...await evaluateV073CurrentLocomoClaimState({
    claims: capability.benchmarks?.currentClaims ?? [],
    releaseStatus: packageRelease?.status,
    repoRoot,
  }));

  return {
    detail:
      issues.length === 0
        ? `${packageRelease?.status} ${RELEASE_VERSION} source metadata is aligned; mutable npm state is not encoded; earlier-version benchmark evidence is not labeled current`
        : issues.join("; "),
    durationMs: Math.round(performance.now() - startedAt),
    id: "version",
    required: true,
    status: issues.length === 0 ? "pass" : "fail",
    title: "Version consistency and benchmark provenance",
  };
}

async function evaluatePack(repoRoot: string): Promise<V07ReleaseReadinessCheck> {
  const packDirectory = await mkdtemp(join(tmpdir(), "goodmemory-v07-pack-"));
  const startedAt = performance.now();

  try {
    const outcome = await runCommand(
      "npm",
      ["pack", "--json", "--ignore-scripts", "--pack-destination", packDirectory],
      repoRoot,
    );
    if (outcome.code !== 0) {
      return {
        detail: tail(outcome.stderr || outcome.stdout),
        durationMs: outcome.durationMs,
        id: "pack",
        required: true,
        status: "fail",
        title: "Package manifest and size",
      };
    }

    const parsed = JSON.parse(outcome.stdout) as Array<{
      filename?: string;
      files?: Array<{ path: string }>;
    }>;
    const result = parsed[0];
    const filename = result?.filename;
    if (!filename) {
      throw new Error("npm pack did not report a tarball filename");
    }
    const tarballBytes = (await stat(join(packDirectory, filename))).size;
    const files = (result.files ?? []).map((file) => file.path);
    const issues = evaluateV07PackManifest(files, tarballBytes);

    return {
      detail:
        issues.length === 0
          ? `${files.length} packed files; compressed tarball ${tarballBytes} bytes (< 4 MiB)`
          : issues.join("; "),
      durationMs: Math.round(performance.now() - startedAt),
      id: "pack",
      required: true,
      status: issues.length === 0 ? "pass" : "fail",
      title: "Package manifest and size",
    };
  } finally {
    await rm(packDirectory, { force: true, recursive: true });
  }
}

export function evaluateV07PackedProductionDependencyClosure(input: {
  auditExitCode: number;
  auditRaw: string;
  packageLockRaw: string;
}): string[] {
  const issues: string[] = [];
  let packageLock: unknown;
  let audit: unknown;
  try {
    packageLock = JSON.parse(input.packageLockRaw) as unknown;
    audit = JSON.parse(input.auditRaw) as unknown;
  } catch {
    return ["packed production dependency evidence is not valid JSON"];
  }
  const packages = isRecord(packageLock) && isRecord(packageLock.packages)
    ? packageLock.packages
    : {};
  const undiciVersions = Object.entries(packages)
    .filter(([path]) => /(?:^|\/)node_modules\/undici$/u.test(path))
    .map(([, value]) => isRecord(value) ? value.version : undefined)
    .filter((version): version is string => typeof version === "string");
  if (undiciVersions.some((version) => /^5\./u.test(version))) {
    issues.push("packed production dependency closure must not install undici 5.x");
  }
  const vulnerabilities = isRecord(audit) && isRecord(audit.metadata) &&
      isRecord(audit.metadata.vulnerabilities)
    ? audit.metadata.vulnerabilities
    : undefined;
  const high = vulnerabilities?.high;
  const critical = vulnerabilities?.critical;
  if (typeof high !== "number" || typeof critical !== "number") {
    issues.push("packed production dependency audit summary is missing");
  } else if (high > 0 || critical > 0) {
    issues.push(
      `packed production dependency audit reported ${high} high and ${critical} critical vulnerabilities`,
    );
  } else if (input.auditExitCode !== 0) {
    issues.push("packed production dependency audit command failed");
  }
  return issues;
}

export function renderV07LanguageConsumerSmoke(): string {
  return `
import {
  createChineseLanguagePack,
  createEnglishLanguagePack,
  createFrenchLanguagePack,
  createJapaneseLanguagePack,
  createKoreanLanguagePack,
  createLanguageService,
  createSpanishLanguagePack,
} from "goodmemory";

const language = createLanguageService({
  defaultLocale: "zh-TW",
  packs: [
    createEnglishLanguagePack(),
    createChineseLanguagePack("Hans"),
    createChineseLanguagePack("Hant"),
    createJapaneseLanguagePack(),
    createKoreanLanguagePack(),
    createFrenchLanguagePack(),
    createSpanishLanguagePack(),
  ],
});
const english = language.resolveFromText({ locale: "en-US", text: "release memory" });
const simplified = language.resolveFromText({ locale: "zh-CN", text: "简体中文记忆" });
const traditional = language.resolveFromText({ locale: "zh-TW", text: "繁體中文記憶" });
const japanese = language.resolveFromText({ locale: "ja-JP", text: "日本語の記憶" });
const korean = language.resolveFromText({ locale: "ko-KR", text: "한국어 기억" });
const french = language.resolveFromText({ locale: "fr-FR", text: "mémoire française" });
const spanish = language.resolveFromText({ locale: "es-ES", text: "memoria española" });
if (english.languagePackId !== "en") throw new Error("English pack unresolved");
if (!language.buildSearchTerms("release memory", english).includes("release")) {
  throw new Error("English search terms unavailable");
}
if (simplified.languagePackId !== "zh-Hans") throw new Error("zh-Hans pack unresolved");
if (!language.buildSearchTerms("简体中文记忆", simplified).includes("简体")) {
  throw new Error("zh-Hans search terms unavailable");
}
if (traditional.languagePackId !== "zh-Hant") throw new Error("zh-Hant pack unresolved");
if (!language.buildSearchTerms("繁體中文記憶", traditional).includes("繁體")) {
  throw new Error("zh-Hant search terms unavailable");
}
if (japanese.languagePackId !== "ja") throw new Error("Japanese pack unresolved");
if (!language.buildSearchTerms("日本語の記憶", japanese).includes("日本語")) {
  throw new Error("Japanese search terms unavailable");
}
if (korean.languagePackId !== "ko") throw new Error("Korean pack unresolved");
if (!language.buildSearchTerms("한국어 기억", korean).includes("한국어")) {
  throw new Error("Korean search terms unavailable");
}
if (french.languagePackId !== "fr") throw new Error("French pack unresolved");
if (!language.buildSearchTerms("mémoire française", french).includes("mémoire")) {
  throw new Error("French search terms unavailable");
}
if (spanish.languagePackId !== "es") throw new Error("Spanish pack unresolved");
if (!language.buildSearchTerms("memoria española", spanish).includes("memoria")) {
  throw new Error("Spanish search terms unavailable");
}
console.log("LANGUAGE_CONSUMER_OK");
`;
}

export async function verifyV07ArtifactConsumers(input: {
  artifactPath?: string;
  repoRoot: string;
}): Promise<V07RuntimeIdentity> {
  const smokeDirectory = await mkdtemp(join(tmpdir(), "goodmemory-v07-consumer-"));

  try {
    let tarballPath = input.artifactPath;
    if (!tarballPath) {
      const packDirectory = join(smokeDirectory, "pack");
      await mkdir(packDirectory, { recursive: true });
      const packed = await runCommand(
        "bun",
        ["pm", "pack", "--destination", packDirectory, "--quiet"],
        input.repoRoot,
      );
      const tarballOutput = packed.stdout
        .trim()
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter((line) => line.endsWith(".tgz"))
        .at(-1);
      if (packed.code !== 0 || !tarballOutput) {
        throw new Error(tail(packed.stderr || packed.stdout));
      }
      tarballPath = tarballOutput.startsWith("/")
        ? tarballOutput
        : join(packDirectory, tarballOutput);
    }
    await writeFile(
      join(smokeDirectory, "package.json"),
      `${JSON.stringify({
        dependencies: { goodmemory: `file:${tarballPath}` },
        private: true,
        type: "module",
      }, null, 2)}\n`,
      "utf8",
    );
    const installed = await runCommand(
      "npm",
      ["install", "--ignore-scripts", "--engine-strict", "--no-audit", "--no-fund"],
      smokeDirectory,
    );
    if (installed.code !== 0) {
      throw new Error(tail(installed.stderr || installed.stdout));
    }
    const audit = await runCommand(
      "npm",
      ["audit", "--omit=dev", "--audit-level=high", "--json"],
      smokeDirectory,
    );
    const dependencyIssues = evaluateV07PackedProductionDependencyClosure({
      auditExitCode: audit.code ?? -1,
      auditRaw: audit.stdout,
      packageLockRaw: await readFile(
        join(smokeDirectory, "package-lock.json"),
        "utf8",
      ),
    });
    if (dependencyIssues.length > 0) {
      throw new Error(dependencyIssues.join("; "));
    }
    const smokePath = join(smokeDirectory, "smoke.mjs");
    await writeFile(
      smokePath,
      renderV07LanguageConsumerSmoke(),
      "utf8",
    );

    const runtimes = [
      ["node", [smokePath]],
      ["bun", ["run", smokePath]],
    ] as const;
    const failures: string[] = [];
    for (const [runtime, args] of runtimes) {
      const outcome = await runCommand(runtime, args, smokeDirectory);
      if (outcome.code !== 0 || !outcome.stdout.includes("LANGUAGE_CONSUMER_OK")) {
        failures.push(`${runtime}: ${tail(outcome.stderr || outcome.stdout, 4)}`);
      }
    }
    if (failures.length > 0) {
      throw new Error(failures.join("; "));
    }
    const runtime = await collectV07RuntimeIdentity(input.repoRoot);
    if (runtime.check.status !== "pass") {
      throw new Error(runtime.check.detail);
    }
    return runtime.runtime;
  } finally {
    await rm(smokeDirectory, { force: true, recursive: true });
  }
}

async function evaluateLanguageConsumers(
  repoRoot: string,
): Promise<V07ReleaseReadinessCheck> {
  const startedAt = performance.now();
  try {
    const runtime = await verifyV07ArtifactConsumers({ repoRoot });
    return {
      detail:
        `installed tarball passed a clean production dependency audit and all seven public LanguagePack APIs under Node ${runtime.nodeVersion} and Bun ${runtime.bunVersion}`,
      durationMs: Math.round(performance.now() - startedAt),
      id: "language-consumers",
      required: true,
      status: "pass",
      title: "Node and Bun packed LanguagePack consumers",
    };
  } catch (error) {
    return {
      detail: error instanceof Error ? error.message : String(error),
      durationMs: Math.round(performance.now() - startedAt),
      id: "language-consumers",
      required: true,
      status: "fail",
      title: "Node and Bun packed LanguagePack consumers",
    };
  }
}

function skippedCheck(id: string, title: string, flag: string): V07ReleaseReadinessCheck {
  return {
    detail: `skipped via ${flag}`,
    durationMs: 0,
    id,
    required: true,
    status: "skip",
    title,
  };
}

export function evaluateV07RequiredEnvironment(input: {
  environment: Readonly<Record<string, string | undefined>>;
  environmentName: string;
  id: string;
  title: string;
}): V07ReleaseReadinessCheck | undefined {
  if (input.environment[input.environmentName]?.trim()) {
    return undefined;
  }
  return {
    detail: `${input.environmentName} is required for the release gate`,
    durationMs: 0,
    id: input.id,
    required: true,
    status: "fail",
    title: input.title,
  };
}

function skippedCommandFlag(
  id: RequiredCommandId,
  options: V07ReleaseReadinessOptions,
): string | undefined {
  if (id === "tests" && options.skipTests) {
    return "--skip-tests";
  }
  if (id === "coverage" && options.skipCoverage) {
    return "--skip-coverage";
  }
  if (id === "build" && options.skipBuild) {
    return "--skip-build";
  }
  return undefined;
}

export async function runV07ReleaseReadiness(
  options: V07ReleaseReadinessOptions = {},
): Promise<V07ReleaseReadinessReport> {
  assertValidV07ReleaseReadinessOptions(options);
  const repoRoot = resolveRepoRootFromScriptUrl(import.meta.url);
  const packageJson = JSON.parse(
    await readFile(join(repoRoot, "package.json"), "utf8"),
  ) as PackageJson;
  const checks: V07ReleaseReadinessCheck[] = [];
  const source = await collectV07SourceIdentity(repoRoot);
  const runtime = await collectV07RuntimeIdentity(repoRoot);

  checks.push(source.check, runtime.check);
  checks.push(await evaluateV07ReleaseSourceIdentity({
    releaseStatus: packageJson.goodmemoryRelease?.status,
    repoRoot,
    version: packageJson.version,
  }));
  checks.push(await evaluateVersionConsistency(repoRoot));
  checks.push(...(await evaluateV073LifecycleProtectionArtifactFile({
    artifactPath: resolve(
      repoRoot,
      options.lifecycleProtectionArtifact ?? V073_LIFECYCLE_PROTECTION_ARTIFACT,
    ),
    currentCommit: source.sourceIdentity.commitSha,
    repoRoot,
  })));

  for (const command of V07_RELEASE_REQUIRED_COMMANDS) {
    const details = REQUIRED_COMMAND_DETAILS[command.id];
    const skipFlag = skippedCommandFlag(command.id, options);
    if (skipFlag) {
      checks.push(skippedCheck(command.id, details.title, skipFlag));
      continue;
    }
    if (
      "requiredEnvironment" in command
    ) {
      const environmentCheck = evaluateV07RequiredEnvironment({
        environment: process.env,
        environmentName: command.requiredEnvironment,
        id: command.id,
        title: details.title,
      });
      if (environmentCheck) {
        checks.push(environmentCheck);
        continue;
      }
    }

    const outcome = await runCommand(command.command, command.args, repoRoot, {
      logGroupName: `${details.title}: ${command.command} ${command.args.join(" ")}`,
    });
    checks.push(
      commandCheck({
        id: command.id,
        outcome,
        successDetail: details.successDetail,
        title: details.title,
      }),
    );
  }

  checks.push(await evaluatePack(repoRoot));
  checks.push(await evaluateLanguageConsumers(repoRoot));
  const finalSource = await collectV07SourceIdentity(repoRoot);
  checks.push(evaluateV07SourceStability({
    final: finalSource,
    initial: source.sourceIdentity,
  }));

  const passed = checks.filter((check) => check.status === "pass").length;
  const failed = checks.filter((check) => check.status === "fail").length;
  const skipped = checks.filter((check) => check.status === "skip").length;
  const report: V07ReleaseReadinessReport = {
    allRequiredPassed: evaluateV07RequiredChecks(checks),
    checks,
    generatedAt: new Date().toISOString(),
    generatedBy: "scripts/run-v0-7-release-readiness.ts",
    packageVersion: packageJson.version,
    runtime: runtime.runtime,
    sourceIdentity: source.sourceIdentity,
    summary: {
      failed,
      passed,
      skipped,
      total: checks.length,
    },
  };
  const outputDir =
    options.outputDir ?? join(repoRoot, "reports", "release", `v${RELEASE_LINE}`);
  await mkdir(outputDir, { recursive: true });
  await writeFile(
    join(outputDir, "readiness-report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  await writeFile(join(outputDir, "summary.md"), renderV07ReleaseSummary(report));
  return report;
}

export function renderV07ReleaseSummary(
  report: V07ReleaseReadinessReport,
): string {
  const lines = [
    `# v${RELEASE_LINE} Release Readiness`,
    "",
    `- package version: ${report.packageVersion}`,
    `- generated: ${report.generatedAt}`,
    `- source commit: ${report.sourceIdentity.commitSha}`,
    `- source tree: ${report.sourceIdentity.treeSha}`,
    `- runtime: Node ${report.runtime.nodeVersion} / Bun ${report.runtime.bunVersion}`,
    `- result: ${
      report.allRequiredPassed
        ? "ALL REQUIRED CHECKS PASS"
        : "REQUIRED CHECK(S) FAILED"
    } (${report.summary.passed} pass / ${report.summary.failed} fail / ${report.summary.skipped} skip)`,
    "",
    "| Check | Required | Status | Detail |",
    "|---|---|---|---|",
  ];

  for (const check of report.checks) {
    const detail = check.detail
      .replace(/\n/gu, " ")
      .replace(/\|/gu, "\\|")
      .slice(0, 180);
    lines.push(
      `| ${check.title} | ${check.required ? "yes" : "no"} | ${check.status.toUpperCase()} | ${detail} |`,
    );
  }

  const failedChecks = report.checks.filter((check) => check.status === "fail");
  if (failedChecks.length > 0) {
    lines.push("", "## Failure Details", "");
    for (const check of failedChecks) {
      lines.push(`### ${check.title}`, "", "```text", check.detail, "```", "");
    }
  }

  return `${lines.join("\n")}\n`;
}

if (import.meta.main) {
  const options = parseV07ReleaseReadinessCliOptions(Bun.argv);
  const report = await runV07ReleaseReadiness(options);
  process.stdout.write(renderV07ReleaseSummary(report));
  if (options.strict && !report.allRequiredPassed) {
    process.exitCode = 1;
  }
}
