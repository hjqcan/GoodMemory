import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "bun:test";

import {
  buildC6SourceV3SimpleCensusExecutionContract,
  C6_SOURCE_V3_SIMPLE_PULL_REQUEST_PAGE_QUERY,
  C6_SOURCE_V3_SIMPLE_REPOSITORY_COUNT_QUERY,
  C6_SOURCE_V3_SIMPLE_REPOSITORY_PAGE_QUERY,
  parseC6SourceV3SimpleCensusExecutionContract,
  serializeC6SourceV3SimpleCensusExecutionContract,
} from "../../scripts/codex-coding-effect/c6-source-v3-simple-census-contract";
import {
  deriveC6SourceV3SimpleRootShards,
} from "../../scripts/codex-coding-effect/c6-source-v3-simple-census-core";
import {
  parseC6Wave3SourceUniverseV2,
} from "../../scripts/codex-coding-effect/c6-wave3-source-universe-v2";

const SOURCE_ROOT = join(
  process.cwd(),
  "fixtures/codex-coding-effect/c6-source-pool",
);
const CONTRACT_PATH = join(
  SOURCE_ROOT,
  "provenance/source-v3-simple/" +
    "census-execution-contract-v1.json",
);

describe("C6 source-v3-simple executable census contract", () => {
  it("freezes three content-blind GraphQL operations and bounded transport semantics", () => {
    const contract =
      buildC6SourceV3SimpleCensusExecutionContract();

    expect(contract.boundary).toEqual({
      acceptedEpisodeCount: 0,
      candidateManifestFrozen: false,
      candidateSelectionPermitted: false,
      codexRunReady: false,
      liveCensusRequestCount: 0,
      liveCensusRequestPermitted: false,
      runtimeActivationFrozen: false,
      status:
        "executable-contract-only-no-live-census-evidence",
    });
    expect(contract.capture).toMatchObject({
      capturePasses: ["A", "B"],
      checkpointResume: {
        completedLogicalRequestReplayRequired: true,
        completedLogicalRequestResumeAction:
          "local-raw-response-replay-network-redispatch-prohibited",
        passCacheIsolationRequired: true,
        resumeAfterProcessInterruption: true,
        resumeAfterTerminalFailure: false,
        singleWriterRequired: true,
      },
      countTreeEqualityAcrossPassesRequired: false,
      passOrder: "A-complete-before-B-starts",
      normalizedRowEqualityAcrossPassesRequired: true,
      rootShardCount: 1_536,
    });
    expect(contract.transport).toMatchObject({
      maximumAttemptsPerLogicalRequest: 4,
      method: "POST",
      redirect: "error",
      requestTimeoutMilliseconds: 60_000,
      retryableHttpStatuses: [429, 500, 502, 503, 504],
    });
    expect(contract.rawAttemptLedger).toMatchObject({
      attemptCommitMarker:
        "attempt.json-create-only-written-last",
      logicalRequestCommitMarker:
        "logical-request-complete-ordinal.json-create-only-written-after-projected-result-and-successful-attempt-chain",
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
    });
    expect(contract.rawAttemptLedger).toMatchObject({
      persistenceStateMachine: {
        partialResponse:
          "response-started-without-valid-response-complete-is-terminal-and-network-redispatch-prohibited",
      },
      secretSafety: {
        terminalRecursiveScanRequired: true,
      },
    });
    expect(contract.publication).toMatchObject({
      authoritativeTerminalMarker:
        "terminal.json-create-only-fsync-written-last",
      receiptAndAssetLockAreEvidenceNotTerminalMarkers: true,
    });
    expect(contract.runtimeActivation).toMatchObject({
      activationBridgeRequired: true,
      activationStatementReviewRequired: true,
      activationReceiptExactRebuildRequired: true,
      callerOrRunnerSelfReportedHashesAccepted: false,
    });
    expect(contract.graphql).toMatchObject({
      globalNodeIdMode:
        "opaque-github-default-x-github-next-global-id-header-omitted",
      responseIdentity: {
        requestNodeIdEchoProhibited: true,
        returnedRepositoryIdMustEqualRequestedNodeId: true,
        returnedTypename: "Repository",
      },
    });
    expect(contract.graphql.operations).toEqual({
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
    });
    for (const query of [
      C6_SOURCE_V3_SIMPLE_PULL_REQUEST_PAGE_QUERY,
      C6_SOURCE_V3_SIMPLE_REPOSITORY_COUNT_QUERY,
      C6_SOURCE_V3_SIMPLE_REPOSITORY_PAGE_QUERY,
    ]) {
      expect(query).not.toMatch(
        /\b(body|diff|files|title|checkSuites|statusCheckRollup)\b/u,
      );
    }
    expect(
      C6_SOURCE_V3_SIMPLE_PULL_REQUEST_PAGE_QUERY,
    ).toContain("commits(first: 1)");
    expect(
      C6_SOURCE_V3_SIMPLE_PULL_REQUEST_PAGE_QUERY,
    ).toContain("reviews(first: 1)");
    expect(
      C6_SOURCE_V3_SIMPLE_PULL_REQUEST_PAGE_QUERY,
    ).toContain("reviewThreads(first: 1)");
  });

  it("round-trips canonically and binds the exact 1,536 frozen root shards", async () => {
    const contract =
      buildC6SourceV3SimpleCensusExecutionContract();
    const serialized =
      serializeC6SourceV3SimpleCensusExecutionContract(
        contract,
      );

    expect(
      parseC6SourceV3SimpleCensusExecutionContract(
        serialized,
      ),
    ).toEqual(contract);
    const sourceUniverse = parseC6Wave3SourceUniverseV2(
      await readFile(join(
        SOURCE_ROOT,
        "swe-bench-live-multilang-608f7ae9." +
          "wave3-source-universe-v2.json",
      )),
    );
    const shards =
      deriveC6SourceV3SimpleRootShards(sourceUniverse);
    expect(shards).toHaveLength(1_536);
    expect(shards[0]!.rootShardId).toBe("c:2016-01-01");
    expect(shards.at(-1)!.rootShardId).toBe(
      "ts:2023-12-15",
    );
  });

  it("matches the committed artifact and independent literal byte snapshots", async () => {
    const serialized =
      serializeC6SourceV3SimpleCensusExecutionContract(
        buildC6SourceV3SimpleCensusExecutionContract(),
      );
    const querySnapshots = [
      {
        bytes: 209,
        query: C6_SOURCE_V3_SIMPLE_REPOSITORY_COUNT_QUERY,
        sha256:
          "87a9543df92ee073b91e17246b36f475125817662fdea98c6a0fc8b55630ad23",
      },
      {
        bytes: 573,
        query: C6_SOURCE_V3_SIMPLE_REPOSITORY_PAGE_QUERY,
        sha256:
          "79587c627685fa8a1f7ed5048b8ba650525ecae2cd04e61807341e997be7310f",
      },
      {
        bytes: 907,
        query: C6_SOURCE_V3_SIMPLE_PULL_REQUEST_PAGE_QUERY,
        sha256:
          "d584e5c26ef00e7912e1e89472bcbd6b01faac03736e3574baad2980c576cc73",
      },
    ];
    for (const snapshot of querySnapshots) {
      expect(Buffer.byteLength(snapshot.query)).toBe(
        snapshot.bytes,
      );
      expect(sha256(snapshot.query)).toBe(snapshot.sha256);
    }
    expect(
      await readFile(CONTRACT_PATH, "utf8"),
    ).toBe(serialized);
    expect(Buffer.byteLength(serialized)).toBe(26_443);
    expect(sha256(serialized)).toBe(
      "a473d6668a46e4d3d23d855d42dffeb6026099cedf82af1351587fd9b04b76e8",
    );
  });
});

function queryReference(
  operationName: string,
  query: string,
) {
  return {
    operationName,
    query,
    queryBytes: Buffer.byteLength(query),
    querySha256: createHash("sha256")
      .update(query)
      .digest("hex"),
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
