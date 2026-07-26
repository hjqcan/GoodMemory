import { createHash } from "node:crypto";

import { z } from "zod";

import {
  parseC6Wave3SourceUniverseV2,
} from "./c6-wave3-source-universe-v2";

const SOURCE_V2 = {
  artifactKind: "c6-wave3-source-universe",
  bytes: 631_004,
  path:
    "swe-bench-live-multilang-608f7ae9." +
    "wave3-source-universe-v2.json",
  schemaVersion: 2,
  sha256:
    "822c458e792ee31f7738cae2526b05dfc3b63fcaac58e3f4f87dcd3803ccdba1",
} as const;

const SOURCE_FRAME_PROJECTION_SHA256 =
  "efb76e58585c6c422020954783eee50e37290d94f78310bd88c176929fa85474";

const PRETARGET_POLICY = {
  artifactKind: "c6-wave3-pretarget-policy",
  bytes: 9_105,
  path:
    "swe-bench-live-multilang-608f7ae9." +
    "wave3-pretarget-policy-v1.json",
  schemaVersion: 1,
  sha256:
    "eb3df63ff269b1d0166ed4b2faba682d60cdce3fb1ea64946e66f08e5eda9856",
} as const;

const protocolSchema = z.object({
  artifactKind: z.literal("c6-source-v3-simple-protocol"),
  boundary: z.object({
    acceptedEpisodeCount: z.literal(0),
    candidateManifestFrozen: z.literal(false),
    codexRunReady: z.literal(false),
    formalCensusPermitted: z.literal(false),
    sourceV3SimpleFrozen: z.literal(false),
    status: z.literal(
      "independent-review-and-freeze-ancestry-required",
    ),
  }).strict(),
  censusProtocol: z.object({
    callerOrderOverrideAllowed: z.literal(false),
    capturePasses: z.literal(2),
    completeRootShardCount: z.literal(1_536),
    downstreamYieldStoppingAllowed: z.literal(false),
    failurePolicy: z.literal(
      "fail-evaluation-id-without-redraw-or-frame-expansion",
    ),
    metadataDecisionLedger: z.literal(
      "one-accepted-or-rejected-decision-per-enumerated-pull-request",
    ),
    mode: z.literal("complete-finite-frame"),
    pullRequestOrder: z.literal(
      "createdAt-descending-then-pullRequestNodeId-utf8-byte-ascending",
    ),
    quotaStoppingAllowed: z.literal(false),
    redrawAllowed: z.literal(false),
    repositoryEnumeration: z.literal(
      "all-normalized-repository-node-ids-from-every-complete-root-shard",
    ),
    repositoryOrder: z.literal(
      "repositoryNodeId-utf8-byte-ascending",
    ),
    rootShardOrder: z.literal(
      "rootShardId-utf8-byte-ascending",
    ),
    pullRequestEnumeration: z.literal(
      "all-merged-pull-requests-in-frozen-window-for-every-frame-repository",
    ),
    twoPassNormalizedProjectionEqualityRequired: z.literal(true),
  }).strict(),
  censusReceiptContract: z.object({
    actualReceiptPresent: z.literal(false),
    artifactKind: z.literal(
      "c6-source-v3-simple-census-receipt",
    ),
    requiredBindings: z.tuple([
      z.literal("protocol-bytes-and-sha256"),
      z.literal("complete-root-count-tree-and-leaf-set"),
      z.literal(
        "repository-page-request-response-cursor-and-terminal-closure",
      ),
      z.literal(
        "repository-normalization-source-sha256-and-two-pass-row-set-sha256",
      ),
      z.literal("alias-and-node-id-exclusion-closure"),
      z.literal(
        "pull-request-page-request-response-cursor-and-terminal-closure",
      ),
      z.literal(
        "pull-request-normalization-source-sha256-and-two-pass-row-set-sha256",
      ),
      z.literal(
        "one-metadata-decision-per-normalized-pull-request-row",
      ),
      z.literal("asset-lock-and-terminal-input-replay"),
    ]),
    schemaVersion: z.literal(1),
  }).strict(),
  estimand: z.object({
    cohort: z.literal("frozen-public-github-convenience-frame"),
    representative: z.literal(false),
    treatmentOutcomeObservationBeforeAllocation: z.literal("prohibited"),
  }).strict(),
  evaluationId: z.literal(
    "goodmemory-c6-codex-coding-effect-source-v3-simple-v1",
  ),
  downstreamGates: z.object({
    candidateSelectionPermitted: z.literal(false),
    episodeConstructionProtocol: z.literal(
      "required-separate-complete-edge-and-stage-triple-protocol",
    ),
    repositoryAllocationProtocol: z.literal(
      "required-separate-outcome-blind-power-and-precision-artifact",
    ),
    taskOriginAndRelationshipProtocol: z.literal(
      "required-separate-raw-row-projector-and-per-edge-review",
    ),
  }).strict(),
  promotionReceiptContract: z.object({
    artifactKind: z.literal(
      "c6-source-v3-simple-promotion-receipt",
    ),
    requiredBindings: z.tuple([
      z.literal("protocol-bytes-and-sha256"),
      z.literal("review-request-input-dispatch-response-provenance"),
      z.literal("reviewer-identity-and-author-separation"),
      z.literal("freeze-commit-tree-parent-and-ancestry"),
      z.literal("verifier-source-sha256"),
      z.literal("prior-repository-node-id-exclusion-closure"),
    ]),
    schemaVersion: z.literal(1),
    selfAuthorizationAllowed: z.literal(false),
  }).strict(),
  schemaVersion: z.literal(1),
  sourceFrame: z.object({
    inheritedSections: z.tuple([
      z.literal("exclusions"),
      z.literal("inputPolicy"),
      z.literal("repositoryUniverse"),
      z.literal("searchProtocol"),
    ]),
    rootShardCount: z.literal(1_536),
    metadataPredicate: z.object({
      artifactKind: z.literal(PRETARGET_POLICY.artifactKind),
      bytes: z.literal(PRETARGET_POLICY.bytes),
      path: z.literal(PRETARGET_POLICY.path),
      schemaVersion: z.literal(PRETARGET_POLICY.schemaVersion),
      sha256: z.literal(PRETARGET_POLICY.sha256),
    }).strict(),
    sourceFrameProjectionSha256: z.literal(
      SOURCE_FRAME_PROJECTION_SHA256,
    ),
    sourceV2: z.object({
      artifactKind: z.literal(SOURCE_V2.artifactKind),
      bytes: z.literal(SOURCE_V2.bytes),
      path: z.literal(SOURCE_V2.path),
      schemaVersion: z.literal(SOURCE_V2.schemaVersion),
      sha256: z.literal(SOURCE_V2.sha256),
    }).strict(),
    supersededSections: z.tuple([
      z.literal("activationPlanProtocol"),
      z.literal("antiGrindingProtocol"),
    ]),
  }).strict(),
}).strict();

export type C6SourceV3SimpleProtocol = z.infer<
  typeof protocolSchema
>;

export function buildC6SourceV3SimpleProtocol(
  sourceV2Input: string | Uint8Array,
): {
  outputSha256: string;
  protocol: C6SourceV3SimpleProtocol;
} {
  const sourceV2Bytes = typeof sourceV2Input === "string"
    ? Buffer.from(sourceV2Input)
    : Buffer.from(sourceV2Input);
  if (
    sourceV2Bytes.length !== SOURCE_V2.bytes ||
    sha256(sourceV2Bytes) !== SOURCE_V2.sha256
  ) {
    throw new Error(
      "C6 source-v3-simple source-v2 bytes do not match the frozen reference",
    );
  }
  const sourceV2 = parseC6Wave3SourceUniverseV2(sourceV2Bytes);
  const sourceFrameProjection = {
    exclusions: sourceV2.exclusions,
    inputPolicy: sourceV2.inputPolicy,
    repositoryUniverse: sourceV2.repositoryUniverse,
    searchProtocol: sourceV2.searchProtocol,
  };
  if (
    sha256(JSON.stringify(sourceFrameProjection)) !==
      SOURCE_FRAME_PROJECTION_SHA256
  ) {
    throw new Error(
      "C6 source-v3-simple source frame projection mismatch",
    );
  }

  const protocol = protocolSchema.parse({
    artifactKind: "c6-source-v3-simple-protocol",
    boundary: {
      acceptedEpisodeCount: 0,
      candidateManifestFrozen: false,
      codexRunReady: false,
      formalCensusPermitted: false,
      sourceV3SimpleFrozen: false,
      status: "independent-review-and-freeze-ancestry-required",
    },
    censusProtocol: {
      callerOrderOverrideAllowed: false,
      capturePasses: 2,
      completeRootShardCount: sourceV2.repositoryUniverse.rootShardCount,
      downstreamYieldStoppingAllowed: false,
      failurePolicy:
        "fail-evaluation-id-without-redraw-or-frame-expansion",
      metadataDecisionLedger:
        "one-accepted-or-rejected-decision-per-enumerated-pull-request",
      mode: "complete-finite-frame",
      pullRequestOrder:
        "createdAt-descending-then-pullRequestNodeId-utf8-byte-ascending",
      pullRequestEnumeration:
        "all-merged-pull-requests-in-frozen-window-for-every-frame-repository",
      quotaStoppingAllowed: false,
      redrawAllowed: false,
      repositoryEnumeration:
        "all-normalized-repository-node-ids-from-every-complete-root-shard",
      repositoryOrder:
        "repositoryNodeId-utf8-byte-ascending",
      rootShardOrder: "rootShardId-utf8-byte-ascending",
      twoPassNormalizedProjectionEqualityRequired: true,
    },
    censusReceiptContract: {
      actualReceiptPresent: false,
      artifactKind: "c6-source-v3-simple-census-receipt",
      requiredBindings: [
        "protocol-bytes-and-sha256",
        "complete-root-count-tree-and-leaf-set",
        "repository-page-request-response-cursor-and-terminal-closure",
        "repository-normalization-source-sha256-and-two-pass-row-set-sha256",
        "alias-and-node-id-exclusion-closure",
        "pull-request-page-request-response-cursor-and-terminal-closure",
        "pull-request-normalization-source-sha256-and-two-pass-row-set-sha256",
        "one-metadata-decision-per-normalized-pull-request-row",
        "asset-lock-and-terminal-input-replay",
      ],
      schemaVersion: 1,
    },
    estimand: {
      cohort: "frozen-public-github-convenience-frame",
      representative: false,
      treatmentOutcomeObservationBeforeAllocation: "prohibited",
    },
    evaluationId:
      "goodmemory-c6-codex-coding-effect-source-v3-simple-v1",
    downstreamGates: {
      candidateSelectionPermitted: false,
      episodeConstructionProtocol:
        "required-separate-complete-edge-and-stage-triple-protocol",
      repositoryAllocationProtocol:
        "required-separate-outcome-blind-power-and-precision-artifact",
      taskOriginAndRelationshipProtocol:
        "required-separate-raw-row-projector-and-per-edge-review",
    },
    promotionReceiptContract: {
      artifactKind: "c6-source-v3-simple-promotion-receipt",
      requiredBindings: [
        "protocol-bytes-and-sha256",
        "review-request-input-dispatch-response-provenance",
        "reviewer-identity-and-author-separation",
        "freeze-commit-tree-parent-and-ancestry",
        "verifier-source-sha256",
        "prior-repository-node-id-exclusion-closure",
      ],
      schemaVersion: 1,
      selfAuthorizationAllowed: false,
    },
    schemaVersion: 1,
    sourceFrame: {
      inheritedSections: [
        "exclusions",
        "inputPolicy",
        "repositoryUniverse",
        "searchProtocol",
      ],
      metadataPredicate: PRETARGET_POLICY,
      rootShardCount: sourceV2.repositoryUniverse.rootShardCount,
      sourceFrameProjectionSha256:
        SOURCE_FRAME_PROJECTION_SHA256,
      sourceV2: SOURCE_V2,
      supersededSections: [
        "activationPlanProtocol",
        "antiGrindingProtocol",
      ],
    },
  });
  const serialized = serializeC6SourceV3SimpleProtocol(protocol);
  return {
    outputSha256: sha256(serialized),
    protocol,
  };
}

export function serializeC6SourceV3SimpleProtocol(
  input: C6SourceV3SimpleProtocol,
): string {
  return `${JSON.stringify(protocolSchema.parse(input), null, 2)}\n`;
}

export function parseC6SourceV3SimpleProtocol(
  input: string | Uint8Array,
): C6SourceV3SimpleProtocol {
  const text = typeof input === "string"
    ? input
    : Buffer.from(input).toString("utf8");
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch {
    throw new Error("C6 source-v3-simple invalid JSON");
  }
  if (text !== `${JSON.stringify(raw, null, 2)}\n`) {
    throw new Error("C6 source-v3-simple requires canonical JSON");
  }
  return protocolSchema.parse(raw);
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
