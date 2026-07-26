import { createHash } from "node:crypto";
import {
  cp,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "bun:test";

import {
  buildC6ReviewerActorDerivedClassification,
  materializeC6ReviewerActorDerivedClassification,
  parseC6ReviewerActorDerivedClassification,
  parseC6ReviewerActorPolicyV2ReviewReceipt,
  serializeC6ReviewerActorDerivedClassification,
  serializeC6ReviewerActorSanitizedProjection,
} from "../../../scripts/codex-coding-effect/c6-reviewer-actor-derived-classification";
import type {
  C6ReviewerActorPolicyV2ReviewReceipt,
} from "../../../scripts/codex-coding-effect/c6-reviewer-actor-derived-classification";
import {
  runC6ReviewerActorDerivedClassificationCommand,
} from "../../../scripts/snapshot-codex-coding-effect-c6-reviewer-actor-derived-classification";

const ACTOR_PLAN_PATH = join(
  process.cwd(),
  "fixtures/codex-coding-effect/c6-source-pool/" +
    "swe-bench-live-multilang-608f7ae9." +
    "neighbor-reviewer-actor-plan-v1.json",
);
const CLASSIFICATION_PATH = join(
  process.cwd(),
  "fixtures/codex-coding-effect/c6-source-pool/" +
    "swe-bench-live-multilang-608f7ae9." +
    "neighbor-reviewer-actor-derived-classification-v2.json",
);
const CLASSIFICATION_SHA256 =
  "739193f348ee15852e9f337a009233dab3bde3479ea85aa2b73299960280cebc";
const ACTOR_ROOT =
  process.env
    .GOODMEMORY_TEST_C6_LIVE_MULTILANG_NEIGHBOR_ACTOR_ROOT
    ?.trim();
if (!ACTOR_ROOT) {
  throw new Error(
    "C6 reviewer actor v2 gate missing " +
      "GOODMEMORY_TEST_C6_LIVE_MULTILANG_NEIGHBOR_ACTOR_ROOT",
  );
}
const temporaryRoots: string[] = [];

afterAll(async () => {
  await Promise.all(
    temporaryRoots.map((root) =>
      rm(root, { force: true, recursive: true })
    ),
  );
});

describe("Codex coding-effect C6 reviewer actor derived classification", () => {
  it("derives the strict 267-row outcome-blind v2 freeze from the v1 raw closure", async () => {
    const frozenBytes = await readFile(CLASSIFICATION_PATH);
    expect(hash(frozenBytes)).toBe(CLASSIFICATION_SHA256);
    const result =
      await buildC6ReviewerActorDerivedClassification({
        actorPlanPath: ACTOR_PLAN_PATH,
        actorRoot: ACTOR_ROOT,
      });
    const artifact = result.classification;

    expect(artifact.counts).toEqual({
      actorCount: 267,
      newlyExcludedActorCount: 5,
      resolvedActorCount: 260,
      unresolvedActorCount: 7,
      v1EligibleActorCount: 254,
      v1IneligibleActorCount: 13,
      v2EligibleActorCount: 249,
      v2IneligibleActorCount: 18,
    });
    expect(artifact.newlyExcludedLogins).toEqual([
      "cubic-dev-ai",
      "esphbot",
      "gemini-code-assist",
      "greptile-apps",
      "mentatbot",
    ]);
    expect(artifact.sanitizedProjection.rows).toHaveLength(267);
    expect(Object.keys(artifact.sanitizedProjection.rows[0]!).sort())
      .toEqual([
        "captureOrder",
        "currentPlatformType",
        "login",
        "status",
      ]);
    expect(artifact.boundary).toEqual({
      actorFilteredSelectionExecuted: false,
      automationExclusionComplete: false,
      candidateManifestFrozen: false,
      codexRunReady: false,
      commitAncestryProven: false,
      eventTimeActorTypeProven: false,
      humanReviewerIdentityProven: false,
      independentReviewCompleted: false,
      independentReviewReceiptRequired: true,
      status: "policy-v2-independent-review-and-commit-freeze-required",
    });
    expect(artifact.independenceBoundary).toEqual({
      goldInput: false,
      reviewBodyInput: false,
      reviewOutcomeInput: false,
      selectedSequenceInput: false,
    });
    expect(artifact.chronology).toEqual({
      adaptiveAfterActorCapture: true,
      commitAncestryProven: false,
      policyV2PreregisteredBeforeActorCapture: false,
      selectionExecuted: false,
    });
    expect(artifact.inputs.actorPlan.sha256).toBe(
      "abb0a817611c7f5568c0f3390625598a46a1a56c687617815260ee98121a92d3",
    );
    expect(artifact.inputs.actorRoot).toMatchObject({
      assetRootSha256:
        "f92953b8a0cfbf10e41a54c6912b67541a847c1b11b7b57dc7d5cb647b1a4ab4",
      captureManifestSha256:
        "ec047aba9c5e862193627d814432bd2d29d9387505de56c1e834891aba511f51",
      fileCount: 1_069,
    });
    expect(
      parseC6ReviewerActorDerivedClassification(
        serializeC6ReviewerActorDerivedClassification(artifact),
      ),
    ).toEqual(artifact);
    expect(result.outputSha256).toBe(
      hash(serializeC6ReviewerActorDerivedClassification(artifact)),
    );
    expect(result.outputSha256).toBe(
      CLASSIFICATION_SHA256,
    );
    expect(Buffer.from(
      serializeC6ReviewerActorDerivedClassification(artifact),
      "utf8",
    )).toEqual(frozenBytes);
  });

  it("rejects extra, missing, added, reordered, and modified sanitized tuples", async () => {
    const { classification } =
      await buildC6ReviewerActorDerivedClassification({
        actorPlanPath: ACTOR_PLAN_PATH,
        actorRoot: ACTOR_ROOT,
      });
    const mutations = [
      (raw: Record<string, unknown>) => {
        const projection = projectionOf(raw);
        projection.rows[0]!.hiddenOutcome = "forbidden";
      },
      (raw: Record<string, unknown>) => {
        projectionOf(raw).rows.pop();
      },
      (raw: Record<string, unknown>) => {
        const projection = projectionOf(raw);
        projection.rows.push({
          captureOrder: 268,
          currentPlatformType: "User",
          login: "zz-extra",
          status: 200,
        });
      },
      (raw: Record<string, unknown>) => {
        projectionOf(raw).rows.reverse();
      },
      (raw: Record<string, unknown>) => {
        projectionOf(raw).rows[0]!.currentPlatformType =
          "Organization";
      },
    ];

    for (const mutate of mutations) {
      const raw = JSON.parse(
        serializeC6ReviewerActorDerivedClassification(
          classification,
        ),
      ) as Record<string, unknown>;
      mutate(raw);
      expect(() =>
        parseC6ReviewerActorDerivedClassification(
          `${JSON.stringify(raw, null, 2)}\n`,
        )
      ).toThrow();
    }
  });

  it("rejects policy, root, and projection identity drift", async () => {
    const { classification } =
      await buildC6ReviewerActorDerivedClassification({
        actorPlanPath: ACTOR_PLAN_PATH,
        actorRoot: ACTOR_ROOT,
      });
    const mutations = [
      (raw: Record<string, unknown>) => {
        policyOf(raw).sha256 = "0".repeat(64);
      },
      (raw: Record<string, unknown>) => {
        actorRootOf(raw).assetRootSha256 = "0".repeat(64);
      },
      (raw: Record<string, unknown>) => {
        projectionOf(raw).sha256 = "0".repeat(64);
      },
    ];
    for (const mutate of mutations) {
      const raw = JSON.parse(
        serializeC6ReviewerActorDerivedClassification(
          classification,
        ),
      ) as Record<string, unknown>;
      mutate(raw);
      expect(() =>
        parseC6ReviewerActorDerivedClassification(
          `${JSON.stringify(raw, null, 2)}\n`,
        )
      ).toThrow();
    }

    const copiedRoot = await mkdtemp(
      "/private/tmp/goodmemory-c6-actor-v2-root-drift-",
    );
    temporaryRoots.push(copiedRoot);
    await cp(ACTOR_ROOT, copiedRoot, { recursive: true });
    await writeFile(join(copiedRoot, "foreign.txt"), "drift\n");
    await expect(
      buildC6ReviewerActorDerivedClassification({
        actorPlanPath: ACTOR_PLAN_PATH,
        actorRoot: copiedRoot,
      }),
    ).rejects.toThrow("actor root hash mismatch");
  });

  it("detects terminal raw closure drift and never publishes a stale freeze", async () => {
    const copiedRoot = await mkdtemp(
      "/private/tmp/goodmemory-c6-actor-v2-terminal-",
    );
    temporaryRoots.push(copiedRoot);
    await cp(ACTOR_ROOT, copiedRoot, { recursive: true });
    const capturePath = join(copiedRoot, "capture.json");
    let hookCalled = false;

    await expect(
      buildC6ReviewerActorDerivedClassification({
        actorPlanPath: ACTOR_PLAN_PATH,
        actorRoot: copiedRoot,
        testHooks: {
          beforeTerminalVerification: async () => {
            hookCalled = true;
            await writeFile(capturePath, "{}\n");
          },
        },
      }),
    ).rejects.toThrow(/changed|hash mismatch/u);
    expect(hookCalled).toBe(true);
  });

  it("materializes through the CLI and replays exact canonical bytes", async () => {
    const outputRoot = await mkdtemp(
      "/private/tmp/goodmemory-c6-actor-v2-output-",
    );
    temporaryRoots.push(outputRoot);
    const outputPath = join(outputRoot, "classification.json");
    const command =
      await runC6ReviewerActorDerivedClassificationCommand([
        `--actor-plan=${ACTOR_PLAN_PATH}`,
        `--actor-root=${ACTOR_ROOT}`,
        `--output=${outputPath}`,
      ]);
    const outputBytes = await readFile(outputPath);
    const result =
      parseC6ReviewerActorDerivedClassification(outputBytes);

    expect(hash(outputBytes)).toBe(command.outputSha256);
    expect(command.counts).toEqual(result.counts);
    expect(command.independentReviewCompleted).toBe(false);
    expect(result.boundary.actorFilteredSelectionExecuted).toBe(
      false,
    );
    await expect(
      materializeC6ReviewerActorDerivedClassification({
        actorPlanPath: ACTOR_PLAN_PATH,
        actorRoot: ACTOR_ROOT,
        outputPath,
      }),
    ).rejects.toThrow();
  });

  it("validates only a bound review-receipt structure without claiming independent review", async () => {
    const result =
      await buildC6ReviewerActorDerivedClassification({
        actorPlanPath: ACTOR_PLAN_PATH,
        actorRoot: ACTOR_ROOT,
      });
    const receipt = reviewReceipt(result);
    expect(parseC6ReviewerActorPolicyV2ReviewReceipt({
      expectedClassificationSha256: result.outputSha256,
      expectedPolicySha256:
        result.classification.policy.v2.sha256,
      expectedSanitizedProjectionSha256:
        result.classification.sanitizedProjection.sha256,
      input: `${JSON.stringify(receipt, null, 2)}\n`,
    })).toEqual(receipt);

    const sameReviewer = structuredClone(receipt);
    sameReviewer.reviewer.identity = sameReviewer.author.identity;
    expect(() =>
      parseC6ReviewerActorPolicyV2ReviewReceipt({
        expectedClassificationSha256: result.outputSha256,
        expectedPolicySha256:
          result.classification.policy.v2.sha256,
        expectedSanitizedProjectionSha256:
          result.classification.sanitizedProjection.sha256,
        input: `${JSON.stringify(sameReviewer, null, 2)}\n`,
      })
    ).toThrow("reviewer must differ");
    const wrongProjection = structuredClone(receipt);
    wrongProjection.inputs.sanitizedProjectionSha256 =
      "0".repeat(64);
    expect(() =>
      parseC6ReviewerActorPolicyV2ReviewReceipt({
        expectedClassificationSha256: result.outputSha256,
        expectedPolicySha256:
          result.classification.policy.v2.sha256,
        expectedSanitizedProjectionSha256:
          result.classification.sanitizedProjection.sha256,
        input: `${JSON.stringify(wrongProjection, null, 2)}\n`,
      })
    ).toThrow("input binding mismatch");
  });
});

function actorRootOf(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  return (raw.inputs as Record<string, unknown>)
    .actorRoot as Record<string, unknown>;
}

function hash(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function policyOf(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  return (raw.policy as Record<string, unknown>)
    .v2 as Record<string, unknown>;
}

function projectionOf(raw: Record<string, unknown>): {
  bytes: number;
  rows: Array<Record<string, unknown>>;
  sha256: string;
} {
  return (raw.sanitizedProjection as {
    bytes: number;
    rows: Array<Record<string, unknown>>;
    sha256: string;
  });
}

function reviewReceipt(result: Awaited<
  ReturnType<typeof buildC6ReviewerActorDerivedClassification>
>): C6ReviewerActorPolicyV2ReviewReceipt {
  const artifact = (
    path: string,
    value: string,
  ) => ({
    bytes: Buffer.byteLength(value),
    path,
    sha256: hash(value),
  });
  const request = "review request\n";
  const input = serializeC6ReviewerActorSanitizedProjection(
    result.classification.sanitizedProjection.rows,
  );
  const dispatch = "review dispatch\n";
  const response = "review response\n";
  return {
    artifactKind:
      "c6-reviewer-actor-policy-v2-review-receipt",
    author: {
      identity: "policy-author",
    },
    boundary: {
      goldInput: false,
      independentReviewerIdentityProven: false,
      personnelOutcomeBlindnessProven: false,
      reviewBodyInput: false,
      reviewOutcomeInput: false,
      selectedSequenceInput: false,
      status: "review-receipt-structure-only",
    },
    decision: "accepted",
    inputs: {
      classificationSha256: result.outputSha256,
      policySha256: result.classification.policy.v2.sha256,
      sanitizedProjectionSha256:
        result.classification.sanitizedProjection.sha256,
    },
    provenance: {
      dispatch: artifact("dispatch.txt", dispatch),
      input: artifact("input.json", input),
      request: artifact("request.txt", request),
      response: artifact("response.txt", response),
    },
    reviewer: {
      identity: "reviewer-actor",
    },
    schemaVersion: 1,
  };
}
