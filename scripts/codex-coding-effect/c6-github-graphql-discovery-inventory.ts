import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  lstat,
  open,
  readdir,
} from "node:fs/promises";
import { basename, join, relative, resolve, sep } from "node:path";
import { createInterface } from "node:readline";
import { Transform } from "node:stream";

import { z } from "zod";

import {
  assertC6NoSymlinkPathComponents,
  readC6StableRegularFile,
} from "./c6-asset-lock";
import {
  C6_GITHUB_GRAPHQL_DISCOVERY_QUERY,
} from "./c6-github-graphql-discovery";

const CAPTURE_FILES = [
  "capture.json",
  "request.json",
  "response-headers.json",
  "response.json",
] as const;
const REST_COMMIT_GAP_PATH =
  "data.repository.pullRequest.commits.pageInfo";
const REST_PAGE_SIZE = 100;
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u);
const commitSchema = z.string().regex(/^[a-f0-9]{40}$/u);
const artifactReferenceSchema = z.object({
  bytes: z.number().int().nonnegative(),
  path: z.string().min(1),
  sha256: sha256Schema,
}).strict();
const pageInfoSchema = z.object({
  endCursor: z.string().nullable(),
  hasNextPage: z.boolean(),
}).passthrough();
const genericConnectionSchema = z.object({
  nodes: z.array(z.unknown().nullable()),
  pageInfo: pageInfoSchema,
}).passthrough();
const commitConnectionSchema = z.object({
  nodes: z.array(z.object({
    commit: z.object({
      committedDate: z.iso.datetime(),
      oid: commitSchema,
      parents: genericConnectionSchema,
    }).passthrough(),
  }).passthrough().nullable()),
  pageInfo: pageInfoSchema,
}).passthrough();
const reviewConnectionSchema = z.object({
  nodes: z.array(z.object({
    commit: z.object({ oid: commitSchema }).passthrough().nullable(),
    state: z.string().min(1),
  }).passthrough().nullable()),
  pageInfo: pageInfoSchema,
}).passthrough();
const reviewThreadConnectionSchema = z.object({
  nodes: z.array(z.object({
    comments: z.object({
      nodes: z.array(z.object({
        commit: z.object({ oid: commitSchema }).passthrough().nullable(),
        originalCommit:
          z.object({ oid: commitSchema }).passthrough().nullable(),
      }).passthrough().nullable()),
      pageInfo: pageInfoSchema,
    }).passthrough(),
    isResolved: z.boolean(),
  }).passthrough().nullable()),
  pageInfo: pageInfoSchema,
}).passthrough();
const responseSchema = z.object({
  data: z.object({
    rateLimit: z.object({
      cost: z.number().int().nonnegative(),
      remaining: z.number().int().nonnegative(),
      resetAt: z.iso.datetime(),
    }).passthrough(),
    repository: z.object({
      nameWithOwner: z.string().min(1),
      pullRequest: z.object({
        baseRefName: z.string(),
        baseRefOid: commitSchema,
        baseRepository: z.object({
          nameWithOwner: z.string().min(1),
        }).passthrough(),
        closingIssuesReferences: genericConnectionSchema,
        comments: genericConnectionSchema,
        commits: commitConnectionSchema,
        headRefName: z.string().nullable(),
        headRefOid: commitSchema.nullable(),
        mergeCommit: z.object({ oid: commitSchema }).passthrough().nullable(),
        merged: z.boolean(),
        mergedAt: z.iso.datetime().nullable(),
        number: z.number().int().positive(),
        reviewThreads: reviewThreadConnectionSchema,
        reviews: reviewConnectionSchema,
        url: z.url(),
      }).passthrough(),
    }).passthrough(),
  }).passthrough(),
}).passthrough();
const sourceRowSchema = z.object({
  number: z.number().int().positive(),
  org: z.string().min(1),
  repo: z.string().min(1),
}).passthrough();
const treeReceiptSchema = z.array(z.object({
  lfs: z.object({
    oid: sha256Schema,
    pointerSize: z.number().int().positive(),
    size: z.number().int().nonnegative(),
  }).passthrough().optional(),
  oid: commitSchema,
  path: z.string().min(1),
  size: z.number().int().nonnegative(),
  type: z.enum(["directory", "file"]),
}).passthrough());
const captureManifestSchema = z.object({
  boundary: z.object({
    acceptedEpisodeCount: z.literal(0),
    candidateManifestFrozen: z.literal(false),
    status: z.literal(
      "single-pr-graphql-discovery-not-accepted-evidence",
    ),
    upperBoundClaimPermitted: z.literal(false),
  }).strict(),
  discovery: z.object({
    discoverySurfaceComplete: z.boolean(),
    paginationGaps: z.array(z.object({
      endCursor: z.string().nullable(),
      path: z.string().min(1),
    }).strict()),
    rateLimit: z.object({
      cost: z.number().int().nonnegative(),
      remaining: z.number().int().nonnegative(),
      resetAt: z.iso.datetime(),
    }).strict(),
  }).strict(),
  request: z.object({
    body: artifactReferenceSchema,
    endpoint: z.literal("https://api.github.com/graphql"),
    headers: z.object({
      accept: z.literal("application/vnd.github+json"),
      authorization: z.literal("Bearer [REDACTED]"),
      "content-type": z.literal("application/json"),
      "user-agent": z.literal("GoodMemory-C6-GraphQL-Discovery/1"),
      "x-github-api-version": z.literal("2022-11-28"),
    }).strict(),
    method: z.literal("POST"),
    variables: z.object({
      name: z.string().min(1),
      number: z.number().int().positive(),
      owner: z.string().min(1),
    }).strict(),
  }).strict(),
  response: z.object({
    body: artifactReferenceSchema,
    headers: artifactReferenceSchema,
    httpStatus: z.literal(200),
  }).strict(),
  schemaVersion: z.literal(1),
  target: z.object({
    pullNumber: z.number().int().positive(),
    repository: z.string().min(1),
    repositoryRedirect: z.object({
      requestedRepository: z.string().min(1),
      resolvedRepository: z.string().min(1),
      status: z.literal("explicit-graphql-resolution-observed"),
    }).strict().optional(),
    url: z.url(),
  }).strict(),
}).strict();
const requestSchema = z.object({
  query: z.literal(C6_GITHUB_GRAPHQL_DISCOVERY_QUERY),
  variables: z.object({
    name: z.string().min(1),
    number: z.number().int().positive(),
    owner: z.string().min(1),
  }).strict(),
}).strict();
const responseHeaderSchema = z.object({
  "content-type": z.string().min(1),
  date: z.string().min(1),
  etag: z.string().min(1).optional(),
  "x-github-request-id": z.string().min(1),
  "x-ratelimit-limit": z.string().regex(/^\d+$/u),
  "x-ratelimit-remaining": z.string().regex(/^\d+$/u),
  "x-ratelimit-reset": z.string().regex(/^\d+$/u),
  "x-ratelimit-resource": z.literal("graphql"),
  "x-ratelimit-used": z.string().regex(/^\d+$/u),
}).strict();
const restResponseHeaderSchema = z.object({
  "content-type": z.string().min(1),
  date: z.string().min(1),
  etag: z.string().min(1),
  "x-github-api-version-selected": z.literal("2022-11-28"),
  "x-github-request-id": z.string().min(1),
  "x-ratelimit-limit": z.string().regex(/^\d+$/u),
  "x-ratelimit-remaining": z.string().regex(/^\d+$/u),
  "x-ratelimit-reset": z.string().regex(/^\d+$/u),
  "x-ratelimit-resource": z.literal("core"),
  "x-ratelimit-used": z.string().regex(/^\d+$/u),
  link: z.string().nullable(),
}).strict();
const restRequestSchema = z.object({
  endpoint: z.enum([
    "commits",
    "issue",
    "issue-comments",
    "pull",
    "pull-discussion-comments",
    "review-comments",
    "reviews",
  ]),
  issueNumber: z.number().int().positive().nullable(),
  page: z.number().int().positive().nullable(),
  request: z.object({
    headers: z.object({
      accept: z.literal("application/vnd.github+json"),
      authorization: z.literal("redacted"),
      "user-agent": z.literal("goodmemory-c6-github-rest-capture/1"),
      "x-github-api-version": z.literal("2022-11-28"),
    }).strict(),
    method: z.literal("GET"),
    url: z.url(),
  }).strict(),
  response: z.object({
    headers: restResponseHeaderSchema,
    rawBody: artifactReferenceSchema,
    status: z.literal(200),
  }).strict(),
}).strict();
const restManifestSchema = z.object({
  boundary: z.object({
    authorizationRecordedAs: z.literal("redacted"),
    bearerAuthorizationHeaderSent: z.literal(true),
    cryptographicPlatformReceipt: z.literal(false),
    httpsUrlEnforced: z.literal(true),
    platformAuthenticationCryptographicallyProven: z.literal(false),
    status: z.literal(
      "https-bearer-rest-session-local-capture-not-cryptographic-platform-receipt",
    ),
    tlsPeerReceiptCaptured: z.literal(false),
  }).strict(),
  generatedBy: z.literal(
    "scripts/codex-coding-effect/c6-github-rest-capture.ts",
  ),
  input: z.object({
    owner: z.string().min(1),
    pullNumber: z.number().int().positive(),
    repository: z.string().min(1),
    resolvedIssueNumbers: z.array(z.number().int().positive()),
  }).strict(),
  requestProtocol: z.object({
    accept: z.literal("application/vnd.github+json"),
    apiRoot: z.literal("https://api.github.com"),
    apiVersion: z.literal("2022-11-28"),
    pagination: z.literal(
      "per-page-100-follow-validated-link-next-until-absent",
    ),
    userAgent: z.literal("goodmemory-c6-github-rest-capture/1"),
  }).strict(),
  requests: z.array(restRequestSchema).min(1),
  responseClosureSha256: sha256Schema,
  schemaVersion: z.literal(1),
}).strict();
const restPullSchema = z.object({
  base: z.object({
    repo: z.object({
      full_name: z.string().min(1),
      id: z.number().int().positive(),
    }).passthrough(),
    sha: commitSchema,
  }).passthrough(),
  comments: z.number().int().nonnegative(),
  commits: z.number().int().nonnegative(),
  head: z.object({
    sha: commitSchema,
  }).passthrough(),
  html_url: z.url(),
  number: z.number().int().positive(),
  review_comments: z.number().int().nonnegative(),
}).passthrough();
const restCommitSchema = z.object({
  sha: commitSchema,
}).passthrough();

interface FileReference {
  bytes: number;
  mode: number;
  path: string;
  sha256: string;
}

interface SourceAnchor {
  anchorId: string;
  captureDirectory: string;
  number: number;
  org: string;
  repo: string;
  repository: string;
  source: {
    path: string;
    rowIndex: number;
    rowSha256: string;
  };
}

interface DiscoveryStatistics {
  closingIssues: number;
  commits: number;
  discussionComments: number;
  parentEdges: number;
  resolvedReviewThreads: number;
  reviewStates: Record<string, number>;
  reviewThreadComments: number;
  reviewThreadCommentsWithCurrentCommit: number;
  reviewThreadCommentsWithOriginalAndCurrentCommit: number;
  reviewThreadCommentsWithOriginalCommit: number;
  reviewThreads: number;
  reviews: number;
  reviewsWithCommit: number;
}

type CaptureEntry =
  C6GitHubGraphQLDiscoveryInventory["captureEntries"][number];

interface RestPaginationSupplement {
  commitCount: number;
  commitPages: number;
  manifestSha256: string;
  type: "github-rest-commits-pagination";
}

interface GraphQLCaptureBinding {
  baseRefOid: string;
  commitOids: Array<string | null>;
  headRefOid: string | null;
}

interface ValidatedCapture {
  binding: GraphQLCaptureBinding;
  entry: CaptureEntry;
}

export interface C6GitHubGraphQLDiscoveryInventory {
  anchors: SourceAnchor[];
  artifactKind: "c6-github-graphql-discovery-inventory";
  boundary: {
    acceptedEpisodeCount: 0;
    candidateManifestFrozen: false;
    codexRunReady: false;
    status: "graphql-discovery-inventory-only-not-accepted-evidence";
    upperBoundClaimPermitted: false;
  };
  capture: {
    rootSha256: string;
    structureSha256: string;
  };
  captureEntries: Array<{
    anchorId: string;
    captureManifestSha256: string;
    directory: string;
    discoverySurfaceComplete: boolean;
    effectiveDiscoverySurfaceComplete: boolean;
    paginationGaps: Array<{
      endCursor: string | null;
      path: string;
    }>;
    paginationSupplement: {
      commitCount: number;
      commitPages: number;
      manifestSha256: string;
      type: "github-rest-commits-pagination";
    } | null;
    repository: {
      redirected: boolean;
      requested: string;
      resolved: string;
    };
    responseSha256: string;
    rawGraphQLStatistics: DiscoveryStatistics;
  }>;
  counts: {
    completeCaptures: number;
    discoverySurfaceCompleteCaptures: number;
    discoverySurfaceIncompleteCaptures: number;
    effectiveDiscoverySurfaceCompleteCaptures: number;
    effectiveDiscoverySurfaceIncompleteCaptures: number;
    expectedCaptures: number;
    missingCaptures: number;
    paginationGaps: number;
    paginationSupplementedCount: number;
    partialCaptures: number;
    repositoryRedirects: number;
    sourceFiles: number;
    sourceRows: number;
    uniqueAnchors: number;
  };
  missingCaptures: Array<{
    anchorId: string;
    directory: string;
  }>;
  partialCaptures: Array<{
    anchorId: string;
    directory: string;
    missingFiles: string[];
  }>;
  provenance: {
    platformCryptographicReceipt: false;
    status:
      "https-response-capture-is-not-a-platform-cryptographic-receipt";
    transport: "https-response-body-and-selected-header-capture";
  };
  restSupplement: {
    entryCount: number;
    provided: boolean;
    rootSha256: string | null;
  };
  schemaVersion: 1;
  source: {
    datasetId: "ByteDance-Seed/Multi-SWE-bench";
    files: Array<{
      bytes: number;
      path: string;
      receiptIdentity: "git-blob-sha1" | "git-lfs-sha256";
      receiptObjectOid: string;
      rows: number;
      sha256: string;
    }>;
    revision: string;
    rootSha256: string;
    treeReceipt: {
      bytes: number;
      path: string;
      sha256: string;
    };
    revisionBinding:
      "caller-pinned-revision-and-tree-receipt-hash-not-platform-signed";
  };
  sourcePopulationSha256: string;
  rawGraphQLStatistics: DiscoveryStatistics;
}

export async function buildC6GitHubGraphQLDiscoveryInventory(input: {
  captureRoot: string;
  expectedSourceRevision: string;
  expectedSourceRootSha256: string;
  expectedTreeReceiptSha256: string;
  restSupplementRoot?: string;
  sourceRoot: string;
  treeReceiptPath: string;
}): Promise<C6GitHubGraphQLDiscoveryInventory> {
  const sourceRevision = commitSchema.parse(input.expectedSourceRevision);
  const expectedSourceRootSha256 = sha256Schema.parse(
    input.expectedSourceRootSha256,
  );
  const expectedTreeReceiptSha256 = sha256Schema.parse(
    input.expectedTreeReceiptSha256,
  );
  const sourceRoot = await assertC6NoSymlinkPathComponents(
    input.sourceRoot,
    "C6 discovery inventory source root",
  );
  const captureRoot = await assertC6NoSymlinkPathComponents(
    input.captureRoot,
    "C6 discovery inventory capture root",
  );
  const treeReceiptPath = await assertC6NoSymlinkPathComponents(
    input.treeReceiptPath,
    "C6 discovery inventory tree receipt",
  );
  const treeReceiptBytes = await readC6StableRegularFile(
    treeReceiptPath,
    "discovery inventory tree receipt",
  );
  if (sha256(treeReceiptBytes) !== expectedTreeReceiptSha256) {
    throw new Error(
      "C6 discovery inventory tree receipt hash mismatch",
    );
  }
  const tree = treeReceiptSchema.parse(
    JSON.parse(treeReceiptBytes.toString("utf8")) as unknown,
  );
  const selectedEntries = tree
    .filter((entry) =>
      entry.type === "file" && entry.path.endsWith("_dataset.jsonl")
    )
    .sort((left, right) => compareStrings(left.path, right.path));
  if (selectedEntries.length === 0) {
    throw new Error("C6 discovery inventory source receipt is empty");
  }
  const selectedPathSet = new Set<string>();
  for (const entry of selectedEntries) {
    assertSafeRelativePath(entry.path);
    if (selectedPathSet.has(entry.path)) {
      throw new Error(
        `C6 discovery inventory duplicate receipt path ${entry.path}`,
      );
    }
    selectedPathSet.add(entry.path);
  }
  const actualSourcePaths = await walkFiles(sourceRoot);
  if (
    JSON.stringify(actualSourcePaths) !==
      JSON.stringify(selectedEntries.map((entry) => entry.path))
  ) {
    throw new Error(
      "C6 discovery inventory source root does not match receipt paths",
    );
  }

  const anchors: SourceAnchor[] = [];
  const sourceFiles: C6GitHubGraphQLDiscoveryInventory["source"]["files"] = [];
  const sourceClosureFiles: FileReference[] = [];
  for (const entry of selectedEntries) {
    const absolutePath = join(sourceRoot, entry.path);
    const rows = await parseSourceRows(absolutePath, entry.path);
    const file = rows.file;
    if (file.bytes !== entry.size) {
      throw new Error(
        `C6 discovery inventory source size mismatch ${entry.path}`,
      );
    }
    const receiptMatches = entry.lfs === undefined
      ? file.gitBlobOid === entry.oid
      : (
        entry.lfs.size === entry.size &&
        entry.lfs.oid === file.sha256
      );
    if (!receiptMatches) {
      throw new Error(
        `C6 discovery inventory source receipt identity mismatch ${entry.path}`,
      );
    }
    anchors.push(...rows.anchors);
    sourceClosureFiles.push(fileReference(file));
    sourceFiles.push({
      bytes: file.bytes,
      path: entry.path,
      receiptIdentity: entry.lfs === undefined
        ? "git-blob-sha1"
        : "git-lfs-sha256",
      receiptObjectOid: entry.lfs?.oid ?? entry.oid,
      rows: rows.anchors.length,
      sha256: file.sha256,
    });
  }
  const sourceRootSha256 = closureSha256(sourceClosureFiles);
  if (sourceRootSha256 !== expectedSourceRootSha256) {
    throw new Error("C6 discovery inventory source root hash mismatch");
  }
  anchors.sort((left, right) =>
    compareStrings(left.anchorId, right.anchorId)
  );
  for (let index = 1; index < anchors.length; index += 1) {
    if (anchors[index - 1]!.anchorId === anchors[index]!.anchorId) {
      throw new Error(
        `C6 discovery inventory duplicate source anchor ${
          anchors[index]!.anchorId
        }`,
      );
    }
  }
  const directoryToAnchor = new Map<string, SourceAnchor>();
  for (const anchor of anchors) {
    if (directoryToAnchor.has(anchor.captureDirectory)) {
      throw new Error(
        `C6 discovery inventory capture directory collision ${
          anchor.captureDirectory
        }`,
      );
    }
    directoryToAnchor.set(anchor.captureDirectory, anchor);
  }

  const captureClosure = await buildFileClosure(captureRoot);
  const captureStructure = await readCaptureStructure(
    captureRoot,
    new Set(directoryToAnchor.keys()),
  );
  const captureEntries: C6GitHubGraphQLDiscoveryInventory["captureEntries"] =
    [];
  const captureBindings = new Map<string, GraphQLCaptureBinding>();
  const captureClosureByPath = new Map(
    captureClosure.files.map((file) => [file.path, file]),
  );
  const missingCaptures:
    C6GitHubGraphQLDiscoveryInventory["missingCaptures"] = [];
  const partialCaptures:
    C6GitHubGraphQLDiscoveryInventory["partialCaptures"] = [];
  for (const anchor of anchors) {
    const files = captureStructure.directories.get(
      anchor.captureDirectory,
    );
    if (files === undefined) {
      missingCaptures.push({
        anchorId: anchor.anchorId,
        directory: anchor.captureDirectory,
      });
      continue;
    }
    const missingFiles = CAPTURE_FILES.filter((file) => !files.includes(file));
    if (missingFiles.length > 0) {
      partialCaptures.push({
        anchorId: anchor.anchorId,
        directory: anchor.captureDirectory,
        missingFiles: [...missingFiles],
      });
      continue;
    }
    const validatedCapture = await validateCapture(
      captureRoot,
      anchor,
      captureClosureByPath,
    );
    captureEntries.push(validatedCapture.entry);
    captureBindings.set(
      anchor.captureDirectory,
      validatedCapture.binding,
    );
  }
  let restSupplementClosure:
    Awaited<ReturnType<typeof buildFileClosure>> | null = null;
  let restSupplementRoot: string | null = null;
  let restSupplementStructureSha256: string | null = null;
  if (input.restSupplementRoot !== undefined) {
    restSupplementRoot = await assertC6NoSymlinkPathComponents(
      input.restSupplementRoot,
      "C6 discovery inventory REST supplement root",
    );
    restSupplementClosure = await buildFileClosure(restSupplementRoot);
    const structure = await readRestSupplementStructure(restSupplementRoot);
    restSupplementStructureSha256 = structure.structureSha256;
    const restSupplementClosureByPath = new Map(
      restSupplementClosure.files.map((file) => [file.path, file]),
    );
    const captureEntryByDirectory = new Map(
      captureEntries.map((entry) => [entry.directory, entry]),
    );
    for (const directory of structure.captureDirectories) {
      const captureEntry = captureEntryByDirectory.get(directory);
      if (captureEntry === undefined) {
        throw new Error(
          `C6 discovery inventory unexpected REST supplement ${directory}`,
        );
      }
      if (!isCommitPaginationOnlyGap(captureEntry)) {
        throw new Error(
          `C6 discovery inventory REST supplement does not match exact ` +
          `GraphQL commit gap ${captureEntry.anchorId}`,
        );
      }
      const supplement = await validateRestPaginationSupplement(
        restSupplementRoot,
        captureEntry,
        captureBindings.get(directory)!,
        restSupplementClosureByPath,
        structure.entries.find((entry) => entry.directory === directory)!,
      );
      captureEntry.effectiveDiscoverySurfaceComplete = true;
      captureEntry.paginationSupplement = supplement;
    }
  }
  const rawGraphQLStatistics = sumStatistics(
    captureEntries.map((entry) => entry.rawGraphQLStatistics),
  );
  const paginationGaps = captureEntries.reduce(
    (sum, entry) => sum + entry.paginationGaps.length,
    0,
  );

  const terminalSourceClosure = await buildFileClosure(sourceRoot);
  if (
    terminalSourceClosure.assetRootSha256 !== sourceRootSha256 ||
    JSON.stringify(terminalSourceClosure.files) !==
      JSON.stringify(sourceClosureFiles)
  ) {
    throw new Error(
      "C6 discovery inventory source closure changed during analysis",
    );
  }
  const terminalCaptureClosure = await buildFileClosure(captureRoot);
  const terminalCaptureStructure = await readCaptureStructure(
    captureRoot,
    new Set(directoryToAnchor.keys()),
  );
  if (
    terminalCaptureClosure.assetRootSha256 !==
      captureClosure.assetRootSha256 ||
    JSON.stringify(terminalCaptureClosure.files) !==
      JSON.stringify(captureClosure.files) ||
    terminalCaptureStructure.structureSha256 !==
      captureStructure.structureSha256
  ) {
    throw new Error(
      "C6 discovery inventory capture closure changed during analysis",
    );
  }
  if (
    restSupplementRoot !== null &&
    restSupplementClosure !== null &&
    restSupplementStructureSha256 !== null
  ) {
    const terminalRestSupplementClosure = await buildFileClosure(
      restSupplementRoot,
    );
    const terminalRestSupplementStructure = await readRestSupplementStructure(
      restSupplementRoot,
    );
    if (
      terminalRestSupplementClosure.assetRootSha256 !==
        restSupplementClosure.assetRootSha256 ||
      JSON.stringify(terminalRestSupplementClosure.files) !==
        JSON.stringify(restSupplementClosure.files) ||
      terminalRestSupplementStructure.structureSha256 !==
        restSupplementStructureSha256
    ) {
      throw new Error(
        "C6 discovery inventory REST supplement closure changed during analysis",
      );
    }
  }
  const terminalTreeReceiptBytes = await readC6StableRegularFile(
    treeReceiptPath,
    "discovery inventory terminal tree receipt",
  );
  if (!terminalTreeReceiptBytes.equals(treeReceiptBytes)) {
    throw new Error(
      "C6 discovery inventory tree receipt changed during analysis",
    );
  }

  return {
    anchors,
    artifactKind: "c6-github-graphql-discovery-inventory",
    boundary: {
      acceptedEpisodeCount: 0,
      candidateManifestFrozen: false,
      codexRunReady: false,
      status: "graphql-discovery-inventory-only-not-accepted-evidence",
      upperBoundClaimPermitted: false,
    },
    capture: {
      rootSha256: captureClosure.assetRootSha256,
      structureSha256: captureStructure.structureSha256,
    },
    captureEntries,
    counts: {
      completeCaptures: captureEntries.length,
      discoverySurfaceCompleteCaptures: captureEntries.filter(
        (entry) => entry.discoverySurfaceComplete,
      ).length,
      discoverySurfaceIncompleteCaptures: captureEntries.filter(
        (entry) => !entry.discoverySurfaceComplete,
      ).length,
      effectiveDiscoverySurfaceCompleteCaptures: captureEntries.filter(
        (entry) => entry.effectiveDiscoverySurfaceComplete,
      ).length,
      effectiveDiscoverySurfaceIncompleteCaptures: captureEntries.filter(
        (entry) => !entry.effectiveDiscoverySurfaceComplete,
      ).length,
      expectedCaptures: anchors.length,
      missingCaptures: missingCaptures.length,
      paginationGaps,
      paginationSupplementedCount: captureEntries.filter(
        (entry) => entry.paginationSupplement !== null,
      ).length,
      partialCaptures: partialCaptures.length,
      repositoryRedirects: captureEntries.filter(
        (entry) => entry.repository.redirected,
      ).length,
      sourceFiles: sourceFiles.length,
      sourceRows: anchors.length,
      uniqueAnchors: anchors.length,
    },
    missingCaptures,
    partialCaptures,
    provenance: {
      platformCryptographicReceipt: false,
      status:
        "https-response-capture-is-not-a-platform-cryptographic-receipt",
      transport: "https-response-body-and-selected-header-capture",
    },
    restSupplement: {
      entryCount: captureEntries.filter(
        (entry) => entry.paginationSupplement !== null,
      ).length,
      provided: restSupplementClosure !== null,
      rootSha256: restSupplementClosure?.assetRootSha256 ?? null,
    },
    schemaVersion: 1,
    source: {
      datasetId: "ByteDance-Seed/Multi-SWE-bench",
      files: sourceFiles,
      revision: sourceRevision,
      revisionBinding:
        "caller-pinned-revision-and-tree-receipt-hash-not-platform-signed",
      rootSha256: sourceRootSha256,
      treeReceipt: {
        bytes: treeReceiptBytes.byteLength,
        path: basename(treeReceiptPath),
        sha256: expectedTreeReceiptSha256,
      },
    },
    sourcePopulationSha256: sha256(JSON.stringify(anchors)),
    rawGraphQLStatistics,
  };
}

export function serializeC6GitHubGraphQLDiscoveryInventory(
  inventory: C6GitHubGraphQLDiscoveryInventory,
): string {
  return `${JSON.stringify(inventory, null, 2)}\n`;
}

async function validateCapture(
  captureRoot: string,
  anchor: SourceAnchor,
  initialClosureByPath: ReadonlyMap<string, FileReference>,
): Promise<ValidatedCapture> {
  const directory = join(captureRoot, anchor.captureDirectory);
  const [
    captureBytes,
    requestBytes,
    responseHeaderBytes,
    responseBytes,
  ] = await Promise.all([
    readC6StableRegularFile(
      join(directory, "capture.json"),
      "discovery inventory capture manifest",
    ),
    readC6StableRegularFile(
      join(directory, "request.json"),
      "discovery inventory request",
    ),
    readC6StableRegularFile(
      join(directory, "response-headers.json"),
      "discovery inventory response headers",
    ),
    readC6StableRegularFile(
      join(directory, "response.json"),
      "discovery inventory response",
    ),
  ]);
  for (const [name, bytes] of [
    ["capture.json", captureBytes],
    ["request.json", requestBytes],
    ["response-headers.json", responseHeaderBytes],
    ["response.json", responseBytes],
  ] as const) {
    assertInitialClosureBytes(
      initialClosureByPath,
      `${anchor.captureDirectory}/${name}`,
      bytes,
      `capture ${anchor.anchorId}`,
    );
  }
  const rawCapture = parseJson(captureBytes, "capture manifest");
  if (
    typeof rawCapture !== "object" ||
    rawCapture === null ||
    !("request" in rawCapture) ||
    typeof rawCapture.request !== "object" ||
    rawCapture.request === null ||
    !("headers" in rawCapture.request) ||
    typeof rawCapture.request.headers !== "object" ||
    rawCapture.request.headers === null ||
    !("authorization" in rawCapture.request.headers) ||
    rawCapture.request.headers.authorization !== "Bearer [REDACTED]"
  ) {
    throw new Error(
      `C6 discovery inventory capture token redaction mismatch ${
        anchor.anchorId
      }`,
    );
  }
  const capture = captureManifestSchema.parse(rawCapture);
  if (
    captureBytes.toString("utf8") !==
      `${JSON.stringify(rawCapture, null, 2)}\n`
  ) {
    throw new Error(
      `C6 discovery inventory capture manifest is not canonical ${
        anchor.anchorId
      }`,
    );
  }
  assertArtifactReference(
    capture.request.body,
    "request.json",
    requestBytes,
    anchor.anchorId,
  );
  assertArtifactReference(
    capture.response.headers,
    "response-headers.json",
    responseHeaderBytes,
    anchor.anchorId,
  );
  assertArtifactReference(
    capture.response.body,
    "response.json",
    responseBytes,
    anchor.anchorId,
  );

  const request = requestSchema.parse(
    parseJson(requestBytes, "request JSON"),
  );
  if (requestBytes.toString("utf8") !== JSON.stringify(request)) {
    throw new Error(
      `C6 discovery inventory request JSON is not exact ${anchor.anchorId}`,
    );
  }
  const expectedVariables = {
    name: anchor.repo,
    number: anchor.number,
    owner: anchor.org,
  };
  if (
    JSON.stringify(request.variables) !== JSON.stringify(expectedVariables) ||
    JSON.stringify(capture.request.variables) !==
      JSON.stringify(expectedVariables)
  ) {
    throw new Error(
      `C6 discovery inventory request target mismatch ${anchor.anchorId}`,
    );
  }
  const responseHeaders = responseHeaderSchema.parse(
    parseJson(responseHeaderBytes, "response headers"),
  );
  if (
    responseHeaderBytes.toString("utf8") !==
      `${JSON.stringify(responseHeaders, null, 2)}\n` ||
    responseHeaders["content-type"].split(";", 1)[0]!.trim().toLowerCase() !==
      "application/json"
  ) {
    throw new Error(
      `C6 discovery inventory response headers mismatch ${anchor.anchorId}`,
    );
  }
  const rawResponse = parseJson(responseBytes, "response JSON");
  if (
    typeof rawResponse === "object" &&
    rawResponse !== null &&
    "errors" in rawResponse &&
    Array.isArray(rawResponse.errors) &&
    rawResponse.errors.length > 0
  ) {
    throw new Error(
      `C6 discovery inventory GraphQL errors in ${anchor.anchorId}`,
    );
  }
  const response = responseSchema.parse(rawResponse);
  const pullRequest = response.data.repository.pullRequest;
  const resolvedRepository = normalizeRepositoryName(
    response.data.repository.nameWithOwner,
    "GraphQL response repository",
  );
  const baseRepository = normalizeRepositoryName(
    pullRequest.baseRepository.nameWithOwner,
    "GraphQL base repository",
  );
  if (
    baseRepository !== resolvedRepository ||
    pullRequest.number !== anchor.number
  ) {
    throw new Error(
      `C6 discovery inventory capture identity mismatch ${anchor.anchorId}`,
    );
  }
  const redirect = capture.target.repositoryRedirect;
  const repositoryRedirected = resolvedRepository !== anchor.repository;
  if (
    (
      !repositoryRedirected &&
      redirect !== undefined
    ) ||
    (
      repositoryRedirected &&
      (
        redirect === undefined ||
        normalizeRepositoryName(
          redirect.requestedRepository,
          "GraphQL redirect requested repository",
        ) !== anchor.repository ||
        normalizeRepositoryName(
          redirect.resolvedRepository,
          "GraphQL redirect resolved repository",
        ) !== resolvedRepository
      )
    )
  ) {
    throw new Error(
      `C6 discovery inventory repository redirect mismatch ${anchor.anchorId}`,
    );
  }
  const expectedUrl =
    `https://github.com/${resolvedRepository}/pull/${anchor.number}`;
  if (
    normalizeUrl(pullRequest.url) !== normalizeUrl(expectedUrl) ||
    normalizeRepositoryName(
      capture.target.repository,
      "GraphQL capture target repository",
    ) !== resolvedRepository ||
    capture.target.pullNumber !== anchor.number ||
    normalizeUrl(capture.target.url) !== normalizeUrl(expectedUrl)
  ) {
    throw new Error(
      `C6 discovery inventory capture target mismatch ${anchor.anchorId}`,
    );
  }
  const paginationGaps = collectPaginationGaps(response.data, "data");
  if (
    JSON.stringify(capture.discovery.paginationGaps) !==
      JSON.stringify(paginationGaps) ||
    capture.discovery.discoverySurfaceComplete !==
      (paginationGaps.length === 0) ||
    JSON.stringify(capture.discovery.rateLimit) !==
      JSON.stringify(response.data.rateLimit)
  ) {
    throw new Error(
      `C6 discovery inventory pagination manifest mismatch ${
        anchor.anchorId
      }`,
    );
  }
  return {
    binding: {
      baseRefOid: pullRequest.baseRefOid,
      commitOids: pullRequest.commits.nodes.map(
        (node) => node?.commit.oid ?? null,
      ),
      headRefOid: pullRequest.headRefOid,
    },
    entry: {
      anchorId: anchor.anchorId,
      captureManifestSha256: sha256(captureBytes),
      directory: anchor.captureDirectory,
      discoverySurfaceComplete: paginationGaps.length === 0,
      effectiveDiscoverySurfaceComplete: paginationGaps.length === 0,
      paginationGaps,
      paginationSupplement: null,
      repository: {
        redirected: repositoryRedirected,
        requested: anchor.repository,
        resolved: resolvedRepository,
      },
      responseSha256: sha256(responseBytes),
      rawGraphQLStatistics: extractStatistics(pullRequest),
    },
  };
}

function isCommitPaginationOnlyGap(entry: CaptureEntry): boolean {
  return entry.paginationGaps.length === 1 &&
    entry.paginationGaps[0]!.path === REST_COMMIT_GAP_PATH;
}

async function validateRestPaginationSupplement(
  root: string,
  captureEntry: CaptureEntry,
  graphqlBinding: GraphQLCaptureBinding,
  initialClosureByPath: ReadonlyMap<string, FileReference>,
  initialStructure: {
    directories: string[];
    files: string[];
  },
): Promise<RestPaginationSupplement> {
  const directory = join(root, captureEntry.directory);
  const manifestBytes = await readC6StableRegularFile(
    join(directory, "manifest.json"),
    "discovery inventory REST supplement manifest",
  );
  assertInitialClosureBytes(
    initialClosureByPath,
    `${captureEntry.directory}/manifest.json`,
    manifestBytes,
    `REST supplement ${captureEntry.anchorId}`,
  );
  const rawManifest = parseJson(
    manifestBytes,
    "REST supplement manifest",
  );
  const manifest = restManifestSchema.parse(rawManifest);
  if (
    manifestBytes.toString("utf8") !==
      `${JSON.stringify(rawManifest, null, 2)}\n`
  ) {
    throw new Error(
      `C6 discovery inventory REST supplement manifest is not canonical ${
        captureEntry.anchorId
      }`,
    );
  }
  const manifestRepository = normalizeRepository(
    manifest.input.owner,
    manifest.input.repository,
  );
  if (
    manifestRepository !== captureEntry.repository.resolved ||
    manifest.input.pullNumber !== pullNumberFromAnchorId(captureEntry.anchorId)
  ) {
    throw new Error(
      `C6 discovery inventory REST supplement target mismatch ${
        captureEntry.anchorId
      }`,
    );
  }
  if (
    new Set(manifest.input.resolvedIssueNumbers).size !==
      manifest.input.resolvedIssueNumbers.length ||
    manifest.input.resolvedIssueNumbers.some(
      (number) => number === manifest.input.pullNumber,
    ) ||
    JSON.stringify(manifest.input.resolvedIssueNumbers) !==
      JSON.stringify(
        [...manifest.input.resolvedIssueNumbers].sort(
          (left, right) => left - right,
        ),
      )
  ) {
    throw new Error(
      `C6 discovery inventory REST supplement issue targets mismatch ${
        captureEntry.anchorId
      }`,
    );
  }

  const expectedFiles = new Set(["manifest.json"]);
  const requests: Array<{
    body: unknown;
    request: z.infer<typeof restRequestSchema>;
  }> = [];
  const requestKeys = new Set<string>();
  for (const request of manifest.requests) {
    assertSafeRelativePath(request.response.rawBody.path);
    if (
      request.response.rawBody.path === "manifest.json" ||
      expectedFiles.has(request.response.rawBody.path)
    ) {
      throw new Error(
        `C6 discovery inventory duplicate REST supplement artifact ${
          captureEntry.anchorId
        }`,
      );
    }
    expectedFiles.add(request.response.rawBody.path);
    const requestKey = [
      request.endpoint,
      request.issueNumber ?? "none",
      request.page ?? "none",
    ].join(":");
    if (requestKeys.has(requestKey)) {
      throw new Error(
        `C6 discovery inventory duplicate REST supplement request ${
          captureEntry.anchorId
        }`,
      );
    }
    requestKeys.add(requestKey);
    const bodyBytes = await readC6StableRegularFile(
      join(directory, request.response.rawBody.path),
      "discovery inventory REST supplement response",
    );
    assertInitialClosureBytes(
      initialClosureByPath,
      `${captureEntry.directory}/${request.response.rawBody.path}`,
      bodyBytes,
      `REST supplement ${captureEntry.anchorId}`,
    );
    assertRestArtifactReference(
      request.response.rawBody,
      bodyBytes,
      captureEntry.anchorId,
    );
    if (
      request.response.headers["content-type"]
        .split(";", 1)[0]!
        .trim()
        .toLowerCase() !== "application/json"
    ) {
      throw new Error(
        `C6 discovery inventory REST supplement content type mismatch ${
          captureEntry.anchorId
        }`,
      );
    }
    requests.push({
      body: parseJson(bodyBytes, "REST supplement response JSON"),
      request,
    });
  }
  const structure = await readRelativeStructure(directory);
  const expectedStructure = buildExpectedStructure(expectedFiles);
  if (
    JSON.stringify(structure) !== JSON.stringify({
      directories: initialStructure.directories,
      files: initialStructure.files,
    }) ||
    JSON.stringify(structure.files) !==
      JSON.stringify(expectedStructure.files) ||
    JSON.stringify(structure.directories) !==
      JSON.stringify(expectedStructure.directories)
  ) {
    throw new Error(
      `C6 discovery inventory REST supplement file closure mismatch ${
        captureEntry.anchorId
      }`,
    );
  }
  if (
    manifest.responseClosureSha256 !== sha256(JSON.stringify(
      manifest.requests.map((request) => request.response.rawBody),
    ))
  ) {
    throw new Error(
      `C6 discovery inventory REST supplement response closure mismatch ${
        captureEntry.anchorId
      }`,
    );
  }

  const pullRequests = requests.filter(
    (item) => item.request.endpoint === "pull",
  );
  if (pullRequests.length !== 1) {
    throw new Error(
      `C6 discovery inventory REST supplement requires one pull response ${
        captureEntry.anchorId
      }`,
    );
  }
  const pull = restPullSchema.parse(pullRequests[0]!.body);
  const expectedPullUrl =
    `https://github.com/${captureEntry.repository.resolved}/pull/` +
    `${manifest.input.pullNumber}`;
  if (
    normalizeRepositoryName(
      pull.base.repo.full_name,
      "REST pull base repository",
    ) !== captureEntry.repository.resolved ||
    pull.number !== manifest.input.pullNumber ||
    normalizeUrl(pull.html_url) !== normalizeUrl(expectedPullUrl) ||
    pull.base.sha !== graphqlBinding.baseRefOid ||
    pull.head.sha !== graphqlBinding.headRefOid
  ) {
    throw new Error(
      `C6 discovery inventory REST supplement pull identity mismatch ${
        captureEntry.anchorId
      }`,
    );
  }

  const groups = new Map<string, typeof requests>();
  for (const item of requests) {
    validateRestRequestIdentity(
      item.request,
      manifest,
      pull.base.repo.id,
      captureEntry.anchorId,
    );
    const key = restRequestGroupKey(item.request);
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    validateRestPaginationGroup(
      group,
      manifest,
      pull.base.repo.id,
      captureEntry.anchorId,
    );
  }

  const commitGroup = groups.get("commits:none");
  if (commitGroup === undefined) {
    throw new Error(
      `C6 discovery inventory REST supplement is missing commits ${
        captureEntry.anchorId
      }`,
    );
  }
  const orderedCommitPages = [...commitGroup].sort(
    (left, right) => left.request.page! - right.request.page!,
  );
  const commits = orderedCommitPages.flatMap((item) =>
    z.array(restCommitSchema).parse(item.body)
  );
  if (
    orderedCommitPages.length < 2 ||
    commits.length <= REST_PAGE_SIZE ||
    commits.length !== pull.commits ||
    new Set(commits.map((commit) => commit.sha)).size !== commits.length ||
    commits.at(-1)?.sha !== pull.head.sha ||
    JSON.stringify(
      commits.slice(0, graphqlBinding.commitOids.length)
        .map((commit) => commit.sha),
    ) !== JSON.stringify(graphqlBinding.commitOids)
  ) {
    throw new Error(
      `C6 discovery inventory REST commit supplement count mismatch ${
        captureEntry.anchorId
      }`,
    );
  }
  return {
    commitCount: commits.length,
    commitPages: orderedCommitPages.length,
    manifestSha256: sha256(manifestBytes),
    type: "github-rest-commits-pagination",
  };
}

function validateRestRequestIdentity(
  request: z.infer<typeof restRequestSchema>,
  manifest: z.infer<typeof restManifestSchema>,
  repositoryId: number,
  anchorId: string,
): void {
  const target = expectedRestRequestTarget(request, manifest, anchorId);
  const expectedRawPath = target.singleton
    ? target.rawPathRoot
    : `${target.rawPathRoot}/page-${
      String(request.page).padStart(4, "0")
    }.json`;
  if (request.response.rawBody.path !== expectedRawPath) {
    throw new Error(
      `C6 discovery inventory REST supplement response path mismatch ${
        anchorId
      }`,
    );
  }
  validateRestApiUrl(
    request.request.url,
    target.endpointPath,
    target.singleton ? null : request.page,
    repositoryId,
    anchorId,
  );
}

function expectedRestRequestTarget(
  request: z.infer<typeof restRequestSchema>,
  manifest: z.infer<typeof restManifestSchema>,
  anchorId: string,
): {
  endpointPath: string;
  rawPathRoot: string;
  singleton: boolean;
} {
  const repositoryRoot =
    `/repos/${manifest.input.owner}/${manifest.input.repository}`;
  const pullNumber = manifest.input.pullNumber;
  const issueNumbers = new Set(manifest.input.resolvedIssueNumbers);
  if (
    request.endpoint === "pull" &&
    request.issueNumber === null &&
    request.page === null
  ) {
    return {
      endpointPath: `${repositoryRoot}/pulls/${pullNumber}`,
      rawPathRoot: "responses/pull.json",
      singleton: true,
    };
  }
  if (
    request.endpoint === "issue" &&
    request.issueNumber !== null &&
    issueNumbers.has(request.issueNumber) &&
    request.page === null
  ) {
    return {
      endpointPath: `${repositoryRoot}/issues/${request.issueNumber}`,
      rawPathRoot: `responses/issues/${request.issueNumber}/issue.json`,
      singleton: true,
    };
  }
  if (request.page === null) {
    throw new Error(
      `C6 discovery inventory REST supplement request shape mismatch ${
        anchorId
      }`,
    );
  }
  if (
    request.endpoint === "review-comments" &&
    request.issueNumber === null
  ) {
    return {
      endpointPath: `${repositoryRoot}/pulls/${pullNumber}/comments`,
      rawPathRoot: "responses/review-comments",
      singleton: false,
    };
  }
  if (request.endpoint === "reviews" && request.issueNumber === null) {
    return {
      endpointPath: `${repositoryRoot}/pulls/${pullNumber}/reviews`,
      rawPathRoot: "responses/reviews",
      singleton: false,
    };
  }
  if (request.endpoint === "commits" && request.issueNumber === null) {
    return {
      endpointPath: `${repositoryRoot}/pulls/${pullNumber}/commits`,
      rawPathRoot: "responses/commits",
      singleton: false,
    };
  }
  if (
    request.endpoint === "pull-discussion-comments" &&
    request.issueNumber === pullNumber
  ) {
    return {
      endpointPath: `${repositoryRoot}/issues/${pullNumber}/comments`,
      rawPathRoot: "responses/pull-discussion-comments",
      singleton: false,
    };
  }
  if (
    request.endpoint === "issue-comments" &&
    request.issueNumber !== null &&
    issueNumbers.has(request.issueNumber)
  ) {
    return {
      endpointPath: `${repositoryRoot}/issues/${request.issueNumber}/comments`,
      rawPathRoot: `responses/issues/${request.issueNumber}/comments`,
      singleton: false,
    };
  }
  throw new Error(
    `C6 discovery inventory REST supplement request target mismatch ${
      anchorId
    }`,
  );
}

function validateRestPaginationGroup(
  group: Array<{
    body: unknown;
    request: z.infer<typeof restRequestSchema>;
  }>,
  manifest: z.infer<typeof restManifestSchema>,
  repositoryId: number,
  anchorId: string,
): void {
  const singleton = group[0]!.request.page === null;
  if (singleton) {
    if (
      group.length !== 1 ||
      group[0]!.request.response.headers.link !== null
    ) {
      throwRestLinkMismatch(anchorId);
    }
    return;
  }
  const ordered = [...group].sort(
    (left, right) => left.request.page! - right.request.page!,
  );
  for (let index = 0; index < ordered.length; index += 1) {
    const item = ordered[index]!;
    if (item.request.page !== index + 1 || !Array.isArray(item.body)) {
      throw new Error(
        `C6 discovery inventory REST pagination body mismatch ${anchorId}`,
      );
    }
    if (
      item.body.length > REST_PAGE_SIZE ||
      (index < ordered.length - 1 && item.body.length !== REST_PAGE_SIZE)
    ) {
      throw new Error(
        `C6 discovery inventory REST pagination page-size mismatch ${anchorId}`,
      );
    }
    const links = parseRestLinks(
      item.request.response.headers.link,
      anchorId,
    );
    const next = links.get("next") ?? null;
    const expectedNext = ordered[index + 1]?.request.request.url ?? null;
    if (next !== expectedNext) {
      throwRestLinkMismatch(anchorId);
    }
    const target = expectedRestRequestTarget(
      item.request,
      manifest,
      anchorId,
    );
    for (const [relation, url] of links) {
      const expectedPage = relation === "next"
        ? index + 2
        : relation === "prev"
        ? index
        : relation === "first"
        ? 1
        : ordered.length;
      if (expectedPage < 1 || expectedPage > ordered.length) {
        throwRestLinkMismatch(anchorId);
      }
      validateRestApiUrl(
        url,
        target.endpointPath,
        expectedPage,
        repositoryId,
        anchorId,
      );
    }
  }
}

function validateRestApiUrl(
  value: string,
  endpointPath: string,
  page: number | null,
  repositoryId: number,
  anchorId: string,
): void {
  const url = new URL(value);
  const repositoryPrefix = /^\/repos\/[^/]+\/[^/]+/u.exec(endpointPath)?.[0];
  const canonicalPath = repositoryPrefix === undefined
    ? ""
    : `/repositories/${repositoryId}${
      endpointPath.slice(repositoryPrefix.length)
    }`;
  const keys = [...url.searchParams.keys()];
  const validPageQuery = page === null
    ? keys.length === 0
    : (
      keys.length === 2 &&
      new Set(keys).size === 2 &&
      url.searchParams.get("per_page") === String(REST_PAGE_SIZE) &&
      url.searchParams.get("page") === String(page)
    );
  if (
    url.protocol !== "https:" ||
    url.host !== "api.github.com" ||
    url.username !== "" ||
    url.password !== "" ||
    url.hash !== "" ||
    (
      url.pathname !== endpointPath &&
      (page === null || url.pathname !== canonicalPath)
    ) ||
    !validPageQuery
  ) {
    throw new Error(
      `C6 discovery inventory REST supplement URL mismatch ${anchorId}`,
    );
  }
}

function parseRestLinks(
  value: string | null,
  anchorId: string,
): Map<"first" | "last" | "next" | "prev", string> {
  const links = new Map<"first" | "last" | "next" | "prev", string>();
  if (value === null) {
    return links;
  }
  for (const segment of value.split(",")) {
    const match = /^\s*<([^<>]+)>\s*;\s*rel="(first|last|next|prev)"\s*$/u
      .exec(segment);
    if (match === null) {
      throwRestLinkMismatch(anchorId);
    }
    const relation = match[2] as "first" | "last" | "next" | "prev";
    if (links.has(relation)) {
      throwRestLinkMismatch(anchorId);
    }
    links.set(relation, match[1]!);
  }
  return links;
}

function throwRestLinkMismatch(anchorId: string): never {
  throw new Error(
    `C6 discovery inventory REST pagination Link closure mismatch ${
      anchorId
    }`,
  );
}

function restRequestGroupKey(
  request: z.infer<typeof restRequestSchema>,
): string {
  return `${request.endpoint}:${request.issueNumber ?? "none"}`;
}

function assertRestArtifactReference(
  reference: z.infer<typeof artifactReferenceSchema>,
  bytes: Buffer,
  anchorId: string,
): void {
  if (
    reference.bytes !== bytes.byteLength ||
    reference.sha256 !== sha256(bytes)
  ) {
    throw new Error(
      `C6 discovery inventory REST supplement artifact hash mismatch ${
        anchorId
      }`,
    );
  }
}

function assertInitialClosureBytes(
  initialClosureByPath: ReadonlyMap<string, FileReference>,
  path: string,
  bytes: Buffer,
  label: string,
): void {
  const initial = initialClosureByPath.get(path);
  if (
    initial === undefined ||
    initial.bytes !== bytes.byteLength ||
    initial.sha256 !== sha256(bytes)
  ) {
    throw new Error(
      `C6 discovery inventory ${label} differs from initial closure ${path}`,
    );
  }
}

async function readRestSupplementStructure(root: string): Promise<{
  captureDirectories: string[];
  entries: Array<{
    directories: string[];
    directory: string;
    files: string[];
  }>;
  structureSha256: string;
}> {
  const captureDirectories: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.isSymbolicLink() || !entry.isDirectory()) {
      throw new Error(
        `C6 discovery inventory rejects REST supplement root entry ${
          entry.name
        }`,
      );
    }
    captureDirectories.push(entry.name);
  }
  captureDirectories.sort(compareStrings);
  const entries = [];
  for (const directory of captureDirectories) {
    entries.push({
      directory,
      ...await readRelativeStructure(join(root, directory)),
    });
  }
  return {
    captureDirectories,
    entries,
    structureSha256: sha256(JSON.stringify(entries)),
  };
}

async function readRelativeStructure(root: string): Promise<{
  directories: string[];
  files: string[];
}> {
  const directories: string[] = [];
  const files: string[] = [];
  await walkRelativeStructure(root, root, directories, files);
  return {
    directories: directories.sort(compareStrings),
    files: files.sort(compareStrings),
  };
}

async function walkRelativeStructure(
  root: string,
  directory: string,
  directories: string[],
  files: string[],
): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolutePath = join(directory, entry.name);
    const relativePath = relative(root, absolutePath).split(sep).join("/");
    if (entry.isSymbolicLink()) {
      throw new Error(
        `C6 discovery inventory rejects REST supplement symlink ${
          relativePath
        }`,
      );
    }
    if (entry.isDirectory()) {
      directories.push(relativePath);
      await walkRelativeStructure(
        root,
        absolutePath,
        directories,
        files,
      );
    } else if (entry.isFile()) {
      files.push(relativePath);
    } else {
      throw new Error(
        `C6 discovery inventory rejects REST supplement entry ${
          relativePath
        }`,
      );
    }
  }
}

function buildExpectedStructure(files: ReadonlySet<string>): {
  directories: string[];
  files: string[];
} {
  const directories = new Set<string>();
  for (const path of files) {
    const components = path.split("/");
    for (let index = 1; index < components.length; index += 1) {
      directories.add(components.slice(0, index).join("/"));
    }
  }
  return {
    directories: [...directories].sort(compareStrings),
    files: [...files].sort(compareStrings),
  };
}

function pullNumberFromAnchorId(anchorId: string): number {
  const value = anchorId.slice(anchorId.lastIndexOf("#") + 1);
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new Error(
      `C6 discovery inventory invalid source anchor ${anchorId}`,
    );
  }
  return number;
}

function assertArtifactReference(
  reference: z.infer<typeof artifactReferenceSchema>,
  expectedPath: string,
  bytes: Buffer,
  anchorId: string,
): void {
  if (
    reference.path !== expectedPath ||
    reference.bytes !== bytes.byteLength ||
    reference.sha256 !== sha256(bytes)
  ) {
    throw new Error(
      `C6 discovery inventory capture artifact hash mismatch ${anchorId}`,
    );
  }
}

function extractStatistics(
  pullRequest: z.infer<typeof responseSchema>["data"]["repository"][
    "pullRequest"
  ],
): DiscoveryStatistics {
  const commits = pullRequest.commits.nodes.filter(isPresent);
  const reviews = pullRequest.reviews.nodes.filter(isPresent);
  const reviewThreads = pullRequest.reviewThreads.nodes.filter(isPresent);
  const reviewThreadComments = reviewThreads.flatMap((thread) =>
    thread.comments.nodes.filter(isPresent)
  );
  const reviewStates: Record<string, number> = {};
  for (const review of reviews) {
    reviewStates[review.state] = (reviewStates[review.state] ?? 0) + 1;
  }
  return {
    closingIssues:
      pullRequest.closingIssuesReferences.nodes.filter(isPresent).length,
    commits: commits.length,
    discussionComments:
      pullRequest.comments.nodes.filter(isPresent).length,
    parentEdges: commits.reduce(
      (sum, item) =>
        sum + item.commit.parents.nodes.filter(isPresent).length,
      0,
    ),
    resolvedReviewThreads:
      reviewThreads.filter((thread) => thread.isResolved).length,
    reviewStates: sortRecord(reviewStates),
    reviewThreadComments: reviewThreadComments.length,
    reviewThreadCommentsWithCurrentCommit:
      reviewThreadComments.filter((comment) => comment.commit !== null).length,
    reviewThreadCommentsWithOriginalAndCurrentCommit:
      reviewThreadComments.filter((comment) =>
        comment.originalCommit !== null && comment.commit !== null
      ).length,
    reviewThreadCommentsWithOriginalCommit:
      reviewThreadComments.filter((comment) =>
        comment.originalCommit !== null
      ).length,
    reviewThreads: reviewThreads.length,
    reviews: reviews.length,
    reviewsWithCommit:
      reviews.filter((review) => review.commit !== null).length,
  };
}

function sumStatistics(
  values: readonly DiscoveryStatistics[],
): DiscoveryStatistics {
  const result = emptyStatistics();
  for (const value of values) {
    result.closingIssues += value.closingIssues;
    result.commits += value.commits;
    result.discussionComments += value.discussionComments;
    result.parentEdges += value.parentEdges;
    result.resolvedReviewThreads += value.resolvedReviewThreads;
    result.reviewThreadComments += value.reviewThreadComments;
    result.reviewThreadCommentsWithCurrentCommit +=
      value.reviewThreadCommentsWithCurrentCommit;
    result.reviewThreadCommentsWithOriginalAndCurrentCommit +=
      value.reviewThreadCommentsWithOriginalAndCurrentCommit;
    result.reviewThreadCommentsWithOriginalCommit +=
      value.reviewThreadCommentsWithOriginalCommit;
    result.reviewThreads += value.reviewThreads;
    result.reviews += value.reviews;
    result.reviewsWithCommit += value.reviewsWithCommit;
    for (const [state, count] of Object.entries(value.reviewStates)) {
      result.reviewStates[state] = (result.reviewStates[state] ?? 0) + count;
    }
  }
  result.reviewStates = sortRecord(result.reviewStates);
  return result;
}

function emptyStatistics(): DiscoveryStatistics {
  return {
    closingIssues: 0,
    commits: 0,
    discussionComments: 0,
    parentEdges: 0,
    resolvedReviewThreads: 0,
    reviewStates: {},
    reviewThreadComments: 0,
    reviewThreadCommentsWithCurrentCommit: 0,
    reviewThreadCommentsWithOriginalAndCurrentCommit: 0,
    reviewThreadCommentsWithOriginalCommit: 0,
    reviewThreads: 0,
    reviews: 0,
    reviewsWithCommit: 0,
  };
}

async function parseSourceRows(
  absolutePath: string,
  relativePath: string,
): Promise<{
  anchors: SourceAnchor[];
  file: FileReference & { gitBlobOid: string };
}> {
  const before = await lstat(absolutePath);
  if (!before.isFile() || before.isSymbolicLink()) {
    throw new Error(
      `C6 discovery inventory rejects non-file ${relativePath}`,
    );
  }
  const handle = await open(
    absolutePath,
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  try {
    const opened = await handle.stat();
    const contentHash = createHash("sha256");
    const blobHash = createHash("sha1").update(
      `blob ${opened.size}\0`,
    );
    const utf8Decoder = new TextDecoder("utf-8", { fatal: true });
    let bytes = 0;
    let containsCarriageReturn = false;
    let lastByte = -1;
    const verifier = new Transform({
      transform(chunk, _encoding, callback) {
        try {
          const buffer = Buffer.from(chunk);
          bytes += buffer.byteLength;
          contentHash.update(buffer);
          blobHash.update(buffer);
          utf8Decoder.decode(buffer, { stream: true });
          containsCarriageReturn ||= buffer.includes(13);
          if (buffer.byteLength > 0) {
            lastByte = buffer[buffer.byteLength - 1]!;
          }
          callback(null, buffer);
        } catch (error) {
          callback(error instanceof Error ? error : new Error(String(error)));
        }
      },
    });
    const lines = createInterface({
      crlfDelay: Infinity,
      input: handle.createReadStream({
        autoClose: false,
        start: 0,
      }).pipe(verifier),
    });
    const anchors: SourceAnchor[] = [];
    let rowIndex = 0;
    for await (const line of lines) {
      rowIndex += 1;
      const row = sourceRowSchema.parse(JSON.parse(line) as unknown);
      const repository = normalizeRepository(row.org, row.repo);
      anchors.push({
        anchorId: `${repository}#${row.number}`,
        captureDirectory: `${row.org}__${row.repo}__${row.number}`,
        number: row.number,
        org: row.org,
        repo: row.repo,
        repository,
        source: {
          path: relativePath,
          rowIndex,
          rowSha256: sha256(`${line}\n`),
        },
      });
    }
    utf8Decoder.decode();
    const after = await handle.stat();
    if (
      bytes !== opened.size ||
      bytes === 0 ||
      lastByte !== 10 ||
      containsCarriageReturn ||
      !sameFile(before, opened, after)
    ) {
      throw new Error(
        `C6 discovery inventory source changed or is not LF JSONL ${
          relativePath
        }`,
      );
    }
    return {
      anchors,
      file: {
        bytes,
        gitBlobOid: blobHash.digest("hex"),
        mode: after.mode & 0o777,
        path: relativePath,
        sha256: contentHash.digest("hex"),
      },
    };
  } finally {
    await handle.close();
  }
}

async function hashRegularFile(
  absolutePath: string,
  relativePath: string,
): Promise<FileReference & { gitBlobOid: string }> {
  const before = await lstat(absolutePath);
  if (!before.isFile() || before.isSymbolicLink()) {
    throw new Error(
      `C6 discovery inventory rejects non-file ${relativePath}`,
    );
  }
  const handle = await open(
    absolutePath,
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  try {
    const opened = await handle.stat();
    const contentHash = createHash("sha256");
    const blobHash = createHash("sha1").update(
      `blob ${opened.size}\0`,
    );
    let bytes = 0;
    for await (
      const chunk of handle.createReadStream({
        autoClose: false,
        start: 0,
      })
    ) {
      const buffer = Buffer.from(chunk);
      bytes += buffer.byteLength;
      contentHash.update(buffer);
      blobHash.update(buffer);
    }
    const after = await handle.stat();
    if (
      bytes !== opened.size ||
      !sameFile(before, opened, after)
    ) {
      throw new Error(
        `C6 discovery inventory file changed while hashing ${relativePath}`,
      );
    }
    return {
      bytes,
      gitBlobOid: blobHash.digest("hex"),
      mode: after.mode & 0o777,
      path: relativePath,
      sha256: contentHash.digest("hex"),
    };
  } finally {
    await handle.close();
  }
}

async function buildFileClosure(root: string): Promise<{
  assetRootSha256: string;
  files: FileReference[];
}> {
  const paths = await walkFiles(root);
  const files: FileReference[] = [];
  for (const path of paths) {
    files.push(fileReference(await hashRegularFile(
      join(root, path),
      path,
    )));
  }
  return {
    assetRootSha256: closureSha256(files),
    files,
  };
}

async function walkFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  await walkDirectory(root, root, files);
  return files.sort(compareStrings);
}

async function walkDirectory(
  root: string,
  directory: string,
  files: string[],
): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(
        `C6 discovery inventory rejects symlink ${path}`,
      );
    }
    if (entry.isDirectory()) {
      await walkDirectory(root, path, files);
    } else if (entry.isFile()) {
      files.push(relative(root, path).split(sep).join("/"));
    } else {
      throw new Error(
        `C6 discovery inventory rejects non-file ${path}`,
      );
    }
  }
}

async function readCaptureStructure(
  captureRoot: string,
  expectedDirectories: ReadonlySet<string>,
): Promise<{
  directories: Map<string, string[]>;
  structureSha256: string;
}> {
  const directories = new Map<string, string[]>();
  for (const entry of await readdir(captureRoot, { withFileTypes: true })) {
    if (entry.isSymbolicLink() || !entry.isDirectory()) {
      throw new Error(
        `C6 discovery inventory rejects capture root entry ${entry.name}`,
      );
    }
    if (!expectedDirectories.has(entry.name)) {
      throw new Error(
        `C6 discovery inventory unexpected capture directory ${entry.name}`,
      );
    }
    const files: string[] = [];
    for (
      const child of await readdir(join(captureRoot, entry.name), {
        withFileTypes: true,
      })
    ) {
      if (child.isSymbolicLink() || !child.isFile()) {
        throw new Error(
          `C6 discovery inventory rejects nested capture entry ${
            entry.name
          }/${child.name}`,
        );
      }
      if (!(CAPTURE_FILES as readonly string[]).includes(child.name)) {
        throw new Error(
          `C6 discovery inventory unexpected capture artifact ${
            entry.name
          }/${child.name}`,
        );
      }
      files.push(child.name);
    }
    directories.set(entry.name, files.sort(compareStrings));
  }
  const structure = [...directories.entries()]
    .sort((left, right) => compareStrings(left[0], right[0]))
    .map(([directory, files]) => ({ directory, files }));
  return {
    directories,
    structureSha256: sha256(JSON.stringify(structure)),
  };
}

function collectPaginationGaps(
  value: unknown,
  path: string,
): Array<{ endCursor: string | null; path: string }> {
  const gaps: Array<{ endCursor: string | null; path: string }> = [];
  visitPagination(value, path, gaps);
  return gaps.sort((left, right) => compareStrings(left.path, right.path));
}

function visitPagination(
  value: unknown,
  path: string,
  gaps: Array<{ endCursor: string | null; path: string }>,
): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      visitPagination(item, `${path}[${index}]`, gaps)
    );
    return;
  }
  if (typeof value !== "object" || value === null) {
    return;
  }
  for (const [name, child] of Object.entries(value)) {
    const childPath = `${path}.${name}`;
    if (name === "pageInfo") {
      const pageInfo = pageInfoSchema.parse(child);
      if (pageInfo.hasNextPage) {
        gaps.push({
          endCursor: pageInfo.endCursor,
          path: childPath,
        });
      }
    }
    visitPagination(child, childPath, gaps);
  }
}

function fileReference(
  file: FileReference,
): FileReference {
  return {
    bytes: file.bytes,
    mode: file.mode,
    path: file.path,
    sha256: file.sha256,
  };
}

function closureSha256(files: readonly FileReference[]): string {
  return sha256(JSON.stringify(
    [...files].sort((left, right) => left.path.localeCompare(right.path)),
  ));
}

function sameFile(
  before: Awaited<ReturnType<typeof lstat>>,
  opened: Awaited<ReturnType<Awaited<ReturnType<typeof open>>["stat"]>>,
  after: Awaited<ReturnType<Awaited<ReturnType<typeof open>>["stat"]>>,
): boolean {
  return before.dev === opened.dev &&
    before.ino === opened.ino &&
    before.mode === opened.mode &&
    before.mtimeMs === opened.mtimeMs &&
    before.size === opened.size &&
    opened.dev === after.dev &&
    opened.ino === after.ino &&
    opened.mode === after.mode &&
    opened.mtimeMs === after.mtimeMs &&
    opened.size === after.size;
}

function assertSafeRelativePath(path: string): void {
  const components = path.split("/");
  if (
    path.includes("\\") ||
    components.some((component) =>
      component.length === 0 || component === "." || component === ".."
    )
  ) {
    throw new Error(
      `C6 discovery inventory rejects unsafe receipt path ${path}`,
    );
  }
}

function normalizeRepository(org: string, repo: string): string {
  const repository = `${org}/${repo}`.toLowerCase();
  if (!/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/u.test(repository)) {
    throw new Error(
      `C6 discovery inventory invalid repository ${org}/${repo}`,
    );
  }
  return repository;
}

function normalizeRepositoryName(value: string, label: string): string {
  const components = value.split("/");
  if (components.length !== 2) {
    throw new Error(
      `C6 discovery inventory invalid ${label} ${value}`,
    );
  }
  return normalizeRepository(components[0]!, components[1]!);
}

function normalizeUrl(value: string): string {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.host !== "github.com" ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error(
      `C6 discovery inventory invalid GitHub target URL ${value}`,
    );
  }
  return `${url.protocol}//${url.host.toLowerCase()}${
    url.pathname.toLowerCase()
  }`;
}

function parseJson(bytes: Buffer, label: string): unknown {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`C6 discovery inventory invalid ${label}`);
  }
}

function sortRecord(value: Record<string, number>): Record<string, number> {
  return Object.fromEntries(
    Object.entries(value).sort((left, right) =>
      compareStrings(left[0], right[0])
    ),
  );
}

function isPresent<T>(value: T | null): value is T {
  return value !== null;
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
