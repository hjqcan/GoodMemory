import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  discoverC6MultiSWERelationshipSignals,
} from "../../scripts/codex-coding-effect/c6-multi-swe-relationship-discovery";
import type {
  C6MultiSWERelationshipRow,
} from "../../scripts/codex-coding-effect/c6-multi-swe-relationship-discovery";
import {
  parseC6MultiSWERelationshipDiscoveryCliOptions,
} from "../../scripts/snapshot-codex-coding-effect-c6-multi-swe-relationship-discovery";

describe("Codex coding-effect C6 Multi-SWE relationship discovery", () => {
  it("promotes only qualified pull references from the later pull body", () => {
    const rows = [
      buildRow(100, 10),
      buildRow(200, 20),
      buildRow(
        300,
        30,
        "PR #200 reintroduced the behavior fixed with pull request #100. Fixes #30.",
      ),
      buildRow(
        400,
        40,
        "This is parallel to #100 and related to issue #20.",
      ),
    ];

    const result = discoverC6MultiSWERelationshipSignals(rows);

    expect(result.referenceSignals).toEqual([
      {
        evidenceField: "pull-body",
        fromPullNumber: 300,
        fromSourceUnitId: "source:300",
        matchedSyntax: "qualified-pull-hash",
        occurrences: 1,
        repository: "example/project",
        targetKinds: ["candidate-pull"],
        targetNumber: 100,
        targetSourceUnitIds: ["source:100"],
      },
      {
        evidenceField: "pull-body",
        fromPullNumber: 300,
        fromSourceUnitId: "source:300",
        matchedSyntax: "qualified-pull-hash",
        occurrences: 1,
        repository: "example/project",
        targetKinds: ["candidate-pull"],
        targetNumber: 200,
        targetSourceUnitIds: ["source:200"],
      },
      {
        evidenceField: "pull-body",
        fromPullNumber: 400,
        fromSourceUnitId: "source:400",
        matchedSyntax: "bare-hash",
        occurrences: 1,
        repository: "example/project",
        targetKinds: ["candidate-pull"],
        targetNumber: 100,
        targetSourceUnitIds: ["source:100"],
      },
      {
        evidenceField: "pull-body",
        fromPullNumber: 400,
        fromSourceUnitId: "source:400",
        matchedSyntax: "qualified-issue-hash",
        occurrences: 1,
        repository: "example/project",
        targetKinds: ["candidate-issue"],
        targetNumber: 20,
        targetSourceUnitIds: ["source:200"],
      },
    ]);
    expect(result.candidateTriples).toEqual([{
      candidateId: "example-project-prs-100-200-300",
      laterPullNumber: 300,
      laterSourceUnitId: "source:300",
      memberPullNumbers: [100, 200, 300],
      orderedPullNumbers: null,
      priorPullNumbers: [100, 200],
      priorSourceUnitIds: ["source:100", "source:200"],
      repository: "example/project",
      status: "relationship-candidate-ancestry-and-review-required",
    }]);
  });

  it("does not let mutable resolved-issue text manufacture a strong chain", () => {
    const rows = [
      buildRow(100, 10),
      buildRow(200, 20),
      {
        ...buildRow(300, 30),
        resolvedIssues: [{
          body: "PR #100 and PR #200 already fixed this.",
          number: 30,
          title: "mutable issue",
        }],
      },
    ];

    const result = discoverC6MultiSWERelationshipSignals(rows);

    expect(result.referenceSignals).toEqual([]);
    expect(result.candidateTriples).toEqual([]);
  });

  it("records shared issues as ambiguity rather than a dependency", () => {
    const result = discoverC6MultiSWERelationshipSignals([
      buildRow(100, 10),
      buildRow(200, 10),
      buildRow(300, 30),
    ]);

    expect(result.sharedResolvedIssueGroups).toEqual([{
      issueNumber: 10,
      memberPullNumbers: [100, 200],
      memberSourceUnitIds: ["source:100", "source:200"],
      repository: "example/project",
      status: "parallel-or-superseding-attempts-not-dependency-proof",
    }]);
    expect(result.candidateTriples).toEqual([]);
  });

  it("requires every local input explicitly at the snapshot boundary", () => {
    expect(parseC6MultiSWERelationshipDiscoveryCliOptions([
      "--source-root=/evidence/multi-swe",
      "--readme-file=/evidence/README.md",
      "--tree-receipt=/evidence/tree.json",
      "--existing-source-pool=/evidence/swe-source-pool.json",
      "--pull-3075=/evidence/pull-3075.json",
      "--pull-2896=/evidence/pull-2896.json",
      "--pull-3189=/evidence/pull-3189.json",
      "--issue-3073=/evidence/issue-3073.json",
      "--issue-1746=/evidence/issue-1746.json",
      "--issue-3188=/evidence/issue-3188.json",
      "--compare-3075-to-2896=/evidence/compare-3075-to-2896.json",
      "--compare-2896-to-3189=/evidence/compare-2896-to-3189.json",
      "--output=/evidence/relationship-discovery.json",
    ])).toEqual({
      compare2896To3189: "/evidence/compare-2896-to-3189.json",
      compare3075To2896: "/evidence/compare-3075-to-2896.json",
      existingSourcePool: "/evidence/swe-source-pool.json",
      issue1746: "/evidence/issue-1746.json",
      issue3073: "/evidence/issue-3073.json",
      issue3188: "/evidence/issue-3188.json",
      output: "/evidence/relationship-discovery.json",
      pull2896: "/evidence/pull-2896.json",
      pull3075: "/evidence/pull-3075.json",
      pull3189: "/evidence/pull-3189.json",
      readmeFile: "/evidence/README.md",
      sourceRoot: "/evidence/multi-swe",
      treeReceipt: "/evidence/tree.json",
    });
    expect(() =>
      parseC6MultiSWERelationshipDiscoveryCliOptions([
        "--source-root=/evidence/multi-swe",
      ])
    ).toThrow("--compare-2896-to-3189 is required exactly once");
  });

  it("tracks the real 24-file discovery tranche without accepting an episode", () => {
    const artifactPath = join(
      import.meta.dir,
      "../../fixtures/codex-coding-effect/c6-source-pool",
      "multi-swe-under-1mb-56ff018.relationship-discovery.json",
    );
    const bytes = readFileSync(artifactPath);
    const artifact = JSON.parse(bytes.toString("utf8")) as {
      boundary: {
        acceptedEpisodeCount: number;
        candidateManifestFrozen: boolean;
        fullMultiSWESourcePopulationCovered: boolean;
        status: string;
      };
      counts: {
        candidateTriples: number;
        crossSourceAliases: number;
        newCanonicalUpstreamTasks: number;
        observedRows: number;
        referenceSignals: number;
        repositories: number;
        sourceFiles: number;
      };
      evidenceBoundary: {
        independentCaptureAuthenticationVerified: boolean;
        independentSemanticReviewVerified: boolean;
        localMergeOrderAndAncestryVerifiedCandidates: number;
        orderedOriginalRequestChronologyVerifiedCandidates: number;
      };
      locallyVerifiedCandidates: Array<{
        ancestryEdges: Array<{
          aheadBy: number;
          fromPullNumber: number;
          toPullNumber: number;
        }>;
        mergeChronologyVerified: boolean;
        mergeOrderPullNumbers: [number, number, number];
        originalRequestChronology: {
          issueCreatedOrderPullNumbers: [number, number, number];
          pullCreatedOrderPullNumbers: [number, number, number];
          requestChronologyVerified: boolean;
          status: string;
        };
        relationshipKind: string;
        stages: Array<{
          issueCreatedAt: string;
          pullCreatedAt: string;
          pullNumber: number;
        }>;
        status: string;
      }>;
      requiredNextEvidence: string[];
      schemaVersion: number;
    };

    expect(bytes.byteLength).toBe(29_589);
    expect(sha256(bytes)).toBe(
      "4c7fb407078905f2ad1705f21e617796b31fcca4777cb8fd912e0801f6c20c06",
    );
    expect(artifact.schemaVersion).toBe(2);
    expect(artifact.boundary).toEqual({
      acceptedEpisodeCount: 0,
      candidateManifestFrozen: false,
      fullMultiSWESourcePopulationCovered: false,
      status: "relationship-discovery-only-independent-review-required",
    });
    expect(artifact.counts).toMatchObject({
      candidateTriples: 1,
      crossSourceAliases: 15,
      newCanonicalUpstreamTasks: 246,
      observedRows: 261,
      referenceSignals: 6,
      repositories: 24,
      sourceFiles: 24,
    });
    expect(artifact.evidenceBoundary).toMatchObject({
      independentCaptureAuthenticationVerified: false,
      independentSemanticReviewVerified: false,
      localMergeOrderAndAncestryVerifiedCandidates: 1,
      orderedOriginalRequestChronologyVerifiedCandidates: 0,
    });
    expect(artifact.requiredNextEvidence).toEqual(expect.arrayContaining([
      "cross-stage-gold-and-leakage-review",
      "independent-semantic-duplicate-review",
      "original-request-chronology-conflict-eligibility-decision",
      "repository-commit-reachability-and-tree",
    ]));
    expect(artifact.locallyVerifiedCandidates).toEqual([
      expect.objectContaining({
        ancestryEdges: [
          expect.objectContaining({
            aheadBy: 39,
            fromPullNumber: 3075,
            toPullNumber: 2896,
          }),
          expect.objectContaining({
            aheadBy: 90,
            fromPullNumber: 2896,
            toPullNumber: 3189,
          }),
        ],
        mergeChronologyVerified: true,
        mergeOrderPullNumbers: [3075, 2896, 3189],
        originalRequestChronology: {
          issueCreatedOrderPullNumbers: [2896, 3075, 3189],
          pullCreatedOrderPullNumbers: [2896, 3075, 3189],
          requestChronologyVerified: false,
          status: "conflicts-with-merge-order",
        },
        relationshipKind: "merge-order-regression",
        stages: [
          expect.objectContaining({
            issueCreatedAt: "2024-08-18T17:20:09Z",
            pullCreatedAt: "2024-08-25T09:40:42Z",
            pullNumber: 3075,
          }),
          expect.objectContaining({
            issueCreatedAt: "2021-07-21T08:19:18Z",
            pullCreatedAt: "2024-03-15T17:17:48Z",
            pullNumber: 2896,
          }),
          expect.objectContaining({
            issueCreatedAt: "2025-01-27T14:44:30Z",
            pullCreatedAt: "2025-01-27T16:23:22Z",
            pullNumber: 3189,
          }),
        ],
        status:
          "merge-order-regression-candidate-original-request-chronology-conflict",
      }),
    ]);

    const receiptRoot = join(
      import.meta.dir,
      "../../fixtures/codex-coding-effect/c6-source-pool",
      "multi-swe-under-1mb-56ff018-receipts",
    );
    for (const [name, expectedBytes, expectedSha256] of [
      ["compare-2896-to-3189.json", 12_033, "2b2cf1b0d81861a5bed63d6b858da115e6c55c1075224742fef64d14a4cd267f"],
      ["compare-3075-to-2896.json", 14_720, "de5dba605710ff773d8cd83cbf70aee7595cde6fa638eb9d31cc245d1d98ff49"],
      ["hf-tree.json", 38_112, "69b4797acb34252fcc726daf6d3e0480577017d9b8faf25b7dbd53f7f82e07b6"],
      ["issue-1746.json", 11_307, "3ed8014c2d2a11838831f5125ddc611770f7c3e54a16ce0bc984e7e4fbb2ffe0"],
      ["issue-3073.json", 4_513, "3f98a9d36612c9e33d6f8ff2c460d0b3f9c6f7b570e31330f45f606079ed5f24"],
      ["issue-3188.json", 6_596, "01cae0c9d99ced87ec9b6c60b3c6389f9dac79179f3d822321bd87c25eeae705"],
      ["pull-2896.json", 16_466, "f9efb007b0bb7ef891c0c46539d0cd2295b86c8fce57f5bb2aacd3202d3dc201"],
      ["pull-3075.json", 17_162, "5dc31a2b621ad7873afbb0d498ac3a2d4ca79ebb34062c2c53dea867cc7eddd0"],
      ["pull-3189.json", 18_282, "b2cf484e034f7051153774be6c972077a4c102b968155214f3eb024afdb20aa4"],
    ] as const) {
      const receipt = readFileSync(join(receiptRoot, name));
      expect(receipt.byteLength).toBe(expectedBytes);
      expect(sha256(receipt)).toBe(expectedSha256);
    }

    const text = bytes.toString("utf8");
    expect(text).not.toContain("\"body\":");
    expect(text).not.toContain("\"title\":");
    expect(text).not.toContain("\"fix_patch\":");
    expect(text).not.toContain("\"test_patch\":");
    expect(text).not.toContain("agentVisibleRequestSha256");
  });
});

function buildRow(
  pullNumber: number,
  issueNumber: number,
  pullBody = "",
): C6MultiSWERelationshipRow {
  return {
    pullBody,
    repository: "example/project",
    resolvedIssues: [{
      body: "",
      number: issueNumber,
      title: `issue ${issueNumber}`,
    }],
    sourceUnitId: `source:${pullNumber}`,
    upstreamPullNumber: pullNumber,
  };
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
