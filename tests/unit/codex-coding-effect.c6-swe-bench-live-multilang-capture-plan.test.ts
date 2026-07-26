import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  projectC6SWEbenchLiveMultiLangCapturePlan,
} from "../../scripts/codex-coding-effect/c6-swe-bench-live-multilang-capture-plan";

const SOURCE_POOL_PATH = resolve(
  "fixtures/codex-coding-effect/c6-source-pool/" +
    "swe-bench-live-multilang-608f7ae9.source-pool.json",
);

describe("Codex coding-effect C6 SWE-bench-Live MultiLang capture plan", () => {
  it("freezes all 743 targets in source row order", () => {
    const bytes = readFileSync(SOURCE_POOL_PATH);
    const plan = projectC6SWEbenchLiveMultiLangCapturePlan({
      sourcePoolBytes: bytes,
      sourcePoolPath: SOURCE_POOL_PATH,
    });

    expect(plan.counts).toEqual({
      repositoryCount: 381,
      sourceRowCount: 743,
      targetCount: 743,
    });
    expect(plan.targets[0]).toMatchObject({
      captureOrder: 1,
      requestedAnchorId: "samtools/samtools#2235",
      rowIndex: 0,
      sourceSplit: "c",
      sourceSplitRowIndex: 0,
    });
    expect(plan.targets.at(-1)).toMatchObject({
      captureOrder: 743,
      rowIndex: 742,
      sourceSplit: "cs",
      sourceSplitRowIndex: 86,
    });
    expect(plan.independenceBoundary).toMatchObject({
      evaluatorFieldInput: false,
      machineOutcomeInput: false,
      semanticLedgerInput: false,
      selection: "all-frozen-source-rows",
    });
  });

  it("keeps target projection invariant to hidden evaluator hashes", () => {
    const source = JSON.parse(
      readFileSync(SOURCE_POOL_PATH, "utf8"),
    ) as {
      rows: Array<Record<string, unknown>>;
    };
    const first = projectC6SWEbenchLiveMultiLangCapturePlan({
      sourcePoolBytes: Buffer.from(
        `${JSON.stringify(source, null, 2)}\n`,
      ),
      sourcePoolPath: SOURCE_POOL_PATH,
    });
    source.rows[0]!.evaluatorOnlySha256 = "f".repeat(64);
    source.rows[0]!.normalizedRowSha256 = "e".repeat(64);
    const second = projectC6SWEbenchLiveMultiLangCapturePlan({
      sourcePoolBytes: Buffer.from(
        `${JSON.stringify(source, null, 2)}\n`,
      ),
      sourcePoolPath: SOURCE_POOL_PATH,
    });

    expect(second.independenceBoundary.targetProjectionSha256).toBe(
      first.independenceBoundary.targetProjectionSha256,
    );
    expect(second.targets).toEqual(first.targets);
  });

  it("fails closed on source target projection drift", () => {
    const source = JSON.parse(
      readFileSync(SOURCE_POOL_PATH, "utf8"),
    ) as {
      rows: Array<{ repository: string }>;
    };
    source.rows[0]!.repository = "different/repository";
    expect(() =>
      projectC6SWEbenchLiveMultiLangCapturePlan({
        sourcePoolBytes: Buffer.from(
          `${JSON.stringify(source, null, 2)}\n`,
        ),
        sourcePoolPath: SOURCE_POOL_PATH,
      })
    ).toThrow("source target projection mismatch");
  });
});
