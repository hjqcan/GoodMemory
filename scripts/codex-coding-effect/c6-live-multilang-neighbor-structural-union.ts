import { createHash, randomUUID } from "node:crypto";
import {
  link,
  lstat,
  open,
  rm,
} from "node:fs/promises";
import {
  basename,
  dirname,
  join,
  resolve,
} from "node:path";

import { z } from "zod";

import {
  assertC6NoSymlinkPathComponents,
  readC6StableRegularFile,
} from "./c6-asset-lock";
import type {
  C6LiveMultiLangNeighborStructuralQualification,
  C6LiveMultiLangNeighborStructuralQualificationResult,
} from "./c6-live-multilang-neighbor-structural-qualification";
import {
  parseC6LiveMultiLangNeighborStructuralQualification,
  serializeC6LiveMultiLangNeighborStructuralQualification,
} from "./c6-live-multilang-neighbor-structural-qualification";
import {
  serializeC6StructuralReviewEventPolicy,
} from "./c6-review-event-policy";

const ARTIFACT_KIND =
  "c6-live-multilang-neighbor-structural-union";
const SOURCE_ARTIFACT_KIND =
  "c6-live-multilang-neighbor-structural-qualification";
const REPOSITORY_CAP = 4;
const FROZEN_WAVE1 = {
  bytes: 1_358_575,
  counts: {
    exactStructuralCandidateCount: 34,
    exactStructuralRepositoryCount: 15,
    noExactStructuralSequenceCount: 658,
    projectedStructuralEventCount: 830,
    pullAuthorOccurrenceCount: 692,
    repositoryCappedStructuralCeiling: 30,
    reviewerActorOccurrenceCount: 3_185,
    reviewerUniqueLoginCount: 267,
    targetCount: 692,
  },
  deepCapturePlan: {
    bytes: 518_443,
    path:
      "swe-bench-live-multilang-608f7ae9." +
      "neighbor-deep-capture-plan-v1.json",
    sha256:
      "9c1ebdafd700a274cffc4dba807a2425013079d1bfe74a1e99f1144399da492a",
  },
  deepEvidence: {
    assetRootSha256:
      "80c360d58b1959e5a47cbd70c5eb620276ed2105c49a595dccdb4aa178d1f83b",
    completionSha256:
      "62ba6ada2d0ae54f4d43149e592ec06b70899e712a12f97dd503d8650ff2063d",
    directoryCount: 2_771,
    fileCount: 2_772,
    finalSuccessfulResponseCount: 693,
    logicalRequestCount: 693,
    networkRequestCount: 693,
    targetProjectionSha256:
      "7286f92d0b211ab6830727969d2c40e691e73b1b55197fce221a271ef14edbcf",
  },
  path:
    "swe-bench-live-multilang-608f7ae9." +
    "neighbor-structural-qualification-v1.json",
  projections: {
    pullAuthorOccurrenceProjectionSha256:
      "72b4f597546917d0140b07c516a6a8577849f4f54e8b8ef074177a47b4aeaffc",
    reviewerActorOccurrenceProjectionSha256:
      "881aafcfad9a9675e353adb8b2a3aaa8fd623ff0525c29ba34a3b08f29ee0c49",
    reviewerLoginProjectionSha256:
      "a26324b895357d9191a0d84baddbca968bea218859d968a743ebdd7b48f0aa34",
    structuralResultProjectionSha256:
      "f599d7ced72a3cebd4f175a059a604d2bb2c09b97d81e268dd18915cdd136081",
  },
  sha256:
    "ae096d86f779cb04f1fb0bb336d6bb4e02ced04e72385d9332d4dba82a9c1210",
} as const;
const FROZEN_WAVE2 = {
  bytes: 1_159_147,
  counts: {
    exactStructuralCandidateCount: 22,
    exactStructuralRepositoryCount: 16,
    noExactStructuralSequenceCount: 620,
    projectedStructuralEventCount: 649,
    pullAuthorOccurrenceCount: 642,
    repositoryCappedStructuralCeiling: 22,
    reviewerActorOccurrenceCount: 2_701,
    reviewerUniqueLoginCount: 256,
    targetCount: 642,
  },
  deepCapturePlan: {
    bytes: 484_504,
    path:
      "swe-bench-live-multilang-608f7ae9." +
      "neighbor-deep-capture-plan-v3.json",
    sha256:
      "a0dd0fa0a106d6d1e65645dcec9e44f9e04eb08d7f47e59d25f37920d7cae411",
  },
  deepEvidence: {
    assetRootSha256:
      "85b3d8db9ef328c3c0bb29025da6b428552435d1188c53dd8aa4b1a4b1f46ea1",
    completionSha256:
      "63b203ec0bd52765e1fedcf980f2cc7cb74d899c004b2ec7499eabfb94b0a939",
    directoryCount: 2_573,
    fileCount: 2_575,
    finalSuccessfulResponseCount: 644,
    logicalRequestCount: 644,
    networkRequestCount: 644,
    targetProjectionSha256:
      "009e431943a46ceb9aa4312c9436fc2bb4e7ed35cb21050e0b4b05af9f34ae1d",
  },
  path:
    "swe-bench-live-multilang-608f7ae9." +
    "neighbor-continuation-structural-qualification-v1.json",
  projections: {
    pullAuthorOccurrenceProjectionSha256:
      "724faa616c60707b316ee24fcd1b49f6366c993ce50905919937e4b1ee8b9d4b",
    reviewerActorOccurrenceProjectionSha256:
      "b70ac3ac8cf1ae8fe73c7c6ae6f849c5501ea7df4640335157e26cb6d90cdcef",
    reviewerLoginProjectionSha256:
      "0e4d2f838e1c3fe0cd50ce3ff7e84a9018f9ab482f21209f74df51a8ed835333",
    structuralResultProjectionSha256:
      "398b700f0521054f8c3b491e34a741df2c0e733864dc679e365d40e992a541d3",
  },
  sha256:
    "9dc625cbfb5c1c0bc47f9b09511b9ce7c8df789bf4bcbaafa2d8d182dd88be91",
} as const;

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const anchorSchema = z.string().regex(
  /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+#[1-9]\d*$/u,
);
const repositorySchema = z.string().regex(
  /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u,
);
const actorLoginSchema = z.string().min(1).refine(
  (value) =>
    value.trim() === value &&
    !/[/\s]/u.test(value),
  "invalid actor login",
);
const normalizedLoginSchema = actorLoginSchema.refine(
  (value) => value === value.toLowerCase(),
  "reviewer login must be normalized",
);
const artifactReferenceSchema = z.object({
  bytes: z.number().int().positive(),
  path: z.string().min(1).refine(
    (value) => basename(value) === value,
    "artifact path must be a basename",
  ),
  sha256: sha256Schema,
}).strict();
const wave1QualificationReferenceSchema = z.object({
  artifactKind: z.literal(SOURCE_ARTIFACT_KIND),
  bytes: z.literal(FROZEN_WAVE1.bytes),
  path: z.literal(FROZEN_WAVE1.path),
  schemaVersion: z.literal(1),
  sha256: z.literal(FROZEN_WAVE1.sha256),
}).strict();
const wave2QualificationReferenceSchema = z.object({
  artifactKind: z.literal(SOURCE_ARTIFACT_KIND),
  bytes: z.literal(FROZEN_WAVE2.bytes),
  path: z.literal(FROZEN_WAVE2.path),
  schemaVersion: z.literal(1),
  sha256: z.literal(FROZEN_WAVE2.sha256),
}).strict();
const countsSchema = z.object({
  exactStructuralCandidateCount: z.number().int().nonnegative(),
  exactStructuralRepositoryCount: z.number().int().nonnegative(),
  noExactStructuralSequenceCount: z.number().int().nonnegative(),
  projectedStructuralEventCount: z.number().int().nonnegative(),
  pullAuthorOccurrenceCount: z.number().int().nonnegative(),
  repositoryCappedStructuralCeiling:
    z.number().int().nonnegative(),
  reviewerActorOccurrenceCount: z.number().int().nonnegative(),
  reviewerUniqueLoginCount: z.number().int().nonnegative(),
  targetCount: z.number().int().positive(),
}).strict();
const deepEvidenceReferenceSchema = z.object({
  assetRootSha256: sha256Schema,
  completionSha256: sha256Schema,
  directoryCount: z.number().int().positive(),
  fileCount: z.number().int().positive(),
  finalSuccessfulResponseCount: z.number().int().positive(),
  logicalRequestCount: z.number().int().positive(),
  networkRequestCount: z.number().int().positive(),
  targetProjectionSha256: sha256Schema,
}).strict();
const sourceProjectionsSchema = z.object({
  pullAuthorOccurrenceProjectionSha256: sha256Schema,
  reviewerActorOccurrenceProjectionSha256: sha256Schema,
  reviewerLoginProjectionSha256: sha256Schema,
  structuralResultProjectionSha256: sha256Schema,
}).strict();
const sourceInputCommonSchema = z.object({
  counts: countsSchema,
  deepCapturePlan: artifactReferenceSchema,
  deepEvidence: deepEvidenceReferenceSchema,
  projections: sourceProjectionsSchema,
});
const wave1InputSchema = sourceInputCommonSchema.extend({
  qualification: wave1QualificationReferenceSchema,
  sourceWave: z.literal("wave1"),
}).strict();
const wave2InputSchema = sourceInputCommonSchema.extend({
  qualification: wave2QualificationReferenceSchema,
  sourceWave: z.literal("wave2"),
}).strict();
const reviewOccurrenceSchema = z.object({
  actorLogin: actorLoginSchema,
  canonicalAnchorId: anchorSchema,
  eventId: z.string().min(1),
  submittedAt: z.iso.datetime().nullable(),
  surface: z.literal("review"),
}).strict();
const commentOccurrenceSchema = z.object({
  actorLogin: actorLoginSchema,
  canonicalAnchorId: anchorSchema,
  createdAt: z.iso.datetime(),
  eventId: z.string().min(1),
  surface: z.literal("review-thread-comment"),
  threadId: z.string().min(1),
}).strict();
const pullAuthorOccurrenceSchema = z.object({
  actorLogin: actorLoginSchema,
  canonicalAnchorId: anchorSchema,
  eventId: z.string().min(1),
  surface: z.literal("pull-author"),
}).strict();
const structuralEventSchema = z.object({
  author: actorLoginSchema,
  body: z.string(),
  bodyBytes: z.number().int().nonnegative(),
  bodySha256: sha256Schema,
  createdAt: z.iso.datetime(),
  id: z.string().min(1),
  reviewedCommit: z.string().regex(/^[a-f0-9]{40}$/u),
  source: z.enum(["review-thread-comment", "whole-review"]),
  threadId: z.string().min(1).nullable(),
}).strict();
const exactSequenceSchema = z.object({
  firstFixCommit: z.string().regex(/^[a-f0-9]{40}$/u),
  firstReview: structuralEventSchema,
  initialCommit: z.string().regex(/^[a-f0-9]{40}$/u),
  secondFixCommit: z.string().regex(/^[a-f0-9]{40}$/u),
  secondReview: structuralEventSchema,
}).strict();
const commonUnionResultSchema = z.object({
  canonicalAnchorId: anchorSchema,
  canonicalRepository: repositorySchema,
  captureDirectory: z.string().min(1),
  pullAuthorLogin: actorLoginSchema,
  reviewSurfaceClosureSha256: sha256Schema,
  sourceCaptureOrder: z.number().int().positive(),
  sourceWave: z.enum(["wave1", "wave2"]),
  structuralEventCount: z.number().int().nonnegative(),
  structuralEventProjectionSha256: sha256Schema,
  unionOrder: z.number().int().positive(),
});
const unionResultSchema = z.discriminatedUnion("status", [
  commonUnionResultSchema.extend({
    exactSequence: exactSequenceSchema,
    legalSequenceCount: z.number().int().positive(),
    lineageIdentitySha256: sha256Schema,
    status: z.literal(
      "exact-structural-candidate-pre-actor",
    ),
  }).strict(),
  commonUnionResultSchema.extend({
    status: z.literal("no-exact-structural-sequence"),
  }).strict(),
]);
const unionSchema = z.object({
  artifactKind: z.literal(ARTIFACT_KIND),
  boundary: z.object({
    acceptedEpisodeCount: z.literal(0),
    actorCaptureExecuted: z.literal(false),
    actorQualifiedEpisodeCount: z.literal(0),
    candidateManifestFrozen: z.literal(false),
    codexRunReady: z.literal(false),
    evaluatorQualifiedEpisodeCount: z.literal(0),
    machineQualifiedEpisodeCount: z.literal(0),
    semanticallyQualifiedEpisodeCount: z.literal(0),
    status: z.literal("pre-actor-structural-union-only"),
  }).strict(),
  counts: countsSchema,
  independenceBoundary: z.object({
    acceptedEpisodeInput: z.literal(false),
    actorEligibilityInput: z.literal(false),
    evaluatorDecisionInput: z.literal(false),
    goldInput: z.literal(false),
    hiddenTestInput: z.literal(false),
    machineOutcomeInput: z.literal(false),
    patchInput: z.literal(false),
    pullAuthorOccurrenceProjectionSha256: sha256Schema,
    reviewerActorOccurrenceProjectionSha256: sha256Schema,
    reviewerLoginProjectionSha256: sha256Schema,
    semanticDecisionInput: z.literal(false),
    structuralResultProjectionSha256: sha256Schema,
  }).strict(),
  inputs: z.object({
    wave1: wave1InputSchema,
    wave2: wave2InputSchema,
  }).strict(),
  policy: z.object({
    policyId: z.literal("prospective-structural-review-v2"),
    schemaVersion: z.literal(2),
    sha256: sha256Schema,
  }).strict(),
  pullAuthorOccurrences: z.array(pullAuthorOccurrenceSchema),
  results: z.array(unionResultSchema).min(1),
  reviewerActorOccurrences: z.array(
    z.discriminatedUnion("surface", [
      reviewOccurrenceSchema,
      commentOccurrenceSchema,
    ]),
  ),
  reviewerLogins: z.array(normalizedLoginSchema),
  rule: z.object({
    duplicateCaptureDirectory: z.literal("reject"),
    duplicateCanonicalAnchor: z.literal("reject"),
    repositoryCap: z.literal(REPOSITORY_CAP),
    repositoryOverlap: z.literal(
      "frozen-wave-repositories-must-be-disjoint",
    ),
    resultOrder: z.literal(
      "wave1-then-wave2-source-capture-order",
    ),
    reviewerLoginNormalization: z.literal(
      "case-insensitive-login",
    ),
  }).strict(),
  schemaVersion: z.literal(1),
}).strict();

export type C6LiveMultiLangNeighborStructuralUnion =
  z.infer<typeof unionSchema>;
export type C6LiveMultiLangNeighborStructuralUnionResult =
  z.infer<typeof unionResultSchema>;

export interface C6LiveMultiLangNeighborStructuralUnionTestHooks {
  afterOutputPublication?: () => Promise<void> | void;
  beforeTerminalReplay?: () => Promise<void> | void;
}

export interface C6LiveMultiLangNeighborStructuralUnionBuildInput {
  testHooks?: C6LiveMultiLangNeighborStructuralUnionTestHooks;
  wave1QualificationPath: string;
  wave2QualificationPath: string;
}

export function deriveC6LiveMultiLangNeighborStructuralUnion(input: {
  wave1: C6LiveMultiLangNeighborStructuralQualification;
  wave2: C6LiveMultiLangNeighborStructuralQualification;
}): C6LiveMultiLangNeighborStructuralUnion {
  assertSourceSeparation(input.wave1.results, input.wave2.results);
  const wave1 = canonicalFrozenQualification(
    input.wave1,
    FROZEN_WAVE1,
    "wave1",
  );
  const wave2 = canonicalFrozenQualification(
    input.wave2,
    FROZEN_WAVE2,
    "wave2",
  );
  if (JSON.stringify(wave1.policy) !== JSON.stringify(wave2.policy)) {
    throw new Error("C6 structural union policy mismatch");
  }

  const results = [
    ...projectSourceResults(wave1.results, "wave1", 0),
    ...projectSourceResults(
      wave2.results,
      "wave2",
      wave1.results.length,
    ),
  ];
  const reviewerActorOccurrences = [
    ...wave1.reviewerActorOccurrences,
    ...wave2.reviewerActorOccurrences,
  ];
  const pullAuthorOccurrences = [
    ...wave1.pullAuthorOccurrences,
    ...wave2.pullAuthorOccurrences,
  ];
  const reviewerLogins = normalizedReviewerLogins(
    reviewerActorOccurrences,
  );
  const counts = deriveCounts({
    pullAuthorOccurrences,
    results,
    reviewerActorOccurrences,
    reviewerLogins,
  });
  const union = unionSchema.parse({
    artifactKind: ARTIFACT_KIND,
    boundary: {
      acceptedEpisodeCount: 0,
      actorCaptureExecuted: false,
      actorQualifiedEpisodeCount: 0,
      candidateManifestFrozen: false,
      codexRunReady: false,
      evaluatorQualifiedEpisodeCount: 0,
      machineQualifiedEpisodeCount: 0,
      semanticallyQualifiedEpisodeCount: 0,
      status: "pre-actor-structural-union-only",
    },
    counts,
    independenceBoundary: {
      acceptedEpisodeInput: false,
      actorEligibilityInput: false,
      evaluatorDecisionInput: false,
      goldInput: false,
      hiddenTestInput: false,
      machineOutcomeInput: false,
      patchInput: false,
      pullAuthorOccurrenceProjectionSha256: sha256(
        JSON.stringify(pullAuthorOccurrences),
      ),
      reviewerActorOccurrenceProjectionSha256: sha256(
        JSON.stringify(reviewerActorOccurrences),
      ),
      reviewerLoginProjectionSha256: sha256(
        JSON.stringify(reviewerLogins),
      ),
      semanticDecisionInput: false,
      structuralResultProjectionSha256: sha256(
        JSON.stringify(results),
      ),
    },
    inputs: {
      wave1: sourceInput(wave1, FROZEN_WAVE1, "wave1"),
      wave2: sourceInput(wave2, FROZEN_WAVE2, "wave2"),
    },
    policy: wave1.policy,
    pullAuthorOccurrences,
    results,
    reviewerActorOccurrences,
    reviewerLogins,
    rule: {
      duplicateCaptureDirectory: "reject",
      duplicateCanonicalAnchor: "reject",
      repositoryCap: REPOSITORY_CAP,
      repositoryOverlap:
        "frozen-wave-repositories-must-be-disjoint",
      resultOrder: "wave1-then-wave2-source-capture-order",
      reviewerLoginNormalization: "case-insensitive-login",
    },
    schemaVersion: 1,
  });
  assertUnionSelfConsistency(union);
  return union;
}

export function serializeC6LiveMultiLangNeighborStructuralUnion(
  union: C6LiveMultiLangNeighborStructuralUnion,
): string {
  const parsed = unionSchema.parse(union);
  assertUnionSelfConsistency(parsed);
  return `${JSON.stringify(parsed, null, 2)}\n`;
}

export function parseC6LiveMultiLangNeighborStructuralUnion(
  input: string | Uint8Array,
): C6LiveMultiLangNeighborStructuralUnion {
  const text = typeof input === "string"
    ? input
    : Buffer.from(input).toString("utf8");
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch {
    throw new Error("C6 structural union invalid JSON");
  }
  if (text !== `${JSON.stringify(raw, null, 2)}\n`) {
    throw new Error("C6 structural union requires canonical JSON");
  }
  const union = unionSchema.parse(raw);
  assertUnionSelfConsistency(union);
  return union;
}

export async function buildC6LiveMultiLangNeighborStructuralUnion(
  input: C6LiveMultiLangNeighborStructuralUnionBuildInput,
): Promise<{
  outputSha256: string;
  union: C6LiveMultiLangNeighborStructuralUnion;
}> {
  const initial = await readFrozenChildren(input);
  const union = deriveC6LiveMultiLangNeighborStructuralUnion({
    wave1: initial.wave1.qualification,
    wave2: initial.wave2.qualification,
  });

  await input.testHooks?.beforeTerminalReplay?.();
  const terminal = await readFrozenChildren(input);
  const terminalUnion = deriveC6LiveMultiLangNeighborStructuralUnion({
    wave1: terminal.wave1.qualification,
    wave2: terminal.wave2.qualification,
  });
  const serialized =
    serializeC6LiveMultiLangNeighborStructuralUnion(union);
  if (
    !terminal.wave1.bytes.equals(initial.wave1.bytes) ||
    !terminal.wave2.bytes.equals(initial.wave2.bytes) ||
    serializeC6LiveMultiLangNeighborStructuralUnion(terminalUnion) !==
      serialized
  ) {
    throw new Error("C6 structural union input closure changed");
  }
  parseC6LiveMultiLangNeighborStructuralUnion(serialized);
  return {
    outputSha256: sha256(serialized),
    union,
  };
}

export async function materializeC6LiveMultiLangNeighborStructuralUnion(
  input:
    C6LiveMultiLangNeighborStructuralUnionBuildInput & {
      outputPath: string;
    },
): Promise<{
  outputSha256: string;
  union: C6LiveMultiLangNeighborStructuralUnion;
}> {
  const result = await buildC6LiveMultiLangNeighborStructuralUnion(
    input,
  );
  const serialized =
    serializeC6LiveMultiLangNeighborStructuralUnion(result.union);
  const outputPath = resolve(input.outputPath);
  const outputParent = await assertC6NoSymlinkPathComponents(
    dirname(outputPath),
    "C6 structural union output parent",
  );
  const temporaryPath = join(
    outputParent,
    `.${basename(outputPath)}.incomplete-${randomUUID()}`,
  );
  let ownedIdentity: OwnedFileIdentity | null = null;
  try {
    const handle = await open(temporaryPath, "wx", 0o600);
    try {
      const openedStat = await handle.stat();
      if (
        !openedStat.isFile() ||
        (openedStat.mode & 0o7777) !== 0o600
      ) {
        throw new Error(
          "C6 structural union temporary output identity mismatch",
        );
      }
      ownedIdentity = {
        dev: openedStat.dev,
        ino: openedStat.ino,
      };
      await handle.writeFile(serialized, "utf8");
      await handle.chmod(0o644);
      await handle.sync();
    } finally {
      await handle.close();
    }
    const temporaryBytes = await readC6StableRegularFile(
      temporaryPath,
      "C6 structural union temporary output",
    );
    if (temporaryBytes.toString("utf8") !== serialized) {
      throw new Error(
        "C6 structural union temporary output mismatch",
      );
    }
    await assertC6NoSymlinkPathComponents(
      outputParent,
      "C6 structural union terminal output parent",
    );
    await link(temporaryPath, outputPath);
    await assertPublishedOutputOwnership({
      outputPath,
      ownedIdentity,
      temporaryPath,
    });

    await input.testHooks?.afterOutputPublication?.();
    const replayed =
      await buildC6LiveMultiLangNeighborStructuralUnion({
        wave1QualificationPath: input.wave1QualificationPath,
        wave2QualificationPath: input.wave2QualificationPath,
      });
    if (
      replayed.outputSha256 !== result.outputSha256 ||
      serializeC6LiveMultiLangNeighborStructuralUnion(
        replayed.union,
      ) !== serialized
    ) {
      throw new Error(
        "C6 structural union post-publication replay mismatch",
      );
    }
    await assertPublishedOutputOwnership({
      outputPath,
      ownedIdentity,
      temporaryPath,
    });
    const publishedBytes = await readC6StableRegularFile(
      outputPath,
      "C6 structural union published output",
    );
    if (
      serializeC6LiveMultiLangNeighborStructuralUnion(
        parseC6LiveMultiLangNeighborStructuralUnion(publishedBytes),
      ) !== serialized
    ) {
      throw new Error("C6 structural union published output mismatch");
    }
    await assertPublishedOutputOwnership({
      outputPath,
      ownedIdentity,
      temporaryPath,
    });
    if (!await removePathIfOwned(temporaryPath, ownedIdentity)) {
      throw new Error(
        "C6 structural union temporary output cleanup mismatch",
      );
    }
  } catch (error) {
    if (ownedIdentity !== null) {
      await removePathIfOwned(outputPath, ownedIdentity);
      await removePathIfOwned(temporaryPath, ownedIdentity);
    }
    throw error;
  }
  return result;
}

interface FrozenQualification {
  bytes: Buffer;
  qualification: C6LiveMultiLangNeighborStructuralQualification;
}

type FrozenStructuralSource =
  | typeof FROZEN_WAVE1
  | typeof FROZEN_WAVE2;

interface OwnedFileIdentity {
  dev: number;
  ino: number;
}

interface SourceCountsInput {
  pullAuthorOccurrences:
    C6LiveMultiLangNeighborStructuralUnion["pullAuthorOccurrences"];
  results: C6LiveMultiLangNeighborStructuralUnionResult[];
  reviewerActorOccurrences:
    C6LiveMultiLangNeighborStructuralUnion["reviewerActorOccurrences"];
  reviewerLogins: string[];
}

async function readFrozenChildren(
  input: C6LiveMultiLangNeighborStructuralUnionBuildInput,
): Promise<{
  wave1: FrozenQualification;
  wave2: FrozenQualification;
}> {
  const [wave1, wave2] = await Promise.all([
    readFrozenQualification(
      input.wave1QualificationPath,
      FROZEN_WAVE1,
      "wave1",
    ),
    readFrozenQualification(
      input.wave2QualificationPath,
      FROZEN_WAVE2,
      "wave2",
    ),
  ]);
  return { wave1, wave2 };
}

async function readFrozenQualification(
  inputPath: string,
  frozen: FrozenStructuralSource,
  sourceWave: "wave1" | "wave2",
): Promise<FrozenQualification> {
  const path = await assertC6NoSymlinkPathComponents(
    inputPath,
    `C6 structural union ${sourceWave} qualification`,
  );
  const bytes = await readC6StableRegularFile(
    path,
    `C6 structural union ${sourceWave} qualification`,
  );
  if (
    basename(path) !== frozen.path ||
    bytes.byteLength !== frozen.bytes ||
    sha256(bytes) !== frozen.sha256
  ) {
    throw new Error(
      `C6 structural union ${sourceWave} qualification hash mismatch`,
    );
  }
  return {
    bytes,
    qualification:
      parseC6LiveMultiLangNeighborStructuralQualification(bytes),
  };
}

function canonicalFrozenQualification(
  qualification: C6LiveMultiLangNeighborStructuralQualification,
  frozen: FrozenStructuralSource,
  sourceWave: "wave1" | "wave2",
): C6LiveMultiLangNeighborStructuralQualification {
  const serialized =
    serializeC6LiveMultiLangNeighborStructuralQualification(
      qualification,
    );
  const canonical =
    parseC6LiveMultiLangNeighborStructuralQualification(serialized);
  if (
    Buffer.byteLength(serialized) !== frozen.bytes ||
    sha256(serialized) !== frozen.sha256
  ) {
    throw new Error(
      `C6 structural union ${sourceWave} qualification hash mismatch`,
    );
  }
  return canonical;
}

function sourceInput(
  qualification: C6LiveMultiLangNeighborStructuralQualification,
  frozen: FrozenStructuralSource,
  sourceWave: "wave1" | "wave2",
) {
  return {
    counts: qualification.counts,
    deepCapturePlan: qualification.inputs.deepCapturePlan,
    deepEvidence: qualification.inputs.deepEvidence,
    projections: {
      pullAuthorOccurrenceProjectionSha256:
        qualification.independenceBoundary
          .pullAuthorOccurrenceProjectionSha256,
      reviewerActorOccurrenceProjectionSha256:
        qualification.independenceBoundary
          .reviewerActorOccurrenceProjectionSha256,
      reviewerLoginProjectionSha256:
        qualification.independenceBoundary
          .reviewerLoginProjectionSha256,
      structuralResultProjectionSha256:
        qualification.independenceBoundary
          .structuralResultProjectionSha256,
    },
    qualification: {
      artifactKind: SOURCE_ARTIFACT_KIND,
      bytes: frozen.bytes,
      path: frozen.path,
      schemaVersion: 1,
      sha256: frozen.sha256,
    },
    sourceWave,
  };
}

function projectSourceResults(
  results: C6LiveMultiLangNeighborStructuralQualificationResult[],
  sourceWave: "wave1" | "wave2",
  unionOffset: number,
): C6LiveMultiLangNeighborStructuralUnionResult[] {
  return results.map((result, index) => {
    const { captureOrder: sourceCaptureOrder, ...sourceResult } =
      result;
    return unionResultSchema.parse({
      ...sourceResult,
      sourceCaptureOrder,
      sourceWave,
      unionOrder: unionOffset + index + 1,
    });
  });
}

function assertSourceSeparation(
  wave1:
    C6LiveMultiLangNeighborStructuralQualificationResult[],
  wave2:
    C6LiveMultiLangNeighborStructuralQualificationResult[],
): void {
  const anchors = new Set<string>();
  const directories = new Set<string>();
  for (const result of [...wave1, ...wave2]) {
    if (anchors.has(result.canonicalAnchorId)) {
      throw new Error(
        `C6 structural union duplicate anchor ${
          result.canonicalAnchorId
        }`,
      );
    }
    if (directories.has(result.captureDirectory)) {
      throw new Error(
        `C6 structural union duplicate capture directory ${
          result.captureDirectory
        }`,
      );
    }
    anchors.add(result.canonicalAnchorId);
    directories.add(result.captureDirectory);
  }
  const wave1Repositories = new Set(
    wave1.map((result) => result.canonicalRepository),
  );
  for (const result of wave2) {
    if (wave1Repositories.has(result.canonicalRepository)) {
      throw new Error(
        `C6 structural union repository overlap ${
          result.canonicalRepository
        }`,
      );
    }
  }
}

function deriveCounts(input: SourceCountsInput) {
  const exact = input.results.filter((result) =>
    result.status === "exact-structural-candidate-pre-actor"
  );
  const exactByRepository = new Map<string, number>();
  for (const result of exact) {
    exactByRepository.set(
      result.canonicalRepository,
      (exactByRepository.get(result.canonicalRepository) ?? 0) + 1,
    );
  }
  return {
    exactStructuralCandidateCount: exact.length,
    exactStructuralRepositoryCount: exactByRepository.size,
    noExactStructuralSequenceCount:
      input.results.length - exact.length,
    projectedStructuralEventCount: input.results.reduce(
      (count, result) => count + result.structuralEventCount,
      0,
    ),
    pullAuthorOccurrenceCount: input.pullAuthorOccurrences.length,
    repositoryCappedStructuralCeiling:
      [...exactByRepository.values()].reduce(
        (count, repositoryCount) =>
          count + Math.min(REPOSITORY_CAP, repositoryCount),
        0,
      ),
    reviewerActorOccurrenceCount:
      input.reviewerActorOccurrences.length,
    reviewerUniqueLoginCount: input.reviewerLogins.length,
    targetCount: input.results.length,
  };
}

function normalizedReviewerLogins(
  occurrences:
    C6LiveMultiLangNeighborStructuralUnion["reviewerActorOccurrences"],
): string[] {
  return [...new Set(
    occurrences.map((occurrence) =>
      normalizeLogin(occurrence.actorLogin)
    ),
  )].sort(compareStrings);
}

function assertUnionSelfConsistency(
  union: C6LiveMultiLangNeighborStructuralUnion,
): void {
  assertFrozenSourceInput(
    union.inputs.wave1,
    FROZEN_WAVE1,
    "wave1",
  );
  assertFrozenSourceInput(
    union.inputs.wave2,
    FROZEN_WAVE2,
    "wave2",
  );
  const wave1TargetCount = union.inputs.wave1.counts.targetCount;
  const wave2TargetCount = union.inputs.wave2.counts.targetCount;
  const wave1ReviewerCount =
    union.inputs.wave1.counts.reviewerActorOccurrenceCount;
  const wave2ReviewerCount =
    union.inputs.wave2.counts.reviewerActorOccurrenceCount;
  const wave1PullAuthorCount =
    union.inputs.wave1.counts.pullAuthorOccurrenceCount;
  const wave2PullAuthorCount =
    union.inputs.wave2.counts.pullAuthorOccurrenceCount;
  if (
    union.results.length !== wave1TargetCount + wave2TargetCount ||
    union.reviewerActorOccurrences.length !==
      wave1ReviewerCount + wave2ReviewerCount ||
    union.pullAuthorOccurrences.length !==
      wave1PullAuthorCount + wave2PullAuthorCount
  ) {
    throw new Error("C6 structural union source count mismatch");
  }

  const wave1Rows = union.results.slice(0, wave1TargetCount);
  const wave2Rows = union.results.slice(wave1TargetCount);
  assertUnionRowOrder(wave1Rows, "wave1", 0);
  assertUnionRowOrder(wave2Rows, "wave2", wave1TargetCount);
  assertSourceSeparation(
    wave1Rows.map(toSourceResult),
    wave2Rows.map(toSourceResult),
  );

  const wave1ReviewerOccurrences =
    union.reviewerActorOccurrences.slice(0, wave1ReviewerCount);
  const wave2ReviewerOccurrences =
    union.reviewerActorOccurrences.slice(wave1ReviewerCount);
  const wave1PullAuthorOccurrences =
    union.pullAuthorOccurrences.slice(0, wave1PullAuthorCount);
  const wave2PullAuthorOccurrences =
    union.pullAuthorOccurrences.slice(wave1PullAuthorCount);
  const wave1Logins = normalizedReviewerLogins(
    wave1ReviewerOccurrences,
  );
  const wave2Logins = normalizedReviewerLogins(
    wave2ReviewerOccurrences,
  );
  assertSourceProjection({
    input: union.inputs.wave1,
    pullAuthorOccurrences: wave1PullAuthorOccurrences,
    results: wave1Rows,
    reviewerActorOccurrences: wave1ReviewerOccurrences,
    reviewerLogins: wave1Logins,
  });
  assertSourceProjection({
    input: union.inputs.wave2,
    pullAuthorOccurrences: wave2PullAuthorOccurrences,
    results: wave2Rows,
    reviewerActorOccurrences: wave2ReviewerOccurrences,
    reviewerLogins: wave2Logins,
  });

  const reviewerLogins = normalizedReviewerLogins(
    union.reviewerActorOccurrences,
  );
  const counts = deriveCounts({
    pullAuthorOccurrences: union.pullAuthorOccurrences,
    results: union.results,
    reviewerActorOccurrences: union.reviewerActorOccurrences,
    reviewerLogins,
  });
  const anchors = new Set(
    union.results.map((result) => result.canonicalAnchorId),
  );
  if (
    JSON.stringify(union.counts) !== JSON.stringify(counts) ||
    JSON.stringify(union.reviewerLogins) !==
      JSON.stringify(reviewerLogins) ||
    union.independenceBoundary
      .pullAuthorOccurrenceProjectionSha256 !==
        sha256(JSON.stringify(union.pullAuthorOccurrences)) ||
    union.independenceBoundary
      .reviewerActorOccurrenceProjectionSha256 !==
        sha256(JSON.stringify(union.reviewerActorOccurrences)) ||
    union.independenceBoundary.reviewerLoginProjectionSha256 !==
      sha256(JSON.stringify(union.reviewerLogins)) ||
    union.independenceBoundary.structuralResultProjectionSha256 !==
      sha256(JSON.stringify(union.results)) ||
    union.policy.sha256 !==
      sha256(serializeC6StructuralReviewEventPolicy())
  ) {
    throw new Error("C6 structural union self-consistency mismatch");
  }
  for (const occurrence of [
    ...union.reviewerActorOccurrences,
    ...union.pullAuthorOccurrences,
  ]) {
    if (!anchors.has(occurrence.canonicalAnchorId)) {
      throw new Error(
        "C6 structural union orphan actor occurrence",
      );
    }
  }
}

function assertFrozenSourceInput(
  input: C6LiveMultiLangNeighborStructuralUnion["inputs"][
    "wave1" | "wave2"
  ],
  frozen: FrozenStructuralSource,
  sourceWave: "wave1" | "wave2",
): void {
  const expected = {
    counts: frozen.counts,
    deepCapturePlan: frozen.deepCapturePlan,
    deepEvidence: frozen.deepEvidence,
    projections: frozen.projections,
    qualification: {
      artifactKind: SOURCE_ARTIFACT_KIND,
      bytes: frozen.bytes,
      path: frozen.path,
      schemaVersion: 1,
      sha256: frozen.sha256,
    },
    sourceWave,
  };
  if (JSON.stringify(input) !== JSON.stringify(expected)) {
    throw new Error(
      `C6 structural union ${sourceWave} frozen provenance mismatch`,
    );
  }
}

function assertUnionRowOrder(
  rows: C6LiveMultiLangNeighborStructuralUnionResult[],
  sourceWave: "wave1" | "wave2",
  unionOffset: number,
): void {
  for (const [index, row] of rows.entries()) {
    if (
      row.sourceWave !== sourceWave ||
      row.sourceCaptureOrder !== index + 1 ||
      row.unionOrder !== unionOffset + index + 1 ||
      row.canonicalRepository !==
        row.canonicalAnchorId.split("#")[0]
    ) {
      throw new Error("C6 structural union result order mismatch");
    }
  }
}

function assertSourceProjection(input: {
  input: C6LiveMultiLangNeighborStructuralUnion["inputs"][
    "wave1" | "wave2"
  ];
  pullAuthorOccurrences:
    C6LiveMultiLangNeighborStructuralUnion["pullAuthorOccurrences"];
  results: C6LiveMultiLangNeighborStructuralUnionResult[];
  reviewerActorOccurrences:
    C6LiveMultiLangNeighborStructuralUnion["reviewerActorOccurrences"];
  reviewerLogins: string[];
}): void {
  const sourceResults = input.results.map(toSourceResult);
  const counts = deriveCounts({
    pullAuthorOccurrences: input.pullAuthorOccurrences,
    results: input.results,
    reviewerActorOccurrences: input.reviewerActorOccurrences,
    reviewerLogins: input.reviewerLogins,
  });
  if (
    JSON.stringify(input.input.counts) !== JSON.stringify(counts) ||
    input.input.projections
      .pullAuthorOccurrenceProjectionSha256 !==
        sha256(JSON.stringify(input.pullAuthorOccurrences)) ||
    input.input.projections
      .reviewerActorOccurrenceProjectionSha256 !==
        sha256(JSON.stringify(input.reviewerActorOccurrences)) ||
    input.input.projections.reviewerLoginProjectionSha256 !==
      sha256(JSON.stringify(input.reviewerLogins)) ||
    input.input.projections.structuralResultProjectionSha256 !==
      sha256(JSON.stringify(sourceResults))
  ) {
    throw new Error(
      `C6 structural union ${input.input.sourceWave} projection mismatch`,
    );
  }
  const anchors = new Set(
    input.results.map((result) => result.canonicalAnchorId),
  );
  for (const occurrence of [
    ...input.reviewerActorOccurrences,
    ...input.pullAuthorOccurrences,
  ]) {
    if (!anchors.has(occurrence.canonicalAnchorId)) {
      throw new Error(
        `C6 structural union ${input.input.sourceWave} occurrence mismatch`,
      );
    }
  }
}

function toSourceResult(
  row: C6LiveMultiLangNeighborStructuralUnionResult,
): C6LiveMultiLangNeighborStructuralQualificationResult {
  const common = {
    canonicalAnchorId: row.canonicalAnchorId,
    canonicalRepository: row.canonicalRepository,
    captureDirectory: row.captureDirectory,
    captureOrder: row.sourceCaptureOrder,
    pullAuthorLogin: row.pullAuthorLogin,
    reviewSurfaceClosureSha256: row.reviewSurfaceClosureSha256,
    structuralEventCount: row.structuralEventCount,
    structuralEventProjectionSha256:
      row.structuralEventProjectionSha256,
  };
  return row.status === "no-exact-structural-sequence"
    ? {
      ...common,
      status: row.status,
    }
    : {
      ...common,
      exactSequence: row.exactSequence,
      legalSequenceCount: row.legalSequenceCount,
      lineageIdentitySha256: row.lineageIdentitySha256,
      status: row.status,
    };
}

async function assertPublishedOutputOwnership(input: {
  outputPath: string;
  ownedIdentity: OwnedFileIdentity;
  temporaryPath: string;
}): Promise<void> {
  const [outputStat, temporaryStat] = await Promise.all([
    lstat(input.outputPath),
    lstat(input.temporaryPath),
  ]);
  if (
    !outputStat.isFile() ||
    outputStat.isSymbolicLink() ||
    !temporaryStat.isFile() ||
    temporaryStat.isSymbolicLink() ||
    outputStat.dev !== input.ownedIdentity.dev ||
    outputStat.ino !== input.ownedIdentity.ino ||
    temporaryStat.dev !== input.ownedIdentity.dev ||
    temporaryStat.ino !== input.ownedIdentity.ino ||
    (outputStat.mode & 0o7777) !== 0o644 ||
    (temporaryStat.mode & 0o7777) !== 0o644
  ) {
    throw new Error(
      "C6 structural union published output ownership mismatch",
    );
  }
}

async function removePathIfOwned(
  path: string,
  ownedIdentity: OwnedFileIdentity,
): Promise<boolean> {
  let pathStat;
  try {
    pathStat = await lstat(path);
  } catch (error) {
    if (isErrorCode(error, "ENOENT")) {
      return false;
    }
    throw error;
  }
  if (
    !pathStat.isFile() ||
    pathStat.isSymbolicLink() ||
    pathStat.dev !== ownedIdentity.dev ||
    pathStat.ino !== ownedIdentity.ino
  ) {
    return false;
  }
  await rm(path);
  return true;
}

function isErrorCode(error: unknown, code: string): boolean {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code;
}

function normalizeLogin(value: string): string {
  const login = actorLoginSchema.parse(value);
  return login.toLowerCase();
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
