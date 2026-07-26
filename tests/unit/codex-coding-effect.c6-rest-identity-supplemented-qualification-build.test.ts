import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  captureC6RestIdentitySupplement,
} from "../../scripts/codex-coding-effect/c6-rest-identity-supplement-capture";
import {
  buildC6RestIdentitySupplementedQualification,
} from "../../scripts/codex-coding-effect/c6-rest-identity-supplemented-qualification";
import {
  buildC6AssetLock,
} from "../../scripts/codex-coding-effect/c6-asset-lock";

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) =>
    rm(path, { force: true, recursive: true })
  ));
});

test("C6 supplemented qualification rebuilds from the frozen capture roots", async () => {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "c6-supplemented-qualification-")),
  );
  cleanup.push(root);
  const originalPath = join(root, "qualification-v1.json");
  const planPath = join(root, "supplement-plan.json");
  const graphqlRoot = join(root, "graphql");
  const graphqlDirectory = join(graphqlRoot, "requested__repo__1");
  const supplementRoot = join(root, "supplement");
  await mkdir(graphqlDirectory, { recursive: true });
  await writeFile(
    join(graphqlDirectory, "response.json"),
    bytes(graphqlResponse()),
  );
  const graphqlLock = await buildC6AssetLock(graphqlRoot);
  const originalBytes = bytes(
    originalQualification(graphqlLock.assetRootSha256),
  );
  const target = supplementTarget();
  const planValue = supplementPlan(
    target,
    sha256(originalBytes),
  );
  const planBytes = bytes(planValue);
  await Promise.all([
    writeFile(originalPath, originalBytes),
    writeFile(planPath, planBytes),
  ]);
  const capture = await captureC6RestIdentitySupplement({
    authorizationToken: "secret-token",
    expectedPlanSha256: sha256(planBytes),
    fetchImpl: async () =>
      new Response(JSON.stringify({
        base: { repo: { full_name: "canonical/repo" } },
        head: { sha: "3".repeat(40) },
        html_url: "https://github.com/canonical/repo/pull/1",
        number: 1,
        user: { login: "pull-author" },
      }), { status: 200 }),
    outputRoot: supplementRoot,
    planPath,
  });
  const result = await buildC6RestIdentitySupplementedQualification({
    expectedGraphqlRootSha256: graphqlLock.assetRootSha256,
    expectedOriginalQualificationSha256: sha256(originalBytes),
    expectedSupplementPlanSha256: sha256(planBytes),
    expectedSupplementRootSha256: capture.assetRootSha256,
    graphqlRoot,
    originalQualificationPath: originalPath,
    supplementPlanPath: planPath,
    supplementRoot,
  });

  expect(result.qualification.counts).toMatchObject({
    exactStructuralCandidateCount: 1,
    identitySupplementClosureCount: 1,
    missingClosureCount: 0,
    targetCount: 1,
  });
  expect(result.qualification.results[0]).toMatchObject({
    canonicalAnchorId: "canonical/repo#1",
    qualificationSource: "pull-identity-supplement-v1",
    status: "exact-structural-candidate",
  });
});

function originalQualification(graphqlRootSha256: string) {
  return {
    artifactKind: "c6-source-expansion-rest-qualification",
    boundary: {
      acceptedEpisodeCount: 0,
      candidateManifestFrozen: false,
      captureAttemptCompletenessProven: false,
      codexRunReady: false,
      machineQualifiedEpisodeCount: 0,
    },
    counts: {
      capturedClosureCount: 0,
      exactStructuralCandidateCount: 0,
      exactStructuralRepositoryCount: 0,
      missingClosureCount: 1,
      repositoryCappedStructuralCeiling: 0,
      targetCount: 1,
    },
    inputs: {
      capturePlanSha256: sha256("capture-plan"),
      graphqlRootSha256,
      restRootSha256: sha256("rest-root"),
    },
    results: [{
      anchorId: "requested/repo#1",
      canonicalAnchorId: "canonical/repo#1",
      captureDirectory: "requested__repo__1",
      captureOrder: 1,
      source: {
        path: "ts/requested__repo_dataset.jsonl",
        rowIndex: 1,
        rowSha256: sha256("source-row"),
      },
      status: "missing-rest-closure",
    }],
    schemaVersion: 1,
  };
}

function supplementTarget() {
  return {
    anchorId: "requested/repo#1",
    canonicalAnchorId: "canonical/repo#1",
    canonicalOwner: "canonical",
    canonicalRepository: "repo",
    captureDirectory: "requested__repo__1",
    originalCaptureOrder: 1,
    pullNumber: 1,
    supplementOrder: 1,
  };
}

function supplementPlan(
  target: ReturnType<typeof supplementTarget>,
  qualificationSha256: string,
) {
  return {
    artifactKind: "c6-rest-identity-supplement-plan",
    boundary: {
      acceptedEpisodeCount: 0,
      candidateManifestFrozen: false,
      captureExecuted: false,
      codexRunReady: false,
    },
    counts: {
      originalTargetCount: 1,
      supplementRepositoryCount: 1,
      supplementTargetCount: 1,
    },
    independenceBoundary: {
      candidateOrderChanged: false,
      machineOutcomeInput: false,
      originalTargetProjectionSha256: sha256("original-targets"),
      retryTargetingDependsOnMissingClosure: true,
      semanticLedgerInput: false,
      supplementTargetProjectionSha256: sha256(JSON.stringify([target])),
    },
    inputs: {
      capturePlan: {
        bytes: 1,
        path: "capture-plan.json",
        sha256: sha256("capture-plan"),
      },
      restQualification: {
        bytes: 1,
        path: "qualification-v1.json",
        sha256: qualificationSha256,
      },
    },
    rule: {
      endpoint: "GET /repos/{owner}/{repo}/pulls/{pull_number}",
      order: "original-captureOrder-ascending",
      purpose:
        "pull-author-and-canonical-identity-only-no-comment-enumeration",
    },
    schemaVersion: 1,
    targets: [target],
  };
}

function graphqlResponse() {
  const first = "1".repeat(40);
  const second = "2".repeat(40);
  const third = "3".repeat(40);
  return {
    data: {
      repository: {
        nameWithOwner: "canonical/repo",
        pullRequest: {
          commits: {
            nodes: [
              commit(first, [], "2026-01-01T00:00:00.000Z"),
              commit(second, [first], "2026-01-01T02:00:00.000Z"),
              commit(third, [second], "2026-01-01T04:00:00.000Z"),
            ],
            pageInfo: { hasNextPage: false },
          },
          headRefOid: third,
          number: 1,
          reviews: {
            nodes: [
              review("review-one", first, "2026-01-01T01:00:00.000Z"),
              review("review-two", second, "2026-01-01T03:00:00.000Z"),
            ],
            pageInfo: { hasNextPage: false },
          },
          reviewThreads: {
            nodes: [],
            pageInfo: { hasNextPage: false },
          },
        },
      },
    },
  };
}

function commit(oid: string, parents: string[], committedDate: string) {
  return {
    commit: {
      committedDate,
      oid,
      parents: {
        nodes: parents.map((parent) => ({ oid: parent })),
        pageInfo: { hasNextPage: false },
      },
    },
  };
}

function review(id: string, oid: string, submittedAt: string) {
  return {
    author: { login: "reviewer" },
    body: `behavioral request for ${id}`,
    commit: { oid },
    id,
    state: "CHANGES_REQUESTED",
    submittedAt,
  };
}

function bytes(value: unknown): Buffer {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
