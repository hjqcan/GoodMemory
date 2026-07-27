import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  dirname,
  join,
} from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "bun:test";

import {
  C6_SOURCE_V3_SIMPLE_CENSUS_ACTIVATION_BRIDGE_PATH,
  C6_SOURCE_V3_SIMPLE_CENSUS_ACTIVATION_BRIDGE_SOURCE,
  C6_SOURCE_V3_SIMPLE_CENSUS_ACTIVATION_RECEIPT_PATH,
  C6_SOURCE_V3_SIMPLE_CENSUS_REQUIRED_REVIEW_CHECKS,
  C6_SOURCE_V3_SIMPLE_CENSUS_REQUIRED_REVIEW_COMMANDS,
  buildC6SourceV3SimpleCensusRuntimeAuthorization,
  locateActivationCommit,
  parseC6SourceV3SimpleCensusActivationReceipt,
  requireC6SourceV3SimpleCensusRuntimeAuthorization,
  verifyC6SourceV3SimpleCensusReviewScope,
} from "../../scripts/codex-coding-effect/c6-source-v3-simple-census-activation";

const execFileAsync = promisify(execFile);
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

  it("locates the activation directly after its bound review across refreeze history", async () => {
    const root = await mkdtemp(join(
      tmpdir(),
      "goodmemory-c6-activation-history-",
    ));
    try {
      await git(root, ["init", "--quiet"]);
      await git(root, [
        "config",
        "user.name",
        "C6 Test",
      ]);
      await git(root, [
        "config",
        "user.email",
        "c6@example.invalid",
      ]);
      await git(root, [
        "commit",
        "--allow-empty",
        "-m",
        "old review",
      ]);
      const receiptPath = join(
        root,
        C6_SOURCE_V3_SIMPLE_CENSUS_ACTIVATION_RECEIPT_PATH,
      );
      await mkdir(dirname(receiptPath), {
        recursive: true,
      });
      await writeFile(receiptPath, "{}\n");
      await git(root, [
        "add",
        C6_SOURCE_V3_SIMPLE_CENSUS_ACTIVATION_RECEIPT_PATH,
      ]);
      await git(root, ["commit", "-m", "old activation"]);
      await rm(receiptPath);
      await git(root, [
        "add",
        C6_SOURCE_V3_SIMPLE_CENSUS_ACTIVATION_RECEIPT_PATH,
      ]);
      await git(root, [
        "commit",
        "-m",
        "invalidate old activation",
      ]);
      await git(root, [
        "commit",
        "--allow-empty",
        "-m",
        "new review",
      ]);
      const reviewCommitSha = await gitOutput(
        root,
        ["rev-parse", "HEAD"],
      );
      await writeFile(receiptPath, "{}\n");
      await git(root, [
        "add",
        C6_SOURCE_V3_SIMPLE_CENSUS_ACTIVATION_RECEIPT_PATH,
      ]);
      await git(root, ["commit", "-m", "new activation"]);
      const activationCommitSha = await gitOutput(
        root,
        ["rev-parse", "HEAD"],
      );

      expect(
        await locateActivationCommit(
          root,
          reviewCommitSha,
        ),
      ).toBe(activationCommitSha);
    } finally {
      await rm(root, {
        force: true,
        recursive: true,
      });
    }
  });

  it("rejects two activation children hidden by merge history simplification", async () => {
    const root = await mkdtemp(join(
      tmpdir(),
      "goodmemory-c6-activation-merge-",
    ));
    try {
      await git(root, ["init", "--quiet"]);
      await git(root, [
        "config",
        "user.name",
        "C6 Test",
      ]);
      await git(root, [
        "config",
        "user.email",
        "c6@example.invalid",
      ]);
      await git(root, [
        "commit",
        "--allow-empty",
        "-m",
        "review",
      ]);
      const reviewCommitSha = await gitOutput(
        root,
        ["rev-parse", "HEAD"],
      );
      const receiptPath = join(
        root,
        C6_SOURCE_V3_SIMPLE_CENSUS_ACTIVATION_RECEIPT_PATH,
      );
      const bridgePath = join(
        root,
        C6_SOURCE_V3_SIMPLE_CENSUS_ACTIVATION_BRIDGE_PATH,
      );
      await mkdir(dirname(receiptPath), {
        recursive: true,
      });
      await mkdir(dirname(bridgePath), {
        recursive: true,
      });
      await git(root, [
        "switch",
        "-c",
        "activation-a",
      ]);
      await writeFile(receiptPath, "a\n");
      await writeFile(bridgePath, "a\n");
      await git(root, [
        "add",
        C6_SOURCE_V3_SIMPLE_CENSUS_ACTIVATION_RECEIPT_PATH,
        C6_SOURCE_V3_SIMPLE_CENSUS_ACTIVATION_BRIDGE_PATH,
      ]);
      await git(root, ["commit", "-m", "activation a"]);
      await git(root, [
        "switch",
        "-c",
        "activation-b",
        reviewCommitSha,
      ]);
      await mkdir(dirname(receiptPath), {
        recursive: true,
      });
      await mkdir(dirname(bridgePath), {
        recursive: true,
      });
      await writeFile(receiptPath, "b\n");
      await writeFile(bridgePath, "b\n");
      await git(root, [
        "add",
        C6_SOURCE_V3_SIMPLE_CENSUS_ACTIVATION_RECEIPT_PATH,
        C6_SOURCE_V3_SIMPLE_CENSUS_ACTIVATION_BRIDGE_PATH,
      ]);
      await git(root, ["commit", "-m", "activation b"]);
      await git(root, ["switch", "activation-a"]);
      await git(root, [
        "merge",
        "--no-ff",
        "-s",
        "ours",
        "activation-b",
        "-m",
        "merge activations",
      ]);

      await expect(
        locateActivationCommit(
          root,
          reviewCommitSha,
        ),
      ).rejects.toThrow("not unique for review");
    } finally {
      await rm(root, {
        force: true,
        recursive: true,
      });
    }
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

async function git(
  repositoryRoot: string,
  args: string[],
): Promise<void> {
  await execFileAsync("git", args, {
    cwd: repositoryRoot,
  });
}

async function gitOutput(
  repositoryRoot: string,
  args: string[],
): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  return stdout.trim();
}
