import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";

import {
  projectC6MultilingualRestIdentityPlan,
} from "../../scripts/codex-coding-effect/c6-multilingual-rest-identity-plan";

describe("Codex coding-effect C6 multilingual REST identity plan", () => {
  it("selects every broad pretarget in frozen source order", () => {
    const fixture = expansionFixture();
    const plan = projectC6MultilingualRestIdentityPlan({
      expansionBytes: fixture.bytes,
      expansionPath: "expansion.json",
    });

    expect(plan.boundary).toEqual({
      acceptedEpisodeCount: 0,
      candidateManifestFrozen: false,
      captureExecuted: false,
      codexRunReady: false,
      status: "multilingual-pull-identity-capture-plan-only",
    });
    expect(plan.counts).toEqual({
      originalTargetCount: 4,
      supplementRepositoryCount: 2,
      supplementTargetCount: 2,
    });
    expect(plan.independenceBoundary).toMatchObject({
      candidateOrderChanged: false,
      machineOutcomeInput: false,
      retryTargetingDependsOnMissingClosure: false,
      semanticLedgerInput: false,
    });
    expect(plan.targets).toEqual([{
      anchorId: "Requested/One#10",
      canonicalAnchorId: "canonical/one#10",
      canonicalOwner: "canonical",
      canonicalRepository: "one",
      captureDirectory: "requested__one__10",
      originalCaptureOrder: 1,
      pullNumber: 10,
      supplementOrder: 1,
    }, {
      anchorId: "requested/two#20",
      canonicalAnchorId: "requested/two#20",
      canonicalOwner: "requested",
      canonicalRepository: "two",
      captureDirectory: "requested__two__20",
      originalCaptureOrder: 3,
      pullNumber: 20,
      supplementOrder: 2,
    }]);
  });

  it("fails closed on count and canonical identity drift", () => {
    const countDrift = expansionFixture();
    countDrift.value.counts.broadStructuralPretargetCount = 1;
    expect(() =>
      projectC6MultilingualRestIdentityPlan({
        expansionBytes: bytes(countDrift.value),
        expansionPath: "expansion.json",
      })
    ).toThrow("count mismatch");

    const identityDrift = expansionFixture();
    identityDrift.value.results[0]!.canonicalAnchorId =
      "canonical/one#11";
    expect(() =>
      projectC6MultilingualRestIdentityPlan({
        expansionBytes: bytes(identityDrift.value),
        expansionPath: "expansion.json",
      })
    ).toThrow("pull mismatch");
  });
});

function expansionFixture() {
  const results = [{
    canonicalAnchorId: "canonical/one#10",
    captureDirectory: "requested__one__10",
    captureOrder: 1,
    requestedAnchorId: "Requested/One#10",
    status: "prior-frame-overlap",
  }, {
    canonicalAnchorId: "requested/none#11",
    captureDirectory: "requested__none__11",
    captureOrder: 2,
    requestedAnchorId: "requested/none#11",
    status: "no-broad-structural-sequence",
  }, {
    canonicalAnchorId: "requested/two#20",
    captureDirectory: "requested__two__20",
    captureOrder: 3,
    requestedAnchorId: "requested/two#20",
    status: "broad-structural-pretarget",
  }, {
    canonicalAnchorId: "requested/gap#30",
    captureDirectory: "requested__gap__30",
    captureOrder: 4,
    requestedAnchorId: "requested/gap#30",
    status: "unsupported-pagination",
  }];
  const value = {
    artifactKind: "c6-multilingual-review-trajectory-expansion",
    boundary: {
      acceptedEpisodeCount: 0,
      candidateManifestFrozen: false,
      codexRunReady: false,
      machineQualifiedEpisodeCount: 0,
      pullAuthorQualified: false,
    },
    counts: {
      broadStructuralPretargetCount: 2,
      freshBroadStructuralPretargetCount: 1,
      priorFrameOverlapCount: 1,
      sourceTargetCount: 4,
    },
    independenceBoundary: {
      broadPretargetProjectionSha256: "a".repeat(64),
      evaluatorFieldInput: false,
      machineOutcomeInput: false,
      semanticLedgerInput: false,
      sourceOrderChanged: false,
    },
    results,
    schemaVersion: 1,
  };
  return {
    bytes: bytes(value),
    value,
  };
}

function bytes(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
