import { describe, expect, it } from "bun:test";

import {
  buildEvalPostgresSchemaName,
  DEFAULT_EVAL_POSTGRES_RETENTION_DAYS,
  isEvalPostgresSchemaMetadataBound,
  parseEvalPostgresSchemaComment,
  planEvalPostgresRetention,
  serializeEvalPostgresSchemaComment,
  withEvalPostgresRunRetention,
  type EvalPostgresRunLease,
  type EvalPostgresSchemaMetadata,
} from "../../src/eval/postgresRetention";

const CREATED_AT = "2026-07-01T00:00:00.000Z";

function buildMetadata(
  overrides: Partial<EvalPostgresSchemaMetadata> = {},
): EvalPostgresSchemaMetadata {
  return {
    attemptId: "attempt-1",
    benchmark: "longmemeval",
    createdAt: CREATED_AT,
    runId: "run-1",
    schemaVersion: 1,
    status: "failed",
    updatedAt: CREATED_AT,
    ...overrides,
  };
}

function createLease(events: string[]): EvalPostgresRunLease {
  return {
    schema: "gm_eval_longmemeval_deadbeef",
    async drop() {
      events.push("drop");
    },
    async retain(status) {
      events.push(`retain:${status}`);
    },
  };
}

describe("eval Postgres retention", () => {
  it("derives a bounded attempt schema without leaking the run id", () => {
    const schema = buildEvalPostgresSchemaName({
      attemptId: "attempt-1",
      benchmark: "LongMemEval",
      runId: "run/private/path/with spaces",
    });

    expect(schema).toMatch(/^gm_eval_longmemeval_[a-f0-9]{16}$/u);
    expect(schema).not.toContain("private");
    expect(schema.length).toBeLessThanOrEqual(63);
    expect(buildEvalPostgresSchemaName({
      attemptId: "attempt-1",
      benchmark: "LongMemEval",
      runId: "run/private/path/with spaces",
    })).toBe(schema);
    expect(buildEvalPostgresSchemaName({
      attemptId: "attempt-2",
      benchmark: "LongMemEval",
      runId: "run/private/path/with spaces",
    })).not.toBe(schema);
  });

  it("round-trips only marked versioned schema metadata", () => {
    const metadata = buildMetadata();

    expect(
      parseEvalPostgresSchemaComment(
        serializeEvalPostgresSchemaComment(metadata),
      ),
    ).toEqual(metadata);
    expect(parseEvalPostgresSchemaComment("unrelated schema")).toBeNull();
    expect(
      parseEvalPostgresSchemaComment(
        "goodmemory-eval:v1:{\"schemaVersion\":2}",
      ),
    ).toBeNull();
    expect(
      isEvalPostgresSchemaMetadataBound(
        buildEvalPostgresSchemaName(metadata),
        metadata,
      ),
    ).toBe(true);
    expect(
      isEvalPostgresSchemaMetadataBound(
        "gm_eval_longmemeval_forged00000000",
        metadata,
      ),
    ).toBe(false);
  });

  it("deletes only stale, marked, unlocked schemas", () => {
    const decisions = planEvalPostgresRetention({
      now: new Date("2026-07-21T00:00:00.000Z"),
      schemas: [
        {
          active: false,
          bytes: 100,
          metadata: buildMetadata(),
          schema: "gm_eval_longmemeval_old",
        },
        {
          active: true,
          bytes: 200,
          metadata: buildMetadata(),
          schema: "gm_eval_longmemeval_active",
        },
        {
          active: false,
          bytes: 300,
          metadata: buildMetadata({
            updatedAt: "2026-07-20T00:00:00.000Z",
          }),
          schema: "gm_eval_longmemeval_recent",
        },
        {
          active: false,
          bytes: 400,
          metadata: null,
          schema: "gm_eval_unmarked",
        },
      ],
    });

    expect(DEFAULT_EVAL_POSTGRES_RETENTION_DAYS).toBe(7);
    const oldMetadata = buildMetadata();
    const recentMetadata = buildMetadata({
      updatedAt: "2026-07-20T00:00:00.000Z",
    });
    expect(decisions).toEqual([
      {
        action: "delete",
        bytes: 100,
        metadata: oldMetadata,
        reason: "retention-expired",
        schema: "gm_eval_longmemeval_old",
      },
      {
        action: "keep",
        bytes: 200,
        metadata: oldMetadata,
        reason: "active-run",
        schema: "gm_eval_longmemeval_active",
      },
      {
        action: "keep",
        bytes: 300,
        metadata: recentMetadata,
        reason: "within-retention-window",
        schema: "gm_eval_longmemeval_recent",
      },
      {
        action: "ignore",
        bytes: 400,
        metadata: null,
        reason: "unmarked-schema",
        schema: "gm_eval_unmarked",
      },
    ]);
  });

  it("drops successful runs and retains failed or explicitly retained runs", async () => {
    const successEvents: string[] = [];
    const success = await withEvalPostgresRunRetention({
      lease: createLease(successEvents),
      run: async () => ({ summary: { executionFailures: 0 } }),
      verify: async () => {
        successEvents.push("verify");
      },
    });
    expect(success.summary.executionFailures).toBe(0);
    expect(successEvents).toEqual(["verify", "drop"]);

    const failedEvents: string[] = [];
    await withEvalPostgresRunRetention({
      lease: createLease(failedEvents),
      run: async () => ({ summary: { executionFailures: 2 } }),
    });
    expect(failedEvents).toEqual(["retain:failed"]);

    const retainedEvents: string[] = [];
    await withEvalPostgresRunRetention({
      lease: createLease(retainedEvents),
      retain: true,
      run: async () => ({ summary: { executionFailures: 0 } }),
    });
    expect(retainedEvents).toEqual(["retain:retained"]);
  });

  it("retains thrown runs before rethrowing the original failure", async () => {
    const events: string[] = [];
    const failure = new Error("provider failed");

    await expect(
      withEvalPostgresRunRetention({
        lease: createLease(events),
        run: async () => {
          throw failure;
        },
      }),
    ).rejects.toBe(failure);
    expect(events).toEqual(["retain:failed"]);
  });

  it("retains a run when final report verification fails", async () => {
    const events: string[] = [];
    const failure = new Error("report mismatch");

    await expect(
      withEvalPostgresRunRetention({
        lease: createLease(events),
        run: async () => ({ summary: { executionFailures: 0 } }),
        verify: async () => {
          throw failure;
        },
      }),
    ).rejects.toBe(failure);
    expect(events).toEqual(["retain:failed"]);
  });

  it("preserves the evaluation failure when retaining it also fails", async () => {
    const failure = new Error("evaluation failed");
    const originalConsoleError = console.error;
    const logged: unknown[][] = [];
    console.error = (...values: unknown[]) => {
      logged.push(values);
    };

    try {
      await expect(
        withEvalPostgresRunRetention({
          lease: {
            schema: "gm_eval_longmemeval_deadbeef",
            async drop() {},
            async retain() {
              throw new Error("retain failed");
            },
          },
          run: async () => {
            throw failure;
          },
        }),
      ).rejects.toBe(failure);
      expect(logged).toHaveLength(1);
    } finally {
      console.error = originalConsoleError;
    }
  });
});
