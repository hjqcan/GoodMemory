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
import { isDeepStrictEqual } from "node:util";

import { z } from "zod";

import {
  assertC6NoSymlinkPathComponents,
  readC6StableRegularFile,
} from "./c6-asset-lock";
import type {
  C6LiveMultiLangNeighborStructuralQualification,
} from "./c6-live-multilang-neighbor-structural-qualification";
import {
  parseC6LiveMultiLangNeighborStructuralQualification,
} from "./c6-live-multilang-neighbor-structural-qualification";
import type {
  C6LiveMultiLangNeighborStructuralUnion,
} from "./c6-live-multilang-neighbor-structural-union";
import {
  parseC6LiveMultiLangNeighborStructuralUnion,
} from "./c6-live-multilang-neighbor-structural-union";

const ARTIFACT_KIND = "c6-wave3-pretarget-policy";
const METADATA_ARTIFACT_KIND =
  "c6-live-multilang-neighbor-census-qualification";
const STRUCTURAL_ARTIFACT_KIND =
  "c6-live-multilang-neighbor-structural-qualification";
const STRUCTURAL_UNION_ARTIFACT_KIND =
  "c6-live-multilang-neighbor-structural-union";
const REVIEW_COUNT_MINIMUM = 4;
const REVIEW_THREAD_COUNT_MINIMUM = 2;
const COMMIT_TOTAL_COUNT_MAXIMUM = 250;

const FROZEN_EVIDENCE = {
  structuralUnion: {
    artifactKind: STRUCTURAL_UNION_ARTIFACT_KIND,
    bytes: 2_597_956,
    exactStructuralCandidateCount: 56,
    path:
      "swe-bench-live-multilang-608f7ae9." +
      "neighbor-structural-union-v1.json",
    pullAuthorOccurrenceProjectionSha256:
      "a35fe54aafc61279b769774c4c8e176a4a95c634cfdeaabb0f664772deb68c2c",
    reviewerActorOccurrenceProjectionSha256:
      "d426b898d5bddb5da2a187e5927695b3df6fb850168dc755ba0fd3c8e96c9fc7",
    reviewerLoginProjectionSha256:
      "4c03e130ce0b6c945f2bf526c3cfa0c25e5c17f0734cc34eafb264ebb9d56a61",
    schemaVersion: 1,
    sha256:
      "3a438e999450b96c039dbea6eba7ae971bb03223c42c2b2ff502f85ed76ad208",
    structuralResultProjectionSha256:
      "796eb8477e750a76ab96ae0eeccec00f7ee6a5feb03603e469630a7432d8a975",
    targetCount: 1_334,
  },
  wave1: {
    metadataQualification: {
      artifactKind: METADATA_ARTIFACT_KIND,
      bytes: 912_748,
      canonicalPullProjectionSha256:
        "06b6ac9ac67447b72a492e5e118b41d1eb9195895421e94ae8eb832b69c402c8",
      deepCaptureTargetProjectionSha256:
        "f45d9ef61b55d73d2b94c8018d7874ae58887fa01133a4fd77883f0548701404",
      excludedAnchorProjectionSha256:
        "f33883edbbca727e49ab68d77e517a02323174c85b973fb3f40452d4a2ea9f5b",
      existingAnchorProjectionSha256:
        "2a144a3e31a2451c8a8076a2146d0c08bf76c23d77e7ee6c3a3d174f1cbe3aa8",
      metadataQuerySha256:
        "ad41b6656f21f35e45a592e3b39549a02a0ae9536d01ac6052c1f31b0ee635d3",
      path:
        "swe-bench-live-multilang-608f7ae9." +
        "neighbor-census-qualification-v2.json",
      schemaVersion: 2,
      sha256:
        "e51243ea3aa740a3a0812f8c1289ac2d3cf51436440ae0ecfea67a280743f1cc",
      qualificationPolicySha256:
        "a80ef0981b35dc5479d9d8b346d14a4187494dbb0c0591bd4dd412cb49acb025",
    },
    observation: {
      exactStructuralCount: 29,
      exactStructuralProjectionSha256:
        "26334b3d80666ac16d1ce78af6e6263ac977a6d6824b8b5f3e635eccaa370453",
      metadataCount: 96,
      metadataProjectionSha256:
        "c0f062b6ec1fc0686047af36dee7cf21500222d41abce0e684c35c024a730d9d",
    },
    structuralQualification: {
      artifactKind: STRUCTURAL_ARTIFACT_KIND,
      bytes: 1_358_575,
      path:
        "swe-bench-live-multilang-608f7ae9." +
        "neighbor-structural-qualification-v1.json",
      pullAuthorOccurrenceProjectionSha256:
        "72b4f597546917d0140b07c516a6a8577849f4f54e8b8ef074177a47b4aeaffc",
      reviewerActorOccurrenceProjectionSha256:
        "881aafcfad9a9675e353adb8b2a3aaa8fd623ff0525c29ba34a3b08f29ee0c49",
      reviewerLoginProjectionSha256:
        "a26324b895357d9191a0d84baddbca968bea218859d968a743ebdd7b48f0aa34",
      schemaVersion: 1,
      sha256:
        "ae096d86f779cb04f1fb0bb336d6bb4e02ced04e72385d9332d4dba82a9c1210",
      structuralResultProjectionSha256:
        "f599d7ced72a3cebd4f175a059a604d2bb2c09b97d81e268dd18915cdd136081",
    },
  },
  wave2: {
    metadataQualification: {
      artifactKind: METADATA_ARTIFACT_KIND,
      bytes: 914_091,
      canonicalPullProjectionSha256:
        "2a286123ea113d8192e90e5da87e2a268f5adcb28e07aa5b1c082e04625fd58b",
      deepCaptureTargetProjectionSha256:
        "d4aefe655c93875656c48e789af96801ba02a98edb423d6da8303ef8ddc1dbe6",
      excludedAnchorProjectionSha256:
        "d01b8d6d6497ff590a2fffbc1b9fc718dae4ce41672173f24a97550187f38bdf",
      existingAnchorProjectionSha256:
        "2a144a3e31a2451c8a8076a2146d0c08bf76c23d77e7ee6c3a3d174f1cbe3aa8",
      metadataQuerySha256:
        "ad41b6656f21f35e45a592e3b39549a02a0ae9536d01ac6052c1f31b0ee635d3",
      path:
        "swe-bench-live-multilang-608f7ae9." +
        "neighbor-census-qualification-v3.json",
      schemaVersion: 3,
      sha256:
        "011c264e496fb849a1f14baee1289cb815e90bd81adfa4f6bec44d08b11030ef",
      qualificationPolicySha256:
        "a80ef0981b35dc5479d9d8b346d14a4187494dbb0c0591bd4dd412cb49acb025",
    },
    observation: {
      exactStructuralCount: 20,
      exactStructuralProjectionSha256:
        "06aa94c1e4189c4108e4d04fe78e9c22364d5bebc029aa6c96d38d7e85780f43",
      metadataCount: 74,
      metadataProjectionSha256:
        "af8f7bfe17059e97c80da6cb8542d2bcf264893e970a309a69ef4f1a84e7c08e",
    },
    structuralQualification: {
      artifactKind: STRUCTURAL_ARTIFACT_KIND,
      bytes: 1_159_147,
      path:
        "swe-bench-live-multilang-608f7ae9." +
        "neighbor-continuation-structural-qualification-v1.json",
      pullAuthorOccurrenceProjectionSha256:
        "724faa616c60707b316ee24fcd1b49f6366c993ce50905919937e4b1ee8b9d4b",
      reviewerActorOccurrenceProjectionSha256:
        "b70ac3ac8cf1ae8fe73c7c6ae6f849c5501ea7df4640335157e26cb6d90cdcef",
      reviewerLoginProjectionSha256:
        "0e4d2f838e1c3fe0cd50ce3ff7e84a9018f9ab482f21209f74df51a8ed835333",
      schemaVersion: 1,
      sha256:
        "9dc625cbfb5c1c0bc47f9b09511b9ce7c8df789bf4bcbaafa2d8d182dd88be91",
      structuralResultProjectionSha256:
        "398b700f0521054f8c3b491e34a741df2c0e733864dc679e365d40e992a541d3",
    },
  },
} as const;

const COMBINED_OBSERVATION = {
  exactStructuralCount: 49,
  exactStructuralProjectionSha256:
    "f98011f44136509ebb952df6665e388de63c65f709f67742ea26722067f42151",
  metadataCount: 170,
  metadataProjectionSha256:
    "c2fd1b14853158222e8ef012b3a93e7e71a1ca351808db21421a36c6738a41d0",
  scope:
    "review-count-and-thread-count-threshold-only-no-commit-count-observation",
} as const;

const DECISION_INPUTS = [
  "commitTotalCount",
  "reviewCount",
  "reviewThreadCount",
] as const;
const IDENTITY_ONLY_INPUTS = [
  {
    field: "canonicalAnchorId",
    permittedRoles: [
      "novelty-against-frozen-pre-wave3-exclusion",
      "deduplication",
    ],
  },
  {
    field: "canonicalRepository",
    permittedRoles: [
      "novelty-against-frozen-pre-wave3-exclusion",
      "deduplication",
      "repository-cap-grouping",
    ],
  },
  {
    field: "frozenPreWave3AnchorExclusions",
    permittedRoles: [
      "novelty-reference-set-only",
    ],
  },
  {
    field: "frozenPreWave3RepositoryExclusions",
    permittedRoles: [
      "novelty-reference-set-only",
    ],
  },
] as const;
const PROVENANCE_ONLY_INPUTS = [
  "authorLogin",
  "baseRefOid",
  "commentCount",
  "createdAt",
  "mergeCommitOid",
  "mergedAt",
  "sourceDataset",
  "sourceSplit",
  "url",
] as const;
const FORBIDDEN_SELECTION_INPUTS = [
  "acceptedEpisode",
  "actorEligibilityDecision",
  "actorIdentity",
  "body",
  "checkOutcome",
  "commitMessage",
  "deepCaptureOrder",
  "diff",
  "evaluatorDecision",
  "files",
  "gold",
  "hiddenTest",
  "language",
  "languageYield",
  "machineDecision",
  "observationRefs",
  "outcome",
  "patch",
  "pilotRank",
  "priorTrancheOutcome",
  "pullRequestBody",
  "pullRequestTitle",
  "rank",
  "repositoryYield",
  "responseNodeRank",
  "reviewBody",
  "selectedSequence",
  "semanticDecision",
  "status",
  "test",
  "testOutcome",
  "title",
] as const;

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const anchorSchema = z.string().regex(
  /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+#[1-9]\d*$/u,
);
const repositorySchema = z.string().regex(
  /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u,
);
const decisionInputSchema = z.object({
  canonicalAnchorId: anchorSchema,
  canonicalRepository: repositorySchema,
  commitTotalCount: z.number().int().nonnegative(),
  reviewCount: z.number().int().nonnegative(),
  reviewThreadCount: z.number().int().nonnegative(),
}).strict().superRefine((value, context) => {
  if (
    value.canonicalAnchorId.slice(
      0,
      value.canonicalAnchorId.lastIndexOf("#"),
    ) !== value.canonicalRepository
  ) {
    context.addIssue({
      code: "custom",
      message:
        "canonical anchor/repository identity mismatch",
    });
  }
});
const decisionContextSchema = z.object({
  frozenPreWave3AnchorExclusions:
    z.array(anchorSchema),
  frozenPreWave3RepositoryExclusions:
    z.array(repositorySchema),
}).strict();
const metadataResultSchema = z.object({
  canonicalAnchorId: anchorSchema,
  canonicalRepository: repositorySchema,
  reviewCount: z.number().int().nonnegative(),
  reviewThreadCount: z.number().int().nonnegative(),
  status: z.string().min(1),
}).passthrough();
const metadataQualificationSchema = z.object({
  artifactKind: z.literal(METADATA_ARTIFACT_KIND),
  counts: z.object({
    deepCaptureTargetCount: z.number().int().nonnegative(),
    rawObservationCount: z.number().int().nonnegative(),
  }).passthrough(),
  independenceBoundary: z.object({
    canonicalPullProjectionSha256: sha256Schema,
    deepCaptureTargetProjectionSha256: sha256Schema,
    excludedAnchorProjectionSha256: sha256Schema,
    existingAnchorProjectionSha256: sha256Schema,
    metadataQuerySha256: sha256Schema,
    qualificationPolicySha256: sha256Schema,
  }).passthrough(),
  results: z.array(metadataResultSchema).min(1),
  schemaVersion: z.number().int().positive(),
}).passthrough();
const frozenMetadataBindingSchema = z.object({
  artifactKind: z.literal(METADATA_ARTIFACT_KIND),
  bytes: z.number().int().positive(),
  canonicalPullProjectionSha256: sha256Schema,
  deepCaptureTargetProjectionSha256: sha256Schema,
  excludedAnchorProjectionSha256: sha256Schema,
  existingAnchorProjectionSha256: sha256Schema,
  metadataQuerySha256: sha256Schema,
  path: z.string().min(1),
  qualificationPolicySha256: sha256Schema,
  schemaVersion: z.number().int().positive(),
  sha256: sha256Schema,
}).strict();
const frozenStructuralBindingSchema = z.object({
  artifactKind: z.literal(STRUCTURAL_ARTIFACT_KIND),
  bytes: z.number().int().positive(),
  path: z.string().min(1),
  pullAuthorOccurrenceProjectionSha256: sha256Schema,
  reviewerActorOccurrenceProjectionSha256: sha256Schema,
  reviewerLoginProjectionSha256: sha256Schema,
  schemaVersion: z.literal(1),
  sha256: sha256Schema,
  structuralResultProjectionSha256: sha256Schema,
}).strict();
const observationSchema = z.object({
  exactStructuralCount: z.number().int().nonnegative(),
  exactStructuralProjectionSha256: sha256Schema,
  metadataCount: z.number().int().nonnegative(),
  metadataProjectionSha256: sha256Schema,
}).strict();
const waveEvidenceSchema = z.object({
  metadataQualification: frozenMetadataBindingSchema,
  reviewThresholdObservation: observationSchema,
  sourceWave: z.enum(["wave1", "wave2"]),
  structuralQualification: frozenStructuralBindingSchema,
}).strict();
const policySchema = z.object({
  artifactKind: z.literal(ARTIFACT_KIND),
  boundary: z.object({
    acceptedEpisodeCount: z.literal(0),
    codexRunReady: z.literal(false),
    commitAncestryProven: z.literal(false),
    independentReview: z.literal(false),
    preregisteredBeforeWave3Capture: z.literal(false),
    selectionExecuted: z.literal(false),
    status: z.literal("review-and-freeze-commit-required"),
  }).strict(),
  capacityPlanning: z.object({
    assumptions: z.object({
      actorSurvivalRate: z.literal(0.75),
      downstreamQualificationSurvivalRate: z.literal(0.25),
      preActorStructuralYieldRate: z.literal(0.15),
      repositoryCapSurvivalRate: z.literal(0.8),
    }).strict(),
    derivedActorCappedStructuralYieldRate: z.literal(0.09),
    status: z.literal("planning-only-not-acceptance-evidence"),
    targets: z.object({
      acceptedRegistryCount: z.literal(470),
      finalCandidateManifestEpisodeCount: z.literal(391),
      minimumRawMetadataCount: z.literal(240_000),
      minimumSelectedPretargetCount: z.literal(20_000),
      reserveRawMetadataCount: z.literal(615_000),
      reserveSelectedPretargetCount: z.literal(51_000),
    }).strict(),
  }).strict(),
  chronology: z.object({
    applicablePopulation: z.literal("unseen-wave3-only"),
    derivedAfterWave1AndWave2Inspection: z.literal(true),
    evidenceUse: z.literal("retrospective-exploratory-only"),
    wave1AndWave2BackselectionProhibited: z.literal(true),
  }).strict(),
  inputPolicy: z.object({
    decisionInputs: z.array(z.string()).length(
      DECISION_INPUTS.length,
    ),
    defaultDeny: z.literal(true),
    forbiddenSelectionInputs: z.array(z.string()).length(
      FORBIDDEN_SELECTION_INPUTS.length,
    ),
    identityOnlyInputs: z.array(z.object({
      field: z.string().min(1),
      permittedRoles: z.array(z.string().min(1)).min(1),
    }).strict()).length(
      IDENTITY_ONLY_INPUTS.length,
    ),
    provenanceOnlyInputs: z.array(z.string()).length(
      PROVENANCE_ONLY_INPUTS.length,
    ),
    strictDecisionInputSchema: z.literal(
      "c6-wave3-pretarget-decision-input-v1",
    ),
  }).strict(),
  observedEvidence: z.object({
    combined: z.object({
      exactStructuralCount: z.literal(
        COMBINED_OBSERVATION.exactStructuralCount,
      ),
      exactStructuralProjectionSha256: sha256Schema,
      metadataCount: z.literal(COMBINED_OBSERVATION.metadataCount),
      metadataProjectionSha256: sha256Schema,
      scope: z.literal(COMBINED_OBSERVATION.scope),
    }).strict(),
    structuralUnion: z.object({
      artifactKind: z.literal(STRUCTURAL_UNION_ARTIFACT_KIND),
      bytes: z.number().int().positive(),
      exactStructuralCandidateCount: z.literal(56),
      path: z.string().min(1),
      pullAuthorOccurrenceProjectionSha256: sha256Schema,
      reviewerActorOccurrenceProjectionSha256: sha256Schema,
      reviewerLoginProjectionSha256: sha256Schema,
      schemaVersion: z.literal(1),
      sha256: sha256Schema,
      structuralResultProjectionSha256: sha256Schema,
      targetCount: z.literal(1_334),
    }).strict(),
    waves: z.array(waveEvidenceSchema).length(2),
  }).strict(),
  rule: z.object({
    canonicalPullRequestNovelAgainst: z.literal(
      "frozen-pre-wave3-anchor-exclusion-set",
    ),
    canonicalRepositoryNovelAgainst: z.literal(
      "frozen-pre-wave3-repository-exclusion-set",
    ),
    maximumCommitTotalCount: z.literal(
      COMMIT_TOTAL_COUNT_MAXIMUM,
    ),
    minimumReviewCount: z.literal(REVIEW_COUNT_MINIMUM),
    minimumReviewThreadCount: z.literal(
      REVIEW_THREAD_COUNT_MINIMUM,
    ),
  }).strict(),
  schemaVersion: z.literal(1),
}).strict();

type MetadataQualification = z.infer<
  typeof metadataQualificationSchema
>;

export type C6Wave3PretargetPolicy = z.infer<typeof policySchema>;

export type C6Wave3PretargetDecisionReason =
  | "canonical-pull-request-not-novel"
  | "canonical-repository-not-novel"
  | "commit-total-count-above-maximum"
  | "review-count-below-minimum"
  | "review-thread-count-below-minimum";

export function classifyC6Wave3Pretarget(
  input: unknown,
  contextInput: unknown,
): {
  eligible: boolean;
  reasons: C6Wave3PretargetDecisionReason[];
} {
  const decision = decisionInputSchema.parse(input);
  const context = decisionContextSchema.parse(contextInput);
  const reasons: C6Wave3PretargetDecisionReason[] = [];
  if (
    context.frozenPreWave3AnchorExclusions.includes(
      decision.canonicalAnchorId,
    )
  ) {
    reasons.push("canonical-pull-request-not-novel");
  }
  if (
    context.frozenPreWave3RepositoryExclusions.includes(
      decision.canonicalRepository,
    )
  ) {
    reasons.push("canonical-repository-not-novel");
  }
  if (decision.commitTotalCount > COMMIT_TOTAL_COUNT_MAXIMUM) {
    reasons.push("commit-total-count-above-maximum");
  }
  if (decision.reviewCount < REVIEW_COUNT_MINIMUM) {
    reasons.push("review-count-below-minimum");
  }
  if (
    decision.reviewThreadCount <
      REVIEW_THREAD_COUNT_MINIMUM
  ) {
    reasons.push("review-thread-count-below-minimum");
  }
  return {
    eligible: reasons.length === 0,
    reasons,
  };
}

export interface C6Wave3PretargetPolicyTestHooks {
  afterOutputPublication?: () => Promise<void> | void;
  beforeTerminalReplay?: () => Promise<void> | void;
}

export interface C6Wave3PretargetPolicyBuildInput {
  structuralUnionPath: string;
  testHooks?: C6Wave3PretargetPolicyTestHooks;
  wave1MetadataQualificationPath: string;
  wave1StructuralQualificationPath: string;
  wave2MetadataQualificationPath: string;
  wave2StructuralQualificationPath: string;
}

export async function buildC6Wave3PretargetPolicy(
  input: C6Wave3PretargetPolicyBuildInput,
): Promise<{
  outputSha256: string;
  policy: C6Wave3PretargetPolicy;
}> {
  const initial = await readEvidenceClosure(input);
  const policy = deriveC6Wave3PretargetPolicy(initial);
  const serialized = serializeC6Wave3PretargetPolicy(policy);

  await input.testHooks?.beforeTerminalReplay?.();
  const terminal = await readEvidenceClosure(input);
  const terminalSerialized = serializeC6Wave3PretargetPolicy(
    deriveC6Wave3PretargetPolicy(terminal),
  );
  if (
    terminalSerialized !== serialized ||
    terminal.closureProjectionSha256 !==
      initial.closureProjectionSha256
  ) {
    throw new Error(
      "C6 Wave3 pretarget policy input closure changed",
    );
  }
  parseC6Wave3PretargetPolicy(serialized);
  return {
    outputSha256: sha256(serialized),
    policy,
  };
}

export function serializeC6Wave3PretargetPolicy(
  policy: C6Wave3PretargetPolicy,
): string {
  const parsed = policySchema.parse(policy);
  assertPolicySelfConsistency(parsed);
  return `${JSON.stringify(parsed, null, 2)}\n`;
}

export function parseC6Wave3PretargetPolicy(
  input: string | Uint8Array,
): C6Wave3PretargetPolicy {
  const text = typeof input === "string"
    ? input
    : Buffer.from(input).toString("utf8");
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch {
    throw new Error("C6 Wave3 pretarget policy invalid JSON");
  }
  if (text !== `${JSON.stringify(raw, null, 2)}\n`) {
    throw new Error(
      "C6 Wave3 pretarget policy requires canonical JSON",
    );
  }
  const policy = policySchema.parse(raw);
  assertPolicySelfConsistency(policy);
  return policy;
}

export async function materializeC6Wave3PretargetPolicy(
  input:
    C6Wave3PretargetPolicyBuildInput & {
      outputPath: string;
    },
): Promise<{
  outputSha256: string;
  policy: C6Wave3PretargetPolicy;
}> {
  const result = await buildC6Wave3PretargetPolicy(input);
  const serialized = serializeC6Wave3PretargetPolicy(result.policy);
  const outputPath = resolve(input.outputPath);
  const outputParent = await assertC6NoSymlinkPathComponents(
    dirname(outputPath),
    "C6 Wave3 pretarget policy output parent",
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
          "C6 Wave3 pretarget policy temporary output identity mismatch",
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
      "C6 Wave3 pretarget policy temporary output",
    );
    if (temporaryBytes.toString("utf8") !== serialized) {
      throw new Error(
        "C6 Wave3 pretarget policy temporary output mismatch",
      );
    }
    await assertC6NoSymlinkPathComponents(
      outputParent,
      "C6 Wave3 pretarget policy terminal output parent",
    );
    await link(temporaryPath, outputPath);
    await assertPublishedOutputOwnership({
      outputPath,
      ownedIdentity,
      temporaryPath,
    });

    await input.testHooks?.afterOutputPublication?.();
    const replayed = await buildC6Wave3PretargetPolicy({
      structuralUnionPath: input.structuralUnionPath,
      wave1MetadataQualificationPath:
        input.wave1MetadataQualificationPath,
      wave1StructuralQualificationPath:
        input.wave1StructuralQualificationPath,
      wave2MetadataQualificationPath:
        input.wave2MetadataQualificationPath,
      wave2StructuralQualificationPath:
        input.wave2StructuralQualificationPath,
    });
    if (
      replayed.outputSha256 !== result.outputSha256 ||
      serializeC6Wave3PretargetPolicy(replayed.policy) !==
        serialized
    ) {
      throw new Error(
        "C6 Wave3 pretarget policy post-publication replay mismatch",
      );
    }
    await assertPublishedOutputOwnership({
      outputPath,
      ownedIdentity,
      temporaryPath,
    });
    const publishedBytes = await readC6StableRegularFile(
      outputPath,
      "C6 Wave3 pretarget policy published output",
    );
    if (
      serializeC6Wave3PretargetPolicy(
        parseC6Wave3PretargetPolicy(publishedBytes),
      ) !== serialized
    ) {
      throw new Error(
        "C6 Wave3 pretarget policy published output mismatch",
      );
    }
    await assertPublishedOutputOwnership({
      outputPath,
      ownedIdentity,
      temporaryPath,
    });
    if (!await removePathIfOwned(temporaryPath, ownedIdentity)) {
      throw new Error(
        "C6 Wave3 pretarget policy temporary output cleanup mismatch",
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

interface EvidenceClosure {
  closureProjectionSha256: string;
  structuralUnion: C6LiveMultiLangNeighborStructuralUnion;
  wave1MetadataQualification: MetadataQualification;
  wave1StructuralQualification:
    C6LiveMultiLangNeighborStructuralQualification;
  wave2MetadataQualification: MetadataQualification;
  wave2StructuralQualification:
    C6LiveMultiLangNeighborStructuralQualification;
}

interface FrozenFileBinding {
  bytes: number;
  path: string;
  sha256: string;
}

interface OwnedFileIdentity {
  dev: number;
  ino: number;
}

interface ThresholdProjectionRow {
  canonicalAnchorId: string;
  canonicalRepository: string;
  reviewCount: number;
  reviewThreadCount: number;
}

function deriveC6Wave3PretargetPolicy(
  evidence: EvidenceClosure,
): C6Wave3PretargetPolicy {
  assertStructuralUnion(evidence.structuralUnion);
  const wave1 = deriveWaveEvidence({
    frozen: FROZEN_EVIDENCE.wave1,
    metadataQualification:
      evidence.wave1MetadataQualification,
    sourceWave: "wave1",
    structuralQualification:
      evidence.wave1StructuralQualification,
  });
  const wave2 = deriveWaveEvidence({
    frozen: FROZEN_EVIDENCE.wave2,
    metadataQualification:
      evidence.wave2MetadataQualification,
    sourceWave: "wave2",
    structuralQualification:
      evidence.wave2StructuralQualification,
  });
  const combinedMetadataProjection = [
    ...wave1.thresholdRows.map((row) => ({
      sourceWave: "wave1" as const,
      ...row,
    })),
    ...wave2.thresholdRows.map((row) => ({
      sourceWave: "wave2" as const,
      ...row,
    })),
  ];
  const combinedExactProjection = [
    ...wave1.exactRows.map((row) => ({
      sourceWave: "wave1" as const,
      ...row,
    })),
    ...wave2.exactRows.map((row) => ({
      sourceWave: "wave2" as const,
      ...row,
    })),
  ];
  if (
    combinedMetadataProjection.length !==
      COMBINED_OBSERVATION.metadataCount ||
    combinedExactProjection.length !==
      COMBINED_OBSERVATION.exactStructuralCount ||
    sha256(JSON.stringify(combinedMetadataProjection)) !==
      COMBINED_OBSERVATION.metadataProjectionSha256 ||
    sha256(JSON.stringify(combinedExactProjection)) !==
      COMBINED_OBSERVATION.exactStructuralProjectionSha256
  ) {
    throw new Error(
      "C6 Wave3 pretarget policy combined evidence mismatch",
    );
  }

  const policy = policySchema.parse({
    artifactKind: ARTIFACT_KIND,
    boundary: {
      acceptedEpisodeCount: 0,
      codexRunReady: false,
      commitAncestryProven: false,
      independentReview: false,
      preregisteredBeforeWave3Capture: false,
      selectionExecuted: false,
      status: "review-and-freeze-commit-required",
    },
    capacityPlanning: {
      assumptions: {
        actorSurvivalRate: 0.75,
        downstreamQualificationSurvivalRate: 0.25,
        preActorStructuralYieldRate: 0.15,
        repositoryCapSurvivalRate: 0.8,
      },
      derivedActorCappedStructuralYieldRate: 0.09,
      status: "planning-only-not-acceptance-evidence",
      targets: {
        acceptedRegistryCount: 470,
        finalCandidateManifestEpisodeCount: 391,
        minimumRawMetadataCount: 240_000,
        minimumSelectedPretargetCount: 20_000,
        reserveRawMetadataCount: 615_000,
        reserveSelectedPretargetCount: 51_000,
      },
    },
    chronology: {
      applicablePopulation: "unseen-wave3-only",
      derivedAfterWave1AndWave2Inspection: true,
      evidenceUse: "retrospective-exploratory-only",
      wave1AndWave2BackselectionProhibited: true,
    },
    inputPolicy: {
      decisionInputs: [...DECISION_INPUTS],
      defaultDeny: true,
      forbiddenSelectionInputs: [...FORBIDDEN_SELECTION_INPUTS],
      identityOnlyInputs: IDENTITY_ONLY_INPUTS.map((input) => ({
        field: input.field,
        permittedRoles: [...input.permittedRoles],
      })),
      provenanceOnlyInputs: [...PROVENANCE_ONLY_INPUTS],
      strictDecisionInputSchema:
        "c6-wave3-pretarget-decision-input-v1",
    },
    observedEvidence: {
      combined: COMBINED_OBSERVATION,
      structuralUnion: FROZEN_EVIDENCE.structuralUnion,
      waves: [
        wave1.artifact,
        wave2.artifact,
      ],
    },
    rule: {
      canonicalPullRequestNovelAgainst:
        "frozen-pre-wave3-anchor-exclusion-set",
      canonicalRepositoryNovelAgainst:
        "frozen-pre-wave3-repository-exclusion-set",
      maximumCommitTotalCount: COMMIT_TOTAL_COUNT_MAXIMUM,
      minimumReviewCount: REVIEW_COUNT_MINIMUM,
      minimumReviewThreadCount: REVIEW_THREAD_COUNT_MINIMUM,
    },
    schemaVersion: 1,
  });
  assertPolicySelfConsistency(policy);
  return policy;
}

function deriveWaveEvidence(input: {
  frozen: typeof FROZEN_EVIDENCE.wave1 |
    typeof FROZEN_EVIDENCE.wave2;
  metadataQualification: MetadataQualification;
  sourceWave: "wave1" | "wave2";
  structuralQualification:
    C6LiveMultiLangNeighborStructuralQualification;
}): {
  artifact: z.infer<typeof waveEvidenceSchema>;
  exactRows: ThresholdProjectionRow[];
  thresholdRows: ThresholdProjectionRow[];
} {
  const {
    frozen,
    metadataQualification,
    sourceWave,
    structuralQualification,
  } = input;
  if (
    metadataQualification.schemaVersion !==
      frozen.metadataQualification.schemaVersion ||
    metadataQualification.independenceBoundary
      .canonicalPullProjectionSha256 !==
        frozen.metadataQualification
          .canonicalPullProjectionSha256 ||
    metadataQualification.independenceBoundary
      .deepCaptureTargetProjectionSha256 !==
        frozen.metadataQualification
          .deepCaptureTargetProjectionSha256 ||
    metadataQualification.independenceBoundary
      .excludedAnchorProjectionSha256 !==
        frozen.metadataQualification
          .excludedAnchorProjectionSha256 ||
    metadataQualification.independenceBoundary
      .existingAnchorProjectionSha256 !==
        frozen.metadataQualification
          .existingAnchorProjectionSha256 ||
    metadataQualification.independenceBoundary
      .metadataQuerySha256 !==
        frozen.metadataQualification.metadataQuerySha256 ||
    metadataQualification.independenceBoundary
      .qualificationPolicySha256 !==
        frozen.metadataQualification.qualificationPolicySha256 ||
    structuralQualification.independenceBoundary
      .pullAuthorOccurrenceProjectionSha256 !==
        frozen.structuralQualification
          .pullAuthorOccurrenceProjectionSha256 ||
    structuralQualification.independenceBoundary
      .reviewerActorOccurrenceProjectionSha256 !==
        frozen.structuralQualification
          .reviewerActorOccurrenceProjectionSha256 ||
    structuralQualification.independenceBoundary
      .reviewerLoginProjectionSha256 !==
        frozen.structuralQualification
          .reviewerLoginProjectionSha256 ||
    structuralQualification.independenceBoundary
      .structuralResultProjectionSha256 !==
        frozen.structuralQualification
          .structuralResultProjectionSha256
  ) {
    throw new Error(
      `C6 Wave3 pretarget policy ${sourceWave} projection mismatch`,
    );
  }
  const structuralAnchors = new Set<string>();
  const exactAnchors = new Set<string>();
  for (const result of structuralQualification.results) {
    if (structuralAnchors.has(result.canonicalAnchorId)) {
      throw new Error(
        `C6 Wave3 pretarget policy ${sourceWave} duplicate structural anchor`,
      );
    }
    structuralAnchors.add(result.canonicalAnchorId);
    if (
      result.status ===
        "exact-structural-candidate-pre-actor"
    ) {
      exactAnchors.add(result.canonicalAnchorId);
    }
  }
  const metadataAnchors = new Set<string>();
  const thresholdRows: ThresholdProjectionRow[] = [];
  for (const result of metadataQualification.results) {
    if (metadataAnchors.has(result.canonicalAnchorId)) {
      throw new Error(
        `C6 Wave3 pretarget policy ${sourceWave} duplicate metadata anchor`,
      );
    }
    metadataAnchors.add(result.canonicalAnchorId);
    if (
      result.status ===
        "novel-review-surface-deep-capture-target" &&
      result.reviewCount >= REVIEW_COUNT_MINIMUM &&
      result.reviewThreadCount >=
        REVIEW_THREAD_COUNT_MINIMUM
    ) {
      thresholdRows.push({
        canonicalAnchorId: result.canonicalAnchorId,
        canonicalRepository: result.canonicalRepository,
        reviewCount: result.reviewCount,
        reviewThreadCount: result.reviewThreadCount,
      });
    }
  }
  for (const anchor of structuralAnchors) {
    if (!metadataAnchors.has(anchor)) {
      throw new Error(
        `C6 Wave3 pretarget policy ${sourceWave} structural anchor not in metadata`,
      );
    }
  }
  const exactRows = thresholdRows.filter((row) =>
    exactAnchors.has(row.canonicalAnchorId)
  );
  if (
    thresholdRows.length !== frozen.observation.metadataCount ||
    exactRows.length !==
      frozen.observation.exactStructuralCount ||
    sha256(JSON.stringify(thresholdRows)) !==
      frozen.observation.metadataProjectionSha256 ||
    sha256(JSON.stringify(exactRows)) !==
      frozen.observation.exactStructuralProjectionSha256
  ) {
    throw new Error(
      `C6 Wave3 pretarget policy ${sourceWave} observed yield mismatch`,
    );
  }
  return {
    artifact: {
      metadataQualification: frozen.metadataQualification,
      reviewThresholdObservation: frozen.observation,
      sourceWave,
      structuralQualification: frozen.structuralQualification,
    },
    exactRows,
    thresholdRows,
  };
}

function assertStructuralUnion(
  union: C6LiveMultiLangNeighborStructuralUnion,
): void {
  const frozen = FROZEN_EVIDENCE.structuralUnion;
  if (
    union.counts.exactStructuralCandidateCount !==
      frozen.exactStructuralCandidateCount ||
    union.counts.targetCount !== frozen.targetCount ||
    union.independenceBoundary
      .pullAuthorOccurrenceProjectionSha256 !==
        frozen.pullAuthorOccurrenceProjectionSha256 ||
    union.independenceBoundary
      .reviewerActorOccurrenceProjectionSha256 !==
        frozen.reviewerActorOccurrenceProjectionSha256 ||
    union.independenceBoundary
      .reviewerLoginProjectionSha256 !==
        frozen.reviewerLoginProjectionSha256 ||
    union.independenceBoundary
      .structuralResultProjectionSha256 !==
        frozen.structuralResultProjectionSha256 ||
    union.inputs.wave1.qualification.sha256 !==
      FROZEN_EVIDENCE.wave1.structuralQualification.sha256 ||
    union.inputs.wave2.qualification.sha256 !==
      FROZEN_EVIDENCE.wave2.structuralQualification.sha256
  ) {
    throw new Error(
      "C6 Wave3 pretarget policy structural union mismatch",
    );
  }
}

function assertPolicySelfConsistency(
  policy: C6Wave3PretargetPolicy,
): void {
  const [wave1, wave2] = policy.observedEvidence.waves;
  const derivedRate =
    policy.capacityPlanning.assumptions
      .preActorStructuralYieldRate *
    policy.capacityPlanning.assumptions.actorSurvivalRate *
    policy.capacityPlanning.assumptions.repositoryCapSurvivalRate;
  if (
    !isDeepStrictEqual(
      policy.inputPolicy.decisionInputs,
      DECISION_INPUTS,
    ) ||
    !isDeepStrictEqual(
      policy.inputPolicy.identityOnlyInputs,
      IDENTITY_ONLY_INPUTS,
    ) ||
    !isDeepStrictEqual(
      policy.inputPolicy.provenanceOnlyInputs,
      PROVENANCE_ONLY_INPUTS,
    ) ||
    !isDeepStrictEqual(
      policy.inputPolicy.forbiddenSelectionInputs,
      FORBIDDEN_SELECTION_INPUTS,
    ) ||
    !isDeepStrictEqual(wave1, {
      metadataQualification:
        FROZEN_EVIDENCE.wave1.metadataQualification,
      reviewThresholdObservation:
        FROZEN_EVIDENCE.wave1.observation,
      sourceWave: "wave1",
      structuralQualification:
        FROZEN_EVIDENCE.wave1.structuralQualification,
    }) ||
    !isDeepStrictEqual(wave2, {
      metadataQualification:
        FROZEN_EVIDENCE.wave2.metadataQualification,
      reviewThresholdObservation:
        FROZEN_EVIDENCE.wave2.observation,
      sourceWave: "wave2",
      structuralQualification:
        FROZEN_EVIDENCE.wave2.structuralQualification,
    }) ||
    !isDeepStrictEqual(
      policy.observedEvidence.combined,
      COMBINED_OBSERVATION,
    ) ||
    !isDeepStrictEqual(
      policy.observedEvidence.structuralUnion,
      FROZEN_EVIDENCE.structuralUnion,
    ) ||
    Math.abs(
      derivedRate -
      policy.capacityPlanning
        .derivedActorCappedStructuralYieldRate,
    ) > Number.EPSILON
  ) {
    throw new Error(
      "C6 Wave3 pretarget policy self-consistency mismatch",
    );
  }
}

async function readEvidenceClosure(
  input: C6Wave3PretargetPolicyBuildInput,
): Promise<EvidenceClosure> {
  const [
    structuralUnionBytes,
    wave1MetadataBytes,
    wave1StructuralBytes,
    wave2MetadataBytes,
    wave2StructuralBytes,
  ] = await Promise.all([
    readFrozenFile(
      input.structuralUnionPath,
      FROZEN_EVIDENCE.structuralUnion,
      "structural union",
    ),
    readFrozenFile(
      input.wave1MetadataQualificationPath,
      FROZEN_EVIDENCE.wave1.metadataQualification,
      "Wave1 metadata qualification",
    ),
    readFrozenFile(
      input.wave1StructuralQualificationPath,
      FROZEN_EVIDENCE.wave1.structuralQualification,
      "Wave1 structural qualification",
    ),
    readFrozenFile(
      input.wave2MetadataQualificationPath,
      FROZEN_EVIDENCE.wave2.metadataQualification,
      "Wave2 metadata qualification",
    ),
    readFrozenFile(
      input.wave2StructuralQualificationPath,
      FROZEN_EVIDENCE.wave2.structuralQualification,
      "Wave2 structural qualification",
    ),
  ]);
  return {
    closureProjectionSha256: sha256(JSON.stringify([
      sha256(wave1MetadataBytes),
      sha256(wave1StructuralBytes),
      sha256(wave2MetadataBytes),
      sha256(wave2StructuralBytes),
      sha256(structuralUnionBytes),
    ])),
    structuralUnion:
      parseC6LiveMultiLangNeighborStructuralUnion(
        structuralUnionBytes,
      ),
    wave1MetadataQualification:
      parseMetadataQualification(
        wave1MetadataBytes,
        "Wave1",
      ),
    wave1StructuralQualification:
      parseC6LiveMultiLangNeighborStructuralQualification(
        wave1StructuralBytes,
      ),
    wave2MetadataQualification:
      parseMetadataQualification(
        wave2MetadataBytes,
        "Wave2",
      ),
    wave2StructuralQualification:
      parseC6LiveMultiLangNeighborStructuralQualification(
        wave2StructuralBytes,
      ),
  };
}

async function readFrozenFile(
  pathInput: string,
  binding: FrozenFileBinding,
  label: string,
): Promise<Buffer> {
  const path = await assertC6NoSymlinkPathComponents(
    pathInput,
    `C6 Wave3 pretarget policy ${label}`,
  );
  const bytes = await readC6StableRegularFile(
    path,
    `C6 Wave3 pretarget policy ${label}`,
  );
  if (
    basename(path) !== binding.path ||
    bytes.byteLength !== binding.bytes ||
    sha256(bytes) !== binding.sha256
  ) {
    throw new Error(
      `C6 Wave3 pretarget policy ${label} hash mismatch`,
    );
  }
  return bytes;
}

function parseMetadataQualification(
  bytes: Uint8Array,
  label: string,
): MetadataQualification {
  const text = Buffer.from(bytes).toString("utf8");
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch {
    throw new Error(
      `C6 Wave3 pretarget policy ${label} metadata invalid JSON`,
    );
  }
  if (text !== `${JSON.stringify(raw, null, 2)}\n`) {
    throw new Error(
      `C6 Wave3 pretarget policy ${label} metadata requires canonical JSON`,
    );
  }
  return metadataQualificationSchema.parse(raw);
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
      "C6 Wave3 pretarget policy published output ownership mismatch",
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

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
