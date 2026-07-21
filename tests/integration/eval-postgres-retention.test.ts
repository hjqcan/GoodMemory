import { SQL } from "bun";
import { describe, expect, it } from "bun:test";

import {
  beginEvalPostgresRun,
  cleanupEvalPostgresSchemas,
  withEvalPostgresRunRetention,
} from "../../src/eval/postgresRetention";

const POSTGRES_URL = process.env.GOODMEMORY_TEST_POSTGRES_URL;

async function schemaExists(url: string, schema: string): Promise<boolean> {
  const sql = new SQL(url);
  try {
    const rows = await sql.unsafe<Array<{ exists: boolean }>>(
      "SELECT to_regnamespace($1) IS NOT NULL AS exists",
      [schema],
    );
    return rows[0]?.exists === true;
  } finally {
    await sql.close();
  }
}

if (POSTGRES_URL) {
  describe("eval Postgres retention integration", () => {
    it("protects active runs, drops successes, and expires retained failures", async () => {
      const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const active = await beginEvalPostgresRun({
        attemptId: `${unique}-attempt`,
        benchmark: "integration",
        now: () => new Date("2026-07-01T00:00:00.000Z"),
        runId: `${unique}-active`,
        url: POSTGRES_URL,
      });

      try {
        await expect(
          beginEvalPostgresRun({
            attemptId: `${unique}-different-attempt`,
            benchmark: "integration",
            runId: `${unique}-active`,
            url: POSTGRES_URL,
          }),
        ).rejects.toThrow("already active");
        const activeCleanup = await cleanupEvalPostgresSchemas({
          apply: true,
          now: new Date("2026-07-21T00:00:00.000Z"),
          onlySchemas: [active.schema],
          retentionDays: 7,
          url: POSTGRES_URL,
        });
        expect(activeCleanup.decisions).toHaveLength(1);
        expect(activeCleanup.decisions[0]).toMatchObject({
          action: "keep",
          bytes: 0,
          metadata: {
            benchmark: "integration",
            runId: `${unique}-active`,
            status: "running",
          },
          reason: "active-run",
          schema: active.schema,
        });
        expect(await schemaExists(POSTGRES_URL, active.schema)).toBe(true);
      } finally {
        await active.retain("failed");
      }

      const retained = await cleanupEvalPostgresSchemas({
        apply: false,
        now: new Date("2026-07-05T00:00:00.000Z"),
        onlySchemas: [active.schema],
        retentionDays: 7,
        url: POSTGRES_URL,
      });
      expect(retained.decisions[0]?.reason).toBe("within-retention-window");

      const expired = await cleanupEvalPostgresSchemas({
        apply: true,
        now: new Date("2026-07-09T00:00:00.000Z"),
        onlySchemas: [active.schema],
        retentionDays: 7,
        url: POSTGRES_URL,
      });
      expect(expired.deletedSchemas).toEqual([active.schema]);
      expect(await schemaExists(POSTGRES_URL, active.schema)).toBe(false);

      const successful = await beginEvalPostgresRun({
        benchmark: "integration",
        runId: `${unique}-successful`,
        url: POSTGRES_URL,
      });
      await withEvalPostgresRunRetention({
        lease: successful,
        run: async () => ({ summary: { executionFailures: 0 } }),
        verify: async () => {},
      });
      expect(await schemaExists(POSTGRES_URL, successful.schema)).toBe(false);
    });

    it("reaps expired failures before starting the next managed run", async () => {
      const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const expired = await beginEvalPostgresRun({
        benchmark: "integration-reap",
        now: () => new Date("2026-07-01T00:00:00.000Z"),
        runId: `${unique}-expired`,
        url: POSTGRES_URL,
      });
      await expired.retain("failed");
      expect(await schemaExists(POSTGRES_URL, expired.schema)).toBe(true);

      const current = await beginEvalPostgresRun({
        benchmark: "integration-reap",
        now: () => new Date("2026-07-09T00:00:00.000Z"),
        runId: `${unique}-current`,
        url: POSTGRES_URL,
      });
      try {
        expect(await schemaExists(POSTGRES_URL, expired.schema)).toBe(false);
      } finally {
        await current.drop();
      }
    });
  });
} else {
  describe("eval Postgres retention integration", () => {
    it("requires GOODMEMORY_TEST_POSTGRES_URL", () => {});
  });
}
