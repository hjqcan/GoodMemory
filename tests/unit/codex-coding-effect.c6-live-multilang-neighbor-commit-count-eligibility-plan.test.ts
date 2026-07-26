import { afterEach, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import {
  chmod,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  C6_LIVE_MULTILANG_NEIGHBOR_COMMIT_COUNT_ELIGIBILITY_QUERY,
  C6_LIVE_MULTILANG_NEIGHBOR_COMMIT_COUNT_ELIGIBILITY_QUERY_POLICY,
  buildC6LiveMultiLangNeighborCommitCountEligibilityPlan,
  deriveC6LiveMultiLangNeighborCommitCountEligibilityPlan,
  materializeC6LiveMultiLangNeighborCommitCountEligibilityPlan,
  parseC6LiveMultiLangNeighborCommitCountEligibilityPlan,
  serializeC6LiveMultiLangNeighborCommitCountEligibilityPlan,
  serializeC6LiveMultiLangNeighborCommitCountEligibilityQueryPolicy,
} from "../../scripts/codex-coding-effect/c6-live-multilang-neighbor-commit-count-eligibility-plan";

const SOURCE_PLAN_PATH = resolve(
  "fixtures/codex-coding-effect/c6-source-pool/" +
    "swe-bench-live-multilang-608f7ae9." +
    "neighbor-deep-capture-plan-v2.json",
);
const SOURCE_PLAN_SHA256 =
  "9af58b2033aa67d8bb1d056ff0f56fe8db9c1b0c7a75f73ed1a6a784ad0f4472";
const SOURCE_TARGET_PROJECTION_SHA256 =
  "9b1249a93f2878c41d258cdb2212facf26e4c810f2ed7322d1fcd23fe867eacf";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      rm(root, { force: true, recursive: true })
    ),
  );
});

describe("C6 live MultiLang commit-count eligibility plan", () => {
  it("derives the outcome-blind 643-target plan from the exact frozen source", async () => {
    const sourcePlanBytes = await readFile(SOURCE_PLAN_PATH);
    const plan =
      deriveC6LiveMultiLangNeighborCommitCountEligibilityPlan({
        sourcePlanBytes,
        sourcePlanPath: SOURCE_PLAN_PATH,
      });

    expect(plan.schemaVersion).toBe(1);
    expect(plan.counts).toEqual({
      expectedRequestCount: 643,
      sourceTargetCount: 643,
    });
    expect(plan.boundary).toEqual({
      acceptedEpisodeCount: 0,
      candidateManifestFrozen: false,
      codexRunReady: false,
      commitCountCaptureExecuted: false,
      machineQualifiedEpisodeCount: 0,
      semanticallyQualifiedEpisodeCount: 0,
      status: "commit-count-eligibility-plan-only",
    });
    expect(plan.inputs.deepCapturePlan).toMatchObject({
      artifactKind: "c6-live-multilang-neighbor-deep-capture-plan",
      bytes: sourcePlanBytes.byteLength,
      path: SOURCE_PLAN_PATH.split("/").at(-1),
      schemaVersion: 1,
      sha256: SOURCE_PLAN_SHA256,
      targetProjectionSha256: SOURCE_TARGET_PROJECTION_SHA256,
    });
    expect(plan.targets).toHaveLength(643);
    expect(plan.targets.map((target) => target.captureOrder)).toEqual(
      Array.from({ length: 643 }, (_, index) => index + 1),
    );
    expect(plan.targets[256]?.canonicalAnchorId).toBe(
      "mbed-tls/mbedtls#10815",
    );
    expect(plan.independenceBoundary).toMatchObject({
      goldInput: false,
      machineOutcomeInput: false,
      patchInput: false,
      semanticDecisionInput: false,
      sourceTargetProjectionSha256:
        SOURCE_TARGET_PROJECTION_SHA256,
      testInput: false,
    });
    expect(plan.queryContract.querySha256).toBe(
      sha256(
        C6_LIVE_MULTILANG_NEIGHBOR_COMMIT_COUNT_ELIGIBILITY_QUERY,
      ),
    );
    expect(plan.queryContract.policySha256).toBe(
      sha256(
        serializeC6LiveMultiLangNeighborCommitCountEligibilityQueryPolicy(),
      ),
    );
    expect(plan.rule.platformCommitCap).toBe(250);
    expect(plan.rule.targetOrder).toBe("frozen-source-plan-order");
    expect(plan.rule).not.toHaveProperty("oneRequestPerTarget");
    expect(plan.rule.oneLogicalRequestPerTarget).toBe(true);
    expect(plan.rule.transportContract).toEqual({
      defaultRequestTimeoutMilliseconds: 60_000,
      exponentialBackoffMilliseconds: [1_000, 2_000, 4_000],
      maximumNetworkAttemptsPerTarget: 4,
      maximumRequestTimeoutMilliseconds: 300_000,
      maximumRetryAfterMilliseconds: 60_000,
      retriedTransportPhases: ["fetch", "body-read", "timeout"],
      retryableHttpStatuses: [429, 502, 503, 504],
      transientGraphqlTypes: [
        "INTERNAL",
        "INTERNAL_SERVER_ERROR",
        "RATE_LIMITED",
        "SERVICE_UNAVAILABLE",
        "TIMEOUT",
      ],
    });
    expect(plan.registrationBoundary).toEqual({
      exploratoryAllTargetCountDiagnosticObserved: true,
      frozenBeforeCanonicalCapture: true,
      initialPlanV2TransportFailureObserved: true,
      preregisteredBeforeExploratoryDiagnostic: false,
    });

    const serialized =
      serializeC6LiveMultiLangNeighborCommitCountEligibilityPlan(plan);
    expect(
      parseC6LiveMultiLangNeighborCommitCountEligibilityPlan(
        serialized,
      ),
    ).toEqual(plan);
  });

  it("keeps the fixed query to identity, rate-limit, and totalCount fields", () => {
    expect(
      C6_LIVE_MULTILANG_NEIGHBOR_COMMIT_COUNT_ELIGIBILITY_QUERY_POLICY,
    ).toMatchObject({
      outcomeBlind: true,
      platformCommitCap: 250,
      schemaVersion: 1,
    });
    expect(
      C6_LIVE_MULTILANG_NEIGHBOR_COMMIT_COUNT_ELIGIBILITY_QUERY,
    ).toContain("commits(first: 1)");
    for (const forbidden of [
      "body",
      "title",
      "files",
      "diff",
      "patch",
      "test",
      "gold",
      "check",
      "outcome",
      "message",
    ]) {
      expect(
        C6_LIVE_MULTILANG_NEIGHBOR_COMMIT_COUNT_ELIGIBILITY_QUERY
          .toLowerCase(),
      ).not.toContain(forbidden);
    }
  });

  it("rejects any source bytes other than the exact frozen plan", async () => {
    const source = JSON.parse(
      await readFile(SOURCE_PLAN_PATH, "utf8"),
    ) as { targets: Array<{ captureOrder: number }> };
    source.targets[0]!.captureOrder = 2;

    expect(() =>
      deriveC6LiveMultiLangNeighborCommitCountEligibilityPlan({
        sourcePlanBytes: Buffer.from(
          `${JSON.stringify(source, null, 2)}\n`,
        ),
        sourcePlanPath: SOURCE_PLAN_PATH,
      })
    ).toThrow("source plan hash mismatch");
  });

  it("rejects a rehashed plan with a mutated query contract", async () => {
    const sourcePlanBytes = await readFile(SOURCE_PLAN_PATH);
    const plan =
      deriveC6LiveMultiLangNeighborCommitCountEligibilityPlan({
        sourcePlanBytes,
        sourcePlanPath: SOURCE_PLAN_PATH,
      });
    const raw = JSON.parse(
      serializeC6LiveMultiLangNeighborCommitCountEligibilityPlan(plan),
    ) as {
      queryContract: { policySha256: string };
    };
    raw.queryContract.policySha256 = "0".repeat(64);

    expect(() =>
      parseC6LiveMultiLangNeighborCommitCountEligibilityPlan(
        `${JSON.stringify(raw, null, 2)}\n`,
      )
    ).toThrow("query contract mismatch");
  });

  it("rejects source symlinks and terminal source drift", async () => {
    const root = await temporaryRoot();
    const sourcePath = join(
      root,
      "swe-bench-live-multilang-608f7ae9." +
        "neighbor-deep-capture-plan-v2.json",
    );
    const sourceBytes = await readFile(SOURCE_PLAN_PATH);
    await writeFile(sourcePath, sourceBytes);
    const linkPath = join(root, "source-link.json");
    await symlink(sourcePath, linkPath);

    await expect(
      buildC6LiveMultiLangNeighborCommitCountEligibilityPlan({
        sourcePlanPath: linkPath,
      }),
    ).rejects.toThrow("rejects symlink");

    await expect(
      buildC6LiveMultiLangNeighborCommitCountEligibilityPlan({
        sourcePlanPath: sourcePath,
        testHooks: {
          beforeTerminalVerification: async () => {
            await writeFile(sourcePath, "{}\n");
          },
        },
      }),
    ).rejects.toThrow("source plan changed");
  });

  it("materializes no-replace and rolls back only its own inode", async () => {
    const root = await temporaryRoot();
    const outputPath = join(root, "eligibility-plan.json");
    await writeFile(outputPath, "foreign\n");

    await expect(
      materializeC6LiveMultiLangNeighborCommitCountEligibilityPlan({
        outputPath,
        sourcePlanPath: SOURCE_PLAN_PATH,
      }),
    ).rejects.toThrow();
    expect(await readFile(outputPath, "utf8")).toBe("foreign\n");

    await rm(outputPath);
    await expect(
      materializeC6LiveMultiLangNeighborCommitCountEligibilityPlan({
        outputPath,
        sourcePlanPath: SOURCE_PLAN_PATH,
        testHooks: {
          afterOutputPublication: async () => {
            await rm(outputPath);
            await writeFile(outputPath, "foreign-agent-output\n");
          },
        },
      }),
    ).rejects.toThrow();
    expect(await readFile(outputPath, "utf8")).toBe(
      "foreign-agent-output\n",
    );
    expect(
      (await Array.fromAsync(
        new Bun.Glob(".eligibility-plan.json.incomplete-*").scan(root),
      )).length,
    ).toBe(0);
  });

  it("rejects a published mode mutation and removes its owned output", async () => {
    const root = await temporaryRoot();
    const outputPath = join(root, "eligibility-plan.json");

    await expect(
      materializeC6LiveMultiLangNeighborCommitCountEligibilityPlan({
        outputPath,
        sourcePlanPath: SOURCE_PLAN_PATH,
        testHooks: {
          afterOutputPublication: async () => {
            await chmod(outputPath, 0o600);
          },
        },
      }),
    ).rejects.toThrow("output identity mismatch");
    await expect(readFile(outputPath)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});

async function temporaryRoot(): Promise<string> {
  const root = await realpath(
    await mkdtemp(
      join(tmpdir(), "goodmemory-c6-commit-count-plan-"),
    ),
  );
  temporaryRoots.push(root);
  return root;
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
