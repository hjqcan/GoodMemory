import { describe, expect, it } from "bun:test";
import {
  cp,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  loadC6TransitionEvaluatorReviewReceipt,
} from "../../scripts/codex-coding-effect/c6-transition-evaluator-review-receipt";
import {
  buildC6AssetLock,
  serializeC6AssetLock,
} from "../../scripts/codex-coding-effect/c6-asset-lock";

const RECEIPT_ROOT = resolve(
  "fixtures/codex-coding-effect/" +
    "c6-fmt974-transition-evaluator-review-receipt",
);

describe("C6 transition-evaluator independent review receipt", () => {
  it("binds the scoped read-only acceptance without authenticating execution or promotion", async () => {
    const loaded = await loadC6TransitionEvaluatorReviewReceipt({
      receiptRoot: RECEIPT_ROOT,
      repositoryRoot: resolve("."),
    });

    expect(loaded.receipt.review.verdict).toBe(
      "frozen-receipt-rejection-derivation-accepted",
    );
    expect(loaded.receipt.review.noRemainingBlockersWithinScope).toBe(true);
    expect(loaded.receipt.review).toMatchObject({
      candidateManifestFrozen: false,
      codexRunReady: false,
      episodeAccepted: false,
      executionAuthenticated: false,
      machineQualified: false,
      originalExecutionWitnessed: false,
      reviewCryptographicReceipt: false,
      reviewerEditedFiles: false,
      reviewerIdentityCryptographicallyAttested: false,
    });
    expect(loaded.transitionScreening.derived).toMatchObject({
      acceptedEpisodeCount: 0,
      candidateManifestFrozen: false,
      codexRunReady: false,
      machineQualifiedCount: 0,
    });
    expect(loaded.semanticScreeningState).toMatchObject({
      assessedCandidateCount: 42,
      continuationAnchorIds: [
        "fmtlib/fmt#974",
        "vuejs/core#9213",
        "clap-rs/clap#2796",
        "fmtlib/fmt#2310",
        "tokio-rs/tokio#5343",
      ],
      nextUnauditedCappedPoolRank: 43,
      rejectedCandidateCount: 37,
    });
  });

  it("rejects a relocked receipt that upgrades unauthenticated review claims", async () => {
    await expectRelockedReceiptMutationRejected((receipt) => {
      receipt.review.executionAuthenticated = true;
      receipt.review.machineQualified = true;
    });
  });

  it("rejects a relocked amendment basis that no longer matches the reviewed ledger prefix", async () => {
    await expectRelockedReceiptMutationRejected((receipt) => {
      receipt.bindings.semanticLedger
        .amendmentBasisAssessmentPrefixSha256 = "a".repeat(64);
    });
  });
});

interface MutableReceipt {
  bindings: {
    semanticLedger: {
      amendmentBasisAssessmentPrefixSha256: string;
    };
  };
  review: {
    executionAuthenticated: boolean;
    machineQualified: boolean;
  };
}

async function expectRelockedReceiptMutationRejected(
  mutate: (receipt: MutableReceipt) => void,
): Promise<void> {
  const root = await mkdtemp(
    join(
      await realpath(tmpdir()),
      "goodmemory-c6-review-receipt-",
    ),
  );
  try {
    await cp(RECEIPT_ROOT, root, { recursive: true });
    const receiptPath = join(root, "receipt.json");
    const receipt = JSON.parse(
      await readFile(receiptPath, "utf8"),
    ) as MutableReceipt;
    mutate(receipt);
    await writeFile(
      receiptPath,
      `${JSON.stringify(receipt, null, 2)}\n`,
    );
    await writeFile(
      join(root, "asset-lock.json"),
      serializeC6AssetLock(await buildC6AssetLock(root)),
    );

    await expect(loadC6TransitionEvaluatorReviewReceipt({
      receiptRoot: root,
      repositoryRoot: resolve("."),
    })).rejects.toThrow();
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}
