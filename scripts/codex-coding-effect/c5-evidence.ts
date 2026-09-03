import { createHash } from "node:crypto";
import {
  lstat,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
  posix,
} from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

import { buildC4BaselinePrompt } from "./c4-baseline-ceiling";
import {
  c4RepositoryIdForUrl,
  materializeC4SourceRepository,
} from "./c4-controlled-dataset";
import { validateC4ControlledPilotDataset } from "./c4-contracts";
import { auditC4SurfaceHiddenArtifactMatrix } from "./c4-leakage";
import type {
  C4HiddenArtifact,
  C4LeakageMatrixAudit,
  C4LeakageSurface,
} from "./c4-leakage";
import { loadCodexCodingEffectDataset } from "./dataset";
import {
  C5_FLAT_SUMMARY_SESSION_START_MAX_TOKENS,
  C5_FLAT_SUMMARY_USER_PROMPT_SUBMIT_MAX_TOKENS,
  buildC5FlatSummaryHookConfig,
} from "./c5-flat-summary-arm";
import { buildC5StageLeakageInput } from "./c5-leakage-input";
import {
  hashC5ComparableHostEnvironment,
  parseC5HostEnvironment,
} from "./c5-host-environment";
import {
  C5_PRIOR_EXPORT_LINEAGE_REASON,
  isC5StageWritebackRequired,
  resolveC5PriorMemoryLineage,
} from "./c5-memory-protocol";
import {
  C6_FLAT_SUMMARY_INJECTION_COMPOSITION_SHA256,
  C6_INJECTION_TOKEN_COUNTER_ID,
  C6_INJECTION_TOKEN_COUNTER_SHA256,
  C6_NO_HISTORY_ZERO_INJECTION_COMPOSITION_SHA256,
} from "./c6-flat-summary";
import { EMPTY_FROZEN_PREHISTORY_SHA256 } from "./frozen-prehistory";

import type {
  C5BaselineArm,
  C5PilotArm,
  C5PilotCluster,
  C5PilotEpisodeArmRun,
  C5PilotPlan,
  C5PilotStageRun,
} from "./c5-pilot-plan";
import {
  C5_COMPARATOR_GENERATION_POLICY,
  C5_COMPARATOR_INJECTION_CAPS,
  c5PlanBaselineArm,
  serializeC5PilotPlan,
} from "./c5-pilot-plan";
import { verifyC5PilotPrerequisiteEvidence } from "./c5-readiness";
import {
  assertC5CanonicalIndependentReviewInstructions,
  canonicalizeC5FailureTaxonomy,
  parseC5IndependentReview,
  parseC5IndependentReviewDispatch,
  parseC5IndependentReviewProvenance,
  parseC5ReviewInputBundle,
  serializeC5ReviewArtifact,
} from "./c5-review-artifacts";

const CLAIM_BOUNDARY = "internal-native-longitudinal-pilot-only";
const EVIDENCE_CLASS = "native-longitudinal-pilot";
const C4_DATASET_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../fixtures/codex-coding-effect/c4-controlled-pilot",
);
const REQUIRED_ALIAS_LABELS = [
  "current-runtime-auth",
  "evaluator-runner",
  "gold-patch",
  "installed-package",
  "other-arm-workspace",
  "source-auth",
] as const;
const LIVE_SURFACE_IDS = [
  "effective-codex-input-after-seeding",
  "flat-summary-after-seeding",
  "goodmemory-export-after-seeding",
  "goodmemory-hook-context-after-seeding",
] as const;
const ALL_LEAKAGE_SURFACE_IDS = [
  "allowed-feedback",
  "effective-codex-input-after-seeding",
  "flat-summary-after-seeding",
  "frozen-prehistory",
  "goodmemory-export-after-seeding",
  "goodmemory-hook-context-after-seeding",
  "repository-instructions",
  "stage-prompts",
  "visible-repository-files",
] as const;
const HIDDEN_ARTIFACT_IDS = [
  "expected-changed-files",
  "gold-patches",
  "hidden-test-source",
] as const;
const ROOT_EVIDENCE_PATHS = [
  "c4-prerequisite-evidence.json",
  "cluster-commits.jsonl",
  "pairs.jsonl",
  "pilot-plan.json",
  "report.json",
  "run-attempts.jsonl",
  "run-identity.json",
  "runner-source-state-post-run.json",
  "runner-source-state.json",
  "stage-executions.jsonl",
] as const;
const GENERATED_PROJECTION_PATHS = new Set([
  "c5-gate.json",
  "c5-verification.json",
  "review/independent-review.json",
  "review/dispatch.json",
  "review/input-bundle.json",
  "review/provenance.json",
  "review/request.md",
]);
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
// The flat-summary comparator's hook runner lives directly under the arm root,
// so its normalized hooks.json is reproducible from the pinned hook config.
const FLAT_SUMMARY_HOOK_RUNNER_PLACEHOLDER = "/arm-root/flat-summary-hook.mjs";
const FLAT_SUMMARY_NORMALIZED_HOOK_CONFIG = buildC5FlatSummaryHookConfig({
  runnerPath: FLAT_SUMMARY_HOOK_RUNNER_PLACEHOLDER,
}).replaceAll("/arm-root/", "<arm-root>/");
const COMPARATOR_INJECTION_REASONS = [
  "flat-summary-hook-canary-failed",
  "flat-summary-injection-mode-mismatch",
] as const;

interface ProjectionFile {
  bytes: number;
  path: string;
  sha256: string;
  sourceSha256: string;
}

export interface C5EvidenceProjectionManifest {
  claimBoundary: typeof CLAIM_BOUNDARY;
  evidenceClass: typeof EVIDENCE_CLASS;
  files: ProjectionFile[];
  projectedEvidenceAggregateSha256: string;
  runId: string;
  schemaVersion: 1;
  sourceEvidenceAggregateSha256: string;
  sourceRunIdentitySha256: string;
}

export interface C5EvidenceVerification {
  checks: {
    actualFileHashesVerified: boolean;
    exactPlanTopologyVerified: boolean;
    hostPreflightVerified: boolean;
    noInfrastructureFailure: boolean;
    noLeakageRejection: boolean;
    noMemoryChannelFailure: boolean;
    noSilentFallback: boolean;
    reportRecomputed: boolean;
  };
  claimBoundary: typeof CLAIM_BOUNDARY;
  counts: {
    hostPreflights: number;
    opaqueProcessOnlyTrajectoryOrigins: number;
    pairs: number;
    projectedFiles: number;
    stageExecutions: number;
    taskAliasAudits: number;
  };
  decision: "accepted" | "rejected";
  evidenceClass: typeof EVIDENCE_CLASS;
  externalAuthenticityVerified: false;
  planSha256: string | null;
  projectionManifestSha256: string | null;
  publicClaimEligible: false;
  reasons: string[];
  runId: string | null;
  schemaVersion: 1;
  verificationScope:
    "frozen-capture-claims-and-projection-internal-consistency";
}

export interface C5EvidenceGate {
  claimBoundary: typeof CLAIM_BOUNDARY;
  decision: "accepted" | "rejected";
  evidenceClass: typeof EVIDENCE_CLASS;
  independentReviewSha256: string | null;
  planSha256: string | null;
  projectionManifestSha256: string | null;
  publicClaimEligible: false;
  publicCodingEffectProof: false;
  reviewProvenanceSha256: string | null;
  reasons: string[];
  runId: string | null;
  schemaVersion: 1;
  verificationSha256: string | null;
}

interface VerifiedProjection {
  hostPreflightCount: number;
  infrastructureFailureCount: number;
  leakageRejectionCount: number;
  manifest: C5EvidenceProjectionManifest;
  manifestSha256: string;
  opaqueProcessOnlyTrajectoryOriginCount: number;
  pairCount: number;
  planSha256: string;
  runId: string;
  memoryChannelFailureCount: number;
  stageExecutionCount: number;
  taskAliasAuditCount: number;
}

interface ArtifactReader {
  bytes(path: string): string;
  json(path: string): Record<string, unknown>;
}

interface FrozenC5DatasetVerification {
  leakageInputs: ReadonlyMap<string, {
    artifacts: C4HiddenArtifact[];
    staticSurfaces: C4LeakageSurface[];
  }>;
  promptContents: ReadonlyMap<string, string>;
  promptSha256: ReadonlyMap<string, string>;
}

export async function projectC5RunEvidence(input: {
  outputDirectory: string;
  rawRunDirectory: string;
}): Promise<C5EvidenceProjectionManifest> {
  const outputDirectory = resolve(input.outputDirectory);
  const rawRunDirectory = resolve(input.rawRunDirectory);
  await assertRealDirectory(rawRunDirectory, "C5 raw run directory");
  const [physicalRaw, physicalOutput] = await Promise.all([
    realpath(rawRunDirectory),
    resolvePhysicalPath(outputDirectory),
  ]);
  if (pathsOverlap(physicalRaw, physicalOutput)) {
    throw new Error("C5 projection directory must not overlap the raw run directory");
  }
  await assertAbsent(outputDirectory, "C5 projection directory");

  const planBytes = await readRequiredRegularFile(
    rawRunDirectory,
    "pilot-plan.json",
  );
  const plan = parsePlan(planBytes);
  assertFrozenPlan(plan);
  const stageRows = parseJsonLines(
    await readRequiredRegularFile(rawRunDirectory, "stage-executions.jsonl"),
    "stage-executions.jsonl",
  );
  const pairRows = parseJsonLines(
    await readRequiredRegularFile(rawRunDirectory, "pairs.jsonl"),
    "pairs.jsonl",
  );
  const attemptRows = parseJsonLines(
    await readRequiredRegularFile(rawRunDirectory, "run-attempts.jsonl"),
    "run-attempts.jsonl",
  );
  const expectedPaths = expectedEvidencePaths(
    plan,
    stageRows,
    pairRows,
    attemptRows,
  );
  const rawFiles = new Map<string, string>();
  for (const path of expectedPaths) {
    rawFiles.set(path, await readRequiredRegularFile(rawRunDirectory, path));
  }
  const identityBytes = requiredBytes(rawFiles, "run-identity.json");
  const identity = parseJsonRecord(identityBytes, "run-identity.json");
  const runId = requiredString(identity.runId, "C5 run identity runId");
  const files = [...rawFiles.entries()]
    .sort(([first], [second]) => first.localeCompare(second))
    .map(([path, bytes]) => ({
      bytes: Buffer.byteLength(bytes),
      path,
      sha256: sha256(bytes),
      sourceSha256: sha256(bytes),
    }));
  const aggregate = evidenceAggregate(files);
  const manifest: C5EvidenceProjectionManifest = {
    claimBoundary: CLAIM_BOUNDARY,
    evidenceClass: EVIDENCE_CLASS,
    files,
    projectedEvidenceAggregateSha256: aggregate,
    runId,
    schemaVersion: 1,
    sourceEvidenceAggregateSha256: aggregate,
    sourceRunIdentitySha256: sha256(identityBytes),
  };

  try {
    await mkdir(outputDirectory, { recursive: true });
    for (const [path, bytes] of rawFiles) {
      const destination = join(outputDirectory, ...path.split("/"));
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, bytes, { encoding: "utf8", flag: "wx" });
    }
    await writeFile(
      join(outputDirectory, "projection-manifest.json"),
      serializeC5EvidenceProjectionManifest(manifest),
      { encoding: "utf8", flag: "wx" },
    );
    const verification = await verifyC5EvidenceProjection({
      projectionDirectory: outputDirectory,
    });
    if (verification.decision !== "accepted") {
      throw new Error(
        `C5 projected raw evidence was rejected: ${verification.reasons.join("; ")}`,
      );
    }
    return manifest;
  } catch (error) {
    await rm(outputDirectory, { force: true, recursive: true });
    throw error;
  }
}

export async function verifyC5EvidenceProjection(input: {
  projectionDirectory: string;
}): Promise<C5EvidenceVerification> {
  try {
    const verified = await inspectProjection(resolve(input.projectionDirectory));
    return {
      checks: {
        ...passingChecks(),
        noInfrastructureFailure: verified.infrastructureFailureCount === 0,
        noLeakageRejection: verified.leakageRejectionCount === 0,
        noMemoryChannelFailure: verified.memoryChannelFailureCount === 0,
      },
      claimBoundary: CLAIM_BOUNDARY,
      counts: {
        hostPreflights: verified.hostPreflightCount,
        opaqueProcessOnlyTrajectoryOrigins:
          verified.opaqueProcessOnlyTrajectoryOriginCount,
        pairs: verified.pairCount,
        projectedFiles: verified.manifest.files.length,
        stageExecutions: verified.stageExecutionCount,
        taskAliasAudits: verified.taskAliasAuditCount,
      },
      decision: "accepted",
      evidenceClass: EVIDENCE_CLASS,
      externalAuthenticityVerified: false,
      planSha256: verified.planSha256,
      projectionManifestSha256: verified.manifestSha256,
      publicClaimEligible: false,
      reasons: [],
      runId: verified.runId,
      schemaVersion: 1,
      verificationScope:
        "frozen-capture-claims-and-projection-internal-consistency",
    };
  } catch (error) {
    return {
      checks: failingChecks(),
      claimBoundary: CLAIM_BOUNDARY,
      counts: {
        hostPreflights: 0,
        opaqueProcessOnlyTrajectoryOrigins: 0,
        pairs: 0,
        projectedFiles: 0,
        stageExecutions: 0,
        taskAliasAudits: 0,
      },
      decision: "rejected",
      evidenceClass: EVIDENCE_CLASS,
      externalAuthenticityVerified: false,
      planSha256: null,
      projectionManifestSha256: null,
      publicClaimEligible: false,
      reasons: [errorMessage(error)],
      runId: null,
      schemaVersion: 1,
      verificationScope:
        "frozen-capture-claims-and-projection-internal-consistency",
    };
  }
}

export async function persistC5EvidenceVerification(input: {
  path: string;
  verification: C5EvidenceVerification;
}): Promise<void> {
  await writeFile(
    resolve(input.path),
    serializeC5EvidenceVerification(input.verification),
    "utf8",
  );
}

export async function runC5EvidenceGate(input: {
  projectionDirectory: string;
  reviewPath?: string;
  reviewProvenancePath?: string;
  verificationPath?: string;
}): Promise<C5EvidenceGate> {
  const projectionDirectory = resolve(input.projectionDirectory);
  const verificationPath = resolve(
    input.verificationPath ?? join(projectionDirectory, "c5-verification.json"),
  );
  const fresh = await verifyC5EvidenceProjection({ projectionDirectory });
  let verificationSha256: string | null = null;
  let independentReviewSha256: string | null = null;
  let reviewProvenanceSha256: string | null = null;
  const reasons = [...fresh.reasons];
  try {
    const persisted = await readRequiredAbsoluteRegularFile(
      verificationPath,
      "C5 persisted verification",
    );
    verificationSha256 = sha256(persisted);
    if (persisted !== serializeC5EvidenceVerification(fresh)) {
      reasons.push("persisted C5 verification does not match an independent replay");
    }
  } catch (error) {
    reasons.push(errorMessage(error));
  }
  try {
    const reviewPath = resolve(
      input.reviewPath ??
        join(projectionDirectory, "review", "independent-review.json"),
    );
    const provenancePath = resolve(
      input.reviewProvenancePath ??
        join(projectionDirectory, "review", "provenance.json"),
    );
    const reviewDirectory = dirname(reviewPath);
    const [
      reviewBytes,
      provenanceBytes,
      manifestBytes,
      reportBytes,
      dispatchBytes,
      inputBundleBytes,
      requestBytes,
      verificationBytes,
    ] =
      await Promise.all([
        readRequiredAbsoluteRegularFile(reviewPath, "C5 independent review"),
        readRequiredAbsoluteRegularFile(
          provenancePath,
          "C5 review provenance",
        ),
        readRequiredAbsoluteRegularFile(
          join(projectionDirectory, "projection-manifest.json"),
          "C5 projection manifest",
        ),
        readRequiredAbsoluteRegularFile(
          join(projectionDirectory, "report.json"),
          "C5 report",
        ),
        readRequiredAbsoluteRegularFile(
          join(reviewDirectory, "dispatch.json"),
          "C5 review dispatch",
        ),
        readRequiredAbsoluteRegularFile(
          join(reviewDirectory, "input-bundle.json"),
          "C5 review input bundle",
        ),
        readRequiredAbsoluteRegularFile(
          join(reviewDirectory, "request.md"),
          "C5 review request",
        ),
        readRequiredAbsoluteRegularFile(
          verificationPath,
          "C5 persisted verification",
        ),
      ]);
    independentReviewSha256 = sha256(reviewBytes);
    reviewProvenanceSha256 = sha256(provenanceBytes);
    verifyIndependentReview({
      manifestSha256: sha256(manifestBytes),
      dispatchBytes,
      inputBundleBytes,
      manifestBytes,
      provenanceBytes,
      reportSha256: sha256(reportBytes),
      reportBytes,
      requestBytes,
      reviewBytes,
      reviewSha256: independentReviewSha256,
      verificationBytes,
    });
  } catch (error) {
    reasons.push(errorMessage(error));
  }
  const decision = fresh.decision === "accepted" && reasons.length === 0
    ? "accepted"
    : "rejected";
  return {
    claimBoundary: CLAIM_BOUNDARY,
    decision,
    evidenceClass: EVIDENCE_CLASS,
    independentReviewSha256,
    planSha256: fresh.planSha256,
    projectionManifestSha256: fresh.projectionManifestSha256,
    publicClaimEligible: false,
    publicCodingEffectProof: false,
    reviewProvenanceSha256,
    reasons,
    runId: fresh.runId,
    schemaVersion: 1,
    verificationSha256,
  };
}

function verifyIndependentReview(input: {
  dispatchBytes: string;
  inputBundleBytes: string;
  manifestBytes: string;
  manifestSha256: string;
  provenanceBytes: string;
  reportBytes: string;
  reportSha256: string;
  requestBytes: string;
  reviewBytes: string;
  reviewSha256: string;
  verificationBytes: string;
}): void {
  const bundle = parseC5ReviewInputBundle(parseJsonRecord(
    input.inputBundleBytes,
    "C5 review input bundle",
  ));
  const dispatch = parseC5IndependentReviewDispatch(parseJsonRecord(
    input.dispatchBytes,
    "C5 review dispatch",
  ));
  const review = parseC5IndependentReview(parseJsonRecord(
    input.reviewBytes,
    "C5 independent review",
  ));
  const provenance = parseC5IndependentReviewProvenance(parseJsonRecord(
    input.provenanceBytes,
    "C5 review provenance",
  ));
  if (
    input.inputBundleBytes !== serializeC5ReviewArtifact(bundle) ||
    input.dispatchBytes !== serializeC5ReviewArtifact(dispatch) ||
    input.reviewBytes !== serializeC5ReviewArtifact(review) ||
    input.provenanceBytes !== serializeC5ReviewArtifact(provenance)
  ) {
    throw new Error("C5 review artifacts are not canonically serialized");
  }
  assertC5CanonicalIndependentReviewInstructions({
    dispatchBytes: input.dispatchBytes,
    inputBundleBytes: input.inputBundleBytes,
    requestBytes: input.requestBytes,
  });
  const failureTaxonomyBytes = canonicalizeC5FailureTaxonomy(
    input.reportBytes,
  );
  if (
    bundle.artifacts.projectionManifest.sha256 !== input.manifestSha256 ||
    bundle.artifacts.projectionManifest.byteLength !==
      Buffer.byteLength(input.manifestBytes) ||
    bundle.artifacts.report.sha256 !== input.reportSha256 ||
    bundle.artifacts.report.byteLength !== Buffer.byteLength(input.reportBytes) ||
    bundle.artifacts.verification.sha256 !== sha256(input.verificationBytes) ||
    bundle.artifacts.verification.byteLength !==
      Buffer.byteLength(input.verificationBytes) ||
    bundle.artifacts.failureTaxonomy.sha256 !==
      sha256(failureTaxonomyBytes) ||
    bundle.artifacts.failureTaxonomy.byteLength !==
      Buffer.byteLength(failureTaxonomyBytes) ||
    review.decision !== "accepted" ||
    review.runId !== bundle.runId ||
    review.inputBundleSha256 !== sha256(input.inputBundleBytes) ||
    review.projectionManifestSha256 !== input.manifestSha256 ||
    review.reportSha256 !== input.reportSha256 ||
    review.verificationSha256 !== sha256(input.verificationBytes) ||
    review.failureTaxonomySha256 !== sha256(failureTaxonomyBytes) ||
    !Object.values(review.assertions).every(Boolean) ||
    review.findings.some((finding) => finding.severity === "blocking")
  ) {
    throw new Error("C5 independent review is rejected or evidence-unbound");
  }
  if (
    provenance.reviewDecision !== "accepted" ||
    provenance.runId !== bundle.runId ||
    provenance.authorTaskName === provenance.reviewer.agentName ||
    provenance.reviewer.agentName !== review.reviewerTaskName ||
    !artifactReferenceMatches(provenance.dispatch, input.dispatchBytes) ||
    !artifactReferenceMatches(provenance.inputBundle, input.inputBundleBytes) ||
    !artifactReferenceMatches(provenance.request, input.requestBytes) ||
    !artifactReferenceMatches(provenance.response, input.reviewBytes) ||
    input.reviewSha256 !== sha256(input.reviewBytes)
  ) {
    throw new Error("C5 independent review provenance is invalid or not independent");
  }
}

function artifactReferenceMatches(
  reference: { byteLength: number; sha256: string },
  bytes: string,
): boolean {
  return reference.byteLength === Buffer.byteLength(bytes) &&
    reference.sha256 === sha256(bytes);
}

export async function persistC5EvidenceGate(input: {
  gate: C5EvidenceGate;
  path: string;
}): Promise<void> {
  await writeFile(
    resolve(input.path),
    `${JSON.stringify(input.gate, null, 2)}\n`,
    "utf8",
  );
}

export function serializeC5EvidenceProjectionManifest(
  manifest: C5EvidenceProjectionManifest,
): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

export function serializeC5EvidenceVerification(
  verification: C5EvidenceVerification,
): string {
  return `${JSON.stringify(verification, null, 2)}\n`;
}

async function inspectProjection(
  projectionDirectory: string,
): Promise<VerifiedProjection> {
  await assertRealDirectory(projectionDirectory, "C5 projection directory");
  const manifestBytes = await readRequiredRegularFile(
    projectionDirectory,
    "projection-manifest.json",
  );
  const manifest = parseManifest(manifestBytes);
  const files = new Map<string, string>();
  for (const file of manifest.files) {
    const bytes = await readRequiredRegularFile(projectionDirectory, file.path);
    if (
      Buffer.byteLength(bytes) !== file.bytes ||
      sha256(bytes) !== file.sha256 ||
      file.sourceSha256 !== file.sha256
    ) {
      throw new Error(`C5 projected evidence hash mismatch: ${file.path}`);
    }
    files.set(file.path, bytes);
  }
  const actualPaths = await collectRelativeFilePaths(projectionDirectory);
  const expectedPaths = new Set([
    ...manifest.files.map((file) => file.path),
    "projection-manifest.json",
  ]);
  for (const path of actualPaths) {
    if (!expectedPaths.has(path) && !GENERATED_PROJECTION_PATHS.has(path)) {
      throw new Error(`unsupported file in C5 evidence projection: ${path}`);
    }
  }
  for (const path of expectedPaths) {
    if (!actualPaths.includes(path)) {
      throw new Error(`missing file in C5 evidence projection: ${path}`);
    }
  }
  const aggregate = evidenceAggregate(manifest.files);
  if (
    aggregate !== manifest.projectedEvidenceAggregateSha256 ||
    aggregate !== manifest.sourceEvidenceAggregateSha256
  ) {
    throw new Error("C5 projected evidence aggregate is inconsistent");
  }

  const planBytes = requiredBytes(files, "pilot-plan.json");
  const plan = parsePlan(planBytes);
  assertFrozenPlan(plan);
  const frozenDataset = await verifyFrozenDatasetPlan(
    plan,
    planBytes,
    requiredBytes(files, "c4-prerequisite-evidence.json"),
  );
  const expected = expectedEvidencePaths(
    plan,
    parseJsonLines(requiredBytes(files, "stage-executions.jsonl"), "stage-executions.jsonl"),
    parseJsonLines(requiredBytes(files, "pairs.jsonl"), "pairs.jsonl"),
    parseJsonLines(requiredBytes(files, "run-attempts.jsonl"), "run-attempts.jsonl"),
  );
  if (!sameStrings(manifest.files.map((file) => file.path), expected)) {
    throw new Error("C5 projection file set does not match the frozen plan");
  }
  const reader = createArtifactReader(files);
  const verified = verifyEvidenceGraph({
    frozenDataset,
    manifest,
    plan,
    planBytes,
    reader,
  });
  return {
    ...verified,
    manifest,
    manifestSha256: sha256(manifestBytes),
    planSha256: sha256(planBytes),
  };
}

function verifyEvidenceGraph(input: {
  frozenDataset: FrozenC5DatasetVerification;
  manifest: C5EvidenceProjectionManifest;
  plan: C5PilotPlan;
  planBytes: string;
  reader: ArtifactReader;
}): Omit<VerifiedProjection, "manifest" | "manifestSha256" | "planSha256"> {
  const planSha256 = sha256(input.planBytes);
  const identity = input.reader.json("run-identity.json");
  verifyRunIdentity(identity, input.manifest, planSha256);
  verifyRunnerSourceState({ identity, reader: input.reader });
  const runId = requiredString(identity.runId, "C5 run identity runId");
  const stages = parseJsonLines(
    input.reader.bytes("stage-executions.jsonl"),
    "stage-executions.jsonl",
  );
  const pairs = parseJsonLines(
    input.reader.bytes("pairs.jsonl"),
    "pairs.jsonl",
  );
  verifyClusterCommits({
    pairs,
    plan: input.plan,
    rows: parseJsonLines(
      input.reader.bytes("cluster-commits.jsonl"),
      "cluster-commits.jsonl",
    ),
    stages,
  });
  verifyInterruptedAttempts({
    plan: input.plan,
    reader: input.reader,
    rows: parseJsonLines(
      input.reader.bytes("run-attempts.jsonl"),
      "run-attempts.jsonl",
    ),
  });
  const stageMap = verifyStageExecutions(input.plan, stages);
  const pairMap = verifyPairs(input.plan, pairs);
  const baselineArm = c5PlanBaselineArm(input.plan);
  const hostIdentityHashes = new Set<string>();
  let hostPreflightCount = 0;
  let opaqueProcessOnlyTrajectoryOriginCount = 0;
  let taskAliasAuditCount = 0;

  for (const cluster of input.plan.clusters) {
    const runs = runsForCluster(input.plan, cluster);
    const root = trajectoryRoot(cluster.id);
    const preflight = input.reader.json(
      `${root}/host-preflight.sanitized.json`,
    );
    const hostBindings = verifyHostPreflight({
      baselineArm,
      cluster,
      identity,
      preflight,
      reader: input.reader,
      root,
      runs,
    });
    hostIdentityHashes.add(hostBindings.hostIdentitySha256);
    hostPreflightCount += 1;
    taskAliasAuditCount += hostBindings.taskAliasAuditCount;

    for (const run of runs) {
      const permissionPath =
        `${root}/${run.arm}/permission-isolation-preflight.sanitized.json`;
      const permission = input.reader.json(permissionPath);
      verifyPermissionIsolation(permission, permissionPath);
      const aliasPath = `${root}/${run.arm}/task-alias-isolation.json`;
      verifyTaskAliasIsolation(input.reader.json(aliasPath), aliasPath);
      const priorWrittenMemoryIds: string[] = [];
      for (const stage of run.stages) {
        const key = stage.id;
        const execution = requiredMapValue(stageMap, key, "C5 stage execution");
        const stagePath = `${root}/${run.arm}/${stage.stageId}/stage-execution.sanitized.json`;
        const writebackRequired = isC5StageWritebackRequired({
          priorWritebackCommitted: priorWrittenMemoryIds.length > 0,
          run,
          stage,
        });
        const writtenMemoryIds = verifyStageEvidence({
          codexExecutableSha256: hostBindings.codexExecutableSha256,
          comparator: frozenComparatorInput(input.plan),
          expectedPriorMemoryIds: priorWrittenMemoryIds,
          expectedPromptSha256: requiredMapValue(
            input.frozenDataset.promptSha256,
            `${run.episodeId}/${stage.stageId}`,
            "C5 frozen stage prompt",
          ),
          execution,
          permissionSha256: sha256(input.reader.bytes(permissionPath)),
          reader: input.reader,
          root,
          run,
          stage,
          stagePath,
          writebackRequired,
        });
        priorWrittenMemoryIds.push(...writtenMemoryIds);
      }
    }

    for (const stage of runs[0]!.stages) {
      const pairKey = `${cluster.id}/${stage.stageId}`;
      const pair = requiredMapValue(pairMap, pairKey, "C5 pair");
      opaqueProcessOnlyTrajectoryOriginCount += verifyPairEvidence({
        baselineArm,
        cluster,
        executions: runs.map((run) => requiredMapValue(
          stageMap,
          `${run.id}/${stage.stageId}`,
          "C5 paired stage execution",
        )),
        frozenDataset: input.frozenDataset,
        pair,
        reader: input.reader,
        root,
        stage,
      });
    }
  }
  if (hostIdentityHashes.size !== 1) {
    throw new Error("C5 host identity drifted across the 12 cluster preflights");
  }
  verifyReport({
    generatedAt: requiredString(identity.generatedAt, "C5 generatedAt"),
    pairs,
    plan: input.plan,
    planSha256,
    report: input.reader.json("report.json"),
    runId,
    stages,
  });
  return {
    hostPreflightCount,
    infrastructureFailureCount:
      stages.filter((stage) => stage.infrastructureFailureStage !== null).length +
      pairs.flatMap((pair) => Array.isArray(pair.evaluations)
        ? pair.evaluations
        : []).filter((evaluation) =>
          asRecord(evaluation, "C5 evaluation count").disposition ===
            "infrastructure-failure"
        ).length,
    leakageRejectionCount: pairs.filter((pair) =>
      Array.isArray(pair.incomparabilityReasons) &&
      pair.incomparabilityReasons.includes("live-leakage-audit-rejected")
    ).length,
    memoryChannelFailureCount: stages.filter((stage) =>
      stage.arm === "goodmemory-installed" &&
      stage.memoryChannelStatus === "failed"
    ).length,
    opaqueProcessOnlyTrajectoryOriginCount,
    pairCount: pairs.length,
    runId,
    stageExecutionCount: stages.length,
    taskAliasAuditCount,
  };
}

function parsePlan(bytes: string): C5PilotPlan {
  const value = parseJsonRecord(bytes, "pilot-plan.json");
  if (`${JSON.stringify(value, null, 2)}\n` !== bytes) {
    throw new Error("C5 pilot plan is not canonically serialized");
  }
  return value as unknown as C5PilotPlan;
}

function assertFrozenPlan(plan: C5PilotPlan): void {
  if (
    plan.schemaVersion !== 1 ||
    plan.phase !== "C5" ||
    plan.host !== "codex" ||
    plan.evidenceClass !== EVIDENCE_CLASS ||
    plan.claimBoundary !== CLAIM_BOUNDARY ||
    plan.publicClaimEligible !== false ||
    plan.publicCodingEffectProof !== false ||
    plan.readmeRowAllowed !== false ||
    plan.networkAccess !== false ||
    plan.maxConcurrency !== 1 ||
    plan.historyPolicy !== "native-stop-writeback-only" ||
    plan.frozenPrehistoryUse !== "leakage-audit-reference-only-never-seeded" ||
    plan.sessionPolicy !== "fresh-codex-process-no-resume-per-stage" ||
    plan.datasetSnapshotMode !== "asset-locked-copy" ||
    plan.datasetId !== "codex-c4-controlled-pilot-v2" ||
    !Array.isArray(plan.arms) ||
    plan.arms.length !== 2 ||
    (plan.arms[0] !== "no-memory" && plan.arms[0] !== "flat-summary") ||
    plan.arms[1] !== "goodmemory-installed" ||
    !sameStrings(plan.repetitions.map(String), ["1", "2"]) ||
    !sameStrings(plan.excludedHosts, ["claude-code"])
  ) {
    throw new Error("C5 pilot plan changed its frozen claim or execution boundary");
  }
  const baselineArm = c5PlanBaselineArm(plan);
  assertFrozenComparatorProtocol(plan, baselineArm);
  if (
    plan.counts.arms !== 2 ||
    plan.counts.codexProcesses !== 72 ||
    plan.counts.episodeArmRuns !== 24 ||
    plan.counts.episodes !== 6 ||
    plan.counts.repetitions !== 2 ||
    plan.counts.stageRuns !== 72 ||
    plan.counts.stages !== 18 ||
    plan.clusters.length !== 12 ||
    plan.episodeArmRuns.length !== 24 ||
    plan.analysis.bootstrapSamples !== 10_000 ||
    plan.analysis.confidenceLevel !== 0.95 ||
    plan.analysis.power !== 0.8 ||
    plan.analysis.primaryResamplingUnit !== "episode" ||
    !Number.isSafeInteger(plan.analysis.materialEffectPercentagePoints) ||
    plan.analysis.materialEffectPercentagePoints < 1 ||
    plan.analysis.materialEffectPercentagePoints > 50
  ) {
    throw new Error("C5 pilot plan does not have the exact 72-stage topology");
  }
  for (const digest of Object.values(plan.bindings)) {
    assertSha256(digest, "C5 plan binding");
  }
  const randomization = plan.randomization as Record<string, unknown>;
  const baselineFirstKey = baselineArm === "no-memory"
    ? "noMemoryFirstClusters"
    : "baselineFirstClusters";
  const absentFirstKey = baselineArm === "no-memory"
    ? "baselineFirstClusters"
    : "noMemoryFirstClusters";
  if (
    plan.randomization.algorithm !== "sha256-ranked-balanced-pair-order-v1" ||
    plan.randomization.goodMemoryFirstClusters !== 6 ||
    randomization[baselineFirstKey] !== 6 ||
    absentFirstKey in randomization ||
    !Number.isSafeInteger(plan.randomization.orderSeed) ||
    plan.randomization.orderSeed <= 0
  ) {
    throw new Error("C5 pilot plan randomization is not balanced and frozen");
  }
  assertSha256(
    plan.randomization.clusterOrderSha256,
    "C5 cluster order binding",
  );

  const clusterIds = new Set<string>();
  const clusterPositions = new Set<number>();
  const episodeRepetitions = new Map<string, Set<number>>();
  for (const cluster of plan.clusters) {
    if (
      cluster.id !== `${cluster.episodeId}/repetition-${cluster.repetition}` ||
      (cluster.repetition !== 1 && cluster.repetition !== 2) ||
      !Number.isSafeInteger(cluster.executionPosition) ||
      cluster.executionPosition < 1 ||
      cluster.executionPosition > 12 ||
      cluster.armOrder.length !== 2 ||
      new Set(cluster.armOrder).size !== 2 ||
      !cluster.armOrder.includes(baselineArm) ||
      !cluster.armOrder.includes("goodmemory-installed")
    ) {
      throw new Error(`invalid C5 cluster identity ${cluster.id}`);
    }
    assertSha256(cluster.randomizationRankSha256, "C5 cluster rank");
    if (
      clusterIds.has(cluster.id) ||
      clusterPositions.has(cluster.executionPosition)
    ) {
      throw new Error("duplicate C5 cluster identity or execution position");
    }
    clusterIds.add(cluster.id);
    clusterPositions.add(cluster.executionPosition);
    const repetitions = episodeRepetitions.get(cluster.episodeId) ?? new Set();
    repetitions.add(cluster.repetition);
    episodeRepetitions.set(cluster.episodeId, repetitions);
  }
  if (
    episodeRepetitions.size !== 6 ||
    [...episodeRepetitions.values()].some((values) =>
      values.size !== 2 || !values.has(1) || !values.has(2)
    )
  ) {
    throw new Error("C5 plan must cover six episodes at both repetitions");
  }
  const expectedClusterBinding = sha256(JSON.stringify(plan.clusters.map(
    (cluster) => ({ armOrder: cluster.armOrder, id: cluster.id }),
  )));
  if (expectedClusterBinding !== plan.randomization.clusterOrderSha256) {
    throw new Error("C5 cluster order hash is not bound to the plan");
  }

  const runIds = new Set<string>();
  const stageRunIds = new Set<string>();
  for (const cluster of plan.clusters) {
    const runs = runsForCluster(plan, cluster);
    for (const [armIndex, run] of runs.entries()) {
      if (
        run.id !== `${cluster.id}/${run.arm}` ||
        run.clusterId !== cluster.id ||
        run.episodeId !== cluster.episodeId ||
        run.repetition !== cluster.repetition ||
        run.arm !== cluster.armOrder[armIndex] ||
        run.armOrderPosition !== armIndex + 1 ||
        run.executionPosition !==
          ((cluster.executionPosition - 1) * 2) + armIndex + 1 ||
        run.stateMode !== "canonical-snapshot" ||
        run.stages.length !== 3 ||
        runIds.has(run.id)
      ) {
        throw new Error(`invalid C5 episode-arm run ${run.id}`);
      }
      runIds.add(run.id);
      for (const [stageIndex, stage] of run.stages.entries()) {
        assertSafeSegment(stage.stageId, "C5 stage ID");
        if (
          stage.id !== `${run.id}/${stage.stageId}` ||
          stage.position !== stageIndex + 1 ||
          stage.freshSession !== true ||
          stage.resume !== false ||
          stage.repositoryReset !== "declared-stage-snapshot" ||
          stage.priorStageIds.length !== stageIndex ||
          !sameStrings(
            stage.priorStageIds,
            run.stages.slice(0, stageIndex).map((item) => item.stageId),
          ) ||
          stageRunIds.has(stage.id)
        ) {
          throw new Error(`invalid C5 stage run ${stage.id}`);
        }
        for (const digest of [
          stage.c4StageInputSha256,
          stage.pairedTaskInputSha256,
          stage.stageRunIdentitySha256,
        ]) {
          assertSha256(digest, "C5 stage binding");
        }
        stageRunIds.add(stage.id);
      }
    }
    const firstStages = runs[0]!.stages;
    const secondStages = runs[1]!.stages;
    for (const [index, first] of firstStages.entries()) {
      const second = secondStages[index]!;
      if (
        first.stageId !== second.stageId ||
        first.c4StageInputSha256 !== second.c4StageInputSha256 ||
        first.pairedTaskInputSha256 !== second.pairedTaskInputSha256 ||
        first.memoryExpectation !== second.memoryExpectation ||
        first.promptPath !== second.promptPath ||
        first.snapshot !== second.snapshot ||
        !sameStrings(first.priorStageIds, second.priorStageIds)
      ) {
        throw new Error(`C5 paired stage inputs drifted in cluster ${cluster.id}`);
      }
    }
  }
  if (runIds.size !== 24 || stageRunIds.size !== 72) {
    throw new Error("C5 plan identities are incomplete");
  }
}

// The flat-summary comparator freezes its summary protocol into the plan:
// pinned model, prompt bytes, endpoint, the installed profile's injection
// caps, and zero injection on no-history stages. The no-memory baseline must
// carry no such block, keeping the legacy plan byte-identical.
function assertFrozenComparatorProtocol(
  plan: C5PilotPlan,
  baselineArm: C5BaselineArm,
): void {
  const comparator = (plan as unknown as Record<string, unknown>).comparator;
  if (baselineArm === "no-memory") {
    if (comparator !== undefined) {
      throw new Error("C5 no-memory plan must not carry a comparator protocol");
    }
    return;
  }
  const protocol = asRecord(comparator, "C5 comparator protocol");
  assertExactKeys(protocol, [
    "generationPolicy",
    "injectionCaps",
    "noHistoryZeroInjection",
    "summaryEndpointSha256",
    "summaryModel",
    "summaryPromptSha256",
  ], "C5 comparator protocol");
  assertExactRecord(
    protocol.injectionCaps,
    { ...C5_COMPARATOR_INJECTION_CAPS },
    "C5 comparator injection caps",
  );
  if (
    protocol.generationPolicy !== C5_COMPARATOR_GENERATION_POLICY ||
    protocol.noHistoryZeroInjection !== true ||
    C5_COMPARATOR_INJECTION_CAPS.sessionStart !==
      C5_FLAT_SUMMARY_SESSION_START_MAX_TOKENS ||
    C5_COMPARATOR_INJECTION_CAPS.userPromptSubmit !==
      C5_FLAT_SUMMARY_USER_PROMPT_SUBMIT_MAX_TOKENS ||
    requiredString(protocol.summaryModel, "C5 comparator model").trim()
      .length === 0
  ) {
    throw new Error("C5 comparator protocol is not the frozen flat-summary protocol");
  }
  assertSha256(protocol.summaryEndpointSha256, "C5 comparator endpoint binding");
  assertSha256(protocol.summaryPromptSha256, "C5 comparator prompt binding");
}

function frozenComparatorInput(plan: C5PilotPlan): {
  summaryEndpointSha256: string;
  summaryModel: string;
  summaryPromptSha256: string;
} | undefined {
  return plan.comparator === undefined
    ? undefined
    : {
        summaryEndpointSha256: plan.comparator.summaryEndpointSha256,
        summaryModel: plan.comparator.summaryModel,
        summaryPromptSha256: plan.comparator.summaryPromptSha256,
      };
}

async function verifyFrozenDatasetPlan(
  plan: C5PilotPlan,
  planBytes: string,
  prerequisiteEvidenceBytes: string,
): Promise<FrozenC5DatasetVerification> {
  const readinessWorkspace = await mkdtemp(join(
    tmpdir(),
    "goodmemory-c5-c4-readiness-",
  ));
  let prerequisite: Awaited<ReturnType<
    typeof verifyC5PilotPrerequisiteEvidence
  >>;
  try {
    const comparator = frozenComparatorInput(plan);
    prerequisite = await verifyC5PilotPrerequisiteEvidence({
      baselineArm: c5PlanBaselineArm(plan),
      c4ReadinessWorkspaceRoot: join(readinessWorkspace, "core"),
      ...(comparator === undefined ? {} : { comparator }),
      datasetRoot: C4_DATASET_ROOT,
      materialEffectPercentagePoints:
        plan.analysis.materialEffectPercentagePoints,
      orderSeed: plan.randomization.orderSeed,
      prerequisiteEvidenceBytes,
    });
  } finally {
    await rm(readinessWorkspace, { force: true, recursive: true });
  }
  if (prerequisite.planBytes !== planBytes) {
    throw new Error(
      "C5 pilot plan drifted from independently verified C4 prerequisites",
    );
  }

  const loaded = await loadCodexCodingEffectDataset(C4_DATASET_ROOT);
  const dataset = validateC4ControlledPilotDataset(loaded.dataset);

  const promptContents = new Map<string, string>();
  const promptSha256 = new Map<string, string>();
  const leakageInputs = new Map<string, {
    artifacts: C4HiddenArtifact[];
    staticSurfaces: C4LeakageSurface[];
  }>();
  const workspace = await mkdtemp(join(tmpdir(), "goodmemory-c5-verifier-"));
  try {
    const repositories = new Map<string, string>();
    for (const episode of dataset.episodes) {
      let repositoryRoot = repositories.get(episode.repository.url);
      if (repositoryRoot === undefined) {
        repositoryRoot = join(
          workspace,
          c4RepositoryIdForUrl(episode.repository.url),
        );
        const identity = await materializeC4SourceRepository({
          datasetRoot: C4_DATASET_ROOT,
          destination: repositoryRoot,
          repositoryId: c4RepositoryIdForUrl(episode.repository.url),
        });
        if (identity.commit !== episode.repository.baseCommit) {
          throw new Error("C5 verifier reconstructed the wrong repository commit");
        }
        repositories.set(episode.repository.url, repositoryRoot);
      }
      for (const stage of episode.stages) {
        const key = `${episode.id}/${stage.id}`;
        const prompt = buildC4BaselinePrompt({
          allowedFeedback: stage.allowedFeedback,
          prompt: await readFile(
            join(C4_DATASET_ROOT, stage.promptPath),
            "utf8",
          ),
        });
        promptContents.set(key, prompt);
        promptSha256.set(key, sha256(prompt));
        leakageInputs.set(key, await buildC5StageLeakageInput({
          datasetRoot: C4_DATASET_ROOT,
          episode,
          repositoryRoot,
          stage,
        }));
      }
    }
  } finally {
    await rm(workspace, { force: true, recursive: true });
  }
  return { leakageInputs, promptContents, promptSha256 };
}

function expectedEvidencePaths(
  plan: C5PilotPlan,
  stageRows: readonly Record<string, unknown>[],
  pairRows: readonly Record<string, unknown>[],
  attemptRows: readonly Record<string, unknown>[],
): string[] {
  const paths: string[] = [...ROOT_EVIDENCE_PATHS];
  for (const row of attemptRows) {
    paths.push(requiredString(
      row.attemptEvidencePath,
      "C5 interrupted attempt evidence path",
    ));
  }
  const executions = new Map(stageRows.map((row) => [row.stageRunId, row]));
  const pairs = new Map(pairRows.map((row) => [
    `${row.clusterId}/${row.stageId}`,
    row,
  ]));
  const baselineArm = c5PlanBaselineArm(plan);
  for (const cluster of plan.clusters) {
    const root = trajectoryRoot(cluster.id);
    paths.push(`${root}/host-preflight.sanitized.json`);
    const runs = runsForCluster(plan, cluster);
    for (const run of runs) {
      paths.push(
        `${root}/${run.arm}/permission-isolation-preflight.sanitized.json`,
      );
      paths.push(`${root}/${run.arm}/task-alias-isolation.json`);
      for (const stage of run.stages) {
        paths.push(
          `${root}/${run.arm}/${stage.stageId}/stage-execution.sanitized.json`,
        );
        paths.push(`${root}/${run.arm}/${stage.stageId}/agent.patch`);
        const execution = executions.get(stage.id);
        if (
          run.arm === "goodmemory-installed" &&
          execution !== undefined &&
          execution?.memoryObservation !== null
        ) {
          paths.push(
            `${root}/${run.arm}/${stage.stageId}/host-canary/host-canary.sanitized.json`,
          );
          paths.push(
            `${root}/${run.arm}/${stage.stageId}/host-canary/codex-rollout.sanitized.jsonl`,
          );
        }
        // The comparator's sanitized injection receipt (hashes, token counts,
        // provider usage) is projected; the summary and history text are not.
        if (
          run.arm === "flat-summary" &&
          execution !== undefined &&
          execution.comparatorInjection !== null &&
          execution.comparatorInjection !== undefined
        ) {
          paths.push(comparatorReceiptPath(root, stage.stageId));
        }
      }
    }
    for (const stage of runs[0]!.stages) {
      const pairRoot = `pairs/${clusterDigest(cluster.id)}/${stage.stageId}`;
      paths.push(`${pairRoot}/live-leakage-audit.json`);
      const pair = pairs.get(`${cluster.id}/${stage.stageId}`);
      for (const arm of ["goodmemory-installed", baselineArm] as const) {
        const evaluation = Array.isArray(pair?.evaluations)
          ? pair.evaluations.map((value) => asRecord(
              value,
              "C5 expected evaluator path",
            )).find((value) => value.arm === arm)
          : undefined;
        const run = runs.find((candidate) => candidate.arm === arm);
        const execution = run === undefined
          ? undefined
          : executions.get(`${run.id}/${stage.stageId}`);
        paths.push(evaluatorEvidencePath({
          arm,
          codexStatus: execution?.codexStatus,
          disposition: evaluation?.disposition,
          pairRoot,
        }));
      }
    }
  }
  return [...paths].sort();
}

// An "infrastructure-failure" evaluation has two evidence shapes: when the
// evaluator itself could not run, the runner persists a sanitized failure
// receipt; when the evaluator ran against a stage whose Codex process never
// completed, it persists an ordinary evaluation whose score carries the
// infrastructure disposition and the execution failure stage.
function evaluatorEvidencePath(input: {
  arm: string;
  codexStatus: unknown;
  disposition: unknown;
  pairRoot: string;
}): string {
  if (
    input.disposition === "infrastructure-failure" &&
    input.codexStatus === "completed"
  ) {
    return `${input.pairRoot}/${input.arm}-evaluation-failure.sanitized.json`;
  }
  return `${input.pairRoot}/${input.arm}-evaluation.json`;
}

function verifyRunIdentity(
  identity: Record<string, unknown>,
  manifest: C5EvidenceProjectionManifest,
  planSha256: string,
): void {
  assertExactKeys(identity, [
    "claimBoundary",
    "evidenceClass",
    "generatedAt",
    "host",
    "model",
    "mutableRootsSha256",
    "networkAccess",
    "phase",
    "planSha256",
    "publicClaimEligible",
    "publicCodingEffectProof",
    "reasoningEffort",
    "runId",
    "runnerSourceAggregateSha256",
    "schemaVersion",
    "stageTimeoutMs",
    "testTimeoutMs",
  ], "C5 run identity");
  if (
    identity.schemaVersion !== 1 ||
    identity.phase !== "C5" ||
    identity.host !== "codex" ||
    identity.evidenceClass !== EVIDENCE_CLASS ||
    identity.claimBoundary !== CLAIM_BOUNDARY ||
    identity.networkAccess !== false ||
    identity.publicClaimEligible !== false ||
    identity.publicCodingEffectProof !== false ||
    identity.planSha256 !== planSha256 ||
    identity.runId !== manifest.runId ||
    requiredString(identity.model, "C5 identity model").length === 0 ||
    requiredString(identity.reasoningEffort, "C5 identity reasoning effort")
      .length === 0 ||
    !isPositiveInteger(identity.stageTimeoutMs) ||
    !isPositiveInteger(identity.testTimeoutMs)
  ) {
    throw new Error("C5 run identity is not bound to the frozen internal pilot");
  }
  assertSha256(
    identity.runnerSourceAggregateSha256,
    "C5 runner source aggregate binding",
  );
  assertSha256(identity.mutableRootsSha256, "C5 mutable roots binding");
  if (manifest.sourceRunIdentitySha256 !== sha256(
    `${JSON.stringify(identity, null, 2)}\n`,
  )) {
    throw new Error("C5 source run identity hash is inconsistent");
  }
}

function verifyRunnerSourceState(input: {
  identity: Record<string, unknown>;
  reader: ArtifactReader;
}): void {
  const beforeBytes = input.reader.bytes("runner-source-state.json");
  const afterBytes = input.reader.bytes("runner-source-state-post-run.json");
  if (beforeBytes !== afterBytes) {
    throw new Error("C5 runner source changed during the pilot");
  }
  const state = input.reader.json("runner-source-state.json");
  assertExactKeys(
    state,
    ["aggregateSha256", "files", "schemaVersion"],
    "C5 runner source state",
  );
  const aggregateSha256 = requiredSha256(
    state.aggregateSha256,
    "C5 runner source aggregate",
  );
  const files = asArray(state.files, "C5 runner source files");
  if (state.schemaVersion !== 2 || files.length < 6) {
    throw new Error("C5 runner source state is incomplete");
  }
  const normalized: Array<{
    bytes: number;
    path: string;
    sha256: string;
    sourceBase64: string;
  }> = [];
  const paths = new Set<string>();
  const sourceByPath = new Map<string, string>();
  for (const value of files) {
    const file = asRecord(value, "C5 runner source file");
    assertExactKeys(
      file,
      ["bytes", "path", "sha256", "sourceBase64"],
      "C5 runner source file",
    );
    const path = requiredString(file.path, "C5 runner source relative path");
    const sourceBase64 = requiredString(
      file.sourceBase64,
      "C5 runner source bytes",
    );
    const sourceBytes = Buffer.from(sourceBase64, "base64");
    if (
      !isSafeRelativePath(path) ||
      paths.has(path) ||
      !isNonNegativeInteger(file.bytes) ||
      sourceBytes.toString("base64") !== sourceBase64 ||
      sourceBytes.byteLength !== file.bytes ||
      sha256(sourceBytes) !== file.sha256
    ) {
      throw new Error("C5 runner source state contains unauthenticated bytes");
    }
    paths.add(path);
    sourceByPath.set(path, sourceBytes.toString("utf8"));
    normalized.push({
      bytes: file.bytes,
      path,
      sha256: requiredSha256(file.sha256, "C5 runner source file hash"),
      sourceBase64,
    });
  }
  if (
    !paths.has("bun.lock") ||
    !paths.has("bunfig.toml") ||
    !paths.has("package.json") ||
    !paths.has("tsconfig.json") ||
    !paths.has("scripts/prepare-codex-coding-effect-c5-pilot.ts") ||
    !paths.has("scripts/run-codex-coding-effect-c5-pilot.ts") ||
    // Code-point order, matching the capture's comparator; a locale-aware
    // comparison reorders mixed-case names such as rerankPool/reranker.
    normalized.some((file, index) =>
      index > 0 && !(normalized[index - 1]!.path < file.path)
    ) ||
    aggregateSha256 !== sha256(`${JSON.stringify(normalized)}\n`) ||
    input.identity.runnerSourceAggregateSha256 !== aggregateSha256
  ) {
    throw new Error("C5 runner source aggregate is inconsistent");
  }
  verifyEmbeddedRunnerImportClosure(sourceByPath);
}

function verifyEmbeddedRunnerImportClosure(
  sources: ReadonlyMap<string, string>,
): void {
  const entrypointPattern =
    /^scripts\/(?:gate|prepare|project|run|verify)-codex-coding-effect-c5(?:-[a-z0-9-]+)?\.ts$/u;
  const reachable = new Set(["bun.lock", "bunfig.toml", "package.json", "tsconfig.json"]);
  const pending = [...sources.keys()].filter((path) => entrypointPattern.test(path));
  while (pending.length > 0) {
    const path = pending.shift()!;
    if (reachable.has(path)) continue;
    const source = sources.get(path);
    if (source === undefined) throw new Error("C5 runner import closure is incomplete");
    reachable.add(path);
    for (const imported of ts.preProcessFile(source, true, true).importedFiles) {
      if (!imported.fileName.startsWith(".")) continue;
      const resolved = resolveEmbeddedRunnerImport(path, imported.fileName, sources);
      if (!reachable.has(resolved)) pending.push(resolved);
    }
  }
  if (!sameStrings([...reachable].sort(), [...sources.keys()].sort())) {
    throw new Error("C5 runner source contains files outside its import closure");
  }
}

function resolveEmbeddedRunnerImport(
  importer: string,
  specifier: string,
  sources: ReadonlyMap<string, string>,
): string {
  const unresolved = posix.normalize(posix.join(posix.dirname(importer), specifier));
  if (!isSafeRelativePath(unresolved)) {
    throw new Error("C5 runner import escapes the authenticated source closure");
  }
  const extension = posix.extname(unresolved);
  const candidates = extension.length > 0
    ? [
        unresolved,
        ...(extension === ".js" || extension === ".mjs" || extension === ".cjs"
          ? [
              unresolved.slice(0, -extension.length) + ".ts",
              unresolved.slice(0, -extension.length) + ".tsx",
              unresolved.slice(0, -extension.length) + ".mts",
              unresolved.slice(0, -extension.length) + ".cts",
            ]
          : []),
      ]
    : [
        `${unresolved}.ts`,
        `${unresolved}.tsx`,
        `${unresolved}.mts`,
        `${unresolved}.cts`,
        `${unresolved}.js`,
        `${unresolved}.json`,
        `${unresolved}/index.ts`,
        `${unresolved}/index.tsx`,
        `${unresolved}/index.mts`,
        `${unresolved}/index.js`,
      ];
  const resolved = candidates.find((candidate) => sources.has(candidate));
  if (resolved === undefined) throw new Error("C5 runner import closure is incomplete");
  return resolved;
}

function verifyStageExecutions(
  plan: C5PilotPlan,
  rows: Record<string, unknown>[],
): Map<string, Record<string, unknown>> {
  if (rows.length !== 72) {
    throw new Error("C5 stage ledger must contain exactly 72 rows");
  }
  const expected = new Map(plan.episodeArmRuns.flatMap((run) =>
    run.stages.map((stage) => [stage.id, { run, stage }] as const)
  ));
  const result = new Map<string, Record<string, unknown>>();
  const threadIds = new Set<string>();
  const runsWithPriorWriteback = new Set<string>();
  for (const row of rows) {
    const stageRunId = requiredString(row.stageRunId, "C5 stageRunId");
    const scheduled = expected.get(stageRunId);
    if (scheduled === undefined || result.has(stageRunId)) {
      throw new Error(`unexpected or duplicate C5 stage row ${stageRunId}`);
    }
    const { run, stage } = scheduled;
    assertExactKeys(row, [
      "arm",
      "clusterId",
      "codexDurationMs",
      "codexStatus",
      "codexUsage",
      ...(run.arm === "flat-summary" ? ["comparatorInjection"] : []),
      "episodeId",
      "infrastructureFailureStage",
      "memoryObservation",
      "memoryChannelStatus",
      "repetition",
      "stageEvidenceSha256",
      "stageId",
      "stageRunId",
      "threadId",
    ], "C5 stage ledger row");
    const infrastructureFailureStage = row.infrastructureFailureStage;
    if (
      row.arm !== run.arm ||
      row.clusterId !== run.clusterId ||
      row.episodeId !== run.episodeId ||
      row.repetition !== run.repetition ||
      row.stageId !== stage.stageId ||
      typeof row.codexStatus !== "string" ||
      row.codexStatus.length === 0 ||
      (infrastructureFailureStage !== null &&
        (typeof infrastructureFailureStage !== "string" ||
          infrastructureFailureStage.length === 0)) ||
      !isNonNegativeNumber(row.codexDurationMs)
    ) {
      throw new Error(`C5 stage ${stageRunId} has invalid execution evidence`);
    }
    assertSha256(row.stageEvidenceSha256, "C5 stage evidence hash");
    verifyUsage(row.codexUsage, stageRunId);
    const threadId = row.threadId;
    if (row.codexStatus === "completed") {
      requiredString(threadId, "C5 completed thread ID");
    } else if (threadId !== null) {
      requiredString(threadId, "C5 partial thread ID");
    }
    if (typeof threadId === "string") {
      if (threadIds.has(threadId)) {
        throw new Error("C5 reused a Codex thread");
      }
      threadIds.add(threadId);
    }
    if (run.arm !== "goodmemory-installed") {
      if (
        row.memoryChannelStatus !== "not-applicable" ||
        row.memoryObservation !== null
      ) {
        throw new Error(`C5 ${run.arm} arm reported a memory channel`);
      }
      if (run.arm === "flat-summary") {
        verifyComparatorInjectionRow(row, stageRunId);
      }
    } else {
      const writebackRequired = isC5StageWritebackRequired({
        priorWritebackCommitted: runsWithPriorWriteback.has(run.id),
        run,
        stage,
      });
      if (
        row.memoryChannelStatus !== "passed" &&
        row.memoryChannelStatus !== "failed"
      ) {
        throw new Error(`C5 stage ${stageRunId} has an invalid memory channel`);
      }
      if (row.memoryObservation !== null) {
        const observation = asRecord(
          row.memoryObservation,
          row.memoryChannelStatus === "passed"
            ? "C5 installed memory observation"
            : "C5 failed memory observation",
        );
        if (row.memoryChannelStatus === "passed") {
          verifyMemoryObservation(observation, stage, writebackRequired);
        } else {
          verifyFailedMemoryObservation(observation);
        }
        if (Number(observation.writtenMemoryCount) > 0) {
          runsWithPriorWriteback.add(run.id);
        }
      }
    }
    result.set(stageRunId, row);
  }
  if (result.size !== expected.size) {
    throw new Error("C5 stage ledger does not account for all scheduled processes");
  }
  return result;
}

// The flat-summary ledger row carries the comparator's injection receipt. A
// missing receipt is only legitimate when the stage failed before the
// comparator was prepared; the pair then records the mode mismatch.
function verifyComparatorInjectionRow(
  row: Record<string, unknown>,
  stageRunId: string,
): void {
  if (row.comparatorInjection === null) {
    if (row.infrastructureFailureStage === null) {
      throw new Error(
        `C5 flat-summary stage ${stageRunId} completed without an injection receipt`,
      );
    }
    return;
  }
  const injection = asRecord(
    row.comparatorInjection,
    `C5 flat-summary injection receipt ${stageRunId}`,
  );
  assertExactKeys(injection, [
    "historySourceSha256",
    "hookEvaluationPassed",
    "injectedContentSha256",
    "injectedTokenCount",
    "mode",
  ], `C5 flat-summary injection receipt ${stageRunId}`);
  const historySourceSha256 = requiredSha256(
    injection.historySourceSha256,
    `${stageRunId} history source hash`,
  );
  const zero = injection.mode === "no-history-zero-injection";
  if (
    (injection.mode !== "content-injection" && !zero) ||
    typeof injection.hookEvaluationPassed !== "boolean" ||
    !isNonNegativeInteger(injection.injectedTokenCount) ||
    zero !== (historySourceSha256 === EMPTY_FROZEN_PREHISTORY_SHA256) ||
    (zero
      ? injection.injectedContentSha256 !== null ||
        injection.injectedTokenCount !== 0
      : !SHA256_PATTERN.test(String(injection.injectedContentSha256)) ||
        injection.injectedTokenCount === 0 ||
        injection.injectedTokenCount >
          C5_FLAT_SUMMARY_USER_PROMPT_SUBMIT_MAX_TOKENS)
  ) {
    throw new Error(`C5 flat-summary injection receipt ${stageRunId} is malformed`);
  }
}

function comparatorInjectionOf(
  row: Record<string, unknown>,
): Record<string, unknown> | null {
  return row.comparatorInjection === null || row.comparatorInjection === undefined
    ? null
    : asRecord(row.comparatorInjection, "C5 comparator injection");
}

function comparatorReceiptPath(root: string, stageId: string): string {
  return `${root}/flat-summary/${stageId}/flat-summary/injection.sanitized.json`;
}

function verifyPairs(
  plan: C5PilotPlan,
  rows: Record<string, unknown>[],
): Map<string, Record<string, unknown>> {
  if (rows.length !== 36) {
    throw new Error("C5 pair ledger must contain exactly 36 rows");
  }
  const baselineArm = c5PlanBaselineArm(plan);
  const expected: Map<string, {
    cluster: C5PilotCluster;
    stage: C5PilotStageRun;
  }> = new Map(plan.clusters.flatMap((cluster) => {
    const run = runsForCluster(plan, cluster)[0]!;
    return run.stages.map((stage) => [
      `${cluster.id}/${stage.stageId}`,
      { cluster, stage },
    ] as const);
  }));
  const result = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    assertExactKeys(row, [
      "clusterId",
      "comparable",
      "episodeId",
      "evaluations",
      "incomparabilityReasons",
      "leakageAuditSha256",
      "memoryExpectation",
      "outcome",
      "repetition",
      "stageId",
    ], "C5 pair ledger row");
    const key = `${requiredString(row.clusterId, "C5 pair clusterId")}/${
      requiredString(row.stageId, "C5 pair stageId")}`;
    const scheduled = expected.get(key);
    if (scheduled === undefined || result.has(key)) {
      throw new Error(`unexpected or duplicate C5 pair ${key}`);
    }
    const reasons = asArray(row.incomparabilityReasons, "C5 pair reasons");
    const comparable = reasons.length === 0;
    if (
      row.episodeId !== scheduled.cluster.episodeId ||
      row.repetition !== scheduled.cluster.repetition ||
      row.memoryExpectation !== scheduled.stage.memoryExpectation ||
      row.comparable !== comparable ||
      (comparable
        ? row.outcome === "incomparable"
        : row.outcome !== "incomparable")
    ) {
      throw new Error(`C5 pair ${key} comparability is inconsistent`);
    }
    assertSha256(row.leakageAuditSha256, "C5 leakage audit binding");
    const evaluations = parsePairEvaluations(row.evaluations, key, baselineArm);
    const expectedOutcome = comparable
      ? pairOutcome(evaluations, baselineArm)
      : "incomparable";
    if (row.outcome !== expectedOutcome) {
      throw new Error(`C5 pair ${key} outcome is inconsistent`);
    }
    result.set(key, row);
  }
  if (result.size !== expected.size) {
    throw new Error("C5 pair ledger does not account for every scheduled pair");
  }
  return result;
}

function verifyInterruptedAttempts(input: {
  plan: C5PilotPlan;
  reader: ArtifactReader;
  rows: Record<string, unknown>[];
}): void {
  const clusterIds = new Set(input.plan.clusters.map((cluster) => cluster.id));
  const attemptIds = new Set<string>();
  const safeArtifactNames = new Set([
    "agent.patch",
    "codex-rollout.sanitized.jsonl",
    "goodmemory-installed-evaluation-failure.sanitized.json",
    "goodmemory-installed-evaluation.json",
    "host-canary.sanitized.json",
    "host-preflight.sanitized.json",
    "live-leakage-audit.json",
    "no-memory-evaluation-failure.sanitized.json",
    "no-memory-evaluation.json",
    "permission-isolation-preflight.sanitized.json",
    "stage-execution.sanitized.json",
    "task-alias-isolation.json",
  ]);
  for (const row of input.rows) {
    assertExactKeys(row, [
      "attemptEvidencePath",
      "attemptEvidenceSha256",
      "attemptId",
      "clusterId",
      "disposition",
      "schemaVersion",
    ], "C5 interrupted attempt row");
    const attemptId = requiredString(row.attemptId, "C5 interrupted attempt ID");
    const clusterId = requiredString(row.clusterId, "C5 interrupted cluster ID");
    const evidencePath = requiredString(
      row.attemptEvidencePath,
      "C5 interrupted attempt evidence path",
    );
    if (
      row.schemaVersion !== 1 ||
      row.disposition !== "process-interrupted-before-cluster-commit" ||
      !clusterIds.has(clusterId) ||
      attemptIds.has(attemptId) ||
      !new RegExp(`^${clusterDigest(clusterId)}-attempt-[1-9][0-9]*$`, "u")
        .test(attemptId) ||
      evidencePath !==
        `interrupted-attempts/${attemptId}/attempt.sanitized.json`
    ) {
      throw new Error("C5 interrupted attempt row is invalid");
    }
    attemptIds.add(attemptId);
    const evidenceBytes = input.reader.bytes(evidencePath);
    if (row.attemptEvidenceSha256 !== sha256(evidenceBytes)) {
      throw new Error("C5 interrupted attempt evidence hash is invalid");
    }
    const evidence = input.reader.json(evidencePath);
    assertExactKeys(evidence, [
      "artifacts",
      "attemptId",
      "clusterId",
      "commitTornTail",
      "disposition",
      "pairRows",
      "pairTornTail",
      "schemaVersion",
      "stageRows",
      "stageTornTail",
    ], "C5 interrupted attempt evidence");
    if (
      evidenceBytes !== `${JSON.stringify(evidence, null, 2)}\n` ||
      evidence.attemptId !== attemptId ||
      evidence.clusterId !== clusterId ||
      evidence.disposition !== row.disposition ||
      evidence.schemaVersion !== 1
    ) {
      throw new Error("C5 interrupted attempt evidence is not canonical");
    }
    const stageRows = asArray(evidence.stageRows, "C5 interrupted stage rows");
    const pairRows = asArray(evidence.pairRows, "C5 interrupted pair rows");
    const artifacts = asArray(evidence.artifacts, "C5 interrupted artifacts");
    const stageTail = verifyInterruptedTail(
      evidence.stageTornTail,
      "C5 interrupted stage tail",
    );
    const pairTail = verifyInterruptedTail(
      evidence.pairTornTail,
      "C5 interrupted pair tail",
    );
    const commitTail = verifyInterruptedTail(
      evidence.commitTornTail,
      "C5 interrupted cluster commit tail",
    );
    if (
      stageRows.length > 6 ||
      pairRows.length > 3
    ) {
      throw new Error("C5 interrupted attempt does not describe a partial cluster");
    }
    for (const value of stageRows) {
      const stage = asRecord(value, "C5 interrupted stage row");
      if (stage.clusterId !== clusterId) {
        throw new Error("C5 interrupted stage row drifted across clusters");
      }
      assertSha256(stage.stageEvidenceSha256, "C5 interrupted stage evidence hash");
    }
    for (const value of pairRows) {
      const pair = asRecord(value, "C5 interrupted pair row");
      if (pair.clusterId !== clusterId) {
        throw new Error("C5 interrupted pair row drifted across clusters");
      }
      assertSha256(pair.leakageAuditSha256, "C5 interrupted pair evidence hash");
    }
    const digest = clusterDigest(clusterId);
    let previousPath = "";
    for (const value of artifacts) {
      const artifact = asRecord(value, "C5 interrupted artifact");
      assertExactKeys(
        artifact,
        ["bytesBase64", "path", "sha256"],
        "C5 interrupted artifact",
      );
      const path = requiredString(artifact.path, "C5 interrupted artifact path");
      const bytesBase64 = requiredString(
        artifact.bytesBase64,
        "C5 interrupted artifact bytes",
      );
      const bytes = Buffer.from(bytesBase64, "base64");
      if (
        path.localeCompare(previousPath) <= 0 ||
        (!path.startsWith(`trajectories/${digest}/`) &&
          !path.startsWith(`pairs/${digest}/`)) ||
        !safeArtifactNames.has(basename(path)) ||
        bytes.toString("base64") !== bytesBase64 ||
        artifact.sha256 !== sha256(bytes)
      ) {
        throw new Error("C5 interrupted artifact is not independently bound");
      }
      previousPath = path;
    }
  }
}

function verifyClusterCommits(input: {
  pairs: readonly Record<string, unknown>[];
  plan: C5PilotPlan;
  rows: readonly Record<string, unknown>[];
  stages: readonly Record<string, unknown>[];
}): void {
  if (input.rows.length !== input.plan.clusters.length) {
    throw new Error("C5 projection requires one cleanup-safe commit per cluster");
  }
  for (const [index, row] of input.rows.entries()) {
    assertExactKeys(row, ["clusterId", "schemaVersion"], "C5 cluster commit");
    const cluster = input.plan.clusters[index];
    const stages = input.stages.slice(index * 6, (index + 1) * 6);
    const pairs = input.pairs.slice(index * 3, (index + 1) * 3);
    if (
      row.schemaVersion !== 1 ||
      row.clusterId !== cluster?.id ||
      stages.length !== 6 ||
      pairs.length !== 3 ||
      stages.some((stage) => stage.clusterId !== row.clusterId) ||
      pairs.some((pair) => pair.clusterId !== row.clusterId)
    ) {
      throw new Error("C5 cluster commit is not bound to an exact completed cluster");
    }
  }
}

function verifyInterruptedTail(value: unknown, label: string): boolean {
  if (value === null) return false;
  const tail = asRecord(value, label);
  assertExactKeys(tail, ["bytesBase64", "sha256"], label);
  const bytesBase64 = requiredString(tail.bytesBase64, `${label} bytes`);
  const bytes = Buffer.from(bytesBase64, "base64");
  if (
    bytes.toString("base64") !== bytesBase64 ||
    tail.sha256 !== sha256(bytes)
  ) {
    throw new Error(`${label} is not independently bound`);
  }
  return true;
}

function verifyHostPreflight(input: {
  baselineArm: C5BaselineArm;
  cluster: C5PilotCluster;
  identity: Record<string, unknown>;
  preflight: Record<string, unknown>;
  reader: ArtifactReader;
  root: string;
  runs: C5PilotEpisodeArmRun[];
}): {
  codexExecutableSha256: string;
  hostIdentitySha256: string;
  taskAliasAuditCount: number;
} {
  assertExactKeys(input.preflight, [
    "arms",
    "clusterId",
    "hostEnvironment",
    "hostIdentity",
    "hostIdentitySha256",
    "networkAccess",
    "repository",
    "schemaVersion",
  ], "C5 host preflight");
  if (
    input.preflight.schemaVersion !== 2 ||
    input.preflight.clusterId !== input.cluster.id ||
    input.preflight.networkAccess !== false
  ) {
    throw new Error(`invalid C5 host preflight for ${input.cluster.id}`);
  }
  const hostIdentity = asRecord(
    input.preflight.hostIdentity,
    "C5 host identity",
  );
  // The baseline arm is recorded in the host identity by comparator-aware
  // runners; the legacy no-memory identity may omit it, the flat-summary
  // comparator may not.
  const identityRecordsBaseline = "baselineArm" in hostIdentity;
  assertExactKeys(hostIdentity, [
    ...(identityRecordsBaseline ? ["baselineArm"] : []),
    "codexExecutableSha256",
    "codexVersion",
    "goodMemoryPackageSha256",
    "goodMemoryPackageVersion",
    "comparableHostEnvironmentSha256",
    "installedProfile",
    "model",
    "reasoningEffort",
  ], "C5 host identity");
  if (
    (identityRecordsBaseline &&
      hostIdentity.baselineArm !== input.baselineArm) ||
    (!identityRecordsBaseline && input.baselineArm !== "no-memory")
  ) {
    throw new Error("C5 host identity is not bound to the plan's baseline arm");
  }
  const codexExecutableSha256 = requiredSha256(
    hostIdentity.codexExecutableSha256,
    "C5 Codex executable hash",
  );
  assertSha256(hostIdentity.goodMemoryPackageSha256, "C5 package hash");
  const hostEnvironment = parseC5HostEnvironment(
    input.preflight.hostEnvironment,
  );
  if (
    input.baselineArm === "no-memory"
      ? hostEnvironment.baselineArm !== undefined &&
        hostEnvironment.baselineArm !== "no-memory"
      : hostEnvironment.baselineArm !== "flat-summary" ||
        hostEnvironment.configurations.arms.noMemory.hooksConfig
          ?.normalizedText !== FLAT_SUMMARY_NORMALIZED_HOOK_CONFIG
  ) {
    throw new Error(
      "C5 host environment baseline configuration is not the frozen comparator",
    );
  }
  const comparableHostEnvironmentSha256 = requiredSha256(
    hostIdentity.comparableHostEnvironmentSha256,
    "C5 comparable host environment binding",
  );
  if (
    comparableHostEnvironmentSha256 !==
      hashC5ComparableHostEnvironment(hostEnvironment)
  ) {
    throw new Error("C5 comparable host environment hash is inconsistent");
  }
  requiredString(hostIdentity.codexVersion, "C5 Codex version");
  requiredString(hostIdentity.goodMemoryPackageVersion, "C5 package version");
  if (
    hostIdentity.model !== input.identity.model ||
    hostIdentity.reasoningEffort !== input.identity.reasoningEffort
  ) {
    throw new Error("C5 host preflight model identity drifted");
  }
  verifyInstalledProfile(hostIdentity.installedProfile);
  const hostIdentitySha256 = requiredSha256(
    input.preflight.hostIdentitySha256,
    "C5 host identity binding",
  );
  if (hostIdentitySha256 !== sha256(JSON.stringify(hostIdentity))) {
    throw new Error("C5 host preflight identity hash is inconsistent");
  }
  const repository = asRecord(input.preflight.repository, "C5 repository identity");
  assertExactKeys(repository, ["commit", "tree"], "C5 repository identity");
  if (
    !isGitObject(repository.commit) ||
    !isGitObject(repository.tree)
  ) {
    throw new Error("C5 host preflight has no frozen repository identity");
  }

  const arms = asArray(input.preflight.arms, "C5 host preflight arms");
  if (arms.length !== 2) {
    throw new Error("C5 host preflight must bind exactly two arms");
  }
  const byArm = new Map<C5PilotArm, Record<string, unknown>>();
  for (const value of arms) {
    const arm = asRecord(value, "C5 host preflight arm");
    assertExactKeys(arm, [
      "arm",
      "instructionSha256",
      "noMemoryAbsence",
      "permissionIsolationSha256",
      "taskAliasIsolationSha256",
    ], "C5 host preflight arm");
    if (arm.arm !== input.baselineArm && arm.arm !== "goodmemory-installed") {
      throw new Error("C5 host preflight has an unknown arm");
    }
    const armName = arm.arm as C5PilotArm;
    if (byArm.has(armName)) {
      throw new Error("C5 host preflight duplicated an arm");
    }
    assertSha256(arm.instructionSha256, "C5 instruction binding");
    const permissionPath =
      `${input.root}/${armName}/permission-isolation-preflight.sanitized.json`;
    const aliasPath = `${input.root}/${armName}/task-alias-isolation.json`;
    if (
      arm.permissionIsolationSha256 !== sha256(input.reader.bytes(permissionPath)) ||
      arm.taskAliasIsolationSha256 !== sha256(input.reader.bytes(aliasPath))
    ) {
      throw new Error(`C5 host preflight evidence hash mismatch for ${armName}`);
    }
    verifyNoMemoryAbsence(armName, arm.noMemoryAbsence);
    byArm.set(armName, arm);
  }
  const instructionHashes = new Set(
    [...byArm.values()].map((arm) => arm.instructionSha256),
  );
  if (
    byArm.size !== 2 ||
    instructionHashes.size !== 1 ||
    input.runs.some((run) => !byArm.has(run.arm))
  ) {
    throw new Error("C5 host preflight arms are not identically instructed");
  }
  return {
    codexExecutableSha256,
    hostIdentitySha256,
    taskAliasAuditCount: 2,
  };
}

// Both baselines must be free of GoodMemory files, MCP registration, and
// prior sessions. The flat-summary comparator alone carries a hooks.json (its
// own SessionStart/UserPromptSubmit runner), which the preflight audits.
function verifyNoMemoryAbsence(
  arm: C5PilotArm,
  value: unknown,
): void {
  if (arm === "goodmemory-installed") {
    if (value !== null) {
      throw new Error("C5 installed arm must not claim no-memory absence");
    }
    return;
  }
  const absence = asRecord(value, `C5 ${arm} absence audit`);
  assertExactKeys(absence, [
    "goodMemoryFileCount",
    "hookConfigPresent",
    "mcpConfigPresent",
    "passed",
    "preexistingSessionCount",
  ], `C5 ${arm} absence audit`);
  if (
    absence.passed !== true ||
    absence.goodMemoryFileCount !== 0 ||
    absence.hookConfigPresent !== (arm === "flat-summary") ||
    absence.mcpConfigPresent !== false ||
    absence.preexistingSessionCount !== 0
  ) {
    throw new Error(`C5 ${arm} arm contains GoodMemory or prior session state`);
  }
}

function verifyPermissionIsolation(
  evidence: Record<string, unknown>,
  label: string,
): void {
  assertExactKeys(evidence, [
    "configSha256",
    "deniedReads",
    "networkAccess",
    "networkDenied",
    "networkPositiveControl",
    "passed",
    "phase",
    "profileName",
    "reasons",
    "schemaVersion",
    "workspaceRead",
    "workspaceWrite",
  ], label);
  if (
    evidence.schemaVersion !== 1 ||
    evidence.profileName !== "c3-task" ||
    evidence.phase !== "preflight" ||
    evidence.networkAccess !== false ||
    evidence.networkDenied !== true ||
    evidence.networkPositiveControl !== true ||
    evidence.workspaceRead !== true ||
    evidence.workspaceWrite !== true ||
    evidence.passed !== true ||
    asArray(evidence.reasons, `${label} reasons`).length !== 0
  ) {
    throw new Error(`${label} is not a passing task sandbox audit`);
  }
  assertSha256(evidence.configSha256, `${label} config hash`);
  const deniedReads = asArray(evidence.deniedReads, `${label} denied reads`);
  if (deniedReads.length < 12) {
    throw new Error(`${label} does not cover the complete denied-read surface`);
  }
  const labels = new Set<string>();
  for (const value of deniedReads) {
    const probe = asRecord(value, `${label} denied-read probe`);
    assertExactKeys(probe, [
      "denied",
      "exitCode",
      "label",
      "pathSha256",
    ], `${label} denied-read probe`);
    const probeLabel = requiredString(probe.label, `${label} probe label`);
    if (
      labels.has(probeLabel) ||
      probe.denied !== true ||
      !isIntegerOrNull(probe.exitCode) ||
      !SHA256_PATTERN.test(String(probe.pathSha256))
    ) {
      throw new Error(`${label} contains an invalid denied-read probe`);
    }
    labels.add(probeLabel);
  }
}

function verifyTaskAliasIsolation(
  evidence: Record<string, unknown>,
  label: string,
): void {
  assertExactKeys(evidence, [
    "aliases",
    "passed",
    "profileName",
    "schemaVersion",
  ], label);
  if (
    evidence.schemaVersion !== 1 ||
    evidence.profileName !== "c3-task" ||
    evidence.passed !== true
  ) {
    throw new Error(`${label} is not a passing alias-isolation audit`);
  }
  const aliases = asArray(evidence.aliases, `${label} aliases`);
  if (aliases.length < REQUIRED_ALIAS_LABELS.length) {
    throw new Error(`${label} does not cover all protected aliases`);
  }
  const labels = new Set<string>();
  for (const value of aliases) {
    const alias = asRecord(value, `${label} alias`);
    assertExactKeys(alias, [
      "denied",
      "exitCode",
      "label",
      "targetPathSha256",
    ], `${label} alias`);
    const aliasLabel = requiredString(alias.label, `${label} alias label`);
    if (
      labels.has(aliasLabel) ||
      alias.denied !== true ||
      !isIntegerOrNull(alias.exitCode)
    ) {
      throw new Error(`${label} contains an invalid protected alias`);
    }
    assertSha256(alias.targetPathSha256, `${label} target path hash`);
    labels.add(aliasLabel);
  }
  if (REQUIRED_ALIAS_LABELS.some((required) => !labels.has(required))) {
    throw new Error(`${label} is missing a required protected alias`);
  }
}

function verifyStageEvidence(input: {
  codexExecutableSha256: string;
  comparator: ReturnType<typeof frozenComparatorInput>;
  expectedPriorMemoryIds: readonly string[];
  expectedPromptSha256: string;
  execution: Record<string, unknown>;
  permissionSha256: string;
  reader: ArtifactReader;
  root: string;
  run: C5PilotEpisodeArmRun;
  stage: C5PilotStageRun;
  stagePath: string;
  writebackRequired: boolean;
}): string[] {
  const bytes = input.reader.bytes(input.stagePath);
  if (input.execution.stageEvidenceSha256 !== sha256(bytes)) {
    throw new Error(`C5 stage evidence hash mismatch: ${input.stage.id}`);
  }
  const evidence = input.reader.json(input.stagePath);
  assertExactKeys(evidence, [
    "canaryEvidenceSha256",
    "codex",
    ...(input.run.arm === "flat-summary" ? ["comparatorEvidenceSha256"] : []),
    "effectivePromptSha256",
    "events",
    "execution",
    "failureReasonSha256",
    "patch",
    "permissionIsolationSha256",
    "schemaVersion",
    "visibleBaseHealth",
  ], input.stagePath);
  const failed = input.execution.infrastructureFailureStage !== null;
  if (
    evidence.schemaVersion !== 1 ||
    (failed
      ? !SHA256_PATTERN.test(String(evidence.failureReasonSha256))
      : evidence.failureReasonSha256 !== null) ||
    evidence.permissionIsolationSha256 !== input.permissionSha256
  ) {
    throw new Error(`C5 stage evidence is not clean: ${input.stage.id}`);
  }
  const effectivePromptSha256 = requiredSha256(
    evidence.effectivePromptSha256,
    `${input.stagePath} effective prompt hash`,
  );
  if (
    effectivePromptSha256 !== input.expectedPromptSha256 &&
    !(failed && effectivePromptSha256 === sha256(""))
  ) {
    throw new Error(`C5 stage prompt drifted from the frozen dataset: ${input.stage.id}`);
  }
  const evidenceExecution = asRecord(
    evidence.execution,
    `${input.stagePath} execution`,
  );
  const expectedExecution = { ...input.execution };
  delete expectedExecution.clusterId;
  delete expectedExecution.episodeId;
  delete expectedExecution.repetition;
  delete expectedExecution.stageEvidenceSha256;
  delete expectedExecution.stageId;
  if (JSON.stringify(evidenceExecution) !== JSON.stringify(expectedExecution)) {
    throw new Error(`C5 stage ledger drifted from its evidence: ${input.stage.id}`);
  }
  verifyCodexStageSummary(evidence.codex, input.execution);
  if (failed) {
    verifyFailedStageEvents(evidence.events, input.execution);
  } else {
    verifyStageEvents(
      evidence.events,
      input.codexExecutableSha256,
      input.execution,
    );
  }
  const agentPatchPath =
    `${input.root}/${input.run.arm}/${input.stage.stageId}/agent.patch`;
  verifyPatchSummary(
    evidence.patch,
    input.reader.bytes(agentPatchPath),
    input.stagePath,
  );
  if (failed) {
    verifyFailedVisibleBaseHealth(evidence.visibleBaseHealth, input.stagePath);
  } else {
    verifyVisibleBaseHealth(evidence.visibleBaseHealth, input.stagePath);
  }
  if (input.run.arm !== "goodmemory-installed") {
    if (evidence.canaryEvidenceSha256 !== null) {
      throw new Error(
        `C5 ${input.run.arm} stage unexpectedly contains host canary evidence`,
      );
    }
    if (input.run.arm === "flat-summary") {
      verifyComparatorStageEvidence({
        comparator: input.comparator,
        evidence,
        execution: input.execution,
        reader: input.reader,
        root: input.root,
        stage: input.stage,
      });
    }
    return [];
  }
  if (evidence.canaryEvidenceSha256 === null) {
    if (input.execution.memoryObservation !== null) {
      throw new Error(`C5 stage ${input.stage.id} omitted its host canary`);
    }
    return [];
  }
  const canaryPath =
    `${input.root}/${input.run.arm}/${input.stage.stageId}/host-canary/host-canary.sanitized.json`;
  const transcriptPath =
    `${input.root}/${input.run.arm}/${input.stage.stageId}/host-canary/codex-rollout.sanitized.jsonl`;
  if (evidence.canaryEvidenceSha256 !== sha256(input.reader.bytes(canaryPath))) {
    throw new Error(`C5 host canary hash mismatch: ${input.stage.id}`);
  }
  return verifyHostCanary({
    canary: input.reader.json(canaryPath),
    expectedPriorMemoryIds: input.expectedPriorMemoryIds,
    expectedPromptSha256: input.expectedPromptSha256,
    execution: input.execution,
    sanitizedTranscript: input.reader.bytes(transcriptPath),
    stage: input.stage,
    writebackRequired: input.writebackRequired,
  });
}

// The flat-summary stage binds its sanitized injection receipt by hash. The
// receipt must agree with the ledger row, the frozen comparator protocol, and
// the C6 injection-budget contract; the summary text itself is never projected.
function verifyComparatorStageEvidence(input: {
  comparator: ReturnType<typeof frozenComparatorInput>;
  evidence: Record<string, unknown>;
  execution: Record<string, unknown>;
  reader: ArtifactReader;
  root: string;
  stage: C5PilotStageRun;
}): void {
  const injection = comparatorInjectionOf(input.execution);
  if (injection === null) {
    if (input.evidence.comparatorEvidenceSha256 !== null) {
      throw new Error(
        `C5 flat-summary stage ${input.stage.id} binds a receipt it never produced`,
      );
    }
    return;
  }
  if (input.comparator === undefined) {
    throw new Error("C5 flat-summary stage evidence requires the comparator protocol");
  }
  const path = comparatorReceiptPath(input.root, input.stage.stageId);
  const bytes = input.reader.bytes(path);
  if (input.evidence.comparatorEvidenceSha256 !== sha256(bytes)) {
    throw new Error(`C5 comparator receipt hash mismatch: ${input.stage.id}`);
  }
  const receipt = input.reader.json(path);
  assertExactKeys(receipt, [
    "generation",
    "historySourceSha256",
    "injection",
    "priorStageIds",
    "schemaVersion",
  ], path);
  const zero = injection.mode === "no-history-zero-injection";
  if (
    receipt.schemaVersion !== 1 ||
    receipt.historySourceSha256 !== injection.historySourceSha256 ||
    !sameStrings(
      stringArray(receipt.priorStageIds, `${path} prior stage IDs`),
      input.stage.priorStageIds,
    )
  ) {
    throw new Error(`${path} is not bound to its stage history`);
  }
  const record = asRecord(receipt.injection, `${path} injection`);
  assertExactKeys(record, [
    "injectedUtf8Bytes",
    "mode",
    "semanticSurfaceCommitmentSha256",
    "sessionStart",
    "userPromptSubmit",
  ], `${path} injection`);
  const expectedContentSha256 = zero
    ? sha256("")
    : requiredSha256(injection.injectedContentSha256, `${path} content hash`);
  if (
    record.mode !== injection.mode ||
    !isNonNegativeInteger(record.injectedUtf8Bytes) ||
    (zero
      ? record.injectedUtf8Bytes !== 0 ||
        record.semanticSurfaceCommitmentSha256 !==
          sha256(JSON.stringify([""]))
      : record.injectedUtf8Bytes === 0 ||
        !SHA256_PATTERN.test(String(record.semanticSurfaceCommitmentSha256)))
  ) {
    throw new Error(`${path} injection surface commitments are inconsistent`);
  }
  for (const [placement, cap] of [
    ["sessionStart", C5_FLAT_SUMMARY_SESSION_START_MAX_TOKENS],
    ["userPromptSubmit", C5_FLAT_SUMMARY_USER_PROMPT_SUBMIT_MAX_TOKENS],
  ] as const) {
    assertExactRecord(record[placement], {
      arm: "flat-summary",
      compositionSha256: zero
        ? C6_NO_HISTORY_ZERO_INJECTION_COMPOSITION_SHA256
        : C6_FLAT_SUMMARY_INJECTION_COMPOSITION_SHA256,
      contentSha256: expectedContentSha256,
      historySourceSha256: injection.historySourceSha256,
      injectedTokenCount: injection.injectedTokenCount,
      injectionMode: injection.mode,
      maxInjectedTokens: cap,
      schemaVersion: 2,
      tokenCounterId: C6_INJECTION_TOKEN_COUNTER_ID,
      tokenCounterSha256: C6_INJECTION_TOKEN_COUNTER_SHA256,
    }, `${path} ${placement} budget receipt`);
  }
  if (zero) {
    if (receipt.generation !== null) {
      throw new Error(`${path} generated a summary for a no-history stage`);
    }
    return;
  }
  const generation = asRecord(receipt.generation, `${path} generation`);
  assertExactKeys(generation, [
    "leakageAuditSha256",
    "model",
    "promptSha256",
    "redactedRequestSha256",
    "requestSha256",
    "responseSha256",
    "usage",
  ], `${path} generation`);
  if (
    generation.model !== input.comparator.summaryModel ||
    generation.promptSha256 !== input.comparator.summaryPromptSha256 ||
    generation.usage === null
  ) {
    throw new Error(`${path} summary was not generated by the frozen protocol`);
  }
  for (const key of [
    "leakageAuditSha256",
    "redactedRequestSha256",
    "requestSha256",
    "responseSha256",
  ]) {
    assertSha256(generation[key], `${path} generation ${key}`);
  }
  verifyUsage(generation.usage, `${path} generation`);
}

function verifyCodexStageSummary(
  value: unknown,
  execution: Record<string, unknown>,
): void {
  const codex = asRecord(value, "C5 stage Codex summary");
  assertExactKeys(codex, [
    "durationMs",
    "eventCount",
    "exitCode",
    "status",
    "timedOut",
    "usage",
  ], "C5 stage Codex summary");
  if (
    codex.durationMs !== execution.codexDurationMs ||
    codex.status !== execution.codexStatus ||
    (execution.codexStatus === "completed" &&
      (codex.timedOut !== false || codex.exitCode !== 0)) ||
    (execution.codexStatus === "timed-out" && codex.timedOut !== true) ||
    typeof codex.timedOut !== "boolean" ||
    !isIntegerOrNull(codex.exitCode) ||
    !isNonNegativeInteger(codex.eventCount) ||
    JSON.stringify(codex.usage) !== JSON.stringify(execution.codexUsage)
  ) {
    throw new Error("C5 stage Codex evidence is not a completed process");
  }
}

function verifyFailedStageEvents(
  value: unknown,
  execution: Record<string, unknown>,
): void {
  for (const item of asArray(value, "C5 failed stage events")) {
    const event = asRecord(item, "C5 failed stage event");
    assertExactKeys(event, [
      "arm",
      "attemptId",
      "details",
      "episodeId",
      "event",
      "repetition",
      "runId",
      "seed",
      "stageId",
      "timestamp",
      "traceId",
    ], "C5 failed stage event");
    if (
      event.arm !== execution.arm ||
      event.episodeId !== execution.episodeId ||
      event.repetition !== execution.repetition ||
      event.stageId !== execution.stageId ||
      event.traceId !== execution.stageRunId
    ) {
      throw new Error("C5 failed stage event identity is inconsistent");
    }
    asRecord(event.details, "C5 failed stage event details");
  }
}

function verifyStageEvents(
  value: unknown,
  codexExecutableSha256: string,
  execution: Record<string, unknown>,
): void {
  const events = asArray(value, "C5 stage events");
  if (events.length !== 3) {
    throw new Error(
      "C5 completed stage must contain start, exit, and patch receipt events",
    );
  }
  for (const [index, value] of events.entries()) {
    const event = asRecord(value, "C5 stage event");
    assertExactKeys(event, [
      "arm",
      "attemptId",
      "details",
      "episodeId",
      "event",
      "repetition",
      "runId",
      "seed",
      "stageId",
      "timestamp",
      "traceId",
    ], "C5 stage event");
    if (
      event.arm !== execution.arm ||
      event.episodeId !== execution.episodeId ||
      event.repetition !== execution.repetition ||
      event.stageId !== execution.stageId ||
      event.traceId !== execution.stageRunId ||
      !isPositiveInteger(event.seed) ||
      requiredString(event.runId, "C5 event runId").length === 0 ||
      requiredString(event.attemptId, "C5 event attemptId").length === 0 ||
      requiredString(event.timestamp, "C5 event timestamp").length === 0
    ) {
      throw new Error("C5 stage event identity is inconsistent");
    }
    const details = asRecord(event.details, "C5 stage event details");
    if (index === 0) {
      assertExactKeys(
        details,
        ["argumentCount", "executableSha256"],
        "C5 start event",
      );
      if (
        event.event !== "codex_process_started" ||
        !isPositiveInteger(details.argumentCount) ||
        details.executableSha256 !== codexExecutableSha256
      ) {
        throw new Error("C5 Codex start event is invalid");
      }
    } else if (index === 1) {
      assertExactKeys(details, [
        "durationMs",
        "exitCode",
        "status",
        "timedOut",
      ], "C5 exit event");
      if (
        event.event !== "codex_process_exited" ||
        details.durationMs !== execution.codexDurationMs ||
        details.exitCode !== 0 ||
        details.status !== "exited" ||
        details.timedOut !== false
      ) {
        throw new Error("C5 Codex exit event is invalid");
      }
    } else {
      assertExactKeys(details, [
        "changedFileCount",
        "forbiddenFileCount",
        "hasPatch",
        "sha256",
        "untrackedFileCount",
      ], "C5 patch receipt event");
      if (
        event.event !== "patch_captured" ||
        !isNonNegativeInteger(details.changedFileCount) ||
        !isNonNegativeInteger(details.forbiddenFileCount) ||
        !isNonNegativeInteger(details.untrackedFileCount) ||
        typeof details.hasPatch !== "boolean" ||
        (details.hasPatch
          ? !SHA256_PATTERN.test(String(details.sha256))
          : details.sha256 !== null)
      ) {
        throw new Error("C5 patch receipt event is invalid");
      }
    }
  }
}

function verifyPatchSummary(
  value: unknown,
  agentPatch: string,
  label: string,
): void {
  const patch = asRecord(value, `${label} patch`);
  assertExactKeys(patch, [
    "changedFiles",
    "forbiddenFiles",
    "hasPatch",
    "sha256",
    "untrackedFiles",
  ], `${label} patch`);
  const changed = stringArray(patch.changedFiles, `${label} changed files`);
  const forbidden = stringArray(patch.forbiddenFiles, `${label} forbidden files`);
  const untracked = asArray(patch.untrackedFiles, `${label} untracked files`);
  for (const value of untracked) {
    const file = asRecord(value, `${label} untracked file`);
    assertExactKeys(file, ["path", "sha256", "size"], `${label} untracked file`);
    requiredString(file.path, `${label} untracked file path`);
    assertSha256(file.sha256, `${label} untracked file hash`);
    if (!isNonNegativeInteger(file.size)) {
      throw new Error(`${label} untracked file has an invalid size`);
    }
  }
  if (
    typeof patch.hasPatch !== "boolean" ||
    (patch.hasPatch
      ? patch.sha256 !== sha256(agentPatch)
      : patch.sha256 !== null || agentPatch !== "") ||
    (forbidden.length > 0 && changed.length === 0)
  ) {
    throw new Error(`${label} has an invalid patch summary`);
  }
}

function verifyVisibleBaseHealth(value: unknown, label: string): void {
  const visible = asRecord(value, `${label} visible base health`);
  assertExactKeys(visible, [
    "durationMs",
    "exitCode",
    "passed",
    "status",
  ], `${label} visible base health`);
  if (
    !isNonNegativeNumber(visible.durationMs) ||
    visible.exitCode !== 0 ||
    visible.passed !== true ||
    visible.status !== "passed"
  ) {
    throw new Error(`${label} did not start from a healthy visible base`);
  }
}

function verifyFailedVisibleBaseHealth(value: unknown, label: string): void {
  if (value === null) return;
  const visible = asRecord(value, `${label} visible base health`);
  assertExactKeys(visible, [
    "durationMs",
    "exitCode",
    "passed",
    "status",
  ], `${label} visible base health`);
  if (
    !isNonNegativeNumber(visible.durationMs) ||
    !isIntegerOrNull(visible.exitCode) ||
    typeof visible.passed !== "boolean" ||
    typeof visible.status !== "string"
  ) {
    throw new Error(`${label} contains invalid visible base-health evidence`);
  }
}

function verifyHostCanary(input: {
  canary: Record<string, unknown>;
  expectedPriorMemoryIds: readonly string[];
  expectedPromptSha256: string;
  execution: Record<string, unknown>;
  sanitizedTranscript: string;
  stage: C5PilotStageRun;
  writebackRequired: boolean;
}): string[] {
  assertExactKeys(input.canary, [
    "canary",
    "collectionFailures",
    "liveSurfaceSha256",
    "schemaVersion",
    "sessionDigest",
    "sourceReceipts",
    "sources",
  ], "C5 host canary");
  const sessionDigest = requiredString(
    input.canary.sessionDigest,
    "C5 canary session digest",
  );
  if (
    input.canary.schemaVersion !== 3 ||
    sessionDigest.length === 0
  ) {
    throw new Error("invalid C5 host canary envelope");
  }
  const collectionFailures = verifyCanaryCollectionFailures(
    input.canary.collectionFailures,
  );
  const sources = asRecord(input.canary.sources, "C5 host canary sources");
  assertExactKeys(sources, [
    "cursorSourceSha256",
    "injectionSourceSha256",
    "memoryExportSha256",
    "sanitizedTranscriptSha256",
    "transcriptSourceSha256",
    "writebackSourceSha256",
  ], "C5 host canary sources");
  assertSha256(
    sources.memoryExportSha256,
    "C5 memory export source commitment",
  );
  assertSha256(
    sources.sanitizedTranscriptSha256,
    "C5 sanitized transcript commitment",
  );
  verifyCollectedSourceCommitment(
    sources.transcriptSourceSha256,
    collectionFailures.has("codex-transcript"),
    "C5 transcript source commitment",
  );
  verifyCollectedSourceCommitment(
    sources.injectionSourceSha256,
    collectionFailures.has("injection-state"),
    "C5 injection source commitment",
  );
  verifyCollectedSourceCommitment(
    sources.cursorSourceSha256,
    collectionFailures.has("stop-cursor"),
    "C5 cursor source commitment",
  );
  verifyCollectedSourceCommitment(
    sources.writebackSourceSha256,
    collectionFailures.has("writeback-inspection"),
    "C5 writeback source commitment",
  );
  const sourceReceipt = verifyHostCanarySourceReceipts({
    expectedPromptSha256: input.expectedPromptSha256,
    sessionDigest,
    sourceReceipts: input.canary.sourceReceipts,
    sources,
  });
  const canary = asRecord(input.canary.canary, "C5 host canary result");
  assertExactKeys(canary, [
    "currentWrittenMemoryIds",
    "hookContexts",
    "injectedRecordIds",
    "irrelevantInjection",
    "memoryChannelStatus",
    "passed",
    "recalledPriorMemoryIds",
    "reasons",
    "stopCursorAdvanced",
    "writebackCommitted",
  ], "C5 host canary result");
  const written = canonicalStringArray(
    canary.currentWrittenMemoryIds,
    "C5 written memory IDs",
  );
  const injected = canonicalStringArray(
    canary.injectedRecordIds,
    "C5 injected memory IDs",
  );
  const recalled = canonicalStringArray(
    canary.recalledPriorMemoryIds,
    "C5 recalled memory IDs",
  );
  const lineage = resolveC5PriorMemoryLineage({
    exportedMemoryIds: sourceReceipt.memoryRecordIds,
    injectedMemoryIds: injected,
    priorWritebackMemoryIds: input.expectedPriorMemoryIds,
  });
  const expectedPrior = lineage.expectedPriorMemoryIds;
  const expectedRecalled = lineage.expectedRecalledMemoryIds;
  const reasons = stringArray(canary.reasons, "C5 host canary reasons");
  if (
    !lineage.containsPriorWritebackLineage &&
    !reasons.includes(C5_PRIOR_EXPORT_LINEAGE_REASON)
  ) {
    throw new Error("C5 host canary omitted prior-memory lineage failure");
  }
  for (const source of collectionFailures.keys()) {
    if (!reasons.includes(`source-collection-failed:${source}`)) {
      throw new Error("C5 host canary omitted a source collection failure");
    }
  }
  const passed = reasons.length === 0;
  if (
    canary.passed !== passed ||
    canary.memoryChannelStatus !== (passed ? "passed" : "failed") ||
    canary.writebackCommitted !== (written.length > 0) ||
    !sameStrings(written, sourceReceipt.writtenMemoryIds) ||
    !sameStrings(injected, sourceReceipt.injectedRecordIds) ||
    (passed && !lineage.containsPriorWritebackLineage) ||
    canary.stopCursorAdvanced !== sourceReceipt.stopCursorAdvanced ||
    canary.irrelevantInjection !==
      (input.stage.memoryExpectation === "irrelevant-control" &&
        injected.length > 0) ||
    (passed && canary.stopCursorAdvanced !== true) ||
    (passed && input.writebackRequired && canary.writebackCommitted !== true) ||
    (passed && input.stage.memoryExpectation === "none" && injected.length > 0) ||
    (passed && input.stage.memoryExpectation === "required" && recalled.length === 0) ||
    (passed && !sameStrings(recalled, expectedRecalled)) ||
    (passed && !sameStrings(injected, expectedRecalled))
  ) {
    throw new Error(
      `C5 host canary rejected recall/writeback binding to a prior native Stop: ${input.stage.id}`,
    );
  }
  const hookContexts = asArray(canary.hookContexts, "C5 hook context receipts");
  const hookContextHashes: string[] = [];
  const hookContextSegments: Array<{
    contentByteLength: number;
    contentSha256: string;
  }> = [];
  for (const value of hookContexts) {
    const context = asRecord(value, "C5 hook context receipt");
    assertExactKeys(
      context,
      ["contentByteLength", "contentHash", "contentSha256"],
      "C5 hook context receipt",
    );
    const contentHash = requiredString(context.contentHash, "C5 hook context hash");
    if (!/^content:[a-f0-9]{24}$/u.test(contentHash)) {
      throw new Error("C5 hook context hash has an invalid format");
    }
    const contentSha256 = requiredSha256(
      context.contentSha256,
      "C5 hook context SHA-256",
    );
    if (contentHash !== `content:${contentSha256.slice(0, 24)}`) {
      throw new Error("C5 hook context hash is not derived from its content SHA-256");
    }
    if (!isNonNegativeInteger(context.contentByteLength)) {
      throw new Error("C5 hook context byte length is invalid");
    }
    hookContextHashes.push(contentHash);
    hookContextSegments.push({
      contentByteLength: context.contentByteLength,
      contentSha256,
    });
  }
  hookContextHashes.sort();
  if (
    !sameStrings(hookContextHashes, sourceReceipt.contentHashes) ||
    JSON.stringify(hookContextSegments) !==
      JSON.stringify(sourceReceipt.hookContextSegments) ||
    sha256(JSON.stringify(hookContexts)) !==
      sourceReceipt.hookContextReceiptSha256
  ) {
    throw new Error("C5 hook context receipts drifted from injection state");
  }
  const observation = asRecord(
    input.execution.memoryObservation,
    "C5 memory observation",
  );
  if (
    observation.injectedRecordCount !== injected.length ||
    observation.recalledPriorMemoryCount !== recalled.length ||
    observation.writtenMemoryCount !== written.length ||
    observation.irrelevantInjection !== canary.irrelevantInjection ||
    observation.writebackCommitted !== canary.writebackCommitted
  ) {
    throw new Error("C5 memory observation drifted from host canary evidence");
  }
  const surfaces = asRecord(
    input.canary.liveSurfaceSha256,
    "C5 live surface hashes",
  );
  assertExactKeys(surfaces, [...LIVE_SURFACE_IDS], "C5 live surface hashes");
  for (const digest of Object.values(surfaces)) {
    assertSha256(digest, "C5 live surface hash");
  }
  if (
    surfaces["effective-codex-input-after-seeding"] !==
      sourceReceipt.effectiveInputSurfaceSha256
  ) {
    throw new Error("C5 effective input composition drifted from its surface");
  }
  if (sources.sanitizedTranscriptSha256 !== sha256(input.sanitizedTranscript)) {
    throw new Error("C5 sanitized transcript hash is not bound by host canary evidence");
  }
  verifySanitizedTranscript({
    bytes: input.sanitizedTranscript,
    collectionFailures,
    execution: input.execution,
    sessionDigest,
  });
  return written;
}

function verifyCanaryCollectionFailures(
  value: unknown,
): Map<string, string> {
  const failures = new Map<string, string>();
  let previousSource = "";
  for (const item of asArray(value, "C5 canary collection failures")) {
    const failure = asRecord(item, "C5 canary collection failure");
    assertExactKeys(
      failure,
      ["errorSha256", "source"],
      "C5 canary collection failure",
    );
    const source = requiredString(
      failure.source,
      "C5 canary collection failure source",
    );
    if (
      ![
        "codex-transcript",
        "injection-state",
        "stop-cursor",
        "writeback-inspection",
      ].includes(source) ||
      source.localeCompare(previousSource) <= 0
    ) {
      throw new Error("C5 canary collection failures are not canonical");
    }
    previousSource = source;
    failures.set(
      source,
      requiredSha256(
        failure.errorSha256,
        "C5 canary collection failure hash",
      ),
    );
  }
  return failures;
}

function verifyCollectedSourceCommitment(
  value: unknown,
  failed: boolean,
  label: string,
): void {
  if (value === null) {
    if (!failed) throw new Error(`${label} is missing without a collection failure`);
    return;
  }
  assertSha256(value, label);
}

function verifyHostCanarySourceReceipts(input: {
  expectedPromptSha256: string;
  sessionDigest: string;
  sourceReceipts: unknown;
  sources: Record<string, unknown>;
}): {
  contentHashes: string[];
  effectiveInputSemanticSurfaceCommitmentSha256: string;
  effectiveInputSurfaceSha256: string;
  hookContextSegments: Array<{
    contentByteLength: number;
    contentSha256: string;
  }>;
  hookContextSurfaceCommitmentSha256: string;
  hookContextReceiptSha256: string;
  injectedRecordIds: string[];
  memoryRecordIds: string[];
  memorySemanticDocumentSha256: string[];
  memorySemanticSurfaceCommitmentSha256: string;
  memoryUtf8Bytes: number;
  stopCursorAdvanced: boolean;
  writtenMemoryIds: string[];
} {
  const receipts = asRecord(
    input.sourceReceipts,
    "C5 host canary source receipts",
  );
  assertExactKeys(
    receipts,
    ["cursor", "effectiveInput", "injection", "memoryExport", "writeback"],
    "C5 host canary source receipts",
  );

  const cursor = asRecord(receipts.cursor, "C5 cursor source receipt");
  assertExactKeys(
    cursor,
    ["sessionDigest", "sessionDigests", "sourceSha256"],
    "C5 cursor source receipt",
  );
  const cursorSessionDigests = canonicalStringArray(
    cursor.sessionDigests,
    "C5 cursor session digests",
  );
  if (
    cursor.sessionDigest !== input.sessionDigest ||
    cursor.sourceSha256 !== input.sources.cursorSourceSha256
  ) {
    throw new Error("C5 cursor source receipt is not bound to its source commitment");
  }

  const effectiveInput = asRecord(
    receipts.effectiveInput,
    "C5 effective input composition receipt",
  );
  assertExactKeys(effectiveInput, [
    "compositionSha256",
    "hookContextReceiptSha256",
    "promptSha256",
    "semanticSurfaceCommitmentSha256",
    "separatorPolicy",
    "surfaceSha256",
  ], "C5 effective input composition receipt");
  const effectiveInputBasis = {
    hookContextReceiptSha256: requiredSha256(
      effectiveInput.hookContextReceiptSha256,
      "C5 hook context receipt hash",
    ),
    promptSha256: requiredSha256(
      effectiveInput.promptSha256,
      "C5 effective input prompt hash",
    ),
    semanticSurfaceCommitmentSha256: requiredSha256(
      effectiveInput.semanticSurfaceCommitmentSha256,
      "C5 effective input semantic surface commitment",
    ),
    separatorPolicy: effectiveInput.separatorPolicy,
    surfaceSha256: requiredSha256(
      effectiveInput.surfaceSha256,
      "C5 effective input surface hash",
    ),
  };
  if (
    effectiveInputBasis.promptSha256 !== input.expectedPromptSha256 ||
    effectiveInputBasis.separatorPolicy !==
      "prompt-then-double-lf-hook-context-v1" ||
    effectiveInput.compositionSha256 !== sha256(JSON.stringify(
      effectiveInputBasis,
    ))
  ) {
    throw new Error("C5 effective input composition receipt is inconsistent");
  }

  const injection = asRecord(
    receipts.injection,
    "C5 injection source receipt",
  );
  assertExactKeys(injection, [
    "contentHashes",
    "events",
    "hookContextSegments",
    "hookContextSurfaceCommitmentSha256",
    "injectedRecordIds",
    "sessionDigest",
    "sourceSha256",
  ], "C5 injection source receipt");
  if (
    injection.sessionDigest !== input.sessionDigest ||
    injection.sourceSha256 !== input.sources.injectionSourceSha256
  ) {
    throw new Error(
      "C5 injection source receipt is not bound to its source commitment",
    );
  }
  const contentHashes = canonicalStringArray(
    injection.contentHashes,
    "C5 injection content hashes",
  );
  if (contentHashes.some((hash) => !/^content:[a-f0-9]{24}$/u.test(hash))) {
    throw new Error("C5 injection content hash has an invalid format");
  }
  const hookContextSegments = asArray(
    injection.hookContextSegments,
    "C5 hook context source segments",
  ).map((value) => {
    const segment = asRecord(value, "C5 hook context source segment");
    assertExactKeys(
      segment,
      ["contentByteLength", "contentSha256"],
      "C5 hook context source segment",
    );
    if (!isNonNegativeInteger(segment.contentByteLength)) {
      throw new Error("C5 hook context source segment has invalid byte length");
    }
    return {
      contentByteLength: segment.contentByteLength,
      contentSha256: requiredSha256(
        segment.contentSha256,
        "C5 hook context source segment hash",
      ),
    };
  });
  if (
    hookContextSegments.length === 0 &&
    effectiveInputBasis.surfaceSha256 !== effectiveInputBasis.promptSha256
  ) {
    throw new Error("C5 empty-hook effective input does not equal its prompt");
  }
  const hookContextSurfaceCommitmentSha256 = requiredSha256(
    injection.hookContextSurfaceCommitmentSha256,
    "C5 hook context surface commitment",
  );
  const receiptInjectedRecordIds = canonicalStringArray(
    injection.injectedRecordIds,
    "C5 injection session record IDs",
  );
  const injectedRecordIds = new Set<string>();
  let injectedEventObserved = false;
  let previousInjectionEvent = "";
  for (const value of asArray(injection.events, "C5 injection receipt events")) {
    const event = asRecord(value, "C5 injection receipt event");
    assertExactKeys(
      event,
      ["command", "decision", "recordIds"],
      "C5 injection receipt event",
    );
    if (
      (event.command !== "session-start" &&
        event.command !== "user-prompt-submit") ||
      (event.decision !== "duplicate_context" &&
        event.decision !== "injected" &&
        event.decision !== "low_relevance")
    ) {
      throw new Error("C5 injection receipt contains an invalid event");
    }
    const recordIds = canonicalStringArray(
      event.recordIds,
      "C5 injection event record IDs",
    );
    const canonicalEvent = JSON.stringify({
      command: event.command,
      decision: event.decision,
      recordIds,
    });
    if (canonicalEvent.localeCompare(previousInjectionEvent) <= 0) {
      throw new Error("C5 injection receipt events are not canonical");
    }
    previousInjectionEvent = canonicalEvent;
    if (event.decision === "injected" || event.decision === "duplicate_context") {
      for (const id of recordIds) injectedRecordIds.add(id);
    }
    if (event.decision === "injected") injectedEventObserved = true;
  }
  const derivedInjectedRecordIds = [...injectedRecordIds].sort();
  if (
    !sameStrings(derivedInjectedRecordIds, receiptInjectedRecordIds) ||
    (injectedEventObserved && contentHashes.length === 0)
  ) {
    throw new Error("C5 injection receipt record IDs are not event-derived");
  }

  const memoryExport = asRecord(
    receipts.memoryExport,
    "C5 memory export source receipt",
  );
  assertExactKeys(memoryExport, [
    "recordIds",
    "semanticDocumentSha256",
    "semanticSurfaceCommitmentSha256",
    "sourceSha256",
    "utf8Bytes",
  ], "C5 memory export source receipt");
  if (memoryExport.sourceSha256 !== input.sources.memoryExportSha256) {
    throw new Error(
      "C5 memory export source receipt is not bound to its source commitment",
    );
  }
  const memoryRecordIds = canonicalStringArray(
    memoryExport.recordIds,
    "C5 memory export record IDs",
  );
  const memorySemanticDocumentSha256 = canonicalSortedSha256Array(
    memoryExport.semanticDocumentSha256,
    "C5 memory export semantic document hashes",
  );
  const memorySemanticSurfaceCommitmentSha256 = requiredSha256(
    memoryExport.semanticSurfaceCommitmentSha256,
    "C5 memory export semantic surface commitment",
  );
  if (!isNonNegativeInteger(memoryExport.utf8Bytes)) {
    throw new Error("C5 memory export source receipt has invalid byte length");
  }

  const writeback = asRecord(
    receipts.writeback,
    "C5 writeback source receipt",
  );
  assertExactKeys(
    writeback,
    ["events", "sessionDigest", "sourceSha256"],
    "C5 writeback source receipt",
  );
  if (
    writeback.sessionDigest !== input.sessionDigest ||
    writeback.sourceSha256 !== input.sources.writebackSourceSha256
  ) {
    throw new Error(
      "C5 writeback source receipt is not bound to its source commitment",
    );
  }
  const writtenMemoryIds = new Set<string>();
  let previousWritebackEvent = "";
  for (const value of asArray(writeback.events, "C5 writeback receipt events")) {
    const event = asRecord(value, "C5 writeback receipt event");
    assertExactKeys(
      event,
      ["command", "linkedRecordIds", "status"],
      "C5 writeback receipt event",
    );
    const command = requiredString(event.command, "C5 writeback command");
    const status = requiredString(event.status, "C5 writeback status");
    const linkedRecordIds: Array<{ id: string; type: string }> = [];
    let previousRecord = "";
    for (const item of asArray(
      event.linkedRecordIds,
      "C5 writeback linked record IDs",
    )) {
      const record = asRecord(item, "C5 writeback linked record");
      assertExactKeys(record, ["id", "type"], "C5 writeback linked record");
      const normalized = {
        id: requiredString(record.id, "C5 writeback linked record ID"),
        type: requiredString(record.type, "C5 writeback linked record type"),
      };
      const serialized = JSON.stringify(normalized);
      if (serialized.localeCompare(previousRecord) <= 0) {
        throw new Error("C5 writeback linked records are not canonical");
      }
      previousRecord = serialized;
      linkedRecordIds.push(normalized);
    }
    const canonicalEvent = JSON.stringify({ command, linkedRecordIds, status });
    if (canonicalEvent.localeCompare(previousWritebackEvent) <= 0) {
      throw new Error("C5 writeback receipt events are not canonical");
    }
    previousWritebackEvent = canonicalEvent;
    if (command === "turn-end" && status === "committed") {
      for (const record of linkedRecordIds) {
        if (record.type === "memory") writtenMemoryIds.add(record.id);
      }
    }
  }

  return {
    contentHashes,
    effectiveInputSemanticSurfaceCommitmentSha256:
      effectiveInputBasis.semanticSurfaceCommitmentSha256,
    effectiveInputSurfaceSha256: effectiveInputBasis.surfaceSha256,
    hookContextSegments,
    hookContextSurfaceCommitmentSha256,
    hookContextReceiptSha256: effectiveInputBasis.hookContextReceiptSha256,
    injectedRecordIds: derivedInjectedRecordIds,
    memoryRecordIds,
    memorySemanticDocumentSha256,
    memorySemanticSurfaceCommitmentSha256,
    memoryUtf8Bytes: memoryExport.utf8Bytes,
    stopCursorAdvanced: cursorSessionDigests.includes(input.sessionDigest),
    writtenMemoryIds: [...writtenMemoryIds].sort(),
  };
}

function verifySanitizedTranscript(input: {
  bytes: string;
  collectionFailures: ReadonlyMap<string, string>;
  execution: Record<string, unknown>;
  sessionDigest: string;
}): void {
  const rows = parseJsonLines(input.bytes, "C5 sanitized Codex transcript");
  const transcriptFailure = input.collectionFailures.get("codex-transcript");
  if (transcriptFailure !== undefined) {
    if (rows.length !== 1) {
      throw new Error("C5 transcript failure receipt is not singular");
    }
    const row = rows[0]!;
    assertExactKeys(row, ["payload", "type"], "C5 transcript failure receipt");
    const payload = asRecord(row.payload, "C5 transcript failure payload");
    assertExactKeys(
      payload,
      ["errorSha256", "sessionDigest", "source"],
      "C5 transcript failure payload",
    );
    if (
      row.type !== "source_failure" ||
      payload.errorSha256 !== transcriptFailure ||
      payload.sessionDigest !== input.sessionDigest ||
      payload.source !== "codex-transcript"
    ) {
      throw new Error("C5 transcript failure receipt is not source-bound");
    }
    return;
  }
  if (rows.length < 2) {
    throw new Error("C5 sanitized transcript is incomplete");
  }
  const meta = rows[0]!;
  assertExactKeys(meta, ["payload", "type"], "C5 sanitized transcript meta");
  const metaPayload = asRecord(meta.payload, "C5 sanitized transcript meta payload");
  assertExactKeys(metaPayload, ["id"], "C5 sanitized transcript meta payload");
  if (meta.type !== "session_meta" || metaPayload.id !== input.execution.threadId) {
    throw new Error("C5 sanitized transcript is not bound to the exact thread");
  }
  let userMessageCount = 0;
  for (const row of rows.slice(1)) {
    assertExactKeys(row, ["payload", "type"], "C5 sanitized transcript row");
    const payload = asRecord(row.payload, "C5 sanitized transcript payload");
    assertExactKeys(
      payload,
      ["content", "role", "type"],
      "C5 sanitized transcript payload",
    );
    if (
      row.type !== "response_item" ||
      payload.type !== "message" ||
      (payload.role !== "user" && payload.role !== "assistant")
    ) {
      throw new Error("C5 sanitized transcript contains an unsupported row");
    }
    if (payload.role === "user") userMessageCount += 1;
    const expectedType = payload.role === "user" ? "input_text" : "output_text";
    const expectedText = payload.role === "user"
      ? "<redacted-user-text>"
      : "<redacted-assistant-text>";
    const blocks = asArray(payload.content, "C5 sanitized transcript content");
    if (blocks.length === 0) {
      throw new Error("C5 sanitized transcript message has no redacted content");
    }
    for (const value of blocks) {
      const block = asRecord(value, "C5 sanitized transcript block");
      assertExactKeys(
        block,
        ["length", "text", "textSha256", "type"],
        "C5 sanitized transcript block",
      );
      if (
        block.type !== expectedType ||
        block.text !== expectedText ||
        !isNonNegativeInteger(block.length)
      ) {
        throw new Error("C5 sanitized transcript exposed unredacted text");
      }
      assertSha256(block.textSha256, "C5 sanitized transcript text binding");
    }
  }
  if (userMessageCount === 0) {
    throw new Error("C5 sanitized transcript has no user task receipt");
  }
}

function verifyPairEvidence(input: {
  baselineArm: C5BaselineArm;
  cluster: C5PilotCluster;
  executions: readonly Record<string, unknown>[];
  frozenDataset: FrozenC5DatasetVerification;
  pair: Record<string, unknown>;
  reader: ArtifactReader;
  root: string;
  stage: C5PilotStageRun;
}): number {
  const pairRoot =
    `pairs/${clusterDigest(input.cluster.id)}/${input.stage.stageId}`;
  const leakagePath = `${pairRoot}/live-leakage-audit.json`;
  const leakage = input.reader.json(leakagePath);
  const leakageInput = requiredMapValue(
    input.frozenDataset.leakageInputs,
    `${input.cluster.episodeId}/${input.stage.stageId}`,
    "C5 frozen leakage input",
  );
  const opaqueProcessOnlyTrajectoryOriginCount = verifyLeakageAudit({
    audit: leakage,
    baselineArm: input.baselineArm,
    episodeId: input.cluster.episodeId,
    expectedPromptContents: input.frozenDataset.promptContents,
    leakageInput,
    label: leakagePath,
    reader: input.reader,
    root: input.root,
    stage: input.stage,
  });
  const pairReasons = stringArray(
    input.pair.incomparabilityReasons,
    `${input.cluster.id}/${input.stage.stageId} incomparability reasons`,
  );
  if (input.pair.leakageAuditSha256 !== leakage.auditSha256) {
    throw new Error(`C5 pair leakage binding mismatch: ${input.cluster.id}`);
  }
  const pairEvaluations = parsePairEvaluations(
    input.pair.evaluations,
    `${input.cluster.id}/${input.stage.stageId}`,
    input.baselineArm,
  );
  // Comparability is recomputed from the pair's own evidence: leakage
  // rejection, per-arm infrastructure failures, the comparator's injection
  // receipt, the required memory channel, and evaluator failures.
  const expectedReasons = expectedIncomparabilityReasons({
    evaluations: pairEvaluations,
    executions: input.executions,
    leakageRejected: leakage.status === "rejected",
    stage: input.stage,
  });
  if (!sameStrings([...pairReasons].sort(), expectedReasons)) {
    throw new Error(
      `C5 pair incomparability was not reproduced: ${input.cluster.id}/${input.stage.stageId}`,
    );
  }
  for (const evaluation of pairEvaluations) {
    const execution = input.executions.find((candidate) =>
      candidate.arm === evaluation.arm
    );
    const path = evaluatorEvidencePath({
      arm: evaluation.arm,
      codexStatus: execution?.codexStatus,
      disposition: evaluation.disposition,
      pairRoot,
    });
    const bytes = input.reader.bytes(path);
    if (evaluation.evaluationEvidenceSha256 !== sha256(bytes)) {
      throw new Error(`C5 evaluator evidence hash mismatch: ${path}`);
    }
    if (path.endsWith("-evaluation-failure.sanitized.json")) {
      verifyEvaluatorFailureEvidence(
        input.reader.json(path),
        evaluation.arm,
        path,
      );
    } else {
      verifyEvaluatorEvidence({
        evidence: input.reader.json(path),
        evaluation,
        path,
        scoredInfrastructureFailure:
          evaluation.disposition === "infrastructure-failure",
      });
    }
  }
  return opaqueProcessOnlyTrajectoryOriginCount;
}

function expectedIncomparabilityReasons(input: {
  evaluations: readonly ParsedPairEvaluation[];
  executions: readonly Record<string, unknown>[];
  leakageRejected: boolean;
  stage: C5PilotStageRun;
}): string[] {
  const reasons: string[] = [];
  if (input.leakageRejected) {
    reasons.push("live-leakage-audit-rejected");
  }
  for (const execution of input.executions) {
    const arm = requiredString(execution.arm, "C5 paired execution arm");
    if (execution.infrastructureFailureStage !== null) {
      reasons.push(`${arm}-infrastructure-${requiredString(
        execution.infrastructureFailureStage,
        "C5 paired infrastructure failure stage",
      )}`);
    }
    if (arm === "flat-summary") {
      const injection = comparatorInjectionOf(execution);
      const expectedMode = input.stage.priorStageIds.length === 0
        ? "no-history-zero-injection"
        : "content-injection";
      if (injection === null || injection.mode !== expectedMode) {
        reasons.push(COMPARATOR_INJECTION_REASONS[1]);
      }
      if (injection !== null && injection.hookEvaluationPassed !== true) {
        reasons.push(COMPARATOR_INJECTION_REASONS[0]);
      }
    }
  }
  const installed = input.executions.find((execution) =>
    execution.arm === "goodmemory-installed"
  );
  if (
    input.stage.memoryExpectation === "required" &&
    installed?.memoryChannelStatus !== "passed"
  ) {
    reasons.push("goodmemory-required-memory-channel-failed");
  }
  for (const evaluation of input.evaluations) {
    if (evaluation.disposition === "infrastructure-failure") {
      reasons.push(`${evaluation.arm}-evaluator-infrastructure-failure`);
    }
  }
  return [...new Set(reasons)].sort();
}

function verifyLeakageAudit(input: {
  audit: Record<string, unknown>;
  baselineArm: C5BaselineArm;
  episodeId: string;
  expectedPromptContents: ReadonlyMap<string, string>;
  leakageInput: {
    artifacts: C4HiddenArtifact[];
    staticSurfaces: C4LeakageSurface[];
  };
  label: string;
  reader: ArtifactReader;
  root: string;
  stage: C5PilotStageRun;
}): number {
  if (input.audit.variant === "infrastructure-rejected") {
    verifyRejectedLeakageAudit(input.audit, input.label);
    return 0;
  }
  return verifyCompleteLeakageAudit(input);
}

function verifyRejectedLeakageAudit(
  audit: Record<string, unknown>,
  label: string,
): void {
  assertExactKeys(audit, [
    "auditSha256",
    "failureReasonSha256",
    "schemaVersion",
    "status",
    "variant",
  ], label);
  if (
    audit.schemaVersion !== 5 ||
    audit.status !== "rejected" ||
    audit.variant !== "infrastructure-rejected"
  ) {
    throw new Error(`${label} has an invalid infrastructure-rejected envelope`);
  }
  assertSha256(audit.failureReasonSha256, `${label} failure reason hash`);
  verifyInternalAuditHash(audit, label);
}

function verifyCompleteLeakageAudit(input: {
  audit: Record<string, unknown>;
  baselineArm: C5BaselineArm;
  episodeId: string;
  expectedPromptContents: ReadonlyMap<string, string>;
  leakageInput: {
    artifacts: C4HiddenArtifact[];
    staticSurfaces: C4LeakageSurface[];
  };
  label: string;
  reader: ArtifactReader;
  root: string;
  stage: C5PilotStageRun;
}): number {
  const { audit, label } = input;
  assertExactKeys(audit, [
    "auditSha256",
    "fullMatrixAuditReceipt",
    "fullMatrixAuditSha256",
    "liveCells",
    "liveMatrixCellCount",
    "liveOverlapCount",
    "liveSurfaceReceipts",
    "liveSurfaceIds",
    "schemaVersion",
    "staticOverlapCount",
    "status",
    "trajectoryOriginAuditSha256",
    "trajectoryOriginOverlapCount",
    "trajectoryOrigins",
    "unexplainedLiveOverlapCount",
  ], label);
  if (
    audit.schemaVersion !== 5 ||
    (audit.status !== "accepted" && audit.status !== "rejected") ||
    audit.liveMatrixCellCount !== 12 ||
    !isNonNegativeInteger(audit.liveOverlapCount) ||
    !isNonNegativeInteger(audit.staticOverlapCount) ||
    !isNonNegativeInteger(audit.trajectoryOriginOverlapCount) ||
    !isNonNegativeInteger(audit.unexplainedLiveOverlapCount) ||
    !sameStrings(
      stringArray(audit.liveSurfaceIds, `${label} live surface IDs`),
      [...LIVE_SURFACE_IDS],
    )
  ) {
    throw new Error(`${label} incompletely audited a leakage surface`);
  }
  const liveSurfaceReceipts = verifyLiveSurfaceReceipts(input);
  const fullMatrix = verifyC4MatrixAuditReceipt(
    audit.fullMatrixAuditReceipt,
    `${label} full matrix receipt`,
  );
  if (
    requiredSha256(audit.fullMatrixAuditSha256, `${label} full matrix hash`) !==
      fullMatrix.auditSha256
  ) {
    throw new Error(`${label} full matrix receipt hash is inconsistent`);
  }
  verifyStaticMatrixCells(input, fullMatrix.cells);
  for (const receipt of liveSurfaceReceipts.values()) {
    for (const artifactId of HIDDEN_ARTIFACT_IDS) {
      const cell = fullMatrix.cells.get(`${receipt.id}/${artifactId}`);
      if (
        cell === undefined ||
        cell.raw.surfaceSha256 !== receipt.contentSha256 ||
        cell.raw.hiddenValueSurfaceSha256 !==
          receipt.hiddenValueSurfaceSha256
      ) {
        throw new Error(`${label} live matrix is not bound to its surface claim`);
      }
    }
  }
  const trajectoryOriginAuditSha256 = requiredSha256(
    audit.trajectoryOriginAuditSha256,
    `${label} trajectory-origin audit hash`,
  );
  verifyInternalAuditHash(audit, label);
  const trajectoryOrigins = verifyTrajectoryOrigins(input);
  if (trajectoryOriginAuditSha256 !== trajectoryOrigins.auditSha256) {
    throw new Error(`${label} trajectory-origin audit hash is inconsistent`);
  }
  const cells = asArray(audit.liveCells, `${label} live cells`);
  if (cells.length !== 12) {
    throw new Error(`${label} does not contain the complete 4 x 3 matrix`);
  }
  const identities = new Set<string>();
  let overlapCount = 0;
  let originOverlapCount = 0;
  let unexplainedOverlapCount = 0;
  for (const value of cells) {
    const cell = asRecord(value, `${label} matrix cell`);
    assertExactKeys(cell, [
      "allowedPublicContractCount",
      "allowedPublicFragmentSha256",
      "artifactId",
      "artifactSha256",
      "candidateFragmentCount",
      "candidateFragmentSetSha256",
      "exactOverlapCount",
      "hiddenValueCount",
      "hiddenValueRelationCount",
      "hiddenValueRelationSetSha256",
      "hiddenValueSetSha256",
      "hiddenValueSurfaceSha256",
      "matchedFragmentSha256",
      "normalizedOverlapCount",
      "originAttestedMatchSha256",
      "provenanceStatus",
      "status",
      "surfaceId",
      "surfaceSha256",
      "unexplainedMatchSha256",
    ], `${label} matrix cell`);
    const surfaceId = requiredString(cell.surfaceId, `${label} surface ID`);
    const artifactId = requiredString(cell.artifactId, `${label} artifact ID`);
    if (
      !LIVE_SURFACE_IDS.includes(surfaceId as typeof LIVE_SURFACE_IDS[number]) ||
      !HIDDEN_ARTIFACT_IDS.includes(
        artifactId as typeof HIDDEN_ARTIFACT_IDS[number],
      ) ||
      (cell.status !== "accepted" && cell.status !== "rejected") ||
      (cell.provenanceStatus !== "accepted" &&
        cell.provenanceStatus !== "rejected") ||
      !isNonNegativeInteger(cell.allowedPublicContractCount) ||
      !isNonNegativeInteger(cell.candidateFragmentCount) ||
      !isNonNegativeInteger(cell.exactOverlapCount) ||
      !isNonNegativeInteger(cell.hiddenValueCount) ||
      !isNonNegativeInteger(cell.hiddenValueRelationCount) ||
      !isNonNegativeInteger(cell.normalizedOverlapCount)
    ) {
      throw new Error(`${label} contains an invalid leakage matrix cell`);
    }
    const allowedPublic = canonicalSha256Array(
      cell.allowedPublicFragmentSha256,
      `${label} allowed public fragments`,
    );
    const cellOverlap = Number(cell.exactOverlapCount) +
      Number(cell.normalizedOverlapCount);
    const matches = canonicalSha256Array(
      cell.matchedFragmentSha256,
      `${label} matches`,
    );
    const originMatches = canonicalSha256Array(
      cell.originAttestedMatchSha256,
      `${label} origin-attested matches`,
    );
    const unexplainedMatches = canonicalSha256Array(
      cell.unexplainedMatchSha256,
      `${label} unexplained matches`,
    );
    verifyLiveCellCandidateClaims({
      allowedPublic,
      artifact: requiredMapValue(
        new Map(input.leakageInput.artifacts.map((artifact) => [
          artifact.id,
          artifact,
        ])),
        artifactId as C4HiddenArtifact["id"],
        `${label} frozen hidden artifact`,
      ),
      label,
      matches,
    });
    const partition = [...originMatches, ...unexplainedMatches].sort();
    const attested = trajectoryOrigins.matchesByArtifact.get(artifactId) ??
      new Set<string>();
    const expectedOriginMatches = matches.filter((digest) => attested.has(digest));
    const expectedUnexplainedMatches = matches.filter((digest) =>
      !attested.has(digest)
    );
    const identity = `${surfaceId}/${artifactId}`;
    const fullCell = fullMatrix.cells.get(identity);
    const {
      originAttestedMatchSha256: _,
      provenanceStatus: __,
      unexplainedMatchSha256: ___,
      ...baseCell
    } = cell;
    if (
      allowedPublic.length !== cell.allowedPublicContractCount ||
      cell.status !== (cellOverlap === 0 ? "accepted" : "rejected") ||
      cell.provenanceStatus !==
        (unexplainedMatches.length === 0 ? "accepted" : "rejected") ||
      matches.length !== cellOverlap ||
      !sameStrings(partition, matches) ||
      !sameStrings(originMatches, expectedOriginMatches) ||
      !sameStrings(unexplainedMatches, expectedUnexplainedMatches) ||
      fullCell === undefined ||
      JSON.stringify(baseCell) !== JSON.stringify(fullCell.raw)
    ) {
      throw new Error(`${label} leakage cell status is inconsistent`);
    }
    overlapCount += cellOverlap;
    originOverlapCount += originMatches.length;
    unexplainedOverlapCount += unexplainedMatches.length;
    for (const key of [
      "artifactSha256",
      "candidateFragmentSetSha256",
      "hiddenValueRelationSetSha256",
      "hiddenValueSetSha256",
      "hiddenValueSurfaceSha256",
      "surfaceSha256",
    ]) {
      assertSha256(cell[key], `${label} ${key}`);
    }
    if (identities.has(identity)) {
      throw new Error(`${label} duplicated a matrix cell`);
    }
    identities.add(identity);
  }
  const staticOverlapCount = [...fullMatrix.cells.values()]
    .filter((cell) =>
      !LIVE_SURFACE_IDS.includes(
        cell.surfaceId as typeof LIVE_SURFACE_IDS[number],
      )
    )
    .reduce((total, cell) => total + cell.overlapCount, 0);
  if (
    overlapCount !== audit.liveOverlapCount ||
    originOverlapCount !== audit.trajectoryOriginOverlapCount ||
    unexplainedOverlapCount !== audit.unexplainedLiveOverlapCount ||
    overlapCount !== originOverlapCount + unexplainedOverlapCount ||
    staticOverlapCount !== audit.staticOverlapCount ||
    (originOverlapCount > 0 && trajectoryOrigins.receiptCount === 0) ||
    audit.status !==
      (audit.staticOverlapCount === 0 && unexplainedOverlapCount === 0
        ? "accepted"
        : "rejected")
  ) {
    throw new Error(`${label} leakage result is inconsistent`);
  }
  return trajectoryOrigins.opaqueReceiptCount;
}

function verifyLiveSurfaceReceipts(input: {
  audit: Record<string, unknown>;
  baselineArm: C5BaselineArm;
  episodeId: string;
  expectedPromptContents: ReadonlyMap<string, string>;
  label: string;
  reader: ArtifactReader;
  root: string;
  stage: C5PilotStageRun;
}): Map<string, {
  contentSha256: string;
  hiddenValueSurfaceSha256: string;
  id: string;
  utf8Bytes: number;
}> {
  const values = asArray(
    input.audit.liveSurfaceReceipts,
    `${input.label} live surface receipts`,
  );
  if (values.length !== LIVE_SURFACE_IDS.length) {
    throw new Error(`${input.label} has incomplete live surface receipts`);
  }
  const receipts = values.map((value, index) => {
    const receipt = asRecord(value, `${input.label} live surface receipt`);
    const expectedId = LIVE_SURFACE_IDS[index]!;
    assertExactKeys(
      receipt,
      ["contentSha256", "hiddenValueSurfaceSha256", "id", "utf8Bytes"],
      `${input.label} live surface receipt`,
    );
    const id = requiredString(receipt.id, `${input.label} live surface ID`);
    if (id !== expectedId || !isNonNegativeInteger(receipt.utf8Bytes)) {
      throw new Error(`${input.label} live surface receipts are not canonical`);
    }
    return {
      contentSha256: requiredSha256(
        receipt.contentSha256,
        `${input.label} live surface content hash`,
      ),
      hiddenValueSurfaceSha256: requiredSha256(
        receipt.hiddenValueSurfaceSha256,
        `${input.label} live semantic surface hash`,
      ),
      id,
      utf8Bytes: receipt.utf8Bytes,
    };
  });
  const byId = new Map(receipts.map((receipt) => [receipt.id, receipt]));
  const comparatorSurface = expectedComparatorSurface(input);
  const hostCanary = input.reader.json(
    `${input.root}/goodmemory-installed/${input.stage.stageId}/host-canary/host-canary.sanitized.json`,
  );
  const liveSurfaceSha256 = asRecord(
    hostCanary.liveSurfaceSha256,
    `${input.label} host-canary live surface hashes`,
  );
  assertExactKeys(
    liveSurfaceSha256,
    [...LIVE_SURFACE_IDS],
    `${input.label} host-canary live surface hashes`,
  );
  for (const receipt of receipts) {
    const canarySha256 = requiredSha256(
      liveSurfaceSha256[receipt.id],
      `${input.label} host-canary live surface hash`,
    );
    // The installed host never carries a flat summary; that surface is bound
    // to the comparator arm's injection receipt instead of the host canary.
    const flat = receipt.id === "flat-summary-after-seeding";
    if (
      (flat && canarySha256 !== sha256("")) ||
      receipt.contentSha256 !==
        (flat ? comparatorSurface.contentSha256 : canarySha256)
    ) {
      throw new Error(`${input.label} live surface is not bound to host canary`);
    }
  }
  const sourceReceipts = asRecord(
    hostCanary.sourceReceipts,
    `${input.label} host-canary source receipts`,
  );
  const effectiveInput = asRecord(
    sourceReceipts.effectiveInput,
    `${input.label} effective-input receipt`,
  );
  const injection = asRecord(
    sourceReceipts.injection,
    `${input.label} injection receipt`,
  );
  const memoryExport = asRecord(
    sourceReceipts.memoryExport,
    `${input.label} memory-export receipt`,
  );
  const expectedSemanticCommitments = new Map<string, string>([
    [
      "effective-codex-input-after-seeding",
      requiredSha256(
        effectiveInput.semanticSurfaceCommitmentSha256,
        `${input.label} effective-input semantic commitment`,
      ),
    ],
    [
      "flat-summary-after-seeding",
      comparatorSurface.semanticSurfaceCommitmentSha256,
    ],
    [
      "goodmemory-export-after-seeding",
      requiredSha256(
        memoryExport.semanticSurfaceCommitmentSha256,
        `${input.label} memory-export semantic commitment`,
      ),
    ],
    [
      "goodmemory-hook-context-after-seeding",
      requiredSha256(
        injection.hookContextSurfaceCommitmentSha256,
        `${input.label} hook-context semantic commitment`,
      ),
    ],
  ]);
  if (
    receipts.some((receipt) =>
      receipt.hiddenValueSurfaceSha256 !==
        expectedSemanticCommitments.get(receipt.id)
    )
  ) {
    throw new Error(`${input.label} live semantic surface is not source-bound`);
  }
  const prompt = requiredMapValue(
    input.expectedPromptContents,
    `${input.episodeId}/${input.stage.stageId}`,
    "C5 frozen current prompt",
  );
  const sources = asRecord(
    hostCanary.sources,
    `${input.label} host-canary sources`,
  );
  const hookSegmentLengths = asArray(
    injection.hookContextSegments,
    `${input.label} hook-context segments`,
  ).map((value) => {
    const segment = asRecord(value, `${input.label} hook-context segment`);
    assertExactKeys(
      segment,
      ["contentByteLength", "contentSha256"],
      `${input.label} hook-context segment`,
    );
    if (!isNonNegativeInteger(segment.contentByteLength)) {
      throw new Error(`${input.label} hook-context segment length is invalid`);
    }
    assertSha256(
      segment.contentSha256,
      `${input.label} hook-context segment hash`,
    );
    return segment.contentByteLength;
  });
  const hookUtf8Bytes = hookSegmentLengths.reduce(
    (total, length) => total + length,
    0,
  ) + Math.max(0, hookSegmentLengths.length - 1) * 2;
  const effective = byId.get("effective-codex-input-after-seeding")!;
  const flat = byId.get("flat-summary-after-seeding")!;
  const exported = byId.get("goodmemory-export-after-seeding")!;
  const hook = byId.get("goodmemory-hook-context-after-seeding")!;
  if (
    effective.contentSha256 !== effectiveInput.surfaceSha256 ||
    effectiveInput.promptSha256 !== sha256(prompt) ||
    effective.utf8Bytes !== Buffer.byteLength(prompt, "utf8") +
      (hookUtf8Bytes === 0 ? 0 : 2 + hookUtf8Bytes) ||
    flat.contentSha256 !== comparatorSurface.contentSha256 ||
    flat.utf8Bytes !== comparatorSurface.utf8Bytes ||
    exported.contentSha256 !== sources.memoryExportSha256 ||
    !isNonNegativeInteger(memoryExport.utf8Bytes) ||
    exported.utf8Bytes !== memoryExport.utf8Bytes ||
    hook.utf8Bytes !== hookUtf8Bytes
  ) {
    throw new Error(`${input.label} live surface claims drifted from host receipts`);
  }
  if (
    hookSegmentLengths.length === 0 &&
    (hook.contentSha256 !== sha256("") ||
      effective.contentSha256 !== sha256(prompt))
  ) {
    throw new Error(`${input.label} empty-hook surfaces drifted from the prompt`);
  }
  return byId;
}

// The comparator's live surface for a pair is what the flat-summary arm
// injected at that stage: nothing for the no-memory baseline, for no-history
// stages, or when the comparator was never prepared; otherwise the receipt's
// content hash, byte length, and semantic commitment.
function expectedComparatorSurface(input: {
  baselineArm: C5BaselineArm;
  reader: ArtifactReader;
  root: string;
  stage: C5PilotStageRun;
}): {
  contentSha256: string;
  semanticSurfaceCommitmentSha256: string;
  utf8Bytes: number;
} {
  const empty = {
    contentSha256: sha256(""),
    semanticSurfaceCommitmentSha256: sha256(JSON.stringify([""])),
    utf8Bytes: 0,
  };
  if (input.baselineArm !== "flat-summary") return empty;
  const evidence = input.reader.json(
    `${input.root}/flat-summary/${input.stage.stageId}/stage-execution.sanitized.json`,
  );
  const injection = comparatorInjectionOf(
    asRecord(evidence.execution, "C5 flat-summary stage execution"),
  );
  if (injection === null || injection.mode !== "content-injection") {
    return empty;
  }
  const path = comparatorReceiptPath(input.root, input.stage.stageId);
  const record = asRecord(
    input.reader.json(path).injection,
    `${path} injection`,
  );
  if (!isNonNegativeInteger(record.injectedUtf8Bytes)) {
    throw new Error(`${path} injected byte length is invalid`);
  }
  return {
    contentSha256: requiredSha256(
      injection.injectedContentSha256,
      `${path} injected content hash`,
    ),
    semanticSurfaceCommitmentSha256: requiredSha256(
      record.semanticSurfaceCommitmentSha256,
      `${path} semantic surface commitment`,
    ),
    utf8Bytes: record.injectedUtf8Bytes,
  };
}

function verifyStaticMatrixCells(
  input: {
    leakageInput: {
      artifacts: C4HiddenArtifact[];
      staticSurfaces: C4LeakageSurface[];
    };
    label: string;
  },
  cells: ReadonlyMap<string, VerifiedC4MatrixCell>,
): void {
  const expected = auditC4SurfaceHiddenArtifactMatrix({
    artifacts: input.leakageInput.artifacts,
    surfaces: [
      ...input.leakageInput.staticSurfaces,
      ...LIVE_SURFACE_IDS.map((id) => ({ content: "", id })),
    ],
  });
  const artifactInvariantKeys = [
    "artifactSha256",
    "candidateFragmentCount",
    "candidateFragmentSetSha256",
    "hiddenValueCount",
    "hiddenValueRelationCount",
    "hiddenValueRelationSetSha256",
    "hiddenValueSetSha256",
  ] as const;
  for (const cell of expected.cells) {
    const actual = cells.get(`${cell.surfaceId}/${cell.artifactId}`);
    if (actual === undefined) {
      throw new Error(`${input.label} matrix omitted a frozen artifact cell`);
    }
    if (LIVE_SURFACE_IDS.includes(
      cell.surfaceId as typeof LIVE_SURFACE_IDS[number],
    )) {
      if (artifactInvariantKeys.some((key) => actual.raw[key] !== cell[key])) {
        throw new Error(`${input.label} live matrix drifted from frozen artifacts`);
      }
      continue;
    }
    if (JSON.stringify(actual.raw) !== JSON.stringify(cell)) {
      throw new Error(`${input.label} static matrix was not independently recomputed`);
    }
  }
}

function verifyLiveCellCandidateClaims(input: {
  allowedPublic: readonly string[];
  artifact: C4HiddenArtifact;
  label: string;
  matches: readonly string[];
}): void {
  const candidates = new Set(
    [...new Set([
      input.artifact.content,
      ...input.artifact.fragments,
    ].filter((fragment) => fragment.length > 0))].map(sha256),
  );
  const hiddenValues = new Map(
    (input.artifact.hiddenValues ?? []).map((value) => [
      JSON.stringify(canonicalLeakageValue(value)),
      value,
    ]),
  );
  for (const value of hiddenValues.values()) {
    candidates.add(sha256(JSON.stringify(canonicalLeakageValue(value))));
  }
  const relations = new Map<string, readonly (string | number | boolean | null)[]>();
  for (const relation of input.artifact.hiddenValueRelations ?? []) {
    if (relation.length < 2) continue;
    relations.set(
      JSON.stringify(relation.map(canonicalLeakageValue)),
      relation,
    );
  }
  for (const relation of relations.values()) {
    candidates.add(sha256(JSON.stringify({
      type: "relation",
      values: relation.map(canonicalLeakageValue),
    })));
  }
  const allowed = new Set(
    (input.artifact.allowedPublicFragments ?? []).map(sha256),
  );
  if (
    input.matches.some((digest) => !candidates.has(digest)) ||
    input.allowedPublic.some((digest) => !allowed.has(digest))
  ) {
    throw new Error(`${input.label} live matrix claims an unknown candidate`);
  }
}

function canonicalLeakageValue(value: string | number | boolean | null): {
  type: "boolean" | "null" | "number" | "string";
  value: string | number | boolean | null;
} {
  return {
    type: value === null
      ? "null"
      : typeof value === "boolean"
      ? "boolean"
      : typeof value === "number"
      ? "number"
      : "string",
    value,
  };
}

function verifyInternalAuditHash(
  audit: Record<string, unknown>,
  label: string,
): void {
  const auditSha256 = requiredSha256(audit.auditSha256, `${label} audit hash`);
  const { auditSha256: _, ...basis } = audit;
  if (auditSha256 !== sha256(JSON.stringify(basis))) {
    throw new Error(`${label} internal audit hash is inconsistent`);
  }
}

function verifyTrajectoryOrigins(input: {
  audit: Record<string, unknown>;
  baselineArm: C5BaselineArm;
  episodeId: string;
  expectedPromptContents: ReadonlyMap<string, string>;
  leakageInput: {
    artifacts: C4HiddenArtifact[];
    staticSurfaces: C4LeakageSurface[];
  };
  label: string;
  reader: ArtifactReader;
  root: string;
  stage: C5PilotStageRun;
}): {
  auditSha256: string;
  matchesByArtifact: Map<string, Set<string>>;
  opaqueReceiptCount: number;
  receiptCount: number;
} {
  const expected = new Map<string,
    | {
        audit: C4LeakageMatrixAudit;
        kind: "content-recomputed";
        sha256: string;
      }
    | { kind: "process-only-codex-jsonl-output" }
  >();
  // Prior-stage origins come from the installed arm and, for the flat-summary
  // comparator, from the comparator's own prior stages (its summary is built
  // from them), keyed with the runner's ":flat-summary" suffix.
  const originArms: Array<{
    arm: C5PilotArm;
    originId: (stageId: string) => string;
  }> = [
    { arm: "goodmemory-installed", originId: (stageId) => stageId },
    ...(input.baselineArm === "flat-summary"
      ? [{
          arm: "flat-summary" as const,
          originId: (stageId: string) => `${stageId}:flat-summary`,
        }]
      : []),
  ];
  for (const priorStageId of input.stage.priorStageIds) {
    const prompt = requiredMapValue(
      input.expectedPromptContents,
      `${input.episodeId}/${priorStageId}`,
      "C5 frozen prior prompt",
    );
    for (const { arm, originId } of originArms) {
      const id = originId(priorStageId);
      const priorEvidence = input.reader.json(
        `${input.root}/${arm}/${priorStageId}/stage-execution.sanitized.json`,
      );
      const promptSha256 = requiredSha256(
        priorEvidence.effectivePromptSha256,
        `${input.label} prior effective prompt hash`,
      );
      if (promptSha256 !== sha256(prompt)) {
        throw new Error(`${input.label} prior prompt is not asset-locked`);
      }
      expected.set(`${id}:effective-prompt`, {
        audit: buildC5OriginMatrixAudit(input.leakageInput, prompt),
        kind: "content-recomputed",
        sha256: promptSha256,
      });
      const patch = input.reader.bytes(
        `${input.root}/${arm}/${priorStageId}/agent.patch`,
      );
      if (patch.length > 0) {
        expected.set(`${id}:agent-patch`, {
          audit: buildC5OriginMatrixAudit(input.leakageInput, patch),
          kind: "content-recomputed",
          sha256: sha256(patch),
        });
      }
      const codex = asRecord(
        priorEvidence.codex,
        `${input.label} prior Codex summary`,
      );
      if (Number(codex.eventCount) > 0) {
        expected.set(`${id}:codex-jsonl-output`, {
          kind: "process-only-codex-jsonl-output",
        });
      }
    }
  }
  const values = asArray(
    input.audit.trajectoryOrigins,
    `${input.label} trajectory origins`,
  );
  const origins: Array<{ id: string; matrixAuditReceipt: unknown; sha256: string }> = [];
  const matchesByArtifact = new Map<string, Set<string>>();
  const artifacts = new Map(input.leakageInput.artifacts.map((artifact) => [
    artifact.id,
    artifact,
  ]));
  const ids = new Set<string>();
  let opaqueReceiptCount = 0;
  for (const value of values) {
    const origin = asRecord(value, `${input.label} trajectory origin`);
    assertExactKeys(
      origin,
      ["id", "matrixAuditReceipt", "sha256"],
      `${input.label} trajectory origin`,
    );
    const id = requiredString(origin.id, `${input.label} trajectory origin ID`);
    const digest = requiredSha256(
      origin.sha256,
      `${input.label} trajectory origin hash`,
    );
    const expectedReceipt = expected.get(id);
    if (
      ids.has(id) ||
      expectedReceipt === undefined ||
      (expectedReceipt.kind === "content-recomputed" &&
        digest !== expectedReceipt.sha256)
    ) {
      throw new Error(`${input.label} has an invalid trajectory origin receipt`);
    }
    const matrix = verifyC4MatrixAuditReceipt(
      origin.matrixAuditReceipt,
      `${input.label} trajectory origin ${id}`,
    );
    if (
      expectedReceipt.kind === "content-recomputed" &&
      JSON.stringify(origin.matrixAuditReceipt) !==
        JSON.stringify(expectedReceipt.audit)
    ) {
      throw new Error(`${input.label} trajectory origin matrix was not recomputed`);
    }
    if (expectedReceipt.kind === "process-only-codex-jsonl-output") {
      verifyOpaqueTrajectoryOriginMatrix({
        leakageInput: input.leakageInput,
        label: `${input.label} trajectory origin ${id}`,
        matrix,
      });
      opaqueReceiptCount += 1;
    }
    for (const cell of matrix.cells.values()) {
      const expectedSurfaceSha256 =
        cell.surfaceId === "effective-codex-input-after-seeding"
          ? digest
          : sha256("");
      if (cell.raw.surfaceSha256 !== expectedSurfaceSha256) {
        throw new Error(
          `${input.label} trajectory origin matrix is not bound to ${id}`,
        );
      }
      if (cell.surfaceId !== "effective-codex-input-after-seeding") continue;
      verifyLiveCellCandidateClaims({
        allowedPublic: canonicalSha256Array(
          cell.raw.allowedPublicFragmentSha256,
          `${input.label} trajectory origin ${id} allowed public fragments`,
        ),
        artifact: requiredMapValue(
          artifacts,
          cell.artifactId as C4HiddenArtifact["id"],
          `${input.label} trajectory origin ${id} frozen hidden artifact`,
        ),
        label: `${input.label} trajectory origin ${id}`,
        matches: cell.matches,
      });
      const matches = matchesByArtifact.get(cell.artifactId) ?? new Set<string>();
      for (const match of cell.matches) matches.add(match);
      matchesByArtifact.set(cell.artifactId, matches);
    }
    ids.add(id);
    origins.push({
      id,
      matrixAuditReceipt: origin.matrixAuditReceipt,
      sha256: digest,
    });
  }
  if (
    origins.length !== expected.size ||
    origins.some((origin, index) =>
      index > 0 && origins[index - 1]!.id.localeCompare(origin.id) >= 0
    )
  ) {
    throw new Error(`${input.label} trajectory origin receipts are incomplete`);
  }
  return {
    auditSha256: sha256(JSON.stringify(origins)),
    matchesByArtifact,
    opaqueReceiptCount,
    receiptCount: origins.length,
  };
}

function verifyOpaqueTrajectoryOriginMatrix(input: {
  leakageInput: {
    artifacts: C4HiddenArtifact[];
    staticSurfaces: C4LeakageSurface[];
  };
  label: string;
  matrix: ReturnType<typeof verifyC4MatrixAuditReceipt>;
}): void {
  const expected = buildC5OriginMatrixAudit(input.leakageInput, "");
  const invariantKeys = [
    "artifactSha256",
    "candidateFragmentCount",
    "candidateFragmentSetSha256",
    "hiddenValueCount",
    "hiddenValueRelationCount",
    "hiddenValueRelationSetSha256",
    "hiddenValueSetSha256",
  ] as const;
  for (const expectedCell of expected.cells) {
    const actual = input.matrix.cells.get(
      `${expectedCell.surfaceId}/${expectedCell.artifactId}`,
    );
    if (actual === undefined) {
      throw new Error(`${input.label} omitted a frozen artifact cell`);
    }
    if (expectedCell.surfaceId === "effective-codex-input-after-seeding") {
      const driftedKey = invariantKeys.find((key) =>
        JSON.stringify(actual.raw[key]) !== JSON.stringify(expectedCell[key])
      );
      if (driftedKey !== undefined) {
        throw new Error(
          `${input.label} drifted from frozen artifacts at ${driftedKey}`,
        );
      }
      continue;
    }
    if (JSON.stringify(actual.raw) !== JSON.stringify(expectedCell)) {
      throw new Error(`${input.label} non-content cells were not recomputed`);
    }
  }
}

function buildC5OriginMatrixAudit(
  input: {
    artifacts: readonly C4HiddenArtifact[];
    staticSurfaces: readonly C4LeakageSurface[];
  },
  content: string,
): C4LeakageMatrixAudit {
  return auditC4SurfaceHiddenArtifactMatrix({
    artifacts: input.artifacts,
    surfaces: [
      ...input.staticSurfaces.map((surface) => ({
        content: "",
        id: surface.id,
      })),
      ...LIVE_SURFACE_IDS.map((id): C4LeakageSurface => ({
        content: id === "effective-codex-input-after-seeding" ? content : "",
        ...(id === "effective-codex-input-after-seeding"
          ? { hiddenValueContents: [content] }
          : {}),
        id,
      })),
    ],
  });
}

interface VerifiedC4MatrixCell {
  artifactId: string;
  matches: string[];
  overlapCount: number;
  raw: Record<string, unknown>;
  surfaceId: string;
}

function verifyC4MatrixAuditReceipt(
  value: unknown,
  label: string,
): {
  auditSha256: string;
  cells: Map<string, VerifiedC4MatrixCell>;
} {
  const receipt = asRecord(value, label);
  assertExactKeys(receipt, [
    "artifactIds",
    "auditSha256",
    "candidateBindingVersion",
    "candidateExtractionVersion",
    "cells",
    "normalizationVersion",
    "overlapCount",
    "schemaVersion",
    "status",
    "surfaceIds",
  ], label);
  if (
    receipt.schemaVersion !== 1 ||
    receipt.candidateBindingVersion !== 1 ||
    receipt.candidateExtractionVersion !==
      "semantic-documents-exact-relations-corpus-wide-v9" ||
    receipt.normalizationVersion !==
      "nfkc-lowercase-whitespace-numeric-equivalence-v4" ||
    !sameStrings(
      stringArray(receipt.artifactIds, `${label} artifact IDs`),
      [...HIDDEN_ARTIFACT_IDS],
    ) ||
    !sameStrings(
      stringArray(receipt.surfaceIds, `${label} surface IDs`),
      [...ALL_LEAKAGE_SURFACE_IDS],
    ) ||
    !isNonNegativeInteger(receipt.overlapCount) ||
    (receipt.status !== "accepted" && receipt.status !== "rejected")
  ) {
    throw new Error(`${label} has an invalid C4 matrix envelope`);
  }
  const expectedIdentities = [...ALL_LEAKAGE_SURFACE_IDS]
    .sort()
    .flatMap((surfaceId) => [...HIDDEN_ARTIFACT_IDS]
      .sort()
      .map((artifactId) => `${surfaceId}/${artifactId}`));
  const values = asArray(receipt.cells, `${label} cells`);
  if (values.length !== expectedIdentities.length) {
    throw new Error(`${label} does not contain the complete 9 x 3 matrix`);
  }
  const cells = new Map<string, VerifiedC4MatrixCell>();
  let overlapCount = 0;
  for (const [index, item] of values.entries()) {
    const cell = asRecord(item, `${label} cell`);
    assertExactKeys(cell, [
      "allowedPublicContractCount",
      "allowedPublicFragmentSha256",
      "artifactId",
      "artifactSha256",
      "candidateFragmentCount",
      "candidateFragmentSetSha256",
      "exactOverlapCount",
      "hiddenValueCount",
      "hiddenValueRelationCount",
      "hiddenValueRelationSetSha256",
      "hiddenValueSetSha256",
      "hiddenValueSurfaceSha256",
      "matchedFragmentSha256",
      "normalizedOverlapCount",
      "status",
      "surfaceId",
      "surfaceSha256",
    ], `${label} cell`);
    const surfaceId = requiredString(cell.surfaceId, `${label} surface ID`);
    const artifactId = requiredString(cell.artifactId, `${label} artifact ID`);
    const identity = `${surfaceId}/${artifactId}`;
    const allowed = canonicalSha256Array(
      cell.allowedPublicFragmentSha256,
      `${label} allowed public fragments`,
    );
    const matches = canonicalSha256Array(
      cell.matchedFragmentSha256,
      `${label} matched fragments`,
    );
    const cellOverlap = Number(cell.exactOverlapCount) +
      Number(cell.normalizedOverlapCount);
    if (
      identity !== expectedIdentities[index] ||
      !isNonNegativeInteger(cell.allowedPublicContractCount) ||
      !isNonNegativeInteger(cell.candidateFragmentCount) ||
      !isNonNegativeInteger(cell.exactOverlapCount) ||
      !isNonNegativeInteger(cell.hiddenValueCount) ||
      !isNonNegativeInteger(cell.hiddenValueRelationCount) ||
      !isNonNegativeInteger(cell.normalizedOverlapCount) ||
      allowed.length !== cell.allowedPublicContractCount ||
      matches.length !== cellOverlap ||
      cell.status !== (cellOverlap === 0 ? "accepted" : "rejected")
    ) {
      throw new Error(`${label} contains an inconsistent C4 matrix cell`);
    }
    for (const key of [
      "artifactSha256",
      "candidateFragmentSetSha256",
      "hiddenValueRelationSetSha256",
      "hiddenValueSetSha256",
      "hiddenValueSurfaceSha256",
      "surfaceSha256",
    ]) {
      assertSha256(cell[key], `${label} ${key}`);
    }
    cells.set(identity, {
      artifactId,
      matches,
      overlapCount: cellOverlap,
      raw: cell,
      surfaceId,
    });
    overlapCount += cellOverlap;
  }
  const auditSha256 = requiredSha256(receipt.auditSha256, `${label} audit hash`);
  const { auditSha256: _, ...basis } = receipt;
  if (
    auditSha256 !== sha256(JSON.stringify(basis)) ||
    overlapCount !== receipt.overlapCount ||
    receipt.status !== (overlapCount === 0 ? "accepted" : "rejected")
  ) {
    throw new Error(`${label} C4 matrix audit hash or status is inconsistent`);
  }
  return { auditSha256, cells };
}

function canonicalSha256Array(value: unknown, label: string): string[] {
  const digests = stringArray(value, label);
  for (const digest of digests) assertSha256(digest, label);
  if (
    new Set(digests).size !== digests.length ||
    digests.some((digest, index) =>
      index > 0 && digests[index - 1]!.localeCompare(digest) >= 0
    )
  ) {
    throw new Error(`${label} must be unique and canonically sorted`);
  }
  return digests;
}

function canonicalSortedSha256Array(value: unknown, label: string): string[] {
  const digests = stringArray(value, label);
  for (const digest of digests) assertSha256(digest, label);
  if (digests.some((digest, index) =>
    index > 0 && digests[index - 1]!.localeCompare(digest) > 0
  )) {
    throw new Error(`${label} must be canonically sorted`);
  }
  return digests;
}

function canonicalStringArray(value: unknown, label: string): string[] {
  const items = stringArray(value, label);
  if (
    items.some((item) => item.length === 0) ||
    new Set(items).size !== items.length ||
    items.some((item, index) =>
      index > 0 && items[index - 1]!.localeCompare(item) >= 0
    )
  ) {
    throw new Error(`${label} must be non-empty, unique, and canonically sorted`);
  }
  return items;
}

interface ParsedPairEvaluation {
  arm: C5PilotArm;
  disposition: "finalized" | "infrastructure-failure";
  evaluationEvidenceSha256: string;
  resolved: boolean;
  taskFailureReasons: string[];
}

function parsePairEvaluations(
  value: unknown,
  label: string,
  baselineArm: C5BaselineArm,
): ParsedPairEvaluation[] {
  const values = asArray(value, `${label} evaluations`);
  if (values.length !== 2) {
    throw new Error(`${label} must contain exactly two evaluations`);
  }
  const result: ParsedPairEvaluation[] = [];
  const arms = new Set<C5PilotArm>();
  for (const value of values) {
    const evaluation = asRecord(value, `${label} evaluation`);
    assertExactKeys(evaluation, [
      "arm",
      "disposition",
      "evaluationEvidenceSha256",
      "resolved",
      "taskFailureReasons",
    ], `${label} evaluation`);
    if (
      (evaluation.arm !== baselineArm &&
        evaluation.arm !== "goodmemory-installed") ||
      (evaluation.disposition !== "finalized" &&
        evaluation.disposition !== "infrastructure-failure") ||
      typeof evaluation.resolved !== "boolean"
    ) {
      throw new Error(`${label} contains invalid evaluator evidence`);
    }
    const arm = evaluation.arm as C5PilotArm;
    if (arms.has(arm)) {
      throw new Error(`${label} duplicated an evaluated arm`);
    }
    arms.add(arm);
    result.push({
      arm,
      disposition: evaluation.disposition,
      evaluationEvidenceSha256: requiredSha256(
        evaluation.evaluationEvidenceSha256,
        `${label} evaluator binding`,
      ),
      resolved: evaluation.resolved,
      taskFailureReasons: stringArray(
        evaluation.taskFailureReasons,
        `${label} task failure reasons`,
      ),
    });
  }
  return result;
}

function verifyEvaluatorFailureEvidence(
  evidence: Record<string, unknown>,
  arm: C5PilotArm,
  path: string,
): void {
  assertExactKeys(evidence, [
    "arm",
    "reasonSha256",
    "schemaVersion",
    "status",
  ], path);
  if (
    evidence.arm !== arm ||
    evidence.schemaVersion !== 1 ||
    evidence.status !== "infrastructure-failure"
  ) {
    throw new Error(`${path} is not bound infrastructure-failure evidence`);
  }
  assertSha256(evidence.reasonSha256, `${path} failure reason`);
}

function verifyEvaluatorEvidence(input: {
  evidence: Record<string, unknown>;
  evaluation: ParsedPairEvaluation;
  path: string;
  scoredInfrastructureFailure?: boolean;
}): void {
  assertExactKeys(input.evidence, [
    "arm",
    "evaluatorFiles",
    "failToPass",
    "passToPass",
    "sandbox",
    "schemaVersion",
    "score",
  ], input.path);
  if (
    input.evidence.schemaVersion !== 1 ||
    input.evidence.arm !== input.evaluation.arm
  ) {
    throw new Error(`${input.path} evaluator arm identity drifted`);
  }
  const evaluatorFiles = asArray(
    input.evidence.evaluatorFiles,
    `${input.path} evaluator files`,
  );
  const fileNames = new Set<string>();
  for (const value of evaluatorFiles) {
    const file = asRecord(value, `${input.path} evaluator file`);
    assertExactKeys(file, ["relativePath", "sha256"], `${input.path} evaluator file`);
    const relativePath = requiredString(
      file.relativePath,
      `${input.path} evaluator relative path`,
    );
    assertSha256(file.sha256, `${input.path} evaluator source commitment`);
    fileNames.add(relativePath);
  }
  if (!fileNames.has("cases.json") || !fileNames.has("runner.ts")) {
    throw new Error(`${input.path} omits frozen evaluator source commitments`);
  }
  verifySanitizedTestResult(input.evidence.failToPass, "fail-to-pass", input.path);
  verifySanitizedTestResult(input.evidence.passToPass, "pass-to-pass", input.path);
  verifyEvaluatorSandbox(input.evidence.sandbox, input.path);
  const score = asRecord(input.evidence.score, `${input.path} score`);
  assertExactKeys(score, [
    "disposition",
    "executionFailureStage",
    "resolved",
    "taskFailureReasons",
  ], `${input.path} score`);
  if (input.scoredInfrastructureFailure === true) {
    // The evaluator ran, but the arm's Codex process never completed; the
    // score records the execution failure and never counts as resolved.
    if (
      score.disposition !== "infrastructure-failure" ||
      typeof score.executionFailureStage !== "string" ||
      score.executionFailureStage.length === 0 ||
      score.resolved !== false ||
      input.evaluation.resolved !== false ||
      stringArray(score.taskFailureReasons, `${input.path} score reasons`)
        .length !== 0 ||
      input.evaluation.taskFailureReasons.length !== 0
    ) {
      throw new Error(`${input.path} scored infrastructure failure is inconsistent`);
    }
    return;
  }
  if (
    score.disposition !== "finalized" ||
    score.executionFailureStage !== null ||
    score.resolved !== input.evaluation.resolved ||
    !sameStrings(
      stringArray(score.taskFailureReasons, `${input.path} score reasons`),
      input.evaluation.taskFailureReasons,
    ) ||
    (score.resolved === true && input.evaluation.taskFailureReasons.length > 0) ||
    (score.resolved === false && input.evaluation.taskFailureReasons.length === 0)
  ) {
    throw new Error(`${input.path} score is inconsistent or silently fell back`);
  }
}

function verifySanitizedTestResult(
  value: unknown,
  kind: "fail-to-pass" | "pass-to-pass",
  label: string,
): void {
  const result = asRecord(value, `${label} ${kind}`);
  assertExactKeys(result, [
    "commandSha256",
    "durationMs",
    "exitCode",
    "kind",
    "status",
  ], `${label} ${kind}`);
  assertSha256(result.commandSha256, `${label} ${kind} command hash`);
  if (
    result.kind !== kind ||
    !isNonNegativeNumber(result.durationMs) ||
    !isIntegerOrNull(result.exitCode) ||
    (result.status !== "passed" &&
      result.status !== "failed" &&
      result.status !== "timed-out")
  ) {
    throw new Error(`${label} contains invalid or infrastructure test evidence`);
  }
}

function verifyEvaluatorSandbox(value: unknown, label: string): void {
  const sandbox = asRecord(value, `${label} evaluator sandbox`);
  assertExactKeys(sandbox, [
    "configSha256",
    "configWriteDenied",
    "copiedAuthRemovedBeforeEvaluator",
    "evaluatorRead",
    "evaluatorWriteDenied",
    "networkAccess",
    "networkDenied",
    "networkPositiveControl",
    "originalAuthAliasDenied",
    "originalAuthDenied",
    "profileName",
    "schemaVersion",
    "workspaceRead",
    "workspaceWrite",
  ], `${label} evaluator sandbox`);
  assertSha256(sandbox.configSha256, `${label} evaluator config hash`);
  if (
    sandbox.schemaVersion !== 1 ||
    sandbox.profileName !== "c4-evaluator" ||
    sandbox.configWriteDenied !== true ||
    sandbox.copiedAuthRemovedBeforeEvaluator !== true ||
    sandbox.evaluatorRead !== true ||
    sandbox.evaluatorWriteDenied !== true ||
    sandbox.networkAccess !== false ||
    sandbox.networkDenied !== true ||
    sandbox.networkPositiveControl !== true ||
    sandbox.originalAuthAliasDenied !== true ||
    sandbox.originalAuthDenied !== true ||
    sandbox.workspaceRead !== true ||
    sandbox.workspaceWrite !== true
  ) {
    throw new Error(`${label} evaluator sandbox boundary did not pass`);
  }
}

function verifyReport(input: {
  generatedAt: string;
  pairs: Record<string, unknown>[];
  plan: C5PilotPlan;
  planSha256: string;
  report: Record<string, unknown>;
  runId: string;
  stages: Record<string, unknown>[];
}): void {
  assertExactKeys(input.report, [
    "acceptance",
    "attempts",
    "claimBoundary",
    "comparatorInjection",
    "effect",
    "evidenceClass",
    "failureTaxonomy",
    "fullSetBudget",
    "generatedAt",
    "memoryBehavior",
    "pairs",
    "phase",
    "planSha256",
    "powerAnalysis",
    "publicClaimEligible",
    "publicCodingEffectProof",
    "readmeRowAllowed",
    "resourceUsage",
    "runId",
    "schemaVersion",
  ], "C5 report");
  if (
    input.report.schemaVersion !== 1 ||
    input.report.phase !== "C5" ||
    input.report.evidenceClass !== EVIDENCE_CLASS ||
    input.report.claimBoundary !== CLAIM_BOUNDARY ||
    input.report.publicClaimEligible !== false ||
    input.report.publicCodingEffectProof !== false ||
    input.report.readmeRowAllowed !== false ||
    input.report.planSha256 !== input.planSha256 ||
    input.report.runId !== input.runId ||
    input.report.generatedAt !== input.generatedAt
  ) {
    throw new Error("C5 report changed the internal-only claim boundary");
  }
  assertExactRecord(input.report.acceptance, {
    everyAttemptAccountedFor: true,
    failureTaxonomyProduced: true,
    noSilentFallback: true,
    powerAnalysisProduced: true,
    status: "accepted",
  }, "C5 report acceptance");

  const baselineArm = c5PlanBaselineArm(input.plan);
  const installed = input.stages.filter((stage) =>
    stage.arm === "goodmemory-installed"
  );
  const usage = input.stages.flatMap((stage) =>
    stage.codexUsage === null
      ? []
      : [asRecord(stage.codexUsage, "C5 report usage")]
  );
  const comparatorReceipts = input.stages
    .filter((stage) => stage.arm === "flat-summary")
    .map((stage) => comparatorInjectionOf(stage));
  const expectedComparatorInjection = baselineArm !== "flat-summary"
    ? null
    : {
        contentInjectionCount: comparatorReceipts.filter((receipt) =>
          receipt?.mode === "content-injection"
        ).length,
        hookCanaryFailureCount: comparatorReceipts.filter((receipt) =>
          receipt === null || receipt.hookEvaluationPassed !== true
        ).length,
        injectedTokensTotal: comparatorReceipts.reduce(
          (total, receipt) => total + Number(receipt?.injectedTokenCount ?? 0),
          0,
        ),
        zeroInjectionCount: comparatorReceipts.filter((receipt) =>
          receipt?.mode === "no-history-zero-injection"
        ).length,
      };
  if (
    JSON.stringify(input.report.comparatorInjection) !==
      JSON.stringify(expectedComparatorInjection)
  ) {
    throw new Error("C5 report comparator injection was not reproduced");
  }
  assertExactRecord(input.report.attempts, {
    accountedCount: input.stages.length,
    codexCompletedCount: input.stages.filter((stage) =>
      stage.codexStatus === "completed"
    ).length,
    infrastructureFailureCount: input.stages.filter((stage) =>
      stage.infrastructureFailureStage !== null
    ).length,
    memoryChannelFailureCount: input.stages.filter((stage) =>
      stage.memoryChannelStatus === "failed"
    ).length,
    scheduledCount: input.plan.counts.stageRuns,
  }, "C5 report attempts");

  const outcomes = {
    incomparable: 0,
    regression: 0,
    rescue: 0,
    "shared-fail": 0,
    "shared-pass": 0,
  };
  for (const pair of input.pairs) {
    const outcome = requiredString(pair.outcome, "C5 pair outcome");
    if (!(outcome in outcomes)) {
      throw new Error("C5 report encountered an unknown pair outcome");
    }
    outcomes[outcome as keyof typeof outcomes] += 1;
  }
  assertExactRecord(input.report.pairs, {
    comparableCount: input.pairs.filter((pair) => pair.comparable === true).length,
    incomparableCount: outcomes.incomparable,
    outcomes,
    scheduledCount: 36,
  }, "C5 report pairs");

  const observedStages = installed.filter((stage) =>
    stage.memoryObservation !== null
  );
  const observations = observedStages.map((stage) =>
    asRecord(stage.memoryObservation, "C5 report memory observation")
  );
  const requiredRecallObservedCount = observedStages.filter((stage) => {
    const pair = input.pairs.find((candidate) =>
      candidate.clusterId === stage.clusterId &&
      candidate.stageId === stage.stageId
    );
    const observation = asRecord(
      stage.memoryObservation,
      "C5 report memory observation",
    );
    return pair?.memoryExpectation === "required" &&
      Number(observation.recalledPriorMemoryCount) > 0;
  }).length;
  assertExactRecord(input.report.memoryBehavior, {
    injectionObservedCount: observations.filter((observation) =>
      Number(observation.injectedRecordCount) > 0
    ).length,
    installedAttemptCount: 36,
    irrelevantInjectionCount: observations.filter((observation) =>
      observation.irrelevantInjection === true
    ).length,
    missingObservationCount: installed.length - observations.length,
    observedAttemptCount: observations.length,
    requiredRecallObservedCount,
    writebackCommittedCount: observations.filter((observation) =>
      observation.writebackCommitted === true
    ).length,
  }, "C5 report memory behavior");

  assertExactRecord(input.report.resourceUsage, {
    attemptsWithUsage: usage.length,
    cachedInputTokens: sumNumbers(usage, "cachedInputTokens"),
    estimatedCostUsd: null,
    inputTokens: sumNumbers(usage, "inputTokens"),
    missingUsageCount: input.stages.length - usage.length,
    outputTokens: sumNumbers(usage, "outputTokens"),
    pricingBoundary: "token-usage-only-model-price-not-frozen",
    totalCodexDurationMs: input.stages.reduce(
      (sum, stage) => sum + Number(stage.codexDurationMs),
      0,
    ),
  }, "C5 report resource usage");

  const failureTaxonomy = independentlyBuildFailureTaxonomy(
    input.pairs,
    input.stages,
    baselineArm,
  );
  if (JSON.stringify(input.report.failureTaxonomy) !== JSON.stringify(failureTaxonomy)) {
    throw new Error("C5 report failure taxonomy was not reproduced from pair evidence");
  }
  const comparablePairs = input.pairs.filter((pair) => pair.comparable === true);
  const noMemoryResolved = countResolved(
    comparablePairs,
    baselineArm,
    baselineArm,
  );
  const installedResolved = countResolved(
    comparablePairs,
    "goodmemory-installed",
    baselineArm,
  );
  const netRescueRate = comparablePairs.length === 0
    ? null
    : (outcomes.rescue - outcomes.regression) / comparablePairs.length;
  const expectedEffect = {
    baselineArm,
    baselineResolveRate: comparablePairs.length === 0
      ? null
      : noMemoryResolved / comparablePairs.length,
    comparablePairs: comparablePairs.length,
    goodMemoryResolveRate: comparablePairs.length === 0
      ? null
      : installedResolved / comparablePairs.length,
    netRescueRate,
    netRescueRateInterval95: independentlyBootstrapInterval({
      pairs: input.pairs,
      plan: input.plan,
      planSha256: input.planSha256,
    }),
    noMemoryResolveRate: comparablePairs.length === 0
      ? null
      : noMemoryResolved / comparablePairs.length,
    observedDiscordanceRate: comparablePairs.length === 0
      ? null
      : (outcomes.rescue + outcomes.regression) / comparablePairs.length,
    regressions: outcomes.regression,
    rescues: outcomes.rescue,
  };
  assertExactRecord(input.report.effect, expectedEffect, "C5 report effect");

  const correlation = independentlyEstimateEpisodeCorrelation(comparablePairs);
  const materialEffectRate =
    input.plan.analysis.materialEffectPercentagePoints / 100;
  const powerAnalysis = independentlyBuildPowerAnalysis({
    materialEffectRate,
    observedWithinEpisodeCorrelation: correlation,
  });
  assertExactRecord(
    input.report.powerAnalysis,
    powerAnalysis,
    "C5 report power analysis",
  );
  assertExactRecord(input.report.fullSetBudget, {
    arms: 2,
    codexCalls: powerAnalysis.requiredEpisodes * 3 * 2 * 3,
    episodes: powerAnalysis.requiredEpisodes,
    repositories: 6,
    scoredStages: powerAnalysis.requiredEpisodes * 3,
    seeds: 3,
  }, "C5 full-set budget");
}

function independentlyBuildFailureTaxonomy(
  pairs: readonly Record<string, unknown>[],
  stages: readonly Record<string, unknown>[],
  baselineArm: C5BaselineArm,
): Array<{ count: number; reason: string }> {
  const counts = new Map<string, number>();
  for (const stage of stages) {
    if (stage.infrastructureFailureStage !== null) {
      const reason = `infrastructure:${stage.infrastructureFailureStage}`;
      counts.set(reason, (counts.get(reason) ?? 0) + 1);
    }
    if (stage.memoryChannelStatus === "failed") {
      const reason = "goodmemory-memory-channel-failed";
      counts.set(reason, (counts.get(reason) ?? 0) + 1);
    }
  }
  for (const pair of pairs) {
    for (const value of stringArray(
      pair.incomparabilityReasons,
      "C5 taxonomy incomparability reasons",
    )) {
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    const evaluations = parsePairEvaluations(
      pair.evaluations,
      "C5 taxonomy",
      baselineArm,
    );
    for (const evaluation of evaluations) {
      for (const reason of evaluation.taskFailureReasons) {
        const key = `task:${evaluation.arm}:${reason}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
  }
  return [...counts.entries()]
    .sort(([first], [second]) => first.localeCompare(second))
    .map(([reason, count]) => ({ count, reason }));
}

function countResolved(
  pairs: readonly Record<string, unknown>[],
  arm: C5PilotArm,
  baselineArm: C5BaselineArm,
): number {
  return pairs.filter((pair) =>
    parsePairEvaluations(pair.evaluations, "C5 resolved count", baselineArm)
      .find((evaluation) => evaluation.arm === arm)?.resolved
  ).length;
}

function independentlyBootstrapInterval(input: {
  pairs: readonly Record<string, unknown>[];
  plan: C5PilotPlan;
  planSha256: string;
}): Record<string, unknown> | null {
  const episodeIds = [...new Set(input.plan.clusters.map((cluster) =>
    cluster.episodeId
  ))].sort();
  const pairsByEpisode = new Map(episodeIds.map((episodeId) => [
    episodeId,
    input.pairs.filter((pair) => pair.episodeId === episodeId),
  ]));
  if (!input.pairs.some((pair) => pair.comparable === true)) return null;
  const random = seededRandom(`${input.planSha256}:c5-bootstrap`);
  const samples: number[] = [];
  while (samples.length < 10_000) {
    const sampled: Record<string, unknown>[] = [];
    for (let draw = 0; draw < episodeIds.length; draw += 1) {
      const episodeId = episodeIds[Math.floor(random() * episodeIds.length)]!;
      sampled.push(...requiredMapValue(
        pairsByEpisode,
        episodeId,
        "C5 bootstrap episode",
      ));
    }
    const comparable = sampled.filter((pair) => pair.comparable === true);
    if (comparable.length === 0) continue;
    const rescues = comparable.filter((pair) => pair.outcome === "rescue").length;
    const regressions = comparable.filter((pair) => pair.outcome === "regression")
      .length;
    samples.push((rescues - regressions) / comparable.length);
  }
  samples.sort((first, second) => first - second);
  return {
    bootstrapSamples: 10_000,
    confidenceLevel: 0.95,
    lower: samples[Math.floor((samples.length - 1) * 0.025)]!,
    method: "paired-episode-cluster-percentile-bootstrap",
    resamplingUnit: "episode",
    upper: samples[Math.floor((samples.length - 1) * 0.975)]!,
  };
}

function independentlyEstimateEpisodeCorrelation(
  pairs: readonly Record<string, unknown>[],
): number {
  const byEpisode = new Map<string, number[]>();
  for (const pair of pairs) {
    const value = pair.outcome === "rescue"
      ? 1
      : pair.outcome === "regression"
      ? -1
      : 0;
    const episodeId = requiredString(pair.episodeId, "C5 pair episodeId");
    const values = byEpisode.get(episodeId) ?? [];
    values.push(value);
    byEpisode.set(episodeId, values);
  }
  const groups = [...byEpisode.values()];
  const observationsPerEpisode = groups[0]?.length ?? 0;
  if (
    groups.length < 2 ||
    observationsPerEpisode < 2 ||
    groups.some((group) => group.length !== observationsPerEpisode)
  ) {
    return 1;
  }
  const values = groups.flat();
  const overallMean = mean(values);
  const betweenMeanSquare = observationsPerEpisode * groups.reduce(
    (sum, group) => sum + (mean(group) - overallMean) ** 2,
    0,
  ) / (groups.length - 1);
  const withinMeanSquare = groups.reduce((sum, group) => {
    const groupMean = mean(group);
    return sum + group.reduce(
      (inner, value) => inner + (value - groupMean) ** 2,
      0,
    );
  }, 0) / (groups.length * (observationsPerEpisode - 1));
  const denominator = betweenMeanSquare +
    (observationsPerEpisode - 1) * withinMeanSquare;
  return denominator === 0
    ? 0
    : Math.max(
      0,
      Math.min(1, (betweenMeanSquare - withinMeanSquare) / denominator),
    );
}

function independentlyBuildPowerAnalysis(input: {
  materialEffectRate: number;
  observedWithinEpisodeCorrelation: number;
}): {
  alpha: 0.05;
  designEffect: number;
  materialEffectRate: number;
  method: "paired-proportion-normal-approximation-with-episode-design-effect";
  observedWithinEpisodeCorrelation: number;
  pairedObservationsBeforeClustering: number;
  planningDiscordanceRate: 0.5;
  power: 0.8;
  requiredEpisodes: number;
  seeds: 3;
  stagesPerEpisode: 3;
} {
  const pairedObservationsBeforeClustering = Math.ceil((
    1.959963984540054 * Math.sqrt(0.5) +
    0.8416212335729143 * Math.sqrt(0.5 - input.materialEffectRate ** 2)
  ) ** 2 / input.materialEffectRate ** 2);
  const designEffect = 1 +
    8 * input.observedWithinEpisodeCorrelation;
  return {
    alpha: 0.05,
    designEffect,
    materialEffectRate: input.materialEffectRate,
    method: "paired-proportion-normal-approximation-with-episode-design-effect",
    observedWithinEpisodeCorrelation: input.observedWithinEpisodeCorrelation,
    pairedObservationsBeforeClustering,
    planningDiscordanceRate: 0.5,
    power: 0.8,
    requiredEpisodes: Math.max(
      30,
      Math.ceil(pairedObservationsBeforeClustering * designEffect / 9),
    ),
    seeds: 3,
    stagesPerEpisode: 3,
  };
}

function parseManifest(bytes: string): C5EvidenceProjectionManifest {
  const value = parseJsonRecord(bytes, "projection-manifest.json");
  if (`${JSON.stringify(value, null, 2)}\n` !== bytes) {
    throw new Error("C5 projection manifest is not canonically serialized");
  }
  assertExactKeys(value, [
    "claimBoundary",
    "evidenceClass",
    "files",
    "projectedEvidenceAggregateSha256",
    "runId",
    "schemaVersion",
    "sourceEvidenceAggregateSha256",
    "sourceRunIdentitySha256",
  ], "C5 projection manifest");
  if (
    value.schemaVersion !== 1 ||
    value.claimBoundary !== CLAIM_BOUNDARY ||
    value.evidenceClass !== EVIDENCE_CLASS
  ) {
    throw new Error("invalid C5 projection manifest boundary");
  }
  const runId = requiredString(value.runId, "C5 projection runId");
  const files: ProjectionFile[] = [];
  const paths = new Set<string>();
  for (const item of asArray(value.files, "C5 projection files")) {
    const file = asRecord(item, "C5 projection file");
    assertExactKeys(
      file,
      ["bytes", "path", "sha256", "sourceSha256"],
      "C5 projection file",
    );
    const path = requiredString(file.path, "C5 projection file path");
    if (
      !isSafeRelativePath(path) ||
      paths.has(path) ||
      !isNonNegativeInteger(file.bytes)
    ) {
      throw new Error("invalid C5 projection file manifest");
    }
    paths.add(path);
    files.push({
      bytes: file.bytes,
      path,
      sha256: requiredSha256(file.sha256, "C5 projected file hash"),
      sourceSha256: requiredSha256(
        file.sourceSha256,
        "C5 source file hash",
      ),
    });
  }
  if (
    files.length === 0 ||
    files.some((file, index) =>
      index > 0 && files[index - 1]!.path.localeCompare(file.path) >= 0
    )
  ) {
    throw new Error("C5 projection files are not uniquely sorted");
  }
  return {
    claimBoundary: CLAIM_BOUNDARY,
    evidenceClass: EVIDENCE_CLASS,
    files,
    projectedEvidenceAggregateSha256: requiredSha256(
      value.projectedEvidenceAggregateSha256,
      "C5 projected evidence aggregate",
    ),
    runId,
    schemaVersion: 1,
    sourceEvidenceAggregateSha256: requiredSha256(
      value.sourceEvidenceAggregateSha256,
      "C5 source evidence aggregate",
    ),
    sourceRunIdentitySha256: requiredSha256(
      value.sourceRunIdentitySha256,
      "C5 source identity hash",
    ),
  };
}

function evidenceAggregate(files: readonly ProjectionFile[]): string {
  return sha256(`${JSON.stringify(files.map((file) => ({
    bytes: file.bytes,
    path: file.path,
    sha256: file.sha256,
    sourceSha256: file.sourceSha256,
  })))}\n`);
}

function createArtifactReader(files: ReadonlyMap<string, string>): ArtifactReader {
  return {
    bytes(path) {
      return requiredBytes(files, path);
    },
    json(path) {
      const bytes = requiredBytes(files, path);
      const value = parseJsonRecord(bytes, path);
      if (`${JSON.stringify(value, null, 2)}\n` !== bytes) {
        throw new Error(`${path} is not canonically serialized JSON`);
      }
      return value;
    },
  };
}

function parseJsonLines(bytes: string, label: string): Record<string, unknown>[] {
  if (bytes.length === 0) return [];
  if (!bytes.endsWith("\n") || bytes.includes("\n\n")) {
    throw new Error(`${label} is not canonical JSONL`);
  }
  const lines = bytes.slice(0, -1).split("\n");
  if (lines.length === 1 && lines[0] === "") return [];
  return lines.map((line, index) => {
    const value = parseJsonRecord(line, `${label}:${index + 1}`);
    if (JSON.stringify(value) !== line) {
      throw new Error(`${label}:${index + 1} is not canonical JSONL`);
    }
    return value;
  });
}

function verifyUsage(value: unknown, label: string): void {
  if (value === null) return;
  const usage = asRecord(value, `${label} usage`);
  assertExactKeys(usage, [
    "cachedInputTokens",
    "inputTokens",
    "outputTokens",
  ], `${label} usage`);
  if (Object.values(usage).some((count) => !isNonNegativeInteger(count))) {
    throw new Error(`${label} has invalid token usage`);
  }
}

function verifyMemoryObservation(
  observation: Record<string, unknown>,
  stage: C5PilotStageRun,
  writebackRequired: boolean,
): void {
  assertExactKeys(observation, [
    "injectedRecordCount",
    "irrelevantInjection",
    "recalledPriorMemoryCount",
    "writebackCommitted",
    "writtenMemoryCount",
  ], "C5 memory observation");
  if (
    !isNonNegativeInteger(observation.injectedRecordCount) ||
    !isNonNegativeInteger(observation.recalledPriorMemoryCount) ||
    !isNonNegativeInteger(observation.writtenMemoryCount) ||
    typeof observation.irrelevantInjection !== "boolean" ||
    typeof observation.writebackCommitted !== "boolean" ||
    observation.writebackCommitted !==
      (Number(observation.writtenMemoryCount) > 0) ||
    (writebackRequired && observation.writebackCommitted !== true) ||
    (stage.memoryExpectation === "none" &&
      (Number(observation.injectedRecordCount) !== 0 ||
        Number(observation.recalledPriorMemoryCount) !== 0)) ||
    observation.irrelevantInjection !==
      (stage.memoryExpectation === "irrelevant-control" &&
        Number(observation.injectedRecordCount) > 0) ||
    (stage.memoryExpectation === "required" &&
      Number(observation.recalledPriorMemoryCount) === 0)
  ) {
    throw new Error(`C5 stage ${stage.id} has an invalid memory observation`);
  }
}

function verifyFailedMemoryObservation(
  observation: Record<string, unknown>,
): void {
  assertExactKeys(observation, [
    "injectedRecordCount",
    "irrelevantInjection",
    "recalledPriorMemoryCount",
    "writebackCommitted",
    "writtenMemoryCount",
  ], "C5 failed memory observation");
  if (
    !isNonNegativeInteger(observation.injectedRecordCount) ||
    !isNonNegativeInteger(observation.recalledPriorMemoryCount) ||
    !isNonNegativeInteger(observation.writtenMemoryCount) ||
    typeof observation.irrelevantInjection !== "boolean" ||
    typeof observation.writebackCommitted !== "boolean"
  ) {
    throw new Error("C5 failed memory observation is invalid");
  }
}

function verifyInstalledProfile(value: unknown): void {
  const profile = asRecord(value, "C5 installed profile");
  assertExactKeys(profile, [
    "activationMode",
    "hookRegistered",
    "mcpRegistered",
    "persistRawTranscript",
    "retrievalProfile",
    "workspaceStatus",
    "writebackMode",
  ], "C5 installed profile");
  assertExactRecord(profile, {
    activationMode: "global",
    hookRegistered: true,
    mcpRegistered: true,
    persistRawTranscript: false,
    retrievalProfile: "coding_agent",
    workspaceStatus: "ok",
    writebackMode: "selective",
  }, "C5 installed profile");
}

function pairOutcome(
  evaluations: readonly ParsedPairEvaluation[],
  baselineArm: C5BaselineArm,
): "regression" | "rescue" | "shared-fail" | "shared-pass" {
  const baseline = evaluations.find((item) => item.arm === baselineArm)!;
  const installed = evaluations.find((item) =>
    item.arm === "goodmemory-installed"
  )!;
  if (baseline.resolved && installed.resolved) return "shared-pass";
  if (!baseline.resolved && !installed.resolved) return "shared-fail";
  return installed.resolved ? "rescue" : "regression";
}

function runsForCluster(
  plan: C5PilotPlan,
  cluster: C5PilotCluster,
): C5PilotEpisodeArmRun[] {
  return plan.episodeArmRuns
    .filter((run) => run.clusterId === cluster.id)
    .sort((first, second) => first.armOrderPosition - second.armOrderPosition);
}

function trajectoryRoot(clusterId: string): string {
  return `trajectories/${clusterDigest(clusterId)}`;
}

function clusterDigest(clusterId: string): string {
  return sha256(clusterId).slice(0, 16);
}

function assertExactRecord(
  actual: unknown,
  expected: Record<string, unknown>,
  label: string,
): void {
  const record = asRecord(actual, label);
  if (JSON.stringify(record) !== JSON.stringify(expected)) {
    throw new Error(`${label} is inconsistent with independently recomputed evidence`);
  }
}

function assertExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (!sameStrings(actual, expected)) {
    throw new Error(`${label} has an unsupported or missing field`);
  }
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }
  return value;
}

function stringArray(value: unknown, label: string): string[] {
  const values = asArray(value, label);
  if (values.some((item) => typeof item !== "string")) {
    throw new Error(`${label} must contain only strings`);
  }
  return values as string[];
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function requiredStringAllowEmpty(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string`);
  }
  return value;
}

function requiredSha256(value: unknown, label: string): string {
  assertSha256(value, label);
  return value;
}

function assertSha256(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    throw new Error(`${label} must be a SHA-256 digest`);
  }
}

function assertSafeSegment(value: string, label: string): void {
  if (!/^[A-Za-z0-9._-]+$/u.test(value) || value === "." || value === "..") {
    throw new Error(`${label} is not path safe`);
  }
}

function sameStrings(
  first: readonly string[],
  second: readonly string[],
): boolean {
  return first.length === second.length &&
    first.every((value, index) => value === second[index]);
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isIntegerOrNull(value: unknown): boolean {
  return value === null || Number.isSafeInteger(value);
}

function isGitObject(value: unknown): boolean {
  return typeof value === "string" && /^[a-f0-9]{40}$/u.test(value);
}

function sumNumbers(
  values: readonly Record<string, unknown>[],
  key: string,
): number {
  return values.reduce((sum, value) => sum + Number(value[key]), 0);
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function seededRandom(seed: string): () => number {
  let state = Number.parseInt(sha256(seed).slice(0, 8), 16) || 0x9e3779b9;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
}

function evidenceChecks(value: boolean): C5EvidenceVerification["checks"] {
  return {
    actualFileHashesVerified: value,
    exactPlanTopologyVerified: value,
    hostPreflightVerified: value,
    noInfrastructureFailure: value,
    noLeakageRejection: value,
    noMemoryChannelFailure: value,
    noSilentFallback: value,
    reportRecomputed: value,
  };
}

function passingChecks(): C5EvidenceVerification["checks"] {
  return evidenceChecks(true);
}

function failingChecks(): C5EvidenceVerification["checks"] {
  return evidenceChecks(false);
}

function requiredBytes(
  files: ReadonlyMap<string, string>,
  path: string,
): string {
  const bytes = files.get(path);
  if (bytes === undefined) {
    throw new Error(`missing C5 projected evidence file ${path}`);
  }
  return bytes;
}

function requiredMapValue<Key, Value>(
  values: ReadonlyMap<Key, Value>,
  key: Key,
  label: string,
): Value {
  const value = values.get(key);
  if (value === undefined) {
    throw new Error(`missing ${label}`);
  }
  return value;
}

function parseJsonRecord(bytes: string, label: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(bytes);
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
  return asRecord(value, label);
}

function isSafeRelativePath(path: string): boolean {
  if (path.length === 0 || path.includes("\\") || isAbsolute(path)) return false;
  const segments = path.split("/");
  return segments.every((segment) =>
    segment.length > 0 && segment !== "." && segment !== ".."
  );
}

async function readRequiredRegularFile(
  root: string,
  path: string,
): Promise<string> {
  if (!isSafeRelativePath(path)) {
    throw new Error(`unsafe C5 evidence path ${path}`);
  }
  const absolutePath = join(root, ...path.split("/"));
  const [rootReal, fileReal] = await Promise.all([
    realpath(root),
    realpath(absolutePath),
  ]);
  if (!pathInsideOrEqual(rootReal, fileReal)) {
    throw new Error(`C5 evidence path escapes its root: ${path}`);
  }
  return readRequiredAbsoluteRegularFile(absolutePath, `C5 evidence ${path}`);
}

async function readRequiredAbsoluteRegularFile(
  path: string,
  label: string,
): Promise<string> {
  let info;
  try {
    info = await lstat(path);
  } catch (error) {
    if (isMissingPathError(error)) {
      throw new Error(`missing ${label}`);
    }
    throw error;
  }
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new Error(`${label} must be a regular non-symlink file`);
  }
  return readFile(path, "utf8");
}

async function assertRealDirectory(path: string, label: string): Promise<void> {
  let info;
  try {
    info = await lstat(path);
  } catch (error) {
    if (isMissingPathError(error)) throw new Error(`missing ${label}`);
    throw error;
  }
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error(`${label} must be a real directory`);
  }
}

async function assertAbsent(path: string, label: string): Promise<void> {
  try {
    await lstat(path);
  } catch (error) {
    if (isMissingPathError(error)) return;
    throw error;
  }
  throw new Error(`${label} already exists`);
}

async function collectRelativeFilePaths(root: string): Promise<string[]> {
  const files: string[] = [];
  await walkProjection(root, "", files);
  return files.sort();
}

async function walkProjection(
  root: string,
  relativeDirectory: string,
  files: string[],
): Promise<void> {
  const directory = relativeDirectory === ""
    ? root
    : join(root, ...relativeDirectory.split("/"));
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((first, second) => first.name.localeCompare(second.name));
  for (const entry of entries) {
    const relativePath = relativeDirectory === ""
      ? entry.name
      : `${relativeDirectory}/${entry.name}`;
    if (entry.isSymbolicLink()) {
      throw new Error(`C5 projection contains a symbolic link: ${relativePath}`);
    }
    if (entry.isDirectory()) {
      await walkProjection(root, relativePath, files);
      continue;
    }
    if (!entry.isFile()) {
      throw new Error(`C5 projection contains a non-regular entry: ${relativePath}`);
    }
    files.push(relativePath);
  }
}

async function resolvePhysicalPath(path: string): Promise<string> {
  let ancestor = resolve(path);
  const missing: string[] = [];
  while (true) {
    try {
      return resolve(await realpath(ancestor), ...missing);
    } catch (error) {
      if (!isMissingPathError(error)) throw error;
      const parent = dirname(ancestor);
      if (parent === ancestor) return resolve(path);
      missing.unshift(ancestor.slice(parent.length + 1));
      ancestor = parent;
    }
  }
}

function pathsOverlap(first: string, second: string): boolean {
  return pathInsideOrEqual(first, second) || pathInsideOrEqual(second, first);
}

function pathInsideOrEqual(parent: string, candidate: string): boolean {
  const child = relative(resolve(parent), resolve(candidate));
  return child === "" ||
    (child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child));
}

function isMissingPathError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
