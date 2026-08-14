import {
  buildC6SourceV4BoundedCapturePlan,
} from "../../../codex-coding-effect/c6-source-v4-bounded-replay";
import {
  loadC6SourceV4BoundedSnapshot,
} from "../../../codex-coding-effect/c6-source-v4-bounded-snapshot";

import type {
  ProofFileRef,
} from "../../../proof/files";

export interface LegacySourceV4Projection {
  assetBytes: number;
  captureIdentity: {
    assetLockSha256: string;
    assetRootSha256: string;
    pilotExclusionReceiptSha256: string;
    prefixReceiptSha256: string;
    selectedRepositoriesSha256: string;
    selectionReceiptSha256: string;
    v4ContractSha256: string;
  };
  files: ProofFileRef[];
  selectedRepositoryCount: number;
}

export async function loadLegacySourceV4Projection(
  snapshotRoot: string,
): Promise<LegacySourceV4Projection> {
  const snapshot = await loadC6SourceV4BoundedSnapshot(snapshotRoot);
  const capturePlan = buildC6SourceV4BoundedCapturePlan(snapshot);
  return {
    assetBytes: snapshot.assetBytes,
    captureIdentity: capturePlan.identity,
    files: snapshot.assetLock.assetLock.files.map(
      ({ bytes, path, sha256 }) => ({ bytes, path, sha256 }),
    ),
    selectedRepositoryCount: capturePlan.selectedRepositories.length,
  };
}

if (import.meta.main) {
  const snapshotRoot = process.argv[2];
  if (snapshotRoot === undefined || snapshotRoot.length === 0) {
    throw new Error("usage: source-v4.ts <snapshot-root>");
  }
  const projection = await loadLegacySourceV4Projection(snapshotRoot);
  process.stdout.write(`${JSON.stringify(projection)}\n`);
}
