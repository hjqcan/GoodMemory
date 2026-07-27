#!/usr/bin/env bun

import {
  materializeC6SourceV4BoundedSnapshot,
} from "./codex-coding-effect/c6-source-v4-bounded-snapshot";

const [v3AssetRoot, outputRoot, ...extra] =
  process.argv.slice(2);
if (
  v3AssetRoot === undefined ||
  outputRoot === undefined ||
  extra.length > 0
) {
  throw new Error(
    "usage: materialize-codex-coding-effect-c6-source-v4-bounded.ts <v3-asset-root> <output-root>",
  );
}

const snapshot =
  await materializeC6SourceV4BoundedSnapshot({
    outputRoot,
    v3AssetRoot,
  });
process.stdout.write(`${JSON.stringify({
  assetBytes: snapshot.assetBytes,
  assetLockSha256:
    snapshot.assetLock.assetLockSha256,
  boundary: snapshot.manifest.boundary,
  outputRoot,
  pilotExclusionReceiptSha256:
    snapshot.pilotExclusionReceipt.sha256,
  prefixReceiptSha256:
    snapshot.prefixReceipt.sha256,
  selectedRepositoriesSha256:
    snapshot.selectionReceipt.receipt
      .selectedRepositoriesSha256,
  selectionReceiptSha256:
    snapshot.selectionReceipt.sha256,
}, null, 2)}\n`);
