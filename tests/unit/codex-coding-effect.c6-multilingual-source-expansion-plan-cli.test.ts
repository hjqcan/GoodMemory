import { describe, expect, it } from "bun:test";
import {
  mkdtemp,
  readFile,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  parseC6MultilingualSourceExpansionPlanCliOptions,
  runC6MultilingualSourceExpansionPlanSnapshotCommand,
} from "../../scripts/snapshot-codex-coding-effect-c6-multilingual-source-expansion-plan";

const SOURCE_POOL_PATH = resolve(
  "fixtures/codex-coding-effect/c6-source-pool/" +
    "swe-bench-multilingual-e5c585e.source-pool.json",
);
const SOURCE_POOL_SHA256 =
  "15cf8d4a0a7ab0e3e7dee32555f266f1bccfd47ace7f5b31d8e474e064c37cf5";

describe("C6 multilingual source-expansion plan CLI", () => {
  it("writes one new deterministic plan and refuses overwrite", async () => {
    const root = await mkdtemp(join(tmpdir(), "c6-multilingual-plan-"));
    const output = join(root, "plan.json");
    try {
      const args = [
        `--source-pool=${SOURCE_POOL_PATH}`,
        `--expected-source-pool-sha256=${SOURCE_POOL_SHA256}`,
        `--output=${output}`,
      ];
      const result =
        await runC6MultilingualSourceExpansionPlanSnapshotCommand(args);

      expect(result.counts.targetCount).toBe(300);
      expect(result.output).toBe(output);
      expect(
        JSON.parse(await readFile(output, "utf8")).targets,
      ).toHaveLength(300);
      await expect(
        runC6MultilingualSourceExpansionPlanSnapshotCommand(args),
      ).rejects.toThrow();
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("rejects duplicate, padded, unknown, and malformed hash options", () => {
    expect(() =>
      parseC6MultilingualSourceExpansionPlanCliOptions([
        "--source-pool=a",
        "--source-pool=b",
        `--expected-source-pool-sha256=${SOURCE_POOL_SHA256}`,
        "--output=c",
      ])
    ).toThrow();
    expect(() =>
      parseC6MultilingualSourceExpansionPlanCliOptions([
        "--source-pool= a",
        `--expected-source-pool-sha256=${SOURCE_POOL_SHA256}`,
        "--output=c",
      ])
    ).toThrow();
    expect(() =>
      parseC6MultilingualSourceExpansionPlanCliOptions([
        "--source-pool=a",
        "--expected-source-pool-sha256=bad",
        "--output=c",
      ])
    ).toThrow();
    expect(() =>
      parseC6MultilingualSourceExpansionPlanCliOptions([
        "--source-pool=a",
        `--expected-source-pool-sha256=${SOURCE_POOL_SHA256}`,
        "--output=c",
        "--unknown=d",
      ])
    ).toThrow();
  });
});
