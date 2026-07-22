import { describe, expect, it } from "bun:test";
import {
  GROUPS,
  evaluateCoverage,
  mergeCoverageRecords,
  parseLcov,
  resolveOverallRecords,
} from "../../scripts/check-coverage";

function buildCoverageRecords(
  overrides: Record<string, { found: number; covered: number }> = {},
) {
  const root = process.cwd();
  const defaults: Record<string, { found: number; covered: number }> = {
    "src/domain/example.ts": { found: 10, covered: 10 },
    "src/remember/example.ts": { found: 10, covered: 10 },
    "src/recall/example.ts": { found: 10, covered: 10 },
    "src/runtime/example.ts": { found: 10, covered: 10 },
    "src/maintenance/example.ts": { found: 10, covered: 10 },
    "src/verify/example.ts": { found: 10, covered: 10 },
    "src/storage/example.ts": { found: 10, covered: 10 },
    "src/eval/example.ts": { found: 10, covered: 10 },
    "src/provider/example.ts": { found: 10, covered: 10 },
    "src/api/example.ts": { found: 10, covered: 10 },
    "src/ai-sdk/example.ts": { found: 10, covered: 10 },
    "src/host/example.ts": { found: 10, covered: 10 },
    "src/install/example.ts": { found: 10, covered: 10 },
    "src/language/example.ts": { found: 10, covered: 10 },
    "src/cli.ts": { found: 10, covered: 10 },
    "scripts/run-eval.ts": { found: 20, covered: 19 },
    "scripts/summarize-eval.ts": { found: 31, covered: 25 },
  };

  return parseLcov(
    Object.entries({ ...defaults, ...overrides })
      .flatMap(([path, counts]) => [
        `SF:${root}/${path}`,
        `LF:${counts.found}`,
        `LH:${counts.covered}`,
      ])
      .join("\n"),
  );
}

describe("check-coverage script", () => {
  it("includes summarize-eval in group gates and overall coverage", () => {
    const records = buildCoverageRecords();

    expect(GROUPS.some((group) => group.name === "scripts/summarize-eval.ts")).toBe(true);
    expect(resolveOverallRecords(records).slice(0, 3).map((record) => record.path)).toEqual([
      "src/domain/example.ts",
      "src/remember/example.ts",
      "src/recall/example.ts",
    ]);
    expect(resolveOverallRecords(records).slice(-2).map((record) => record.path)).toEqual([
      "scripts/run-eval.ts",
      "scripts/summarize-eval.ts",
    ]);

    const result = evaluateCoverage(records);
    expect(
      result.groups.find((group) => group.name === "scripts/summarize-eval.ts")?.percent,
    ).toBeCloseTo(80.65, 2);
    expect(result.failures).toEqual([]);
  });

  it("keeps public source surfaces inside explicit coverage gates and the overall denominator", () => {
    const records = buildCoverageRecords({
      "src/cli.ts": { found: 1000, covered: 0 },
      "src/install/hostMcpServer.ts": { found: 1000, covered: 0 },
    });

    expect(resolveOverallRecords(records).map((record) => record.path)).toContain(
      "src/cli.ts",
    );
    expect(resolveOverallRecords(records).map((record) => record.path)).toContain(
      "src/install/hostMcpServer.ts",
    );
    expect(evaluateCoverage(records).failures).toEqual([
      "overall deterministic line coverage 8.40% < 90.00%",
      "src/install line coverage 0.99% < 80.00%",
      "src/cli.ts line coverage 0.00% < 85.00%",
    ]);
  });

  it("fails independently when the language package coverage drops below its threshold", () => {
    const records = buildCoverageRecords({
      "src/language/example.ts": { found: 100, covered: 84 },
    });

    expect(GROUPS.find((group) => group.name === "src/language")?.threshold).toBe(85);
    expect(evaluateCoverage(records).failures).toContain(
      "src/language line coverage 84.00% < 85.00%",
    );
  });

  it("merges repeated lcov records using line-level coverage union", () => {
    const root = process.cwd();
    const records = parseLcov(
      [
        `SF:${root}/src/storage/example.ts`,
        "DA:1,1",
        "DA:2,0",
        "LF:2",
        "LH:1",
        "end_of_record",
        `SF:${root}/src/storage/example.ts`,
        "DA:1,0",
        "DA:2,3",
        "DA:3,0",
        "LF:3",
        "LH:1",
        "end_of_record",
      ].join("\n"),
    );

    expect(mergeCoverageRecords(records)).toMatchObject([
      {
        covered: 2,
        found: 3,
        path: "src/storage/example.ts",
      },
    ]);
  });

  it("fails when summarize-eval coverage drops below the threshold", () => {
    const records = buildCoverageRecords({
      "scripts/run-eval.ts": { found: 20, covered: 20 },
      "scripts/summarize-eval.ts": { found: 10, covered: 7 },
    });

    const result = evaluateCoverage(records);
    expect(result.failures).toContain("scripts/summarize-eval.ts line coverage 70.00% < 80.00%");
  });

  it("fails when overall deterministic coverage drops below the release threshold", () => {
    const records = buildCoverageRecords({
      "src/other/uncovered.ts": { found: 100, covered: 50 },
    });

    const result = evaluateCoverage(records);
    expect(result.failures).toContain(
      "overall deterministic line coverage 81.06% < 90.00%",
    );
  });
});
