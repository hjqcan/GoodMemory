import { createHash } from "node:crypto";
import { resolve } from "node:path";

import { z } from "zod";

import {
  loadC6AssetLock,
  readC6StableRegularFile,
  verifyC6AssetClosure,
} from "./c6-asset-lock";
import type { C6AssetLock } from "./c6-asset-lock";

const SUPPLY_PATH = "provenance/controlled-mutation/supply.json";
const CONTROLLED_ROOT = "provenance/controlled-mutation";

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const revisionSchema = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u);
const identifierSchema = z.string()
  .min(1)
  .regex(/^[a-z0-9][a-z0-9._-]*$/u);
const spdxLicenseSchema = z.string()
  .min(1)
  .regex(/^[A-Za-z0-9][A-Za-z0-9.+-]*$/u);
const trimmedStringSchema = z.string().min(1).refine(
  (value) => value.trim() === value,
  "value cannot be whitespace-padded",
);
const relativePathSchema = trimmedStringSchema.refine(
  (value) =>
    !value.startsWith("/") &&
    !value.includes("\\") &&
    value.split("/").every((part) =>
      part.length > 0 && part !== "." && part !== ".."
    ),
  "path must be a normalized relative POSIX path without traversal",
);
const httpsUrlSchema = z.url().refine((value) => {
  const url = new URL(value);
  return (
    url.protocol === "https:" &&
    url.username.length === 0 &&
    url.password.length === 0 &&
    url.search.length === 0 &&
    url.hash.length === 0 &&
    !url.pathname.endsWith("/")
  );
}, "canonical repository URL must be HTTPS without aliases");

const artifactReferenceSchema = z.object({
  path: relativePathSchema,
  sha256: sha256Schema,
}).strict();
const controlledArtifactReference = (
  directory: string,
  message: string,
) => artifactReferenceSchema.extend({
  path: relativePathSchema.refine(
    (value) => value.startsWith(`${CONTROLLED_ROOT}/${directory}/`),
    message,
  ),
}).strict();

const sourceBundleReferenceSchema = controlledArtifactReference(
  "sources",
  "source bundles must stay under provenance/controlled-mutation/sources",
);
const licenseReferenceSchema = controlledArtifactReference(
  "licenses",
  "license evidence must stay under provenance/controlled-mutation/licenses",
);
const projectionReferenceSchema = controlledArtifactReference(
  "projections",
  "agent-visible projections must stay under provenance/controlled-mutation/projections",
);
const evaluatorFactoryReferenceSchema = controlledArtifactReference(
  "evaluator-factories",
  "evaluator factory source must stay under provenance/controlled-mutation/evaluator-factories",
);
const evaluatorReferenceSchema = controlledArtifactReference(
  "evaluators",
  "hidden evaluator artifacts must stay under provenance/controlled-mutation/evaluators",
);
const promptReferenceSchema = controlledArtifactReference(
  "prompts",
  "agent-visible prompts must stay under provenance/controlled-mutation/prompts",
);
const patchReferenceSchema = controlledArtifactReference(
  "patches",
  "mutation and gold patches must stay under provenance/controlled-mutation/patches",
);

const evaluatorFactoryIdSchema = z.literal(
  "bun-typescript-module-cases-v1",
);
const semanticContractSchema = z.object({
  behaviorId: identifierSchema,
  changedSurface: z.array(relativePathSchema).min(1),
  expectedBehavior: trimmedStringSchema,
  preservedBehavior: z.array(identifierSchema).min(1),
  schemaVersion: z.literal(1),
  targetExport: identifierSchema,
}).strict().superRefine((contract, context) => {
  addDuplicateIssues(
    contract.changedSurface,
    context,
    ["changedSurface"],
    "semantic contract repeats a changed surface",
  );
  addDuplicateIssues(
    contract.preservedBehavior,
    context,
    ["preservedBehavior"],
    "semantic contract repeats preserved behavior",
  );
});

const baseRepositorySchema = z.object({
  baseHealth: z.object({
    evaluatorFactoryId: evaluatorFactoryIdSchema,
    spec: evaluatorReferenceSchema,
  }).strict(),
  agentVisibleProjection: projectionReferenceSchema,
  baseRepositoryId: identifierSchema,
  canonicalUrl: httpsUrlSchema,
  ecosystem: trimmedStringSchema,
  language: trimmedStringSchema,
  license: z.object({
    evidence: licenseReferenceSchema,
    spdx: spdxLicenseSchema,
  }).strict(),
  repositoryFamilyId: identifierSchema,
  sourceBundle: sourceBundleReferenceSchema,
  upstreamCommit: revisionSchema,
  upstreamTree: revisionSchema,
}).strict();

const stageSchema = z.object({
  evaluators: z.object({
    failToPass: evaluatorReferenceSchema,
    passToPass: evaluatorReferenceSchema,
  }).strict(),
  goldPatch: patchReferenceSchema,
  goldTreeSha256: sha256Schema,
  mutationPatch: patchReferenceSchema,
  preparedTreeSha256: sha256Schema,
  prompt: promptReferenceSchema,
  stageId: identifierSchema,
}).strict();

const mutationFamilySchema = z.object({
  evaluatorFactory: z.object({
    id: evaluatorFactoryIdSchema,
    source: evaluatorFactoryReferenceSchema,
  }).strict(),
  mutationFamilyId: z.string().regex(/^mutation-family-[a-f0-9]{64}$/u),
  primaryStratum: z.enum([
    "open-loop-handoff",
    "validated-approach",
    "failure-avoidance",
    "user-correction",
    "project-convention",
    "stale-update",
    "irrelevant-memory-negative-control",
    "no-history-negative-control",
  ]),
  semanticContract: semanticContractSchema,
  stageCount: z.number().int().positive(),
}).strict();

const derivationSchema = z.object({
  baseRepositoryId: identifierSchema,
  decision: z.enum([
    "qualified-reserve",
    "selected",
    "semantic-duplicate",
  ]),
  episodeId: identifierSchema,
  mutationFamilyId: z.string().regex(/^mutation-family-[a-f0-9]{64}$/u),
  representativeEpisodeId: identifierSchema,
  stages: z.array(stageSchema).min(1),
  variantId: identifierSchema,
}).strict().superRefine((derivation, context) => {
  addDuplicateIssues(
    derivation.stages.map((stage) => stage.stageId),
    context,
    ["stages"],
    "derivation repeats a stage id",
  );
});

const supplySchema = z.object({
  baseRepositories: z.array(baseRepositorySchema).min(1),
  derivations: z.array(derivationSchema).min(1),
  mutationFamilies: z.array(mutationFamilySchema).min(1),
  schemaVersion: z.literal(1),
}).strict();

export type C6ControlledMutationSemanticContract = z.infer<
  typeof semanticContractSchema
>;

export interface C6ControlledMutationSupplyInput {
  assetRoot: string;
  expectedAssetLockSha256: string;
  expectedAssetRootSha256: string;
  expectedSupplySha256: string;
}

export interface C6ControlledMutationSupplyEvidence {
  assetLockSha256: string;
  assetRootSha256: string;
  baseRepositoryCount: number;
  candidateManifestFrozen: false;
  codexRunReady: false;
  controlledMutationCellByEpisodeId: Record<string, string>;
  evidenceScope:
    "controlled-mutation-supply-structure-plus-mechanical-lower-bounds";
  exactOutcomeCloneLowerBoundVerified: true;
  mutationFamilyCount: number;
  promptLeakageLowerBoundVerified: true;
  qualifiedReserveRepresentativeCount: number;
  representativeCellCount: number;
  selectedRepresentativeCount: number;
  semanticEquivalenceReviewVerified: false;
  semanticDuplicateCount: number;
  supplySha256: string;
  totalDerivationCount: number;
}

export function deriveC6ControlledMutationFamilyId(
  input: C6ControlledMutationSemanticContract,
): string {
  const contract = semanticContractSchema.parse(input);
  return `mutation-family-${sha256(JSON.stringify(contract))}`;
}

export function deriveC6ControlledMutationCellId(
  repositoryFamilyId: string,
  mutationFamilyId: string,
): string {
  const parsedRepositoryFamilyId = identifierSchema.parse(repositoryFamilyId);
  const parsedMutationFamilyId = z.string()
    .regex(/^mutation-family-[a-f0-9]{64}$/u)
    .parse(mutationFamilyId);
  return `controlled-cell-${sha256(JSON.stringify([
    parsedRepositoryFamilyId,
    parsedMutationFamilyId,
  ]))}`;
}

export async function loadC6ControlledMutationSupply(
  input: C6ControlledMutationSupplyInput,
): Promise<C6ControlledMutationSupplyEvidence> {
  return (await loadC6ControlledMutationSupplyBundle(input)).evidence;
}

export async function loadC6ControlledMutationSupplyBundle(
  input: C6ControlledMutationSupplyInput,
): Promise<{
  evidence: C6ControlledMutationSupplyEvidence;
  supply: C6ControlledMutationSupply;
}> {
  assertSha256(input.expectedAssetLockSha256, "asset-lock");
  assertSha256(input.expectedAssetRootSha256, "asset-root");
  assertSha256(input.expectedSupplySha256, "supply");

  const loadedAssetLock = await loadC6AssetLock(input.assetRoot);
  if (loadedAssetLock.assetLockSha256 !== input.expectedAssetLockSha256) {
    throw new Error("C6 controlled-mutation asset-lock SHA-256 does not match");
  }
  if (
    loadedAssetLock.assetLock.assetRootSha256 !==
      input.expectedAssetRootSha256
  ) {
    throw new Error("C6 controlled-mutation asset-root SHA-256 does not match");
  }

  const supplyBytes = await readLockedArtifact({
    assetLock: loadedAssetLock.assetLock,
    assetRoot: input.assetRoot,
    expectedSha256: input.expectedSupplySha256,
    label: "controlled-mutation supply",
    path: SUPPLY_PATH,
  });
  const supply = parseCanonicalSupply(supplyBytes);
  validateSupplyStructure(supply);
  const artifactByPath = await readAllReferencedArtifacts(
    input.assetRoot,
    loadedAssetLock.assetLock,
    supply,
  );
  assertNoExactOutcomeFamilySplit(
    supply,
  );
  assertAgentVisiblePromptsDoNotLeak(supply, artifactByPath);
  await verifyC6AssetClosure(input.assetRoot, loadedAssetLock);

  const familyById = new Map(
    supply.mutationFamilies.map((family) => [
      family.mutationFamilyId,
      family,
    ]),
  );
  const baseById = new Map(
    supply.baseRepositories.map((base) => [
      base.baseRepositoryId,
      base,
    ]),
  );
  const controlledMutationCellByEpisodeId: Record<string, string> = {};
  const derivationsByCell = new Map<
    string,
    typeof supply.derivations
  >();
  for (const derivation of supply.derivations) {
    const repositoryFamilyId =
      baseById.get(derivation.baseRepositoryId)!.repositoryFamilyId;
    const cellId = deriveC6ControlledMutationCellId(
      repositoryFamilyId,
      derivation.mutationFamilyId,
    );
    controlledMutationCellByEpisodeId[derivation.episodeId] = cellId;
    const entries = derivationsByCell.get(cellId) ?? [];
    entries.push(derivation);
    derivationsByCell.set(cellId, entries);

    const family = familyById.get(derivation.mutationFamilyId)!;
    const base = baseById.get(derivation.baseRepositoryId)!;
    if (
      derivation.stages.length !== family.stageCount ||
      base.baseHealth.evaluatorFactoryId !== family.evaluatorFactory.id
    ) {
      throw new Error(
        `C6 controlled-mutation derivation ${derivation.episodeId} does not match its family contract`,
      );
    }
  }

  for (const [cellId, derivations] of derivationsByCell) {
    validateCell(cellId, derivations);
  }

  const representatives = [...derivationsByCell.values()].map(
    (derivations) =>
      derivations.find((derivation) =>
        derivation.episodeId === derivation.representativeEpisodeId
      )!,
  );
  const evidence: C6ControlledMutationSupplyEvidence = {
    assetLockSha256: loadedAssetLock.assetLockSha256,
    assetRootSha256: loadedAssetLock.assetLock.assetRootSha256,
    baseRepositoryCount: supply.baseRepositories.length,
    candidateManifestFrozen: false,
    codexRunReady: false,
    controlledMutationCellByEpisodeId,
    evidenceScope:
      "controlled-mutation-supply-structure-plus-mechanical-lower-bounds",
    exactOutcomeCloneLowerBoundVerified: true,
    mutationFamilyCount: supply.mutationFamilies.length,
    promptLeakageLowerBoundVerified: true,
    qualifiedReserveRepresentativeCount: representatives.filter(
      (derivation) => derivation.decision === "qualified-reserve",
    ).length,
    representativeCellCount: representatives.length,
    selectedRepresentativeCount: representatives.filter(
      (derivation) => derivation.decision === "selected",
    ).length,
    semanticEquivalenceReviewVerified: false,
    semanticDuplicateCount: supply.derivations.filter(
      (derivation) => derivation.decision === "semantic-duplicate",
    ).length,
    supplySha256: sha256(supplyBytes),
    totalDerivationCount: supply.derivations.length,
  };
  return { evidence, supply };
}

export type C6ControlledMutationSupply = z.infer<typeof supplySchema>;
type Supply = C6ControlledMutationSupply;
type Derivation = C6ControlledMutationSupply["derivations"][number];

function validateSupplyStructure(
  supply: Supply,
): void {
  assertUnique(
    supply.baseRepositories.map((base) => base.baseRepositoryId),
    "C6 controlled-mutation supply repeats a base repository id",
  );
  assertUnique(
    supply.baseRepositories.map((base) => base.canonicalUrl),
    "C6 controlled-mutation supply repeats a canonical repository URL",
  );
  assertUnique(
    supply.mutationFamilies.map((family) => family.mutationFamilyId),
    "C6 controlled-mutation supply repeats a mutation family id",
  );
  assertUnique(
    supply.derivations.map((derivation) => derivation.episodeId),
    "C6 controlled-mutation supply repeats an episode id",
  );

  const baseIds = new Set(
    supply.baseRepositories.map((base) => base.baseRepositoryId),
  );
  const familyIds = new Set<string>();
  for (const family of supply.mutationFamilies) {
    const derived = deriveC6ControlledMutationFamilyId(
      family.semanticContract,
    );
    if (family.mutationFamilyId !== derived) {
      throw new Error(
        "C6 controlled-mutation mutation family id is not derived from its semantic contract",
      );
    }
    familyIds.add(family.mutationFamilyId);
  }

  const usedBaseIds = new Set<string>();
  const usedFamilyIds = new Set<string>();
  const variants = new Set<string>();
  for (const derivation of supply.derivations) {
    if (!baseIds.has(derivation.baseRepositoryId)) {
      throw new Error(
        `C6 controlled-mutation derivation ${derivation.episodeId} references an unknown base repository`,
      );
    }
    if (!familyIds.has(derivation.mutationFamilyId)) {
      throw new Error(
        `C6 controlled-mutation derivation ${derivation.episodeId} references an unknown mutation family`,
      );
    }
    const variantKey = JSON.stringify([
      derivation.baseRepositoryId,
      derivation.mutationFamilyId,
      derivation.variantId,
    ]);
    if (variants.has(variantKey)) {
      throw new Error(
        "C6 controlled-mutation supply repeats a variant within one base/family pair",
      );
    }
    variants.add(variantKey);
    usedBaseIds.add(derivation.baseRepositoryId);
    usedFamilyIds.add(derivation.mutationFamilyId);
  }
  if (
    usedBaseIds.size !== baseIds.size ||
    usedFamilyIds.size !== familyIds.size
  ) {
    throw new Error(
      "C6 controlled-mutation supply contains an unused base repository or mutation family",
    );
  }
}

function validateCell(
  cellId: string,
  derivations: readonly Derivation[],
): void {
  const representativeIds = new Set(
    derivations.map((derivation) => derivation.representativeEpisodeId),
  );
  if (representativeIds.size !== 1) {
    throw new Error(
      `C6 controlled-mutation cell declares multiple representatives: ${cellId}`,
    );
  }
  const representativeId = [...representativeIds][0]!;
  const representative = derivations.find(
    (derivation) => derivation.episodeId === representativeId,
  );
  if (representative === undefined) {
    throw new Error(
      `C6 controlled-mutation cell representative is not a cell member: ${cellId}`,
    );
  }
  if (
    representative.decision !== "selected" &&
    representative.decision !== "qualified-reserve"
  ) {
    throw new Error(
      "C6 controlled-mutation cell representative must be selected or qualified-reserve",
    );
  }
  for (const derivation of derivations) {
    if (
      derivation.episodeId !== representativeId &&
      derivation.decision !== "semantic-duplicate"
    ) {
      throw new Error(
        "C6 controlled-mutation non-representative derivation must be semantic-duplicate",
      );
    }
  }
}

async function readAllReferencedArtifacts(
  assetRoot: string,
  assetLock: C6AssetLock,
  supply: Supply,
): Promise<ReadonlyMap<string, string>> {
  const references: Array<{
    label: string;
    reference: z.infer<typeof artifactReferenceSchema>;
  }> = [];
  for (const base of supply.baseRepositories) {
    references.push(
      {
        label: `${base.baseRepositoryId} source bundle`,
        reference: base.sourceBundle,
      },
      {
        label: `${base.baseRepositoryId} license evidence`,
        reference: base.license.evidence,
      },
      {
        label: `${base.baseRepositoryId} base-health evaluator`,
        reference: base.baseHealth.spec,
      },
      {
        label: `${base.baseRepositoryId} agent-visible projection`,
        reference: base.agentVisibleProjection,
      },
    );
  }
  for (const family of supply.mutationFamilies) {
    references.push({
      label: `${family.mutationFamilyId} evaluator factory`,
      reference: family.evaluatorFactory.source,
    });
  }
  for (const derivation of supply.derivations) {
    for (const stage of derivation.stages) {
      references.push(
        {
          label: `${derivation.episodeId}/${stage.stageId} prompt`,
          reference: stage.prompt,
        },
        {
          label: `${derivation.episodeId}/${stage.stageId} mutation patch`,
          reference: stage.mutationPatch,
        },
        {
          label: `${derivation.episodeId}/${stage.stageId} gold patch`,
          reference: stage.goldPatch,
        },
        {
          label: `${derivation.episodeId}/${stage.stageId} fail-to-pass evaluator`,
          reference: stage.evaluators.failToPass,
        },
        {
          label: `${derivation.episodeId}/${stage.stageId} pass-to-pass evaluator`,
          reference: stage.evaluators.passToPass,
        },
      );
    }
  }
  const artifacts = await Promise.all(
    references.map(({ label, reference }) =>
      readLockedArtifact({
        assetLock,
        assetRoot,
        expectedSha256: reference.sha256,
        label,
        path: reference.path,
      })
    ),
  );
  return new Map(references.map(({ reference }, index) => [
    reference.path,
    artifacts[index]!,
  ]));
}

function assertNoExactOutcomeFamilySplit(
  supply: Supply,
): void {
  const familyById = new Map(
    supply.mutationFamilies.map((family) => [
      family.mutationFamilyId,
      family,
    ]),
  );
  const baseById = new Map(
    supply.baseRepositories.map((base) => [
      base.baseRepositoryId,
      base,
    ]),
  );
  const familyByOutcome = new Map<string, string>();
  for (const derivation of supply.derivations) {
    const family = familyById.get(derivation.mutationFamilyId)!;
    const outcomeKey = JSON.stringify([
      baseById.get(derivation.baseRepositoryId)!.repositoryFamilyId,
      family.evaluatorFactory.id,
      family.evaluatorFactory.source.sha256,
      derivation.stages.map((stage) => [
        stage.evaluators.failToPass.sha256,
        stage.evaluators.passToPass.sha256,
        stage.goldTreeSha256,
      ]),
    ]);
    const existingFamilyId = familyByOutcome.get(outcomeKey);
    if (
      existingFamilyId !== undefined &&
      existingFamilyId !== derivation.mutationFamilyId
    ) {
      throw new Error(
        "C6 controlled-mutation exact evaluator and gold outcome clone is split across semantic families",
      );
    }
    familyByOutcome.set(outcomeKey, derivation.mutationFamilyId);
  }
}

function assertAgentVisiblePromptsDoNotLeak(
  supply: Supply,
  artifactByPath: ReadonlyMap<string, string>,
): void {
  const hiddenArtifacts = [
    ...supply.baseRepositories.map((base) =>
      artifactByPath.get(base.baseHealth.spec.path)!
    ),
    ...supply.derivations.flatMap((derivation) =>
      derivation.stages.flatMap((stage) => [
        artifactByPath.get(stage.goldPatch.path)!,
        artifactByPath.get(stage.evaluators.failToPass.path)!,
        artifactByPath.get(stage.evaluators.passToPass.path)!,
      ])
    ),
  ];
  for (const derivation of supply.derivations) {
    for (const stage of derivation.stages) {
      const prompt = artifactByPath.get(stage.prompt.path)!;
      const normalizedPrompt = normalizeLeakageText(prompt);
      if (
        hiddenArtifacts.some((artifact) =>
          hiddenArtifactFragments(artifact).some((fragment) =>
            normalizedPrompt.includes(normalizeLeakageText(fragment))
          )
        )
      ) {
        throw new Error(
          `C6 controlled-mutation agent-visible prompt leaks hidden artifact for ${derivation.episodeId}/${stage.stageId}`,
        );
      }
    }
  }
}

function hiddenArtifactFragments(content: string): string[] {
  return [...new Set([
    content.trim(),
    ...content.split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) =>
        line.length >= 8 && /[\p{L}\p{N}_]/u.test(line)
      ),
  ].filter((fragment) => fragment.length > 0))];
}

function normalizeLeakageText(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/\s+/gu, " ").trim();
}

async function readLockedArtifact(input: {
  assetLock: C6AssetLock;
  assetRoot: string;
  expectedSha256: string;
  label: string;
  path: string;
}): Promise<string> {
  const lockEntry = input.assetLock.files.find(
    (file) => file.path === input.path,
  );
  if (
    lockEntry === undefined ||
    lockEntry.sha256 !== input.expectedSha256
  ) {
    throw new Error(
      `C6 controlled-mutation ${input.label} does not match asset lock`,
    );
  }
  const bytes = await readC6StableRegularFile(
    resolve(input.assetRoot, input.path),
    `controlled-mutation ${input.label}`,
  );
  if (
    bytes.byteLength !== lockEntry.bytes ||
    sha256(bytes) !== input.expectedSha256
  ) {
    throw new Error(
      `C6 controlled-mutation ${input.label} bytes do not match`,
    );
  }
  return bytes.toString("utf8");
}

function parseCanonicalSupply(bytes: string): Supply {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(bytes);
  } catch {
    throw new Error("invalid C6 controlled-mutation supply JSON");
  }
  const parsed = supplySchema.safeParse(parsedJson);
  if (!parsed.success) {
    throw new Error(
      `invalid C6 controlled-mutation supply: ${parsed.error.message}`,
    );
  }
  if (`${JSON.stringify(parsed.data, null, 2)}\n` !== bytes) {
    throw new Error("C6 controlled-mutation supply is not canonical JSON");
  }
  return parsed.data;
}

function addDuplicateIssues(
  values: readonly string[],
  context: z.RefinementCtx,
  path: Array<string | number>,
  message: string,
): void {
  const seen = new Set<string>();
  for (const [index, value] of values.entries()) {
    if (seen.has(value)) {
      context.addIssue({
        code: "custom",
        message,
        path: [...path, index],
      });
    }
    seen.add(value);
  }
}

function assertUnique(values: readonly string[], message: string): void {
  if (new Set(values).size !== values.length) {
    throw new Error(message);
  }
}

function assertSha256(value: string, label: string): void {
  if (!sha256Schema.safeParse(value).success) {
    throw new Error(`C6 controlled-mutation ${label} SHA-256 is invalid`);
  }
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
