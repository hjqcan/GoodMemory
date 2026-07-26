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
import {
  parseC6LiveMultiLangNeighborStructuralUnion,
} from "./c6-live-multilang-neighbor-structural-union";
import type {
  C6LiveMultiLangNeighborStructuralUnion,
} from "./c6-live-multilang-neighbor-structural-union";
import {
  parseC6Wave3PretargetPolicy,
} from "./c6-wave3-pretarget-policy";
import type {
  C6Wave3PretargetPolicy,
} from "./c6-wave3-pretarget-policy";

const ARTIFACT_KIND = "c6-wave3-source-universe";
const PRETARGET_POLICY_ARTIFACT_KIND =
  "c6-wave3-pretarget-policy";
const PRIOR_FRAME_ARTIFACT_KIND =
  "c6-reviewer-actor-qualified-screening-frame";
const STRUCTURAL_UNION_ARTIFACT_KIND =
  "c6-live-multilang-neighbor-structural-union";
const ACCESSIBLE_RESULT_CAP = 1_000;
const PAGE_SIZE = 100;
const ROOT_WINDOW_COUNT = 192;
const ROOT_SHARD_COUNT = 1_536;
const PRE_WAVE3_ANCHOR_COUNT = 1_447;
const PRE_WAVE3_REPOSITORY_COUNT = 178;

const ACTIVATION_SALT_DOMAIN =
  "goodmemory:c6:wave3-activation-plan:v1:" +
  "activation-salt";
const ROOT_SHARD_KEY_DOMAIN =
  "goodmemory:c6:wave3-activation-plan:v1:" +
  "root-shard-order-key";
const REPOSITORY_KEY_DOMAIN =
  "goodmemory:c6:wave3-activation-plan:v1:" +
  "repository-order-key";
const PULL_REQUEST_KEY_DOMAIN =
  "goodmemory:c6:wave3-activation-plan:v1:" +
  "pull-request-order-key";

const QUICKNET = {
  beaconId: "quicknet",
  chainHash:
    "52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971",
  genesisTimeUnixSeconds: 1_692_803_367,
  groupHash:
    "f477d5c89f21a17c863a7f937c6a6d15859414d2be09cd448d4279af331c5d3e",
  periodSeconds: 3,
  publicKey:
    "83cf0f2896adee7eb8b5f01fcad3912212c437e0073e911fb90022d3e760183c8c4b450b6a0a6c3ac6a5776a2d1064510d1fec758c921cc22b0e17e63aaf4bcb5ed66304de9cf809bd274ca73bab4af5a6e9c76a4bc09e76eae8991ef5ece45a",
  scheme: "bls-unchained-g1-rfc9380",
} as const;

const FROZEN_INPUTS = {
  pretargetPolicy: {
    artifactKind: PRETARGET_POLICY_ARTIFACT_KIND,
    bytes: 9_105,
    path:
      "swe-bench-live-multilang-608f7ae9." +
      "wave3-pretarget-policy-v1.json",
    schemaVersion: 1,
    sha256:
      "eb3df63ff269b1d0166ed4b2faba682d60cdce3fb1ea64946e66f08e5eda9856",
  },
  priorFrame: {
    artifactKind: PRIOR_FRAME_ARTIFACT_KIND,
    bytes: 88_335,
    candidateCount: 113,
    candidateProjectionSha256:
      "1d0c5689521aa906e7fb2bf015579bbcc7638b31093966edec5339724aec82af",
    path:
      "multi-source." +
      "reviewer-actor-qualified-screening-frame-v1.json",
    schemaVersion: 1,
    sha256:
      "6838de7f36875b3b3de104ffd896b9e30dcf95ad1eb285a87b465789800f4b0c",
  },
  structuralUnion: {
    artifactKind: STRUCTURAL_UNION_ARTIFACT_KIND,
    bytes: 2_597_956,
    path:
      "swe-bench-live-multilang-608f7ae9." +
      "neighbor-structural-union-v1.json",
    schemaVersion: 1,
    sha256:
      "3a438e999450b96c039dbea6eba7ae971bb03223c42c2b2ff502f85ed76ad208",
    targetCount: 1_334,
  },
} as const;

const FROZEN_EXCLUSION_PROJECTIONS = {
  anchors:
    "a8d40b7c4f786a918807bbb5dc17e0be18b1ab6e4858f1e8af0d8deaaa6c5ebd",
  repositories:
    "360da907fb4dd3c4e3e023c528b90e8f5401e5f52bc13b69fcce034b8b44ab01",
} as const;

const LANGUAGE_SPLITS = [
  { language: "C", split: "c" },
  { language: "C++", split: "cpp" },
  { language: "Go", split: "go" },
  { language: "JavaScript", split: "js" },
  { language: "Rust", split: "rust" },
  { language: "Java", split: "java" },
  { language: "TypeScript", split: "ts" },
  { language: "C#", split: "cs" },
] as const;

const SOURCE_FRAME_MEMBERSHIP_INPUTS = [
  "createdAt",
  "isArchived",
  "isFork",
  "isMirror",
  "isTemplate",
  "language",
  "pushedAt",
  "visibility",
] as const;

const FORBIDDEN_INPUTS = [
  "acceptedEpisode",
  "actorDecision",
  "body",
  "checkOutcome",
  "commitMessage",
  "diff",
  "downstreamYield",
  "evaluatorDecision",
  "files",
  "gold",
  "hiddenTest",
  "languageYield",
  "machineDecision",
  "outcome",
  "patch",
  "pilotRank",
  "pullRequestBody",
  "pullRequestTitle",
  "rank",
  "repositoryYield",
  "responseNodeRank",
  "reviewBody",
  "selectedSequence",
  "semanticDecision",
  "test",
  "testOutcome",
  "title",
] as const;

const ACTIVATION_FORBIDDEN_SIGNALS = [
  "acceptedEpisode",
  "actorDecision",
  "downstreamYield",
  "evaluatorDecision",
  "gold",
  "hiddenTest",
  "languageYield",
  "machineDecision",
  "outcome",
  "patch",
  "rank",
  "repositoryYield",
  "semanticDecision",
  "testOutcome",
] as const;

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const utcSecondSchema = z.string().regex(
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u,
);
const repositorySchema = z.string().regex(
  /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u,
);
const anchorSchema = z.string().regex(
  /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+#[1-9]\d*$/u,
);
const languageSchema = z.enum([
  "C",
  "C++",
  "Go",
  "JavaScript",
  "Rust",
  "Java",
  "TypeScript",
  "C#",
]);
const splitSchema = z.enum([
  "c",
  "cpp",
  "go",
  "js",
  "rust",
  "java",
  "ts",
  "cs",
]);
const repositoryQueryInputSchema = z.object({
  createdFrom: utcSecondSchema,
  createdTo: utcSecondSchema,
  language: languageSchema,
}).strict();
const priorFrameCandidateSchema = z.object({
  canonicalAnchorId: anchorSchema,
  canonicalRepository: repositorySchema,
}).passthrough();
const priorFrameSchema = z.object({
  artifactKind: z.literal(PRIOR_FRAME_ARTIFACT_KIND),
  candidates: z.array(priorFrameCandidateSchema).length(
    FROZEN_INPUTS.priorFrame.candidateCount,
  ),
  independenceBoundary: z.object({
    candidateProjectionSha256: z.literal(
      FROZEN_INPUTS.priorFrame.candidateProjectionSha256,
    ),
  }).passthrough(),
  schemaVersion: z.literal(1),
}).passthrough();
const artifactReferenceSchema = z.object({
  artifactKind: z.string().min(1),
  bytes: z.number().int().positive(),
  path: z.string().min(1),
  schemaVersion: z.number().int().positive(),
  sha256: sha256Schema,
}).strict();
const rootShardSchema = z.object({
  createdFrom: utcSecondSchema,
  createdTo: utcSecondSchema,
  query: z.string().min(1),
  rootShardId: z.string().regex(
    /^(c|cpp|go|js|rust|java|ts|cs):\d{4}-\d{2}-\d{2}$/u,
  ),
  windowId: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
}).strict();
const languageSplitSchema = z.object({
  language: languageSchema,
  rootShards: z.array(rootShardSchema).length(ROOT_WINDOW_COUNT),
  split: splitSchema,
}).strict();

const sourceUniverseSchema = z.object({
  activationPlanProtocol: z.object({
    activationMaterialPresent: z.literal(false),
    completeShardOnly: z.literal(true),
    forbiddenSignals: z.array(
      z.enum(ACTIVATION_FORBIDDEN_SIGNALS),
    ).length(ACTIVATION_FORBIDDEN_SIGNALS.length),
    keyDerivationProtocol: z.object({
      activationSalt: z.object({
        actualInputValuesPresent: z.literal(false),
        domain: z.literal(ACTIVATION_SALT_DOMAIN),
        evaluationId: z.object({
          callerOverrideAccepted: z.literal(false),
          frozenInSourceArtifact: z.literal(false),
          requiredInC0CommitmentProfile: z.literal(true),
        }).strict(),
        formula: z.literal(
          "sha256(domain NUL evaluationId NUL commitmentSha256 NUL roundDecimal NUL randomnessHex)",
        ),
        inputSource: z.literal(
          "future-accepted-commitment-and-verified-fixed-round-receipt",
        ),
      }).strict(),
      algorithm: z.literal("sha256"),
      callerNonceAccepted: z.literal(false),
      callerRoundOverrideAccepted: z.literal(false),
      callerSaltAccepted: z.literal(false),
      encoding: z.literal(
        "utf8-null-delimited-lowercase-hex-canonical-base10-round",
      ),
      pullRequest: z.object({
        domain: z.literal(PULL_REQUEST_KEY_DOMAIN),
        formula: z.literal(
          "sha256(domain NUL activationSaltHex NUL repositoryNodeId NUL pullRequestNodeId)",
        ),
      }).strict(),
      repository: z.object({
        domain: z.literal(REPOSITORY_KEY_DOMAIN),
        formula: z.literal(
          "sha256(domain NUL activationSaltHex NUL repositoryNodeId)",
        ),
      }).strict(),
      rootShard: z.object({
        domain: z.literal(ROOT_SHARD_KEY_DOMAIN),
        formula: z.literal(
          "sha256(domain NUL activationSaltHex NUL rootShardId)",
        ),
      }).strict(),
    }).strict(),
    metadataPretargetCapPerRepositoryNodeId: z.literal(4),
    metadataPretargetCapScope: z.literal(
      "global-across-language-splits-by-repository-node-id",
    ),
    nextShardRule: z.literal(
      "activate-complete-shard-until-terminal-raw-and-cap-retained-selected-quotas-are-both-met",
    ),
    order: z.object({
      pullRequest: z.literal(
        "per-repository-pullRequestKeySha256-then-pullRequestNodeId",
      ),
      repository: z.literal(
        "per-language-repositoryKeySha256-then-repositoryNodeId",
      ),
      rootShard: z.literal(
        "per-language-rootShardKeySha256-then-rootShardId",
      ),
    }).strict(),
    quotaPerLanguage: z.object({
      primaryMilestone: z.object({
        rawMetadataCount: z.literal(30_000),
        selectedPretargetCountAfterCap: z.literal(2_500),
        successTerminal: z.literal(false),
      }).strict(),
      terminal: z.object({
        rawMetadataCount: z.literal(76_875),
        selectedPretargetCountAfterCap: z.literal(6_375),
      }).strict(),
    }).strict(),
    runnerAcceptsQuotaTier: z.literal(false),
  }).strict(),
  antiGrindingProtocol: z.object({
    beacon: z.object({
      beaconId: z.literal(QUICKNET.beaconId),
      chainHash: z.literal(QUICKNET.chainHash),
      genesisTimeUnixSeconds: z.literal(
        QUICKNET.genesisTimeUnixSeconds,
      ),
      groupHash: z.literal(QUICKNET.groupHash),
      periodSeconds: z.literal(QUICKNET.periodSeconds),
      publicKey: z.literal(QUICKNET.publicKey),
      scheme: z.literal(QUICKNET.scheme),
    }).strict(),
    beaconCaptureInSourceArtifact: z.literal(false),
    beaconResponseVerification: z.object({
      exactChainInfoProfileMatchRequired: z.literal(true),
      exactRequestedRoundRequired: z.literal(true),
      randomnessFormula: z.literal(
        "sha256(signatureBytes)",
      ),
      signatureVerificationRequired: z.literal(true),
    }).strict(),
    concreteWitnessProviderProfile: z.object({
      commitmentBindingRequired: z.literal(true),
      frozen: z.literal(false),
      requiredBeforeCapture: z.literal(true),
      requiredVerifierComponents: z.tuple([
        z.literal("canonicalPayload"),
        z.literal("endpoint"),
        z.literal("enumeration"),
        z.literal("inclusion"),
        z.literal("namespace"),
        z.literal("signature"),
        z.literal("trustRoot"),
      ]),
      verifierImplemented: z.literal(false),
    }).strict(),
    fixedRoundFailure: z.literal(
      "fail-closed-no-fallback-no-redraw",
    ),
    targetRound: z.object({
      arithmetic: z.literal(
        "exact-positive-integer-seconds",
      ),
      commitTimestampAccepted: z.literal(false),
      formula: z.literal(
        "1+ceilDiv(externallySignedWitnessUnixSeconds+frozenLeadSeconds-genesisTimeUnixSeconds,periodSeconds)",
      ),
      frozenLeadSeconds: z.literal(3_600),
      predecessorRule: z.literal(
        "predecessorRoundTimestamp<witnessPlusFrozenLead",
      ),
      roundTimestampFormula: z.literal(
        "genesisTimeUnixSeconds+(round-1)*periodSeconds",
      ),
      semantics: z.literal(
        "earliest-round-timestamp-not-before-witness-plus-frozen-lead",
      ),
      targetRule: z.literal(
        "targetRoundTimestamp>=witnessPlusFrozenLead",
      ),
      uniqueDerivationRequired: z.literal(true),
      witnessBeforeGenesisAccepted: z.literal(false),
    }).strict(),
    witness: z.object({
      appendOnly: z.literal(true),
      enumerable: z.literal(true),
      externalToRepository: z.literal(true),
      externallySigned: z.literal(true),
      mustBindCommitmentSha256: z.literal(true),
      receiptRequired: z.literal(true),
      timestampField: z.literal(
        "externallySignedWitnessUnixSeconds",
      ),
    }).strict(),
  }).strict(),
  artifactKind: z.literal(ARTIFACT_KIND),
  boundary: z.object({
    acceptedEpisodeCount: z.literal(0),
    candidateManifestFrozen: z.literal(false),
    codexRunReady: z.literal(false),
    commitAncestryProven: z.literal(false),
    independentReview: z.literal(false),
    officialWave3CapturePermitted: z.literal(false),
    pretargetPolicyPromotionAccepted: z.literal(false),
    priorRepositoryNodeIdExclusionComplete: z.literal(false),
    selectionExecuted: z.literal(false),
    sourceUniverseFrozen: z.literal(false),
    sourceUniversePromotionAccepted: z.literal(false),
    status: z.literal(
      "source-review-commit-policy-promotion-and-prior-node-closure-required",
    ),
  }).strict(),
  chronology: z.object({
    officialWave3CaptureStarted: z.literal(false),
    sourceArtifactCommitCompleted: z.literal(false),
    sourceArtifactIndependentReviewCompleted: z.literal(false),
    sourceArtifactPreregistered: z.literal(false),
  }).strict(),
  exclusions: z.object({
    canonicalAnchorProjectionSha256: z.literal(
      FROZEN_EXCLUSION_PROJECTIONS.anchors,
    ),
    canonicalAnchors: z.array(anchorSchema).length(
      PRE_WAVE3_ANCHOR_COUNT,
    ),
    canonicalRepositories: z.array(repositorySchema).length(
      PRE_WAVE3_REPOSITORY_COUNT,
    ),
    canonicalRepositoryProjectionSha256: z.literal(
      FROZEN_EXCLUSION_PROJECTIONS.repositories,
    ),
    counts: z.object({
      canonicalAnchorCount: z.literal(PRE_WAVE3_ANCHOR_COUNT),
      canonicalRepositoryCount: z.literal(
        PRE_WAVE3_REPOSITORY_COUNT,
      ),
      priorFrameAnchorCount: z.literal(
        FROZEN_INPUTS.priorFrame.candidateCount,
      ),
      structuralUnionAnchorCount: z.literal(
        FROZEN_INPUTS.structuralUnion.targetCount,
      ),
    }).strict(),
    derivation: z.literal(
      "sorted-deduplicated-priorFrame-candidates-plus-structuralUnion-results",
    ),
  }).strict(),
  inputPolicy: z.object({
    defaultDeny: z.literal(true),
    forbiddenInputs: z.array(
      z.enum(FORBIDDEN_INPUTS),
    ).length(FORBIDDEN_INPUTS.length),
    languageRole: z.literal(
      "fixed-source-frame-stratification-only-not-within-stratum-order-or-pretarget-decision",
    ),
    sourceFrameMembershipInputs: z.array(
      z.enum(SOURCE_FRAME_MEMBERSHIP_INPUTS),
    ).length(SOURCE_FRAME_MEMBERSHIP_INPUTS.length),
    sourceFrameMembershipOnly: z.literal(true),
  }).strict(),
  inputs: z.object({
    pretargetPolicy: artifactReferenceSchema.extend({
      artifactKind: z.literal(PRETARGET_POLICY_ARTIFACT_KIND),
      bytes: z.literal(FROZEN_INPUTS.pretargetPolicy.bytes),
      path: z.literal(FROZEN_INPUTS.pretargetPolicy.path),
      schemaVersion: z.literal(1),
      sha256: z.literal(FROZEN_INPUTS.pretargetPolicy.sha256),
    }).strict(),
    priorFrame: artifactReferenceSchema.extend({
      artifactKind: z.literal(PRIOR_FRAME_ARTIFACT_KIND),
      bytes: z.literal(FROZEN_INPUTS.priorFrame.bytes),
      candidateCount: z.literal(
        FROZEN_INPUTS.priorFrame.candidateCount,
      ),
      candidateProjectionSha256: z.literal(
        FROZEN_INPUTS.priorFrame.candidateProjectionSha256,
      ),
      path: z.literal(FROZEN_INPUTS.priorFrame.path),
      schemaVersion: z.literal(1),
      sha256: z.literal(FROZEN_INPUTS.priorFrame.sha256),
    }).strict(),
    structuralUnion: artifactReferenceSchema.extend({
      artifactKind: z.literal(STRUCTURAL_UNION_ARTIFACT_KIND),
      bytes: z.literal(FROZEN_INPUTS.structuralUnion.bytes),
      path: z.literal(FROZEN_INPUTS.structuralUnion.path),
      schemaVersion: z.literal(1),
      sha256: z.literal(FROZEN_INPUTS.structuralUnion.sha256),
      targetCount: z.literal(
        FROZEN_INPUTS.structuralUnion.targetCount,
      ),
    }).strict(),
  }).strict(),
  repositoryUniverse: z.object({
    host: z.literal("github.com"),
    languageSplits: z.array(languageSplitSchema).length(
      LANGUAGE_SPLITS.length,
    ),
    qualifiers: z.object({
      archived: z.literal(false),
      forkQueryQualifier: z.literal("omit-use-default-exclusion"),
      mirror: z.literal(false),
      public: z.literal(true),
      pushedAtOrAfter: z.literal("2024-01-01"),
      template: z.literal(false),
    }).strict(),
    representative: z.literal(false),
    repositoryNodeValidation: z.object({
      createdAtWithinShard: z.literal(true),
      isArchived: z.literal(false),
      isFork: z.literal(false),
      isMirror: z.literal(false),
      isTemplate: z.literal(false),
      nodeIdRequired: z.literal(true),
      primaryLanguageMustEqualSourceSplit: z.literal(true),
      pushedAtOrAfter: z.literal("2024-01-01T00:00:00Z"),
      visibility: z.literal("PUBLIC"),
    }).strict(),
    rootShardCount: z.literal(ROOT_SHARD_COUNT),
    rootWindowCount: z.literal(ROOT_WINDOW_COUNT),
    rootWindowPolicy: z.object({
      daysOfMonth: z.tuple([z.literal(1), z.literal(15)]),
      endTime: z.literal("23:59:59Z"),
      months: z.tuple([
        z.literal(1),
        z.literal(2),
        z.literal(3),
        z.literal(4),
        z.literal(5),
        z.literal(6),
        z.literal(7),
        z.literal(8),
        z.literal(9),
        z.literal(10),
        z.literal(11),
        z.literal(12),
      ]),
      startTime: z.literal("00:00:00Z"),
      years: z.tuple([
        z.literal(2016),
        z.literal(2017),
        z.literal(2018),
        z.literal(2019),
        z.literal(2020),
        z.literal(2021),
        z.literal(2022),
        z.literal(2023),
      ]),
      zone: z.literal("UTC"),
    }).strict(),
  }).strict(),
  schemaVersion: z.literal(2),
  searchProtocol: z.object({
    accessibleResultCap: z.literal(ACCESSIBLE_RESULT_CAP),
    countProbe: z.object({
      first: z.literal(1),
    }).strict(),
    officialDocumentation: z.object({
      graphqlPagination: z.literal(
        "https://docs.github.com/en/graphql/guides/using-pagination-in-the-graphql-api",
      ),
      graphqlSearch: z.literal(
        "https://docs.github.com/en/graphql/reference/search",
      ),
      repositoryConnection: z.literal(
        "https://docs.github.com/en/graphql/reference/repos",
      ),
      repositorySearch: z.literal(
        "https://docs.github.com/en/search-github/searching-on-github/searching-for-repositories",
      ),
    }).strict(),
    overflowPolicy: z.object({
      boundaryUnit: z.literal("utc-second"),
      leafAtOrBelowAccessibleCap:
        z.literal(ACCESSIBLE_RESULT_CAP),
      midpointRule: z.literal(
        "left=[lo,mid]-right=[mid+1-second,hi]",
      ),
      singleSecondAboveCap: z.literal("fail-closed"),
    }).strict(),
    pageSize: z.literal(PAGE_SIZE),
    pullRequestConnection: z.object({
      doublePassMetadataProjectionEquality: z.literal(true),
      doublePassNormalizedNodeIdSetEquality: z.literal(true),
      endpoint: z.literal("GraphQL Repository.pullRequests"),
      lowerBound: z.literal("2022-01-01T00:00:00Z"),
      lowerBoundTermination: z.literal(
        "strictly-older-createdAt-witness-or-connection-exhaustion",
      ),
      orderBy: z.object({
        direction: z.literal("DESC"),
        field: z.literal("CREATED_AT"),
      }).strict(),
      pageSize: z.literal(PAGE_SIZE),
      states: z.tuple([z.literal("MERGED")]),
      upperBound: z.literal("2025-12-31T23:59:59Z"),
      upperBoundRows: z.literal(
        "skip-but-retain-boundary-receipts",
      ),
    }).strict(),
    repositorySearchEndpoint: z.literal(
      "GraphQL Query.search(type: REPOSITORY)",
    ),
  }).strict(),
}).strict();

export type C6Wave3SourceUniverseV2 = z.infer<
  typeof sourceUniverseSchema
>;

export interface C6Wave3SourceUniverseV2TestHooks {
  afterOutputPublication?: () => Promise<void> | void;
  beforeTerminalReplay?: () => Promise<void> | void;
}

export interface C6Wave3SourceUniverseV2BuildInput {
  pretargetPolicyPath: string;
  priorFramePath: string;
  structuralUnionPath: string;
  testHooks?: C6Wave3SourceUniverseV2TestHooks;
}

export interface C6Wave3SearchIntervalV2 {
  createdFrom: string;
  createdTo: string;
}

export interface C6Wave3SearchIntervalLeafV2
  extends C6Wave3SearchIntervalV2 {
  count: number;
}

export async function buildC6Wave3SourceUniverseV2(
  input: C6Wave3SourceUniverseV2BuildInput,
): Promise<{
  outputSha256: string;
  sourceUniverse: C6Wave3SourceUniverseV2;
}> {
  const initial = await readInputClosure(input);
  const sourceUniverse = deriveSourceUniverse(initial);
  const serialized =
    serializeC6Wave3SourceUniverseV2(sourceUniverse);

  await input.testHooks?.beforeTerminalReplay?.();
  const terminal = await readInputClosure(input);
  const terminalSerialized =
    serializeC6Wave3SourceUniverseV2(
      deriveSourceUniverse(terminal),
    );
  if (
    terminalSerialized !== serialized ||
    terminal.closureProjectionSha256 !==
      initial.closureProjectionSha256
  ) {
    throw new Error(
      "C6 Wave3 source universe v2 input closure changed",
    );
  }
  parseC6Wave3SourceUniverseV2(serialized);
  return {
    outputSha256: sha256(serialized),
    sourceUniverse,
  };
}

export function serializeC6Wave3SourceUniverseV2(
  sourceUniverse: C6Wave3SourceUniverseV2,
): string {
  const parsed = sourceUniverseSchema.parse(sourceUniverse);
  assertSourceUniverseSelfConsistency(parsed);
  return `${JSON.stringify(parsed, null, 2)}\n`;
}

export function parseC6Wave3SourceUniverseV2(
  input: string | Uint8Array,
): C6Wave3SourceUniverseV2 {
  const text = typeof input === "string"
    ? input
    : Buffer.from(input).toString("utf8");
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch {
    throw new Error(
      "C6 Wave3 source universe v2 invalid JSON",
    );
  }
  if (text !== `${JSON.stringify(raw, null, 2)}\n`) {
    throw new Error(
      "C6 Wave3 source universe v2 requires canonical JSON",
    );
  }
  const sourceUniverse = sourceUniverseSchema.parse(raw);
  assertSourceUniverseSelfConsistency(sourceUniverse);
  return sourceUniverse;
}

export function requireC6Wave3OfficialCaptureAuthorizationV2(
  input: unknown,
): never {
  sourceUniverseSchema.parse(input);
  throw new Error(
    "C6 Wave3 source-universe v2 cannot authorize capture; " +
    "promotion receipt verifier is required",
  );
}

export async function materializeC6Wave3SourceUniverseV2(
  input:
    C6Wave3SourceUniverseV2BuildInput & {
      outputPath: string;
    },
): Promise<{
  outputSha256: string;
  sourceUniverse: C6Wave3SourceUniverseV2;
}> {
  const result = await buildC6Wave3SourceUniverseV2(input);
  const serialized =
    serializeC6Wave3SourceUniverseV2(result.sourceUniverse);
  const outputPath = resolve(input.outputPath);
  const outputParent = await assertC6NoSymlinkPathComponents(
    dirname(outputPath),
    "C6 Wave3 source universe v2 output parent",
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
          "C6 Wave3 source universe v2 temporary output identity mismatch",
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
      "C6 Wave3 source universe v2 temporary output",
    );
    if (temporaryBytes.toString("utf8") !== serialized) {
      throw new Error(
        "C6 Wave3 source universe v2 temporary output mismatch",
      );
    }
    await assertC6NoSymlinkPathComponents(
      outputParent,
      "C6 Wave3 source universe v2 terminal output parent",
    );
    await link(temporaryPath, outputPath);
    await assertPublishedOutputOwnership({
      outputPath,
      ownedIdentity,
      temporaryPath,
    });

    await input.testHooks?.afterOutputPublication?.();
    const replayed = await buildC6Wave3SourceUniverseV2({
      pretargetPolicyPath: input.pretargetPolicyPath,
      priorFramePath: input.priorFramePath,
      structuralUnionPath: input.structuralUnionPath,
    });
    if (
      replayed.outputSha256 !== result.outputSha256 ||
      serializeC6Wave3SourceUniverseV2(
        replayed.sourceUniverse,
      ) !== serialized
    ) {
      throw new Error(
        "C6 Wave3 source universe v2 post-publication replay mismatch",
      );
    }
    await assertPublishedOutputOwnership({
      outputPath,
      ownedIdentity,
      temporaryPath,
    });
    const publishedBytes = await readC6StableRegularFile(
      outputPath,
      "C6 Wave3 source universe v2 published output",
    );
    if (
      serializeC6Wave3SourceUniverseV2(
        parseC6Wave3SourceUniverseV2(publishedBytes),
      ) !== serialized
    ) {
      throw new Error(
        "C6 Wave3 source universe v2 published output mismatch",
      );
    }
    await assertPublishedOutputOwnership({
      outputPath,
      ownedIdentity,
      temporaryPath,
    });
    if (!await removePathIfOwned(temporaryPath, ownedIdentity)) {
      throw new Error(
        "C6 Wave3 source universe v2 temporary output cleanup mismatch",
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

export function buildC6Wave3RepositorySearchQueryV2(
  input: {
    createdFrom: string;
    createdTo: string;
    language: string;
  },
): string {
  const parsed = repositoryQueryInputSchema.parse(input);
  assertOrderedInterval(parsed);
  return [
    `language:${parsed.language}`,
    `created:${parsed.createdFrom}..${parsed.createdTo}`,
    "pushed:>=2024-01-01",
    "is:public",
    "archived:false",
    "mirror:false",
    "template:false",
  ].join(" ");
}

export function deriveC6Wave3TargetRoundV2(
  externallySignedWitnessUnixSeconds: bigint,
): bigint {
  if (externallySignedWitnessUnixSeconds < 0n) {
    throw new Error(
      "C6 Wave3 witness Unix seconds must be nonnegative",
    );
  }
  const genesis = BigInt(QUICKNET.genesisTimeUnixSeconds);
  if (externallySignedWitnessUnixSeconds < genesis) {
    throw new Error(
      "C6 Wave3 witness cannot be before Quicknet genesis",
    );
  }
  const period = BigInt(QUICKNET.periodSeconds);
  const threshold =
    externallySignedWitnessUnixSeconds + 3_600n;
  const delta = threshold - genesis;
  const intervals =
    delta / period + (delta % period === 0n ? 0n : 1n);
  return intervals + 1n;
}

export async function partitionC6Wave3SearchIntervalV2(
  input: C6Wave3SearchIntervalV2 & {
    countProbe: (
      interval: C6Wave3SearchIntervalV2,
    ) => number | Promise<number>;
  },
): Promise<C6Wave3SearchIntervalLeafV2[]> {
  const interval = parseInterval(input);
  const count = await input.countProbe(interval);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error(
      "C6 Wave3 search count probe must return a nonnegative safe integer",
    );
  }
  if (count <= ACCESSIBLE_RESULT_CAP) {
    return [{ count, ...interval }];
  }
  const fromSeconds = toUtcSeconds(interval.createdFrom);
  const toSeconds = toUtcSeconds(interval.createdTo);
  if (fromSeconds === toSeconds) {
    throw new Error(
      "C6 Wave3 search single UTC second exceeds accessible cap",
    );
  }
  const midpoint = Math.floor((fromSeconds + toSeconds) / 2);
  const left = await partitionC6Wave3SearchIntervalV2({
    countProbe: input.countProbe,
    createdFrom: formatUtcSecond(fromSeconds),
    createdTo: formatUtcSecond(midpoint),
  });
  const right = await partitionC6Wave3SearchIntervalV2({
    countProbe: input.countProbe,
    createdFrom: formatUtcSecond(midpoint + 1),
    createdTo: formatUtcSecond(toSeconds),
  });
  return [...left, ...right];
}

interface InputClosure {
  closureProjectionSha256: string;
  pretargetPolicy: C6Wave3PretargetPolicy;
  priorFrame: z.infer<typeof priorFrameSchema>;
  structuralUnion: C6LiveMultiLangNeighborStructuralUnion;
}

interface OwnedFileIdentity {
  dev: number;
  ino: number;
}

async function readInputClosure(
  input: C6Wave3SourceUniverseV2BuildInput,
): Promise<InputClosure> {
  const [
    pretargetPolicy,
    priorFrame,
    structuralUnion,
  ] = await Promise.all([
    readFrozenInput(
      input.pretargetPolicyPath,
      FROZEN_INPUTS.pretargetPolicy,
      "pretarget policy",
    ),
    readFrozenInput(
      input.priorFramePath,
      FROZEN_INPUTS.priorFrame,
      "prior frame",
    ),
    readFrozenInput(
      input.structuralUnionPath,
      FROZEN_INPUTS.structuralUnion,
      "structural union",
    ),
  ]);
  return {
    closureProjectionSha256: sha256(JSON.stringify([
      pretargetPolicy.sha256,
      priorFrame.sha256,
      structuralUnion.sha256,
    ])),
    pretargetPolicy: parseC6Wave3PretargetPolicy(
      pretargetPolicy.bytes,
    ),
    priorFrame: parsePriorFrame(priorFrame.bytes),
    structuralUnion:
      parseC6LiveMultiLangNeighborStructuralUnion(
        structuralUnion.bytes,
      ),
  };
}

async function readFrozenInput(
  pathInput: string,
  frozen: {
    bytes: number;
    path: string;
    sha256: string;
  },
  label: string,
): Promise<{
  bytes: Buffer;
  sha256: string;
}> {
  const path = await assertC6NoSymlinkPathComponents(
    pathInput,
    `C6 Wave3 source universe v2 ${label}`,
  );
  const bytes = await readC6StableRegularFile(
    path,
    `C6 Wave3 source universe v2 ${label}`,
  );
  const actualSha256 = sha256(bytes);
  if (
    basename(path) !== frozen.path ||
    bytes.byteLength !== frozen.bytes ||
    actualSha256 !== frozen.sha256
  ) {
    throw new Error(
      `C6 Wave3 source universe v2 ${label} hash mismatch`,
    );
  }
  return {
    bytes,
    sha256: actualSha256,
  };
}

function parsePriorFrame(
  bytes: Uint8Array,
): z.infer<typeof priorFrameSchema> {
  const text = Buffer.from(bytes).toString("utf8");
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch {
    throw new Error(
      "C6 Wave3 source universe v2 prior frame invalid JSON",
    );
  }
  if (text !== `${JSON.stringify(raw, null, 2)}\n`) {
    throw new Error(
      "C6 Wave3 source universe v2 prior frame requires canonical JSON",
    );
  }
  return priorFrameSchema.parse(raw);
}

function deriveSourceUniverse(
  closure: InputClosure,
): C6Wave3SourceUniverseV2 {
  assertFrozenInputSemantics(closure);
  const canonicalAnchors = sortedUnique([
    ...closure.priorFrame.candidates.map(
      (candidate) => candidate.canonicalAnchorId,
    ),
    ...closure.structuralUnion.results.map(
      (result) => result.canonicalAnchorId,
    ),
  ]);
  const canonicalRepositories = sortedUnique([
    ...closure.priorFrame.candidates.map(
      (candidate) => candidate.canonicalRepository,
    ),
    ...closure.structuralUnion.results.map(
      (result) => result.canonicalRepository,
    ),
  ]);

  const sourceUniverse = sourceUniverseSchema.parse({
    activationPlanProtocol: {
      activationMaterialPresent: false,
      completeShardOnly: true,
      forbiddenSignals: [...ACTIVATION_FORBIDDEN_SIGNALS],
      keyDerivationProtocol: {
        activationSalt: {
          actualInputValuesPresent: false,
          domain: ACTIVATION_SALT_DOMAIN,
          evaluationId: {
            callerOverrideAccepted: false,
            frozenInSourceArtifact: false,
            requiredInC0CommitmentProfile: true,
          },
          formula:
            "sha256(domain NUL evaluationId NUL commitmentSha256 NUL roundDecimal NUL randomnessHex)",
          inputSource:
            "future-accepted-commitment-and-verified-fixed-round-receipt",
        },
        algorithm: "sha256",
        callerNonceAccepted: false,
        callerRoundOverrideAccepted: false,
        callerSaltAccepted: false,
        encoding:
          "utf8-null-delimited-lowercase-hex-canonical-base10-round",
        pullRequest: {
          domain: PULL_REQUEST_KEY_DOMAIN,
          formula:
            "sha256(domain NUL activationSaltHex NUL repositoryNodeId NUL pullRequestNodeId)",
        },
        repository: {
          domain: REPOSITORY_KEY_DOMAIN,
          formula:
            "sha256(domain NUL activationSaltHex NUL repositoryNodeId)",
        },
        rootShard: {
          domain: ROOT_SHARD_KEY_DOMAIN,
          formula:
            "sha256(domain NUL activationSaltHex NUL rootShardId)",
        },
      },
      metadataPretargetCapPerRepositoryNodeId: 4,
      metadataPretargetCapScope:
        "global-across-language-splits-by-repository-node-id",
      nextShardRule:
        "activate-complete-shard-until-terminal-raw-and-cap-retained-selected-quotas-are-both-met",
      order: {
        pullRequest:
          "per-repository-pullRequestKeySha256-then-pullRequestNodeId",
        repository:
          "per-language-repositoryKeySha256-then-repositoryNodeId",
        rootShard:
          "per-language-rootShardKeySha256-then-rootShardId",
      },
      quotaPerLanguage: {
        primaryMilestone: {
          rawMetadataCount: 30_000,
          selectedPretargetCountAfterCap: 2_500,
          successTerminal: false,
        },
        terminal: {
          rawMetadataCount: 76_875,
          selectedPretargetCountAfterCap: 6_375,
        },
      },
      runnerAcceptsQuotaTier: false,
    },
    antiGrindingProtocol: {
      beacon: QUICKNET,
      beaconCaptureInSourceArtifact: false,
      beaconResponseVerification: {
        exactChainInfoProfileMatchRequired: true,
        exactRequestedRoundRequired: true,
        randomnessFormula: "sha256(signatureBytes)",
        signatureVerificationRequired: true,
      },
      concreteWitnessProviderProfile: {
        commitmentBindingRequired: true,
        frozen: false,
        requiredBeforeCapture: true,
        requiredVerifierComponents: [
          "canonicalPayload",
          "endpoint",
          "enumeration",
          "inclusion",
          "namespace",
          "signature",
          "trustRoot",
        ],
        verifierImplemented: false,
      },
      fixedRoundFailure:
        "fail-closed-no-fallback-no-redraw",
      targetRound: {
        arithmetic:
          "exact-positive-integer-seconds",
        commitTimestampAccepted: false,
        formula:
          "1+ceilDiv(externallySignedWitnessUnixSeconds+frozenLeadSeconds-genesisTimeUnixSeconds,periodSeconds)",
        frozenLeadSeconds: 3_600,
        predecessorRule:
          "predecessorRoundTimestamp<witnessPlusFrozenLead",
        roundTimestampFormula:
          "genesisTimeUnixSeconds+(round-1)*periodSeconds",
        semantics:
          "earliest-round-timestamp-not-before-witness-plus-frozen-lead",
        targetRule:
          "targetRoundTimestamp>=witnessPlusFrozenLead",
        uniqueDerivationRequired: true,
        witnessBeforeGenesisAccepted: false,
      },
      witness: {
        appendOnly: true,
        enumerable: true,
        externalToRepository: true,
        externallySigned: true,
        mustBindCommitmentSha256: true,
        receiptRequired: true,
        timestampField:
          "externallySignedWitnessUnixSeconds",
      },
    },
    artifactKind: ARTIFACT_KIND,
    boundary: {
      acceptedEpisodeCount: 0,
      candidateManifestFrozen: false,
      codexRunReady: false,
      commitAncestryProven: false,
      independentReview: false,
      officialWave3CapturePermitted: false,
      pretargetPolicyPromotionAccepted: false,
      priorRepositoryNodeIdExclusionComplete: false,
      selectionExecuted: false,
      sourceUniverseFrozen: false,
      sourceUniversePromotionAccepted: false,
      status:
        "source-review-commit-policy-promotion-and-prior-node-closure-required",
    },
    chronology: {
      officialWave3CaptureStarted: false,
      sourceArtifactCommitCompleted: false,
      sourceArtifactIndependentReviewCompleted: false,
      sourceArtifactPreregistered: false,
    },
    exclusions: {
      canonicalAnchorProjectionSha256: sha256(
        JSON.stringify(canonicalAnchors),
      ),
      canonicalAnchors,
      canonicalRepositories,
      canonicalRepositoryProjectionSha256: sha256(
        JSON.stringify(canonicalRepositories),
      ),
      counts: {
        canonicalAnchorCount: canonicalAnchors.length,
        canonicalRepositoryCount: canonicalRepositories.length,
        priorFrameAnchorCount:
          closure.priorFrame.candidates.length,
        structuralUnionAnchorCount:
          closure.structuralUnion.results.length,
      },
      derivation:
        "sorted-deduplicated-priorFrame-candidates-plus-structuralUnion-results",
    },
    inputPolicy: {
      defaultDeny: true,
      forbiddenInputs: [...FORBIDDEN_INPUTS],
      languageRole:
        "fixed-source-frame-stratification-only-not-within-stratum-order-or-pretarget-decision",
      sourceFrameMembershipInputs: [
        ...SOURCE_FRAME_MEMBERSHIP_INPUTS,
      ],
      sourceFrameMembershipOnly: true,
    },
    inputs: FROZEN_INPUTS,
    repositoryUniverse: {
      host: "github.com",
      languageSplits: deriveLanguageSplits(),
      qualifiers: {
        archived: false,
        forkQueryQualifier: "omit-use-default-exclusion",
        mirror: false,
        public: true,
        pushedAtOrAfter: "2024-01-01",
        template: false,
      },
      representative: false,
      repositoryNodeValidation: {
        createdAtWithinShard: true,
        isArchived: false,
        isFork: false,
        isMirror: false,
        isTemplate: false,
        nodeIdRequired: true,
        primaryLanguageMustEqualSourceSplit: true,
        pushedAtOrAfter: "2024-01-01T00:00:00Z",
        visibility: "PUBLIC",
      },
      rootShardCount: ROOT_SHARD_COUNT,
      rootWindowCount: ROOT_WINDOW_COUNT,
      rootWindowPolicy: {
        daysOfMonth: [1, 15],
        endTime: "23:59:59Z",
        months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
        startTime: "00:00:00Z",
        years: [
          2016,
          2017,
          2018,
          2019,
          2020,
          2021,
          2022,
          2023,
        ],
        zone: "UTC",
      },
    },
    schemaVersion: 2,
    searchProtocol: {
      accessibleResultCap: ACCESSIBLE_RESULT_CAP,
      countProbe: {
        first: 1,
      },
      officialDocumentation: {
        graphqlPagination:
          "https://docs.github.com/en/graphql/guides/using-pagination-in-the-graphql-api",
        graphqlSearch:
          "https://docs.github.com/en/graphql/reference/search",
        repositoryConnection:
          "https://docs.github.com/en/graphql/reference/repos",
        repositorySearch:
          "https://docs.github.com/en/search-github/searching-on-github/searching-for-repositories",
      },
      overflowPolicy: {
        boundaryUnit: "utc-second",
        leafAtOrBelowAccessibleCap: ACCESSIBLE_RESULT_CAP,
        midpointRule:
          "left=[lo,mid]-right=[mid+1-second,hi]",
        singleSecondAboveCap: "fail-closed",
      },
      pageSize: PAGE_SIZE,
      pullRequestConnection: {
        doublePassMetadataProjectionEquality: true,
        doublePassNormalizedNodeIdSetEquality: true,
        endpoint: "GraphQL Repository.pullRequests",
        lowerBound: "2022-01-01T00:00:00Z",
        lowerBoundTermination:
          "strictly-older-createdAt-witness-or-connection-exhaustion",
        orderBy: {
          direction: "DESC",
          field: "CREATED_AT",
        },
        pageSize: PAGE_SIZE,
        states: ["MERGED"],
        upperBound: "2025-12-31T23:59:59Z",
        upperBoundRows:
          "skip-but-retain-boundary-receipts",
      },
      repositorySearchEndpoint:
        "GraphQL Query.search(type: REPOSITORY)",
    },
  });
  assertSourceUniverseSelfConsistency(sourceUniverse);
  return sourceUniverse;
}

function assertFrozenInputSemantics(
  closure: InputClosure,
): void {
  if (
    closure.pretargetPolicy.boundary
      .preregisteredBeforeWave3Capture ||
    closure.pretargetPolicy.boundary.independentReview ||
    closure.pretargetPolicy.boundary.commitAncestryProven ||
    closure.pretargetPolicy.boundary.selectionExecuted ||
    closure.priorFrame.candidates.length !==
      FROZEN_INPUTS.priorFrame.candidateCount ||
    closure.priorFrame.independenceBoundary
      .candidateProjectionSha256 !==
        FROZEN_INPUTS.priorFrame
          .candidateProjectionSha256 ||
    closure.structuralUnion.results.length !==
      FROZEN_INPUTS.structuralUnion.targetCount
  ) {
    throw new Error(
      "C6 Wave3 source universe v2 frozen input semantics mismatch",
    );
  }
  assertCanonicalRows(
    closure.priorFrame.candidates,
    "prior frame",
  );
  assertCanonicalRows(
    closure.structuralUnion.results,
    "structural union",
  );
}

function assertCanonicalRows(
  rows: readonly {
    canonicalAnchorId: string;
    canonicalRepository: string;
  }[],
  label: string,
): void {
  const anchors = new Set<string>();
  for (const row of rows) {
    const anchorRepository = row.canonicalAnchorId.slice(
      0,
      row.canonicalAnchorId.lastIndexOf("#"),
    );
    if (
      anchorRepository !== row.canonicalRepository ||
      anchors.has(row.canonicalAnchorId)
    ) {
      throw new Error(
        `C6 Wave3 source universe v2 ${label} identity mismatch`,
      );
    }
    anchors.add(row.canonicalAnchorId);
  }
}

function deriveLanguageSplits():
  C6Wave3SourceUniverseV2[
    "repositoryUniverse"
  ]["languageSplits"] {
  const windows = deriveRootWindows();
  return z.array(languageSplitSchema).parse(
    LANGUAGE_SPLITS.map(({ language, split }) => ({
      language,
      rootShards: windows.map((window) => ({
        createdFrom: window.createdFrom,
        createdTo: window.createdTo,
        query: buildC6Wave3RepositorySearchQueryV2({
          createdFrom: window.createdFrom,
          createdTo: window.createdTo,
          language,
        }),
        rootShardId: `${split}:${window.windowId}`,
        windowId: window.windowId,
      })),
      split,
    })),
  );
}

function deriveRootWindows(): {
  createdFrom: string;
  createdTo: string;
  windowId: string;
}[] {
  const windows = [];
  for (let year = 2016; year <= 2023; year += 1) {
    for (let month = 1; month <= 12; month += 1) {
      for (const day of [1, 15]) {
        const windowId = [
          year.toString().padStart(4, "0"),
          month.toString().padStart(2, "0"),
          day.toString().padStart(2, "0"),
        ].join("-");
        windows.push({
          createdFrom: `${windowId}T00:00:00Z`,
          createdTo: `${windowId}T23:59:59Z`,
          windowId,
        });
      }
    }
  }
  if (windows.length !== ROOT_WINDOW_COUNT) {
    throw new Error(
      "C6 Wave3 source universe v2 root window count mismatch",
    );
  }
  return windows;
}

function assertSourceUniverseSelfConsistency(
  sourceUniverse: C6Wave3SourceUniverseV2,
): void {
  const anchors = sourceUniverse.exclusions.canonicalAnchors;
  const repositories =
    sourceUniverse.exclusions.canonicalRepositories;
  if (
    JSON.stringify(
      sourceUniverse.repositoryUniverse.languageSplits,
    ) !== JSON.stringify(deriveLanguageSplits()) ||
    JSON.stringify(anchors) !==
      JSON.stringify(sortedUnique(anchors)) ||
    JSON.stringify(repositories) !==
      JSON.stringify(sortedUnique(repositories)) ||
    sha256(JSON.stringify(anchors)) !==
      FROZEN_EXCLUSION_PROJECTIONS.anchors ||
    sha256(JSON.stringify(repositories)) !==
      FROZEN_EXCLUSION_PROJECTIONS.repositories ||
    JSON.stringify(
      sourceUniverse.activationPlanProtocol.forbiddenSignals,
    ) !== JSON.stringify(ACTIVATION_FORBIDDEN_SIGNALS) ||
    JSON.stringify(sourceUniverse.inputPolicy.forbiddenInputs) !==
      JSON.stringify(FORBIDDEN_INPUTS) ||
    JSON.stringify(
      sourceUniverse.inputPolicy.sourceFrameMembershipInputs,
    ) !== JSON.stringify(SOURCE_FRAME_MEMBERSHIP_INPUTS) ||
    !anchors.every((anchor) =>
      repositories.includes(
        anchor.slice(0, anchor.lastIndexOf("#")),
      )
    )
  ) {
    throw new Error(
      "C6 Wave3 source universe v2 self-consistency mismatch",
    );
  }
}

function parseInterval(
  input: C6Wave3SearchIntervalV2,
): C6Wave3SearchIntervalV2 {
  const parsed = z.object({
    createdFrom: utcSecondSchema,
    createdTo: utcSecondSchema,
  }).strict().parse({
    createdFrom: input.createdFrom,
    createdTo: input.createdTo,
  });
  assertOrderedInterval(parsed);
  return parsed;
}

function assertOrderedInterval(input: {
  createdFrom: string;
  createdTo: string;
}): void {
  if (
    toUtcSeconds(input.createdFrom) >
      toUtcSeconds(input.createdTo)
  ) {
    throw new Error(
      "C6 Wave3 search interval must be ordered",
    );
  }
}

function toUtcSeconds(value: string): number {
  const milliseconds = Date.parse(value);
  if (
    !Number.isSafeInteger(milliseconds) ||
    formatUtcSecond(milliseconds / 1_000) !== value
  ) {
    throw new Error(
      `C6 Wave3 search timestamp is not a canonical UTC second: ${value}`,
    );
  }
  return milliseconds / 1_000;
}

function formatUtcSecond(seconds: number): string {
  return new Date(seconds * 1_000)
    .toISOString()
    .replace(".000Z", "Z");
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort(compareStrings);
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
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
      "C6 Wave3 source universe v2 published output ownership mismatch",
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
