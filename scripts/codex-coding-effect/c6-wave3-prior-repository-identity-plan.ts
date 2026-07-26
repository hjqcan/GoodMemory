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
  buildC6Wave3PriorRepositoryIdentityCaptureArtifact,
  buildC6Wave3PriorRepositoryIdentityQualificationArtifact,
  C6_WAVE3_PRIOR_REPOSITORY_IDENTITY_FROZEN,
  C6_WAVE3_PRIOR_REPOSITORY_IDENTITY_QUERY,
  parseC6Wave3PriorRepositoryIdentityCaptureArtifact,
  parseC6Wave3PriorRepositoryIdentityQualificationArtifact,
  serializeC6Wave3PriorRepositoryIdentityCaptureArtifact,
  serializeC6Wave3PriorRepositoryIdentityQualificationArtifact,
  verifyC6Wave3PriorRepositoryIdentityDraftEvidenceArtifact,
} from "./c6-wave3-prior-repository-identity-artifacts";
import type {
  C6Wave3PriorRepositoryIdentityArtifactPlanContext,
  C6Wave3PriorRepositoryIdentityArtifactTestHooks,
  C6Wave3PriorRepositoryIdentityAssetLockReference,
  C6Wave3PriorRepositoryIdentityCapture,
  C6Wave3PriorRepositoryIdentityCaptureLookup,
  C6Wave3PriorRepositoryIdentityQualification,
} from "./c6-wave3-prior-repository-identity-artifacts";
import type {
  C6Wave3PriorRepositoryIdentityCompletionCapability,
} from "./c6-wave3-prior-repository-identity-capture";
import {
  parseC6Wave3SourceUniverseV2,
} from "./c6-wave3-source-universe-v2";

const {
  captureBasename: CAPTURE_BASENAME,
  lookupCount: LOOKUP_COUNT,
  planArtifactKind: ARTIFACT_KIND,
  planBasename: PLAN_BASENAME,
  repositoryCount: REPOSITORY_COUNT,
  repositoryProjectionSha256:
    REPOSITORY_PROJECTION_SHA256,
  sourceArtifactKind: SOURCE_ARTIFACT_KIND,
  sourceBasename: SOURCE_BASENAME,
  sourceBytes: SOURCE_BYTES,
  sourceSha256: SOURCE_SHA256,
} = C6_WAVE3_PRIOR_REPOSITORY_IDENTITY_FROZEN;
const QUERY_SHA256 =
  "c182b2706394b838b194d053077c6d1af3d0b76ca541a31a78f7c8846492566b";
const RETRY_AFTER_RULE =
  "null-or-absent-use-exponential-1000-2000-4000-" +
  "canonical-unsigned-decimal-seconds-0-through-60-use-" +
  "seconds-times-1000-invalid-fraction-http-date-or-over-60-abort";
const RETRYABLE_HTTP_OUTCOME_RULE =
  "retryable-http-status=>retry-if-attempt-below-4-and-" +
  "retry-after-null-or-canonical-0-through-60-else-abort";

export {
  C6_WAVE3_PRIOR_REPOSITORY_IDENTITY_QUERY,
};
export type {
  C6Wave3PriorRepositoryIdentityArtifactTestHooks,
  C6Wave3PriorRepositoryIdentityAssetLockReference,
  C6Wave3PriorRepositoryIdentityCapture,
  C6Wave3PriorRepositoryIdentityCaptureLookup,
  C6Wave3PriorRepositoryIdentityQualification,
};

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const repositorySchema = z.string().regex(
  /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u,
);
const targetSchema = z.object({
  passALookupOrder: z.number().int().min(1).max(
    REPOSITORY_COUNT,
  ),
  passBLookupOrder: z.number().int().min(
    REPOSITORY_COUNT + 1,
  ).max(LOOKUP_COUNT),
  repositoryOrder: z.number().int().min(1).max(
    REPOSITORY_COUNT,
  ),
  requestedName: z.string().regex(/^[A-Za-z0-9_.-]+$/u),
  requestedNameWithOwner: repositorySchema,
  requestedOwner: z.string().regex(/^[A-Za-z0-9_.-]+$/u),
  requestedRepositorySha256: sha256Schema,
}).strict();
const captureArtifactContractSchema = z.object({
  artifactKind: z.literal(
    "c6-wave3-prior-repository-identity-capture",
  ),
  authorizationRule: z.literal(
    "capture-artifact-alone-never-authorizes-official-wave3-search",
  ),
  boundary: z.object({
    captureCompleted: z.literal(true),
    officialWave3SearchPermitted: z.literal(false),
    priorIdentityQualificationExecuted: z.literal(false),
    status: z.literal(
      "capture-complete-awaiting-qualification",
    ),
  }).strict(),
  completion: z.object({
    allAttemptReferencesRequired: z.literal(true),
    everyLookupFinalOutcome: z.literal(
      "complete-graphql-http-200",
    ),
    lookupOrder: z.literal(
      "1-through-356-exactly-once",
    ),
    rawEvidenceAssetLockRequired: z.literal(true),
    successfulLogicalLookupCount: z.literal(LOOKUP_COUNT),
  }).strict(),
  inputClosure: z.object({
    filesystemVerification: z.literal(
      "no-symlink-stable-read-identity-and-bytes-terminal-replay",
    ),
    fixedInputBasenames: z.tuple([
      z.literal(PLAN_BASENAME),
      z.literal(SOURCE_BASENAME),
    ]),
  }).strict(),
  recordSchemas: z.object({
    artifactReferenceRequiredFields: z.tuple([
      z.literal("bytes"),
      z.literal("path"),
      z.literal("sha256"),
    ]),
    attemptOutcomeEnum: z.tuple([
      z.literal("complete-graphql-http-200"),
      z.literal("graphql-http-200-invalid"),
      z.literal("retryable-http-status"),
      z.literal("terminal-http-status"),
      z.literal("transient-transport-failure"),
      z.literal("terminal-transport-failure"),
    ]),
    attemptRecordRequiredFields: z.tuple([
      z.literal("attempt"),
      z.literal("attemptArtifact"),
      z.literal("httpResponseExists"),
      z.literal("httpStatus"),
      z.literal("lookupOrder"),
      z.literal("outcome"),
      z.literal("request"),
      z.literal("requestBody"),
      z.literal("requestProjection"),
      z.literal("responseBody"),
      z.literal("responseBodyReadCompleted"),
      z.literal("responseHeaders"),
      z.literal("retryDecision"),
      z.literal("selectedResponseHeaders"),
      z.literal("transportError"),
    ]),
    countsRequiredFields: z.tuple([
      z.literal("logicalLookupCount"),
      z.literal("networkAttemptCount"),
      z.literal("successfulLogicalLookupCount"),
    ]),
    inputsRequiredFields: z.tuple([
      z.literal("captureAssetLock"),
      z.literal("plan"),
      z.literal("sourceUniverse"),
    ]),
    lookupRecordRequiredFields: z.tuple([
      z.literal("attempts"),
      z.literal("finalAttempt"),
      z.literal("lookupOrder"),
      z.literal("pass"),
      z.literal("repositoryNodeId"),
      z.literal("repositoryOrder"),
      z.literal("requestedName"),
      z.literal("requestedNameWithOwner"),
      z.literal("requestedOwner"),
      z.literal("requestedRepositorySha256"),
      z.literal("resolvedNameWithOwner"),
      z.literal("resolvedUrl"),
      z.literal("response"),
      z.literal("success"),
    ]),
    requestRecordRequiredFields: z.tuple([
      z.literal("attempt"),
      z.literal("body"),
      z.literal("endpoint"),
      z.literal("headers"),
      z.literal("lookupOrder"),
      z.literal("method"),
      z.literal("redirect"),
      z.literal("timeoutMilliseconds"),
      z.literal("variables"),
    ]),
    nullabilityRules: z.object({
      httpStatus: z.literal(
        "integer-100-through-599-iff-httpResponseExists-else-null",
      ),
      responseBody: z.literal(
        "artifact-reference-iff-responseBodyReadCompleted-else-null",
      ),
      responseBodyReadCompleted: z.literal(
        "true-implies-httpResponseExists",
      ),
      transportError: z.literal(
        "artifact-reference-iff-transport-failure-outcome-else-null",
      ),
    }).strict(),
    outcomeDecisionRules: z.tuple([
      z.literal(
        "complete-graphql-http-200=>stop-success:complete-graphql-response",
      ),
      z.literal(
        "graphql-http-200-invalid=>abort:graphql-or-required-field-or-header-reason",
      ),
      z.literal(
        RETRYABLE_HTTP_OUTCOME_RULE,
      ),
      z.literal(
        "terminal-http-status=>abort:nonretryable-http-status",
      ),
      z.literal(
        "transient-transport-failure=>retry-if-attempt-below-4-else-abort",
      ),
      z.literal(
        "terminal-transport-failure=>abort:terminal-transport-error",
      ),
    ]),
    retryDecisionEnum: z.tuple([
      z.literal("abort"),
      z.literal("retry"),
      z.literal("stop-success"),
    ]),
    retryDecisionRequiredFields: z.tuple([
      z.literal("decision"),
      z.literal("delayMilliseconds"),
      z.literal("reason"),
      z.literal("retryAfter"),
    ]),
    retryReasonEnum: z.tuple([
      z.literal("complete-graphql-response"),
      z.literal("graphql-errors-or-partial-data"),
      z.literal("missing-required-success-header"),
      z.literal("missing-required-response-field"),
      z.literal("retryable-http-429"),
      z.literal("retryable-http-502"),
      z.literal("retryable-http-503"),
      z.literal("retryable-http-504"),
      z.literal("nonretryable-http-status"),
      z.literal("retry-after-invalid-or-over-maximum"),
      z.literal("transient-transport-code"),
      z.literal("terminal-transport-error"),
      z.literal("maximum-attempts-exhausted"),
    ]),
    transportErrorPhaseEnum: z.tuple([
      z.literal("body-read"),
      z.literal("fetch"),
      z.literal("timeout"),
    ]),
    transportErrorRecordRequiredFields: z.tuple([
      z.literal("code"),
      z.literal("message"),
      z.literal("phase"),
      z.literal("transient"),
    ]),
    topLevelRequiredFields: z.tuple([
      z.literal("artifactKind"),
      z.literal("boundary"),
      z.literal("counts"),
      z.literal("inputs"),
      z.literal("lookups"),
      z.literal("schemaVersion"),
    ]),
  }).strict(),
  schemaVersion: z.literal(1),
  serialization: z.object({
    canonicalJsonRequired: z.literal(true),
    terminalInputReplayRequired: z.literal(true),
    unknownFields: z.literal("reject"),
  }).strict(),
}).strict();
const qualificationArtifactContractSchema = z.object({
  artifactKind: z.literal(
    "c6-wave3-prior-repository-identity-qualification",
  ),
  authorizationRule: z.literal(
    "qualification-artifact-alone-never-authorizes-official-wave3-search",
  ),
  boundary: z.object({
    officialWave3SearchPermitted: z.literal(false),
    priorRepositoryNodeIdExclusionComplete: z.literal(true),
    status: z.literal(
      "qualified-prior-node-id-closure-awaiting-external-promotion",
    ),
  }).strict(),
  caseFoldRules: z.object({
    algorithm: z.literal(
      "ascii-A-through-Z-to-a-through-z-only",
    ),
    nodeIdToResolvedFold: z.literal(
      "exactly-one-otherwise-fail-closed",
    ),
    requestedFoldToNodeId: z.literal(
      "exactly-one-otherwise-fail-closed",
    ),
    resolvedFoldToNodeId: z.literal(
      "exactly-one-otherwise-fail-closed",
    ),
  }).strict(),
  closure: z.object({
    aliasMappingCount: z.literal(REPOSITORY_COUNT),
    allRequestedAliasesPreserved: z.literal(true),
    assetLockRequired: z.literal(true),
    attemptReferencesRequiredForBothPasses: z.literal(true),
    successfulLogicalLookupCount: z.literal(LOOKUP_COUNT),
    uniqueNodeIdCount: z.literal(
      "1-through-178-equals-nodeIdDedup-row-count",
    ),
  }).strict(),
  inputClosure: z.object({
    artifactReferenceFields: z.tuple([
      z.literal("artifactKind"),
      z.literal("bytes"),
      z.literal("path"),
      z.literal("schemaVersion"),
      z.literal("sha256"),
    ]),
    assetLock: z.literal(
      "c6-asset-lock-v1-plus-assetRootSha256-and-lockSha256",
    ),
    filesystemVerification: z.literal(
      "no-symlink-stable-read-identity-and-bytes-terminal-replay",
    ),
    fixedInputBasenames: z.tuple([
      z.literal(CAPTURE_BASENAME),
      z.literal(PLAN_BASENAME),
      z.literal(SOURCE_BASENAME),
    ]),
    terminalReplay: z.literal(
      "all-input-bytes-and-asset-lock-must-match-before-publication",
    ),
  }).strict(),
  inputsRequired: z.tuple([
    z.literal("capture"),
    z.literal("captureAssetLock"),
    z.literal("plan"),
    z.literal("sourceUniverse"),
  ]),
  mapping: z.object({
    crossPassRule: z.literal(
      "same-exact-requested-name-must-have-identical-resolved-exact-name-and-node-id",
    ),
    rowRequiredFields: z.tuple([
      z.literal("passAAttemptReferences"),
      z.literal("passBAttemptReferences"),
      z.literal("repositoryNodeId"),
      z.literal("requestedNameWithOwner"),
      z.literal("resolvedNameWithOwner"),
    ]),
    sort: z.literal(
      "requestedNameWithOwner-code-unit-ascending",
    ),
  }).strict(),
  nodeIdDedup: z.object({
    rowRequiredFields: z.tuple([
      z.literal("repositoryNodeId"),
      z.literal("requestedAliases"),
      z.literal("resolvedNameWithOwnerAsciiFold"),
      z.literal("resolvedNameWithOwnerExactValues"),
    ]),
    requestedAliasesSort: z.literal(
      "code-unit-ascending",
    ),
    resolvedExactValuesSort: z.literal(
      "code-unit-ascending",
    ),
    sort: z.literal(
      "repositoryNodeId-code-unit-then-resolved-fold-ascending",
    ),
  }).strict(),
  projections: z.object({
    attemptReferenceRows: z.literal(
      "mapping-order-requested-name-passA-all-references-passB-all-references",
    ),
    formula: z.literal(
      "sha256-JSON.stringify-canonical-sorted-array",
    ),
    nodeIdDedupRows: z.literal(
      "exact-nodeIdDedup-rows-in-frozen-sort-order",
    ),
    requestedToResolvedRows: z.literal(
      "exact-mapping-rows-in-frozen-sort-order",
    ),
    requiredHashes: z.tuple([
      z.literal("attemptReferenceProjectionSha256"),
      z.literal("nodeIdDedupProjectionSha256"),
      z.literal(
        "requestedToResolvedMappingProjectionSha256",
      ),
    ]),
  }).strict(),
  schemaVersion: z.literal(1),
  serialization: z.object({
    canonicalJsonRequired: z.literal(true),
    terminalInputReplayRequired: z.literal(true),
    unknownFields: z.literal("reject"),
  }).strict(),
  topLevelRequiredFields: z.tuple([
    z.literal("artifactKind"),
    z.literal("boundary"),
    z.literal("counts"),
    z.literal("inputs"),
    z.literal("mappings"),
    z.literal("nodeIdDedup"),
    z.literal("projections"),
    z.literal("schemaVersion"),
  ]),
}).strict();
const planSchema = z.object({
  artifactKind: z.literal(ARTIFACT_KIND),
  boundary: z.object({
    acceptedEpisodeCount: z.literal(0),
    candidateManifestFrozen: z.literal(false),
    codexRunReady: z.literal(false),
    officialWave3SearchPermitted: z.literal(false),
    policyCommitAncestryProven: z.literal(false),
    policyIndependentReviewAccepted: z.literal(false),
    priorIdentityCaptureExecuted: z.literal(false),
    priorIdentityCapturePermitted: z.literal(false),
    sourceUniverseCommitAncestryProven: z.literal(false),
    sourceUniverseIndependentReviewAccepted: z.literal(false),
    status: z.literal(
      "prior-repository-identity-plan-proposal-only",
    ),
  }).strict(),
  captureArtifactContract: captureArtifactContractSchema,
  captureProtocol: z.object({
    asciiCaseFoldCollisionChecks: z.object({
      algorithm: z.literal(
        "ascii-A-through-Z-to-a-through-z-only",
      ),
      exactCasePreservedInputs: z.literal(true),
      requestedNameWithOwner: z.literal(
        "preserve-group-require-same-node-id-and-resolved-fold",
      ),
      resolvedNameWithOwner: z.literal(
        "require-one-node-id-per-fold",
      ),
    }).strict(),
    aliasResolution: z.object({
      duplicateRepositoryNodeId: z.literal(
        "allowed-across-requested-aliases-deduplicate-after-both-passes",
      ),
      requestedToResolvedMapping: z.literal(
        "preserve-every-exact-requested-name",
      ),
      resolvedIdentityConsistency: z.literal(
        "one-node-id-must-map-to-one-ascii-folded-resolved-name",
      ),
    }).strict(),
    crossPassEquality: z.object({
      exactCasePreservedFields: z.tuple([
        z.literal("requestedNameWithOwner"),
        z.literal("resolvedNameWithOwner"),
        z.literal("repositoryNodeId"),
      ]),
      required: z.literal(true),
    }).strict(),
    endpoint: z.literal("GraphQL Query.repository"),
    evidenceClosure: z.object({
      attemptDirectoryPattern: z.literal(
        "lookup-{lookupOrder-4-digit}/attempt-{attempt-2-digit}",
      ),
      completionAssetLock: z.object({
        coversEveryAttemptArtifact: z.literal(true),
        format: z.literal("c6-asset-lock-v1"),
        path: z.literal("asset-lock.json"),
        requiredAfterAllLookups: z.literal(true),
        symlinksRejected: z.literal(true),
        verifiedBeforeQualification: z.literal(true),
      }).strict(),
      graphqlBodyRateLimitFields: z.tuple([
        z.literal("cost"),
        z.literal("limit"),
        z.literal("remaining"),
        z.literal("resetAt"),
        z.literal("used"),
      ]),
      perAttemptArtifacts: z.object({
        artifactReference: z.literal("path-bytes-sha256"),
        attemptRecord: z.literal("attempt.json"),
        rawRequestBody: z.literal("request-body.raw"),
        rawResponseBody: z.literal(
          "response-body.raw-required-when-response-body-read-completes",
        ),
        requestMetadata: z.literal("request.json"),
        responseHeaders: z.literal(
          "response-headers.json",
        ),
        retryDecision: z.literal("retry-decision.json"),
        transportError: z.literal(
          "transport-error.json-only-on-transport-failure",
        ),
      }).strict(),
      selectedResponseHeaders: z.object({
        alwaysRequiredOnCompleteGraphqlHttp200: z.tuple([
          z.literal("date"),
          z.literal("x-github-request-id"),
          z.literal("x-ratelimit-limit"),
          z.literal("x-ratelimit-remaining"),
          z.literal("x-ratelimit-reset"),
          z.literal("x-ratelimit-resource"),
          z.literal("x-ratelimit-used"),
        ]),
        names: z.tuple([
          z.literal("date"),
          z.literal("retry-after"),
          z.literal("x-github-request-id"),
          z.literal("x-ratelimit-limit"),
          z.literal("x-ratelimit-remaining"),
          z.literal("x-ratelimit-reset"),
          z.literal("x-ratelimit-resource"),
          z.literal("x-ratelimit-used"),
        ]),
        projection: z.literal(
          "all-selected-names-present-as-string-or-null",
        ),
        retryAfterDecision: z.literal(
          RETRY_AFTER_RULE,
        ),
        successValidation: z.object({
          bodyCost: z.literal(
            "nonnegative-safe-integer",
          ),
          date: z.literal("rfc7231-imf-fixdate"),
          rateLimitBounds: z.literal(
            "zero-through-limit-for-remaining-and-used",
          ),
          rateLimitNumbers: z.literal(
            "canonical-unsigned-decimal-safe-integer",
          ),
          rateLimitProjection: z.literal(
            "limit-remaining-used-equal-body-and-reset-equals-resetAt-epoch-seconds",
          ),
          requestId: z.literal(
            "ascii-alphanumeric-first-then-alphanumeric-colon-hyphen-up-to-128",
          ),
          resetAt: z.literal("canonical-utc-second"),
          resource: z.literal("exact-graphql"),
          retryAfter: z.literal("null"),
        }).strict(),
      }).strict(),
      tokenRedaction: z.object({
        authorizationHeaderReceipt: z.literal(
          "Bearer <redacted>",
        ),
        completionCapability: z.literal(
          "not-issued-by-source-v2-external-promotion-verifier-required",
        ),
        preAssetLockOrdering: z.literal(
          "scan-every-runner-owned-regular-file-before-build-asset-lock",
        ),
        runnerErrorAndProgressTokenEmission: z.literal(false),
        runnerOwnedCaptureRootTokenPersistence:
          z.literal(false),
        scanScope: z.literal(
          "every-regular-file-byte-in-runner-owned-temporary-capture-root",
        ),
        terminalOrdering: z.literal(
          "write-and-load-asset-lock-then-rescan-token-and-verify-closure-before-structural-verifier",
        ),
        transportErrorSanitization: z.literal(
          "replace-all-exact-runtime-token-occurrences-before-runner-write-error-or-progress",
        ),
      }).strict(),
    }).strict(),
    fullPassBeforeNext: z.literal(true),
    lookupConcurrency: z.literal(1),
    lookupOrder: z.literal(
      "pass-A-repositoryOrder-ascending-then-pass-B-repositoryOrder-ascending",
    ),
    networkExecuted: z.literal(false),
    nextLookupRule: z.literal(
      "complete-and-reference-all-current-lookup-attempts-or-abort-before-next",
    ),
    normalization: z.object({
      repositoryNodeId: z.literal(
        "case-preserved-exact-nonempty-string",
      ),
      requestedNameWithOwner: z.literal(
        "case-preserved-exact-owner-slash-name",
      ),
      resolvedNameWithOwner: z.literal(
        "case-preserved-exact-owner-slash-name",
      ),
    }).strict(),
    operationName: z.literal(
      "C6Wave3PriorRepositoryIdentity",
    ),
    passOrder: z.tuple([z.literal("A"), z.literal("B")]),
    requestBody: z.object({
      canonicalization: z.literal(
        "utf8-JSON.stringify-no-trailing-newline-key-order-query-variables-name-owner",
      ),
      topLevelKeys: z.tuple([
        z.literal("query"),
        z.literal("variables"),
      ]),
      variableKeys: z.tuple([
        z.literal("name"),
        z.literal("owner"),
      ]),
      variables: z.literal(
        "name-and-owner-exactly-from-frozen-target",
      ),
    }).strict(),
    query: z.literal(
      C6_WAVE3_PRIOR_REPOSITORY_IDENTITY_QUERY,
    ),
    querySha256: z.literal(QUERY_SHA256),
    rateLimitReceipt: z.object({
      fields: z.tuple([
        z.literal("cost"),
        z.literal("limit"),
        z.literal("remaining"),
        z.literal("resetAt"),
        z.literal("used"),
      ]),
      requiredPerLookup: z.literal(true),
    }).strict(),
    retryPolicy: z.object({
      decisionReceiptRequiredEveryAttempt: z.literal(true),
      maximumNetworkAttemptsPerLookup: z.literal(4),
      maximumRetryDelayMilliseconds: z.literal(60_000),
      retryDelayRule: z.literal(
        RETRY_AFTER_RULE,
      ),
      retryableHttpStatuses: z.tuple([
        z.literal(429),
        z.literal(502),
        z.literal(503),
        z.literal(504),
      ]),
      retryableStatusDecisionBeforeSuccessHeaderValidation:
        z.literal(true),
      transientTransportCodes: z.tuple([
        z.literal("EAI_AGAIN"),
        z.literal("ECONNREFUSED"),
        z.literal("ECONNRESET"),
        z.literal("EHOSTUNREACH"),
        z.literal("ENETDOWN"),
        z.literal("ENETRESET"),
        z.literal("ENETUNREACH"),
        z.literal("ENOTFOUND"),
        z.literal("ETIMEDOUT"),
        z.literal("UND_ERR_CONNECT_TIMEOUT"),
        z.literal("UND_ERR_HEADERS_TIMEOUT"),
        z.literal("UND_ERR_SOCKET"),
      ]),
    }).strict(),
    responseFields: z.tuple([
      z.literal("id"),
      z.literal("nameWithOwner"),
      z.literal("url"),
    ]),
    transport: z.object({
      endpoint: z.literal(
        "https://api.github.com/graphql",
      ),
      headers: z.object({
        accept: z.literal(
          "application/vnd.github+json",
        ),
        authorization: z.literal("Bearer <redacted>"),
        "content-type": z.literal("application/json"),
        "user-agent": z.literal(
          "GoodMemory-C6-Wave3-Prior-Repository-Identity/1",
        ),
        "x-github-api-version": z.literal("2022-11-28"),
      }).strict(),
      method: z.literal("POST"),
      redirect: z.literal("error"),
      timeoutMilliseconds: z.literal(60_000),
    }).strict(),
    validation: z.object({
      crossPassMismatch: z.literal("fail-closed"),
      graphqlErrorsOrPartialData: z.literal("fail-closed"),
      missingRequiredHeader: z.literal(
        "fail-closed-only-on-complete-graphql-http-200",
      ),
      missingRequiredResponseField:
        z.literal("fail-closed"),
      non200HttpStatus: z.literal(
        "retry-only-under-frozen-policy-otherwise-fail-closed",
      ),
      nullRepository: z.literal("fail-closed"),
      oneRepositoryNodeIdWithInconsistentResolvedFold:
        z.literal("fail-closed"),
    }).strict(),
  }).strict(),
  counts: z.object({
    lookupCount: z.literal(LOOKUP_COUNT),
    passCount: z.literal(2),
    priorRepositoryCount: z.literal(REPOSITORY_COUNT),
  }).strict(),
  independenceBoundary: z.object({
    goldInput: z.literal(false),
    hiddenTestInput: z.literal(false),
    receiptHashAuthorizesCapture: z.literal(false),
    requestedRepositoryProjectionSha256: z.literal(
      REPOSITORY_PROJECTION_SHA256,
    ),
    targetProjectionSha256: sha256Schema,
  }).strict(),
  inputs: z.object({
    sourceUniverse: z.object({
      artifactKind: z.literal(SOURCE_ARTIFACT_KIND),
      bytes: z.literal(SOURCE_BYTES),
      canonicalRepositoryCount: z.literal(
        REPOSITORY_COUNT,
      ),
      canonicalRepositoryProjectionSha256: z.literal(
        REPOSITORY_PROJECTION_SHA256,
      ),
      path: z.literal(SOURCE_BASENAME),
      schemaVersion: z.literal(2),
      sha256: z.literal(SOURCE_SHA256),
    }).strict(),
  }).strict(),
  qualificationArtifactContract:
    qualificationArtifactContractSchema,
  schemaVersion: z.literal(1),
  targets: z.array(targetSchema).length(REPOSITORY_COUNT),
}).strict();

export type C6Wave3PriorRepositoryIdentityPlan = z.infer<
  typeof planSchema
>;

export interface C6Wave3PriorRepositoryIdentityPlanTestHooks {
  afterOutputPublication?: () => Promise<void> | void;
  beforeTerminalReplay?: () => Promise<void> | void;
}

export interface C6Wave3PriorRepositoryIdentityPlanBuildInput {
  sourceUniversePath: string;
  testHooks?: C6Wave3PriorRepositoryIdentityPlanTestHooks;
}

export async function buildC6Wave3PriorRepositoryIdentityPlan(
  input: C6Wave3PriorRepositoryIdentityPlanBuildInput,
): Promise<{
  outputSha256: string;
  plan: C6Wave3PriorRepositoryIdentityPlan;
}> {
  const initial = await readSourceUniverse(
    input.sourceUniversePath,
  );
  const plan = derivePlan(initial.repositories);
  const serialized =
    serializeC6Wave3PriorRepositoryIdentityPlan(plan);

  await input.testHooks?.beforeTerminalReplay?.();
  const terminal = await readSourceUniverse(
    input.sourceUniversePath,
  );
  const terminalSerialized =
    serializeC6Wave3PriorRepositoryIdentityPlan(
      derivePlan(terminal.repositories),
    );
  if (
    !terminal.bytes.equals(initial.bytes) ||
    terminalSerialized !== serialized
  ) {
    throw new Error(
      "C6 Wave3 prior repository identity source universe changed",
    );
  }
  parseC6Wave3PriorRepositoryIdentityPlan(serialized);
  return {
    outputSha256: sha256(serialized),
    plan,
  };
}

export function serializeC6Wave3PriorRepositoryIdentityPlan(
  plan: C6Wave3PriorRepositoryIdentityPlan,
): string {
  const parsed = planSchema.parse(plan);
  assertPlanSelfConsistency(parsed);
  return `${JSON.stringify(parsed, null, 2)}\n`;
}

export function parseC6Wave3PriorRepositoryIdentityPlan(
  input: string | Uint8Array,
): C6Wave3PriorRepositoryIdentityPlan {
  const text = typeof input === "string"
    ? input
    : Buffer.from(input).toString("utf8");
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch {
    throw new Error(
      "C6 Wave3 prior repository identity plan invalid JSON",
    );
  }
  if (text !== `${JSON.stringify(raw, null, 2)}\n`) {
    throw new Error(
      "C6 Wave3 prior repository identity plan requires canonical JSON",
    );
  }
  const plan = planSchema.parse(raw);
  assertPlanSelfConsistency(plan);
  return plan;
}

export async function buildC6Wave3PriorRepositoryIdentityCapture(
  input: {
    assetRoot: string;
    completionCapability?:
      C6Wave3PriorRepositoryIdentityCompletionCapability;
    lookups: readonly C6Wave3PriorRepositoryIdentityCaptureLookup[];
    plan: C6Wave3PriorRepositoryIdentityPlan;
    planPath: string;
    sourceUniversePath: string;
    testHooks?:
      C6Wave3PriorRepositoryIdentityArtifactTestHooks;
  },
): Promise<C6Wave3PriorRepositoryIdentityCapture> {
  const plan = planSchema.parse(input.plan);
  assertPlanSelfConsistency(plan);
  return await buildC6Wave3PriorRepositoryIdentityCaptureArtifact({
    assetRoot: input.assetRoot,
    completionCapability: input.completionCapability,
    lookups: input.lookups,
    plan: deriveArtifactPlanContext(plan),
    planPath: input.planPath,
    sourceUniversePath: input.sourceUniversePath,
    testHooks: input.testHooks,
  });
}

export async function verifyC6Wave3PriorRepositoryIdentityDraftEvidence(
  input: {
    assetRoot: string;
    lookups: readonly C6Wave3PriorRepositoryIdentityCaptureLookup[];
    plan: C6Wave3PriorRepositoryIdentityPlan;
    planPath: string;
    sourceUniversePath: string;
    testHooks?:
      C6Wave3PriorRepositoryIdentityArtifactTestHooks;
  },
): Promise<void> {
  const plan = planSchema.parse(input.plan);
  assertPlanSelfConsistency(plan);
  await verifyC6Wave3PriorRepositoryIdentityDraftEvidenceArtifact({
    assetRoot: input.assetRoot,
    lookups: input.lookups,
    plan: deriveArtifactPlanContext(plan),
    planPath: input.planPath,
    sourceUniversePath: input.sourceUniversePath,
    testHooks: input.testHooks,
  });
}

export async function serializeC6Wave3PriorRepositoryIdentityCapture(
  capture: C6Wave3PriorRepositoryIdentityCapture,
  context: {
    assetRoot: string;
    completionCapability?:
      C6Wave3PriorRepositoryIdentityCompletionCapability;
    plan: C6Wave3PriorRepositoryIdentityPlan;
    planPath: string;
    sourceUniversePath: string;
    testHooks?:
      C6Wave3PriorRepositoryIdentityArtifactTestHooks;
  },
): Promise<string> {
  const plan = planSchema.parse(context.plan);
  assertPlanSelfConsistency(plan);
  return await serializeC6Wave3PriorRepositoryIdentityCaptureArtifact(
    capture,
    {
      assetRoot: context.assetRoot,
      completionCapability: context.completionCapability,
      plan: deriveArtifactPlanContext(plan),
      planPath: context.planPath,
      sourceUniversePath: context.sourceUniversePath,
      testHooks: context.testHooks,
    },
  );
}

export async function parseC6Wave3PriorRepositoryIdentityCapture(
  input: string | Uint8Array,
  context: {
    assetRoot: string;
    completionCapability?:
      C6Wave3PriorRepositoryIdentityCompletionCapability;
    plan: C6Wave3PriorRepositoryIdentityPlan;
    planPath: string;
    sourceUniversePath: string;
    testHooks?:
      C6Wave3PriorRepositoryIdentityArtifactTestHooks;
  },
): Promise<C6Wave3PriorRepositoryIdentityCapture> {
  const plan = planSchema.parse(context.plan);
  assertPlanSelfConsistency(plan);
  return await parseC6Wave3PriorRepositoryIdentityCaptureArtifact(
    input,
    {
      assetRoot: context.assetRoot,
      completionCapability: context.completionCapability,
      plan: deriveArtifactPlanContext(plan),
      planPath: context.planPath,
      sourceUniversePath: context.sourceUniversePath,
      testHooks: context.testHooks,
    },
  );
}

export async function buildC6Wave3PriorRepositoryIdentityQualification(
  input: {
    assetRoot: string;
    capture: C6Wave3PriorRepositoryIdentityCapture;
    capturePath: string;
    completionCapability?:
      C6Wave3PriorRepositoryIdentityCompletionCapability;
    plan: C6Wave3PriorRepositoryIdentityPlan;
    planPath: string;
    sourceUniversePath: string;
    testHooks?:
      C6Wave3PriorRepositoryIdentityArtifactTestHooks;
  },
): Promise<C6Wave3PriorRepositoryIdentityQualification> {
  const plan = planSchema.parse(input.plan);
  assertPlanSelfConsistency(plan);
  return await buildC6Wave3PriorRepositoryIdentityQualificationArtifact({
    assetRoot: input.assetRoot,
    capture: input.capture,
    capturePath: input.capturePath,
    completionCapability: input.completionCapability,
    plan: deriveArtifactPlanContext(plan),
    planPath: input.planPath,
    sourceUniversePath: input.sourceUniversePath,
    testHooks: input.testHooks,
  });
}

export async function serializeC6Wave3PriorRepositoryIdentityQualification(
  qualification: C6Wave3PriorRepositoryIdentityQualification,
  context: {
    assetRoot: string;
    capture: C6Wave3PriorRepositoryIdentityCapture;
    capturePath: string;
    completionCapability?:
      C6Wave3PriorRepositoryIdentityCompletionCapability;
    plan: C6Wave3PriorRepositoryIdentityPlan;
    planPath: string;
    sourceUniversePath: string;
    testHooks?:
      C6Wave3PriorRepositoryIdentityArtifactTestHooks;
  },
): Promise<string> {
  const plan = planSchema.parse(context.plan);
  assertPlanSelfConsistency(plan);
  return await serializeC6Wave3PriorRepositoryIdentityQualificationArtifact(
    qualification,
    {
      assetRoot: context.assetRoot,
      capture: context.capture,
      capturePath: context.capturePath,
      completionCapability: context.completionCapability,
      plan: deriveArtifactPlanContext(plan),
      planPath: context.planPath,
      sourceUniversePath: context.sourceUniversePath,
      testHooks: context.testHooks,
    },
  );
}

export async function parseC6Wave3PriorRepositoryIdentityQualification(
  input: string | Uint8Array,
  context: {
    assetRoot: string;
    capture: C6Wave3PriorRepositoryIdentityCapture;
    capturePath: string;
    completionCapability?:
      C6Wave3PriorRepositoryIdentityCompletionCapability;
    plan: C6Wave3PriorRepositoryIdentityPlan;
    planPath: string;
    sourceUniversePath: string;
    testHooks?:
      C6Wave3PriorRepositoryIdentityArtifactTestHooks;
  },
): Promise<C6Wave3PriorRepositoryIdentityQualification> {
  const plan = planSchema.parse(context.plan);
  assertPlanSelfConsistency(plan);
  return await parseC6Wave3PriorRepositoryIdentityQualificationArtifact(
    input,
    {
      assetRoot: context.assetRoot,
      capture: context.capture,
      capturePath: context.capturePath,
      completionCapability: context.completionCapability,
      plan: deriveArtifactPlanContext(plan),
      planPath: context.planPath,
      sourceUniversePath: context.sourceUniversePath,
      testHooks: context.testHooks,
    },
  );
}
export function requireC6Wave3PriorRepositoryIdentityCaptureAuthorization(
  input: unknown,
): never {
  planSchema.parse(input);
  throw new Error(
    "C6 Wave3 prior repository identity plan cannot authorize " +
    "capture; external promotion verifier is required",
  );
}

export async function materializeC6Wave3PriorRepositoryIdentityPlan(
  input:
    C6Wave3PriorRepositoryIdentityPlanBuildInput & {
      outputPath: string;
    },
): Promise<{
  outputSha256: string;
  plan: C6Wave3PriorRepositoryIdentityPlan;
}> {
  const result =
    await buildC6Wave3PriorRepositoryIdentityPlan(input);
  const serialized =
    serializeC6Wave3PriorRepositoryIdentityPlan(result.plan);
  const outputPath = resolve(input.outputPath);
  const outputParent = await assertC6NoSymlinkPathComponents(
    dirname(outputPath),
    "C6 Wave3 prior repository identity output parent",
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
          "C6 Wave3 prior repository identity temporary output identity mismatch",
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
      "Wave3 prior repository identity temporary output",
    );
    if (temporaryBytes.toString("utf8") !== serialized) {
      throw new Error(
        "C6 Wave3 prior repository identity temporary output mismatch",
      );
    }
    await assertC6NoSymlinkPathComponents(
      outputParent,
      "C6 Wave3 prior repository identity terminal output parent",
    );
    await link(temporaryPath, outputPath);
    await assertPublishedOutputOwnership({
      outputPath,
      ownedIdentity,
      temporaryPath,
    });

    await input.testHooks?.afterOutputPublication?.();
    const replayed =
      await buildC6Wave3PriorRepositoryIdentityPlan({
        sourceUniversePath: input.sourceUniversePath,
      });
    if (
      replayed.outputSha256 !== result.outputSha256 ||
      serializeC6Wave3PriorRepositoryIdentityPlan(
        replayed.plan,
      ) !== serialized
    ) {
      throw new Error(
        "C6 Wave3 prior repository identity post-publication replay mismatch",
      );
    }
    await assertPublishedOutputOwnership({
      outputPath,
      ownedIdentity,
      temporaryPath,
    });
    const published = await readC6StableRegularFile(
      outputPath,
      "Wave3 prior repository identity published output",
    );
    if (
      serializeC6Wave3PriorRepositoryIdentityPlan(
        parseC6Wave3PriorRepositoryIdentityPlan(published),
      ) !== serialized
    ) {
      throw new Error(
        "C6 Wave3 prior repository identity published output mismatch",
      );
    }
    await assertPublishedOutputOwnership({
      outputPath,
      ownedIdentity,
      temporaryPath,
    });
    if (
      !await removePathIfOwned(temporaryPath, ownedIdentity)
    ) {
      throw new Error(
        "C6 Wave3 prior repository identity temporary output cleanup mismatch",
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

interface LoadedSourceUniverse {
  bytes: Buffer;
  repositories: string[];
}

interface OwnedFileIdentity {
  dev: number;
  ino: number;
}

async function readSourceUniverse(
  sourceUniversePathInput: string,
): Promise<LoadedSourceUniverse> {
  const sourceUniversePath =
    await assertC6NoSymlinkPathComponents(
      sourceUniversePathInput,
      "C6 Wave3 prior repository identity source universe",
    );
  const bytes = await readC6StableRegularFile(
    sourceUniversePath,
    "Wave3 prior repository identity source universe",
  );
  if (
    basename(sourceUniversePath) !== SOURCE_BASENAME ||
    bytes.byteLength !== SOURCE_BYTES ||
    sha256(bytes) !== SOURCE_SHA256
  ) {
    throw new Error(
      "C6 Wave3 prior repository identity source universe hash mismatch",
    );
  }
  const sourceUniverse = parseC6Wave3SourceUniverseV2(bytes);
  const repositories = [
    ...sourceUniverse.exclusions.canonicalRepositories,
  ];
  if (
    repositories.length !== REPOSITORY_COUNT ||
    JSON.stringify(repositories) !==
      JSON.stringify(sortedUnique(repositories)) ||
    sha256(JSON.stringify(repositories)) !==
      REPOSITORY_PROJECTION_SHA256 ||
    sourceUniverse.exclusions
      .canonicalRepositoryProjectionSha256 !==
        REPOSITORY_PROJECTION_SHA256 ||
    sourceUniverse.boundary.commitAncestryProven ||
    sourceUniverse.boundary.independentReview ||
    sourceUniverse.boundary.officialWave3CapturePermitted
  ) {
    throw new Error(
      "C6 Wave3 prior repository identity source universe semantics mismatch",
    );
  }
  return {
    bytes,
    repositories,
  };
}

function deriveCaptureArtifactContract(): z.infer<
  typeof captureArtifactContractSchema
> {
  return {
    artifactKind:
      "c6-wave3-prior-repository-identity-capture",
    authorizationRule:
      "capture-artifact-alone-never-authorizes-official-wave3-search",
    boundary: {
      captureCompleted: true,
      officialWave3SearchPermitted: false,
      priorIdentityQualificationExecuted: false,
      status: "capture-complete-awaiting-qualification",
    },
    completion: {
      allAttemptReferencesRequired: true,
      everyLookupFinalOutcome:
        "complete-graphql-http-200",
      lookupOrder: "1-through-356-exactly-once",
      rawEvidenceAssetLockRequired: true,
      successfulLogicalLookupCount: LOOKUP_COUNT,
    },
    inputClosure: {
      filesystemVerification:
        "no-symlink-stable-read-identity-and-bytes-terminal-replay",
      fixedInputBasenames: [
        PLAN_BASENAME,
        SOURCE_BASENAME,
      ],
    },
    recordSchemas: {
      artifactReferenceRequiredFields: [
        "bytes",
        "path",
        "sha256",
      ],
      attemptOutcomeEnum: [
        "complete-graphql-http-200",
        "graphql-http-200-invalid",
        "retryable-http-status",
        "terminal-http-status",
        "transient-transport-failure",
        "terminal-transport-failure",
      ],
      attemptRecordRequiredFields: [
        "attempt",
        "attemptArtifact",
        "httpResponseExists",
        "httpStatus",
        "lookupOrder",
        "outcome",
        "request",
        "requestBody",
        "requestProjection",
        "responseBody",
        "responseBodyReadCompleted",
        "responseHeaders",
        "retryDecision",
        "selectedResponseHeaders",
        "transportError",
      ],
      countsRequiredFields: [
        "logicalLookupCount",
        "networkAttemptCount",
        "successfulLogicalLookupCount",
      ],
      inputsRequiredFields: [
        "captureAssetLock",
        "plan",
        "sourceUniverse",
      ],
      lookupRecordRequiredFields: [
        "attempts",
        "finalAttempt",
        "lookupOrder",
        "pass",
        "repositoryNodeId",
        "repositoryOrder",
        "requestedName",
        "requestedNameWithOwner",
        "requestedOwner",
        "requestedRepositorySha256",
        "resolvedNameWithOwner",
        "resolvedUrl",
        "response",
        "success",
      ],
      requestRecordRequiredFields: [
        "attempt",
        "body",
        "endpoint",
        "headers",
        "lookupOrder",
        "method",
        "redirect",
        "timeoutMilliseconds",
        "variables",
      ],
      nullabilityRules: {
        httpStatus:
          "integer-100-through-599-iff-httpResponseExists-else-null",
        responseBody:
          "artifact-reference-iff-responseBodyReadCompleted-else-null",
        responseBodyReadCompleted:
          "true-implies-httpResponseExists",
        transportError:
          "artifact-reference-iff-transport-failure-outcome-else-null",
      },
      outcomeDecisionRules: [
        "complete-graphql-http-200=>stop-success:complete-graphql-response",
        "graphql-http-200-invalid=>abort:graphql-or-required-field-or-header-reason",
        RETRYABLE_HTTP_OUTCOME_RULE,
        "terminal-http-status=>abort:nonretryable-http-status",
        "transient-transport-failure=>retry-if-attempt-below-4-else-abort",
        "terminal-transport-failure=>abort:terminal-transport-error",
      ],
      retryDecisionEnum: [
        "abort",
        "retry",
        "stop-success",
      ],
      retryDecisionRequiredFields: [
        "decision",
        "delayMilliseconds",
        "reason",
        "retryAfter",
      ],
      retryReasonEnum: [
        "complete-graphql-response",
        "graphql-errors-or-partial-data",
        "missing-required-success-header",
        "missing-required-response-field",
        "retryable-http-429",
        "retryable-http-502",
        "retryable-http-503",
        "retryable-http-504",
        "nonretryable-http-status",
        "retry-after-invalid-or-over-maximum",
        "transient-transport-code",
        "terminal-transport-error",
        "maximum-attempts-exhausted",
      ],
      transportErrorPhaseEnum: [
        "body-read",
        "fetch",
        "timeout",
      ],
      transportErrorRecordRequiredFields: [
        "code",
        "message",
        "phase",
        "transient",
      ],
      topLevelRequiredFields: [
        "artifactKind",
        "boundary",
        "counts",
        "inputs",
        "lookups",
        "schemaVersion",
      ],
    },
    schemaVersion: 1,
    serialization: {
      canonicalJsonRequired: true,
      terminalInputReplayRequired: true,
      unknownFields: "reject",
    },
  };
}

function deriveQualificationArtifactContract(): z.infer<
  typeof qualificationArtifactContractSchema
> {
  return {
    artifactKind:
      "c6-wave3-prior-repository-identity-qualification",
    authorizationRule:
      "qualification-artifact-alone-never-authorizes-official-wave3-search",
    boundary: {
      officialWave3SearchPermitted: false,
      priorRepositoryNodeIdExclusionComplete: true,
      status:
        "qualified-prior-node-id-closure-awaiting-external-promotion",
    },
    caseFoldRules: {
      algorithm: "ascii-A-through-Z-to-a-through-z-only",
      nodeIdToResolvedFold:
        "exactly-one-otherwise-fail-closed",
      requestedFoldToNodeId:
        "exactly-one-otherwise-fail-closed",
      resolvedFoldToNodeId:
        "exactly-one-otherwise-fail-closed",
    },
    closure: {
      aliasMappingCount: REPOSITORY_COUNT,
      allRequestedAliasesPreserved: true,
      assetLockRequired: true,
      attemptReferencesRequiredForBothPasses: true,
      successfulLogicalLookupCount: LOOKUP_COUNT,
      uniqueNodeIdCount:
        "1-through-178-equals-nodeIdDedup-row-count",
    },
    inputClosure: {
      artifactReferenceFields: [
        "artifactKind",
        "bytes",
        "path",
        "schemaVersion",
        "sha256",
      ],
      assetLock:
        "c6-asset-lock-v1-plus-assetRootSha256-and-lockSha256",
      filesystemVerification:
        "no-symlink-stable-read-identity-and-bytes-terminal-replay",
      fixedInputBasenames: [
        CAPTURE_BASENAME,
        PLAN_BASENAME,
        SOURCE_BASENAME,
      ],
      terminalReplay:
        "all-input-bytes-and-asset-lock-must-match-before-publication",
    },
    inputsRequired: [
      "capture",
      "captureAssetLock",
      "plan",
      "sourceUniverse",
    ],
    mapping: {
      crossPassRule:
        "same-exact-requested-name-must-have-identical-resolved-exact-name-and-node-id",
      rowRequiredFields: [
        "passAAttemptReferences",
        "passBAttemptReferences",
        "repositoryNodeId",
        "requestedNameWithOwner",
        "resolvedNameWithOwner",
      ],
      sort:
        "requestedNameWithOwner-code-unit-ascending",
    },
    nodeIdDedup: {
      rowRequiredFields: [
        "repositoryNodeId",
        "requestedAliases",
        "resolvedNameWithOwnerAsciiFold",
        "resolvedNameWithOwnerExactValues",
      ],
      requestedAliasesSort: "code-unit-ascending",
      resolvedExactValuesSort: "code-unit-ascending",
      sort:
        "repositoryNodeId-code-unit-then-resolved-fold-ascending",
    },
    projections: {
      attemptReferenceRows:
        "mapping-order-requested-name-passA-all-references-passB-all-references",
      formula:
        "sha256-JSON.stringify-canonical-sorted-array",
      nodeIdDedupRows:
        "exact-nodeIdDedup-rows-in-frozen-sort-order",
      requestedToResolvedRows:
        "exact-mapping-rows-in-frozen-sort-order",
      requiredHashes: [
        "attemptReferenceProjectionSha256",
        "nodeIdDedupProjectionSha256",
        "requestedToResolvedMappingProjectionSha256",
      ],
    },
    schemaVersion: 1,
    serialization: {
      canonicalJsonRequired: true,
      terminalInputReplayRequired: true,
      unknownFields: "reject",
    },
    topLevelRequiredFields: [
      "artifactKind",
      "boundary",
      "counts",
      "inputs",
      "mappings",
      "nodeIdDedup",
      "projections",
      "schemaVersion",
    ],
  };
}

function derivePlan(
  repositories: readonly string[],
): C6Wave3PriorRepositoryIdentityPlan {
  const targets = repositories.map(
    (requestedNameWithOwner, index) => {
      const [requestedOwner, requestedName] =
        requestedNameWithOwner.split("/");
      return {
        passALookupOrder: index + 1,
        passBLookupOrder: index + 1 + REPOSITORY_COUNT,
        repositoryOrder: index + 1,
        requestedName: requestedName!,
        requestedNameWithOwner,
        requestedOwner: requestedOwner!,
        requestedRepositorySha256: sha256(
          requestedNameWithOwner,
        ),
      };
    },
  );
  const plan = planSchema.parse({
    artifactKind: ARTIFACT_KIND,
    boundary: {
      acceptedEpisodeCount: 0,
      candidateManifestFrozen: false,
      codexRunReady: false,
      officialWave3SearchPermitted: false,
      policyCommitAncestryProven: false,
      policyIndependentReviewAccepted: false,
      priorIdentityCaptureExecuted: false,
      priorIdentityCapturePermitted: false,
      sourceUniverseCommitAncestryProven: false,
      sourceUniverseIndependentReviewAccepted: false,
      status:
        "prior-repository-identity-plan-proposal-only",
    },
    captureArtifactContract: deriveCaptureArtifactContract(),
    captureProtocol: {
      asciiCaseFoldCollisionChecks: {
        algorithm:
          "ascii-A-through-Z-to-a-through-z-only",
        exactCasePreservedInputs: true,
        requestedNameWithOwner:
          "preserve-group-require-same-node-id-and-resolved-fold",
        resolvedNameWithOwner:
          "require-one-node-id-per-fold",
      },
      aliasResolution: {
        duplicateRepositoryNodeId:
          "allowed-across-requested-aliases-deduplicate-after-both-passes",
        requestedToResolvedMapping:
          "preserve-every-exact-requested-name",
        resolvedIdentityConsistency:
          "one-node-id-must-map-to-one-ascii-folded-resolved-name",
      },
      crossPassEquality: {
        exactCasePreservedFields: [
          "requestedNameWithOwner",
          "resolvedNameWithOwner",
          "repositoryNodeId",
        ],
        required: true,
      },
      endpoint: "GraphQL Query.repository",
      evidenceClosure: {
        attemptDirectoryPattern:
          "lookup-{lookupOrder-4-digit}/attempt-{attempt-2-digit}",
        completionAssetLock: {
          coversEveryAttemptArtifact: true,
          format: "c6-asset-lock-v1",
          path: "asset-lock.json",
          requiredAfterAllLookups: true,
          symlinksRejected: true,
          verifiedBeforeQualification: true,
        },
        graphqlBodyRateLimitFields: [
          "cost",
          "limit",
          "remaining",
          "resetAt",
          "used",
        ],
        perAttemptArtifacts: {
          artifactReference: "path-bytes-sha256",
          attemptRecord: "attempt.json",
          rawRequestBody: "request-body.raw",
          rawResponseBody:
            "response-body.raw-required-when-response-body-read-completes",
          requestMetadata: "request.json",
          responseHeaders: "response-headers.json",
          retryDecision: "retry-decision.json",
          transportError:
            "transport-error.json-only-on-transport-failure",
        },
        selectedResponseHeaders: {
          alwaysRequiredOnCompleteGraphqlHttp200: [
            "date",
            "x-github-request-id",
            "x-ratelimit-limit",
            "x-ratelimit-remaining",
            "x-ratelimit-reset",
            "x-ratelimit-resource",
            "x-ratelimit-used",
          ],
          names: [
            "date",
            "retry-after",
            "x-github-request-id",
            "x-ratelimit-limit",
            "x-ratelimit-remaining",
            "x-ratelimit-reset",
            "x-ratelimit-resource",
            "x-ratelimit-used",
          ],
          projection:
            "all-selected-names-present-as-string-or-null",
          retryAfterDecision: RETRY_AFTER_RULE,
          successValidation: {
            bodyCost: "nonnegative-safe-integer",
            date: "rfc7231-imf-fixdate",
            rateLimitBounds:
              "zero-through-limit-for-remaining-and-used",
            rateLimitNumbers:
              "canonical-unsigned-decimal-safe-integer",
            rateLimitProjection:
              "limit-remaining-used-equal-body-and-reset-equals-resetAt-epoch-seconds",
            requestId:
              "ascii-alphanumeric-first-then-alphanumeric-colon-hyphen-up-to-128",
            resetAt: "canonical-utc-second",
            resource: "exact-graphql",
            retryAfter: "null",
          },
        },
        tokenRedaction: {
          authorizationHeaderReceipt: "Bearer <redacted>",
          completionCapability:
            "not-issued-by-source-v2-external-promotion-verifier-required",
          preAssetLockOrdering:
            "scan-every-runner-owned-regular-file-before-build-asset-lock",
          runnerErrorAndProgressTokenEmission: false,
          runnerOwnedCaptureRootTokenPersistence: false,
          scanScope:
            "every-regular-file-byte-in-runner-owned-temporary-capture-root",
          terminalOrdering:
            "write-and-load-asset-lock-then-rescan-token-and-verify-closure-before-structural-verifier",
          transportErrorSanitization:
            "replace-all-exact-runtime-token-occurrences-before-runner-write-error-or-progress",
        },
      },
      fullPassBeforeNext: true,
      lookupConcurrency: 1,
      lookupOrder:
        "pass-A-repositoryOrder-ascending-then-pass-B-repositoryOrder-ascending",
      networkExecuted: false,
      nextLookupRule:
        "complete-and-reference-all-current-lookup-attempts-or-abort-before-next",
      normalization: {
        repositoryNodeId:
          "case-preserved-exact-nonempty-string",
        requestedNameWithOwner:
          "case-preserved-exact-owner-slash-name",
        resolvedNameWithOwner:
          "case-preserved-exact-owner-slash-name",
      },
      operationName:
        "C6Wave3PriorRepositoryIdentity",
      passOrder: ["A", "B"],
      requestBody: {
        canonicalization:
          "utf8-JSON.stringify-no-trailing-newline-key-order-query-variables-name-owner",
        topLevelKeys: ["query", "variables"],
        variableKeys: ["name", "owner"],
        variables:
          "name-and-owner-exactly-from-frozen-target",
      },
      query: C6_WAVE3_PRIOR_REPOSITORY_IDENTITY_QUERY,
      querySha256: QUERY_SHA256,
      rateLimitReceipt: {
        fields: [
          "cost",
          "limit",
          "remaining",
          "resetAt",
          "used",
        ],
        requiredPerLookup: true,
      },
      retryPolicy: {
        decisionReceiptRequiredEveryAttempt: true,
        maximumNetworkAttemptsPerLookup: 4,
        maximumRetryDelayMilliseconds: 60_000,
        retryDelayRule: RETRY_AFTER_RULE,
        retryableHttpStatuses: [429, 502, 503, 504],
        retryableStatusDecisionBeforeSuccessHeaderValidation:
          true,
        transientTransportCodes: [
          "EAI_AGAIN",
          "ECONNREFUSED",
          "ECONNRESET",
          "EHOSTUNREACH",
          "ENETDOWN",
          "ENETRESET",
          "ENETUNREACH",
          "ENOTFOUND",
          "ETIMEDOUT",
          "UND_ERR_CONNECT_TIMEOUT",
          "UND_ERR_HEADERS_TIMEOUT",
          "UND_ERR_SOCKET",
        ],
      },
      responseFields: ["id", "nameWithOwner", "url"],
      transport: {
        endpoint: "https://api.github.com/graphql",
        headers: {
          accept: "application/vnd.github+json",
          authorization: "Bearer <redacted>",
          "content-type": "application/json",
          "user-agent":
            "GoodMemory-C6-Wave3-Prior-Repository-Identity/1",
          "x-github-api-version": "2022-11-28",
        },
        method: "POST",
        redirect: "error",
        timeoutMilliseconds: 60_000,
      },
      validation: {
        crossPassMismatch: "fail-closed",
        graphqlErrorsOrPartialData: "fail-closed",
        missingRequiredHeader:
          "fail-closed-only-on-complete-graphql-http-200",
        missingRequiredResponseField: "fail-closed",
        non200HttpStatus:
          "retry-only-under-frozen-policy-otherwise-fail-closed",
        nullRepository: "fail-closed",
        oneRepositoryNodeIdWithInconsistentResolvedFold:
          "fail-closed",
      },
    },
    counts: {
      lookupCount: LOOKUP_COUNT,
      passCount: 2,
      priorRepositoryCount: REPOSITORY_COUNT,
    },
    independenceBoundary: {
      goldInput: false,
      hiddenTestInput: false,
      receiptHashAuthorizesCapture: false,
      requestedRepositoryProjectionSha256:
        REPOSITORY_PROJECTION_SHA256,
      targetProjectionSha256: sha256(
        JSON.stringify(targets),
      ),
    },
    inputs: {
      sourceUniverse: {
        artifactKind: SOURCE_ARTIFACT_KIND,
        bytes: SOURCE_BYTES,
        canonicalRepositoryCount: REPOSITORY_COUNT,
        canonicalRepositoryProjectionSha256:
          REPOSITORY_PROJECTION_SHA256,
        path: SOURCE_BASENAME,
        schemaVersion: 2,
        sha256: SOURCE_SHA256,
      },
    },
    qualificationArtifactContract:
      deriveQualificationArtifactContract(),
    schemaVersion: 1,
    targets,
  });
  assertPlanSelfConsistency(plan);
  return plan;
}

function assertPlanSelfConsistency(
  plan: C6Wave3PriorRepositoryIdentityPlan,
): void {
  const requestedRepositories = plan.targets.map(
    (target) => target.requestedNameWithOwner,
  );
  if (
    sha256(C6_WAVE3_PRIOR_REPOSITORY_IDENTITY_QUERY) !==
      QUERY_SHA256 ||
    JSON.stringify(requestedRepositories) !==
      JSON.stringify(sortedUnique(requestedRepositories)) ||
    sha256(JSON.stringify(requestedRepositories)) !==
      REPOSITORY_PROJECTION_SHA256 ||
    plan.independenceBoundary
      .targetProjectionSha256 !==
        sha256(JSON.stringify(plan.targets))
  ) {
    throw new Error(
      "C6 Wave3 prior repository identity plan self-consistency mismatch",
    );
  }
  for (const [index, target] of plan.targets.entries()) {
    const repositoryOrder = index + 1;
    if (
      target.repositoryOrder !== repositoryOrder ||
      target.passALookupOrder !== repositoryOrder ||
      target.passBLookupOrder !==
        repositoryOrder + REPOSITORY_COUNT ||
      `${target.requestedOwner}/${target.requestedName}` !==
        target.requestedNameWithOwner ||
      target.requestedRepositorySha256 !==
        sha256(target.requestedNameWithOwner)
    ) {
      throw new Error(
        "C6 Wave3 prior repository identity plan self-consistency mismatch",
      );
    }
  }
}

function deriveArtifactPlanContext(
  plan: C6Wave3PriorRepositoryIdentityPlan,
): C6Wave3PriorRepositoryIdentityArtifactPlanContext {
  return {
    serialized:
      serializeC6Wave3PriorRepositoryIdentityPlan(plan),
    targets: plan.targets,
  };
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
      "C6 Wave3 prior repository identity published output ownership mismatch",
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
