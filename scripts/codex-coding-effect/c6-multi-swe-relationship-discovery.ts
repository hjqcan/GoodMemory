import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";

import { z } from "zod";

import {
  assertC6SourcePoolArtifact,
} from "./c6-source-pool";

const commitSchema = z.string().regex(/^[a-f0-9]{40}$/u);
const resolvedIssueSchema = z.object({
  body: z.string(),
  number: z.number().int().positive(),
  title: z.string(),
}).strict();
const sourceRowSchema = z.object({
  base: z.object({
    label: z.string(),
    ref: z.string(),
    sha: commitSchema,
  }).strict(),
  body: z.string().nullable(),
  fix_patch: z.string(),
  hints: z.string().optional(),
  instance_id: z.string().optional(),
  number: z.number().int().positive(),
  org: z.string().min(1),
  repo: z.string().min(1),
  resolved_issues: z.array(resolvedIssueSchema).min(1),
  state: z.literal("closed"),
  test_patch: z.string(),
  title: z.string(),
}).passthrough();
const treeReceiptSchema = z.array(z.object({
  oid: commitSchema,
  path: z.string(),
  size: z.number().int().nonnegative(),
  type: z.enum(["directory", "file"]),
}).passthrough());
const pullReceiptSchema = z.object({
  base: z.object({
    sha: commitSchema,
  }).passthrough(),
  body: z.string(),
  created_at: z.string().datetime(),
  html_url: z.string().url(),
  merge_commit_sha: commitSchema,
  merged: z.literal(true),
  merged_at: z.string().datetime(),
  number: z.number().int().positive(),
  state: z.literal("closed"),
  title: z.string(),
}).passthrough();
const issueReceiptSchema = z.object({
  body: z.string(),
  created_at: z.string().datetime(),
  html_url: z.string().url(),
  number: z.number().int().positive(),
  state: z.literal("closed"),
  title: z.string(),
}).passthrough();
const compareReceiptSchema = z.object({
  ahead_by: z.number().int().positive(),
  base_commit: z.object({
    sha: commitSchema,
  }).passthrough(),
  behind_by: z.literal(0),
  html_url: z.string().url(),
  merge_base_commit: z.object({
    sha: commitSchema,
  }).passthrough(),
  status: z.literal("ahead"),
  total_commits: z.number().int().positive(),
}).passthrough();

export const C6_MULTI_SWE_RELATIONSHIP_SOURCE = {
  datasetCard: {
    bytes: 11_283,
    gitBlobOid: "5f9e55e14d014e4ce253d49e7b2fea974744bccd",
    path: "README.md",
    sha256:
      "26638a5dc8d8c10e04de4578c904beecefb584d44e618cfe2c33fd350ca9810d",
  },
  datasetId: "ByteDance-Seed/Multi-SWE-bench",
  revision: "56ff018c04a38e27ada1e9d0a6d5839a51f88f0d",
  selection: {
    maximumSourceFileBytes: 1_000_000,
    pathSuffix: "_dataset.jsonl",
    policy: "all-revision-tree-files-at-or-below-byte-threshold-v1",
  },
  treeReceipt: {
    bytes: 38_112,
    captureForm:
      "locally-merged-two-page-body-no-response-header-authentication",
    entryCount: 59,
    matchingPathEntries: 47,
    paginationAuthenticationVerified: false,
    sha256:
      "69b4797acb34252fcc726daf6d3e0480577017d9b8faf25b7dbd53f7f82e07b6",
  },
} as const;

export const C6_MULTI_SWE_RELATIONSHIP_SOURCE_FILES = [
  sourceFile("c/facebook__zstd_dataset.jsonl", 677_646, "778933d67c8a091627d9fca7003d4042c137e110", "689b60bfbe9b1c9558ac345468b54c40fbb30748069caa1a92ca747773610e7b"),
  sourceFile("c/jqlang__jq_dataset.jsonl", 148_809, "e5648629616c7ff5b319954202aa1db6d89fd7c5", "8be07a2281fa766b310037db9bc2abc3f8c7150c3d471ea56a964921d5609e8f"),
  sourceFile("cpp/catchorg__Catch2_dataset.jsonl", 698_675, "8145e4cc6eff4dad5db9530814b62855962d6d1d", "a2fad917a116bca66692129bfa91bbf6d1e8563dd0bbd7fd82732d6a82f3048f"),
  sourceFile("cpp/fmtlib__fmt_dataset.jsonl", 375_788, "b660726d4edf6bec9d6b9e9ef598852c42df0ca4", "7d060ca46ba6343373aa68ced7fcca70e2ce0addac7ec610c47d2bbfcfed6762"),
  sourceFile("cpp/yhirose__cpp-httplib_dataset.jsonl", 60_772, "6b2dd554bdf594e38f878f0195c491adbe25649f", "3551b73936dd788873b7727649ca94c102678d5541f1eb0a14d27730799d6143"),
  sourceFile("go/grpc__grpc-go_dataset.jsonl", 864_342, "8120a559a1d9050b939cab94aa7bfce2a52179ee", "cd8984b884679c44f71c2af958d74c692f4a1feb6ec68e74b0ddc312526b4e13"),
  sourceFile("java/apache__dubbo_dataset.jsonl", 376_821, "ea813f36abeaf1e8fc99490ef0986c3cbee7a974", "a12c85a7232a449cfd4f9ef93bb475a3b2193c2c0d53cd0802942259d0d3ccd6"),
  sourceFile("java/fasterxml__jackson-core_dataset.jsonl", 967_999, "7a37489c45c90c7450afb7f1effc80ec111ce5c6", "21f1f1350dcaf687840f6cf0dce4198c7958cc66cd6ab6722a0dd3a18860147e"),
  sourceFile("java/fasterxml__jackson-dataformat-xml_dataset.jsonl", 279_932, "68f4528317296eee59a5d0d75a859bcc54a0a48b", "a5690cb59b2c8d244139bae8a6f99937df9aebc320bbaf9cbf8505f02c025ea9"),
  sourceFile("java/google__gson_dataset.jsonl", 122_857, "8683ce6d91b7d916f799bfe1d9a4a40d19f31970", "fc4e6547d8ccd761719c68dc09053b9e10ba9aca8db97b4b565dbf88c83473f6"),
  sourceFile("java/googlecontainertools__jib_dataset.jsonl", 135_084, "cc01812133fad16d7bf6a137cd493a6bebc43681", "ca2b733714ff2886cc3a47df8ff50cadf74bc7afcf9bfce16ec96c666e9362f3"),
  sourceFile("java/mockito__mockito_dataset.jsonl", 255_347, "3e7c689c8192b194a264cc3bb554d9716623a88a", "ba9658d470f9365c764342cb41af899db0ab616c18887498e8db038bea7669bf"),
  sourceFile("js/Kong__insomnia_dataset.jsonl", 64_765, "3d123cdf33c3b5afc7b284a6226d0982847a2055", "a12c192097969d351c1081cfb5728680864b0c7d8f3bf2a9e90c2f0a60c8836f"),
  sourceFile("js/axios__axios_dataset.jsonl", 151_870, "d19999a3b6070d4c6b3950c122e458d844d265fa", "64217dadc28cf21cc3b4d0777eef8207f957a5f0edfc7de43e13bee680d76c64"),
  sourceFile("js/expressjs__express_dataset.jsonl", 995_502, "a5ebbb9a124738b0fb3c21d6e04c839cdce6c017", "b409503d27b227982c8063b3735463899b7134afd7c3b712d75e04d50c442913"),
  sourceFile("js/iamkun__dayjs_dataset.jsonl", 954_834, "ed49ace984f9c2c94e2f1328007c0d290512aa1e", "2385ad31059b7448d35aa2dba38c03c2cae9ed09f6e794d299649a22bef71c71"),
  sourceFile("kotlin/GradleUp__shadow_dataset.jsonl", 34_371, "8962dbc83fabe0856fce801d50a90668c1a09808", "0b4401c7d5b86a05538085b910ce862dfad978363af34fb09be901df5d6f0c3e"),
  sourceFile("kotlin/square__okhttp_dataset.jsonl", 816_039, "fa9932a7d90a242dc245ab814586ed7f8041e344", "068cdcf7946a147098518383cb9c97557e35e63a8bdd9330d0196bdb97ddc01d"),
  sourceFile("rust/rayon-rs__rayon_dataset.jsonl", 163_860, "fcce0ba5772c34e91fc65f7d6a37650557132627", "03dbe8d22c1b61eddf3b0f729426a1f9579e9efd80bfbecf6dd68f802c2b589d"),
  sourceFile("rust/serde-rs__serde_dataset.jsonl", 138_138, "f59fbbee8d1b58f22b82541f71921c85719507bf", "164ea8543f438b964c40e5e1cd09f5b82dc917aa5e4348b644d4b5e17e81142f"),
  sourceFile("rust/sharkdp__bat_dataset.jsonl", 610_685, "5355f5b1fbc743a14ffb4914aa4743cd9e644c10", "5d2a10fd1adef574b8a21c41d2f1b7bcd904e40c7c0c563c3b92efea7b576348"),
  sourceFile("rust/sharkdp__fd_dataset.jsonl", 648_192, "08e3e4cec4c2084554f2a76c4b36df41282d1e9c", "3e2b3862f7b17a39aa27bf03458d27204af0a5e72c71f1e6e19b2bdd52ef45ea"),
  sourceFile("rust/tokio-rs__bytes_dataset.jsonl", 143_947, "58dffb169d2cc61a71488bc27847af58c3033036", "9516b916eb11556a27a62d79296829c821b19873fea0a9f8f02d52c043f855a0"),
  sourceFile("ts/darkreader__darkreader_dataset.jsonl", 38_899, "5372fa046d1400b7a03008f3c2f2a684152ec9a7", "350ddd200d2774be699d72062b356a9ceecdf38c3f9ab72e1ece3887626a93a8"),
] as const;

const EXISTING_SOURCE_POOL_PIN = {
  bytes: 333_573,
  sha256:
    "15cf8d4a0a7ab0e3e7dee32555f266f1bccfd47ace7f5b31d8e474e064c37cf5",
  sourceId: "swe-bench-multilingual-e5c585e",
} as const;

const BAT_RECEIPT_PINS = {
  compare2896To3189: {
    bytes: 12_033,
    request:
      "GET /repos/sharkdp/bat/compare/8a4701f93ff296b80b813bde07002796f9ff2f1d...f8c6e90647221d8a5142bc50c7ea972562f6cdcd?per_page=1&page=2",
    sha256:
      "2b2cf1b0d81861a5bed63d6b858da115e6c55c1075224742fef64d14a4cd267f",
  },
  compare3075To2896: {
    bytes: 14_720,
    request:
      "GET /repos/sharkdp/bat/compare/eca6b8a3768ec3931a41330c42b138107b1786b5...d00e05643ff6ef00de1aa8da90c869db993c93e2?per_page=1&page=2",
    sha256:
      "de5dba605710ff773d8cd83cbf70aee7595cde6fa638eb9d31cc245d1d98ff49",
  },
  issue1746: {
    bytes: 11_307,
    sha256:
      "3ed8014c2d2a11838831f5125ddc611770f7c3e54a16ce0bc984e7e4fbb2ffe0",
  },
  issue3073: {
    bytes: 4_513,
    sha256:
      "3f98a9d36612c9e33d6f8ff2c460d0b3f9c6f7b570e31330f45f606079ed5f24",
  },
  issue3188: {
    bytes: 6_596,
    sha256:
      "01cae0c9d99ced87ec9b6c60b3c6389f9dac79179f3d822321bd87c25eeae705",
  },
  pull2896: {
    bytes: 16_466,
    sha256:
      "f9efb007b0bb7ef891c0c46539d0cd2295b86c8fce57f5bb2aacd3202d3dc201",
  },
  pull3075: {
    bytes: 17_162,
    sha256:
      "5dc31a2b621ad7873afbb0d498ac3a2d4ca79ebb34062c2c53dea867cc7eddd0",
  },
  pull3189: {
    bytes: 18_282,
    sha256:
      "b2cf484e034f7051153774be6c972077a4c102b968155214f3eb024afdb20aa4",
  },
} as const;

const BAT_STAGE_ISSUES = new Map([
  [3075, 3073],
  [2896, 1746],
  [3189, 3188],
]);
const BAT_MERGE_ORDER = [3075, 2896, 3189] as const;
const BAT_ORIGINAL_REQUEST_ORDER = [2896, 3075, 3189] as const;
const REQUIRED_NEXT_EVIDENCE = [
  "original-request-chronology-conflict-eligibility-decision",
  "independent-upstream-capture-authentication",
  "gold-blind-independent-semantic-dependency-review",
  "independent-semantic-duplicate-review",
  "original-request-construction-review",
  "repository-commit-reachability-and-tree",
  "historical-project-license-review",
  "base-gold-protection-linux-replay",
  "cross-stage-gold-and-leakage-review",
  "deterministic-prehistory-materialization",
  "full-source-population-selection-closure",
] as const;

export interface C6MultiSWERelationshipRow {
  pullBody: string | null;
  repository: string;
  resolvedIssues: Array<{
    body: string;
    number: number;
    title: string;
  }>;
  sourceUnitId: string;
  upstreamPullNumber: number;
}

export interface C6MultiSWEReferenceSignal {
  evidenceField: "pull-body";
  fromPullNumber: number;
  fromSourceUnitId: string;
  matchedSyntax:
    | "bare-hash"
    | "qualified-issue-hash"
    | "qualified-pull-hash";
  occurrences: number;
  repository: string;
  targetKinds: Array<"candidate-issue" | "candidate-pull">;
  targetNumber: number;
  targetSourceUnitIds: string[];
}

export interface C6MultiSWECandidateTriple {
  candidateId: string;
  laterPullNumber: number;
  laterSourceUnitId: string;
  memberPullNumbers: [number, number, number];
  orderedPullNumbers: null;
  priorPullNumbers: [number, number];
  priorSourceUnitIds: [string, string];
  repository: string;
  status: "relationship-candidate-ancestry-and-review-required";
}

export interface C6MultiSWERelationshipSignals {
  candidateTriples: C6MultiSWECandidateTriple[];
  referenceSignals: C6MultiSWEReferenceSignal[];
  sharedResolvedIssueGroups: Array<{
    issueNumber: number;
    memberPullNumbers: number[];
    memberSourceUnitIds: string[];
    repository: string;
    status: "parallel-or-superseding-attempts-not-dependency-proof";
  }>;
}

interface C6ParsedMultiSWERow extends C6MultiSWERelationshipRow {
  baseCommit: string;
  evaluatorOnlySha256: string;
  fixPatchSha256: string;
  lineNumber: number;
  pullBodySha256: string;
  pullTitle: string;
  pullTitleSha256: string;
  rawRecordBytes: number;
  rawRecordSha256: string;
  sourcePath: string;
  testPatchSha256: string;
}

interface C6ExistingSourcePool {
  artifactSha256: string;
  rows: Array<{
    baseCommit: string;
    repository: string;
    version: string;
  }>;
  sourceId: string;
}

export interface C6MultiSWERelationshipDiscoveryInput {
  compare2896To3189: string;
  compare3075To2896: string;
  existingSourcePool: string;
  issue1746: string;
  issue3073: string;
  issue3188: string;
  pull2896: string;
  pull3075: string;
  pull3189: string;
  readmeFile: string;
  sourceRoot: string;
  treeReceipt: string;
}

export interface C6MultiSWERelationshipDiscoverySnapshot {
  boundary: {
    acceptedEpisodeCount: 0;
    candidateManifestFrozen: false;
    fullMultiSWESourcePopulationCovered: false;
    status: "relationship-discovery-only-independent-review-required";
  };
  counts: {
    candidateTriples: number;
    crossSourceAliases: number;
    newCanonicalUpstreamTasks: number;
    observedRows: number;
    referenceSignals: number;
    repositories: number;
    sharedResolvedIssueGroups: number;
    sourceFiles: number;
  };
  crossSourceAliases: Array<{
    canonicalUpstreamIdentity: string;
    existingBaseCommit: string;
    existingSourceId: string;
    sameBaseCommit: boolean;
    sourceBaseCommit: string;
  }>;
  discoveryPolicy: {
    candidateDoesNotFreezeAgentVisiblePrompt: true;
    issueBodyCanPromoteCandidate: false;
    mergeOrderDoesNotEstablishOriginalRequestChronology: true;
    pullBodyEvidenceVisibility: "evaluator-only-not-agent-request";
    qualifiedPullReference:
      "pull-body-pr-or-pull-request-prefix-followed-by-hash-number";
    strongCandidateRule:
      "one-later-pull-body-qualified-references-two-source-pulls";
  };
  discoverySignals: C6MultiSWERelationshipSignals;
  evidenceBoundary: {
    githubCaptureStatus:
      "local-public-api-responses-hash-bound-no-platform-signature";
    independentCaptureAuthenticationVerified: false;
    independentSemanticReviewVerified: false;
    localMergeOrderAndAncestryVerifiedCandidates: number;
    linuxReplayVerified: false;
    orderedOriginalRequestChronologyVerifiedCandidates: number;
    treeCaptureStatus:
      "local-merged-body-no-response-header-or-platform-signature";
  };
  existingSourcePool: {
    artifactSha256: string;
    sourceId: string;
  };
  locallyVerifiedCandidates: C6LocallyVerifiedCandidate[];
  populationSha256: string;
  requiredNextEvidence: typeof REQUIRED_NEXT_EVIDENCE;
  schemaVersion: 2;
  source: typeof C6_MULTI_SWE_RELATIONSHIP_SOURCE;
  sourceFiles: Array<
    (typeof C6_MULTI_SWE_RELATIONSHIP_SOURCE_FILES)[number] & {
      observedRows: number;
    }
  >;
}

interface C6LocallyVerifiedCandidate {
  ancestryEdges: Array<{
    aheadBy: number;
    compareReceiptSha256: string;
    fromMergeCommit: string;
    fromPullNumber: number;
    request: string;
    toBaseCommit: string;
    toPullNumber: number;
  }>;
  candidateId: string;
  blockers: typeof REQUIRED_NEXT_EVIDENCE;
  episodeEligibility:
    "blocked-pending-preregistered-merge-order-regression-policy";
  mergeChronologyVerified: true;
  mergeOrderPullNumbers: typeof BAT_MERGE_ORDER;
  originalRequestChronology: {
    issueCreatedOrderPullNumbers: typeof BAT_ORIGINAL_REQUEST_ORDER;
    pullCreatedOrderPullNumbers: typeof BAT_ORIGINAL_REQUEST_ORDER;
    requestChronologyVerified: false;
    status: "conflicts-with-merge-order";
  };
  relationshipKind: "merge-order-regression";
  semanticDependency: {
    independentReviewReceiptSha256: null;
    independentReviewVerified: false;
    status:
      "explicit-regression-narrative-detected-independent-review-required";
    thirdStagePullBodySha256: string;
    thirdStageQualifiedPullReferences: [2896, 3075];
    thirdStageQualifiedIssueReferences: [3073];
  };
  stages: Array<{
    baseCommit: string;
    issueCreatedAt: string;
    issueReceiptSha256: string;
    mergeCommit: string;
    mergedAt: string;
    originalIssueNumber: number;
    pullCreatedAt: string;
    pullNumber: number;
    pullReceiptSha256: string;
    sourceRecordMatchesIssueReceipt: true;
    sourceRecordMatchesPullReceipt: true;
    sourceUnitId: string;
  }>;
  status:
    "merge-order-regression-candidate-original-request-chronology-conflict";
}

export function discoverC6MultiSWERelationshipSignals(
  rows: readonly C6MultiSWERelationshipRow[],
): C6MultiSWERelationshipSignals {
  const rowsByRepository = new Map<string, C6MultiSWERelationshipRow[]>();
  const seenSourceUnitIds = new Set<string>();
  for (const row of rows) {
    if (seenSourceUnitIds.has(row.sourceUnitId)) {
      throw new Error(
        `C6 Multi-SWE relationship discovery contains duplicate source unit ${row.sourceUnitId}`,
      );
    }
    seenSourceUnitIds.add(row.sourceUnitId);
    const repository = normalizeRepository(row.repository);
    const repositoryRows = rowsByRepository.get(repository) ?? [];
    repositoryRows.push({
      ...row,
      repository,
    });
    rowsByRepository.set(repository, repositoryRows);
  }

  const referenceSignals: C6MultiSWEReferenceSignal[] = [];
  const sharedResolvedIssueGroups:
    C6MultiSWERelationshipSignals["sharedResolvedIssueGroups"] = [];
  for (const [repository, repositoryRows] of [...rowsByRepository.entries()]
    .sort(([left], [right]) => left.localeCompare(right))) {
    const rowsByPull = new Map<number, C6MultiSWERelationshipRow>();
    const rowsByIssue = new Map<number, C6MultiSWERelationshipRow[]>();
    for (const row of repositoryRows) {
      if (rowsByPull.has(row.upstreamPullNumber)) {
        throw new Error(
          `C6 Multi-SWE relationship discovery contains duplicate pull ${repository}#${row.upstreamPullNumber}`,
        );
      }
      rowsByPull.set(row.upstreamPullNumber, row);
      for (const issue of row.resolvedIssues) {
        const issueRows = rowsByIssue.get(issue.number) ?? [];
        issueRows.push(row);
        rowsByIssue.set(issue.number, issueRows);
      }
    }
    for (const [issueNumber, issueRows] of rowsByIssue) {
      const uniqueRows = uniqueRowsByPull(issueRows);
      if (uniqueRows.length < 2) {
        continue;
      }
      sharedResolvedIssueGroups.push({
        issueNumber,
        memberPullNumbers: uniqueRows.map((row) => row.upstreamPullNumber),
        memberSourceUnitIds: uniqueRows.map((row) => row.sourceUnitId),
        repository,
        status: "parallel-or-superseding-attempts-not-dependency-proof",
      });
    }
    for (const row of repositoryRows) {
      const ownIssueNumbers = new Set(
        row.resolvedIssues.map((issue) => issue.number),
      );
      const accumulated = new Map<string, C6MultiSWEReferenceSignal>();
      for (const match of (row.pullBody ?? "").matchAll(/#(\d+)/gu)) {
        const targetNumber = Number(match[1]);
        if (
          targetNumber === row.upstreamPullNumber ||
          ownIssueNumbers.has(targetNumber)
        ) {
          continue;
        }
        const targetKinds: C6MultiSWEReferenceSignal["targetKinds"] = [];
        const targetSourceUnitIds: string[] = [];
        const pullRow = rowsByPull.get(targetNumber);
        if (pullRow !== undefined) {
          targetKinds.push("candidate-pull");
          targetSourceUnitIds.push(pullRow.sourceUnitId);
        }
        const issueRows = rowsByIssue.get(targetNumber);
        if (issueRows !== undefined) {
          targetKinds.push("candidate-issue");
          targetSourceUnitIds.push(
            ...issueRows.map((issueRow) => issueRow.sourceUnitId),
          );
        }
        if (targetKinds.length === 0) {
          continue;
        }
        const matchedSyntax = classifyHashReference(
          row.pullBody ?? "",
          match.index,
        );
        const uniqueTargetSourceUnitIds = [...new Set(targetSourceUnitIds)]
          .sort();
        const key = [
          row.sourceUnitId,
          matchedSyntax,
          targetNumber,
          targetKinds.join(","),
        ].join(":");
        const previous = accumulated.get(key);
        accumulated.set(key, {
          evidenceField: "pull-body",
          fromPullNumber: row.upstreamPullNumber,
          fromSourceUnitId: row.sourceUnitId,
          matchedSyntax,
          occurrences: (previous?.occurrences ?? 0) + 1,
          repository,
          targetKinds,
          targetNumber,
          targetSourceUnitIds: uniqueTargetSourceUnitIds,
        });
      }
      referenceSignals.push(...accumulated.values());
    }
  }

  referenceSignals.sort(compareReferenceSignals);
  sharedResolvedIssueGroups.sort((left, right) =>
    left.repository.localeCompare(right.repository) ||
    left.issueNumber - right.issueNumber
  );
  const candidateTriples = buildCandidateTriples(referenceSignals);
  return {
    candidateTriples,
    referenceSignals,
    sharedResolvedIssueGroups,
  };
}

export async function loadC6MultiSWERelationshipDiscovery(
  input: C6MultiSWERelationshipDiscoveryInput,
): Promise<C6MultiSWERelationshipDiscoverySnapshot> {
  const [
    treeBytes,
    readmeBytes,
    existingSourcePoolBytes,
    ...sourceBytes
  ] = await Promise.all([
    readFile(input.treeReceipt),
    readFile(input.readmeFile),
    readFile(input.existingSourcePool),
    ...C6_MULTI_SWE_RELATIONSHIP_SOURCE_FILES.map((source) =>
      readFile(join(input.sourceRoot, source.path))
    ),
  ]);
  assertC6SourcePoolArtifact(
    treeBytes,
    C6_MULTI_SWE_RELATIONSHIP_SOURCE.treeReceipt,
    "C6 Multi-SWE relationship tree receipt",
  );
  assertC6SourcePoolArtifact(
    readmeBytes,
    C6_MULTI_SWE_RELATIONSHIP_SOURCE.datasetCard,
    "C6 Multi-SWE relationship dataset card",
  );
  assertC6SourcePoolArtifact(
    existingSourcePoolBytes,
    EXISTING_SOURCE_POOL_PIN,
    "C6 existing SWE-bench Multilingual source pool",
  );
  validateSelectedSourceFiles(treeBytes);
  const parsedSourceFiles = C6_MULTI_SWE_RELATIONSHIP_SOURCE_FILES.map(
    (source, index) => {
      const bytes = sourceBytes[index]!;
      assertC6SourcePoolArtifact(
        bytes,
        source,
        `C6 Multi-SWE relationship source ${source.path}`,
      );
      return {
        rows: parseSourceRows(source.path, bytes),
        source,
      };
    },
  );
  const rows = parsedSourceFiles.flatMap((source) => source.rows);
  if (rows.length !== 261) {
    throw new Error(
      `C6 Multi-SWE relationship discovery requires 261 rows; received ${rows.length}`,
    );
  }
  const existingSourcePool = parseExistingSourcePool(
    existingSourcePoolBytes,
  );
  const crossSourceAliases = buildCrossSourceAliases(
    rows,
    existingSourcePool,
  );
  const discoverySignals = discoverC6MultiSWERelationshipSignals(rows);
  const batCandidate = discoverySignals.candidateTriples.find((candidate) =>
    candidate.candidateId === "sharkdp-bat-prs-2896-3075-3189"
  );
  if (
    discoverySignals.candidateTriples.length !== 1 ||
    batCandidate === undefined
  ) {
    throw new Error(
      "C6 Multi-SWE relationship discovery expected exactly the bat 2896/3075/3189 candidate",
    );
  }
  const locallyVerifiedCandidate = await loadBatCandidateEvidence(
    input,
    rows,
    batCandidate,
  );
  const repositoryCount = new Set(rows.map((row) => row.repository)).size;
  if (repositoryCount !== 24) {
    throw new Error(
      `C6 Multi-SWE relationship discovery requires 24 repositories; received ${repositoryCount}`,
    );
  }
  return {
    boundary: {
      acceptedEpisodeCount: 0,
      candidateManifestFrozen: false,
      fullMultiSWESourcePopulationCovered: false,
      status: "relationship-discovery-only-independent-review-required",
    },
    counts: {
      candidateTriples: discoverySignals.candidateTriples.length,
      crossSourceAliases: crossSourceAliases.length,
      newCanonicalUpstreamTasks: rows.length - crossSourceAliases.length,
      observedRows: rows.length,
      referenceSignals: discoverySignals.referenceSignals.length,
      repositories: repositoryCount,
      sharedResolvedIssueGroups:
        discoverySignals.sharedResolvedIssueGroups.length,
      sourceFiles: parsedSourceFiles.length,
    },
    crossSourceAliases,
    discoveryPolicy: {
      candidateDoesNotFreezeAgentVisiblePrompt: true,
      issueBodyCanPromoteCandidate: false,
      mergeOrderDoesNotEstablishOriginalRequestChronology: true,
      pullBodyEvidenceVisibility: "evaluator-only-not-agent-request",
      qualifiedPullReference:
        "pull-body-pr-or-pull-request-prefix-followed-by-hash-number",
      strongCandidateRule:
        "one-later-pull-body-qualified-references-two-source-pulls",
    },
    discoverySignals,
    evidenceBoundary: {
      githubCaptureStatus:
        "local-public-api-responses-hash-bound-no-platform-signature",
      independentCaptureAuthenticationVerified: false,
      independentSemanticReviewVerified: false,
      localMergeOrderAndAncestryVerifiedCandidates: 1,
      linuxReplayVerified: false,
      orderedOriginalRequestChronologyVerifiedCandidates: 0,
      treeCaptureStatus:
        "local-merged-body-no-response-header-or-platform-signature",
    },
    existingSourcePool: {
      artifactSha256: existingSourcePool.artifactSha256,
      sourceId: existingSourcePool.sourceId,
    },
    locallyVerifiedCandidates: [locallyVerifiedCandidate],
    populationSha256: buildPopulationSha256(rows),
    requiredNextEvidence: REQUIRED_NEXT_EVIDENCE,
    schemaVersion: 2,
    source: C6_MULTI_SWE_RELATIONSHIP_SOURCE,
    sourceFiles: parsedSourceFiles.map(({ rows: sourceRows, source }) => ({
      ...source,
      observedRows: sourceRows.length,
    })),
  };
}

export function serializeC6MultiSWERelationshipDiscovery(
  snapshot: C6MultiSWERelationshipDiscoverySnapshot,
): string {
  return `${JSON.stringify(snapshot, null, 2)}\n`;
}

function sourceFile(
  path: string,
  bytes: number,
  gitBlobOid: string,
  sha256: string,
) {
  return {
    bytes,
    gitBlobOid,
    path,
    sha256,
    url:
      `https://huggingface.co/datasets/ByteDance-Seed/Multi-SWE-bench/resolve/${C6_MULTI_SWE_RELATIONSHIP_SOURCE.revision}/${path}`,
  };
}

function normalizeRepository(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/u.test(normalized)) {
    throw new Error(`invalid C6 Multi-SWE repository ${value}`);
  }
  return normalized;
}

function uniqueRowsByPull(
  rows: readonly C6MultiSWERelationshipRow[],
): C6MultiSWERelationshipRow[] {
  return [...new Map(
    rows.map((row) => [row.upstreamPullNumber, row]),
  ).values()].sort((left, right) =>
    left.upstreamPullNumber - right.upstreamPullNumber
  );
}

function classifyHashReference(
  text: string,
  matchIndex: number,
): C6MultiSWEReferenceSignal["matchedSyntax"] {
  const prefix = text.slice(Math.max(0, matchIndex - 40), matchIndex);
  if (/\b(?:PR|pull request)\s*$/iu.test(prefix)) {
    return "qualified-pull-hash";
  }
  if (/\bissue\s*$/iu.test(prefix)) {
    return "qualified-issue-hash";
  }
  return "bare-hash";
}

function compareReferenceSignals(
  left: C6MultiSWEReferenceSignal,
  right: C6MultiSWEReferenceSignal,
): number {
  return left.repository.localeCompare(right.repository) ||
    left.fromPullNumber - right.fromPullNumber ||
    targetKindRank(left) - targetKindRank(right) ||
    left.targetNumber - right.targetNumber ||
    left.matchedSyntax.localeCompare(right.matchedSyntax);
}

function targetKindRank(signal: C6MultiSWEReferenceSignal): number {
  return signal.targetKinds.includes("candidate-pull") ? 0 : 1;
}

function buildCandidateTriples(
  signals: readonly C6MultiSWEReferenceSignal[],
): C6MultiSWECandidateTriple[] {
  const signalsByLaterPull = new Map<string, C6MultiSWEReferenceSignal[]>();
  for (const signal of signals) {
    if (
      signal.matchedSyntax !== "qualified-pull-hash" ||
      !signal.targetKinds.includes("candidate-pull")
    ) {
      continue;
    }
    const key = `${signal.repository}#${signal.fromPullNumber}`;
    const values = signalsByLaterPull.get(key) ?? [];
    values.push(signal);
    signalsByLaterPull.set(key, values);
  }
  const candidates: C6MultiSWECandidateTriple[] = [];
  for (const values of signalsByLaterPull.values()) {
    const first = values[0]!;
    const priorSignals = [...new Map(
      values.map((signal) => [signal.targetNumber, signal]),
    ).values()].sort((left, right) => left.targetNumber - right.targetNumber);
    for (let leftIndex = 0; leftIndex < priorSignals.length; leftIndex += 1) {
      for (
        let rightIndex = leftIndex + 1;
        rightIndex < priorSignals.length;
        rightIndex += 1
      ) {
        const left = priorSignals[leftIndex]!;
        const right = priorSignals[rightIndex]!;
        const memberPullNumbers = [
          left.targetNumber,
          right.targetNumber,
          first.fromPullNumber,
        ].sort((a, b) => a - b) as [number, number, number];
        candidates.push({
          candidateId:
            `${first.repository.replace(/[^a-z0-9]+/gu, "-")}-prs-${memberPullNumbers.join("-")}`,
          laterPullNumber: first.fromPullNumber,
          laterSourceUnitId: first.fromSourceUnitId,
          memberPullNumbers,
          orderedPullNumbers: null,
          priorPullNumbers: [left.targetNumber, right.targetNumber],
          priorSourceUnitIds: [
            requiredPullSourceUnitId(left),
            requiredPullSourceUnitId(right),
          ],
          repository: first.repository,
          status: "relationship-candidate-ancestry-and-review-required",
        });
      }
    }
  }
  return candidates.sort((left, right) =>
    left.repository.localeCompare(right.repository) ||
    left.candidateId.localeCompare(right.candidateId)
  );
}

function requiredPullSourceUnitId(
  signal: C6MultiSWEReferenceSignal,
): string {
  const sourceUnitId = signal.targetSourceUnitIds[0];
  if (sourceUnitId === undefined) {
    throw new Error(
      `C6 Multi-SWE pull reference ${signal.repository}#${signal.targetNumber} has no source unit`,
    );
  }
  return sourceUnitId;
}

function validateSelectedSourceFiles(treeBytes: Uint8Array): void {
  const tree = treeReceiptSchema.parse(
    JSON.parse(Buffer.from(treeBytes).toString("utf8")),
  );
  if (
    tree.length !==
      C6_MULTI_SWE_RELATIONSHIP_SOURCE.treeReceipt.entryCount ||
    tree.filter((entry) =>
      entry.type === "file" &&
      entry.path.endsWith(
        C6_MULTI_SWE_RELATIONSHIP_SOURCE.selection.pathSuffix,
      )
    ).length !==
      C6_MULTI_SWE_RELATIONSHIP_SOURCE.treeReceipt.matchingPathEntries
  ) {
    throw new Error(
      "C6 Multi-SWE relationship tree capture has incomplete entry counts",
    );
  }
  const selected = tree
    .filter((entry) =>
      entry.type === "file" &&
      entry.size <=
        C6_MULTI_SWE_RELATIONSHIP_SOURCE.selection.maximumSourceFileBytes &&
      entry.path.endsWith(
        C6_MULTI_SWE_RELATIONSHIP_SOURCE.selection.pathSuffix,
      )
    )
    .map((entry) => ({
      bytes: entry.size,
      gitBlobOid: entry.oid,
      path: entry.path,
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
  const expected = C6_MULTI_SWE_RELATIONSHIP_SOURCE_FILES
    .map((source) => ({
      bytes: source.bytes,
      gitBlobOid: source.gitBlobOid,
      path: source.path,
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
  if (JSON.stringify(selected) !== JSON.stringify(expected)) {
    throw new Error(
      "C6 Multi-SWE relationship source selection does not match the pinned revision tree",
    );
  }
}

function parseSourceRows(
  sourcePath: string,
  bytes: Uint8Array,
): C6ParsedMultiSWERow[] {
  const rawRecords = splitRawRecords(bytes, sourcePath);
  const expectedRepository = basename(sourcePath)
    .replace(/_dataset\.jsonl$/u, "")
    .replace("__", "/");
  return rawRecords.map((rawRecord, index) => {
    const parsed = sourceRowSchema.parse(
      JSON.parse(rawRecord.slice(0, -1)),
    );
    const repository = `${parsed.org}/${parsed.repo}`;
    if (repository !== expectedRepository) {
      throw new Error(
        `C6 Multi-SWE source ${sourcePath} row ${index + 1} has repository ${repository}`,
      );
    }
    const expectedInstanceId = `${parsed.org}__${parsed.repo}-${parsed.number}`;
    if (
      parsed.instance_id !== undefined &&
      parsed.instance_id !== expectedInstanceId
    ) {
      throw new Error(
        `C6 Multi-SWE source ${sourcePath} row ${index + 1} has mismatched instance ID`,
      );
    }
    const sourceUnitId =
      `multi-swe-56ff018:${sourcePath}:line:${index + 1}`;
    return {
      baseCommit: parsed.base.sha,
      evaluatorOnlySha256: sha256(
        `${parsed.fix_patch}\u0000${parsed.test_patch}`,
      ),
      fixPatchSha256: sha256(parsed.fix_patch),
      lineNumber: index + 1,
      pullBody: parsed.body,
      pullBodySha256: sha256(parsed.body ?? ""),
      pullTitle: parsed.title,
      pullTitleSha256: sha256(parsed.title),
      rawRecordBytes: Buffer.byteLength(rawRecord),
      rawRecordSha256: sha256(rawRecord),
      repository: normalizeRepository(repository),
      resolvedIssues: parsed.resolved_issues,
      sourcePath,
      sourceUnitId,
      testPatchSha256: sha256(parsed.test_patch),
      upstreamPullNumber: parsed.number,
    };
  });
}

function splitRawRecords(
  bytes: Uint8Array,
  sourcePath: string,
): string[] {
  const text = Buffer.from(bytes).toString("utf8");
  if (!text.endsWith("\n")) {
    throw new Error(
      `C6 Multi-SWE source ${sourcePath} must end with LF`,
    );
  }
  const records = text.match(/[^\n]*\n/gu) ?? [];
  if (records.join("") !== text || records.some((record) => record === "\n")) {
    throw new Error(
      `C6 Multi-SWE source ${sourcePath} must contain one JSON record per LF-terminated line`,
    );
  }
  return records;
}

function parseExistingSourcePool(
  bytes: Uint8Array,
): C6ExistingSourcePool {
  const schema = z.object({
    rows: z.array(z.object({
      baseCommit: commitSchema,
      repository: z.string(),
      version: z.string(),
    }).passthrough()),
  }).passthrough();
  const parsed = schema.parse(
    JSON.parse(Buffer.from(bytes).toString("utf8")),
  );
  return {
    artifactSha256: sha256(bytes),
    rows: parsed.rows,
    sourceId: EXISTING_SOURCE_POOL_PIN.sourceId,
  };
}

function buildCrossSourceAliases(
  rows: readonly C6ParsedMultiSWERow[],
  existingSourcePool: C6ExistingSourcePool,
): C6MultiSWERelationshipDiscoverySnapshot["crossSourceAliases"] {
  const existingByIdentity = new Map(
    existingSourcePool.rows.map((row) => [
      `${normalizeRepository(row.repository)}#${row.version}`,
      row,
    ]),
  );
  return rows.flatMap((row) => {
    const existing = existingByIdentity.get(
      `${row.repository}#${row.upstreamPullNumber}`,
    );
    if (existing === undefined) {
      return [];
    }
    return [{
      canonicalUpstreamIdentity:
        `https://github.com/${row.repository}/pull/${row.upstreamPullNumber}`,
      existingBaseCommit: existing.baseCommit,
      existingSourceId: existingSourcePool.sourceId,
      sameBaseCommit: existing.baseCommit === row.baseCommit,
      sourceBaseCommit: row.baseCommit,
    }];
  }).sort((left, right) =>
    left.canonicalUpstreamIdentity.localeCompare(
      right.canonicalUpstreamIdentity,
    )
  );
}

function buildPopulationSha256(
  rows: readonly C6ParsedMultiSWERow[],
): string {
  const population = rows.map((row) => ({
    baseCommit: row.baseCommit,
    evaluatorOnlySha256: row.evaluatorOnlySha256,
    fixPatchSha256: row.fixPatchSha256,
    lineNumber: row.lineNumber,
    pullBodySha256: row.pullBodySha256,
    pullTitleSha256: row.pullTitleSha256,
    rawRecordBytes: row.rawRecordBytes,
    rawRecordSha256: row.rawRecordSha256,
    repository: row.repository,
    resolvedIssueNumbers: row.resolvedIssues.map((issue) => issue.number),
    sourcePath: row.sourcePath,
    sourceUnitId: row.sourceUnitId,
    testPatchSha256: row.testPatchSha256,
    upstreamPullNumber: row.upstreamPullNumber,
  }));
  return sha256(JSON.stringify(population));
}

async function loadBatCandidateEvidence(
  input: C6MultiSWERelationshipDiscoveryInput,
  rows: readonly C6ParsedMultiSWERow[],
  candidate: C6MultiSWECandidateTriple,
): Promise<C6LocallyVerifiedCandidate> {
  const receiptPaths = {
    compare2896To3189: input.compare2896To3189,
    compare3075To2896: input.compare3075To2896,
    issue1746: input.issue1746,
    issue3073: input.issue3073,
    issue3188: input.issue3188,
    pull2896: input.pull2896,
    pull3075: input.pull3075,
    pull3189: input.pull3189,
  };
  const receiptNames = Object.keys(receiptPaths) as Array<
    keyof typeof receiptPaths
  >;
  const receiptValues = await Promise.all(
    receiptNames.map((name) => readFile(receiptPaths[name])),
  );
  const receiptBytes = new Map(
    receiptNames.map((name, index) => [name, receiptValues[index]!]),
  );
  for (const name of receiptNames) {
    assertC6SourcePoolArtifact(
      requiredMapValue(receiptBytes, name),
      BAT_RECEIPT_PINS[name],
      `C6 Multi-SWE bat receipt ${name}`,
    );
  }

  const rowsByPull = new Map(
    rows
      .filter((row) => row.repository === "sharkdp/bat")
      .map((row) => [row.upstreamPullNumber, row]),
  );
  const pulls = new Map<number, z.infer<typeof pullReceiptSchema>>();
  const issues = new Map<number, z.infer<typeof issueReceiptSchema>>();
  for (const pullNumber of BAT_MERGE_ORDER) {
    const row = requiredMapValue(rowsByPull, pullNumber);
    const name = `pull${pullNumber}` as
      "pull2896" | "pull3075" | "pull3189";
    const receipt = pullReceiptSchema.parse(
      JSON.parse(requiredMapValue(receiptBytes, name).toString("utf8")),
    );
    validatePullReceipt(receipt, row);
    pulls.set(pullNumber, receipt);
    const issueNumber = requiredMapValue(BAT_STAGE_ISSUES, pullNumber);
    const issueName = `issue${issueNumber}` as
      "issue1746" | "issue3073" | "issue3188";
    const issueReceipt = issueReceiptSchema.parse(
      JSON.parse(requiredMapValue(receiptBytes, issueName).toString("utf8")),
    );
    validateIssueReceipt(issueReceipt, row, issueNumber);
    issues.set(pullNumber, issueReceipt);
  }

  const mergedTimes = BAT_MERGE_ORDER.map((pullNumber) =>
    Date.parse(requiredMapValue(pulls, pullNumber).merged_at)
  );
  if (
    !(
      mergedTimes[0]! < mergedTimes[1]! &&
      mergedTimes[1]! < mergedTimes[2]!
    )
  ) {
    throw new Error(
      "C6 Multi-SWE bat candidate receipts violate merge chronology",
    );
  }
  const issueCreatedOrder = [...BAT_MERGE_ORDER].sort((left, right) =>
    Date.parse(requiredMapValue(issues, left).created_at) -
    Date.parse(requiredMapValue(issues, right).created_at)
  );
  const pullCreatedOrder = [...BAT_MERGE_ORDER].sort((left, right) =>
    Date.parse(requiredMapValue(pulls, left).created_at) -
    Date.parse(requiredMapValue(pulls, right).created_at)
  );
  if (
    issueCreatedOrder.join(",") !== BAT_ORIGINAL_REQUEST_ORDER.join(",") ||
    pullCreatedOrder.join(",") !== BAT_ORIGINAL_REQUEST_ORDER.join(",")
  ) {
    throw new Error(
      "C6 Multi-SWE bat candidate original-request chronology drifted",
    );
  }
  const ancestryEdges = [
    buildAncestryEdge({
      compareBytes: requiredMapValue(
        receiptBytes,
        "compare3075To2896",
      ),
      fromPull: requiredMapValue(pulls, 3075),
      fromPullNumber: 3075,
      pin: BAT_RECEIPT_PINS.compare3075To2896,
      toPullNumber: 2896,
      toRow: requiredMapValue(rowsByPull, 2896),
    }),
    buildAncestryEdge({
      compareBytes: requiredMapValue(
        receiptBytes,
        "compare2896To3189",
      ),
      fromPull: requiredMapValue(pulls, 2896),
      fromPullNumber: 2896,
      pin: BAT_RECEIPT_PINS.compare2896To3189,
      toPullNumber: 3189,
      toRow: requiredMapValue(rowsByPull, 3189),
    }),
  ];
  const stageThreeSignals = discoverC6MultiSWERelationshipSignals(
    rows.filter((row) => row.repository === "sharkdp/bat"),
  ).referenceSignals.filter((signal) => signal.fromPullNumber === 3189);
  const thirdStageQualifiedPullReferences = stageThreeSignals
    .filter((signal) =>
      signal.matchedSyntax === "qualified-pull-hash" &&
      signal.targetKinds.includes("candidate-pull")
    )
    .map((signal) => signal.targetNumber)
    .sort((left, right) => left - right);
  const thirdStageQualifiedIssueReferences = stageThreeSignals
    .filter((signal) =>
      signal.matchedSyntax === "qualified-issue-hash" &&
      signal.targetKinds.includes("candidate-issue")
    )
    .map((signal) => signal.targetNumber)
    .sort((left, right) => left - right);
  if (
    JSON.stringify(thirdStageQualifiedPullReferences) !==
      JSON.stringify([2896, 3075]) ||
    JSON.stringify(thirdStageQualifiedIssueReferences) !==
      JSON.stringify([3073])
  ) {
    throw new Error(
      "C6 Multi-SWE bat candidate explicit regression references drifted",
    );
  }
  const thirdStagePullBody = requiredMapValue(pulls, 3189).body;
  if (
    !thirdStagePullBody.includes(
      "PR #2896 reintroduced the behaviour described in issue #3073 which had previously been fixed with PR #3075",
    )
  ) {
    throw new Error(
      "C6 Multi-SWE bat candidate explicit regression narrative drifted",
    );
  }
  if (candidate.memberPullNumbers.join(",") !== "2896,3075,3189") {
    throw new Error("C6 Multi-SWE bat candidate discovery identity drifted");
  }
  return {
    ancestryEdges,
    blockers: REQUIRED_NEXT_EVIDENCE,
    candidateId: candidate.candidateId,
    episodeEligibility:
      "blocked-pending-preregistered-merge-order-regression-policy",
    mergeChronologyVerified: true,
    mergeOrderPullNumbers: BAT_MERGE_ORDER,
    originalRequestChronology: {
      issueCreatedOrderPullNumbers: BAT_ORIGINAL_REQUEST_ORDER,
      pullCreatedOrderPullNumbers: BAT_ORIGINAL_REQUEST_ORDER,
      requestChronologyVerified: false,
      status: "conflicts-with-merge-order",
    },
    relationshipKind: "merge-order-regression",
    semanticDependency: {
      independentReviewReceiptSha256: null,
      independentReviewVerified: false,
      status:
        "explicit-regression-narrative-detected-independent-review-required",
      thirdStagePullBodySha256: sha256(thirdStagePullBody),
      thirdStageQualifiedIssueReferences: [3073],
      thirdStageQualifiedPullReferences: [2896, 3075],
    },
    stages: BAT_MERGE_ORDER.map((pullNumber) => {
      const row = requiredMapValue(rowsByPull, pullNumber);
      const pull = requiredMapValue(pulls, pullNumber);
      const issue = requiredMapValue(issues, pullNumber);
      const issueNumber = requiredMapValue(BAT_STAGE_ISSUES, pullNumber);
      const pullName = `pull${pullNumber}` as
        "pull2896" | "pull3075" | "pull3189";
      const issueName = `issue${issueNumber}` as
        "issue1746" | "issue3073" | "issue3188";
      return {
        baseCommit: row.baseCommit,
        issueCreatedAt: issue.created_at,
        issueReceiptSha256: BAT_RECEIPT_PINS[issueName].sha256,
        mergeCommit: pull.merge_commit_sha,
        mergedAt: pull.merged_at,
        originalIssueNumber: issueNumber,
        pullCreatedAt: pull.created_at,
        pullNumber,
        pullReceiptSha256: BAT_RECEIPT_PINS[pullName].sha256,
        sourceRecordMatchesIssueReceipt: true,
        sourceRecordMatchesPullReceipt: true,
        sourceUnitId: row.sourceUnitId,
      };
    }),
    status:
      "merge-order-regression-candidate-original-request-chronology-conflict",
  };
}

function validatePullReceipt(
  receipt: z.infer<typeof pullReceiptSchema>,
  row: C6ParsedMultiSWERow,
): void {
  if (
    receipt.number !== row.upstreamPullNumber ||
    receipt.base.sha !== row.baseCommit ||
    receipt.title !== row.pullTitle ||
    receipt.body !== row.pullBody ||
    receipt.html_url !==
      `https://github.com/${row.repository}/pull/${row.upstreamPullNumber}`
  ) {
    throw new Error(
      `C6 Multi-SWE bat pull receipt ${row.upstreamPullNumber} does not match the source row`,
    );
  }
}

function validateIssueReceipt(
  receipt: z.infer<typeof issueReceiptSchema>,
  row: C6ParsedMultiSWERow,
  issueNumber: number,
): void {
  const sourceIssue = row.resolvedIssues.find((issue) =>
    issue.number === issueNumber
  );
  if (
    sourceIssue === undefined ||
    receipt.number !== issueNumber ||
    receipt.title !== sourceIssue.title ||
    receipt.body !== sourceIssue.body ||
    receipt.html_url !==
      `https://github.com/${row.repository}/issues/${issueNumber}`
  ) {
    throw new Error(
      `C6 Multi-SWE bat issue receipt ${issueNumber} does not match the source row`,
    );
  }
}

function buildAncestryEdge(input: {
  compareBytes: Uint8Array;
  fromPull: z.infer<typeof pullReceiptSchema>;
  fromPullNumber: number;
  pin: {
    request: string;
    sha256: string;
  };
  toPullNumber: number;
  toRow: C6ParsedMultiSWERow;
}): C6LocallyVerifiedCandidate["ancestryEdges"][number] {
  const compare = compareReceiptSchema.parse(
    JSON.parse(Buffer.from(input.compareBytes).toString("utf8")),
  );
  const expectedUrl =
    `https://github.com/sharkdp/bat/compare/${input.fromPull.merge_commit_sha}...${input.toRow.baseCommit}`;
  if (
    compare.base_commit.sha !== input.fromPull.merge_commit_sha ||
    compare.merge_base_commit.sha !== input.fromPull.merge_commit_sha ||
    compare.html_url !== expectedUrl ||
    compare.total_commits !== compare.ahead_by
  ) {
    throw new Error(
      `C6 Multi-SWE bat ancestry ${input.fromPullNumber}->${input.toPullNumber} does not bind merge commit to next base`,
    );
  }
  return {
    aheadBy: compare.ahead_by,
    compareReceiptSha256: input.pin.sha256,
    fromMergeCommit: input.fromPull.merge_commit_sha,
    fromPullNumber: input.fromPullNumber,
    request: input.pin.request,
    toBaseCommit: input.toRow.baseCommit,
    toPullNumber: input.toPullNumber,
  };
}

function requiredMapValue<K, V>(
  map: ReadonlyMap<K, V>,
  key: K,
): V {
  const value = map.get(key);
  if (value === undefined) {
    throw new Error(`missing C6 Multi-SWE value ${String(key)}`);
  }
  return value;
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
