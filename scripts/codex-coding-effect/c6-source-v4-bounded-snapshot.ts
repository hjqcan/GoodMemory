import { createHash } from "node:crypto";
import {
  lstat,
  mkdtemp,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import {
  dirname,
  join,
} from "node:path";
import { isDeepStrictEqual } from "node:util";

import { z } from "zod";

import {
  assertC6NoSymlinkPathComponents,
  buildC6AssetLock,
  loadC6AssetLock,
  readC6StableRegularFile,
  serializeC6AssetLock,
  verifyC6AssetClosure,
} from "./c6-asset-lock";
import type {
  LoadedC6AssetLock,
} from "./c6-asset-lock";
import {
  buildC6SourceV4BoundedContract,
  C6_SOURCE_V4_BOUNDED_EVALUATION_ID,
  C6_SOURCE_V4_BOUNDED_MAX_CANONICAL_ASSET_BYTES,
  C6_SOURCE_V4_BOUNDED_V3_EVALUATION_ID,
  C6_SOURCE_V4_BOUNDED_V3_EXECUTION_CONTRACT_SHA256,
  C6_SOURCE_V4_BOUNDED_V3_OBSERVED_CLOSURE,
  parseC6SourceV4BoundedContract,
  serializeC6SourceV4BoundedContract,
} from "./c6-source-v4-bounded-contract";
import {
  buildC6SourceV4BoundedPilotExclusionReceipt,
  buildC6SourceV4BoundedSelectionReceipt,
  buildC6SourceV4BoundedV3PrefixReuseReceipt,
  C6_SOURCE_V4_BOUNDED_CONTRACT_SHA256,
  parseC6SourceV4BoundedPilotExclusionReceipt,
  parseC6SourceV4BoundedSelectionReceipt,
  parseC6SourceV4BoundedV3PrefixReuseReceipt,
  serializeC6SourceV4BoundedPilotExclusionReceipt,
  serializeC6SourceV4BoundedSelectionReceipt,
  serializeC6SourceV4BoundedV3PrefixReuseReceipt,
  verifyC6SourceV4BoundedPilotExclusionReceipt,
  verifyC6SourceV4BoundedSelectionReceipt,
  verifyC6SourceV4BoundedV3PrefixReuseReceipt,
} from "./c6-source-v4-bounded-receipts";
import type {
  LoadedC6SourceV4BoundedPilotExclusionReceipt,
  LoadedC6SourceV4BoundedSelectionReceipt,
  LoadedC6SourceV4BoundedV3PrefixReuseReceipt,
} from "./c6-source-v4-bounded-receipts";
import {
  parseC6SourceV3SimpleFrameDefinition,
} from "./c6-source-v3-simple-census-core";
import {
  verifyC6SourceV3SimpleDurableGraphqlRequest,
} from "./c6-source-v3-simple-census-transport";
import {
  acquireC6SourceV3SimpleCensusWriterLock,
} from "./c6-source-v3-simple-census-lock";
import {
  loadC6SourceV4BoundedV3ReuseInput,
} from "./c6-source-v4-bounded-v3-reuse";
import type {
  C6SourceV4BoundedV3CommittedRequest,
} from "./c6-source-v4-bounded-v3-runtime";

const EXPECTED_RUNTIME = {
  arch: "arm64",
  bunRevision:
    "700fc117a2fd01ac0201deaa6fa69c5557acb04f",
  bunVersion: "1.3.12",
  nodeVersion: "24.3.0",
} as const;
const VERIFIED_SNAPSHOT =
  Symbol("C6 source-v4 bounded verified snapshot");
const VERIFIED_SNAPSHOT_IDENTITIES = new WeakMap<
  object,
  {
    assetBytes: number;
    serializedAssetLock: string;
  }
>();
const FILE_MODE = 0o600;
const FILES = {
  committedRequestEntries:
    "v3-committed-request-entries.json",
  contract: "contract.json",
  frame: "v3-frame.json",
  frameRepositories:
    "v3-frame-repositories.json",
  manifest: "snapshot-manifest.json",
  normalizedRepositories:
    "v3-normalized-repositories.json",
  pilotExclusionReceipt:
    "pilot-exclusion-receipt.json",
  pilotRepositoryNodeIds:
    "v3-pilot-repository-node-ids.json",
  prefixReuseReceipt:
    "prefix-reuse-receipt.json",
  repositoryDecisions:
    "v3-repository-decisions.json",
  repositoryLeafClosures:
    "v3-repository-leaf-closures.json",
  selectionReceipt: "selection-receipt.json",
} as const;

const sha256Schema = z.string().regex(
  /^[a-f0-9]{64}$/u,
);
const persistedRequestSchema = z.object({
  bodyBytes: z.number().int().positive(),
  bodySha256: sha256Schema,
  endpoint: z.string().url(),
  headers: z.record(z.string(), z.string()),
  method: z.literal("POST"),
  operationName: z.string().min(1),
  queryBytes: z.number().int().positive(),
  querySha256: sha256Schema,
  redirect: z.literal("error"),
  variables: z.record(z.string(), z.unknown()),
  variablesSha256: sha256Schema,
}).strict();
const serializedCommittedRequestEntrySchema = z.object({
  attemptNumber: z.number().int().min(1).max(4),
  logicalRequestOrdinal: z.number().int().positive(),
  request: z.object({
    bodyBase64: z.string().min(1),
    persistedRequest: persistedRequestSchema,
  }).strict(),
  requestBodySha256: sha256Schema,
  requestCommittedSha256: sha256Schema,
  requestSha256: sha256Schema,
}).strict();

type C6SourceV4BoundedV3ReuseInput =
  Awaited<
    ReturnType<
      typeof loadC6SourceV4BoundedV3ReuseInput
    >
  >;

export interface LoadedC6SourceV4BoundedSnapshot {
  readonly [VERIFIED_SNAPSHOT]: true;
  assetBytes: number;
  assetLock: LoadedC6AssetLock;
  manifest: ReturnType<typeof buildSnapshotManifest>;
  pilotExclusionReceipt:
    LoadedC6SourceV4BoundedPilotExclusionReceipt;
  prefixReceipt:
    LoadedC6SourceV4BoundedV3PrefixReuseReceipt;
  selectionReceipt:
    LoadedC6SourceV4BoundedSelectionReceipt;
  v3Reuse: C6SourceV4BoundedV3ReuseInput;
}

export async function materializeC6SourceV4BoundedSnapshot(
  input: {
    outputRoot: string;
    v3AssetRoot: string;
  },
): Promise<LoadedC6SourceV4BoundedSnapshot> {
  assertExactKeys(
    input,
    ["outputRoot", "v3AssetRoot"],
    "C6 source-v4 bounded snapshot input",
  );
  assertMaterializationRuntime();
  const outputRoot = join(
    await assertC6NoSymlinkPathComponents(
      dirname(input.outputRoot),
      "C6 source-v4 bounded snapshot parent",
    ),
    input.outputRoot.split("/").at(-1)!,
  );
  if (await pathExists(outputRoot)) {
    throw new Error(
      "C6 source-v4 bounded snapshot output already exists",
    );
  }
  return await withC6SourceV4BoundedV3SnapshotLock(
    input.v3AssetRoot,
    () =>
      materializeC6SourceV4BoundedSnapshotLocked({
        outputRoot,
        v3AssetRoot: input.v3AssetRoot,
      }),
  );
}

async function materializeC6SourceV4BoundedSnapshotLocked(
  input: {
    outputRoot: string;
    v3AssetRoot: string;
  },
): Promise<LoadedC6SourceV4BoundedSnapshot> {
  if (await pathExists(input.outputRoot)) {
    throw new Error(
      "C6 source-v4 bounded snapshot output already exists",
    );
  }
  const v3Reuse =
    await loadC6SourceV4BoundedV3ReuseInput({
      v3AssetRoot: input.v3AssetRoot,
    });
  const prefixReceipt =
    buildC6SourceV4BoundedV3PrefixReuseReceipt(v3Reuse);
  const pilotExclusionReceipt =
    buildC6SourceV4BoundedPilotExclusionReceipt({
      prefixReceipt,
      v3Reuse,
    });
  const selectionReceipt =
    buildC6SourceV4BoundedSelectionReceipt({
      pilotExclusionReceipt,
      prefixReceipt,
      v3Reuse,
    });
  const manifest = buildSnapshotManifest({
    pilotExclusionReceipt,
    prefixReceipt,
    selectionReceipt,
    v3Reuse,
  });

  const temporaryRoot = await mkdtemp(join(
    dirname(input.outputRoot),
    ".c6-source-v4-bounded-snapshot-",
  ));
  let published = false;
  try {
    await Promise.all([
      writeCanonicalFile(
        temporaryRoot,
        FILES.contract,
        serializeC6SourceV4BoundedContract(
          buildC6SourceV4BoundedContract(),
        ),
      ),
      writeCanonicalFile(
        temporaryRoot,
        FILES.frame,
        canonicalJson(v3Reuse.frame),
      ),
      writeCanonicalFile(
        temporaryRoot,
        FILES.frameRepositories,
        canonicalJson(v3Reuse.frameRepositories),
      ),
      writeCanonicalFile(
        temporaryRoot,
        FILES.normalizedRepositories,
        canonicalJson(v3Reuse.repositories),
      ),
      writeCanonicalFile(
        temporaryRoot,
        FILES.repositoryDecisions,
        canonicalJson(v3Reuse.repositoryDecisions),
      ),
      writeCanonicalFile(
        temporaryRoot,
        FILES.repositoryLeafClosures,
        canonicalJson(v3Reuse.repositoryLeafClosures),
      ),
      writeCanonicalFile(
        temporaryRoot,
        FILES.committedRequestEntries,
        canonicalJson(
          v3Reuse.durableRequestEntries.map(
            serializeCommittedRequestEntry,
          ),
        ),
      ),
      writeCanonicalFile(
        temporaryRoot,
        FILES.pilotRepositoryNodeIds,
        canonicalJson(
          v3Reuse.pilotRepositoryNodeIds,
        ),
      ),
      writeCanonicalFile(
        temporaryRoot,
        FILES.prefixReuseReceipt,
        serializeC6SourceV4BoundedV3PrefixReuseReceipt(
          prefixReceipt.receipt,
        ),
      ),
      writeCanonicalFile(
        temporaryRoot,
        FILES.pilotExclusionReceipt,
        serializeC6SourceV4BoundedPilotExclusionReceipt(
          pilotExclusionReceipt.receipt,
        ),
      ),
      writeCanonicalFile(
        temporaryRoot,
        FILES.selectionReceipt,
        serializeC6SourceV4BoundedSelectionReceipt(
          selectionReceipt.receipt,
        ),
      ),
      writeCanonicalFile(
        temporaryRoot,
        FILES.manifest,
        canonicalJson(manifest),
      ),
    ]);
    const assetLock =
      await buildC6AssetLock(temporaryRoot);
    const serializedAssetLock =
      serializeC6AssetLock(assetLock);
    const assetBytes =
      assetLock.files.reduce(
        (sum, file) => sum + file.bytes,
        Buffer.byteLength(serializedAssetLock),
      );
    if (
      assetBytes >
      C6_SOURCE_V4_BOUNDED_MAX_CANONICAL_ASSET_BYTES
    ) {
      throw new Error(
        "C6 source-v4 bounded snapshot exceeds the canonical asset byte budget",
      );
    }
    await writeCanonicalFile(
      temporaryRoot,
      "asset-lock.json",
      serializedAssetLock,
    );
    await loadC6SourceV4BoundedV3ReuseInput({
      v3AssetRoot: input.v3AssetRoot,
    });
    await rename(
      temporaryRoot,
      input.outputRoot,
    );
    published = true;
    return await loadC6SourceV4BoundedSnapshot(
      input.outputRoot,
    );
  } catch (cause) {
    await rm(
      published
        ? input.outputRoot
        : temporaryRoot,
      {
        force: true,
        recursive: true,
      },
    );
    throw cause;
  }
}

/** @internal Holds the historical writer fence for the full snapshot transaction. */
export async function withC6SourceV4BoundedV3SnapshotLock<T>(
  v3AssetRoot: string,
  run: () => Promise<T>,
): Promise<T> {
  const lock =
    await acquireC6SourceV3SimpleCensusWriterLock({
      assetRoot: v3AssetRoot,
      evaluationId:
        C6_SOURCE_V4_BOUNDED_V3_EVALUATION_ID,
      executionContractSha256:
        C6_SOURCE_V4_BOUNDED_V3_EXECUTION_CONTRACT_SHA256,
    });
  try {
    return await run();
  } finally {
    await lock.release();
  }
}

export async function loadC6SourceV4BoundedSnapshot(
  root: string,
): Promise<LoadedC6SourceV4BoundedSnapshot> {
  await assertExactSnapshotEntries(root);
  const assetLock = await loadC6AssetLock(root);
  const expectedAssetPaths =
    Object.values(FILES).sort(compareUtf8);
  const actualAssetPaths =
    assetLock.assetLock.files.map(
      (file) => file.path,
    );
  if (
    actualAssetPaths.length !==
      expectedAssetPaths.length ||
    actualAssetPaths.some(
      (path, index) =>
        path !== expectedAssetPaths[index],
    )
  ) {
    throw new Error(
      "C6 source-v4 bounded snapshot asset path set mismatch",
    );
  }
  const [
    contractBytes,
    frame,
    frameRepositories,
    normalizedRepositories,
    repositoryDecisions,
    repositoryLeafClosures,
    serializedCommittedRequestEntries,
    pilotRepositoryNodeIds,
    prefixReceiptBytes,
    pilotExclusionReceiptBytes,
    selectionReceiptBytes,
    manifest,
  ] = await Promise.all([
    readSnapshotFile(root, FILES.contract),
    readSnapshotJson(root, FILES.frame),
    readSnapshotJson(
      root,
      FILES.frameRepositories,
    ),
    readSnapshotJson(
      root,
      FILES.normalizedRepositories,
    ),
    readSnapshotJson(
      root,
      FILES.repositoryDecisions,
    ),
    readSnapshotJson(
      root,
      FILES.repositoryLeafClosures,
    ),
    readSnapshotJson(
      root,
      FILES.committedRequestEntries,
    ),
    readSnapshotJson(
      root,
      FILES.pilotRepositoryNodeIds,
    ),
    readSnapshotFile(
      root,
      FILES.prefixReuseReceipt,
    ),
    readSnapshotFile(
      root,
      FILES.pilotExclusionReceipt,
    ),
    readSnapshotFile(
      root,
      FILES.selectionReceipt,
    ),
    readSnapshotJson(root, FILES.manifest),
  ]);
  parseC6SourceV4BoundedContract(contractBytes);
  if (
    sha256(contractBytes) !==
      C6_SOURCE_V4_BOUNDED_CONTRACT_SHA256
  ) {
    throw new Error(
      "C6 source-v4 bounded snapshot contract hash mismatch",
    );
  }
  if (
    !Array.isArray(frameRepositories) ||
    !Array.isArray(normalizedRepositories) ||
    !Array.isArray(repositoryDecisions) ||
    !Array.isArray(repositoryLeafClosures) ||
    !Array.isArray(serializedCommittedRequestEntries) ||
    !Array.isArray(pilotRepositoryNodeIds) ||
    !pilotRepositoryNodeIds.every(
      (value) => typeof value === "string",
    )
  ) {
    throw new Error(
      "C6 source-v4 bounded snapshot array shape mismatch",
    );
  }
  const durableRequestEntries =
    serializedCommittedRequestEntries.map(
      deserializeCommittedRequestEntry,
    );
  const parsedFrame =
    parseC6SourceV3SimpleFrameDefinition(frame);
  const prefixReceipt =
    parseC6SourceV4BoundedV3PrefixReuseReceipt(
      prefixReceiptBytes,
    );
  const pilotExclusionReceipt =
    parseC6SourceV4BoundedPilotExclusionReceipt(
      pilotExclusionReceiptBytes,
    );
  const selectionReceipt =
    parseC6SourceV4BoundedSelectionReceipt(
      selectionReceiptBytes,
    );
  const v3Reuse = {
    committedAttemptCount:
      durableRequestEntries.length,
    committedRequestClosureSha256:
      C6_SOURCE_V4_BOUNDED_V3_OBSERVED_CLOSURE
        .committedRequestClosureSha256,
    durableRequestEntries,
    frame: parsedFrame,
    frameRepositories,
    frameRepositoriesSha256:
      hashJson(frameRepositories),
    frozenInputClosure:
      manifestFrozenInputClosure(manifest),
    pilotPullRequestAttemptCount:
      durableRequestEntries.filter(
        (entry) =>
          entry.request.persistedRequest.operationName ===
            "C6SourceV3SimplePullRequestPage",
      ).length,
    pilotRepositoryNodeIds:
      pilotRepositoryNodeIds as string[],
    pilotRepositoryNodeIdsSha256:
      hashJson(pilotRepositoryNodeIds),
    prefixCompletionRootSha256:
      prefixReceipt.receipt.repositoryPrefix
        .prefixCompletionRootSha256,
    repositories: normalizedRepositories,
    repositoriesSha256:
      hashJson(normalizedRepositories),
    repositoryDecisions,
    repositoryDecisionsSha256:
      hashJson(repositoryDecisions),
    repositoryLeafClosures,
    repositoryLeafClosuresSha256:
      hashJson(repositoryLeafClosures),
    requestStructureSha256:
      prefixReceipt.receipt.repositoryPrefix
        .scannerRequestStructureSha256,
  } satisfies C6SourceV4BoundedV3ReuseInput;

  const verifiedPrefix =
    verifyC6SourceV4BoundedV3PrefixReuseReceipt(
      prefixReceipt,
      v3Reuse,
    );
  const verifiedPilotExclusion =
    verifyC6SourceV4BoundedPilotExclusionReceipt(
      pilotExclusionReceipt,
      {
        prefixReceipt: verifiedPrefix,
        v3Reuse,
      },
    );
  const verifiedSelection =
    verifyC6SourceV4BoundedSelectionReceipt(
      selectionReceipt,
      {
        pilotExclusionReceipt:
          verifiedPilotExclusion,
        prefixReceipt: verifiedPrefix,
        v3Reuse,
      },
    );
  const expectedManifest = buildSnapshotManifest({
    pilotExclusionReceipt:
      verifiedPilotExclusion,
    prefixReceipt: verifiedPrefix,
    selectionReceipt: verifiedSelection,
    v3Reuse,
  });
  if (!isDeepStrictEqual(manifest, expectedManifest)) {
    throw new Error(
      "C6 source-v4 bounded snapshot manifest mismatch",
    );
  }
  await verifyC6AssetClosure(root, assetLock);
  await assertExactSnapshotEntries(root);
  const assetLockBytes = await readC6StableRegularFile(
    join(root, "asset-lock.json"),
    "source-v4 bounded snapshot asset lock",
    undefined,
    true,
  );
  const assetBytes = assetLock.assetLock.files.reduce(
    (sum, file) => sum + file.bytes,
    assetLockBytes.length,
  );
  if (
    assetBytes >
    C6_SOURCE_V4_BOUNDED_MAX_CANONICAL_ASSET_BYTES
  ) {
    throw new Error(
      "C6 source-v4 bounded snapshot exceeds the canonical asset byte budget",
    );
  }
  const snapshot = {
    assetBytes,
    assetLock,
    manifest: expectedManifest,
    pilotExclusionReceipt:
      verifiedPilotExclusion,
    prefixReceipt: verifiedPrefix,
    selectionReceipt: verifiedSelection,
    v3Reuse,
  };
  Object.defineProperty(
    snapshot,
    VERIFIED_SNAPSHOT,
    {
      enumerable: false,
      value: true,
    },
  );
  VERIFIED_SNAPSHOT_IDENTITIES.set(snapshot, {
    assetBytes,
    serializedAssetLock:
      assetLockBytes.toString("utf8"),
  });
  return deepFreeze(
    snapshot,
  ) as LoadedC6SourceV4BoundedSnapshot;
}

export function assertC6SourceV4BoundedSnapshotVerified(
  snapshot: LoadedC6SourceV4BoundedSnapshot,
): void {
  const originalIdentity =
    VERIFIED_SNAPSHOT_IDENTITIES.get(snapshot);
  if (
    snapshot[VERIFIED_SNAPSHOT] !== true ||
    originalIdentity === undefined
  ) {
    throw new Error(
      "C6 source-v4 bounded capture requires a verified snapshot",
    );
  }
  try {
    const verifiedPrefix =
      verifyC6SourceV4BoundedV3PrefixReuseReceipt(
        snapshot.prefixReceipt,
        snapshot.v3Reuse,
      );
    const verifiedPilotExclusion =
      verifyC6SourceV4BoundedPilotExclusionReceipt(
        snapshot.pilotExclusionReceipt,
        {
          prefixReceipt: verifiedPrefix,
          v3Reuse: snapshot.v3Reuse,
        },
      );
    const verifiedSelection =
      verifyC6SourceV4BoundedSelectionReceipt(
        snapshot.selectionReceipt,
        {
          pilotExclusionReceipt:
            verifiedPilotExclusion,
          prefixReceipt: verifiedPrefix,
          v3Reuse: snapshot.v3Reuse,
        },
      );
    const expectedManifest = buildSnapshotManifest({
      pilotExclusionReceipt:
        verifiedPilotExclusion,
      prefixReceipt: verifiedPrefix,
      selectionReceipt: verifiedSelection,
      v3Reuse: snapshot.v3Reuse,
    });
    const serializedAssetLock =
      serializeC6AssetLock(
        snapshot.assetLock.assetLock,
      );
    const expectedAssetRootSha256 =
      sha256(JSON.stringify(
        snapshot.assetLock.assetLock.files,
      ));
    const expectedAssetBytes =
      snapshot.assetLock.assetLock.files.reduce(
        (sum, file) => sum + file.bytes,
        Buffer.byteLength(serializedAssetLock),
      );
    if (
      !isDeepStrictEqual(
        snapshot.manifest,
        expectedManifest,
      ) ||
      serializedAssetLock !==
        originalIdentity.serializedAssetLock ||
      snapshot.assetLock.assetLockSha256 !==
        sha256(serializedAssetLock) ||
      snapshot.assetLock.assetLock
        .assetRootSha256 !==
        expectedAssetRootSha256 ||
      snapshot.assetBytes !== expectedAssetBytes ||
      snapshot.assetBytes !==
        originalIdentity.assetBytes
    ) {
      throw new Error(
        "verified snapshot identity mismatch",
      );
    }
  } catch (cause) {
    throw new Error(
      "C6 source-v4 bounded verified snapshot changed after verification",
      { cause },
    );
  }
}

async function assertExactSnapshotEntries(
  root: string,
): Promise<void> {
  const entries = await readdir(root, {
    withFileTypes: true,
  });
  const expected = [
    "asset-lock.json",
    ...Object.values(FILES),
  ].sort(compareUtf8);
  entries.sort((left, right) =>
    compareUtf8(left.name, right.name)
  );
  if (
    entries.length !== expected.length ||
    entries.some(
      (entry, index) =>
        entry.name !== expected[index] ||
        !entry.isFile() ||
        entry.isSymbolicLink(),
    )
  ) {
    throw new Error(
      "C6 source-v4 bounded snapshot root entry set mismatch",
    );
  }
}

function buildSnapshotManifest(
  input: {
    pilotExclusionReceipt:
      LoadedC6SourceV4BoundedPilotExclusionReceipt;
    prefixReceipt:
      LoadedC6SourceV4BoundedV3PrefixReuseReceipt;
    selectionReceipt:
      LoadedC6SourceV4BoundedSelectionReceipt;
    v3Reuse: C6SourceV4BoundedV3ReuseInput;
  },
) {
  return {
    artifactKind:
      "c6-source-v4-bounded-selection-snapshot-manifest",
    boundary: {
      candidateManifestFrozen: false,
      codexRunReady: false,
      independentReviewAccepted: false,
      liveCaptureAuthorized: false,
      selectionMaterialized: true,
      status:
        "asset-locked-selection-snapshot-review-and-freeze-pending",
    },
    counts: {
      committedAttemptCount:
        input.v3Reuse.committedAttemptCount,
      frameRepositoryCount:
        input.v3Reuse.frameRepositories.length,
      normalizedRepositoryCount:
        input.v3Reuse.repositories.length,
      pilotRepositoryNodeIdCount:
        input.v3Reuse.pilotRepositoryNodeIds.length,
      selectedRepositoryCount:
        input.selectionReceipt.receipt
          .selectedRepositories.length,
    },
    evaluationId:
      C6_SOURCE_V4_BOUNDED_EVALUATION_ID,
    historicalV3: {
      frozenInputClosure:
        input.v3Reuse.frozenInputClosure,
      observedClosure:
        C6_SOURCE_V4_BOUNDED_V3_OBSERVED_CLOSURE,
    },
    receipts: {
      pilotExclusionReceiptSha256:
        input.pilotExclusionReceipt.sha256,
      prefixReuseReceiptSha256:
        input.prefixReceipt.sha256,
      selectedRepositoriesSha256:
        input.selectionReceipt.receipt
          .selectedRepositoriesSha256,
      selectionReceiptSha256:
        input.selectionReceipt.sha256,
      v4ContractSha256:
        C6_SOURCE_V4_BOUNDED_CONTRACT_SHA256,
    },
    runtime: EXPECTED_RUNTIME,
    schemaVersion: 1,
  } as const;
}

function manifestFrozenInputClosure(
  manifest: unknown,
): C6SourceV4BoundedV3ReuseInput[
  "frozenInputClosure"
] {
  if (
    typeof manifest !== "object" ||
    manifest === null ||
    !("historicalV3" in manifest) ||
    typeof manifest.historicalV3 !== "object" ||
    manifest.historicalV3 === null ||
    !("frozenInputClosure" in manifest.historicalV3)
  ) {
    throw new Error(
      "C6 source-v4 bounded snapshot manifest frozen input closure is missing",
    );
  }
  return manifest.historicalV3
    .frozenInputClosure as C6SourceV4BoundedV3ReuseInput[
      "frozenInputClosure"
    ];
}

function serializeCommittedRequestEntry(
  entry: C6SourceV4BoundedV3CommittedRequest,
) {
  return {
    attemptNumber: entry.attemptNumber,
    logicalRequestOrdinal:
      entry.logicalRequestOrdinal,
    request: {
      bodyBase64:
        entry.request.body.toString("base64"),
      persistedRequest:
        entry.request.persistedRequest,
    },
    requestBodySha256: entry.requestBodySha256,
    requestCommittedSha256:
      entry.requestCommittedSha256,
    requestSha256: entry.requestSha256,
  };
}

function deserializeCommittedRequestEntry(
  input: unknown,
): C6SourceV4BoundedV3CommittedRequest {
  const value =
    serializedCommittedRequestEntrySchema.parse(input);
  const body = Buffer.from(
    value.request.bodyBase64,
    "base64",
  );
  if (
    body.toString("base64") !==
      value.request.bodyBase64
  ) {
    throw new Error(
      "C6 source-v4 bounded snapshot request body is not canonical base64",
    );
  }
  const request =
    verifyC6SourceV3SimpleDurableGraphqlRequest({
      body,
      persistedRequest:
        value.request.persistedRequest,
    });
  return {
    attemptNumber: value.attemptNumber,
    logicalRequestOrdinal:
      value.logicalRequestOrdinal,
    request,
    requestBodySha256:
      value.requestBodySha256,
    requestCommittedSha256:
      value.requestCommittedSha256,
    requestSha256: value.requestSha256,
  };
}

async function readSnapshotFile(
  root: string,
  path: string,
): Promise<Buffer> {
  return await readC6StableRegularFile(
    join(root, path),
    `source-v4 bounded snapshot ${path}`,
    undefined,
    true,
  );
}

async function readSnapshotJson(
  root: string,
  path: string,
): Promise<unknown> {
  const bytes = await readSnapshotFile(root, path);
  const text = new TextDecoder("utf-8", {
    fatal: true,
  }).decode(bytes);
  const value = JSON.parse(text) as unknown;
  if (text !== canonicalJson(value)) {
    throw new Error(
      `C6 source-v4 bounded snapshot ${path} is not canonical JSON`,
    );
  }
  return value;
}

async function writeCanonicalFile(
  root: string,
  path: string,
  value: string,
): Promise<void> {
  await writeFile(join(root, path), value, {
    flag: "wx",
    mode: FILE_MODE,
  });
}

function assertMaterializationRuntime(): void {
  const actual = {
    arch: process.arch,
    bunRevision: Bun.revision,
    bunVersion: Bun.version,
    nodeVersion: process.versions.node,
  };
  if (!isDeepStrictEqual(actual, EXPECTED_RUNTIME)) {
    throw new Error(
      "C6 source-v4 bounded snapshot requires the exact pinned materialization runtime",
    );
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (cause) {
    if (
      cause instanceof Error &&
      "code" in cause &&
      cause.code === "ENOENT"
    ) {
      return false;
    }
    throw cause;
  }
}

function assertExactKeys(
  value: object,
  expected: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort(compareUtf8);
  const sortedExpected = [...expected].sort(compareUtf8);
  if (
    actual.length !== sortedExpected.length ||
    actual.some(
      (key, index) =>
        key !== sortedExpected[index],
    )
  ) {
    throw new Error(`${label} keys mismatch`);
  }
}

function canonicalJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function hashJson(value: unknown): string {
  return sha256(JSON.stringify(value));
}

function sha256(
  value: string | Uint8Array,
): string {
  return createHash("sha256")
    .update(value)
    .digest("hex");
}

function compareUtf8(
  left: string,
  right: string,
): number {
  return Buffer.compare(
    Buffer.from(left),
    Buffer.from(right),
  );
}

function deepFreeze<T>(
  value: T,
  seen = new WeakSet<object>(),
): T {
  if (
    typeof value !== "object" ||
    value === null ||
    ArrayBuffer.isView(value) ||
    value instanceof ArrayBuffer ||
    seen.has(value)
  ) {
    return value;
  }
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    deepFreeze(
      (
        value as Record<
          PropertyKey,
          unknown
        >
      )[key],
      seen,
    );
  }
  return Object.freeze(value);
}
