import { describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  projectC6MultilingualSourceExpansionPlan,
} from "../../scripts/codex-coding-effect/c6-multilingual-source-expansion-plan";

const SOURCE_POOL_PATH = resolve(
  "fixtures/codex-coding-effect/c6-source-pool/" +
    "swe-bench-multilingual-e5c585e.source-pool.json",
);

describe("C6 multilingual source-expansion plan", () => {
  it("freezes every source row before network capture without evaluator-field selection", async () => {
    const sourcePoolBytes = await readFile(SOURCE_POOL_PATH);
    const plan = projectC6MultilingualSourceExpansionPlan({
      sourcePoolBytes,
      sourcePoolPath: SOURCE_POOL_PATH,
    });

    expect(plan.counts).toEqual({
      repositoryCount: 41,
      sourceRowCount: 300,
      targetCount: 300,
    });
    expect(plan.independenceBoundary).toMatchObject({
      canonicalDeduplicationDeferredToPostCapture: true,
      machineOutcomeInput: false,
      selectionUsesEvaluatorFields: false,
      semanticLedgerInput: false,
    });
    expect(plan.targets).toHaveLength(300);
    expect(plan.targets[0]).toEqual({
      agentVisibleRequestSha256:
        "355dc4b282aa454a80ce4996dffe2831fcb3216fabf6cbc4c24f967c5c6cc081",
      captureDirectory: "apache__druid__13704",
      captureOrder: 1,
      instanceId: "apache__druid-13704",
      owner: "apache",
      pullNumber: 13704,
      repo: "druid",
      requestedAnchorId: "apache/druid#13704",
      rowIndex: 0,
    });
    expect(plan.targets.at(-1)).toEqual({
      agentVisibleRequestSha256:
        "a378d0fb58a85045c2a2dcba79b56243d64aea479e7ba566cf4fed3577888cb7",
      captureDirectory: "vuejs__core__11915",
      captureOrder: 300,
      instanceId: "vuejs__core-11915",
      owner: "vuejs",
      pullNumber: 11915,
      repo: "core",
      requestedAnchorId: "vuejs/core#11915",
      rowIndex: 299,
    });
  });

  it("keeps the target projection unchanged when evaluator-only fields change", async () => {
    const sourcePool = JSON.parse(
      await readFile(SOURCE_POOL_PATH, "utf8"),
    ) as {
      rows: Array<Record<string, unknown>>;
    };
    const original = projectC6MultilingualSourceExpansionPlan({
      sourcePoolBytes: Buffer.from(
        `${JSON.stringify(sourcePool, null, 2)}\n`,
      ),
      sourcePoolPath: SOURCE_POOL_PATH,
    });
    sourcePool.rows[0]!.decision = "rejected-before-origin-review";
    sourcePool.rows[0]!.evaluatorOnlySha256 = "a".repeat(64);
    sourcePool.rows[0]!.failToPassSha256 = "b".repeat(64);
    sourcePool.rows[0]!.goldPatchSha256 = "c".repeat(64);
    sourcePool.rows[0]!.passToPassSha256 = "d".repeat(64);
    sourcePool.rows[0]!.testPatchSha256 = "e".repeat(64);
    const mutated = projectC6MultilingualSourceExpansionPlan({
      sourcePoolBytes: Buffer.from(
        `${JSON.stringify(sourcePool, null, 2)}\n`,
      ),
      sourcePoolPath: SOURCE_POOL_PATH,
    });

    expect(mutated.targets).toEqual(original.targets);
    expect(
      mutated.independenceBoundary.targetProjectionSha256,
    ).toBe(original.independenceBoundary.targetProjectionSha256);
  });
});
