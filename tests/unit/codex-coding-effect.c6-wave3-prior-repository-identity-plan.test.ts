import { createHash } from "node:crypto";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  readdir,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterAll, describe, expect, it } from "bun:test";

import {
  buildC6AssetLock,
  serializeC6AssetLock,
} from "../../scripts/codex-coding-effect/c6-asset-lock";
import {
  buildC6Wave3PriorRepositoryIdentityCapture,
  buildC6Wave3PriorRepositoryIdentityPlan,
  buildC6Wave3PriorRepositoryIdentityQualification,
  C6_WAVE3_PRIOR_REPOSITORY_IDENTITY_QUERY,
  materializeC6Wave3PriorRepositoryIdentityPlan,
  parseC6Wave3PriorRepositoryIdentityCapture,
  parseC6Wave3PriorRepositoryIdentityPlan,
  parseC6Wave3PriorRepositoryIdentityQualification,
  requireC6Wave3PriorRepositoryIdentityCaptureAuthorization,
  serializeC6Wave3PriorRepositoryIdentityCapture,
  serializeC6Wave3PriorRepositoryIdentityPlan,
  serializeC6Wave3PriorRepositoryIdentityQualification,
  verifyC6Wave3PriorRepositoryIdentityDraftEvidence,
} from "../../scripts/codex-coding-effect/c6-wave3-prior-repository-identity-plan";
import type {
  C6Wave3PriorRepositoryIdentityCapture,
  C6Wave3PriorRepositoryIdentityCaptureLookup,
  C6Wave3PriorRepositoryIdentityPlan,
  C6Wave3PriorRepositoryIdentityQualification,
} from "../../scripts/codex-coding-effect/c6-wave3-prior-repository-identity-plan";
import type {
  C6Wave3PriorRepositoryIdentityCompletionCapability,
} from "../../scripts/codex-coding-effect/c6-wave3-prior-repository-identity-capture";
import {
  parseC6Wave3PriorRepositoryIdentityPlanCliOptions,
  runC6Wave3PriorRepositoryIdentityPlanSnapshotCommand,
} from "../../scripts/snapshot-codex-coding-effect-c6-wave3-prior-repository-identity-plan";

const SOURCE_ROOT = join(
  process.cwd(),
  "fixtures/codex-coding-effect/c6-source-pool",
);
const SOURCE_BASENAME =
  "swe-bench-live-multilang-608f7ae9." +
  "wave3-source-universe-v2.json";
const PLAN_BASENAME =
  "swe-bench-live-multilang-608f7ae9." +
  "wave3-prior-repository-identity-plan-v1.json";
const SOURCE_PATH = join(SOURCE_ROOT, SOURCE_BASENAME);
const SOURCE_BYTES = 631_004;
const SOURCE_SHA256 =
  "822c458e792ee31f7738cae2526b05dfc3b63fcaac58e3f4f87dcd3803ccdba1";
const REPOSITORY_PROJECTION_SHA256 =
  "360da907fb4dd3c4e3e023c528b90e8f5401e5f52bc13b69fcce034b8b44ab01";
const QUERY_SHA256 =
  "c182b2706394b838b194d053077c6d1af3d0b76ca541a31a78f7c8846492566b";
const RETRY_AFTER_RULE =
  "null-or-absent-use-exponential-1000-2000-4000-" +
  "canonical-unsigned-decimal-seconds-0-through-60-use-" +
  "seconds-times-1000-invalid-fraction-http-date-or-over-60-abort";
const EXPECTED_QUERY =
  "query C6Wave3PriorRepositoryIdentity(" +
  "$owner: String!, $name: String!) {\n" +
  "  repository(owner: $owner, name: $name, " +
  "followRenames: true) {\n" +
  "    id\n" +
  "    nameWithOwner\n" +
  "    url\n" +
  "  }\n" +
  "  rateLimit {\n" +
  "    cost\n" +
  "    limit\n" +
  "    remaining\n" +
  "    resetAt\n" +
  "    used\n" +
  "  }\n" +
  "}\n";
const temporaryRoots: string[] = [];

afterAll(async () => {
  await Promise.all(
    temporaryRoots.map((root) =>
      rm(root, { force: true, recursive: true })
    ),
  );
});

describe("Codex coding-effect C6 Wave3 prior repository identity plan", () => {
  it("freezes 178 repositories into complete pass A then pass B", async () => {
    const result =
      await buildC6Wave3PriorRepositoryIdentityPlan({
        sourceUniversePath: SOURCE_PATH,
      });
    const { plan } = result;
    const serialized =
      serializeC6Wave3PriorRepositoryIdentityPlan(plan);

    expect(plan.boundary).toEqual({
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
      status: "prior-repository-identity-plan-proposal-only",
    });
    expect(plan.counts).toEqual({
      lookupCount: 356,
      passCount: 2,
      priorRepositoryCount: 178,
    });
    expect(plan.inputs.sourceUniverse).toEqual({
      artifactKind: "c6-wave3-source-universe",
      bytes: SOURCE_BYTES,
      canonicalRepositoryCount: 178,
      canonicalRepositoryProjectionSha256:
        REPOSITORY_PROJECTION_SHA256,
      path: SOURCE_BASENAME,
      schemaVersion: 2,
      sha256: SOURCE_SHA256,
    });
    expect(C6_WAVE3_PRIOR_REPOSITORY_IDENTITY_QUERY)
      .toBe(EXPECTED_QUERY);
    expect(plan.captureProtocol.query).toBe(EXPECTED_QUERY);
    expect(plan.captureProtocol.querySha256).toBe(
      QUERY_SHA256,
    );
    expect(sha256(plan.captureProtocol.query)).toBe(
      QUERY_SHA256,
    );
    expect(plan.captureProtocol).toMatchObject({
      asciiCaseFoldCollisionChecks: {
        algorithm: "ascii-A-through-Z-to-a-through-z-only",
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
      operationName: "C6Wave3PriorRepositoryIdentity",
      passOrder: ["A", "B"],
      requestBody: {
        canonicalization:
          "utf8-JSON.stringify-no-trailing-newline-key-order-query-variables-name-owner",
        topLevelKeys: ["query", "variables"],
        variableKeys: ["name", "owner"],
        variables:
          "name-and-owner-exactly-from-frozen-target",
      },
      retryPolicy: {
        decisionReceiptRequiredEveryAttempt: true,
        maximumNetworkAttemptsPerLookup: 4,
        maximumRetryDelayMilliseconds: 60_000,
        retryDelayRule: RETRY_AFTER_RULE,
        retryableStatusDecisionBeforeSuccessHeaderValidation:
          true,
        retryableHttpStatuses: [429, 502, 503, 504],
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
    });
    expect(
      plan.captureProtocol.evidenceClosure
        .selectedResponseHeaders.retryAfterDecision,
    ).toBe(plan.captureProtocol.retryPolicy.retryDelayRule);
    expect(
      plan.captureArtifactContract.recordSchemas
        .outcomeDecisionRules,
    ).toContain(
      "retryable-http-status=>retry-if-attempt-below-4-and-" +
      "retry-after-null-or-canonical-0-through-60-else-abort",
    );
    expect(plan.captureArtifactContract).toEqual({
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
        successfulLogicalLookupCount: 356,
      },
      inputClosure: {
        filesystemVerification:
          "no-symlink-stable-read-identity-and-bytes-terminal-replay",
        fixedInputBasenames: [
          "swe-bench-live-multilang-608f7ae9.wave3-prior-repository-identity-plan-v1.json",
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
          "retryable-http-status=>retry-if-attempt-below-4-and-retry-after-null-or-canonical-0-through-60-else-abort",
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
    });
    expect(plan.qualificationArtifactContract).toEqual({
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
        aliasMappingCount: 178,
        allRequestedAliasesPreserved: true,
        assetLockRequired: true,
        attemptReferencesRequiredForBothPasses: true,
        successfulLogicalLookupCount: 356,
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
          "swe-bench-live-multilang-608f7ae9.wave3-prior-repository-identity-capture-v1.json",
          "swe-bench-live-multilang-608f7ae9.wave3-prior-repository-identity-plan-v1.json",
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
    });
    expect(plan.targets).toHaveLength(178);
    expect(plan.targets.map((target) =>
      target.requestedNameWithOwner
    )).toEqual(
      [...plan.targets.map((target) =>
        target.requestedNameWithOwner
      )].sort(),
    );
    expect(new Set(plan.targets.map((target) =>
      target.requestedNameWithOwner
    )).size).toBe(178);
    expect(plan.targets.map((target) =>
      target.repositoryOrder
    )).toEqual(Array.from({ length: 178 }, (_, index) =>
      index + 1
    ));
    expect(plan.targets.map((target) =>
      target.passALookupOrder
    )).toEqual(Array.from({ length: 178 }, (_, index) =>
      index + 1
    ));
    expect(plan.targets.map((target) =>
      target.passBLookupOrder
    )).toEqual(Array.from({ length: 178 }, (_, index) =>
      index + 179
    ));
    for (const target of plan.targets) {
      expect(
        `${target.requestedOwner}/${target.requestedName}`,
      ).toBe(target.requestedNameWithOwner);
      expect(target.requestedRepositorySha256).toBe(
        sha256(target.requestedNameWithOwner),
      );
    }
    expect(
      plan.independenceBoundary
        .requestedRepositoryProjectionSha256,
    ).toBe(REPOSITORY_PROJECTION_SHA256);
    expect(
      plan.independenceBoundary.targetProjectionSha256,
    ).toBe(sha256(JSON.stringify(plan.targets)));
    expect(parseC6Wave3PriorRepositoryIdentityPlan(serialized))
      .toEqual(plan);
    expect(result.outputSha256).toBe(sha256(serialized));
  });

  it("rejects source drift and noncanonical or inconsistent plans", async () => {
    const root = await copySourceUniverse();
    const source = join(root, SOURCE_BASENAME);
    await writeFile(source, "{}\n", "utf8");
    await expect(
      buildC6Wave3PriorRepositoryIdentityPlan({
        sourceUniversePath: source,
      }),
    ).rejects.toThrow("source universe hash mismatch");

    const wrongBasenameRoot = await mkdtemp(
      join(await realpath(tmpdir()), "goodmemory-c6-wave3-prior-wrong-name-"),
    );
    temporaryRoots.push(wrongBasenameRoot);
    const wrongBasename = join(wrongBasenameRoot, "source.json");
    await copyFile(SOURCE_PATH, wrongBasename);
    await expect(
      buildC6Wave3PriorRepositoryIdentityPlan({
        sourceUniversePath: wrongBasename,
      }),
    ).rejects.toThrow("source universe hash mismatch");

    const { plan } =
      await buildC6Wave3PriorRepositoryIdentityPlan({
        sourceUniversePath: SOURCE_PATH,
      });
    const serialized =
      serializeC6Wave3PriorRepositoryIdentityPlan(plan);
    expect(() =>
      parseC6Wave3PriorRepositoryIdentityPlan(
        serialized.slice(0, -1),
      )
    ).toThrow("requires canonical JSON");

    const tainted = structuredClone(plan);
    tainted.targets[0]!.requestedRepositorySha256 =
      "0".repeat(64);
    expect(() =>
      serializeC6Wave3PriorRepositoryIdentityPlan(tainted)
    ).toThrow("self-consistency");

    const receiptInjection = {
      ...plan,
      receiptSha256: "0".repeat(64),
    };
    expect(() =>
      parseC6Wave3PriorRepositoryIdentityPlan(
        `${JSON.stringify(receiptInjection, null, 2)}\n`,
      )
    ).toThrow();
    expect(() =>
      requireC6Wave3PriorRepositoryIdentityCaptureAuthorization(
        plan,
      )
    ).toThrow("external promotion verifier is required");
  });

  it("validates complete offline 356-lookup draft evidence without formal completion", async () => {
    const { plan } =
      await buildC6Wave3PriorRepositoryIdentityPlan({
        sourceUniversePath: SOURCE_PATH,
      });
    const artifactInputs =
      await materializeFrozenArtifactInputs(plan);
    const lookups = syntheticLookups(plan);
    const assetRoot = await materializeSyntheticRawEvidence(
      lookups,
    );

    await expect(
      verifyC6Wave3PriorRepositoryIdentityDraftEvidence({
        assetRoot,
        ...artifactInputs,
        lookups,
        plan,
      }),
    ).resolves.toBeUndefined();
    expect(lookups).toHaveLength(356);
    await expect(
      buildC6Wave3PriorRepositoryIdentityCapture({
        assetRoot,
        ...artifactInputs,
        lookups,
        plan,
      }),
    ).rejects.toThrow(/external promotion completion capability/u);
  }, 15_000);

  it("rejects a forged structural completion capability before every formal artifact parse or construction", async () => {
    const { plan } =
      await buildC6Wave3PriorRepositoryIdentityPlan({
        sourceUniversePath: SOURCE_PATH,
      });
    const artifactInputs =
      await materializeFrozenArtifactInputs(plan);
    const lookups = syntheticLookups(plan);
    const assetRoot = await materializeSyntheticRawEvidence(
      lookups,
    );
    const completionCapability = {
      kind:
        "c6-wave3-prior-repository-identity-runner-completion",
    } as const satisfies
      C6Wave3PriorRepositoryIdentityCompletionCapability;
    const invalidCapture = {} as
      C6Wave3PriorRepositoryIdentityCapture;
    const invalidQualification = {} as
      C6Wave3PriorRepositoryIdentityQualification;
    const captureContext = {
      assetRoot,
      completionCapability,
      ...artifactInputs,
      plan,
    };
    const qualificationContext = {
      ...captureContext,
      capture: invalidCapture,
      capturePath: join(assetRoot, "invalid-capture.json"),
    };
    const completionUnavailable =
      /external promotion completion capability is unavailable/u;

    await expect(
      buildC6Wave3PriorRepositoryIdentityCapture({
        ...captureContext,
        lookups,
      }),
    ).rejects.toThrow(completionUnavailable);
    await expect(
      serializeC6Wave3PriorRepositoryIdentityCapture(
        invalidCapture,
        captureContext,
      ),
    ).rejects.toThrow(completionUnavailable);
    await expect(
      parseC6Wave3PriorRepositoryIdentityCapture(
        "{not-json",
        captureContext,
      ),
    ).rejects.toThrow(completionUnavailable);
    await expect(
      buildC6Wave3PriorRepositoryIdentityQualification(
        qualificationContext,
      ),
    ).rejects.toThrow(completionUnavailable);
    await expect(
      serializeC6Wave3PriorRepositoryIdentityQualification(
        invalidQualification,
        qualificationContext,
      ),
    ).rejects.toThrow(completionUnavailable);
    await expect(
      parseC6Wave3PriorRepositoryIdentityQualification(
        "{not-json",
        qualificationContext,
      ),
    ).rejects.toThrow(completionUnavailable);
  }, 15_000);

  it("represents body-read failures without inventing a response body", async () => {
    const { plan } =
      await buildC6Wave3PriorRepositoryIdentityPlan({
        sourceUniversePath: SOURCE_PATH,
      });
    const artifactInputs =
      await materializeFrozenArtifactInputs(plan);
    const lookups = syntheticLookups(plan);
    const target = plan.targets[0]!;
    lookups[0]!.attempts = [
      syntheticBodyReadFailure(target, 1, 1),
      syntheticSuccessAttempt(target, 1, 2, {
        repositoryNodeId: "R_SHARED_ALIAS",
        resolvedNameWithOwner: "renamed/shared-alias",
      }),
    ];
    lookups[0]!.finalAttempt = 2;
    const assetRoot = await materializeSyntheticRawEvidence(
      lookups,
    );
    await expect(
      verifyC6Wave3PriorRepositoryIdentityDraftEvidence({
        assetRoot,
        ...artifactInputs,
        lookups,
        plan,
      }),
    ).resolves.toBeUndefined();
    expect(lookups[0]!.attempts[0]).toMatchObject({
      httpResponseExists: true,
      httpStatus: 200,
      outcome: "transient-transport-failure",
      responseBody: null,
      responseBodyReadCompleted: false,
      transportError: {
        phase: "body-read",
        transient: true,
      },
    });

    const impossible = structuredClone(lookups);
    impossible[0]!.attempts[0]!
      .responseBodyReadCompleted = true;
    await expect(
      verifyC6Wave3PriorRepositoryIdentityDraftEvidence({
        assetRoot,
        ...artifactInputs,
        lookups: impossible,
        plan,
      }),
    ).rejects.toThrow(/response body|body-read/u);
  });

  it("rejects attempt gaps, retry contradictions, and unsafe refs offline", async () => {
    const { plan } =
      await buildC6Wave3PriorRepositoryIdentityPlan({
        sourceUniversePath: SOURCE_PATH,
      });
    const artifactInputs =
      await materializeFrozenArtifactInputs(plan);
    const gap = syntheticLookups(plan);
    const target = plan.targets[0]!;
    gap[0]!.attempts = [
      syntheticBodyReadFailure(target, 1, 1),
      syntheticSuccessAttempt(target, 1, 3, {
        repositoryNodeId: "R_SHARED_ALIAS",
        resolvedNameWithOwner: "renamed/shared-alias",
      }),
    ];
    gap[0]!.finalAttempt = 3;
    const gapRoot = await materializeSyntheticRawEvidence(gap);
    await expect(
      verifyC6Wave3PriorRepositoryIdentityDraftEvidence({
        assetRoot: gapRoot,
        ...artifactInputs,
        lookups: gap,
        plan,
      }),
    ).rejects.toThrow(/contiguous|attempt/u);

    const retryConflict = syntheticLookups(plan);
    retryConflict[0]!.attempts = [
      syntheticBodyReadFailure(target, 1, 1),
      syntheticSuccessAttempt(target, 1, 2, {
        repositoryNodeId: "R_SHARED_ALIAS",
        resolvedNameWithOwner: "renamed/shared-alias",
      }),
    ];
    retryConflict[0]!.finalAttempt = 2;
    retryConflict[0]!.attempts[0]!.retryDecision
      .delayMilliseconds = 7;
    const retryRoot = await materializeSyntheticRawEvidence(
      retryConflict,
    );
    await expect(
      verifyC6Wave3PriorRepositoryIdentityDraftEvidence({
        assetRoot: retryRoot,
        ...artifactInputs,
        lookups: retryConflict,
        plan,
      }),
    ).rejects.toThrow(/retry|delay/u);

    const unsafe = syntheticLookups(plan);
    const unsafeRoot = await materializeSyntheticRawEvidence(
      unsafe,
    );
    unsafe[0]!.attempts[0]!.request.path =
      "../request.json";
    await expect(
      verifyC6Wave3PriorRepositoryIdentityDraftEvidence({
        assetRoot: unsafeRoot,
        ...artifactInputs,
        lookups: unsafe,
        plan,
      }),
    ).rejects.toThrow();

  }, 15_000);

  it("rejects fake locks, reference drift, and incomplete asset closures", async () => {
    const { plan } =
      await buildC6Wave3PriorRepositoryIdentityPlan({
        sourceUniversePath: SOURCE_PATH,
      });
    const artifactInputs =
      await materializeFrozenArtifactInputs(plan);
    const lookups = syntheticLookups(plan);
    const root = await materializeSyntheticRawEvidence(lookups);
    const lockPath = join(root, "asset-lock.json");
    const fakeHash = JSON.parse(
      await readFile(lockPath, "utf8"),
    ) as {
      assetRootSha256: string;
      files: Array<{ bytes: number }>;
    };
    fakeHash.assetRootSha256 = "0".repeat(64);
    await writeFile(
      lockPath,
      `${JSON.stringify(fakeHash, null, 2)}\n`,
      "utf8",
    );
    await expect(
      buildC6Wave3PriorRepositoryIdentityCapture({
        assetRoot: root,
        ...artifactInputs,
        lookups,
        plan,
      }),
    ).rejects.toThrow(/asset lock|invalid/u);

    await rewriteAssetLock(root);
    const fakeBytes = JSON.parse(
      await readFile(lockPath, "utf8"),
    ) as {
      assetRootSha256: string;
      files: Array<{ bytes: number }>;
    };
    fakeBytes.files[0]!.bytes += 1;
    fakeBytes.assetRootSha256 = sha256(
      JSON.stringify(fakeBytes.files),
    );
    await writeFile(
      lockPath,
      `${JSON.stringify(fakeBytes, null, 2)}\n`,
      "utf8",
    );
    await expect(
      buildC6Wave3PriorRepositoryIdentityCapture({
        assetRoot: root,
        ...artifactInputs,
        lookups,
        plan,
      }),
    ).rejects.toThrow(/asset lock|invalid/u);

    await rewriteAssetLock(root);
    const badReference = structuredClone(lookups);
    badReference[0]!.attempts[0]!.request.bytes += 1;
    await expect(
      buildC6Wave3PriorRepositoryIdentityCapture({
        assetRoot: root,
        ...artifactInputs,
        lookups: badReference,
        plan,
      }),
    ).rejects.toThrow(/reference|asset lock/u);

    const missingLookups = syntheticLookups(plan);
    const missingRoot =
      await materializeSyntheticRawEvidence(missingLookups);
    await rm(
      join(
        missingRoot,
        missingLookups[0]!.attempts[0]!.requestBody.path,
      ),
    );
    await rewriteAssetLock(missingRoot);
    await expect(
      buildC6Wave3PriorRepositoryIdentityCapture({
        assetRoot: missingRoot,
        ...artifactInputs,
        lookups: missingLookups,
        plan,
      }),
    ).rejects.toThrow(/reference|missing|asset lock/u);

    const extraLookups = syntheticLookups(plan);
    const extraRoot =
      await materializeSyntheticRawEvidence(extraLookups);
    await writeEvidenceFile(
      extraRoot,
      "unexpected-extra.raw",
      "extra",
    );
    await rewriteAssetLock(extraRoot);
    await expect(
      buildC6Wave3PriorRepositoryIdentityCapture({
        assetRoot: extraRoot,
        ...artifactInputs,
        lookups: extraLookups,
        plan,
      }),
    ).rejects.toThrow(/extra evidence|asset lock/u);
  }, 15_000);

  it("rejects projection drift despite matching bytes and lock entries", async () => {
    const { plan } =
      await buildC6Wave3PriorRepositoryIdentityPlan({
        sourceUniversePath: SOURCE_PATH,
      });
    const artifactInputs =
      await materializeFrozenArtifactInputs(plan);
    const lookups = syntheticLookups(plan);
    const root = await materializeSyntheticRawEvidence(lookups);
    const attempt = lookups[0]!.attempts[0]!;
    attempt.responseHeaders = await writeEvidenceFile(
      root,
      attempt.responseHeaders.path,
      `${JSON.stringify({
        ...attempt.selectedResponseHeaders,
        date: "Mon, 27 Jul 2026 12:00:00 GMT",
      }, null, 2)}\n`,
    );
    const {
      attemptArtifact: _attemptArtifact,
      ...attemptReceipt
    } = attempt;
    attempt.attemptArtifact = await writeEvidenceFile(
      root,
      attempt.attemptArtifact.path,
      `${JSON.stringify(attemptReceipt, null, 2)}\n`,
    );
    await rewriteAssetLock(root);
    await expect(
      buildC6Wave3PriorRepositoryIdentityCapture({
        assetRoot: root,
        ...artifactInputs,
        lookups,
        plan,
      }),
    ).rejects.toThrow(/response headers projection mismatch/u);
  });

  it("terminal replay rejects symlink and foreign-inode replacement without cleanup", async () => {
    const { plan } =
      await buildC6Wave3PriorRepositoryIdentityPlan({
        sourceUniversePath: SOURCE_PATH,
      });
    const artifactInputs =
      await materializeFrozenArtifactInputs(plan);
    const foreignLookups = syntheticLookups(plan);
    const foreignRoot =
      await materializeSyntheticRawEvidence(foreignLookups);
    const foreignDirectory = await mkdtemp(
      join(await realpath(tmpdir()), "goodmemory-c6-wave3-prior-foreign-"),
    );
    temporaryRoots.push(foreignDirectory);
    const foreignFile = join(foreignDirectory, "foreign.raw");
    await writeFile(foreignFile, "foreign inode", "utf8");
    const foreignBefore = await lstat(foreignFile);
    const foreignTarget = join(
      foreignRoot,
      foreignLookups[0]!.attempts[0]!.requestBody.path,
    );
    await expect(
      buildC6Wave3PriorRepositoryIdentityCapture({
        assetRoot: foreignRoot,
        ...artifactInputs,
        lookups: foreignLookups,
        plan,
        testHooks: {
          beforeTerminalInputReplay: async () => {
            await rename(foreignFile, foreignTarget);
          },
        },
      }),
    ).rejects.toThrow(/closure changed|asset closure/u);
    const foreignAfter = await lstat(foreignTarget);
    expect(foreignAfter.ino).toBe(foreignBefore.ino);
    expect(await readFile(foreignTarget, "utf8")).toBe(
      "foreign inode",
    );

    const symlinkLookups = syntheticLookups(plan);
    const symlinkRoot =
      await materializeSyntheticRawEvidence(symlinkLookups);
    const externalFile = join(
      foreignDirectory,
      "external.raw",
    );
    await writeFile(externalFile, "external", "utf8");
    const symlinkTarget = join(
      symlinkRoot,
      symlinkLookups[0]!.attempts[0]!.requestBody.path,
    );
    await expect(
      buildC6Wave3PriorRepositoryIdentityCapture({
        assetRoot: symlinkRoot,
        ...artifactInputs,
        lookups: symlinkLookups,
        plan,
        testHooks: {
          beforeTerminalInputReplay: async () => {
            await rm(symlinkTarget);
            await symlink(externalFile, symlinkTarget);
          },
        },
      }),
    ).rejects.toThrow(/closure changed|asset closure/u);
    expect((await lstat(symlinkTarget)).isSymbolicLink()).toBe(
      true,
    );
    expect(await readFile(externalFile, "utf8")).toBe(
      "external",
    );
  });

  it("binds actual plan and source files through terminal replay", async () => {
    const { plan } =
      await buildC6Wave3PriorRepositoryIdentityPlan({
        sourceUniversePath: SOURCE_PATH,
      });
    const lookups = syntheticLookups(plan);
    const assetRoot = await materializeSyntheticRawEvidence(
      lookups,
    );

    const planMutationInputs =
      await materializeFrozenArtifactInputs(plan);
    const foreignDirectory = await mkdtemp(
      join(await realpath(tmpdir()), "goodmemory-c6-wave3-prior-input-foreign-"),
    );
    temporaryRoots.push(foreignDirectory);
    const foreignPlan = join(foreignDirectory, PLAN_BASENAME);
    await copyFile(planMutationInputs.planPath, foreignPlan);
    const foreignPlanStat = await lstat(foreignPlan);
    await expect(
      buildC6Wave3PriorRepositoryIdentityCapture({
        assetRoot,
        ...planMutationInputs,
        lookups,
        plan,
        testHooks: {
          beforeTerminalInputReplay: async () => {
            await rename(
              foreignPlan,
              planMutationInputs.planPath,
            );
          },
        },
      }),
    ).rejects.toThrow(/plan input changed|identity/u);
    expect(
      (await lstat(planMutationInputs.planPath)).ino,
    ).toBe(foreignPlanStat.ino);

    const sourceMutationInputs =
      await materializeFrozenArtifactInputs(plan);
    await expect(
      buildC6Wave3PriorRepositoryIdentityCapture({
        assetRoot,
        ...sourceMutationInputs,
        lookups,
        plan,
        testHooks: {
          beforeTerminalInputReplay: async () => {
            await writeFile(
              sourceMutationInputs.sourceUniversePath,
              "{}\n",
              "utf8",
            );
          },
        },
      }),
    ).rejects.toThrow(/source universe input|mismatch/u);

    const missingInputs =
      await materializeFrozenArtifactInputs(plan);
    await rm(missingInputs.planPath);
    await expect(
      buildC6Wave3PriorRepositoryIdentityCapture({
        assetRoot,
        ...missingInputs,
        lookups,
        plan,
      }),
    ).rejects.toThrow();

    const wrongBasenameInputs =
      await materializeFrozenArtifactInputs(plan);
    const wrongPlanPath = join(
      dirname(wrongBasenameInputs.planPath),
      "plan.json",
    );
    await rename(
      wrongBasenameInputs.planPath,
      wrongPlanPath,
    );
    await expect(
      buildC6Wave3PriorRepositoryIdentityCapture({
        assetRoot,
        planPath: wrongPlanPath,
        sourceUniversePath:
          wrongBasenameInputs.sourceUniversePath,
        lookups,
        plan,
      }),
    ).rejects.toThrow(/basename/u);

    const symlinkInputs =
      await materializeFrozenArtifactInputs(plan);
    await rm(symlinkInputs.sourceUniversePath);
    await symlink(
      SOURCE_PATH,
      symlinkInputs.sourceUniversePath,
    );
    await expect(
      buildC6Wave3PriorRepositoryIdentityCapture({
        assetRoot,
        ...symlinkInputs,
        lookups,
        plan,
      }),
    ).rejects.toThrow(/symlink/u);

  }, 15_000);

  it("enforces successful GitHub header syntax and rate-limit projection", async () => {
    const { plan } =
      await buildC6Wave3PriorRepositoryIdentityPlan({
        sourceUniversePath: SOURCE_PATH,
      });
    const artifactInputs =
      await materializeFrozenArtifactInputs(plan);
    const expectRejected = async (
      mutate: (
        lookup: C6Wave3PriorRepositoryIdentityCaptureLookup,
      ) => void,
      pattern: RegExp,
    ): Promise<void> => {
      const lookups = syntheticLookups(plan);
      mutate(lookups[0]!);
      const assetRoot =
        await materializeSyntheticRawEvidence(lookups);
      await expect(
        buildC6Wave3PriorRepositoryIdentityCapture({
          assetRoot,
          ...artifactInputs,
          lookups,
          plan,
        }),
      ).rejects.toThrow(pattern);
    };

    await expectRejected((lookup) => {
      lookup.attempts[0]!.selectedResponseHeaders.date =
        "Invalid Date";
    }, /date|IMF|validation/u);
    await expectRejected((lookup) => {
      lookup.attempts[0]!.selectedResponseHeaders.date =
        "Mon, 26 Jul 2026 12:00:00 GMT";
    }, /date|IMF|validation/u);
    await expectRejected((lookup) => {
      lookup.attempts[0]!.selectedResponseHeaders[
        "x-github-request-id"
      ] = "request id with spaces";
    }, /request-id|validation|invalid_string/u);
    await expectRejected((lookup) => {
      lookup.attempts[0]!.selectedResponseHeaders[
        "x-ratelimit-limit"
      ] = "05000";
    }, /ratelimit-limit|validation|invalid_string/u);
    await expectRejected((lookup) => {
      lookup.attempts[0]!.selectedResponseHeaders[
        "x-ratelimit-resource"
      ] = "graphql-other" as "graphql";
    }, /ratelimit-resource|literal|validation/u);
    await expectRejected((lookup) => {
      lookup.attempts[0]!.selectedResponseHeaders[
        "x-ratelimit-reset"
      ] = "1785067201";
    }, /rate-limit header mismatch/u);
    await expectRejected((lookup) => {
      lookup.attempts[0]!.selectedResponseHeaders[
        "x-ratelimit-remaining"
      ] = "5001";
    }, /rate-limit header mismatch/u);
    await expectRejected((lookup) => {
      lookup.response.rateLimit.cost =
        Number.MAX_SAFE_INTEGER + 1;
    }, /too_big|validation|safe/u);
    await expectRejected((lookup) => {
      lookup.response.rateLimit.resetAt =
        "2026-02-30T12:00:00Z";
    }, /resetAt|UTC second|validation/u);
  }, 15_000);

  it("detects terminal source mutation before publication", async () => {
    const root = await copySourceUniverse();
    const source = join(root, SOURCE_BASENAME);
    await expect(
      buildC6Wave3PriorRepositoryIdentityPlan({
        sourceUniversePath: source,
        testHooks: {
          beforeTerminalReplay: async () => {
            await writeFile(source, "{}\n", "utf8");
          },
        },
      }),
    ).rejects.toThrow(/hash mismatch|changed/u);
  });

  it("rolls back owned output on post-publication source mutation", async () => {
    const root = await copySourceUniverse();
    const source = join(root, SOURCE_BASENAME);
    const output = join(root, "output.json");
    await expect(
      materializeC6Wave3PriorRepositoryIdentityPlan({
        outputPath: output,
        sourceUniversePath: source,
        testHooks: {
          afterOutputPublication: async () => {
            await writeFile(source, "{}\n", "utf8");
          },
        },
      }),
    ).rejects.toThrow(/hash mismatch|replay/u);
    await expect(readFile(output)).rejects.toThrow();
    expect((await readdir(root)).some(
      (entry) => entry.includes(".incomplete-"),
    )).toBe(false);
  });

  it("publishes atomically without replacement and as 0644 under umask", async () => {
    const root = await copySourceUniverse();
    const output = join(root, "prior-identity-plan.json");
    const previousUmask = process.umask(0o077);
    let first;
    try {
      first = await materializeC6Wave3PriorRepositoryIdentityPlan({
        outputPath: output,
        sourceUniversePath: join(root, SOURCE_BASENAME),
      });
    } finally {
      process.umask(previousUmask);
    }
    expect((await stat(output)).mode & 0o7777).toBe(0o644);
    expect(
      parseC6Wave3PriorRepositoryIdentityPlan(
        await readFile(output),
      ),
    ).toEqual(first.plan);
    const original = await readFile(output, "utf8");
    await expect(
      materializeC6Wave3PriorRepositoryIdentityPlan({
        outputPath: output,
        sourceUniversePath: join(root, SOURCE_BASENAME),
      }),
    ).rejects.toThrow();
    expect(await readFile(output, "utf8")).toBe(original);
    expect((await readdir(root)).some(
      (entry) => entry.includes(".incomplete-"),
    )).toBe(false);
  });

  it("rejects symlink and mode drift while preserving foreign inodes", async () => {
    const physicalRoot = await copySourceUniverse();
    const aliasParent = await mkdtemp(
      join(await realpath(tmpdir()), "goodmemory-c6-wave3-prior-alias-"),
    );
    temporaryRoots.push(aliasParent);
    const alias = join(aliasParent, "source");
    await symlink(physicalRoot, alias);
    await expect(
      buildC6Wave3PriorRepositoryIdentityPlan({
        sourceUniversePath: join(alias, SOURCE_BASENAME),
      }),
    ).rejects.toThrow(/symlink/u);
    await expect(
      materializeC6Wave3PriorRepositoryIdentityPlan({
        outputPath: join(alias, "output.json"),
        sourceUniversePath: join(
          physicalRoot,
          SOURCE_BASENAME,
        ),
      }),
    ).rejects.toThrow(/symlink/u);

    const modeRoot = await copySourceUniverse();
    const modeOutput = join(modeRoot, "output.json");
    await expect(
      materializeC6Wave3PriorRepositoryIdentityPlan({
        outputPath: modeOutput,
        sourceUniversePath: join(modeRoot, SOURCE_BASENAME),
        testHooks: {
          afterOutputPublication: async () => {
            await chmod(modeOutput, 0o600);
          },
        },
      }),
    ).rejects.toThrow(/ownership mismatch/u);
    await expect(readFile(modeOutput)).rejects.toThrow();

    const outputRoot = await copySourceUniverse();
    const outputPath = join(outputRoot, "output.json");
    await expect(
      materializeC6Wave3PriorRepositoryIdentityPlan({
        outputPath,
        sourceUniversePath: join(outputRoot, SOURCE_BASENAME),
        testHooks: {
          afterOutputPublication: async () => {
            await rm(outputPath);
            await writeFile(outputPath, "foreign-output\n", {
              mode: 0o644,
            });
          },
        },
      }),
    ).rejects.toThrow(/ownership mismatch/u);
    expect(await readFile(outputPath, "utf8")).toBe(
      "foreign-output\n",
    );

    const temporaryRoot = await copySourceUniverse();
    const temporaryOutput = join(temporaryRoot, "output.json");
    let foreignTemporary = "";
    await expect(
      materializeC6Wave3PriorRepositoryIdentityPlan({
        outputPath: temporaryOutput,
        sourceUniversePath: join(
          temporaryRoot,
          SOURCE_BASENAME,
        ),
        testHooks: {
          afterOutputPublication: async () => {
            foreignTemporary = (await readdir(temporaryRoot))
              .find((entry) =>
                entry.includes(".incomplete-")
              )!;
            await rm(join(temporaryRoot, foreignTemporary));
            await writeFile(
              join(temporaryRoot, foreignTemporary),
              "foreign-temporary\n",
              { mode: 0o644 },
            );
          },
        },
      }),
    ).rejects.toThrow(/ownership mismatch/u);
    expect(
      await readFile(
        join(temporaryRoot, foreignTemporary),
        "utf8",
      ),
    ).toBe("foreign-temporary\n");
    await expect(readFile(temporaryOutput)).rejects.toThrow();
  });

  it("preserves foreign symlink targets replacing published hardlinks", async () => {
    const outputRoot = await copySourceUniverse();
    const outputPath = join(outputRoot, "output.json");
    const foreignOutputTarget = join(
      outputRoot,
      "foreign-output-target.txt",
    );
    await writeFile(
      foreignOutputTarget,
      "foreign-output-target\n",
      "utf8",
    );
    await expect(
      materializeC6Wave3PriorRepositoryIdentityPlan({
        outputPath,
        sourceUniversePath: join(outputRoot, SOURCE_BASENAME),
        testHooks: {
          afterOutputPublication: async () => {
            await rm(outputPath);
            await symlink(foreignOutputTarget, outputPath);
          },
        },
      }),
    ).rejects.toThrow(/ownership mismatch/u);
    expect((await lstat(outputPath)).isSymbolicLink()).toBe(true);
    expect(await readFile(foreignOutputTarget, "utf8")).toBe(
      "foreign-output-target\n",
    );

    const temporaryRoot = await copySourceUniverse();
    const temporaryOutput = join(temporaryRoot, "output.json");
    const foreignTemporaryTarget = join(
      temporaryRoot,
      "foreign-temporary-target.txt",
    );
    await writeFile(
      foreignTemporaryTarget,
      "foreign-temporary-target\n",
      "utf8",
    );
    let foreignTemporary = "";
    await expect(
      materializeC6Wave3PriorRepositoryIdentityPlan({
        outputPath: temporaryOutput,
        sourceUniversePath: join(
          temporaryRoot,
          SOURCE_BASENAME,
        ),
        testHooks: {
          afterOutputPublication: async () => {
            foreignTemporary = (await readdir(temporaryRoot))
              .find((entry) =>
                entry.includes(".incomplete-")
              )!;
            const temporaryPath = join(
              temporaryRoot,
              foreignTemporary,
            );
            await rm(temporaryPath);
            await symlink(
              foreignTemporaryTarget,
              temporaryPath,
            );
          },
        },
      }),
    ).rejects.toThrow(/ownership mismatch/u);
    expect(
      (await lstat(
        join(temporaryRoot, foreignTemporary),
      )).isSymbolicLink(),
    ).toBe(true);
    expect(
      await readFile(foreignTemporaryTarget, "utf8"),
    ).toBe("foreign-temporary-target\n");
    await expect(readFile(temporaryOutput)).rejects.toThrow();
  });

  it("exposes a strict offline-only snapshot CLI", async () => {
    expect(
      parseC6Wave3PriorRepositoryIdentityPlanCliOptions([
        "--output=/tmp/output.json",
        "--source-universe=/tmp/source.json",
      ]),
    ).toEqual({
      output: "/tmp/output.json",
      sourceUniverse: "/tmp/source.json",
    });
    for (const args of [
      ["--network=true"],
      [
        "--output=/tmp/output.json",
        "--output=/tmp/other.json",
        "--source-universe=/tmp/source.json",
      ],
      [
        "--output=/tmp/output.json",
        "--source-universe= /tmp/source.json",
      ],
    ]) {
      expect(() =>
        parseC6Wave3PriorRepositoryIdentityPlanCliOptions(args)
      ).toThrow();
    }

    const root = await copySourceUniverse();
    const output = join(root, "cli-output.json");
    const result =
      await runC6Wave3PriorRepositoryIdentityPlanSnapshotCommand([
        `--output=${output}`,
        `--source-universe=${join(root, SOURCE_BASENAME)}`,
      ]);
    expect(result).toEqual({
      artifactKind:
        "c6-wave3-prior-repository-identity-plan",
      officialWave3SearchPermitted: false,
      output,
      outputSha256: result.outputSha256,
      priorIdentityCapturePermitted: false,
      schemaVersion: 1,
    });
    expect(
      parseC6Wave3PriorRepositoryIdentityPlan(
        await readFile(output),
      ).captureProtocol.networkExecuted,
    ).toBe(false);
  });
});

async function copySourceUniverse(): Promise<string> {
  const root = await mkdtemp(
    join(await realpath(tmpdir()), "goodmemory-c6-wave3-prior-"),
  );
  temporaryRoots.push(root);
  await copyFile(SOURCE_PATH, join(root, SOURCE_BASENAME));
  return root;
}

async function materializeFrozenArtifactInputs(
  plan: C6Wave3PriorRepositoryIdentityPlan,
): Promise<{
  planPath: string;
  sourceUniversePath: string;
}> {
  const root = await mkdtemp(
    join(await realpath(tmpdir()), "goodmemory-c6-wave3-prior-inputs-"),
  );
  temporaryRoots.push(root);
  const planPath = join(root, PLAN_BASENAME);
  const sourceUniversePath = join(root, SOURCE_BASENAME);
  await writeFile(
    planPath,
    serializeC6Wave3PriorRepositoryIdentityPlan(plan),
    "utf8",
  );
  await copyFile(SOURCE_PATH, sourceUniversePath);
  await Promise.all([
    chmod(planPath, 0o644),
    chmod(sourceUniversePath, 0o644),
  ]);
  return {
    planPath,
    sourceUniversePath,
  };
}

async function materializeSyntheticRawEvidence(
  lookups: C6Wave3PriorRepositoryIdentityCaptureLookup[],
): Promise<string> {
  const root = await mkdtemp(
    join(await realpath(tmpdir()), "goodmemory-c6-wave3-prior-evidence-"),
  );
  temporaryRoots.push(root);
  for (const lookup of lookups) {
    for (const attempt of lookup.attempts) {
      const requestBody = JSON.stringify({
        query: C6_WAVE3_PRIOR_REPOSITORY_IDENTITY_QUERY,
        variables: attempt.requestProjection.variables,
      });
      attempt.requestBody = await writeEvidenceFile(
        root,
        attempt.requestBody.path,
        requestBody,
      );
      if (attempt.responseBodyReadCompleted) {
        const responseBody =
          attempt.outcome === "complete-graphql-http-200"
            ? JSON.stringify({ data: lookup.response })
            : JSON.stringify({ retryable: true });
        if (attempt.responseBody === null) {
          throw new Error(
            "synthetic completed response body reference missing",
          );
        }
        attempt.responseBody = await writeEvidenceFile(
          root,
          attempt.responseBody.path,
          responseBody,
        );
      } else {
        attempt.responseBody = null;
      }
      attempt.responseHeaders = await writeEvidenceFile(
        root,
        attempt.responseHeaders.path,
        `${JSON.stringify(
          attempt.selectedResponseHeaders,
          null,
          2,
        )}\n`,
      );
      const {
        artifact: _retryArtifact,
        ...retryDecisionReceipt
      } = attempt.retryDecision;
      attempt.retryDecision.artifact =
        await writeEvidenceFile(
          root,
          attempt.retryDecision.artifact.path,
          `${JSON.stringify(
            retryDecisionReceipt,
            null,
            2,
          )}\n`,
        );
      if (attempt.transportError !== null) {
        const {
          artifact: _transportArtifact,
          ...transportErrorReceipt
        } = attempt.transportError;
        attempt.transportError.artifact =
          await writeEvidenceFile(
            root,
            attempt.transportError.artifact.path,
            `${JSON.stringify(
              transportErrorReceipt,
              null,
              2,
            )}\n`,
          );
      }
      attempt.request = await writeEvidenceFile(
        root,
        attempt.request.path,
        `${JSON.stringify({
          attempt: attempt.attempt,
          body: attempt.requestBody,
          ...attempt.requestProjection,
        }, null, 2)}\n`,
      );
      const {
        attemptArtifact: _attemptArtifact,
        ...attemptReceipt
      } = attempt;
      attempt.attemptArtifact = await writeEvidenceFile(
        root,
        attempt.attemptArtifact.path,
        `${JSON.stringify(attemptReceipt, null, 2)}\n`,
      );
    }
  }
  await rewriteAssetLock(root);
  return root;
}

async function writeEvidenceFile(
  root: string,
  path: string,
  content: string | Uint8Array,
): Promise<{
  bytes: number;
  path: string;
  sha256: string;
}> {
  const absolutePath = join(root, path);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content);
  await chmod(absolutePath, 0o644);
  return {
    bytes: typeof content === "string"
      ? Buffer.byteLength(content)
      : content.byteLength,
    path,
    sha256: sha256(content),
  };
}

async function rewriteAssetLock(root: string): Promise<void> {
  const assetLock = await buildC6AssetLock(root);
  const path = join(root, "asset-lock.json");
  await writeFile(path, serializeC6AssetLock(assetLock), "utf8");
  await chmod(path, 0o644);
}

function syntheticLookups(
  plan: C6Wave3PriorRepositoryIdentityPlan,
  options: { caseFoldConflict?: boolean } = {},
): C6Wave3PriorRepositoryIdentityCaptureLookup[] {
  const lookups: C6Wave3PriorRepositoryIdentityCaptureLookup[] =
    [];
  for (const pass of ["A", "B"] as const) {
    for (const target of plan.targets) {
      const lookupOrder = pass === "A"
        ? target.passALookupOrder
        : target.passBLookupOrder;
      const identity = syntheticIdentity(
        target,
        options.caseFoldConflict === true,
      );
      lookups.push({
        attempts: [
          syntheticSuccessAttempt(
            target,
            lookupOrder,
            1,
            identity,
          ),
        ],
        finalAttempt: 1,
        lookupOrder,
        pass,
        repositoryNodeId: identity.repositoryNodeId,
        repositoryOrder: target.repositoryOrder,
        requestedName: target.requestedName,
        requestedNameWithOwner:
          target.requestedNameWithOwner,
        requestedOwner: target.requestedOwner,
        requestedRepositorySha256:
          target.requestedRepositorySha256,
        resolvedNameWithOwner:
          identity.resolvedNameWithOwner,
        resolvedUrl:
          `https://github.com/${identity.resolvedNameWithOwner}`,
        response: {
          rateLimit: {
            cost: 1,
            limit: 5_000,
            remaining: 4_999,
            resetAt: "2026-07-26T12:00:00Z",
            used: 1,
          },
          repository: {
            id: identity.repositoryNodeId,
            nameWithOwner: identity.resolvedNameWithOwner,
            url:
              `https://github.com/${identity.resolvedNameWithOwner}`,
          },
        },
        success: true,
      });
    }
  }
  return lookups;
}

function syntheticIdentity(
  target: C6Wave3PriorRepositoryIdentityPlan["targets"][number],
  caseFoldConflict: boolean,
): {
  repositoryNodeId: string;
  resolvedNameWithOwner: string;
} {
  if (target.repositoryOrder === 1) {
    return caseFoldConflict
      ? {
        repositoryNodeId: "R_CASE_FOLD_A",
        resolvedNameWithOwner: "CaseFold/Repository",
      }
      : {
        repositoryNodeId: "R_SHARED_ALIAS",
        resolvedNameWithOwner: "renamed/shared-alias",
      };
  }
  if (target.repositoryOrder === 2) {
    return caseFoldConflict
      ? {
        repositoryNodeId: "R_CASE_FOLD_B",
        resolvedNameWithOwner: "casefold/repository",
      }
      : {
        repositoryNodeId: "R_SHARED_ALIAS",
        resolvedNameWithOwner: "renamed/shared-alias",
      };
  }
  return {
    repositoryNodeId:
      `R_${target.requestedRepositorySha256}`,
    resolvedNameWithOwner: target.requestedNameWithOwner,
  };
}

function syntheticSuccessAttempt(
  target: C6Wave3PriorRepositoryIdentityPlan["targets"][number],
  lookupOrder: number,
  attempt: number,
  identity: {
    repositoryNodeId: string;
    resolvedNameWithOwner: string;
  },
): C6Wave3PriorRepositoryIdentityCaptureLookup["attempts"][number] {
  const root = attemptRoot(lookupOrder, attempt);
  const requestBody = JSON.stringify({
    query: C6_WAVE3_PRIOR_REPOSITORY_IDENTITY_QUERY,
    variables: {
      name: target.requestedName,
      owner: target.requestedOwner,
    },
  });
  return {
    attempt,
    attemptArtifact: syntheticReference(
      `${root}/attempt.json`,
    ),
    httpResponseExists: true,
    httpStatus: 200,
    lookupOrder,
    outcome: "complete-graphql-http-200",
    request: syntheticReference(`${root}/request.json`),
    requestBody: syntheticReference(
      `${root}/request-body.raw`,
      requestBody,
    ),
    requestProjection: {
      endpoint: "https://api.github.com/graphql",
      headers: {
        accept: "application/vnd.github+json",
        authorization: "Bearer <redacted>",
        "content-type": "application/json",
        "user-agent":
          "GoodMemory-C6-Wave3-Prior-Repository-Identity/1",
        "x-github-api-version": "2022-11-28",
      },
      lookupOrder,
      method: "POST",
      redirect: "error",
      timeoutMilliseconds: 60_000,
      variables: {
        name: target.requestedName,
        owner: target.requestedOwner,
      },
    },
    responseBody: syntheticReference(
      `${root}/response-body.raw`,
    ),
    responseBodyReadCompleted: true,
    responseHeaders: syntheticReference(
      `${root}/response-headers.json`,
    ),
    retryDecision: {
      artifact: syntheticReference(
        `${root}/retry-decision.json`,
      ),
      decision: "stop-success",
      delayMilliseconds: null,
      reason: "complete-graphql-response",
      retryAfter: null,
    },
    selectedResponseHeaders: syntheticResponseHeaders(),
    transportError: null,
  };
}

function syntheticBodyReadFailure(
  target: C6Wave3PriorRepositoryIdentityPlan["targets"][number],
  lookupOrder: number,
  attempt: number,
): C6Wave3PriorRepositoryIdentityCaptureLookup["attempts"][number] {
  const root = attemptRoot(lookupOrder, attempt);
  const requestBody = JSON.stringify({
    query: C6_WAVE3_PRIOR_REPOSITORY_IDENTITY_QUERY,
    variables: {
      name: target.requestedName,
      owner: target.requestedOwner,
    },
  });
  return {
    attempt,
    attemptArtifact: syntheticReference(
      `${root}/attempt.json`,
    ),
    httpResponseExists: true,
    httpStatus: 200,
    lookupOrder,
    outcome: "transient-transport-failure",
    request: syntheticReference(`${root}/request.json`),
    requestBody: syntheticReference(
      `${root}/request-body.raw`,
      requestBody,
    ),
    requestProjection: {
      endpoint: "https://api.github.com/graphql",
      headers: {
        accept: "application/vnd.github+json",
        authorization: "Bearer <redacted>",
        "content-type": "application/json",
        "user-agent":
          "GoodMemory-C6-Wave3-Prior-Repository-Identity/1",
        "x-github-api-version": "2022-11-28",
      },
      lookupOrder,
      method: "POST",
      redirect: "error",
      timeoutMilliseconds: 60_000,
      variables: {
        name: target.requestedName,
        owner: target.requestedOwner,
      },
    },
    responseBody: null,
    responseBodyReadCompleted: false,
    responseHeaders: syntheticReference(
      `${root}/response-headers.json`,
    ),
    retryDecision: {
      artifact: syntheticReference(
        `${root}/retry-decision.json`,
      ),
      decision: "retry",
      delayMilliseconds: 1_000,
      reason: "transient-transport-code",
      retryAfter: null,
    },
    selectedResponseHeaders: syntheticResponseHeaders(),
    transportError: {
      artifact: syntheticReference(
        `${root}/transport-error.json`,
      ),
      code: "UND_ERR_SOCKET",
      message: "body read failed",
      phase: "body-read",
      transient: true,
    },
  };
}

function syntheticResponseHeaders(): {
  date: string;
  "retry-after": null;
  "x-github-request-id": string;
  "x-ratelimit-limit": string;
  "x-ratelimit-remaining": string;
  "x-ratelimit-reset": string;
  "x-ratelimit-resource": "graphql";
  "x-ratelimit-used": string;
} {
  return {
    date: "Sun, 26 Jul 2026 12:00:00 GMT",
    "retry-after": null,
    "x-github-request-id": "REQUEST-ID",
    "x-ratelimit-limit": "5000",
    "x-ratelimit-remaining": "4999",
    "x-ratelimit-reset": "1785067200",
    "x-ratelimit-resource": "graphql",
    "x-ratelimit-used": "1",
  };
}

function attemptRoot(
  lookupOrder: number,
  attempt: number,
): string {
  return `lookup-${lookupOrder.toString().padStart(4, "0")}/` +
    `attempt-${attempt.toString().padStart(2, "0")}`;
}

function syntheticReference(
  path: string,
  content = path,
): {
  bytes: number;
  path: string;
  sha256: string;
} {
  return {
    bytes: Buffer.byteLength(content),
    path,
    sha256: sha256(content),
  };
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
