import {
  buildProofFileRef,
  verifyProofFileClosure,
} from "../../proof/files";
import type {
  ProofFileRef,
} from "../../proof/files";
import {
  proofIdentity,
} from "../../proof/identity";
import type {
  LegacySourceV4Projection,
} from "./legacy-inputs/source-v4";

export const SOURCE_V4_PROTOCOL_ID =
  "goodmemory-c6-codex-coding-effect-source-v4-bounded-v1";

export interface SourceV4ProtocolResult {
  assetBytes: number;
  captureIdentity: LegacySourceV4Projection["captureIdentity"];
  proofClosure: {
    fileCount: number;
    sha256: string;
  };
  protocolId: typeof SOURCE_V4_PROTOCOL_ID;
  selectedRepositoryCount: number;
}

export async function runSourceV4CaptureProtocol(
  legacy: LegacySourceV4Projection,
  canonicalArtifacts: readonly string[],
): Promise<Omit<SourceV4ProtocolResult, "proofClosure">> {
  assertCanonicalArtifactSet(legacy, canonicalArtifacts);
  return {
    assetBytes: legacy.assetBytes,
    captureIdentity: legacy.captureIdentity,
    protocolId: SOURCE_V4_PROTOCOL_ID,
    selectedRepositoryCount: legacy.selectedRepositoryCount,
  };
}

export async function verifySourceV4CaptureProtocol(
  snapshotRoot: string,
  legacy: LegacySourceV4Projection,
  canonicalArtifacts: readonly string[],
): Promise<SourceV4ProtocolResult> {
  return await verifySourceV4ProofBoundary(
    snapshotRoot,
    legacy,
    canonicalArtifacts,
  );
}

export async function verifySourceV4ProofBoundary(
  snapshotRoot: string,
  legacy: LegacySourceV4Projection,
  canonicalArtifacts: readonly string[],
): Promise<SourceV4ProtocolResult> {
  assertCanonicalArtifactSet(legacy, canonicalArtifacts);
  const assetLock = await buildProofFileRef(snapshotRoot, "asset-lock.json");
  if (assetLock.sha256 !== legacy.captureIdentity.assetLockSha256) {
    throw new Error("source-v4 asset lock identity mismatch");
  }
  const files = [...legacy.files, assetLock].sort(compareProofFiles);
  const verified = await verifyProofFileClosure(snapshotRoot, files);
  const identity = proofIdentity({
    files: verified,
    protocolId: SOURCE_V4_PROTOCOL_ID,
  });
  return {
    assetBytes: legacy.assetBytes,
    captureIdentity: legacy.captureIdentity,
    proofClosure: {
      fileCount: verified.length,
      sha256: identity.sha256,
    },
    protocolId: SOURCE_V4_PROTOCOL_ID,
    selectedRepositoryCount: legacy.selectedRepositoryCount,
  };
}

function compareProofFiles(left: ProofFileRef, right: ProofFileRef): number {
  return Buffer.compare(Buffer.from(left.path), Buffer.from(right.path));
}

function assertCanonicalArtifactSet(
  legacy: LegacySourceV4Projection,
  canonicalArtifacts: readonly string[],
): void {
  const observed = [
    ...legacy.files.map(({ path }) => path),
    "asset-lock.json",
  ].sort(comparePaths);
  const expected = [...canonicalArtifacts].sort(comparePaths);
  if (
    observed.length !== expected.length ||
    observed.some((path, index) => path !== expected[index])
  ) {
    throw new Error("source-v4 canonical artifact set mismatch");
  }
}

function comparePaths(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left), Buffer.from(right));
}
