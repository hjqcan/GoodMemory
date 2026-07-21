import { describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { parseCleanupEvalPostgresOptions } from "../../scripts/cleanup-eval-postgres";

describe("cleanup-eval-postgres script", () => {
  it("defaults to a seven-day dry run", () => {
    expect(
      parseCleanupEvalPostgresOptions([
        "bun",
        "run",
        "scripts/cleanup-eval-postgres.ts",
      ]),
    ).toEqual({
      apply: false,
      retentionDays: 7,
    });
  });

  it("requires explicit apply and validates the retention window", () => {
    expect(
      parseCleanupEvalPostgresOptions([
        "bun",
        "run",
        "scripts/cleanup-eval-postgres.ts",
        "--apply",
        "--retention-days",
        "3",
      ]),
    ).toEqual({
      apply: true,
      retentionDays: 3,
    });
    expect(() =>
      parseCleanupEvalPostgresOptions([
        "bun",
        "run",
        "scripts/cleanup-eval-postgres.ts",
        "--retention-days",
        "0",
      ])
    ).toThrow("--retention-days must be a positive integer");
  });

  it("keeps the cleanup command and retention contract discoverable", async () => {
    const root = join(import.meta.dir, "../..");
    const packageJson = JSON.parse(
      await readFile(join(root, "package.json"), "utf8"),
    ) as { scripts?: Record<string, string> };
    const docs = await readFile(
      join(root, "docs/GoodMemory-Eval-Storage-Retention.md"),
      "utf8",
    );

    expect(packageJson.scripts?.["eval:storage:cleanup"]).toBe(
      "bun run scripts/cleanup-eval-postgres.ts",
    );
    expect(docs).toContain("默认 dry-run");
    expect(docs).toContain("7 天");
    expect(docs).toContain("GOODMEMORY_EVAL_RETAIN_POSTGRES=1");
    expect(docs).toContain("report.json");
  });
});
