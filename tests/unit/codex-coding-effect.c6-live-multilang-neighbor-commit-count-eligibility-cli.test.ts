import { afterEach, describe, expect, it } from "bun:test";
import {
  mkdtemp,
  readFile,
  realpath,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  parseC6LiveMultiLangNeighborCommitCountEligibilityCaptureCliOptions,
} from "../../scripts/capture-codex-coding-effect-c6-live-multilang-neighbor-commit-count-eligibility";
import {
  parseC6LiveMultiLangNeighborCommitCountEligibilityPlanCliOptions,
  runC6LiveMultiLangNeighborCommitCountEligibilityPlanCommand,
} from "../../scripts/snapshot-codex-coding-effect-c6-live-multilang-neighbor-commit-count-eligibility-plan";
import {
  parseC6LiveMultiLangNeighborCommitCountEligibilityPlan,
} from "../../scripts/codex-coding-effect/c6-live-multilang-neighbor-commit-count-eligibility-plan";

const SOURCE_PLAN = resolve(
  "fixtures/codex-coding-effect/c6-source-pool/" +
    "swe-bench-live-multilang-608f7ae9." +
    "neighbor-deep-capture-plan-v2.json",
);
const SHA = "a".repeat(64);
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      rm(root, { force: true, recursive: true })
    ),
  );
});

describe("C6 commit-count eligibility CLIs", () => {
  it("parses the strict plan and capture option surfaces", () => {
    expect(
      parseC6LiveMultiLangNeighborCommitCountEligibilityPlanCliOptions([
        `--source-plan=${SOURCE_PLAN}`,
        "--output=/tmp/eligibility-plan.json",
      ]),
    ).toEqual({
      output: "/tmp/eligibility-plan.json",
      sourcePlan: SOURCE_PLAN,
    });
    expect(
      parseC6LiveMultiLangNeighborCommitCountEligibilityCaptureCliOptions([
        `--expected-plan-sha256=${SHA}`,
        `--expected-query-sha256=${SHA}`,
        `--expected-source-target-projection-sha256=${SHA}`,
        "--expected-target-count=643",
        "--output-root=/tmp/capture",
        "--plan=/tmp/plan.json",
        "--token-env=GITHUB_TOKEN",
      ]),
    ).toEqual({
      expectedPlanSha256: SHA,
      expectedQuerySha256: SHA,
      expectedSourceTargetProjectionSha256: SHA,
      expectedTargetCount: 643,
      outputRoot: "/tmp/capture",
      plan: "/tmp/plan.json",
      tokenEnv: "GITHUB_TOKEN",
    });
    expect(() =>
      parseC6LiveMultiLangNeighborCommitCountEligibilityCaptureCliOptions([
        "--unknown=value",
      ])
    ).toThrow("unknown");
  });

  it("materializes the fixed 643-target plan through the thin CLI", async () => {
    const root = await temporaryRoot();
    const output = join(root, "eligibility-plan.json");
    const result =
      await runC6LiveMultiLangNeighborCommitCountEligibilityPlanCommand([
        `--source-plan=${SOURCE_PLAN}`,
        `--output=${output}`,
      ]);
    const bytes = await readFile(output);
    const plan =
      parseC6LiveMultiLangNeighborCommitCountEligibilityPlan(bytes);

    expect(result).toMatchObject({
      counts: {
        expectedRequestCount: 643,
        sourceTargetCount: 643,
      },
      output,
    });
    expect(result.outputSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(plan.targets).toHaveLength(643);
  });
});

async function temporaryRoot(): Promise<string> {
  const root = await realpath(
    await mkdtemp(
      join(tmpdir(), "goodmemory-c6-commit-count-cli-"),
    ),
  );
  temporaryRoots.push(root);
  return root;
}
