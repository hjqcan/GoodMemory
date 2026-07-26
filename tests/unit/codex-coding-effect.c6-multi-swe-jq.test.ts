import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildC6MultiSWEJqChainDecisionLedger,
  loadC6MultiSWEJqAncestryObservations,
  loadC6MultiSWEJqProjectLicenseCapture,
} from "../../scripts/codex-coding-effect/c6-multi-swe-jq-chain-ledger";
import type {
  C6MultiSWEJqAncestryObservation,
} from "../../scripts/codex-coding-effect/c6-multi-swe-jq-chain-ledger";
import {
  buildC6MultiSWEJqSourcePoolSnapshot,
  C6_MULTI_SWE_JQ_SOURCE,
  serializeC6MultiSWEJqSourcePoolSnapshot,
} from "../../scripts/codex-coding-effect/c6-multi-swe-jq-source-pool";
import type {
  C6MultiSWEJqSourcePoolSnapshot,
} from "../../scripts/codex-coding-effect/c6-multi-swe-jq-source-pool";
import {
  parseC6MultiSWEJqSourcePoolCliOptions,
} from "../../scripts/snapshot-codex-coding-effect-c6-multi-swe-jq-source-pool";
import {
  parseC6MultiSWEJqChainLedgerCliOptions,
} from "../../scripts/snapshot-codex-coding-effect-c6-multi-swe-jq-chain-ledger";

describe("Codex coding-effect C6 Multi-SWE-bench jq intake", () => {
  it("commits all 17 raw JSONL records without inventing accepted tasks", () => {
    const records = buildRawRecords();
    const snapshot = buildC6MultiSWEJqSourcePoolSnapshot(records, {
      artifactSha256: sha256("existing source pool"),
      sourceId: "swe-bench-multilingual-e5c585e",
      rows: [{
        baseCommit: sha256("other base").slice(0, 40),
        instanceId: "jqlang__jq-1001",
      }],
    });

    expect(snapshot).toMatchObject({
      boundary: {
        acceptedEpisodeCount: 0,
        candidateChainUniverseComplete: false,
        candidateManifestFrozen: false,
        status: "source-pool-only-origin-ancestry-semantic-and-replay-review-required",
      },
      counts: {
        crossSourceAliases: 1,
        newCanonicalUpstreamTasks: 16,
        observedRows: 17,
        queuedForReview: 17,
        rejectedBeforeUpstreamReview: 0,
        repositories: 1,
      },
      schemaVersion: 1,
      source: C6_MULTI_SWE_JQ_SOURCE,
    });
    expect(snapshot.rows).toHaveLength(17);
    expect(snapshot.rows[0]).toMatchObject({
      canonicalUpstreamIdentity: "https://github.com/jqlang/jq/pull/1000",
      crossSourceAlias: null,
      decision: "queued-for-origin-ancestry-semantic-and-replay-review",
      lineNumber: 1,
      rawRecordBytes: Buffer.byteLength(records[0]!),
      rawRecordSha256: sha256(records[0]!),
    });
    expect(snapshot.rows[1]).toMatchObject({
      canonicalUpstreamIdentity: "https://github.com/jqlang/jq/pull/1001",
      crossSourceAlias: {
        existingBaseCommit: sha256("other base").slice(0, 40),
        existingSourceId: "swe-bench-multilingual-e5c585e",
        sameBaseCommit: false,
      },
    });

    const serialized = serializeC6MultiSWEJqSourcePoolSnapshot(snapshot);
    expect(serialized).not.toContain("original-issue-body-sentinel");
    expect(serialized).not.toContain("solution-pr-body-sentinel");
    expect(serialized).not.toContain("gold-patch-sentinel");
    expect(serialized).not.toContain("test-patch-sentinel");
    expect(serialized).not.toContain("agentVisibleRequestSha256");
    expect(serialized).toEndWith("\n");
  });

  it("requires exact LF-terminated records and unique upstream identities", () => {
    const records = buildRawRecords();
    expect(() =>
      buildC6MultiSWEJqSourcePoolSnapshot([
        records[0]!.trimEnd(),
        ...records.slice(1),
      ], emptyExistingSourcePool())
    ).toThrow("must include its terminating LF");

    const duplicate = JSON.parse(records[1]!) as Record<string, unknown>;
    duplicate.number = 1000;
    duplicate.instance_id = "jqlang__jq-1000";
    expect(() =>
      buildC6MultiSWEJqSourcePoolSnapshot([
        records[0]!,
        `${JSON.stringify(duplicate)}\n`,
        ...records.slice(2),
      ], emptyExistingSourcePool())
    ).toThrow("duplicate canonical upstream identity");
  });

  it("enumerates all 136 pairs and 680 triples while keeping ancestry separate from semantics", () => {
    const snapshot = buildC6MultiSWEJqSourcePoolSnapshot(
      buildRawRecords(),
      emptyExistingSourcePool(),
    );
    const ledger = buildC6MultiSWEJqChainDecisionLedger(
      snapshot,
      buildAncestryObservations(snapshot),
      buildProjectLicenseCapture(snapshot),
    );

    expect(ledger).toMatchObject({
      boundary: {
        acceptedEpisodeCount: 0,
        candidateManifestFrozen: false,
        intakeSelectionClosureComplete: false,
        status: "complete-combinatorial-universe-all-chains-blocked",
      },
      counts: {
        ancestryObservedPairs: 2,
        chainUniverse: 680,
        pairUniverse: 136,
        rowUniverse: 17,
      },
      evidenceBoundary: {
        projectLicenseCapture: {
          coverage: "single-base-capture-only",
          reviewVerified: false,
        },
        projectLicenseReviewVerified: false,
      },
      universe: {
        allCombinationsEnumerated: true,
        memberSerializationOrder: "ascending-pull-number-not-chronology",
        orderingPolicy: "unordered-until-ancestry-and-semantic-dependency-are-both-verified",
      },
    });
    expect(ledger.pairDecisions).toHaveLength(136);
    expect(ledger.chainDecisions).toHaveLength(680);
    expect(new Set(ledger.pairDecisions.map((value) => value.pairId)).size)
      .toBe(136);
    expect(new Set(ledger.chainDecisions.map((value) => value.chainId)).size)
      .toBe(680);

    const observedPair = ledger.pairDecisions.find((value) =>
      value.memberPrNumbers[0] === 1000 &&
      value.memberPrNumbers[1] === 1001
    );
    expect(observedPair).toMatchObject({
      ancestry: {
        direction: {
          fromPrNumber: 1000,
          toPrNumber: 1001,
        },
        status: "local-capture-verified-no-independent-authentication",
      },
      semanticDependency: {
        status: "not-reviewed",
      },
    });

    const canaryTriple = ledger.chainDecisions.find((value) =>
      value.memberPrNumbers.join(",") === "1000,1001,1002"
    );
    expect(canaryTriple).toMatchObject({
      decision: "blocked",
      orderedSourceUnitIds: null,
    });
    expect(canaryTriple?.blockers).toContain(
      "semantic-dependency-not-reviewed",
    );
  });

  it("rejects ancestry observations with reversed time or source-base drift", () => {
    const snapshot = buildC6MultiSWEJqSourcePoolSnapshot(
      buildRawRecords(),
      emptyExistingSourcePool(),
    );
    const observations = buildAncestryObservations(snapshot);
    expect(() =>
      buildC6MultiSWEJqChainDecisionLedger(snapshot, [{
        ...observations[0]!,
        fromMergedAt: "2024-01-03T00:00:00Z",
        toMergedAt: "2024-01-02T00:00:00Z",
      }, observations[1]!], buildProjectLicenseCapture(snapshot))
    ).toThrow("merged-at chronology");
    expect(() =>
      buildC6MultiSWEJqChainDecisionLedger(snapshot, [{
        ...observations[0]!,
        toBaseCommit: sha256("wrong base").slice(0, 40),
      }, observations[1]!], buildProjectLicenseCapture(snapshot))
    ).toThrow("does not match the destination source row");
  });

  it("parses only explicit local source-pool inputs", () => {
    expect(parseC6MultiSWEJqSourcePoolCliOptions([
      "--jsonl-file=/evidence/jq.jsonl",
      "--readme-file=/evidence/README.md",
      "--existing-source-pool=/evidence/swe-source-pool.json",
      "--output=/evidence/jq-source-pool.json",
    ])).toEqual({
      existingSourcePool: "/evidence/swe-source-pool.json",
      jsonlFile: "/evidence/jq.jsonl",
      output: "/evidence/jq-source-pool.json",
      readmeFile: "/evidence/README.md",
    });
    expect(() =>
      parseC6MultiSWEJqSourcePoolCliOptions([
        "--jsonl-file=/evidence/jq.jsonl",
        "--readme-file=/evidence/README.md",
        "--existing-source-pool=/evidence/swe-source-pool.json",
      ])
    ).toThrow("--output is required exactly once");
  });

  it("requires every local ancestry receipt for ledger materialization", () => {
    expect(parseC6MultiSWEJqChainLedgerCliOptions([
      "--jsonl-file=/evidence/jq.jsonl",
      "--readme-file=/evidence/README.md",
      "--existing-source-pool=/evidence/swe-source-pool.json",
      "--pull-2824=/evidence/pull-2824.json",
      "--pull-2839=/evidence/pull-2839.json",
      "--pull-2840=/evidence/pull-2840.json",
      "--compare-2824-to-2839=/evidence/compare-2824-to-2839.json",
      "--compare-2839-to-2840=/evidence/compare-2839-to-2840.json",
      "--project-license=/evidence/jq-COPYING.txt",
      "--output=/evidence/chain-decisions.json",
    ])).toEqual({
      compare2824To2839: "/evidence/compare-2824-to-2839.json",
      compare2839To2840: "/evidence/compare-2839-to-2840.json",
      existingSourcePool: "/evidence/swe-source-pool.json",
      jsonlFile: "/evidence/jq.jsonl",
      output: "/evidence/chain-decisions.json",
      projectLicense: "/evidence/jq-COPYING.txt",
      pull2824: "/evidence/pull-2824.json",
      pull2839: "/evidence/pull-2839.json",
      pull2840: "/evidence/pull-2840.json",
      readmeFile: "/evidence/README.md",
    });
    expect(() =>
      parseC6MultiSWEJqChainLedgerCliOptions([
        "--jsonl-file=/evidence/jq.jsonl",
        "--readme-file=/evidence/README.md",
        "--existing-source-pool=/evidence/swe-source-pool.json",
        "--pull-2824=/evidence/pull-2824.json",
        "--pull-2839=/evidence/pull-2839.json",
        "--pull-2840=/evidence/pull-2840.json",
        "--compare-2824-to-2839=/evidence/compare-2824-to-2839.json",
        "--project-license=/evidence/jq-COPYING.txt",
        "--output=/evidence/chain-decisions.json",
      ])
    ).toThrow("--compare-2839-to-2840 is required exactly once");
  });

  it("tracks the real jq source universe and fail-closed decision ledger", () => {
    const fixtureRoot = join(
      import.meta.dir,
      "../../fixtures/codex-coding-effect/c6-source-pool",
    );
    const sourceBytes = readFileSync(
      join(fixtureRoot, "multi-swe-jq-56ff018.source-pool.json"),
    );
    const ledgerBytes = readFileSync(
      join(fixtureRoot, "multi-swe-jq-56ff018.chain-decisions.json"),
    );
    expect(sourceBytes.byteLength).toBe(25_676);
    expect(sha256(sourceBytes)).toBe(
      "fe513b9810bcc2bee926402c8384a4a0e438dd5ed5495b8d84fe3a4665fe1d4e",
    );
    expect(ledgerBytes.byteLength).toBe(700_325);
    expect(sha256(ledgerBytes)).toBe(
      "4d0942ec59aa3de906c9c621211d84ae7750d2f3d4f953d65f59fdd00d22154a",
    );

    const source = JSON.parse(sourceBytes.toString("utf8")) as {
      boundary: {
        acceptedEpisodeCount: number;
        candidateManifestFrozen: boolean;
      };
      counts: {
        crossSourceAliases: number;
        newCanonicalUpstreamTasks: number;
        observedRows: number;
      };
      rows: C6SourcePoolArtifactRow[];
    };
    expect(source.boundary).toMatchObject({
      acceptedEpisodeCount: 0,
      candidateManifestFrozen: false,
    });
    expect(source.counts).toMatchObject({
      crossSourceAliases: 4,
      newCanonicalUpstreamTasks: 13,
      observedRows: 17,
    });
    expect(source.rows.filter((row) => row.crossSourceAlias !== null))
      .toHaveLength(4);
    expect(source.rows.find((row) => row.upstreamPullNumber === 2824))
      .toMatchObject({
        lineNumber: 7,
        rawRecordBytes: 9977,
        rawRecordSha256:
          "403606fdf9c92f969d5a80a686dc4b1d4da3043c65cc78d86b607d994ff0c757",
      });
    const sourceText = sourceBytes.toString("utf8");
    expect(sourceText).not.toContain("\"body\":");
    expect(sourceText).not.toContain("\"title\":");
    expect(sourceText).not.toContain("\"fix_patch\":");
    expect(sourceText).not.toContain("\"test_patch\":");
    expect(sourceText).not.toContain("agentVisibleRequestSha256");

    const ledger = JSON.parse(ledgerBytes.toString("utf8")) as {
      boundary: {
        acceptedEpisodeCount: number;
        candidateManifestFrozen: boolean;
        intakeSelectionClosureComplete: boolean;
        status: string;
      };
      chainDecisions: Array<{
        decision: string;
        orderedSourceUnitIds: unknown;
      }>;
      counts: {
        ancestryObservedPairs: number;
        chainUniverse: number;
        pairUniverse: number;
        rowUniverse: number;
      };
      evidenceBoundary: {
        independentAncestryAuthenticationVerified: boolean;
        independentSemanticReviewVerified: boolean;
        linuxReplayVerified: boolean;
        projectLicenseCapture: {
          reviewVerified: boolean;
          sha256: string;
        };
        projectLicenseReviewVerified: boolean;
      };
      pairDecisions: Array<{
        ancestry: {
          status: string;
        };
      }>;
      populationSha256: string;
    };
    expect(ledger.populationSha256).toBe(sha256(sourceBytes));
    expect(ledger.boundary).toEqual({
      acceptedEpisodeCount: 0,
      candidateManifestFrozen: false,
      intakeSelectionClosureComplete: false,
      status: "complete-combinatorial-universe-all-chains-blocked",
    });
    expect(ledger.counts).toEqual({
      ancestryObservedPairs: 2,
      chainUniverse: 680,
      pairUniverse: 136,
      rowUniverse: 17,
    });
    expect(ledger.pairDecisions.filter((value) =>
      value.ancestry.status ===
        "local-capture-verified-no-independent-authentication"
    )).toHaveLength(2);
    expect(ledger.chainDecisions.every((value) =>
      value.decision === "blocked" && value.orderedSourceUnitIds === null
    )).toBe(true);
    expect(ledger.evidenceBoundary).toMatchObject({
      independentAncestryAuthenticationVerified: false,
      independentSemanticReviewVerified: false,
      linuxReplayVerified: false,
      projectLicenseCapture: {
        reviewVerified: false,
        sha256:
          "10e974638a41fadfd72357f2f3a4325e20b856c563365128f72feaa406f8c92d",
      },
      projectLicenseReviewVerified: false,
    });

    const receiptRoot = join(
      fixtureRoot,
      "multi-swe-jq-56ff018-receipts",
    );
    for (const [fileName, expectedSha256] of Object.entries({
      "compare-2824-to-2839.json":
        "57e246de3ab255f0589e2b57c6bb52ac427cd9adc5bd02b3386cade30578f4c1",
      "compare-2839-to-2840.json":
        "3d13bdb94f4e7efa849003dbcd9a1e8f9f1839c32b67e184a158902cae99b417",
      "jq-COPYING-f94a9d4.txt":
        "10e974638a41fadfd72357f2f3a4325e20b856c563365128f72feaa406f8c92d",
      "pull-2824.json":
        "78b9a77e6867fad67375ef6362ec96c883f28f2fc4171f2b91b57008eb5bc583",
      "pull-2839.json":
        "f44fb13fc42bfe706ec57430c4a28678beec18f8e6d83c8d4c32b3ffbed21c4e",
      "pull-2840.json":
        "5bc322bd608638e10d12b4dbc182a82c7a8eec1a94d9785c3cc0eaf0ca763dce",
    })) {
      expect(sha256(readFileSync(join(receiptRoot, fileName))))
        .toBe(expectedSha256);
    }
  });

  it("replays the pinned ancestry/license closure and rejects receipt drift", async () => {
    const fixtureRoot = join(
      import.meta.dir,
      "../../fixtures/codex-coding-effect/c6-source-pool",
    );
    const receiptRoot = join(
      fixtureRoot,
      "multi-swe-jq-56ff018-receipts",
    );
    const sourcePool = JSON.parse(readFileSync(
      join(fixtureRoot, "multi-swe-jq-56ff018.source-pool.json"),
      "utf8",
    )) as C6MultiSWEJqSourcePoolSnapshot;
    const paths = {
      compare2824To2839: join(receiptRoot, "compare-2824-to-2839.json"),
      compare2839To2840: join(receiptRoot, "compare-2839-to-2840.json"),
      pull2824: join(receiptRoot, "pull-2824.json"),
      pull2839: join(receiptRoot, "pull-2839.json"),
      pull2840: join(receiptRoot, "pull-2840.json"),
    };
    const observations = await loadC6MultiSWEJqAncestryObservations(
      paths,
      sourcePool,
    );
    expect(observations.map((value) => [
      value.fromPrNumber,
      value.toPrNumber,
    ])).toEqual([
      [2824, 2839],
      [2839, 2840],
    ]);
    await expect(loadC6MultiSWEJqProjectLicenseCapture(
      join(receiptRoot, "jq-COPYING-f94a9d4.txt"),
    )).resolves.toMatchObject({
      coverage: "single-base-capture-only",
      reviewVerified: false,
    });

    const temporaryRoot = await mkdtemp(
      join(tmpdir(), "goodmemory-c6-jq-receipt-"),
    );
    try {
      const drifted = Buffer.from(
        readFileSync(paths.compare2824To2839),
      );
      drifted[100] = drifted[100]! ^ 1;
      const driftedPath = join(temporaryRoot, "drifted-compare.json");
      await writeFile(driftedPath, drifted);
      await expect(loadC6MultiSWEJqAncestryObservations({
        ...paths,
        compare2824To2839: driftedPath,
      }, sourcePool)).rejects.toThrow(
        "C6 jq ancestry receipt compare2824To2839 does not match its frozen bytes",
      );
    } finally {
      await rm(temporaryRoot, { force: true, recursive: true });
    }
  });
});

interface C6SourcePoolArtifactRow {
  crossSourceAlias: Record<string, unknown> | null;
  lineNumber: number;
  rawRecordBytes: number;
  rawRecordSha256: string;
  upstreamPullNumber: number;
}

function buildRawRecords(): string[] {
  return Array.from({ length: 17 }, (_, index) => {
    const number = 1000 + index;
    return `${JSON.stringify({
      base: {
        label: "jqlang:master",
        ref: "master",
        sha: sha256(`base-${index}`).slice(0, 40),
      },
      body: `solution-pr-body-sentinel-${index}`,
      f2p_tests: {
        [`f2p-${index}`]: testOutcome("PASS", "FAIL", "PASS"),
      },
      fix_patch: `gold-patch-sentinel-${index}`,
      fix_patch_result: runResult(1, 0),
      fixed_tests: {
        [`fixed-${index}`]: testOutcome("PASS", "FAIL", "PASS"),
      },
      hints: "",
      instance_id: `jqlang__jq-${number}`,
      n2p_tests: {},
      number,
      org: "jqlang",
      p2p_tests: {
        [`p2p-${index}`]: testOutcome("PASS", "PASS", "PASS"),
      },
      repo: "jq",
      resolved_issues: [{
        body: `original-issue-body-sentinel-${index}`,
        number: 2000 + index,
        title: `original-issue-title-${index}`,
      }],
      run_result: runResult(1, 0),
      s2p_tests: {},
      state: "closed",
      test_patch: `test-patch-sentinel-${index}`,
      test_patch_result: runResult(0, 1),
      title: `solution-pr-title-${index}`,
    })}\n`;
  });
}

function buildAncestryObservations(
  snapshot: ReturnType<typeof buildC6MultiSWEJqSourcePoolSnapshot>,
): C6MultiSWEJqAncestryObservation[] {
  return [
    {
      compareReceiptSha256: sha256("compare-1000-1001"),
      fromMergeCommit: sha256("merge-1000").slice(0, 40),
      fromMergedAt: "2024-01-01T00:00:00Z",
      fromPrNumber: 1000,
      fromPullReceiptSha256: sha256("pull-1000"),
      toBaseCommit: snapshot.rows[1]!.baseCommit,
      toMergedAt: "2024-01-02T00:00:00Z",
      toPrNumber: 1001,
      toPullReceiptSha256: sha256("pull-1001"),
    },
    {
      compareReceiptSha256: sha256("compare-1001-1002"),
      fromMergeCommit: sha256("merge-1001").slice(0, 40),
      fromMergedAt: "2024-01-02T00:00:00Z",
      fromPrNumber: 1001,
      fromPullReceiptSha256: sha256("pull-1001"),
      toBaseCommit: snapshot.rows[2]!.baseCommit,
      toMergedAt: "2024-01-03T00:00:00Z",
      toPrNumber: 1002,
      toPullReceiptSha256: sha256("pull-1002"),
    },
  ];
}

function emptyExistingSourcePool() {
  return {
    artifactSha256: sha256("empty source pool"),
    sourceId: "swe-bench-multilingual-e5c585e",
    rows: [],
  };
}

function buildProjectLicenseCapture(
  snapshot: ReturnType<typeof buildC6MultiSWEJqSourcePoolSnapshot>,
) {
  return {
    baseCommit: snapshot.rows[0]!.baseCommit,
    bytes: 6_026,
    coverage: "single-base-capture-only" as const,
    reviewVerified: false as const,
    sha256: sha256("project license"),
    sourceUrl:
      `https://raw.githubusercontent.com/jqlang/jq/${snapshot.rows[0]!.baseCommit}/COPYING`,
  };
}

function runResult(passedCount: number, failedCount: number) {
  return {
    failed_count: failedCount,
    failed_tests: failedCount === 0 ? [] : ["failed"],
    passed_count: passedCount,
    passed_tests: passedCount === 0 ? [] : ["passed"],
    skipped_count: 0,
    skipped_tests: [],
  };
}

function testOutcome(
  run: "FAIL" | "NONE" | "PASS",
  test: "FAIL" | "NONE" | "PASS",
  fix: "FAIL" | "NONE" | "PASS",
) {
  return {
    fix,
    run,
    test,
  };
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
