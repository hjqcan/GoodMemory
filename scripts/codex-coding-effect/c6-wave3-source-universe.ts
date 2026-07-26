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
const ACTIVATION_SALT_ARTIFACT_KIND =
  "c6-wave3-activation-salt-proposal";
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
const PUBLIC_SALT_HEX =
  "de6c101137b6353d129105ca88c75a6050245f4ecb69fdd3b05c3e006a62cf20";
const ROOT_SHARD_KEY_DOMAIN =
  "goodmemory:c6:wave3-source-universe:v1:" +
  "root-shard-activation-key";
const REPOSITORY_KEY_DOMAIN =
  "goodmemory:c6:wave3-source-universe:v1:" +
  "repository-order-key";
const PULL_REQUEST_KEY_DOMAIN =
  "goodmemory:c6:wave3-source-universe:v1:" +
  "pull-request-order-key";

const FROZEN_INPUTS = {
  activationSalt: {
    artifactKind: ACTIVATION_SALT_ARTIFACT_KIND,
    bytes: 491,
    firstAndOnlyDrawReviewAccepted: false,
    originReceiptAccepted: false,
    path:
      "swe-bench-live-multilang-608f7ae9." +
      "wave3-activation-salt-proposal-v1.json",
    schemaVersion: 1,
    sha256:
      "66793fb6426c5719feb6fca61f75fa38dd0d02ce2a927c61135f34cda4725e71",
  },
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
const nodeIdSchema = z.string()
  .min(1)
  .refine((value) => !value.includes("\0"));
const priorFrameCandidateSchema = z.object({
  canonicalAnchorId: anchorSchema,
  canonicalRepository: repositorySchema,
}).passthrough();
const activationSaltSchema = z.object({
  artifactKind: z.literal(ACTIVATION_SALT_ARTIFACT_KIND),
  boundary: z.object({
    firstAndOnlyDrawReviewAccepted: z.literal(false),
    officialWave3CapturePermitted: z.literal(false),
    originReceiptAccepted: z.literal(false),
    status: z.literal(
      "external-origin-receipt-and-first-only-review-required",
    ),
  }).strict(),
  provenance: z.object({
    origin: z.literal("local-literal-proposal-only"),
    priorEvidenceContentInput: z.literal(false),
  }).strict(),
  publicSaltHex: z.literal(PUBLIC_SALT_HEX),
  schemaVersion: z.literal(1),
}).strict();
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
  activationKeySha256: sha256Schema,
  activationOrder: z.number().int().positive(),
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
  activation: z.object({
    completeShardOnly: z.literal(true),
    forbiddenSignals: z.array(
      z.enum(ACTIVATION_FORBIDDEN_SIGNALS),
    ).length(ACTIVATION_FORBIDDEN_SIGNALS.length),
    keyDerivations: z.object({
      pullRequest: z.object({
        domain: z.literal(PULL_REQUEST_KEY_DOMAIN),
        formula: z.literal(
          "sha256-domain-publicSalt-repositoryNodeId-pullRequestNodeId",
        ),
      }).strict(),
      repository: z.object({
        domain: z.literal(REPOSITORY_KEY_DOMAIN),
        formula: z.literal(
          "sha256-domain-publicSalt-repositoryNodeId",
        ),
      }).strict(),
      rootShard: z.object({
        domain: z.literal(ROOT_SHARD_KEY_DOMAIN),
        formula: z.literal(
          "sha256-domain-publicSalt-rootShardId",
        ),
      }).strict(),
    }).strict(),
    metadataPretargetCapPerRepositoryNodeId: z.literal(4),
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
        "per-language-activationKeySha256-then-rootShardId",
      ),
    }).strict(),
    publicSalt: z.object({
      firstAndOnlyDrawReviewAccepted: z.literal(false),
      hex: z.literal(PUBLIC_SALT_HEX),
      origin: z.literal(
        "source-artifact-literal-awaiting-external-origin-receipt",
      ),
      originReceiptAccepted: z.literal(false),
      priorEvidenceContentInput: z.literal(false),
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
  artifactKind: z.literal(ARTIFACT_KIND),
  boundary: z.object({
    acceptedEpisodeCount: z.literal(0),
    candidateManifestFrozen: z.literal(false),
    codexRunReady: z.literal(false),
    commitAncestryProven: z.literal(false),
    independentReview: z.literal(false),
    officialWave3CapturePermitted: z.literal(false),
    pretargetPolicyPromotionAccepted: z.literal(false),
    preregisteredBeforeWave3Capture: z.literal(false),
    priorRepositoryNodeIdExclusionComplete: z.literal(false),
    selectionExecuted: z.literal(false),
    sourceUniversePromotionAccepted: z.literal(false),
    sourceUniverseFrozen: z.literal(false),
    status: z.literal(
      "policy-and-source-promotion-plus-prior-node-id-closure-required",
    ),
  }).strict(),
  chronology: z.object({
    unreceiptedExploratoryScaleProbes: z.object({
      evidenceStatus: z.literal(
        "unverified-design-note-not-gate-evidence",
      ),
      numericalObservationsRetained: z.literal(false),
      occurred: z.literal(true),
      permittedUse: z.literal("source-frame-design-only"),
      receiptsBound: z.literal(false),
    }).strict(),
    sourceArtifactCommitCompleted: z.literal(false),
    sourceArtifactIndependentReviewCompleted: z.literal(false),
    sourceArtifactPreregistered: z.literal(false),
  }).strict(),
  exclusions: z.object({
    canonicalAnchorProjectionSha256: sha256Schema,
    canonicalAnchors: z.array(anchorSchema).length(
      PRE_WAVE3_ANCHOR_COUNT,
    ),
    canonicalRepositories: z.array(repositorySchema).length(
      PRE_WAVE3_REPOSITORY_COUNT,
    ),
    canonicalRepositoryProjectionSha256: sha256Schema,
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
    activationSalt: artifactReferenceSchema.extend({
      artifactKind: z.literal(ACTIVATION_SALT_ARTIFACT_KIND),
      bytes: z.literal(FROZEN_INPUTS.activationSalt.bytes),
      firstAndOnlyDrawReviewAccepted: z.literal(false),
      originReceiptAccepted: z.literal(false),
      path: z.literal(FROZEN_INPUTS.activationSalt.path),
      schemaVersion: z.literal(1),
      sha256: z.literal(FROZEN_INPUTS.activationSalt.sha256),
    }).strict(),
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
  schemaVersion: z.literal(1),
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
export type C6Wave3SourceUniverse = z.infer<
  typeof sourceUniverseSchema
>;

export function requireC6Wave3OfficialCaptureAuthorization(
  input: unknown,
): never {
  sourceUniverseSchema.parse(input);
  throw new Error(
    "C6 Wave3 source-universe proposal cannot authorize capture; " +
    "promotion receipt verifier is required",
  );
}

export interface C6Wave3SourceUniverseTestHooks {
  afterOutputPublication?: () => Promise<void> | void;
  beforeTerminalReplay?: () => Promise<void> | void;
}

export interface C6Wave3SourceUniverseBuildInput {
  activationSaltPath: string;
  pretargetPolicyPath: string;
  priorFramePath: string;
  structuralUnionPath: string;
  testHooks?: C6Wave3SourceUniverseTestHooks;
}

export interface C6Wave3SearchInterval {
  createdFrom: string;
  createdTo: string;
}

export interface C6Wave3SearchIntervalLeaf
  extends C6Wave3SearchInterval {
  count: number;
}

export async function buildC6Wave3SourceUniverse(
  input: C6Wave3SourceUniverseBuildInput,
): Promise<{
  outputSha256: string;
  sourceUniverse: C6Wave3SourceUniverse;
}> {
  const initial = await readInputClosure(input);
  const sourceUniverse = deriveSourceUniverse(initial);
  const serialized =
    serializeC6Wave3SourceUniverse(sourceUniverse);

  await input.testHooks?.beforeTerminalReplay?.();
  const terminal = await readInputClosure(input);
  const terminalSerialized = serializeC6Wave3SourceUniverse(
    deriveSourceUniverse(terminal),
  );
  if (
    terminalSerialized !== serialized ||
    terminal.closureProjectionSha256 !==
      initial.closureProjectionSha256
  ) {
    throw new Error(
      "C6 Wave3 source universe input closure changed",
    );
  }
  parseC6Wave3SourceUniverse(serialized);
  return {
    outputSha256: sha256(serialized),
    sourceUniverse,
  };
}

export function serializeC6Wave3SourceUniverse(
  sourceUniverse: C6Wave3SourceUniverse,
): string {
  const parsed = sourceUniverseSchema.parse(sourceUniverse);
  assertSourceUniverseSelfConsistency(parsed);
  return `${JSON.stringify(parsed, null, 2)}\n`;
}

export function parseC6Wave3SourceUniverse(
  input: string | Uint8Array,
): C6Wave3SourceUniverse {
  const text = typeof input === "string"
    ? input
    : Buffer.from(input).toString("utf8");
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch {
    throw new Error("C6 Wave3 source universe invalid JSON");
  }
  if (text !== `${JSON.stringify(raw, null, 2)}\n`) {
    throw new Error(
      "C6 Wave3 source universe requires canonical JSON",
    );
  }
  const sourceUniverse = sourceUniverseSchema.parse(raw);
  assertSourceUniverseSelfConsistency(sourceUniverse);
  return sourceUniverse;
}

export async function materializeC6Wave3SourceUniverse(
  input:
    C6Wave3SourceUniverseBuildInput & {
      outputPath: string;
    },
): Promise<{
  outputSha256: string;
  sourceUniverse: C6Wave3SourceUniverse;
}> {
  const result = await buildC6Wave3SourceUniverse(input);
  const serialized =
    serializeC6Wave3SourceUniverse(result.sourceUniverse);
  const outputPath = resolve(input.outputPath);
  const outputParent = await assertC6NoSymlinkPathComponents(
    dirname(outputPath),
    "C6 Wave3 source universe output parent",
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
          "C6 Wave3 source universe temporary output identity mismatch",
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
      "C6 Wave3 source universe temporary output",
    );
    if (temporaryBytes.toString("utf8") !== serialized) {
      throw new Error(
        "C6 Wave3 source universe temporary output mismatch",
      );
    }
    await assertC6NoSymlinkPathComponents(
      outputParent,
      "C6 Wave3 source universe terminal output parent",
    );
    await link(temporaryPath, outputPath);
    await assertPublishedOutputOwnership({
      outputPath,
      ownedIdentity,
      temporaryPath,
    });

    await input.testHooks?.afterOutputPublication?.();
    const replayed = await buildC6Wave3SourceUniverse({
      activationSaltPath: input.activationSaltPath,
      pretargetPolicyPath: input.pretargetPolicyPath,
      priorFramePath: input.priorFramePath,
      structuralUnionPath: input.structuralUnionPath,
    });
    if (
      replayed.outputSha256 !== result.outputSha256 ||
      serializeC6Wave3SourceUniverse(
        replayed.sourceUniverse,
      ) !== serialized
    ) {
      throw new Error(
        "C6 Wave3 source universe post-publication replay mismatch",
      );
    }
    await assertPublishedOutputOwnership({
      outputPath,
      ownedIdentity,
      temporaryPath,
    });
    const publishedBytes = await readC6StableRegularFile(
      outputPath,
      "C6 Wave3 source universe published output",
    );
    if (
      serializeC6Wave3SourceUniverse(
        parseC6Wave3SourceUniverse(publishedBytes),
      ) !== serialized
    ) {
      throw new Error(
        "C6 Wave3 source universe published output mismatch",
      );
    }
    await assertPublishedOutputOwnership({
      outputPath,
      ownedIdentity,
      temporaryPath,
    });
    if (!await removePathIfOwned(temporaryPath, ownedIdentity)) {
      throw new Error(
        "C6 Wave3 source universe temporary output cleanup mismatch",
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

export function buildC6Wave3RepositorySearchQuery(
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

export function deriveC6Wave3RepositoryOrderKey(
  repositoryNodeIdInput: string,
): string {
  const repositoryNodeId = nodeIdSchema.parse(
    repositoryNodeIdInput,
  );
  return sha256(
    `${REPOSITORY_KEY_DOMAIN}\0${PUBLIC_SALT_HEX}\0` +
    repositoryNodeId,
  );
}

export function deriveC6Wave3PullRequestOrderKey(
  input: {
    pullRequestNodeId: string;
    repositoryNodeId: string;
  },
): string {
  const parsed = z.object({
    pullRequestNodeId: nodeIdSchema,
    repositoryNodeId: nodeIdSchema,
  }).strict().parse(input);
  return sha256(
    `${PULL_REQUEST_KEY_DOMAIN}\0${PUBLIC_SALT_HEX}\0` +
    `${parsed.repositoryNodeId}\0${parsed.pullRequestNodeId}`,
  );
}

export async function partitionC6Wave3SearchInterval(
  input: C6Wave3SearchInterval & {
    countProbe: (
      interval: C6Wave3SearchInterval,
    ) => number | Promise<number>;
  },
): Promise<C6Wave3SearchIntervalLeaf[]> {
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
  const left = await partitionC6Wave3SearchInterval({
    countProbe: input.countProbe,
    createdFrom: formatUtcSecond(fromSeconds),
    createdTo: formatUtcSecond(midpoint),
  });
  const right = await partitionC6Wave3SearchInterval({
    countProbe: input.countProbe,
    createdFrom: formatUtcSecond(midpoint + 1),
    createdTo: formatUtcSecond(toSeconds),
  });
  return [...left, ...right];
}

interface InputClosure {
  activationSalt: z.infer<typeof activationSaltSchema>;
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
  input: C6Wave3SourceUniverseBuildInput,
): Promise<InputClosure> {
  const [
    activationSalt,
    pretargetPolicy,
    priorFrame,
    structuralUnion,
  ] =
    await Promise.all([
      readFrozenInput(
        input.activationSaltPath,
        FROZEN_INPUTS.activationSalt,
        "activation salt",
      ),
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
      activationSalt.sha256,
      pretargetPolicy.sha256,
      priorFrame.sha256,
      structuralUnion.sha256,
    ])),
    activationSalt: parseActivationSalt(
      activationSalt.bytes,
    ),
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
    `C6 Wave3 source universe ${label}`,
  );
  const bytes = await readC6StableRegularFile(
    path,
    `C6 Wave3 source universe ${label}`,
  );
  const actualSha256 = sha256(bytes);
  if (
    basename(path) !== frozen.path ||
    bytes.byteLength !== frozen.bytes ||
    actualSha256 !== frozen.sha256
  ) {
    throw new Error(
      `C6 Wave3 source universe ${label} hash mismatch`,
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
      "C6 Wave3 source universe prior frame invalid JSON",
    );
  }
  if (text !== `${JSON.stringify(raw, null, 2)}\n`) {
    throw new Error(
      "C6 Wave3 source universe prior frame requires canonical JSON",
    );
  }
  return priorFrameSchema.parse(raw);
}

function parseActivationSalt(
  bytes: Uint8Array,
): z.infer<typeof activationSaltSchema> {
  const text = Buffer.from(bytes).toString("utf8");
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch {
    throw new Error(
      "C6 Wave3 activation salt proposal invalid JSON",
    );
  }
  if (text !== `${JSON.stringify(raw, null, 2)}\n`) {
    throw new Error(
      "C6 Wave3 activation salt proposal requires canonical JSON",
    );
  }
  return activationSaltSchema.parse(raw);
}

function deriveSourceUniverse(
  closure: InputClosure,
): C6Wave3SourceUniverse {
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
    activation: {
      completeShardOnly: true,
      forbiddenSignals: [...ACTIVATION_FORBIDDEN_SIGNALS],
      keyDerivations: {
        pullRequest: {
          domain: PULL_REQUEST_KEY_DOMAIN,
          formula:
            "sha256-domain-publicSalt-repositoryNodeId-pullRequestNodeId",
        },
        repository: {
          domain: REPOSITORY_KEY_DOMAIN,
          formula:
            "sha256-domain-publicSalt-repositoryNodeId",
        },
        rootShard: {
          domain: ROOT_SHARD_KEY_DOMAIN,
          formula:
            "sha256-domain-publicSalt-rootShardId",
        },
      },
      metadataPretargetCapPerRepositoryNodeId: 4,
      nextShardRule:
        "activate-complete-shard-until-terminal-raw-and-cap-retained-selected-quotas-are-both-met",
      order: {
        pullRequest:
          "per-repository-pullRequestKeySha256-then-pullRequestNodeId",
        repository:
          "per-language-repositoryKeySha256-then-repositoryNodeId",
        rootShard:
          "per-language-activationKeySha256-then-rootShardId",
      },
      publicSalt: {
        firstAndOnlyDrawReviewAccepted:
          closure.activationSalt.boundary
            .firstAndOnlyDrawReviewAccepted,
        hex: closure.activationSalt.publicSaltHex,
        origin:
          "source-artifact-literal-awaiting-external-origin-receipt",
        originReceiptAccepted:
          closure.activationSalt.boundary
            .originReceiptAccepted,
        priorEvidenceContentInput:
          closure.activationSalt.provenance
            .priorEvidenceContentInput,
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
    artifactKind: ARTIFACT_KIND,
    boundary: {
      acceptedEpisodeCount: 0,
      candidateManifestFrozen: false,
      codexRunReady: false,
      commitAncestryProven: false,
      independentReview: false,
      officialWave3CapturePermitted: false,
      pretargetPolicyPromotionAccepted: false,
      preregisteredBeforeWave3Capture: false,
      priorRepositoryNodeIdExclusionComplete: false,
      selectionExecuted: false,
      sourceUniversePromotionAccepted: false,
      sourceUniverseFrozen: false,
      status:
        "policy-and-source-promotion-plus-prior-node-id-closure-required",
    },
    chronology: {
      unreceiptedExploratoryScaleProbes: {
        evidenceStatus:
          "unverified-design-note-not-gate-evidence",
        numericalObservationsRetained: false,
        occurred: true,
        permittedUse: "source-frame-design-only",
        receiptsBound: false,
      },
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
    inputs: {
      activationSalt: FROZEN_INPUTS.activationSalt,
      pretargetPolicy: FROZEN_INPUTS.pretargetPolicy,
      priorFrame: FROZEN_INPUTS.priorFrame,
      structuralUnion: FROZEN_INPUTS.structuralUnion,
    },
    repositoryUniverse: {
      host: "github.com",
      languageSplits: deriveLanguageSplits(
        closure.activationSalt.publicSaltHex,
      ),
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
    schemaVersion: 1,
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
    closure.activationSalt.boundary
      .firstAndOnlyDrawReviewAccepted ||
    closure.activationSalt.boundary
      .originReceiptAccepted ||
    closure.activationSalt.boundary
      .officialWave3CapturePermitted ||
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
      "C6 Wave3 source universe frozen input semantics mismatch",
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
        `C6 Wave3 source universe ${label} identity mismatch`,
      );
    }
    anchors.add(row.canonicalAnchorId);
  }
}

function deriveLanguageSplits(
  publicSaltHex: string,
): C6Wave3SourceUniverse["repositoryUniverse"]["languageSplits"] {
  const windows = deriveRootWindows();
  return z.array(languageSplitSchema).parse(
    LANGUAGE_SPLITS.map(({ language, split }) => {
      const shards = windows.map((window) => {
        const rootShardId = `${split}:${window.windowId}`;
        return {
          activationKeySha256: sha256(
            `${ROOT_SHARD_KEY_DOMAIN}\0` +
            `${publicSaltHex}\0${rootShardId}`,
          ),
          createdFrom: window.createdFrom,
          createdTo: window.createdTo,
          query: buildC6Wave3RepositorySearchQuery({
            createdFrom: window.createdFrom,
            createdTo: window.createdTo,
            language,
          }),
          rootShardId,
          windowId: window.windowId,
        };
      }).sort((left, right) =>
        compareStrings(
          left.activationKeySha256,
          right.activationKeySha256,
        ) || compareStrings(left.rootShardId, right.rootShardId)
      );
      return {
        language,
        rootShards: shards.map((shard, index) => ({
          activationOrder: index + 1,
          ...shard,
        })),
        split,
      };
    }),
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
      "C6 Wave3 source universe root window count mismatch",
    );
  }
  return windows;
}

function assertSourceUniverseSelfConsistency(
  sourceUniverse: C6Wave3SourceUniverse,
): void {
  const expectedSplits = deriveLanguageSplits(PUBLIC_SALT_HEX);
  const anchors = sourceUniverse.exclusions.canonicalAnchors;
  const repositories =
    sourceUniverse.exclusions.canonicalRepositories;
  if (
    sourceUniverse.activation.publicSalt.hex !==
      PUBLIC_SALT_HEX ||
    JSON.stringify(
      sourceUniverse.repositoryUniverse.languageSplits,
    ) !== JSON.stringify(expectedSplits) ||
    JSON.stringify(anchors) !==
      JSON.stringify(sortedUnique(anchors)) ||
    JSON.stringify(repositories) !==
      JSON.stringify(sortedUnique(repositories)) ||
    sha256(JSON.stringify(anchors)) !==
      FROZEN_EXCLUSION_PROJECTIONS.anchors ||
    sourceUniverse.exclusions
      .canonicalAnchorProjectionSha256 !==
        FROZEN_EXCLUSION_PROJECTIONS.anchors ||
    sha256(JSON.stringify(repositories)) !==
      FROZEN_EXCLUSION_PROJECTIONS.repositories ||
    sourceUniverse.exclusions
      .canonicalRepositoryProjectionSha256 !==
        FROZEN_EXCLUSION_PROJECTIONS.repositories ||
    JSON.stringify(sourceUniverse.activation.forbiddenSignals) !==
      JSON.stringify(ACTIVATION_FORBIDDEN_SIGNALS) ||
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
      "C6 Wave3 source universe self-consistency mismatch",
    );
  }
}

function parseInterval(
  input: C6Wave3SearchInterval,
): C6Wave3SearchInterval {
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
  const fromSeconds = toUtcSeconds(input.createdFrom);
  const toSeconds = toUtcSeconds(input.createdTo);
  if (fromSeconds > toSeconds) {
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
      "C6 Wave3 source universe published output ownership mismatch",
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
