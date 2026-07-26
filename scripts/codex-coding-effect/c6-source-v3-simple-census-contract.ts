import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

export const C6_SOURCE_V3_SIMPLE_REPOSITORY_COUNT_QUERY =
  `query C6SourceV3SimpleRepositoryCount($query: String!) {
  search(query: $query, type: REPOSITORY, first: 1) {
    repositoryCount
  }
  rateLimit {
    cost
    limit
    remaining
    resetAt
    used
  }
}
`;

export const C6_SOURCE_V3_SIMPLE_REPOSITORY_PAGE_QUERY =
  `query C6SourceV3SimpleRepositoryPage($query: String!, $after: String) {
  search(query: $query, type: REPOSITORY, first: 100, after: $after) {
    repositoryCount
    nodes {
      __typename
      ... on Repository {
        id
        nameWithOwner
        createdAt
        pushedAt
        isArchived
        isFork
        isMirror
        isTemplate
        visibility
        primaryLanguage {
          name
        }
      }
    }
    pageInfo {
      hasNextPage
      endCursor
    }
  }
  rateLimit {
    cost
    limit
    remaining
    resetAt
    used
  }
}
`;

export const C6_SOURCE_V3_SIMPLE_PULL_REQUEST_PAGE_QUERY =
  `query C6SourceV3SimplePullRequestPage($repositoryNodeId: ID!, $after: String) {
  node(id: $repositoryNodeId) {
    __typename
    ... on Repository {
      id
      nameWithOwner
      pullRequests(first: 100, after: $after, states: [MERGED], orderBy: {field: CREATED_AT, direction: DESC}) {
        totalCount
        nodes {
          id
          number
          url
          createdAt
          mergedAt
          baseRefOid
          mergeCommit {
            oid
          }
          author {
            login
          }
          commits(first: 1) {
            totalCount
          }
          reviews(first: 1) {
            totalCount
          }
          reviewThreads(first: 1) {
            totalCount
          }
        }
        pageInfo {
          hasNextPage
          endCursor
        }
      }
    }
  }
  rateLimit {
    cost
    limit
    remaining
    resetAt
    used
  }
}
`;

const CONTRACT = {
  artifactKind:
    "c6-source-v3-simple-census-execution-contract",
  boundary: {
    acceptedEpisodeCount: 0,
    candidateManifestFrozen: false,
    candidateSelectionPermitted: false,
    codexRunReady: false,
    liveCensusRequestCount: 0,
    liveCensusRequestPermitted: false,
    runtimeActivationFrozen: false,
    status:
      "executable-contract-only-no-live-census-evidence",
  },
  capture: {
    capturePasses: ["A", "B"],
    checkpointResume: {
      activePassPreTokenFilesystemGate:
        "continuous-complete-requests-one-optional-in-progress-request-no-future-or-trailing-artifacts-and-static-pass-artifacts-must-finish-by-tokenless-local-replay",
      checkpointBindings: [
        "evaluationId",
        "executionContractSha256",
        "frozenInputClosureArtifact",
        "frozenInputClosureSha256",
        "runtimeAuthorizationSha256",
        "runtimeFreezeCommit",
        "runtimeSourceManifestSha256",
        "capturePass",
        "logicalRequestOrdinal",
        "logicalRequestIdentitySha256",
        "priorLogicalRequestCompletionSha256",
      ],
      completedLogicalRequestReplayRequired: true,
      completedLogicalRequestResumeAction:
        "local-raw-response-replay-network-redispatch-prohibited",
      incompleteAttemptPolicy:
        "when-request-committed-has-no-response-started-append-fixed-locally-generated-tokenless-process-interruption-transport-error-consume-attempt-then-retry-identical-logical-request",
      logicalRequestOrdinal:
        "strictly-monotonic-within-pass-starting-at-one",
      passCacheIsolationRequired: true,
      pendingRecovery:
        "recursively-recover-only-schema-known-pending-artifacts-before-state-classification-unknown-pending-fails-closed",
      resumeAfterProcessInterruption: true,
      resumeAfterTerminalFailure: false,
      singleWriterLock:
        "create-exclusive-evaluation-root-writer-lock",
      singleWriterRequired: true,
      terminalResponseCrashRecovery:
        "replay-local-response-classification-and-publish-failure-without-network-redispatch",
      assetLockRecovery:
        "asset-lock-present-enters-finalize-only-mode-load-durable-frame-and-runtime-authorization-verify-entire-locked-outcome-before-token-access-and-write-only-terminal",
      terminalFailureMarker:
        "terminal.json-outcome-failed-prevents-resume",
    },
    countTree: {
      accessibleResultCap: 1_000,
      childIntervals:
        "left=[lo,mid]-right=[mid+1-second,hi]",
      countProbeFirst: 1,
      fullInternalTreeRetained: true,
      midpoint:
        "floor((lo-unix-seconds+hi-unix-seconds)/2)",
      singleUtcSecondAboveCap:
        "terminal-evaluation-failure",
    },
    countTreeEqualityAcrossPassesRequired: false,
    countTreeTraversal:
      "depth-first-preorder-left-child-before-right-child",
    failurePolicy:
      "fail-evaluation-id-without-redraw-skip-or-frame-expansion",
    metadataDecisionBijectionRequired: true,
    mode: "complete-finite-frame",
    normalizedProjectionHash: {
      algorithm: "sha256",
      fieldOrder: [
        "repositories",
        "repositoryDecisions",
        "pullRequests",
        "metadataDecisions",
      ],
      fieldPrefix:
        "utf8-field-name-then-single-0x00-then-base10-row-count-then-single-0x00",
      rowEncoding:
        "base10-utf8-byte-length-then-ascii-colon-then-schema-ordered-json-stringify-no-whitespace-then-single-0x0a",
      schemaOrderedObjectKeys:
        "exactly-the-frozen-row-field-arrays-and-decision-schema-order",
    },
    normalizedRowEqualityAcrossPassesRequired: true,
    passCommitProtocol: {
      passAGenesisPriorCompletionSha256:
        "0000000000000000000000000000000000000000000000000000000000000000",
      passBGenesis:
        "create-only-bind-exact-pass-a-complete-sha256",
      passCompleteRequiredFields: [
        "pass",
        "evaluationId",
        "executionContractSha256",
        "frozenInputClosureSha256",
        "runtimeAuthorizationSha256",
        "genesisSha256",
        "logicalRequestCount",
        "logicalRequestCompletionArtifacts",
        "lastLogicalRequestCompletionSha256",
        "attemptLedgerRootSha256",
        "countTreeClosureArtifact",
        "repositoryClosureArtifact",
        "pullRequestClosureArtifact",
        "normalizedProjectionSha256",
      ],
      attemptLedgerRootHash:
        "sha256-over-contiguous-base10-ordinal-null-logical-request-completion-sha256-newline",
      passCompleteWrite:
        "pass-complete.json-create-only-fsync-written-after-full-local-replay",
      passFilesystemClosure:
        "reject-unreferenced-request-attempt-result-or-other-files-before-pass-complete-is-accepted",
    },
    passOrder: "A-complete-before-B-starts",
    passReusePolicy:
      "every-pass-has-distinct-network-attempt-ledger-no-cross-pass-response-cache",
    semanticCausalClosure:
      "every-normalized-artifact-is-rebuilt-from-the-ordered-verified-projected-result-of-every-logical-request",
    pullRequestClosureBijectionRequired: true,
    pullRequestConnection: {
      lowerBoundInclusive: "2022-01-01T00:00:00Z",
      order:
        "createdAt-descending-then-pullRequestNodeId-utf8-byte-ascending",
      pageSize: 100,
      states: ["MERGED"],
      terminal:
        "connection-exhausted-or-strictly-older-createdAt-witness",
      upperBoundInclusive: "2025-12-31T23:59:59Z",
      upperBoundRows:
        "exclude-from-normalized-rows-retain-raw-page",
    },
    repositoryConnection: {
      pageSize: 100,
      terminal:
        "hasNextPage-false-and-collected-count-equals-leaf-count",
    },
    repositoryDecisionBijectionRequired: true,
    repositoryLeafClosureBijectionRequired: true,
    repositoryOrder:
      "repositoryNodeId-utf8-byte-ascending",
    rootShardCount: 1_536,
    rootShardOrder: "rootShardId-utf8-byte-ascending",
  },
  evaluationId:
    "goodmemory-c6-codex-coding-effect-source-v3-simple-v1",
  graphql: {
    endpoint: "https://api.github.com/graphql",
    envelope: {
      errorsWithPartialData:
        "retain-raw-never-consume-data-then-classify-errors",
      success:
        "data-required-errors-absent-or-empty-extensions-allowed",
    },
    globalNodeIdMode:
      "opaque-github-default-x-github-next-global-id-header-omitted",
    operations: {
      pullRequestPage: queryReference(
        "C6SourceV3SimplePullRequestPage",
        C6_SOURCE_V3_SIMPLE_PULL_REQUEST_PAGE_QUERY,
      ),
      repositoryCount: queryReference(
        "C6SourceV3SimpleRepositoryCount",
        C6_SOURCE_V3_SIMPLE_REPOSITORY_COUNT_QUERY,
      ),
      repositoryPage: queryReference(
        "C6SourceV3SimpleRepositoryPage",
        C6_SOURCE_V3_SIMPLE_REPOSITORY_PAGE_QUERY,
      ),
    },
    requestHeaders: {
      accept: "application/vnd.github+json",
      authorization: "Bearer [REDACTED]",
      "content-type": "application/json",
      "user-agent":
        "GoodMemory-C6-Source-V3-Simple-Census/1",
      "x-github-api-version": "2022-11-28",
    },
    responseProjectors: {
      pullRequestPage: {
        requestAfterVariable:
          "present-as-null-on-first-page-then-exact-prior-endCursor",
        searchNodeTypenamePolicy: "not-applicable",
        strictProjector:
          "node-repository-identity-and-pull-request-page-v1",
      },
      repositoryCount: {
        requestAfterVariable: "absent",
        strictProjector:
          "search-repositoryCount-and-rateLimit-v1",
      },
      repositoryPage: {
        requestAfterVariable:
          "present-as-null-on-first-page-then-exact-prior-endCursor",
        searchNodeTypenamePolicy:
          "every-element-non-null-and-__typename-exactly-Repository",
        strictProjector:
          "search-repository-page-and-rateLimit-v1",
      },
    },
    responseIdentity: {
      repositorySearchIdIsSubsequentNodeLookupId: true,
      requestNodeIdEchoProhibited: true,
      returnedRepositoryIdMustEqualRequestedNodeId: true,
      returnedTypename: "Repository",
    },
  },
  inputs: {
    metadataPredicate: {
      bytes: 9_105,
      path:
        "fixtures/codex-coding-effect/c6-source-pool/" +
        "swe-bench-live-multilang-608f7ae9." +
        "wave3-pretarget-policy-v1.json",
      sha256:
        "eb3df63ff269b1d0166ed4b2faba682d60cdce3fb1ea64946e66f08e5eda9856",
    },
    priorExclusionProjection: {
      bytes: 50_106,
      nodeIdDedupProjectionSha256:
        "c1d0d92294306042872f73a7e98acd7a64cd6aa82c01ef2cdd81bcf2620e4076",
      path:
        "fixtures/codex-coding-effect/c6-source-pool/" +
        "provenance/source-v3-simple/" +
        "prior-repository-identity/" +
        "prior-repository-exclusion-projection-v1.json",
      sha256:
        "a7a80a9c7797424aaf89938d5f7860b47ebde9fc4fa504d1df488c033cda35a9",
      uniqueAliasCount: 178,
      uniqueNodeIdCount: 178,
    },
    priorIdentityReplayReceipt: {
      bytes: 4_769,
      path:
        "fixtures/codex-coding-effect/c6-source-pool/" +
        "provenance/source-v3-simple/" +
        "prior-repository-identity/" +
        "swe-bench-live-multilang-608f7ae9." +
        "source-v3-simple-prior-repository-identity-" +
        "observation-replay-v1.json",
      sha256:
        "903912db14ed999cd19f32ffaef81658bc241daf8be9e2f33aa14b1784b94d0a",
    },
    promotionReceipt: {
      bytes: 12_652,
      path:
        "fixtures/codex-coding-effect/c6-source-pool/" +
        "provenance/source-v3-simple/promotion/" +
        "promotion-receipt-v1.json",
      sha256:
        "a0892b9c87cce89b23604a43b02d06ad1344fe010afd4894a5f6c387c7d43e3b",
    },
    protocol: {
      bytes: 3_992,
      path:
        "fixtures/codex-coding-effect/c6-source-pool/" +
        "swe-bench-live-multilang-608f7ae9." +
        "source-v3-simple-protocol-v1.json",
      sha256:
        "5f989ab640c684dac287142edc9d2f9d8ee46099c082f63bb20f2a9546205132",
    },
    sourceUniverse: {
      bytes: 631_004,
      path:
        "fixtures/codex-coding-effect/c6-source-pool/" +
        "swe-bench-live-multilang-608f7ae9." +
        "wave3-source-universe-v2.json",
      sha256:
        "822c458e792ee31f7738cae2526b05dfc3b63fcaac58e3f4f87dcd3803ccdba1",
    },
  },
  normalization: {
    allowedNullableFields: [
      "pullRequest.author",
      "pullRequest.mergeCommit",
    ],
    criticalNullPolicy:
      "retain-raw-response-then-terminal-failure",
    dateTimePolicy:
      "exact-whole-second-utc-z-otherwise-terminal",
    gitObjectIdPolicy:
      "exact-lowercase-40-hex-otherwise-terminal",
    prohibitedNullOrWrongTypeFields: [
      "search.nodes",
      "search.nodes[]",
      "node",
      "node.__typename",
      "repository.id",
      "repository.nameWithOwner",
      "repository.primaryLanguage",
      "repository.pushedAt",
      "pullRequest.nodes",
      "pullRequest.nodes[]",
      "pullRequest.mergedAt",
      "pullRequest.commits",
      "pullRequest.reviews",
      "pullRequest.reviewThreads",
    ],
    metadataDecisionInputs: [
      "canonicalAnchorId",
      "canonicalRepository",
      "commitTotalCount",
      "reviewCount",
      "reviewThreadCount",
    ],
    metadataDecisionRowFields: [
      "accepted",
      "canonicalAnchorId",
      "canonicalRepository",
      "pullRequestNodeId",
      "reasons",
    ],
    pullRequestRowFields: [
      "authorLogin",
      "baseRefOid",
      "canonicalAnchorId",
      "canonicalRepository",
      "commitTotalCount",
      "createdAt",
      "mergeCommitOid",
      "mergedAt",
      "number",
      "pullRequestNodeId",
      "repositoryNodeId",
      "reviewCount",
      "reviewThreadCount",
      "url",
    ],
    repositoryRowFields: [
      "createdAt",
      "id",
      "isArchived",
      "isFork",
      "isMirror",
      "isTemplate",
      "leafCreatedFrom",
      "leafCreatedTo",
      "nameWithOwner",
      "primaryLanguage",
      "pushedAt",
      "repositoryNodeId",
      "rootShardId",
      "sourceSplit",
      "visibility",
    ],
    repositoryDecisionRowFields: [
      "accepted",
      "canonicalRepository",
      "reasons",
      "repositoryNodeId",
    ],
    twoPassEqualityProjection: [
      "repositories",
      "repositoryDecisions",
      "pullRequests",
      "metadataDecisions",
    ],
  },
  publication: {
    assetLockBindings: [
      "evaluationId",
      "executionContractSha256",
      "inputClosureSha256",
      "frozenInputClosureSha256",
      "runtimeAuthorizationSha256",
      "exact-frozen-input-closure-file-reference",
      "exact-recursive-asset-file-set",
    ],
    assetLockRequired: true,
    authoritativeTerminalMarker:
      "terminal.json-create-only-fsync-written-last",
    createOnlyFinalRoot: true,
    finalWriteOrder: [
      "pass-a-complete",
      "pass-b-genesis-binding-pass-a",
      "pass-b-complete",
      "two-pass-equality-receipt",
      "census-receipt",
      "asset-lock",
      "terminal",
    ],
    failureChainTip:
      "exact-whitelist-of-frozen-input-closure-input-mutation-evidence-full-ledger-verified-response-started-or-terminal-attempt-logical-request-completion-pass-complete-or-two-pass-equality-with-evaluation-contract-frozen-closure-runtime-authorization-and-path-context-reverified",
    frameAuthority:
      "publication-and-terminal-verification-use-only-the-canonical-frame-inside-expected-frozen-inputs",
    receiptAndAssetLockAreEvidenceNotTerminalMarkers: true,
    rollback:
      "remove-only-capture-owned-device-and-inode-identities",
    terminalInputReplayRequired:
      "current-inputs-rechecked-before-outcome-receipt-input-mutation-binds-typed-observation-evidence-asset-lock-closes-the-receipt-graph-later-terminal-finalization-replays-only-the-locked-closure-and-publication-graph",
    terminalSchema: {
      completeRequiredRefs: [
        "passAComplete",
        "passBComplete",
        "twoPassEqualityReceipt",
        "assetLock",
        "censusReceipt",
      ],
      discriminant: "outcome-complete-or-failed",
      failedRequiredFields: [
        "chainTip",
        "failureCode",
        "failureEvidence",
        "frozenInputClosure",
        "assetLock",
      ],
      sharedRequiredFields: [
        "evaluationId",
        "executionContractSha256",
        "frozenInputClosure",
        "frozenInputClosureSha256",
        "runtimeAuthorizationSha256",
        "inputClosureSha256",
      ],
    },
    writeSemantics:
      "all-publication-artifacts-are-create-only-or-verify-exact-existing-bytes-for-crash-idempotence",
  },
  preflight: {
    closureVerificationMoments: [
      "before-first-network-request",
      "before-outcome-receipt-publication",
    ],
    frozenClosureContents: [
      "canonical-frame",
      "canonical-frozen-input-receipts",
      "runtime-authorization-snapshot",
      "runtime-authorization-sha256",
    ],
    frozenInputRead:
      "component-wise-no-symlink-stable-regular-file-read",
    requiredBindings: [
      "protocol-bytes-and-sha256",
      "promotion-receipt-bytes-and-sha256",
      "metadata-predicate-bytes-and-sha256",
      "prior-identity-replay-receipt-bytes-and-sha256",
      "prior-exclusion-projection-bytes-and-sha256",
      "source-universe-bytes-and-sha256",
      "execution-contract-bytes-and-sha256",
      "cryptographically-rebuilt-promotion-authorization",
      "runtime-freeze-manifest-review-commit-and-activation-receipt",
    ],
    terminalOnMutation:
      "typed-input-mutation-evidence-then-failure-evidence-asset-lock-and-failed-terminal",
  },
  runtimeActivation: {
    activationBridgeRequired: true,
    activationStatementReviewRequired: true,
    activationReceiptExactRebuildRequired: true,
    callerOrRunnerSelfReportedHashesAccepted: false,
    closureIncludes: [
      "runner-and-cli",
      "execution-contract-and-preflight",
      "transport-retry-rate-limit",
      "attempt-ledger-and-publication",
      "graphql-response-projectors",
      "census-core-and-prior-exclusion",
      "asset-lock-and-all-local-transitive-imports",
      "package-json-bun-lock-and-tsconfig",
    ],
    exactBindings: [
      "rf-freeze-commit-parent-tree-and-ancestry",
      "ordered-runtime-path-set",
      "bytes-and-sha256-per-path",
      "runtime-versions",
      "canonical-runtime-authorization-snapshot-and-sha256",
      "independent-review-request-dispatch-response-provenance",
      "rr-direct-child-only-five-review-artifacts",
      "ra-direct-child-only-exact-bridge-and-deterministic-receipt",
      "activation-commit-located-by-unique-receipt-addition-without-self-binding",
    ],
    commitSequence:
      "RF-final-runtime-and-manifest-then-RR-review-only-direct-child-then-RA-bridge-and-receipt-only-direct-child",
    reviewBoundary:
      "independent-task-observed-cryptographic-review-independence-false",
    status:
      "required-separate-freeze-review-and-activation-before-live-request",
  },
  rawAttemptLedger: {
    attemptCommitMarker:
      "attempt.json-create-only-written-last",
    attemptNumbers: "contiguous-starting-at-one",
    authorizationPersistence: "prohibited",
    hashChain:
      "attempt-commit-sha256-and-prior-logical-request-completion-sha256",
    logicalRequestIdentityFields: [
      "evaluationId",
      "executionContractSha256",
      "frozenInputClosureSha256",
      "runtimeAuthorizationSha256",
      "pass",
      "logicalRequestOrdinal",
      "operationName",
      "method",
      "endpoint",
      "redactedRequestHeadersSha256",
      "querySha256",
      "variablesSha256",
      "requestBodySha256",
      "redirect",
    ],
    logicalRequestCommitMarker:
      "logical-request-complete-ordinal.json-create-only-written-after-projected-result-and-successful-attempt-chain",
    projectedResultArtifact:
      "strict-operation-projection-from-raw-response-bound-by-logical-request-identity-and-replayed-into-pass-artifacts",
    persistenceStateMachine: {
      dispatchPrecondition:
        "request.json-and-request-body.raw-fsynced-then-request-committed.json-create-only-fsynced",
      interruptedBeforeResponse:
        "request-committed-without-response-started-consumes-attempt-and-may-retry",
      partialResponse:
        "response-started-without-valid-response-complete-is-terminal-and-network-redispatch-prohibited",
      responseComplete:
        "external-body-fsynced-then-response-complete.json-create-only-binds-bytes-and-sha256",
      responseHeaders:
        "sanitize-and-secret-scan-in-memory-then-response-started.json-create-only-fsynced-before-body-read",
      resume:
        "validate-every-marker-and-hash-damage-or-truncation-is-terminal",
      terminalAttempt:
        "retry-decision-fsynced-then-attempt.json-create-only-fsynced-last",
    },
    requiredArtifactsByOutcome: {
      always: [
        "request.json",
        "request-body.raw",
        "request-committed.json",
        "retry-decision.json",
        "attempt.json",
      ],
      httpResponse: [
        "response-started.json",
        "response-body.raw",
        "response-complete.json",
      ],
      transportFailure: ["transport-error.json"],
    },
    secretSafety: {
      beforeExternalPersistence:
        "scan-in-memory-exact-token-bytes-and-sanitize-error-object",
      durableRequestBuilderAcceptsAuthorization: false,
      leakDetected:
        "persist-only-locally-generated-terminal.json-outcome-failed-with-no-external-value",
      tokenLifetime:
        "requested-only-after-writer-lock-recovery-and-local-state-validation-used-for-network-or-secret-scan-zeroed-on-exit-never-returned-in-serializable-object",
      tokenProviderBeforeCorruptStateOrWriterConflict: false,
      terminalRecursiveScanRequired: true,
    },
    tokenAbsenceScanRequired: true,
    exactFilesystemClosureRequired: true,
  },
  schemaVersion: 1,
  transport: {
    classificationOrder: [
      "transport-outcome",
      "http-status",
      "required-response-headers",
      "response-json",
      "graphql-errors",
      "operation-schema-and-identity",
    ],
    conditionallyRetryableHttpStatuses: [{
      condition:
        "valid-retry-after-or-x-ratelimit-remaining-zero-or-case-insensitive-body-message-identifies-secondary-rate-limit-or-abuse-detection",
      status: 403,
    }],
    retryable403BodyMessageSubstringsAsciiFolded: [
      "secondary rate limit",
      "abuse detection mechanism",
    ],
    bodyReadFailurePolicy:
      "after-response-started-always-terminal-network-redispatch-prohibited",
    graphqlErrorPolicy: {
      consumePartialData: false,
      missingErrorType: "terminal",
      mixedTransientAndTerminalTypes: "terminal",
      retryOnlyWhenEveryErrorTypeIsFrozenTransient: true,
    },
    invalidJsonPolicy:
      "retain-raw-response-then-terminal-failure",
    maximumAttemptsPerLogicalRequest: 4,
    maximumPauseSegmentMilliseconds: 60_000,
    maximumRateLimitPauseMilliseconds: 3_700_000,
    maximumRetryAfterMilliseconds: 60_000,
    method: "POST",
    quotaStoppingAllowed: false,
    rateLimitPacing: {
      clock:
        "absolute-utc-not-before-resumable-across-processes",
      graphQlHeaderConsistency: {
        integerFieldsExact: [
          "limit",
          "remaining",
          "used",
        ],
        limitEqualsRemainingPlusUsed: true,
        resetAtExact:
          "graphql-resetAt-utc-second-equals-x-ratelimit-reset-unix-second",
      },
      headerResetPrecedence: true,
      maximumPauseExceeded: "terminal-no-clamp",
      minimumRemainingBeforePause: 50,
      pauseConsumesAttempt: false,
      pauseReceipt:
        "retry-not-before-is-in-the-durable-retry-decision-and-proactive-not-before-is-rederived-from-the-prior-successful-raw-response-headers",
      pauseReceiptPerSegmentRequired: false,
      heartbeatEvidenceClaimed: false,
      resetSafetyMilliseconds: 1_000,
    },
    redirect: "error",
    requestBody: {
      encoding: "utf-8",
      jsonPropertyOrder: [
        "operationName",
        "query",
        "variables",
      ],
      serialization: "JSON.stringify-no-trailing-newline",
      variablesPropertyOrder: {
        pullRequestPage: [
          "repositoryNodeId",
          "after",
        ],
        repositoryCount: ["query"],
        repositoryPage: ["query", "after"],
      },
    },
    requestTimeoutMilliseconds: 60_000,
    retryAfterMaximumExceeded: "terminal-no-clamp",
    retryAfterParsing: {
      allowedFormats: [
        "nonnegative-base10-integer-delta-seconds",
        "imf-fixdate-http-date",
      ],
      baseTime:
        "delta-seconds-use-local-received-at-http-date-uses-local-received-at-plus-server-target-minus-response-date",
      invalidPresentHeader: "terminal",
    },
    requiredSuccessResponseHeaders: {
      "content-type": "application-json-compatible",
      date: "valid-http-date",
      "x-github-request-id": "non-empty",
      "x-ratelimit-limit": "nonnegative-integer",
      "x-ratelimit-remaining": "nonnegative-integer",
      "x-ratelimit-reset":
        "nonnegative-unix-seconds",
      "x-ratelimit-resource": "graphql",
      "x-ratelimit-used": "nonnegative-integer",
    },
    retryDelay:
      "absolute-not-before-is-max-of-attempt-backoff-valid-retry-after-and-required-rate-reset",
    retryableServerErrorHeaders:
      "429-or-500-502-503-504-remain-retryable-with-backoff-when-rate-limit-headers-are-absent-invalid-present-or-partial-headers-are-terminal",
    rateLimitResetClockCorrection:
      "local-received-at-plus-max-zero-of-reset-epoch-minus-valid-response-date-plus-safety",
    rateLimitResetMode:
      "derived-from-status-error-types-and-remaining-never-caller-boolean",
    retryDelayBackoffMillisecondsByFailedAttempt: [
      1_000,
      2_000,
      4_000,
    ],
    retryableGraphqlErrorTypes: [
      "INTERNAL",
      "INTERNAL_SERVER_ERROR",
      "RATE_LIMITED",
      "SERVICE_UNAVAILABLE",
      "TIMEOUT",
    ],
    retryableHttpStatuses: [429, 500, 502, 503, 504],
    retryableTransportCodes: [
      "ABORT_ERR",
      "C6_REQUEST_TIMEOUT",
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
    retryableTransportErrorNames: ["AbortError"],
    selectedResponseHeaders: [
      "content-type",
      "date",
      "etag",
      "retry-after",
      "x-github-request-id",
      "x-ratelimit-limit",
      "x-ratelimit-remaining",
      "x-ratelimit-reset",
      "x-ratelimit-resource",
      "x-ratelimit-used",
    ],
    successfulHttpStatuses: [200],
  },
} as const;

export type C6SourceV3SimpleCensusExecutionContract =
  typeof CONTRACT;

export function buildC6SourceV3SimpleCensusExecutionContract():
  C6SourceV3SimpleCensusExecutionContract {
  return structuredClone(CONTRACT);
}

export function serializeC6SourceV3SimpleCensusExecutionContract(
  input: C6SourceV3SimpleCensusExecutionContract,
): string {
  assertExactContract(input);
  return `${JSON.stringify(input, null, 2)}\n`;
}

export function parseC6SourceV3SimpleCensusExecutionContract(
  input: string | Uint8Array,
): C6SourceV3SimpleCensusExecutionContract {
  const bytes = Buffer.from(input);
  let text: string;
  try {
    text = new TextDecoder("utf-8", {
      fatal: true,
    }).decode(bytes);
  } catch {
    throw new Error(
      "C6 source-v3-simple census contract is not UTF-8",
    );
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch {
    throw new Error(
      "C6 source-v3-simple census contract is not JSON",
    );
  }
  if (text !== `${JSON.stringify(raw, null, 2)}\n`) {
    throw new Error(
      "C6 source-v3-simple census contract is not canonical JSON",
    );
  }
  assertExactContract(raw);
  return structuredClone(CONTRACT);
}

function assertExactContract(
  input: unknown,
): asserts input is C6SourceV3SimpleCensusExecutionContract {
  if (!isDeepStrictEqual(input, CONTRACT)) {
    throw new Error(
      "C6 source-v3-simple census contract does not equal the executable contract",
    );
  }
}

function queryReference(
  operationName: string,
  query: string,
) {
  return {
    operationName,
    query,
    queryBytes: Buffer.byteLength(query),
    querySha256: sha256(query),
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
