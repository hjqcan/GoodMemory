import { createHash } from "node:crypto";
import { join } from "node:path";

import { z } from "zod";

import {
  assertC6NoSymlinkPathComponents,
  loadC6AssetLock,
  readC6StableRegularFile,
  verifyC6AssetClosure,
} from "./c6-asset-lock";
import type {
  C6AssetLock,
} from "./c6-asset-lock";

const EVIDENCE_ROOT = "provenance/repository-design";
const DESIGN_PATH = `${EVIDENCE_ROOT}/design-power.json`;
const LINEAGE_PATH = `${EVIDENCE_ROOT}/repository-lineage.json`;
const POWER_INPUT_PATH = `${EVIDENCE_ROOT}/power-input.json`;
const REVIEW_RECEIPT_PATH = `${EVIDENCE_ROOT}/review-receipt.json`;
const REVIEW_INPUT_PATH = `${EVIDENCE_ROOT}/review/input.json`;
const REVIEW_REQUEST_PATH = `${EVIDENCE_ROOT}/review/request.json`;
const REVIEW_DISPATCH_PATH = `${EVIDENCE_ROOT}/review/dispatch.json`;
const REVIEW_RESPONSE_PATH = `${EVIDENCE_ROOT}/review/response.json`;
const NORMAL_TWO_SIDED_95_Z = 1.959963984540054;
const NORMAL_POWER_80_Z = 0.8416212335729143;

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const trimmedStringSchema = z.string().min(1).refine(
  (value) => value.trim() === value,
  "value cannot be whitespace-padded",
);
const identifierSchema = trimmedStringSchema.regex(
  /^[a-z0-9][a-z0-9._-]*$/u,
);
const artifactReference = (path: string) => z.object({
  path: z.literal(path),
  sha256: sha256Schema,
}).strict();

const repositoryLineageSchema = z.object({
  datasetSha256: sha256Schema,
  repositories: z.array(z.object({
    canonicalUrl: trimmedStringSchema,
    familyId: identifierSchema,
    rawUrl: trimmedStringSchema,
    relation: z.enum([
      "direct",
      "rename",
      "redirect",
      "fork",
      "controlled-variant",
    ]),
    upstreamIdentity: trimmedStringSchema,
  }).strict()).min(1),
  schemaVersion: z.literal(1),
}).strict();

const powerInputSchema = z.object({
  algorithm: z.literal(
    "repository-mean-normal-power-and-precision-v1",
  ),
  alpha: z.literal(0.05),
  confidenceLevel: z.literal(0.95),
  maximumHalfWidth: z.number().positive().max(1),
  minimumDetectableEffect: z.number().positive().max(1),
  minimumRepositoryFamilies: z.number().int().min(2),
  planningRepositoryStandardDeviation: z.number().positive().max(1),
  power: z.literal(0.8),
  schemaVersion: z.literal(1),
}).strict();

const designPowerSchema = z.object({
  author: trimmedStringSchema,
  createdAt: z.iso.datetime(),
  datasetEpisodeCount: z.number().int().positive(),
  datasetSha256: sha256Schema,
  episodeFamilyBindingSha256: sha256Schema,
  groupingPolicy: z.literal(
    "canonical-upstream-repository-family-v1",
  ),
  powerInputArtifactSha256: sha256Schema,
  powerRequiredRepositoryFamilies: z.number().int().positive(),
  precisionRequiredRepositoryFamilies: z.number().int().positive(),
  repositoryFamilyAllocationSha256: sha256Schema,
  requiredRepositoryFamilies: z.number().int().min(2),
  schemaVersion: z.literal(1),
}).strict();

const reviewInputSchema = z.object({
  datasetSha256: sha256Schema,
  designPowerArtifactSha256: sha256Schema,
  powerInputArtifactSha256: sha256Schema,
  repositoryLineageArtifactSha256: sha256Schema,
  schemaVersion: z.literal(1),
}).strict();

const reviewRequestSchema = z.object({
  declaredOutcomeAccess: z.literal("prohibited"),
  inputSha256: sha256Schema,
  schemaVersion: z.literal(1),
  task: z.literal("repository-design-review"),
}).strict();

const reviewDispatchSchema = z.object({
  author: trimmedStringSchema,
  inputSha256: sha256Schema,
  requestSha256: sha256Schema,
  reviewer: trimmedStringSchema,
  schemaVersion: z.literal(1),
}).strict();

const reviewResponseSchema = z.object({
  decision: z.literal("accepted"),
  designPowerArtifactSha256: sha256Schema,
  inputSha256: sha256Schema,
  requestSha256: sha256Schema,
  reviewedAt: z.iso.datetime(),
  reviewer: trimmedStringSchema,
  schemaVersion: z.literal(1),
}).strict();

const reviewReceiptSchema = z.object({
  author: trimmedStringSchema,
  decision: z.literal("accepted"),
  designPowerArtifactSha256: sha256Schema,
  provenance: z.object({
    dispatch: artifactReference(REVIEW_DISPATCH_PATH),
    input: artifactReference(REVIEW_INPUT_PATH),
    request: artifactReference(REVIEW_REQUEST_PATH),
    response: artifactReference(REVIEW_RESPONSE_PATH),
  }).strict(),
  powerInputArtifactSha256: sha256Schema,
  repositoryLineageArtifactSha256: sha256Schema,
  reviewedAt: z.iso.datetime(),
  reviewer: trimmedStringSchema,
  schemaVersion: z.literal(1),
}).strict();

export interface C6RepositoryDesignDataset {
  episodes: ReadonlyArray<{
    id: string;
    repository: {
      url: string;
    };
  }>;
}

export interface C6RepositoryDesignEvidenceInput {
  assetRoot: string;
  dataset: C6RepositoryDesignDataset;
  datasetSha256: string;
  expectedAssetLockSha256: string;
  expectedAssetRootSha256: string;
  expectedDesignPowerArtifactSha256: string;
  expectedPowerInputArtifactSha256: string;
  expectedRepositoryLineageArtifactSha256: string;
  expectedReviewReceiptSha256: string;
}

export interface C6RepositoryDesignEvidence {
  actualRepositoryFamilies: number;
  algorithm: "repository-mean-normal-power-and-precision-v1";
  alpha: 0.05;
  allocation: {
    allocationSha256: string;
    episodeCountByFamily: Record<string, number>;
    episodes: number;
    repositoryFamilies: number;
  };
  confidenceLevel: 0.95;
  createdAt: string;
  cryptographicAuthenticity: false;
  datasetSha256: string;
  declaredOutcomeAccess: "prohibited";
  designPowerArtifactSha256: string;
  effectiveRepositoryFamilies: number;
  episodeFamilyBindingSha256: string;
  groupingPolicy: "canonical-upstream-repository-family-v1";
  maximumHalfWidth: number;
  minimumDetectableEffect: number;
  minimumRepositoryFamilies: number;
  planningRepositoryStandardDeviation: number;
  power: 0.8;
  powerInputArtifactSha256: string;
  powerRequiredRepositoryFamilies: number;
  precisionRequiredRepositoryFamilies: number;
  repositoryFamilyByEpisodeId: Record<string, string>;
  repositoryLineageArtifactSha256: string;
  requiredRepositoryFamilies: number;
  reviewReceiptSha256: string;
  reviewReceiptStatus: "review-receipt-structure-verified";
  reviewedAt: string;
}

export async function loadC6RepositoryDesignEvidence(
  input: C6RepositoryDesignEvidenceInput,
): Promise<C6RepositoryDesignEvidence> {
  assertSha256(input.datasetSha256, "dataset");
  assertSha256(input.expectedAssetLockSha256, "asset-lock");
  assertSha256(input.expectedAssetRootSha256, "asset-root");
  assertSha256(
    input.expectedDesignPowerArtifactSha256,
    "design-power artifact",
  );
  assertSha256(
    input.expectedPowerInputArtifactSha256,
    "power-input artifact",
  );
  assertSha256(
    input.expectedRepositoryLineageArtifactSha256,
    "repository-lineage artifact",
  );
  assertSha256(
    input.expectedReviewReceiptSha256,
    "review receipt",
  );

  const loadedAssetLock = await loadC6AssetLock(input.assetRoot);
  if (loadedAssetLock.assetLockSha256 !== input.expectedAssetLockSha256) {
    throw new Error("C6 asset-lock SHA-256 does not match external pin");
  }
  if (
    loadedAssetLock.assetLock.assetRootSha256 !==
      input.expectedAssetRootSha256
  ) {
    throw new Error("C6 asset-root SHA-256 does not match external pin");
  }

  const lineageArtifact = await readCanonicalLockedArtifact({
    assetLock: loadedAssetLock.assetLock,
    assetRoot: input.assetRoot,
    expectedSha256: input.expectedRepositoryLineageArtifactSha256,
    label: "repository-lineage artifact",
    path: LINEAGE_PATH,
    schema: repositoryLineageSchema,
  });
  const powerInputArtifact = await readCanonicalLockedArtifact({
    assetLock: loadedAssetLock.assetLock,
    assetRoot: input.assetRoot,
    expectedSha256: input.expectedPowerInputArtifactSha256,
    label: "power-input artifact",
    path: POWER_INPUT_PATH,
    schema: powerInputSchema,
  });
  const designArtifact = await readCanonicalLockedArtifact({
    assetLock: loadedAssetLock.assetLock,
    assetRoot: input.assetRoot,
    expectedSha256: input.expectedDesignPowerArtifactSha256,
    label: "design-power artifact",
    path: DESIGN_PATH,
    schema: designPowerSchema,
  });
  const reviewReceipt = await readCanonicalLockedArtifact({
    assetLock: loadedAssetLock.assetLock,
    assetRoot: input.assetRoot,
    expectedSha256: input.expectedReviewReceiptSha256,
    label: "review receipt",
    path: REVIEW_RECEIPT_PATH,
    schema: reviewReceiptSchema,
  });

  if (lineageArtifact.value.datasetSha256 !== input.datasetSha256) {
    throw new Error(
      "C6 repository-lineage artifact does not bind the dataset",
    );
  }
  const familyByEpisode = deriveEpisodeFamilies(
    input.dataset,
    lineageArtifact.value.repositories,
  );
  const bindingSha256 = buildEpisodeFamilyBindingSha256(familyByEpisode);
  const allocation = buildRepositoryFamilyAllocation(familyByEpisode);
  const effectiveRepositoryFamilies =
    calculateEffectiveRepositoryFamilies(
      allocation.episodes,
      allocation.episodeCountByFamily,
    );
  const computedDesign = computeRepositoryDesign(powerInputArtifact.value);

  if (designArtifact.value.datasetSha256 !== input.datasetSha256) {
    throw new Error("C6 design-power artifact does not bind the dataset");
  }
  if (
    designArtifact.value.powerInputArtifactSha256 !==
      powerInputArtifact.sha256
  ) {
    throw new Error(
      "C6 design-power artifact does not bind the power-input artifact",
    );
  }
  if (
    designArtifact.value.datasetEpisodeCount !==
      input.dataset.episodes.length
  ) {
    throw new Error(
      "C6 design-power artifact dataset episode count does not match",
    );
  }
  if (
    designArtifact.value.episodeFamilyBindingSha256 !== bindingSha256
  ) {
    throw new Error(
      "C6 design-power artifact episode-family binding does not match lineage",
    );
  }
  if (
    designArtifact.value.repositoryFamilyAllocationSha256 !==
      allocation.allocationSha256
  ) {
    throw new Error(
      "C6 design-power artifact repository allocation does not match lineage",
    );
  }
  if (
    designArtifact.value.powerRequiredRepositoryFamilies !==
      computedDesign.powerRequiredRepositoryFamilies
  ) {
    throw new Error(
      "C6 design-power artifact power-required repository family count " +
        "does not match power input",
    );
  }
  if (
    designArtifact.value.precisionRequiredRepositoryFamilies !==
      computedDesign.precisionRequiredRepositoryFamilies
  ) {
    throw new Error(
      "C6 design-power artifact precision-required repository family count " +
        "does not match power input",
    );
  }
  if (
    designArtifact.value.requiredRepositoryFamilies !==
      computedDesign.requiredRepositoryFamilies
  ) {
    throw new Error(
      "C6 design-power artifact required repository family count " +
        "does not match power input",
    );
  }
  if (
    allocation.repositoryFamilies <
      computedDesign.requiredRepositoryFamilies
  ) {
    throw new Error(
      `C6 dataset has ${allocation.repositoryFamilies} raw repository ` +
        `families but design requires ${
          computedDesign.requiredRepositoryFamilies
        }`,
    );
  }
  if (
    effectiveRepositoryFamilies <
      computedDesign.requiredRepositoryFamilies
  ) {
    throw new Error(
      `C6 dataset has ${effectiveRepositoryFamilies} effective repository ` +
        `families but design requires ${
          computedDesign.requiredRepositoryFamilies
        }`,
    );
  }

  if (
    reviewReceipt.value.designPowerArtifactSha256 !==
      designArtifact.sha256
  ) {
    throw new Error(
      "C6 review receipt does not bind the design-power artifact",
    );
  }
  if (
    reviewReceipt.value.powerInputArtifactSha256 !==
      powerInputArtifact.sha256
  ) {
    throw new Error(
      "C6 review receipt does not bind the power-input artifact",
    );
  }
  if (
    reviewReceipt.value.repositoryLineageArtifactSha256 !==
      lineageArtifact.sha256
  ) {
    throw new Error(
      "C6 review receipt does not bind the repository-lineage artifact",
    );
  }
  if (reviewReceipt.value.author === reviewReceipt.value.reviewer) {
    throw new Error("C6 repository design reviewer must differ from author");
  }
  if (reviewReceipt.value.author !== designArtifact.value.author) {
    throw new Error("C6 review receipt author does not match design author");
  }

  const [
    reviewInput,
    reviewRequest,
    reviewDispatch,
    reviewResponse,
  ] = await Promise.all([
    readCanonicalLockedArtifact({
      assetLock: loadedAssetLock.assetLock,
      assetRoot: input.assetRoot,
      expectedSha256: reviewReceipt.value.provenance.input.sha256,
      label: "review input",
      path: reviewReceipt.value.provenance.input.path,
      schema: reviewInputSchema,
    }),
    readCanonicalLockedArtifact({
      assetLock: loadedAssetLock.assetLock,
      assetRoot: input.assetRoot,
      expectedSha256: reviewReceipt.value.provenance.request.sha256,
      label: "review request",
      path: reviewReceipt.value.provenance.request.path,
      schema: reviewRequestSchema,
    }),
    readCanonicalLockedArtifact({
      assetLock: loadedAssetLock.assetLock,
      assetRoot: input.assetRoot,
      expectedSha256: reviewReceipt.value.provenance.dispatch.sha256,
      label: "review dispatch",
      path: reviewReceipt.value.provenance.dispatch.path,
      schema: reviewDispatchSchema,
    }),
    readCanonicalLockedArtifact({
      assetLock: loadedAssetLock.assetLock,
      assetRoot: input.assetRoot,
      expectedSha256: reviewReceipt.value.provenance.response.sha256,
      label: "review response",
      path: reviewReceipt.value.provenance.response.path,
      schema: reviewResponseSchema,
    }),
  ]);

  validateReviewChain({
    design: designArtifact.value,
    designSha256: designArtifact.sha256,
    dispatch: reviewDispatch.value,
    input: reviewInput.value,
    inputSha256: reviewInput.sha256,
    lineageSha256: lineageArtifact.sha256,
    powerInputSha256: powerInputArtifact.sha256,
    receipt: reviewReceipt.value,
    request: reviewRequest.value,
    requestSha256: reviewRequest.sha256,
    response: reviewResponse.value,
  });

  await verifyC6AssetClosure(input.assetRoot, loadedAssetLock);

  return {
    actualRepositoryFamilies: allocation.repositoryFamilies,
    algorithm: powerInputArtifact.value.algorithm,
    alpha: powerInputArtifact.value.alpha,
    allocation,
    confidenceLevel: powerInputArtifact.value.confidenceLevel,
    createdAt: designArtifact.value.createdAt,
    cryptographicAuthenticity: false,
    datasetSha256: input.datasetSha256,
    declaredOutcomeAccess: reviewRequest.value.declaredOutcomeAccess,
    designPowerArtifactSha256: designArtifact.sha256,
    effectiveRepositoryFamilies,
    episodeFamilyBindingSha256: bindingSha256,
    groupingPolicy: designArtifact.value.groupingPolicy,
    maximumHalfWidth: powerInputArtifact.value.maximumHalfWidth,
    minimumDetectableEffect:
      powerInputArtifact.value.minimumDetectableEffect,
    minimumRepositoryFamilies:
      powerInputArtifact.value.minimumRepositoryFamilies,
    planningRepositoryStandardDeviation:
      powerInputArtifact.value.planningRepositoryStandardDeviation,
    power: powerInputArtifact.value.power,
    powerInputArtifactSha256: powerInputArtifact.sha256,
    powerRequiredRepositoryFamilies:
      computedDesign.powerRequiredRepositoryFamilies,
    precisionRequiredRepositoryFamilies:
      computedDesign.precisionRequiredRepositoryFamilies,
    repositoryFamilyByEpisodeId: familyByEpisode,
    repositoryLineageArtifactSha256: lineageArtifact.sha256,
    requiredRepositoryFamilies: computedDesign.requiredRepositoryFamilies,
    reviewReceiptSha256: reviewReceipt.sha256,
    reviewReceiptStatus: "review-receipt-structure-verified",
    reviewedAt: reviewReceipt.value.reviewedAt,
  };
}

function deriveEpisodeFamilies(
  dataset: C6RepositoryDesignDataset,
  repositories: z.infer<typeof repositoryLineageSchema>["repositories"],
): Record<string, string> {
  const lineageByRawUrl = new Map<string, {
    familyId: string;
    normalizedCanonicalUrl: string;
    upstreamIdentity: string;
  }>();
  const familyByUpstreamIdentity = new Map<string, string>();
  const upstreamIdentityByCanonicalUrl = new Map<string, string>();
  const familyByCanonicalUrl = new Map<string, string>();
  const upstreamIdentityByFamily = new Map<string, string>();

  for (const repository of repositories) {
    const normalizedRawUrl = normalizeRepositoryUrl(repository.rawUrl);
    const normalizedCanonicalUrl = normalizeRepositoryUrl(
      repository.canonicalUrl,
    );
    if (
      repository.relation === "direct" &&
      normalizedRawUrl !== normalizedCanonicalUrl
    ) {
      throw new Error(
        "C6 direct relation requires matching normalized repository URLs",
      );
    }
    if (lineageByRawUrl.has(normalizedRawUrl)) {
      throw new Error(
        "C6 normalized raw repository alias is ambiguous",
      );
    }

    assertStableMapping(
      familyByUpstreamIdentity,
      repository.upstreamIdentity,
      repository.familyId,
      "C6 upstream identity is split across families",
    );
    assertStableMapping(
      familyByCanonicalUrl,
      normalizedCanonicalUrl,
      repository.familyId,
      "C6 canonical repository is split across families",
    );
    assertStableMapping(
      upstreamIdentityByCanonicalUrl,
      normalizedCanonicalUrl,
      repository.upstreamIdentity,
      "C6 canonical repository maps to multiple upstream identities",
    );
    assertStableMapping(
      upstreamIdentityByFamily,
      repository.familyId,
      repository.upstreamIdentity,
      "C6 repository family maps to multiple upstream identities",
    );
    lineageByRawUrl.set(normalizedRawUrl, {
      familyId: repository.familyId,
      normalizedCanonicalUrl,
      upstreamIdentity: repository.upstreamIdentity,
    });
  }

  const familyByEpisode: Record<string, string> = {};
  for (const episode of dataset.episodes) {
    if (familyByEpisode[episode.id] !== undefined) {
      throw new Error(`C6 dataset repeats episode ${episode.id}`);
    }
    const repository = lineageByRawUrl.get(
      normalizeRepositoryUrl(episode.repository.url),
    );
    if (repository === undefined) {
      throw new Error(
        `C6 repository lineage does not cover dataset repository ` +
          `${episode.repository.url}`,
      );
    }
    familyByEpisode[episode.id] = repository.familyId;
  }
  return Object.fromEntries(
    Object.entries(familyByEpisode)
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

function buildEpisodeFamilyBindingSha256(
  familyByEpisode: Readonly<Record<string, string>>,
): string {
  return sha256(serializeCanonical(
    Object.entries(familyByEpisode)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([episodeId, familyId]) => ({ episodeId, familyId })),
  ));
}

function buildRepositoryFamilyAllocation(
  familyByEpisode: Readonly<Record<string, string>>,
): C6RepositoryDesignEvidence["allocation"] {
  const episodesByFamily = new Map<string, string[]>();
  for (const [episodeId, familyId] of Object.entries(familyByEpisode)) {
    const episodeIds = episodesByFamily.get(familyId) ?? [];
    episodeIds.push(episodeId);
    episodesByFamily.set(familyId, episodeIds);
  }
  const allocationRows = [...episodesByFamily.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([familyId, episodeIds]) => ({
      episodeIds: episodeIds.sort(),
      familyId,
    }));
  return {
    allocationSha256: sha256(serializeCanonical(allocationRows)),
    episodeCountByFamily: Object.fromEntries(
      allocationRows.map((row) => [row.familyId, row.episodeIds.length]),
    ),
    episodes: Object.keys(familyByEpisode).length,
    repositoryFamilies: allocationRows.length,
  };
}

function calculateEffectiveRepositoryFamilies(
  episodes: number,
  episodeCountByFamily: Readonly<Record<string, number>>,
): number {
  const sumOfSquaredCounts = Object.values(episodeCountByFamily).reduce(
    (sum, count) => sum + count ** 2,
    0,
  );
  return episodes ** 2 / sumOfSquaredCounts;
}

function computeRepositoryDesign(
  input: z.infer<typeof powerInputSchema>,
): {
  powerRequiredRepositoryFamilies: number;
  precisionRequiredRepositoryFamilies: number;
  requiredRepositoryFamilies: number;
} {
  const powerRequiredRepositoryFamilies = Math.ceil((
    (
      (NORMAL_TWO_SIDED_95_Z + NORMAL_POWER_80_Z) *
      input.planningRepositoryStandardDeviation
    ) /
    input.minimumDetectableEffect
  ) ** 2);
  const precisionRequiredRepositoryFamilies = Math.ceil((
    (
      NORMAL_TWO_SIDED_95_Z *
      input.planningRepositoryStandardDeviation
    ) /
    input.maximumHalfWidth
  ) ** 2);
  return {
    powerRequiredRepositoryFamilies,
    precisionRequiredRepositoryFamilies,
    requiredRepositoryFamilies: Math.max(
      input.minimumRepositoryFamilies,
      powerRequiredRepositoryFamilies,
      precisionRequiredRepositoryFamilies,
    ),
  };
}

function validateReviewChain(input: {
  design: z.infer<typeof designPowerSchema>;
  designSha256: string;
  dispatch: z.infer<typeof reviewDispatchSchema>;
  input: z.infer<typeof reviewInputSchema>;
  inputSha256: string;
  lineageSha256: string;
  powerInputSha256: string;
  receipt: z.infer<typeof reviewReceiptSchema>;
  request: z.infer<typeof reviewRequestSchema>;
  requestSha256: string;
  response: z.infer<typeof reviewResponseSchema>;
}): void {
  if (
    input.input.datasetSha256 !== input.design.datasetSha256 ||
    input.input.designPowerArtifactSha256 !== input.designSha256 ||
    input.input.repositoryLineageArtifactSha256 !== input.lineageSha256 ||
    input.input.powerInputArtifactSha256 !== input.powerInputSha256
  ) {
    throw new Error("C6 review input does not bind the frozen design inputs");
  }
  if (input.request.inputSha256 !== input.inputSha256) {
    throw new Error("C6 review request does not bind the review input");
  }
  if (
    input.dispatch.inputSha256 !== input.inputSha256 ||
    input.dispatch.requestSha256 !== input.requestSha256
  ) {
    throw new Error("C6 review dispatch does not bind input and request");
  }
  if (
    input.dispatch.author !== input.receipt.author ||
    input.dispatch.reviewer !== input.receipt.reviewer
  ) {
    throw new Error("C6 review dispatch identities do not match receipt");
  }
  if (input.response.requestSha256 !== input.requestSha256) {
    throw new Error("C6 review response does not bind the request");
  }
  if (
    input.response.inputSha256 !== input.inputSha256 ||
    input.response.designPowerArtifactSha256 !== input.designSha256
  ) {
    throw new Error("C6 review response does not bind input and design");
  }
  if (
    input.response.reviewer !== input.receipt.reviewer ||
    input.response.reviewedAt !== input.receipt.reviewedAt
  ) {
    throw new Error("C6 review response does not match receipt");
  }
  if (
    Date.parse(input.receipt.reviewedAt) <
      Date.parse(input.design.createdAt)
  ) {
    throw new Error("C6 review predates the repository design");
  }
}

async function readCanonicalLockedArtifact<T>(input: {
  assetLock: C6AssetLock;
  assetRoot: string;
  expectedSha256: string;
  label: string;
  path: string;
  schema: z.ZodType<T>;
}): Promise<{ sha256: string; value: T }> {
  const lockedFile = input.assetLock.files.find(
    (file) => file.path === input.path,
  );
  if (lockedFile === undefined) {
    throw new Error(`C6 asset lock does not contain ${input.label}`);
  }
  if (lockedFile.sha256 !== input.expectedSha256) {
    throw new Error(
      `C6 ${input.label} SHA-256 does not match external pin`,
    );
  }
  const absolutePath = join(input.assetRoot, input.path);
  await assertC6NoSymlinkPathComponents(
    absolutePath,
    `C6 ${input.label}`,
  );
  const bytes = await readC6StableRegularFile(
    absolutePath,
    input.label,
  );
  const actualSha256 = sha256(bytes);
  if (
    actualSha256 !== input.expectedSha256 ||
    bytes.byteLength !== lockedFile.bytes
  ) {
    throw new Error(`C6 ${input.label} does not match asset lock`);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(bytes.toString("utf8")) as unknown;
  } catch {
    throw new Error(`C6 ${input.label} is not valid JSON`);
  }
  const parsed = input.schema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `invalid C6 ${input.label}: ${parsed.error.message}`,
    );
  }
  if (bytes.toString("utf8") !== serializeCanonical(parsed.data)) {
    throw new Error(`C6 ${input.label} must be canonical JSON`);
  }
  return {
    sha256: actualSha256,
    value: parsed.data,
  };
}

function normalizeRepositoryUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`C6 repository URL is invalid: ${value}`);
  }
  if (
    (url.protocol !== "https:" && url.protocol !== "http:") ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.search.length > 0 ||
    url.hash.length > 0
  ) {
    throw new Error(`C6 repository URL is not canonicalizable: ${value}`);
  }
  let pathname = url.pathname.replace(/\/+$/u, "");
  pathname = pathname.replace(/\.git$/iu, "");
  if (pathname.length === 0) {
    throw new Error(`C6 repository URL lacks a repository path: ${value}`);
  }
  return `${url.protocol.toLowerCase()}//${url.host.toLowerCase()}${pathname}`;
}

function assertStableMapping(
  map: Map<string, string>,
  key: string,
  value: string,
  message: string,
): void {
  const prior = map.get(key);
  if (prior !== undefined && prior !== value) {
    throw new Error(message);
  }
  map.set(key, value);
}

function serializeCanonical(value: unknown): string {
  return `${JSON.stringify(sortJson(value), null, 2)}\n`;
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, sortJson(entry)]),
    );
  }
  return value;
}

function assertSha256(value: string, label: string): void {
  if (!/^[a-f0-9]{64}$/u.test(value)) {
    throw new Error(`C6 ${label} SHA-256 pin is invalid`);
  }
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
