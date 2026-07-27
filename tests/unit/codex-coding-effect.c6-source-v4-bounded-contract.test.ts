import { describe, expect, it } from "bun:test";

import {
  buildC6SourceV4BoundedContract,
  C6_SOURCE_V4_BOUNDED_EVALUATION_ID,
  C6_SOURCE_V4_BOUNDED_LANGUAGE_SPLITS,
  C6_SOURCE_V4_BOUNDED_MAX_CANONICAL_ASSET_BYTES,
  C6_SOURCE_V4_BOUNDED_MAX_LIVE_LOGICAL_REQUEST_COUNT,
  C6_SOURCE_V4_BOUNDED_REPOSITORIES_PER_LANGUAGE,
  C6_SOURCE_V4_BOUNDED_REPOSITORY_COUNT,
  C6_SOURCE_V4_BOUNDED_REPOSITORY_RANK_DOMAIN,
  C6_SOURCE_V4_BOUNDED_RUNTIME_AUTHORIZATION_SHA256,
  parseC6SourceV4BoundedContract,
  serializeC6SourceV4BoundedContract,
} from "../../scripts/codex-coding-effect/c6-source-v4-bounded-contract";

describe("C6 source-v4-bounded contract", () => {
  it("freezes one outcome-blind bounded repository allocation", () => {
    const contract = buildC6SourceV4BoundedContract();

    expect(contract).toMatchObject({
      artifactKind: "c6-source-v4-bounded-contract",
      boundary: {
        acceptedEpisodeCount: 0,
        candidateManifestFrozen: false,
        codexRunReady: false,
        liveCaptureComplete: false,
        repositorySelectionComplete: false,
        status: "contract-only-no-selection-or-live-capture",
      },
      budgets: {
        maximumCanonicalAssetBytes:
          C6_SOURCE_V4_BOUNDED_MAX_CANONICAL_ASSET_BYTES,
        maximumLiveLogicalRequestCount:
          C6_SOURCE_V4_BOUNDED_MAX_LIVE_LOGICAL_REQUEST_COUNT,
        overflowPolicy:
          "fail-evaluation-id-no-partial-cohort-or-replacement",
      },
      evaluationId: C6_SOURCE_V4_BOUNDED_EVALUATION_ID,
      replay: {
        liveCaptureCount: 1,
        localReplayCount: 2,
        localReplayNetworkPermitted: false,
      },
      schemaVersion: 1,
      selection: {
        callerSeedAccepted: false,
        languageSplits: C6_SOURCE_V4_BOUNDED_LANGUAGE_SPLITS,
        replacementAllowed: false,
        repositoriesPerLanguage:
          C6_SOURCE_V4_BOUNDED_REPOSITORIES_PER_LANGUAGE,
        repositoryCount:
          C6_SOURCE_V4_BOUNDED_REPOSITORY_COUNT,
        repositoryRankDomain:
          C6_SOURCE_V4_BOUNDED_REPOSITORY_RANK_DOMAIN,
        runtimeAuthorizationSha256:
          C6_SOURCE_V4_BOUNDED_RUNTIME_AUTHORIZATION_SHA256,
      },
      sourceSnapshot: {
        historicalV3Disposition:
          "abandoned-infeasible-observation-not-promotable",
        historicalV3ObservedClosure: {
          committedAttemptCount: 9_277,
          committedRequestClosureSha256:
            "db3502478f76297eb63339d36b6f499fc84a8d07c0ba39513fda7630e05bed47",
          frameRepositoriesSha256:
            "2f1aae1d90d9766c2e299d5430c213490ed076462c9714ed8386708ea2bb0757",
          pilotPullRequestAttemptCount: 4_780,
          pilotRepositoryNodeIdCount: 3_578,
          pilotRepositoryNodeIdsSha256:
            "506193664a02ec3a0626f859a93198772ef5f50c1550736abd41c04ca797f041",
          prefixCompletionRootSha256:
            "e1d02cd17af4b2074959d9df76da2a1969efbf78b5a2108cd0251bce7be21a4b",
          repositoriesSha256:
            "4c8324ba4f905bf4aca0edd85ce2d810869f298a62ed1d43e5fe08cb7394e563",
          repositoryDecisionsSha256:
            "273e2aaa7b7d24eaa6c627aee552eff60bc60e457be3bc029e78a9cb40d98d5b",
          repositoryLeafClosuresSha256:
            "5dd1a2a4a0e412a9599e49dabc2699e31f40d34a8460d1a82a6dfd6d13b23f25",
          requestStructureSha256:
            "7e5f0555b55cdb40a7409091879dd01a435d35958849129e0789188ebc1564a5",
          status: "exact-observation-reuse-input-only",
        },
        pilotExclusion:
          "all-distinct-repository-node-ids-in-every-durable-v3-pull-request-page-request",
        pullRequestResponsesConsumedBySelector: false,
        repositoryPrefix: {
          acceptedAfterPriorExclusions: 191_604,
          countTreeCount: 1_536,
          logicalRequestCount: 4_497,
          repositoryCountRequestCount: 1_604,
          repositoryLeafClosureCount: 1_570,
          repositoryPageRequestCount: 2_893,
          repositoryRowCount: 191_612,
        },
        source:
          "source-v3-simple-pass-a-complete-repository-prefix",
        v3EvaluationId:
          "goodmemory-c6-codex-coding-effect-source-v3-simple-v1",
        v3ExecutionContractSha256:
          "a473d6668a46e4d3d23d855d42dffeb6026099cedf82af1351587fd9b04b76e8",
        v3FrozenInputClosureSha256:
          "5e1225706f760312a5e6c2f7295376623a7566bcd59d9d7f128b371af9f4bbb7",
        v3FrozenInputClosureBytes: 622_330,
        v3FrameSha256:
          "2fed192a34344b1cd83cf2e79cd70b25a7de827d347b4e17a88e1cd5e721fce2",
      },
    });
    expect(C6_SOURCE_V4_BOUNDED_LANGUAGE_SPLITS).toEqual([
      "c",
      "cpp",
      "go",
      "js",
      "rust",
      "java",
      "ts",
      "cs",
    ]);
    expect(C6_SOURCE_V4_BOUNDED_REPOSITORY_COUNT).toBe(
      8 * 2_048,
    );
    expect(C6_SOURCE_V4_BOUNDED_MAX_CANONICAL_ASSET_BYTES)
      .toBe(6 * 1_024 ** 3);
  });

  it("round-trips only the exact canonical contract", () => {
    const contract = buildC6SourceV4BoundedContract();
    const serialized =
      serializeC6SourceV4BoundedContract(contract);

    expect(parseC6SourceV4BoundedContract(serialized))
      .toEqual(contract);
    expect(() =>
      parseC6SourceV4BoundedContract(JSON.stringify(contract))
    ).toThrow("canonical JSON");
    expect(() =>
      parseC6SourceV4BoundedContract(`${JSON.stringify({
        ...contract,
        selection: {
          ...contract.selection,
          replacementAllowed: true,
        },
      }, null, 2)}\n`)
    ).toThrow("executable contract");
  });
});
