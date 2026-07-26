import { createHash } from "node:crypto";
import { dirname } from "node:path";

import { describe, expect, it } from "bun:test";

import {
  C6_SOURCE_V3_SIMPLE_CENSUS_ACTIVATION_BRIDGE_PATH,
  C6_SOURCE_V3_SIMPLE_CENSUS_ACTIVATION_BRIDGE_SOURCE,
  C6_SOURCE_V3_SIMPLE_CENSUS_REQUIRED_REVIEW_CHECKS,
  C6_SOURCE_V3_SIMPLE_CENSUS_REQUIRED_REVIEW_COMMANDS,
  buildC6SourceV3SimpleCensusRuntimeAuthorization,
  parseC6SourceV3SimpleCensusActivationReceipt,
  requireC6SourceV3SimpleCensusRuntimeAuthorization,
  verifyC6SourceV3SimpleCensusReviewScope,
} from "../../scripts/codex-coding-effect/c6-source-v3-simple-census-activation";

const SHA1 = "1".repeat(40);
const SHA256 = "2".repeat(64);

describe("C6 source-v3-simple runtime activation", () => {
  it("keeps the reviewed bridge exact and rejects authority expansion", () => {
    const receipt = activationReceipt();

    expect(
      parseC6SourceV3SimpleCensusActivationReceipt(
        canonical(receipt),
      ),
    ).toEqual(receipt);
    expect(receipt.activationBridge).toEqual({
      bytes: Buffer.byteLength(
        C6_SOURCE_V3_SIMPLE_CENSUS_ACTIVATION_BRIDGE_SOURCE,
      ),
      path:
        C6_SOURCE_V3_SIMPLE_CENSUS_ACTIVATION_BRIDGE_PATH,
      sha256: createHash("sha256")
        .update(
          C6_SOURCE_V3_SIMPLE_CENSUS_ACTIVATION_BRIDGE_SOURCE,
        )
        .digest("hex"),
    });
    expect(() =>
      parseC6SourceV3SimpleCensusActivationReceipt(
        canonical({
          ...receipt,
          boundary: {
            ...receipt.boundary,
            candidateSelectionPermitted: true,
          },
        }),
      )
    ).toThrow();
    expect(() =>
      parseC6SourceV3SimpleCensusActivationReceipt(
        canonical({
          ...receipt,
          activationCommitSha: SHA1,
        }),
      )
    ).toThrow();
  });

  it("rejects a caller-selected repository before parsing an activation receipt", async () => {
    await expect(
      requireC6SourceV3SimpleCensusRuntimeAuthorization({
        activationReceiptBytes: "{}\n",
        repositoryRoot: dirname(process.cwd()),
      }),
    ).rejects.toThrow("running repository");
  });

  it("requires the exact reviewed checks and verification commands", () => {
    const acceptedChecks = [
      ...C6_SOURCE_V3_SIMPLE_CENSUS_REQUIRED_REVIEW_CHECKS,
    ];
    const verificationCommands = [
      ...C6_SOURCE_V3_SIMPLE_CENSUS_REQUIRED_REVIEW_COMMANDS,
    ];
    expect(() =>
      verifyC6SourceV3SimpleCensusReviewScope({
        acceptedChecks,
        requestedChecks: acceptedChecks,
        verificationCommands,
      })
    ).not.toThrow();
    for (const requestedChecks of [
      acceptedChecks.slice(1),
      [...acceptedChecks, "unreviewed-extra"],
      [...acceptedChecks].reverse(),
    ]) {
      expect(() =>
        verifyC6SourceV3SimpleCensusReviewScope({
          acceptedChecks,
          requestedChecks,
          verificationCommands,
        })
      ).toThrow("review scope");
    }
    expect(() =>
      verifyC6SourceV3SimpleCensusReviewScope({
        acceptedChecks: acceptedChecks.slice(1),
        requestedChecks: acceptedChecks,
        verificationCommands,
      })
    ).toThrow("review scope");
    expect(() =>
      verifyC6SourceV3SimpleCensusReviewScope({
        acceptedChecks,
        requestedChecks: acceptedChecks,
        verificationCommands:
          verificationCommands.slice(1),
      })
    ).toThrow("review scope");
  });

  it("derives one canonical runtime authorization snapshot and hash", () => {
    const receipt = activationReceipt();
    const activationReceiptReference = {
      bytes: Buffer.byteLength(canonical(receipt)),
      path:
        "fixtures/codex-coding-effect/c6-source-pool/" +
        "provenance/source-v3-simple/census-runtime/" +
        "activation-receipt-v1.json",
      sha256: createHash("sha256")
        .update(canonical(receipt))
        .digest("hex"),
    };
    const authorization =
      buildC6SourceV3SimpleCensusRuntimeAuthorization({
        activationCommit: {
          commitSha: "3".repeat(40),
          parentCommitSha:
            receipt.reviewCommit.commitSha,
          treeSha: "4".repeat(40),
        },
        activationReceipt:
          activationReceiptReference,
        receipt,
      });

    expect(
      authorization.snapshot.activationReceipt,
    ).toEqual(activationReceiptReference);
    expect(
      authorization.snapshot.freeze,
    ).toEqual(receipt.freeze);
    expect(
      authorization.runtimeAuthorizationSha256,
    ).toBe(
      createHash("sha256")
        .update(JSON.stringify(
          authorization.snapshot,
        ))
        .digest("hex"),
    );
    expect(
      authorization.snapshot
        .runtimeSourceAggregateSha256,
    ).toBe(receipt.runtimeSourceAggregateSha256);
  });
});

function activationReceipt() {
  const reference = (path: string) => ({
    bytes: 1,
    path,
    sha256: SHA256,
  });
  return {
    activationBridge: {
      bytes: Buffer.byteLength(
        C6_SOURCE_V3_SIMPLE_CENSUS_ACTIVATION_BRIDGE_SOURCE,
      ),
      path:
        C6_SOURCE_V3_SIMPLE_CENSUS_ACTIVATION_BRIDGE_PATH,
      sha256: createHash("sha256")
        .update(
          C6_SOURCE_V3_SIMPLE_CENSUS_ACTIVATION_BRIDGE_SOURCE,
        )
        .digest("hex"),
    },
    artifactKind:
      "c6-source-v3-simple-census-runtime-activation-receipt",
    boundary: {
      acceptedEpisodeCount: 0,
      candidateManifestFrozen: false,
      candidateSelectionPermitted: false,
      codexRunReady: false,
      formalCensusLiveNetworkPermitted: true,
    },
    evaluationId:
      "goodmemory-c6-codex-coding-effect-source-v3-simple-v1",
    executionContract:
      reference("contract.json"),
    freeze: {
      commitSha: SHA1,
      parentCommitSha: SHA1,
      treeSha: SHA1,
    },
    promotionReceipt:
      reference("promotion.json"),
    reviewCommit: {
      commitSha: SHA1,
      parentCommitSha: SHA1,
      treeSha: SHA1,
    },
    reviewProvenance:
      reference("review.json"),
    runtimeSourceManifest:
      reference("manifest.json"),
    runtimeSourceAggregateSha256: SHA256,
    runtimeVersions: {
      bun: Bun.version,
      node: process.versions.node,
    },
    schemaVersion: 1,
    status:
      "formal-census-live-network-only-no-candidate-selection-or-codex-run-authority",
  } as const;
}

function canonical(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}
