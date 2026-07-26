import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";

import {
  projectC6SourceExpansionRestCapturePlan,
} from "../../scripts/codex-coding-effect/c6-source-expansion-rest-capture-plan";

describe("Codex coding-effect C6 source-expansion REST capture plan", () => {
  it("freezes every pretarget in the precommitted capture order", () => {
    const fixture = createFixture();
    const plan = projectC6SourceExpansionRestCapturePlan(fixture);

    expect(plan.boundary).toEqual({
      acceptedEpisodeCount: 0,
      candidateManifestFrozen: false,
      captureExecuted: false,
      codexRunReady: false,
      status: "rest-capture-plan-only-no-network-result",
    });
    expect(plan.counts).toEqual({
      repositoryCount: 2,
      targetCount: 2,
    });
    expect(plan.targets).toEqual([{
      anchorId: "example/alpha#2",
      canonicalAnchorId: "example/alpha#2",
      captureDirectory: "example__alpha__2",
      captureOrder: 1,
      owner: "example",
      pullNumber: 2,
      repository: "alpha",
      resolvedIssueNumbers: [1002],
      source: {
        path: "typescript/example__alpha_dataset.jsonl",
        rowIndex: 2,
        rowSha256: fixture.alphaRowSha256,
      },
    }, {
      anchorId: "legacy/renamed#3",
      canonicalAnchorId: "canonical/renamed#3",
      captureDirectory: "legacy__renamed__3",
      captureOrder: 2,
      owner: "legacy",
      pullNumber: 3,
      repository: "renamed",
      resolvedIssueNumbers: [1003, 1004],
      source: {
        path: "typescript/legacy__renamed_dataset.jsonl",
        rowIndex: 3,
        rowSha256: fixture.renamedRowSha256,
      },
    }]);
  });

  it("rejects source-row and expansion-order drift", () => {
    const rowDrift = createFixture();
    rowDrift.sourceRows.set(
      "typescript/example__alpha_dataset.jsonl#2",
      `${JSON.stringify({
        number: 2,
        org: "example",
        repo: "alpha",
        resolved_issues: [{ number: 9999 }],
      })}\n`,
    );
    expect(() =>
      projectC6SourceExpansionRestCapturePlan(rowDrift)
    ).toThrow("source row hash mismatch");

    const orderDrift = createFixture();
    const expansion = JSON.parse(
      orderDrift.expansionBytes.toString("utf8"),
    ) as { pretargets: Array<{ restCaptureOrder: number }> };
    expansion.pretargets[1]!.restCaptureOrder = 3;
    expect(() =>
      projectC6SourceExpansionRestCapturePlan({
        ...orderDrift,
        expansionBytes: bytes(expansion),
      })
    ).toThrow("capture order must be contiguous");
  });
});

function createFixture() {
  const alphaRow = `${JSON.stringify({
    number: 2,
    org: "example",
    repo: "alpha",
    resolved_issues: [{ number: 1002 }],
  })}\n`;
  const renamedRow = `${JSON.stringify({
    number: 3,
    org: "legacy",
    repo: "renamed",
    resolved_issues: [{ number: 1004 }, { number: 1003 }],
  })}\n`;
  const alphaRowSha256 = sha256(alphaRow);
  const renamedRowSha256 = sha256(renamedRow);
  const expansion = {
    artifactKind: "c6-review-trajectory-source-expansion",
    boundary: {
      acceptedEpisodeCount: 0,
      candidateManifestFrozen: false,
      codexRunReady: false,
    },
    inventory: {
      sourceRevision: "e".repeat(40),
      sourceRootSha256: sha256("source-root"),
      treeReceiptSha256: sha256("tree-receipt"),
    },
    policy: {
      policyId: "prospective-structural-review-v2",
      sha256: sha256("policy"),
    },
    pretargets: [{
      anchorId: "legacy/renamed#3",
      canonicalAnchorId: "canonical/renamed#3",
      captureDirectory: "legacy__renamed__3",
      requestedRepository: "legacy/renamed",
      restCaptureOrder: 2,
      source: {
        path: "typescript/legacy__renamed_dataset.jsonl",
        rowIndex: 3,
        rowSha256: renamedRowSha256,
      },
    }, {
      anchorId: "example/alpha#2",
      canonicalAnchorId: "example/alpha#2",
      captureDirectory: "example__alpha__2",
      requestedRepository: "example/alpha",
      restCaptureOrder: 1,
      source: {
        path: "typescript/example__alpha_dataset.jsonl",
        rowIndex: 2,
        rowSha256: alphaRowSha256,
      },
    }],
    schemaVersion: 1,
  };
  return {
    alphaRowSha256,
    expansionBytes: bytes(expansion),
    expansionPath: "expansion.json",
    renamedRowSha256,
    sourceRows: new Map([
      ["typescript/example__alpha_dataset.jsonl#2", alphaRow],
      ["typescript/legacy__renamed_dataset.jsonl#3", renamedRow],
    ]),
  };
}

function bytes(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
