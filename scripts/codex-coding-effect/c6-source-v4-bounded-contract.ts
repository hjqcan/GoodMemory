import { isDeepStrictEqual } from "node:util";

import type {
  C6SourceV3SimpleSplit,
} from "./c6-source-v3-simple-census-core";

export const C6_SOURCE_V4_BOUNDED_EVALUATION_ID =
  "goodmemory-c6-codex-coding-effect-source-v4-bounded-v1";
export const C6_SOURCE_V4_BOUNDED_LANGUAGE_SPLITS = [
  "c",
  "cpp",
  "go",
  "js",
  "rust",
  "java",
  "ts",
  "cs",
] as const satisfies readonly C6SourceV3SimpleSplit[];
export const C6_SOURCE_V4_BOUNDED_MAX_CANONICAL_ASSET_BYTES =
  6 * 1_024 ** 3;
export const C6_SOURCE_V4_BOUNDED_MAX_LIVE_LOGICAL_REQUEST_COUNT =
  100_000;
export const C6_SOURCE_V4_BOUNDED_REPOSITORIES_PER_LANGUAGE =
  2_048;
export const C6_SOURCE_V4_BOUNDED_REPOSITORY_COUNT =
  C6_SOURCE_V4_BOUNDED_LANGUAGE_SPLITS.length *
  C6_SOURCE_V4_BOUNDED_REPOSITORIES_PER_LANGUAGE;
export const C6_SOURCE_V4_BOUNDED_REPOSITORY_RANK_DOMAIN =
  "goodmemory:c6:source-v4-bounded:repository-rank:v1";
export const C6_SOURCE_V4_BOUNDED_RUNTIME_AUTHORIZATION_SHA256 =
  "351ff9ddbb55f95f039d21887b79f63fddf3db69b0cde58d1d0a8a968d609c68";
export const C6_SOURCE_V4_BOUNDED_V3_EVALUATION_ID =
  "goodmemory-c6-codex-coding-effect-source-v3-simple-v1";
export const C6_SOURCE_V4_BOUNDED_V3_EXECUTION_CONTRACT_SHA256 =
  "a473d6668a46e4d3d23d855d42dffeb6026099cedf82af1351587fd9b04b76e8";
export const C6_SOURCE_V4_BOUNDED_V3_FROZEN_INPUT_CLOSURE_SHA256 =
  "5e1225706f760312a5e6c2f7295376623a7566bcd59d9d7f128b371af9f4bbb7";
export const C6_SOURCE_V4_BOUNDED_V3_FROZEN_INPUT_CLOSURE_BYTES =
  622_330;
export const C6_SOURCE_V4_BOUNDED_V3_FRAME_SHA256 =
  "2fed192a34344b1cd83cf2e79cd70b25a7de827d347b4e17a88e1cd5e721fce2";
export const C6_SOURCE_V4_BOUNDED_V3_FRAME_REPOSITORY_COUNT =
  191_604;
export const C6_SOURCE_V4_BOUNDED_V3_OBSERVED_CLOSURE = {
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
} as const;

const CONTRACT = {
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
    languageSplits:
      C6_SOURCE_V4_BOUNDED_LANGUAGE_SPLITS,
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
    historicalV3ObservedClosure:
      C6_SOURCE_V4_BOUNDED_V3_OBSERVED_CLOSURE,
    pilotExclusion:
      "all-distinct-repository-node-ids-in-every-durable-v3-pull-request-page-request",
    pullRequestResponsesConsumedBySelector: false,
    repositoryPrefix: {
      acceptedAfterPriorExclusions:
        C6_SOURCE_V4_BOUNDED_V3_FRAME_REPOSITORY_COUNT,
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
      C6_SOURCE_V4_BOUNDED_V3_EVALUATION_ID,
    v3ExecutionContractSha256:
      C6_SOURCE_V4_BOUNDED_V3_EXECUTION_CONTRACT_SHA256,
    v3FrozenInputClosureSha256:
      C6_SOURCE_V4_BOUNDED_V3_FROZEN_INPUT_CLOSURE_SHA256,
    v3FrozenInputClosureBytes:
      C6_SOURCE_V4_BOUNDED_V3_FROZEN_INPUT_CLOSURE_BYTES,
    v3FrameSha256:
      C6_SOURCE_V4_BOUNDED_V3_FRAME_SHA256,
  },
} as const;

export type C6SourceV4BoundedContract = typeof CONTRACT;

export function buildC6SourceV4BoundedContract():
  C6SourceV4BoundedContract {
  return structuredClone(CONTRACT);
}

export function serializeC6SourceV4BoundedContract(
  input: C6SourceV4BoundedContract,
): string {
  assertExactContract(input);
  return `${JSON.stringify(input, null, 2)}\n`;
}

export function parseC6SourceV4BoundedContract(
  input: string | Uint8Array,
): C6SourceV4BoundedContract {
  let text: string;
  try {
    text = new TextDecoder("utf-8", {
      fatal: true,
    }).decode(Buffer.from(input));
  } catch {
    throw new Error(
      "C6 source-v4-bounded contract is not UTF-8",
    );
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch {
    throw new Error(
      "C6 source-v4-bounded contract is not JSON",
    );
  }
  if (text !== `${JSON.stringify(raw, null, 2)}\n`) {
    throw new Error(
      "C6 source-v4-bounded contract is not canonical JSON",
    );
  }
  assertExactContract(raw);
  return structuredClone(CONTRACT);
}

function assertExactContract(
  input: unknown,
): asserts input is C6SourceV4BoundedContract {
  if (!isDeepStrictEqual(input, CONTRACT)) {
    throw new Error(
      "C6 source-v4-bounded contract does not equal the executable contract",
    );
  }
}
