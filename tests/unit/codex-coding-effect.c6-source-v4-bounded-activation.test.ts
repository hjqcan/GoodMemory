import { tmpdir } from "node:os";
import {
  join,
  resolve,
} from "node:path";

import {
  describe,
  expect,
  it,
} from "bun:test";

import * as activationModule from "../../scripts/codex-coding-effect/c6-source-v4-bounded-activation";
import {
  assertC6SourceV4BoundedActivationLivenessReport,
  claimC6SourceV4BoundedCapture,
  C6_SOURCE_V4_BOUNDED_CAPTURE_BRIDGE_PATH,
  C6_SOURCE_V4_BOUNDED_CAPTURE_BRIDGE_SOURCE,
  parseC6SourceV4BoundedActivationCliOptions,
  parseC6SourceV4BoundedActivationReceipt,
  parseC6SourceV4BoundedCaptureCliOptions,
  serializeC6SourceV4BoundedActivationReceipt,
} from "../../scripts/codex-coding-effect/c6-source-v4-bounded-activation";
import type {
  C6SourceV4BoundedCaptureAuthorization,
} from "../../scripts/codex-coding-effect/c6-source-v4-bounded-activation";
import {
  C6_SOURCE_V4_BOUNDED_CANONICAL_SNAPSHOT_IDENTITY,
  C6_SOURCE_V4_BOUNDED_SELECTION_CHECKPOINT,
} from "../../scripts/codex-coding-effect/c6-source-v4-bounded-review";

const AUTHOR = "/root";
const REVIEWER =
  "/root/c6_source_v4_bounded_review_v1";
const SNAPSHOT_ROOT = "/tmp/c6-v4-snapshot";
const REPOSITORY_ROOT = resolve(
  import.meta.dir,
  "../..",
);

describe("C6 source-v4 bounded activation lineage", () => {
  it("requires explicit one-shot activation and capture CLI confirmations", () => {
    expect(
      parseC6SourceV4BoundedActivationCliOptions([
        "--activation-commit=3".concat(
          "3".repeat(39),
        ),
        `--author-task-name=${AUTHOR}`,
        "--authorize-one-live-capture",
        "--freeze-commit=4".concat(
          "4".repeat(39),
        ),
        "--output-path=/tmp/activation.json",
        "--review-commit=5".concat(
          "5".repeat(39),
        ),
        `--reviewer-agent-name=${REVIEWER}`,
        `--snapshot-root=${SNAPSHOT_ROOT}`,
      ]),
    ).toMatchObject({
      authorTaskName: AUTHOR,
      authorizeOneLiveCapture: true,
      outputPath: "/tmp/activation.json",
      reviewerAgentName: REVIEWER,
      snapshotRoot: SNAPSHOT_ROOT,
    });
    expect(
      parseC6SourceV4BoundedCaptureCliOptions([
        "--capture-root=/tmp/capture",
        "--execute-one-live-capture",
        "--publication-commit=6".concat(
          "6".repeat(39),
        ),
        `--snapshot-root=${SNAPSHOT_ROOT}`,
      ]),
    ).toEqual({
      captureRoot: "/tmp/capture",
      executeOneLiveCapture: true,
      mode: "execute-one-live-capture",
      publicationCommitSha:
        "6".repeat(40),
      snapshotRoot: SNAPSHOT_ROOT,
    });
    expect(
      parseC6SourceV4BoundedCaptureCliOptions([
        "--capture-root=/tmp/capture",
        "--finalize-only",
        "--publication-commit=6".concat(
          "6".repeat(39),
        ),
        `--snapshot-root=${SNAPSHOT_ROOT}`,
      ]),
    ).toEqual({
      captureRoot: "/tmp/capture",
      finalizeOnly: true,
      mode: "finalize-only",
      publicationCommitSha:
        "6".repeat(40),
      snapshotRoot: SNAPSHOT_ROOT,
    });
    expect(() =>
      parseC6SourceV4BoundedCaptureCliOptions([
        "--capture-root=/tmp/capture",
        "--execute-one-live-capture",
        "--finalize-only",
        "--publication-commit=6".concat(
          "6".repeat(39),
        ),
        `--snapshot-root=${SNAPSHOT_ROOT}`,
      ])
    ).toThrow(
      "exactly one capture mode is required",
    );
    expect(() =>
      parseC6SourceV4BoundedCaptureCliOptions([
        "--capture-root=/tmp/capture",
        "--publication-commit=6".concat(
          "6".repeat(39),
        ),
        `--snapshot-root=${SNAPSHOT_ROOT}`,
      ])
    ).toThrow(
      "exactly one capture mode is required",
    );
  });

  it("keeps live execution private and rejects forged capture authority before creating a root", async () => {
    expect(
      "runC6SourceV4BoundedAuthorizedCapture" in
        activationModule,
    ).toBe(false);
    expect(
      "runC6SourceV4BoundedCaptureCli" in
        activationModule,
    ).toBe(false);
    expect(
      C6_SOURCE_V4_BOUNDED_CAPTURE_BRIDGE_PATH,
    ).toEndWith(".sh");
    expect(
      C6_SOURCE_V4_BOUNDED_CAPTURE_BRIDGE_SOURCE,
    ).toContain("/usr/bin/env -i");
    expect(
      C6_SOURCE_V4_BOUNDED_CAPTURE_BRIDGE_SOURCE,
    ).toContain("--no-addons");
    await expect(
      claimC6SourceV4BoundedCapture({
        authorization:
          {} as C6SourceV4BoundedCaptureAuthorization,
        captureRoot: join(
          tmpdir(),
          "must-not-be-created",
        ),
      }),
    ).rejects.toThrow(
      "requires verified one-shot authority",
    );
  });

  it("runs capture only as a clean direct worker and rejects loader injection", async () => {
    const workerPath = join(
      REPOSITORY_ROOT,
      "scripts/codex-coding-effect/c6-source-v4-bounded-activation.ts",
    );
    const preloadPath = join(
      REPOSITORY_ROOT,
      "scripts/codex-coding-effect/c6-source-v4-bounded-contract.ts",
    );
    const direct = Bun.spawn([
      process.execPath,
      "--config=/dev/null",
      "--no-env-file",
      "--no-install",
      "--no-addons",
      workerPath,
    ], {
      cwd: REPOSITORY_ROOT,
      env: {},
      stderr: "pipe",
      stdout: "ignore",
    });
    const directError =
      await new Response(direct.stderr).text();
    expect(await direct.exited).not.toBe(0);
    expect(directError.length).toBeGreaterThan(0);

    const injected = Bun.spawn([
      process.execPath,
      "--config=/dev/null",
      "--no-env-file",
      "--no-install",
      "--no-addons",
      "--preload",
      preloadPath,
      workerPath,
    ], {
      cwd: REPOSITORY_ROOT,
      env: {},
      stderr: "pipe",
      stdout: "ignore",
    });
    const injectedError =
      await new Response(
        injected.stderr,
      ).text();
    expect(await injected.exited).not.toBe(0);
    expect(injectedError).toContain(
      "capture worker invocation mismatch",
    );
  });

  it("serializes only a non-Codex one-shot live-capture receipt", () => {
    const receipt = activationReceipt();
    const bytes =
      serializeC6SourceV4BoundedActivationReceipt(
        receipt,
      );
    expect(
      parseC6SourceV4BoundedActivationReceipt(
        bytes,
      ).boundary,
    ).toMatchObject({
      candidateManifestFrozen: false,
      codexRunReady: false,
      independentReviewAccepted: true,
      liveCaptureAuthorized: false,
      maxLiveCaptureCount: 1,
      publicationCommitRequired: true,
    });

    const expanded = structuredClone(receipt);
    expanded.boundary.codexRunReady = true;
    expect(() =>
      serializeC6SourceV4BoundedActivationReceipt(
        expanded,
      )
    ).toThrow();

    const v3 = structuredClone(receipt) as {
      artifactKind: string;
    };
    v3.artifactKind =
      "c6-source-v3-simple-promotion-receipt";
    expect(() =>
      parseC6SourceV4BoundedActivationReceipt(
        canonicalJson(v3),
      )
    ).toThrow();
  });

  it("accepts only a clean exact pinned-runtime liveness report", () => {
    const report = cleanLivenessReport();
    expect(() =>
      assertC6SourceV4BoundedActivationLivenessReport(
        report,
      )
    ).not.toThrow();

    const dirty = structuredClone(report);
    dirty.clean = false;
    expect(() =>
      assertC6SourceV4BoundedActivationLivenessReport(
        dirty,
      )
    ).toThrow("clean pinned liveness report");

    const short = structuredClone(report);
    short.observations[0]!
      .completedWorkItems -= 1;
    expect(() =>
      assertC6SourceV4BoundedActivationLivenessReport(
        short,
      )
    ).toThrow();
  });

});

function activationReceipt() {
  const freeze = "e".repeat(40);
  const review = "f".repeat(40);
  return {
    artifactKind:
      "c6-source-v4-bounded-activation-receipt",
    authorTaskName: AUTHOR,
    boundary: {
      candidateManifestFrozen: false,
      codexRunReady: false,
      independentReviewAccepted: true,
      liveCaptureAuthorized: false,
      maxLiveCaptureCount: 1,
      publicationCommitRequired: true,
      sourceSelectionFrozen: true,
    },
    captureTarget: {
      path:
        "/tmp/c6-source-v4-bounded-live-capture-v1",
      scope:
        "host-local-activated-repository-root",
    },
    bridge: {
      byteLength: Buffer.byteLength(
        C6_SOURCE_V4_BOUNDED_CAPTURE_BRIDGE_SOURCE,
      ),
      gitBlobSha1: "1".repeat(40),
      mode: "100644",
      path:
        C6_SOURCE_V4_BOUNDED_CAPTURE_BRIDGE_PATH,
      sha256: "2".repeat(64),
    },
    evaluationId:
      "goodmemory-c6-codex-coding-effect-source-v4-bounded-v1",
    generatedAt:
      "2026-07-27T22:40:00.000Z",
    lineage: {
      activation: {
        commitSha: "3".repeat(40),
        parentCommitSha: review,
        treeSha: "4".repeat(40),
      },
      freeze: {
        commitSha: freeze,
        parentCommitSha: "5".repeat(40),
        treeSha: "6".repeat(40),
      },
      review: {
        commitSha: review,
        parentCommitSha: freeze,
        treeSha: "7".repeat(40),
      },
      selectionCheckpoint:
        C6_SOURCE_V4_BOUNDED_SELECTION_CHECKPOINT,
    },
    livenessReport: cleanLivenessReport(),
    reviewEvidence: {
      cryptographicReviewIndependence: false,
      dispatchSha256: "8".repeat(64),
      inputSha256: "9".repeat(64),
      provenanceSha256: "a".repeat(64),
      requestSha256: "b".repeat(64),
      responseSha256: "c".repeat(64),
      reviewReceiptStructureVerified: true,
    },
    reviewerAgentName: REVIEWER,
    runtime: {
      arch: "arm64",
      bunExecutableSha256:
        "39e644cea4e6db24a3af36013695655d6f789b4b98f1f13bacb882ac6e5c3c18",
      bunRevision:
        "700fc117a2fd01ac0201deaa6fa69c5557acb04f",
      bunVersion: "1.3.12",
      nodeVersion: "24.3.0",
      platform: "darwin",
    },
    schemaVersion: 1,
    snapshot:
      C6_SOURCE_V4_BOUNDED_CANONICAL_SNAPSHOT_IDENTITY,
    status:
      "prepared-publication-commit-required-no-live-or-codex-authority",
  };
}

function cleanLivenessReport() {
  const seeds = [
    0x1a2b3c4d,
    0x5e6f7788,
    0x10293847,
  ];
  return {
    artifactKind:
      "c6-bun-fs-liveness-stress-report",
    clean: true,
    completedAt:
      "2026-07-27T22:20:01.000Z",
    configuration: {
      concurrency: 8,
      fsPromiseOperationsPerSeed: 700_000,
      seedCount: 3,
      timeoutMsPerSeed: 180_000,
      workItemsPerSeed: 100_000,
    },
    durationMs: 4_000,
    expected: {
      arch: "arm64",
      bunExecutableSha256:
        "39e644cea4e6db24a3af36013695655d6f789b4b98f1f13bacb882ac6e5c3c18",
      bunRevision:
        "700fc117a2fd01ac0201deaa6fa69c5557acb04f",
      bunVersion: "1.3.12",
      platform: "darwin",
      scriptSha256:
        "019cde93809a7cf052b33a965d562a7b8466726766dbf28ccfa8d1ba66b9ce90",
    },
    observations: seeds.map((seed) => ({
      completedFsPromiseOperations:
        700_000,
      completedWorkItems: 100_000,
      durationMs: 1_000,
      exitCode: 0,
      failureReason: null,
      protocolErrors: [],
      resultSha256: "c".repeat(64),
      runtime: {
        arch: "arm64",
        bunRevision:
          "700fc117a2fd01ac0201deaa6fa69c5557acb04f",
        bunVersion: "1.3.12",
        executable: "/pinned/bun",
        executableSha256:
          "39e644cea4e6db24a3af36013695655d6f789b4b98f1f13bacb882ac6e5c3c18",
        platform: "darwin",
        scriptSha256:
          "019cde93809a7cf052b33a965d562a7b8466726766dbf28ccfa8d1ba66b9ce90",
      },
      seed,
      signalCode: null,
      startSha256: "d".repeat(64),
      status: "passed",
      stderrTail: "",
      terminationSignalRequested: null,
      timedOut: false,
    })),
    schemaVersion: 2,
    selectedBunExecutable: "/pinned/bun",
    startedAt:
      "2026-07-27T22:20:00.000Z",
  };
}

function canonicalJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}
