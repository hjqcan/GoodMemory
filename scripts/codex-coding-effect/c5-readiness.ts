import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";

import { z } from "zod";

import {
  assertC4BaselineCeilingReportBindings,
  buildC4BaselineCeilingTargets,
  reconstructC4BaselineFrozenStageBindings,
  serializeC4BaselineCeilingReport,
  verifyC4BaselineDatasetTargets,
  verifyC4BaselineStageEvidenceFiles,
} from "./c4-baseline-ceiling";
import type {
  C4BaselineCeilingReport,
  C4BaselineStageEvidenceFile,
} from "./c4-baseline-ceiling";
import {
  buildC4AssetLock,
  loadC4AssetLock,
  serializeC4AssetLock,
} from "./c4-controlled-dataset";
import {
  finalizeC4DatasetReadiness,
  runC4DatasetCoreReadiness,
} from "./c4-readiness";
import type {
  C5BaselineArm,
  C5PilotComparatorInput,
} from "./c5-pilot-plan";
import {
  buildC5PilotPlan,
  serializeC5PilotPlan,
} from "./c5-pilot-plan";
import type {
  C5PilotPlan,
} from "./c5-pilot-plan";
import { loadCodexCodingEffectDataset } from "./dataset";

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const trimmedStringSchema = z.string().min(1).refine(
  (value) => value.trim() === value,
  "value cannot be whitespace-padded",
);
const stageEvidenceFileSchema = z.object({
  bytes: z.string(),
  path: z.string().min(1),
}).strict();
const c5PilotPrerequisiteEvidenceSchema = z.object({
  baselineRawStageEvidenceFiles: z.array(stageEvidenceFileSchema),
  baselineReportBytes: z.string(),
  baselineStageEvidenceFiles: z.array(stageEvidenceFileSchema),
  c4ReadinessCoreBytes: z.string(),
  c4ReadinessReportBytes: z.string(),
  c4ReviewDispatchBytes: z.string(),
  c4ReviewInputBundleBytes: z.string(),
  c4ReviewProvenanceBytes: z.string(),
  c4ReviewRequestBytes: z.string(),
  c4ReviewResponseBytes: z.string(),
  schemaVersion: z.literal(2),
}).strict();
const acceptedC4ReadinessSchema = z.object({
  assetLockSha256: sha256Schema,
  assetRootSha256: sha256Schema,
  authorTaskName: z.literal("/root"),
  authorAttestationSha256: sha256Schema,
  baselineCeiling: z.object({
    ceilingRisk: z.literal(false),
    decision: z.literal("proceed-to-c5-pilot"),
    infrastructureFailureCount: z.literal(0),
    path: trimmedStringSchema,
    reportSha256: sha256Schema,
    runIdentitySha256: sha256Schema,
    stageEvidenceAggregateSha256: sha256Schema,
  }).strict(),
  claimBoundary: z.literal("dataset-readiness-only-no-coding-uplift"),
  coreSha256: sha256Schema,
  counts: z.object({
    baseProbes: z.literal(54),
    episodes: z.literal(6),
    repositories: z.literal(2),
    stages: z.literal(18),
  }).strict(),
  datasetId: z.literal("codex-c4-controlled-pilot-v2"),
  excludedHosts: z.tuple([z.literal("claude-code")]),
  host: z.literal("codex"),
  leakageAuditSha256: sha256Schema,
  manifestSha256: sha256Schema,
  nextEvidencePhase: z.literal("C5-native-longitudinal-pilot"),
  phase: z.literal("C4"),
  publicClaimEligible: z.literal(false),
  publicCodingEffectProof: z.literal(false),
  readmeRowAllowed: z.literal(false),
  reviewedAt: trimmedStringSchema,
  reviewer: trimmedStringSchema,
  reviewerAgentName: z.literal("/root/c4_final_independent_review_v5"),
  reviewerIdentityEvidence: z.literal(
    "orchestrator-attestation-not-cryptographic-receipt",
  ),
  reviewerRequestedTaskName: z.literal("c4_final_independent_review_v5"),
  reviewerType: z.literal("independent-ai-agent"),
  reviewContextPolicy: z.literal("fork-turns-none"),
  reviewDispatchSha256: sha256Schema,
  reviewInputBundleSha256: sha256Schema,
  reviewProvenanceSha256: sha256Schema,
  reviewRequestSha256: sha256Schema,
  reviewSha256: sha256Schema,
  schemaVersion: z.literal(3),
  status: z.literal("accepted"),
}).strict();

export type AcceptedC4Readiness = z.infer<
  typeof acceptedC4ReadinessSchema
>;
export type C5PilotPrerequisiteEvidence = z.infer<
  typeof c5PilotPrerequisiteEvidenceSchema
>;

export interface C5PilotReadinessInput {
  baselineArm?: C5BaselineArm;
  baselineReportPath: string;
  baselineRawStageEvidenceRoot?: string;
  baselineStageEvidenceRoot?: string;
  c4ReadinessCorePath: string;
  c4ReadinessReportPath: string;
  c4ReadinessWorkspaceRoot: string;
  c4ReviewDispatchPath: string;
  c4ReviewInputBundlePath: string;
  c4ReviewProvenancePath: string;
  c4ReviewRequestPath: string;
  c4ReviewResponsePath: string;
  comparator?: C5PilotComparatorInput;
  datasetRoot: string;
  materialEffectPercentagePoints: number;
  orderSeed: number;
}

export interface C5PilotReadinessResult {
  c4Readiness: AcceptedC4Readiness;
  c4ReadinessReportSha256: string;
  plan: C5PilotPlan;
  planBytes: string;
  planSha256: string;
  prerequisiteEvidenceBytes: string;
  prerequisiteEvidenceSha256: string;
}

export async function loadC5PilotReadiness(
  input: C5PilotReadinessInput,
): Promise<C5PilotReadinessResult> {
  const baselineBytes = await readFile(input.baselineReportPath, "utf8");
  const [
    c4ReadinessCoreBytes,
    c4ReadinessBytes,
    c4ReviewDispatchBytes,
    c4ReviewInputBundleBytes,
    c4ReviewProvenanceBytes,
    c4ReviewRequestBytes,
    c4ReviewResponseBytes,
    baselineRawStageEvidenceFiles,
    baselineStageEvidenceFiles,
  ] = await Promise.all([
    readFile(input.c4ReadinessCorePath, "utf8"),
    readFile(input.c4ReadinessReportPath, "utf8"),
    readFile(input.c4ReviewDispatchPath, "utf8"),
    readFile(input.c4ReviewInputBundlePath, "utf8"),
    readFile(input.c4ReviewProvenancePath, "utf8"),
    readFile(input.c4ReviewRequestPath, "utf8"),
    readFile(input.c4ReviewResponsePath, "utf8"),
    loadStageEvidenceFiles(
      input.baselineRawStageEvidenceRoot ??
        resolve(dirname(input.baselineReportPath), "raw-stages"),
    ),
    loadStageEvidenceFiles(
      input.baselineStageEvidenceRoot ??
        resolve(dirname(input.baselineReportPath), "stages"),
    ),
  ]);
  const prerequisiteEvidenceBytes = serializeC5PilotPrerequisiteEvidence({
    baselineRawStageEvidenceFiles,
    baselineReportBytes: baselineBytes,
    baselineStageEvidenceFiles,
    c4ReadinessCoreBytes,
    c4ReadinessReportBytes: c4ReadinessBytes,
    c4ReviewDispatchBytes,
    c4ReviewInputBundleBytes,
    c4ReviewProvenanceBytes,
    c4ReviewRequestBytes,
    c4ReviewResponseBytes,
    schemaVersion: 2,
  });
  return verifyC5PilotPrerequisiteEvidence({
    ...(input.baselineArm === undefined ? {} : { baselineArm: input.baselineArm }),
    c4ReadinessWorkspaceRoot: input.c4ReadinessWorkspaceRoot,
    ...(input.comparator === undefined ? {} : { comparator: input.comparator }),
    datasetRoot: input.datasetRoot,
    materialEffectPercentagePoints: input.materialEffectPercentagePoints,
    orderSeed: input.orderSeed,
    prerequisiteEvidenceBytes,
  });
}

export async function verifyC5PilotPrerequisiteEvidence(input: {
  baselineArm?: C5BaselineArm;
  c4ReadinessWorkspaceRoot: string;
  comparator?: C5PilotComparatorInput;
  datasetRoot: string;
  materialEffectPercentagePoints: number;
  orderSeed: number;
  prerequisiteEvidenceBytes: string;
}): Promise<C5PilotReadinessResult> {
  const datasetRoot = resolve(input.datasetRoot);
  const prerequisiteEvidence = parseC5PilotPrerequisiteEvidence(
    input.prerequisiteEvidenceBytes,
  );
  const [loaded, storedAssetLock, currentAssetLock] = await Promise.all([
    loadCodexCodingEffectDataset(datasetRoot),
    loadC4AssetLock(datasetRoot),
    buildC4AssetLock(datasetRoot),
  ]);
  if (
    serializeC4AssetLock(storedAssetLock.assetLock) !==
      serializeC4AssetLock(currentAssetLock)
  ) {
    throw new Error("C5 frozen C4 asset lock does not match current assets");
  }

  const c4Readiness = parseAcceptedC4Readiness(
    prerequisiteEvidence.c4ReadinessReportBytes,
  );
  const rebuiltCore = await runC4DatasetCoreReadiness({
    datasetRoot,
    workspaceRoot: resolve(input.c4ReadinessWorkspaceRoot),
  });
  if (rebuiltCore.coreBytes !== prerequisiteEvidence.c4ReadinessCoreBytes) {
    throw new Error("C5 C4 readiness core does not match frozen dataset");
  }

  const stageTargets = buildC4BaselineCeilingTargets(loaded.dataset);
  const frozenStageBindings = await reconstructC4BaselineFrozenStageBindings({
    dataset: loaded.dataset,
    datasetRoot,
  });
  const baseline = validateAcceptedBaseline(
    prerequisiteEvidence.baselineReportBytes,
    prerequisiteEvidence.baselineStageEvidenceFiles,
    prerequisiteEvidence.baselineRawStageEvidenceFiles,
    stageTargets,
    frozenStageBindings,
  );
  const rebuiltReadiness = finalizeC4DatasetReadiness({
    baselineBytes: prerequisiteEvidence.baselineReportBytes,
    baselinePath: c4Readiness.baselineCeiling.path,
    baselineStageEvidenceFiles:
      prerequisiteEvidence.baselineStageEvidenceFiles,
    dispatchBytes: prerequisiteEvidence.c4ReviewDispatchBytes,
    inputBundleBytes: prerequisiteEvidence.c4ReviewInputBundleBytes,
    provenanceBytes: prerequisiteEvidence.c4ReviewProvenanceBytes,
    requestBytes: prerequisiteEvidence.c4ReviewRequestBytes,
    result: rebuiltCore,
    reviewBytes: prerequisiteEvidence.c4ReviewResponseBytes,
  });
  if (
    rebuiltReadiness.reportBytes !==
      prerequisiteEvidence.c4ReadinessReportBytes
  ) {
    throw new Error("accepted C4 readiness report does not match finalizer replay");
  }
  const repositoryCount = new Set(
    loaded.dataset.episodes.map((episode) => episode.repository.url),
  ).size;
  const stageCount = loaded.dataset.episodes.reduce(
    (count, episode) => count + episode.stages.length,
    0,
  );
  if (
    c4Readiness.datasetId !== loaded.dataset.datasetId ||
    c4Readiness.manifestSha256 !== loaded.manifestSha256 ||
    c4Readiness.assetLockSha256 !== storedAssetLock.assetLockSha256 ||
    c4Readiness.assetRootSha256 !== currentAssetLock.assetRootSha256 ||
    c4Readiness.counts.episodes !== loaded.dataset.episodes.length ||
    c4Readiness.counts.repositories !== repositoryCount ||
    c4Readiness.counts.stages !== stageCount
  ) {
    throw new Error("accepted C4 readiness report does not bind the frozen dataset");
  }
  if (
    c4Readiness.baselineCeiling.reportSha256 !== baseline.reportSha256 ||
    c4Readiness.baselineCeiling.runIdentitySha256 !==
      baseline.report.runIdentitySha256 ||
    c4Readiness.baselineCeiling.stageEvidenceAggregateSha256 !==
      baseline.report.stageEvidenceAggregateSha256 ||
    baseline.report.assetLockSha256 !== storedAssetLock.assetLockSha256 ||
    baseline.report.assetRootSha256 !== currentAssetLock.assetRootSha256 ||
    baseline.report.manifestSha256 !== loaded.manifestSha256
  ) {
    throw new Error("accepted C4 readiness report does not bind the baseline");
  }

  const c4ReadinessReportSha256 = sha256(
    prerequisiteEvidence.c4ReadinessReportBytes,
  );
  const plan = buildC5PilotPlan({
    assetLockSha256: storedAssetLock.assetLockSha256,
    assetRootSha256: currentAssetLock.assetRootSha256,
    ...(input.baselineArm === undefined ? {} : { baselineArm: input.baselineArm }),
    baselineCeilingReportSha256: baseline.reportSha256,
    c4ReadinessReportSha256,
    ...(input.comparator === undefined ? {} : { comparator: input.comparator }),
    dataset: loaded.dataset,
    manifestSha256: loaded.manifestSha256,
    materialEffectPercentagePoints: input.materialEffectPercentagePoints,
    orderSeed: input.orderSeed,
  });
  const planBytes = serializeC5PilotPlan(plan);
  return {
    c4Readiness,
    c4ReadinessReportSha256,
    plan,
    planBytes,
    planSha256: sha256(planBytes),
    prerequisiteEvidenceBytes: input.prerequisiteEvidenceBytes,
    prerequisiteEvidenceSha256: sha256(input.prerequisiteEvidenceBytes),
  };
}

export function serializeC5PilotPrerequisiteEvidence(
  evidence: C5PilotPrerequisiteEvidence,
): string {
  return `${JSON.stringify(evidence, null, 2)}\n`;
}

function parseC5PilotPrerequisiteEvidence(
  bytes: string,
): C5PilotPrerequisiteEvidence {
  let value: unknown;
  try {
    value = JSON.parse(bytes);
  } catch {
    throw new Error("invalid C5 C4 prerequisite evidence");
  }
  const parsed = c5PilotPrerequisiteEvidenceSchema.safeParse(value);
  if (
    !parsed.success ||
    serializeC5PilotPrerequisiteEvidence(parsed.data) !== bytes
  ) {
    throw new Error("invalid C5 C4 prerequisite evidence");
  }
  for (const files of [
    parsed.data.baselineRawStageEvidenceFiles,
    parsed.data.baselineStageEvidenceFiles,
  ]) {
    const paths = files.map((file) => file.path);
    if (
      paths.some((path) =>
        path.startsWith("/") ||
        path.split("/").some((segment) =>
          segment.length === 0 || segment === "." || segment === ".."
        ) ||
        basename(path) !== "stage-evidence.json"
      ) ||
      new Set(paths).size !== paths.length ||
      paths.some((path, index) =>
        index > 0 && paths[index - 1]!.localeCompare(path) >= 0
      )
    ) {
      throw new Error("invalid C5 C4 prerequisite stage evidence paths");
    }
  }
  return parsed.data;
}

function validateAcceptedBaseline(
  bytes: string,
  stageEvidenceFiles: readonly C4BaselineStageEvidenceFile[],
  rawStageEvidenceFiles: readonly C4BaselineStageEvidenceFile[],
  expectedTargets: ReturnType<typeof buildC4BaselineCeilingTargets>,
  frozenStageBindings: Awaited<ReturnType<
    typeof reconstructC4BaselineFrozenStageBindings
  >>,
): { report: C4BaselineCeilingReport; reportSha256: string } {
  let report: C4BaselineCeilingReport;
  try {
    report = JSON.parse(bytes) as C4BaselineCeilingReport;
    assertC4BaselineCeilingReportBindings(report);
    verifyC4BaselineDatasetTargets(report, expectedTargets);
  } catch {
    throw new Error("invalid accepted C4 baseline report");
  }
  if (serializeC4BaselineCeilingReport(report) !== bytes) {
    throw new Error("accepted C4 baseline report is not canonical");
  }
  if (
    report.ceilingRisk !== false ||
    report.decision !== "proceed-to-c5-pilot" ||
    report.infrastructureFailureCount !== 0 ||
    report.publicClaimEligible
  ) {
    throw new Error("accepted C4 baseline report is not eligible for C5");
  }
  verifyC4BaselineStageEvidenceFiles(
    report,
    stageEvidenceFiles,
    frozenStageBindings,
    rawStageEvidenceFiles,
  );
  return { report, reportSha256: sha256(bytes) };
}

function parseAcceptedC4Readiness(bytes: string): AcceptedC4Readiness {
  let value: unknown;
  try {
    value = JSON.parse(bytes);
  } catch {
    throw new Error("invalid accepted C4 readiness report");
  }
  const parsed = acceptedC4ReadinessSchema.safeParse(value);
  if (
    !parsed.success ||
    `${JSON.stringify(parsed.data, null, 2)}\n` !== bytes
  ) {
    throw new Error("invalid accepted C4 readiness report");
  }
  return parsed.data;
}

async function loadStageEvidenceFiles(
  root: string,
): Promise<C4BaselineStageEvidenceFile[]> {
  const absoluteRoot = resolve(root);
  const files = (await walkFiles(absoluteRoot)).filter((path) =>
    basename(path) === "stage-evidence.json"
  );
  return Promise.all(files.sort().map(async (path) => ({
    bytes: await readFile(path, "utf8"),
    path: relative(absoluteRoot, path).split("\\").join("/"),
  })));
}

async function walkFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walkFiles(path));
    } else if (entry.isFile()) {
      files.push(path);
    }
  }
  return files;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
