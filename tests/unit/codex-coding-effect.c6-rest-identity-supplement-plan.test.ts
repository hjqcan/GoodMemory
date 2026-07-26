import { describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";

import {
  projectC6RestIdentitySupplementPlan,
} from "../../scripts/codex-coding-effect/c6-rest-identity-supplement-plan";

describe("Codex coding-effect C6 REST identity supplement plan", () => {
  it("retries exactly the missing closures without changing candidate order", () => {
    const fixture = createFixture();
    const plan = projectC6RestIdentitySupplementPlan(fixture);

    expect(plan.boundary).toEqual({
      acceptedEpisodeCount: 0,
      candidateManifestFrozen: false,
      captureExecuted: false,
      codexRunReady: false,
      status: "missing-rest-pull-identity-supplement-plan-only",
    });
    expect(plan.counts).toEqual({
      originalTargetCount: 3,
      supplementRepositoryCount: 2,
      supplementTargetCount: 2,
    });
    expect(plan.independenceBoundary).toMatchObject({
      candidateOrderChanged: false,
      machineOutcomeInput: false,
      retryTargetingDependsOnMissingClosure: true,
      semanticLedgerInput: false,
    });
    expect(plan.targets).toEqual([
      {
        anchorId: "requested/one#10",
        canonicalAnchorId: "canonical/one#10",
        canonicalOwner: "canonical",
        canonicalRepository: "one",
        captureDirectory: "requested__one__10",
        originalCaptureOrder: 1,
        pullNumber: 10,
        supplementOrder: 1,
      },
      {
        anchorId: "requested/two#30",
        canonicalAnchorId: "requested/two#30",
        canonicalOwner: "requested",
        canonicalRepository: "two",
        captureDirectory: "requested__two__30",
        originalCaptureOrder: 3,
        pullNumber: 30,
        supplementOrder: 2,
      },
    ]);
  });

  it("fails closed on plan/qualification identity and count drift", () => {
    const statusDrift = createFixture();
    const qualification = JSON.parse(
      statusDrift.qualificationBytes.toString("utf8"),
    ) as {
      results: Array<{ anchorId: string }>;
    };
    qualification.results[0]!.anchorId = "wrong/repo#10";
    expect(() => projectC6RestIdentitySupplementPlan({
      ...statusDrift,
      qualificationBytes: bytes(qualification),
    })).toThrow("target identity mismatch");

    const countDrift = createFixture();
    const qualificationWithCountDrift = JSON.parse(
      countDrift.qualificationBytes.toString("utf8"),
    ) as {
      counts: { missingClosureCount: number };
    };
    qualificationWithCountDrift.counts.missingClosureCount = 1;
    expect(() => projectC6RestIdentitySupplementPlan({
      ...countDrift,
      qualificationBytes: bytes(qualificationWithCountDrift),
    })).toThrow("qualification count mismatch");

    const orderDrift = createFixture();
    const capturePlan = JSON.parse(
      orderDrift.capturePlanBytes.toString("utf8"),
    ) as {
      independenceBoundary: { targetProjectionSha256: string };
      targets: Array<{ captureOrder: number }>;
    };
    capturePlan.targets[2]!.captureOrder = 4;
    capturePlan.independenceBoundary.targetProjectionSha256 = sha256(
      JSON.stringify(capturePlan.targets),
    );
    expect(() => projectC6RestIdentitySupplementPlan({
      ...orderDrift,
      capturePlanBytes: bytes(capturePlan),
    })).toThrow("capture order must be contiguous");
  });
});

function createFixture() {
  const targets = [
    target("requested/one#10", "canonical/one#10", 1),
    target("requested/ok#20", "requested/ok#20", 2),
    target("requested/two#30", "requested/two#30", 3),
  ];
  const capturePlan = {
    artifactKind: "c6-source-expansion-rest-capture-plan",
    boundary: {
      acceptedEpisodeCount: 0,
      candidateManifestFrozen: false,
      captureExecuted: false,
      codexRunReady: false,
    },
    counts: { targetCount: targets.length },
    independenceBoundary: {
      targetProjectionSha256: sha256(JSON.stringify(targets)),
    },
    targets,
    schemaVersion: 1,
  };
  const qualification = {
    artifactKind: "c6-source-expansion-rest-qualification",
    boundary: {
      acceptedEpisodeCount: 0,
      candidateManifestFrozen: false,
      captureAttemptCompletenessProven: false,
      codexRunReady: false,
      machineQualifiedEpisodeCount: 0,
    },
    counts: {
      missingClosureCount: 2,
      targetCount: 3,
    },
    results: [
      result(targets[0]!, "missing-rest-closure"),
      result(targets[1]!, "exact-structural-candidate"),
      result(targets[2]!, "missing-rest-closure"),
    ],
    schemaVersion: 1,
  };
  return {
    capturePlanBytes: bytes(capturePlan),
    capturePlanPath: "capture-plan.json",
    qualificationBytes: bytes(qualification),
    qualificationPath: "qualification.json",
  };
}

function target(
  anchorId: string,
  canonicalAnchorId: string,
  captureOrder: number,
) {
  const [repository, number] = anchorId.split("#");
  const [owner, repo] = repository!.split("/");
  return {
    anchorId,
    canonicalAnchorId,
    captureDirectory: `${owner}__${repo}__${number}`,
    captureOrder,
    owner,
    pullNumber: Number(number),
    repository: repo,
    resolvedIssueNumbers: [Number(number) + 1000],
  };
}

function result(
  value: ReturnType<typeof target>,
  status: "exact-structural-candidate" | "missing-rest-closure",
) {
  return {
    anchorId: value.anchorId,
    canonicalAnchorId: value.canonicalAnchorId,
    captureDirectory: value.captureDirectory,
    captureOrder: value.captureOrder,
    status,
  };
}

function bytes(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
